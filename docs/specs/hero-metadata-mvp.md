# 英雄元数据显示 MVP 功能 Spec

> 状态：MVP 已实现；Catalog 范围已由 [Hero Catalog v2](hero-catalog-v2.md) 取代，本文保留为历史兼容合同
>
> 最后更新：2026-08-30
>
> 版本范围：Medota2 第一个可运行版本

## 1. 文档目的

本文只定义 Medota2 第一个版本的英雄元数据接入、存储和前端显示范围。全项目技术选型、PostgreSQL 边界、Data Worker 和 Rust 演进理由见[项目技术选型与数据处理架构](../architecture/technology-selection.md)。

本文中的页面、表、命令和测试已经由当前 MVP 实现，并继续作为后续回归与兼容合同。

## 2. MVP 结果

完成首版后，用户应能在本地：

1. 从一个明确且输入文件与 HEAD 一致的 `dota_vpk_updates` checkout 导入正式英雄元数据；
2. 把版本化的规范英雄数据与来源信息保存到 PostgreSQL；
3. 打开英雄总览，按名称、主属性、角色和攻击类型搜索筛选；
4. 打开英雄详情，查看中英文文本、原始基础数值和 MVP 定义的 provenance；
5. 从固定的 `dotaconstants` checkout 导入隔离的参考数据并查看差异；该参考步骤可以不执行，但实现必须提供，且其结果不能改变规范值。

核心闭环是“VPK 导入 → PostgreSQL → 英雄总览 → 英雄详情”。`dotaconstants` 比较是同一版本交付的非阻塞参考能力：未配置或比较失败时，核心闭环仍须可用。

## 3. 功能边界

### 3.1 包含

- 英雄身份、可用状态、分类、角色、基础属性、攻击、移动和视野；
- 英文与简体中文名称、简介和背景故事；
- 不可变来源快照、转换版本、当前数据集指针和导入问题报告；
- 英雄总览、组合筛选、详情页、空状态和失败状态；
- `dotaconstants` 参考快照、覆盖率和字段漂移比较；
- 导入幂等、原子提升、回滚基础、来源校验和自动化测试。

### 3.2 不包含

- 技能、天赋、先天技能和 Aghanim 升级；
- 物品、比赛、玩家、胜率、实时对局或 replay；
- 自动拉取或更新任一上游仓库；
- Web 导入按钮、后台调度、任务队列或定时同步；
- 登录、权限、公共 API、云部署或多用户协作；
- 将完整 VPK 或图片、声音等游戏资产打包进产品；
- Rust Worker。

## 4. 数据源决策

### 4.1 唯一 SSOT

`dota_vpk_updates` 是首期英雄规范数据的唯一 SSOT。任何规范值都必须能追溯到一个具体 Git checkout 和实际读取的文件字节。

VPK 导入器只读取以下 repository-relative allowlist：

| 输入                                           | 用途                                                      |
| ---------------------------------------------- | --------------------------------------------------------- |
| `scripts/npc/npc_heroes.txt`                   | HeroID、状态、角色、属性、攻击、移动和视野                |
| `resource/localization/abilities_english.txt`  | 英文英雄显示名 token                                      |
| `resource/localization/abilities_schinese.txt` | 简体中文英雄显示名 token                                  |
| `resource/localization/dota_english.txt`       | 英文英雄简介 token                                        |
| `resource/localization/dota_schinese.txt`      | 简体中文英雄简介 token                                    |
| `resource/localization/hero_lore_english.txt`  | 英文背景故事 token                                        |
| `resource/localization/hero_lore_schinese.txt` | 简体中文背景故事 token                                    |
| `steam.inf`                                    | ClientVersion、SourceRevision、VersionDate 和 VersionTime |

导入器不得扫描整个上游仓库，也不得在运行时写回上游。

### 4.2 dotaconstants 只作参考

MVP 必须提供一个独立参考导入/比较命令，只读取固定 `dotaconstants` checkout 中的 `build/heroes.json` 与 `package.json`，并生成：

- HeroID 与内部名称覆盖率；
- VPK 新增、参考缺失或参考多出的记录；
- 共同字段的值漂移；
- VPK dataset version、参考 commit、文件 checksum、比较器版本和比较时间。

执行该命令是可选的，以下行为则始终被禁止：

