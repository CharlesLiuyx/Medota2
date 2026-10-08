# 数据库环境合同与身份模型

> 2026-10-06 更新：日常共享开发、可复用测试环境、按需 CI 和 development Web 连接验证方式由 [ADR 0007](../adr/0007-shared-development-workbench.md) 与[开发工作台规范](../specs/development-workbench.md)替代。本文保留完整隔离验证与数据库合同的详细依据；其中每次独占资源、CI 默认全量 verify 的表述仅适用于历史方案或显式独立验证。

本文只维护数据库环境、身份和权限合同。项目词汇由[CONTEXT](../../CONTEXT.md)维护，跨模块数据流由[数据流文档](data-flow.md)维护；操作步骤见[开发手册](../operations/development.md)。

## 产品上下文

Medota2 是本地优先、以来源可追溯和原子版本为核心的 Dota 2 数据产品。当前已实现的主链路是：从固定 `dota_vpk_updates` 快照构建不可变 Hero Catalog，为该 Catalog 构建独立的 Asset Dataset，并由 Next.js Web 从 PostgreSQL 的 current head 查询和展示。

环境身份与数据版本身份是两条正交轴：环境回答“进程正在哪里运行、允许做什么”，数据版本回答“页面或任务正在使用哪一份来源与转换结果”。任何 source commit、Catalog UUID、asset manifest 或数据库名都不能单独替代环境身份。

## Environment Contract

**Environment Contract** 是进程访问数据库前必须满足的运行合同。它由进程一次性声明的预期身份、PostgreSQL 内的 Database Identity marker、当前数据库角色和本次操作意图共同构成。

合同至少约束：

- Runtime Environment；
- Data Class；
- 预期 PostgreSQL instance、database 和 role；
- Run Identity；
- 允许的读取、fixture 构造、迁移、导入、提升、回滚、seed 或 reset 操作。

进程不能通过 URL 后缀、`NODE_ENV`、端口、分支名或默认值推断合同。每次 pool checkout 先核对 session role、回滚遗留事务、`DISCARD ALL`，恢复 search path、RLS、replication role 与默认事务只读策略，再按验证策略完成attestation：默认使用严格allowlist的只读control-plane查询；仅 `(development 或 local-review) + Web/read + MEDOTA2_WORKBENCH=1` 对已验证的物理连接复用身份结果；验证成功后，`openVerifiedDatabase` 才返回不透明的 verified capability。除这些 session setup/attestation 语句外，正常 Web、Worker、migration、seed 和 reset 入口不接受裸数据库 URL，也不能在验证前执行应用查询、DDL 或 DML。

为区分生命周期，**Environment Declaration** 指验证前冻结的预期身份，operation 在申请 capability 时另外声明；**Verified Environment Contract** 指 declaration 与数据库事实验证一致后的结果。本文简称 Environment Contract 时，指约束这些阶段及其转换的完整规则。只有 verified 结果可以投影 database identity 或授权数据库操作；验证失败的 UI 只能显示 declaration 和明确的 blocked 状态。

**Provisioning Receipt** 是独立于目标数据库、Git忽略且由本机私有文件权限保护（Unix `0600`，Windows等效owner／ACL核验） 的 expected-identity 记录。它保存 PostgreSQL system identifier、共享 instance UUID，以及每个本地数据库的 database UUID 与分类。Receipt 是本地 trust root 的一部分，但不是密码学签名，也不能防御已经控制主机、文件或 PostgreSQL superuser 的攻击者。

**Reset Policy** 是 marker 对数据生命周期的声明：`manual` 需要精确数据库确认，`run-scoped` 要求 Test Run Identity，`explicit-rebuild` 只允许明确的本地 Preview rebuild，`never` 不开放 reset。它是 capability admission policy；显式隔离Test Run Harness为每次执行创建独立stack；日常测试的受管stack复用及锁规则由[工作台Spec](../specs/development-workbench.md)维护。

## Runtime Environment

**Runtime Environment** 描述一个进程所在的运行边界及其操作策略，取值固定为：

| 值             | 含义                                                                                    |
| -------------- | --------------------------------------------------------------------------------------- |
| `development`  | 开发者可写、可重建的沙箱；不承载线上 current head。                                     |
| `test`         | 自动化验证环境；Worker 只开放测试合同内的 `fixture`，不开放真实数据 `import`。          |
| `local-review` | 本机审阅环境，可保存真实来源或 production-snapshot 数据；默认不是可随意清空的开发沙箱。 |
| `production`   | 对外或正式运行环境；必须显式配置，不能由 `main`、`NODE_ENV=production` 或缺省值推断。   |

