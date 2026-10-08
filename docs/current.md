# 当前工作

更新：2026-10-09。只维护活动状态；概念见[CONTEXT](../CONTEXT.md)，阅读入口见[文档导航](README.md)。

## 基线与接手

- 最新功能基线：`main / 8f5638f`，含地图近似视野Web与移动缓存优化、营地完整悬停、英雄小地图图标、新Logo及语言旅程修复；完整业务快照`173b0645`、数据提交`601d8a2b`。该提交[verify/push CI](https://github.com/CharlesLiuyx/Medota2/actions/runs/37793796142)成功；范围与交接见[地图Web发布验收](history/2026-10-08-map-web-publication.md)。
- 目标由[dev-data.lock.json](../dev-data.lock.json)选择。其他机器运行`pnpm sync`；实际应用、数据库身份及摘要用`pnpm data:status`核对。任务启动与共享协作按[AGENTS](../AGENTS.md)执行。

## 当前交接

地图视野Web、营地详情、127英雄小地图图标和新Logo已发布。Mac功能组合通过448单元、11fixture／17真实浏览、4相关数据库合同与正式构建／启动；语言旅程修复后12fixture／18真实浏览通过，两轮最终无flaky。完整6850对象远端回验通过，22:19:55（新加坡）业务核验为`in-sync`；本机另有未提交地图调整，代码状态需按当前`git status`核对。Linux修复CI通过12fixture浏览、无flaky。范围与边界见[本轮地图Web发布验收](history/2026-10-08-map-web-publication.md)，此前发布进入[历史记录](history/2026-10-08-main-publication.md)。

活动任务：

- **近似视野Web及移动优化已完成，待人工审阅**：连续放点、悬停／拖动实时预览、天辉／夜魇／双方独立覆盖、昼夜半径、砍树恢复、原因查询、取消和信息图标说明已接入。Z轴修正已通过前轮验收。Esc选中、侦查／岗哨／英雄来源、反隐高亮及英雄小地图图标已完成；添加模式Hover隔离、无Icon预览、原生网格对齐与英雄碰撞占地已完成。默认视野持久缓存、树木增量更新、邻格预热及界面减负已完成；4倍CPU添加移动请求往返P95从29.3ms降至9.5–10.5ms，67单元与2条真实地图旅程通过。[Windows原生图标获取](work/map-vision-occlusion.md#windows原生小地图资产待办)已补全v2：修正护盾裁切，明确36项地图用途资产，核对110个非树对象；两类守卫、监视者、塔／兵营均有图。v3另仅补入devilesk两张32×32彩色守卫图，来源独立。智慧圣坛专用图仍缺，数据库与页面接入待完成；v3完整资产包已上传私有数据远端并独立回下载验证707文件，获取方式见[独立资产包交接](development-data-sync-runbook.md#独立资产包交接)。前轮446单元、17真实浏览、4相关数据库检查及更早生产构建／启动保留原验收边界。127个英雄小地图图标已随完整业务快照发布并回验；仍是未校准引擎的近似模型。使用入口、性能与检查证据见[Web验收](history/2026-10-08-map-vision-web.md)，可选精度升级见[视野交接](work/map-vision-occlusion.md)。
- **页面人工审阅待完成**：[地图默认配置与营地完整悬停](history/2026-10-08-map-camp-hover.md)已完成，默认三个野区开关关闭、兵线路径开启；营地悬停显示收益、拉叠时间、刷新范围与组合，浮层不挤动控件。63单元、17真实浏览通过，仍待人工审阅。变化表格、悬浮卡、地图紧凑布局、属性实体／名称及物品参数已通过相应本机检查；发布不代替人工审阅。各功能入口和细节见[本轮发布验收](history/2026-10-08-main-publication.md)，旧名称补充见[名称记录](history/2026-10-07-name-enrichment.md)。低把握推定名称仍保留说明，结算与叠加规则见[Windows机制核验](work/attribute-engine-verification.md)。
- **Windows已有单轮验收，间歇退出待定位**：452单元、12fixture／18真实浏览、23数据库合同及生产构建／启动已通过，浏览无flaky；修复测试配置路径、单测并发和独立产物fixture继承本机地图路径的问题。后续复验出现1项fixture flaky及真实预热连接重置，工作台进程消失后已重启；Node22间歇退出、Node24原生异常仍待定位，见[本机复验](history/2026-10-09-windows-publication.md)及[平台交接](work/windows-native-validation.md)。
- **实体版本与Diff后续验收**：7.41f为默认，第一阶段已落地；真实更新后的多版和跨机器验证见[实施任务](work/entity-version-diff.md)与[7.41f记录](work/7.41f-update.md)。

## 产品缺项

- 单位定义与补充本地化尚有运行时来源依赖，单位图片仍有缺项，目录分块仍未接入；持久化与补图边界见[单位 Spec](specs/unit-catalog.md#后续计划)和[语义 UI](specs/semantic-game-ui.md#本地化文件与版本)。
- 地图导航、碰撞、湍流角度和经济结算尚需同版本引擎抽样；静态估算的适用范围见[地图 Spec](specs/map-explorer.md)。
- 远程 production、比赛／replay 和云端平台验收仍为后续方向，见[技术选型](architecture/technology-selection.md#16-尚未决定)。

## 交接规则

回写按[AGENTS](../AGENTS.md#结束任务与信息归属)；跨机器接手须复核代码、数据与检查，本机`.medota2/`／`output/`附件不随Git交接。
