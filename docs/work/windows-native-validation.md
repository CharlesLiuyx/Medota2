# Windows 原生浏览与构建复验

状态：待专项复验。更新：2026-10-07，依据2026-10-06历史记录；本轮未执行Windows远程诊断。

## 任务范围

目标：在同一代码／数据基线复现并定位详情跳转、页面崩溃和Next构建worker异常，取得该环境的有效组合验收。范围为Windows运行兼容、浏览测试及构建；不调整业务数值、数据库安全合同或测试断言来绕过失败。

读取：[环境登记](../development-environments.md)、[开发运行手册](../operations/development.md)、[工作台合同](../specs/development-workbench.md)、[同步协议](../specs/development-data-sync.md)。代码入口：`src/development/command.ts`、`src/development/process.ts`、`src/workers/run-shared-tests.ts`、`src/workers/release.ts`、`scripts/development/build-output.mjs`。

## 已知证据

- 2026-10-06代码 `392cd3d` 加待发布组合修复：286单测和类型通过；随后修复已提交为 `877b521`，交接文档为 `1063ee3`。
- 同期完整同步成功，目标由代码中的lock确定；出现过技能详情5秒跳转超时、详情h1未就绪、页面崩溃／ECONNRESET，独立Next worker退出3221225477。
- 更早的构建产物符号链接EPERM已有普通文件复制修复；过期产物和早期通过记录均不能代替最新组合结果。
- 来源：[历史整合记录](../history/2026-10-06-current.md#windows-拉取远端并整合本地工作2026-10-06)、[发布前检查](../history/2026-10-06-current.md#windows-本地变更交接-main2026-10-06)。本机附件是Windows的 `.medota2/sessions/pull-remote-*-20261006.log`、`push-main-check-20261006.log`；其他机器不保证持有。

## 接手与解除条件

1. 在获得该环境执行授权后核对Git、未提交改动、Node／pnpm／Docker版本和lock；建立本次Session范围。重跑失败所需命令前确认共享工作台没有其他写任务。
2. 用 `pnpm data:status` 确认数据一致性，运行 `pnpm check --plan` 明确检查范围。先复现技能浏览，再在源码稳定时运行 `pnpm release`；保留原断言、trace及退出码。
3. 区分Web冷编译／路由行为、浏览器、Node原生崩溃和OS问题。数据同步子进程的jitless兼容不自动推广到所有进程；根因未证实前不调整全局运行选项。
4. 修复后执行相应专项与组合检查，记录代码、数据、环境、命令、结果和复现方式。Windows该组合通过后才解除本平台限制。

Mac可以核对同一代码与快照的构建，提供跨平台对照；Mac通过不解除Windows失败。云端尚无登记实例。需跨机器传递的结论写回本任务，能力变化更新环境登记。
