# dotaconstants

## 职责

调研对象是 OpenDota 的 [`odota/dotaconstants`](https://github.com/odota/dotaconstants)。这是一个面向 Dota 2 应用的常量数据包：把手工维护的数据和多个远程来源转换成结构化 JSON，并通过 ESM exports 暴露。

> 审阅基线：2026-08-30，commit `e7705ee975ebec2a88a59a7b455d4cae5dc69ca1`，package version `10.8.0`。上游当前内容可能已经变化。

在三个外部仓库中，它最接近 `Medota2` 可以直接使用的应用层数据，但“易用”并不意味着它是 Valve 原始事实的完整镜像。

## 目录结构

```text
dotaconstants/
├── json/                  # 手工维护的源 JSON
├── build/                 # 生成并发布的应用层 JSON
├── tasks/
│   ├── updateconstants.ts # 拉取、解析、联结并生成所有常量
│   ├── newpatch.ts        # 向手工 patch 列表追加版本的辅助脚本
│   └── util.ts            # 清洗与占位符解析等工具
├── test/                  # Node test runner 测试
├── index.js               # 生成的 ESM JSON exports
├── index.ts               # 与 JS 对应的生成入口
├── package.json           # npm 包、命令、版本和依赖
└── LICENSE                # MIT License
```

### 手工数据与生成数据

`json/` 当前包含游戏模式、物品颜色、lobby 类型、命令类型、补丁列表、永久 buff、玩家颜色、skillshot 和等级经验等手工 JSON。

`build/` 当前包含英雄、英雄技能、技能与 ID、物品与 ID、Aghanim 描述、聊天轮盘、地区/国家、补丁/补丁说明等生成结果。`index.js`/`index.ts` 为这些 JSON 生成命名 export。

审阅基线中的 `tasks/updateconstants.ts` 会从远程 `dotabuff/d2vpkr`、Dota 2 datafeed、国家数据仓库等来源取数，再与 `json/` 内容组合。它并不读取 `GameTracking-Dota2` 或 `dota_vpk_updates` 的本地 checkout。

审阅基线中的 `package.json` 版本是 `10.8.0`。部分图片字段只是面向 OpenDota Web 路径的字符串，这个包本身不提供图片资产或 CDN。

## 构建、测试与发布

以当前 `package.json` 为准：

```text
npm run build   # 运行 tasks/updateconstants.ts，访问网络并重写 build/ 与 index.*
npm run patch   # 运行 tasks/newpatch.ts，修改 json/patch.json
npm test        # 运行 node --test
```

本地 README 写的是 `npm run newpatch`，但当前 `package.json` 实际脚本名是 `patch`；自动化时不要照抄这条过时说明。

`npm version` 和 `npm publish` 会改变版本或向外发布，均不属于 `Medota2` 的普通开发流程。除非任务明确要求维护上游包，否则不要在这个 checkout 中运行构建、改版本或发布。

审阅时使用 Node 22 执行 `npm test` 会成功退出但发现 0 个测试，因为仓库的 `.ts` 测试没有配置对应加载方式；这条观察可能随上游改变，不能把当时的结果当成真正的测试通过。构建又直接使用未固定 commit 的 live 远程源并逐个覆盖产物，所以同一 checkout 在不同时间重建未必完全可复现，中途失败也可能留下部分更新。

## Medota2 应如何使用

适合：

- 直接消费 `build/*.json`，或把该 npm 包作为一个有固定版本的依赖。
- 作为 `Medota2` 领域模型导入器的基础输入。
- 参考 `updateconstants.ts` 如何把 VDF、localization token 和 Dota datafeed 联结成应用字段。

不适合：

- 假定所有字段都来自同一游戏 build；它组合了手工数据和多个远程来源。
- 替代 VPK 原始数据进行补丁级取证。
- 提供比赛、玩家或实时状态数据。

如果 `Medota2` 直接使用本地 `build/`，应固定并记录 commit；如果使用 npm 包，应固定包版本和 lockfile。不要在业务逻辑中依赖上游偶然字段，先映射到 `Medota2` 自己的 schema。

还应逐文件确认新鲜度：当前生成脚本中已有被注释掉的数据源，而相应旧文件仍可能留在 `build/` 并继续被入口导出。目录里存在 JSON 不等于它仍由本次构建稳定生成。

## 许可与溯源

仓库代码和包本身使用 MIT License。生成结果仍组合了多个外部来源，因此 `Medota2` 应同时记录 `dotaconstants` 版本/commit，并在需要时追踪 `updateconstants.ts` 中实际使用的上游 URL。
