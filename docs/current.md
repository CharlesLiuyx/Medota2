# 当前工作

更新：2026-10-20。只维护活动状态；概念见[CONTEXT](../CONTEXT.md)，阅读入口见[文档导航](README.md)。

## 基线与接手

- 最新功能基线：`9094236`，发布检查优化已合入main；发布检查与修复见[本轮发布验收](history/2026-10-19-main-publication.md)。完整业务快照仍为`bee227bd`、数据提交`12bcfdff`。
- 其他机器运行`pnpm sync`，用`pnpm data:status`核对代码、数据库身份和摘要；目标由[dev-data.lock.json](../dev-data.lock.json)选择。共享协作按[AGENTS](../AGENTS.md)执行。

## 待人工审阅

- **英雄等级、技能、天赋、物品与状态**：等级双向联动、六装备槽、中立物品及附魔、消费状态、来源分段与属性排名已实施并发布。已建模效果参与计算，其余保留缺项提示；7.41e／f各940条状态来源。发布门禁已重新验证历史导航；功能与计算边界见[英雄等级验收](history/2026-10-13-hero-detail-levels.md)、[物品验收](history/2026-10-15-hero-inventory.md)和[Spec](specs/hero-inventory.md)。下一步人工体验桌面与窄屏的组合配置、换档及联动。
- **Tab返回与图鉴表格**：首屏预热、缓存返回、角色二级列、冻结列、精度、列宽和重置已实施。首屏图片与普通浏览图片分配独立缓存预算。内存修复后返回英雄首帧32–92ms，9/10低于80ms；降速和内容就绪仍保留性能边界，见[切换验收](history/2026-10-13-tab-switch-latency.md)、[表格验收](history/2026-10-10-table-interactions.md)、[角色列验收](history/2026-10-10-hero-role-columns.md)和[后续性能工作](work/tab-cache-performance.md)。下一步人工体验连续切换、搜索、前进后退及表格操作。
- **地图、变化表格及实体浮层**：视野放置／多选／快捷键、路线选择、触控板平移缩放、营地信息、地图图标和岗哨标记已实施。4倍CPU缩放帧间隔P95从79.3ms降至18.1ms，实际手感仍待验收；地图仍是未校准引擎的近似模型。见[地图工具与性能](history/2026-10-09-map-tools-scenarios.md)、[英雄显示](history/2026-10-09-map-hero-interactions.md)、[岗哨标记](history/2026-10-12-sentry-marker.md)、[资产接入](history/2026-10-09-map-assets-integration.md)及[Web验收](history/2026-10-08-map-vision-web.md)。属性名称、物品参数和结算说明的低把握标记继续保留，机制核对见[Windows任务](work/attribute-engine-verification.md)。

## 环境与后续验证

- **CI准备与模块增量检查正在验证**：已定位254→283秒的关键路径主要差异为依赖安装8→45秒；同版复测259秒。首轮优化版270秒全部通过，第二轮被缓存返回旅程30秒累计超时／重试通过的flaky门禁阻塞；已分拆两条流程并通过本机fixture与真实数据定向复验。准备计时、缓存、镜像下载重叠、模块映射及1至6片容量估算已实施，待最终Linux与模块诊断。详见[CI增量实测](work/ci-incremental-20261020.md)。
- **内存、空间与Docker生命周期**：本轮修复已发布。Mac长时访问、三类HMR、多终端共用及退出回收已有验证；连续多日内存、Windows／Linux原生终端行为待复验。详细边界见[长时内存](history/2026-10-19-development-memory-growth.md)、[生命周期](history/2026-10-19-docker-lifecycle.md)与[空间治理及恢复](history/2026-10-19-sync-storage-cleanup.md)。本轮收尾状态和存储审计见发布验收。
- **Windows间歇退出及取消**：已有Node22单轮应用验收；后续工作台间歇退出、Node24原生异常及发布进程树取消仍待定位／复验。见[平台交接](work/windows-native-validation.md)、[本机验收](history/2026-10-09-windows-publication.md)与[发布取消交接](work/publication-retry-performance.md)。本轮Linux CI不能代替Windows原生验证。
- **实体版本与Diff**：7.41f为默认，第一阶段已落地；实际更新后的多版本和跨机器验证见[实施任务](work/entity-version-diff.md)与[7.41f记录](work/7.41f-update.md)。

## 产品缺项

- 单位定义与补充本地化尚有运行时来源依赖，单位图片仍有缺项；持久化与补图边界见[单位Spec](specs/unit-catalog.md#后续计划)和[语义UI](specs/semantic-game-ui.md#本地化文件与版本)。
- 地图导航、碰撞、湍流角度和经济结算尚需同版本引擎抽样；智慧圣坛专用图仍缺。见[地图Spec](specs/map-explorer.md)与[视野交接](work/map-vision-occlusion.md)。
- 远程production、比赛／replay和云端平台验收仍为后续方向，见[技术选型](architecture/technology-selection.md#16-尚未决定)。

## 交接规则

回写按[AGENTS](../AGENTS.md#结束任务与信息归属)；跨机器接手须复核代码、数据与检查，本机`.medota2/`／`output/`附件不随Git交接。发布与机器检查不代替页面人工审阅。