- 覆盖 VPK 字段；
- 为 VPK 缺值提供 fallback；
- 因两个来源记录数或字段值不同而拒绝 VPK 导入；
- 把 `img`/`icon` 相对路径写入规范图片字段；
- 展示不属于当前 VPK dataset version 的旧比较结果。

### 4.3 GameTracking-Dota2

`GameTracking-Dota2` 不进入本 MVP 的英雄导入管线。

### 4.4 本次调研基线

以下只记录 2026-08-30 编写 Spec 时检查过的本地快照，不是运行时默认值，也不能被写死到导入器：

| 来源               | 调研 checkout                              | 快照信息                                        |
| ------------------ | ------------------------------------------ | ----------------------------------------------- |
| `dota_vpk_updates` | `991daaf6fc24b08445209d9ce8767e145bab107e` | ClientVersion `6918`；SourceRevision `10949923` |
| `dotaconstants`    | `e7705ee975ebec2a88a59a7b455d4cae5dc69ca1` | `build/heroes.json` 含 127 条参考记录           |

这两个快照已经出现部分字段漂移，正是 `dotaconstants` 不能作为 fallback 的原因之一。

## 5. 来源快照与可复现性

### 5.1 VPK 快照记录

每次规范导入至少记录：

- `source_repository` 与实际 Git remote URL；
- checkout 的 `source_commit`；
- repository-relative `source_path` 清单；
- 每个 allowlist 文件原始字节的 SHA-256、大小和识别到的编码；
- 按 path 排序后生成的 `manifest_sha256`；
- `source_dirty`；
- `source_inputs_match_head`；
- `client_version`、`source_revision`、`version_date` 和 `version_time`；
- `imported_at`、`importer_version` 和 `target_schema_version`。

`manifest_sha256` 的输入是按 repository-relative POSIX path 字节序升序排列的 UTF-8 文本，每行固定为 `<path>\t<raw_sha256>\t<size_bytes>\n`；path 不允许 tab 或换行。快照身份是 `source_repository + source_commit + manifest_sha256`，不是目录修改时间，也不是单独一个 commit 字符串。

### 5.2 checkout 与 HEAD 一致性

- MVP 只接受包含 `.git` 且 `HEAD` 可解析的 checkout；读取对象就是该 checkout 的 `HEAD`。
- 每个 allowlist path 都必须由 Git 跟踪，且工作区原始字节必须与 HEAD 中对应 blob 一致；任一输入被修改、删除或替换为 untracked 文件都会阻断规范导入。
- allowlist 之外的 tracked/untracked 改动不参与导入，因此不阻断；仍记录整体 `source_dirty = true`，而正式快照必须满足 `source_inputs_match_head = true`。
- 导入器不得因为存在其他文件而扩大扫描范围。快照的 commit、输入 byte checksums 和 manifest 共同证明实际输入。
- 产品只能声明“数据来自某个明确快照”，不能只写“最新数据”。

### 5.3 字节与编码

- SHA-256 在解码、去 BOM 或换行转换之前对原始字节计算。
- 首期接受 ASCII 子集或 UTF-8；UTF-8 可以有 BOM。其他编码整批失败。
- 解析前可以去除 UTF-8 BOM，并兼容 LF、CRLF 与 CR；这些规范化步骤不得改变已记录的原始 checksum。
- 当前调研快照中的本地化文件为带 BOM 的 UTF-8，导入器必须用 fixture 固定该行为。

### 5.4 转换与 schema 版本

- `MEDOTA2_BUILD_ID` 由构建过程注入，格式为 `medota2@<package_version>+git.<full_commit>`，不能由 CLI 用户任意填写。
- 直接用 `tsx` 从源码运行正式导入时，Medota2 自身 checkout 也必须干净；否则只能运行不提升 active dataset 的 fixture/dev 流程。
- `importer_version` 固定为 `hero-vpk-v1/<MEDOTA2_BUILD_ID>`；修改字段语义、继承或过滤规则时必须提升合同版本。
- `comparator_version` 固定为 `hero-reference-v1/<MEDOTA2_BUILD_ID>`；修改参考归一化或比较字段时必须提升合同版本。
- `target_schema_version` 从数据库 migration ledger 读取，格式为 `<latest_migration_id>:<migration_file_sha256>`；CLI 不接受手工覆盖。

`import_runs` 同时保存上述版本和 Medota2 commit。这样，同一来源字节经过不同转换合同或 schema 时会形成不同 dataset version。

