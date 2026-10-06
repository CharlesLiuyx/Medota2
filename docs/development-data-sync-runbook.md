# 开发数据同步运行手册

当前实现日期：2026-10-06。首个私有数据快照已发布并经远端重新下载验证，代码 lock 固定数据提交 `dfde0a8bbea1d611ffce530a94fd842f6e293a50`。Mac 与 Windows 原生 PowerShell／Node（Docker WSL2 后端）已完成完整快照恢复和导出回验。其他环境还需配置私有数据仓库的读取权限；云端及全部Windows平台要求尚待验收。

## 新环境接入

需要 Node ≥22.12、仓库指定的 pnpm、Git、Git LFS、可用的 Docker Compose。目标支持 Windows 原生 PowerShell；**WSL2 可选，不是项目的强制依赖**。当前原生兼容适配尚未完成，以下完整流程尚不能标为已支持 Windows；WSL2 也尚未实机验收。Windows 待实施项与验收要求见[方案](specs/development-data-sync.md#windows-原生支持要求待实施)。Docker Desktop 的 Linux 容器后端独立选择，按机器条件使用可用后端，不要求项目进入 WSL2。云端需要同机 Docker 与持久磁盘，数据库保持 loopback。无需安装完整游戏，也无需手工复制 `.medota2`。

以下是现有命令接口；Mac 已验证，Windows本轮使用尚未提交的兼容性修复验证同一同步流程。拉取包含兼容修复的代码后，在干净 checkout 中执行：

```sh
git pull --ff-only
pnpm install --frozen-lockfile
git lfs version
docker compose version
pnpm data:workspace --name GofurWindowsLenovo --profile local
pnpm data:fetch --repository https://github.com/CharlesLiuyx/Medota2-dev-data.git
pnpm data:apply --plan
pnpm dev:sync
pnpm data:status
```

`--repository` 只需首次提供，也可通过忽略的 `.env` 中 `MEDOTA2_DATA_REPOSITORY` 配置。URL 不含密码／令牌；通过 Git credential manager 或 SSH agent 认证。每个工作区有自己的 UUID、数据库身份和端口；名称可重复关联同一机器。第三个工作区使用自己的名称和 `--profile cloud-vm` 或 `ephemeral`，执行相同步骤。

按命令输出的 origin 打开 `/heroes`、`/abilities`、`/units`、`/map` 与 `/dev/database`。默认端口3000被其他工作区占用时自动选择空闲端口并保存；需要固定端口可在首次 init 时加 `--port 4300`。

核验成功的 `data:status` 返回0并显示 `in-sync`。报告包含代码 commit、代码改动状态、目标快照、业务摘要、当前数据库身份及核验时间。另一机器的代码 commit、目标快照和业务摘要应相同，workspace／数据库身份应不同。尚未发布 lock 返回 `unlocked`；存在代码改动返回 `code-modified`，不能误报一致。

2026-10-06，Windows 原生已实际通过工作区初始化、私有 Git/LFS 获取、全部快照文件校验与只读应用计划。下载器在受管 checkout 内配置 LFS 过滤器且跳过钩子安装，使用 `.git/disabled-hooks` 替代 Windows 上会被当作相对目录的 `/dev/null`，读取固定快照时禁用换行转换；不改全局 Git 配置。Docker VMM 与 Windows Hypervisor Platform 已配置，但本机必须重启才可启动容器。数据库恢复、重复应用／再导出、ACL 与工作台切换尚未在 Windows 验收；不能只凭下载结果宣称 `in-sync`。本机具体工具与限制见[环境登记](development-environments.md)。

## 常用操作

### Windows 原生适配进展

2026-10-06 重启后，Docker VMM 的 Linux 引擎已可用，实际拉取了 PostgreSQL 镜像。此后配置文件共享并重启 Docker 时出现残留 AF_UNIX socket 重命名错误，容器启动仍待恢复；不要因此重置数据库虚拟磁盘或删除卷。VMM 需显式共享 checkout 的 `docker` 目录，数据库端口继续只绑定 loopback。

代码现已补充 Windows 原生 pnpm 启动（Node 直接执行 pnpm JS 入口，参数不经 shell）、凭据／身份文件 ACL 校验与私有目录创建、工作台按 instance 匹配的停止指令和子进程树退出。Windows 私有目录只授予当前用户完全控制并关闭继承；读入文件时重新检查所有者、普通文件／重解析点以及 DACL，拒绝其他非系统／管理员主体的访问授权。Unix 保留0600／owner门禁。没有通过跳过权限检查来兼容 Windows。

原生测试已覆盖 ACL 正常读入及额外 Users 授权拒绝、只有 Modify 权限的目录收紧与重复保护、包含空格／中文／shell符号的字面参数传递，以及精确停止本进程树而保留另一个子进程。新终端执行仓库指定的 `pnpm`，工作台重启仍用 `pnpm dev:restart`；脚本内环境变量赋值使用 `pnpm-workspace.yaml` 的 `shellEmulator: true`，测试运行器也复用原生 pnpm 入口。当前没有声明所有Windows平台要求已完成。

同日实际恢复验收：用户选择 Docker WSL2 后端后，引擎与挂载正常；原生 PowerShell／Node 完成独立候选恢复、工作台切换、全量数据／文件依赖检查、重复应用和导出。34表46,238行、4,623对象及84,475,984字节通过核验；业务摘要与lock一致，导出的快照ID相同。`data:status` 的 `code-modified` 表示代码有未提交修复；此时 `problems=[]` 且业务摘要一致，不应误报数据未同步，也不应将其改写成 `in-sync`。VMM 的旧目录和经过SHA-256校验的磁盘副本保留，未重置卷。

Windows验收限制：265项单测与21项隔离数据库合同测试通过，实际开发重启通过。合同测试在Windows为逐次ACL检查提供60秒hook／30秒test时限；仍核验全部身份和权限。浏览器技能列表跳转用例持续超时，release在编译通过后复制standalone产物因symlink权限EPERM失败，完整check尚未通过。需要浏览器测试时先运行 `pnpm exec playwright install chromium`；不要将本机开发可用表述成发布流程已验收。

| 命令                                                    | 实际作用                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm data:workspace --name <名称> --profile local`     | 首次建立工作区身份，重复相同参数不改变身份                                  |
| `pnpm data:fetch`                                       | 获取 lock 指定的 Git commit／LFS 对象并校验，不切换数据库                   |
| `pnpm data:apply --plan`                                | 只读检查已缓存目标；缓存缺失先运行 fetch                                    |
| `pnpm data:apply`                                       | 完整核验，在独立候选恢复，切换并启动工作台                                  |
| `pnpm data:apply --prepare-only`                        | 仅创建并核验候选，当前工作台保持原选择                                      |
| `pnpm dev:sync`                                         | 核对冻结依赖、应用锁定快照、启动／重启工作台                                |
| `pnpm data:status`                                      | 重新读取完整业务数据和文件依赖，保存带时间的核验结果                        |
| `pnpm data:export`                                      | 将当前业务状态保存为本机不可变快照，输出内容ID与体积                        |
| `pnpm data:bundle --snapshot <ID>`                      | 准备精确发布目录，包含 manifest、表分块、对象与 LFS 规则                    |
| `pnpm data:lock --commit <完整Git提交> --snapshot <ID>` | 验证已发布数据及 LFS 全部可获取后写代码 lock                                |
| `pnpm data:publish`                                     | 导出当前完整数据，向私有数据仓库发布不可变分支，独立回取校验后更新本地 lock |
| `pnpm push`                                             | 提交本地代码、发布完整数据、更新lock并一起普通推送当前分支                  |
| `pnpm sync`                                             | 拉取代码、安装固定依赖、备份未导出数据、应用共享快照并重启                  |

离线使用 `data:apply --offline`，前提是数据 commit、全部对象与固定来源已经在缓存中。重复应用同一快照会重新核验并返回 `already-applied`。本地验收可用 `--root <导出目录> --snapshot <ID>`；它不创建远端 lock，也不代表另一机器已能获取。

`data:apply` 遇到未导出的业务改动会停止；先 `data:export` 保存，再选择目标。代码不会将不同快照的数据库记录自动合并。切换期间原有写连接被阻止继续写入或提交，必须重新打开当前选择的数据库；失败时保留旧库与候选，并依据 `.medota2/data-sync/switch.json` 恢复。下次 apply／sync 自动处理未完成切换。不要手工复制身份 receipt 或覆盖 active 文件。

旧栈与失败候选默认保留，磁盘清理由另外的明确操作完成。当前不支持跨 schema 自动转换；schema／迁移摘要不符会停止。升级需另行设计迁移与旧基线恢复流程。

## 数据查看页与云端访问

`/dev/database` 提供34张业务表的行数／体积、列与主键、每页50条记录、按单列包含文本筛选、长文本／JSON展开和图片预览。API单页最多200条，长字段截到12,000字符。该页没有 SQL 执行器或写入操作。

仅开发工作台开启页面与 API；正式构建返回404。Host 与浏览器 Origin 必须精确匹配本机工作台。云端通过已有认证的 SSH 隧道访问；若本地转发端口不同，可在云端 `.env` 设置 `MEDOTA2_WORKBENCH_BROWSER_ORIGIN=http://localhost:4300` 后重启。不得直接开放公网或将数据库端口公开。

## 发布步骤与保留规则

日常只有两个入口：开发完成运行 `pnpm push`，另一台机器运行 `pnpm sync`。前者自动提交本地未提交代码（可用 `-m` 指定说明），发布全部业务数据、更新并提交lock，再普通推送当前代码分支。后者拉取代码和固定依赖，自动保存未导出的本地业务数据，恢复lock选择的快照并重启工作台。原数据库与地图包保留，不合并不同快照的业务记录；代码分叉仍使用正常Git协作流程处理。

所有环境共享数据库记录、图片、地图集合及其默认版本、底图、导航、高度、来源和许可。快照只使用相对路径；工作区UUID、凭据、端口、进程启动和系统路径属于各机器的兼容层。应用快照会记录原本机地图选择，以共享集合替代该旧选择；以后显式配置一个新的不可变集合才表示新的本地数据编辑，页面与导出使用相同选择。无需手工清理旧.env地图路径。

数据使用私有仓库中的不可变快照分支。上传Git/LFS后从独立缓存回取全部内容并核对，本地数据仍一致才更新代码lock；失败保留旧状态和候选。相同内容复用已有快照。当前自动发布支持私有GitHub仓库，使用Git凭据或GH_TOKEN／GITHUB_TOKEN验证私有性，不打印凭据。没有安装或修改Git hooks；普通git push只推代码，项目统一使用pnpm push交接两部分。原始安装、提取缓存、凭据和数据库卷不上传，发布的是带provenance的已导入业务包。

以下分步命令继续用于需要单独审阅数据的情况：

1. 在具备来源能力的环境完成导入、验证并 `data:export`。`data:bundle --snapshot <ID>` 得到 `.medota2/data-sync/bundles/<ID>`；核对报告和资源范围。
2. 获得针对具体仓库、快照与资源范围的发布批准。私有存储不代替第三方资源许可；凭据、控制表、staging、运行中导入、机器 receipt 和数据库卷都不进入 bundle。
3. 在获准的**私有**数据仓库中加入 bundle 文件，保留已有 snapshots、tables 与 objects；使用 `git lfs install --local` 和 bundle 的 `.gitattributes`，普通提交并非强制推送。首个数据仓库的创建同样属于批准范围。
4. 用新的、完整数据 commit 运行 `data:lock`，确认全部远端对象可取，再检查并提交／推送公开代码仓库中的实现、文档和 lock。公开仓库不加入数据文件。
5. 发布前重新 fetch 目标代码分支，确认它仍等于批准基线。远端已推进则重新核对数据祖先和 schema，不通过强制推送覆盖并发工作。

所有受支持代码版本引用的数据 commit 与 LFS 对象都需要保留。不要自动 force push、清空历史或删除旧对象。`data:export`／`data:bundle`仍只准备本机产物；只有显式 `data:publish`／`push` 执行上述发布动作，没有后台上传、自动合并或远端垃圾清理服务。
