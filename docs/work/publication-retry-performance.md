# 发布预检与失败恢复交接

更新：2026-10-11。最新功能基线`e067a7a`已合入main；CI为static/runtime两个core通道与固定6个浏览分片，同片共用fixture、Web服务及预热，main保留轻量证据核对和直接推送的完整所选检查兜底。作业数14→10；本轮合计1199 runner秒，较原1708减少29.8%。完整快照bee227bd/12bcfdff、8238对象已交接。

包含537全量单元、4所选数据库合同、Linux正式构建及全部所选浏览／视觉的完整发布为**267.620秒（4分27.6秒）**。原资源POST超时通过服务端固定版本表格GET／POST准备修复，原测试、断言、超时与网络隔离保持；8次本机零重试、两轮Linux首次通过。计时条件、第一轮303.723秒与第二轮267.620秒证据见[完整发布验收](../history/2026-10-11-publication-full-gates.md)，此前9作业与增量范围保留在[精简验收](../history/2026-10-11-ci-simplification.md)。

新待定位项：第二轮Linux `catalog-views.spec.ts:128`英雄移动排序／冻结流程点击分类菜单（第172行）被排序图标／冻结对象列遮挡，首次30秒超时、重试4.3秒通过。截图和trace在候选38149672701的browser (1)产物中；后续核对横向滚动和表头布局，不使用force点击或放宽断言。原资源POST问题已解决，不能把本轮描述为全无flaky。

剩余交接：Windows原生环境复验受管进程树取消与清理；首次安装、冷构建、快照变化及GitHub排队下的300秒上界尚未验证。其他机器用`pnpm sync`消费同一基线，再用`pnpm data:status`核对本机状态。

正常发布使用`pnpm push`；失败后按日志中的`pnpm check --retry-failed <run.json>`先修复失败项，再完成当前完整发布计划。定向通过不替代发布门禁。行为见[工作台Spec](../specs/development-workbench.md#发布前预检定向复验与取消)、[同步Spec](../specs/development-data-sync.md#发布候选与执行证据)，操作见[同步手册](../development-data-sync-runbook.md#发布预览验证与恢复)。
