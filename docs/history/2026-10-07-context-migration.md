# Context整理：范围、迁移与验收

日期：2026-10-07。状态：实施中。用户已批准2026-10-06 Plan，并明确要求SSOT、数据流向和每次任务的Context范围。

## 本次范围

- 目标：短入口、明确权威位置、可追溯历史、有效的文档与检查范围门禁。
- 代码基线：`main / 1063ee3`，原 `docs/current.md` 额外6行Mac同步记录；随原文保存，未丢弃。
- 变更：AGENTS、CONTEXT、README、docs、客户端薄入口、package命令、文档检查器、检查规划及相关测试。
- 排除：业务数据、数据库迁移、依赖安装、远程环境操作、Git提交／推送／部署。
- 数据／环境：本机Mac；业务目标仍由lock选择，本次不切换数据。必要检查使用已有共享工作台和受管测试环境。
- 读取：原根入口、环境登记、相关Spec／ADR、检查规划源码与Next本地测试指南。
- 扩展条件：发现新的产品行为问题仅记录；本轮修复文档与脚手架，现有业务断言和数据门禁保持有效。

## 文档归属

当前归属统一见[文档索引](../README.md)，数据节点和身份流向见[数据流](../architecture/data-flow.md)。原current和环境登记的完整快照保留正文及本地证据路径，只调整相对链接；各自首部记录原文件哈希。

下面61个原章节逐项记录去向。历史条目中的通过、未提交、未安装等只适用于当时基线；不会因为迁移而成为最新结论。机器原始附件仍由产生记录的机器持有，不将本机不可读路径声称为已核验。

## 原current章节去向

