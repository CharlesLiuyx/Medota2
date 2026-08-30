# Medota2

> 一个计划在本地运行、强调版本可追溯与可复现数据接入的 Dota 2 分析项目。

> [!IMPORTANT]
> 项目目前处于初始化阶段。仓库仅包含项目边界和潜在数据来源的调研文档，尚无可安装或可运行的应用、数据导入器、数据库与分析功能。

## 项目简介

Dota 2 的客户端协议、原始游戏定义、应用常量和比赛数据分散在不同来源，而且会随客户端版本和补丁持续变化。Medota2 计划在这些来源之上建立清晰的数据适配与领域模型，并最终提供一个可以在本地运行的分析产品。

项目强调：

- **本地优先**：核心数据处理和分析能力计划在用户自己的环境中运行。
- **来源隔离**：每个外部来源通过独立适配层接入，不让业务逻辑直接依赖 VDF、KV3 或第三方 JSON 布局。
- **版本可追溯**：派生数据记录来源仓库、commit、原始路径、客户端版本和转换器版本。
- **产品边界明确**：外部仓库提供参考数据；Medota2 计划负责比赛数据接入、标准化、分析、存储和展示。

## 当前有什么

| 已有内容 | 尚未实现 |
| --- | --- |
| 三类 Dota 2 外部数据源的结构调研 | 技术栈与应用架构 |
| 数据源职责、选源和冲突处理原则 | API、回放或本地比赛数据接入 |
| provenance 与再分发注意事项 | 数据库、分析指标和领域模型 |
| 初始项目说明和开发约束 | CLI、本地服务、Web UI 和发布包 |

当前没有启动、构建或安装命令。请不要把路线图中的规划视为已经交付的能力。

## 外部数据源调研

这些仓库是可选的独立上游来源，不会随 Medota2 一起发布，也尚未成为已集成依赖：

| 上游仓库 | 主要职责 | 本仓库说明 |
| --- | --- | --- |
| [SteamDatabase/GameTracking-Dota2](https://github.com/SteamDatabase/GameTracking-Dota2) | 客户端、引擎、协议和非 VPK 文件的可追踪快照 | [详细说明](docs/repositories/game-tracking-dota2.md) |
| [spirit-bear-productions/dota_vpk_updates](https://github.com/spirit-bear-productions/dota_vpk_updates) | `pak01_dir.vpk` 内玩法、文本、UI 等资源的提取/反编译快照 | [详细说明](docs/repositories/dota-vpk-updates.md) |
| [odota/dotaconstants](https://github.com/odota/dotaconstants) | 面向应用消费的标准化 Dota 2 常量 JSON/ESM 包 | [详细说明](docs/repositories/dotaconstants.md) |

三者的关系和选源建议见[外部仓库总览](docs/repositories/README.md)。它们都不提供可直接分析的比赛历史数据；比赛数据仍需要由 Medota2 通过 API、回放文件或本地采集器接入。

## 规划中的职责边界

```text
客户端/协议快照 ─┐
VPK 原始资源 ────┼──> 来源适配与标准化 ──> Medota2 领域模型 ──> 分析 / 存储 / 展示
应用层常量 ──────┘                 ↑
比赛 API / 回放 / 本地采集 ─────────┘
```

外部文件的存在不代表它们属于产品 schema。未来的实现应先转换到来源专属 DTO，再映射到 Medota2 自己的领域模型，并对缺失字段、ID 映射、补丁切换和来源冲突建立测试。

## 仓库结构

```text
Medota2/
├── AGENTS.md              # 面向自动化开发代理的项目约束
├── README.md              # 项目入口与当前状态
└── docs/
    └── repositories/      # 外部数据源职责、结构和选源调研
```

## 开始了解项目

```bash
git clone https://github.com/CharlesLiuyx/Medota2.git
cd Medota2
```

然后从以下文档开始：

1. [外部仓库总览与选源指南](docs/repositories/README.md)
2. [GameTracking-Dota2](docs/repositories/game-tracking-dota2.md)
3. [dota_vpk_updates](docs/repositories/dota-vpk-updates.md)
4. [dotaconstants](docs/repositories/dotaconstants.md)

## 路线图

- [x] 梳理外部数据源的职责与风险。
- [x] 建立独立 Git 仓库和公开项目说明。
- [ ] 明确首个可运行版本的用户场景、输入与输出。
- [ ] 通过 ADR 选择技术栈和本地应用形态。
- [ ] 实现第一个带 provenance 的数据适配器与领域模型。
- [ ] 接入一条可分析的比赛数据链路。
- [ ] 交付最小本地分析闭环及自动化测试。

路线图只表达顺序，不承诺发布日期。

## 数据溯源要求

未来生成的派生数据至少应记录：

- 来源仓库与上游 URL；
- 实际读取的 Git commit 和仓库相对路径；
- 能识别时的客户端版本或 Source revision；
- 导入时间、导入器版本和目标 schema 版本。

详细字段约定见[外部仓库总览中的 provenance 清单](docs/repositories/README.md#provenance-最小清单)。

## 参与项目

目前最有价值的贡献是完善产品范围、数据来源证据、首个分析场景和架构决策。提交实现前，建议先通过 GitHub Issue 说明目标、输入输出和会引入的数据来源。

## 许可

本项目尚未选择开源许可证。公开可见不等于授予复制、修改或再分发许可；在仓库加入明确许可证之前，保留所有权利。

外部数据源还可能包含 Valve 或其他第三方内容，其许可不由 Medota2 仓库决定。不要未经审查把客户端文本、图片、声音或反编译资产打包进产品。

## 声明

Medota2 是非官方社区项目，与 Valve Corporation、Dota 2、SteamDatabase、OpenDota 及其他上游项目没有隶属或背书关系。Dota 2 和相关商标、游戏内容归其各自权利人所有。
