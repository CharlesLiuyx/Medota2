# 发布预检与失败恢复交接

更新：2026-10-11。功能已随`6473f31`合入main，完整发布实测**288.562秒（4分48.6秒）**，本轮300秒目标达成。完整快照bee227bd/12bcfdff已回验，最终数据状态in-sync。

静态预检、失败定向复验及协同取消已落地；本机真实旅程与fixture构建重叠；CI后续精简为一个core与固定6个浏览分片，同片共用fixture、Web服务及预热；main保留轻量证据核对与完整所选检查兜底。本轮精简实测进行中，完成前不沿用前轮计时结论。保持原检查范围、断言、超时、单次重试、完整快照与精确SHA门禁。三轮测量、适用条件、已通过范围和CI链接见[验收记录](../history/2026-10-11-publish-retry.md)。

剩余交接：Windows原生环境复验受管进程树取消与清理；首次安装、冷构建、快照变化及GitHub排队下的300秒上界尚未验证。其他机器用`pnpm sync`消费同一基线，再用`pnpm data:status`核对本机状态。

正常发布使用`pnpm push`；失败后按日志中的`pnpm check --retry-failed <run.json>`先修复失败项，再完成当前完整发布计划。定向通过不替代发布门禁。行为见[工作台Spec](../specs/development-workbench.md#发布前预检定向复验与取消)、[同步Spec](../specs/development-data-sync.md#发布候选与执行证据)，操作见[同步手册](../development-data-sync-runbook.md#发布预览验证与恢复)。