一个进程只声明一个 Runtime Environment。完成初始化后，修改 `process.env` 不能让同一进程或已建立的连接池切换环境。

共享工作台通常使用 `http://127.0.0.1:3000`，可以读取development或local-review数据；独立local-review入口为3001。已初始化workspace以其origin为准。显式隔离Harness为每run分配origin，日常受管测试由共享runner选择。origin隔离浏览器存储而不能证明数据库身份；Cookie不按端口分区，未来环境敏感Cookie必须按用途命名或使用不同host。

## Data Class

**Data Class** 描述数据库内容的来源级别与使用预期，取值固定为：

| 值                    | 含义                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `sandbox`             | 为开发构造或导入、允许重建的非正式数据。                                    |
| `synthetic-fixture`   | 自动化测试专用的裁剪或合成 fixture。                                        |
| `production-snapshot` | 从正式来源获得、复制或固化到非 production 环境用于只读/受控 Review 的快照。 |
| `live-production`     | production 环境当前正式服务的数据。                                         |

Runtime Environment 与 Data Class 不能合并。例如 `local-review + production-snapshot` 是合法组合，而 `test + live-production` 必须被合同拒绝。Data Class 表示数据敏感性和预期，不表示数据新鲜度；新鲜度仍由 source commit、ClientVersion、imported time 和 current head 表达。

Data Class 是受控分类，不是对表内每一行来源的自动证明。import、seed、restore 或 reclassify 必须经过 operation policy；若一个操作会让内容不再符合当前分类，它必须被拒绝，或由 control plane 原子更新分类并使已有 capability 失效。

## Database Identity

**Database Identity** 是 PostgreSQL 自己声明的环境身份，不等同于连接 URL 或数据库名。每个数据库在 `medota2_control.environment_identity` 中恰有一条 marker，至少包含：

- contract version；
- instance UUID；
- database UUID；
- database name；
- Runtime Environment；
- Data Class；
- Web、Worker 与 migration 的预期 role；
- marker state 与 reset policy；
- created time。

同一逻辑数据库的三个 role 必须观察到相同的 instance UUID、database UUID、database name、Runtime Environment、Data Class、server endpoint 和 PostgreSQL system identifier，并分别以预期的 `session_user` 连接。三类进程从同一个不可变 expected-identity block 获得预期 UUID、system identifier 和分类，但只获得各自的 role credential；expected identity 不能从正在验证的数据库反向推导。当前本地边界信任由操作者控制的进程配置与 provisioning receipt 提供，远程 production trust root 留待部署 ADR 定义。

Web 日常接口只选择 Web credential，但当前本地实现按受管stack保存角色凭据与receipt（旧三库adoption记录仍可追溯）；同一 OS user 下的恶意进程仍可读取全部本地凭据。`MEDOTA2_PROCESS_ROLE` 防止正常 caller 越权选择 credential，是应用层 admission label，不是 OS 级 secret boundary。需要进程级秘密隔离时，应把 Web、Worker 和 migration 放入不同 OS/container identity 并分别注入单一 credential。进程初始化时核对 receipt 并冻结 expected identity；每次checkout恢复session baseline，默认重新验证数据库marker／role／ACL；上述受限development Web物理连接可复用身份验证，而不会把 receipt 当作实时撤销通道。provisioning、adoption 和 environment doctor 负责诊断三角色 convergence。正常非只读 capability 在签发前也会临时打开另外两个 role 的 attestation-only 连接并验证 convergence，因此 URL/server/marker/reset policy 分叉不会获得写 capability。

marker 属于 provisioning control plane，不由普通应用 migration 自动创建或修复。marker 缺失、重复、不可读或与进程声明不一致时，正常运行必须 fail closed。contract v1 的本地 CLI 只接纳 Docker/IaC 已预置且结构正确的 marker，可把旧 role/ACL 布局 cutover 到环境专属布局，但不会为未知、无 marker 的旧库创建身份。无 marker 的 legacy 库需要另行 Review 的 provisioning/restore seam；这不是正常入口的 fallback。

## Run Identity

**Run Identity** 标识一次进程或自动化执行，而不是数据库环境或数据版本。它用于关联日志、PostgreSQL `application_name`、测试产物和未来的 per-run database。

