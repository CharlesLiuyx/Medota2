# v3地图资产包接入与单位补图

日期2026-10-09，环境GofurMacM4Max128GB，共享3000工作台消费local-review。代码基线0d8e72b加原有英雄交互未提交变更；业务lock为601d8a2b／173b0645。本轮未提交、推送或发布。

## 输入与完成范围

ZIP `map-assets-20261009-v3.zip`，SHA-256 `99cf5807c487283be97f9beeef654b7ac0093f190aaf4ea0f380dddbabfa1dca`，本机解压到忽略目录output/map-assets-20261009-v3。707项manifest文件大小／SHA全部通过；导入器另锁定manifest SHA `845e0b3d124023796a508f215ddb3b1b8753c3ccd470af76d00a4781dc417528`，不执行包内取证脚本。

- 入库350项可用图片及四级LoD：304图集条目、36独立材质、8原生HUD、2 devilesk守卫。中文用途文件为已核验图集别名；原始字节／错误裁切／脚本／日志作为证据保留。
- 6944地图revision `7173e46b…`绑定108个非树点位；127英雄用同Catalog原生图。22塔／12兵营保留正斜方向，28营地按等级；泉水使用24×24 HUD图，智慧圣坛2个仍缺专用图。树木仍是地形对象；包中没有新的4096px底图，不改来源既有SFM底图。
- 全部图片可在地图图标库分批检索并查看原图；备用样式、英雄变体、神符和HUD素材不虚构当前地图点位。
- 14个6944单位从unavailable补为带unit_minimap关系的related_icon，新单位资产版本`1a3f37b4-5336-4e44-9724-25260e9cd355`。已有253张肖像／共享肖像／技能图完整保留；6918单位资产版本不变。目录／悬停／详情标注地图用途。

补图单位：dota_fountain、ent_dota_dire_candybucket、ent_dota_radiant_candybucket、npc_dota_badguys_cny_beast、npc_dota_badguys_siege_diretide、npc_dota_dire_ofrenda、npc_dota_goodguys_cny_beast、npc_dota_goodguys_siege_diretide、npc_dota_lotus_pool、npc_dota_radiant_ofrenda、npc_dota_roshan_halloween_minion、npc_dota_teleporters、npc_dota_unit_item_stone_of_recall、npc_dota_unit_twin_gate。

## 验证与边界

导入前业务状态code-modified，无数据问题。首次误选未运行development sandbox未写入，按工作台实际local-review身份重试；单位文件不在Catalog source_snapshot_files中，改核对已验证单位资产provenance里的同提交npc_units hash后导入成功。完整事务和旧单位版本保留；重复真实导入已验证新增绑定为0、单位资产版本与manifest hash相同。350对象均具有四级LoD；数据库逐项比较确认已有253个可用绑定的对象／resolution／provenance完全相同，6944缺图90→76，6918仍为90。

350张图片HTTP逐项返回200且字节SHA与原图一致（SVG泉水按已记录转换验证ETag）；条件缓存304、错误hash404、非法width400。1600×1000地图截图、图标库护盾搜索与双生之门详情已检查，详情图片加载并显示“小地图图标”；7.41e显示原版本且没有6944图标库。390×844无横向溢出或图标加载失败，窄屏标记缩至60%避免基地重叠。图谱两个节点点击、详情与来源文件可达性通过JSDOM检查，不冒称图谱浏览器视觉验收。

首轮格式问题已修复；组合通过457单元（2既有跳过）、18真实浏览（1 fixture-only跳过、无flaky）、4所选数据库合同及开发样例。首轮生产构建编译／启动成功，但因期间调整窄屏代码而被门禁判为stale；冻结最终代码后重新执行受影响检查，最终收据`1791487222515-045519ea`全部通过：457单元、18真实浏览（无flaky）、4所选数据库合同、格式／lint／types／文档、开发样例和生产构建／独立启动。正式构建产物`b102438a9fcb432377cbeb4382b8719780947543185b41dc450c717006683f41`已核验。随后只更新验收文档，按规则单独补文档检查。

导入后`pnpm data:status`为`data-differs`且problems为空，符合本次新增图片／单位绑定；lock保持原值。实现及机器验证完成，待用户页面人工审阅。

原生灰白像素保留；按用户后续审阅去掉静态原生图标的阵营／选中外框，保留悬停放大与详情交互；没有完成游戏内着色／引擎语义校准。devilesk图客户端未知且来源独立，不标为6944原生。7.41e不借用6944用途清单。图片／数据未加入代码Git；本次本地业务变更未更新lock，跨机器需在获得发布授权后用完整快照交接。

复现：按[导入手册](../operations/catalog-import.md#地图资产包与单位缺图补充)取得包并导入，运行本轮范围`pnpm check --files`及现有map／units真实旅程；页面打开/map、放置守卫和英雄、切换7.41e、查看/units/npc_dota_unit_twin_gate。实现规则见[地图](../specs/map-explorer.md#v3小地图资产)与[单位](../specs/unit-catalog.md#地图资产补图)。本机日志位于.medota2/sessions/map-assets-*，截图在output/playwright；这些忽略附件不作为跨机器可用证据。
