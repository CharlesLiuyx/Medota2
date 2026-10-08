# 地图顶栏分组与右栏上移

日期：2026-10-08（Asia/Singapore）。环境：GofurMacM4Max128GB，共享3000真实工作台。代码基线main / 2f68616，保留其他任务未提交改动；数据锁提交93885618，活动快照6577aa14与锁一致，data:status为code-modified、problems=[]。地图使用7.41f／6944及SHA-1 412137a154d86cd4ba61da98692a5fb15e1cb79a，仅调整布局。

## 实现

顶栏移入地图画布所在列，宽度与画布一致；64px地形／测距／寻路／缩放工具轨跨时间行和画布两行，200px对象属性栏与顶栏顶部对齐。普通兵／兵营情景下拉放在游戏时间左侧，时间跳转仍与滑条同步。游戏状态、三项野区配置、兵线路径三组通过两条细竖线区分，空间不足自然换行，窄屏对象属性栏继续在地图下方。

现行规则回写[地图Spec](../specs/map-explorer.md#地图布局与交互性能)和图谱data-graph-mapview。计算、地图来源和数据版本沿用现有合同。

## 验证

5项范围检查通过，收据1791400782055-7b1c4f94：格式、lint、文档、类型和42项测试。首轮类型检查被并行变化表格任务release-changes.ts的字符串／数字类型冲突阻塞，该任务修复后重新检查通过。单独地图组件的2项既有交互回归也通过，不降低断言。

Playwright CLI核对中英1920／1440／390px共6种布局，全部无横向溢出；顶栏左右边界与画布相同，工具轨顶端对齐，桌面对象属性栏同样对齐。分组为两项游戏状态、三项野区复选框、一项兵线路径复选框及两条1px分隔。实际切换超级兵情景、跳转15:00、开启野区经验后，时间滑条为900秒、兵线收益同步为超级兵。地图图谱节点点击、更新说明和来源文件链接验证通过。

本机证据：.medota2/sessions/codex-map-toolbar-20261008.md、map-toolbar-layout-final.log、map-toolbar-recheck.log、map-toolbar-data-status.log；截图output/playwright/map-toolbar-desktop.png及map-toolbar-mobile-en.png。这些忽略目录附件不随Git交接；其他机器依照范围命令pnpm check --files src/components/map/map-viewer.tsx docs/specs/map-explorer.md docs/architecture/project-atlas.html及中英宽／窄页面复验。当前可在共享工作台审阅，Windows未复验。
