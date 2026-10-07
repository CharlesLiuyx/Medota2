# Catalog 与资产导入

本页维护首次来源／图片导入操作。刷新、Review和回滚见[更新手册](catalog-refresh.md)，领域合同见[Catalog Spec](../specs/hero-catalog-v2.md)。导入会创建候选，只有完整Release校验通过才可能提升head；先确定目标环境、来源及授权范围。

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

本机真实预览使用 `pnpm data:import:catalog:preview --lock <lock-file> --no-promote --download-missing`，仍保留 Yellow Review。其 importer_version 追加当前代码／依赖指纹，修改实现会形成不同候选。正式导入要求 Medota2 checkout 干净，使 `importer_version` 能准确标识转换代码。分支名和目录时间戳都不能替代 source lock。

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

`--catalog-version <UUID>` 可为指定历史或待审候选准备单位头像；Red／rejected 候选拒绝处理。不指定时使用当前 head。候选图片准备不批准或提升 Catalog，公开入口仍只读取已发布版本。

## 物品图标

```bash
pnpm db:migrate
pnpm data:import:item-assets
# 本机真实预览，默认当前Catalog；历史版本使用 --catalog-version <UUID>
pnpm db:migrate:local
pnpm data:import:item-assets:local
```

从固定Catalog来源读取完整物品身份，再下载Valve Steam static图片；图纸共用原生recipe图标。导入前下载与解码，完整批次才事务写入并提升物品资产head；任一图片缺失或LoD不完整均失败。相同内容重复导入幂等。图片页面路径为 `/valve-assets/item/[key]?v=...&width=64`，运行时只读数据库。CDN构建号未知，不能视作历史客户端原图认证。许可与英雄资产相同；不得因此自动对外发布。

已应用业务快照的工作区新增迁移后，先 `pnpm data:export` 保存完整本机新状态，再用 `pnpm data:apply --root .medota2/data-sync/export --snapshot <ID>` 选择刚导出的同内容快照；核对 `reusedDatabase=true`，然后 `pnpm dev:restart`。这会保存新schema和资源清单，不会发布或改写远端lock；旧代码仍应搭配旧快照。不要手改active记录。

## 完整版本收录

未来版本更新统一收录全部产品实体。Catalog和英雄／技能图片完成后，按上节为候选准备单位图片状态和完整物品图片，并准备同补丁完整地图Collection；缺项候选继续隐藏。`data:promote:catalog`再次核对固定来源、英雄／技能／命石／关系／双语文本、完整单位／物品身份与图片状态、地图和资源校验，再应用原有Review和覆盖率门禁，详见[实体版本合同](../specs/entity-versions.md)。
