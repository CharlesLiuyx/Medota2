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
- 可选读取本地 Valve Hero portrait 与 Ability icon；资产缺失或不匹配时使用稳定 fallback，不把批量 Valve 资产提交进仓库。
- 远端发现、exact-commit source lock、detached worktree、全量候选、semantic diff、Green/Yellow/Red gate、Review、原子发布与回滚均已实现。

审计快照 `991daaf6fc24b08445209d9ce8767e145bab107e` 的一次真实全量运行得到 127 Heroes、2,703 accepted Abilities、4,752 bindings、339 Facets，0 blocking error。它们是审计结果，不是写死的业务常量；后续版本由 selector 和验证规则重新计算。

## 技术栈

- Node.js 24 LTS（最低 `22.12`）、pnpm 11；
- Next.js 16、React 19、TypeScript strict、Tailwind CSS 4；
- PostgreSQL 18、Drizzle schema、node-postgres、`pg-copy-streams`；
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

将已从本地 Dota 2 客户端只读提取的资源根目录配置为：

```dotenv
DOTA_VALVE_ASSET_PATH=/absolute/path/to/extracted/root
DOTA_VALVE_ASSET_CLIENT_VERSION=6918
```

Provider 只允许读取约定的 `panorama/images/heroes` 和 `panorama/images/spellicons` 路径，返回 private cache、ETag 和逻辑路径，不把机器绝对路径暴露给领域模型。ClientVersion 不匹配或系统性异常进入 Yellow Review；单个缺失使用可访问的 fallback。

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
- [真实快照审计报告](docs/data/real-snapshot-audit-991daaf6.json)
- [外部仓库选源指南](docs/repositories/README.md)

## 许可与声明

本项目尚未选择开源许可证。公开可见不等于授予复制、修改或再分发许可。上游仓库可能包含 Valve 或其他第三方内容；Medota2 不打包完整 VPK、声音、模型或批量 Valve 资产。

Medota2 是非官方自用项目，与 Valve Corporation、Dota 2、SteamDatabase、OpenDota、Liquipedia 及其他上游项目没有隶属或背书关系。Dota 2 和相关商标、游戏内容归其各自权利人所有。
