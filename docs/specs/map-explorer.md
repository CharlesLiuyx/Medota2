# 地图浏览与 VPK 提取

## 当前实现和缺口

顶栏「地图」进入 `/map`。二维 Canvas 视图支持拖拽、滚轮／双指缩放（1–16倍）、键盘平移、复位、图层、点位搜索与选择、直线测距和选定点范围圈。静态图片与点位在浏览器本地交互，无逐次查询；绘制由 requestAnimationFrame 合并，设备像素比最多2，点位命中用512单位空间分桶，屏外点位跳过绘制，树木在2倍以上绘制，标签在3倍以上显示。图层注册表、来源适配、领域模型和渲染器分开。

**已在本机接入7.41e公开地图**：Sloppy固定提交的4096×4096游戏资源SFM俯视图、2585个静态点位及28个营地生成边界。包含22座塔、12座兵营、28个营地、2475棵树、10个监视者、2个前哨，以及泉水、遗迹、商店、神符、智慧圣坛、莲花池、双生之门、肉山和魔方位置。

版本是独立数据身份：地图页明确显示「7.41e · 来源标注」，折叠详情列出Steam manifest、VPK哈希声明和来源commit，并提示与图鉴补丁的差异。版本索引、实体内嵌声明和渲染索引已交叉核对；尚无原始VPK可独立验证，客户端号存null，不能冒用图鉴6918。此二维静态地图不等价于运行中的游戏模拟；尚未实现导航、碰撞、高度计算、视野、动态单位及昼夜状态。

公开来源有独立适配边界，见 [Sloppy来源审阅](../repositories/sloppy-map.md)。下载后浏览器完全读取本机资产。原生VPK离线链路已通过合成fixture验证，真实VPK提取仍未在本机验证。

## 无游戏安装时导入公开地图

无需安装游戏或新增依赖。仅下载所选补丁所需文件，不执行外部脚本：

```sh
pnpm exec tsx src/workers/import-public-map.ts \
  --commit 38fb8ef1d16c99c141d0630e5227110fd082b364 \
  --patch 7.41e \
  --output .medota2/maps/7.41e-sloppy-38fb8ef
```

输出目录必须不存在。将`.env`的`DOTA_MAP_DATA_PATH`设为该目录，顺序运行`pnpm dev:restart`，打开`http://127.0.0.1:3000/map`。当前本机已完成。数据包括原始source文件、LICENSE、map.json和原字节overview.webp；每个来源文件记录SHA-256。该适配器仅接收来源明确标注为自身SFM且4096px的图，拒绝其他渲染或临近版本代用。来源没有Z／队伍字段，保留未知。营地边界与树木在放大2倍后显示。

## 输入和运行

沿用现有依赖，无数据库迁移。原生地图需同一Dota 2安装内的 `game/dota/pak01_dir.vpk` 及其分卷、`game/dota/maps/dota.vpk`、`steam.inf`，以及已安装的 [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md)。不要只提供VPK目录索引文本。配置文本来源仍使用 `DOTA_VPK_UPDATES_PATH` 或 `DOTA_VPK_WORKTREE_ROOT`；本次不会安装游戏或提取器。

提取到一个尚不存在、位于游戏目录之外的版本化目录：

```sh
pnpm exec tsx src/workers/extract-map-vpk.ts \
  --source /path/to/dota_vpk_updates \
  --commit <full-40-character-source-sha> \
  --vpk /path/to/game/dota/pak01_dir.vpk \
  --map-vpk /path/to/game/dota/maps/dota.vpk \
  --cli /path/to/Source2Viewer-CLI \
  --output /path/to/local-map-extraction
```

必须满足安装内steam.inf字节与指定Git提交一致。提取范围为overview材质／贴图和地图实体lump，保留提取文件SHA-256、VPK目录及地图归档指纹、CLI版本和客户端版本。大包VPK的分卷不逐个哈希；提取产物单独逐文件校验，目录归档哈希不能代表全部分卷哈希。提取前后核对两个指定VPK和steam.inf，失败不发布半成品。

检查当前 `textures/materials/overviews/dota.vmat` 的颜色贴图引用，以及 `entities/` 中实际根实体lump。选择完整原生贴图（至少1024×1024，不上采样）和**已确认使用世界坐标的根实体lump**，再导入：

