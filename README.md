# Medota2

> 本地运行、以来源可追溯和原子版本为核心的 Dota 2 Heroes / Abilities Catalog。

Hero Catalog v2 已实现从固定 `dota_vpk_updates` commit 到 PostgreSQL、查询界面和更新门禁的完整链路。Heroes、Abilities、Facets、关系与本地化共享同一个不可变 catalog version；`dotaconstants` 仅作为隔离参考，不覆盖 VPK 规范值。

全产品所有内容 List 的加载与渲染统一遵循[全局 List 无限滚动与 3× 预加载 Spec](docs/specs/infinite-lists.md)；该合同取代旧有分页或一次性 DOM 全量渲染约定。

## 已实现能力

- 从 `dota_vpk_updates` 动态发现全部分 Hero 文件，导入正式 Heroes 与完整 Ability 定义集。
- 保留 ordered KeyValues、重复定义、BaseClass 继承、AbilityValues、modifier、数值 ID 映射和结构化 exclusion reason。
- 建模 `loadout`、`talent`、`draft`、`facet`、`linked`、`sub_ability`、`upgrade_granted` 与声明归属关系。
- `/heroes` 按 Strength、Agility、Intelligence、Universal 分组；Hero 详情包含 Abilities、Talents & Upgrades、Raw 与 Provenance。
- `/abilities` 默认展示 current，并可查询 indirect、defined/unbound、template 和 deprecated；详情可查看逐级数值、关系、原始定义和来源。
- 首期支持 `zh-CN` 与 `en`；本地化使用行模型，增加 locale 不需要修改 Hero/Ability 核心表。
- Design System 使用语义 token、复用组件、键盘焦点和桌面/移动响应式规则；组件画廊位于 `/design-system`。
- Hero 与 Ability icon 以内容寻址二进制和 `original`、`w64`、`w128`、`w256` LoD 存入 PostgreSQL；本地 Valve 源缺失时也会生成并入库确定性 fallback，保证显示覆盖率为 100%。
- 资产使用独立的不可变 dataset version 与 head；替换来源图片、调整 LoD 策略或增加新图片时不需要重建玩法 Catalog。
- 远端发现、exact-commit source lock、detached worktree、全量候选、semantic diff、Green/Yellow/Red gate、Review、原子发布与回滚均已实现。

审计快照 `991daaf6fc24b08445209d9ce8767e145bab107e` 的一次真实全量运行得到 127 Heroes、2,703 accepted Abilities、4,752 bindings、339 Facets，0 blocking error。它们是审计结果，不是写死的业务常量；后续版本由 selector 和验证规则重新计算。

## 技术栈

- Node.js 24 LTS（最低 `22.12`）、pnpm 11；
- Next.js 16、React 19、TypeScript strict、Tailwind CSS 4；
- PostgreSQL 18、Drizzle schema、node-postgres、`pg-copy-streams`；
- Sharp 图片解码、校验与 WebP LoD 转换；
- Zod、Vitest、Playwright、ESLint、Prettier；
- Docker Compose 本地数据库。

Web、Worker 与 migration 使用独立 PostgreSQL 账号。浏览器不直连数据库；Web 账号只读，Worker 无 DDL 权限，也不能直接改 current head。

## 环境合同

Medota2 不再用 `NODE_ENV`、URL 后缀或缺省的 `main` 推断数据环境。每个进程必须声明 Runtime Environment 与 Data Class；初始化时读取外部 receipt 并冻结 expected identity，每次 PostgreSQL pool checkout 再重置 session、进入只读 attestation，核对冻结期望与 PostgreSQL system identifier、数据库内 identity marker、server endpoint、role/ACL 和操作策略。验证成功后，应用层只接收 opaque verified capability；migration、Worker、seed/reset 不接受裸 URL。receipt 不是实时撤销通道，变更后必须重启进程。

