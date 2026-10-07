# 实体版本架构第一阶段实施记录

日期：2026-10-07。范围：为下一次游戏版本更新准备全局版本读上下文、历史查询和结构化端点比较；后续完整目标见[任务](../work/entity-version-diff.md)，现行行为见[实体版本合同](../specs/entity-versions.md)。

## 基线与范围

- 环境：GofurMacM4Max128GB，当前工作区，共享预览 `http://127.0.0.1:3000`，真实业务读取身份为local-review；数据库测试使用test／synthetic-fixture。
- 代码：`main / 4fdce38eba48a04c26fdb761b850dbe9ba5d6725` 加本轮未提交修改。保留此前地图UI实现；本轮没有新增依赖、迁移或运行环境。
- 目标及实际业务快照：`eef4400bab9426e0d508e04432a0f9424d241beb7a131e2659da0ba1482f5326`，数据提交 `d786117aab83a8e1d67b08775ac9f872b0dd656c`。结束核对data:status为code-modified，problems为空，业务摘要及head未变。
- Catalog：`3afd349f-9081-4c11-9c0d-8be765137ec9`，客户端6918，补丁7.41e，来源commit `991daaf6fc24b08445209d9ce8767e145bab107e`；127英雄、2703技能，仅一版真实Catalog。匹配英雄／技能资产 `e06b90d7-45e6-4919-a0a2-4185152246ef`。
- 地图：独立Collection版本7.41e及7.41f-6944；分别保留来源和客户端证据，没有通过日期或当前checkout猜测关联。

## 已落地与决定

顶栏Release切换作用于英雄、技能、单位、地图和变化页；URL显式固定版本，搜索、清空、语言、详情与关系跳转保持上下文，各标签页独立。Catalog head只选择默认入口；候选不公开，历史已发布Catalog可查。每份地图保留稳定m:入口，后续同补丁Catalog发布不会使旧地图链接消失。对应资产、来源和缓存按所选Catalog读取。

Diff直接比较两个完整端点，记录字段前后值、关系、已解析机制、来源结构与双方证据，明确区分未出现、null、缺资料和身份歧义。解析／模型实现变化单独返回，未知结构列待核对。变化页支持对象／类别筛选和分页。存储沿用不可变全量快照，同步沿用全部历史Catalog、来源与地图包，无新增业务迁移或同步格式。

已回写Catalog、单位、地图、缓存、语义UI、同步Spec及数据流，新增ADR0009；图谱更新data-graph、cache-graph、versions-graph及当前状态。版本组合、稳定身份、覆盖边界与后续扩展由实体版本Spec维护。

## 验证

`pnpm check`按9项计划完成格式、lint、文档、类型、单元、journeys、既有E2E、数据库和5轮解析样例检查；文档收尾后重新运行确认有效结果。

- 单元：61个文件，294项通过、2项既有平台条件跳过；新增三个synthetic-fixture端点覆盖属性修改与还原、临时新增后撤回、关系与机制、null／未出现、缺资料、重复身份和未知结构。
- Journeys：5项通过、1项仅限固定fixture的既有检查在真实工作台跳过；全局版本保持、独立标签页、缺图鉴覆盖、搜索清空与单位输入均核对。
- 既有英雄／技能E2E：16项通过；版本URL、双语、离线回退、目录分块、404、tooltip、移动布局和键盘焦点保留。
- 数据库：21项通过；三个合成Catalog依次发布后默认入口选择C，A／B／C显式元信息、详情与关联关系均保持所属版本，未发布候选不出现在公共索引，也不能使用列表读取。
- 解析样例：5轮通过，当前样例median 4.1ms、p95 4.2ms、peak 74MB；该样例不代表Diff端到端性能。
- 文档与图谱：索引、链接、命令和Context入口无错误；图谱交互证据见下文。

输入准备问题通过hydration状态阻止交互就绪前的筛选输入；既有URL断言补全release，并等待入口版本重定向完成。保持原结果、键盘焦点和移动布局断言，未降低检查标准。

真实API核对：版本索引200；同一Catalog端点比较0条变化，已知缺项使整体状态partial；两份地图比较200，3条来源结构变化、92条待核对记录，未将不完整身份判作增删。人工浏览核对顶栏、跨页面版本保持及390px布局，保存切换器预览。

图谱DOM、链接和交互检查通过：8幅图、76个节点，节点详情与来源文件、图例、箭头标签、导航、折叠、主题和字号均核对。该检查不代表对每种浏览器完成视觉验收。

