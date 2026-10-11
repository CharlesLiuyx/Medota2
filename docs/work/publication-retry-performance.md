# 发布预检与失败恢复交接

更新：2026-10-12。最新功能基线`75e3ea1`已合入main；CI为static/runtime两个core通道与固定6个浏览分片，保留片内共用准备、main轻量证据核对及直接推送兜底。完整快照bee227bd/12bcfdff、8238对象已交接。

本轮本机清空生产产物与编译缓存，完整发布命令为**285.700秒（4分45.7秒）**，含541全量单元、4所选数据库合同、两端重新构建与独立启动、Mac41真实／Linux33fixture、各4网络E2E及6视觉，最终全部无重试。冷编译117秒，本机动态202.667秒与候选224.378秒并行，10作业1269 runner秒。前两轮地图长用例超时、API空闲连接复用竞争的诊断、修复及计时边界见[冷构建验收](../history/2026-10-12-cold-publication.md)。此前复用成品255.318秒及表头修复证据见[表头验收](../history/2026-10-12-header-menu.md)。

浏览配置启用failOnFlakyTests，原一次重试仍收集诊断证据，但flaky同样阻断发布；失败reporter记录该用例，定向修复后必须重过完整计划。原断言、超时、隔离、数据和精确SHA门禁保持。此前预热与并行阶段267.620秒保留在[完整发布验收](../history/2026-10-11-publication-full-gates.md)。

剩余交接：Windows原生环境复验受管进程树取消与清理；本机生产冷构建已有单轮300秒以内证据；首次安装、快照变化及不同GitHub排队下的稳定300秒上界尚未验证。其他机器用`pnpm sync`消费同一基线，再用`pnpm data:status`核对本机状态。

正常发布使用`pnpm push`；失败后按日志中的`pnpm check --retry-failed <run.json>`先修复失败项，再完成当前完整发布计划。定向通过不替代发布门禁。行为见[工作台Spec](../specs/development-workbench.md#发布前预检定向复验与取消)、[同步Spec](../specs/development-data-sync.md#发布候选与执行证据)，操作见[同步手册](../development-data-sync-runbook.md#发布预览验证与恢复)。
