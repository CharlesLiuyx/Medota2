# 项目技术选型与数据处理架构

> 状态：已由英雄元数据 MVP 落地；后续能力仍按本文演进
>
> 最后更新：2026-08-31
>
> 适用范围：Medota2 的 Web、应用服务、PostgreSQL、数据 Worker、开发工具链与高性能计算演进

## 1. 文档目的

本文独立记录 Medota2 的技术选型上下文、权衡和演进边界。它回答“为什么这样选”和“各运行时负责什么”，不定义某个产品版本的具体页面与字段。

第一个产品切片见[英雄元数据显示 MVP 功能 Spec](../specs/hero-metadata-mvp.md)，全产品内容 List 的共享加载与渲染边界见[全局 List 无限滚动与 3× 预加载 Spec](../specs/infinite-lists.md)。后者取代早期分页或一次性 DOM 全量渲染条款。本文中的 Web、PostgreSQL、TypeScript Worker、权限边界和工具链已经由 MVP 实现；Rust 和后续重计算能力仍是演进规则。

## 2. 项目上下文

Medota2 是本地优先的 Dota 2 数据接入与分析项目，预期同时包含：

- 小而频繁变化的游戏元数据；
- API、回放或本地文件等异构输入；
- 版本化、可复现的数据转换；
- PostgreSQL 中的规范数据和分析结果；
- 本地 Web 查询与可视化；
- 未来可能出现的回放解析、解压、事件转换和重度计算。

因此技术方案需要同时优化两件事：首期开发速度，以及未来把重计算从 Web 请求进程中安全拆出的能力。

## 3. 架构驱动因素

按优先级排序：

1. **可追溯**：任何派生数据都能追溯到来源快照和转换器版本。
2. **开发效率**：前端、应用服务和首期导入器尽量共享 TypeScript 类型与工具链。
3. **数据正确性**：约束、事务、幂等和冲突处理优先于微观性能。
4. **本地可运行**：不依赖特定云厂商或托管平台。
5. **处理隔离**：批量导入和重计算不阻塞 Web 请求进程。
6. **渐进性能**：先优化算法、SQL 和批处理，再按 profiling 证据引入 Rust。
7. **低运维成本**：首期避免微服务、Redis、Kafka 和重复 API 层。

## 4. 技术决策摘要

1. Web 与应用服务采用 Next.js、React 和 TypeScript。
2. Next.js Node.js 服务端通过 Drizzle 和 `pg` 直接访问 PostgreSQL。
3. 浏览器永远不直接连接 PostgreSQL，也不能获得数据库凭据。
4. 首期不增加 NestJS、FastAPI、GraphQL 或独立 REST 服务。
5. PostgreSQL 是唯一持久化数据库；集成测试也使用真实 PostgreSQL。
6. 数据导入和批处理作为独立 TypeScript Worker/CLI 运行。
7. 中等 CPU 任务可使用固定大小的 Node.js Worker Threads 池。
8. Rust 不作为首期依赖；只有可复现 benchmark 证明需要时，才新增独立 Rust Worker。

## 5. 方案比较

| 决策点    | 采用方案                     | 暂不采用            | 主要理由                                                                 |
| --------- | ---------------------------- | ------------------- | ------------------------------------------------------------------------ |
| Web       | Next.js App Router           | Vite SPA            | Server Components 可以直接使用服务端 repository，减少额外 API 和重复 DTO |
| 应用服务  | Next.js Node.js runtime      | NestJS、FastAPI     | 首期是本地单产品，独立服务会增加 API、部署和类型同步成本                 |
| 数据库    | PostgreSQL 18                | SQLite、MongoDB     | 需要强约束、事务、集合查询、`COPY` 和未来分析能力                        |
| 数据访问  | Drizzle 稳定版 + `pg`        | Prisma、纯 ORM 黑盒 | 接近 SQL、类型安全、迁移 SQL 可审阅，复杂分析仍可写参数化 SQL            |
| UI        | Tailwind CSS + shadcn/ui     | 大型黑盒组件套件    | 开发快、组件源码可控，方便定制本地分析界面                               |
| 数据处理  | 独立 TypeScript Worker       | 在 HTTP 请求中执行  | 与 Web 隔离，同时复用领域类型和校验逻辑                                  |
| CPU 扩展  | Worker Threads 后再评估 Rust | 从第一天全量 Rust   | 避免没有性能证据的双工具链和跨语言维护成本                               |
| Rust 集成 | 独立可执行 Worker            | N-API、WASM         | 进程与故障隔离，不绑定 Node ABI，也便于独立资源限制                      |

