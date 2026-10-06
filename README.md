# Medota2

> 本地优先、来源可追溯的 Dota 2 数据与图鉴平台，提供英雄、技能、单位及交互地图。

Medota2 把锁定 commit 的 Dota 2 原始数据转换为可复现的 PostgreSQL 数据集，并提供本地 Web 查询、差异审阅、安全发布与回滚。它不把上游目录直接当作产品模型，也不以分支名、`latest` 或文件修改时间代表数据版本。

## 项目状态

| 范围         | 当前状态                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 产品切片     | Hero Catalog v2、英雄／技能／单位图鉴、独立单位资产与交互地图已实现；单位资料尚未持久化为独立 Dataset                                 |
| 数据链路     | exact-commit source lock → 全量候选 → semantic diff → Green/Yellow/Red gate → 原子发布/回滚                                           |
| 运行方式     | 本地开发与本地真实数据审阅；尚未定义远程 production 部署形态                                                                          |
| 环境安全     | Environment Contract v1、独立数据库角色、共享开发连接验证缓存、显式独立 Test Harness 已实现                                           |
| 最近完整验收 | 2026-10-06：组合单测、数据库合同、真实数据关键流程、桌面／手机视觉与正式构建／启动通过；详细范围见当前进展                            |
| 数据审计基线 | commit `991daaf6fc24b08445209d9ce8767e145bab107e`：127 Heroes、2,703 accepted Abilities、4,752 bindings、339 Facets、0 blocking error |

开发工作台、语义化图鉴、浏览器离线目录、单位头像和地图均已完成本机验证。具体检查范围、数据来源、已知缺项与性能测量边界见 [当前进展](docs/current.md)。GitHub Actions 的远程执行结果另行记录。

审计数字描述一次真实快照，不是业务常量。后续版本会从锁定来源重新发现文件并执行完整校验。

当前产品不包含比赛、玩家、胜率、出装、实时对局或 replay 分析；这些属于后续数据域，不应从 Catalog 能力推断为已经实现。

## 已实现能力

