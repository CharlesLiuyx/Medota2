# ADR 0001：Hero Catalog 使用单一原子版本边界

- 状态：Accepted
- 日期：2026-08-30
- 关联：[Hero Catalog v2 Spec](../specs/hero-catalog-v2.md)

## Context

英雄 MVP 使用独立的 `heroes` dataset head。v2 同时引入 Ability、Hero/Ability 关系、Facet、本地化和资产引用。如果这些实体分别提升，页面可能在一次更新中读取到不同补丁的数据，形成 patch tearing。

## Decision

- 使用不可变 `HeroCatalogDatasetVersion` 统一承载 Hero、Ability、Facet、关系和本地化。
- 产品只通过 `dataset_heads('hero_catalog')` 读取当前版本。
- 候选版本完整写入、校验和生成 semantic diff 后才能提升。
- promotion 和 rollback 都只在事务内移动一个 head；不覆盖或删除历史数据。
- `dotaconstants` reference snapshot 和 Valve asset cache 保持独立身份，不参与玩法目录的规范值。

## Consequences

- 共享定义变化时默认全量重建，以正确性优先。
- 任一核心实体失败会阻止整个候选发布，但不会影响当前版本。
- 数据库外键和所有产品查询必须携带 `dataset_version_id`。
- 从 MVP 迁移时，现有 Hero dataset 会被原位升级为一个 Green Hero Catalog 版本。
