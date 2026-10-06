# 开发数据同步运行手册

当前实现日期：2026-10-06。本机完整快照已导出并恢复到独立数据库。首个私有数据快照已发布并经远端重新下载验证，代码 lock 固定数据提交 `dfde0a8bbea1d611ffce530a94fd842f6e293a50`。其他环境还需配置私有数据仓库的读取权限。Windows／云端尚待实际验收。

## 新环境接入

需要 Node ≥22.12、仓库指定的 pnpm、Git、Git LFS、可用的 Docker Compose。目标支持 Windows 原生 PowerShell；**WSL2 可选，不是项目的强制依赖**。当前原生兼容适配尚未完成，以下完整流程尚不能标为已支持 Windows；WSL2 也尚未实机验收。Windows 待实施项与验收要求见[方案](specs/development-data-sync.md#windows-原生支持要求待实施)。Docker Desktop 的 Linux 容器后端独立选择，按机器条件使用可用后端，不要求项目进入 WSL2。云端需要同机 Docker 与持久磁盘，数据库保持 loopback。无需安装完整游戏，也无需手工复制 `.medota2`。

以下是现有命令接口；Mac 已验证，Windows 原生需在兼容适配完成后验证同一流程。拉取包含本功能的代码后，在干净 checkout 中执行：

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

## 常用操作

| 命令                                                    | 实际作用                                                  |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `pnpm data:workspace --name <名称> --profile local`     | 首次建立工作区身份，重复相同参数不改变身份                |
| `pnpm data:fetch`                                       | 获取 lock 指定的 Git commit／LFS 对象并校验，不切换数据库 |
| `pnpm data:apply --plan`                                | 只读检查已缓存目标；缓存缺失先运行 fetch                  |
| `pnpm data:apply`                                       | 完整核验，在独立候选恢复，切换并启动工作台                |
| `pnpm data:apply --prepare-only`                        | 仅创建并核验候选，当前工作台保持原选择                    |
| `pnpm dev:sync`                                         | 核对冻结依赖、应用锁定快照、启动／重启工作台              |
| `pnpm data:status`                                      | 重新读取完整业务数据和文件依赖，保存带时间的核验结果      |
| `pnpm data:export`                                      | 将当前业务状态保存为本机不可变快照，输出内容ID与体积      |
| `pnpm data:bundle --snapshot <ID>`                      | 准备精确发布目录，包含 manifest、表分块、对象与 LFS 规则  |
| `pnpm data:lock --commit <完整Git提交> --snapshot <ID>` | 验证已发布数据及 LFS 全部可获取后写代码 lock              |

离线使用 `data:apply --offline`，前提是数据 commit、全部对象与固定来源已经在缓存中。重复应用同一快照会重新核验并返回 `already-applied`。本地验收可用 `--root <导出目录> --snapshot <ID>`；它不创建远端 lock，也不代表另一机器已能获取。

`data:apply` 遇到未导出的业务改动会停止；先 `data:export` 保存，再选择目标。代码不会将不同快照的数据库记录自动合并。切换期间原有写连接被阻止继续写入或提交，必须重新打开当前选择的数据库；失败时保留旧库与候选，并依据 `.medota2/data-sync/switch.json` 恢复。下次 apply／sync 自动处理未完成切换。不要手工复制身份 receipt 或覆盖 active 文件。

旧栈与失败候选默认保留，磁盘清理由另外的明确操作完成。当前不支持跨 schema 自动转换；schema／迁移摘要不符会停止。升级需另行设计迁移与旧基线恢复流程。

## 数据查看页与云端访问

`/dev/database` 提供34张业务表的行数／体积、列与主键、每页50条记录、按单列包含文本筛选、长文本／JSON展开和图片预览。API单页最多200条，长字段截到12,000字符。该页没有 SQL 执行器或写入操作。

仅开发工作台开启页面与 API；正式构建返回404。Host 与浏览器 Origin 必须精确匹配本机工作台。云端通过已有认证的 SSH 隧道访问；若本地转发端口不同，可在云端 `.env` 设置 `MEDOTA2_WORKBENCH_BROWSER_ORIGIN=http://localhost:4300` 后重启。不得直接开放公网或将数据库端口公开。

## 发布步骤与保留规则

1. 在具备来源能力的环境完成导入、验证并 `data:export`。`data:bundle --snapshot <ID>` 得到 `.medota2/data-sync/bundles/<ID>`；核对报告和资源范围。
2. 获得针对具体仓库、快照与资源范围的发布批准。私有存储不代替第三方资源许可；凭据、控制表、staging、运行中导入、机器 receipt 和数据库卷都不进入 bundle。
3. 在获准的**私有**数据仓库中加入 bundle 文件，保留已有 snapshots、tables 与 objects；使用 `git lfs install --local` 和 bundle 的 `.gitattributes`，普通提交并非强制推送。首个数据仓库的创建同样属于批准范围。
4. 用新的、完整数据 commit 运行 `data:lock`，确认全部远端对象可取，再检查并提交／推送公开代码仓库中的实现、文档和 lock。公开仓库不加入数据文件。
5. 发布前重新 fetch 目标代码分支，确认它仍等于批准基线。远端已推进则重新核对数据祖先和 schema，不通过强制推送覆盖并发工作。

所有受支持代码版本引用的数据 commit 与 LFS 对象都需要保留。不要自动 force push、清空历史或删除旧对象。当前 CLI 负责准备与验证，Git 提交／推送由获准操作者执行；没有自动合并或远端垃圾清理服务。