- 从 `dota_vpk_updates` 动态发现全部分 Hero 文件，导入正式 Heroes 与完整 Ability 定义集。
- 保留 ordered KeyValues、重复定义、BaseClass 继承、AbilityValues、modifier、数值 ID 映射和结构化 exclusion reason。
- 建模 `loadout`、`talent`、`draft`、`facet`、`linked`、`sub_ability`、`upgrade_granted` 与声明归属关系。
- `/heroes` 按力量、敏捷、智力、全才分组，以英雄肖像进入技能说明、天赋树、命石、基础属性与背景故事。
- `/abilities` 使用紧凑技能条目与即时悬停卡，详情以玩家可读名称展示技能、各级效果、冷却、魔耗及神杖／魔晶升级；支持英雄、类型、升级与状态筛选。原始定义、ID 与来源记录保留在数据层，产品页面不再直接展示。
- 展示层处理游戏文本占位符、枚举、等级数值与条件升级。完整数值标签、命石与机制说明会读取已锁定来源的本地化文件并校验 SHA-256；来源位置沿用 `DOTA_VPK_WORKTREE_ROOT` 或 `DOTA_VPK_UPDATES_PATH`。缺失或版本不符时仅显示可确认的资料，不猜测名称和效果。详见[语义化游戏图鉴](docs/specs/semantic-game-ui.md)。
- 首页使用紧凑头像网格和即时悬停卡；收录的游戏性版本与客户端构建号分开显示。游戏性版本从同一 commit 的 `scripts/change_log.txt` 读取，需本机 Git 与匹配的可选来源仓库；来源缺失时显示待确认。
- 英雄／技能列表输入即筛选，选项即时生效；支持中英文、完整拼音、拼音首字母及常见中英文别称。例：`敌法` / `Anti-Mage` / `difashi` / `dfs` / `AM`，技能可搜索 `闪烁` / `shanshuo` / `ss` 或 `am blink`。保留 URL 恢复与当前状态等筛选条件；技能模板、历史定义需切换对应状态或全部。
- 悬停只更新当前与上一个卡片；正式构建预取图鉴和停留后的详情，近期页面复用 300 秒。开发模式不自动预取，首次编译仍需等待；刷新立即读取当前版本。详见[性能与缓存边界](docs/specs/semantic-game-ui.md#悬停与导航性能)。
- 英雄／技能目录采用浏览器优先策略：IndexedDB 持久保存版本快照，搜索、筛选、排序与分块在本机完成；后台每60秒轻检版本，只同步变化的哈希块。同版本重载复用本机资料，已打开目录可断网查询。详见[缓存范围与边界](docs/specs/browser-catalog-cache.md)。
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

本地机器、云端与临时工作区通过 Git 协同开发并交接 PostgreSQL、图片和地图的方式见[多环境数据同步设计](docs/specs/development-data-sync.md)。首版已实现工作区身份、Git/LFS 快照获取、受管候选恢复、内容核验与只读数据库页；首个私有快照已发布并通过远端下载核验，跨机器接入需要数据仓库读取权限。具体命令见[同步运行手册](docs/development-data-sync-runbook.md)。平台目标包含 Windows 原生 PowerShell，WSL2 为可选路径；当前 Windows 原生兼容适配和实机验收尚未完成，详见[方案要求](docs/specs/development-data-sync.md#windows-原生支持要求待实施)。

Windows 原生接入使用系统 Node、项目指定的 pnpm 和 Docker Compose；进程启动、私有凭据 ACL 与完整同步的验证状态见[同步运行手册](docs/development-data-sync-runbook.md)。Windows 进程直接调用 pnpm 的 JavaScript 入口，`pnpm-workspace.yaml` 的 `shellEmulator` 支持脚本中的环境变量赋值，不要求 Git Bash。2026-10-06 已在原生 PowerShell／Node、Docker WSL2 后端完成数据库恢复、重复应用和导出回验；项目仍在 Windows 文件系统中。Docker VMM 需共享项目 `docker` 目录，本机该后端发生通信故障，未验收其完整同步流程。

各环境已有资源、适合的任务和限制集中记录在[开发环境与能力登记册](docs/development-environments.md)。目前登记 `GofurMacM4Max128GB` 的三个元数据来源仓库与 `GofurWindowsLenovo` 的 Dota 2 客户端资源；遇到环境缺项时按登记能力推荐执行位置并准备交接。

### 多机器同步

各机器只保留操作系统、路径、进程与数据库连接等兼容配置。代码和业务数据统一交接：数据库记录、英雄／技能／单位图片、全部地图版本、地形图层及来源文件绑定同一份快照。

`pnpm push` 提交本地代码变化，发布当前完整数据并更新数据 lock，再一起推送当前分支。另一台机器运行 `pnpm sync`，拉取代码、安装固定依赖、应用对应数据并重启工作台。同步前自动保存尚未导出的本地数据，旧数据库与地图包保留；同步后的页面使用下载的共享地图集合，本机旧路径不再覆盖它。

`pnpm push -m "说明"` 可指定代码提交说明。首次需配置现有私有数据仓库权限；命令使用普通 Git 非强制推送，分支分叉时仍按 Git 合并处理。没有额外 Git hooks；直接 `git push` 仍是 Git 的代码推送，因此项目日常统一使用 `pnpm push`。详见[同步运行手册](docs/development-data-sync-runbook.md)。

### 自动空间保留策略

发布和测试命令结束后自动维护本机生成产物，默认保留最近2份成功发布包、10份成功测试完整附件。失败附件至少保留7天及最近5份；已有缺少新执行元数据的历史失败保留，标记`.resolved`后才按规则淘汰。各目录内创建`.keep`可固定保留；当前任务、未完成记录及共享测试租约所引用目录保留。测试摘要与日志持续保留，重复trace经SHA-256核对后只保留完整HTML报告中的副本。

```bash
pnpm storage:clean                       # 只预览候选和保留理由
pnpm storage:clean --apply               # 持锁执行可再生产物清理
pnpm storage:clean --scope tests         # 只预览测试附件
pnpm storage:clean --scope releases --apply
```

自定义数量可在忽略文件`.medota2/storage-policy.json`中填写部分配置：

```json
{
  "releases": 2,
  "successfulTests": 10,
  "failedTests": 5,
  "failureGraceDays": 7,
  "logMaxBytes": 10485760,
  "logArchives": 3
}
```

工作台日志持续轮转，每份最多10 MiB，保留当前日志及3份历史日志；子进程输出统一写入`.medota2/development/server.log`及`.1`至`.3`。首次启动会将原来的大日志按同一容量规则迁入；修改日志配置后运行`pnpm dev:restart`。本机文件计量与清理收据见`.medota2/maintenance/last-storage-cleanup.json`；删除发布包的manifest另存于`maintenance/releases/`，测试目录内`storage-cleanup.json`记录附件去向。

自动清理在CI跳过，设置`MEDOTA2_AUTO_CLEANUP=0`可禁用本机自动附件清理；手动命令仍可使用。清理只选择受管发布包与已完成测试的可再生附件，保留来源缓存、数据同步仓库、候选、地图、身份凭据及数据库备份。历史构建目录的整批清理仍需像本次空间审计一样核对运行引用。详细行为见[工作台Spec](docs/specs/development-workbench.md)。

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
- identity、marker、peer role 或安全函数签名不一致时 fail closed，页面显示“数据连接未验证，暂不可用”。
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

### 单位图鉴

顶栏「单位」进入 `/units`，支持中英文／拼音搜索、分类筛选、悬停基础属性及详情中的技能链接。运行 `pnpm dev` 后使用固定工作台访问。单位读取当前 Catalog 固定 commit 的可配置 VPK Git 来源，路径沿用 `DOTA_VPK_UPDATES_PATH` / `DOTA_VPK_WORKTREE_ROOT`；未配置匹配来源时显示未接入。单位定义当前是只读补充模型；单位头像已进入独立资产版本，提供原图和三级缩略图。活动／辅助／历史定义不等于当前对局可用单位。实现和检查见 [单位图鉴 Spec](docs/specs/unit-catalog.md)。

单位头像导入（先运行对应环境的迁移）：

```bash
pnpm db:migrate
pnpm data:import:unit-assets
# 当前本机真实数据预览；额外从固定 ReDota 提交导入模型截图
pnpm db:migrate:local
pnpm data:import:unit-assets:local --portrait-commit f51e568e6ef45e32e1a7d21def805bdd7604568b
```

默认下载 Valve Steam CDN 单位头像；`--portrait-commit` 启用可选 ReDota 模型截图，必须给出完整 Git commit。`--reuse-portraits` 保留同一 Catalog 和补充来源提交已有的独立／共用头像，只重新处理其余条目；不加此参数会重新下载。下载失败不切换资产 head；所有单位都有独立头像、共用头像、关联技能图标或缺图的明确记录。页面 `/valve-assets/unit/[key]?v=...&width=64` 只读取数据库。图片版本与 Catalog 绑定，但 CDN / 社区截图的游戏构建号未经确认。原始图片保存在本机数据库，不写入仓库；外部发布前仍需审查 Valve 资产许可。详细来源见 [ReDota 审阅](docs/repositories/redota.md)。

## 地图

顶栏「地图」进入 `/map`，支持缩放／拖拽、分类图层、搜索、测距和范围圈。版本来源在右上问号提示中查看；地形与视图操作合用一行，搜索与紧凑图层筛选位于地图下方，点位多列平铺；右侧显示所选对象属性与操作。静态画面缓存和逐帧输入合并减少悬停开销，切换状态不清空画布。版本是独立数据身份：7.41e与7.41f同等可选，各自绑定底图、实体、地形层和来源，不随默认版本切换而失去访问入口。

右上角深色下拉选择地图版本；树木默认填满对齐导航网格的阻挡色块，在100%缩放下即可悬停查看XYZ，悬停文字位于所有地图标记上方。7.41f／6944新增28个营地刷新体积、拉野／叠野提示时间、26类基础野怪组合与清野金币／经验区间，以及六条原生兵线路径。营地默认细边框，悬停时高亮并显示「Z 轴范围」；营地、组合和单体经验随时间与分裂体开关联动。兵线路径可悬停查看当前时间一波兵的金币与经验；可选择单座、本路两座或全部六座敌方兵营被毁状态。经验按单人独享、旗手额外奖励仅计金币。7.41e没有匹配收益资料，界面明确显示缺失，不混用7.41f数值。组合／时序是按补丁审阅的规则模型，尚未逐项实机结算验证。

本机已接入两个版本：**7.41e**为Sloppy固定来源的4096px SFM图、2585点和28营地边界；**7.41f**为地图哈希核验后的本机客户端6944数据，包含原生XYZ／阵营、活动世界层、营地PHYS边界、导航栅格与高度图，搭配相同地图哈希的4096px SFM底图。7.41e客户端号未知；7.41f补丁名称仍来自固定社区索引。地形栅格尚未经引擎验证；提供静态寻路估算，不提供真实游戏导航或视野模拟。

无需游戏安装也可导入指定的公开版本：

```sh
pnpm exec tsx src/workers/import-public-map.ts --commit 38fb8ef1d16c99c141d0630e5227110fd082b364 --patch 7.41e --output .medota2/maps/7.41e-sloppy-38fb8ef
```

本机原生提取与导入分别使用`pnpm exec tsx src/workers/extract-local-map.ts`、`pnpm exec tsx src/workers/import-local-map.ts`；集合命令`pnpm exec tsx src/workers/index-maps.ts`将各Dataset登记为独立版本。全部参数、完整步骤、兼容入口和来源边界见[地图Spec](docs/specs/map-explorer.md)，本机格式审阅见[本机地图数据](docs/repositories/local-dota-map.md)。

配置`DOTA_MAP_COLLECTION_PATH`后运行`pnpm dev:restart`，通过`/map?version=7.41e`与`/map?version=7.41f-6944`分别查看。无数据库的本机可使用显式`MEDOTA2_WORKBENCH_MAPS_ONLY=1`文件地图预览模式；要求development+sandbox，沿用固定3000服务，不伪造数据库身份。安装与测试命令见Spec。

所有提取和导入输出必须是新目录；原文、版本号、哈希、导入器／schema版本与许可文件随Dataset保存。Valve资源保持本机Git忽略，未公开发布。

「测距」旁的「寻路」支持创建／选中多条路线，右侧设置移速并比较陆地最短距离、湍流最短耗时及双生门；只显示最快与耗时接近的方案，点击线切换，Delete删除，右键或Esc退出工具。后台计算显示进度，普通陆地路线经过湍流同样计入方向加速。常规入口不包含飞行。树木和建筑显示对齐64单位格的阻挡近似，路径坐标按1单位取整；遗迹模型范围与湍流斜向加速仍需引擎验证。地形图例位于右侧，有视野单位默认显示昼夜范围圈。顶部拉野/叠野秒数默认开启，野区经验默认关闭；使用和估算边界见[地图Spec](docs/specs/map-explorer.md#寻路树木阻挡与地图提示)。
