# 地图浏览与版本数据

## 当前能力

地图版本是独立且同等重要的数据身份。`/map?release=<release-id>` 明确选择一个版本；顶栏可随时切换，点位、底图、地形层和来源元信息一起切换。默认版本只决定无参数入口，不改变其他版本的可访问性。未收录的版本返回404，不代用相邻补丁。

当前本机有两个独立Dataset：

| 补丁  | 客户端     | 数据与证据                                                                                                                     |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 7.41e | 未知，null | Sloppy固定快照，4096px SFM图、2585点和28营地边界；补丁与地图哈希为来源声明                                                     |
| 7.41f | 6944       | 本机地图VPK哈希与固定快照匹配；原生XYZ／阵营、2585点、28营地PHYS边界、导航与高度栅格；4096px底图来自相同地图哈希的Sloppy SFM图 |

7.41f不是7.41e的图片替换。两者的地图SHA-1分别为`412137a154d86cd4ba61da98692a5fb15e1cb79a`和`f049eadfa145a180f68ebe1f55da4ace8298bdc7`。补丁名称来自社区固定索引；7.41f完成了本机地图字节匹配，但没有独立验证社区Steam manifest归属。地图版本与英雄Catalog分开，不推定6918与任一地图相同。

Canvas支持拖拽、滚轮／双指缩放、键盘平移、复位、分类图层、搜索、选择、直线测距、静态寻路估算和范围圈。绘制按动画帧合并，设备像素比最多2，点位分桶命中与屏外裁剪；树木阻挡格和营地边界在100%显示。7.41f可选择底图、导航栅格、地面高度和湍流；7.41e不显示不存在的地形层。切换版本重置选择与视口，避免残留其他版本的状态。

导航颜色表达GNV静态标记，高度图来自VHCG样本，均为社区格式解码，尚未在游戏引擎验证。已实现静态网格路径估算，未实现动态树木／单位碰撞、真实战争迷雾或昼夜模拟。`coverage.navigation=false`仍表示未实现游戏引擎导航等价物；静态栅格另由`rasterLayers`描述。底图没有放大512px原生贴图，也没有声称本机重新渲染完整场景。

## 寻路、树木阻挡与地图提示

工具栏「测距」与「寻路」互斥，激活时青色底和描边突出。右键或Esc退出当前工具，已创建路线保留；Delete删除选中路线，编辑输入框时不误删。操作说明通过地图视口左上角的问号Tooltip打开，复位图标在右侧缩放组底部。地图上方不再插入说明／结果行；地形颜色图例与寻路参数／进度／结果放右侧，切换地形不改变地图位置。

点击起点A、终点B后形成独立路线，自动恢复选择指针。新建路线才重新进入选点；辅助提示为轻量文字、实际导航格轮廓及精准点击位置。选点和路线节点按1单位取整，但GNV仍是64单位数据，不声称具有1单位地形精度。多个路线保留，地图点线或右侧列表可选中；重合线反复点击依次轮换方案。常规产品仅包含陆地最短距离和湍流最短耗时；飞行作为后续特殊能力，未开放入口或参与推荐。底层独立飞行计算保留作隔离验证。

陆地使用所选Dataset保存并逐文件验哈希的GNV，8邻接A*、禁止斜切阻挡角，只移除共线冗余节点，保证所建网格图的最短距离。仅bit0可走，bit16禁插眼不阻挡行走，未知位保守阻挡。连通分量快速拒绝不可达目标，类型数组代际复用与LRU缓存减少分配；Web Worker异步搜索、分阶段报告实际进度，旧请求可取消且不能覆盖新结果。Worker不可用时分片让出主线程。无导航数据的版本不启用常规寻路。

