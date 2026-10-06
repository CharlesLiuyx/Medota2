# 单位图鉴

## 当前已实现

顶栏第三个实体为「单位」，入口 `/units`，详情 `/units/[internal-name]`。目录采用既有紧凑深色样式、头像和即时悬停，支持中文、英文、拼音及首字母搜索、分类、语言切换、URL 恢复、清空及空结果提示。列表、悬停与详情共用头像；关联技能图标带“技能”标记，缺图明确显示待补充。

详情显示基础属性和同一 Catalog 中可解析的技能链接。兵线强化、塔级别／分路、继承变体等级保留，召唤、守卫和信使的阵营以所属者为准。数值是基础定义，并不模拟时间成长、召唤技能或对局效果。

## 数据边界

复用当前 Catalog 元数据及可配置 `DOTA_VPK_UPDATES_PATH` / `DOTA_VPK_WORKTREE_ROOT`，从其固定 source commit 的 Git 对象读取 `scripts/npc/npc_units.txt`、`resource/localization/abilities_schinese.txt` 和 `abilities_english.txt`。先核对同 commit 的 `steam.inf` checksum 与数据库记录。不读工作树改动、不追踪最新 HEAD。单位定义仍是只读补充模型，独立资产导入会写入数据库。无匹配来源时明确显示资料未接入，解析错误进入错误页。

这是按当前 Catalog 绑定的只读补充模型，尚未成为独立 PostgreSQL Unit Dataset。服务器保留两份以内的解析缓存、完整单位 KV 对象（含未知键）、文件 checksum，以及 `source_repository`、`source_commit`、`source_path`、`client_version`、`imported_at`、适配器版本和 schema 版本。此处 imported_at 表示只读模型构建时间，缓存随进程结束释放；原始定义由固定 Git commit 保留。首次读取只加载上述文件，不扫描完整来源目录。

适配器按 `npc_dota_units_base → include_keys_from 递归父定义 → 本条目` 解析标量字段。重复实体身份、缺失父定义和循环继承直接报错；BaseClass 是引擎类，不当作继承引用。名称优先本条目的同版本本地化，继承变体可使用明确父条目的名称并标明等级；动态占位符和缺失文本显示待补充。不能解析的数值显示待确认，未知字段不抛弃。

分类是浏览辅助：兵线、中立、远古、建筑、首领、守卫、信使、召唤与其他、活动、辅助与模板。依据引擎类、IsAncient、IsSummoned 及明确的名称模式推导，不代表当前地图生成清单或可用性证明。来源仍包含历史定义，因此所有目录均提示这一限制。

## 验证与运行

`pnpm dev` 后访问 `http://127.0.0.1:3000/units`。来源路径配置与英雄图鉴相同，无新增依赖；0010 迁移增加单位资产版本、绑定及 head。

- `pnpm check --files src/domain/units.ts src/importers/dota-vpk/unit-adapter.ts src/server/repositories/units.ts src/components/unit-catalog.tsx src/app/units/page.tsx tests/unit/unit-adapter.test.ts tests/unit/unit-source.test.ts tests/journeys/units.spec.ts`
- `pnpm test:journeys --grep units`：当前真实版本的搜索／清空／筛选／手机布局／详情和技能跳转；合成 fixture 验证来源缺失状态。

## 后续计划

将单位定义、本地化、状态审阅与原始文件溯源持久化到不可变 Dataset，接入导入门禁、版本差异。当前独立部署若不带可配置的匹配 Git 来源，只显示未接入状态。

## 单位头像

`pnpm data:import:unit-assets` / `pnpm data:import:unit-assets:local` 从当前 Catalog 已核对的固定单位源获取完整身份集合，优先下载 Valve Steam static 单位图。可选 `--portrait-commit <完整commit>` 从 ReDota 固定提交读取截图及模型映射；只对明确的变体和同模型共享头像，守卫材质、阵营不同的兵线不会自动互换。关联技能只复用同 Catalog 已入库的 exact 原生图标，关系标为 `related_icon`，不是单位肖像。没有可核对图片的定义保留 `unavailable`，不生成假图片。

单位资产有独立的版本/head，复用 `asset_objects / asset_variants / asset_blobs`。原图和 w64/w128/w256 WebP 全部入库，SHA-256 校验、完整单位身份集合、LoD 完整性和防覆盖降级检查在提升前执行。事务失败回滚整个候选；英雄与技能资产 head 不改变。导入报告列出各类数量及缺图身份；`--reuse-portraits` 可保留相同 Catalog / 补充来源提交已有的独立和共用头像。网络只出现在导入阶段，页面响应由数据库提供，带版本、ETag 和私有缓存。

单位定义的客户端版本与图片版本分别记录。CDN 图片没有 Git commit，客户端版本明确为空；ReDota 图像有来源 commit，但原始游戏构建号仍未知。每张新图片记录来源路径、URL、SHA、下载时间、导入器版本和 schema 版本；版本记录关联单位快照的全部溯源数据。社区资产来源与再分发限制见 `docs/repositories/redota.md`。
