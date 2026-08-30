# Hero Catalog 更新操作手册

本文是 Hero Catalog v2 的手动刷新、计划调度、Yellow Review、失败恢复与回滚手册。所有入口调用同一个幂等工作流；上游仓库、锁定 worktree 与本地 Valve 资产始终只读。

## 运行合同

`dota_vpk_updates` 是 Heroes 与 Abilities 玩法数据的唯一 SSOT。刷新按以下顺序执行：

```text
remote HEAD discovery
  -> exact commit source lock
  -> detached read-only worktree
  -> file checksum + manifest verification
  -> full catalog candidate
  -> semantic diff
  -> Green auto-promotion | Yellow review | Red reject
```

来源锁写入 `.medota2/locks/`，镜像和 detached worktree 写入 `.medota2/cache/`。两者都是本机运行产物并被 Git 忽略；锁文件记录 selector 版本、匹配文件集合、每个 blob 的 SHA-256、ClientVersion 和 SourceRevision。

## 配置

复制 `.env.example` 为 `.env`，至少配置数据库连接。更新渠道默认值如下，均可覆盖：

```dotenv
DOTA_VPK_REMOTE_URL=https://github.com/spirit-bear-productions/dota_vpk_updates.git
DOTA_VPK_MIRROR_PATH=.medota2/cache/dota-vpk.git
DOTA_VPK_WORKTREE_ROOT=.medota2/cache/worktrees
DOTA_VPK_LOCK_ROOT=.medota2/locks
CATALOG_NOTIFICATION_WEBHOOK_URL=
```

Webhook 可选且必须是 HTTPS。它接收 `no_change`、`succeeded` 或 `failed` 事件；通知失败会使本次自动化返回失败，便于调度器告警。

## 手动刷新

先验证远端发现，再运行完整工作流：

```bash
pnpm data:source:discover:vpk
pnpm data:refresh:catalog
```

需要复现或预审指定 commit 时：

```bash
pnpm data:source:lock:vpk --commit <40-character-sha>
pnpm data:import:catalog --lock <lock-file> --no-promote
pnpm data:diff:catalog --candidate <dataset-version-id>
```

正式导入要求 Medota2 checkout 干净，使 `importer_version` 能唯一标识转换代码。无新远端 commit 时，refresh 直接 no-op，不创建新 dataset。

## Green、Yellow 与 Red

- Green：已知且安全的加法或字段更新，导入事务自动切换 `hero_catalog` head。
- Yellow：候选和机器可读 semantic diff 已保存，当前 head 继续服务。Reviewer 检查来源 commit、selector 变化、删除、ID/关系变化、本地化与资产状态。
- Red：来源锁、解析、身份、引用或数据库完整性失败，不发布候选；当前 head 保持不变。

Yellow Review：

```bash
pnpm data:diff:catalog --candidate <dataset-version-id>
pnpm data:review:catalog --candidate <dataset-version-id> --decision approved --reason "<reason>"
pnpm data:import:assets --catalog-version <dataset-version-id>
pnpm data:promote:catalog --candidate <dataset-version-id>
```

若命令因跨 Catalog 的 exact/native 覆盖率下降而停止，先核对 VPK 提取来源和候选资产；只有确认接受 fallback 降级时，才在实际 promotion 命令追加 `--allow-fallback-downgrade`。此前为候选导入资产时使用过该开关，不会自动授权后续 Catalog head 切换。

拒绝候选：

```bash
pnpm data:review:catalog --candidate <dataset-version-id> --decision rejected --reason "<reason>"
```

不要修改候选表来“修复”上游数据。若 selector 或 mapper 有误，修改转换器并用新的 importer version 重建候选。

## 回滚

回滚只移动当前 head，不删除新版本、diff 或审计信息：

```bash
pnpm data:rollback:catalog --to <compatible-dataset-version-id> --reason "<reason>"
```

数据库函数会验证目标版本存在、schema 兼容且已有完整匹配的 asset head，并在同一事务内记录操作者、from/to version、原因和时间。对尚无图片资产的旧版本，先运行 `pnpm data:import:assets --catalog-version <compatible-dataset-version-id>` 回填并提升资产；否则 rollback 会保持当前 head 并明确失败。

## 计划任务

默认建议每 15 分钟 discover 一次。macOS 示例位于 `ops/launchd/ai.one2x.medota2.catalog-refresh.plist.example`：

1. 将 `__MEDOTA2_ROOT__` 替换为当前仓库绝对路径。
2. 确保调度环境能找到 `pnpm`，必要时把 `/usr/bin/env` 与 `pnpm` 替换为实际可执行文件绝对路径。
3. 创建 `.medota2/logs/`。
4. 把生成的 plist 安装到当前用户的 `~/Library/LaunchAgents/` 并用 `launchctl bootstrap` 启用。

示例不会自动安装，以免未经确认修改用户系统调度。生产环境可用任意调度器调用同一 `pnpm data:refresh:catalog` 命令，但同一数据库上仍只有一个 advisory-lock owner 能执行 promotion。Catalog promotion 在同一事务中固定先取得 Catalog lock、再取得 asset lock，手写运维脚本不得反转顺序。

## 指标与 SLO

每个 `import_run` 记录总耗时、输入字节、Hero/Ability/binding 数量、数据库写入耗时和幂等命中。初始目标：上游 commit 可见后 15 分钟内被发现，Green 在 30 分钟内自动发布；Yellow/Red 在同一窗口生成候选或失败记录及通知。

每次运行至少检查：

- 远端发现、锁定、解析、数据库写入和 gate 各阶段耗时；
- accepted/excluded/warning/blocker 数量及与当前 head 的差异；
- source commit、ClientVersion、SourceRevision、manifest checksum；
- asset exact/alias/generated coverage、缺失实体、LoD 完整率和当前 asset head；
- 当前 head 是否改变，Yellow/Red 时是否仍指向上一有效版本；
- webhook 和调度进程退出码。

## 失败恢复

1. 先读取 `import_runs.stage`、`error`、`validation_report` 与运行日志，确认失败发生在发现、锁定、解析、持久化还是发布。
2. 来源或网络短暂失败：保留 current head，恢复后重跑相同命令。锁文件不可变，可安全复用。
3. checksum/manifest 不匹配：不要绕过校验；删除有问题的本地 cache worktree 后，从相同锁重新准备，或为正确 commit 生成新锁。
4. Yellow：按上节 Review，不当作导入失败。
5. mapper/schema 漂移：修复并测试转换器，迁移数据库后生成新候选。
6. 错误发布：执行原子 rollback；不要删除审计记录。

刷新失败不影响 Web 读取当前版本。只有经 gate 和受约束数据库函数提升的完整 catalog 才会成为 current head。
