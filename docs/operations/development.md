# 开发与验证运行手册

本页维护实际操作。行为合同见[共享工作台](../specs/development-workbench.md)，平台能力见[环境登记](../development-environments.md)。命令实现由[package.json](../../package.json)及对应脚本定义。

## 启动与配置

前置条件：Node.js 24 LTS（也支持22.15及以上的22系列；具体范围见package engines）、pnpm 11、Git、Docker。E2E 还需要项目锁定的 Playwright Chromium。

首次启动共享开发工作台：

```bash
pnpm install --frozen-lockfile
cp .env.example .env  # 已有 .env 时保留原文件
pnpm dev
```

打开 [http://127.0.0.1:3000/heroes](http://127.0.0.1:3000/heroes)。该入口默认优先复用已准备的 local-review 真实 Catalog 和资产，启动前检查图片覆盖；已有数据保持原样。没有真实审阅环境时，才使用 development 数据库，空库加载含占位图的小样例，并在开发面板标明。第二个 Session 再运行 `pnpm dev` 会连接同一个共享服务，并保持前台运行。

保存页面代码后自动热更新。页面右下角“共享开发”显示真实解析器的小样例、运行状态、耗时与错误；连续保存合并重算，旧结果不会覆盖新结果。页面数据与下方计算样例相互独立，计算使用的小 fixture 不替换页面的真实数据。冷启动与首次页面编译会慢一些。开发入口统一使用项目锁定的Turbopack，Tailwind扫描范围为`src/`；文档与测试保存不应引起全站CSS热更新。隐藏标签页暂停开发面板轮询，切回后立即同步。

开发浏览器应使用不注入页面内容的配置。若hydration报错显示`data-immersive-translate-page-theme`等服务端不存在的属性，在沉浸式翻译「基本设置 → 更多进阶设置 → 不使用插件的网址」中添加`http://127.0.0.1:3000/*`并保存，然后完整刷新（其他开发地址按实际origin配置）；也可使用无扩展的独立开发配置。不要用全局`suppressHydrationWarning`掩盖。依赖必须由本目录的`pnpm install --frozen-lockfile`建立，不复制其他工作树的`node_modules`或其链接；否则Turbopack可能无法在项目根内解析Next，临时工作树移除也会破坏开发环境。

`.env` 的 `MEDOTA2_WORKBENCH_DATA` 默认为 `auto`；可显式设为 `local-review` 或 `development`，修改后运行 `pnpm dev:restart`。真实数据模式的资产检查不通过时会报错，不会静默切换为占位图。

```bash
pnpm dev:restart             # 配置、迁移或脚手架变化后重新准备并恢复预览
pnpm dev:stop                # 停止Web／样例，移除数据库容器及网络，保留业务卷
pnpm db:development:stop     # 单独移除开发数据库容器及网络，保留业务卷
pnpm dev:sample              # 在终端执行同一个小样例
```

日常使用结束关闭运行`pnpm dev`的终端或按Ctrl+C即可；多个开发终端共用服务，最后一个退出后自动停机清理。浏览器页面不持有服务。`pnpm dev:stop`仍可显式停止全部终端共用的工作台。重启时原有终端等待新实例，重启命令也保持前台运行。下次`pnpm dev`复用同一业务卷并重新创建所需容器。测试库仅在一批检查内共用，结束后自动回收；前台进程或其父进程意外退出由独立supervisor检测并清理；supervisor被强杀或主机断电的残留由下次启动、测试或`pnpm test:clean`按精确租约清理。启动与退出的Docker清理只处理当前工作区的受管资源，运行中的任务／持锁资源延后，业务卷和其他项目保留。自动附件保留沿用下方策略。

开发日志位于 `.medota2/development/server.log`。多个 Session 共用目录和当前分支，各自维护 `.medota2/sessions/<id>.md`；提交、分支切换、依赖安装和数据库写操作先协调。详见 [AGENTS.md](../../AGENTS.md)。已有同步工作区的真实来源及地图由活动快照提供。

共享Next服务默认使用4096 MiB JavaScript老生代预算，避免Next按整机一半内存分配预算；需要调整时在启动命令的`NODE_OPTIONS`显式设置`--max-old-space-size`，其他Node选项保留。Turbopack每次磁盘快照后主动释放可回收编译数据，继续复用磁盘缓存。此预算不包括原生编译器及Buffer，不能当作进程总内存上限。macOS诊断同时记录`vmmap -summary <Next服务PID>`的Physical footprint和峰值；RSS不包含已压缩／换出的全部内存。服务长期异常时用`pnpm dev:restart`，停用的工作树用其自身的`pnpm dev:stop`关闭。

开发服务器还应用两项内存兼容措施：React调试信息随请求返回，关闭等待浏览器连接的独立调试通道；仅在Next开发阶段，用Node同步模块加载钩子停止React Flight的可选异步祖先跟踪。该跟踪会通过`previous`／`awaited`保留长寿命任务的历史。热更新、当前错误栈、普通异步钩子和请求AsyncLocalStorage继续运行；开发工具中的深层异步调用历史不再采集。正式构建与正式启动不安装该钩子。

兼容入口为`scripts/development/react-debug-memory.mjs`，只匹配Next16.3.3的四个已核对SHA256的开发AppPage runtime，在内存中替换单一调试钩子的激活，不写node_modules。Node最低22.15，使用`module.registerHooks`；本仓库接受22.15及以上22系列或24及以上版本。升级Next时若版本／文件指纹不匹配，先核验上游修复，重复访问与热更新测试后移除或重新审阅兼容；不得只更新哈希绕过检查。回归入口：`pnpm test tests/unit/react-debug-memory.test.ts`，覆盖真实框架模块、长寿命异步任务、请求上下文、其他钩子及生产隔离。

遇到`ENV_CONNECT_FAILED`时先查开发日志中的`connectionFailure`：timeout包含连接池等待超时，unreachable表示连接中断或不可达，capacity表示数据库连接容量耗尽；不能仅凭错误标题判断数据库已停止。变化页可直接点击“重试”，导航及URL参数保留。连接池／环境合同代码修改后需`pnpm dev:restart`更新全局复用实例；不要通过增大等待超时掩盖重复读取。只读状态核对用`pnpm data:status`，检查身份、快照与代码修改状态。

跨工作区的数据获取、恢复和发布见[同步运行手册](../development-data-sync-runbook.md)，协议见[同步 Spec](../specs/development-data-sync.md)。已实现 Windows 原生启动、进程与 ACL 适配；平台验证状态、推荐环境及待解决异常以[环境登记册](../development-environments.md)为准。

Windows 使用系统 Node、项目指定 pnpm 和 Docker Compose；进程直接调用 pnpm 的 JavaScript 入口，`pnpm-workspace.yaml` 的 `shellEmulator` 支持脚本中的环境变量赋值，不要求 Git Bash。

## 独立真实数据审阅入口

先在 `.env` 中配置只读的 `DOTA_VPK_UPDATES_PATH`，之后首次初始化和日常启动都只需要：

```bash
pnpm local
```

`pnpm local` 是 `pnpm dev:local` 的短别名。它会幂等地完成以下准备后启动 Web：

1. receipt 不存在时 provision 独立 local-review PostgreSQL stack，已存在时只启动原 stack；
2. 应用尚未执行的 migration；
3. 已有 active Catalog 时直接复用，不重复导入；
4. 首次没有 Catalog 时，从配置的只读 VPK checkout 导入真实快照并补齐官方图片。

首次导入若只有暂时的 `asset_provider_errors`，启动器会重试资产；仅当重试结果达到完整 LoD、零 fallback、零 mismatch、零 error 时，才会自动批准并晋升这个 asset-only Yellow 候选。任何玩法、来源或其他语义差异仍会停在人工 Review 门禁，不会为了启动页面而绕过。

传统local-review准备入口使用独立Compose project、默认54322端口、volume和receipt；已同步候选以活动清单为准。此独立Web入口为：

- [http://127.0.0.1:3001/heroes](http://127.0.0.1:3001/heroes)
- [http://127.0.0.1:3001/abilities](http://127.0.0.1:3001/abilities)
- [http://127.0.0.1:3001/design-system](http://127.0.0.1:3001/design-system)

导入失败不会预先清空已有 snapshot。只有确实需要重建时，才单独执行带精确确认的 `pnpm data:reset:local-review -- --confirm medota2_local`。

## 检查、测试与产物

```bash
pnpm check --plan --files src/components/hero-card.tsx  # 本任务范围与准备需求
pnpm check --files src/components/hero-card.tsx         # 执行相同范围
pnpm check                   # 组合交付：检查全部未提交改动
pnpm check --base <git-ref>  # 检查指定 Git 状态之后的组合改动
pnpm check --publication --base <git-ref>  # 发布检查：fixture与真实旅程
pnpm check --base <git-ref> --lane static  # 发布前静态预检，无产品数据库
pnpm check --retry-failed <run.json>      # 当前代码上的失败用例／任务定向复验
pnpm check --watch           # 相关内容变化后重跑
pnpm test:journeys           # 在共享开发页面执行短流程，不重置开发数据
pnpm test:journeys --fixture # 在可复用测试库核对已知数据与页面
pnpm test:integration --testNamePattern 'enforces canonical'
pnpm test:e2e tests/e2e/heroes.spec.ts --grep 'overview'
pnpm test:e2e --project=desktop-chromium --project=mobile-chromium # 完整fixture
pnpm test:e2e tests/e2e/visual.spec.ts --project=desktop-chromium --project=mobile-chromium # 两端视觉
pnpm bench --iterations 5   # 真实解析器的小样例耗时与内存
pnpm bench --input <vpk-directory> --iterations 3
pnpm release                # 构建并启动检查 Web 产物，相同输入复用
MEDOTA2_RELEASE_COLD=1 pnpm release  # 清空生产编译缓存，不复用成品，重新验收
pnpm test:clean             # 清理本工具持有的测试栈及退役编译目录，保留诊断
```

冷构建测量可在既有完整发布计划前加`MEDOTA2_RELEASE_COLD=1`，例如`MEDOTA2_RELEASE_COLD=1 pnpm push -m "chore: validate cold publication"`。开关只控制计划中实际选中的构建，不扩大检查范围；测量前用`pnpm check --plan`核对包含build与全部所需门禁。生产目录`.next-release`在release锁内清空，开发工作台、依赖和业务数据保留。计时应从push启动至main确认，包含本机重新构建，日志须出现Cold Web build且无Reusing checked Web artifact。Windows PowerShell先设置`$env:MEDOTA2_RELEASE_COLD="1"`，完成后用`Remove-Item Env:MEDOTA2_RELEASE_COLD`恢复。

小任务先列全本任务改动文件（含测试和负责规则的文档），规划与执行使用同一组 `--files`；新增依赖加入集合。翻译资源与已登记的展示组件选现有专项，无需启动产品数据库或浏览器。普通英雄卡片只选英雄浏览及共用悬停，版本／语言等流程按各自职责选取。规划器映射维护在 `scripts/development/check-plan.mjs`，新增职责时同步更新映射及边界测试。

`check` 选中的浏览流程自动附带 `--retries=1`：首轮通过的用例保持结果，只重试失败项一次，HTML报告与日志保留flaky。手工API request使用独立短连接，避免跨用例复用空闲TCP；不增加请求重试。直接执行 `pnpm test:journeys` 时仍默认不重试；可显式传 `--retries=1`。持续失败先看具体断言与trace；修复后重新规划受影响文件，避免无输入变化就反复整组重跑。产品检查通过后若只补文档，使用文档文件范围运行check。纯静态任务可直接运行，不排队等待其他任务的浏览检查；类型增量缓存仍由types锁保护。

`check` 按文件与功能选择少量 E2E、已有针对性单测、静态检查和必要构建。纯文档运行格式与 `pnpm docs:check`，不启动产品数据库或浏览器；普通页面逻辑改动不跑全量构建；源CSS新增、修改或删除会执行正式构建，核对开发Turbopack与生产webpack的编译差异。类型检查使用独立的 `tsconfig.check.json` 和 TypeScript 增量缓存，避免开发服务重新生成 `.next` 类型时相互干扰；框架生成的路由约束由正式构建检查。工具链变化会扩大范围，完整验证仍可显式运行：

```bash
pnpm typecheck
pnpm test
pnpm test:integration:isolated  # 每次全新数据库，适合身份/权限合同检查
pnpm test:e2e:isolated          # 完整 Desktop + Mobile 与视觉回归
pnpm verify                     # 显式全量诊断，包含覆盖率
```

测试脚本支持最前一个可选`--`，例如`pnpm test:e2e -- tests/e2e/heroes.spec.ts --project=mobile-chromium`；中间或重复的独立`--`会报错。`test:e2e`直接调用默认只跑桌面，完整fixture须显式指定两个项目；范围规划器会为选中的fixture与视觉合同传入桌面和移动项目。更新快照前先逐张核对差异，更新运行不能当作验收，随后不带`--update-snapshots`复验。Mac与Linux基线分别在对应环境渲染；远端CI需单独确认。

日常固定数据测试仅在一批任务内复用一套PostgreSQL，相关写入排队，结束后回收容器与网络；浏览器状态和报告每次独立。测试 API 固定数据版本，相关代码或数据变化时结果作废。`check` 的证据位于 `.medota2/checks/`，测试报告位于 `.medota2/shared-tests/runs/`；独立验证仍在 `.medota2/test-runs/`。

Windows测试运行器为Next生成的配置路径使用正斜杠；若fixture服务报`@/…`模块不存在，先检查该次`tsconfig.next.json`的`extends`及`MEDOTA2_NEXT_TSCONFIG`，修正生成器后重新运行原检查，不修改产品别名或放宽启动超时。

Windows的`pnpm test`默认最多4个worker，适用于多核机器上的Git／子进程fixture；不放宽原有测试超时。并发对照可用`pnpm test --maxWorkers=4`复现。

浏览流程globalSetup会只读预热目录／首条详情及其客户端脚本块，排除开发编译耗时后仍使用原导航断言与时限；此步骤只获取当前同源页面引用的Next静态脚本，按URL去重。

本机真实旅程最多2个worker，CI与fixture单worker。完整本机计划允许真实只读旅程与fixture构建重叠，其余动态任务保持串行；任一失败会取消同批任务并等待退出。

CI 在安装 Chromium 或准备数据库前计算范围，调用同一个 `pnpm check`，并取消同分支已过期的运行。仅完整输入与执行条件一致时复用结果；本地与 CI 分别记录。默认无覆盖率门槛。

`release` 当前只准备 `.medota2/releases/` 下的 Web 产物，并用固定测试数据做启动检查。构建完成钩子在 standalone 复制前移除本地状态、旧构建和测试输出的追踪引用，兼容 Windows 路径；发布复制前再次检查边界，Windows 使用普通文件副本，失败时清理 `app/` 与验收副本。远程部署目标尚未配置。计算引擎、独立部署单元和大型调度按实际需要扩展。详见[开发工作台规范](../specs/development-workbench.md)。

该固定数据检查不继承开发机的`DOTA_MAP_COLLECTION_PATH`或`DOTA_MAP_DATA_PATH`，构建／启动时显式置空；否则未随产物复制的本机地图路径会导致全局版本索引读取失败。此隔离只用于验收fixture，不跳过正式地图校验。

## 空间保留与日志

发布和测试命令结束后自动维护生成产物，默认最多保留1份且7天内的成功发布、3份成功测试和2份失败测试附件；测试完整附件共同预算128 MiB。失败保护7天，`.keep`及保护期可超预算并产生审计告警；确认诊断完成后可在目录创建`.resolved`解除保护期，原始测试结果和日志保留。旧终态记录不再因缺少PID永久保留；共享测试PID已退出且startedAt超过保护期时按中断处理，活动租约、未知记录和未清理数据库继续保护。重复trace经SHA-256核对后保留完整HTML报告中的副本。

```bash
pnpm storage:audit                       # 只读盘点全项目、各目录占用和预算告警
pnpm storage:clean                       # 只预览候选和保留理由
pnpm storage:clean --apply               # 持锁执行可再生产物清理
pnpm storage:clean --scope tests         # 只预览测试附件
pnpm storage:clean --scope releases --apply
```

自定义数量可在忽略文件`.medota2/storage-policy.json`中填写部分配置：

```json
{
  "releases": 1,
  "releaseMaxAgeDays": 7,
  "successfulTests": 3,
  "failedTests": 2,
  "failureGraceDays": 7,
  "testArtifactsMaxBytes": 134217728,
  "syncIdleDays": 7,
  "syncCacheMaxBytes": 402653184,
  "developmentCacheMaxBytes": 1073741824,
  "buildCacheMaxBytes": 536870912,
  "logMaxBytes": 10485760,
  "logArchives": 3
}
```

工作台日志持续轮转，每份最多10 MiB，保留当前日志及3份历史日志；子进程输出统一写入`.medota2/development/server.log`及`.1`至`.3`。首次启动会将原来的大日志按同一容量规则迁入；修改日志配置后运行`pnpm dev:restart`。本机文件计量与清理收据见`.medota2/maintenance/last-storage-cleanup.json`；删除发布包的manifest另存于`maintenance/releases/`，测试目录内`storage-cleanup.json`记录附件去向。

自动清理在CI跳过，设置`MEDOTA2_AUTO_CLEANUP=0`可禁用本机自动附件清理；手动命令仍可使用。构建／测试清理选择受管发布包、符合保留策略的测试附件与超过预算的停用编译缓存；同步清理另持data-sync锁，按[同步手册](../development-data-sync-runbook.md#本地副本清理与恢复)去重压缩旧载荷并回收已成功发布的闲置副本，保留来源、完整repository、候选、地图、身份凭据及数据库备份。历史构建目录的整批清理仍需像本次空间审计一样核对运行引用。详细行为见[工作台Spec](../specs/development-workbench.md)。

工作台每次就绪后及每6小时尝试执行构建、测试附件及同步副本保留策略；已有任务持锁时跳过。每批测试结束、`test:clean`或启动时回收中断租约，还会删除该租约专用的编译目录，保留`.keep`、日志及状态，并在原目录写`retired-build.json`收据。开发编译缓存默认最多1 GiB，等待Web退出后持工作台锁检查并回收超额目录；正式编译缓存默认最多512 MiB，在release锁内回收，仅删除cache；成功release复制及独立启动验收后另行移除重复standalone，保留正式发布app和next-start运行文件，保护`.keep`。预算内日常复用；活动编译期间不删除。

工作台就绪和持续运行期间每6小时尝试只读盘点，24小时最多一次，结果覆盖写入`.medota2/maintenance/storage-audit.json`。目录预算：shared-tests 768 MiB、test-runs及sessions各256 MiB、来源cache 1.5 GiB、data-sync 2 GiB、releases 384 MiB、开发编译1.5 GiB、正式编译768 MiB、output及本机Linux浏览器各512 MiB、node_modules 1 GiB，未登记目录256 MiB。保护期内证据或有用途的历史材料可触发提示，需解释，不自动盲删。预算指文件内容字节，`du`的磁盘分配块数与其不同。

大型历史文本证据可以gzip无损压缩，索引记录原路径、压缩路径及原SHA-256；用gzip解压即可恢复。新增诊断遵守[Agent空间规则](../../AGENTS.md#本机产物与空间预算)，避免重复全量响应和整套CI附件。

## 环境诊断与秘密配置

```sh
pnpm db:environment:doctor
pnpm db:environment:doctor:local
```

非生产数据库凭据由受管stack写入私有receipt；禁止手工复制其他环境的身份文件。旧栈adoption会轮换凭据、调整owner／ACL并终止连接，须按[环境合同ADR](../adr/0005-environment-contract.md)另行明确授权；它不是日常启动步骤。

OpenDota当前只有服务端秘密配置入口，操作见[OpenDota配置](../specs/opendota-secret.md)。Windows文件权限以项目ACL适配为准，不能机械执行Unix chmod步骤。

跨机器获取／发布完整业务状态使用[同步运行手册](../development-data-sync-runbook.md)。`pnpm push`需用户授权，固定候选后验证代码和完整数据、推送main并确认对应CI；`pnpm push --plan`预览，`pnpm push --status`汇总阶段耗时，`pnpm push --resume`只续接CI。依赖过期时脚本停止，协调后显式按锁文件安装；禁止跨工作区共享可写node_modules。`pnpm sync`会拉取代码、安装锁定依赖、保存本地业务变更并应用目标数据，必要时重启工作台。

CI耗时定位：先对比job中的Install dependencies、Install Chromium和browser步骤，再查看check附件`phases.jsonl`与`run.json`。pnpm策略缓存仍由原生校验判断有效性；缓存未命中不是测试回归。`gh workflow run verify.yml -f profile=full`重测完整检查执行器范围；`profile=hero-build`、`items`或`map`核对模块增量成本。手动诊断结果不能替代发布候选证据。
