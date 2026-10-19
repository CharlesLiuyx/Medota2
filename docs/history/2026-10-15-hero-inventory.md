# 英雄物品和状态验收

## 环境与范围

2026-10-15，Mac共享工作台 `http://127.0.0.1:43187`，local-review／production-snapshot；main `a05bc58` 加本次及既有未提交组合。lock `bee227bd`／业务data `12bcfdff`，未修改业务数据、迁移或发布。原有等级、天赋、技能全等级与目录缓存改动保留；规则见[物品和状态 Spec](../specs/hero-inventory.md)。

天赋移到等级下；中栏标题按用户改为「物品和状态」。六装备槽、双语／拼音搜索、简介、价值、全重置、神杖三模式、魔晶、银月和恢复状态接入；中立物品与附魔独立配置，当前档位和主属性决定候选与值，可保留低档物品搭配高档附魔。包含负面属性、条件状态、珍品强化及附魔师饰物再次打造。

两版固定来源只读审计：6918与6944每版188普通物品、7个消费／赠予状态、49个当前中立物品；四主属性分别核对五档附魔池（4／5／5／5／5候选），不混入历史定义。警觉的近战／远程攻击距离依据同版 `+$attack_range_all` token；狂热的魔法上限减少以明确语义映射处理。

## 验证结果

- 物品专项15个单元测试通过，涵盖已知数值、替换／消费／重复状态、负面属性、档位、低档物品保留、附魔增幅、来源拒绝与升级投影。
- 最终组合收据 `1792056104005-9ab75903`（17:21–17:24）：format、lint、docs、types、unit、journeys、visual、database、benchmark九项全部通过。576单元通过、2既有条件跳过；48完整真实浏览通过、1fixture条件跳过；桌面／移动6视觉通过；4项所选数据库合同通过（19项未纳入本次选择）。最终浏览均无重试，包含目录详情及历史导航回归。此前共享输入变化导致的过期收据已由此次稳定输入验证替代。
- 真实浏览核对斧王持有神杖生命670→1065，吞服恢复670且保持升级，炼金赠予恢复完整属性；银月持有／吞服、魔晶与全重置；中立档位、石羽挎包切换、壮实与附魔师饰物增幅；手机390px无横向溢出。
- 手工宙斯吞服神杖后雷云由锁定变为已解锁、等级1；英文390px标题为Items & States，物品面板无中文残留。

## 性能与失败修复

既有解析小样例基线（6069字节、5次）：中位4.3ms、P95 4.4ms、峰值72MB；这是解析诊断，不代表页面交互耗时。

物品搜索与组合更新纯客户端计算，普通装备变化不通知整本技能上下文。Mac开发模式1600×1000实测6次搜索／6次装备草鞋：事件至DOM提交，搜索9.3–31.8ms、装备6.6–24.1ms；事件至双requestAnimationFrame为13.2–41.4ms。包含首次冷交互，样本用于本机诊断，不当作跨设备或生产P95承诺。神杖与全重置还会更新技能卡，早期并行检查时双帧采样51–113ms；没有宣称绝对零延迟。

