# 本机 Dota 2 地图数据调研

审阅日期：2026-10-06。范围是只读检查本机安装、真实小范围提取和现有导入器适配验证；没有切换产品地图、启动游戏、修改数据库或发布资产。输入通过命令参数指定；本机路径仅记录在本地 session 和提取证据中，不作为程序默认值。

## 结论

以下结论为首次取证时点。后续已完成多层导入和版本集合，见[后续实现](#后续实现2026-10-06)；当前使用合同见[地图Spec](../specs/map-explorer.md)。

本机具备提取静态点位、导航栅格、高度网格、触发区域和场景模型的资源。已经用 Source 2 Viewer CLI 20.0 成功提取实体、overview 和导航／高度原文件，并验证地图 VPK 内部校验。首次审阅时的Medota2原生导入链路不能直接处理这批数据：版本文件换行差异、多行实体属性、地图分层和 512px 原生 overview 都需要适配。

建议以本机地图建立独立版本的数据包，先解决结构化数据质量，再用同版本场景生成高清底图。不要把低清小地图放大后当作高清地图，也不要把当前本机文件标为现有 7.41e 数据。

## 版本身份与证据边界

| 项目           | 本次核验结果                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 安装声明       | ClientVersion / ServerVersion `6944`；SourceRevision `11085649`                                                             |
| Steam 安装记录 | app `570`；build ID `25735857`；depot `373301` manifest `3619792261709528007`                                               |
| 地图文件       | `game/dota/maps/dota.vpk`，29,021,488 字节                                                                                  |
| 地图 SHA-1     | `412137a154d86cd4ba61da98692a5fb15e1cb79a`                                                                                  |
| 社区补丁关联   | 与 Sloppy 固定 commit `38fb8ef1d16c99c141d0630e5227110fd082b364` 中 **7.41f** 条目的地图 SHA-1 一致                         |
| 当前产品地图   | 7.41e，来源声明 SHA-1 `f049eadfa145a180f68ebe1f55da4ace8298bdc7`，与本机不同                                                |
| 文本来源核对   | `dota_vpk_updates` commit `f4c45719314754567cb4ef4fe343bbc790a311f4` 的 `steam.inf` 字段与安装一致；overview 文件逐字节一致 |
| 提取工具       | `20.0.6980+a06886f7d06049052d32a7381ec05523064a2ca0`，官方 release 便携 Windows x64 CLI                                     |

这里已核验的是**本地地图字节与社区补丁索引的对应**。补丁名称仍来自社区；Steam appmanifest 是本机安装声明，并非独立下载、解码并验证过的 depot manifest。Sloppy 的 7.41f manifest 是 `3074137983983757042`，与本次安装声明不同，但地图内容哈希相同：不同客户端发布可以复用同一地图。不能将 build ID、ClientVersion、补丁名、depot manifest 和地图哈希合并成一个版本字段。

安装 `steam.inf` 为 220 字节 CRLF，上游为 210 字节 LF；仅规范化 CRLF 后内容相同，规范化 SHA-256 为 `b1380a011df3ab399d1161a683825c3d853533ff615eaf61fa5616963ef82b8d`。原始文件哈希各自保留，不能声称原字节一致。匹配 `steam.inf` 也不能证明所有 VPK 分卷均来自该 Git 快照。

地图 VPK 的 `--vpk_verify` 返回 Success；提取前后地图 VPK、主 VPK 索引和 `steam.inf` 的 SHA-256 不变。本轮没有逐一校验主 VPK 的全部分卷。

来源：[Sloppy 补丁索引](https://github.com/sikleq/Sloppy/blob/38fb8ef1d16c99c141d0630e5227110fd082b364/data/map/patch_maps.json)、[匹配的文本来源提交](https://github.com/spirit-bear-productions/dota_vpk_updates/commit/f4c45719314754567cb4ef4fe343bbc790a311f4)、[CLI release 20.0](https://github.com/ValveResourceFormat/ValveResourceFormat/releases/tag/20.0)。

## 实际能取得的数据

以下数量是本地文件观测；实体数量为 class 记录数，尚不是完成去重、生命周期和游戏内核对后的产品对象数。

| 内容               | 位置与实测结果                                                                                    | 可用于什么；尚需什么                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 静态实体           | 5 个 `vents_c`；主层 4,912 条、双方基地层 84 / 124 条、双方 destruction 层各 3 条                 | 保留原始属性、XYZ、角度、模型、显式阵营、名称与层归属                                                        |
| 树木               | 主层 2,306 + 天辉基地 103 + 夜魇基地 66 = **2,475**                                               | 树木位置；需区分初始存在、被砍、再生状态                                                                     |
| 建筑／目标         | 22 塔、12 兵营、2 遗迹、28 营地生成器、10 监视者、2 前哨、2 双生之门、2 莲花池、2 智慧圣坛        | 结构化点位与版本 diff；不能仅靠 class 名识别全部目标位置                                                     |
| 肉山／魔方位置     | 各 1 个 spawner，另有 `info_player_start_dota` 位置标记                                           | 第二位置、激活时机与昼夜规则需要结合命名、脚本和运行时                                                       |
| 区域／视野辅助实体 | 393 个 `ent_fow_blocker_node`、5 个 `trigger_no_wards`、2 个 `trigger_boss_attackable`            | 是视野／放置规则的输入之一，不能直接当完整战争迷雾算法                                                       |
| 营地边界           | 主层 `trigger_multiple` 引用局部 hull 模型                                                        | 一个真实营地模型已读出 PHYS 和三维 bounds；需按 origin、旋转和缩放变换，多个 hull 保留几何，不只取包围矩形   |
| 导航栅格           | `maps/dota.gnv`，104,992 字节；**320×328、64 游戏单位／格**，原点 `(-10240, -10752)`              | 已核对头部、magic、精确长度与原始 flag 分布；可通行／禁止插眼 bit 含义仍需引擎抽样确认                       |
| 高度网格           | `maps/dota.vhcg`，2,372,758 字节；version 1，165×938、128 单位主格，9,797 个细分格，每格 5×5 样本 | 按社区布局独立核对长度完全吻合；细分间距为 32 单位，不等于全图原生 32 单位分辨率，插值和实际地面查询尚未验证 |
| 其他场景资源       | `dota.trm`、`dota.vmap_c`、`world.vwrld_c`、`worldnodes/*.vwnod_c`、模型与 `world_physics.vmdl_c` | 提供场景和碰撞分析入口；TRM 语义本轮未解析                                                                   |
| 当前原生小地图     | `dota.vmat` 的 `g_tColor` 指向 `dota_tga_d8178876.vtex`，实测 **512×512**                         | 适合轻量概览；同目录的大图／旧图不能不核对引用就替换                                                         |
| 坐标变换           | `resource/overviews/dota.txt`：pos `(-9472, 9472)`，scale `18.5`                                  | overview 范围为 X/Y ±9472；与导航和高度网格的范围不同，不能直接像素相叠                                      |

GNV 观测到原始字节值 `0, 1, 4, 5, 13, 16, 17, 20, 25`。初期应保留所有 flag 和未知 bit，不可粗暴转换成一个 boolean。高度网格原点 Y 为 `-109440`，不能凭直觉改成 overview 边界；需按头部定位并裁出实际地图。

社区解析参考：[gridnav.py](https://github.com/sikleq/Sloppy/blob/38fb8ef1d16c99c141d0630e5227110fd082b364/scripts/gen/gridnav.py)、[heightmap.py](https://github.com/sikleq/Sloppy/blob/38fb8ef1d16c99c141d0630e5227110fd082b364/scripts/gen/heightmap.py)。这些是逆向结果，未作为 Valve 官方格式契约。本轮只阅读参考，独立检查本地二进制结构，没有执行其下载或生成脚本。

## 实测可复现步骤

从 [官方 release](https://github.com/ValveResourceFormat/ValveResourceFormat/releases/tag/20.0) 获取 `cli-windows-x64.zip`，核对 release API 的 SHA-256 后解压到游戏目录之外。本次 ZIP SHA-256 为 `d32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5`。不需要将工具加入项目依赖或 PATH；本机便携工具与证据在忽略目录 `.medota2/map-research-20261006/`。

以下 PowerShell 命令中的三个路径需由操作者显式填写；输出必须为新目录且位于游戏安装之外。所有命令读取游戏文件，不使用会在 VPK 旁创建缓存的 `--vpk_cache`。

```powershell
$game = 'C:\path\to\dota 2 beta\game\dota'
$cli = 'E:\tools\Source2Viewer-CLI.exe'
$out = 'E:\map-data\new-snapshot'
if (Test-Path -LiteralPath $out) { throw 'Output already exists' }
New-Item -ItemType Directory -Path $out | Out-Null

& $cli --version
Get-Content "$game\steam.inf"
Get-FileHash "$game\maps\dota.vpk" -Algorithm SHA256
& $cli -i "$game\maps\dota.vpk" --vpk_verify
& $cli -i "$game\maps\dota.vpk" --vpk_list

# 导出全部实体层；后续适配器决定初始激活层，不能无条件混合。
& $cli -i "$game\maps\dota.vpk" -e vents_c -d -o "$out\entities" --threads 4

# 保留导航、高度和地形原字节；本命令不解码其业务语义。
& $cli -i "$game\maps\dota.vpk" -e 'gnv,vhcg,trm,vwrld_c' -o "$out\raw"

# 先读当前材质的真实绑定，再选贴图；材质导出也可能产生 PNG。
& $cli -i "$game\pak01_dir.vpk" -f 'materials/overviews/dota.vmat_c,resource/overviews/dota.txt' -d -o "$out\overview"
Get-Content "$out\overview\materials\overviews\dota.vmat"

# 此文件名只针对本次已经核对的材质绑定，其他版本须重新检查。
& $cli -i "$game\pak01_dir.vpk" -f 'materials/overviews/dota_tga_d8178876.vtex_c' -d --texture_decode_flags ForceLDR -o "$out\current-overview.png"
```

逐条核对退出码和日志，并保存输入／输出哈希、实际命令、工具版本、来源提交和采集时间；开始和结束再核对输入指纹，避免 Steam 更新期间混入两个版本。上述是勘察命令，不会生成产品 `map.json`。CLI 20.0 在 filter 只匹配一个文件时可能把 `-o` 当作文件名，本次已观测到；自动化应明确创建目标目录或指定文件扩展名。[CLI 文档](https://s2v.app/ValveResourceFormat/guides/command-line.html)

## 现有导入器的实际障碍

历史复现，已由后述多层流程解决的项目不再列为当前待办；旧单层入口的质量门槛仍见地图Spec。

1. `extract-map-vpk.ts` 使用 `Buffer.equals` 比较上游和安装的 `steam.inf`。本机字段完全相同、只有 CRLF/LF 差异，也会被拒绝。后续应明确、严格地比较规范化字段，同时记录双方原始哈希，不应取消版本校验。
2. `parseEntityDump` 实际返回 `Invalid quoted entity field: pathnodes`：真实 dump 包含三引号多行数组。需要保留多行值和未知属性的解析，不应删除报错实体以“通过导入”。
3. 当前入口只接受单一实体文件。主层之外还有 169 棵基地树；主层 `info_world_layer` 的 base 层 spawnflags 为 1、destruction 为 0。应根据层关系核对坐标语义及状态，再合并初始层；保留动态层和 2 个 `point_prefab` 的引用。
4. 当前 class 映射缺少泉水、监视者、智慧圣坛等；肉山／魔方额外位置是位置标记，不能仅统计 spawner。未知阵营也不应默认当中立。
5. `import-map.ts` 要求图片至少 1024px；本次真实绑定只有 512px，必然不符合该门槛。应把低清 overview 与高分辨率场景渲染定义为不同质量等级，或只使用经过验证的高清渲染，不得上采样冒充。
6. 原生导入尚未表达营地体积、导航、高度与状态。现有公开适配器的营地多边形不能证明原生适配器已有这些能力。

本轮没有改动这些运行时代码。合成 fixture 通过不能替代上述真实输入验证。

## 怎样获得更高质量的数据

### 先完成可审计的结构化数据

修复版本和实体适配，保留原始 XYZ／阵营／层／局部变换与未知属性；关联 28 个营地触发区的几何。分别保存 GNV flag、高度样本、静态碰撞和可破坏障碍，建立统一世界坐标变换。树木、塔、目标位置与禁插眼区选少量固定坐标做已知答案核对，再将引擎查询作为独立校验源。

在同版本离线测试／Workshop 环境中，评估 `GridNav` 查询、地面高度查询与真实放置／移动行为；记录游戏模式、时间、昼夜、树木状态、对象碰撞尺寸和采集脚本版本。接口和行为需在实际客户端确认。本轮没有启动游戏或验证这些查询，静态 GNV＋高度图不能直接声称提供完整路径或战争迷雾模拟。

### 高清视觉优先使用同版本引擎渲染

首选 Dota 2 Workshop Tools 的 Source 2 Filmmaker：固定场景、地形皮肤、光照、世界边界和相机，输出 4096px 或 8192px 分块图及像素到世界坐标变换。使用严格俯视正交投影（如可用）；若采用高空小视角透视拼接，必须测量高地／树冠视差并在元数据中说明，不能当数学正交图。导出后用塔、河道和两侧基地的锚点核对对齐。

Valve 提供 Dota 集成的 Source 2 Filmmaker；工具通过 Dota 2 的 Workshop Tools DLC 获取。本轮仅在安装内看到 `dmxconvert.exe`，没有启动工具验证其可用性。[Valve 说明](https://www.sourcefilmmaker.com/post.php?id=17206&p=1)、[Workshop Tools 安装入口](https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Installing_and_Launching_Tools)

另一条路线是 Source 2 Viewer 导出 glTF／GLB 后由 Blender 正交渲染，适合自动化；材质、粒子和引擎光照的还原程度必须对照游戏确认。模型导出不会替代实体提取；尤其没有模型的逻辑点不能指望从 GLB 恢复。本轮未导出完整场景、未安装 Blender、未完成高清渲染。[地图导出文档](https://s2v.app/ValveResourceFormat/guides/exporting-maps.html)、[格式与还原边界](https://s2v.app/ValveResourceFormat/guides/format-support.html)

### 如果必须精确回到 7.41e

现有安装虽然包含 `dota_683.vpk` 至 `dota_737.vpk` 等兼容旧回放的地图，目录中没有独立的 `dota_741e.vpk`。应按已记录的 7.41e depot／manifest 从本人有权获取的 Steam 历史内容或自己的备份恢复到独立目录，再核对目标地图 SHA-1；Steam 历史 manifest 是否仍可取得需实际验证，本轮没有下载旧 depot。高清渲染还需要该版本依赖的材质、模型、脚本，不能只拿旧 `dota.vpk` 配当前资源就宣称完全同版本。

如果暂时只做 7.41e 浏览，可维持现有固定公开来源。若采用本机这批数据，应创建独立地图版本并显示其证据级别，不覆盖旧数据，也不强行沿用英雄 Catalog 的 6918。

## 本地证据与下一步

`.medota2/map-research-20261006/` 保存工具 release 元数据、CLI help、地图清单、5 个实体 dump、原生贴图、GNV／VHCG／TRM、world dump、一个营地 PHYS 样本、实体统计、二进制布局检查、提取前后哈希及调研 manifest。原始资产和便携工具均被 Git 忽略；仓库仅保存调研说明。

首次调研建议顺序为：输入适配 → 独立Dataset → 导航／高度 → 高清渲染 → 游戏内验证。前三项的后续落地见下节；同版本引擎抽样与更高清场景渲染仍待完成。每一步分别记录覆盖率和未验证项。公开再分发 Valve 资源仍需独立许可审阅。

## 后续实现（2026-10-06）

上述内容记录调研当时的观察与障碍；现已完成原生多层适配、独立Dataset、版本集合和导航／高度显示，真实运行入口见[地图Spec](../specs/map-explorer.md)。7.41e与7.41f是同等可选的数据身份，各自保有版本元信息、资源和证据；默认入口不代表其他版本被替代。

新流程使用`extract-local-map.ts`／`import-local-map.ts`：本机活动根层及双方基地层共2585个产品点位、28个真实PHYS营地边界；2475树、22塔、28营地与固定参考逐点匹配。生成GNV静态标记层和VHCG高度层，游戏语义仍未通过引擎验证。已知多行实体、CRLF/LF及分层阻塞已修复；原生512px贴图保持原分辨率，页面选用相同地图哈希的4096px Sloppy SFM图，没有将其宣称为本机新渲染。

版本证据继续区分：本机Steam客户端6944／SourceRevision11085649、已校验地图SHA-1、社区补丁名称与render来源commit。未将社区manifest当成本机安装manifest。7.41e仍是来源声明级别，客户端未知。

## 同版本野区与兵线数据补充（2026-10-06）

本机6944中额外读取`scripts/npc/npc_units.txt`（基础悬赏及中立升级技能）、`scripts/npc/npc_abilities.txt`（neutral_upgrade：450秒、每次1金、上限30）、`scripts/creep_pull_timings.txt`（各营地叠野／双方拉野窗口）、`resource/localization/abilities_schinese.txt`（69个单位中文名，无缺失）和`dota.fgd`（生成类型枚举）。原始单位表含退役／活动单位，不能直接把同等级单位任意组合成营地。营地实际min/max spawn type、forced subtype和maxupgradecount取自同一地图原生实体；组合数量由独立版本规则表保存，未声明随机概率。

已生成独立`.medota2/maps/7.41f-6944-economy-v3`：28营地、26基础组合、69必要单位（含BountyXP）、28个含世界XYZ的刷新体积、6条出兵路径；来源文件和独立economy/import.json含原始路径、版本、工具及逐文件哈希。输入旧Dataset保留，登记到versions-v5集合。7.41e不继承这些规则或游戏文件。

经验导入器map-economy/2、规则creep-economy-7.41-v2：基础经验来自同版本npc_units的BountyXP；中立升级技能原文increase_xp=5、increase_time=450、max_level=30，仅对拥有该技能的单位应用。远程兵每7分30秒+8经验依据Valve [7.22](https://www.dota2.com/patches/7.22)；普通近战／旗手57、普通远程69、强化／超级近战25、强化／超级远程22、攻城车88均来自本机单位表。旗手额外金币不增加经验，泥土傀儡分裂体分别计入；不计多人分摊、反补和其他修正。缺经验的旧规则包保持未知，不以零补全。

时间模型审阅依据：Valve [7.41](https://www.dota2.com/patches/7.41)的攻城车和洪流营地调整、[7.40](https://www.dota2.com/patches/7.40)的近战／旗手悬赏增长、[7.38](https://www.dota2.com/patches/7.38)的逐单位洪流进化、[7.33](https://www.dota2.com/patches/7.33)的近战／远程悬赏升级及[7.32](https://www.dota2.com/patches/7.32)的旗手替换／额外奖励。官方datafeed JSON的本机审阅副本在`.medota2/map-economy-20261006/patch-*.json`，不提交。强化近战及超级兵采用基础悬赏；普通近战／旗手按7.40每7分30秒+1金、普通及强化远程按7.33每次+3金计算。该组合／时序模型没有逐项游戏结算验证，界面与Spec保留这一边界。

拉野时间是引擎提示表，包含方向角，但方向坐标基准尚未实机确认，所以仅展示秒数、不生成未经验证的路线箭头。兵线虚线只是原生path_corner连线，不能推导到线时间或实时避障；营地封锁、堆叠和进化进度需要实际游戏状态。来源许可边界沿用本文件原有要求。

## 静态寻路与监视者规则审阅（2026-10-06）

服务端只读取所选Dataset已记录的source/raw/maps/dota.gnv、economy/scripts/npc/npc_abilities.txt及npc_units.txt，每次核对provenance SHA-256。未修改原始Dataset或来源版本，派生器static-routing/1；完整导入身份沿用该Dataset。GNV bit0走路、bit16禁插眼参考本文件固定gridnav.py作者实现；未识别位保守阻挡。树半径32＋英雄体积24是用于64单位格的模型近似，非本轮实机测量；树木显示与寻路共用阻挡格，不能据此断言所有树林缝隙与引擎相同。飞行按用户要求忽略GNV与树木，尚不模拟飞行边界禁区。

6944同版本twin_gate_portal_warp：AbilityChannelTime=4、AbilityCastRange=200；ability_lamp_use：ChannelTime=1、CastRange=200、active_duration=420、inactive_duration=120；npc_dota_lantern昼800／夜450，10个地图实体teamnumber均0。读取这些字段而非沿用7.33旧参数。Valve[7.40](https://www.dota2.com/patches/7.40)确认监视者施法1.5→1秒和夜视野800→450；[7.34](https://www.dota2.com/patches/7.34)明确肉山击杀不再转移监视者控制权。官方英文datafeed副本保存在.medota2/map-economy-20261006/patch-7.34.json及patch-7.40.json。初始中立与对局动态归属分开，静态地图不按方位填造天辉／夜魇所有权。

## 6944 湍流、视野与静态体积审阅（2026-10-06）

运行时仅从所选Dataset声明且SHA256一致的文件派生。`default_ents.vents`五个`dota_movespeed_modifier_path`包含九个控制点位置／入出切线、节点类型1/2和半径；适配器校验数量、未知类型及变换，应用朝向与平移，最大32单位采样。Valve [7.41官方datafeed](https://www.dota2.com/datafeed/patchnotes?version=7.41&language=english)明确各段最大加速统一150；同版本中文modifier说明顺流加速、逆流无阻力。正向点积是当前估算规则，不是已验证的引擎公式。不得扩展到未知补丁。视野使用同包npc_units中明确的昼夜字段；缺失时不借默认数值。

`src/importers/dota-map/hulls-6944.json`记录本机server.dll及两座遗迹模型的文件哈希、client_version、map_sha1、source_repository/path/commit、imported_at、适配／schema版本。DLL规则审阅记录忽略目录`.medota2/collision-research/server-hull-audit.json`，DOTA_HULL_SIZE分支的bound半径及padding分别写入0xbc4/0xbc8：tower144+0、barracks144+16、filler96+16、small8+10等。不使用RingRadius或ProjectileCollisionSize替代寻路碰撞体积。BUILDING为动态模型派生，当前只对两座已哈希记录的遗迹按mesh XY最大跨度一半估算（Radiant314.726、Dire428.486），详情明确标注近似；不是物理网格提取或引擎验证结论。树木与建筑统一加24单位英雄体积后按格中心占用，仍需同版本实机验证。规则仅绑定6944和指定地图SHA，未知版本不回填。

原始DLL／模型保持本机忽略目录，仓库只增加小型数值规则与provenance；没有批量vendor上游或公开分发原始游戏资源。读取源仍通过配置的Dataset目录，不依赖安装目录。服务消费规则无需新增依赖或安装游戏工具。

## 视野近似算法准备（2026-10-08）

本机6944地图SHA-1仍为`412137a154d86cd4ba61da98692a5fb15e1cb79a`；复用现有文件包的2475树木与哈希绑定VHCG，离线准备64单位地面样本。算法树圆半径64和高度分层128是可调模型参数，不是Valve常量，也不采用导航阻挡半径作为视野证据。

本版FGD定义`ent_fow_blocker_node.TargetNode`连线和`ent_fow_revealer.visionrange`；已抽查原生dump存在重复targetname且缺TargetNode，首版没有按文件顺序推测连线。后续Z修正已保留树木实体高度，并保留VHCG的32单位细采样和原点；2475棵树实体Z与原生采样的差值均不超过64，5万个确定性坐标的新场景查询与原生heightAt一致。专用线／区域、真正FoW高度和运行时状态继续未覆盖；有效树高128仍是近似参数，详见[Z修正验收](../history/2026-10-08-map-vision-web.md#z轴修正)。输入身份、近似口径、结果与复现见[视野准备](../work/map-vision-occlusion.md)及[验收](../history/2026-10-08-map-vision-preparation.md)。原Dataset、来源provenance与游戏文件未修改，未进行游戏内校准。
