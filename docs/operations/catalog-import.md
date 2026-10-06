# Catalog 与资产导入

本页维护首次来源／图片导入操作。刷新、Review和回滚见[更新手册](catalog-refresh.md)，领域合同见[Catalog Spec](../specs/hero-catalog-v2.md)。导入会创建候选并可能提升head；先确定目标环境、来源及授权范围。

## 锁定上游数据

推荐从远端发现并锁定精确 commit：

```bash
pnpm data:source:discover:vpk
pnpm data:source:lock:vpk --commit <40-character-sha>
pnpm data:import:catalog --lock <lock-file>
```

也可以在 `.env` 中把 `DOTA_VPK_UPDATES_PATH` 指向已有的只读 checkout，再运行：

```bash
pnpm data:import:catalog
```

正式导入要求 Medota2 checkout 干净，使 `importer_version` 能准确标识转换代码。分支名和目录时间戳都不能替代 source lock。

## 英雄与技能图标

如果本机有 Dota 2 VPK 和 [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md)，配置只读输入与新的版本化输出目录：

```dotenv
DOTA_VPK_PATH=/absolute/path/to/game/dota/pak01_dir.vpk
SOURCE2VIEWER_CLI_PATH=/absolute/path/to/Source2Viewer-CLI
DOTA_VALVE_ASSET_PATH=.medota2/cache/valve-assets/<client-version>
DOTA_VALVE_ASSET_CLIENT_VERSION=<client-version>
```

```bash
pnpm data:extract:assets:vpk
pnpm data:import:assets
pnpm data:audit:assets
```

本机没有完整 VPK 资产时，可在导入阶段显式下载 Valve Steam static 资源：

```bash
pnpm data:import:assets --download-missing
pnpm data:audit:assets
```

网页运行时不访问 CDN。解析优先级为“VPK 精确资源 → Steam 官方精确资源 → VPK alias → Steam 官方 alias → generated fallback”。普通离线开发允许可审计 fallback；正式资产验收默认要求 `generated_fallbacks = 0`。

提取器不会覆盖已有输出目录，先在同一父目录原子 staging，并通过 manifest 固化 VPK/CLI/ClientVersion 指纹。完整设计与发布门禁见 [ADR 0002](../adr/0002-valve-local-asset-provider.md) 和 [ADR 0004](../adr/0004-database-icon-asset-datasets.md)。

## 单位头像

```bash
pnpm db:migrate
pnpm data:import:unit-assets
# 当前本机真实数据预览；额外从固定 ReDota 提交导入模型截图
pnpm db:migrate:local
pnpm data:import:unit-assets:local --portrait-commit f51e568e6ef45e32e1a7d21def805bdd7604568b
```

默认下载 Valve Steam CDN 单位头像；`--portrait-commit` 启用可选 ReDota 模型截图，必须给出完整 Git commit。`--reuse-portraits` 保留同一 Catalog 和补充来源提交已有的独立／共用头像，只重新处理其余条目；不加此参数会重新下载。下载失败不切换资产 head；所有单位都有独立头像、共用头像、关联技能图标或缺图的明确记录。页面 `/valve-assets/unit/[key]?v=...&width=64` 只读取数据库。图片版本与 Catalog 绑定，但 CDN / 社区截图的游戏构建号未经确认。原始图片保存在本机数据库，不写入仓库；外部发布前仍需审查 Valve 资产许可。详细来源见 [ReDota 审阅](../repositories/redota.md)。
