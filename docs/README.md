# 文档导航与事实归属

本页维护文档职责、状态与读取入口。执行规则在 [AGENTS](../AGENTS.md)，稳定术语在 [CONTEXT](../CONTEXT.md)，活动工作在 [current](current.md)。每次任务按范围读取，不默认加载全部文档。

## 事实归属与更新流向

| 信息                   | 唯一维护位置                                  | 更新触发                                       |
| ---------------------- | --------------------------------------------- | ---------------------------------------------- |
| Agent规则与范围声明    | [AGENTS](../AGENTS.md)                        | 协作、授权、接手或验收流程变化                 |
| 领域术语与模块地图     | [CONTEXT](../CONTEXT.md)                      | 新增概念或职责变化                             |
| 数据流与权威存储       | [数据流](architecture/data-flow.md)           | 来源、存储、消费者或版本关系变化               |
| 行为与不变量           | 下表对应现行Spec                              | 可见行为或数据合同变化                         |
| 决策理由与替代范围     | 对应ADR                                       | 架构决定被接受、扩展或取代                     |
| 活动工作、阻塞、下一步 | [current](current.md)                         | 任务状态变化，替换更新                         |
| 跨Session任务细节      | `work/`下对应任务                             | 任务需要跨轮次／机器接手；普通小改动无需建文件 |
| 机器能力与平台限制     | [环境登记](development-environments.md)       | 资源、工具、验证能力或限制变化                 |
| 操作步骤和副作用       | 对应运行手册                                  | 命令、参数或准备条件变化                       |
| 可执行命令与依赖版本   | [package](../package.json)、锁文件和脚本      | 实现变更；文档引用，检查其存在性               |
| 目标业务快照           | [dev-data.lock](../dev-data.lock.json)        | 经授权发布并核验新快照                         |
| 实际状态与检查结果     | 本机active／manifest、数据库身份合同及run记录 | 执行核验；仓库只保存有基线的结论               |
| 历史过程及原始审阅     | `history/`、`reviews/`                        | 完成任务／归档旧状态；不冒充当前规则           |

更新流向：**实现或核验 → 更新对应权威页 → current调整任务状态与链接 → 受影响任务按路由重读**。README只维护能力摘要和使用入口，不重复完整合同。用户任务决定授权范围；Spec描述应有行为，代码及检查描述已实现／已验证状态，发现偏差时明确记录并修正。

## 按任务读取

基础范围：AGENTS、CONTEXT、current、环境登记，以及当前Git状态和相关Session。任务范围卡与扩展条件由AGENTS维护。

| 任务              | 追加读取                                                                                                                                                           | 验证入口                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 图鉴UI            | [语义UI](specs/semantic-game-ui.md)、[设计系统](design-system.md)；涉及加载时读[列表](specs/infinite-lists.md)和[缓存](specs/browser-catalog-cache.md)             | 对应组件及图鉴浏览流程                        |
| 地图／寻路        | [地图](specs/map-explorer.md)、[本机来源](repositories/local-dota-map.md)或[公开来源](repositories/sloppy-map.md)                                                  | 已有地图算法、导入、组件用例；核对Dataset版本 |
| 单位／资产        | [单位](specs/unit-catalog.md)、[资产ADR](adr/0004-database-icon-asset-datasets.md)、所用来源页                                                                     | 单位、资产及相关浏览／数据库检查              |
| Catalog导入／发布 | [Catalog](specs/hero-catalog-v2.md)、[来源](repositories/README.md)、[刷新门禁](adr/0003-catalog-refresh-gates.md)                                                 | 解析、差异、原子发布及数据库约束              |
| 同步／平台兼容    | [同步Spec](specs/development-data-sync.md)、[运行手册](development-data-sync-runbook.md)、[恢复ADR](adr/0008-development-snapshot-restore.md)、环境对应条目        | 内容一致性、失败恢复及目标平台                |
| 数据库身份／迁移  | [环境合同](architecture/environment-contract-details.md)、[ADR0005](adr/0005-environment-contract.md)、[隔离验证](specs/environment-isolation-and-verification.md) | 完整数据库合同检查                            |
| 检查／开发脚手架  | [工作台](specs/development-workbench.md)、[ADR0007](adr/0007-shared-development-workbench.md)、[开发手册](operations/development.md)                               | 检查选择、输入失效、对应组合验收              |
| 纯文档            | 本索引、该事实权威页及引用方                                                                                                                                       | `pnpm docs:check`、格式检查；无需产品环境     |

## 文档清单

下表是文档状态的维护位置，`pnpm docs:check`核对覆盖。`active`为当前规则／操作／任务；`reference`为决策或固定证据，按适用范围读取；`historical`仅代表原基线。部分被取代的ADR仍保留有效条款，替代范围写在原页。