| 原章节                                                                                                                             | 当前归属或检索入口                                           | 处理                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| [当前目标](2026-10-06-current.md#当前目标)                                                                                         | [入口](../../CONTEXT.md)                                     | 稳定能力归CONTEXT；旧目标留历史               |
| [已确认决定](2026-10-06-current.md#已确认决定)                                                                                     | [入口](../../AGENTS.md)                                      | 执行规则归AGENTS，活动状态归current           |
| [本次实施](2026-10-06-current.md#本次实施)                                                                                         | [入口](../specs/development-workbench.md)                    | 工作台规则归Spec；运行时观察不充当现状        |
| [接手方式](2026-10-06-current.md#接手方式)                                                                                         | [入口](../../AGENTS.md)                                      | 执行规则归AGENTS，活动状态归current           |
| [已知情况](2026-10-06-current.md#已知情况)                                                                                         | [入口](../specs/opendota-secret.md)                          | 配置合同保留；提交状态归历史                  |
| [验证记录](2026-10-06-current.md#验证记录)                                                                                         | [入口](2026-10-06-current.md#验证记录)                       | 完成／验证／提交的历史证据原位保存            |
| [头像问题修复](2026-10-06-current.md#头像问题修复)                                                                                 | [入口](../specs/development-workbench.md)                    | 工作台规则归Spec；运行时观察不充当现状        |
| [后续接手](2026-10-06-current.md#后续接手)                                                                                         | [入口](../../AGENTS.md)                                      | 执行规则归AGENTS，活动状态归current           |
| [英雄与技能语义化界面](2026-10-06-current.md#英雄与技能语义化界面)                                                                 | [入口](../specs/semantic-game-ui.md)                         | 当前玩家展示归语义UI；中间尺寸／验收归历史    |
| [紧凑目录与无装饰线界面](2026-10-06-current.md#紧凑目录与无装饰线界面)                                                             | [入口](../specs/semantic-game-ui.md)                         | 当前玩家展示归语义UI；中间尺寸／验收归历史    |
| [英雄详情继续提高密度](2026-10-06-current.md#英雄详情继续提高密度)                                                                 | [入口](../specs/semantic-game-ui.md)                         | 当前玩家展示归语义UI；中间尺寸／验收归历史    |
| [技能 Tab 风格统一](2026-10-06-current.md#技能-tab-风格统一)                                                                       | [入口](../specs/semantic-game-ui.md)                         | 当前玩家展示归语义UI；中间尺寸／验收归历史    |
| [主 Logo 候选选稿](2026-10-06-current.md#主-logo-候选选稿)                                                                         | [入口](../assets/medota2-icon.md)                            | 选稿结果／来源归图标记录                      |
| [实时搜索、统一菜单与章节导航](2026-10-06-current.md#实时搜索统一菜单与章节导航)                                                   | [入口](../specs/browser-catalog-cache.md)                    | 缓存行为归缓存与语义UI；阶段验收归历史        |
| [单位 Tab 与同版本只读图鉴](2026-10-06-current.md#单位-tab-与同版本只读图鉴)                                                       | [入口](../specs/unit-catalog.md)                             | 当前单位／图片能力及缺项归Spec                |
| [图鉴 Local-first 与交互性能](2026-10-06-current.md#图鉴-local-first-与交互性能)                                                   | [入口](../specs/browser-catalog-cache.md)                    | 缓存行为归缓存与语义UI；阶段验收归历史        |
| [天赋卡片常显等级](2026-10-06-current.md#天赋卡片常显等级)                                                                         | [入口](../specs/semantic-game-ui.md)                         | 当前玩家展示归语义UI；中间尺寸／验收归历史    |
| [影魔毁灭阴影展示合并](2026-10-06-current.md#影魔毁灭阴影展示合并)                                                                 | [入口](../specs/semantic-game-ui.md)                         | 当前玩家展示归语义UI；中间尺寸／验收归历史    |
| [单位头像资产与组合验收](2026-10-06-current.md#单位头像资产与组合验收)                                                             | [入口](../specs/unit-catalog.md)                             | 当前单位／图片能力及缺项归Spec                |
| [地图 Tab 与版本独立的真实俯视图](2026-10-06-current.md#地图-tab-与版本独立的真实俯视图)                                           | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [GitHub 项目同步](2026-10-06-current.md#github-项目同步)                                                                           | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [Windows 本地游戏资源来源](2026-10-06-current.md#windows-本地游戏资源来源)                                                         | [入口](../development-environments.md)                       | 机器能力归登记；原生证据归本机地图来源        |
| [多环境 Git 数据同步设计](2026-10-06-current.md#多环境-git-数据同步设计)                                                           | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [环境职责与任务推荐](2026-10-06-current.md#环境职责与任务推荐)                                                                     | [入口](../development-environments.md)                       | 机器能力归登记；原生证据归本机地图来源        |
| [多环境数据同步首版实现](2026-10-06-current.md#多环境数据同步首版实现)                                                             | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [Windows 原生开发方案修订](2026-10-06-current.md#windows-原生开发方案修订)                                                         | [入口](../development-environments.md)                       | 机器能力归登记；原生证据归本机地图来源        |
| [Windows Codex CLI 本地安装](2026-10-06-current.md#windows-codex-cli-本地安装)                                                     | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [Windows 地图真实数据调研](2026-10-06-current.md#windows-地图真实数据调研)                                                         | [入口](../development-environments.md)                       | 机器能力归登记；原生证据归本机地图来源        |
| [地图版本集合与本机6944数据（2026-10-06）](2026-10-06-current.md#地图版本集合与本机6944数据2026-10-06)                             | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [营地收益、兵线时间轴与地图交互（2026-10-06）](2026-10-06-current.md#营地收益兵线时间轴与地图交互2026-10-06)                       | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [树木方块与营地边界对比度（2026-10-06）](2026-10-06-current.md#树木方块与营地边界对比度2026-10-06)                                 | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [营地与兵线悬停、经验收益（2026-10-06）](2026-10-06-current.md#营地与兵线悬停经验收益2026-10-06)                                   | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [静态寻路、树木网格与营地提示（2026-10-06）](2026-10-06-current.md#静态寻路树木网格与营地提示2026-10-06)                           | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [地图性能、闪烁修复及紧凑布局（2026-10-06）](2026-10-06-current.md#地图性能闪烁修复及紧凑布局2026-10-06)                           | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [地图标题提示与工具栏合并（2026-10-06）](2026-10-06-current.md#地图标题提示与工具栏合并2026-10-06)                                 | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [异步寻路、湍流、阻挡及地图操作迭代（2026-10-06）](2026-10-06-current.md#异步寻路湍流阻挡及地图操作迭代2026-10-06)                 | [入口](../specs/map-explorer.md)                             | 地图行为归Spec；引擎未验边界保留              |
| [Windows 本地改动与远程 main 整合（2026-10-06）](2026-10-06-current.md#windows-本地改动与远程-main-整合2026-10-06)                 | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [Windows 多环境同步配置（2026-10-06）](2026-10-06-current.md#windows-多环境同步配置2026-10-06)                                     | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [Windows 重启后恢复进展（2026-10-06）](2026-10-06-current.md#windows-重启后恢复进展2026-10-06)                                     | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [本地工作台启动复核（2026-10-06）](2026-10-06-current.md#本地工作台启动复核2026-10-06)                                             | [入口](../specs/development-workbench.md)                    | 工作台规则归Spec；运行时观察不充当现状        |
| [Windows 数据库同步完成（2026-10-06）](2026-10-06-current.md#windows-数据库同步完成2026-10-06)                                     | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [Windows 兼容修复提交交接（2026-10-06）](2026-10-06-current.md#windows-兼容修复提交交接2026-10-06)                                 | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [7.41f 地图未同步根因（2026-10-06）](2026-10-06-current.md#741f-地图未同步根因2026-10-06)                                          | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [完整数据统一推送与多机器同步（2026-10-06）](2026-10-06-current.md#完整数据统一推送与多机器同步2026-10-06)                         | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [Mac 拉取远端代码（2026-10-06）](2026-10-06-current.md#mac-拉取远端代码2026-10-06)                                                 | [入口](2026-10-06-current.md#mac-拉取远端代码2026-10-06)     | 完成／验证／提交的历史证据原位保存            |
| [Mac 本地工作台启动（2026-10-06）](2026-10-06-current.md#mac-本地工作台启动2026-10-06)                                             | [入口](../specs/development-workbench.md)                    | 工作台规则归Spec；运行时观察不充当现状        |
| [Mac 7.41f 地图缺失诊断（2026-10-06）](2026-10-06-current.md#mac-741f-地图缺失诊断2026-10-06)                                      | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [Mac 项目空间审计（2026-10-06）](2026-10-06-current.md#mac-项目空间审计2026-10-06)                                                 | [入口](../specs/development-workbench.md#自动保留与日志容量) | 现行保留合同归Spec；计量与清理收据归历史      |
| [Mac 工作台复用确认（2026-10-06）](2026-10-06-current.md#mac-工作台复用确认2026-10-06)                                             | [入口](../specs/development-workbench.md)                    | 工作台规则归Spec；运行时观察不充当现状        |
| [Mac 项目空间清理完成（2026-10-06）](2026-10-06-current.md#mac-项目空间清理完成2026-10-06)                                         | [入口](../specs/development-workbench.md#自动保留与日志容量) | 现行保留合同归Spec；计量与清理收据归历史      |
| [Mac 完整7.41f快照同步验收（2026-10-06）](2026-10-06-current.md#mac-完整741f快照同步验收2026-10-06)                                | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [自动空间保留策略（2026-10-06）](2026-10-06-current.md#自动空间保留策略2026-10-06)                                                 | [入口](../specs/development-workbench.md#自动保留与日志容量) | 现行保留合同归Spec；计量与清理收据归历史      |
| [本机变更提交交接（2026-10-06）](2026-10-06-current.md#本机变更提交交接2026-10-06)                                                 | [入口](2026-10-06-current.md#本机变更提交交接2026-10-06)     | 完成／验证／提交的历史证据原位保存            |
| [本地项目空间分析（2026-10-06）](2026-10-06-current.md#本地项目空间分析2026-10-06)                                                 | [入口](../specs/development-workbench.md#自动保留与日志容量) | 现行保留合同归Spec；计量与清理收据归历史      |
| [同步链路性能审阅（2026-10-06，已审阅；实施结果见下文）](2026-10-06-current.md#同步链路性能审阅2026-10-06已审阅实施结果见下文)     | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [同步完成后的空间复查（2026-10-06 21:32，Asia/Singapore）](2026-10-06-current.md#同步完成后的空间复查2026-10-06-2132asiasingapore) | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [项目空间清理执行（2026-10-06）](2026-10-06-current.md#项目空间清理执行2026-10-06)                                                 | [入口](../specs/development-workbench.md#自动保留与日志容量) | 现行保留合同归Spec；计量与清理收据归历史      |
| [同步链路性能优化实施（2026-10-06）](2026-10-06-current.md#同步链路性能优化实施2026-10-06)                                         | [入口](../specs/development-data-sync.md)                    | 已实现协议归Spec；操作归runbook；旧阻塞归历史 |
| [Windows 拉取远端并整合本地工作（2026-10-06）](2026-10-06-current.md#windows-拉取远端并整合本地工作2026-10-06)                     | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [Windows 本地变更交接 main（2026-10-06）](2026-10-06-current.md#windows-本地变更交接-main2026-10-06)                               | [入口](../work/windows-native-validation.md)                 | 已完成同步归历史；未解决平台失败归任务        |
| [Mac 拉取远端变更（2026-10-06）](2026-10-06-current.md#mac-拉取远端变更2026-10-06)                                                 | [入口](2026-10-06-current.md#mac-拉取远端变更2026-10-06)     | 完成／验证／提交的历史证据原位保存            |

## 仍需保留的边界

- Windows原生浏览／构建失败及Node兼容限制：[复验任务](../work/windows-native-validation.md)。
- 地图引擎语义、碰撞、湍流及收益结算未核验；当前规则仍是静态估算。
- 单位定义与补充本地化尚未完整持久化；单位缺图及目录分块缺口继续保留。
- 远程生产、云端全流程与比赛／replay领域为后续能力。
- 旧legacy栈cutover的凭据／权限／连接操作仍要求明确授权。

## 验收记录

本轮在`GofurMacM4Max128GB`、Node26.8.1／pnpm11.7.0、`main / 1063ee3`加本轮未提交改动上执行。没有改产品运行代码、业务版本或数据库合同，没有安装依赖、提交或推送。测试使用共享工作台和受管测试库；保留既有Mac同步记录。Windows与远程CI未执行。

| 检查         | 结果与范围                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| 完整按需组合 | `pnpm check --plan`选择9项，`pnpm check`全部通过；2026-10-07 00:39:57至00:41:35（Asia/Singapore），约98秒            |
| 文档门禁     | 48份docs文档全部登记，Markdown链接／锚点、替代无环、现行命令和客户端入口通过；不读取大型HTML正文、不联网执行文中命令 |
| 门禁正反场景 | Node test 2项通过：覆盖失效文件／标题、未知命令、漏登记、客户端缺项、替代环和基础Context预算                         |
| 检查规划     | 11项回归通过：纯文档、地图算法／组件、单位、共享依赖、迁移、工具链、混合及删除／改名路径                             |
| 静态与单测   | 格式、ESLint、TypeScript通过；60个测试文件，289项通过、2项原有条件跳过                                               |
| 浏览流程     | 英雄、技能、tooltip／移动布局、单位4项通过；真实数据模式下1项固定fixture数值检查跳过                                 |
| 数据库       | 规划选定4项通过；其他17项未选中；没有声称运行完整隔离数据库合同套件                                                  |
| Web产物      | Next16.3.3构建、standalone复制及独立启动验收通过；无远程部署                                                         |
| 历史完整性   | 两份历史正文移除迁移新增的链接前缀后，SHA-256与归档头记录一致；旧current61个章节均有迁移行                           |

本机完整收据：`.medota2/checks/1791304797817-e8b26694/run.json`及同目录日志。产物key为`d95115725d41960a164965fd7d2536b5c2f1293594e292e561fa65ced8c124cb`；这些是Mac本地附件，其他机器按本页命令复现。收尾仅更新交接文档，再执行对应文档范围检查。

### 接手演练

仅从AGENTS、CONTEXT、current、环境登记及任务导航出发，按下列路径核对合同、代码、版本和计划；这是同一Session的静态接手演练，未启动其他模型或客户端代替用户验收。

| 场景          | 可找到的范围及结果                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 图鉴UI        | 导航→语义UI／设计系统→hero-card；按需加载列表／缓存；Catalog版本从head读取；规划为格式、文档、类型和heroes浏览                              |
| 地图寻路      | 导航→地图Spec／对应来源→domain/map/routing；版本按Map Dataset独立选择；选12个已有地图测试文件，无产品数据库、浏览、Hero解析bench            |
| 同步／Windows | 导航→同步Spec／runbook／ADR0008→data-sync/restore与平台任务；目标以lock为准；规划扩大单测、浏览、数据库、构建，原Windows异常不被Mac通过解除 |
| 纯文档        | 导航→事实权威页及引用方；规划只选格式与docs，无数据库／浏览器／构建                                                                         |
| 单位补充核对  | units repository选3个单位专项、units浏览及数据库检查，源码缺项继续由单位Spec维护                                                            |

客户端入口按[Claude Code导入规则](https://code.claude.com/docs/en/memory#import-additional-files)与[OpenCode规则](https://opencode.ai/docs/rules/)核对：CLAUDE显式导入四份基础材料；OpenCode原生读取AGENTS，instructions补其余三份。检查器验证这些路径及覆盖；实际客户端设置可能影响加载，未声称运行过跨客户端对话验收。

基础四文件从128,391字节降到约20 KiB以内；减少的是默认Context输入，不表示Git历史或整个docs体积等比例减少，也不承诺模型零遗漏。检查器不验证远程链接、自然语言全部语义、任意CLI参数和历史命令可执行性。
