# 文档导航与事实归属

本页维护文档职责、状态与读取入口。执行规则在 [AGENTS](../AGENTS.md)，稳定术语在 [CONTEXT](../CONTEXT.md)，活动工作在 [current](current.md)。每次任务按范围读取，不默认加载全部文档。

## 事实归属与更新流向

| 信息                   | 唯一维护位置                                  | 更新触发                                       |
| ---------------------- | --------------------------------------------- | ---------------------------------------------- |
| Agent规则与范围声明    | [AGENTS](../AGENTS.md)                        | 协作、授权、接手或验收流程变化                 |
| 领域术语与模块地图     | [CONTEXT](../CONTEXT.md)                      | 新增概念或职责变化                             |
| 现状与跨模块可视化总览 | [项目图谱](architecture/project-atlas.html)   | 图中现状、流程、实体、版本或模块关系变化       |
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

更新流向：**实现或核验 → 更新对应权威页及受影响图谱 → current调整任务状态与链接 → 受影响任务按路由重读**。README只维护能力摘要和使用入口，不重复完整合同。用户任务决定授权范围；Spec描述应有行为，代码及检查描述已实现／已验证状态，发现偏差时明确记录并修正。

## 图谱维护约定

[项目现状与架构图谱](architecture/project-atlas.html)是现行可视化总览的唯一维护源，直接编辑此HTML；`output/`中的旧附件和生成器不再作为维护源。CONTEXT维护稳定术语与模块入口，图谱解释它们如何关联、运转以及当前能力边界；具体行为、字段和不变量仍由对应Spec、数据流文档及ADR负责。冲突必须在同一任务中核对实现与合同并修正，不能保留两套解释。