树木按32单位半径、英雄体积24单位做格中心占用近似；建筑依据同版本单位BoundsHullName和6944本机引擎常量，遗迹依据模型XY边界做显式近似。规则绑定客户端与地图SHA，未知版本不套用；详见本机来源审阅。绿色树木、金色建筑阻挡格与路径计算共享，隐藏图层不移除阻挡；内部格线淡化，外轮廓保留。静态估算未处理转身、动态单位、建筑被毁、砍树、技能或真实战争迷雾。

读取原生dota_movespeed_modifier_path的Bezier控制点、宽度和实体变换，得到五条湍流。区域及箭头对齐64单位格；7.41各段最大加速150，顺流按正向投影估算，逆流不减速，尚未验证引擎精确角度公式。两类陆地方案经过湍流都计算加速；最短距离优先距离，湍流方案优先耗时。模拟逐段使用同一时间模型。

每次计算陆地／湍流各自直达与双向经门，门参数来自本版本npc_abilities（6944持续施法4秒、范围200），中心阻挡时在终点连通区域内寻找门旁落点。只显示最快和耗时差≤max(3秒,最快10%)的候选，地图与面板共用筛选；选中方案最后绘制并高亮。输入移速必须有限且大于0，支持模拟／暂停／重播及1/4/8倍速，模拟在门入口等待施法后跳转。

有明确同版本视野字段的对象默认显示昼／夜两圈，范围滑条同步标注值，监视者注明“激活后”。这些圈是距离参考，不计算遮挡或战争迷雾。

顶部「拉野/叠野秒数」默认开，28营地显示叠野窗口，有拉线数据的4营地同时显示对应阵营拉野窗口；每行表示每分钟的秒数。「野区经验」默认关；开关关闭仍在悬停单营地时显示其金币与经验。悬停地图下方野怪营地图层项时，所有当前可见营地和边界突出、显示经验范围，离开恢复；关闭的图层不被悬停临时开启。

监视者是可占领的中立视野目标，不按地理位置分配固定阵营。本机6944的10个实体teamnumber=0；静态地图灰色「中」标识中立，明确不包含对局归属。详情从同版本文件显示交互范围200、持续施法1秒、有效420秒、停用120秒、昼/夜视野800/450；未知版本不借用这些参数。机制介绍链接Valve7.33、7.34及7.40，击杀肉山不再获得控制权。不添加虚构的初始阵营或自动占领时间轴。

运行继续使用`pnpm dev`和固定3000工作台，无新依赖、无需重新导入旧Dataset或重启数据库。来源文件必须在Dataset的source目录内且与provenance哈希一致。验证可运行`pnpm exec vitest run tests/unit/map-routing.test.ts tests/unit/map-navigation-source.test.ts tests/unit/map-viewer.test.tsx tests/unit/map-currents.test.ts tests/unit/map-route-client.test.ts tests/unit/compact-select.test.tsx`，常规检查仍使用`pnpm check --files`。

## 地图布局与交互性能

全站顶栏高28px。地图页不显示独立标题行；版本选择器和其左侧的来源问号合入游戏时间控制行右侧，时间滑条自适应缩短。地图哈希核验／来源待确认状态由当前版本提供并展示在最顶栏右侧，离开地图页后撤除；小屏以图标显示，悬停、焦点或点击可读完整状态。来源说明同样支持悬停／键盘焦点／点击打开、Escape关闭，保留原有来源链接和元信息。地图右侧64px工具轨分为地形、测距／寻路、缩放／复位三组，组间两条细分隔线；缩小、比例、放大以紧凑横排显示，复位在下方。地图操作问号固定在视口左上角，支持悬停、焦点或点击展开。桌面地图视口高度为100dvh减160px，小屏为70vh，最小400px；桌面属性栏为200px，小屏排列在地图下方。方位、比例尺、悬停收益／测距及寻路选点指示集中于随相机移动的底图左下黑色留白，使用不超过10px的文字，区域按底图宽28%、高9%约束并裁切，不覆盖有效地图；具体对象与收益明细仍可在属性和下方收益区查看。四个收益／路径显示开关使用相同尺寸复选框，与文字垂直居中。地图下方为图层筛选：标题后紧跟160px搜索框，后续图层选项连续横排换行；树木开头，依次野怪营地、防御塔、兵营、神符、肉山与魔方、双生之门、监视者、智慧圣坛、莲花池、前哨、商店、泉水、其他实体，遗迹结尾；点位以至少155px列宽自动横向铺满，继续仅列前80项并可搜索。右栏用于寻路操作、地形图例、所选对象属性、营地收益摘要、定位和范围操作；小屏自然纵向排列。寻路参数下拉、移速输入与起终点选择压缩到24px控件；新建操作放到标题右侧，进度、错误和计算结果继续常显。「静态估算」标记保留，完整计算口径、方案筛选和未验证边界收进标题的信息图标Tooltip，支持悬停／焦点／点击与Escape关闭。

