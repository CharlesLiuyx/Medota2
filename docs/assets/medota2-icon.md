# Medota2 主 Logo：象牙白流线 M

2026-10-08，用户明确选择附件 `Ivory Flowing M Emblem.png` 作为最终 Logo，替换此前候选。图形为象牙白连续流线 M，保留原图的双拱、中央弧线、斜向内切口和炭黑背景。

## 来源与资产

来源为用户提供的1254 × 1254 PNG附件。应用资产直接从附件裁剪外边距并缩放，保留原始轮廓和配色。

- [附件原图](../../public/brand/medota2-flowing-m-source.png)：1254 × 1254 RGB PNG，与用户附件字节一致，随代码保存。
- [顶栏资产](../../public/brand/medota2-flowing-m.png)：512 × 512 PNG，共用顶栏显示20 × 20 CSS px，在28px高顶栏中垂直居中，上下各留4px外边距，保留炭黑背景。
- [网站图标](../../src/app/icon.png)：64 × 64 PNG，通过Next.js文件约定加载。
- 本机验收截图保存在 `output/brand/logo-flowing-m-2026-10-08/`，该忽略目录不作为跨机器交付依赖。

前一轮沙盘候选及导出已保存在本机候选目录；当前页面使用流线M资源。旧王车与更早的历史资产不再被当前页面引用。原图是位图，未重建矢量路径。

## 导出方式

使用项目已有sharp，从附件取左上角 `(137,134)`、尺寸980 × 980的正方形区域，完整包含M并保留外边距；缩小到512px，再由顶栏资产缩小到64px。保留原有背景及抗锯齿，不进行重新生成或颜色替换。

```js
const sharp = require("sharp");
const source = "public/brand/medota2-flowing-m-source.png";
const header = "public/brand/medota2-flowing-m.png";
await sharp(source)
  .extract({ left: 137, top: 134, width: 980, height: 980 })
  .resize(512, 512)
  .png()
  .toFile(header);
await sharp(header).resize(64, 64).png().toFile("src/app/icon.png");
```
