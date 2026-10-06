# Medota2 开发指引

## 当前状态

Medota2 已实现首个英雄元数据 MVP。仓库包含 Next.js Web、PostgreSQL migration、VPK 导入器、dotaconstants 参考比较、测试 fixture，以及单元、集成和 E2E 测试。

文档、Issue 和代码仍必须区分“当前已有”和“后续计划”。README 中列出的命令是当前真实接口；修改脚本、目录或运行要求时同步更新 README 和 Spec。

## 项目职责

Medota2 计划负责：

- 外部数据的适配、校验、标准化与版本兼容；
- 比赛/API/回放数据接入；
- 稳定的产品领域模型、存储和查询；
- 分析逻辑、本地服务、界面与测试。

`GameTracking-Dota2`、`dota_vpk_updates` 和 `dotaconstants` 是独立的可选上游来源，不属于本仓库，也不是当前已安装的依赖。不要把它们 vendor 或批量复制进本仓库。

## 数据接入规则

- 每个来源保留独立适配边界，再映射到 Medota2 领域模型。
- 输入位置必须可配置；不能依赖某个用户机器上的相邻目录或绝对路径。
- 派生数据至少记录 `source_repository`、`source_commit`、`source_path`、`client_version`、`imported_at`、导入器版本和目标 schema 版本。
- 对缺失字段、未知键、重复 ID、补丁切换和来源冲突建立显式校验与测试。
- 不通过文件修改时间推断数据版本，也不把某个 checkout 自动视作最新上游。
- 外部游戏资源在再分发前必须单独审查许可；公开 Git 仓库不等于资源可以自由复制。

## 开发规则

- 每次开始先读 `CONTEXT.md`、`docs/current.md`、当前 `git status` 和相关 diff；任务或接口变化后重新读相关上下文。
- 开始任务时读取 `docs/development-environments.md`，核对当前环境职责、资源与限制；发现资源／工具／平台缺项时，推荐具备对应能力的已登记环境，说明依据、版本条件、待核验项与交接步骤，并继续完成当前环境可独立开展的工作。环境事实集中更新该登记册，不把机器路径写成代码默认值，不把推荐当作远程执行授权。
- 默认共用当前目录、分支和 `pnpm dev` 的固定工作台（`http://127.0.0.1:3000`）。第二个 Session 复用服务；用 `pnpm dev:restart` 迁移/重启并恢复预览。
- 每个 Session 在 `.medota2/sessions/<id>.md` 写目标、涉及文件/接口、检查结果和状态。改同一处代码前读取最新内容，冲突由一个 Session 整合；不得覆盖他人的未提交改动。
- 暂存/提交/切换分支、安装依赖、共享数据库迁移和重置先协调并顺序执行。普通代码编辑继续并行；不自动提交、推送或发布。
- 用户授权推送时使用 `pnpm push` 一起交接代码和完整本地业务数据；另一环境使用 `pnpm sync` 拉取同一代码与数据快照。机器差异仅留在兼容配置中，不为各机器维持不同业务数据版本。
- 日常用 `pnpm check --plan` 查看范围，用 `pnpm check` 运行或复用必要检查。指定范围可用 `--files`，持续编辑可用 `--watch`。结果过期时补跑有关检查；`pnpm verify` 仅作显式全量诊断。
- 测试以少量有效使用流程为主；计算改动检查已知答案，需要时运行 `pnpm bench`。不为每个函数新增测试，不把覆盖率作为默认门槛。
- 结束或交接时，把稳定结论、尚未解决的问题和下一步写入 `docs/current.md`。工具私有聊天记录不作为唯一上下文。

- 当前 MVP 技术栈已由 `docs/architecture/technology-selection.md` 落地；新增大型框架、服务或 Rust 前先提交 ADR。
- 修改运行时组件时，同步补充真实可执行的安装、运行和测试说明。
- 大型原始快照、凭据、`.env`、数据库文件和缓存不提交到 Git。
- 变更外部来源假设时，同步更新 `docs/repositories/` 的说明与审阅基线。
- 保持 README 的状态、仓库结构和路线图与实际内容一致。

## 文档入口

- `README.md`：项目定位、当前状态与路线图。
- `docs/development-environments.md`：各环境职责、资源、限制、核验依据与任务推荐／交接规则。
- `docs/repositories/README.md`：外部来源关系、选源和 provenance 要求。
- `docs/repositories/*.md`：三个来源的结构与职责审阅。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