| Runtime Environment | Data Class            | 本地数据库       | 浏览器 origin                | 用途                                       |
| ------------------- | --------------------- | ---------------- | ---------------------------- | ------------------------------------------ |
| `development`       | `sandbox`             | `medota2`        | `http://127.0.0.1:3000`      | 内部开发与可重建沙箱                       |
| `test`              | `synthetic-fixture`   | `medota2_test`   | Harness 分配的 loopback 端口 | 每 run 一次性 fixture stack                |
| `local-review`      | `production-snapshot` | `medota2_local`  | `http://127.0.0.1:3001`      | 本机审阅真实来源数据，不等同 live 线上库   |
| `production`        | `live-production`     | 不提供本地缺省值 | 由部署配置显式提供           | 需外部 identity receipt 与 verify-full TLS |

contract v1 的 capability 矩阵默认拒绝，当前明确开放范围如下：

| 环境           | Web    | Worker                           | Migration            | 额外门禁                                           |
| -------------- | ------ | -------------------------------- | -------------------- | -------------------------------------------------- |
| `development`  | `read` | `import/review/promote/rollback` | `migrate/reset`      | reset 需精确确认 `medota2`                         |
| `test`         | `read` | `fixture`                        | `migrate/seed/reset` | 必须有 Run ID，marker 必须为 `run-scoped`          |
| `local-review` | `read` | `import/review/promote/rollback` | `migrate/reset`      | 非 Web 均需精确确认；reset 还需 `explicit-rebuild` |
| `production`   | `read` | 拒绝                             | 拒绝                 | 三项外部身份 + `verify-full` TLS                   |

Web capability 的每次 checkout 都恢复 `default_transaction_read_only=on`，并证明它没有业务 DML、持久 DDL、列级写授权、control marker 写授权或可写 security-definer 函数；所有应用 SECURITY DEFINER 定义同时受签名、owner、`search_path` 与规范化函数体 SHA-256 清单约束，应用 trigger/rule 默认拒绝。Worker 还必须证明无持久 DDL、control 写入、role membership 与高权限属性。operation 是 capability 路由和 policy 意图，不是 SQL parser；最终数据库权限仍由独立 PostgreSQL role 强制执行。

Fresh Docker volume 会在产品 migration 前创建三个 `quarantined` marker，同时保持全部环境角色 `NOLOGIN`。`db:development:provision`、`db:local-review:provision` 和 Test Run Harness 会生成一次性 bootstrap secret，并在同一受管生命周期内完成 preflight、credential rotation、owner/ACL 收敛和 active postflight。它们不会运行产品 migration、TRUNCATE、业务表 DML 或移动 Catalog/Asset head。

下面的低层 cutover 入口只用于已经存在且带 contract-v1 marker 的旧三库栈；它会终止连接并轮换 credential，必须获得单独精确授权，不能当作新受管栈的日常初始化步骤：

```bash
pnpm db:environment:adopt:local-stack -- --confirm adopt:medota2,medota2_local,medota2_test
```

legacy adoption 只接受三库都已有、结构正确且彼此一致的 contract-v1 marker；未知、无 marker 的旧库不会被 CLI 自动“认领”为可信环境。此类旧库必须先走另行 Review 的 provisioning/restore 流程，或把数据恢复到新建的受管栈。失败发生在 cutover 前时不改数据库状态；cutover 开始后的失败会尽力收敛到三库 `quarantined`、runtime `NOLOGIN`。若恢复本身无法被证明，状态必须视为未知：保持应用停止并人工核对，不能假定连接一定已经关闭。

日常可用 doctor 核对三个 role 是否收敛到同一个安全数据库指纹。每次签发非只读 capability 时也会先完成同样的三角色 identity convergence；任一 peer URL、server 或 marker 分叉都会拒绝写入：

```bash
pnpm db:environment:doctor
pnpm db:environment:doctor:local
```

