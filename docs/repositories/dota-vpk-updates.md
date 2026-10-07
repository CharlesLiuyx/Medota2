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
- 审阅基线中没有可直接作为 Hero/Ability 图标入库的 `panorama/images/heroes` 或 `panorama/images/spellicons` 图片二进制；玩法文件里的资源引用和 `AbilityTextureName` 只说明逻辑路径，不等于图片内容已经提交到仓库。
- “已反编译”不代表能无损还原原始源文件。`panorama/` 与 `panorama_stripped/` 的具体取舍没有在本地 README 中形成稳定契约；使用前应以目标文件做 diff 和解析测试。
- 仓库没有本地可见的独立更新/构建入口，应把内容视为上游生成并提交的快照。
- 原始目录可能包含历史活动、废弃内容、测试条目和基础模板。不能仅因某条目存在就判定它在当前正常比赛中可用。
- 审阅基线中的工作树约 624 MiB（不含约 1.5 GiB 的 Git 历史）；这些数字会随上游变化，不要在产品启动时全量扫描。

### 图标资源的四层分工

Hero/Ability 图标需要区分“规范引用、VPK 索引、真实字节、可导入图片”四层：

| 来源                                         | 能提供什么                                                               | 不能替代什么                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| `dota_vpk_updates`                           | Hero/Ability 定义、`AbilityTextureName`、ClientVersion 和逻辑资源引用    | 不保证包含 `.vtex_c` 或解码后图片二进制       |
| `GameTracking-Dota2/game/dota/pak01_dir.txt` | 固定客户端快照中的 VPK path、CRC/size 等索引事实，可用于验证资源是否存在 | 不是 VPK，不能读取或解码图片字节              |
| 用户本地 `game/dota/pak01_dir.vpk`           | 对应客户端安装中的真实 `.vtex_c` 内容                                    | 不是稳定应用 schema，也不能提交进 Medota2     |
| Source 2 Viewer 提取目录                     | 从受限 VPK 路径解码出的 PNG/Web 图片，是资产 importer 的只读输入         | 只是 Git 忽略的中间缓存，不是运行时资产数据库 |

因此，玩法 importer 从锁定的 `dota_vpk_updates` commit 获取实体和资源引用；独立资产流程再用同一 ClientVersion 的 VPK/index 交叉核对，从真实 VPK 提取所需图片并存入 PostgreSQL。来源缺图时仍要保留 requested logical path 和解析状态，再使用明确 Valve alias 或确定性生成 fallback，不能把 index 文本或远程 CDN 当作图片本体。

## Medota2 应如何使用

> 首期专项决策：英雄元数据以本来源为唯一 SSOT。规范字段不能由 `dotaconstants` 覆盖或回填。详见[英雄元数据显示 MVP 功能 Spec](../specs/hero-metadata-mvp.md)。

适合：

- 生成首期规范英雄 ID、属性、角色、可用状态及中英本地化数据。
- 核对固定 snapshot/client version 对应的英雄、技能、物品、单位和游戏规则字段。
- 解析多语言展示文本、补丁文本和客户端 UI 行为。
- 为需要固定客户端快照的玩法事实提供原始依据。
- 为 Hero/Ability 资产 importer 提供规范实体、`AbilityTextureName` 和 ClientVersion；图标二进制另从同版本本地 VPK 提取。

不适合：

- 直接作为产品数据库 schema。
- 提供比赛历史、胜率或玩家行为数据。
- 未经筛选地把完整 VPK 资源复制/打包进 `Medota2`。

建议为 VDF/KV、本地化和 Panorama 分别建立来源适配器，并用 allowlist 选择真正进入产品的数据。解析时保留未知字段报告，以便补丁更新时发现 schema 漂移。

## 许可与溯源

仓库根目录当前没有独立 `LICENSE` 文件，而且内容来自 Dota 2 客户端；其中部分 `gameevents` 文件还带有 Valve 的版权/限制声明。将文本、图片、声音或 UI 资产随产品分发前，应确认 Valve 与上游仓库的许可条件。

接入时至少记录：上游仓库 URL、commit、`steam.inf` 中的版本信息、原始相对路径及反编译产物类型。

## 游戏图鉴展示层补充（2026-10-06）

当前审阅基线不变。展示层可读取同一 source snapshot 已记录 checksum 的 `abilities_schinese.txt` / `abilities_english.txt`，补充数值标签、机制注释、命石名称及说明。只接受完整文件 SHA-256 与当前 Catalog 记录一致的本地文件；路径沿用已有可配置 checkout / worktree 根目录。没有匹配文件时保留数据库已有说明及已知中文标签，不加载其他版本或在线补全。不会复制原始本地化文件进仓库。

核对发现：该基线中 `AbilityValues.AbilityCooldown` / `AbilityCastRange` 覆盖继承的顶层默认值；天赋的 `{s:bonus_*}` 取自相应数值条目的同名天赋 modifier；神杖／魔晶说明使用对应 modifier 生效后的数值。只解析有明确数值语义的加减、乘法或替换；未知条件表达式明确缺失，不执行原始表达式。

游戏性版本新增只读来源 `scripts/change_log.txt` 的 `patch_name` 与 `date`。读取固定 source commit 的 Git 对象，先核对同 commit `steam.inf` 的 SHA-256 与 Catalog 记录，再选择不晚于构建日期的最新补丁。当前基线为 7.41e／6918；这不代表上游当前最新版本。未导入或复制完整 changelog。

## 单位只读模型（2026-10-06）

审阅基线保持上述 commit／客户端版本不变。新增按固定 Git 对象读取 `scripts/npc/npc_units.txt`，搭配同 commit 的 `abilities_schinese.txt` / `abilities_english.txt`；先核对已入库 `steam.inf` checksum。明确解析 `include_keys_from` 递归继承，保留未知原文与文件 checksum。分类仅用于浏览，不把文件中的活动、模板和历史对象视为当前地图生成清单。此补充模型未修改数据库，独立运行仍需要匹配来源；详见 [单位图鉴 Spec](../specs/unit-catalog.md)。

## 地图坐标配置（2026-10-06）

沿用上述固定6918基线，新增只读 `resource/overviews/dota.txt`。pos_x=-9472、pos_y=9472、scale=18.5；scale基于1024逻辑像素，不能按解码图片分辨率直接相乘。此仓库提供材质引用与坐标变换，没有可用地图贴图／地形／导航／实体二进制。`scripts/minimap_starting_positions.txt`是选路UI位置，不能冒充实际建筑、野怪和神符世界坐标。原生地图须另从匹配安装的pak01_dir.vpk和maps/dota.vpk提取；当前真实提取仍阻塞于缺少输入。详见[地图 Spec](../specs/map-explorer.md)。

## 7.41f 固定来源审阅（2026-10-07）

新增核验提交 `f4c45719314754567cb4ef4fe343bbc790a311f4`，ClientVersion 6944，steam.inf 日期 2026-10-05；固定 changelog 最新补丁声明为7.41f。新版 npc_heroes.txt 使用 #base 引用129个英雄文件（含 base／target_dummy）；各英雄文件的 DOTAHeroes 对象嵌套 AbilityDefinitions。旧6918仍保留，适配器分别处理两个来源结构。当前所选 KV 范围首发7.41f到6944的数值未变，不能据此推断引擎代码无变化。完整证据及已收录版本见 [更新报告](../work/7.41f-update.md)。
