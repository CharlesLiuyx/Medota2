# 开发数据同步运行手册

当前操作接口更新：2026-10-07。目标数据版本读取 [dev-data.lock.json](../dev-data.lock.json)，平台能力、工具版本和已验证范围统一见[环境登记](development-environments.md)。日常使用 `pnpm push` 和 `pnpm sync` 交接代码与完整业务数据。

## 新环境接入

需要 Node ≥22.12、仓库指定的 pnpm、Git、Git LFS、可用的 Docker Compose。支持 Windows 原生 PowerShell；**WSL2 可选，不是项目的强制依赖**。当前Windows实机使用Docker WSL2后端，项目及命令仍运行于原生Windows；其他Docker后端按机器条件核验。云端需要同机 Docker 与持久磁盘，数据库保持 loopback。无需安装完整游戏，也无需手工复制 `.medota2`。完整平台验收限制见下文及[方案](specs/development-data-sync.md)。

以下是首次接入命令；兼容修复已提交并推送。拉取代码后，在干净 checkout 中执行：

```sh
git pull --ff-only
pnpm install --frozen-lockfile
git lfs version
docker compose version
pnpm data:workspace --name GofurWindowsLenovo --profile local
pnpm data:fetch --repository https://github.com/CharlesLiuyx/Medota2-dev-data.git
pnpm data:apply --plan
pnpm sync
pnpm data:status
```

`--repository` 只需首次提供，也可通过忽略的 `.env` 中 `MEDOTA2_DATA_REPOSITORY` 配置。URL 不含密码／令牌；通过 Git credential manager 或 SSH agent 认证。每个工作区有自己的 UUID、数据库身份和端口；名称可重复关联同一机器。第三个工作区使用自己的名称和 `--profile cloud-vm` 或 `ephemeral`，执行相同步骤。

按命令输出的 origin 打开 `/heroes`、`/abilities`、`/units`、`/map` 与 `/dev/database`。默认端口3000被其他工作区占用时自动选择空闲端口并保存；需要固定端口可在首次 init 时加 `--port 4300`。

核验成功的 `data:status` 返回0并显示 `in-sync`。报告包含代码 commit、代码改动状态、目标快照、业务摘要、当前数据库身份及核验时间。另一机器的代码 commit、目标快照和业务摘要应相同，workspace／数据库身份应不同。尚未发布 lock 返回 `unlocked`；存在代码改动返回 `code-modified`，不能误报一致。

下载器在受管 checkout 内配置 LFS 过滤器且跳过钩子安装，使用 `.git/disabled-hooks` 替代 Windows 上会被当作相对目录的 `/dev/null`，读取固定快照时禁用换行转换；不改全局 Git 配置。Windows已通过数据库恢复、重复应用／再导出、ACL与工作台切换；仍不能只凭下载结果宣称 `in-sync`。本机具体工具与限制见[环境登记](development-environments.md)。

## 常用操作

### Windows 原生使用

项目通过Node直接执行pnpm入口、私有文件ACL检查、instance归属与进程树管理支持原生PowerShell；脚本环境变量由 `pnpm-workspace.yaml` 的 `shellEmulator` 处理。保持本机身份／权限核验，不复制其他机器的receipt。Docker容器后端按环境能力选择；WSL2不是项目终端的强制前提。

浏览器测试需要 `pnpm exec playwright install chromium`。已知平台异常、Node兼容条件和完成范围见[环境登记](development-environments.md)，专项复验见[Windows任务](work/windows-native-validation.md)。运行可用不能代替组合发布验收。

## 命令

候选数据库健康检查使用容器内TCP，避免把官方镜像初始化期间的临时Unix服务误判为可连接的最终数据库。初始化、角色隔离和完整回验完成后才切换工作台。

