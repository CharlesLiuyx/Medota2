# 当前工作

更新：2026-10-07。此页维护活动状态；概念见 [CONTEXT](../CONTEXT.md)，规则与任务阅读入口见[文档导航](README.md)。旧过程在[历史快照](history/2026-10-06-current.md)，不作为实时状态。

## 基线与接手

- 本轮开始代码：`main / 1063ee3`；包含此前未提交的 Mac 同步交接，已完整保留于历史快照末节。
- 目标业务数据由 [dev-data.lock.json](../dev-data.lock.json) 选择。实际是否应用、数据库身份及摘要需在任务涉及数据时用 `pnpm data:status` 核对，不能只读文档判断。
- 最近已有记录：2026-10-06 Mac 消费目标快照、工作台 ready，五个页面 HTTP 200；这次同步未重跑完整产品测试。原始记录见[Mac 交接](history/2026-10-06-current.md#mac-拉取远端变更2026-10-06)。
- 开始任务先核对当前 Git diff 和相关 Session，按 [AGENTS](../AGENTS.md) 建立本次 Context 范围。

## 当前交接

文档、Context与检查范围整理已完成，用户已审阅并授权提交至main。48份文档已登记，61个旧章节完整归档；本机必要组合检查通过。范围、检查结果与接手演练见[迁移验收](history/2026-10-07-context-migration.md)。

地图紧凑UI与营地选中保持已合入main（实现提交`1cfa248`）；布局与验证见[记录](history/2026-10-07-map-compact-ui.md)。

活动任务：

- Windows浏览及原生构建异常仍待专项复验，保留原断言，按[平台交接](work/windows-native-validation.md)定位。
- **待实施：实体版本化与语义 Diff**。先确定实体范围，再关联游戏／客户端等版本，支持前端按版本查询和结构化的实体、属性、关系、机制变化。下一步是实体盘点与概念模型；要求、现状差距和验收见[系统优化 Todo](work/entity-version-diff.md)。

## 产品缺项

- 单位定义与补充本地化尚有运行时来源依赖，单位图片仍有缺项，目录分块仍未接入；持久化与补图边界见[单位 Spec](specs/unit-catalog.md#后续计划)和[语义 UI](specs/semantic-game-ui.md#本地化文件与版本)。
- 地图导航、碰撞、湍流角度和经济结算尚需同版本引擎抽样；静态估算的适用范围见[地图 Spec](specs/map-explorer.md)。
- 远程 production、比赛／replay 和云端平台验收仍为后续方向，见[技术选型](architecture/technology-selection.md#16-尚未决定)。

## 交接规则

稳定结论更新其[唯一维护位置](README.md#事实归属与更新流向)，本页只留下当前状态和入口。任务完成后替换活动行；详细证据写入任务记录或历史报告，注明环境、版本、检查范围和未验证项。

`.medota2/` 和 `output/` 是各机器的本地附件位置；接手不能假设另一机器持有它们。历史记录的日期或“通过”不能代替当前代码的检查。
