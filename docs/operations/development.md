# 开发与验证运行手册

本页维护实际操作。行为合同见[共享工作台](../specs/development-workbench.md)，平台能力见[环境登记](../development-environments.md)。命令实现由[package.json](../../package.json)及对应脚本定义。

## 启动与配置

前置条件：Node.js 24 LTS（最低 `22.12`）、pnpm 11、Git、Docker。E2E 还需要项目锁定的 Playwright Chromium。

首次启动共享开发工作台：

```bash
pnpm install --frozen-lockfile
cp .env.example .env  # 已有 .env 时保留原文件
pnpm dev
```

打开 [http://127.0.0.1:3000/heroes](http://127.0.0.1:3000/heroes)。该入口默认优先复用已准备的 local-review 真实 Catalog 和资产，启动前检查图片覆盖；已有数据保持原样。没有真实审阅环境时，才使用 development 数据库，空库加载含占位图的小样例，并在开发面板标明。第二个 Session 再运行 `pnpm dev` 会连接同一个后台服务。

保存页面代码后自动热更新。页面右下角“共享开发”显示真实解析器的小样例、运行状态、耗时与错误；连续保存合并重算，旧结果不会覆盖新结果。页面数据与下方计算样例相互独立，计算使用的小 fixture 不替换页面的真实数据。冷启动与首次页面编译会慢一些。开发入口统一使用项目锁定的Turbopack，Tailwind扫描范围为`src/`；文档与测试保存不应引起全站CSS热更新。隐藏标签页暂停开发面板轮询，切回后立即同步。

开发浏览器应使用不注入页面内容的配置。若hydration报错显示`data-immersive-translate-page-theme`等服务端不存在的属性，在沉浸式翻译「基本设置 → 更多进阶设置 → 不使用插件的网址」中添加`http://127.0.0.1:3000/*`并保存，然后完整刷新（其他开发地址按实际origin配置）；也可使用无扩展的独立开发配置。不要用全局`suppressHydrationWarning`掩盖。依赖必须由本目录的`pnpm install --frozen-lockfile`建立，不复制其他工作树的`node_modules`或其链接；否则Turbopack可能无法在项目根内解析Next，临时工作树移除也会破坏开发环境。

`.env` 的 `MEDOTA2_WORKBENCH_DATA` 默认为 `auto`；可显式设为 `local-review` 或 `development`，修改后运行 `pnpm dev:restart`。真实数据模式的资产检查不通过时会报错，不会静默切换为占位图。

```bash
pnpm dev:restart             # 配置、迁移或脚手架变化后重新准备并恢复预览
pnpm dev:stop                # 停止共享 Web 和样例进程，保留数据库
pnpm db:development:stop     # 需要时单独停止开发数据库
pnpm dev:sample              # 在终端执行同一个小样例
```

开发日志位于 `.medota2/development/server.log`。多个 Session 共用目录和当前分支，各自维护 `.medota2/sessions/<id>.md`；提交、分支切换、依赖安装和数据库写操作先协调。详见 [AGENTS.md](../../AGENTS.md)。已有同步工作区的真实来源及地图由活动快照提供。

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
pnpm check --watch           # 相关内容变化后重跑
pnpm test:journeys           # 在共享开发页面执行短流程，不重置开发数据
pnpm test:journeys --fixture # 在可复用测试库核对已知数据与页面
pnpm test:integration --testNamePattern 'enforces canonical'
pnpm test:e2e tests/e2e/heroes.spec.ts --grep 'overview'
pnpm bench --iterations 5   # 真实解析器的小样例耗时与内存
pnpm bench --input <vpk-directory> --iterations 3
pnpm release                # 构建并启动检查 Web 产物，相同输入复用
pnpm test:clean             # 清理本工具持有的可复用测试栈
```

小任务先列全本任务改动文件（含测试和负责规则的文档），规划与执行使用同一组 `--files`；新增依赖加入集合。翻译资源与已登记的展示组件选现有专项，无需启动产品数据库或浏览器。普通英雄卡片只选英雄浏览及共用悬停，版本／语言等流程按各自职责选取。规划器映射维护在 `scripts/development/check-plan.mjs`，新增职责时同步更新映射及边界测试。

`check` 选中的浏览流程自动附带 `--retries=1`：首轮通过的用例保持结果，只重试失败项一次，HTML报告与日志保留flaky。直接执行 `pnpm test:journeys` 时仍默认不重试；可显式传 `--retries=1`。持续失败先看具体断言与trace；修复后重新规划受影响文件，避免无输入变化就反复整组重跑。产品检查通过后若只补文档，使用文档文件范围运行check。纯静态任务可直接运行，不排队等待其他任务的浏览检查；类型增量缓存仍由types锁保护。

`check` 按文件与功能选择少量 E2E、已有针对性单测、静态检查和必要构建。纯文档运行格式与 `pnpm docs:check`，不启动产品数据库或浏览器；普通页面改动不跑全量构建。类型检查使用独立的 `tsconfig.check.json` 和 TypeScript 增量缓存，避免开发服务重新生成 `.next` 类型时相互干扰；框架生成的路由约束由正式构建检查。工具链变化会扩大范围，完整验证仍可显式运行：

```bash
pnpm typecheck
pnpm test
pnpm test:integration:isolated  # 每次全新数据库，适合身份/权限合同检查
pnpm test:e2e:isolated          # 完整 Desktop + Mobile 与视觉回归
pnpm verify                     # 显式全量诊断，包含覆盖率
```

日常固定数据测试复用一套 PostgreSQL，相关写入排队；浏览器状态和报告每次独立。测试 API 固定数据版本，相关代码或数据变化时结果作废。`check` 的证据位于 `.medota2/checks/`，测试报告位于 `.medota2/shared-tests/runs/`；独立验证仍在 `.medota2/test-runs/`。

CI 在安装 Chromium 或准备数据库前计算范围，调用同一个 `pnpm check`，并取消同分支已过期的运行。仅完整输入与执行条件一致时复用结果；本地与 CI 分别记录。默认无覆盖率门槛。

`release` 当前只准备 `.medota2/releases/` 下的 Web 产物，并用固定测试数据做启动检查。构建完成钩子在 standalone 复制前移除本地状态、旧构建和测试输出的追踪引用，兼容 Windows 路径；发布复制前再次检查边界，Windows 使用普通文件副本，失败时清理 `app/` 与验收副本。远程部署目标尚未配置。计算引擎、独立部署单元和大型调度按实际需要扩展。详见[开发工作台规范](../specs/development-workbench.md)。

## 空间保留与日志

发布和测试命令结束后自动维护本机生成产物，默认保留最近2份成功发布包、10份成功测试完整附件。失败附件至少保留7天及最近5份；已有缺少新执行元数据的历史失败保留，标记`.resolved`后才按规则淘汰。各目录内创建`.keep`可固定保留；当前任务、未完成记录及共享测试租约所引用目录保留。测试摘要与日志持续保留，重复trace经SHA-256核对后只保留完整HTML报告中的副本。

```bash
pnpm storage:clean                       # 只预览候选和保留理由
pnpm storage:clean --apply               # 持锁执行可再生产物清理
pnpm storage:clean --scope tests         # 只预览测试附件
pnpm storage:clean --scope releases --apply
```

自定义数量可在忽略文件`.medota2/storage-policy.json`中填写部分配置：

```json
{
  "releases": 2,
  "successfulTests": 10,
  "failedTests": 5,
  "failureGraceDays": 7,
  "logMaxBytes": 10485760,
  "logArchives": 3
}
```

工作台日志持续轮转，每份最多10 MiB，保留当前日志及3份历史日志；子进程输出统一写入`.medota2/development/server.log`及`.1`至`.3`。首次启动会将原来的大日志按同一容量规则迁入；修改日志配置后运行`pnpm dev:restart`。本机文件计量与清理收据见`.medota2/maintenance/last-storage-cleanup.json`；删除发布包的manifest另存于`maintenance/releases/`，测试目录内`storage-cleanup.json`记录附件去向。

自动清理在CI跳过，设置`MEDOTA2_AUTO_CLEANUP=0`可禁用本机自动附件清理；手动命令仍可使用。清理只选择受管发布包与已完成测试的可再生附件，保留来源缓存、数据同步仓库、候选、地图、身份凭据及数据库备份。历史构建目录的整批清理仍需像本次空间审计一样核对运行引用。详细行为见[工作台Spec](../specs/development-workbench.md)。

## 环境诊断与秘密配置

```sh
pnpm db:environment:doctor
pnpm db:environment:doctor:local
```

非生产数据库凭据由受管stack写入私有receipt；禁止手工复制其他环境的身份文件。旧栈adoption会轮换凭据、调整owner／ACL并终止连接，须按[环境合同ADR](../adr/0005-environment-contract.md)另行明确授权；它不是日常启动步骤。

OpenDota当前只有服务端秘密配置入口，操作见[OpenDota配置](../specs/opendota-secret.md)。Windows文件权限以项目ACL适配为准，不能机械执行Unix chmod步骤。

跨机器获取／发布完整业务状态使用[同步运行手册](../development-data-sync-runbook.md)。`pnpm push`需用户授权，固定候选后验证代码和完整数据、推送main并确认对应CI；`pnpm push --plan`预览，`pnpm push --status`汇总阶段耗时，`pnpm push --resume`只续接CI。依赖过期时脚本停止，协调后显式按锁文件安装；禁止跨工作区共享可写node_modules。`pnpm sync`会拉取代码、安装锁定依赖、保存本地业务变更并应用目标数据，必要时重启工作台。
