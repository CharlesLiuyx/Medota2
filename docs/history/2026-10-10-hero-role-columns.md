# 英雄角色二级列验收

2026-10-10，GofurMacM4Max128GB。代码基线`main / 7ae1e55`加本轮工作区改动；数据锁快照`bee227bd`、数据提交`12bcfdff`不变。行为维护在[语义UI](../specs/semantic-game-ui.md#图鉴网格与表格)，状态见[current](../current.md)。

## 结果

英雄默认18个普通列加8个角色数值子列。角色保留一级表头，二级为核心、辅助、爆发、控制、耐久、逃生、推进、先手；未包含的角色为0。子列复用排序、隐藏、移动、精度与冻结功能。旧偏好中的roles列原位展开，原先隐藏角色的设置继续隐藏，旧冻结终点同步映射。来源仍是当前Catalog的角色数组，无导入、迁移或业务数据修改。

GroupedTable使用原生colSpan／rowSpan表头；相邻角色列共享分组，冻结边界或其他列将分组分段。冻结偏移从colgroup获取叶列宽度。测试发现短列的更多按钮覆盖排序点击中心，已向右移动4px利用已有单元格内边距，正常点击通过，无强制点击或放宽断言。

## 验证范围与证据

范围check `1791623441730-2084f4ce`通过：格式、lint、文档、类型、492单元（2既有跳过）、33真实浏览（1fixture专属跳过）、6桌面／手机视觉，以及正式构建／独立启动。最终浏览无flaky。产物`0e87bdc0ca0fac6eb391599db922e4c3d63034ee50f42c0f96d4cdc0dda6ed12`。

角色专项验证恐怖利刃`3/0/1/0/0/0/2/0`、数值升降序、旧偏好展开、冻结边界、手机滚动和英文表头；其他旅程覆盖默认26叶列、两层吸顶、配置／重置及其他共用表格。前轮角色专项首次与单项重试均因按钮遮挡失败，修复后的定向及最终完整回归首轮通过。前两次规划因并行修改测试文件触发输入保护，重新规划后验证，未越过门禁。

本机日志在`.medota2/sessions/hero-role-check-final.log`，角色和吸顶截图在`output/playwright/hero-role-subcolumns.png`及`hero-table-pinned-header.png`；这些忽略目录附件仅属于上述Mac工作区。复现使用AGENTS规定的`pnpm check --files`，纳入catalog投影／偏好／表格、GroupedTable、冻结定位、列头CSS、catalog单元／旅程和检查映射；角色专项可运行`pnpm test:journeys tests/journeys/catalog-views.spec.ts --grep 'role subcolumns' --retries=1`。

已同步图谱entities的图鉴节点。共用目录中的发布任务同时拆分了过长的catalog旅程，本任务保留该修改并在上述范围验证。没有提交、推送或发布；页面效果待用户人工审阅。