## 6. 运行时拓扑

```text
浏览器
  │ HTTP / React Server Components
  ▼
Next.js Node.js 服务端
  ├─ 页面渲染与交互
  ├─ Server Repository / 查询服务
  └─ 未来任务控制面
          │
          ▼
PostgreSQL 18
  ├─ 规范数据与分析结果
  ├─ 来源快照和导入记录
  ├─ staging 与校验结果
  └─ 未来任务状态
          ▲
          │
独立 Data Worker
  ├─ 首期：TypeScript CLI/Worker
  ├─ 中等 CPU：Worker Threads 池
  └─ 未来热点：独立 Rust Worker
```

Web 进程只负责查询、呈现和控制面。VPK 导入、回放解析、批量转换和重计算不得在 Next.js 请求生命周期内运行。

## 7. 参考技术栈

MVP 通过 `packageManager` 字段、精确 dependency 版本和 `pnpm-lock.yaml` 固定工具链；升级时仍应选择对应维护线的安全补丁并运行完整验收。

| 层次          | MVP 选择                                                               | 用途                                           |
| ------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| 运行时        | Node.js 24 LTS，package 最低 `22.12`                                   | Web、TypeScript Worker 和测试                  |
| 包管理        | pnpm 11                                                                | 安装、脚本与可复现依赖                         |
| 全栈框架      | Next.js 16.3                                                           | App Router、Server Components、Route Handlers  |
| UI            | React 19.2、TypeScript 6 strict                                        | 页面、交互和共享类型                           |
| 样式          | Tailwind CSS 4                                                         | 响应式布局和主题                               |
| 组件          | 本地源码组件、Lucide Icons；需要通用 primitive 时再引入 shadcn/ui 源码 | 可控的基础 UI 与图标                           |
| 表格          | MVP 卡片不引入表格依赖；出现表格视图时评估 TanStack Table              | 避免未使用依赖                                 |
| 数据库        | PostgreSQL 18.2                                                        | 唯一持久化数据库                               |
| 驱动          | `pg` / node-postgres 8                                                 | 连接池、事务、参数化查询                       |
| 批量写入      | `pg-copy-streams`                                                      | 在同一 `pg` 连接与事务中执行 `COPY FROM STDIN` |
| 数据访问      | Drizzle ORM 0.45 + 参数化 SQL                                          | schema 与常规查询类型；复杂查询保持显式 SQL    |
| 迁移          | drizzle-kit + 已审阅 SQL + checksum ledger runner                      | 生成、审阅、校验并执行迁移                     |
| 校验          | Zod 4 + 显式领域校验                                                   | 环境变量、DTO 和命令输入                       |
| CLI           | `tsx`                                                                  | TypeScript 数据任务入口                        |
| 单元/集成测试 | Vitest、Testing Library                                                | 领域、repository 和组件测试                    |
| E2E           | Playwright 1.62                                                        | 浏览器完整流程                                 |
| 质量工具      | ESLint、`eslint-config-next`、Prettier                                 | lint、格式化和 CI 门禁                         |
| 本地基础设施  | Docker Compose                                                         | PostgreSQL 与测试数据库                        |

## 8. 前端边界

- 页面和 layout 默认使用 React Server Components。
- 搜索框、筛选器、Drawer 等需要事件或浏览器 API 的区域才使用 Client Components。
- 筛选状态优先进入 URL query，以支持刷新、分享和服务端查询。
- 首期不引入 Redux、Zustand 或 TanStack Query。
- 浏览器不加载完整来源快照后自行处理；远程 List 的筛选、排序和双向 cursor continuation 由服务端与 PostgreSQL 完成，本地已有集合通过共享适配器惰性分块渲染。具体合同以[全局 List Spec](../specs/infinite-lists.md)为准。
- 只有浏览器确实需要调用的能力才建立 Route Handler。

## 9. 应用服务与 PostgreSQL

### 9.1 服务端分层

```text
Next.js page / Route Handler
           │
           ▼
server/services        # 用例和领域编排
           │
           ▼
server/repositories    # PostgreSQL 查询边界
           │
           ▼
server/db              # Drizzle schema、pg Pool、migration
```