## 6. 规范英雄合同

### 6.1 数值语义

MVP 保存并展示 `npc_heroes.txt` 中经过基类继承后的原始定义分量，不计算“一级英雄最终面板值”。例如：

- `StatusHealth`、`StatusMana` 是原始基础分量；
- `ArmorPhysical` 不叠加敏捷带来的护甲；
- `AttackDamageMin`/`AttackDamageMax` 不叠加主属性带来的攻击力；
- `AttackRate` 按来源值原样保存，不换算攻击频率。

前端必须将这些字段标成“基础/原始定义”，避免把它们解释为最终游戏内面板数值。所有小数用 PostgreSQL `numeric(12,6)` 保存，不经过 JavaScript 浮点舍入后再入库。

### 6.2 VDF 到领域字段映射

除 `RandomEnabled`、简介和背景故事外，下表字段对正式英雄均为必填；必填指完成基类继承后必须存在且类型有效。

| 来源 key                    | 领域字段                 | PostgreSQL 表示与规则                                           |
| --------------------------- | ------------------------ | --------------------------------------------------------------- |
| VDF 对象 key                | `internal_name`          | `text`；匹配正式英雄正则                                        |
| `HeroID`                    | `hero_id`                | `integer > 0`                                                   |
| 由内部名称生成              | `slug`                   | 去掉 `npc_dota_hero_` 前缀，保留原小写 suffix；不使用本地化名称 |
| `Enabled`                   | `enabled`                | 严格把 `0`/`1` 转为 `boolean`                                   |
| `CMEnabled`                 | `cm_enabled`             | 严格把 `0`/`1` 转为 `boolean`                                   |
| `RandomEnabled`             | `random_enabled`         | 可空 `boolean`；缺少时为 `NULL`                                 |
| `AttributePrimary`          | `primary_attribute`      | strength/agility/intelligence/universal 枚举                    |
| `AttackCapabilities`        | `attack_type`            | melee/ranged 枚举                                               |
| `Team`                      | `faction`                | 大小写不敏感地把 Good/Bad 映射为 radiant/dire                   |
| `Complexity`                | `complexity`             | `smallint`，范围 1..3                                           |
| `Role` + `Rolelevels`       | `hero_roles`             | 同位置配对；role 为 8 个允许值之一，level 为 1..3               |
| `AttributeBaseStrength`     | `base_strength`          | `numeric(12,6)`                                                 |
| `AttributeStrengthGain`     | `strength_gain`          | `numeric(12,6)`                                                 |
| `AttributeBaseAgility`      | `base_agility`           | `numeric(12,6)`                                                 |
| `AttributeAgilityGain`      | `agility_gain`           | `numeric(12,6)`                                                 |
| `AttributeBaseIntelligence` | `base_intelligence`      | `numeric(12,6)`                                                 |
| `AttributeIntelligenceGain` | `intelligence_gain`      | `numeric(12,6)`                                                 |
| `StatusHealth`              | `base_health`            | `numeric(12,6)`                                                 |
| `StatusMana`                | `base_mana`              | `numeric(12,6)`                                                 |
| `StatusHealthRegen`         | `base_health_regen`      | `numeric(12,6)`                                                 |
| `StatusManaRegen`           | `base_mana_regen`        | `numeric(12,6)`                                                 |
| `ArmorPhysical`             | `base_armor`             | `numeric(12,6)`                                                 |
| `MagicalResistance`         | `magic_resistance`       | `numeric(12,6)`，保留来源百分数数值                             |
| `AttackDamageMin`           | `base_attack_damage_min` | `numeric(12,6)`                                                 |
| `AttackDamageMax`           | `base_attack_damage_max` | `numeric(12,6)`；不得小于 min                                   |
| `BaseAttackSpeed`           | `base_attack_speed`      | `numeric(12,6)`                                                 |
| `AttackRate`                | `attack_rate`            | `numeric(12,6)`                                                 |
| `AttackAnimationPoint`      | `attack_animation_point` | `numeric(12,6)`                                                 |
| `AttackRange`               | `attack_range`           | `numeric(12,6)`                                                 |
| `ProjectileSpeed`           | `projectile_speed`       | `numeric(12,6)`                                                 |
| `MovementSpeed`             | `movement_speed`         | `numeric(12,6)`                                                 |
| `MovementTurnRate`          | `turn_rate`              | `numeric(12,6)`                                                 |
| `VisionDaytimeRange`        | `day_vision`             | `numeric(12,6)`                                                 |
| `VisionNighttimeRange`      | `night_vision`           | `numeric(12,6)`                                                 |

