# ADR 0006：使用 Run-scoped Harness 隔离自动验证

- 状态：Accepted
- 日期：2026-08-31
- 关联：[Environment Isolation、Test Run Harness 与 Verification Evidence Spec](../specs/environment-isolation-and-verification.md)、[ADR 0005](0005-environment-contract.md)

## Context

ADR 0005 已经把 Runtime Environment、Data Class、Database Identity、role 与 operation 收敛为 Environment Contract，但它原先只阻止跨环境误连。固定的 test database、Web port、Next dist 和 Playwright output 仍会让两个合法 test run 互相覆盖；development 与 local-review 若复用同一 PostgreSQL volume，也仍共享故障域。

验证结果此前散落在终端和固定目录，无法回答“哪个 Git 状态、哪个数据库实例、哪些 migration/head、哪组工具版本产生了这次结果”。同时，Catalog promotion 已有双锁和 coverage guard，而 rollback 仍可能通过旧函数接口绕过对称门禁。

## Decision

### 1. Test Run Harness 是唯一自动化编排入口

`pnpm test:integration`、`pnpm test:e2e` 与 `pnpm verify` 都由 Test Run Harness 编排。每次运行生成带时间和随机熵的 Run Identity，并签发一个不可变 Run Context。Vitest、Playwright、Next 和数据库 fixture 只消费该 context，不自行选择共享资源。

每个 run 独占：

- Compose project 与 PostgreSQL host port；
- `.medota2/test-runs/<run-id>/state` receipt root；
- Web port/origin、Next dist 与 run-local TypeScript config overlay；
- coverage、Playwright report/test-results、逐步日志和 manifest 目录。

Playwright config 在缺少 Harness 环境时直接拒绝启动，避免直接调用重新引入固定默认值。

Next 会把动态 `distDir` 的类型路径写入它使用的 TypeScript config。Harness 因此在 run root 生成继承仓库配置的 `tsconfig.next.json`，并让 build/dev 只修改该 run-local overlay；仓库根 `tsconfig.json` 不属于 Test Run 的可写资源。

### 2. Test database 使用一次性 stack

Test Run 为每次执行创建 PostgreSQL 18.2 Compose project，数据目录使用 tmpfs，不挂持久 volume。PostgreSQL 只发布到本机 `127.0.0.1` 的动态端口；测试进程使用 `loopback-only` policy，Steam CDN、remote Git 与 webhook adapter 在发起外部 I/O 前 fail closed，Playwright 也拒绝非 loopback HTTP(S) 请求。

Docker Desktop 无法让宿主 Harness 访问 `internal: true` 网络上发布的端口，因此 test Compose 使用 run-scoped bridge network。该 network 不是外网隔离声明；实际执行测试代码的宿主进程由统一 network policy 和浏览器 route guard 约束。

Harness 只根据完整 Resource Lease 销毁精确 Compose project。成功、失败和第一次中断都尝试销毁该 stack；只有显式 debug keep policy 才保留失败数据库。state credential 与 Next dist 在正常 cleanup 后删除，非敏感证据和测试产物保留。

### 3. development 与 local-review 使用不同持久 stack

受管本地环境使用以下默认边界：

| 环境         | Compose project        | host port | state root                           | 数据生命周期 |
| ------------ | ---------------------- | --------: | ------------------------------------ | ------------ |
| development  | `medota2-development`  |     54321 | `.medota2/environments/development`  | persistent   |
| local-review | `medota2-local-review` |     54322 | `.medota2/environments/local-review` | persistent   |

每个 project 有自己的 named volume。初始化仍创建 Environment Contract 所需的三条 marker，但只有与命令声明相符的环境数据库被日常进程使用。production 没有本地 Compose fallback。

现有旧 `127.0.0.1:54321` 栈不因本 ADR 自动 cutover、迁移或删除。它需要独立、精确的破坏性授权和前后证据。

### 4. Verification Manifest 是验证结果的 source of truth

Harness 在 run root 原子写入版本化 `run.json`，并生成 `index.md`。证据至少包括：

- Run Identity、suite、时间、最终状态和 cleanup 结果；
- Git commit/dirty、Node、pnpm、Playwright 与 PostgreSQL 版本；
- 每个 step 的 argv、时间、duration、exit code 和独立日志；
- Compose project、动态端口及 run-relative 产物路径；
- migration ledger、Catalog/Asset heads、关键计数、安全数据库指纹和 public schema hash；
- destructive fixture 前后的数据库 evidence snapshot。

Manifest 不记录密码、数据库 URL、完整 database/instance identity、system identifier 或本机外部来源路径。CI 调用同一个 `pnpm verify`，不维护第二套验证顺序。

### 5. 数据库发布门禁对 promotion 与 rollback 对称

Catalog promotion 和 rollback 都必须按 `Catalog advisory lock → Asset advisory lock` 取得事务锁，验证目标 Catalog 有完整匹配的 Asset head，并默认拒绝 exact/native Valve coverage 比例下降。只有显式 boolean override 才能接受下降。

Worker 不再拥有旧二参数 rollback function 的 EXECUTE，只能调用三参数受审 SECURITY DEFINER interface。应用层 CLI 的 `--allow-fallback-downgrade` 只把显式意图传给数据库，不能取代 SQL invariant。

### 6. 辅助资产映射也进入 provenance

通过 `dotaconstants/build/heroes.json` 和 `build/abilities.json` 生成 Steam static 路径时，Asset Dataset manifest 同时记录 source repository、remote、commit、dirty/input-match、相对路径、每文件 checksum/size 和映射 manifest checksum。被读取的文件必须是 tracked 且内容与 HEAD 一致；无下载路径时该 provenance 明确为 `null`。

## Consequences

### 正向结果

- 两个测试 run 可以并发而不共享数据库、端口、receipt、Next dist、TypeScript config overlay 或报告目录。
- Integration 红队测试即使失败，也不会污染 development/local-review 的持久数据。
- 一次绿色结果可以从 manifest 追溯到代码、工具链、数据库 schema/head 和逐步日志。
- 测试禁网、数据库身份和 SQL 发布门禁分别位于统一 adapter，而不是依赖 caller 自律。
- rollback 与 promotion 不再存在权限和 coverage policy 的不对称接口。

### 成本与限制

- Integration/E2E 每次都要初始化 PostgreSQL，启动时间高于共享 test database。
- Docker daemon 和本机 OS 仍在信任边界内；`loopback-only` 是应用 adapter policy，不是主机级 sandbox。
- 动态端口只用于资源定位，不构成 Environment Identity。
- 本 ADR 不定义 production topology、远程 secret manager、TLS trust root 或跨主机 test executor。
- 已经签发的 mutation session 仍没有通用 revocation epoch；ADR 0005 的该限制不变。

## Rejected alternatives

- **继续复用 `shared-e2e`/固定 3100 与固定数据库**：有环境标识但没有 run isolation，无法安全并发或证明 cleanup 范围。
- **只为表加 run_id**：不能隔离 schema/role 漂移、migration、端口、Next cache 和报告目录。
- **在 CI 单独维护一套 service-container 脚本**：会让本地与 CI 的验证行为分叉；CI 应消费同一 Harness interface。
- **让 rollback CLI 先在 TypeScript 比较 coverage**：其他 SQL caller 仍可绕过，数据库 head invariant 必须由 PostgreSQL 强制。
