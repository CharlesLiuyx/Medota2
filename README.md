# Medota2

> 本地运行、强调版本可追溯与可复现数据接入的 Dota 2 元数据产品。

Medota2 的首个 MVP 已经可运行：从一个固定且输入与 HEAD 一致的 `dota_vpk_updates` checkout 导入英雄元数据，版本化保存到 PostgreSQL，并通过 Next.js 界面搜索、筛选和查看详情。`dotaconstants` 只进入隔离的参考比较表，不会覆盖或回填 VPK 规范值。

## MVP 能力

- `dota_vpk_updates` 是英雄规范字段唯一 SSOT；导入只读取 8 个 allowlist 文件。
- 校验 Git HEAD、输入原始 SHA-256、UTF-8/BOM、manifest、ClientVersion 与 SourceRevision。
- 解析 Valve KeyValues，处理标量基类继承、重复 key、正式英雄过滤、Role/RoleLevel 和双语 token。
- 使用 PostgreSQL 的不可变 dataset version、active head、advisory lock 与 `SECURITY DEFINER` promotion。
- 提供 `/heroes` 总览，以及中文名、英文名、内部名称、主属性、角色、攻击类型和 CM 状态筛选。
- 提供 `/heroes/[slug]` 详情、基础/原始定义、双语文本、快照级与记录级 provenance。
- 可选导入 `dotaconstants` 并对当前 VPK dataset 生成覆盖率和字段漂移。
- 提供真实 PostgreSQL 集成测试和 Playwright E2E。

英雄图片、技能、比赛、玩家、replay、自动上游更新、登录和 Rust Worker 不在当前 MVP 中。

## 技术栈

- Node.js 24 LTS（最低支持 `22.12`）与 pnpm 11；
- Next.js 16、React 19、TypeScript strict、Tailwind CSS 4；
- PostgreSQL 18、Drizzle schema、node-postgres 和 `pg-copy-streams`；
- Zod、Vitest、Playwright、ESLint、Prettier；
- Docker Compose 本地数据库。

Web、Worker 与 migration 使用独立 PostgreSQL 账号。浏览器从不直接连接数据库；Web 账号只读，Worker 不能执行 DDL 或直接修改 active head。

## 本地启动

前置条件：Node.js 24 LTS、pnpm 11、Docker，以及一个本地 `dota_vpk_updates` Git checkout。`dotaconstants` checkout 仅在运行参考比较时需要。

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm data:import:vpk
pnpm dev
```

打开 [http://localhost:3000/heroes](http://localhost:3000/heroes)。

只想最快预览界面时，可使用独立的本地预览库。该命令会启动 PostgreSQL、从真实 `dota_vpk_updates` 快照重建测试库并启动前端；它不会注入 E2E fixture，也不会放宽正式数据库的 clean-check：

```bash
pnpm dev:demo
```

`.env` 中的上游路径可指向任意位置，应用没有写死相邻仓库。正式 `tsx` 导入要求 Medota2 自身 checkout 干净；这是为了保证 `importer_version = hero-vpk-v1/medota2@<version>+git.<commit>` 能准确表示实际转换代码。上游 checkout 可以有 allowlist 外的改动，但 8 个实际输入必须由 Git 跟踪且和 HEAD 字节一致。

## 可选参考比较

```bash
pnpm data:import:dotaconstants
pnpm data:compare:heroes
```

比较结果明确配对当前 VPK dataset version 和一个 dotaconstants snapshot。参考导入失败或未配置不会影响英雄总览和详情。

## 开发命令

```bash
pnpm dev                   # Next.js 本地开发服务
pnpm dev:demo              # 从真实 VPK 重建完整本地预览并启动前端
pnpm build                 # Webpack 生产构建
pnpm typecheck             # TypeScript strict
pnpm lint                  # ESLint
pnpm test                  # 解析、领域和查询合同单元测试
pnpm test:integration      # 真实 PostgreSQL 权限与原子性测试
pnpm test:e2e              # seed 隔离测试库并运行 Chromium E2E
pnpm db:generate           # 根据 Drizzle schema 生成待审阅 migration
pnpm db:migrate            # migration owner 执行正式库 migration
pnpm db:migrate:test       # 执行 medota2_test migration
pnpm db:studio             # 启动本地 Drizzle Studio
```

Docker 首次初始化会创建 `medota2` 与 `medota2_test` 两个数据库，以及 owner、Worker writer、Web reader 三个本地账号。测试 helper 会拒绝清理不以 `_test` 结尾的数据库。

## 数据源

| 上游仓库                                                                                                | 当前职责                       | 本仓库说明                                           |
| ------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| [spirit-bear-productions/dota_vpk_updates](https://github.com/spirit-bear-productions/dota_vpk_updates) | 英雄规范数据唯一 SSOT          | [详细说明](docs/repositories/dota-vpk-updates.md)    |
| [odota/dotaconstants](https://github.com/odota/dotaconstants)                                           | 隔离参考与漂移比较             | [详细说明](docs/repositories/dotaconstants.md)       |
| [SteamDatabase/GameTracking-Dota2](https://github.com/SteamDatabase/GameTracking-Dota2)                 | 后续协议、schema 与非 VPK 调研 | [详细说明](docs/repositories/game-tracking-dota2.md) |

三个上游仓库始终只读，不随 Medota2 发布，也不提供比赛历史数据。

## 仓库结构

```text
Medota2/
├── src/app/                 # Next.js 总览与详情页面
├── src/components/          # MVP UI 组件
├── src/domain/              # 英雄领域合同
├── src/importers/           # VPK、KeyValues 与 reference 适配器
├── src/server/              # PostgreSQL schema、repository 与查询服务
├── src/workers/             # migration、导入与比较 CLI
├── drizzle/                 # 已审阅 SQL migration
├── docker/init/             # 本地数据库账号和测试库 bootstrap
├── tests/                   # fixture、单元、集成与 E2E
└── docs/                    # 架构、Spec 与上游调研
```

## 设计文档

- [项目技术选型与数据处理架构](docs/architecture/technology-selection.md)
- [英雄元数据显示 MVP 功能 Spec](docs/specs/hero-metadata-mvp.md)
- [外部仓库总览与选源指南](docs/repositories/README.md)

Rust 不在 MVP 中。只有 profiling 和可复现 benchmark 证明 TypeScript Worker、批处理、COPY 和 SQL 优化仍无法达到明确目标时，才通过 ADR 引入独立 Rust 计算内核。

## 许可与声明

本项目尚未选择开源许可证。公开可见不等于授予复制、修改或再分发许可。上游仓库还可能包含 Valve 或其他第三方内容；Medota2 不打包完整 VPK、英雄图片、声音或模型。

Medota2 是非官方社区项目，与 Valve Corporation、Dota 2、SteamDatabase、OpenDota 及其他上游项目没有隶属或背书关系。Dota 2 和相关商标、游戏内容归其各自权利人所有。