| 文档                                                                        | 状态       | 负责内容                                    |
| --------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| [当前工作](current.md)                                                      | active     | 活动状态与接手                              |
| [环境登记](development-environments.md)                                     | active     | 机器能力、限制与推荐                        |
| [同步运行手册](development-data-sync-runbook.md)                            | active     | 获取、发布、恢复操作                        |
| [设计系统](design-system.md)                                                | active     | 共用视觉规则                                |
| [数据流](architecture/data-flow.md)                                         | active     | 来源、存储与版本关系                        |
| [技术选型](architecture/technology-selection.md)                            | active     | 技术理由与演进条件                          |
| [环境合同细节](architecture/environment-contract-details.md)                | active     | 身份、用途和权限概念                        |
| [环境合同历史审阅](architecture/environment-contract-review.md)             | historical | 2026-08-31审查基线                          |
| [Catalog v2](specs/hero-catalog-v2.md)                                      | active     | Catalog、来源适配、关系、导入合同；UI见专项 |
| [英雄MVP](specs/hero-metadata-mvp.md)                                       | historical | 首版合同；兼容记录保留，现行Catalog见v2     |
| [语义图鉴](specs/semantic-game-ui.md)                                       | active     | 玩家页面、搜索、游戏文本                    |
| [无限列表](specs/infinite-lists.md)                                         | active     | 连续加载与分块渲染                          |
| [浏览器目录缓存](specs/browser-catalog-cache.md)                            | active     | 派生快照、同步与失效                        |
| [单位](specs/unit-catalog.md)                                               | active     | 单位模型、头像及缺项                        |
| [地图](specs/map-explorer.md)                                               | active     | 地图数据、操作、计算与估算边界              |
| [工作台](specs/development-workbench.md)                                    | active     | 共享开发、反馈、检查与产物合同              |
| [开发数据同步](specs/development-data-sync.md)                              | active     | 快照、切换、内容一致性协议                  |
| [隔离验证](specs/environment-isolation-and-verification.md)                 | active     | 显式isolated运行与数据库合同                |
| [OpenDota配置](specs/opendota-secret.md)                                    | active     | 可选服务端秘密入口                          |
| [开发操作](operations/development.md)                                       | active     | 启动、检查、构建、清理及排障命令            |
| [Catalog与资产导入](operations/catalog-import.md)                           | active     | 首次来源、英雄／技能／单位图片导入          |
| [Catalog刷新](operations/catalog-refresh.md)                                | active     | Review、发布、回滚与development调度         |
| [来源总览](repositories/README.md)                                          | active     | 各来源职责与选源                            |
| [GameTracking](repositories/game-tracking-dota2.md)                         | reference  | 协议／引擎来源审阅                          |
| [VPK定义来源](repositories/dota-vpk-updates.md)                             | reference  | 固定快照结构与适配边界                      |
| [dotaconstants](repositories/dotaconstants.md)                              | reference  | QA与图片路径参考                            |
| [ReDota](repositories/redota.md)                                            | reference  | 单位截图来源和许可                          |
| [Sloppy地图](repositories/sloppy-map.md)                                    | reference  | 固定公开地图版本与许可                      |
| [本机地图](repositories/local-dota-map.md)                                  | reference  | 6944取证、当前适配及引擎待验项              |
| [ADR0001](adr/0001-hero-catalog-version-boundary.md)                        | reference  | Catalog原子版本                             |
| [ADR0002](adr/0002-valve-local-asset-provider.md)                           | reference  | 只读来源／许可；供图方式被0004替代          |
| [ADR0003](adr/0003-catalog-refresh-gates.md)                                | reference  | 刷新审阅门禁                                |
| [ADR0004](adr/0004-database-icon-asset-datasets.md)                         | reference  | 数据库资产版本                              |
| [ADR0005](adr/0005-environment-contract.md)                                 | reference  | 身份合同；开发连接复用由0007修订            |
| [ADR0006](adr/0006-run-scoped-verification.md)                              | reference  | 显式隔离；日常共享规则由0007修订            |
| [ADR0007](adr/0007-shared-development-workbench.md)                         | reference  | 共享工作台与按需验证                        |
| [ADR0008](adr/0008-development-snapshot-restore.md)                         | reference  | 开发快照与恢复                              |
| [主图标记录](assets/medota2-icon.md)                                        | reference  | 图片来源、选择和导出参数                    |
| [固定Catalog审计](data/real-snapshot-audit-991daaf6.json)                   | reference  | 单次来源审计，不代表当前环境                |
| [开发脚手架Review](reviews/development-scaffold-review-2026-10-06.html)     | historical | 0007的方案依据                              |
| [早期完整工程方案](reviews/testing-to-delivery-refactor-2026-09-06.html)    | historical | 原候选方案；按需打开大HTML                  |
| [简版工程方案](reviews/testing-to-delivery-refactor-simple-2026-10-05.html) | historical | 原需求讨论与附录                            |
| [空间审计](reviews/storage-audit-2026-10-06.md)                             | historical | 特定机器与时间的容量证据                    |
| [旧current完整快照](history/2026-10-06-current.md)                          | historical | 61个旧章节与原证据路径                      |
| [旧环境登记快照](history/2026-10-06-development-environments.md)            | historical | 环境观察历史                                |
| [Context迁移与验收](history/2026-10-07-context-migration.md)                | reference  | 原章节去向、此次范围与验收                  |
| [Windows复验任务](work/windows-native-validation.md)                        | active     | 平台失败的接手步骤与解除条件                |

## 维护与自动检查

新增、改名或改变职责时更新本表及入站引用；现行文档中的操作命令必须存在。文件级替代关系使用 `superseded-by` 注释，原文说明部分或完整替代范围，检查器验证目标与无环性。

基础Context目标为20 KiB以内，超出时预警并整理归属，不截断内容。历史材料和大型HTML默认不加载；需要取证时通过明确链接打开。历史中的`.medota2/`、`output/`是产生记录机器的附件，缺失时注明未知并按复现步骤核验，不能声称已读取。

`pnpm docs:check`只检查仓库内结构、链接／标题锚点、文档覆盖、当前命令与客户端引用；不访问外网，不运行文中操作命令，不证明自然语言全部正确。静态检查失败修复后再交付；语义一致性通过相关合同和接手场景人工核对。
