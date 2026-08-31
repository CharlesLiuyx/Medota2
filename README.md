# Medota2

> 本地优先、来源可追溯、原子版本化的 Dota 2 Heroes / Abilities Catalog。

Medota2 把锁定 commit 的 Dota 2 原始数据转换为可复现的 PostgreSQL 数据集，并提供本地 Web 查询、差异审阅、安全发布与回滚。它不把上游目录直接当作产品模型，也不以分支名、`latest` 或文件修改时间代表数据版本。

## 项目状态

| 范围         | 当前状态                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 产品切片     | Hero Catalog v2 已完成：Heroes、Abilities、Facets、关系、本地化、图标资产与查询界面                                                   |
| 数据链路     | exact-commit source lock → 全量候选 → semantic diff → Green/Yellow/Red gate → 原子发布/回滚                                           |
| 运行方式     | 本地开发与本地真实数据审阅；尚未定义远程 production 部署形态                                                                          |
| 环境安全     | Environment Contract v1、独立数据库角色、per-checkout attestation、run-scoped Test Harness 已实现                                     |
| 最近完整验收 | 2026-08-31：186 个 Unit tests、19 个 Integration tests、34 个 E2E tests、production build/start smoke 全部通过                        |
| 数据审计基线 | commit `991daaf6fc24b08445209d9ce8767e145bab107e`：127 Heroes、2,703 accepted Abilities、4,752 bindings、339 Facets、0 blocking error |

审计数字描述一次真实快照，不是业务常量。后续版本会从锁定来源重新发现文件并执行完整校验。

当前产品不包含比赛、玩家、胜率、出装、实时对局或 replay 分析；这些属于后续数据域，不应从 Catalog 能力推断为已经实现。

## 已实现能力

- 从 `dota_vpk_updates` 动态发现全部分 Hero 文件，导入正式 Heroes 与完整 Ability 定义集。
- 保留 ordered KeyValues、重复定义、BaseClass 继承、AbilityValues、modifier、数值 ID 映射和结构化 exclusion reason。
- 建模 `loadout`、`talent`、`draft`、`facet`、`linked`、`sub_ability`、`upgrade_granted` 与声明归属关系。
- `/heroes` 按 Strength、Agility、Intelligence、Universal 分组；Hero 详情展示 Abilities、Talents & Upgrades、Raw 与 Provenance。
- `/abilities` 默认展示 current，并可查询 indirect、defined/unbound、template 和 deprecated；详情展示逐级数值、关系、原始定义和来源。
- 首期支持 `zh-CN` 与 `en`；本地化使用行模型，增加 locale 不需要修改核心实体表。
- 所有内容列表共享无限滚动、cursor continuation 和 3× 视口预加载合同。
- Hero 与 Ability 图标以内容寻址二进制和 `original`、`w64`、`w128`、`w256` LoD 存入 PostgreSQL。
- Catalog 与 Asset Dataset 分别版本化；替换图标或调整 LoD 不需要重建玩法数据。
- Design System 使用语义 token、键盘焦点与桌面/移动响应式规则，组件画廊位于 `/design-system`。

## 快速开始

前置条件：Node.js 24 LTS（最低 `22.12`）、pnpm 11、Git、Docker。E2E 还需要项目锁定的 Playwright Chromium。

首次创建 development sandbox：

