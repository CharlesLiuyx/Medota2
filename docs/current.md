# 当前工作

更新：2026-10-08。只维护活动状态；概念见[CONTEXT](../CONTEXT.md)，阅读入口见[文档导航](README.md)。

## 基线与接手

- 最新功能基线：`main / 684dd12`，含本轮全部本地实现、测试顺序与客户端脚本预热修复；完整业务快照仍为`6577aa14`、数据提交`93885618`。该提交[verify/push CI](https://github.com/CharlesLiuyx/Medota2/actions/runs/37728068582)成功；收尾仅更新发布文档，见[发布验收](history/2026-10-08-main-publication.md)。
- 目标由[dev-data.lock.json](../dev-data.lock.json)选择。其他机器运行`pnpm sync`；实际应用、数据库身份及摘要用`pnpm data:status`核对。任务启动与共享协作按[AGENTS](../AGENTS.md)执行。

## 当前交接

属性／物品名称和完整术语匹配、图鉴页头与搜索、变化表格与共用表格、地图左侧工具及数据库读取修复已发布。Mac组合检查通过420单元、11fixture浏览、15真实浏览和23数据库合同，最终浏览无flaky；完整快照复核通过、本机`in-sync`。功能范围、跳过原因、来源推定和构建验证边界见[本轮发布验收](history/2026-10-08-main-publication.md)。此前发布与Context迁移证据按[文档导航](README.md)进入历史记录。

活动任务：

- **近似视野Web及移动优化已完成，待人工审阅**：连续放点、悬停／拖动实时预览、天辉／夜魇／双方独立覆盖、昼夜半径、砍树恢复、原因查询、取消和信息图标说明已接入。Z轴修正已通过前轮验收。Esc选中、侦查／岗哨／英雄来源、反隐高亮及英雄小地图图标已完成；添加模式Hover隔离、无Icon预览、原生网格对齐与英雄碰撞占地已完成。默认视野持久缓存、树木增量更新、邻格预热及界面减负已完成；4倍CPU添加移动请求往返P95从29.3ms降至9.5–10.5ms，67单元与2条真实地图旅程通过。守卫及静态地图原生Icon按用户安排留给[Windows提取](work/map-vision-occlusion.md#windows原生小地图资产待办)。前轮446单元、17真实浏览、4相关数据库检查及更早生产构建／启动保留原验收边界。已导入127个本机图标，本机状态为data-differs，待完整业务数据交接；仍是未校准引擎的近似模型。使用入口、性能与检查证据见[Web验收](history/2026-10-08-map-vision-web.md)，可选精度升级见[视野交接](work/map-vision-occlusion.md)。
- **页面人工审阅待完成**：[地图默认配置与营地完整悬停](history/2026-10-08-map-camp-hover.md)已完成，默认三个野区开关关闭、兵线路径开启；营地悬停显示收益、拉叠时间、刷新范围与组合，浮层不挤动控件。63单元、17真实浏览通过，仍待人工审阅。变化表格、悬浮卡、地图紧凑布局、属性实体／名称及物品参数已通过相应本机检查；发布不代替人工审阅。各功能入口和细节见[本轮发布验收](history/2026-10-08-main-publication.md)，旧名称补充见[名称记录](history/2026-10-07-name-enrichment.md)。低把握推定名称仍保留说明，结算与叠加规则见[Windows机制核验](work/attribute-engine-verification.md)。
- **Windows专项复验待完成**：浏览跳转／页面崩溃及原生构建异常保留原断言，按[平台交接](work/windows-native-validation.md)定位。
- **实体版本与Diff后续验收**：7.41f为默认，第一阶段已落地；真实更新后的多版和跨机器验证见[实施任务](work/entity-version-diff.md)与[7.41f记录](work/7.41f-update.md)。

## 产品缺项

- 单位定义与补充本地化尚有运行时来源依赖，单位图片仍有缺项，目录分块仍未接入；持久化与补图边界见[单位 Spec](specs/unit-catalog.md#后续计划)和[语义 UI](specs/semantic-game-ui.md#本地化文件与版本)。
- 地图导航、碰撞、湍流角度和经济结算尚需同版本引擎抽样；静态估算的适用范围见[地图 Spec](specs/map-explorer.md)。
- 远程 production、比赛／replay 和云端平台验收仍为后续方向，见[技术选型](architecture/technology-selection.md#16-尚未决定)。

## 交接规则

回写按[AGENTS](../AGENTS.md#结束任务与信息归属)；跨机器接手须复核代码、数据与检查，本机`.medota2/`／`output/`附件不随Git交接。
