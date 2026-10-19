# 英雄详情布局与等级验收

日期：2026-10-13；环境：GofurMacM4Max128GB，现有共享工作台。代码基线main／a05bc58及本次未提交修改，保留既有Tab缓存／地图任务改动。业务锁仍为snapshot bee227bd、data commit12bcfdff，未更改数据或迁移。

## 已实现

- 英雄主要信息在左、属性在右，1024px以下上下排列；保留原属性锚点并移除“属性”导航项。
- 英雄等级1–30，三围按同版基础值和成长更新；其他属性仍明确标为基础值，计算边界放入属性标题提示。
- 简介使用现有PageInfoTooltip／HoverTooltip，支持悬停、键盘和点击。
- 英雄技能卡显示当前等级、最高等级；选级同步基础参数、描述、冷却、魔耗和神杖／魔晶升级。优先显式max_level，缺少时从有效等级数列取支持上限，排除顶层全零继承默认值；不能确认时显示缺项。
- 影魔三种毁灭阴影保留距离切换及当前等级；独立技能详情继续显示完整等级数列。等级仅为本地阅读状态，不模拟加点限制或完整战斗属性。

行为归属：[语义UI](../specs/semantic-game-ui.md#英雄详情布局与等级)；实现入口及关系已同步[图谱](../architecture/project-atlas.html)。

## 验证

本机完整范围检查通过：格式、ESLint、类型、文档、549单元（2既有跳过）、44真实浏览（1仅fixture适用用例跳过）、桌面／移动6视觉；浏览无重试。新增浏览流程覆盖英雄等级、技能等级、简介Tooltip／Escape、属性导航移除、左右布局和390px无横向溢出。

复现命令：

```bash
pnpm check --files 'src/app/heroes/[slug]/page.tsx' src/components/hero-overview.tsx src/components/hero-section-nav.tsx src/components/ability-tooltip.tsx src/components/shadowraze-card.tsx src/presentation/ability-levels.ts src/i18n/en.json src/i18n/zh-CN.json tests/unit/hero-levels.test.tsx tests/journeys/catalog.spec.ts scripts/development/check-plan.mjs
```

本机检查收据为`.medota2/checks/1791887143136-992df8b9/run.json`；忽略目录文件仅在本机可用。首轮新单测缺少JSDOM scrollIntoView替身，随后类型检查发现索引类型和Testing Library参数问题，均已修复；最终上述范围全部通过，未降低检查标准。

真实7.41f斯温抽样：1级三围24／18／16，30级125.5／81.8／59.5；风暴之拳1→4级伤害80→320、冷却21→12秒，神之力量上限3级，神之愤怒上限1级。英文影魔毁灭阴影4级切换远距离后仍为4级，伤害280、距离700；中英文与手机简介可读。截图`.medota2/sessions/hero-levels-preview.jpg`属于本机上述代码／数据基线；复现以启动命令报告origin进入`/heroes/sven`，选择英雄30级和风暴之拳4级。

本次未做生产构建、Windows复验、提交或发布；页面人工审阅仍待完成。

## 顶部空间与滑块续改

按用户追加的截图，将顶部改为英雄信息、紧凑四行天赋树、属性三列；1280px以上并排，768–1279px英雄／天赋并排、属性另占一行，更窄屏幕依次堆叠。天赋不再重复出现在技能下方，移除天赋导航项，原锚点和详情链接保留；命石改为完整宽度内的卡片网格。

英雄等级改为1–30、步长1的原生滑块，常显当前值／30，拖动和键盘输入共用三围更新。实际核对Home到1、End到30、右方向键到2级；2级斯温为27.5／20.2／17.5。中文390px、英文1024px及宽屏三列均无横向溢出。顶部截图为本机`.medota2/sessions/hero-overview-slider-preview.jpg`。

检查中修正两项既有测试假设：完整英雄列表已因首屏预加载改为194条分布于2块，原“至少5块”断言失效；现改为194条且194个唯一身份，保留完整分组、连续排布、滚动回收和恢复检查。详情fixture因天赋上移而变短，滚动命石会触底并按既有规则高亮故事；章节跟踪测试使用已有滚动余量辅助，再移除余量单独检验触底高亮，保留锚点避让、点击和手机断言。两项首次失败均经过同轮单次重试确认，修复未降低原行为门禁。

React跨服务器／客户端插槽的元素补齐稳定key；专项浏览断言页面无缺key警告，桌面／移动各1项均通过，无重试。

续改最终检查：格式、ESLint、类型、文档、11相关单元、44真实浏览通过（1项fixture条件跳过）。完整heroes E2E未通过：在线回退搜索用例从详情返回列表后清除搜索，首次输入值未清除，单次重试输入清除后未出现预期列表项；语言切换用例首次等待English选项超时、重试通过，记为flaky。该轮6项通过、1项失败、1项flaky、10项未运行。已核对筛选回调、返回时URL恢复与缓存挂载流程，原因尚未确认；本轮未修改这些共享列表实现。组合收据为`.medota2/checks/1791888460044-bb53cb76/run.json`，详情专项日志为`.medota2/sessions/hero-overview-slider-targeted-final.log`，均仅本机可用。

组合检查复现：

```bash
pnpm check --files src/components/hero-overview.tsx 'src/app/heroes/[slug]/page.tsx' src/components/hero-section-nav.tsx tests/unit/hero-levels.test.tsx tests/journeys/catalog.spec.ts tests/e2e/heroes.spec.ts docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html docs/history/2026-10-13-hero-detail-levels.md
```

顶部布局及滑块实现与详情专项验证完成，页面待人工审阅；完整回归仍受上述失败阻塞，不能沿用前轮全通过结论。下一步定位在线回退返回后的筛选恢复，并复验语言切换稳定性。

## 随等级变化的可视化基础属性

新增`hero-stats`纯计算投影，服务端仅传入所需英雄标量和固定来源commit，客户端滑块同步三围、生命／魔法上限与恢复、攻击上下限、护甲、攻击速度及魔抗。绿色血条、蓝色魔法条和四项成长条以同英雄30级为参照并标出1级；常显图例说明含义，图条提供可访问meter数值，减少动态效果偏好下关闭过渡。移动速度与攻击距离常显；原始基础值及前摇／间隔／视野收进展开区。未审阅版本／缺失字段显示缺项，不假定零值；不计装备、技能被动、天赋与命石。公式和新增攻击来源依据回写[属性合同](../specs/attribute-catalog.md#英雄等级基础面板)，布局行为回写语义UI与图谱。

最终文件范围检查通过格式、ESLint、类型、文档、551单元（2既有跳过）和44真实浏览（1 fixture条件跳过），浏览无重试。首轮新增单测误把既有无分组数值格式期望为“2,881”，按现有格式修正为“2881”，数值断言保留。计算验证含斯温1／30级已知答案、四种主属性攻击、缺字段／零值／未知版本；既有浏览旅程增加血条、蓝条、攻击力随等级变化与回到1级恢复，以及30级图条满长。

本机斧王7.41f：1→30级生命670→2392.6、魔法291→847.8、攻击56–60→134.3–138.3；生命恢复4.5→12.33、魔法恢复0.9→3.22、护甲2.88→10.768、攻速118→167.3、魔抗26.8%→31.44%。中文与英文390px无横向溢出；桌面预览保留斧王30级。截图`.medota2/sessions/hero-stats-preview.jpg`与检查收据`.medota2/checks/1791889321936-4bfd29d5/run.json`仅本机可用，基线及数据锁沿用本文开头。

复现命令：

```bash
pnpm check --files src/presentation/hero-stats.ts src/components/hero-overview.tsx 'src/app/heroes/[slug]/page.tsx' tests/unit/hero-levels.test.tsx tests/journeys/catalog.spec.ts src/i18n/en.json src/i18n/zh-CN.json scripts/development/check-plan.mjs docs/specs/semantic-game-ui.md docs/specs/attribute-catalog.md docs/architecture/project-atlas.html
```

本轮所选检查全部通过；未重跑前轮存在在线回退清除搜索失败／语言切换flaky的完整heroes E2E，不宣称其已解决。未新增生产构建、引擎实验或跨平台验证；页面待人工审阅，无提交或推送。

## 可选天赋与属性联动

天赋树改为受控选择按钮并保留独立详情链接：重复点击取消，未解锁层级自动升级，通常同层换边；按Valve规则27／28／29／30级允许对应层双选。降级清理失效选择，第二侧失效时保留先选项；清除选择不改变等级。语言切换在当前英雄／Catalog内保持选择；英雄或Catalog切换通过组件身份重置组合。

新增`domain/hero-build`保存纯状态、转换与修饰类型，`presentation/hero-talents`将固定来源的真实AbilityValues适配为效果，`hero-stats`按三围贡献→直接加成→百分比／魔抗组合投影，`hero-talent-tree`只渲染受控状态。当前覆盖三围、生命／魔法及恢复、直接攻击力、护甲、攻速、移速、攻击距离及昼夜视野；技能／条件效果及尚未纳入当前面板的效果均明确提示，不把技能护甲当作英雄常驻护甲。所有规则维持来源commit门禁，值不从ID数字或本地化文案推定。架构、公式、范围与证据分别回写Context、语义UI、属性合同和图谱。

真实斧王验证：1级选择20级“+15力量”自动升20级，力量91.3、生命2128.6、恢复11.13、攻击122.3–126.3；改选“+40反击螺旋伤害”后力量76.3、生命1798.6、恢复9.63、攻击107.3–111.3，技能伤害不误加到普攻。25级天赋自动升级、取消、30级双选、清除、Enter切换及降回1级全部进入真实浏览回归。中文／英文390px无横向溢出，语言切换保持选中力量天赋及属性值。截图`.medota2/sessions/hero-talents-preview.jpg`属于本机本文代码／数据基线。

最终检查通过格式、ESLint、类型、文档、555单元（2既有跳过）、45真实浏览（1 fixture条件跳过）、4所选数据库合同和小样例基线，浏览无重试。首次类型检查发现新增单测误用了Playwright的exact参数，已按Testing Library接口修正；交互／数值断言保留。收据`.medota2/checks/1791890325284-e326d77c/run.json`及日志`.medota2/sessions/hero-talents-check-final.log`仅本机可用。

复现命令：

```bash
pnpm check --files src/domain/hero-build.ts src/presentation/hero-talents.ts src/presentation/hero-stats.ts src/components/hero-talent-tree.tsx src/components/hero-overview.tsx 'src/app/heroes/[slug]/page.tsx' tests/unit/hero-levels.test.tsx tests/journeys/catalog.spec.ts src/i18n/en.json src/i18n/zh-CN.json scripts/development/check-plan.mjs CONTEXT.md docs/specs/semantic-game-ui.md docs/specs/attribute-catalog.md docs/architecture/project-atlas.html
```

本轮所选检查全部通过，完整旧heroes E2E失败结论仍保留；未做生产构建、引擎实测或跨平台复验。无提交／推送，页面待人工审阅。

## 技能卡天赋联动（2026-10-14）

- HeroBuildProvider共享英雄等级／天赋状态，按英雄＋Catalog重置；HeroOverview与技能卡读取同一组合。技能自身等级保持独立。
- ability-talents纯投影复用既有修饰语法，先选等级再应用同版天赋modifier，同步参数、基础字段、描述占位符、注释与神杖／魔晶预览；来源对象保持不变。卡片显示已计入天赋，重复／嵌套条件／缺基值明确缺项。
- 固定来源f4c45719314754567cb4ef4fe343bbc790a311f4的scripts/npc/heroes/npc_dota_hero_axe.txt第549–552行：反击螺旋damage为100／120／140／160，special_bonus_unique_axe_4为+40。该技能官方中文描述不含damage占位符，因此数值行变化，原文保留；占位符联动以既有组件已知答案验证。
- 基线沿用本记录的未提交实现与bee227bd／12bcfdff；Mac共享43187，只读业务数据。无安装、迁移或提交推送。
- 最终收据`1791917361197-5e342ff3`：格式／lint／types／docs、557单元（2既有skip）、46真实浏览（1fixture-only skip）、6桌面／移动视觉全部通过，浏览无重试。首次types失败为投影返回类型丢失TooltipAbility索引签名，补足显式返回合同后通过；未改变检查门槛。
- 本机复现：`pnpm test tests/unit/hero-levels.test.tsx tests/unit/dota-presentation.test.ts tests/unit/shadowraze-card.test.tsx`；真实流程`pnpm test:journeys tests/journeys/catalog.spec.ts --grep 'talent modifiers'`。完整按文件范围和日志在本机`.medota2/sessions/skill-talents-check-final.log`、范围卡同名任务中；这些忽略附件不随Git交接。
- 页面实测反击螺旋1级100→140，4级200，取消回160；中英切换保持已选天赋与4级，英文390px无横向溢出，控制台无error／warn。截图`.medota2/sessions/skill-talents-preview.png`，Mac／当前未提交代码及上述数据基线，中文斧王20级、反击螺旋4级、+40天赋。
- 本轮完成实施与适用检查，待用户页面审阅；前轮完整heroes E2E在线回退失败与语言切换flaky未复验，不能据本轮journeys／visual视为已解决。

## 恢复量淡色段（2026-10-14）

血／蓝条实色段末端接浅色段，真实比例表示当前1秒恢复；同天赋30级上限＋该级1秒恢复作为刻度，30级仍显示恢复，其他属性图条保持30级参照。零／负／未知恢复不画段，数字照常；与等级／天赋自动联动，支持减少动态效果偏好及可访问恢复说明。无数据或依赖变更，沿用前轮代码／快照和Mac共享43187。既有测试更新为斯温30级生命2881、恢复13.3、总刻度2894.3的已知比例，并核对恢复段与实色段相接及满级不裁切。最终收据`1791917821222-bbb542a1`：19相关单元、46真实浏览（1fixture-only skip）、格式／lint／types／docs通过，无浏览重试。首轮新增断言把CSS百分比序列化精度误当成模型精度，实际99.999971%在页面无可见偏差；改查实际渲染端点在两个1/64px布局单位内贴齐，保留纯数值6位精度已知答案。

Mac中文斧王19级实测：生命1739.2／恢复9.36、魔法636.6／恢复2.34；桌面淡色段分别2.26px／1.59px，390px无溢出，恢复段使用真实比例。截图`.medota2/sessions/hero-regen-preview.png`与日志`.medota2/sessions/hero-regen-check-final.log`为本机忽略附件，不随Git交接。图谱资料节点与语义合同已同步；待页面人工审阅，无提交／推送。

## 全等级数值与双向约束（2026-10-15）

- 范围：`ability-tooltip`常显全部参数、冷却、魔耗、描述及升级占位数值，仅当前级高亮；`hero-abilities`管理加点预算与双向等级约束，来源适配读取RequiredLevel／LevelsBetweenUpgrades／LinkedAbility／DependentOnAbility，祈求者levelkey读取对应元素等级。未学习不高亮、不计入属性。
- 面板：`hero-ability-stats`按当前合法级别读取已审阅常驻加成；敌法师法术反制和小小长大已接入，其余未适配被动或战斗条件保留覆盖提示。未把所有技能参数自动当作常驻属性。原始Catalog不变。
- 环境：Mac共享43187，main a05bc58加本机未提交组合（包含同时实施的物品任务）；数据lock bee227bd/data12bcfdff。无提交、推送、数据写入或跨机器验证。
- 手工：斧王三级大招自动升18、降1恢复未学习；敌法师四级反制自动升7、魔抗52.732%，降1后反制1、魔抗36.532%；英文390px祈求者冰4级对应急速冷却52伤害高亮，无横向溢出。
- 15项专项单元通过。首轮完整573单元通过；技能首次菜单点击早于ready导致单次flaky，已补交互就绪等待；基础攻击间隔英文漏译已修复。另有名称导航单次flaky，以及共享目录缓存返回英雄详情两次失败；相关任务也复现同一路径，未降低门禁。最终组合检查结果见下文。
- Spec、CONTEXT与图谱data-graph-pages已同步；页面待人工审阅。旧完整heroes E2E在线回退清除搜索与语言切换问题未在本轮完整复验。

本轮最终范围检查`1792054525223-2d6c772b`通过格式、ESLint、类型、文档与575项单元（2项既有跳过）。完整journeys中27通过、1失败、1中断、19未运行、1条件跳过；失败为`viewport: cached hero return keeps URL, filters, details and history usable without a route request`，单项自动重试仍失败，第二次停留在回退／前进后点击单位Tab的可见标题断言。此前同一路径也在进入敌法师详情时失败。目录导航由共享工作区的相关任务整合，本轮保留失败门禁，未以专项通过替代完整通过。

独立补验：4条英雄等级／天赋／技能／移动阅读journeys全部通过且无重试；桌面和移动6项visual通过；既定数据库范围4通过、19不在所选范围内；小样例5次中位6.8ms、P95 10.6ms、峰值75MiB。Mac当前源码与上述数据基线，未跑生产构建、引擎机制或跨平台验证。复现命令：

```bash
pnpm test:journeys tests/journeys/catalog.spec.ts --grep 'heroes: adjustable|real talent selection|talent modifiers|heroes and abilities' --retries=1 --max-failures=1
pnpm test:e2e tests/e2e/visual.spec.ts --project=desktop-chromium --project=mobile-chromium --retries=1 --max-failures=1
pnpm test:integration --testNamePattern 'enforces canonical|partially materialized|bidirectional catalog|applies the checked'
pnpm bench --iterations 5
```

截图`.medota2/sessions/ability-levels-preview.jpg`展示中文斧王普通技能4级、英雄自动升7级，全等级数值保留且当前档金色高亮。日志为同目录`ability-levels-check4.log`、`ability-levels-journeys-targeted.log`、`ability-levels-visual.log`、`ability-levels-database.log`、`ability-levels-benchmark.log`；这些均为Mac本机忽略附件，不随Git交接。实施与本功能专项验证完成。随后共享目录导航修复落地，组合检查`1792054757155-d0860e0e`的576单元（2既有跳过）与48条完整journeys（1条件跳过）通过，浏览无重试；该收据仅文档／格式因同期文档回写过期，代码检查有效。随后按本任务范围再次完整复验，结果如下；页面待人工审阅，无提交或推送。

最终复验`1792055050590-14297af9`复用有效静态检查，浏览30通过、1失败、1中断、16未运行、1条件跳过：缓存目录同一用例首次在`catalog.spec.ts:542`后退后未显示技能图鉴，自动单项重试在`:548`点击单位后未显示单位图鉴。进入详情边界修复未覆盖全部历史导航竞态。技能相关4流程本轮再次通过；未继续重复运行完整浏览，也未降低门禁。失败日志`.medota2/sessions/ability-levels-check-final.log`与对应check收据仅本机可用。实现及专项验收完成，完整门禁仍失败；由正在整合目录导航的任务继续定位并补验，不能用之前48条通过覆盖本次失败。

## 技能等级横向单选（2026-10-15）

所有可调技能等级入口改为原生radio组成的横向按钮组，常显“未学习”和1至最高等级；金色选中态与数值高亮同步。使用组件独立名称隔离各技能，固定／关联技能保留禁用规则，英雄等级和加点约束保持原模型。支持点击、触屏、Tab与方向键，390px自然换行且无横向溢出。语义合同和图谱已同步。

Mac共享43187、main a05bc58加现有未提交组合、bee227bd/data12bcfdff。手工斧王点击2后右方向键选3，独立技能选择互不误改；敌法师法力损毁选2自动升英雄3级，各级数值保留且当前档高亮。截图`.medota2/sessions/ability-level-buttons-preview.jpg`、范围卡和`ability-level-buttons-*.log`为本机忽略附件，不随Git交接。

既有15项技能单测通过；新输入稳定后5条英雄等级／天赋／技能／移动阅读／物品重置浏览全部通过，6项桌面／移动visual通过，均无重试。首次检查的就绪断言仍指向旧下拉触发器，已改为新radio组完成客户端挂载的标记；同轮物品表移动检查曾单次重试，保留flaky记录。共享组合`1792055609421-d681d7a0`虽48浏览通过，但检查启动后本轮补入键盘断言，输入过期；因此补跑上述全部受影响的5条英雄流程，未把过期收据称为完整门禁通过，也未覆盖前述目录导航失败记录。

```bash
pnpm test:journeys tests/journeys/catalog.spec.ts --grep 'heroes: adjustable|real talent selection|talent modifiers|heroes and abilities|inventory search' --retries=1 --max-failures=1
pnpm test:e2e tests/e2e/visual.spec.ts --project=desktop-chromium --project=mobile-chromium --retries=1 --max-failures=1
```

本次交互改动实施及专项验证完成，待页面人工审阅；未安装依赖、修改业务数据、提交或推送。
