# ADR 0004：Hero 与 Ability 图标使用数据库资产数据集

- 状态：Accepted for private use
- 日期：2026-08-31
- 关联：[Hero Catalog v2 Spec](../specs/hero-catalog-v2.md)、[ADR 0002：Valve 资产使用本地只读 Provider](0002-valve-local-asset-provider.md)

## Context

Hero Catalog 需要为每个 Hero 和每个 accepted Ability 提供图标，并让列表、详情和高 DPI 屏幕按显示尺寸选择合适的图片。`dota_vpk_updates` 提供玩法定义、`AbilityTextureName` 和资源路径，但审阅的仓库快照不包含这些图标的二进制；`GameTracking-Dota2/game/dota/pak01_dir.txt` 也只是 VPK 文件索引。真实 `.vtex_c` 字节必须来自用户本地 Dota 2 `pak01_dir.vpk`。

原先“请求时读取本地提取目录”的 Provider 不能同时满足以下合同：

- 部署后不依赖某台开发机的绝对路径；
- 图片与来源、转换策略和实体绑定一起版本化；
- 同一原图生成多个 LoD，并按内容去重；
- Valve 没有为部分 Talent、Innate、模板或历史 Ability 提供独立图片时，最终显示覆盖率仍为 100%；
- 图片可以独立增加或替换，不改变 Hero Catalog 的玩法版本身份。

ADR 0002 的“本地只读来源、Git 不提交批量资产、仅限私有使用”边界继续有效；本 ADR 补充数据库持久化、版本与完整性决策。

## Decision

### 数据模型

图标以独立于玩法 Catalog、但明确绑定到一个 `HeroCatalogDatasetVersion` 的不可变 asset dataset 保存：

| 表                       | 职责                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset_blobs`            | 以内容 SHA-256 为主键保存图片 `bytea`、MIME、宽高和字节数；跨实体、LoD 和版本复用相同内容。                                                 |
| `asset_objects`          | 表示一个可复用的逻辑图标对象，记录 `exact`、`alias` 或 `generated_fallback` 来源、逻辑路径、ClientVersion、原始 blob 和 provider metadata。 |
| `asset_variants`         | 将对象关联到 `original`、`w64`、`w128`、`w256` rendition，并记录目标宽度、blob、转换器版本和质量参数；实际宽高来自 blob。                   |
| `asset_dataset_versions` | 保存一个 Catalog 对应的不可变资产 manifest、ClientVersion、provider version、LoD policy version 和覆盖计数。                                |
| `entity_asset_bindings`  | 将 dataset 内的 Hero/Ability `icon` 绑定到对象，同时保留请求路径、解析方式和源状态。                                                        |
| `asset_dataset_heads`    | 为每个 Catalog dataset 指向当前采用的 asset dataset；提升新图片只移动该 head，不重写玩法数据。                                              |

`asset_blobs` 负责字节级去重，`asset_objects` 负责来源与转换身份，`entity_asset_bindings` 负责版本内实体语义。三者不能合并为一个“实体图片”表，否则共享 alias/fallback 会复制二进制，来源变化也会与实体身份耦合。

Catalog version、资产 manifest、provider version 和 LoD policy version 共同参与幂等身份；ClientVersion 作为来源信息记录，并通过对象/manifest 身份反映。同一输入重复导入复用已有 dataset；来源图片、fallback 规则或转换策略变化会创建新版本。历史 asset dataset 和 blob 默认保留，未来增加资产种类或 LoD 时不需要修改 Hero/Ability 核心表。

### 获取与解析优先级

资产工作流是离线、显式且可复现的：

```text
用户本地 pak01_dir.vpk（只读内容）
        │ Source2Viewer-CLI：限定 vtex_c 与 allowlist 路径
        │ sibling staging + provenance manifest + atomic rename
        ▼
Git 忽略的本地提取目录
        │
        ├── 精确 Valve 路径
        ├── 版本化 Valve alias
        └── Medota2 确定性 generated fallback
                 │
                 ▼
       original + w64/w128/w256
                 │
                 ▼
       PostgreSQL asset dataset + head
