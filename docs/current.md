# 当前工作

更新：2026-10-07。只维护活动状态；概念见[CONTEXT](../CONTEXT.md)，阅读入口见[文档导航](README.md)。

## 基线与接手

- 基线：`main / 4fdce38`；旧交接与Mac同步证据见[历史快照](history/2026-10-06-current.md)。
- 目标由[dev-data.lock.json](../dev-data.lock.json)选择。实际应用、数据库身份及摘要用 `pnpm data:status` 核对；任务启动与共享协作按[AGENTS](../AGENTS.md)执行。

## 当前交接

Context整理见[迁移验收](history/2026-10-07-context-migration.md)。全局中英界面已实现；应用术语优先官方VPK，范围与本机检查见[i18n记录](history/2026-10-07-global-i18n.md)。

活动任务：

- **属性实体已完成本机检查，待页面审阅**：63个通用概念、专属参数、枚举值、描述内实体链接、四类对象双向引用和同版机制证据已接入；8项范围检查通过，浏览12通过、1跳过，见[验收](history/2026-10-07-attribute-catalog.md)与[合同](specs/attribute-catalog.md)。未能由文本确定的结算与叠加规则见[Windows机制核验](work/attribute-engine-verification.md)。

- **按需检查优化已实施**：21项专项通过，原文案检查强制执行7.3秒、全复用2.3秒；属性任务稳定后的组合检查已通过。见[验收](history/2026-10-07-incremental-checks.md)。

- **名称补充已完成，待人工审阅**：两版缺名为0，名称浏览、单测与数据库验证通过；属性任务最终组合浏览已覆盖语言切换／地图状态并通过，见[记录](history/2026-10-07-name-enrichment.md)。

- Windows浏览及原生构建异常仍待专项复验，保留原断言，按[平台交接](work/windows-native-validation.md)定位。
- **实体版本与Diff已实现，7.41f为默认**。收录、验证及边界见[更新报告](work/7.41f-update.md)、[Spec](specs/entity-versions.md)和[记录](history/2026-10-07-entity-version-foundation.md)；跨机器验收见[任务](work/entity-version-diff.md)。

- **物品与图片已接入**：7.41e/f每版544项图片；本机快照含迁移0011，旧lock不兼容当前schema。发布交接待授权，组合浏览已在属性任务最终检查中通过，发布构建仍待单独验收，见[验收](history/2026-10-07-item-catalog.md)与[Spec](specs/item-catalog.md)。

## 产品缺项

- 单位定义与补充本地化尚有运行时来源依赖，单位图片仍有缺项，目录分块仍未接入；持久化与补图边界见[单位 Spec](specs/unit-catalog.md#后续计划)和[语义 UI](specs/semantic-game-ui.md#本地化文件与版本)。
- 地图导航、碰撞、湍流角度和经济结算尚需同版本引擎抽样；静态估算的适用范围见[地图 Spec](specs/map-explorer.md)。
- 远程 production、比赛／replay 和云端平台验收仍为后续方向，见[技术选型](architecture/technology-selection.md#16-尚未决定)。

## 交接规则

回写按[AGENTS](../AGENTS.md#结束任务与信息归属)；跨机器接手须复核代码、数据与检查，本机`.medota2/`／`output/`附件不随Git交接。