`primary_attribute` 的固定映射是：

| VDF 值                     | 领域值         |
| -------------------------- | -------------- |
| `DOTA_ATTRIBUTE_STRENGTH`  | `strength`     |
| `DOTA_ATTRIBUTE_AGILITY`   | `agility`      |
| `DOTA_ATTRIBUTE_INTELLECT` | `intelligence` |
| `DOTA_ATTRIBUTE_ALL`       | `universal`    |

`attack_type` 的固定映射是 `DOTA_UNIT_CAP_MELEE_ATTACK → melee`、`DOTA_UNIT_CAP_RANGED_ATTACK → ranged`。MVP 允许的 role 为 `carry`、`support`、`nuker`、`disabler`、`durable`、`escape`、`pusher`、`initiator`；来源值入库时转小写。未知枚举不能静默保留为任意字符串。

### 6.3 本地化映射

领域 locale 固定为 `en` 和 `zh-CN`：

| 内容         | 来源文件                 | token                        |
| ------------ | ------------------------ | ---------------------------- |
| 英雄显示名   | `abilities_<locale>.txt` | `npc_dota_hero_<name>:n`     |
| 英文名称变体 | `abilities_<locale>.txt` | `npc_dota_hero_<name>__en:n` |
| 英雄简介     | `dota_<locale>.txt`      | `npc_dota_hero_<name>_hype`  |
| 背景故事     | `hero_lore_<locale>.txt` | `npc_dota_hero_<name>_bio`   |

- 每个正式英雄的 `en` 与 `zh-CN` 显示名都必须存在；缺少任一名称会阻断规范导入。
- 简介或背景故事缺失是 warning，对应字段存 `NULL`，前端显示明确占位。
- 简体中文缺值不能由 `dotaconstants` 回填。
- 本地化值按文本保存。简介可能含上游标记；前端不得把未清洗字符串直接交给 `dangerouslySetInnerHTML`。

## 7. 导入与规范化规则

### 7.1 配置与解析边界

- VPK checkout 通过 `DOTA_VPK_UPDATES_PATH` 配置，不能写死相邻目录。
- 所有 allowlist 文件在解析前验证存在性、可读性、编码、大小和 SHA-256。
- 解析失败、未知编码或 `steam.inf` 缺少 ClientVersion/SourceRevision 时，规范导入非零退出。
- VDF/KeyValues 解析器封装在来源适配器中，领域代码不得接触原始对象。
- 首个解析器候选为固定版本的 `vdf-parser`；采用前必须以真实 fixture 验证注释、空值、重复键、嵌套对象、数字字符串和非标准 KeyValues 形式。

### 7.2 基类继承

只对第 6 节的标量 allowlist 执行确定性继承：

1. 解析 `DOTAHeroes` 和 `npc_dota_hero_base`；
2. 来源 hero 自身存在某 key 时使用自身值，即使它是空字符串；否则使用 base 值；
3. 空字符串覆盖后按字段规则校验：必填字段为空会阻断导入，不能退回 base；
4. `Role`/`Rolelevels` 和本地化 token 不参与 base 深合并；
5. 重复 key 若影响 allowlist 字段则视为歧义并阻断导入；
6. 不对数组、重复对象或未知嵌套结构执行通用 deep merge；
7. 完成来源 DTO 后，再进行布尔、十进制和枚举转换。

### 7.3 正式英雄过滤

默认纳入同时满足以下条件的记录：

- 内部名称匹配 `^npc_dota_hero_[a-z0-9_]+$`；
- `HeroID` 是正整数；
- `Enabled = 1`；
- 不在初始 denylist：`npc_dota_hero_base`、`npc_dota_hero_target_dummy`。

denylist 必须作为有测试的版本化常量；新增条目需要代码审阅和 fixture，不能临时按记录总数或文件顺序排除。`CMEnabled = 0` 不是排除条件。

不满足 `Enabled = 1` 的记录计为 expected exclusion。满足前三项却命中 denylist，或名称像正式英雄但身份字段非法的记录，必须进入问题报告。

### 7.4 Role 对齐