渲染器缓存当前视口的底图、地形、树木、普通标记与固定收益标签。悬停、范围圈及路线动画只合成动态内容；相机、图层、底图加载或游戏时间变化才使相应缓存失效。树木一次提交整批矩形路径，命中使用预计算的格子索引，普通点位使用空间分桶。营地收益／文字和点位列表独立记忆，经济面板不随普通悬停重新计算。指针移动每帧只处理最后一个位置，同一目标内移动不重绘，空闲不保留动画循环。

只有真实尺寸或DPR改变时才调整画布像素尺寸，并在同一帧立即提交完整画面。选中对象、范围、测距／寻路及显示开关不会重新初始化指针监听或清空画布；保持正在进行的拖拽及当前悬停。工具状态经最新状态引用读取，避免事件闭包引用旧值。

`pnpm exec vitest run tests/unit/map-viewer.test.tsx`包含2500树木的输入合并、静态缓存复用、状态切换不清空画布、卸载取消帧任务，以及原有营地／兵线／测距／寻路交互回归。画布的`data-draw-ms`仅表示最近一次JS绘制提交耗时，`data-paints`、`data-background-builds`及`data-hit-tests`为当前渲染器累计计数；不等同于显示帧率或GPU呈现延迟。

## 安装与输入

沿用仓库的Node、pnpm、sharp等依赖，无新增框架、依赖或数据库迁移。公开来源无需安装游戏；本机提取需要同一Dota 2安装的`pak01_dir.vpk`及分卷、`maps/dota.vpk`、`steam.inf`和显式指定的[Source 2 Viewer CLI](https://s2v.app/ValveResourceFormat/guides/command-line.html)。CLI 20.0与客户端6944已实际运行。工具安装、二进制审阅和PowerShell复现见[本机来源说明](../repositories/local-dota-map.md)。所有路径可配置，产物放在游戏目录之外的Git忽略目录。

以下命令每行可直接在PowerShell或POSIX shell运行。输出目录必须不存在。占位路径需替换为实际输入。

## 导入公开版本

只下载指定补丁所需文件，固定完整commit，不执行外部脚本：

```sh
pnpm exec tsx src/workers/import-public-map.ts --commit 38fb8ef1d16c99c141d0630e5227110fd082b364 --patch 7.41e --output .medota2/maps/7.41e-sloppy-38fb8ef
pnpm exec tsx src/workers/import-public-map.ts --commit 38fb8ef1d16c99c141d0630e5227110fd082b364 --patch 7.41f --output .medota2/maps/7.41f-sloppy-38fb8ef
```

保留原始source、LICENSE、map.json和4096px原字节overview.webp。公开来源没有Z／阵营则保留未知。地图索引、实体声明、渲染索引必须相互一致，拒绝临近版本图片。来源边界见[Sloppy审阅](../repositories/sloppy-map.md)。

## 提取并导入本机原生数据

```sh
pnpm exec tsx src/workers/extract-local-map.ts --vpk "/path/to/game/dota/pak01_dir.vpk" --map-vpk "/path/to/game/dota/maps/dota.vpk" --cli "/path/to/Source2Viewer-CLI.exe" --output .medota2/map-extractions/6944-412137a
pnpm exec tsx src/workers/import-local-map.ts --input .medota2/map-extractions/6944-412137a --render .medota2/maps/7.41f-sloppy-38fb8ef --output .medota2/maps/7.41f-6944-native
```

提取器执行地图VPK内部校验，核对提取前后地图VPK、主索引和steam.inf没有变化，记录工具版本／哈希、ClientVersion、SourceRevision、地图SHA-1／SHA-256和逐文件校验值。没有逐个校验主包所有分卷。输出extraction.json、全部实体层、营地模型／PHYS dump、GNV／VHCG／TRM／world和overview元信息。

导入器逐文件验哈希，要求渲染参考包的地图SHA-1完全相同。保留3个活动世界层，记录但不混入2个destruction层；遵循该编译输出已是世界坐标的事实，不重复应用层变换。2475树、22塔、28营地与独立固定来源逐点匹配；不按来源位置覆盖原生坐标。多行pathnodes、点号属性和未知属性完整保留于原始source，非游戏装饰实体计入省略统计。营地边界由实际PHYS顶点、scale、yaw、origin投影，未知倾斜／非法几何拒绝导入。

GNV为320×328、64单位主格，未知位独立着色；VHCG含128单位主格及32单位细分样本，无样本不填造高度。输出无损navigation.webp、height.webp及各自世界边界。Dataset自带原生提取证据、参考包元信息、固定来源原文和LICENSE，不依赖提取缓存常驻。

## 增补同版本营地与兵线经济数据

已有原生Dataset可使用下列命令生成新的完整Dataset，不覆盖输入、不安装依赖：

```sh
pnpm exec tsx src/workers/enrich-map-economy.ts --input .medota2/maps/7.41f-6944-native --output .medota2/maps/7.41f-6944-economy --vpk "/path/to/game/dota/pak01_dir.vpk" --cli "/path/to/Source2Viewer-CLI.exe"
```

要求同一安装内的steam.inf、dota.fgd、maps/dota.vpk以及完整主包分卷。适配器当前只接受已审阅的7.41f／6944／地图SHA-1 412137a154d86cd4ba61da98692a5fb15e1cb79a，其他版本必须独立审阅；不把旧快照升级为新补丁。工具核对输入文件哈希、安装客户端与SourceRevision，提取npc_units、npc_abilities、creep_pull_timings和中文本地化，保存FGD、steam.inf、工具身份与独立导入provenance；提取前后检查主索引、地图包和steam.inf，没有逐一校验全部主包分卷。

可选的economy-v1内嵌69种必要单位、26类基础组合、28营地生成配置／提示时间和规则版本；地图schema兼容无economy的旧Dataset。PHYS刷新体积保留世界XYZ顶点、Z上下界及二维投影，按volumename精确匹配营地；六条lanePaths来自出兵点和path_corner链。缺单位、非法区间、重复组合／营地、跨版本经济数据和缺路径点拒绝导入。新Dataset使用下节集合命令登记，`--dataset 7.41f-6944=.medota2/maps/7.41f-6944-economy`。

页面在100%显示对齐导航格并填满的树木阻挡近似和营地边界；原始树木坐标保持不变，阻挡格的计算口径见上节。营地边界默认1px青色内线配2px暗底线；悬停营地或列表项时增加5px暗底及2px亮线并置顶。选中营地后保留相同的边界、名称、经验及「Z 轴范围」提示，移开指针或悬停其他对象不撤除已选营地；取消选择、改选其他对象或隐藏营地图层后不再显示对应选中效果。地图默认隐藏高度，仅在悬停或选中营地时显示「Z 轴范围」；活动名称标签最后绘制。营地悬停显示金币与经验区间，详情包含全部可能组合、数量、单体金币／经验、PHYS顶点及拉野／叠野秒数；泥土傀儡分裂体开关同步影响金币和经验。洪流营地按每5分钟一个单位进化枚举混合组合，并遵守各营地maxupgradecount；这是正常刷新的时间表，封野／未清理可能导致进度落后，不推断概率或实时状态。黑暗巨魔临时召唤的骷髅不计入固定清野收益。

兵线路径具有7px命中容差，悬停高亮并显示当前时间出生的一波兵金币／经验、数量和兵营情景；双方路径重合时列出双方，离开后消失。地图与详情面板共享时间和兵营情景。经验取同版本BountyXP，中立单位仅在持有升级技能时每450秒+5经验、最多30次；远程兵每450秒+8经验。经验按范围内单人独享计算，不要求补刀，不含反补等修正；旗手额外奖励仅计金币。规则creep-economy-7.41-v2要求完整经验字段，兼容旧v1数据但缺失时显示「未收录」，不填0或跨版本借用。

0–120分钟时间轴以30秒为步长，支持上一波／下一波。普通近战数量在15／30／45分钟增加，远程在40分钟增加；2分钟起整分钟一名旗手替换近战，额外金币单列而不增加单位数。每5分钟攻城车，30分钟2辆，60分钟3辆。每450秒普通近战／旗手增加1金、普通及强化远程增加3金；强化近战及超级兵使用基础悬赏。用户选择的是出兵方的敌方兵营状态，近战／远程分别影响己方对应单位，全部六座被毁选择超级兵。普通与强化状态保留独立单位定义，基础金币取同版本原文。

收益区间是标准模式、单人全补刀的模型结果，旗手只计该玩家可获得的额外奖励，不把队友奖励重复累加。不含叠野减益／堆野者奖励、炼金、点金、极速模式或实时死亡时刻差异。组合数量与时间规则由FGD枚举和Valve补丁审阅提供，不冒充npc_units直接包含的生成概率；尚未逐项实机验证，具体来源见[本机来源审阅](../repositories/local-dota-map.md)。

## 建立可选择的版本集合

```sh
pnpm exec tsx src/workers/index-maps.ts --output .medota2/maps/versions.json --default 7.41f-6944 --dataset 7.41e=.medota2/maps/7.41e-sloppy-38fb8ef --dataset 7.41f-6944=.medota2/maps/7.41f-6944-native
```

集合保存每个Dataset的稳定ID、patch、clientVersion、相对路径和map.json的SHA-256。ID允许同一补丁的多个客户端／来源快照并存。所有Dataset必须位于集合文件所在目录内；拒绝重复ID、无效默认版本、路径越界、身份失配与内容变化。验证后发布新集合文件，禁止覆盖已有集合；增加版本时创建新集合文件并更新配置，原有ID继续指向其原Dataset。

在本机`.env`设置`DOTA_MAP_COLLECTION_PATH=.medota2/maps/versions.json`，顺序运行`pnpm dev:restart`。入口：

- `http://127.0.0.1:3000/map?version=7.41e`
- `http://127.0.0.1:3000/map?version=7.41f-6944`

集合优先于兼容的单包`DOTA_MAP_DATA_PATH`。只有未配置集合、未显式选版本时才可沿用单包或Catalog overview配置；显式版本缺失不回退。独立部署需要挂载整个集合及Dataset目录。

### 无数据库的本机地图工作台

仅浏览文件Dataset的机器可在`.env`中设置以下内容，再运行`pnpm dev`或`pnpm dev:restart`：

```dotenv
MEDOTA2_ENVIRONMENT=development
MEDOTA2_DATA_CLASS=sandbox
MEDOTA2_WORKBENCH_MAPS_ONLY=1
DOTA_MAP_COLLECTION_PATH=.medota2/maps/versions.json
```

该模式复用固定3000工作台，只展示地图导航，跳过数据库准备和图鉴预热。只允许development+sandbox，数据库身份保持unverified，不生成receipt；数据库API仍经过原有合同校验。恢复完整图鉴工作台时设为0并重启，按原有流程准备数据库。此模式不提供英雄／技能／单位数据。

## 兼容的单根实体入口

`extract-map-vpk.ts`与`import-map.ts`继续用于已有工作流，真实参数如下：

```sh
pnpm exec tsx src/workers/extract-map-vpk.ts --source /path/to/dota_vpk_updates --commit <full-40-character-sha> --vpk /path/to/game/dota/pak01_dir.vpk --map-vpk /path/to/game/dota/maps/dota.vpk --cli /path/to/Source2Viewer-CLI --output /path/to/new-extraction
pnpm exec tsx src/workers/import-map.ts --input /path/to/new-extraction --texture textures/materials/overviews/<referenced-texture>.png --entities entities/maps/dota/entities/<root-lump>.vents --output /path/to/new-dataset
```

steam.inf与固定提交仅容许CRLF/LF差异，分别保存安装原文与固定来源原文；其他字节差异仍失败。该入口仍要求至少1024px原生贴图和已确认世界坐标的单个实体lump，不能完整处理当前6944的512px贴图及分层地图；当前安装应使用上面的多层本机导入流程，不放宽门槛。

## 数据合同与资源接口

map-v1记录source_repository、source_commit（本机Steam来源为null）、source_path、client_version、imported_at、importer_version、schema_version与文件SHA-256。原生来源、渲染来源、社区patch声明分别记录；本机哈希匹配不冒充Git来源或已验证Steam manifest。缺字段、重复字段／ID、非法坐标、未知层策略、版本冲突、篡改文件、覆盖既有目录均拒绝。默认隐藏的其他游戏实体和省略的非游戏装饰分开统计。

图片接口`/map/assets/<file>?version=<id>&v=<map-json-sha256>`只开放overview.webp、navigation.webp、height.webp，且文件必须在该Dataset中声明。逐次检查版本及图片哈希，私有不可变缓存／ETag；跨版本revision、缺失层和无效版本返回404。切换Dataset使渲染器重新挂载，异步旧图片不会进入新地图。浏览器只接收URL与公开来源信息，不暴露本机路径，不启动Git／提取器。

原始资源、工具和输出全部在Git忽略目录；公开发布Valve资源前仍需独立许可审阅。

## 验证和后续工作

```sh
pnpm check --plan
pnpm check
pnpm exec vitest run tests/unit/map.test.ts tests/unit/map-import.test.ts tests/unit/map-public.test.ts tests/unit/map-native.test.ts tests/unit/map-versions.test.ts
pnpm exec vitest run tests/unit/map-economy.test.ts tests/unit/map-viewer.test.tsx
```

测试覆盖坐标已知答案、版本独立选择、错误版本不回退、资源哈希／revision隔离、路径越界、身份冲突、重复字段、活动世界层、多行实体、营地几何及导航／高度二进制截断。检查调度器的Windows原生启动适配已实现；当前平台失败项及复验步骤见[Windows任务](../work/windows-native-validation.md)。算法／组件测试不代替真实地图或引擎验收，历史数据审计见[本机来源](../repositories/local-dota-map.md)。

后续需在同版本引擎抽样核对导航／高度／树木状态，再扩展动态阻挡和视野；更高分辨率可使用同版本Workshop Tools场景渲染，记录相机、地形皮肤、光照与像素变换。静态地图与圈线不替代游戏规则。

## 全局版本入口

页面使用顶栏Release选择对应地图，兼容旧 `/map?version=…` 并重定向到相应release。显式全局版本缺地图时显示未收录，不读取另一版本。页面来源与校验提示保留，地图资源URL继续使用自身Collection ID与revision；图鉴与地图客户端分别记录。关联证据、部分对象Diff与区域身份限制见[实体版本合同](entity-versions.md)。
