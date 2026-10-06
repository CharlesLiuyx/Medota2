# Medota2 开发指引

Medota2 是本地 Dota 2 数据与图鉴平台。能力和模块见 [CONTEXT.md](CONTEXT.md)，本文件只维护 Agent 的执行规则。

## 开始任务与 Context 范围

1. 读取 [CONTEXT.md](CONTEXT.md)、[当前工作](docs/current.md)、[环境登记](docs/development-environments.md)，核对 `git status`、相关 diff 和 `.medota2/sessions/` 中涉及相同文件的记录。已自动加载的相同内容无需重复读取。
2. 按[文档导航](docs/README.md#按任务读取)追加本任务的 Spec、ADR、代码及测试。默认不展开 `docs/history/` 和大型 HTML Review；调查旧决定时按链接读取。
3. 在 `.medota2/sessions/<id>.md` 写范围卡：**目标与完成条件、可修改文件／接口、读取的合同、代码及未提交改动基线、数据／环境、验证范围、状态与下一步**。不涉及数据时注明；涉及时核对 lock、Catalog 或地图版本。跨 Session／机器的长任务另在 `docs/work/` 保留必要交接。
4. 任务新增模块、迁移、来源版本或运行环境时，先更新范围并补读相关合同；不能将既有授权自动扩展到新的高风险操作。普通实现细节自行决定，不重复询问已明确的需求。

缺少 Context 或证据时明确缺项，按索引、Git 历史、来源与复现命令恢复；不能凭旧日志或私人聊天补造当前事实。当前环境缺能力时，按登记册推荐具体环境、版本条件、待核验项与交接步骤，并继续独立工作；推荐不等于远程执行授权。

## 共享工作台与协作

- 默认共用当前目录、分支和 `pnpm dev` 工作台（本工作区通常为 `http://127.0.0.1:3000`；已初始化工作区以命令报告的 origin 为准）。第二个 Session 复用服务；配置、迁移或脚手架变化后用 `pnpm dev:restart` 恢复预览。
- 改同一处代码前重读最新内容；冲突由一个 Session 整合，不覆盖别人的未提交改动。暂存、提交、切换分支、安装依赖、共享数据库迁移／重置与性能基准先协调，短时顺序执行。
- 不自动提交、推送或发布。用户授权推送时用 `pnpm push` 交接代码和完整业务数据；另一环境用 `pnpm sync` 消费同一基线。两者的副作用见[同步手册](docs/development-data-sync-runbook.md)。机器差异只留在兼容配置中。

## 实施与验证

- 先用 `pnpm check --plan` 看范围，修改后运行 `pnpm check`；指定范围用 `--files`，持续编辑用 `--watch`。过期结果补跑有关检查，`pnpm verify` 用于显式全量诊断。
- 测试覆盖少量有效使用流程；计算检查已知答案，测量对应实现。复用已有专项测试，不为每个函数新增测试，不把覆盖率当默认门槛。检查失败先诊断，不降低标准或把局部通过说成全部通过。
- 修改命令、运行时或环境要求时，同步对应运行手册；修改行为同步负责该规则的 Spec。新增大型框架、服务或 Rust 前提交 ADR，技术理由见[技术选型](docs/architecture/technology-selection.md)。
- 纯文档由 `pnpm docs:check` 检查可达性、命令和入口，再由 `pnpm check` 检查格式；不为文档启动产品数据库或浏览器。

## 数据与来源

- 各来源独立适配，再映射领域模型。外部仓库为可选只读输入，不 vendor 或批量复制进代码仓库；输入位置可配置，不使用机器绝对路径作为默认值。
- 派生数据保留 `source_repository`、`source_commit`（非 Git 来源明确为空并保留 URL／哈希）、`source_path`、`client_version`、`imported_at`、导入器与 schema 版本；未知版本不猜测。
- 对缺失字段、未知键、重复身份、补丁切换和来源冲突显式校验。数据版本不用文件修改时间、分支名或 checkout 的“最新”状态推断。Catalog、资产、地图、同步快照与数据库身份按[数据流](docs/architecture/data-flow.md)分别处理。
- 已应用的旧 migration 不改写。凭据、`.env`、数据库卷、大型原始快照和缓存不进入代码 Git；批准的业务包按私有数据同步协议交接。外部资源再分发仍需许可审查。

## 结束任务与信息归属

按[SSOT 表](docs/README.md#事实归属与更新流向)回写原维护位置：稳定概念回 CONTEXT，行为回 Spec，决定回 ADR，机器事实回环境登记，来源假设回来源审阅。README 只同步能力摘要与入口。

`docs/current.md` **替换更新当前状态，不追加整段流水**；只保留活动任务、阻塞、下一步和关键交接链接。长任务细节在 `docs/work/`，完成过程及验收进入 `docs/history/`。本机日志／截图标明所属环境、代码／数据基线、验证范围及复现命令；忽略目录路径不视作跨机器可用附件。不能把准备完成、HTTP 可用或推送成功当作完整产品验收。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
