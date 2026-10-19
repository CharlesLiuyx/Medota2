# Docker残留与开发生命周期验收

日期：2026-10-19；环境：GofurMacM4Max128GB，macOS arm64、Node26.8.1、Next16.3.3。代码基线main／a05bc58加既有未提交功能与本轮生命周期修改；未提交或推送。本轮行为由[工作台Spec](../specs/development-workbench.md)维护，命令见[开发手册](../operations/development.md)。

## 改动与边界

- 清理5个Medota2停用容器及5个网络，其中2个来自旧catalog-publication工作树。保留8个命名业务卷及既有匿名卷，未全局prune，其他项目不在清理范围。
- 移除无现行调用／文档引用的默认Compose与旧bootstrap覆盖文件；保留现用业务栈、tmpfs测试栈。旧文件名仅作为历史Docker标签的识别条件。
- 工作台启动前按checkout、Compose配置、项目和服务身份清理停用资源；日常只准备所选业务库、Web及按需小样例。退出先取消准备／预热、等待子进程，再以保卷down回收业务容器和网络。重复stop可收尾，restart及同步内部旧库核验保留数据库。
- 测试栈只在锁内批次复用，成功／失败／取消后回收，删除跨任务的Docker启动时间和fixture播种缓存判定。Docker启动前先写精确租约，连续终止信号不会跳过收尾；强杀／断电残留由下次启动／测试或test:clean恢复。
- 首轮交付仍需dev:stop；同日按追加要求改成前台终端租约，最后一个开发终端关闭后自动停机。业务卷、来源、凭据、必要诊断和编译缓存按原合同保留。

## 验证

完整检查`1792414520141-e26e5b2f`通过：603单元、49真实旅程／1条件跳过、6桌面／移动视觉、23完整数据库合同、正式构建与独立启动；浏览全部首轮通过。两项Windows专用单元在Mac条件跳过。删除旧Compose后的检查`1792414729115-b01c04e1`另通过79相关单元、29真实旅程／1条件跳过及23数据库合同。

真实fixture准备期间向所属进程连续发送两次SIGTERM：命令按取消退出，测试容器0、租约null。工作台准备期间执行dev:stop：1.77秒完成，启动客户端明确返回cancelled，容器0。重复pnpm dev核对相同owner PID与instance。图谱work-graph-edit／feedback节点已同步，浏览点击详情及源码入口正确；临时文档浏览器和HTTP服务已关闭。

保卷恢复实测：内部`--keep-database`停Web后保留同一数据库容器，旧库摘要仍可读取；普通stop后容器清零，下一次dev创建新容器并复用原卷。业务摘要`9e26a2d1…`、地图摘要`9f89f2c5…`前后一致，data:status为code-modified且problems为空（退出2对应既有未提交代码）。最终连续两次stop通过，Medota2容器与网络均为0，8个命名业务卷保持，43187／63547无监听。其他已跟踪文件的未提交diff与开始基线一致。

本机证据在`.medota2/sessions/docker-lifecycle-20261019/`，包括check-final2.log、check-scaffold.log、cancel-fixture.json、cancel-start.json及lifecycle.json；这些是本机附件，不作为跨机器可用文件。复验入口（追加终端生命周期后，dev保持前台，状态与显式stop在第二个终端执行）：

```bash
pnpm check --files src/workers/dev.ts src/development/docker-resources.ts src/development/test-environment.ts src/server/environment/data-stack-lifecycle.ts
pnpm dev
pnpm dev:stop
pnpm dev
pnpm data:status
pnpm dev:stop
```

初次检查主动中断以核验取消链并补齐准备阶段收尾，当时出现kill EPERM和遗留测试租约，未记通过；租约随后精确回收。后一轮lint报告startupControls应使用const，已修复；最终上述检查全部通过。未降低测试标准或更新视觉基线。本轮未重新执行跨机器同步、Windows／Linux原生生命周期验收或远程发布。

## 追加：关闭终端自动清理

`pnpm dev`与`dev:restart`保持前台运行，多个终端共用服务；关闭窗口、Ctrl+C或前台进程意外退出时释放本终端，最后一个释放后自动回收Web、样例、容器和网络。独立supervisor检查终端租约、进程／父进程和心跳；TTY EOF／close／error用于处理macOS pnpm包装链未转发SIGHUP的情况。启动途中退出同样生效，浏览器不续租。重启及同步切换期间原终端等待新实例，最多180秒。

内部浏览检查和同步启动核验通过有界客户端持有服务，IPC确认就绪；任务成功或失败均释放，已有开发终端继续使用。同步worker纳入工具链检查映射；不执行实际快照切换。

真实PTY测试通过：两终端同实例、关闭第一个仍可用、关闭最后一个自动回收；准备中关闭终端；重启后原终端接入新实例；最后Ctrl+C清理；前台SIGKILL后supervisor检测并清理。每轮结束容器和租约为0。首次真实关闭测试发现仅处理信号不足，修正TTY断开监听后全流程通过；诊断脚本自身的EOF循环也已修正并重新执行，未把中断轮次记为通过。证据`terminal-lifecycle.json`／`terminal-lifecycle3.log`位于上述本机目录。

内部调用另经真实进程验证：业务回调抛错仍释放本客户端，其他客户端继续ready；调用方SIGKILL后，孤立客户端经父进程／IPC断开检测退出，其他客户端继续使用同一实例。见`terminal-callers.json`，两项均通过。

追加范围分批验证：`1792415300707-b5063199`的格式、lint、类型、605单元（Mac条件跳过2项）、49真实旅程（1条件跳过）与正式构建／独立启动均通过；运行期间补写文档使docs指纹过期，整轮明确标记stale，未计为整轮通过。代码与对应输入未再修改，保留有效代码结果；`1792415498518-51cd134a`补验通过6视觉及完整23数据库合同，覆盖原计划剩余门禁。浏览均首轮通过。最终文档单独检查，日志`terminal-docs.log`。

收尾核验：工作台stopped，终端租约0，所有Medota2容器／网络0，43187／63547无监听，8个业务命名卷保留。未提交、推送或执行真实数据切换；本机Mac结论不冒充Windows／Linux原生终端验证。