- `Role` 与 `Rolelevels` 分别按逗号切分并 trim；空项非法。
- 两边长度必须完全相等，按位置生成 `(role, level)`。
- role 必须属于第 6.2 节的允许集合，level 必须是整数 1..3。
- 长度不一致、重复 role 或非法 level 都是 blocking error，不得截短、补零或猜测。

### 7.5 问题等级

| 等级               | 示例                                                                                                                   | 结果                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| expected exclusion | `Enabled != 1`、明确 denylist                                                                                          | 记录计数和原因，不阻断          |
| warning            | 缺少简介/背景故事、参考字段漂移                                                                                        | 保存问题；规范数据可提升        |
| blocking error     | allowlist 输入与 HEAD 不一致、文件/版本缺失、解析失败、重复身份、必填值缺失、未知枚举、Role 对齐失败、任一语言名称缺失 | 整批失败，不改变 active dataset |

候选正式英雄不存在“悄悄跳过”路径。导入开始时先持久化 `import_run`；失败时用独立事务保存状态、计数和结构化问题摘要，随后清理该 run 的 staging 数据。正式表和当前数据集指针保持不变。

### 7.6 原子性与幂等

- `source_snapshot` 由第 5.1 节的快照身份去重。
- canonical dataset 的幂等键为 `source_snapshot_id + importer_version + target_schema_version`。
- 先写 run-scoped staging，再执行领域和数据库完整校验。
- 校验通过后，在一个事务中写入不可变 dataset version，并调用 `promote_hero_dataset_version(version_id)` 切换当前指针。
- 同一幂等键重复执行返回已有成功结果，不复制英雄、角色或本地化行。
- Worker 使用 PostgreSQL advisory lock 防止两个英雄规范导入同时提升。
- `promote_hero_dataset_version` 由 migration owner 以 `SECURITY DEFINER` 创建，验证 version 已校验且调用者持有导入锁；Worker 只有该函数的 `EXECUTE` 权限，不能直接 `UPDATE dataset_heads`。

## 8. PostgreSQL MVP 数据模型

### 8.1 表职责

| 表                           | MVP 职责                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| `import_runs`                | 状态、阶段、计数、结构化问题、时间和性能摘要                                |
| `source_snapshots`           | repository、commit、manifest hash、版本字段和快照时间                       |
| `source_snapshot_files`      | 每个 repository-relative path 的原始 SHA-256、大小和编码                    |
| `hero_dataset_versions`      | 来源 snapshot、importer/schema 版本、校验状态和创建时间                     |
| `dataset_heads`              | `dataset_key = 'heroes'` 对应的当前 `hero_dataset_version_id`               |
| `hero_source_records`        | dataset version、HeroID、VDF source key、来源 DTO checksum 和继承诊断       |
| `heroes`                     | dataset version 范围内的规范英雄标量字段                                    |
| `hero_roles`                 | dataset version、HeroID、role、RoleLevel                                    |
| `hero_localizations`         | dataset version、HeroID、locale、文本、source path 和 token                 |
| `reference_snapshots`        | dotaconstants commit、包版本及 `build/heroes.json`/`package.json` checksums |
| `reference_hero_records`     | 隔离的参考记录；可保留原始 JSONB，但不能作为规范默认值来源                  |
| `hero_reference_comparisons` | 明确配对一个 VPK dataset version 与一个 reference snapshot                  |
| `hero_reference_diffs`       | comparison、HeroID、字段、差异类型和双方值                                  |

### 8.2 版本策略

MVP 采用“不可变多版本 + 单一当前指针”，不是覆盖式 current-only 表：

- `heroes` 的主键为 `(dataset_version_id, hero_id)`；
- 内部名称和 slug 的唯一约束也带 `dataset_version_id`；
- `hero_roles` 与 `hero_localizations` 使用带 dataset version 的复合外键；
- 页面只通过 `dataset_heads('heroes')` 查询当前版本；
- 新版本完整写入并校验后，才在同一事务中更新 head；
- 旧成功版本在 MVP 中默认保留，用于审计；不自动清理；
- 回滚只允许把 head 原子切回仍存在且与当前 schema 兼容的已校验版本。

必须建立：

- `(dataset_version_id, hero_id)` 主键；
- `(dataset_version_id, internal_name)`、`(dataset_version_id, slug)` 唯一约束；
- `(dataset_version_id, hero_id, role)`、`(dataset_version_id, hero_id, locale)` 唯一约束；
- locale、枚举、RoleLevel、Complexity 和数值关系的 CHECK 约束；
- source、dataset、comparison 与子表的外键。

