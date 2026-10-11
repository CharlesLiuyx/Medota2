# 发布预检与失败恢复交接

更新：2026-10-11。最新功能基线`8bea4c5`已合入main；CI精简为一个core与固定6个浏览分片，同片共用fixture、Web服务及预热，main保留轻量证据核对和直接推送的完整所选检查兜底。作业数14→9；广范围运行合计1327 runner秒，较原1708减少22.3%。完整快照bee227bd/12bcfdff、8238对象已交接。

最新完整增量发布**296.194秒（4分56.2秒）**，但包含全量单元／数据库／Linux构建的上一轮广范围为**314.757秒（5分14.8秒）**。增量达到300秒，广范围仍待达成；不沿用前轮或较小范围宣布广范围达标。两种范围、七轮过程和CI证据见[CI精简验收](../history/2026-10-11-ci-simplification.md)，此前预检／恢复的288.562秒记录保留在[前轮验收](../history/2026-10-11-publish-retry.md)。

已保留原检查范围、断言、超时、一次重试及精确SHA门禁。下一步结合最后CI trace定位`resource-loading.spec.ts:87`首次POST等待超时（重试通过），再用相同广范围复测；菜单与单位说明就绪问题已补明确事件标记，两组各9次零重试验证通过。

剩余交接：Windows原生环境复验受管进程树取消与清理；首次安装、冷构建、快照变化及GitHub排队下的300秒上界尚未验证。其他机器用`pnpm sync`消费同一基线，再用`pnpm data:status`核对本机状态。

正常发布使用`pnpm push`；失败后按日志中的`pnpm check --retry-failed <run.json>`先修复失败项，再完成当前完整发布计划。定向通过不替代发布门禁。行为见[工作台Spec](../specs/development-workbench.md#发布前预检定向复验与取消)、[同步Spec](../specs/development-data-sync.md#发布候选与执行证据)，操作见[同步手册](../development-data-sync-runbook.md#发布预览验证与恢复)。