所有页面顶部常驻显示 `DEVELOPMENT`、`TEST`、`LOCAL REVIEW` 或 `PRODUCTION`、Data Class、数据库验证状态、安全指纹与 run ID；`local-review` 只声明 `production-snapshot` 分类，不声称自动证明已经与线上物理隔离。identity 验证失败时会明确显示 `DATA ACCESS BLOCKED`，不会猜测目标。Catalog API 同时返回 `X-Medota2-Environment`、Data Class、verification、run ID 和安全数据库指纹响应头，不暴露 URL、credential、完整 UUID 或本机路径。完整概念见 [Medota2 Domain Context](CONTEXT.md)，决策与威胁边界见 [ADR 0005](docs/adr/0005-environment-contract.md)。

## 本地启动

前置条件：Node.js、pnpm、Git、Docker；E2E 还需安装项目锁定的 Playwright Chromium。复制配置后，创建并接管独立 development stack，再运行产品 migration：

```bash
pnpm install
cp .env.example .env
pnpm db:development:provision
pnpm db:migrate
pnpm dev
```

provision 成功后，日常 `pnpm db:development:start` / `stop` 只读取 `.medota2/environments/development/` 下当前用户所有、权限为 `0600` 的 receipt。local-review 使用独立的 `medota2-local-review` project、54322 port、volume 与 `.medota2/environments/local-review/` receipt。一个本机用户仍可读取各自 receipt 内的本地角色凭据，因此 `MEDOTA2_PROCESS_ROLE` 是应用层 admission label，不是操作系统级 secret 隔离。需要对恶意本机进程隔离时，应把 Web、Worker 和 migration 放入不同 OS/container identity 并分别注入单一 credential。

已有 `127.0.0.1:54321` legacy stack 不会被这些命令静默迁移、删除或重新解释；端口已被占用时新 development provision 会失败。对旧栈执行低层 adoption 或数据搬迁仍需单独授权。

推荐从远端锁定精确 commit 后导入：

```bash
pnpm data:source:discover:vpk
pnpm data:source:lock:vpk --commit <40-character-sha>
pnpm data:import:catalog --lock <lock-file>
pnpm dev
```

也可把 `DOTA_VPK_UPDATES_PATH` 指向现有本地 checkout 后直接运行 `pnpm data:import:catalog`。正式导入要求 Medota2 checkout 干净，使 `importer_version` 能准确标识转换代码；当前工作区尚未提交、但需要运行最终本地界面时使用独立的 `medota2_local`：

```bash
pnpm db:local-review:provision
pnpm db:migrate:local
pnpm data:import:vpk:local
pnpm dev:local
```

