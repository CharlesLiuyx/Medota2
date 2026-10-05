# Medota2

> 本地优先、来源可追溯、原子版本化的 Dota 2 Heroes / Abilities Catalog。

Medota2 把锁定 commit 的 Dota 2 原始数据转换为可复现的 PostgreSQL 数据集，并提供本地 Web 查询、差异审阅、安全发布与回滚。它不把上游目录直接当作产品模型，也不以分支名、`latest` 或文件修改时间代表数据版本。

## 项目状态

| 范围         | 当前状态                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 产品切片     | Hero Catalog v2 已完成：Heroes、Abilities、Facets、关系、本地化、图标资产与查询界面                                                   |
| 数据链路     | exact-commit source lock → 全量候选 → semantic diff → Green/Yellow/Red gate → 原子发布/回滚                                           |
| 运行方式     | 本地开发与本地真实数据审阅；尚未定义远程 production 部署形态                                                                          |
| 环境安全     | Environment Contract v1、独立数据库角色、共享开发连接验证缓存、显式独立 Test Harness 已实现                                           |
| 最近完整验收 | 2026-08-31：186 个 Unit tests、19 个 Integration tests、34 个 E2E tests、production build/start smoke 全部通过                        |
| 数据审计基线 | commit `991daaf6fc24b08445209d9ce8767e145bab107e`：127 Heroes、2,703 accepted Abilities、4,752 bindings、339 Facets、0 blocking error |

开发工作台已于 2026-10-06 完成本机验收：199 个单元测试、19 个数据库集成测试、共享与固定数据关键流程、独立产物构建/启动均通过。具体范围与反馈延迟见 [当前进展](docs/current.md)。上表保留此前完整产品验收基线。

审计数字描述一次真实快照，不是业务常量。后续版本会从锁定来源重新发现文件并执行完整校验。

当前产品不包含比赛、玩家、胜率、出装、实时对局或 replay 分析；这些属于后续数据域，不应从 Catalog 能力推断为已经实现。

## 已实现能力

- 从 `dota_vpk_updates` 动态发现全部分 Hero 文件，导入正式 Heroes 与完整 Ability 定义集。
- 保留 ordered KeyValues、重复定义、BaseClass 继承、AbilityValues、modifier、数值 ID 映射和结构化 exclusion reason。
- 建模 `loadout`、`talent`、`draft`、`facet`、`linked`、`sub_ability`、`upgrade_granted` 与声明归属关系。
- `/heroes` 按 Strength、Agility、Intelligence、Universal 分组；Hero 详情展示 Abilities、Talents & Upgrades、Raw 与 Provenance。
- `/abilities` 默认展示 current，并可查询 indirect、defined/unbound、template 和 deprecated；详情展示逐级数值、关系、原始定义和来源。
- 首期支持 `zh-CN` 与 `en`；本地化使用行模型，增加 locale 不需要修改核心实体表。
- 所有内容列表共享无限滚动、cursor continuation 和上方 7× / 下方 10× 视口预加载合同。
- Hero 与 Ability 图标以内容寻址二进制和 `original`、`w64`、`w128`、`w256` LoD 存入 PostgreSQL。
- Catalog 与 Asset Dataset 分别版本化；替换图标或调整 LoD 不需要重建玩法数据。
- Design System 使用语义 token、键盘焦点与桌面/移动响应式规则，组件画廊位于 `/design-system`。

## 快速开始

前置条件：Node.js 24 LTS（最低 `22.12`）、pnpm 11、Git、Docker。E2E 还需要项目锁定的 Playwright Chromium。

首次启动共享开发工作台：

```bash
pnpm install
cp .env.example .env  # 已有 .env 时保留原文件
pnpm dev
```

