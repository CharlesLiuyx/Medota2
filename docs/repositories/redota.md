# ReDota：可选单位模型截图

审阅基线：`timkurvers/redota@f51e568e6ef45e32e1a7d21def805bdd7604568b`，2026-10-06。

[仓库](https://github.com/timkurvers/redota) 是第三方 Dota 2 回放浏览器。Medota2 仅将 `public/images/portraits/*.jpg` 作为单位头像的可选补充，读取同提交的 `batch.txt` 识别模型对应关系。它不是单位属性或当前补丁的权威来源，不是安装依赖，不复制项目代码或完整快照。

[截图说明](https://github.com/timkurvers/redota/blob/f51e568e6ef45e32e1a7d21def805bdd7604568b/public/images/portraits/README.md) 说明图片由 Dota 2 Model Viewer 根据客户端模型渲染。原始客户端构建号不可确认，因此保存为未知，不标称与当前 Catalog 图片版本完全一致。带特殊材质或相机的 batch 条目不参与通用同模型推断；图片与单位同名或明确变体关系优先。

仓库代码采用 MIT（Copyright © 2020–2023 Tim Kurvers）；Valve 游戏模型及其衍生图片的权利独立存在，MIT 不能自动授予 Valve 资源再分发权。本轮原图只下载到本机数据库用于预览，未加入 Git、未发布外网。公开部署或分发原图前需单独完成权利审查。

适配入口 `src/importers/redota/portraits.ts`，只接受固定 40 位 commit 与安全路径、限定 raw.githubusercontent.com、超时15秒、最大5MiB及像素／JPEG检查；运行时不会代理或回源该站点。图片来源路径、URL、SHA256、commit 和导入时间保存在单位资产记录，原始文件与三级缩略图由现有数据库存储提供。
