# 2026-10-19 开发进程长时内存增长定位

状态：修复、受控重复访问／热更新及完整检查已通过。环境为GofurMacM4Max128GB／macOS arm64／Node26.8.1／Next16.3.3；代码main a05bc58及本轮开始时已有未提交英雄装备／Tab／运行优化改动。共享origin为http://127.0.0.1:43187，既有local-review只读数据，目标lock bee227bd／12bcfdff；不提交、推送或修改业务数据。

## 已确认的原因

1. Next的`server/dev/debug-channel.js`将没有浏览器HMR连接的HTML请求保存在`reactDebugChannelsByHtmlRequestId`，本版本没有等待超时清理。80轮×8路由后积累1305条。诊断性清空后只释放一部分内存，因此不能将全部增长归因于这个Map。
2. React Flight开发调试器的`pendingOperations`通过`previous`／`awaited`串联旧异步任务。长寿命任务保留祖先链，即使对应Promise已经结束、部分Map条目已清理，历史仍被强引用。完整堆快照含11412332节点、42378789边，约94万WeakRef；保留路径可从`global → console.error wrapper → closure → pendingOperations`进入。BFS归属分析仅用来定位，不把它称作精确dominator retained size。
3. 只设置`reactDebugChannel=false`的独立对照中，待连接通道为0，但40轮×8请求的GC后JS堆仍从375增至500MiB。说明异步祖先链是另一个持续增长来源。与[React上游报告36836](https://github.com/react/react/issues/36836)的现象一致；该报告标为未确认并因不活跃关闭，本项目结论以本机取证和对照为准。

原23.3GB进程没有留下堆快照，这次复现不能精确分摊旧进程全部占用。[上一轮资源治理](2026-10-19-runtime-storage-performance.md)的重启、堆预算与编译回收仍然有效，本轮进一步处理能复现的持续保留。

## 测试方法

每组在同一个Next PID内运行，先预热，再重复访问。固定路由为`/heroes`、`/abilities`、`/units`、`/items`、`/attributes`、`/map`、`/heroes/axe`、`/heroes/antimage`；跟随正常Release重定向并完整消费响应。请求组80轮，共640次逻辑访问，不含预热及重定向的额外HTTP请求。

三类热更新各40轮：全局CSS自定义属性、英雄装备组件的诊断data属性、服务端装备投影返回值的未使用诊断字段。每轮保存后访问斧王／敌法师，另有真实浏览器保持斧王页面并接收HMR。每次写入及最终还原都校验文件仍等于本次探针的预期字节，避免覆盖并行修改。

每10轮分别记录自然状态与Inspector主动GC后的JS堆、native context数、模块数、RSS及vmmap Physical footprint；完成后另测15秒空闲。主动GC仅用于区分存活对象和待回收垃圾，未加入日常运行。堆采样用于分配来源，完整堆快照用于保留链，不能将两者混淆。CSS基线期间采集过一次堆快照，所以不把该阶段的延迟当作公平性能对比。

## 相同工作负载的对照

表中均为各阶段预热后与15秒空闲、主动GC后的JS堆（MiB）。修复前四组同PID76571；只关闭通道对照为PID9773；完整修复后四组同PID10512，组间未重启。每个阶段都重新记录预热基线，不将阶段间额外预热混入该阶段增量。

| 工作负载                   | 修复前                   | 修复后                |
| -------------------------- | ------------------------ | --------------------- |
| 640次逻辑页面访问          | 391.9 → 654.9（+263.1）  | 364.6 → 364.1（−0.5） |
| 40次CSS热更新及80次访问    | 655.0 → 685.7（+30.6）   | 369.4 → 365.9（−3.6） |
| 40次组件热更新及80次访问   | 693.6 → 813.4（+119.7）  | 370.4 → 367.5（−2.9） |
| 40次服务端热更新及80次访问 | 826.0 → 1060.1（+234.1） | 372.0 → 373.9（+1.9） |

完整修复后自然空闲JS堆约379MiB、Physical footprint约1.0GB，主动GC后373.9MiB／996.7MiB；同进程该阶段峰值2.1GB。异步祖先Map与待连接调试通道最后均为0。以上说明受控工作负载下存活内存稳定，不代表连续多日或所有输入已经验证。

浏览器修复完成后追加40次组件热更新，服务端GC堆483→479MiB；完整53项旅程批次将更多业务缓存与模块预热后，再对同PID追加40次，GC堆852→847MiB、最终足迹约1.4GB。完整业务预热基线高于八路由基线，不将一次性缓存加载误报为泄漏；后续同负载没有继续增长。浏览器第二组在已预热的同一斧王页面上，40次热更新前后GC堆36.25→35.23MiB，DOM8055、监听器1201均不变。全部临时源码探针已恢复。

另外用实际安装的Turbopack开发runtime单独运行同一长寿命任务，40000次Promise等待后保持任务未结束，再回收：原版增长11.83MiB，兼容后增长0.015MiB；没有Web、数据库或业务代码参与。该正反对照验证了单测8MiB门槛确实能拦住当前已知问题，而不是只断言配置字面值。

## 修复

- `reactDebugChannel=false`使调试信息随请求返回，避免无人连接的独立通道堆积。
- `scripts/development/react-debug-memory.mjs`仅在Next开发阶段安装Node同步模块加载钩子。对Next16.3.3四个已审核SHA256的开发AppPage runtime，在内存中将React可选异步调试钩子的激活改为关闭；不写安装文件，不改变其他Node异步钩子及请求AsyncLocalStorage，正式构建／正式启动不安装兼容。
- 代价：开发工具不再采集深层异步祖先历史；当前错误栈、React开发校验和热更新继续工作。版本或字节变化要求复验上游后移除或重新审阅，不能无依据更新指纹。
- Node下限随公开API调整为22.15；package engines接受22.15及以上22系列或24+。已登记Mac26.8.1、CI22.16、Windows22.23.3满足版本条件，本轮不据此宣称Windows已验收。

## 浏览器端重复导航

全新Chromium会话每轮依次点击英雄、技能、单位、物品、属性、地图，等待URL和标题就绪；每3轮空闲1秒后主动GC。初始实现第3／6／9／12轮的JS堆约50／61／72／85MiB，DOM节点21067／32677／43141／54879，实际文档仅1012节点。堆路径为文档的MediaQueryMatcher → HTMLImageElement::ViewportChangeListener → 未挂入文档的响应式图片 → 旧React树。

用不含React的最小实验创建并解码1000张带有效宽度候选的图片：丢弃JS引用后仍有2000个新增DOM节点；解码后固定currentSrc、去掉srcset／sizes的同样1000张图片，GC后节点回到初始6个。[Chromium对应实现](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/html_image_element.cc)会为宽度候选注册尺寸监听，并在移除图片或不再依赖尺寸时注销；以上判断以本机实验为主。

仅把英雄预备树挂入hidden容器仍不能消除增长；不创建隐藏树的同输入对照，72次导航GC堆31.9→32.9MiB、DOM节点固定3210、监听器约2844。说明隐藏渲染可能在被替换／中断前创建尚未提交的响应式图片，单纯调整容器连接状态不足以释放它们。最终移除后台React树准备，只缓存已验证输入，点击返回时同步查询本地目录并渲染；同时后台图片解码后固定currentSrc并释放尺寸监听，失败／超时也清理。保留图片预算、版本键与搜索／历史合同。

上述定点诊断中用Runtime.queryObjects操作图片的会话只用于定位，不能把操作后的内存当作最终证据；最终对照均用新页面且不修改其DOM。最终完整24轮共144次Tab点击，GC堆第3轮31.50MiB、第12轮32.40MiB、第24轮32.83MiB；DOM固定3208节点、监听器2703→2700、实际文档1015节点，没有持续累积旧页面。完整检查中另跑54次导航，第3→9轮节点固定4610、监听器固定2691，JS堆33.02→33.21MiB。独立页面与测试框架会保留不同数量的基线节点，因此比较各自增量，不跨会话混算。

构建完成后单独在1280×720桌面从技能／单位／物品／属性／地图各返回两次：首帧31.6–91.7ms，9/10低于原80ms目标；最慢为首次从物品返回，第二轮全部32.6–62.8ms。每次95张可见图片均就绪，搜索已启用。完整并发检查另测英雄返回96.5／42.9／40.5ms。取消隐藏DOM准备后需要当场渲染，不能沿用旧实现“全部低于80ms”的结论；数据、图片预热及交互合同通过，页面体验仍由用户审阅。

## 回归与复现入口

`pnpm test tests/unit/react-debug-memory.test.ts`实际载入锁定框架的webpack和Turbopack开发runtime，运行保持存活的40000次Promise等待，确认目标调试钩子不激活、其他hook有事件、并发异步上下文一致、GC后增长小于8MiB；同时检查生产阶段不安装、四个指纹受保护且安装文件原字节不变。测试不需要业务数据库。

完整组合使用`pnpm check --files package.json next.config.ts scripts/development/react-debug-memory.mjs scripts/development/react-debug-memory.d.mts tests/unit/react-debug-memory.test.ts src/browser/viewport-assets.ts src/components/hero-tab-cache.tsx tests/unit/viewport-assets.test.ts tests/journeys/resource-loading.spec.ts`；脚本与配置属于已有toolchain广范围映射，没有缩小门禁。浏览器修复另纳入`src/browser/viewport-assets.ts`、`src/components/hero-tab-cache.tsx`及对应unit／resource-loading journey；既有viewport映射覆盖新增内存回归。回归在3轮预热后再跑6轮，比较GC后文档数、节点、监听器和JS堆，避免只检查可见DOM数量。

本机完整采样和运行日志保存在`.medota2/sessions/memory-growth-20261019/`，这些忽略目录不是跨机器附件。大型堆快照包含运行时对象，只供本机分析，收尾保留统计和路径摘要后清理。原始851.6MiB堆快照已清理，保留统计和路径摘要。

## 完整验证

Mac本轮组合检查`1792403765914-6147f1c1`全部通过：格式、lint、文档、类型、595单元／2既有跳过、52真实旅程／1条件跳过、6桌面与移动视觉、4所选数据库合同／19未选，以及正式构建和独立启动。浏览器无重试、无flaky。Node22.16.0另跑3项框架兼容单测通过。三类HMR正常，受控服务端错误仍显示当前源文件／行号，热更新中英雄等级30保持。

业务数据回读`problems=[]`、`state=code-modified`，逻辑摘要仍为`9e26a2d182c55a06b90c2241ea8abfa2021d8c47cddf60bbc21eb91ec4eb67e7`；目标lock bee227bd／12bcfdff和活动receipt173b0645保持各自身份。未提交、推送或部署。本轮结论限于上述受控循环和本机环境；多日连续运行及Windows运行仍未验证。
