# 当前进展

更新：2026-10-06。

## 当前目标

落实已批准的[开发脚手架方案](reviews/development-scaffold-review-2026-10-06.html)：在同一个页面直接看到多个 AI Session 的组合改动，日常流程按需执行。产品仍以持续积累游戏源数据、结构化保存和复杂分析为长期目标。

## 已确认决定

- 日常共用目录、分支、Web、编译缓存和选定的本机数据库；预览优先复用已有真实数据及资产，development 样例保留作显式选择；短时串行操作见 AGENTS.md。
- Codex、Claude Code、OpenCode 指向同一组上下文和命令。
- 少量 E2E 覆盖关键流程，已有针对性测试按用途保留。`verify` 留作显式全量诊断。
- 现有 TypeScript 解析器就是计算样例使用的实现；大型运行时或新语言先测量再决定。
- 远程部署目标尚未确定，release 负责准备并检查 Web 产物。

## 本次实施

共享预览、样例进程、按需检查、可复用测试环境、CI 范围规划、基准和本地产物入口已实现并完成本机验证。完整使用说明见 [开发工作台 Spec](specs/development-workbench.md)。

## 接手方式

1. 阅读 AGENTS.md、CONTEXT.md 和本文件，再看 `git status` 与相关 diff。
2. 查看 `.medota2/sessions/`，建立自己的简短记录，保留已有改动。
3. 运行 `pnpm dev`，浏览 `http://127.0.0.1:3000/heroes`。
4. 用 `pnpm check --plan` 查看所需范围；完成修改后运行 `pnpm check`。
5. 更新自己的任务记录；稳定结论和未完成事项写回本文件。

## 已知情况

本次开始前已有 OpenDota 私密配置相关的未提交修改（`.env.example`、`README.md`、`src/config/env.ts` 和对应 Spec）；实施时保留。方案 HTML 位于 `docs/reviews/`，实现规范位于 `docs/specs/development-workbench.md`。

## 验证记录

2026-10-06，本机 macOS arm64、Node 26.8.1：

- `pnpm check` 的 7 项检查通过：格式、ESLint、类型、199 个单测、共享页面的 2 条关键流程、19 个数据库集成测试、独立 Web 构建与启动。
- `pnpm test:journeys --fixture` 的 3 条流程通过，已知移动速度 310 同时核对 API 和页面。共享当前数据的流程按设计跳过该固定数值断言。
- `CI=true pnpm check --files src/components/hero-card.tsx` 通过，仅选择英雄相关流程，并使用测试数据；GitHub Actions 尚未远程执行。
- 停止后同时发起两次 `pnpm dev`，5.8 秒内连接到同一工作台实例，重启前后的 Catalog 响应保持一致。
- 同一浏览器页面组合验证了界面和 fixture 修改、URL 参数及面板展开状态保留、连续保存、报错恢复、取消和手动重算。两次预热保存测量中，界面到屏幕为 0.26–0.96 秒，小样例为 0.35–0.89 秒；这是当前小输入的本机样本，不是大数据性能保证。
- 文档检查首次运行、再次复用、执行中改动后标为 `stale` 并退出 2、`--watch` 重查均通过。测试参数筛选和数据库排队复用也已实际验证。
- `pnpm bench --iterations 5`：6,069 字节固定输入，解析中位 4.6 ms，p95 4.9 ms，进程峰值 74 MB。测量含文件读取和解析；进程启动时间单独包含在总用时中。
- 独立 `app/` 通过真实数据库查询、页面、静态资源和生产环境禁用开发 API 的启动检查；无 dotenv 或 `.medota2`，验收副本已清理。同一入口再次运行可复用产物。

详细本机证据：`.medota2/checks/1791227860424-b9ef1afd/run.json`、`.medota2/checks/1791227970986-bb7e2ae7/run.json`、`.medota2/checks/acceptance.json`、`.medota2/development/acceptance.json`、`.medota2/development/concurrent-start-acceptance.json`、`.medota2/benchmarks/runs/`。产物见 `.medota2/releases/`，浏览器截图见 `output/playwright/`。这些本机生成文件不提交。

## 头像问题修复

此前共享页面接入了两位英雄的合成 fixture，图片请求虽返回 200，内容却是 generated fallback；当时的关键流程未检查真实头像，属于脚手架默认数据和验收遗漏。

已改为优先复用已有 local-review 真实数据，启动前执行完整资产审计。当前数据为 127 Heroes、2,703 Abilities，2,830 项图片绑定完整、LoD 完整、零占位图；页面使用同一个 `3000` 地址。小样例只负责快速计算反馈。显式选择方法见 README。

修复验证通过：201 个单测、4 个受影响的数据库用例、真实数据的英雄/技能浏览及原生图片断言、3 条固定数据流程、正式构建与独立启动。证据：`.medota2/checks/1791228689976-6fbe5543/run.json`；在当前应用内浏览器确认可见头像均已解码，截图 `output/playwright/restored-hero-assets.jpg`。

## 后续接手

- 可以直接在共享工作台开始下一项产品需求，按变更范围运行 `pnpm check`。
- Claude Code / OpenCode 的共同上下文入口已配置；实际更换模型时，仍用一次小改动和对应检查验证其接手效果。
- 远程部署平台和运行配置需要在有具体交付目标时确定；当前未发布到外部平台。