`data:import:vpk:local` 会把本机 `DOTA_VPK_UPDATES_PATH` 指向的真实快照以版本化候选导入独立的 `medota2_local`，不会在检查 source lock、解析或资产下载前清空已有 snapshot。优先使用配置的本机 Valve 资产；缺少本机 VPK 资产源时，从 importer 已限定的 Valve Steam static origin 补齐真实图片，并生成 `original / w64 / w128 / w256`。需要有意清空并重建时，必须单独运行 `pnpm data:reset:local-review -- --confirm medota2_local`；该动作与导入分离。随后 `dev:local` 在 [http://127.0.0.1:3001](http://127.0.0.1:3001) 启动最终本地界面；重启 Web 不会重置或改写数据。`pnpm dev:demo` 保留为 `dev:local` 的兼容别名。

页面入口：

- [http://127.0.0.1:3001/heroes](http://127.0.0.1:3001/heroes)
- [http://127.0.0.1:3001/abilities](http://127.0.0.1:3001/abilities)
- [http://127.0.0.1:3001/design-system](http://127.0.0.1:3001/design-system)

## 数据来源与版本身份

| 来源                                                                                                    | 职责                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [spirit-bear-productions/dota_vpk_updates](https://github.com/spirit-bear-productions/dota_vpk_updates) | Heroes / Abilities 玩法与本地化唯一 SSOT   |
| [odota/dotaconstants](https://github.com/odota/dotaconstants)                                           | 隔离 QA/reference，不参与规范值或 fallback |
| [SteamDatabase/GameTracking-Dota2](https://github.com/SteamDatabase/GameTracking-Dota2)                 | 协议、Source 2 schema 与非 VPK 交叉核对    |

导入身份由 source repository、完整 commit、selector version、动态文件集合、每个 blob SHA-256、manifest SHA-256、ClientVersion、SourceRevision、importer version 与 schema version 共同确定。Steam static 路径所依赖的 `dotaconstants` image map 也把 checkout commit、dirty/input-match、两个 tracked JSON 路径及 checksum 写入 Asset Dataset provenance。分支名、“latest”和目录修改时间都不是版本身份。

本机运行缓存位于 `.medota2/` 并被 Git 忽略。三个上游 checkout 始终只读，也不会随 Medota2 发布。

## 本地 Valve 资产

资产导入依赖已经物化到数据库的 Hero Catalog，不要求它已发布为 current；未指定版本时默认使用 current，也可通过 `--catalog-version <uuid>` 为候选或历史 Catalog 导入。若本机有 Dota 2 客户端 VPK 和 [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md)，先配置只读输入与 Git 忽略的提取目录：

```dotenv
DOTA_VPK_PATH=/absolute/path/to/game/dota/pak01_dir.vpk
SOURCE2VIEWER_CLI_PATH=/absolute/path/to/Source2Viewer-CLI
DOTA_VALVE_ASSET_PATH=.medota2/cache/valve-assets/6918
DOTA_VALVE_ASSET_CLIENT_VERSION=6918
```

先从 VPK 只读提取受限的 Hero、spellicon 和 Innate icon 资源，再把当前 Catalog 的完整资产集导入数据库：

```bash
pnpm data:extract:assets:vpk
pnpm data:import:assets
pnpm data:audit:assets
```

本机没有 VPK，或 VPK 中缺少某个精确资源时，可显式下载 Valve Steam static CDN 中由 `dotaconstants` 映射的官方 Hero/Ability 图片，并把下载字节与全部 LoD 直接固化进 PostgreSQL：

```bash
pnpm data:import:assets --download-missing
pnpm data:audit:assets
```

该开关只在导入阶段联网；网页运行时不访问 CDN。解析优先级为“VPK 精确资源 → Steam 官方精确资源 → VPK alias → Steam 官方 alias → 生成 fallback”。Hero 使用高分辨率 `dota_react/heroes` 图片；Talent、Innate 和确实没有独立图标的定义使用 Valve 的 `attribute_bonus`、`innate_icon` 或 `empty` 图片，而不是字母占位图。

提取器要求显式 ClientVersion，且 `DOTA_VALVE_ASSET_PATH` 指向的最终目录必须尚不存在。它先在最终目录同一父目录下创建一次性 staging，校验 CLI 成功且确实生成文件后，写入 `medota2-valve-asset-extraction.json`，最后才原子改名为最终目录；失败会清理 staging，不会留下可被 importer 误认的半成品。已有目录（即使为空）不会被覆盖或复用，更新客户端后应选择新的版本化目录。输出目录也不能位于 VPK 所在目录内，提取流程不会启用会在 VPK 旁写状态的 cache 模式。

提取 manifest 记录 schema、ClientVersion、完整 VPK SHA-256/字节数、Source 2 Viewer 版本、实际参数、精确 filters、线程数、完成时间和文件数。Importer 在读取图片前验证该 manifest，不能仅凭手填环境变量把未知版本的旧目录声明成当前客户端。含本机命令路径的完整 manifest 只保留在 Git 忽略的本地提取目录；数据库仅记录去除绝对路径后的 VPK/CLI 指纹，HTTP 响应不暴露这些信息。

最后一个命令核对当前 Catalog/asset head、缺失实体、不完整 LoD，以及 VPK/CDN/generated 来源数量，作为素材正确性与 100% 显示覆盖的验收入口。正式验收默认要求 `generated_fallbacks = 0`；只有非验收的离线开发才可显式传 `--allow-generated`。提取命令也接受 `--vpk`、`--cli`、`--output`、`--client-version` 覆盖环境变量，调用 Source 2 Viewer 时固定只处理所需的 `vtex_c` 路径。未传 `--download-missing` 且没有可用 VPK 时，导入器仍生成可显示 fallback，但严格审计会失败，不能再把它当作正确素材验收通过。

`asset_blobs` 保存实际图片字节并按 SHA-256 去重；`asset_objects`、`asset_variants` 和 `entity_asset_bindings` 保存来源、逻辑路径及实体绑定。每个对象都有保留源编码与尺寸的 `original`，以及面向列表和详情页的 `w64`、`w128`、`w256` WebP 变体；HTTP 路由按请求宽度从当前 asset head 选择合适 LoD。资产 dataset/head 与玩法 Catalog 版本身份分离但绑定到具体 Catalog，因此可以重复导入、增加或替换图片并独立提升，不改变玩法数据。

独立导入默认以当前 Catalog 为目标；可用 `--catalog-version <uuid>` 先为候选或历史 Catalog 回填图片，用 `--no-promote` 只创建并校验候选资产版本。若当前 head 已有更多原生 Valve 命中，导入器会拒绝把它静默降级成 alias/generated fallback；只有明确传入 `--allow-fallback-downgrade` 才允许这种替换。切换到不同 Catalog 时还会比较当前与候选的 exact/native 覆盖率，新增 fallback 实体导致的比例下降也会阻止自动 promotion；确需接受时，必须在实际执行 `data:import:catalog` 或 `data:promote:catalog` 时显式传入同一开关。Catalog 的 promotion 与 rollback 也会重新校验目标 Catalog 已有完全匹配的 asset head，因此不会把页面切换到全图 404 的版本。

提取目录、生成缓存、VPK 和批量图片都不提交到 Git；运行时只从 PostgreSQL 提供图片，不暴露机器绝对路径。数据库中的 Valve 资产仅限当前批准的本地自用范围。

## 更新、Review 与回滚

手动和计划任务调用同一个幂等入口：

```bash
pnpm data:refresh:catalog:development
```

该复合刷新入口只绑定 `development + sandbox`，不代表 production 调度已经实现。默认建议开发机每 15 分钟 discover 一次；无新 commit 时 no-op；Green 自动发布；Yellow 保留候选等待 Review；Red 或任意失败保持上一 current head。常用操作：

```bash
pnpm data:diff:catalog --candidate <dataset-version-id>
pnpm data:review:catalog --candidate <dataset-version-id> --decision approved --reason "<reason>"
pnpm data:promote:catalog --candidate <dataset-version-id>
pnpm data:promote:catalog --candidate <dataset-version-id> --allow-fallback-downgrade
pnpm data:rollback:catalog --to <dataset-version-id> --reason "<reason>"
pnpm data:rollback:catalog --to <dataset-version-id> --reason "<reason>" --allow-fallback-downgrade
```

完整配置、launchd 示例、通知、指标、SLO 与恢复流程见[Hero Catalog 更新操作手册](docs/operations/catalog-refresh.md)。

## 开发与验证

```bash
pnpm typecheck             # TypeScript strict
pnpm lint                  # ESLint
pnpm format:check          # Prettier
pnpm test                  # parser/domain/service 单元测试
pnpm test:integration      # 真实 PostgreSQL migration/权限/原子性/回滚
pnpm test:e2e              # Desktop + Mobile Chromium，含视觉回归
pnpm test:e2e:concurrent   # 两个完整 E2E run 并发并核对资源零重叠
pnpm test:harness:isolation # 一个 run 注入失败时另一个完成，且两者精确清理
pnpm verify                # 本地/CI 共用全量门禁与版本化证据
pnpm build                 # Webpack 生产构建
pnpm data:audit:catalog    # 真实 checkout 全量 parser 审计
```

Integration、E2E 与 `verify` 每次都由 Test Run Harness 创建独立的 PostgreSQL 18.2 tmpfs stack、Run ID、动态数据库/Web 端口、receipt root、Next dist、run-local TypeScript config overlay 和 artifact root；成功或普通失败后只销毁该 run 的精确 Compose project。测试进程使用 `loopback-only` policy，Steam CDN、remote Git、webhook 与浏览器外网请求均 fail closed。`run.json`、`index.md`、逐步日志、coverage 和 Playwright 产物保存在 `.medota2/test-runs/<run-id>/`，不会被下一次运行覆盖。视觉基线仍位于 `tests/e2e/visual.spec.ts-snapshots/`。

Integration 红队用例会以 run-scoped control credential 临时制造 role/ACL/函数/trigger 漂移，只能运行在 Harness 创建的一次性 cluster；Playwright config 缺少 Harness context 时直接拒绝启动。测试 Worker 只开放 `fixture` operation，不能把 production-snapshot import adapter 当作 fixture seam。

Drizzle config 仅用于离线 schema generation，不包含任何数据库 URL。Drizzle Studio 无法消费 `VerifiedSession`，会绕过 per-checkout attestation 和环境条幅，因此 contract v1 明确不提供 `db:studio`；需要数据库观察时使用 doctor、应用页面或经过 verified capability 的专用只读命令。

整体环境方案与验收基线见 [Environment Isolation、Test Run Harness 与 Verification Evidence Spec](docs/specs/environment-isolation-and-verification.md)。Environment Contract、run-scoped Harness、分离持久栈、验证证据、mapping provenance 与 promotion/rollback 对称门禁均已进入实现；现有 legacy 54321 栈的破坏性 cutover 仍明确未执行。

## 仓库结构

```text
Medota2/
├── src/app/                 # Heroes、Abilities、Design System、asset routes
├── src/components/          # Catalog 与 UI primitives
├── src/domain/              # Hero/Ability/Catalog contracts 与 semantic diff
├── src/importers/           # KeyValues、SSOT adapters、source lock
├── src/server/              # schema、repositories、asset provider
│   └── environment/         # attestation、policy、provision/adoption boundary
├── src/workers/             # import、refresh、Review、promotion、rollback CLI
├── drizzle/                 # 已审阅 SQL migrations
├── ops/                     # 调度示例
├── tests/                   # fixtures、unit、integration、E2E 与视觉基线
└── docs/                    # Spec、ADR、Design System、来源与运维文档
```

## 设计与架构文档

- [Hero Catalog v2 Spec](docs/specs/hero-catalog-v2.md)
- [全局 List 无限滚动与 3× 预加载 Spec](docs/specs/infinite-lists.md)
- [Medota2 Design System](docs/design-system.md)
- [Hero Catalog 更新操作手册](docs/operations/catalog-refresh.md)
- [ADR：共享 Hero Catalog 版本边界](docs/adr/0001-hero-catalog-version-boundary.md)
- [ADR：Valve 本地资产 Provider](docs/adr/0002-valve-local-asset-provider.md)
- [ADR：Green / Yellow / Red 更新门禁](docs/adr/0003-catalog-refresh-gates.md)
- [ADR：数据库图标资产数据集](docs/adr/0004-database-icon-asset-datasets.md)
- [ADR：Environment Contract](docs/adr/0005-environment-contract.md)
- [ADR：Run-scoped Harness 与验证证据](docs/adr/0006-run-scoped-verification.md)
- [Environment Isolation、Test Run Harness 与 Verification Evidence Spec](docs/specs/environment-isolation-and-verification.md)
- [测试、环境与依赖架构 Review（历史基线）](docs/architecture/environment-contract-review.md)
- [真实快照审计报告](docs/data/real-snapshot-audit-991daaf6.json)
- [外部仓库选源指南](docs/repositories/README.md)

## 许可与声明

本项目尚未选择开源许可证。公开可见不等于授予复制、修改或再分发许可。上游仓库可能包含 Valve 或其他第三方内容；Medota2 不把完整 VPK、声音、模型、提取缓存或批量 Valve 资产提交到 Git 或纳入公开发行物。

Medota2 是非官方自用项目，与 Valve Corporation、Dota 2、SteamDatabase、OpenDota、Liquipedia 及其他上游项目没有隶属或背书关系。Dota 2 和相关商标、游戏内容归其各自权利人所有。