- **开始时**：配合CONTEXT按任务读取相关图：[资料与缓存](architecture/project-atlas.html#data)、[开发／门禁／交接](architecture/project-atlas.html#workflow)、[实体／版本／模块](architecture/project-atlas.html#entities)。涉及能力或平台状态时读[当前情况](architecture/project-atlas.html#now)及其依据，无需每次展开整份HTML。
- **变更时**：下层代码、数据模型、Spec、ADR、命令或环境结论改变了图中的能力边界、输入输出、权威存储、缓存、流程门禁、实体关系、版本语义、模块职责或实现入口，必须在同一任务中回写图谱。更新受影响节点的定义、作用、详情、来源文件，相关箭头、图例、正文及核对依据；只改日期或链接不算完成。
- **交付时**：Session记录受影响图的ID与回写结果；判定无影响时写明理由。按图下依据核对语义，运行`pnpm docs:check`、`pnpm check`；修改HTML时另做格式、文件链接及相关交互检查。文档静态检查不自动证明图意与实现一致。受影响图未同步，任务不得标为完成。
- **证据与计划**：数量与验证结果标明时间、代码／数据基线及范围；计划链接任务，实施后同步图谱与状态。当前[实体版本与Diff优化](work/entity-version-diff.md)第一阶段架构已实施，完整多版本数据验收仍待实际更新。

## 按任务读取

国际化、界面文案与语言行为变更先读[全局国际化](specs/global-i18n.md)，游戏来源本地化仍读语义UI。

基础范围：AGENTS、CONTEXT、current、环境登记，以及当前Git状态和相关Session。任务范围卡与扩展条件由AGENTS维护。

| 任务                                                         | 追加读取                                                                                                                                                                      | 验证入口                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 图鉴UI                                                       | [语义UI](specs/semantic-game-ui.md)、[设计系统](design-system.md)；涉及加载时读[列表](specs/infinite-lists.md)和[缓存](specs/browser-catalog-cache.md)                        | 对应组件及图鉴浏览流程                        |
| 地图／寻路                                                   | [地图](specs/map-explorer.md)、[本机来源](repositories/local-dota-map.md)或[公开来源](repositories/sloppy-map.md)                                                             | 已有地图算法、导入、组件用例；核对Dataset版本 |
| 属性图鉴                                                     | [属性](specs/attribute-catalog.md)、[语义UI](specs/semantic-game-ui.md)、[实体版本](specs/entity-versions.md)；机制缺项见[Windows核验](work/attribute-engine-verification.md) | 属性映射、枚举、来源覆盖、公式与浏览流程      |
| 物品图鉴                                                     | [物品](specs/item-catalog.md)、[语义UI](specs/semantic-game-ui.md)、[实体版本](specs/entity-versions.md)                                                                      | 物品适配器、固定来源与浏览流程                |
| 单位／资产                                                   | [单位](specs/unit-catalog.md)、[资产ADR](adr/0004-database-icon-asset-datasets.md)、所用来源页                                                                                | 单位、资产及相关浏览／数据库检查              |
| Catalog导入／发布                                            | [Catalog](specs/hero-catalog-v2.md)、[来源](repositories/README.md)、[刷新门禁](adr/0003-catalog-refresh-gates.md)                                                            | 解析、差异、原子发布及数据库约束              |
| 同步／平台兼容                                               | [同步Spec](specs/development-data-sync.md)、[运行手册](development-data-sync-runbook.md)、[恢复ADR](adr/0008-development-snapshot-restore.md)、环境对应条目                   | 内容一致性、失败恢复及目标平台                |
| 数据库身份／迁移                                             | [环境合同](architecture/environment-contract-details.md)、[ADR0005](adr/0005-environment-contract.md)、[隔离验证](specs/environment-isolation-and-verification.md)            | 完整数据库合同检查                            |
| 检查／开发脚手架                                             | [工作台](specs/development-workbench.md)、[ADR0007](adr/0007-shared-development-workbench.md)、[开发手册](operations/development.md)                                          | 检查选择、输入失效、对应组合验收              |
| [按需检查优化验收](history/2026-10-07-incremental-checks.md) | reference                                                                                                                                                                     | 范围映射、单项重试、静态并行与耗时证据        |
| 纯文档                                                       | 本索引、该事实权威页及引用方                                                                                                                                                  | `pnpm docs:check`、格式检查；无需产品环境     |

## 文档清单

下表是文档状态的维护位置，`pnpm docs:check`核对覆盖。`active`为当前规则／操作／任务；`reference`为决策或固定证据，按适用范围读取；`historical`仅代表原基线。部分被取代的ADR仍保留有效条款，替代范围写在原页。

| 文档                                                                        | 状态       | 负责内容                                           |
| --------------------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| [当前工作](current.md)                                                      | active     | 活动状态与接手                                     |
| [环境登记](development-environments.md)                                     | active     | 机器能力、限制与推荐                               |
| [同步运行手册](development-data-sync-runbook.md)                            | active     | 获取、发布、恢复操作                               |
| [设计系统](design-system.md)                                                | active     | 共用视觉规则                                       |
| [项目现状与架构图谱](architecture/project-atlas.html)                       | active     | 跨模块可视化总览、现状及实现入口                   |
| [数据流](architecture/data-flow.md)                                         | active     | 来源、存储与版本关系                               |
| [技术选型](architecture/technology-selection.md)                            | active     | 技术理由与演进条件                                 |
| [环境合同细节](architecture/environment-contract-details.md)                | active     | 身份、用途和权限概念                               |
| [环境合同历史审阅](architecture/environment-contract-review.md)             | historical | 2026-08-31审查基线                                 |
| [实体版本与Diff](specs/entity-versions.md)                                  | active     | 全局版本、实体身份、覆盖和端点比较                 |
| [ADR0009](adr/0009-entity-release-read-context.md)                          | reference  | 版本读上下文与完整端点Diff                         |
| [Catalog v2](specs/hero-catalog-v2.md)                                      | active     | Catalog、来源适配、关系、导入合同；UI见专项        |
| [英雄MVP](specs/hero-metadata-mvp.md)                                       | historical | 首版合同；兼容记录保留，现行Catalog见v2            |
| [全局国际化](specs/global-i18n.md)                                          | active     | 界面语言、请求上下文、文案与全工作流验收           |
| [i18n实施](work/global-i18n.md)                                             | active     | 国际化迁移范围、状态与验证                         |
| [i18n验证](history/2026-10-07-global-i18n.md)                               | historical | 双语实现、本机验证与复跑边界                       |
| [语义图鉴](specs/semantic-game-ui.md)                                       | active     | 玩家页面、搜索、游戏文本                           |
| [缺失名称补充验收](history/2026-10-07-name-enrichment.md)                   | reference  | 名称身份盘点、公开来源、用途名及固定版本验证       |
| [无限列表](specs/infinite-lists.md)                                         | active     | 连续加载与分块渲染                                 |
| [浏览器目录缓存](specs/browser-catalog-cache.md)                            | active     | 派生快照、同步与失效                               |
| [单位](specs/unit-catalog.md)                                               | active     | 单位模型、头像及缺项                               |
| [属性字段覆盖审计](data/attribute-coverage-7.41e-7.41f.json)                | reference  | 两版根级数字字段、枚举字段与物品参数覆盖           |
| [属性](specs/attribute-catalog.md)                                          | active     | 属性身份、同版引用、官方名称、机制与证据           |
| [属性机制Windows核验](work/attribute-engine-verification.md)                | active     | 同版客户端来源提取与实验交接                       |
| [物品](specs/item-catalog.md)                                               | active     | 物品定义、目录、配方与来源边界                     |
| [地图](specs/map-explorer.md)                                               | active     | 地图数据、操作、计算与估算边界                     |
| [视野遮挡算法 Plan / Todo](work/map-vision-occlusion.md)                    | active     | 版本输入、引擎采样、算法校准、地图接入与验收待办   |
| [工作台](specs/development-workbench.md)                                    | active     | 共享开发、反馈、检查与产物合同                     |
| [开发数据同步](specs/development-data-sync.md)                              | active     | 快照、切换、内容一致性协议                         |
| [隔离验证](specs/environment-isolation-and-verification.md)                 | active     | 显式isolated运行与数据库合同                       |
| [OpenDota配置](specs/opendota-secret.md)                                    | active     | 可选服务端秘密入口                                 |
| [开发操作](operations/development.md)                                       | active     | 启动、检查、构建、清理及排障命令                   |
| [Catalog与资产导入](operations/catalog-import.md)                           | active     | 首次来源、英雄／技能／单位图片导入                 |
| [Catalog刷新](operations/catalog-refresh.md)                                | active     | Review、发布、回滚与development调度                |
| [来源总览](repositories/README.md)                                          | active     | 各来源职责与选源                                   |
| [GameTracking](repositories/game-tracking-dota2.md)                         | reference  | 协议／引擎来源审阅                                 |
| [VPK定义来源](repositories/dota-vpk-updates.md)                             | reference  | 固定快照结构与适配边界                             |
| [dotaconstants](repositories/dotaconstants.md)                              | reference  | QA与图片路径参考                                   |
| [ReDota](repositories/redota.md)                                            | reference  | 单位截图来源和许可                                 |
| [Sloppy地图](repositories/sloppy-map.md)                                    | reference  | 固定公开地图版本与许可                             |
| [本机地图](repositories/local-dota-map.md)                                  | reference  | 6944取证、当前适配及引擎待验项                     |
| [ADR0001](adr/0001-hero-catalog-version-boundary.md)                        | reference  | Catalog原子版本                                    |
| [ADR0002](adr/0002-valve-local-asset-provider.md)                           | reference  | 只读来源／许可；供图方式被0004替代                 |
| [ADR0003](adr/0003-catalog-refresh-gates.md)                                | reference  | 刷新审阅门禁                                       |
| [ADR0004](adr/0004-database-icon-asset-datasets.md)                         | reference  | 数据库资产版本                                     |
| [ADR0005](adr/0005-environment-contract.md)                                 | reference  | 身份合同；开发连接复用由0007修订                   |
| [ADR0006](adr/0006-run-scoped-verification.md)                              | reference  | 显式隔离；日常共享规则由0007修订                   |
| [ADR0007](adr/0007-shared-development-workbench.md)                         | reference  | 共享工作台与按需验证                               |
| [ADR0008](adr/0008-development-snapshot-restore.md)                         | reference  | 开发快照与恢复                                     |
| [主图标记录](assets/medota2-icon.md)                                        | reference  | 图片来源、选择和导出参数                           |
| [固定Catalog审计](data/real-snapshot-audit-991daaf6.json)                   | reference  | 单次来源审计，不代表当前环境                       |
| [开发脚手架Review](reviews/development-scaffold-review-2026-10-06.html)     | historical | 0007的方案依据                                     |
| [早期完整工程方案](reviews/testing-to-delivery-refactor-2026-09-06.html)    | historical | 原候选方案；按需打开大HTML                         |
| [简版工程方案](reviews/testing-to-delivery-refactor-simple-2026-10-05.html) | historical | 原需求讨论与附录                                   |
| [空间审计](reviews/storage-audit-2026-10-06.md)                             | historical | 特定机器与时间的容量证据                           |
| [旧current完整快照](history/2026-10-06-current.md)                          | historical | 61个旧章节与原证据路径                             |
| [旧环境登记快照](history/2026-10-06-development-environments.md)            | historical | 环境观察历史                                       |
| [Context迁移与验收](history/2026-10-07-context-migration.md)                | reference  | 原章节去向、此次范围与验收                         |
| [全部变更发布验收](history/2026-10-07-main-publication.md)                  | reference  | main代码、完整快照、组合检查与平台边界             |
| [实体版本架构实施](history/2026-10-07-entity-version-foundation.md)         | historical | 第一阶段范围、基线、验证与下一次更新               |
| [属性参数命名审阅](history/2026-10-08-attribute-parameter-labels.md)        | historical | 两版逐项VPK查询、名称补充、未确认清单与验证        |
| [属性参数上下文命名](history/2026-10-08-attribute-context-names.md)         | historical | GPT-6-Luna逐项推定剩余双语名称与依据               |
| [属性原变量中文命名](history/2026-10-08-attribute-field-chinese-names.md)   | historical | GPT-6-Luna并行复核全部原变量中文标签与验证         |
| [变化表格与影响排序](history/2026-10-08-changes-table.md)                   | historical | 紧凑分类、实体简述卡、语义方向与连续虚拟滚动验收   |
| [图鉴统计与即时搜索](history/2026-10-08-tab-search-tooltips.md)             | historical | 属性数量、变化实时搜索、页头说明提示与本机验证     |
| [属性完整术语匹配](history/2026-10-08-attribute-term-matching.md)           | historical | 两版中英全篇匹配、复合术语、枚举定位与验证         |
| [属性实体验收](history/2026-10-07-attribute-catalog.md)                     | historical | 属性、枚举、固定来源与验证边界                     |
| [物品实体验收](history/2026-10-07-item-catalog.md)                          | historical | 物品实施、专项验证与并行检查边界                   |
| [物品参数名称补全](history/2026-10-07-item-parameter-labels.md)             | reference  | 注释标签、字段释义、两版补名与验证边界             |
| [地图紧凑UI](history/2026-10-07-map-compact-ui.md)                          | historical | 本轮布局与验证                                     |
| [地图顶栏分组](history/2026-10-08-map-toolbar.md)                           | historical | 顶栏收窄、状态分组、工具轨与属性栏上移及本机验证   |
| [地图工具栏移左](history/2026-10-08-map-left-tools.md)                      | historical | 工具移左、顶部湍流开关、缩放数字复位与地图视区加高 |
| [2026-10-08全部本地变更发布](history/2026-10-08-main-publication.md)        | historical | 本轮组合检查、完整快照、精确提交CI及接手边界       |
| [发布流程优化](history/2026-10-07-publication-optimization.md)              | reference  | 候选门禁、fixture前置、阶段收据、CI续接与验证边界  |
| [数据库读取稳定性](history/2026-10-08-database-read-resilience.md)          | reference  | 变化页池等待超时、端点快照、连接恢复及本机测量     |
| [开发反馈修复](history/2026-10-07-development-feedback.md)                  | reference  | 扩展干扰、扫描边界、编译器与隐藏视口验收           |
| [Windows复验任务](work/windows-native-validation.md)                        | active     | 平台失败的接手步骤与解除条件                       |
| [实体版本与 Diff 优化](work/entity-version-diff.md)                         | active     | 第一阶段实施、后续范围及真实更新验收               |
| [7.41f 更新与 VPK Diff](work/7.41f-update.md)                               | active     | 收录、官方说明与真实Diff                           |
| [7.41e → 7.41f 字段差异](data/vpk-diff-7.41e-7.41f.json)                    | reference  | 固定字段差异及首发后核对                           |

## 维护与自动检查

新增、改名或改变职责时更新本表及入站引用；现行文档中的操作命令必须存在。文件级替代关系使用 `superseded-by` 注释，原文说明部分或完整替代范围，检查器验证目标与无环性。

基础Context目标为20 KiB以内，超出时整理事实归属。历史材料和大型HTML按链接取证；本机附件缺失时注明未知并提供复现步骤。历史日期或“通过”不代表当前验收。

`pnpm docs:check`只检查仓库内结构、链接／标题锚点、文档覆盖、当前命令与客户端引用；不访问外网，不运行文中操作命令，不证明自然语言全部正确。静态检查失败修复后再交付；语义一致性通过相关合同和接手场景人工核对。