核心可查询字段使用明确列，不能只存入 JSONB。

### 8.3 MVP provenance 粒度

“MVP 完整 provenance”明确指以下两层：

1. **快照级**：repository、remote、commit、ClientVersion、SourceRevision、文件 path/hash/encoding、importer version、schema version 和导入时间；
2. **记录级**：英雄 VDF source key、来源 DTO checksum、应用过的 base 字段清单，以及每个本地化字段的 source path 与 token。

来源 DTO checksum 对“继承完成、类型转换之前”的 allowlist 对象计算：值保持来源字符串，按 [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) 生成 UTF-8 字节后取 SHA-256。MVP 不保存每个数值列独立的字段级 lineage；其变换由第 6 节 mapping、mapper 版本和测试共同说明。详情页所称 provenance 必须展示上述两层，不得笼统声称已提供字段级血缘。

## 9. dotaconstants 参考比较合同

- checkout 通过 `DOTACONSTANTS_PATH` 配置，必须可解析 HEAD，且 `build/heroes.json` 与 `package.json` 的原始字节必须和 HEAD 一致；其他路径的改动只记录、不参与比较。
- 参考快照至少记录 repository、remote、commit、`build/heroes.json` 与 `package.json` 的原始 SHA-256、`package.json.version` 和导入时间。
- 每次比较持久化 VPK `dataset_version_id` 与 `reference_snapshot_id`；UI 只读取当前 dataset version 的比较。
- 身份先按 HeroID 配对，再验证内部名称；ID/名称不一致单独报告，不自动重映射。
- 数组 role trim 后按集合比较；数值先解析为十进制并去除无意义尾零后精确比较；枚举先映射到第 6 节领域值。
- `img`、`icon`、`legs` 及 dotaconstants 独有字段不进入规范比较。

比较结果持久化为 `missing_in_reference`、`extra_in_reference`、`identity_mismatch` 或 `value_mismatch`。运行新比较不会修改 `heroes`、`hero_roles` 或 `hero_localizations`。

### 9.1 参考字段映射

首期只比较下表字段；没有列出的 reference key 不产生 drift：

| dotaconstants key                      | 规范字段                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`、`name`                           | `hero_id`、`internal_name`                                                          |
| `primary_attr`                         | `primary_attribute`；str/agi/int/all 映射为 strength/agility/intelligence/universal |
| `attack_type`                          | `attack_type`；Melee/Ranged 映射为 melee/ranged                                     |
| `roles`                                | role 集合；不比较 dotaconstants 未提供的 RoleLevel                                  |
| `base_health`、`base_mana`             | `base_health`、`base_mana`                                                          |
| `base_health_regen`、`base_mana_regen` | `base_health_regen`、`base_mana_regen`                                              |
| `base_armor`、`base_mr`                | `base_armor`、`magic_resistance`                                                    |
| `base_attack_min`、`base_attack_max`   | `base_attack_damage_min`、`base_attack_damage_max`                                  |
| `base_str`、`base_agi`、`base_int`     | `base_strength`、`base_agility`、`base_intelligence`                                |
| `str_gain`、`agi_gain`、`int_gain`     | `strength_gain`、`agility_gain`、`intelligence_gain`                                |
| `attack_range`、`projectile_speed`     | 同名规范字段                                                                        |
| `attack_rate`、`attack_point`          | `attack_rate`、`attack_animation_point`                                             |
| `base_attack_time`                     | `base_attack_speed`；该上游 key 实际由 VPK `BaseAttackSpeed` 生成                   |
| `move_speed`、`turn_rate`              | `movement_speed`、`turn_rate`                                                       |
| `cm_enabled`                           | `cm_enabled`                                                                        |
| `day_vision`、`night_vision`           | `day_vision`、`night_vision`                                                        |
| `localized_name`                       | `en` locale 的显示名                                                                |

reference 值为 `null` 而规范值非空时属于 `value_mismatch`，不能解释成“参考方未参与比较”。

## 10. 数据处理流程

```text
验证配置、Git HEAD、clean 状态和 allowlist
        │
        ▼
记录 raw checksums、manifest、steam.inf 与 import run
        │
        ▼
解析 VDF → 标量继承 → 正式英雄过滤 → Role 对齐
        │
        ▼
