# Hero Catalog v2：英雄、技能、资产与更新管线 Spec

> 状态：已实现并通过 Phase 0–6 验收
>
> 最后更新：2026-08-31
>
> 目标版本：Medota2 Hero Catalog v2
>
> 前置版本：[英雄元数据显示 MVP 功能 Spec](hero-metadata-mvp.md)
>
> 全局列表合同：[全局 List 无限滚动与上 7× / 下 10× 预加载 Spec](infinite-lists.md)

## 1. 文档目的

本文定义 Medota2 从“英雄元数据 MVP”演进到“英雄与技能目录”的产品、数据与工程合同，覆盖：

- 参考 Liquipedia Dota 2 Heroes Portal 的信息架构，建立可复用的 Design System；
- 从唯一规范来源接入完整 Heroes 与 Abilities 数据，并保留可复现 provenance；
- 支持简体中文、英文，并为继续增加语言预留稳定模型；
- 从本地 Valve 客户端资源读取英雄与技能图标，生成多层 LoD 并以独立资产数据集存入 PostgreSQL；
- 建立发现、锁定、导入、差异审查、发布和回滚管线，使游戏更新后可以快速、安全地刷新数据。

本文同时作为实现合同与验收记录。Hero Catalog v2 已落地；本文中与旧 MVP 冲突的 Catalog 合同取代[英雄元数据显示 MVP 功能 Spec](hero-metadata-mvp.md)中的对应范围。

全产品 List 的加载与渲染以[全局 List 无限滚动与上 7× / 下 10× 预加载 Spec](infinite-lists.md)为更高优先级合同；它取代本文涉及分页、页码 URL 或一次性 DOM 全量渲染的旧条款，Hero Catalog 其余领域、来源和版本边界保持不变。

## 2. 已确认决策

本轮 Review 已确认以下决策：

1. 接入全部 Ability 定义。产品默认展示当前英雄直接绑定的内容，历史、遗留、辅助、升级授予及未绑定定义仍可查询和审计。
2. 首期界面支持 `zh-CN` 与 `en`，存储和 API 不写死双语列，为其他 locale 扩展做好准备。
3. 自用场景允许使用 Valve 英雄与技能资产。资产从用户本地 Dota 2 客户端的只读 VPK 内容或其提取缓存获取，二进制与 LoD 存入 PostgreSQL；完整 VPK、提取缓存和批量资产不提交进 Git。
4. 更新发布采用三级门禁：Green 自动发布；Yellow 生成候选版本并等待人工 Review；Red 阻止发布。失败时继续提供上一有效版本。

## 3. 术语与命名

产品、领域和数据库使用 Valve VPK 中的领域语言：

| 概念           | 采用命名                    | 说明                                                                        |
| -------------- | --------------------------- | --------------------------------------------------------------------------- |
| 英雄集合       | `Heroes`                    | 单数领域实体为 `Hero`；数据库表为 `heroes`，不使用 `heros`                  |
| 技能集合       | `Abilities`                 | 单数领域实体为 `Ability`；数据库表为 `abilities`，不使用产品自造的 `skills` |
| 英雄与技能关系 | `HeroAbilityBinding`        | 表达技能槽、天赋、升级授予、Facet 等关系，不把“定义存在”误判为“当前可用”    |
| 目录数据版本   | `HeroCatalogDatasetVersion` | Heroes、Abilities、关系和本地化共享的不可变版本                             |
| 当前版本指针   | `hero_catalog` head         | 所有目录页面在同一个原子快照上查询，避免英雄与技能版本撕裂                  |
| 图标资产版本   | `AssetDatasetVersion`       | 绑定到具体 Catalog、可独立迭代的不可变图片 manifest                         |
| 图标资产指针   | asset dataset head          | 每个 Catalog dataset 当前采用的完整 Hero/Ability 图标集合                   |

“Ability 定义”与“英雄当前技能”不是同一概念。某个定义可以存在于 VPK，但属于基类、隐藏辅助能力、子能力、历史内容或升级授予内容；只有显式关系和状态可以说明其产品语义。

## 4. 目标与非目标

### 4.1 目标

- 用户能按属性快速浏览全部当前英雄，并进入英雄详情。
- 用户能浏览和筛选全部 Ability 定义，并区分当前、间接、历史/未绑定等状态。
- Hero 详情完整展示普通技能、先天技能、天赋、Facet 及 Aghanim 相关关系。
- Ability 详情展示定义、数值、升级条件、归属关系、本地化和来源。
- 每个规范实体都能追溯到固定上游 commit、文件、source key、原始字节 checksum 和转换器版本。
- 每个 Hero 和每个 accepted Ability 都有数据库中的 `original`、`w64`、`w128`、`w256` 图标；原生资源缺失时使用可审计的确定性 fallback，最终显示覆盖率为 100%。
- 上游发布新 commit 后，系统能自动生成候选目录，提供语义差异，并按门禁安全发布。
- UI 组件、颜色、排版、状态和响应式规则形成可复用 Design System，而不是只存在于页面私有样式中。

### 4.2 非目标

- 比赛、玩家、胜率、出装、实时对局和 replay 数据。
- 公开托管或再分发完整 Valve VPK、声音、模型及批量原始资产。
- 依赖 Liquipedia 作为数据源，或复制其商标、图片和页面实现。
- 通过 `dotaconstants` 回填或覆盖 VPK 规范值。
- 保证 Valve 发布客户端更新到第三方跟踪仓库出现 commit 之间的延迟。
- 在 Next.js 请求生命周期中执行导入、Git 更新或 VPK 提取。

## 5. Design System

### 5.1 设计参考与边界