| 命令                                                    | 实际作用                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm data:workspace --name <名称> --profile local`     | 首次建立工作区身份，重复相同参数不改变身份                                  |
| `pnpm data:fetch`                                       | 获取 lock 指定的 Git commit／LFS 对象并校验，不切换数据库                   |
| `pnpm data:apply --plan`                                | 只读检查已缓存目标；缓存缺失先运行 fetch                                    |
| `pnpm data:apply`                                       | 核验后按组件变化复用数据库或恢复独立候选，切换活动选择                      |
| `pnpm data:apply --prepare-only`                        | 仅创建并核验候选，当前工作台保持原选择                                      |
| `pnpm dev:sync`                                         | 核对冻结依赖、应用锁定快照、启动／重启工作台                                |
| `pnpm data:status`                                      | 重新读取完整业务数据和文件依赖，保存带时间的核验结果                        |
| `pnpm data:export`                                      | 将当前业务状态保存为本机不可变快照，输出内容ID与体积                        |
| `pnpm data:bundle --snapshot <ID>`                      | 准备精确发布目录，包含 manifest、表分块、对象与 LFS 规则                    |
| `pnpm data:lock --commit <完整Git提交> --snapshot <ID>` | 验证已发布数据及 LFS 全部可获取后写代码 lock                                |
| `pnpm data:publish`                                     | 导出当前完整数据，向私有数据仓库发布不可变分支，独立回取校验后更新本地 lock |
| `pnpm push`                                             | 固定候选、验证代码和数据、普通推送main并确认对应CI                          |
| `pnpm sync`                                             | 拉取代码和固定依赖、保存业务改动、应用快照；有变化时重启                    |

离线使用 `data:apply --offline`，前提是数据 commit、全部对象与固定来源已经在缓存中。重复应用同一快照会重新核验并返回 `already-applied`。本地验收可用 `--root <导出目录> --snapshot <ID>`；它不创建远端 lock，也不代表另一机器已能获取。

`data:apply` 遇到未导出的业务改动会停止；先 `data:export` 保存，再选择目标。代码不会将不同快照的数据库记录自动合并。切换期间原有写连接被阻止继续写入或提交，必须重新打开当前选择的数据库；失败时保留旧库与候选，并依据 `.medota2/data-sync/switch.json` 恢复。下次 apply／sync 自动处理未完成切换。不要手工复制身份 receipt 或覆盖 active 文件。

旧栈与失败候选默认保留，磁盘清理由另外的明确操作完成。当前不支持跨 schema 自动转换；schema／迁移摘要不符会停止。升级需另行设计迁移与旧基线恢复流程。

0010活动快照切换至0011代码／快照已有只读兼容检查：先运行`pnpm data:apply --plan`确认无未保存业务改动，再运行`pnpm data:apply`恢复独立候选并启动工作台。旧schema、迁移账本与内容均需核验；旧库保持原样。其他旧schema及0010未导出的业务改动仍需使用匹配旧代码处理，不手工迁移旧活动库或修改active清单。

## 数据查看页与云端访问

`/dev/database` 提供37张业务表的行数／体积、列与主键、每页50条记录、按单列包含文本筛选、长文本／JSON展开和图片预览。API单页最多200条，长字段截到12,000字符。该页没有 SQL 执行器或写入操作。

仅开发工作台开启页面与 API；正式构建返回404。Host 与浏览器 Origin 必须精确匹配本机工作台。云端通过已有认证的 SSH 隧道访问；若本地转发端口不同，可在云端 `.env` 设置 `MEDOTA2_WORKBENCH_BROWSER_ORIGIN=http://localhost:4300` 后重启。不得直接开放公网或将数据库端口公开。

## 发布预览、验证与恢复

```sh
pnpm push --plan       # 本地预览范围与检查计划；远端基线尚未刷新，不提交、不上传
pnpm push --status     # 最近10次发布的阶段、耗时、失败项与CI链接
pnpm push -m "说明"    # 获得发布授权后执行完整流程
pnpm push --resume     # 只回读已保存提交并续接CI确认，不提交、不重跑检查、不上传
```

发布需要GitHub CLI `gh`及已有认证。当前自动CI完成判定对应现有工作流的main推送；其他目标分支会在提交和上传前报错，不能把没有CI运行视作通过。读取和推送远端必须指向同一GitHub仓库。`--plan`使用本地upstream引用，实际发布先fetch并检查祖先关系；远端推进时重新整合和规划，不强推。

候选通过临时Git index计算完整tree，包含新增、修改、删除文件，捕获时不修改原暂存区。提交前核对分支、HEAD、暂存区和候选内容，保留既有Git hooks，并核对实际提交tree；生成的数据lock必须等于刚刚独立回取核验的结果。检查后、数据发布后和代码推送前再次核对候选及本地环境配置。准备时先导出完整快照并核对固定来源依赖，发布时重新导出并要求内容ID等于已验证候选。后续编辑或业务变化不会悄悄并入发布。

`pnpm check --publication --base <基线>`使用同一规划器；选中浏览旅程时，先执行对应fixture路径，再执行真实数据路径。CI本身使用fixture，只执行一次。文档不会触发浏览器或产品测试库；完整数据交接仍需读取业务状态。通过的静态结果按原指纹规则复用；动态检查重新确认状态。生成数据lock后只补其范围检查。

依赖检查默认`verifyDepsBeforeRun: error`，脚本运行不隐式安装。发现依赖过期后，协调共享工作台，再显式`pnpm install --frozen-lockfile`。发布还检查`node_modules`、包链接与虚拟依赖目录（virtualStoreDir）归属。多个工作区可共用包缓存，每个工作区独立安装依赖；禁止把可写node_modules链接到另一个工作区。并行编辑时先用独立工作区准备候选、独立初始化环境和测试身份，按同步手册消费所需数据；不复制其他工作区的receipt。当前入口检测并阻止候选漂移，不自动搬迁工作区或复制未发布数据库。

阶段证据在本机`.medota2/publications/<id>/`，包含plan.json、run.json及检查日志。`--status`区分总历时elapsedMs和各阶段累计executionMs；暂停后续接的等待不计为实际执行耗时。数据层另记录导出、LFS上传、Git引用推送、回取及哈希核验日志。收据为本机证据，不随代码交接。

