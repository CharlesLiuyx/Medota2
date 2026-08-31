# Environment Isolation、Test Run Harness 与 Verification Evidence Spec

- 状态：Implemented locally；legacy stack rollout 待单独授权
- 日期：2026-08-31
- 关联：[Medota2 Domain Context](../../CONTEXT.md)、[ADR 0005：使用可证明的 Environment Contract 隔离运行环境](../adr/0005-environment-contract.md)、[ADR 0004：Hero 与 Ability 图标使用数据库资产数据集](../adr/0004-database-icon-asset-datasets.md)
- 历史输入：`architecture-review-20260831-051314.html` 的 A–E 架构候选；该报告只作为审查证据，本 Spec 是后续实现与验收基线

## 1. 文档目的

本 Spec 把 Medota2 的环境隔离、测试运行隔离、数据库栈生命周期、验证证据和数据库发布门禁定义成一套可执行合同。它回答五个问题：

1. 一个进程如何证明自己连接的是预期环境；
2. 两次自动化测试如何保证数据库、端口、缓存和产物互不覆盖；
3. development、local-review、test 与 production 如何避免共享故障域；
4. 一次验证如何留下可复核、不可被下一次运行覆盖的证据；
5. 任何调用路径如何都不能绕过 Catalog/Asset head 的数据库级不变量。

本 Spec 不以“命令返回 0”作为完成标准。完成意味着所有 Interface、状态转换、失败模式和 Definition of Done 都有实现与自动化证据。

## 2. 历史基线与目标状态

历史架构审查提出五个深化候选。本 Spec 将其视作一个依赖有序的整体，而不是五个互不相关的重构：

| 候选 | Module                | 历史基线状态                                                                            | 本 Spec 的目标                                                                                                |
| ---- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A    | Environment Contract  | implementation 已存在；原有 `127.0.0.1:54321` 数据栈尚未执行显式 cutover                | 保持唯一正常数据库 seam；所有新测试和验证工具只能消费 verified capability                                     |
| B    | Test Run Harness      | 未实现；Integration/E2E 使用固定 `shared-*` Run Identity、数据库、端口和目录            | 每次运行获得唯一 Run Context 与精确资源 lease；两个 run 可并发                                                |
| C    | Data Stack Lifecycle  | 环境角色和浏览器 origin 已区分，但本地三库仍可共享 container/volume                     | development 与 local-review 使用独立持久 stack；test 每 run 使用 disposable stack；production 无本地 fallback |
| D    | Verification Evidence | 检查输出散落在终端、固定 coverage/report 目录                                           | 单一 verify Interface 产出 manifest、逐步日志、数据库证据与索引                                               |
| E    | DB Gate Consolidation | promotion 已有双锁与 SQL coverage guard；rollback 仍缺对称的 asset lock/coverage policy | promotion 与 rollback 具有相同锁顺序和数据库级 coverage 单调性                                                |

依赖顺序固定为 `A → B/C → D`，E 与它们正交但必须纳入同一次数据库验收。A 的可信 Database Identity 是 B、C、D 的信任根；Harness 不能通过自造环境变量绕过它。

## 3. 目标与非目标

### 3.1 目标

- 所有 Web、Worker、migration、seed 和 test 数据库访问继续只经过 Environment Contract seam。
- 每次 Integration、E2E 或全量 verify 都生成唯一、不可复用的 Run Identity。
- 每个 Test Run 的 PostgreSQL project、host port、receipt root、Next dist、Web port、Playwright output 和日志目录都由 Harness 分配。
- Test Run cleanup 只能命中本 run 创建并记录的精确资源；不按前缀、时间或进程名猜测。
- development 和 local-review 的持久 volume、Compose project、credential receipt 与默认浏览器 origin 分离。
- test 数据库使用无持久 volume 的 disposable stack；成功或普通失败后销毁，诊断证据仍保留。
- 自动化 test 默认禁止非 loopback 的网络 adapter；fixture 不读取真实 VPK checkout、不访问 Steam CDN、不发送 webhook。
- 一次 `pnpm verify` 可复核格式、lint、类型、Unit、build/start smoke、Integration、E2E 与数据库不变量的结果。
- Catalog promotion 与 rollback 都在 `Catalog lock → Asset lock` 的固定顺序下执行，并由 PostgreSQL 阻止未显式批准的 Valve coverage 降级。

