# 外部仓库总览与选源指南

## 为什么调研这些仓库

Medota2 调研了三个处于不同抽象层次的独立上游仓库：

```text
Dota 2 客户端 depot ──> GameTracking-Dota2 ──┐
pak01_dir.vpk ─────────> dota_vpk_updates ─────┼──> Medota2 的导入/标准化层 ──> 分析产品
d2vpkr + Dota 数据接口 + 手工 JSON ─> dotaconstants ─┘
```

这是职责关系图，不是已经实现的数据管线。三个仓库分别由不同上游维护，也不会随 Medota2 一起发布；`dotaconstants` 的当前构建脚本也不会自动读取另外两个来源的本地 checkout。

## 三个仓库的职责

| 仓库                 | 抽象层次        | 最适合回答的问题                                                                 | 代表内容                                              |
| -------------------- | --------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GameTracking-Dota2` | 客户端/引擎快照 | 某条网络消息、GC 消息或 Source 2 类型如何定义？客户端非 VPK 文件发生了什么变化？ | `.proto`、schema 头文件、模块元数据、客户端脚本和配置 |
| `dota_vpk_updates`   | 游戏资源原始层  | Valve 在 VPK 中怎样定义某英雄、技能、物品、单位、文本或 UI？                     | VDF/KV、KV3、XML、CSS、JS、本地化和资源清单           |
| `dotaconstants`      | 应用常量层      | 应用怎样获得可直接查询的英雄、物品、技能、模式、地区或补丁常量？                 | 已构建 JSON、ESM exports、生成任务和少量手工 JSON     |

`Medota2` 是第四层：由它拥有产品 schema、导入策略、PostgreSQL 和用户界面；比赛分析等后续能力仍在规划。不要把上游文件布局直接变成产品领域模型。

## 按需求选择来源

| 需求                                                         | 首选                                                        | 何时交叉核对                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| 首期英雄 ID、属性、角色、状态和中英展示文本                  | `dota_vpk_updates/scripts/npc/` 与 `resource/localization/` | `dotaconstants` 只生成覆盖率与字段漂移参考，不参与规范值或 fallback         |
| 尚未专项决策的应用常量，例如物品、模式和地区                 | 优先评估 `dotaconstants/build/`                             | 需要固定客户端快照或原始语义时，回到对应 VPK 文件核对                       |
| 固定快照/client version 对应的原始英雄、技能、物品、单位定义 | `dota_vpk_updates/scripts/npc/`                             | 需要应用友好格式时，参考 `dotaconstants` 的转换逻辑，但不要假定 schema 相同 |
| 多语言游戏文本、补丁文本                                     | `dota_vpk_updates/resource/localization/`                   | 只需要英文应用字段时，可先看 `dotaconstants/build/`                         |
| Dota UI 布局、样式、脚本                                     | `dota_vpk_updates/panorama/`                                | 查询客户端其他 Panorama/工具文件时再看 `GameTracking-Dota2`                 |
| 回放、网络、GC 协议                                          | `GameTracking-Dota2/Protobufs/`                             | 结合具体客户端版本和解析器实现核对                                          |
| Source 2 类、模块和引擎结构                                  | `GameTracking-Dota2/DumpSource2/`                           | 原始玩法值仍应回到 VPK 数据                                                 |
| 比赛历史、玩家表现、胜率、实时比赛                           | 三者都不是                                                  | 另接 Steam/OpenDota 等 API、回放或本地采集方案                              |

## 数据新鲜度与冲突

- 不要只看文件修改时间或仓库目录名。每次导入应记录来源 commit；能识别游戏 build/client version 时也一并记录。
- “更原始”不等于“更适合应用”。`dota_vpk_updates` 可能更新快但需要复杂解析，`dotaconstants` 更易使用但包含转换、补充和远程源延迟。
- 同名字段不保证同一语义。先在 `Medota2` 定义领域字段，再为每个来源写显式映射。
- 如果两个来源冲突，保留冲突样本和决策依据，不要按加载顺序覆盖。

### 英雄元数据专项决策

首期英雄元数据采用比本通用指南更严格的规则：`dota_vpk_updates` 是唯一 SSOT，`dotaconstants` 只作可选参考，不能覆盖或回填规范英雄字段。完整字段范围、继承规则、存储和展示方案见[英雄元数据显示 MVP 功能 Spec](../specs/hero-metadata-mvp.md)。其他数据域仍需逐项选源，不能自动沿用这项决定。

### Hero Catalog v2 专项决策

已实现的 Hero Catalog v2 将上述严格规则扩展到 Abilities：Hero 与 Ability 的规范玩法定义统一来自固定 commit 的 `dota_vpk_updates`，`dotaconstants` 仍只作非规范 QA/reference。完整边界、全量定义语义、关系模型和更新门禁见[Hero Catalog v2 Spec](../specs/hero-catalog-v2.md)。本文其他通用选源规则不能覆盖该专项决策。

## Provenance 最小清单

每次生成 `Medota2` 可消费的派生数据时，至少保存：

- `source_repository`：来源名称及上游 URL。
- `source_commit`：实际读取的 Git commit，而不是分支名。
- `source_path`：输入文件的仓库相对路径；多文件联结时保存完整列表。
- `client_version` / `source_revision`：来源能提供时记录；不能提供时明确为空。
- `imported_at`：导入时间，使用带时区的时间格式。
- `importer_version` 与目标 schema 版本：用于复现转换逻辑。

任何 checkout 都不保证已经同步其远端；`source_commit` 只说明“用了哪个快照”，不自动表示“使用了最新数据”。

## 建议的接入约束

1. 外部仓库只读；导入器读取它们，产品运行时不写回。
2. 外部来源的位置通过配置、依赖管理或开发环境发现机制提供，不写死用户绝对路径。
3. 解析结果先进入来源专属 DTO，再映射到产品领域模型。
4. 缓存或快照只保留必要字段，并包含 provenance 元数据。
5. 对更新做可重复的校验：记录数、关键 ID、未知字段、解析失败和 schema diff。

## 分仓库详细说明

- [GameTracking-Dota2：客户端、引擎与协议快照](game-tracking-dota2.md)
- [dota_vpk_updates：VPK 原始资源快照](dota-vpk-updates.md)
- [dotaconstants：应用层常量包](dotaconstants.md)
