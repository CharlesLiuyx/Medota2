# 物品实体实施与验收

2026-10-07，GofurMacM4Max128GB，共享3000 local-review；代码基线main/4fdce38及工作区既有版本改动。本轮新增[物品图鉴](../specs/item-catalog.md)，顶栏在单位之后，固定来源模型、搜索分类、分块目录、悬停、效果与配方详情均已实现。随后与并行的全局语言任务接入同一语言入口。

真实基线为7.41f Catalog ff83d8f6-f828-4a50-a2d4-42f59624e671/source f4c45719314754567cb4ef4fe343bbc790a311f4，读取544条物品定义；保留7.41e历史。未迁移数据库、移动head、修改lock或提交推送。

本次17项适配／固定来源／Release就绪／检查范围单元测试、类型检查、物品浏览专项通过。浏览验证中文／拼音搜索、清空、分类URL恢复、悬停、390px无溢出、配方及反向关系、全局英语与历史Release保持、未知物品404。命令为 `pnpm test:journeys --grep items`；类型为 `pnpm typecheck`。图谱data/entity/module节点已同步，79节点、203文件引用及7个受影响详情交互通过静态DOM执行核验；`pnpm docs:check`通过。

`pnpm check`及本范围 `pnpm check --files`已执行，组合检查受并行全局语言任务影响，最后停在hover-tooltip测试仍断言不带lang的旧URL；未修改对方工作或降低断言，未报告全量通过。最终组合检查与生产构建需在语言任务稳定后重跑。本机日志在 `.medota2/sessions/items-check*.log`，不是跨机器附件。

物品定义的独立持久化Dataset、通用物品机器Diff尚未接入。当前入口读取已核验固定Git定义；新版Release就绪检查要求物品资料，后续完整业务同步包含items.txt。玩家审阅仍以实际页面为准。

## 物品图片补齐

同日按用户后续要求完成物品图片：迁移0011、独立item资产批次/绑定/head、Valve下载与四级LoD、版本化数据库路由、列表/悬停/详情/合成组件图片。7.41e和7.41f各544项（415个独立物品图标、129个共用原生图纸图标）；原图及w64/w128/w256齐全，无生成替代图。CDN构建号未知，保留URL/hash和空client_version。

7.41f图片批次60a634c5-cb13-45e5-ab63-ae53343a1eb2；7.41e图片批次6965fb7d-af49-49c8-9a0e-18233932b142。完整Release门禁现在也核对物品图片身份集合。同步schema包含37张业务表，新运行时items.txt可自动扩展已缓存的稀疏来源，已存在的损坏文件仍拒绝覆盖。

本机完整快照6577aa14e3dd6e59246735e4588bb9b2d921be4a05ed9fd7430cee286283c920，37表、6342对象、95649行、151719117字节。按data:export/data:apply流程更新active快照，回执reusedDatabase=true；原数据库和Catalog头保留，未推送或发布。仓库dev-data.lock仍指向旧schema快照，跨机交接需另经授权发布匹配的新代码及完整数据。

验证：两版全部1088个图片URL回读200且选中w64；数据库schema核验通过，22项数据库集成测试通过；物品图片及路由16项单测、来源缓存扩展6项单测、Release完整性4项单测通过。页面实际观察确认列表图标、魔杖详情与配方图片正常。复现使用data:import:item-assets:local、test:integration、test:journeys --grep items；详细本机日志为.medota2/sessions/item-assets-*，不视作跨机器附件。

最终图片专项浏览通过（8.5秒），覆盖自然图片尺寸回读、悬停／详情、390px、历史批次隔离与全局语言后的404。最新单元测试318通过、2跳过；完整隔离数据库合同22通过，5次小样例基准中位4.2ms。范围检查的格式、lint、文档、类型、单元均通过；组合浏览曾在共享国际化实施期间发生全局语言导航及单位详情导航失败，未报告全量通过。构建又检出use-live-catalog.ts的use client前有新增import，已仅调整directive顺序并重跑。

图谱data-graph-images、data-graph-imagebuild、versions-graph-assetheads同步并完成静态DOM点击与文件引用核验（79节点），此项不等同浏览器布局验收。

构建最终完成webpack编译、TypeScript、静态页面与独立服务启动，但检查发现构建期间源码发生并行改动，结果标记stale（item-assets-build.log），不能视作当前发布产物验收。构建期间重跑组合浏览受Fast Refresh／当时的空诊断值异常影响，后续两处null处理已修正；物品专项此前单独及组合中均通过，最终浏览器再确认完整物品目录图片正常。全量浏览与发布构建需国际化任务稳定后统一重跑。未绕过失败门禁。