```sh
pnpm exec tsx src/workers/import-map.ts \
  --input /path/to/local-map-extraction \
  --texture textures/materials/overviews/<referenced-texture>.png \
  --entities entities/maps/dota/entities/<root-entity-lump>.vents \
  --output /path/to/local-map-dataset
```

路径占位符必须替换为真实提取结果。当前识别Source2Viewer `====N====`格式的实体文本，不接受任意JSON、二进制或未经核对的KV3替代。无法识别的新格式会报错，不能绕过解析失败。根据实际提取目录调整根实体路径；不批量合并prefab局部坐标。

在本机 `.env` 添加 `DOTA_MAP_DATA_PATH=/path/to/local-map-dataset`，然后顺序运行 `pnpm dev:restart` 并打开 `http://127.0.0.1:3000/map`。独立运行必须额外挂载该目录。未配置时只读当前Catalog固定Git提交的overview，并核对数据库记录的steam.inf checksum；它只提供坐标配置。地图资产有自己的客户端版本，在页头独立显示，不能默认为与当前英雄资料版本一致。

## 数据和保障

输出 `map.json`、无损 `overview.webp` 和 `extraction.json`；采用新目录内staging后rename，不覆盖已有版本。内部`map-v1`模型记录source_repository、source_commit、source_path、client_version、imported_at、importer_version、schema_version及文件哈希。原始实体未知属性完整保留；未知class归入默认隐藏的“其他实体”并列入coverage。重复字段／ID、非法／越界坐标、旋转overview、缺字段、失配材质、篡改字节直接拒绝。依赖parentname变换或无origin的记录统计为未显示。

实体类型以FGD声明的精确class映射：遗迹、防御塔、兵营、营地、肉山／魔方、神符、商店、前哨、双生之门、莲花池、树木。单位定义不能提供地图位置。公开适配器将`npc_dota_lantern`映射为监视者；`npc_dota_watch_tower`在当前单位本地化中是“前哨”，不能误标为监视者。实体字段参考本地GameTracking-Dota2的dota.fgd（commit `338d5e24d23bfe3b1231154cfff521ca38b79e8f`），真实VPK仍需逐项核对。数组型多行值、prefab实例变换、脚本动态生成及生命周期尚未适配；有这些输入时可能阻塞整个实体lump解析，须取得实际样本后扩展。

图片接口仅开放 `/map/assets/overview.webp?v=<map-json-sha256>`，校验原图哈希和版本，私有不可变缓存／ETag。网页不访问CDN、不启动Git更新／提取器，不向浏览器公开本机目录。地图原图和产物只保存在忽略目录，本轮没有上传或再分发Valve资源。

## 后续达到游戏地图一致性的验收

1. 公开来源声明已接入；提供完整VPK与可用提取器后独立核验版本，验证CLI输出格式、当前材质和根实体lump，运行真实提取和导入。
2. 与同一客户端游戏内俯视图对齐地形、河道、高地、双方遗迹、各级塔、兵营、野区和目标点，记录缺失实体及动态生成来源。
3. 解析terrain／world／prefab层级和navigation数据，分别表达高度、可通行、碰撞、树木阻挡；再按真实规则增加视野分析。静态坐标和范围圈不能代替游戏规则。
4. 用真实完整点位数测量交互帧耗时、加载内存及手机手势；合成数据基准只验证算法和渲染上限。

## 检查

```sh
pnpm exec vitest run tests/unit/map.test.ts tests/unit/map-import.test.ts tests/unit/map-public.test.ts
pnpm check --files src/domain/map/schema.ts src/domain/map/geometry.ts src/importers/dota-map/adapter.ts src/importers/dota-map/files.ts src/server/map/store.ts src/app/map/page.tsx 'src/app/map/assets/[name]/route.ts' src/components/map/map-viewer.tsx src/components/ui/entity-tabs.tsx src/workers/extract-map-vpk.ts src/workers/import-map.ts tests/unit/map.test.ts tests/unit/map-import.test.ts tests/unit/map-public.test.ts
```

检查覆盖已知坐标答案、变换逆映射、光标缩放、跨负坐标分桶命中、未知键、重复／缺失／非法字段、图片一致性、原子导入、拒绝历史贴图、篡改字节与输出覆盖。浏览器实测与最终检查证据见 `docs/current.md`。