```

精确解析以 Catalog 中的规范身份为输入：

- Hero：`panorama/images/heroes/icons/{internal_name}_png.vtex_c`；
- Ability：`panorama/images/spellicons/{texture_name}_png.vtex_c`，其中 `texture_name` 已包含 `AbilityTextureName` override。

精确资源不存在时只尝试明确列出的 Valve alias：Hero 默认 icon/portrait；Talent 使用 `attribute_bonus`；缺图 Innate 使用 Innate icon，再尝试 `empty`；其他 Ability 使用 `empty`。显式启用 `--download-missing` 时，Importer 在本地精确 VPK 资源之后查询 `dotaconstants` 的官方图片映射，从固定的 Valve Steam static HTTPS origin 下载缺失的 Hero/Ability 图片；随后仍优先本地 alias，再尝试官方 `attribute_bonus`、`innate_icon`、`empty` alias。下载只发生在离线导入阶段，响应必须来自允许的 Steam static host、通过大小/格式/完整解码校验，字节与 URL provenance 一起入库。未配置提取目录、远程资源不存在或所有 alias 都不存在时，才根据 `(entity_type, entity_key)` 生成稳定、实体专属的 fallback；已显式配置但目录不可读或 manifest 缺失/非法则直接失败，不能把配置错误伪装成正常缺源。alias 与 generated fallback 都作为正常图片对象和所有 LoD 入库，而不是等 HTTP 404 后临时绘制。

原生 Valve 命中率和最终显示覆盖率是两个不同指标。`resolution_kind` 与 `source_status` 必须保留真实来源状态，不能因为 fallback 可显示就把缺失、版本不匹配或读取错误记成精确命中。

每次提取必须提供 ClientVersion，并以尚不存在的版本化目录作为最终目标。提取器在同一父目录的随机 staging 中运行 Source 2 Viewer，拒绝 VPK 目录内的输出，也不使用会在 VPK 旁保存状态的 cache 模式。只有 CLI 成功且至少生成一个文件后，才写入 `medota2-valve-asset-extraction.json` 并原子改名；既有最终目录无论是否为空都拒绝复用，从而避免新旧客户端文件混合。

提取 manifest 使用版本化 schema，记录 ClientVersion、VPK 完整 SHA-256 与字节数、Source 2 Viewer 版本、实际 CLI 参数、精确 path/extension filters、decode flags、线程数、提取时间和文件数。资产 importer 在信任目录前必须读取并验证 manifest；不能以手填 ClientVersion 替代来源证明。含本机路径的完整 manifest 仅属于 Git 忽略的本地中间产物；数据库对象 metadata 只保留去除绝对路径后的 VPK/CLI 指纹，HTTP 响应不返回该 provenance。

### LoD 与服务合同

- `original` 保留解析后源图的编码、尺寸和字节，作为最大可用版本和再处理输入。
- `w64`、`w128`、`w256` 使用版本化 Sharp/WebP recipe 生成；不放大小于目标宽度的源图，但仍保留对应 LoD key 和实际尺寸。
- HTTP 路由只从 PostgreSQL 当前 asset head 读取，根据请求显示宽度选择最小的足够 rendition，并用内容 SHA-256 生成 ETag。
- 运行时不读取 VPK 或提取目录，也不把机器绝对路径写入领域数据或响应。

### 完整性与提升门禁

每个 asset dataset 在提升 head 前必须满足硬性不变量：

1. 覆盖目标 Catalog 的每个 Hero；
2. 覆盖目标 Catalog 的每个 accepted Ability，包括 `current`、`indirect`、`defined_unbound`、`template` 和 `deprecated`；
3. 每个实体恰有一个 `icon` binding；
4. 每个绑定对象都有 `original`、`w64`、`w128`、`w256`，且所有 blob 非空、SHA-256 合法、宽高为正；
5. 数据库内的 Hero/Ability 数量和四层 LoD 覆盖与准备阶段 manifest 完全一致。

数据库同时验证 binding 的实体键集合与目标 Catalog 完全相等、`resolution_kind` 与对象来源一致、blob 的实际内容 SHA-256 与主键一致。资产发布必须持有独立 advisory lock；同一 Catalog 已发布资产的 exact/native coverage 下降时默认拒绝提升。切换不同 Catalog 时按 exact/total 与 native/total 比例比较当前和目标 asset head，默认阻止 fallback 比例上升；只有实际 Catalog promotion 显式携带 `--allow-fallback-downgrade` 才可覆盖。Catalog promotion 固定按 Catalog lock → asset lock 顺序持有两把事务锁，使比较不与独立资产更新竞态。Hero Catalog promotion 与 rollback 只有在目标版本已有重新验证过的完整 asset head 时才允许移动玩法 head；候选或历史版本可先通过 `data:import:assets --catalog-version <uuid>` 回填。

缺少原生 Valve 图标本身不破坏门禁，因为确定性 fallback 会补齐可显示对象；无法生成、验证或持久化任一实体的最终图片才会使整个资产导入事务失败。导入在事务和 advisory lock 内完成，验证通过后才原子移动 `asset_dataset_heads`。失败不会留下半发布 head，也不会改变 Hero Catalog head。

## Git、许可与分发边界

- `pak01_dir.vpk`、Source 2 Viewer 提取结果、生成缓存、数据库 dump 和批量图片不提交到 Git。
- 数据库存储图片字节是为了当前批准的本地私有使用，不授予重新分发 Valve 美术资产、商标或其他游戏内容的权利。
- 公开部署、共享数据库备份、发布容器镜像或向第三方提供资产接口前，必须重新完成 Valve 内容、商标和辖区相关的许可审查。
- Source 2 Viewer / ValveResourceFormat 是独立的 MIT 许可第三方工具；使用或分发其程序时保留其许可声明与 attribution。其解码输出中的 Valve 内容不因工具采用 MIT 许可而改变权利归属。
- fallback 由 Medota2 确定性生成并单独标记来源，不能冒充 Valve 原生图标。

## Consequences

- 页面在完成一次资产导入后不再依赖本机文件系统或外部 CDN，并且所有 Catalog 实体都有数据库图片。
- 新增、修改图片或调整压缩策略只生成并提升新的 asset dataset，不制造虚假的玩法版本。
- 内容寻址会复用通用 Talent、Innate、empty 和 generated blob，但 PostgreSQL 与备份体积仍会增加；容量、备份和清理策略必须把资产字节计入。
- 每次新的 Hero Catalog 成为 current 后，都要为该 Catalog 构建并提升匹配的 asset dataset；两种 head 独立，查询通过共同的 Catalog dataset id 配对，避免跨版本绑定。
- 来源缺口保持可审计，同时 display coverage 的验收可以使用明确的 100% 硬门禁，而不是依赖浏览器 fallback。
