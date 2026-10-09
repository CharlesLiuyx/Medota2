# 2026-10-09 全部本地变更发布验收

## 发布范围与基线

用户明确授权将全部本地变更推送远端并合入main。本机为`GofurMacM4Max128GB`，复用共享3000工作台和local-review业务数据；起始代码`0d8e72b12e188b79f0c191aa41d2663319e56188`，36个跟踪修改与21个新增文件均进入同一候选。原分支已经是main，使用项目`pnpm push`普通推送，未创建合并PR。

- 功能候选：`a96169213d793107951675d6bbb25e848b510c7e`。
- 功能与数据发布提交：`523d832e8cb47001aa50c6630ea579c26b456f8a`。
- 完整业务快照：`bee227bd2a5397b2b4cfacbea47b5d2fd843ff87aa47cf5489def945724a00b4`。
- 私有数据提交：`12bcfdff63a90703fd7d392cdde6bc7923202e0b`。
- Manifest SHA-256：`54abc14af0fc36b4288312a75091df2453e1184628c613668d4ccb92a03c5224`。
- 精确发布提交的[verify/push CI](https://github.com/CharlesLiuyx/Medota2/actions/runs/37896290337)成功。

范围包含地图英雄显示与悬停、英雄更换、v3地图图标库与350图片接入、14个缺图单位的地图用途图、工具和快捷键、视野合法落点与高地提示、单选／Shift多选／删除、路线选择与删除、地形色板及热更新、营地标签与详情、触控板输入及绘制缓存优化。行为与实施证据分别见[地图Spec](../specs/map-explorer.md)、[资产接入](2026-10-09-map-assets-integration.md)、[英雄交互](2026-10-09-map-hero-interactions.md)和[工具与性能](2026-10-09-map-tools-scenarios.md)。

## 本机组合验证

`pnpm push`刷新远端基线后固定候选，使用`pnpm check --base 0d8e72b12e188b79f0c191aa41d2663319e56188 --publication`执行：

| 检查                   | 本轮结果                                                                        |
| ---------------------- | ------------------------------------------------------------------------------- |
| 格式、lint、类型、文档 | 全部通过；文档91项、0错误，保留核心上下文体积超目标的既有警告                   |
| 全部单元               | 92个文件、470通过、2既有跳过                                                    |
| Fixture浏览            | 12通过、7按数据条件跳过，无flaky                                                |
| 真实数据浏览           | 18通过、1fixture专属用例跳过，无flaky                                           |
| 所选数据库合同         | 4通过，覆盖固定版本、原子导入及双向Catalog关系；其余19项未选中                  |
| 解析样例               | 5次，median4.3ms、P95 4.4ms，峰值72MB                                           |
| 正式构建／独立启动     | 通过，Web产物`e69103a7b53d2c1f797a0793a93caaeb0fadf6de63114327b396f75a4a520a48` |
| 数据lock范围检查       | 格式与文档检查通过                                                              |

这些是Mac本机和该SHA的Linux CI证据，不代替Windows复验或用户页面验收。未配置远程production部署目标，本轮交付对象是代码与完整开发业务数据。

## 完整数据发布与回验

沿用既有私有仓库和授权资源范围。导出37张表、100274行、8238个对象、98个地图文件，共157499767字节。schema与migration摘要沿用原值，无新增迁移。

普通Git／LFS发布后，从独立远端验证缓存核对全部8238对象。6850个此前远端获取对象重新哈希核验，1388个新增对象一次LFS fetch独立回取（请求2732439字节）；不是全新空缓存全量下载审计。发布后再次读取当前业务内容，摘要与候选一致，才写入数据lock并推送代码。

功能与数据提交在远端main回读一致；2026-10-09 14:57:19（新加坡）`pnpm data:status`返回`in-sync`、`codeDirty=false`、`problems=[]`，当前数据库摘要为`9e26a2d182c55a06b90c2241ea8abfa2021d8c47cddf60bbc21eb91ec4eb67e7`。本轮收尾文档沿用该功能和数据基线，最终HEAD以Git和发布收据为准。

本机证据：`.medota2/publications/1791528338089-e702e3af/`、`.medota2/checks/1791528360102-cf143f91/`及`.medota2/sessions/push-local-20261009-data-status.json`。这些忽略目录不随Git交接；远端CI链接、代码／数据摘要及下列命令提供跨机器复现入口。

## 接手与待验收

其他机器在干净checkout运行`pnpm sync`和`pnpm data:status`，核对代码、lock与业务摘要；环境身份应与Mac不同。操作与失败恢复按[同步运行手册](../development-data-sync-runbook.md)，Windows间歇退出仍按[平台交接](../work/windows-native-validation.md)处理。

页面视觉与触控板手感仍待用户人工审阅；近似视野尚未同版本引擎校准，智慧圣坛专用图仍缺。原任务记录中的“未提交／未发布”描述保留为当时的历史边界，本页及[current](../current.md)维护本轮发布状态。

图谱本轮更新发布基线、当前组合验证与资产已入库状态；mapview／unitview节点继续保留原任务的已实现行为和相关代码入口。收尾仅更新交接文档，按文档范围检查并使用同一`pnpm push`入口发布。
