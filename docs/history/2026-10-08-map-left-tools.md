# 地图工具栏移左与顶栏压缩

日期：2026-10-08（Asia/Singapore）。环境：GofurMacM4Max128GB，共享3000真实工作台。代码基线main / 2f68616，叠加已有地图顶栏及其他任务未提交变更。数据锁提交93885618、快照6577aa14；页面为7.41f／6944，数据只读。本轮是UI调整，无数据导入或迁移。

## 实现

地图左侧64px轨包含地形、测距与寻路，右侧64px轨顶部横排缩放；点击比例数字恢复100%并居中，独立复位图标删除，键盘0保留。顶部下拉从26px压到22px，控制行上下padding为2px，画布与控制行间距为4px；桌面视区从100dvh减160px增至减96px，加高64px。右栏首张地形说明卡片取消顶部外边距。

湍流为顶部独立开关，默认关闭，有对应来源的版本才提供入口；可以与导航或高度图同时显示，右侧展示对应图例。独立状态进入绘制输入与背景缓存键，开关切换后刷新静态画面。

规则回写[地图Spec](../specs/map-explorer.md#地图布局与交互性能)；图谱data-graph-mapview同步交互边界和实现文件。来源与计算规则沿用原合同。

## 验证与复现

地图组件3项用例通过，覆盖原有营地／兵线／测距／寻路、湍流叠加与缓存失效、150%到100%数字复位。旧测试的单回调RAF桩会被独立提示框定位回调覆盖；修改前组件也复现原断言失败。现改为独立帧队列，保留原断言全部通过。

Playwright CLI核对中英1920×1080、1440×1000、390×844共6种布局：左工具、右缩放与桌面说明顶对齐，下拉22px，无横向溢出。宽屏控制行28px；导航与湍流同时显示2张图例，数字复位通过，console error为0。图谱通过格式检查，DOM专项核对节点点击、详情、选中状态及文件链接。

范围检查首轮43项测试通过，真实浏览14通过、1按fixture条件跳过、无flaky；运行期间其他任务改动table-sticky-cells.ts，使收据过期。补跑遇到变化表格搜索后聚焦旧链接的时序失败，原表格任务增加筛选完成等待后重新核验，未改其产品代码。最终代码／浏览结果有效通过或复用：43专项测试、真实浏览14通过／1既定跳过，无flaky，收据1791403975747-a28f21d5。其中只有文档项因其他任务回写current／历史而过期，最后按文档范围单独补验通过，收据1791404141431-285c75ca，文档结构检查0错误。

本机证据：.medota2/sessions/codex-map-left-tools-20261008.md、map-left-tools-layouts.txt及范围检查日志；截图output/playwright/map-left-tools-desktop.png、map-left-tools-mobile-en.png。忽略目录附件不随Git交接；其他环境按下面范围命令及6种中英布局复验。当前可在共享工作台审阅，Windows未复验。

```sh
pnpm check --files src/components/map/map-viewer.tsx src/components/map/terrain-legend.tsx src/app/globals.css tests/unit/map-viewer.test.tsx docs/specs/map-explorer.md docs/architecture/project-atlas.html
```

## 缩放位置修正

同日按用户新图修正：缩放移到地图视口左上角问号右侧，删除原右侧64px空竖栏及4px间距，画布填满腾出的空间。点击数字复位100%和问号Tooltip保留。现行布局以地图Spec和图谱data-graph-mapview为准。

5项范围检查1791404404161-b745569e通过，43项专项测试全部通过；中英1920／1440／390px共6种布局确认缩放在视口内部、位于问号右侧8px、距视口顶12px，布局仅两列且画布延伸至工作区右边界，页面无横向溢出。中英缩放150%到100%及操作说明通过。截图output/playwright/map-zoom-corner-desktop.png、map-zoom-corner-mobile-en.png为本机证据；图谱格式及DOM点击检查通过。文档收尾另按影响范围检查。

## 图层筛选与点位搜索拆分

同日按新附图将15项图层勾选筛选移到右侧对象属性区下方，逐项纵排，数量右对齐；营地悬停／焦点行为保留。地图下方保留点位搜索、筛选后的点位列表和前80项提示。窄屏右栏自然纵排，点位搜索与列表仍在地图之后。无新数据接口、依赖或消息键。

5项范围检查1791404622536-0af55727通过，43专项全部通过。中英1920／1440／390px共6种布局确认筛选在属性区、位于对象卡片之后，搜索和列表在地图下方，15项齐全且无横向溢出；树木开关与搜索同步，营地搜索28项、关闭后0项、恢复28项，悬停重绘及点击点位详情通过。当前console 0 errors；图谱节点交互／文件引用和HTML格式通过。截图output/playwright/map-layer-sidebar-desktop.png及map-layer-sidebar-mobile-en.png为本机证据，Session为codex-map-layer-sidebar-20261008，文档收尾另按范围验证。
