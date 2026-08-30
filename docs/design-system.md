# Medota2 Design System

> 状态：v1 已实现；随 Hero Catalog 继续演进
>
> 来源合同：[Hero Catalog v2 Spec](specs/hero-catalog-v2.md#5-design-system)、[全局 List 无限滚动与 3× 预加载 Spec](specs/infinite-lists.md)

## 目标

Medota2 使用深色优先、百科式、高信息密度的目录界面。设计借鉴 Liquipedia Heroes Portal 的分组浏览和快速扫描原则，但使用独立品牌、token 和组件实现。

## 原则

- 列表先帮助定位，详情再承载完整数据和 provenance。
- 所有内容 List 共用『InfiniteList』的连续滚动与惰性渲染合同；旧分页和一次性 DOM 全量渲染约定不再适用。
- 数据版本、异常和来源始终可见。
- URL 保存查询状态；重要功能不依赖 hover。
- 属性、状态同时使用颜色与文字表达。
- 内部名称、ID、版本和 checksum 使用等宽/表格数字。
- 组件允许本地化文本增长，不使用依赖中英文固定长度的布局。

## Token

Token 定义在 `src/app/globals.css`，组件只消费语义变量：

- Surface：canvas、panel、elevated、hover、sunken；
- Text：primary、secondary、muted、inverse；
- Border：subtle、default、strong；
- Accent：primary、hover、soft、focus；
- Attribute：strength、agility、intelligence、universal；
- Status：success、warning、danger、info；
- Layout：content max、radius、shadow、control height。

默认主题为 `dark`。`[data-theme="light"]` 已保留同名 token 覆盖层，后续启用主题切换时不需要修改组件。

## 组件

| 组件                           | 职责                                   |
| ------------------------------ | -------------------------------------- |
| `AppShell`                     | 全局 header、实体导航、内容和 footer   |
| `EntityTabs`                   | Heroes / Abilities 一级入口与当前状态  |
| `PageHeader`                   | eyebrow、标题、摘要和右侧版本/统计区域 |
| `DatasetBadge`                 | ClientVersion、commit 与健康状态       |
| `Badge`                        | 属性、关系、状态和普通标签             |
| `Panel`                        | 标准 surface/border 容器               |
| `SectionHeading`               | 属性分组和详情 section 标题            |
| `HeroCard`                     | 高密度 Hero 入口与资产 fallback        |
| `AbilityCard`                  | Ability 状态、关系、cost 与 owner 摘要 |
| `HeroCrest` / `AbilityIcon`    | Valve 本地资产及可访问 fallback        |
| `StatGroup`                    | 紧凑 key/value 数值组                  |
| `EmptyState` / `FailureBanner` | 空、失败和待处理状态                   |

开发画廊位于 `/design-system`，用于视觉回归和状态审阅。

『InfiniteList』是 Design System 级行为基座，而不是 Catalog 页面的私有组件。远程查询、本地数组、卡片网格、关系记录和表格行的适配及上下 `3 × viewport` 预加载规则，以[全局 List Spec](specs/infinite-lists.md)为准。

## 响应式与无障碍

- 主内容宽度使用 `--content-max`，移动端保持 16px 以上页面 padding。
- Hero grid 从 2 列逐步扩展；窄屏退化为单列，不横向裁切名称。
- 所有交互有 `focus-visible`，触摸控件使用统一 control height。
- 不移除原生表单、`details`、heading 和 list 语义。
- `prefers-reduced-motion` 下关闭非必要动画和位移。
- Playwright 在 Desktop Chrome 与 Pixel 7 视口固定 Heroes 目录和 Ability 详情视觉基线；宽表在移动端只在自身容器滚动，不扩大页面画布。
