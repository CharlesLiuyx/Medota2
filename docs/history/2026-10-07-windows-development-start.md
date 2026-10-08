# Windows本地开发启动与快照切换（2026-10-07）

环境为GofurWindowsLenovo，Windows原生PowerShell。代码基线`main/db27edf`，本轮未提交的修改为同步检查兼容与对应文档、测试；原有Windows诊断文档补充保留。系统Node24.19.0与pnpm11.7.0没有替换。所有本机附件均位于忽略目录，其他机器不保证持有。

## 同步阻塞与修复

前轮拉取已下载目标快照，但新代码按37表schema检查旧34表数据库，在创建候选前停止。新增0010已发布schema的只读检查合同，固定schema摘要`6b6b58fa96efb3d61c233c498ca8ccf088e958b6c71d1405f8278f9e68864ac2`与迁移摘要`70586843fee5bb9143316eba6627ea29c159ff7a502db16f49cf564636447167`；同时检查真实表结构、迁移账本和业务摘要，未知或损坏合同仍拒绝。历史合同不用于导出或目标恢复。旧库有未保存改动时仍停止，须用匹配旧代码保存数据，不在旧活动库自动迁移。

`pnpm data:apply --plan`确认旧库无未保存改动；`pnpm data:apply`在独立候选恢复迁移0011与新业务快照，恢复后摘要校验、切换前旧库复核均通过，switch journal完成。原旧库未迁移、删除或重置。

目标快照`6577aa14e3dd6e59246735e4588bb9b2d921be4a05ed9fd7430cee286283c920`；数据提交`93885618e3fd2faf408b68223c9091f3db87ec9c`，37表、95649行、6342对象。业务摘要`ffb68637d659f76b386b6de241745fb08be1392a2f540c67d30b4f28fdb1601e`，地图摘要`9f89f2c5dfa1e5999b481da29e3b4d779e5df76292de639a411d0d07ad631291`，与发布基线一致。`pnpm data:status`为`code-modified`、problems为空，不能报告完整`in-sync`。

## 运行与检查范围

Node24.19.0的格式、Lint、文档、类型和353单元通过；首轮组合浏览为1通过、1flaky、1跳过、10失败，期间3000停止监听，健康连接拒绝。前台supervisor再次退出，status捕获Web退出码3221225477（0xC0000005）；不能据此断言与此前独立构建异常同因。组合检查在浏览失败后停止，数据库合同和构建未执行。

整个Web使用`--jitless`对照会使Next Edge runtime所需WebAssembly不可用，已停止。`--no-opt`不允许写入NODE_OPTIONS，未以此启动。没有改变全局Node选项、PATH、`.env`或产品默认。还曾观察到pnpm解析的异常字符，之后从文件读取相同行正常；不足以证明JIT、硬件或存储根因。

另从[官方Node校验清单](https://nodejs.org/download/release/v22.23.3/SHASUMS256.txt)获取满足项目最低版本的Node22.23.3便携版，ZIP SHA256为`2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`，仅存放在本机`.medota2/runtimes/`。首次前台对照仍退出；随后同版本工作台启动到ready并在短浏览复核后保持可用。英雄与技能两条query/filter/detail复核均在原5秒详情URL断言超时，未放宽断言；不将便携运行时启动视为全部Windows问题已解决。

本机可使用`pwsh -File .medota2/start-development-node22.ps1`复用工作台；需要重新启动时加`-Restart`。该本机辅助脚本只对其进程设置PATH，另有`-Stop`和`-Foreground`选项；未安装系统运行时，其他机器需自行准备并核验版本。当前origin为`http://127.0.0.1:3000`。

## 证据与下一步

本机证据：`.medota2/sessions/start-dev-20261007.md`、`start-dev-plan-20261007.log`、`start-dev-apply-20261007.log`、`start-dev-check-20261007.log`、`start-dev-node22-journeys-20261007.log`、`start-dev-data-status-20261007.log`；静态与单元组合收据`.medota2/checks/1791384553663-4e2d5124/run.json`（整体failed），文档收尾收据`.medota2/checks/1791385089100-76f7e01e/run.json`（passed）。图谱同步核验节点与平台摘要已回写，节点选择／详情文本的Playwright检查通过。

当前仅确认完整快照切换与本地服务可用。未执行发布构建、全部平台组合验收或引擎语义核验；未提交、推送或发布。后续按[Windows复验任务](../work/windows-native-validation.md)定位详情跳转与原生退出，保留精确进程、版本、退出码和trace。