- 页面不得直接散落 SQL。
- 数据库连接只能存在于 server-only 模块。
- Drizzle 用于 schema 和常规查询；复杂分析允许使用参数化原生 SQL。
- schema diff 可使用 `drizzle-kit generate`；正式执行由 `pnpm db:migrate` 的 checksum ledger runner 完成，不把 `push` 作为团队迁移流程。

### 9.2 PostgreSQL 使用原则

- 主键、唯一约束、外键和 CHECK 约束由数据库执行。
- 可查询的核心字段使用明确列；`jsonb` 只保存不稳定诊断信息或来源差异。
- 小批量数据使用事务批量 upsert。
- 大批量数据流式写入 staging，并优先使用 `COPY FROM STDIN`。
- 复杂查询先使用索引、集合式 SQL 和 `EXPLAIN (ANALYZE, BUFFERS)` 优化。
- 不通过逐事件 ORM `INSERT` 的结果判断 PostgreSQL 或 Node.js 性能不足。
- 本地和 CI 集成测试使用真实 PostgreSQL，不用 SQLite 模拟 PostgreSQL 语义。

### 9.3 数据库账号与写入权

数据库权限已分为三个运行时边界，而不是让所有进程共用一个高权限账号：

| 身份            | 允许                                                                          | 禁止                                                    |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| migration owner | 执行已审阅的 migration、创建或修改 schema                                     | 作为 Web 或 Worker 的日常连接                           |
| Worker writer   | 写入 import run、staging 和规范数据；获取导入 advisory lock；调用快照提升事务 | DDL、修改 migration 历史、绕过校验直接改 active pointer |
| Web reader      | 查询当前规范数据、来源信息和参考差异                                          | 导入、提升快照、写 staging、DDL                         |

本地 bootstrap 可以由一个管理员账号创建这些角色，但应用运行时仍分别使用 `DATABASE_URL_MIGRATION`、`DATABASE_URL_WORKER` 和 `DATABASE_URL_WEB`。首期没有 Web 管理后台；导入和快照提升只由 Worker/CLI 发起。Web 与 Worker 启动时都要检查数据库 schema 版本，只有 Worker 持有导入锁。

active pointer 只能通过 migration owner 创建的 `SECURITY DEFINER` 数据库函数切换。该函数固定安全 `search_path`，验证目标版本状态与 advisory lock，并在调用者事务中更新 head；Worker 只有 `EXECUTE` 权限，没有对 head 表的直接 `UPDATE` 权限。函数名和参数由具体数据域 Spec 固定。

## 10. Data Worker 设计

首期 Worker 是同一仓库中的独立 TypeScript 进程，而不是常驻微服务。它负责：

- 读取可配置的外部输入；
- 解析、校验和标准化；
- 写 staging table；
- 运行完整校验；
- 事务式提升结果；
- 记录来源、错误和性能指标。

Worker 与 Web 共享领域类型，但不共享请求生命周期。未来需要常驻调度时，再评审 PostgreSQL job queue；首期不引入 Redis 或独立消息系统。

## 11. 性能优化阶梯

所有优化必须建立在代表性 fixture 和可复现 benchmark 上：

1. 修正算法和数据结构；
2. 减少不必要解析、复制和序列化；
3. 使用流式 I/O、批量操作和 PostgreSQL `COPY`；
4. 优化 schema、索引和集合式 SQL；
5. 对中等 CPU 热点使用固定大小的 Worker Threads 池；
6. 仍无法达到明确目标时，将已确认热点迁移到 Rust。

每个 Worker 至少记录输入量、输出量、wall-clock time、CPU time、峰值 RSS、数据库写入时间及失败/跳过计数。

## 12. Rust 引入策略

### 12.1 不在首期引入的原因

首期需要优先验证产品闭环和数据模型。过早加入 Cargo、跨语言 DTO、交叉构建和多套调试链路，会降低开发速度，却不能解决低效 SQL、错误算法或逐行写入等常见瓶颈。

### 12.2 触发条件

只有满足以下一项或多项，并附有可复现 benchmark 时，才提交 Rust ADR：

- CPU profile 显示解析、解压或数值计算占任务大部分时间；
- 优化算法并使用 Worker Threads 后仍达不到明确吞吐目标；
- V8 GC 或单 Worker 峰值内存成为主要约束；
- 需要稳定利用多核处理大量相互独立的事件；
- 开始批量解析 replay、Protobuf 消息或复杂特征工程；
- 同一计算内核需要在本地、服务器和批处理环境复用。