```bash
pnpm install
cp .env.example .env
pnpm db:development:provision
pnpm db:migrate
pnpm dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。新数据库在导入 Catalog 前可以正常启动，但不会凭空生成真实游戏数据。

首次 provision 成功后，日常启动和停止数据库使用：

```bash
pnpm db:development:start
pnpm dev
pnpm db:development:stop
```

`provision` 只建立受管数据栈、轮换本地凭据并签发 `.medota2/environments/development/` 下权限为 `0600` 的 receipt；它不会运行产品 migration、清空业务表或移动 Catalog/Asset head。

### 导入锁定的上游数据

推荐从远端发现并锁定精确 commit：

```bash
pnpm data:source:discover:vpk
pnpm data:source:lock:vpk --commit <40-character-sha>
pnpm data:import:catalog --lock <lock-file>
```

也可以在 `.env` 中把 `DOTA_VPK_UPDATES_PATH` 指向已有的只读 checkout，再运行：

```bash
pnpm data:import:catalog
```

正式导入要求 Medota2 checkout 干净，使 `importer_version` 能准确标识转换代码。分支名和目录时间戳都不能替代 source lock。

### 审阅真实数据与最终界面

需要在独立环境中导入真实快照、下载缺失的官方图片并查看最终页面时：

```bash
pnpm db:local-review:provision
pnpm db:migrate:local
pnpm data:import:vpk:local
pnpm dev:local
```

local-review 使用独立的 Compose project、54322 端口、volume 和 receipt，页面入口为：

- [http://127.0.0.1:3001/heroes](http://127.0.0.1:3001/heroes)
- [http://127.0.0.1:3001/abilities](http://127.0.0.1:3001/abilities)
- [http://127.0.0.1:3001/design-system](http://127.0.0.1:3001/design-system)

导入失败不会预先清空已有 snapshot。只有确实需要重建时，才单独执行带精确确认的 `pnpm data:reset:local-review -- --confirm medota2_local`。

## 架构概览

```text
exact upstream commit
        │
        ▼
read-only source lock ── checksums / manifest / selector version
        │
        ▼
TypeScript importer ─── ordered KV / adapters / validation
        │
        ├──────────────► immutable Hero Catalog Dataset
        │                           │
Valve VPK / Steam static ──────────┴──► immutable Asset Dataset
                                            │
                           review / gate / atomic heads
                                            │
                                            ▼
                              PostgreSQL 18 + read-only Web
                                            │
                                            ▼
                                Next.js local application
