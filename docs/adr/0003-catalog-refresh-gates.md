# ADR 0003：Catalog 刷新采用 Green / Yellow / Red 门禁

- 状态：Accepted
- 日期：2026-08-30
- 关联：[Hero Catalog v2 Spec](../specs/hero-catalog-v2.md)

## Context

Dota 2 更新既包含普通数值变化，也可能改变 KeyValues 形态、ID、文件 selector 和关系。所有变化自动上线会放大未知 schema 风险；所有变化人工处理又无法快速跟随游戏版本。

## Decision

- 所有刷新先生成不可变候选和三层 diff：raw files、source schema、semantic entities。
- Green 候选自动提升。
- Yellow 候选持久化并等待人工 approve/reject。
- Red 候选永不提升；当前 head 保持不变。
- Reviewer 不能直接修改候选规范值，只能接受、拒绝，或升级 mapper 后重建。
- rollback 只移动 head，并记录原因和 from/to version。

## Consequences

- 普通数值和文本更新可以无人工介入发布。
- selector 扩张、删除、ID remap、未知结构和覆盖率下降会产生明确 Review 工作项。
- 更新 SLO 从 `dota_vpk_updates` 上游 commit 可见时开始计算，不涵盖 Valve 到第三方跟踪仓库的延迟。