失败处理：检查失败先修复，再运行push，静态缓存仍可复用；数据已上传而代码未推送时，重跑会核对并复用同一快照。推送返回异常先回读远端，确认已接受后继续；最终提交在推送前写入收据，进程中断后可用resume查证。远端必须仍指向该提交，CI只接受该SHA的verify/push运行且结论为success；取消、跳过、失败或缺失都不算通过。CI失败后修代码需要重新push；只重新运行CI或等待中断时使用resume。

候选分支先跑CI再合入main属于后续仓库策略，尚未启用；现行流程在main推送后确认CI。

## 发布步骤与保留规则

日常交接有两个入口：用户授权发布后运行 `pnpm push`，另一台机器运行 `pnpm sync`。前者固定当前全部未提交内容，保存候选提交（可用 `-m` 指定说明），按远端基线检查；通过后发布完整业务数据、更新并检查lock，普通推送main并等待对应提交的verify工作流。失败可能保留本地候选提交和已上传数据，不自动回滚。后者拉取代码和固定依赖，自动保存未导出的本地业务数据，按组件变化应用lock选择的快照。实际数据库摘要、schema与环境一致时复用当前数据库，只切换地图／来源及快照记录；数据库变化时在独立候选批量恢复。代码或数据变化只重启一次；无变化且工作台已运行时不重启，工作台未运行则启动。原数据库与地图包保留，不合并不同快照的业务记录；代码分叉仍使用正常Git协作流程处理。

所有环境共享数据库记录、图片、地图集合及其默认版本、底图、导航、高度、来源和许可。快照只使用相对路径；工作区UUID、凭据、端口、进程启动和系统路径属于各机器的兼容层。应用快照会记录原本机地图选择，以共享集合替代该旧选择；以后显式配置一个新的不可变集合才表示新的本地数据编辑，页面与导出使用相同选择。无需手工清理旧.env地图路径。

数据使用私有仓库中的不可变快照分支。上传Git/LFS后从单独的远端验证缓存回取内容并核对，本地数据仍一致才更新代码lock；失败保留旧状态和候选。首次验证缓存为空时取回全部对象；后续复用此前远端获取且本次哈希复核通过的对象，只取新增／缺损内容。该缓存的LFS存储与出版缓存分离，不把本机上传材料当作远端回取证据。相同内容复用已有快照。当前自动发布支持私有GitHub仓库，使用Git凭据或GH_TOKEN／GITHUB_TOKEN验证私有性，不打印凭据。没有安装或修改Git hooks；普通git push只推代码，项目统一使用pnpm push交接两部分。原始安装、提取缓存、凭据和数据库卷不上传，发布的是带provenance的已导入业务包。

`pnpm data:publish --full-verification` 从全新独立LFS缓存回取全部内容，用于远端保留策略变化、权限变化或专项审计。普通增量验证不保证每次立刻发现远端删除了仍在本机验证缓存中的旧对象；改变远端保留策略时应执行全量审计。删除本机验证缓存后，下一次发布自动恢复全量回取。

文件获取先按manifest核对工作文件和共享LFS缓存，缓存命中不发起LFS下载；缺失内容经一份临时Git配置合并为一次fetch，最多16路并发，避免Windows命令行长度限制。损坏的不可变对象先移入`.medota2/data-sync/corrupt-cache/`保存，再补取；未跟踪文件、暂存改动或其他受管文件改动仍需保留后处理。各阶段日志使用`[sync]`并显示耗时、缓存命中数、请求数和请求字节；请求数不是网络实际传输计数。

出版过程复用`.medota2/data-sync/export/`、`publication-worktree/`与受管repository的LFS对象，避免每次生成全量bundle和下载旧版全部图片。远端验证缓存位于`verified-remote/`，独立全量审计仍位于`remote-verification/`。这些目录都不包含可跨机器复用的数据库身份或凭据；清理时核对data-sync锁和活动引用。

以下分步命令继续用于需要单独审阅数据的情况：

1. 在具备来源能力的环境完成导入、验证并 `data:export`。`data:bundle --snapshot <ID>` 得到 `.medota2/data-sync/bundles/<ID>`；核对报告和资源范围。
2. 获得针对具体仓库、快照与资源范围的发布批准。私有存储不代替第三方资源许可；凭据、控制表、staging、运行中导入、机器 receipt 和数据库卷都不进入 bundle。
3. 在获准的**私有**数据仓库中加入 bundle 文件，保留已有 snapshots、tables 与 objects；使用 `git lfs install --local` 和 bundle 的 `.gitattributes`，普通提交并非强制推送。首个数据仓库的创建同样属于批准范围。
4. 用新的、完整数据 commit 运行 `data:lock`，确认全部远端对象可取，再检查并提交／推送公开代码仓库中的实现、文档和 lock。公开仓库不加入数据文件。
5. 发布前重新 fetch 目标代码分支，确认它仍等于批准基线。远端已推进则重新核对数据祖先和 schema，不通过强制推送覆盖并发工作。

所有受支持代码版本引用的数据 commit 与 LFS 对象都需要保留。不要自动 force push、清空历史或删除旧对象。`data:export`／`data:bundle`仍只准备本机产物；只有显式 `data:publish`／`push` 执行上述发布动作，没有后台上传、自动合并或远端垃圾清理服务。
