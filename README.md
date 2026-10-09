# Medota2

本地优先、来源可追溯的 Dota 2 数据与图鉴平台，提供英雄、技能、单位、物品、属性及交互地图。

Medota2 从固定来源版本构建可复现数据，保存原文、结构化对象和图片，再提供查询与分析。不同机器通过代码与完整业务快照交接；来源版本、业务版本和数据库身份分别核验。

先读[项目现状与架构图谱](docs/architecture/project-atlas.html)，再结合 [CONTEXT](CONTEXT.md) 理解术语与模块。图谱涵盖数据流、缓存、开发与发布、跨机器交接、实体与版本关系；点击节点可查看作用及实现入口。下层改动影响图谱时，必须在同一任务中按[维护约定](docs/README.md#图谱维护约定)回写。

## 当前能力

| 范围       | 已实现                                                        | 边界                                                                    |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 英雄与技能 | Hero Catalog v2、语义化详情、天赋／命石／升级、多语与拼音搜索 | 数值来自所选快照；部分补充文本仍依赖匹配来源                            |
| 属性       | 独立目录、四类对象双向引用、固定版本机制证据与公式示例        | 未确证引擎机制保留待核验，见[属性合同](docs/specs/attribute-catalog.md) |
| 单位       | 只读图鉴、分类／搜索、独立头像资产版本                        | 定义未持久化为独立Unit Dataset；缺图明确显示                            |
| 地图       | 独立版本、图层／地形、静态寻路、近似地面视野、营地与兵线收益  | 引擎碰撞、导航及结算语义仍需同版本验证                                  |
| 版本与资产 | 来源锁、差异审阅、发布门禁、原子提升／回滚、数据库图片LoD     | 外部资源再分发需单独审查许可                                            |
| 浏览器     | 英雄／技能目录IndexedDB缓存，本机搜索与增量同步               | 不提供完整页面离线安装能力                                              |
| 开发       | 共享工作台、按需检查、构建／启动验收、产物保留                | 尚无远程production部署目标                                              |
| 多环境     | 私有Git/LFS完整快照、受管恢复、重复同步、只读数据库页         | Windows仍有浏览／构建问题；云端尚未完整验收                             |

比赛、玩家、胜率、出装、实时对局与replay分析属于后续领域。活动工作及验证范围见[当前工作](docs/current.md)，平台条件见[环境登记](docs/development-environments.md)。

## 快速开始

要求：Node满足 [package.json](package.json) 的 `engines`（最低22.12），仓库锁定的pnpm、Git、Docker Compose。Node 24为项目既有建议维护线；实际Mac／Windows版本与限制见环境登记，CI版本见[workflow](.github/workflows/verify.yml)。E2E需要锁定的Playwright Chromium；完整业务快照接入还需Git LFS和私有数据仓库权限。

### 已有工作区

```sh
pnpm dev
```

复用同一个后台工作台。通常打开 [http://127.0.0.1:3000/heroes](http://127.0.0.1:3000/heroes)，已初始化工作区以命令输出的origin为准。可访问 `/abilities`、`/units`、`/map`，开发数据库查看页为 `/dev/database`。

保存代码自动热更新。页面右下的解析样例独立计算，不替换页面业务数据。配置、迁移或脚手架变化后运行 `pnpm dev:restart`。

### 新工作区

先取得代码，在空白配置环境执行：

```sh
pnpm install --frozen-lockfile
# 仅在 .env 不存在时从 .env.example 创建；已有文件保留
pnpm dev
```

无真实数据时可以使用development小样例；真实预览优先使用已准备的local-review数据，资产审计失败会报错。完整共享业务数据按[首次同步步骤](docs/development-data-sync-runbook.md#新环境接入)初始化、获取和应用；无需完整游戏安装或手工复制 `.medota2`。

macOS／Linux可在确认文件不存在后运行 `cp .env.example .env`；Windows使用 `Copy-Item .env.example .env`。新文件只填写必要配置，真实秘密保存在本机。示例中的来源路径需按任务显式配置。

### 日常命令

| 命令                            | 用途与影响                                                     |
| ------------------------------- | -------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:restart` | 复用／重新准备共享工作台                                       |
| `pnpm check --plan`             | 只显示检查范围与准备需求                                       |
| `pnpm check`                    | 执行必要检查，复用有效静态结果                                 |
| `pnpm check --files <paths...>` | 显式范围及其关联检查                                           |
| `pnpm docs:check`               | 文档引用、命令、入口和文档归属检查                             |
| `pnpm data:status`              | 核验本机代码／数据状态                                         |
| `pnpm sync`                     | 拉取代码及固定依赖、保存本地业务改动、应用目标数据，必要时重启 |
| `pnpm push`                     | 经授权验证候选、发布完整数据、推送main并确认CI                 |
| `pnpm release`                  | 构建及独立启动验收，生成本地产物                               |
| `pnpm storage:clean`            | 预览可再生附件的清理计划；`--apply`执行                        |

开发、测试、显式隔离检查、日志与清理参数见[开发运行手册](docs/operations/development.md)。同步、发布与恢复见[同步运行手册](docs/development-data-sync-runbook.md)。运行副作用命令前遵守 [AGENTS](AGENTS.md) 的协作及授权要求。

## 结构与数据流

| 目录                           | 职责                                      |
| ------------------------------ | ----------------------------------------- |
| `src/app/`、`src/components/`  | 图鉴、地图、开发页面与HTTP入口            |
| `src/domain/`                  | 领域合同、地图计算、差异与缓存模型        |
| `src/importers/`               | 独立来源适配、校验与转换                  |
| `src/server/`                  | 查询、环境合同、业务服务与地图文件读取    |
| `src/development/`、`scripts/` | 工作台、同步、存储维护及检查              |
| `src/workers/`                 | 导入、数据交接、检查和构建命令            |
| `drizzle/`、`docker/`          | 数据库迁移、权限与环境初始化              |
| `tests/`                       | fixture、专项单测、数据库、浏览和视觉流程 |
| `docs/`                        | 当前合同、操作、来源审阅、ADR与可检索历史 |

[CONTEXT](CONTEXT.md)维护术语和模块导航；[数据流](docs/architecture/data-flow.md)解释原始来源、PostgreSQL Catalog／资产、独立地图包、浏览器缓存与跨机器快照之间的关系。具体版本读取lock／manifest，不从README中的观察数字推断。

## 按需阅读

- 开始任务：[Agent规则](AGENTS.md)、[当前工作](docs/current.md)、[文档职责与任务导航](docs/README.md)。
- 修改图鉴：[语义UI](docs/specs/semantic-game-ui.md)、[列表](docs/specs/infinite-lists.md)、[浏览器缓存](docs/specs/browser-catalog-cache.md)。
- 单位与地图：[单位合同](docs/specs/unit-catalog.md)、[地图合同与导入命令](docs/specs/map-explorer.md)。
- 导入与版本：[Catalog合同](docs/specs/hero-catalog-v2.md)、[来源／资产导入](docs/operations/catalog-import.md)、[刷新与回滚](docs/operations/catalog-refresh.md)。
- 环境与架构：[环境登记](docs/development-environments.md)、[环境合同](docs/architecture/environment-contract-details.md)、[技术选型](docs/architecture/technology-selection.md)。
- 可选服务配置：[OpenDota Secret](docs/specs/opendota-secret.md)，当前尚未接入比赛查询或付费调用。

## 后续方向

单位及补充本地化完整持久化、同版本地图引擎验证、比赛/API/replay输入与分析、生产部署，分别在对应Spec和后续ADR中推进。新增大型框架、服务或Rust前先用测量说明需求并提交ADR。

## 许可与声明

本项目尚未选择开源许可证。公开可见不等于授予复制、修改或再分发许可。代码仓库不保存完整VPK、声音、模型、提取缓存和批量Valve资产；批准的已导入业务包通过私有数据仓库交接，私有存储不代替资源再分发许可审查。

Medota2是非官方项目，与Valve、Dota 2、SteamDatabase、OpenDota、Liquipedia及其他上游没有隶属或背书关系。商标和游戏内容归各自权利人所有。来源角色与许可见[来源总览](docs/repositories/README.md)。
