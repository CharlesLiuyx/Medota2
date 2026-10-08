# Windows 本地变更发布与复验

执行环境：`GofurWindowsLenovo`，原生PowerShell，便携Node22.23.3、pnpm11.7.0、Next16.3.3；系统Node24及全局配置未替换。用户授权发布全部当前本地变更，使用`pnpm push`核验业务快照、普通推送main并确认该提交的verify/push CI。

## 范围与基线

起始代码`9603f841f389b0f22cb082aa3fc98a140c89c420`与origin/main一致。原15个文件包含0010历史快照只读检查兼容、Windows启动记录与本轮小地图资产交接。依次形成`bed8de6`、路径修复`f5d4e1a`、并发修复`1384560`；其后补充独立产物fixture隔离和本记录。

业务快照为`173b064534123f09cc52b62adfff58f4d184f2a960825af162b125c676649043`，数据提交`601d8a2b8be3b2f324d4a567fca9df7f662d680e`，6850对象。本轮不修改业务内容、迁移或来源身份。原始资产v3 ZIP位于本机忽略目录，未入库或跨机器发布；来源、哈希及两张devilesk守卫补充见[地图来源](../repositories/local-dota-map.md)。

## 发布门禁中发现的修复

1. fixture Next服务无法解析实际存在的`@/i18n/locale`，120秒启动失败。共享及独立测试生成的tsconfig继承路径和Next配置路径统一为正斜杠后，英雄查询／筛选／详情与固定移速两条流程通过。
2. 20逻辑CPU默认单测并发出现6项5秒超时及后续EBUSY；没有残留测试进程。同一源码以`pnpm test --maxWorkers=4`通过87文件、452测试，32.29秒。Windows默认worker上限改为4（不超过可用CPU），保留原断言、时限和其他平台默认值。
3. 生产编译成功后，独立产物英雄页读取继承的本机地图索引而报ENOENT。验收使用synthetic-fixture Catalog且产物不携带开发地图，因此在构建及smoke环境将`DOTA_MAP_COLLECTION_PATH`、`DOTA_MAP_DATA_PATH`显式置空，防止dotenv重新注入。正式产品对显式配置缺失／损坏地图的校验不变。

## 本机验证

`1384560`发布检查通过格式、Lint、文档、类型、87文件452单元、12fixture浏览（7项数据条件跳过）、18真实浏览（1项fixture专用跳过）及完整23数据库合同。两轮浏览均无flaky；未复现旧详情跳转、页面崩溃或原生worker退出。首轮完整编译5.2分钟，但因上述地图路径继承问题启动失败，不能计为完整产物验收。

增加fixture隔离后，`pnpm release --build-only`重新编译5.4分钟，并通过数据库身份验证的Catalog API、英雄页、静态资源和生产开发接口404检查。产物manifest为passed；没有配置远程部署目标。本机证据目录为`.medota2/releases/4bddc1190e44ffa7a84162b5e298329ead7c3a0f4d47c6b18141817e3835cab3/`，只在该Windows环境可用。

最终发布仍由`pnpm push`针对候选运行原检查计划；有效静态结果及构建按输入身份复用，浏览／数据库重新核验。精确代码SHA、数据回读及CI结果保存在该环境`.medota2/publications/`的收据，远端结果可从[main提交历史](https://github.com/CharlesLiuyx/Medota2/commits/main/)核对。发布不替代页面人工审阅、同版引擎语义核验或原始资产交接。

## 复现与边界

在本机便携Node22.23.3及项目pnpm的进程PATH下运行`pnpm push --plan`、`pnpm push`；如已推送仅CI确认中断，按[同步手册](../development-data-sync-runbook.md)使用`pnpm push --resume`。失败诊断日志为`.medota2/sessions/publish-all-20261009*.log`、`publish-windows-path-check.log`、`publish-windows-unit-concurrency.log`与`publish-windows-standalone-check.log`；忽略目录不是跨机器附件。

该结果只确认当前Node22代码／数据组合。本轮没有重新验证Node24的0xC0000005，也没有完成长时间运行与游戏引擎校准；剩余范围见[Windows任务](../work/windows-native-validation.md)及[环境登记](../development-environments.md)。