联结 en / zh-CN 名称、简介和背景故事
        │
        ▼
领域校验 → run-scoped staging → 数据库约束校验
        │
        ▼
写不可变 dataset version 并原子切换 heroes head
        │
        └── 可选执行 dotaconstants 参考导入与版本配对比较
```

英雄导入和比较均作为独立 TypeScript CLI/Worker 运行，不在 Next.js 请求生命周期内执行。

## 11. 前端 MVP

### 11.1 英雄总览 `/heroes`

- 当前规范英雄总数；
- VPK ClientVersion、SourceRevision、commit 短哈希和导入时间；
- 以简体中文名为主、英文名为辅的响应式英雄卡片；
- 中文名、英文名和内部名称搜索；
- 主属性、角色、攻击类型和 CM 状态组合筛选；
- 默认按 HeroID 升序，筛选状态写入 URL query；
- 数据问题数量和明确的未导入空状态；
- 点击英雄进入详情页。

首版只交付一种卡片表达，不实现视图切换、拖拽、自定义列或无限滚动。

搜索与筛选合同：

- URL 参数固定为 `q`、可重复的 `attribute`、`role`、`attack`，以及单值 `cm=all|true|false`；输出 URL 中数组值去重并按字节序排序。
- `q` 做 Unicode NFKC、trim 和大小写折叠，最长 100 个 Unicode code points；在中文名、英文名和内部名称上做 contains 匹配，SQL wildcard 必须转义。
- 同一维度多个值按 OR，不同维度之间按 AND；多个 role 表示“拥有任一选中 role”。
- 空 `q` 等同未提供；未知枚举值产生可见的参数校验错误，不能静默进入 SQL。
- 查询、排序和过滤均针对 `dataset_heads('heroes')` 指向的版本在 PostgreSQL 中完成；首版不分页，返回该版本的全部匹配英雄。
- 总览“数据问题数量”只统计 active dataset 对应成功 import run 的 warning；“最近导入失败”指 `finished_at` 晚于 active version `promoted_at` 的最新失败 VPK run。

### 11.2 英雄详情 `/heroes/[slug]`

- 中文名、英文名、内部名称和 HeroID；
- 简介和背景故事；
- 主属性、阵营、攻击类型、复杂度和可用状态；
- 六项基础属性、成长、生存、攻击、移动和视野原始定义；
- 角色与 RoleLevel；
- MVP provenance：repository、commit、ClientVersion、SourceRevision、输入文件、checksums、VDF key、本地化 tokens、importer/schema 版本和导入时间；
- 当前 dataset version 对应的参考差异，固定标注“dotaconstants 参考，不参与规范值”。

slug 使用第 6.2 节规则并在当前 dataset version 内唯一。若未来 Valve 更改内部名称，旧 URL 重定向不属于 MVP；HeroID 仍是领域身份主键。

### 11.3 错误与空状态

- 尚未导入：提示运行 VPK 导入命令；
- 最近导入失败：显示失败阶段和问题摘要，页面继续读取上一个 active dataset；
- 简介/背景缺失：显示“当前 VPK 快照未提供”，不自动使用参考来源；
- dotaconstants 未配置或比较失败：隐藏差异区或显示非阻塞状态，不影响规范页面；
- 图片缺失：使用通用 UI 占位，不影响英雄信息；
- slug 不存在：返回 404，不回退到模糊名称匹配。

### 11.4 文本与图片安全

- 上游文本在 React 中默认按转义文本渲染；如果保留 `<b>` 等少量格式，必须通过明确 allowlist 的 sanitizer/转换器。
- 不直接使用 `dangerouslySetInnerHTML` 渲染来源字符串。
- MVP 不假定 VPK checkout 包含可直接再分发的英雄图片，也不使用 `dotaconstants` 图片相对路径。

## 12. 命令

当前提供：

```bash
pnpm data:import:vpk
pnpm data:import:dotaconstants
pnpm data:compare:heroes
pnpm dev
```

来源路径无效、allowlist 输入与 HEAD 不一致、文件编码未知、`steam.inf` 无法解析或数据库不可用时，规范导入会给出明确错误并非零退出。

## 13. 测试范围

### 13.1 固定最小 fixture

提交人工裁剪、来源可说明的最小 fixture，至少包含：

- `npc_dota_hero_base`；
- Anti-Mage（HeroID `1`）；
- 一个满足正式英雄条件、人工构造为 `CMEnabled = 0` 的边界样本；
- `npc_dota_hero_target_dummy`；
- `en` 与 `zh-CN` 名称、简介和背景 token；
- 缺失简介/背景、缺失名称、重复 ID、重复 allowlist key、未知枚举和 Role 长度不一致样本；
- 一份故意落后的 dotaconstants 参考记录，用于证明差异不回填规范数据。

fixture 只保留测试所需最小内容，并记录原始 repository、commit、path、raw checksum 和裁剪方式。期望规范输出作为 golden fixture 提交。

### 13.2 解析与领域测试

- UTF-8 BOM、ASCII、换行、注释、空值、重复 key 和异常输入；
- allowlist 标量继承、显式空值覆盖和禁止 deep merge；
- HeroID、内部名称与稳定 slug；
- 正式英雄过滤、初始 denylist 和 `CMEnabled = 0` 保留；
- Role/RoleLevel 对齐与允许集合；
- 中英 token 联结、名称阻断、可选文本 warning；
- allowlist 输入改动被拒绝，allowlist 外改动不影响快照内容；
- snapshot 与 dataset version 幂等；
- dotaconstants 对比归一化和“不回填”约束。

### 13.3 PostgreSQL 集成测试

- migration 可从空库执行；
- staging 失败不更新规范表或 `dataset_heads`；
- 并发导入不能同时提升；
- 新版本原子切换，旧版本仍可审计；
- 主键、唯一、外键和 CHECK 约束生效；
- reference 表或比较流程不能更新规范表；
- Web 账号不能执行规范写入，Worker 账号不能执行 DDL。

### 13.4 E2E

- 总览加载、搜索、组合筛选和 URL 恢复；
- 详情字段、原始数值标签和 MVP provenance；
- `CMEnabled = 0` 英雄仍显示并可筛选；
- 未导入、最近导入失败、可选文本缺失、图片缺失和 404；
- 没有 dotaconstants 时核心产品流程仍通过；
- 有 reference comparison 时只显示与当前 dataset version 配对的差异。

## 14. MVP 验收标准

- 文档化步骤可启动 PostgreSQL、迁移、导入 VPK 并运行本地 Web。
- 规范英雄只来自一个明确、输入与 HEAD 一致且带 raw file checksums 的 VPK snapshot。
- 全量导入的 accepted hero 数等于来源中满足第 7.3 节规则的记录数；不写死某个历史英雄总数。
- accepted heroes 的 HeroID、内部名称和 slug 在当前 dataset version 内 100% 唯一。
- 所有 accepted heroes 的第 6.2 节必填标量和 `en`/`zh-CN` 名称覆盖率为 100%；简介/背景缺失仅形成可见 warning。
- Anti-Mage fixture 得到 HeroID `1`、slug `antimage` 以及中英文名称；golden output 与 mapper 结果一致。
- `CMEnabled = 0` 的正式英雄保留并可筛选；target dummy 不进入规范英雄。
- Role 与 RoleLevel 对齐；任何不一致样本使整批导入失败。
- 同一幂等键重复导入不产生重复数据；失败导入不改变 `dataset_heads('heroes')`。
- 任意英雄详情能查看第 8.3 节定义的两层 provenance，不声称字段级血缘。
- `dotaconstants` 未配置时不影响导入、总览和详情；配置后可生成与当前 dataset version 配对的覆盖率和差异。
- 参考导入/比较不会修改任何规范字段；故意落后的参考 fixture 仍以 VPK 值为页面主值。
- 搜索、筛选、详情、空状态、失败状态和图片回退通过 E2E。
- 三个上游仓库保持只读，Medota2 不提交大型原始快照。

## 15. 后续版本候选

- 合法、稳定的英雄图片 provider；
- 字段级 lineage；
- 技能和天赋数据；
- 英雄版本差异与补丁时间线；
- 自动化来源更新流程；
- 比赛或 replay 数据入口；
- 常驻后台 Worker、任务队列和 Rust 热点实现。

这些内容不应在 MVP 实现中顺带加入。

## 16. 本仓库参考

- [项目技术选型与数据处理架构](../architecture/technology-selection.md)
- [外部仓库总览与选源指南](../repositories/README.md)
- [dota_vpk_updates 调研](../repositories/dota-vpk-updates.md)
- [dotaconstants 调研](../repositories/dotaconstants.md)
