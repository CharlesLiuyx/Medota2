# Medota2

> 本地运行、以来源可追溯和原子版本为核心的 Dota 2 Heroes / Abilities Catalog。

Hero Catalog v2 已实现从固定 `dota_vpk_updates` commit 到 PostgreSQL、查询界面和更新门禁的完整链路。Heroes、Abilities、Facets、关系与本地化共享同一个不可变 catalog version；`dotaconstants` 仅作为隔离参考，不覆盖 VPK 规范值。

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

## 本地启动

前置条件：Node.js、pnpm、Docker。复制配置后启动数据库并迁移：

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
```

推荐从远端锁定精确 commit 后导入：

```bash
pnpm data:source:discover:vpk
pnpm data:source:lock:vpk --commit <40-character-sha>
pnpm data:import:catalog --lock <lock-file>
pnpm dev
```

也可把 `DOTA_VPK_UPDATES_PATH` 指向现有本地 checkout 后直接运行 `pnpm data:import:catalog`。正式导入要求 Medota2 checkout 干净，使 `importer_version` 能准确标识转换代码；只需快速预览当前开发改动时使用：

```bash
pnpm dev:demo
```

页面入口：

- [http://localhost:3000/heroes](http://localhost:3000/heroes)
- [http://localhost:3000/abilities](http://localhost:3000/abilities)
- [http://localhost:3000/design-system](http://localhost:3000/design-system)

## 数据来源与版本身份

| 来源                                                                                                    | 职责                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [spirit-bear-productions/dota_vpk_updates](https://github.com/spirit-bear-productions/dota_vpk_updates) | Heroes / Abilities 玩法与本地化唯一 SSOT   |
| [odota/dotaconstants](https://github.com/odota/dotaconstants)                                           | 隔离 QA/reference，不参与规范值或 fallback |
| [SteamDatabase/GameTracking-Dota2](https://github.com/SteamDatabase/GameTracking-Dota2)                 | 协议、Source 2 schema 与非 VPK 交叉核对    |

导入身份由 source repository、完整 commit、selector version、动态文件集合、每个 blob SHA-256、manifest SHA-256、ClientVersion、SourceRevision、importer version 与 schema version 共同确定。分支名、“latest”和目录修改时间都不是版本身份。

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
pnpm data:refresh:catalog
```

默认建议每 15 分钟 discover 一次。无新 commit 时 no-op；Green 自动发布；Yellow 保留候选等待 Review；Red 或任意失败保持上一 current head。常用操作：

```bash
pnpm data:diff:catalog --candidate <dataset-version-id>
pnpm data:review:catalog --candidate <dataset-version-id> --decision approved --reason "<reason>"
pnpm data:promote:catalog --candidate <dataset-version-id>
pnpm data:promote:catalog --candidate <dataset-version-id> --allow-fallback-downgrade
pnpm data:rollback:catalog --to <dataset-version-id> --reason "<reason>"
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
pnpm build                 # Webpack 生产构建
pnpm data:audit:catalog    # 真实 checkout 全量 parser 审计
```

Playwright 使用隔离的 `medota2_test` 数据库、3100 端口和 `.next-e2e` 构建目录，不会复用日常 3000 dev server。视觉基线位于 `tests/e2e/visual.spec.ts-snapshots/`。

## 仓库结构

```text
Medota2/
├── src/app/                 # Heroes、Abilities、Design System、asset routes
├── src/components/          # Catalog 与 UI primitives
├── src/domain/              # Hero/Ability/Catalog contracts 与 semantic diff
├── src/importers/           # KeyValues、SSOT adapters、source lock
├── src/server/              # schema、repositories、asset provider
├── src/workers/             # import、refresh、Review、promotion、rollback CLI
├── drizzle/                 # 已审阅 SQL migrations
├── ops/                     # 调度示例
├── tests/                   # fixtures、unit、integration、E2E 与视觉基线
└── docs/                    # Spec、ADR、Design System、来源与运维文档
```

## 设计与架构文档

- [Hero Catalog v2 Spec](docs/specs/hero-catalog-v2.md)
- [Medota2 Design System](docs/design-system.md)
- [Hero Catalog 更新操作手册](docs/operations/catalog-refresh.md)
- [ADR：共享 Hero Catalog 版本边界](docs/adr/0001-hero-catalog-version-boundary.md)
- [ADR：Valve 本地资产 Provider](docs/adr/0002-valve-local-asset-provider.md)
- [ADR：Green / Yellow / Red 更新门禁](docs/adr/0003-catalog-refresh-gates.md)
- [ADR：数据库图标资产数据集](docs/adr/0004-database-icon-asset-datasets.md)
- [真实快照审计报告](docs/data/real-snapshot-audit-991daaf6.json)
- [外部仓库选源指南](docs/repositories/README.md)

## 许可与声明

本项目尚未选择开源许可证。公开可见不等于授予复制、修改或再分发许可。上游仓库可能包含 Valve 或其他第三方内容；Medota2 不把完整 VPK、声音、模型、提取缓存或批量 Valve 资产提交到 Git 或纳入公开发行物。

Medota2 是非官方自用项目，与 Valve Corporation、Dota 2、SteamDatabase、OpenDota、Liquipedia 及其他上游项目没有隶属或背书关系。Dota 2 和相关商标、游戏内容归其各自权利人所有。