打开 [http://127.0.0.1:3000/heroes](http://127.0.0.1:3000/heroes)。该入口默认优先复用已准备的 local-review 真实 Catalog 和资产，启动前检查图片覆盖；已有数据保持原样。没有真实审阅环境时，才使用 development 数据库，空库加载含占位图的小样例，并在开发面板标明。第二个 Session 再运行 `pnpm dev` 会连接同一个后台服务。

保存页面代码后自动热更新。页面右下角“共享开发”显示真实解析器的小样例、运行状态、耗时与错误；连续保存合并重算，旧结果不会覆盖新结果。页面数据与下方计算样例相互独立，计算使用的小 fixture 不替换页面的真实数据。冷启动与首次页面编译会慢一些。

`.env` 的 `MEDOTA2_WORKBENCH_DATA` 默认为 `auto`；可显式设为 `local-review` 或 `development`，修改后运行 `pnpm dev:restart`。真实数据模式的资产检查不通过时会报错，不会静默切换为占位图。

```bash
pnpm dev:restart             # 配置、迁移或脚手架变化后重新准备并恢复预览
pnpm dev:stop                # 停止共享 Web 和样例进程，保留数据库
pnpm db:development:stop     # 需要时单独停止开发数据库
pnpm dev:sample              # 在终端执行同一个小样例
```

开发日志位于 `.medota2/development/server.log`。多个 Session 共用目录和当前分支，各自维护 `.medota2/sessions/<id>.md`；提交、分支切换、依赖安装和数据库写操作先协调。详见 [AGENTS.md](AGENTS.md)。

### 配置 OpenDota Secret

在项目根目录的 `.env` 中填写以下变量（本地文件，不提交 Git）：

```dotenv
OPENDOTA_API_KEY=你的_OpenDota_API_Key
```

首次从 `.env.example` 创建文件后，运行 `chmod 600 .env`，使它仅对当前用户开放读写。通过编辑器填写 Key，保存后重启需要使用它的进程。请勿将真实值填入 `.env.example` 或使用 `NEXT_PUBLIC_` 前缀。

Node.js 服务端和 Worker 通过 `src/config/env.ts` 的 `getOpenDotaApiKey()` 读取；进程环境变量优先于 `.env`，未填写时返回 `null`。当前只提供 Secret 配置入口，尚未接入 OpenDota 比赛查询、付费调用或录像下载。详细约定见 [OpenDota Secret Spec](docs/specs/opendota-secret.md)。

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

### 一键启动真实数据审阅环境

先在 `.env` 中配置只读的 `DOTA_VPK_UPDATES_PATH`，之后首次初始化和日常启动都只需要：

```bash
pnpm local
```

`pnpm local` 是 `pnpm dev:local` 的短别名。它会幂等地完成以下准备后启动 Web：

1. receipt 不存在时 provision 独立 local-review PostgreSQL stack，已存在时只启动原 stack；
2. 应用尚未执行的 migration；
3. 已有 active Catalog 时直接复用，不重复导入；
4. 首次没有 Catalog 时，从配置的只读 VPK checkout 导入真实快照并补齐官方图片。

首次导入若只有暂时的 `asset_provider_errors`，启动器会重试资产；仅当重试结果达到完整 LoD、零 fallback、零 mismatch、零 error 时，才会自动批准并晋升这个 asset-only Yellow 候选。任何玩法、来源或其他语义差异仍会停在人工 Review 门禁，不会为了启动页面而绕过。

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

| Runtime Environment | Data Class            | 本地数据库      | 浏览器 origin                    | 用途                             |
| ------------------- | --------------------- | --------------- | -------------------------------- | -------------------------------- |
| `development`       | `sandbox`             | `medota2`       | `3000` 选择 development 时       | 可重建开发沙箱                   |
| `test`              | `synthetic-fixture`   | 受管测试库      | Runner 动态分配                  | 可复用；支持显式独立测试栈       |
| `local-review`      | `production-snapshot` | `medota2_local` | 共享预览 `3000`；独立审阅 `3001` | 本机真实快照审阅，不等同线上生产 |
| `production`        | `live-production`     | 无本地默认值    | 部署显式提供                     | 当前只开放 Web/read              |

安全边界：

- 非生产数据库 URL 由受管 lifecycle 写入私有 receipt，不写入 `.env`。
- Web 每次 pool checkout 恢复只读状态。共享 development Web 对每个物理连接验证一次身份与权限；其他模式继续完整验证。迁移后重启开发 Web；Worker 无持久 DDL/control 写权限。
- production contract v1 只签发 `Web/read`，Worker 与 Migration 默认拒绝。
- identity、marker、peer role 或安全函数签名不一致时 fail closed，页面显示 `DATA ACCESS BLOCKED`。
- 既有 `127.0.0.1:54321` legacy stack 不会被 provision 命令静默迁移、删除或重新解释。

日常诊断：

```bash
pnpm db:environment:doctor
pnpm db:environment:doctor:local
```

旧数据栈 adoption 会轮换 credential、调整 owner/ACL 并终止连接，不是日常启动步骤；只能按照 [ADR 0005](docs/adr/0005-environment-contract.md) 与相关 preflight 证据单独授权执行。概念入口见 [CONTEXT.md](CONTEXT.md)，详细约束见[环境合同](docs/architecture/environment-contract-details.md)。

## 开发与验证

```bash
pnpm check --plan            # 只显示影响范围、理由和准备需求
pnpm check                   # 运行必要检查，复用仍有效的静态检查结果
pnpm check --files src/components/hero-card.tsx
pnpm check --base <git-ref>  # 检查指定 Git 状态之后的组合改动
pnpm check --watch           # 相关内容变化后重跑
pnpm test:journeys           # 在共享开发页面执行短流程，不重置开发数据
pnpm test:journeys --fixture # 在可复用测试库核对已知数据与页面
pnpm test:integration --testNamePattern 'enforces canonical'
pnpm test:e2e tests/e2e/heroes.spec.ts --grep 'overview'
pnpm bench --iterations 5   # 真实解析器的小样例耗时与内存
pnpm bench --input <vpk-directory> --iterations 3
pnpm release                # 构建并启动检查 Web 产物，相同输入复用
pnpm test:clean             # 清理本工具持有的可复用测试栈
```

`check` 按文件与功能选择少量 E2E、已有针对性单测、静态检查和必要构建。纯文档不启动产品数据库或浏览器；普通页面改动不跑全量构建。类型检查使用独立的 `tsconfig.check.json` 和 TypeScript 增量缓存，避免开发服务重新生成 `.next` 类型时相互干扰；框架生成的路由约束由正式构建检查。工具链变化会扩大范围，完整验证仍可显式运行：

```bash
pnpm typecheck
pnpm test
pnpm test:integration:isolated  # 每次全新数据库，适合身份/权限合同检查
pnpm test:e2e:isolated          # 完整 Desktop + Mobile 与视觉回归
pnpm verify                     # 显式全量诊断，包含覆盖率
```

日常固定数据测试复用一套 PostgreSQL，相关写入排队；浏览器状态和报告每次独立。测试 API 固定数据版本，相关代码或数据变化时结果作废。`check` 的证据位于 `.medota2/checks/`，测试报告位于 `.medota2/shared-tests/runs/`；独立验证仍在 `.medota2/test-runs/`。

CI 在安装 Chromium 或准备数据库前计算范围，调用同一个 `pnpm check`，并取消同分支已过期的运行。仅完整输入与执行条件一致时复用结果；本地与 CI 分别记录。默认无覆盖率门槛。

`release` 当前只准备 `.medota2/releases/` 下的 Web 产物，并用固定测试数据做启动检查。远程部署目标尚未配置。计算引擎、独立部署单元和大型调度按实际需要扩展。详见[开发工作台规范](docs/specs/development-workbench.md)。

## 仓库结构

```text
Medota2/
├── src/app/                 # Heroes、Abilities、Design System、asset routes
├── src/components/          # Catalog 组件与 UI primitives
├── src/domain/              # 领域合同、版本与 semantic diff
├── src/importers/           # KeyValues、来源 adapters、source lock、资产导入
├── src/server/              # schema、repositories、asset provider
│   └── environment/         # attestation、policy、provision/adoption boundary
├── src/development/         # 共享工作台、样例与测试环境
├── scripts/development/     # 本地与 CI 共用的检查范围规则
├── src/testing/             # 显式独立验证 Harness
├── src/workers/             # import、refresh、Review、promotion、rollback CLI
├── drizzle/                 # 已审阅 SQL migrations
├── docker/                  # PostgreSQL roles 与 environment identity bootstrap
├── ops/                     # development 调度示例
├── tests/                   # fixtures、Unit、Integration、E2E 与视觉基线
├── docs/                    # Spec、ADR、来源、设计与运维文档
└── .github/workflows/       # 按需检查 CI
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
- [当前进展与接手](docs/current.md)
- [共享开发工作台规范](docs/specs/development-workbench.md)
- [共享开发与按需验证 ADR](docs/adr/0007-shared-development-workbench.md)
- [Hero Catalog v2 Spec](docs/specs/hero-catalog-v2.md)
- [全局 List 无限滚动与上 7× / 下 10× 预加载 Spec](docs/specs/infinite-lists.md)
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