### 3.2 非目标

- 不在本 Spec 中定义远程 production topology、secret manager、TLS/SPKI trust root、备份服务或发布平台；这些必须另立 ADR。
- 不声称抵御已控制本机 OS、receipt 文件、Docker daemon 或 PostgreSQL superuser 的攻击者。
- 不把 Runtime Environment、Data Class、Run Identity、Catalog version 或 Asset Dataset version 合并成一个字符串。
- 不让 Test Run Harness 成为第二套数据库身份系统；它只 provision 并消费 Environment Contract。
- 不在自动验证中修改三个上游仓库，也不把真实 VPK、Valve 图片或大批生成资产复制进本仓库。
- 不在未经精确授权时对现有 `54321` 数据栈执行 session termination、credential rotation、owner/ACL 收敛或 volume 迁移。

## 4. 核心概念与关系

### 4.1 Test Run

**Test Run** 是一次由 Harness 拥有完整生命周期的自动化执行。它至少包含一个不可重复的 Run Identity、一份 Run Context、一组 leased resources 和一份 Verification Manifest。

`shared-integration`、`shared-e2e`、进程 PID 或固定数据库名都不是合法 Test Run Identity。Run Identity 必须在创建时随机化，并在本次 orchestration 的所有子进程中保持一致。

### 4.2 Run Context

**Run Context** 是 Harness 签发给 Integration、Playwright 和 verify adapter 的不可变输入，至少包含：

```text
run_id
suite
started_at
compose_project
database_host_port
state_directory
artifact_root
next_dist_dir
web_origin
network_policy
```

Adapter 不自行分配端口、拼接数据库 URL、选择 receipt 或决定清理范围。删除 Harness 后，这些复杂性会重新出现在每个 adapter 中，因此 Harness 通过 deletion test，属于 deep module。

### 4.3 Resource Lease

**Resource Lease** 记录 Harness 实际创建的资源及精确销毁方式。lease 至少覆盖：

- Compose project name；
- disposable PostgreSQL container 与匿名/tmpfs data store；
- host PostgreSQL port；
- state/receipt directory；
- Web port 与 origin；
- Next dist directory 与 run-local TypeScript config overlay；
- Playwright report、trace、screenshot、test-results 和 step log 目录。

Lease 不使用模糊 glob。只有 lease owner 才能 cleanup；cleanup 重复执行必须幂等。

### 4.4 Verification Manifest

**Verification Manifest** 是一次运行的机器可读证据，不是日志拼接。它采用版本化 JSON schema，并由 Markdown index 提供人类入口。manifest 至少记录：

- run schema version、Run Identity、suite、开始/结束时间和最终状态；
- Git commit、dirty 状态和 Node/pnpm/PostgreSQL/Playwright 版本；
- 每个 step 的 argv、开始/结束时间、exit code、duration 与日志相对路径；
- Runtime Environment、Data Class、database/instance 的安全 fingerprint；
- migration ledger、Catalog head、Asset head、关键计数和 public schema fingerprint；
- cleanup 结果以及失败时保留的 artifact 路径。

manifest 不记录 credential URL、密码、完整 database UUID、完整 system identifier 或本机外部绝对路径。

## 5. Module 与 Interface

### 5.1 Environment Contract

Environment Contract 的公开 Interface 继续由 ADR 0005 定义：正常 caller 只调用 `openVerifiedDatabase({ role, operation })`，并得到 opaque verified capability。Harness 不能导出 raw URL 给测试代码；raw bootstrap/control credential 只存在于 provisioning implementation 中。

每个 test 子进程必须同时收到：

- `MEDOTA2_ENVIRONMENT=test`；
- `MEDOTA2_DATA_CLASS=synthetic-fixture`；
- 唯一 `MEDOTA2_RUN_ID`；
- 本 run 独占的 state directory；
- 与 process role 相符的 admission label。

Database Identity marker、receipt、configured/observed endpoint、PostgreSQL system identifier、role、ACL 与 operation 任一不符，都必须在第一次应用查询、DDL 或 DML 前失败。

### 5.2 Test Run Harness

Harness 对 package scripts 提供三个稳定 Interface：

