# Sloppy 地图来源

公开可选来源：[sikleq/Sloppy](https://github.com/sikleq/Sloppy)，不属于 Medota2。当前审阅固定提交 `38fb8ef1d16c99c141d0630e5227110fd082b364`，仅下载所选补丁所需的6个文件，原始资产保存在忽略目录。

## 已核对的 7.41e

- `data/map/patch_maps.json` 的7.41e条目：地图VPK SHA-1 `f049eadfa145a180f68ebe1f55da4ace8298bdc7`，Steam depot373301／manifest `8405633108885859992`。
- `data/map/mapdata_741e.json` 内嵌source声明与上述补丁、哈希、manifest一致；逐类记录数与counts一致。
- `data/map/renders.json` 将该补丁的 `icons/maps/map_7.41e.webp` 标注为自身SFM渲染，原始4096×4096、4,167,878字节；导入保留原字节，不放大、不重采样。
- `data/terrain_map_meta.json` 是渲染图专用裁剪变换。不能套用原生overview的±9472坐标。
- 来源脚本 `scripts/gen/extract_map_entities.py` 说明实体由Source2Viewer读取VPK，合并非destruction层；营地边界来自trigger volume hull。此说明是来源的提取记录，Medota2未在本机独立重跑VPK提取。

因此版本可信级别为 **source-declared（来源标注）**。本机没有该VPK，未校验其真实SHA-1或Steam manifest归属。客户端构建号缺失，存为null，不能把当前图鉴6918写入地图。7.41、7.41e、7.41f分别识别；不存在自动改用最新补丁或临近版本的回退。

## 适配边界

独立适配器 `src/importers/dota-map/sloppy.ts` 映射为map-v1，记录2585个静态点位与28个营地边界。来源没有Z和队伍字段，保留未知，不按坐标象限猜阵营；label表达塔级、兵营类型、野怪等级。缺失键／不一致计数／版本冲突失败；未知类和属性保留。高度、导航、视野虽然来源存在其他产物，本轮未接入，不在页面宣称已实现。

## 许可

固定快照LICENSE为MIT，保留于本地source目录；界面显示来源链接与署名。其地图包含Valve游戏资源，仓库MIT不能自动解释为Valve资源的再分发授权。本轮仅按用户请求下载至本机、提供本机预览，没有把资产纳入Git或部署；公开发布前须单独审阅游戏资源许可。

## 重现

见 [地图 Spec](../specs/map-explorer.md)。导入固定commit而非master，每个下载文件记录SHA-256；输出独立目录并原子rename，禁止覆盖现有版本。
