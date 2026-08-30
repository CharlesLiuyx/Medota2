# ADR 0002：Valve 资产使用本地只读 Provider

- 状态：Accepted for private use
- 日期：2026-08-30
- 关联：[Hero Catalog v2 Spec](../specs/hero-catalog-v2.md)

## Context

`dota_vpk_updates` 能提供玩法定义和资源引用，但不保证包含完整 Hero portrait 和 Ability icon 二进制。当前产品是自用场景，已确认可以使用本地 Valve Dota 2 资产。

## Decision

- `dota_vpk_updates` 继续作为 Hero/Ability 玩法 SSOT。
- 独立 `ValveAssetProvider` 只读访问显式配置的本地 Dota 2 VPK 或提取目录。
- Provider 输出内容寻址缓存，记录 ClientVersion、逻辑资源键、原始路径、checksum、mime、尺寸和转换器版本。
- Git 不提交完整 VPK、大批原始图片或生成缓存。
- 资产缺失使用稳定 fallback，不阻断玩法 Catalog。

## Consequences

- 本地客户端与玩法快照可能版本不一致，系统必须显示并审查这种差异。
- 公开部署或向第三方分发任何 Valve 资产前，必须重新进行许可与商标审查。
- 页面和查询不能把机器绝对路径当作领域数据。