| Interface               | 行为                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm test:integration` | 创建 disposable Test Run，执行 migration 与 Integration adapter，写证据并精确 cleanup                    |
| `pnpm test:e2e`         | 创建 disposable Test Run，migration + synthetic seed，启动唯一 origin，执行 Playwright adapter并 cleanup |
| `pnpm verify`           | 编排静态检查、Unit、production build/start smoke、Integration 与 E2E，并生成一份总 manifest/index        |

Harness implementation 负责：Run Identity、目录、端口、Compose 生命周期、bootstrap secret、local-stack adoption、子进程环境、日志、证据和 cleanup。Vitest/Playwright config 只读取 Run Context，不再含固定 run、port、dist 或报告目录。

### 5.3 Data Stack Lifecycle

本地 stack 的生命周期矩阵为：

| Runtime Environment | Compose project        | 数据存储         | 默认 host port | state root                           | 生命周期                                       |
| ------------------- | ---------------------- | ---------------- | -------------- | ------------------------------------ | ---------------------------------------------- |
| development         | `medota2-development`  | 独立持久 volume  | `54321`        | `.medota2/environments/development`  | 显式 start/stop；允许受控 rebuild              |
| local-review        | `medota2-local-review` | 独立持久 volume  | `54322`        | `.medota2/environments/local-review` | `pnpm local` 幂等准备/启动；rebuild 需精确确认 |
| test                | `medota2-test-<run>`   | tmpfs/disposable | 动态           | `.medota2/test-runs/<run>/state`     | Harness 独占；结束后销毁                       |
| production          | 部署 ADR 决定          | 独立持久基础设施 | 无本地默认     | secret/trust adapter 决定            | 本地 Compose 不提供 fallback                   |

development 与 local-review 必须使用不同 Compose project、volume、port 和 state root。即使 logical database 名相同或兼容性 bootstrap 仍创建额外空数据库，也不能把两个环境的活动数据放在同一 volume。

`pnpm local` / `pnpm dev:local` 是 local-review 的单入口。准备器在 receipt 缺失时 provision，否则只启动原 stack；随后幂等 migration，有 active Catalog 时直接启动 Web，没有 head 时才从配置化只读来源执行首次 Catalog/Asset 导入。它不能把任意 Yellow 当作“首次启动需要”而跳过 Review：只允许在所有 diff 都是 `asset_provider_errors`，且重试资产后英雄/技能绑定与四档 LoD 完整、`generated_fallbacks = mismatches = errors = 0` 时自动批准首个候选。其他 Yellow/Red 必须停止并保留候选供人工审阅。

### 5.4 Verification Evidence

verify Module 只编排现有工具，不重新实现 ESLint、TypeScript、Vitest、Playwright 或数据库 doctor。它的 Interface 是一次 run；implementation 负责把每个工具的输出转成同一 evidence model。

默认 step 顺序为：

```text
format:check → lint → typecheck → unit+coverage
             → disposable stack provision/adopt
             → migrate → database before-fingerprint
             → integration → synthetic seed
             → production build → start smoke → E2E
             → database after-fingerprint → cleanup
```

前一 step 失败后，不继续运行依赖它的危险 step；不依赖该 step 的证据可按 fail-fast policy 跳过并明确记录为 `skipped`。无论成功失败都要尝试写最终 manifest 并执行精确 cleanup。

### 5.5 DB Gate

Catalog promotion 与 rollback 的数据库 Interface 都必须：

1. 要求 Catalog advisory transaction lock；
2. 随后要求 Asset advisory transaction lock；
3. 验证目标 Catalog 有完整且匹配的 current Asset head；
4. 比较 current/target 的 `exact / total` 与 `native / total`；
5. 默认拒绝任一比例下降；
6. 只有显式 boolean override 才允许下降；
7. 在同一事务中写 head 与审计记录。

Worker 只能调用受审 SECURITY DEFINER function；直接 SQL、旧的一参数 fallback 或少拿一把锁都不能绕过该 policy。

## 6. 状态机与失败处理

### 6.1 Test Run 状态机

```text
created
  → provisioning
  → ready
  → running
  → passed | failed | interrupted
  → cleaning
  → cleaned | cleanup_failed
