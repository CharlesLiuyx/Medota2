# 同步副本去重与产物回收验收

日期：2026-10-19。环境：GofurMacM4Max128GB、macOS arm64、Node26.8.1、pnpm11.7.0。代码基线main/a05bc58及既有未提交修改；本轮未提交推送。前轮见[目录空间治理](2026-10-19-storage-cleanup.md)。测量为项目内du分配块，不包含外部来源仓库及Docker业务卷。

## 容量与保留

本轮4802696→约2954200 KiB，即4.58→2.82 GiB，净释放约1.76 GiB（38.5%）。结合前轮，最初9.59 GiB已降至约2.82 GiB，累计减少约70.6%。收尾文档及检查收据会带来少量差异。

| 范围                |       前 |      后 | 处理                                                          |
| ------------------- | -------: | ------: | ------------------------------------------------------------- |
| data-sync           | 1794 MiB | 844 MiB | 旧载荷压缩去重、已发布缓存回收、删除已结束来源下载实验        |
| 发布目录            |  258 MiB | 129 MiB | 保留最近成功构建及必要失败记录                                |
| shared-tests        |  200 MiB |  26 MiB | 新保留数量及128 MiB预算，保留摘要与日志                       |
| .next-release       |   91 MiB |  16 MiB | 验收后删除重复standalone，收尾回收闲置编译cache               |
| Linux视觉浏览器目录 |  343 MiB | 0.1 MiB | 删除Darwin不用的可重装浏览器，保留配置脚本                    |
| output              |  437 MiB | 322 MiB | 删除超过7天的浏览截图；近期截图、脚本、品牌原稿和地图素材保留 |
| .playwright-cli     |   34 MiB |  11 MiB | 328份旧文本无损gzip，解压SHA-256逐份核对                      |

同步目录仍保留完整repository约344 MiB、固定来源约256 MiB、按哈希去重的压缩历史载荷约96 MiB、旧bundle的Git与独有文件约91 MiB、地图约39 MiB，以及应用记录和候选。导出和一个旧bundle各有5个repository中不存在的文件，均保留原位。没有把这些文件当作重复数据删除。

旧包的manifest、来源及Git历史保持；重复objects/tables集中到payload-archive，每个哈希仅存一份gzip，compacted.json记录原路径、SHA和大小。原仓库以后切换版本，归档仍可离线恢复。真实旧发布包已两次恢复4756个文件；追加宽限期修复后，默认预览不再选择刚恢复的旧包，随后显式compact回收验证产生的副本。

## 持续机制

- 同步回收独占data-sync锁，保护祖先.keep、active/switch/candidate引用、独有和未发布内容；先验原文件与repository身份，再写归档、解压核对、原子写恢复收据，最后逐文件删除重复载荷。
- 默认闲置7天；显式导出、打包、恢复刷新使用收据。成功发布的工作目录和独立远端验证缓存闲置7天或单目录超过384 MiB，且精确HEAD匹配成功收据、Git干净、没有HEAD之外的引用提交时才回收。下次需要重新下载独立远端验证内容。
- 工作台就绪及每6小时尝试构建／测试／同步维护，成功publish/lock/apply/sync收尾也尝试同步维护。锁忙则跳过；CI及禁用开关保持。归档、业务数据库、必要来源及原创素材不参与年龄删除。
- 成功构建最多1份且7天内；成功测试最多3份、失败最多2份，完整附件共同128 MiB，未解决失败仍保护7天。release完成复制及独立启动验收后回收重复standalone；编译cache沿用容量预算。本次验证结束后另持锁回收闲置编译cache。

命令、参数与保护边界由[同步手册](../development-data-sync-runbook.md#本地副本清理与恢复)和[开发手册](../operations/development.md#空间保留与日志)维护。原始图片设计和地图素材留在独立目录；新增手工截图走受管测试run，跨平台浏览器用后回收，见[Agent规则](../../AGENTS.md#本机产物与空间预算)。

## 验证与限制

初轮完整check `1792418873644-426a0222`全部9项通过。随后补上刚恢复旧包的使用宽限期：最终代码check `1792419082384-353e686e`的格式、lint、文档、类型、613单元（2平台条件跳过）、49真实旅程（1条件跳过）及正式构建／独立启动通过。视觉globalSetup的表格值预热出现一次HTTP409，未进入截图断言；按规则单项重试 `1792419342695-6e5dfa3c`，6项视觉全部通过，记为flaky，保留原失败。随后补跑原计划未执行的4项数据库合同，全部通过（19项未选）。没有改写失败收据；这是最终代码的分批验证结果。

4个新存储流程测试覆盖压缩／离线恢复、原仓库切换、重新获得闲置宽限、独有/损坏/固定/活动引用保护、越界链接拒绝以及真实Git未发布提交保留。已有存储边界测试通过。下一次发布到远端及Windows/Linux原生行为没有在本轮执行；本轮仅本地文件维护和测试。

锁定业务快照bee227bd的157499767字节／100274行全量文件核验前后一致，manifest仍为54abc14af0fc36b4288312a75091df2453e1184628c613668d4ccb92a03c5224。实际数据库digest仍为9e26a2d182c55a06b90c2241ea8abfa2021d8c47cddf60bbc21eb91ec4eb67e7，地图仍为9f89f2c5dfa1e5999b481da29e3b4d779e5df76292de639a411d0d07ad631291；data:status为预期code-modified、problems=[]。首次停机状态下读取失败，启动检查环境后重新读取成功。

保护清单1602文件（锁、活动状态、来源、地图、备份、品牌和地图素材）前后SHA全部一致；两个来源commit和Git fsck通过，代码范围外既有tracked diff保持。最终工作台停止、Medota2容器回收，业务卷保留。

## 本机证据与恢复

`.medota2/sessions/storage-sync-20261019/`包含before/final-du、capacity、sync-applied/final、protected-before/after、source-check、snapshot-before/after、data-after、check-final/retry、database-final及恢复证明。这是忽略的本机证据，不是跨机器附件。retired-extras.json保存被回收实验、浏览器与旧截图的路径和SHA，cli-log-compression.json保存文本gzip恢复索引；旧截图需按保留脚本重新生成，不能从索引还原像素。

Linux浏览器为锁定Playwright1.62.1、Chromium headless revision1234；在Linux环境中可用`PLAYWRIGHT_BROWSERS_PATH=.medota2/linux-visual/locked-browser pnpm exec playwright install chromium --only-shell`重建。本机没有重新安装该浏览器。

```bash
pnpm storage:audit
pnpm storage:clean --scope data-sync
pnpm storage:clean --restore-sync export
pnpm storage:clean --scope data-sync --compact --apply
```

归档和compacted.json必须一起保留；对外复制完整bundle前先恢复并验证。清理会增加下一次冷构建或远端验证的准备时间，不改变业务数据。
