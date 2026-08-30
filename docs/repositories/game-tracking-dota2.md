# GameTracking-Dota2

## 职责

调研对象是 SteamDatabase 的 [`GameTracking-Dota2`](https://github.com/SteamDatabase/GameTracking-Dota2)。它跟踪从 Dota 2 客户端 depot 中筛选、提取或生成的文件，重点是让客户端和引擎变化可以通过 Git diff 被观察。

> 审阅基线：2026-08-30，commit `5a2ffdeb1b6aaa970b658782088117ed684d6234`，Client/Server Version `6918`。上游当前内容可能已经变化。

它适合做协议、客户端行为和 Source 2 结构的参考；不应被视为完整的 VPK 玩法数据库。独立上游 `dota_vpk_updates` 的 README 明确说明，后者用于补上 GameTracking 已不再跟踪的 `pak01_dir.vpk` 内容。

## 目录结构

```text
GameTracking-Dota2/
├── DumpSource2/
│   ├── module_metadata/   # 各 Source 2 模块的 KV3 元数据
│   └── schemas/           # 从客户端模块提取的类型/schema 头文件
├── Protobufs/             # 网络、回放、GC、用户消息等 .proto 定义
├── content/
│   ├── core/              # Source 2 核心创作资源
│   ├── dota/              # Dota 创作侧资源
│   └── dota_addons/       # 示例/官方 addon 内容
├── game/
│   ├── bin/win64/         # 二进制处理后的字符串等产物
│   ├── core/              # 核心运行时配置、资源和工具文件
│   ├── dota/              # Dota 客户端的配置、脚本、资源等非完整 VPK 快照
│   └── dota_addons/       # 随客户端提供的 addon 运行时内容
├── .github/workflows/     # 复用上游 GameTracking 工具链的更新工作流
├── files.json             # 各 depot 被纳入跟踪的文件扩展名/规则
└── update.sh              # 上游 GameTracking 自动处理入口
```

### 关键内容

- `Protobufs/` 包含 `demo.proto`、`dota_gcmessages_*.proto`、`dota_usermessages.proto`、`netmessages.proto` 等，可用于回放与消息解析器的协议参考。
- `DumpSource2/schemas/` 按 `client`、`server`、`networksystem`、`resourcesystem`、`panorama_content` 等模块分组，内容是提取的 C/C++ 风格类型声明。
- `DumpSource2/module_metadata/` 保存 `client.kv3`、`engine2.kv3`、`networksystem.kv3` 等模块元数据。
- `game/dota/` 可见 `cfg/`、`itembuilds/`、`panorama/`、`resource/`、`scripts/` 等，但其覆盖范围由 `files.json` 和上游处理流程决定。
- `game/dota/pak01_dir.txt` 只是 VPK 内文件的路径、CRC、大小等索引，不包含被列出的完整英雄/技能文件；不要把索引误当成玩法常量库。
- `files.json` 是带注释和尾逗号的跟踪选择配置，不是严格 JSON，也不是产品数据 schema。

## 更新方式与限制

`.github/workflows/update.yml` 复用 `steamtracking/gametracking` 的上游工作流。`update.sh` 会调用上级 GameTracking 工具链来 dump Source 2、处理二进制、VPK 和工具资产，再按客户端版本/build ID 创建提交。独立 clone 不包含脚本引用的 `../common.sh` 与完整工具链，因此不能把 `update.sh` 当成可直接运行的本地更新器。

仓库内容主要是上游自动生成的快照。一般只读查询、比较 commit 或由 `Medota2` 的导入器消费，不手工修补生成文件。

## Medota2 应如何使用

适合：

- 生成或校验回放、网络消息、GC 消息相关代码。
- 查询 Source 2 类型、模块、字段或客户端脚本变更。
- 参考 Valve 默认装备方案，或用 `pak01_dir.txt` 检测资源索引变化。
- 在分析结果依赖客户端版本时定位对应协议/结构快照。

不适合：

- 直接提供比赛记录或玩家统计。
- 作为完整的英雄、技能、物品原始定义来源。
- 在产品启动时扫描整个仓库；它包含大量生成文件和庞大的 Git 历史。

审阅基线中的工作树约 247 MiB，而 Git 历史约 6.5 GiB；这些数字会随上游变化。若自动化只需固定快照，应优先考虑 shallow/sparse 的来源策略，而不是复制整个仓库。

## 许可与溯源

仓库根目录当前没有独立 `LICENSE` 文件。将其中的 Valve 文件、反编译结果或资源再分发进产品前，应另行确认上游说明和原始内容许可。仅在本地读取并不自动授予产品分发权。

接入时至少记录：SteamDatabase 仓库 URL、commit、具体相对路径，以及能从 `game/dota/steam.inf` 等文件识别出的客户端版本。