```

- `created` 后立即落盘 skeleton manifest，保证早期崩溃仍有 Run Identity。
- 只有 Database Identity active 且 doctor/attestation 成功后才能进入 `ready`。
- 任一子进程非零退出进入 `failed`，不得把后续 step 记录成通过。
- SIGINT/SIGTERM 进入 `interrupted`，等待精确 cleanup；第二次信号才允许立即退出。
- `cleanup_failed` 必须列出仍存活的精确 Compose project，不自动扩大删除范围。

### 6.2 证据保留

- step log、manifest、index、Playwright trace/screenshot/report 按 run 永久保留，直到操作者显式清理该 run 目录。
- disposable database 默认在 passed/failed/interrupted 后销毁；设置显式 debug keep policy 时可保留，但 manifest 必须标记 `database_retained=true` 和精确 project name。
- 下一次 run 永远创建新目录，不能复用失败 run 的 state receipt、dist 或数据库。

## 7. Network 与外部来源合同

自动化 test 使用 `loopback-only` policy：

- PostgreSQL 和 Web 只绑定 `127.0.0.1`；
- Test Run 使用 run-scoped bridge network；容器端口只发布到 host loopback，不暴露到 LAN；
- Steam static、Git fetch 和 webhook adapter 在 test policy 下 fail closed；
- Playwright 拦截并拒绝非 loopback request；
- fixture 只读取仓库内 `tests/fixtures/`，不解析相邻真实 checkout；
- manifest 记录 network policy 与被拒绝的 adapter 测试结果。

Docker Desktop 上 `internal` network 会令 host 发布端口不可达，因此这里不以 Docker network flag 充当出站沙箱。应用与测试 adapter 的统一 `loopback-only` policy 才是 fail-closed 边界；该限制和选择由 ADR 0006 记录。

静态字符串中的来源 URL 和数据库内 provenance 不算网络访问。任何新增 outbound adapter 必须消费统一 network policy，而不能直接在业务 Module 中调用 `fetch` 或 `git fetch`。

## 8. 数据库与文件证据

Harness 在 destructive test step 前后采集同构 evidence snapshot：

```text
environment + data_class + safe identity fingerprints
schema_migrations(id, sha256)
dataset_heads
asset_dataset_heads
catalog/asset key counts
public schema canonical fingerprint
```

对于 disposable test stack，before/after 用于证明本 run 的迁移与 fixture 结果。对于现有 development/local-review cutover，另需比较 cutover 前后 public dump hash、ledger/head 和关键计数；后者是单独授权的运维动作，不由 `pnpm verify` 自动触发。

## 9. 配置与目录合同

- `MEDOTA2_STATE_DIRECTORY` 只选择本次进程的 receipt root；它不是环境身份。目录必须位于仓库 `.medota2/` 下并由当前用户拥有。
- `MEDOTA2_ARTIFACT_ROOT`、`MEDOTA2_TEST_WEB_PORT`、`MEDOTA2_NEXT_TSCONFIG` 和 `NEXT_DIST_DIR` 只由 Harness 子进程设置；普通测试脚本不提供固定默认值。数据库 host port 由 Resource Lease 与 manifest 记录，不作为应用数据库身份或 raw connection 配置下发。
- Next build/dev 使用 run root 内继承仓库配置的 `tsconfig.next.json`，动态 dist 类型路径不得写回仓库根 `tsconfig.json`。
- 所有生成目录都位于 Git 忽略的 `.medota2/`、Next dist、coverage 或 Playwright output 范围。
- Manifest 内的文件引用使用 run root 相对路径；日志不得打印 receipt 内容或 URL。

目标目录：

```text
.medota2/
  environments/
    development/{state...}
    local-review/{state...}
  test-runs/
    <run-id>/
      run.json
      index.md
      state/
      tsconfig.next.json
      logs/
      next/
      coverage/
      playwright/{report,test-results}/
