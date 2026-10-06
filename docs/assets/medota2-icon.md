# Medota2 主 Logo：王车跃迁

2026-10-06，用户从 8 个候选中选择「07 王车跃迁」。图形以象牙白城堡、骑士／兽首和圆形负空间组成，应用于共用顶栏及网站图标。

## 来源与生成

通过 Chrome 插件在 [ChatGPT Images 对话](https://chatgpt.com/c/6ac40f2d-a1b0-83e8-824c-07d16c3116f8) 生成原图，再使用同页的 Remove BG 制作透明版本。网页未显示实际图像模型版本，不能确认 GPT Image 2.5。

- 候选原图：`output/brand/logo-options-2026-10-06/07-rook-knight.png`，1254 × 1254。
- 透明原图：同目录 `07-rook-knight-transparent.png`，1254 × 1254 RGBA。
- 全部候选及来源：同目录 `index.html`、`prompts.md`、`manifest.json`。
- 顶栏资产：`public/brand/medota2-rook-knight.png`，512 × 512 透明 PNG，页面显示 26 × 26 CSS px。
- 网站图标：`src/app/icon.png`，64 × 64 PNG，石墨底色保证浅色与深色浏览器标签页都能辨认象牙白图形；通过 Next.js 文件约定加载。

导出使用 sharp 裁去透明外边距，等比放入 464 × 464 画布，四周各留 24px，得到 512px 正方形。网站图标由该资产缩小并合成 `#0d141b` 背景。保留选定图形的比例与颜色；顶栏使用独立资源名，避免命中旧图标的图片优化缓存。旧的 `medota2-icon.png` 留作历史资产，当前页面不再引用。

## 原始提示词

请直接生成一张高质量品牌 Logo 设计图，使用 GPT Image 2.5（如果界面支持），不要只回复文字。品牌 Medota2：Dota 2 英雄与技能知识库，未来提供游戏数据、比赛分析与策略决策；产品是精致紧凑的深色 UI，Logo 最终会以 26px 使用。请以顶尖品牌设计师的审美完成原创图形：极强辨识度、一个清晰视觉记忆点、精确光学校正与负空间、有游戏文化气质和智性，避免普通 AI/科技公司模板。正方形画布，背景纯深石墨色 #0d141b，中央仅一个图形标识，占画布约 60%，周围充分留白。平面矢量感，轮廓干净，可单色复现；不做 3D、金属浮雕、光晕、摄影样机、细碎装饰或文字，不复制 Dota 官方 Logo。

本张独立设计方向：07 王车跃迁：原创的国际象棋式战略图腾，把城堡与一枚朝前看的简化骑士头部融合，轮廓只保留五六个极有张力的转折，内部一个干净的圆形负空间，既像古代棋子也像现代游戏工具。象牙白单色，稳重、雕塑感平面剪影，没有盾牌外框，不画复杂马鬃。

## Remove BG 指令

Remove the background from this image. Keep all foreground subjects unchanged and fully intact, with clean, smooth edges. Make the background transparent.