```

核心不变量：

1. Heroes、Abilities、关系与本地化共享同一个不可变 Catalog version，查询不会跨版本撕裂。
2. Asset Dataset 独立版本化，但必须绑定到具体 Catalog；发布和回滚都会验证完整匹配的 asset head。
3. 浏览器不直连数据库；Web、Worker、Migration 使用独立角色和最小权限。
4. 导入、Git 更新、VPK 提取和批量转换不在 Next.js 请求生命周期内执行。
5. 所有派生数据保留来源 commit、路径、checksum、ClientVersion、importer version 与 schema version。

### 技术栈

| 层次                 | 选择                                                          |
| -------------------- | ------------------------------------------------------------- |
| Runtime              | Node.js 24 LTS、pnpm 11                                       |
| Web                  | Next.js 16.3、React 19.2、TypeScript 6 strict、Tailwind CSS 4 |
| Database             | PostgreSQL 18.2、Drizzle ORM、`pg`、`pg-copy-streams`         |
| Images               | Sharp 解码、校验与 WebP LoD 转换                              |
| Validation           | Zod 4、显式领域校验、已审阅 SQL migration                     |
| Tests                | Vitest、Testing Library、Playwright                           |
| Local infrastructure | Docker Compose                                                |

首期没有引入 Redis、Kafka、独立 API 服务或 Rust Worker。只有 profiling 与可复现 benchmark 证明需要时，才评估新的运行时或大型框架。

## 数据来源与版本身份

| 来源                                                                                                    | 当前职责                                                |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [spirit-bear-productions/dota_vpk_updates](https://github.com/spirit-bear-productions/dota_vpk_updates) | Heroes / Abilities 玩法与本地化唯一 SSOT                |
| [odota/dotaconstants](https://github.com/odota/dotaconstants)                                           | 隔离 QA/reference 与官方图片路径映射，不覆盖 VPK 规范值 |
| [SteamDatabase/GameTracking-Dota2](https://github.com/SteamDatabase/GameTracking-Dota2)                 | 协议、Source 2 schema 与非 VPK 事实交叉核对             |

导入身份由 source repository、完整 commit、selector version、动态文件集合、每个 blob SHA-256、manifest SHA-256、ClientVersion、SourceRevision、importer version 与 schema version 共同确定。Asset Dataset 还记录图片映射 checkout 与输入文件 checksum。

三个上游都是独立、可选、只读的外部来源，不属于本仓库，也不会随 Medota2 发布。详细选源边界见[外部仓库总览](docs/repositories/README.md)。

## 图标资产

如果本机有 Dota 2 VPK 和 [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md)，配置只读输入与新的版本化输出目录：

```dotenv
DOTA_VPK_PATH=/absolute/path/to/game/dota/pak01_dir.vpk
SOURCE2VIEWER_CLI_PATH=/absolute/path/to/Source2Viewer-CLI
DOTA_VALVE_ASSET_PATH=.medota2/cache/valve-assets/<client-version>
DOTA_VALVE_ASSET_CLIENT_VERSION=<client-version>
```

```bash
pnpm data:extract:assets:vpk
pnpm data:import:assets
pnpm data:audit:assets
```

本机没有完整 VPK 资产时，可在导入阶段显式下载 Valve Steam static 资源：

```bash
pnpm data:import:assets --download-missing
pnpm data:audit:assets
```

网页运行时不访问 CDN。解析优先级为“VPK 精确资源 → Steam 官方精确资源 → VPK alias → Steam 官方 alias → generated fallback”。普通离线开发允许可审计 fallback；正式资产验收默认要求 `generated_fallbacks = 0`。

提取器不会覆盖已有输出目录，先在同一父目录原子 staging，并通过 manifest 固化 VPK/CLI/ClientVersion 指纹。完整设计与发布门禁见 [ADR 0002](docs/adr/0002-valve-local-asset-provider.md) 和 [ADR 0004](docs/adr/0004-database-icon-asset-datasets.md)。

## 更新、Review 与回滚

development sandbox 的幂等刷新入口：

```bash
pnpm data:refresh:catalog:development
```

- Green：已知安全变化，自动发布。
- Yellow：保留候选与 semantic diff，等待人工 Review。
- Red：拒绝发布，继续提供上一有效版本。

常用审阅操作：

```bash
pnpm data:diff:catalog --candidate <dataset-version-id>
pnpm data:review:catalog --candidate <dataset-version-id> --decision approved --reason "<reason>"
pnpm data:import:assets --catalog-version <dataset-version-id>
pnpm data:promote:catalog --candidate <dataset-version-id>
pnpm data:rollback:catalog --to <dataset-version-id> --reason "<reason>"
```

如果 exact/native 资产覆盖率下降，promotion/rollback 默认失败。只有完成来源核对并明确接受降级时，才在实际 head 切换命令追加 `--allow-fallback-downgrade`。

该刷新入口和 `ops/launchd/` 示例只面向 `development + sandbox`，不代表 production Worker 或生产调度已经实现。完整流程见[Hero Catalog 更新操作手册](docs/operations/catalog-refresh.md)。

## 环境合同

Medota2 不用 `NODE_ENV`、数据库名后缀或缺省的 `main` 推断数据环境。每个进程必须声明 Runtime Environment 与 Data Class，并通过外部 receipt、数据库 identity marker、PostgreSQL system identifier、endpoint、role/ACL 和 operation policy 的联合验证。

| Runtime Environment | Data Class            | 本地数据库      | 浏览器 origin    | 用途                             |
| ------------------- | --------------------- | --------------- | ---------------- | -------------------------------- |
| `development`       | `sandbox`             | `medota2`       | `127.0.0.1:3000` | 可重建开发沙箱                   |
| `test`              | `synthetic-fixture`   | run-scoped      | Harness 动态分配 | 一次性测试栈                     |
| `local-review`      | `production-snapshot` | `medota2_local` | `127.0.0.1:3001` | 本机真实快照审阅，不等同线上生产 |
| `production`        | `live-production`     | 无本地默认值    | 部署显式提供     | 当前只开放 Web/read              |

安全边界：

- 非生产数据库 URL 由受管 lifecycle 写入私有 receipt，不写入 `.env`。
- Web 每次 pool checkout 恢复只读状态并重新验证身份与权限；Worker 无持久 DDL/control 写权限。
- production contract v1 只签发 `Web/read`，Worker 与 Migration 默认拒绝。
- identity、marker、peer role 或安全函数签名不一致时 fail closed，页面显示 `DATA ACCESS BLOCKED`。
- 既有 `127.0.0.1:54321` legacy stack 不会被 provision 命令静默迁移、删除或重新解释。

日常诊断：

```bash
pnpm db:environment:doctor
pnpm db:environment:doctor:local
```

旧数据栈 adoption 会轮换 credential、调整 owner/ACL 并终止连接，不是日常启动步骤；只能按照 [ADR 0005](docs/adr/0005-environment-contract.md) 与相关 preflight 证据单独授权执行。完整模型见 [CONTEXT.md](CONTEXT.md)。

## 开发与验证

```bash
pnpm typecheck               # TypeScript strict
pnpm lint                    # ESLint
pnpm format:check            # Prettier
pnpm test                    # Unit tests
pnpm test:integration        # PostgreSQL migration/权限/原子性/回滚
pnpm test:e2e                # Desktop + Mobile Chromium，含视觉回归
pnpm test:e2e:concurrent     # 两个完整 E2E run 并发隔离
pnpm test:harness:isolation  # 注入失败不影响并发 survivor
pnpm verify                  # 本地/CI 共用全量门禁与版本化证据
pnpm build                   # Webpack production build
pnpm data:audit:catalog      # 真实 checkout 全量 parser 审计
```

Integration、E2E 与 `verify` 每次创建独立 PostgreSQL 18.2 tmpfs stack、Run ID、动态数据库/Web 端口、receipt root、Next dist 和 artifact root。测试网络策略为 `loopback-only`；成功或失败后只清理该 run 的精确资源。

证据保存在 `.medota2/test-runs/<run-id>/`，包含 `run.json`、摘要、逐步日志、coverage 和 Playwright 产物。Drizzle config 只用于离线 schema generation；contract v1 不提供会绕过 VerifiedSession 的 `db:studio`。

## 仓库结构

```text
Medota2/
├── src/app/                 # Heroes、Abilities、Design System、asset routes
├── src/components/          # Catalog 组件与 UI primitives
├── src/domain/              # 领域合同、版本与 semantic diff
├── src/importers/           # KeyValues、来源 adapters、source lock、资产导入
├── src/server/              # schema、repositories、asset provider
│   └── environment/         # attestation、policy、provision/adoption boundary
├── src/testing/             # run-scoped Test Harness
├── src/workers/             # import、refresh、Review、promotion、rollback CLI
├── drizzle/                 # 已审阅 SQL migrations
├── docker/                  # PostgreSQL roles 与 environment identity bootstrap
├── ops/                     # development 调度示例
├── tests/                   # fixtures、Unit、Integration、E2E 与视觉基线
├── docs/                    # Spec、ADR、来源、设计与运维文档
└── .github/workflows/       # 全量 verify CI
```

## 路线图与决策边界

以下是后续方向，不是当前已有能力：

1. 通过新 ADR 定义远程 production topology、secret distribution、常驻 Worker、调度重试与可观测性。
2. 选择并规范第一个比赛/API/replay 输入，继续沿用来源隔离、provenance 与版本兼容规则。
3. 在规范比赛数据之上增加分析模型、本地查询与可视化。
4. 只有 profiling 证明 TypeScript/SQL/批处理不足时，才引入独立 Rust Worker。

新增大型框架、服务、生产写能力或 Rust 前必须先提交 ADR。计划项进入实现后，同步更新本文、相关 Spec、可执行命令和验证证据。

## 文档入口

- [Medota2 Domain Context](CONTEXT.md)
- [Hero Catalog v2 Spec](docs/specs/hero-catalog-v2.md)
- [全局 List 无限滚动与 3× 预加载 Spec](docs/specs/infinite-lists.md)
- [Medota2 Design System](docs/design-system.md)
- [技术选型与数据处理架构](docs/architecture/technology-selection.md)
- [Hero Catalog 更新操作手册](docs/operations/catalog-refresh.md)
- [Environment Contract ADR](docs/adr/0005-environment-contract.md)
- [Run-scoped Harness 与验证证据 ADR](docs/adr/0006-run-scoped-verification.md)
- [Environment Isolation 与 Verification Spec](docs/specs/environment-isolation-and-verification.md)
- [真实快照审计报告](docs/data/real-snapshot-audit-991daaf6.json)
- [外部仓库总览与选源指南](docs/repositories/README.md)

## 许可与声明

本项目尚未选择开源许可证。公开可见不等于授予复制、修改或再分发许可。完整 VPK、声音、模型、提取缓存和批量 Valve 资产不会提交到 Git 或纳入公开发行物；数据库中的 Valve 资产仅限当前批准的本地自用范围。

Medota2 是非官方项目，与 Valve Corporation、Dota 2、SteamDatabase、OpenDota、Liquipedia 及其他上游项目没有隶属或背书关系。Dota 2 和相关商标、游戏内容归其各自权利人所有。