```

## 10. 测试合同

### 10.1 Unit

- Run Identity、目录和 Compose project 命名合法且不可复用。
- state directory 不能逃出 `.medota2/`。
- cleanup 只接受 lease 中的精确 project。
- manifest 在 pass、fail、interrupt 和 cleanup failure 下都可解析。
- test network policy 拒绝 Steam CDN、webhook 和 remote Git adapter。
- rollback DB gate 的 SQL contract 要求双锁与 coverage policy。

### 10.2 PostgreSQL Integration

- fresh disposable stack 可完成 marker provisioning/adoption、migration 和 fixture。
- 任一 marker/role/ACL/endpoint 分叉在首个应用 DDL/DML 前失败。
- promotion 与 rollback 缺任一 advisory lock 都失败。
- 直接 SQL rollback 不能降低同 Catalog 或跨 Catalog 的 Valve coverage，显式 override 除外。
- 一个 run 的 cleanup 不改变另一个并发 run 的 marker、head 或连接。

### 10.3 E2E / Visual

- 第一个断言核对页面 strip、HTML dataset、response headers 和 Database Identity projection 的 environment/data class/run 一致。
- 两个 E2E run 可并发完成；database port、Web origin、Next dist、TypeScript config overlay、report、trace 和 screenshot path 零重叠。
- 浏览器向非 loopback URL 的请求被拒绝并留下测试证据。
- 视觉 snapshot 的读取基线仍在 Git 内，run 输出不覆盖基线文件。

### 10.4 Verification

- `pnpm verify` 成功时 manifest 的每个 required step 都是 `passed`，cleanup 为 `cleaned`。
- 任一步失败时命令退出非零，manifest/index 仍存在，失败日志可定位。
- Unit coverage 低于仓库阈值时失败；阈值只能通过代码与测试提高，不在失败后动态降低。
- CI 与本地使用同一 verify Interface，不维护第二套命令顺序。

## 11. Definition of Done

以下条件必须全部满足，才能把整体方案标记为 implemented：

- [x] 正常数据库 caller 全部通过 opaque verified capability；architecture lint 不发现 raw `pg.Pool`/URL 绕过。
- [x] Environment Contract 的 Unit、红队 Integration、UI/API projection 和 fresh-stack E2E 通过。
- [x] `test:integration` 与 `test:e2e` 不再包含固定 `shared-*` Run Identity、固定数据库 host port、固定 Web port或固定 output directory。
- [x] 两个全套 E2E run 并发通过，且 manifest 证明所有 leased resources 不重叠。
- [x] Next build/dev 只写 run-local TypeScript config overlay，不修改仓库根 `tsconfig.json`。
- [x] 注入失败一个 run 后，另一 run 完成；cleanup 只销毁失败 run 的精确 Compose project。
- [x] development 与 local-review 的默认 Compose project、volume、port、receipt root 和 browser origin 分离。
- [x] test 在 loopback-only policy 下完成，Steam CDN、remote Git 与 webhook adapter 均 fail closed。
- [x] `pnpm verify` 生成版本化 `run.json` 和 `index.md`，包含 step logs、数据库 fingerprints 与 cleanup 状态。
- [x] CI workflow 从 fresh disposable stack 调用与本地相同的 verify Interface，并保留 evidence artifact。
- [x] Catalog promotion 与 rollback 都通过双 advisory lock 和 SQL coverage 单调性测试。
- [x] README、运维文档、ADR、CONTEXT 和 package scripts 不再宣称固定共享 test stack 是目标态。
- [x] 现有 `54321` 栈若未获得精确破坏性授权，明确记录为“代码就绪、尚未 cutover”，没有伪装为已激活。

## 12. 实施阶段

### Phase 0：Spec 与完成账本

- 将 A–E 合并为本 Spec；
- 按 Interface 和 DoD 对账现有实现；
- 修正文档中的过期命令、测试计数和环境 URL 说明。

### Phase 1：Harness 与 disposable test stack

- 实现唯一 Run Context、state root、动态端口和精确 Compose lease；
- 让 Integration/E2E config 成为薄 adapter；
- 加入失败/信号 cleanup 与 per-run artifacts。

### Phase 2：Data Stack Lifecycle

- 参数化本地 Compose project/port/volume；
- 为 development/local-review 提供独立生命周期命令和 receipt root；
- test 切换为 tmpfs disposable project；production 继续无本地 fallback。

### Phase 3：Verification Evidence 与 CI

- 实现 verify orchestration、manifest/index、coverage threshold 和 build/start smoke；
- 增加 fresh-stack CI；
- 增加并发 run、禁网和崩溃 cleanup 验收。

### Phase 4：DB Gate 对称化

- 新 migration 深化 rollback function；
- 固定 Catalog → Asset lock 顺序；
- 将 coverage downgrade policy 和 adversarial Integration tests 放入数据库 test surface。

### Phase 5：受控 rollout

- 在独立新 stack 验证所有阶段；
- 对现有 `54321` stack 只生成 preflight/备份证据；
- 获得单独精确授权后才执行 credential/owner/ACL/session cutover 和数据迁移。

## 13. 实施记录

实施记录只陈述已经由本仓库命令验证的事实；计划项不得提前标记完成。

| 日期       | 范围                      | 状态                                    | 证据                                                                                                                                                                             |
| ---------- | ------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-31 | A · Environment Contract  | 代码就绪；原有 `54321` stack 未 cutover | ADR 0005；Unit/Integration/E2E；architecture lint                                                                                                                                |
| 2026-08-31 | B · Test Run Harness      | 完成                                    | 并发 E2E runs `e2e-20260831t115022z-b1c4f4b7` / `e2e-20260831t115022z-7697b8cd`；失败隔离 runs `integration-20260831t115002z-4772408f` / `integration-20260831t115002z-02aab4e0` |
| 2026-08-31 | C · Data Stack Lifecycle  | 完成                                    | `docker-compose.data-stack.yml`、`docker-compose.test-run.yml`；lifecycle Unit 与 disposable-stack Integration/E2E                                                               |
| 2026-08-31 | D · Verification Evidence | 完成                                    | verify run `verify-20260831t114637z-8e135d18`；per-run `run.json` / `index.md` / step logs；`.github/workflows/verify.yml`                                                       |
| 2026-08-31 | E · DB Gate Consolidation | 完成                                    | migrations `0006` / `0008`；promotion/rollback 双锁、coverage downgrade 与 override Integration tests                                                                            |
| 2026-08-31 | Mapping provenance        | 完成                                    | migration `0009`；Git checkout/input-to-HEAD provenance Unit tests                                                                                                               |

### 13.1 本地验收快照

- `pnpm verify`：27 个 Unit test files、186 tests、19 个 PostgreSQL Integration tests、production build/start smoke 与 34 个 E2E tests 全部通过；coverage 为 statements 57.39%、branches 56.80%、functions 62.43%、lines 58.31%。
- verify evidence：`.medota2/test-runs/verify-20260831t114637z-8e135d18/`，manifest 状态 `passed`，cleanup 状态 `cleaned`，PostgreSQL `18.2`，migration `0001`–`0009`，before/after public schema hash 一致。
- `pnpm test:e2e:concurrent`：两个各含 34 tests 的 E2E run 并发通过；Compose project、database port、Web origin、state、Next dist、TypeScript config overlay 与 artifact root 均不重叠，cleanup 均为 `cleaned`。
- `pnpm test:harness:isolation`：注入失败的 run 为 `failed + cleaned`，并发 survivor 完成 19 个 Integration tests 并为 `passed + cleaned`。
- `tsconfig.json` 在完整 verify 前后及并发 E2E 结束后 SHA-256 均为 `58ccccaadb34f79978f539222f04d699b42711b86dd709da2d0710b3ed17450a`，证明动态 Next types 未写回共享配置。
- 最终 Docker audit 不存在 `medota2-test-*` 容器；历史 `medota2` stack 未被停止、迁移或删除。

## 14. 后续 ADR 触发条件

以下任一事件发生前必须新增或重开 ADR：

- 定义远程 production topology 或允许 production Worker/migration capability；
- 选择 secret manager、证书/SPKI pinning或签名 environment manifest；
- 引入跨主机 Test Run executor、长期数据库池或共享 CI database；
- 允许 Test Run 保留含真实来源或 production-snapshot 的数据库；
- 将 revocation epoch/lease 扩展到已签发 mutation session；
- 公开分发包含 Valve 资产的镜像、数据库或测试工件。

## 15. 参考

- [Medota2 Domain Context](../../CONTEXT.md)
- [ADR 0005：使用可证明的 Environment Contract 隔离运行环境](../adr/0005-environment-contract.md)
- [ADR 0004：Hero 与 Ability 图标使用数据库资产数据集](../adr/0004-database-icon-asset-datasets.md)
- [项目技术选型与数据处理架构](../architecture/technology-selection.md)
- [测试、环境与依赖架构 Review](../architecture/environment-contract-review.md)
