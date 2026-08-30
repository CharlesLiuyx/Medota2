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

- 当前 MVP 技术栈已由 `docs/architecture/technology-selection.md` 落地；新增大型框架、服务或 Rust 前先提交 ADR。
- 修改运行时组件时，同步补充真实可执行的安装、运行和测试说明。
- 大型原始快照、凭据、`.env`、数据库文件和缓存不提交到 Git。
- 变更外部来源假设时，同步更新 `docs/repositories/` 的说明与审阅基线。
- 保持 README 的状态、仓库结构和路线图与实际内容一致。

## 文档入口

- `README.md`：项目定位、当前状态与路线图。
- `docs/repositories/README.md`：外部来源关系、选源和 provenance 要求。
- `docs/repositories/*.md`：三个来源的结构与职责审阅。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