最初中立浏览测试使用了未经官方术语替换的按钮名，已按可访问名称修正；一次重跑因共享输入变化过期。完整浏览曾在缓存英雄目录进入详情时失败，后续复试仍flaky，门禁未放宽。定位到本地投影仍挂在上一服务端路由树，补充缓存页进入英雄详情及历史后退离开投影的完整文档导航边界，保留修饰键与历史；单项和最终48条浏览均无重试通过。另一次组合检查中的物品宽表测试在首行尚未可见时读取boundingBox，出现null；已先等待首行可见再测量，原有冻结列、行高和虚拟化断言保持。正常目录继续使用Next导航，合同见[目录缓存](../specs/browser-catalog-cache.md#缓存目录进入详情)。

本机详细日志、截图和性能采样位于 `.medota2/sessions/inventory-*`，只作本机复现附件，不视作跨机器证据包。来源审计命令为 `pnpm exec tsx .medota2/sessions/audit-inventory.ts`（本机脚本）；可移植复核使用上述专项单测与既有旅程。人工体验及同版游戏引擎抽样仍待用户审阅；模拟不包括战斗时间、目标伤害、召唤物与全部条件触发，界面保留说明。

## 装备槽紧凑调整

按用户截图反馈，六槽改为56px等高、4px间距；保留44×32图标，去除名称预留的第二行空白，长名称单行省略且保留完整提示／简介。已装备与空槽保持一致，不因选装改变区域高度。

同一Mac工作台及数据基线，收据 `1792056714135-0d890a48`：格式、lint、文档、类型、37项相关单元及15条英雄浏览全部通过（1项fixture条件跳过），浏览无重试。手工1600×1000与390×844核对闪烁匕首和空槽，手机六槽均56px且页面无横向溢出；本机截图 `output/playwright/inventory-compact-desktop.png` 与 `inventory-compact-mobile.png` 为本机附件。复现命令：`pnpm check --files src/components/hero-inventory.tsx docs/specs/hero-inventory.md`。

## 基础属性常显调整

按用户要求移除“原始基础属性与更多参数”折叠入口，攻击、防御与恢复、移动与视野三组直接显示。桌面1600×1000与手机390×844均核对三组可见、入口不存在且无横向溢出，属性简介继续保留。

同一Mac工作台与数据基线，收据 `1792056867131-6d6e6be6` 六项检查全部通过：37项相关单元、15条英雄浏览通过，1项fixture条件跳过，浏览无重试；首轮格式检查发现JSX需要合并行，格式化后通过。本机截图为 `output/playwright/attributes-visible-desktop.png` 与 `attributes-visible-mobile.png`。复现：`pnpm check --files src/components/hero-overview.tsx docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html`。

## 八槽集中排列

按后续截图箭头，将六普通装备槽收窄到左侧三列两行，中立物品和附魔移到右侧上下排列，八槽共用两行高度；原下方中立槽区移除。中立档位与已选物品状态紧接槽区，物品简介按钮同步缩紧，图标尺寸保留。

收据 `1792057274416-ca5af9b2` 六项通过，37项相关单元及15条英雄浏览成功、1项fixture条件跳过、无重试。沿用Mac43187与当前固定数据基线，1600×1000及390×844手工配置闪烁匕首、石羽小包与壮实附魔：手机六普通槽区域241.5×116px，右侧两槽各80.5×56px，行对齐且无页面横向溢出。截图 `output/playwright/eight-slots-desktop.png`／`eight-slots-mobile.png` 仅作本机附件。复现：`pnpm check --files src/components/hero-inventory.tsx docs/specs/hero-inventory.md docs/architecture/project-atlas.html`。

## 六项属性条单行

生命、魔法、攻击力、护甲、攻击速度、魔法抗性各自改为名称／条／数值单行，生命与魔法恢复数字同行；移除原四项卡片上下分层，保留属性简介、初始刻线与淡色恢复段。

同一Mac工作台与数据基线，收据 `1792057738425-a7e52cfc` 六项检查通过：37相关单元、15英雄浏览成功，1fixture条件跳过，无重试。手工1600×1000中文及390×844中英核对，六行各24px，名称／条／数值中心对齐、各行及页面无横向溢出。本机截图 `output/playwright/stat-rows-desktop.png`、`stat-rows-mobile.png`、`stat-rows-en-mobile.png`；复现：`pnpm check --files src/components/hero-overview.tsx docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html`。

## 双列刻度、简短标签与无底框装备槽

用户确认六项属性每行两项、共三行，名称、短条、数值同行；容器不足480px时单列保留完整信息。生命值／魔法值去掉“上限”，恢复改为“+数值/秒”，负值保留负号，未知不添加正号；meter的完整名称与语义保留。示意条以零点为原点，每100为1px细线、每1000为2px粗线，替换旧1级参考线；沿用各项原有数值范围与恢复段。采用固定数量SVG重复图案，避免数值增大时批量创建刻度节点。

装备槽进一步固定为64×48px，无底框、无常驻底色；选中名称金色。中立两槽仍在六装备右侧，档位选择与信息说明放在中立槽旁，移除独立中立标题／档位行。手机的下拉padding和字号已针对该控件收紧，完整显示“1 级”／“Tier 1”。

最终组合收据 `1792058579089-6ab36ec1` 六检查通过，38项相关单元及15条英雄浏览成功，1fixture条件跳过，无重试。已知答案验证斯温生命刻度范围2894.3、100／1000间距、1／2px线宽及负护甲尺度；恢复与等级既有断言保留。Mac共享43187及相同固定业务数据，1600×1000实测两列三行，390×844中英无页面／属性行横向溢出，六装备槽64×48且透明，英文档位文字可用34px与scrollWidth34px一致。1000／2000位置的栅格截图像素确认粗线比100细线覆盖更宽。

本机截图在 `output/playwright/stat-scale-final-desktop.png`、`slots-bare-desktop.png`、`slots-bare-mobile.png`、`density-en-mobile.png`，不作为跨机器附件。复现命令：`pnpm check --files src/components/hero-overview.tsx src/components/hero-inventory.tsx tests/unit/hero-levels.test.tsx src/i18n/en.json src/i18n/zh-CN.json docs/specs/semantic-game-ui.md docs/specs/hero-inventory.md docs/architecture/project-atlas.html`。

## 英雄等级单行

英雄等级名称、原生滑块和当前等级／30改为同一行，数值区保留宽度，等级变化不挤动滑块。Mac同一工作台／数据基线，1600×1000与390×844三项中心线一致，手机无横向溢出，Home／End往返1／30及属性联动正常。本机截图 `output/playwright/level-inline-desktop.png`／`level-inline-mobile.png`。

收据 `1792058739965-e9e5d700` 六项检查通过，38相关单元／15英雄浏览成功，1fixture条件跳过，无重试。复现：`pnpm check --files src/components/hero-overview.tsx docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html`。

## 计算说明、关联响应与物品悬停

计算属性改用计算器图标。`hero-stats-expression`的表达式同时计算数值与生成公式／代入值；保留原有加成顺序、取整、限幅及来源门禁。浮层列出实际输入和结果，攻击区间展示两端。悬停／聚焦时，三围、等级、关联派生项与来源行高亮；Escape／退出释放关联状态。基础攻击间隔只关联来源攻击间隔及其百分比修饰，不关联攻速。说明组件维护局部状态，不让悬停触发装备投影。

普通物品对象为32px方形，中立物品及附魔为32px圆形；槽仍为64×48，名称单行。悬停／聚焦有描边和浅底反馈，简介／移除图标默认隐藏且不接收指针，悬停槽或键盘进入才出现；键盘可操作隐藏入口，触屏点按对象保持焦点。右侧档位和紧凑布局保留。

环境为Mac共享43187、main a05bc58及本工作区未提交组合，业务lock bee227bd／数据12bcfdff不变。数值／公式／依赖和焦点退出专项单元通过；新增真实旅程核对生命670→A杖1065，力量25→35实际代入、关联范围、图标显隐、键盘移除及方形／圆形几何，一次通过。复用已有hero-stats／hero-inventory与tooltip检查映射，新表达式文件按保守规则执行全量单元。390px英文页面与公式卡无横向溢出。

组合收据 `1792060239608-6ab3fa9c`：格式、lint、文档、类型、579单元（2既有跳过）、正式构建及独立启动通过；全量浏览47条首次通过、2条首次失败后单次重试通过、1条件跳过。严格flaky门禁仍失败，不记作全量通过。失败分别为原有缓存英雄目录第二次后退后未出现技能图鉴（catalog.spec.ts:551），以及单位链接点击后仍停在单位图鉴（names.spec.ts:79）；两者重试成功，根因未确认，不降低断言／超时或继续重复跑绿。与本次新增交互有关的浏览均首次通过。

组合停止后单独完成原计划尚未执行的视觉项：`pnpm test:e2e tests/e2e/visual.spec.ts --project=desktop-chromium --project=mobile-chromium --retries=1 --max-failures=1`，6项一次通过。本机证据 `.medota2/sessions/hero-hover-check.log`、`hero-hover-visual.log`；截图 `output/playwright/hero-item-hover.png`、`hero-health-calculation.png`、`hero-hover-mobile-items.png`、`hero-calculation-mobile.png`。这些本机文件不视为跨机器附件；导航偶发失败仍需后续单独定位。

## 点槽搜索与纵向紧凑布局

六个普通装备槽改为两列三行，右列依次为中立物品、附魔和档位／说明；1280px以上三栏比例改为1:0.8:2.05，中栏最小260px，将宽度分给英雄属性。装备价值以金币图标和数字移到标题右侧，保留可访问名称及标题提示。移除“正在配置第N格”和底部即时生效说明；神杖、魔晶、银月入口补同版物品图标；未计入面板的技能条件说明放入属性说明浮层。

普通／中立／附魔统一点击槽后打开非模态搜索浮层，搜索框自动聚焦；搜索同步执行，列表内部滚动。选装后关闭并恢复原槽焦点；Escape／关闭按钮恢复焦点，点击外部或焦点离开收起；简介浮层保持可操作，Escape先关闭简介。浮层通过portal定位在当前视口内，不占主面板行高。宽度与位置在尺寸变化后更新，关闭释放监听和观察器。

Mac共享43187，同一main a05bc58未提交基线及业务lock bee227bd／data12bcfdff。1280px桌面核对中栏收窄／属性扩宽；390px英文弹层左8、右382、宽374，页面scrollWidth390，自动聚焦正确；Enter装备闪烁匕首后弹层消失、焦点回槽1、价值2250。截图为本机`output/playwright/slot-popup-desktop.png`、`slot-popup-open.png`、`slot-popup-mobile-en.png`，不是跨机器附件。

收据`1792064474693-1e772e7a`六项检查全部通过：40相关单元、49完整浏览成功，1fixture条件跳过，无重试。新增流程覆盖入口默认不存在、点槽／Escape／外部关闭／焦点恢复、两列三行、提示移入Hover及选装关闭；既有中立和计算浮层回归通过。首轮仅缺少“关闭”的双语资源，已补齐后验证。上一轮两个导航偶发失败本轮均首次通过，保留其历史证据，不据此宣称根因已修复。复现：`pnpm check --files src/components/hero-inventory.tsx src/components/hero-inventory-picker-panel.tsx src/components/hero-overview.tsx tests/journeys/catalog.spec.ts src/i18n/en.json src/i18n/zh-CN.json docs/specs/hero-inventory.md docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html`。

## 窄槽、右侧配置与圆形状态

普通装备槽改为两列44px、列间2px，面板水平内边距8px；中栏最小232px，三栏比例1:0.7:2.15。右侧中立物品与附魔并排，档位及神杖／魔晶／银月三个配置入口都位于右侧区域，下方留给当前状态。状态统一32px圆形图标，名称、效果、数值与持续时间进入Hover详情；消费状态移除入口悬停或聚焦显示，来源状态随装备／配置变化。移动速度、攻击距离、昼夜视野与基础攻击间隔同一行，窄屏仅此行横向滚动。

Mac共享43187、main a05bc58及已有未提交组合，业务lock bee227bd／data12bcfdff保持。1280×720与390×844核对布局；手机页面scrollWidth390，圆形状态32×32。银月祝福详情显示攻击速度+60，键盘移除后数值回退，全部重置回初始状态。截图 `output/playwright/compact-status-desktop.png`、`compact-status-tooltip.png`、`compact-status-mobile.png` 仅为本机证据，不作为跨机器附件。

最终收据 `1792065289235-2b34056d` 六项检查通过：复用有效40项相关单元，49完整浏览成功、1fixture条件跳过、无重试。首轮测试错误地要求圆角CSS必须为50%，实际Tailwind圆角返回大像素值；改为检查32px正方形及半径不小于半边长后，稳定输入完整回归通过。首轮失败证据收据 `1792065038370-2439da89` 保留。复现：`pnpm check --files src/components/hero-inventory.tsx src/components/hero-overview.tsx tests/journeys/catalog.spec.ts docs/specs/hero-inventory.md docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html`。

## 天赋与命石语义引用

图中天赋名称及命石说明接入同一语义引用组件，复用固定Catalog技能数据和现有属性词／别名。最长完整词优先，英文遵守单词边界，同名不同身份不猜测。技能名悬停／聚焦展示对应技能卡，沿用当前英雄等级、天赋和神杖／魔晶投影；点击定位本页技能。浮层使用独立ID，长内容内部滚动；属性引用展示说明卡并保留版本／语言进入属性详情。选择按钮与引用为兄弟元素，点击文字引用不选天赋，空白区域及Enter／Space保持选择。底部提示同步双语说明点击分工。

Mac共享43187、main a05bc58及本工作区未提交组合，业务lock bee227bd／data12bcfdff不变。桌面及390px中英文核对：战斗饥渴／力量／护甲Hover正常，技能定位保持等级1；命石技能键盘Enter定位，旧天赋鼠标选择、取消、升级和降级仍通过。复用属性匹配器，补同名冲突及最长词组件检查；检查映射新增hero-reference。截图 `output/playwright/talent-reference-hover.png`、`talent-skill-mobile.png`、`talent-reference-en-mobile.png` 为本机证据，不作为跨机器附件。

最终收据 `1792066101279-269e006e` 六项检查通过：78相关单元有效复用、49完整浏览成功、1fixture条件跳过、无重试。前轮检查发现测试框架断言API误用、旧天赋区所有链接数量断言不适用于新增语义链接，以及技能描述测试文字“一名／一个”不一致；已分别修正为现有Vitest断言、精确限定8个天赋详情链接、使用实际同版文案，失败证据保留。初版完整技能浮层曾遮挡入口，已限制内部高度并完成点击回归。复现：`pnpm check --files src/components/hero-reference-text.tsx src/components/hero-talent-tree.tsx 'src/app/heroes/[slug]/page.tsx' scripts/development/check-plan.mjs tests/unit/hero-levels.test.tsx tests/journeys/catalog.spec.ts src/i18n/en.json src/i18n/zh-CN.json docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html`。

## 全英雄数值与成长排名

面板实际数字新增独立排名Hover，包括三围、成长、生命／魔法及恢复、攻击区间两端、四项主要派生值、紧凑参数、来源基础值及非零额外属性。仓储批量读取同Catalog全英雄必要数值列，无额外业务数据或迁移；等级改变复用原有计算器投影各英雄，当前配置替换自身基线样本。对照英雄不含装备、天赋、技能加成，浮层明确口径，排名按数值从大到小而非战斗优劣。并列、空值、整数P及全同值P50遵循属性Spec，SVG绘制全体排序并标出当前英雄；攻击范围上下界分别展示，成长取保持配置的相邻等级差值，30级取29→30。

长排名卡使用HoverTooltip可选avoidAnchor定位，在空间较多的一侧限制高度并内部滚动；默认其他卡行为不变。恢复的计算Icon和排名数字为独立按钮，保留计算说明。新查询始终绑定详情Catalog；未知来源派生值保留空值。图谱、模块映射与两份Spec已同步。

Mac共享43187、main a05bc58及当前未提交组合，业务lock bee227bd／data12bcfdff。7.41f共127英雄；军团1级生命670并列9/P93、增量66并列31/P75，20级生命1924并列29/P78，增量保持66。单元覆盖已知答案、并列最高／最低／全相同、缺值、装备替换与30级增长；真实浏览覆盖数字入口、成长双卡、攻击上下界、基础前摇与成长原值、窄屏。1280px和390px中英手工核对，手机页面宽390；本机截图 `output/playwright/hero-health-ranking.png`、`hero-attack-ranking.png`、`hero-ranking-mobile.png`、`hero-ranking-en-mobile.png` 仅作本机附件。

收据 `1792067114450-a222639d` 八项检查全部通过：581全量单元（2既有跳过）、50完整浏览（1fixture条件跳过）、6视觉、4所选数据库合同（其余19未选），无浏览重试。首轮浏览断言将1924误写为带逗号的格式，已与现有无分组数字格式对齐；首轮失败收据 `1792066897275-61ff971d` 保留。最终功能输入稳定通过，正式生产构建不在本轮门禁范围。

门禁结束后顺序测量开发环境7次排名Hover：从Pointer事件触发到下一帧卡片可见为12.5–25.8ms，全部可见；无排名／业务数据请求，仅遇到工作台原有 `/api/development` 轮询。这是本机开发环境采样，不代表降速设备或生产统计。证据 `.medota2/sessions/hero-ranking-response.log`；新浏览上下文未出现应用错误。复现：`pnpm check --files src/components/hero-stat-rankings.tsx src/components/hero-overview.tsx src/components/hero-stats-relations.tsx src/components/ui/hover-tooltip.tsx src/presentation/hero-stat-rankings.ts src/presentation/hero-stats.ts src/server/repositories/heroes.ts 'src/app/heroes/[slug]/page.tsx' scripts/development/check-plan.mjs tests/unit/hero-levels.test.tsx tests/journeys/catalog.spec.ts src/i18n/en.json src/i18n/zh-CN.json docs/specs/attribute-catalog.md docs/specs/semantic-game-ui.md docs/architecture/project-atlas.html`。

## 属性语义图标统一（2026-10-15）

按用户截图将通用盾牌与Unicode冷却／魔耗符号合并为单个语义SVG。规范属性与枚举按ID映射Lucide静态组件，未知专属参数用调节图标；三围、资源、攻防、移动／视野、时间、目标及费用共用该映射。计算入口使用同形金色图标，公式、关联高亮、数值排名保持原触发方式。图标透明背景，行内1em、0.25em间距，中心对齐；中英文文案同步移除旧符号。调研链接和选型表归[设计系统](../design-system.md#属性图标)，图谱英雄节点同步入口与行为。

Mac共享main a05bc58及既有未提交组合、当前7.41f／6944 Catalog，不改业务数据。范围收据`1792068014615-4206edb3`：格式、lint、类型、文档、112相关单元、正式编译及产物启动通过；49浏览首过、1条件跳过、1单位命名旅程失败后按规则单次重试通过。严格flaky门禁未通过，不能报告全部检查通过。失败停在`names.spec.ts:79`：点击测试标靶后5秒仍显示单位图鉴；trace含目标RSC 200／258.6ms，存在CatalogHeader已有key警告，尚不能归因。保留`shared-tests/runs/1792068022632-80209bb4/report`，未修改该导航或重复刷绿。

最初静态检查指出渲染期图标解析被React静态组件规则拒绝，已改模块级静态映射；旧影压测试匹配Unicode前缀已同步。视觉首轮桌面技能详情7533像素差异，经原图／实际图／diff核对为本轮图标和行内对齐变更，更新桌面及手机技能详情基线，未提高阈值。基线生成会改变输入并标记stale，另行用更新后输入运行完整视觉验证，桌面／手机6项全部首次通过（25秒，命令`pnpm test:e2e tests/e2e/visual.spec.ts --project=desktop-chromium --project=mobile-chromium --retries=1 --max-failures=1`，本机日志`.medota2/sessions/attribute-icons-visual-final.log`）。

手工核对军团指挥官：1600px中文、390px中英文7个冷却／魔耗入口各仅一个SVG，图标与文字中心偏差均0px；390px页面宽度390，无横向溢出；冷却Hover可显示属性卡。一次手工定位误用aria-hidden的分隔斜线，改用真实可访问名称后正常。截图在本机忽略目录`output/playwright/attribute-icons-{hero,costs,en-mobile}.png`，数值记录`.medota2/sessions/attribute-icons-en-metrics.log`，仅作为Mac该基线证据。未提交、推送或发布，人工页面审阅及单位导航偶发问题保留。

## 排名柱条即时提示（2026-10-15）

移除排序分布SVG柱条的原生title，改由`hero-stat-rankings`内独立RankingChart维护一个自实现HTML提示。统一指针入口按横坐标定位英雄；移入即出现、移动切换并高亮、移出隐藏；可聚焦并通过左右键／Home／End选择，触控点击同样定位。提示不截获指针，按图表宽度避让两端，ResizeObserver跟随大小变化；外层排名卡片和Escape保持原关闭方式。悬停只更新局部图表，不重新排序或请求数据。比较口径沿用用户确认的当前配置对同版同等级裸装基础值。

Mac共享main a05bc58及既有未提交组合、7.41f／6944 Catalog。范围收据`1792071537778-41042e34`六项检查通过：复用输入仍有效的42相关单元，50完整浏览首次通过、1原有fixture条件跳过；静态、类型及文档通过。本轮未选正式构建／视觉基线（图表仅在交互浮层中出现）。首轮`1792071372430-d2e770e3`新增退出断言误用合成pointerleave，未触发React的离开合成事件；改为真实鼠标移动后全量复验通过，未放宽断言。前轮单位跳转本轮首次通过，保留历史flaky证据，不宣称根因已修复。

实测截图同位置“树精卫士: 60”由自定义浮层显示，原生title数量0；5次合成指针事件至下一帧文本更新0.4／14.2／16.5／16.1／16.1毫秒，仅为本机样本，不代表所有设备时延保证。390px页面宽390、末端提示右边369.8px，真实移出后提示数量0。键盘和移动边界由旅程再次验证。本机证据`.medota2/sessions/rank-point-response.log`、`rank-point-mobile.log`和`output/playwright/rank-point-{tooltip,mobile}.png`；后一移动日志的首次afterLeave=1来自仍聚焦SVG且指针此前未进入，随后真实移入／移出为0。已关闭本轮浏览会话，未改数据或提交推送。属性／语义Spec及图谱英雄节点同步。

## 中立物品版本隔离核查（2026-10-15）

本轮只读核查现有实现及数据，未发现串版。路径为Release解析到Catalog、英雄页将datasetVersionId传入`getHeroInventoryCatalog`、`getItemOverview`读取对应meta、`readPinnedItemSnapshot`用固定commit读取items／neutral_items／本地化并核对steam.inf。快照缓存键包含meta、steam哈希和适配版本，物品投影WeakMap按快照对象及英雄主属性分离；候选池和附魔等级来自同快照neutralRaw，数值取同快照items。英雄配置Provider以Catalog ID和英雄slug为key，切版本重建状态。未有中立池或未审阅来源时明确缺项／停用，不借用其他版本。

Mac共享main a05bc58及既有未提交组合，数据lock `bee227bd`／数据commit `12bcfdff`。对API返回的两个现有Catalog分别使用固定Git对象审计：

| 版本         | 来源commit                               | 二／三级贪婪攻击力修饰 |
| ------------ | ---------------------------------------- | ---------------------- |
| 7.41e · 6918 | 991daaf6fc24b08445209d9ce8767e145bab107e | −30／−60               |
| 7.41f · 6944 | f4c45719314754567cb4ef4fe343bbc790a311f4 | −35／−70               |

两版`neutral_items.txt`原始SHA256均为`0935ad39d72909cd2800d62d083e55406b2a8eb85049373c1a4392bcf907a8d5`，池文件完全一致。1–5档物品数为12／9／9／9／10，力量英雄附魔候选数为4／5／5／5／5。因此两版列表相同是来源事实，不能据此判定串版；附魔数值确实按版本不同。

真实页面通过全局版本菜单完成7.41f→7.41e→7.41f往返；斧王1级裸面板56–60攻击，每次重新配置二级贪婪后分别21–25／26–30／21–25，魔法值均441。每次切版附魔状态清空、档位回1、攻击回56–60，往返缓存未复用错误数值。`pnpm test tests/unit/hero-inventory.test.ts`15项通过，覆盖池内候选、历史定义排除、主属性筛选和附魔来源等级。本轮不新增生产代码；图谱行为和实现入口未变，无需回写节点。后续新Catalog仍须固定来源适配／机制审阅，不能将本轮核对扩大为全部历史版本已支持。

本机证据位于忽略目录`.medota2/sessions/neutral-version-audit.ts`及JSON、`neutral-version-{f,e,f-return}.log`和`neutral-version-unit.log`；复现审计命令`pnpm exec tsx .medota2/sessions/neutral-version-audit.ts`，证据不视为跨机器交接附件。浏览器会话已关闭。核查结果回写current后仅运行文档范围检查。

## 帮助文案收拢与精简

移除天赋底部常驻操作提示，将空白区域选中／取消、技能名定位收进标题旁帮助浮层。精简英雄详情的天赋、物品、属性、中立与珍品帮助文案，中英文同步；保留自动升级／降级处理、重置范围、版本与档位规则及计算边界，完整英雄简介与对象详情保持领域内容。实现入口未变，图谱无需更新。

环境与数据沿用本页基线。实际浏览器核对中文四个常用帮助入口及英文390px：旧常驻文本为0处，各浮层位于x=8–382，页面宽390，无横向溢出；Escape关闭正常。本机证据`.medota2/sessions/hero-help-browser.log`，浏览器会话已关闭。文件范围检查见`.medota2/sessions/hero-help-check.log`：静态检查、42项相关单元与50项浏览器流程通过，1项fixture条件跳过，无重试。检查期间更新收尾文档使总收据标为stale；稳定文档后补跑，静态结果复用；浏览器按运行器规则重新执行。最终收据`1792072677391-8983b27b`中49项首次通过、1项重试通过、1项条件跳过；严格flaky门禁失败。失败为`resource-loading.spec.ts:73`物品表格滚动返回后行高28px，预期至少77px，自动重试通过。属于物品列表虚拟化恢复路径，未修改该路径，根因尚未确定；保留trace／截图于`.medota2/shared-tests/runs/1792072679556-77d1c683/`，不重复刷绿或放宽断言。英雄详情全部流程通过。

## 扩大装备搜索面板

弹层最大宽度440→760px；列表最大高度448→640px，并按视口可用高度收缩。卡片48→40px高，名称单行省略，完整名称和说明仍可从简介查看。结果按最小150px列宽自适应，宽屏四列、390px两列；InfiniteList分块18→48项，保持按需连续加载。普通装备、中立及附魔共用布局。

沿用本页环境／数据基线。1440×900实测面板760×724px，一屏完整56件，初始挂载96件；390×844面板左右8px、一屏28件，无横向溢出。别名搜索“跳刀”、简介、选装价值2250及Escape后焦点恢复均通过。本机截图`output/playwright/inventory-picker-wide.png`与`.medota2/sessions/inventory-picker-size-browser.log`；文件范围检查记录`.medota2/sessions/inventory-picker-size-check.log`。

验证：42项相关单元、格式／Lint／类型／文档和单独`pnpm release --build-only`正式构建／启动通过。本轮初次旅程因放大面板覆盖原“点击外部”测试目标而超时；改为面板外英雄标题，并加入760px／四列断言，完整装备与中立流程均通过。最终全量回归`1792073737258-e859353c`为38通过、1失败、1重试通过、1中断、1跳过、9未运行；失败集中既有目录导航：names初次停留单位列表、重试停留物品列表，abilities列表跳转重试通过。穷鬼盾目标RSC返回200（约218ms），但5秒内页面仍为列表，根因未定，未放宽断言或继续重复刷绿。trace在`.medota2/shared-tests/runs/1792073743148-3b912a51/`。构建被全量失败门禁中断后单独完成并启动验证成功；全量门禁仍未通过，需另行诊断目录导航。

## 装备详情与属性来源分段

对象悬停直接显示ItemSummary及当前面板贡献；点按仍打开装备搜索。来源保留槽位／中立／附魔／消费状态身份，唯一组先选实际生效项，再按固定顺序逐步使用heroStatsAtLevel求值，升级来源带入已建模技能变化；符号差额合计保持总值。基础与各来源用属性同色系深浅分段，负贡献斜纹，来源与属性双向高亮，独立分段按钮保留键盘访问。

沿用固定Catalog与本机基线。已知值核验：神杖生命＋395、重复鞋不双算、吞服银月攻速＋60；两项魔抗乘法贡献18.3和10.98，总值56.08；减攻击70后56→−14。实页强袭护甲＋15、攻速＋60，叠加银月状态后攻速123＋60＋60＝243，逐段悬停双向高亮成立。本机证据`.medota2/sessions/inventory-contributions-browser.log`与`output/playwright/inventory-contribution-hover.png`，后者为颜色调整前的交互核验；最终同色系截图`output/playwright/inventory-contribution-tones.png`已核对：基础深棕与阔剑浅金棕边界清楚。贪婪二级负攻击−35实页73→38，斜纹与附魔关联正常；390px详情完整显示且无页面横向溢出。

本轮收据`1792074981229-879f4a66`9项全部通过：584单元＋2条件跳过、50浏览＋1fixture跳过、6视觉、所选数据合同及5次小样例基准；浏览无重试。基准中位4.2ms／P95 4.5ms仅代表既有解析小样例，不作为交互延迟指标。新增回归覆盖直接对象详情、神杖生命贡献395、分段反向高亮、消费状态来源60及点击对象切换选装；Hover不取数或重新求值。前轮目录导航flaky证据仍保留，本轮未复现。仅收尾文档更新后补文档检查。

## 配置区底边对齐

魔晶与银月入口改为左右同行，神杖保持上一行；右侧网格拉伸至三行装备槽高度，档位行吸收剩余空间，底边齐平。沿用本页环境与数据基线；1440px／390px、中英文实测底边差均为0，无页面横向溢出，两状态开关正常。证据为本机`output/playwright/inventory-alignment.png`与`.medota2/sessions/inventory-alignment-browser.log`；复现为固定7.41f军团指挥官详情页，切换视口及语言。

收据`1792079537840-0fac158e`六项全部通过：44相关单元、17浏览旅程通过／1条件跳过，无重试，格式、Lint、类型、文档检查通过。日志`.medota2/sessions/inventory-alignment-check.log`。

神杖入口追加收紧：取消填满剩余宽度，文字与箭头间距2px；中文四种模式在1440px／390px下入口宽50或60px，英文1280px无横向溢出。固定Catalog与本页环境不变，复现同页切换四种神杖模式。证据`.medota2/sessions/inventory-select-compact-browser.log`与`output/playwright/inventory-select-compact.png`；收据`1792079739368-6d3d8ad9`六项通过，44单元、17浏览／1条件跳过，无重试。

## 2026-10-16：技能等级与中立档位布局

英雄技能卡的等级控制移至右上角，与图标／名称并排，当前与最高等级提示置于按钮上方。390px中文军团指挥官和英文祈求者均无标题重叠或横向溢出，祈求者当前来源的8级元素选项在右侧自然换行；点击4级仍同步英雄等级。独立技能详情保持原头部间距。首轮视觉检查发现共用头部间距受影响，修正为仅可调等级卡采用新布局后，收据`1792080129240-0b73868a`通过44单元、8旅程、6视觉；初次失败记录保留于`.medota2/sessions/ability-level-position-check.log`，最终日志为同名前缀`-check-final.log`。截图`output/playwright/ability-level-position.png`、`ability-level-position-mobile.png`与浏览记录`.medota2/sessions/ability-level-position-browser.log`均属本机证据。

中立档位改为两槽上方常显单选，数量与取值直接读取当前版本Catalog；点击和方向键均可选择，原换档清空附魔／保留合规中立物品规则保留。左右普通／中立槽顶边和装备／升级配置底边对齐。固定7.41f军团指挥官、中英文1440／1280／390px实测顶底差均0；4级按右方向键切换5级，候选与数值回归通过。截图`output/playwright/neutral-tier-inline.png`与`.medota2/sessions/neutral-tier-inline-browser.log`。环境与数据沿用本页基线，无数据写入。

中立档位收据`1792080293974-d9130a63`六项全部通过：44单元、50浏览旅程／1条件跳过，无重试，格式、Lint、类型和文档检查通过。复用既有中立旅程覆盖常显档位选择、换档与附魔；日志`.medota2/sessions/neutral-tier-inline-check.log`。收尾仅补文档检查，页面待人工审阅。

## 2026-10-16：按提供方添加英雄状态

当前状态标题新增添加入口，弹出搜索面板。按物品、英雄、中立生物、建筑、其他单位筛选，再按具体提供方聚合；结果保留提供方与技能名称，支持中英文和拼音搜索、来源链接、等级直接选择、详情悬停。新增状态继续使用圆形图标、移除、重置与属性来源联动；同一modifier跨提供方只保留一个实例。目录首次打开读取，按Catalog身份缓存，搜索及Hover使用本地数据，初始分块32条。

来源为当前Catalog的技能定义及英雄绑定、同版本物品／单位快照、校验后的双语modifier本地化；新增只读`/api/catalog/hero-statuses?dataset=<UUID>`，不迁移或写入业务数据。保留repository、commit、源文件、客户端版本、导入时间与schema身份。7.41e的`991daaf6fc24b08445209d9ce8767e145bab107e`和7.41f的`f4c45719314754567cb4ef4fe343bbc790a311f4`均返回940条来源记录；f包含707英雄、147物品、43中立、20建筑、23其他单位。这里统计提供方与modifier组合，不代表940种独立或全部当前对局可触发的状态。建筑使用真实塔受益状态；肉山自身防御、光环发射器、偷塔保护等单位自用状态排除。

来源前缀关联与已审阅映射分别标明。嗜血术、强攻、炎阳纹章受益、圆盾／恢复头巾／洞察烟斗／韧鼓光环共7条记录有明确面板映射，其余可添加并查看来源说明，但标注未计入属性。技能参数不等同于对目标的属性效果；单位技能等级为1而来源含4个阶段参数时保留原值，不猜测成长等级。持续时间仅展示，模拟状态保持到手动移除；护盾、控制及未建模被动不伪装成已计算。

本机共享main `a05bc58`加本轮未提交修改，工作台`127.0.0.1:43187`，业务lock `bee227bd`／数据提交`12bcfdff`，只读。军团指挥官1级基础攻速123，嗜血术4级后203、移速325→364；详情改为1级后攻速158；移除恢复。真实旅程覆盖斧王118→198、来源筛选、塔状态、390px强攻添加和重置；英文手机搜索不产生额外网络请求，页面scrollWidth为390。API两版身份正确，非法dataset为400，不存在UUID为404。最终肉山搜索仅保留作用于英雄的两条咆哮状态。截图`output/playwright/status-picker.png`、`status-picker-mobile.png`及`.medota2/sessions/status-*`日志为本机忽略附件，不随Git交接；桌面截图为最终单位过滤前的布局证据。

验证与边界：

- 完整范围收据`1792082536827-5d5bba1e`：格式、Lint、类型、文档、589单元通过，2项单元条件跳过；50浏览通过、1条件跳过、1失败。失败为`releases.spec.ts:906`地图English→简体中文后HTML仍为en，自动单项重试仍失败；未修改该路径，根因未定，保留`.medota2/shared-tests/runs/1792082548341-60307897/`证据。
- 增加单位受作用方过滤后的收据`1792082895087-7bdc73c4`：格式、Lint、类型、文档与53相关单元通过；28浏览首过、1条件跳过、1重试通过。重试项为`catalog-views.spec.ts:71`技能列表点击未跳转，严格flaky门禁仍失败；证据`.medota2/shared-tests/runs/1792082902049-fccc464f/`。英雄状态新增旅程均首过，没有放宽断言或重刷全量。
- 浏览门禁中断的后续只读检查单独完成：`pnpm test:integration --testNamePattern 'enforces canonical|partially materialized|bidirectional catalog|applies the checked'`所选4项通过，19项未选；`pnpm bench --iterations 5`通过，中位4.1ms／P95 4.6ms只代表6069字节解析小样例，不代表页面延迟。

完整门禁尚未通过，页面待人工审阅；没有提交、推送或发布。行为合同、图谱、新交互检查映射与当前交接已同步。

## 2026-10-16：装备槽顶对齐与配置区收紧

左侧六槽跨越右侧档位行，与档位按钮同时从配置区顶部开始；右侧保持档位→中立槽→神杖→魔晶／银月的顺序，升级配置底边与装备第三行对齐。删除左侧空档位行后配置区180→152px，标题下间距12→8px，当前状态整体上移32px；普通槽尺寸与交互保持原合同。仅调整现有布局，图谱模块职责、入口与关系没有变化。

环境为共享main `a05bc58`及既有未提交改动，`127.0.0.1:43187`，固定7.41f Catalog `ff83d8f6-f828-4a50-a2d4-42f59624e671`，没有数据改动。中文／英文1440px与390px实测顶边差0、底边差0，右侧中立与升级间隔18px，页面无横向溢出。截图`output/playwright/inventory-density-{zh-CN,en}-{1440,390}.png`和`.medota2/sessions/inventory-top-density-browser.log`均为本机忽略附件。

按文件检查收据`1792083379032-bdcf7c2a`六项通过：格式、Lint、类型、文档、49相关单元、18浏览流程，1项fixture条件跳过，无重试。覆盖选装、升级、状态添加、移除、重置与窄屏交互；本轮没有重新执行其他模块全量回归，前轮地图语言与目录导航失败记录保留。页面待人工审阅。

## 2026-10-16：状态搜索工具栏单行

搜索框、来源筛选、说明入口和提供方／状态数量由三行合并为单行，工具栏含底部间距高36px；桌面两种语言均完整同排。390px下只在工具栏内横向滚动，筛选可点击、键盘可聚焦，页面不横向溢出。复用原筛选与搜索逻辑，不改变目录、状态计算、接口或图谱职责。

沿用本页共享工作台、固定7.41f及既有未提交改动。中文／英文1440px和390px实测各元素垂直中心一致，桌面工具栏742px无横向滚动，手机页面宽390；选英雄后搜索ogre bloodlust均命中1条。首次人工脚本误用英文Search states而实际为Search statuses导致定位超时，修正为弹层textbox后复验通过；证据`.medota2/sessions/status-toolbar-browser{-final,}.log`，截图`output/playwright/status-toolbar-{zh-CN,en}-{1440,390}.png`均为本机忽略附件。

收据`1792094159918-7235a55a`六项通过：格式、Lint、类型、文档、49相关单元、18浏览流程，1项fixture条件跳过，无重试。仅此次局部范围，既有全量失败记录保留；页面待人工审阅。

## 2026-10-16：中立物品和附魔常显效果

中立候选与附魔候选替换价格0为同版本非零参数、两行效果说明；附魔数值直接复用当前档位投影，零值只从紧凑摘要隐藏，完整简介仍保留。图标／名称与效果组成最小220px卡片，桌面三列、390px一列；普通装备价格与原四列布局保持原行为。搜索、选装与Hover完整说明复用既有入口，无新数据读取、接口、模型或图谱职责变化。

环境沿用共享main、当前未提交修改、工作台43187与固定7.41f Catalog。中英文1440／390px实测无横向溢出；壮实1级显示生命110，4级显示生命230／恢复9／减速抗性25%；石羽小包显示移速12、护甲3及切换说明，搜索、Hover和选装通过。本机证据`.medota2/sessions/neutral-effects-preview-browser.log`，截图`output/playwright/{neutral,enchantment}-effects-{zh-CN,en}-{1440,390}.png`，均为忽略附件。

最终范围收据`1792128617094-d4e2cfb3`格式、Lint、类型、文档、49相关单元通过；17浏览首过、1重试通过、1条件跳过。英雄列表点击敌法师详情在`catalog.spec.ts:66`首次5秒超时，重试通过，严格flaky门禁未通过；状态和中立流程首过。trace保留`.medota2/shared-tests/runs/1792128625262-6cf5aa13/`，未放宽断言或重复刷绿。初次检查在整理零值摘要时产物输入变化，被正确判为stale；最终并行构建因旅程门禁退出而中断，随后单独`pnpm release --build-only`成功完成正式编译与独立启动验证（产物c0683367），没有远程发布。过程见`neutral-effects-preview-{check,final-check,build}.log`；功能可审阅，完整严格门禁仍受导航flaky影响。

## 2026-10-16：换档保持中立选择面板

移除换档时清空弹层目标，并将档位控件作为中立选择弹层的关联交互区，pointerdown和focusin不再误判为外部关闭。搜索组件按物品／附魔身份保持挂载，列表独立按档位重置，搜索词保留且候选／效果刷新；方向键换档同样生效。其余外部点击、Escape、选装仍关闭，原换档清空附魔及保留合规中立物品规则不变。共用弹层新增可选控件ref，普通装备与状态面板没有提供该ref，沿用原关闭规则；图谱职责与入口无变化。

同一共享工作台43187、固定7.41f与既有dirty main基线，无数据变更。桌面实测中立面板从1档切2档显示9件物品，保持打开；附魔搜索“壮实”后切4档显示生命230／恢复9／减速抗性25%，搜索保留，点击标题外部关闭。390px中立旅程补充点击1→4、方向键4→3、回1后的110／230／190值与面板存续；搜索stonefeather时切2档显示空结果，回1档恢复候选并可选装。首次手工探针的status定位命中计数及无障碍播报两个元素，改为直接子节点后通过，未修改产品来适配探针。

收据`1792129445498-0a99fb3a`六项全部通过：格式、Lint、类型、文档、49相关单元、51完整浏览流程，1项fixture条件跳过，无重试。本机`.medota2/sessions/neutral-tier-stay-open-{check,browser,browser-final}.log`和`output/playwright/neutral-tier-open.png`为忽略附件。前轮导航flaky与地图语言失败本轮未复现，旧证据保留；页面待人工审阅，未提交或发布。
