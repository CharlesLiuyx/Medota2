# Medota2 项目上下文

## 目标与现状

项目持续获取游戏源数据，按版本保留来源、原文和结构化对象，再在上层提供复杂游戏分析，辅助决策。比赛、录像、解析记录和分析运行是后续领域，需要关联到准确的游戏版本；当前实现范围是 Hero Catalog、Asset Dataset，以及绑定同一固定来源版本的单位只读图鉴（尚未持久化为独立 Unit Dataset）。

当前主链路：固定 VPK 来源 → 来源适配与校验 → PostgreSQL 不可变 Catalog 版本 → 独立英雄／技能及单位资产版本 → 当前数据指针 → Next.js 页面与查询。来源仓库是可选外部输入，路径可配置，不随仓库打包。

## 核心概念

- **Source Snapshot**：实际读取的来源仓库、commit、文件路径、checksum 和客户端版本。保留来源和未知字段，便于以后重新处理。
- **Hero Catalog**：一批原子切换的英雄、技能、命石、关系及本地化定义。对象身份与版本内定义分别记录，历史版本保留。
- **Asset Dataset**：绑定到一个 Catalog 的图片和图标版本。内容、变体、对象绑定及来源独立记录。
- **Current head**：当前使用的数据版本指针。提升与回滚仍由数据库约束和明确的操作规则控制。
- **Runtime environment / Data class**：运行用途与数据用途。可写开发沙箱使用 `development + sandbox`；共享预览优先读取已有真实来源审阅数据，即 `local-review + production-snapshot`；破坏性测试使用 `test + synthetic-fixture`。
- **Run / Session**：一次执行用于关联日志和检查；一次 AI Session 用于记录当前任务。都不代替数据版本身份。
- **计算任务**：明确的输入、参数、实现版本和输出。小样例与真实数据使用同一实现，过期任务不能覆盖较新的结果。

## 模块入口

| 模块               | 入口与职责                                                            |
| ------------------ | --------------------------------------------------------------------- |
| 页面、交互与 API   | `src/app/`、`src/components/`                                         |
| 对象及业务规则     | `src/domain/`                                                         |
| 来源适配           | `src/importers/`，各来源保留独立边界                                  |
| 持久化、查询、用例 | `src/server/db/`、`repositories/`、`services/`                        |
| 导入与计算命令     | `src/workers/`                                                        |
| 开发脚手架         | `src/development/`、`scripts/development/`                            |
| 固定样例与关键流程 | `tests/fixtures/`、`tests/journeys/`；专项测试在 unit/integration/e2e |
| 数据结构演进       | `drizzle/`；迁移文件应用后不改写旧文件                                |

## 开发默认

一个工作目录、分支、Web 地址和开发数据库。`pnpm dev` 复用固定工作台，实时看到多个 Session 的组合结果；`pnpm check` 说明并执行受影响的检查。上下文和脚本放在仓库中，客户端只提供薄入口。详细用法见 [README](README.md) 和[开发工作台规范](docs/specs/development-workbench.md)。

多机器交接统一使用 `pnpm push` 推送代码与完整业务数据，另一机器用 `pnpm sync` 拉取并应用同一快照。数据库、图片、全部地图版本与来源共同同步；机器差异保留在运行环境兼容配置中。没有额外 Git hooks。

## 深入阅读

- 当前任务、决定和遗留事项：[docs/current.md](docs/current.md)。
- 开始任务时核对[开发环境与能力登记册](docs/development-environments.md)：`GofurMacM4Max128GB` 元数据来源、`GofurWindowsLenovo` 客户端资源及后续云端能力在此集中维护；当前环境缺项时按任务推荐合适环境，并保留版本核验与交接说明。
- 共享开发决定：[ADR 0007](docs/adr/0007-shared-development-workbench.md)。
- 来源职责、许可与 provenance：[来源说明](docs/repositories/README.md)。
- 对象、导入和发布规则：[Catalog Spec](docs/specs/hero-catalog-v2.md)。
- 计算性能与语言选择：[技术选型](docs/architecture/technology-selection.md)。
- 数据库身份、权限和合同诊断：[环境合同细节](docs/architecture/environment-contract-details.md)。其中日常验证隔离和本地 Web 连接复用以 ADR 0007 为准。