Run Identity 与现有 `import_runs` 不同：一个 Run Identity 可以包含多个 import run、migration 或浏览器测试；一个 `import_runs` 记录只描述一次数据导入/比较任务。同一 orchestration 启动的子进程继承同一 Run Identity，破坏性 test 操作必须携带 Run Identity。固定的 `shared-integration` / `shared-e2e` 不是合法自动化 Run Identity。

**Run Context** 是 Test Run Harness 签发的不可变执行输入，包含 Run Identity、suite、动态数据库/Web 端口、state root、Next dist、run-local TypeScript config overlay、artifact root 和 network policy。测试 adapter 不能自行选择这些资源，Next 也不能把动态 dist 类型路径写回仓库根 `tsconfig.json`。

**Resource Lease** 是 Harness 实际创建资源及其精确销毁范围。每个显式isolated／verify run独占Compose project、tmpfs PostgreSQL stack、receipt、origin与产物目录；cleanup 只能使用该 lease，不能按名称前缀或时间猜测目标。

**Verification Manifest** 在显式隔离模式保存于 `.medota2/test-runs/<run-id>/run.json`；日常检查和共享测试分别使用 `.medota2/checks/`、`.medota2/shared-tests/runs/` 的运行记录。它记录代码/工具链身份、step 结果、数据库前后 fingerprint、migration/head/count/schema hash 和 cleanup 状态；`index.md` 是其人类入口。Manifest 不保存 credential URL、密码、完整数据库 identity 或本机外部来源路径。

## Hero Catalog

Catalog的定义及版本关系见[CONTEXT](../../CONTEXT.md)与[数据流](data-flow.md)。source commit、gate或current状态都不能证明Runtime Environment；带真实来源布局的fixture仍须通过环境合同。

## Asset Dataset

资产版本关系见[数据流](data-flow.md)。`exact`、`alias`和`generated_fallback`描述单个资产的解析方式，Data Class描述数据库用途；真实Valve资产不使local-review变成live-production。

## Source Snapshot 与外部来源

来源身份回答输入是什么，环境身份回答在哪里、以何种权限处理，二者均须保留。来源规范由[来源总览](../repositories/README.md)维护；图片映射输入的commit／checksum属于[资产合同](../adr/0004-database-icon-asset-datasets.md)，不能靠环境类别代替。

## 核心关系

```text
Environment Declaration + Run Identity
                  │
Provisioning Receipt (instance/database/system identity)
                  │
Role-specific credential adapter
                  ├─────────────────────────────────────────────┐
                  ▼                                             │
       physical pool checkout                                   │
                  │ role guard → ROLLBACK → DISCARD ALL          │
                  │ restore session baseline                     │
                  ▼                                             │
      attestation or permitted workbench connection reuse                    │
                  │                                             │
                  ├── mismatch/drift ──> destroy + fail closed   │
                  ▼                                             │
        role × operation × environment policy                   │
                  │ non-read: three-role convergence ◀──────────┘
                  ▼
         opaque verified capability
                  │
        ┌─────────┴───────────┐
        ▼                     ▼
Hero Catalog Dataset    Asset Dataset
        └──── bound by Catalog version ────┐
                                           ▲
                                      Source Snapshot
```

## 不变量

1. 进程环境只声明一次；没有隐式 `main` fallback。
2. URL、数据库名后缀和 `NODE_ENV` 都不是可信环境身份。
3. 每次pool checkout恢复只读及session baseline；应用访问前取得验证能力。默认fresh attestation，仅上述共享工作台Web物理连接允许复用，迁移／权限变化后重启。
4. 正常数据库 caller 只能消费 opaque verified capability，不消费裸 URL。
5. marker 缺失或不匹配时 fail closed；普通 migration 不自动 bootstrap marker。
6. 三角色通过共同 Database Identity convergence，而不是通过三个独立 URL 的字符串相似性建立信任。
7. Runtime Environment、Data Class、Run Identity、Hero Catalog version 和 Asset Dataset version 分别建模。
8. local-stack cutover 只接纳预置且一致的 marker；它会调整 role、密码、owner、ACL 和受审 extension dependency，但不清空、重建或移动现有 Catalog/Asset head，也不运行产品 migration。
9. Web 每次 checkout 默认只读且不能拥有业务/列级写入、持久 DDL 或 control 写权限；Worker 不能拥有持久 DDL、control 写权限、role membership 或高权限属性。
10. production contract v1 只签发 `Web/read`；Worker 与 migration capability 默认拒绝。
