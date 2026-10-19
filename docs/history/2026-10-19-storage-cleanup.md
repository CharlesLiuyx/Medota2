# 项目目录深度清理与增长治理

日期：2026-10-19。环境：GofurMacM4Max128GB、macOS arm64、Node26.8.1、pnpm11.7.0。代码基线main/a05bc58加既有未提交改动；本轮未提交推送。测量范围是本项目目录，`du -x -k`统计实际分配块，不包含项目外Docker卷或相邻来源仓库。

## 实际结果

目录从10060572 KiB（9.59 GiB）降至约4801900 KiB（4.6 GiB），净释放5.0 GiB，约52%。后者包含本轮完整验证留下的正式产物、日志和报告，已回收本轮停用编译缓存。数值为收尾测量时点，后续复测以本机审计时间为准。

| 目录                  | 清理前MiB | 清理后MiB | 处理                                                      |
| --------------------- | --------: | --------: | --------------------------------------------------------- |
| .medota2/shared-tests |      1990 |       200 | 过期、失去进程及已结束诊断的附件按预算回收，run与日志保留 |
| .medota2/cache        |      1718 |       289 | 两个固定版本完整Git树保留，去掉整仓历史和无关工作树文件   |
| .medota2/sessions     |       910 |       328 | 34份历史文本无损压缩，23份重复trace按SHA-256去重          |
| .next                 |       900 |         0 | 确认服务退出并持工作台锁后回收                            |
| .next-release         |       474 |        97 | 回收编译cache，保留正式运行文件                           |
| .medota2/data-sync    |      1794 |      1794 | 保留业务快照、恢复和独立远端核验副本                      |

其余主要占用：依赖约648 MiB、output约437 MiB、本机Linux浏览器约343 MiB、发布记录和包约258 MiB；另有Git、地图及数据库备份。output包含品牌原稿、地图包及截图，未将它们当作可盲删缓存。同步旧导出核对4757文件，1份manifest的代码提交、导出时间和parents不同，因此保持完整，未冒充完全重复的包删除。

## 根因与持续修复

1. **清理只按数量，没有总容量约束。** 测试完整附件增加512 MiB预算；成功最多10份、失败最多5份，未解决失败保护7天，`.keep`保护。保护项可以超预算，但有告警；`.resolved`只解除诊断附件保护，不篡改失败状态。旧终态记录不再因缺PID永久保留。
2. **强杀留下永久running。** 共享测试PID已退出且startedAt超过保护期后可回收附件；数据库租约、未知时间及活动进程继续保护，执行前再次核对。
3. **来源整仓镜像和全量展开。** 新流程只按完整commit浅获取，缓存已有对象时离线复用；工作树只展开NPC、版本／更新文件及中英本地化。现有来源镜像1088780→235560 KiB，f4c457工作树640516→约30108 KiB。两个固定版本991daaf6／f4c457的完整树、source lock逐文件SHA256、工作树HEAD／干净状态和Git fsck均通过。第一次切换因Git worktreeConfig下core.bare位置不匹配自动回滚；修正候选配置后才完成替换，原始外部来源仓库未改写。
4. **编译缓存和人工诊断没有退出预算。** 开发缓存默认1 GiB，等待Web结束后持锁回收超额目录；正式cache默认512 MiB，在release锁内回收。新增`pnpm storage:audit`，开发启动及持续运行期间每日最多一次全目录审计。AGENTS新增诊断采样、压缩、禁止重复复制CI附件和新目录生命周期要求。

审计为内容字节计量，和du块数口径不同。sessions仍超过256 MiB提示线：剩余约328 MiB含独有历史CI报告、截图与已压缩证据；本轮核对保留，后续新增仍须解释。告警不会自动删除业务数据。版本更新、新依赖和新的验证证据可合理增加占用，本轮消除了已定位的无界生成路径，不承诺目录永远固定大小。

## 验证与数据保护

完整检查`1792417538752-3abfc860`通过全部10项计划：格式、lint、文档、类型、609单元（2项平台条件跳过）、49真实旅程（1项fixture条件跳过）、6视觉、4所选数据库合同（19项未选）、解析基准、正式构建及独立启动；浏览无重试。冷编译112秒，解析5次中位4.4ms／p95 4.6ms。真实Git测试覆盖浅获取、离线复用、稀疏展开、固定对象保留和拒绝覆盖本地修改；清理用例覆盖活动租约、死进程、预算、链接越界、固定保留及生产文件保留。

图谱work-graph-feedback已同步，并用真实浏览器点击核对512 MiB预算、固定commit浅获取说明和无横向溢出；只有favicon404，无脚本错误。收尾仅文档变更另行执行文档及格式检查。

实际业务摘要`9e26a2d182c55a06b90c2241ea8abfa2021d8c47cddf60bbc21eb91ec4eb67e7`、地图摘要`9f89f2c5dfa1e5999b481da29e3b4d779e5df76292de639a411d0d07ad631291`与前轮记录一致，data:status为预期code-modified、problems=[]。dev-data.lock、活动状态、地图和备份在最终回收前后逐文件哈希保持；其他任务已有tracked diff逐文件比较保持。未导入、迁移、重置或发布业务数据。验证后工作台恢复停机；Windows／Linux原生运行未在本轮复验。

## 本机证据与复跑

本机证据位于`.medota2/sessions/storage-20261019/`，不随Git跨机器交付。`evidence-compression.json`记录原文件路径、gzip路径和原SHA256；解压gzip即可恢复原文，34份均在移除原文本前逐字节核对。`archived-trace-dedupe.json`记录23份重复trace及保留的完整HTML报告路径、SHA256。原报告保持可读；过期测试附件按策略移除，run与日志记录原结果。

`source-cache.json`记录固定commit核验，`data-status.json`保存实际摘要，`check.log`／`check-plan-final.json`保存验证，`final-du.txt`／`final-audit.json`保存占用与预算。本机脚本为本次迁移取证，不是跨机器可直接套用的清理命令。复跑入口：

```bash
pnpm storage:audit
pnpm storage:clean
pnpm storage:clean --apply
pnpm check --files src/development/storage.ts src/development/storage-audit.ts src/workers/storage-clean.ts src/workers/dev.ts src/importers/catalog-source-lock.ts
```

持续规则见[工作台Spec](../specs/development-workbench.md#自动保留与日志容量)、[运行手册](../operations/development.md#空间保留与日志)及[来源导入](../operations/catalog-import.md)。
