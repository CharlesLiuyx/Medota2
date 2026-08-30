# dota_vpk_updates

## 职责

调研对象是 [`spirit-bear-productions/dota_vpk_updates`](https://github.com/spirit-bear-productions/dota_vpk_updates)。其 README 将项目定义为 Dota 2 `pak01_dir.vpk` 内部内容的跟踪仓库，并在可行时进行反编译；它用于补充 GameTracking 不再覆盖的该 VPK。

> 审阅基线：2026-08-30，commit `991daaf6fc24b08445209d9ce8767e145bab107e`，Client/Server Version `6918`。上游当前内容可能已经变化。

这是最接近 Valve VPK 原始定义的一层，适合核对玩法与客户端资源事实，但不是稳定、干净的应用 API。

## 目录结构

```text
dota_vpk_updates/
├── scripts/
│   ├── npc/               # 英雄、技能、物品、单位、ID 等核心 VDF/KV 数据
│   │   └── heroes/        # 每个英雄拆分的能力/属性定义
│   ├── items/             # 经济物品/饰品 schema；items_game.txt 体量很大
│   ├── battlepass/        # 活动与战斗通行证数据
│   ├── compendiums/       # 历届赛事/指南内容
│   ├── chat_wheels/       # 聊天轮盘
│   ├── quests/            # 任务数据
│   └── talker/            # 英雄/播音员响应规则
├── resource/
│   ├── localization/      # 多语言技能、Dota、聊天、补丁等文本
│   ├── overviews/         # 地图 overview 资源
│   └── subtitles/         # 字幕资源
├── resource/*.gameevents  # 战斗日志等 game event schema
├── panorama/
│   ├── layout/            # Panorama XML 布局
│   ├── styles/            # 样式
│   ├── scripts/           # UI 脚本
│   └── images/            # UI 相关图片/资源
├── panorama_stripped/     # 与 Panorama 反编译/剥离形式相关的平行产物
├── camera/ cfg/           # 镜头与配置
├── models/ media/         # 模型/媒体相关条目
├── soundevents/           # 声音事件
├── soundstacks/           # 声音栈
├── expressions/           # 表情/表达式资源
├── teamintros/ tools/     # 队伍入场与工具资源
├── steam.inf              # 当前快照中的客户端版本信息
└── *.txt                  # 匹配模式、token、workshop tag 等根级数据
```

### 核心玩法文件

`scripts/npc/` 是 `Medota2` 最可能使用的部分：

- `npc_heroes.txt` 与 `heroes/npc_dota_hero_*.txt`：英雄及分英雄定义。
- `npc_abilities.txt`、`npc_ability_ids.txt`：技能定义和 ID。
- `items.txt`、`neutral_items.txt`：商店与中立物品。
- `npc_units.txt`：单位定义。

`resource/localization/` 则把内部 token 映射成英文、简体中文等多语言展示文本。玩法数据与展示文本通常需要按 token 联结，不能只解析其中一侧。

`resource/game.gameevents` 等文件可辅助理解 `dota_combatlog` 等回放事件；`soundevents/` 主要是事件、文件路径和参数元数据，并不包含声音本体。若产品不做饰品/经济物品分析，应避免解析体量很大的 `scripts/items/items_game.txt`。

## 数据形态与限制

- 文件以 Valve KeyValues/VDF、KV3、XML、CSS、JavaScript 和文本资源为主，字段会随补丁变化。
- “已反编译”不代表能无损还原原始源文件。`panorama/` 与 `panorama_stripped/` 的具体取舍没有在本地 README 中形成稳定契约；使用前应以目标文件做 diff 和解析测试。
- 仓库没有本地可见的独立更新/构建入口，应把内容视为上游生成并提交的快照。
- 原始目录可能包含历史活动、废弃内容、测试条目和基础模板。不能仅因某条目存在就判定它在当前正常比赛中可用。
- 审阅基线中的工作树约 624 MiB（不含约 1.5 GiB 的 Git 历史）；这些数字会随上游变化，不要在产品启动时全量扫描。

## Medota2 应如何使用

> 首期专项决策：英雄元数据以本来源为唯一 SSOT。规范字段不能由 `dotaconstants` 覆盖或回填。详见[英雄元数据显示 MVP 功能 Spec](../specs/hero-metadata-mvp.md)。

适合：

- 生成首期规范英雄 ID、属性、角色、可用状态及中英本地化数据。
- 核对固定 snapshot/client version 对应的英雄、技能、物品、单位和游戏规则字段。
- 解析多语言展示文本、补丁文本和客户端 UI 行为。
- 为需要固定客户端快照的玩法事实提供原始依据。

不适合：

- 直接作为产品数据库 schema。
- 提供比赛历史、胜率或玩家行为数据。
- 未经筛选地把完整 VPK 资源复制/打包进 `Medota2`。

建议为 VDF/KV、本地化和 Panorama 分别建立来源适配器，并用 allowlist 选择真正进入产品的数据。解析时保留未知字段报告，以便补丁更新时发现 schema 漂移。

## 许可与溯源

仓库根目录当前没有独立 `LICENSE` 文件，而且内容来自 Dota 2 客户端；其中部分 `gameevents` 文件还带有 Valve 的版权/限制声明。将文本、图片、声音或 UI 资产随产品分发前，应确认 Valve 与上游仓库的许可条件。

接入时至少记录：上游仓库 URL、commit、`steam.inf` 中的版本信息、原始相对路径及反编译产物类型。