本机附件：`.medota2/sessions/codex-entity-version-implementation-20261007.md`、`.medota2/sessions/entity-version-atlas-verify.cjs`、`.medota2/sessions/entity-version-atlas-verification.json`、`output/playwright/entity-version-global-switcher.png`；仅属于本机上述代码／数据基线，跨机器按命令复现，不假定附件可用。

复现：

```bash
pnpm check --plan
pnpm check
pnpm docs:check
pnpm data:status
node .medota2/sessions/entity-version-atlas-verify.cjs
```

## 下一次更新与未完成范围

按既有候选导入、Review、资产准备与发布门禁生成完整新版，保留旧Catalog及其固定来源；核对新版默认入口、旧版显式页面与关系、缓存隔离、相邻和跨版本Diff，再验收跨机器完整快照往返。

当前真实数据只有一版Catalog；三版合成测试不代替真实多Catalog及跨机器验收。独立Unit Dataset持久化、完整机制／脚本解释、地图区域稳定身份、可靠改名／拆分／合并映射仍在后续范围。第一阶段准备完成后继续这些任务，不将全部实体版本目标标为完成。

## 后续 UI 修正：下拉箭头（2026-10-07）

环境GofurMacM4Max128GB，代码main／4fdce38与本轮未提交改动；复用local-review的7.41e／7.41f，纯样式与图标修改，无业务数据写入。

单选与多选菜单的9px字符箭头改为14px ChevronDown SVG、描边权重2.5，继承文字颜色；触发器16px行高与固定图标盒按中心对齐。比较页三个箭头中心一致，顶栏、英雄筛选和地图24／26／30px控件的图标中心偏差均为0px。预览连接超时通过重启共享工作台恢复，未改数据库身份。

范围 `pnpm check --files src/components/ui/compact-select.tsx src/components/ui/compact-filter-menu.tsx src/app/globals.css docs/design-system.md docs/specs/semantic-game-ui.md` 六项通过：35地图专项单测、6共享浏览流程，1既有fixture条件跳过；另运行3个CompactSelect交互测试通过。记录 `.medota2/checks/1791347934382-29264b47/run.json`，本机截图 `output/playwright/dropdown-arrow-alignment.png`；其他机器重跑该命令与比较页查看，不假定拥有本机附件。组件职责与依赖关系不变，图谱无需调整。

## 玩家可读变化验收

2026-10-07，Mac共享3000，main@4fdce38与变化页未提交实施，业务数据为7.41e／6918和7.41f／6944两个已发布Catalog。按英雄及技能／天赋、物品分组显示中文名称与前后值，官方说明对应到同一对象；标量／等级数组和机制投影重复合并，全部来源仍可展开。当前57个分组、119项可读数据变化，另有未解释记录及地图身份边界。官方7.41f响应重新获取后SHA-256仍为`6d8f6754b286391dd68008a656cf516f731aa4470dae569d6c7a57380c774a95`。

- 展示专项7项单元测试通过：护甲与百分比、每级值、缺失／null／零、未知引擎字段、端点天赋文本、成长间隔、官方提交边界及物品证据。
- 变化页2项真实浏览旅程通过（本机`.medota2/shared-tests/runs/1791349410239-919143da`）：共享下拉与URL恢复；中文名称／官方说明／图纸价格／反向数值与来源／390px无横向溢出。
- 指定4项既有数据库合同通过（同机`.medota2/shared-tests/runs/1791349410560-fa1a2252`）；其余17项不在本次选择范围。
- 格式、lint、类型与文档检查通过；全仓联合检查`.medota2/checks/1791349345078-88fe3d97/run.json`仍失败于并行全局语言任务的悬停旧断言：期望`/heroes/0`，实际为`/heroes/0?lang=zh-CN`。保留断言，不将专项结果报告为全仓通过；该任务完成后需重跑联合检查。期间物品／语言热更新还曾导致旧旅程加载超时及临时类型错误，后续类型检查已恢复。
- 实际截图在本机忽略目录`output/playwright/readable-version-changes.png`，1274×900，两个固定Catalog的正向比较；原浏览器错误页由并行服务重启导致，新开同目标预览已恢复。截图不属于跨机器交付附件。

行为与后续说明来源接入见[实体版本合同](../specs/entity-versions.md#玩家可读变化与官方说明)，本轮没有迁移、数据发布、提交或推送。

共享i18n随后增量包装变化页文案，类型检查再次通过；对应浏览旅程重跑在启动时遇到共享Catalog API未就绪。因此上面的专项结果保留其执行基线，不能作为所有后续并行改动的验收。联合复验待该任务完成；数值／来源展示逻辑未被本任务进一步改写。
