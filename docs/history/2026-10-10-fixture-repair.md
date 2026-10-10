# Fixture 失败修复与架构根因

## 范围和基线

2026-10-10，新加坡日期。Mac共享工作台，代码基线`77ec811`及同日表格／列配置未提交改动；业务lock`bee227bd`、数据提交`12bcfdff`保持不变。用户要求排查修复前轮完整fixture的6项失败，并检查架构隐患。测试使用既有synthetic-fixture共享栈，不修改业务数据。

## 失败与根因

| 发现                         | 根因                                                                    | 修复与防回归                                                                               |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 两端英雄悬浮卡用例失败       | 全局单个tooltip定位与已有父／子卡合同冲突；鼠标移到卡片中心可能触发子卡 | 按触发器aria-describedby定位对应面板，明确验证父卡保留、逐层Escape、焦点与外部关闭         |
| 卡片异步变大后可能溢出       | 定位只监听打开、窗口滚动和缩放，未覆盖公式／图片到达后的内容尺寸        | HoverTooltip统一观察面板及锚点尺寸，复用帧调度和8px避让；关闭释放观察器                    |
| 关闭卡内焦点丢失             | Escape直接卸载拥有焦点的portal                                          | 先恢复该层触发器，再关闭；两层连续Escape保持键盘上下文                                     |
| 四张Mac及四张Linux旧快照失效 | 新品牌、标题首行布局和属性图标已有变化，但产品文件变更未触发视觉合同    | 逐张核对差异后分别实渲染更新，像素阈值未改变；明确展示依赖与品牌资源触发桌面／移动视觉检查 |
| 参数导致测试范围异常         | 脚本保留的独立`--`进入Playwright，使其后的选项变成位置过滤器            | 共享／独立入口统一剥离首个分隔符；内部／重复分隔符报错；保留文件与项目顺序                 |
| 终端过期但收据仍通过         | 输入核验发生在共享测试环境已写成功收据、释放租约之后                    | 租约内最终verify后才写成功；输入改变写stale，故障注入核对收据与终端一致                    |
| CI缺fixture截图和trace       | 上传路径只覆盖真实旅程，遗漏fixture的playwright子目录                   | 同时保留两套报告及失败附件                                                                 |

组合检查另发现一项生产构建问题：目录列头 CSS Module 使用纯全局选择器，开发时的 Turbopack 接受，但正式 webpack 构建拒绝。现将拖拽指示线限定到目录表头的本地类，再定位共享表头内容；既有拖拽旅程补充实际计算阴影断言。检查规划新增所有源CSS变更触发正式构建，并验证删除样式也会触发、普通组件逻辑不会无故扩围。正式构建负责覆盖这种开发／生产工具链差异，不能只凭开发页面与浏览测试宣布可发布。

悬浮卡生命周期继续集中在现有HoverTooltip中，调用方不承担定位／焦点细节；共享与独立测试入口复用同一参数规则。范围规划仍是本地与CI共同的单一规则，视觉只覆盖登记的页面合同，避免把每个局部修改扩大为完整fixture。以上与ADR0007一致，无新框架或业务数据模型。

## 验证

- 原desktop三项失败已定向复现，首次及单项重试均失败；未放宽断言或超时。
- 两个产品隐患的单元回归先失败后通过；悬浮卡、规划边界、参数与收据专项39项通过。
- 原悬浮卡desktop／mobile两项通过，并加强两层关闭、焦点恢复与外部点击断言。
- 四张Mac图片及四张Linux图片均先核对实际图与diff，再更新。更新快照的运行不算验收，后续使用无更新参数复验。
- 最终完整fixture桌面／移动共50项通过，0失败、无flaky；收据`.medota2/shared-tests/runs/1791614304287-7ea0693c/run.json`。
- 最终组合检查9项全部通过：格式、lint、文档、类型、488单元（2项既有跳过）、27真实旅程（1项既有跳过）、50fixture、4相关数据库合同（19项不在所选范围）以及正式构建／独立产物启动检查。浏览无flaky；组合收据`.medota2/checks/1791614055297-57770a8b/run.json`，完成于2026-10-10 14:42:13（新加坡）。
- 产物`7d7f06bda8efab48223b1518db2efd064712421b52378b85d77e157d3c7f15b4`的manifest为passed，smoke核对独立Web、Catalog API、静态资产和开发API关闭。没有远程部署。

复现命令：

```bash
pnpm test:e2e --project=desktop-chromium --project=mobile-chromium --retries=1
pnpm test:e2e -- tests/e2e/heroes.spec.ts --grep 'compact hero previews' --project=desktop-chromium --project=mobile-chromium
pnpm check --plan --files <本轮范围文件>
pnpm check --files <相同范围文件>
```

最终组合日志为`.medota2/sessions/fixture-repair-complete-check.log`；先前构建失败及为补充CSS门禁而中断的运行均不作为最终通过证据。本机日志在`.medota2/sessions/fixture-repair-*.log`，范围清单在`.medota2/sessions/fixture-repair-files.txt`。Linux使用已有`menv-browser-base:local`容器通过loopback代理访问同一fixture，复用`.medota2/linux-visual/`脚本；先以既有Chromium154通过6项，项目锁定Playwright1.62.1／Chromium151.0.7922.34（revision1234）复验相同6项也全部通过；没有再更新图片。列头CSS修复后以锁定浏览器再次验证6项通过，最终Linux日志为`fixture-repair-linux-final.log`，收据`.medota2/shared-tests/runs/1791613959634-f2069e4d/run.json`。该本机Linux arm64证据不代替GitHub Actions Ubuntu x64实际运行；忽略目录脚本与报告不是跨机器附件。

## 交付边界

本轮不提交、推送或发布；远端CI待实际提交后确认。稳定行为和命令规则已回写语义UI、开发工作台、设计系统、操作手册与图谱。