“未来数据可能很大”不是充分条件。ADR 必须包含代表性输入、基线实现、CPU/内存数据、目标指标、迁移边界和预期收益。

### 12.3 集成方式

首选由 TypeScript Worker 调用独立 Rust 可执行程序，把它作为已确认热点的计算内核：

```text
TypeScript Worker / CLI
        │
        ▼
medota-engine --manifest <path>
  ├─ 读取不可变输入清单
  ├─ 并行解析与计算
  └─ 流式输出结构化结果与性能指标
        │
        ▼
TypeScript Worker 校验并写 PostgreSQL staging
```

TypeScript 协调进程继续拥有任务状态、数据库校验和 active snapshot 提升权；Rust 进程默认不获得数据库凭据。这种方式隔离崩溃和资源，避免 Node ABI 耦合，也不会预设尚未决定的常驻任务队列。

如果 benchmark 证明跨进程序列化或 TypeScript 写入已成为主要瓶颈，可再用 ADR 评估给 Rust 一个仅能写 staging 的数据库角色；它仍不能执行 migration 或切换 active snapshot。届时可评估 `serde`、`rayon`、`prost` 和 `tracing`；Tokio 仅用于确有需要的高并发 I/O，CPU 并行优先评估 Rayon。

## 13. 当前代码结构

```text
Medota2/
├── src/
│   ├── app/                 # Next.js 页面和 Route Handlers
│   ├── components/          # UI 组件
│   ├── domain/              # 稳定领域模型
│   ├── server/
│   │   ├── db/              # Drizzle schema 与连接池
│   │   ├── repositories/    # PostgreSQL 边界
│   │   └── services/        # 用例编排
│   ├── importers/           # 来源专属适配器
│   └── workers/             # 独立 TypeScript Worker
├── drizzle/                 # SQL migrations
├── tests/fixtures/          # 最小、可审阅 fixture
├── docs/
└── docker-compose.yml
```

只有 Rust ADR 通过后，才增加 `crates/medota-engine/` 和 Cargo workspace。

## 14. 配置与命令

项目使用 `.env` 提供本地配置，提交 `.env.example` 而不提交凭据。数据库连接按职责拆为 `DATABASE_URL_MIGRATION`、`DATABASE_URL_WORKER` 和 `DATABASE_URL_WEB`；外部来源路径使用来源专属变量，不写死相邻仓库。当前提供：

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

英雄导入与参考比较命令见 MVP Spec 和 README。修改命令时必须同步更新 README。

## 15. 安全与运维约束

- `DATABASE_URL_*`、`.env`、凭据、数据库文件和缓存不提交 Git。
- 浏览器 bundle 中不得出现服务端环境变量。
- 外部输入路径必须配置化，不能写死某个用户的绝对路径。
- 进程调用使用参数数组，不拼接不可信 shell 字符串。
- 上游公开可见不等于 Valve 资源可再分发；资源打包前单独审查许可。
- 首期产品必须能在没有 Redis、Rust 和 `dotaconstants` 的情况下运行。

## 16. 尚未决定

- 本地单机之外的部署形态；
- 常驻 Worker、任务调度和重试协议；
- 第一个比赛或 replay 输入；
- Rust Worker 的具体 crate、协议和发布方式；
- 英雄图片和其他游戏资产的 provider；
- 统一可观测性后端。

这些内容应通过后续 Spec 或 ADR 决定，不能由实现细节静默引入。

## 17. 官方参考

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Node.js Release Schedule](https://nodejs.org/en/about/previous-releases)
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- [PostgreSQL Versioning Policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL COPY](https://www.postgresql.org/docs/current/sql-copy.html)
- [PostgreSQL Parallel Query](https://www.postgresql.org/docs/current/parallel-query.html)
- [pg-copy-streams](https://github.com/brianc/node-pg-copy-streams)
- [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
- [Drizzle Migrations](https://orm.drizzle.team/docs/migrations)
- [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [shadcn/ui with Next.js](https://ui.shadcn.com/docs/installation/next)
- [Playwright](https://playwright.dev/docs/intro)
- [Rust Concurrency](https://doc.rust-lang.org/book/ch16-00-concurrency.html)
- [Tokio Tutorial and Usage Boundaries](https://tokio.rs/tokio/tutorial)