整体信息架构参考 [Liquipedia Dota 2 Heroes Portal](https://liquipedia.net/dota2/Portal%3AHeroes)：按 Strength、Agility、Intelligence、Universal 分组的高密度英雄入口，以及百科式的页面导航和信息扫描体验。

Medota2 只借鉴布局原则和信息层级，不逐像素复制页面、品牌资产或实现。目标是形成适合数据产品的独立视觉语言：深色优先、信息密度高、来源透明、筛选可恢复、桌面和移动端都能完成核心任务。

### 5.2 设计原则

1. **Scan first**：列表首先帮助用户快速定位实体，再提供详情深挖。
2. **Provenance visible**：数据版本、更新时间和异常状态是一级信息，不藏在后台。
3. **Dense but calm**：使用紧凑网格和表格，但通过一致间距、边框和层级降低噪声。
4. **URL is state**：搜索、筛选、排序和视图状态写入 URL，可复制、刷新和返回。
5. **No hover dependency**：重要信息和操作不能只在 hover 时出现；触摸和键盘完整可用。
6. **Semantic styling**：组件消费语义 token，不直接散落十六进制颜色和一次性尺寸。
7. **Locale resilient**：组件允许文本变长、换行和 fallback，不以中英文固定宽度设计。

### 5.3 信息架构

```text
AppShell
├── GlobalHeader
│   ├── ProductIdentity
│   ├── EntityTabs: Heroes | Abilities
│   └── DatasetBadge
├── PageHeader
│   ├── Title / Summary
│   └── PageTabs / Actions
├── FilterBar
└── PageContent
    ├── CatalogGrid / DataTable
    ├── DetailSections
    └── ProvenancePanel
```

首期页面：

- `/heroes`：按四种主属性分组的英雄目录，支持搜索和组合筛选；
- `/heroes/[slug]`：`Overview`、`Abilities`、`Talents & Upgrades`、`Raw`、`Provenance`；
- `/abilities`：按英雄、关系类型、行为、伤害、升级条件和状态筛选；
- `/abilities/[internal-name]`：定义、逐级数值、升级、所属英雄、原始结构和 provenance。

### 5.4 语义 token

初始 token 分为以下层级；具体色值在实现阶段通过组件画廊和视觉回归固定：

| 类别       | Token 示例                                                                                         | 用途                               |
| ---------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Surface    | `--surface-canvas`、`--surface-panel`、`--surface-elevated`、`--surface-hover`                     | 页面、面板、浮层和交互态           |
| Text       | `--text-primary`、`--text-secondary`、`--text-muted`、`--text-inverse`                             | 主信息、辅助信息、弱提示和反色文本 |
| Border     | `--border-subtle`、`--border-default`、`--border-strong`                                           | 结构分隔和聚焦层级                 |
| Accent     | `--accent-primary`、`--accent-hover`、`--focus-ring`                                               | Dota ember 风格主强调与键盘焦点    |
| Attribute  | `--attribute-strength`、`--attribute-agility`、`--attribute-intelligence`、`--attribute-universal` | 英雄主属性语义                     |
| Status     | `--status-success`、`--status-warning`、`--status-danger`、`--status-info`                         | Green、Yellow、Red 和普通状态      |
| Typography | `--font-sans`、`--font-mono`、`--text-*`、`--leading-*`                                            | 正文、标识符、数值和层级           |
| Layout     | `--space-*`、`--radius-*`、`--content-max`、`--control-height-*`                                   | 间距、圆角、内容宽度和控件尺寸     |

默认采用深色主题；token 结构必须允许后续增加浅色主题。正文使用 sans-serif，内部名称、ID、checksum、版本号和表格数值使用 monospace 或 tabular numerals。

### 5.5 可复用组件

- `AppShell`、`GlobalHeader`、`EntityTabs`、`PageTabs`；
- `DatasetBadge`、`StatusBadge`、`AttributeBadge`、`RelationBadge`；
- `FilterBar`、`SearchInput`、`FilterGroup`、`ActiveFilterList`；
- `HeroTile`、`AbilityCard`、`CatalogSection`；
- `DataTable`、`StatCell`、`KeyValueList`、`LevelValues`；
- `EntityHeader`、`DetailSection`、`ProvenancePanel`、`RawDefinitionViewer`；
- `EmptyState`、`FailureBanner`、`LoadingSkeleton`、`AssetFallback`。

组件必须有明确的默认、hover、focus-visible、selected、disabled、loading、empty 和 error 状态。实现时提供开发用组件画廊，并以 Playwright 覆盖桌面、移动端、键盘导航和主要视觉状态。

### 5.6 响应式与无障碍

- 移动端保持实体搜索、主属性分组和详情导航可用，不依赖横向大表完成核心任务。
- 宽表格在小屏幕转换为分组 key-value 或受控横向滚动，并保留行/列语义。
- 所有交互控件有可见 `focus-visible`，点击区域不小于实现阶段规定的触摸目标。
- 属性和状态不只依赖颜色表达；同时提供文本、图标或形状。
- 图片必须有与上下文匹配的 `alt`；纯装饰图使用空 `alt`。
- 页面标题、区域标题、表格表头、tab 和错误提示使用正确语义及 ARIA 关系。

## 6. 规范数据来源

### 6.1 唯一 SSOT

Heroes 和 Abilities 的规范玩法数据统一来自固定 commit 的 `dota_vpk_updates` checkout。运行时必须记录实际读取的 Git commit 和原始文件字节，不把分支名、“最新”或文件修改时间当作版本身份。

核心来源：

| 路径                                           | 内容                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `scripts/npc/npc_heroes.txt`                   | `DOTAHeroes`、Hero 字段、`AbilityN` 绑定、天赋、Facet 和 draft 关系 |
| `scripts/npc/npc_abilities.txt`                | 全局 `DOTAAbilities`、`ability_base` 及共享定义                     |
| `scripts/npc/heroes/npc_dota_hero_*.txt`       | 分英雄 `DOTAAbilities` 完整定义；按 Git tree 动态发现               |
| `scripts/npc/npc_ability_ids.txt`              | Ability internal name 到数值 ID 的映射                              |
| `resource/localization/abilities_<locale>.txt` | Hero 与 Ability 名称、描述和相关本地化 token                        |
| `resource/localization/dota_<locale>.txt`      | Hero hype 等文本                                                    |
| `resource/localization/hero_lore_<locale>.txt` | Hero lore 文本                                                      |
| `steam.inf`                                    | ClientVersion、SourceRevision 和版本信息                            |

`npc_dota_hero_*.txt` 不能维护固定文件清单。导入器必须从锁定 commit 的 Git tree 按版本化 selector 发现文件，这样新增英雄文件会自动进入候选快照。selector 的匹配集合自身参与 manifest 和差异审查。

### 6.2 辅助来源边界

- `dotaconstants` 继续作为隔离的 QA/reference 来源，可用于覆盖率和差异提示，不参与规范值、fallback 或发布阻断。
- `GameTracking-Dota2` 只用于 ClientVersion、协议或非 VPK 事实的交叉核对，不作为 Hero/Ability 玩法 SSOT。
- Liquipedia 只作为 UI 设计参考，不作为 Hero/Ability 数据来源。
- Valve 本地客户端只作为资产二进制来源；`dota_vpk_updates` 提供资源引用但不提供完整图标字节，玩法字段仍以锁定 commit 为准。

### 6.3 调研基线

以下数字只描述 Spec 编写时审阅的本地快照，不得写成业务常量或验收固定值：

| 项目                           | 审阅值                                     |
| ------------------------------ | ------------------------------------------ |
| `dota_vpk_updates` commit      | `991daaf6fc24b08445209d9ce8767e145bab107e` |
| ClientVersion / SourceRevision | `6918` / `10949923`                        |
| 正式 enabled Heroes            | 127                                        |
| 分英雄文件                     | 128，包含 target dummy                     |
| 唯一 `DOTAAbilities` 定义      | 1,953                                      |
| Ability ID 映射                | 3,160 行、3,159 个唯一名称                 |
| Hero 非天赋 `AbilityN` 关系    | 876，其中 80 个为 `generic_hidden`         |
| 天赋绑定                       | 1,016，即每个正式 Hero 8 个                |
| `Innate = 1` 定义              | 186，其中 126 个在当前 Hero 关系中绑定     |
| Facet 定义                     | 339；该快照均标记 Deprecated               |

基线已经证明：定义数量、当前绑定数量和 ID 映射数量不是同一个集合，不能互相替代。

## 7. Ability 数据合同

### 7.1 “全部 Ability”定义

“全部”指锁定快照的全局和分英雄 `DOTAAbilities` 中所有可解析定义，包括：

- 当前普通技能和终极技能；
- innate Abilities；
- `special_bonus_*` talents；
- Scepter、Shard、Facet 或其他升级相关定义；
- sub-ability、helper、hidden 和由其他能力链接的定义；
- 已定义但没有当前 Hero slot 的记录；
- legacy/deprecated 定义；
- `ability_base` 等需要显式识别的模板定义。

任何读取到的顶层定义都必须满足二者之一：

1. 被接受并持久化；
2. 被排除并记录稳定、可测试的原因。

不允许因为字段未知、没有 Hero 绑定或 UI 暂时不用而静默丢弃定义。

### 7.2 身份规则

- Ability 的规范身份是 `(dataset_version_id, internal_name)`。
- `npc_ability_ids.txt` 的数值 ID 可空且不唯一，不能作为 Ability 主键。
- ID 映射独立保存，允许一个数值 ID 映射多个 internal name，并产生可见的 identity warning。
- Hero 的版本内身份继续以 `(dataset_version_id, hero_id)` 为主，internal name 和 slug 保持版本内唯一。

调研快照中数值 ID `323` 已映射到两个不同名称；任何数据库唯一约束或 mapper 都不得假定 Ability ID 唯一。

### 7.3 解析与继承

- KeyValues 来源层必须保留 key 顺序、重复 key、标量/对象形态和来源位置；不能先转成普通 JavaScript object 后丢失重复项。
- 原始层以 ordered AST 或等价的无损节点序列保存；产品查询层再生成稳定 typed projection。
- `ability_base` 和其他 `BaseClass` 继承必须使用版本化、可测试的解析合同，不做无边界通用 deep merge。
- 继承循环、缺失 base、同层关键字段重复或无法解释的形态属于候选版本问题。
- 所有未知字段进入 schema-drift 报告；原始层仍须保留其值。

### 7.4 Typed projection 与原始定义

`abilities` 保存适合筛选和展示的稳定核心列，例如：

- internal name、数值 ID 映射、定义来源和基类；
- `AbilityType`、`AbilityBehavior`、目标 team/type/flags；
- damage type、spell immunity/dispel 相关属性；
- cast range、cast point、channel time、cooldown、mana cost；
- innate、ultimate、hidden、passive 及升级相关标志；
- 资源名、链接和产品派生状态。

`AbilityValues` 可能是标量、逐级数组或嵌套对象，并可能带有 `special_bonus_*`、Scepter、Shard、Facet、hero level 等动态修饰。数据层必须同时保存：

- value key、来源层级、原始字符串/节点；
- 可解释时的类型与逐级规范值；
- modifier/condition 的结构化表示；
- 未识别形态及其来源位置。

Typed projection 不能宣称覆盖全部原始语义；完整性由无损来源记录保证，常用查询由 typed projection 保证。

### 7.5 Hero 与 Ability 关系

`hero_ability_bindings` 至少表达：

- `hero_id` 与 `ability_internal_name`；
- `source_slot`，保留原始 `AbilityN`；
- `relation_kind`；
- `ordinal`；
- `is_current`；
- `source_path`、source key/位置和派生规则版本。

初始 `relation_kind`：

| 值                      | 含义                                         |
| ----------------------- | -------------------------------------------- |
| `loadout`               | Hero 当前普通技能槽直接绑定                  |
| `talent`                | `special_bonus_*` talent 关系                |
| `draft`                 | Ability Draft 等显式关系                     |
| `facet`                 | Facet 直接关联                               |
| `declared_in_hero_file` | 定义声明在某 Hero 文件中，但不等同当前技能槽 |
| `linked`                | 由另一个 Ability 显式链接                    |
| `sub_ability`           | 子能力或配套切换能力                         |
| `upgrade_granted`       | Scepter、Shard 或其他升级授予                |

Talent 不能只按 slot 区间或 `AbilityTalentStart` 推断。调研快照中 Rubick 的 `Ability20..22` 与 Ringmaster 的 `Ability18..22` 含非 talent 内容；初始规则以 `special_bonus_*` internal name、定义语义和显式来源关系共同判断，并始终保留原始 slot。

### 7.6 产品状态

Ability 页面默认展示 `current`，但允许筛选：

- `current`：当前 Hero loadout、talent、innate 或有效 Facet/升级关系可达；
- `indirect`：通过 linked、sub-ability、upgrade 等间接关系可达；
- `defined_unbound`：有定义但当前关系图不可达；
- `template`：显式 base/template 定义；
- `deprecated`：来源显式标记废弃。

这些状态必须由版本化规则派生，并保留推导依据；不能仅凭文件名或定义存在与否猜测。

## 8. 本地化合同

### 8.1 Locale-neutral 模型

本地化采用行模型，不增加 `name_en`、`name_zh_cn` 一类固定语言列：

```text
entity_localizations
├── dataset_version_id
├── entity_type: hero | ability | facet
├── entity_key
├── locale
├── field: name | description | lore | hype | scepter_description | ...
├── value
├── source_path
└── source_token
```

实际实现可按实体拆表以强化外键，但 API 和领域语义保持 locale-neutral。

### 8.2 首期 locale 与 fallback

- 首期导入并展示 `zh-CN` 和 `en`。
- API 显式接收 locale，并返回实际命中的 locale。
- 默认 fallback 链为请求 locale → `en` → 明确缺失占位。
- 缺少翻译不能由 `dotaconstants` 或机器翻译静默回填。
- 名称等阻断级字段的覆盖要求按实体状态定义；历史/辅助定义可以 warning 形式保留未翻译状态。
- 新增语言只需要增加 locale 配置、输入 selector 和覆盖率门禁，不修改 Hero/Ability 核心表。

## 9. Valve 资产合同

### 9.1 来源、提取与解析

Hero icon 和 Ability icon 的规范资源引用来自当前 Hero Catalog，图片二进制来自用户本地 Dota 2 `pak01_dir.vpk`。`dota_vpk_updates` 不保证提交这些图片字节，`GameTracking-Dota2/game/dota/pak01_dir.txt` 也只是文件索引；二者不能替代真实 VPK。

Source 2 Viewer CLI 只读处理显式配置的 VPK，限定提取 `panorama/images/heroes`、`panorama/images/spellicons` 和所需 Innate icon 路径中的 `vtex_c`。提取目录是 Git 忽略的本地中间产物；运行时不直接读取 VPK。

导入器针对当前 Catalog 的每个实体按以下顺序解析：

1. 精确 Valve 路径：Hero 使用 `heroes/icons/{internal_name}`，Ability 使用已经应用 `AbilityTextureName` override 的 `spellicons/{texture_name}`；
2. 版本化 Valve alias：Hero default、Talent `attribute_bonus`、Innate icon 和 Ability `empty` 等显式通用资源；
3. 以 `(entity_type, entity_key)` 为输入生成确定性、实体专属 fallback。

alias 和 generated fallback 都是正式入库的图片对象，不是请求 404 后才出现的浏览器占位。系统分别报告 native Valve coverage 和 display coverage，保留 `exact`、`alias`、`generated_fallback` 以及 mismatch/error 状态。

### 9.2 数据库存储与 LoD

- 图片实际字节存入 PostgreSQL `asset_blobs`，按内容 SHA-256 去重，并记录 MIME、宽高和字节数。
- `asset_objects` 保存逻辑路径、来源类型、ClientVersion、provider version 和原始 blob；`entity_asset_bindings` 保存实体在某个 asset dataset 中采用的对象。
- 每个对象必须有 `original`、`w64`、`w128`、`w256` 四个 `asset_variants`。`original` 保留解析后源图编码与尺寸；其余使用版本化 Sharp/WebP recipe，禁止放大较小源图但仍保留对应 LoD key 和实际尺寸。
- HTTP 资产路由只从当前 asset head 读取数据库字节，根据请求宽度选择最小的足够 rendition，并以内容 SHA-256 提供 ETag；机器绝对路径不进入 URL、领域模型或响应。
- VPK、提取目录、转换缓存、数据库 dump 与批量图片不提交到 Git。

### 9.3 版本、完整性与降级

资产使用独立的不可变 `asset_dataset_versions` 和 `asset_dataset_heads`，不参与 Hero Catalog 的玩法幂等身份。每个 asset dataset 绑定到一个具体 Catalog dataset；来源图片、manifest、provider 或 LoD policy 变化可以创建并提升新资产版本，而不重建玩法 Catalog。

提升 asset head 前必须验证：目标 Catalog 的全部 Hero 和全部 accepted Ability 各有一个 icon binding，且每个 binding 都有四个可显示 LoD。该门禁包括 `current`、`indirect`、`defined_unbound`、`template` 和 `deprecated` Ability，并校验精确实体键集合、binding/object 来源一致性与 blob 内容 SHA-256。原生资源缺失不会降低 display coverage，因为 importer 会生成 fallback；只有最终图片或任一 LoD 无法生成、校验或持久化时，整个资产事务才失败。已有 asset head 的原生覆盖下降时默认拒绝 promotion，必须显式批准 fallback downgrade。切换到不同 Catalog 时以 `exact / total` 和 `(exact + alias) / total` 的比例比较当前与目标资产 head，避免新增 fallback 实体绕过绝对数量检查，也避免删除实体造成误报；override 必须在实际 Catalog promotion 调用中再次显式提供。

Hero Catalog promotion/rollback 必须先确认目标 Catalog 已有匹配且完整的 asset head；候选和历史 Catalog 可以通过 `data:import:assets --catalog-version <uuid>` 预先回填。Catalog 与 asset 发布各有 advisory lock；Catalog 导入和 promotion 必须固定先取得 Catalog lock、再取得 asset lock，使完整性与跨 Catalog 覆盖率比较不会和独立资产更新竞争同一 head。

页面在资产导入失败时仍保留玩法文本和数据；完成一次资产导入后的正常验收要求数据库显示覆盖率为 100%，不能把 CSS/HTTP 临时占位计入覆盖。完整决策见 [ADR 0004](../adr/0004-database-icon-asset-datasets.md)。

数据库中的 Valve 字节仅限当前批准的本地私有使用。公开发布、共享部署、数据库备份分发或向第三方提供资产接口前，必须重新进行 Valve 内容与商标审查；使用 MIT 许可的 Source 2 Viewer 不改变其输出中 Valve 内容的权利归属。

## 10. 数据模型

### 10.1 共享版本边界

v2 使用一个 Hero Catalog dataset version 覆盖 Heroes、Abilities、关系、Facet 和本地化。所有规范外键都带 `dataset_version_id`，所有产品查询从 `dataset_heads('hero_catalog')` 读取。

不能分别提升 heroes head 和 abilities head；否则 Hero 页面可能指向一个版本，而 Ability 关系指向另一个版本。

### 10.2 目标表职责

| 表                              | 职责                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `hero_catalog_dataset_versions` | 共享不可变目录版本、来源快照、转换/schema 版本和校验状态                  |
| `dataset_heads`                 | `hero_catalog` 当前版本指针                                               |
| `heroes`、`hero_roles`          | 继承 MVP 的 Hero 规范字段和角色                                           |
| `abilities`                     | Ability 版本内身份、稳定 typed projection 和派生状态                      |
| `ability_id_mappings`           | internal name 与可空、非唯一数值 ID 的来源映射                            |
| `hero_ability_bindings`         | Hero/Ability 多种关系、slot、顺序和当前状态                               |
| `ability_values`                | 标量、逐级和带 condition 的值节点                                         |
| `facets`                        | Facet 定义、状态和稳定字段                                                |
| `facet_ability_bindings`        | Facet 与 Ability 的显式关系                                               |
| `hero_localizations`            | Hero locale-neutral 文本及 token provenance                               |
| `ability_localizations`         | Ability locale-neutral 文本及 token provenance                            |
| `facet_localizations`           | Facet locale-neutral 文本及 token provenance                              |
| `entity_source_records`         | source path/key/位置、ordered AST、原始/规范 checksum、继承诊断和未知字段 |
| `asset_refs`                    | 仅为兼容旧 schema 保留且不再写入；历史行不能作为来源状态依据              |
| `asset_blobs`                   | 内容寻址的图片 `bytea`、MIME、实际宽高和字节数                            |
| `asset_objects`                 | 可复用图标对象、原始 blob、逻辑路径、来源类型和 provider provenance       |
| `asset_variants`                | 对象的 `original`、`w64`、`w128`、`w256` rendition 与转换 recipe          |
| `asset_dataset_versions`        | 绑定 Catalog 的不可变资产 manifest、版本化策略和覆盖计数                  |
| `entity_asset_bindings`         | asset dataset 内 Hero/Ability 到图标对象的绑定及解析状态                  |
| `asset_dataset_heads`           | 每个 Catalog dataset 当前采用的 asset dataset 指针                        |
| `catalog_semantic_diffs`        | 候选版本相对当前版本的实体/字段/关系差异                                  |

实现 migration 前必须先让 Drizzle TypeScript schema 与现有 SQL migration 中的实际表、约束和权限一致，再扩展 v2；不能在两个 schema 表达继续漂移的基础上增加目录表。

### 10.3 版本与幂等

- 来源快照身份继续使用 repository、commit 和按路径排序的原始文件 manifest checksum。
- Catalog 幂等键至少包含 `source_snapshot_id + importer_version + target_schema_version + selector_version`。
- Asset dataset 以 Catalog version、资产 manifest、provider version 和 LoD policy version 建立独立幂等身份；ClientVersion 作为来源信息记录并反映在对象/manifest 身份中，不影响玩法 dataset 身份。
- 同一幂等键重复运行返回既有候选/成功版本，不复制记录。
- Catalog 与 asset 的旧成功版本默认保留；回滚或图片迭代只移动各自的 head，不重写或删除数据。

## 11. 更新管线

### 11.1 更新边界

系统保证的是：`dota_vpk_updates` 上游发布可用 commit 后，Medota2 能快速发现并刷新。它不能保证 Valve 客户端更新到第三方仓库提交之间的时延。

如果未来需要直接跟随 Valve depot，必须另写 ADR，引入 Steam depot/VPK 获取、账号权限、下载体积、提取器版本和合规边界；不能悄悄改变当前 SSOT 合同。

### 11.2 工作流

```text
Discover remote commit
        │
        ▼
Lock exact commit + detached read-only worktree
        │
        ▼
Build dynamic source manifest + verify Git blobs/checksums
        │
        ▼
Parse ordered KV AST + resolve inheritance/localization/relations
        │
        ▼
Validate completeness + write run-scoped staging
        │
        ▼
Build immutable candidate catalog
        │
        ▼
Raw diff + source-schema diff + semantic diff
        │
        ├── Green ──> atomic auto-promotion
        ├── Yellow ─> wait for human Review
        └── Red ────> reject; keep current head
```

刷新进程使用专用 mirror/cache 和 exact-commit detached worktree，不对用户正在使用的相邻 checkout 执行 `pull`、`checkout`、`reset` 或上游脚本。所有上游目录保持只读。

### 11.3 全量重建策略

Hero/Ability 基类、共享定义和本地化会产生扇出变化，因此每个新 commit 默认全量重建 Hero Catalog。当前相关数据规模足以支持全量候选；增量优化只允许用于：

- manifest 未变化时直接 no-op；
- 按 blob checksum 复用解析缓存；
- 差异计算复用稳定的记录 checksum。

增量缓存不能改变全量结果、完整性检查和原子发布边界。

### 11.4 三级发布门禁

| 等级   | 典型条件                                                                                                                         | 行为                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Green  | 合法数值/文本调整、正常新增定义、已识别字段变化、覆盖率不下降                                                                    | 自动原子提升为当前版本                                 |
| Yellow | Hero/Ability 删除、ID 重映射、selector 匹配集合异常变化、新数据形态、未知字段、关系/翻译覆盖显著下降、资产版本不匹配或系统性异常 | 保存完整候选与 diff，等待人工 Review；当前版本继续服务 |
| Red    | Git/manifest 不一致、解析失败、继承循环、关键身份重复、外键断裂、必填规范字段缺失、数据库约束失败                                | 阻止候选发布并告警；当前版本不变                       |

Yellow 是“数据可能有效，但变化需要人确认”，不是导入失败。Reviewer 可以：

- 接受并提升该候选；
- 拒绝并记录原因；
- 修复 mapper/selector 后用新 importer version 重建。

不得通过修改候选表中的规范值来“修正”上游数据。

### 11.5 差异报告

每个候选相对当前版本生成：

- raw file diff：新增、删除、修改的 path/blob；
- source-schema diff：新 key、消失 key、scalar/object 形态变化和重复键变化；
- semantic diff：Hero/Ability/Facet 新增删除、字段变化、ID 映射变化、关系变化、本地化覆盖和资产状态；
- summary：影响实体数、阻断项、warning、未知项和门禁结论。

diff 必须可机器读取，也必须提供适合人工 Review 的摘要。任何结论都能定位到 dataset version、source path 和 source key。

### 11.6 调度与时效目标

- 支持手动刷新和计划任务两种入口，二者调用同一幂等 workflow。
- 默认建议每 15 分钟 discover 一次上游；无新 commit 时不创建 dataset。
- Green 更新的运行目标是在上游 commit 可见后 30 分钟内完成自动发布。
- Yellow/Red 在同一时间窗内生成可审阅报告和通知，但发布时间取决于 Review 或修复。
- 导入、差异或发布失败不降低当前页面可用性。

该目标是初始运行 SLO，实施阶段应通过真实全量导入 benchmark 校准，而不是把未经测量的耗时写死成成功条件。

### 11.7 回滚

- promotion 在一个数据库事务内切换 `hero_catalog` head。
- 回滚只允许指向仍存在、已验证且 schema 兼容的历史 dataset。
- 回滚记录操作者/执行来源、原因、from/to version 和时间。
- 回滚不删除失败候选、diff 或 provenance。
- 页面在新导入失败期间继续读取旧 head，并显示最近失败摘要。

## 12. 命令与配置

以下接口已实现：

```bash
pnpm data:source:discover:vpk
pnpm data:source:lock:vpk --commit <sha>
pnpm data:import:catalog --lock <lock-file> --no-promote
pnpm data:extract:assets:vpk
pnpm data:import:assets
pnpm data:import:assets --catalog-version <uuid> --no-promote
pnpm data:audit:assets
pnpm data:diff:catalog --candidate <dataset-version-id>
pnpm data:review:catalog --candidate <dataset-version-id> --decision approved --reason <text>
pnpm data:promote:catalog --candidate <dataset-version-id>
pnpm data:promote:catalog --candidate <dataset-version-id> --allow-fallback-downgrade
pnpm data:rollback:catalog --to <dataset-version-id> --reason <text>
pnpm data:rollback:catalog --to <dataset-version-id> --reason <text> --allow-fallback-downgrade
pnpm data:refresh:catalog:development
```

配置至少包括：

- 上游 remote/mirror 位置；
- 临时 detached worktree/cache 位置；
- locale allowlist；
- selector 和 importer 版本；
- 由 Environment Contract receipt 提供的 PostgreSQL Worker capability；
- 可选的本地 Dota 2 VPK、Source 2 Viewer CLI 和 Git 忽略的已提取资产目录；没有资产源时 importer 仍生成并入库完整 fallback dataset；
- 调度频率与通知出口。

配置不能依赖某个开发者用户名或固定绝对路径。CLI 必须在缺失来源、权限不足、版本不匹配和资产不可用时给出明确、结构化错误。

## 13. 查询与页面合同

### 13.1 Heroes `/heroes`

- 页面顶部显示当前 catalog 的 ClientVersion、SourceRevision、commit、更新时间和健康状态。
- Hero 按 Strength、Agility、Intelligence、Universal 分组；组内使用稳定排序。
- 支持名称、内部名称、HeroID 搜索，以及主属性、角色、攻击类型、CM 状态组合筛选。
- Hero tile 使用当前 asset head 中的数据库 icon 和适合显示宽度的 LoD；Valve 源缺失时使用已经入库、不会改变布局的实体 fallback。
- 筛选状态保存在 URL，并在 locale 切换后保留。

### 13.2 Hero detail `/heroes/[slug]`

- `Overview`：名称、图像、简介、背景、属性、角色和状态；
- `Abilities`：当前普通、终极、innate 和间接能力，清楚标记 relation；
- `Talents & Upgrades`：talents、Facet、Scepter、Shard 及其他升级关系；
- `Raw`：经过安全展示的 ordered source definition/typed projection；
- `Provenance`：catalog、文件、source key、checksum、mapper/schema 版本和最新差异。

### 13.3 Abilities `/abilities`

- 默认只显示 `current`，允许切换到 `indirect`、`defined_unbound`、`template` 和 `deprecated`；
- 支持名称/internal name、Hero、relation、behavior、damage type、upgrade condition 和状态筛选；
- 列表显示图标、双语名称、internal name、所属 Hero 摘要、核心标签和逐级 cost/cooldown 摘要；
- 搜索、筛选、排序和 locale 写入 URL；分页、页码 URL 和一次性 DOM 全量渲染条款已由[全局 List Spec](infinite-lists.md)取代，cursor 与滚动位置不作为公开查询状态。

### 13.4 Ability detail `/abilities/[internal-name]`

- 当前 asset head 中的数据库 icon、适合显示宽度的 LoD、本地化名称和描述；
- behavior、target、damage、cast、cooldown、mana 和逐级 values；
- modifier/condition、Scepter/Shard/Facet 等升级差异；
- 所属 Heroes、relation kind、source slot 和当前状态；
- raw ordered definition、未知字段和 provenance；
- internal name 不存在时返回 404，不做模糊 fallback。

## 14. 安全与内容处理

- 上游本地化默认作为转义文本渲染；若支持少量格式标记，使用显式 allowlist parser/sanitizer。
- 不把来源字符串直接交给 `dangerouslySetInnerHTML`。
- Raw viewer 限制单节点和整页输出大小，防止异常输入拖垮页面。
- Git remote、source path 和错误内容在日志/UI 中按不可信数据处理。
- Web 账号继续只读；Worker 无 DDL 和直接修改 head 的权限，只能调用受约束 promotion/rollback 函数。
- 资产提取器只处理明确配置的 Dota 2 VPK 与 allowlist 路径，不扫描无关目录或修改 VPK 内容；提取结果只写入配置的 Git 忽略目录。
- Web 只从 PostgreSQL 当前 asset head 读取图片；提取目录路径、数据库内部来源 metadata 和机器绝对路径不能暴露给浏览器。

## 15. 测试与验收

### 15.1 Parser/Domain

- ordered KV AST 保留重复 key、顺序、标量/对象和来源位置；
- global/per-Hero ability 合并、BaseClass 继承、缺失 base 和循环检测；
- `AbilityValues` 标量、数组、嵌套和动态 modifier；
- Ability ID 缺失、重复 ID、多名称映射；
- `AbilityN`、talent、innate、Facet、linked、sub-ability 和 upgrade 关系；
- Rubick/Ringmaster 高位非 talent slot 不被误分类；
- 新 Hero 文件被动态 selector 捕获，selector 集合变化进入 diff；
- locale fallback、缺失 token、增加第三语言时不改核心 schema；
- 所有顶层 Ability 定义均 accepted 或有结构化 exclusion reason。

### 15.2 PostgreSQL/Worker

- 从现有 MVP schema 可迁移到共享 Hero Catalog 版本；
- Drizzle schema 与 SQL migration 一致；
- staging 失败不产生半成品规范版本；
- Heroes、Abilities 和 bindings 原子提升，不出现 patch tearing；
- 同一幂等键不会重复写入；并发 refresh 只有一个 promotion；
- Green 自动提升、Yellow 等待 Review、Red 阻止提升；
- rollback 原子恢复历史版本并保留审计记录；
- asset blob 的 SHA-256、`bytea`、MIME 与实际宽高一致，相同内容跨对象/版本去重；
- asset import 覆盖全部 Hero 和全部 accepted Ability，每个 binding 都有 `original`、`w64`、`w128`、`w256`；
- asset dataset 的幂等复用、事务失败和独立 head 提升不改变 Hero Catalog head；
- Web/Worker/migration owner 权限边界生效。

### 15.3 UI/E2E

- `/heroes` 四属性分组、搜索、筛选、URL 恢复和 locale 切换；
- Hero 详情的 Abilities、Talents & Upgrades、Raw 和 Provenance；
- `/abilities` 默认 current、状态切换和组合筛选；
- Ability 详情 values、modifier、归属关系和 provenance；
- exact Valve、alias、无源/版本不匹配 generated fallback 都能从数据库返回可解码图片；
- Hero/Ability 列表与详情按显示宽度请求 LoD，响应尺寸、MIME、ETag 和 cache header 正确；
- 未导入、最近更新失败、Yellow 等待 Review、404 和空结果；
- 桌面与移动端视觉回归、键盘导航、焦点、对比度和语义检查。

### 15.4 v2 验收标准

- 一个命令能从锁定来源 commit 构建完整、不可变、可审阅的 Hero Catalog 候选。
- accepted Hero 数等于该快照中满足版本化正式 Hero 规则的记录数，不写死 127。
- 全局和分 Hero 文件中的每个顶层 `DOTAAbilities` 定义都能证明被接受或按明确原因排除。
- Ability 以 internal name 作为版本内身份，重复/缺失数值 ID 不造成数据覆盖。
- Hero、Ability、Facet、bindings 和 locale 文本共享一个原子 current version。
- UI 默认展示当前内容，但历史、辅助、未绑定和 deprecated 定义可筛选并有清楚标签。
- `zh-CN`、`en` 可用；增加新 locale 不需要修改 Hero/Ability 核心表。
- Valve 资产可先从配置的本地 VPK 受限提取再入库；没有来源时也能生成确定性 fallback asset dataset。
- 当前 Catalog 的全部 Hero 与全部 accepted Ability 都有数据库 icon 及 `original`、`w64`、`w128`、`w256`，最终 display coverage 为 100%。
- 资产可以通过独立 dataset/head 增加、修改和重新生成，不改变玩法 Catalog 版本身份。
- 每个 Hero/Ability 详情能定位到来源 commit、path、source key、checksum 和转换版本。
- Green 更新自动发布；Yellow 不自动发布；Red 与任意失败都不改变 current head。
- 可以把 head 原子回滚到兼容的历史目录版本。
- 三个上游 Git 仓库和本地 Dota 2 VPK 内容始终只读；Medota2 不提交完整快照、提取缓存、数据库 dump 或批量 Valve 资产。

## 16. 实施阶段

### Phase 0：合同与架构基线

- 固化本文、Ability 状态/关系规则和发布门禁；
- 补充共享 catalog version、资产 provider 和更新管线 ADR；
- 对齐 Drizzle schema 与现有 SQL migration；
- 建立真实快照审计 fixture 和预期计数报告。

### Phase 1：Design System

- 建立语义 CSS tokens、布局 primitives 和 `src/components/ui/*`；
- 建立组件画廊与桌面/移动端视觉基线；
- 先重构现有 Heroes 页面到新系统，不改变当前数据合同。

### Phase 2：SSOT Parser

- 动态 Git-tree manifest；
- ordered KV AST、Ability registry 和 BaseClass resolver；
- Hero/Ability relations、localization 和 raw + typed DTO；
- unknown-field、coverage 和 exclusion reports。

### Phase 3：数据库与 Worker

- 共享 Hero Catalog migration；
- run-scoped staging/COPY、完整校验和不可变候选；
- semantic diff、三级门禁、atomic promotion 和 rollback。
- 内容寻址 asset blob/object/variant、独立 dataset/head、全实体覆盖门禁和幂等资产导入。

### Phase 4：查询与 UI

- `/heroes` 与 Hero 详情完整改版；
- `/abilities` 与 Ability 详情；
- 双语及 locale-neutral API；
- 数据库 asset route、按宽度选择 LoD 和已入库 fallback。

### Phase 5：更新自动化

- remote discover、exact-commit lock 和只读 worktree；
- scheduled/manual refresh、Review 报告和通知；
- 运行指标、SLO、失败恢复和操作手册。

### Phase 6：验收与交付

- 单元、真实 PostgreSQL 集成、并发/失败/回滚测试；
- 桌面与移动端 E2E、视觉回归和无障碍检查；
- 真实全量 refresh 演练和 README/运维文档更新。

每个 Phase 应独立可 Review、可回退。不得为了展示 UI 而绕过来源合同，也不得为了先完成导入而把 raw KeyValues schema 直接泄漏到产品查询层。

### 实施与验收记录（2026-08-31）

- Phase 0：共享版本、Valve 资产、数据库 asset dataset 和三级门禁 ADR 已建立；领域合同与真实快照审计报告已固化。
- Phase 1：语义 token、UI primitives、组件画廊及 Heroes 分组目录已实现。
- Phase 2：动态 selector、ordered KeyValues、继承、全部 Ability 定义、关系、Facets、双语和 exclusion/coverage 审计已实现。
- Phase 3：共享 PostgreSQL catalog、run-scoped staging/COPY、semantic diff、Green/Yellow/Red、Review、原子 promotion/rollback，以及独立数据库 icon asset dataset/head 已实现。
- Phase 4：Heroes / Abilities 总览和详情、URL 筛选、双语、record-level provenance、数据库图片路由与多 LoD 选择已实现。
- Phase 5：远端发现、exact-commit lock、detached worktree、手动/计划刷新、HTTPS 通知与运维手册已实现。
- Phase 6：单元测试、真实 PostgreSQL 集成、桌面/移动 E2E、键盘/landmark 检查、四份视觉基线和真实锁定全量 refresh 演练均已通过。

验收使用 commit `991daaf6fc24b08445209d9ce8767e145bab107e`、ClientVersion `6918`、SourceRevision `10949923`：127 Heroes、2,703 accepted Abilities、4,752 bindings、339 Facets、68 warnings、0 blocking errors，gate 为 Green。数字仅记录本次验收快照，不构成未来版本常量。

## 17. 风险与后续决策

- **上游延迟**：第三方跟踪仓库的提交延迟不在 Medota2 控制范围；近实时需求需另行评估直接 depot adapter。
- **KeyValues 漂移**：Ability 数据形态复杂，必须依靠无损原始层和 Yellow 门禁吸收未知变化。
- **关系误判**：slot、文件归属和当前可用性不等价；关系规则需要真实反例 fixture。
- **资产版本**：玩法 commit 与本地客户端可能版本不一致；导入必须保留 mismatch 状态、生成 fallback，并通过独立 asset dataset/head 迭代，不能污染玩法版本身份。
- **资产许可**：当前批准仅限自用；产品公开发布前重新审查。
- **数据规模**：先以全量重建确保正确性；只有 benchmark 证明必要时再做增量发布。
- **多语言覆盖**：新增 locale 可能缺少部分 token；覆盖率阈值按 current/legacy 状态分别定义，不能用 fallback 掩盖来源缺失。

## 18. 参考

- [Liquipedia Dota 2 Heroes Portal](https://liquipedia.net/dota2/Portal%3AHeroes)
- [Liquipedia Redesign FAQ](https://liquipedia.net/hub/Liquipedia%3AChangelogs/Redesign_FAQ)
- [Liquipedia Themes](https://liquipedia.net/commons/Support/Themes)
- [英雄元数据显示 MVP 功能 Spec](hero-metadata-mvp.md)
- [项目技术选型与数据处理架构](../architecture/technology-selection.md)
- [外部仓库总览与选源指南](../repositories/README.md)
- [dota_vpk_updates 调研](../repositories/dota-vpk-updates.md)
- [ADR 0004：Hero 与 Ability 图标使用数据库资产数据集](../adr/0004-database-icon-asset-datasets.md)
- [Source 2 Viewer CLI](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md)
