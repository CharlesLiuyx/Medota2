# Medota2 项目上下文

## 产品与边界

持续积累有版本、有来源的 Dota 2 数据，提供本地查询与分析。当前已有 Hero Catalog v2、英雄／技能／单位图鉴、独立图片资产、版本化地图与静态寻路、浏览器目录缓存、共享工作台及完整业务快照同步。比赛、玩家、实时对局、replay 分析和远程 production 部署尚未落地。

单位定义仍从匹配 Catalog 的固定 Git 文件构建只读模型，未持久化为独立 Unit Dataset；地图是独立版本的文件数据包。完整流向、写入者及版本关系由[数据流与权威存储](docs/architecture/data-flow.md)维护。当前任务见 [current](docs/current.md)，按任务选择[专项合同](docs/README.md#按任务读取)。

[项目图谱](docs/architecture/project-atlas.html)可视化本页概念的关系、流程与现状；下层变化同步回写。

## 稳定概念

| 概念                       | 含义                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Source Snapshot            | 实际读取的来源、commit／URL、文件及 checksum、客户端版本；保留未知字段                                                     |
| Hero Catalog               | 英雄、技能、命石、关系、本地化共享的不可变业务版本                                                                         |
| Asset Dataset              | 绑定 Catalog 的独立图片版本；英雄／技能与单位资产分别选择 head                                                             |
| Current head               | 选择当前业务版本的指针；提升／回滚受数据库约束和审阅门禁控制                                                               |
| Unit snapshot              | 绑定 Catalog source commit 的单位只读模型；缓存不等于持久 Dataset                                                          |
| Map Dataset / Collection   | 每版地图的底图、实体、地形、来源包；集合负责版本入口和默认选择                                                             |
| Development snapshot       | 跨工作区交接的完整业务快照；代码中的 lock 选择目标，实例身份独立                                                           |
| Environment / Data class   | 运行用途与数据用途：开发 `development+sandbox`、真实审阅 `local-review+production-snapshot`、测试 `test+synthetic-fixture` |
| Workspace / Environment ID | checkout 实例与稳定机器标签，分别用于运行身份和能力登记                                                                    |
| Run / Session              | 一次执行证据与一次协作任务；两者都不代替代码／数据版本                                                                     |
| 计算任务                   | 输入、参数、实现版本和输出；样例使用真实实现，旧结果不能覆盖新结果                                                         |

## 模块入口

| 范围               | 代码入口                                                                                 | 合同入口                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Catalog 导入／查询 | `src/importers/dota-vpk/`、`src/server/repositories/`                                    | [Catalog](docs/specs/hero-catalog-v2.md)                                                   |
| 图鉴 UI／缓存      | `src/app/heroes/`、`src/app/abilities/`、`src/components/`、`src/server/services/`       | [语义 UI](docs/specs/semantic-game-ui.md)、[缓存](docs/specs/browser-catalog-cache.md)     |
| 单位与资产         | `src/domain/units.ts`、`src/server/repositories/units.ts`、`src/importers/valve-assets/` | [单位](docs/specs/unit-catalog.md)                                                         |
| 地图与计算         | `src/domain/map/`、`src/importers/dota-map/`、`src/server/map/`、`src/components/map/`   | [地图](docs/specs/map-explorer.md)                                                         |
| 数据库身份与迁移   | `src/server/environment/`、`src/server/db/`、`drizzle/`                                  | [环境合同](docs/architecture/environment-contract-details.md)                              |
| 开发／同步／检查   | `src/development/`、`src/development/data-sync/`、`scripts/development/`、`src/workers/` | [工作台](docs/specs/development-workbench.md)、[同步](docs/specs/development-data-sync.md) |
| 验证               | `tests/unit/`、`tests/journeys/`、`tests/integration/`、`tests/e2e/`、`src/testing/`     | [开发操作](docs/operations/development.md)                                                 |

## 工程方向

Next.js Web、TypeScript Worker、PostgreSQL 与独立来源适配已落地。保留本地共享工作台、按需检查与可复用测试环境；语言、调度或远程部署扩展按[技术选型](docs/architecture/technology-selection.md)及 ADR 处理。

命令与依赖以 [package.json](package.json) 和锁文件为准；实际启动见 [README](README.md)。环境能力由[登记册](docs/development-environments.md)维护，历史过程不进入本文件。
