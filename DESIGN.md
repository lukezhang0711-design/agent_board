---
version: 1.0.0
name: Nimbalyst-design-foundation
description: 极简专业、高度自律的 AI 研发工作台设计语言。通过将可选数值收敛至极简档位并明确语义理由，实现全产品深浅主题统一、排版节奏沉静、操作层级明晰。

colors:
  primary: "var(--nim-primary)"
  primary-hover: "var(--nim-primary-hover)"
  primary-active: "var(--nim-primary-active)"
  primary-subtle: "color-mix(in srgb, var(--nim-primary) 12%, transparent)"
  canvas: "var(--nim-bg)"
  canvas-secondary: "var(--nim-bg-secondary)"
  canvas-tertiary: "var(--nim-bg-tertiary)"
  surface-hover: "var(--nim-bg-hover)"
  surface-selected: "var(--nim-bg-selected)"
  ink: "var(--nim-text)"
  ink-secondary: "var(--nim-text-secondary)"
  ink-muted: "var(--nim-text-muted)"
  ink-subtle: "var(--nim-text-subtle)"
  divider: "var(--nim-border)"
  divider-subtle: "var(--nim-border-subtle)"
  divider-hover: "var(--nim-border-hover)"
  success: "var(--nim-success)"
  success-subtle: "color-mix(in srgb, var(--nim-success) 12%, transparent)"
  warning: "var(--nim-warning)"
  warning-subtle: "color-mix(in srgb, var(--nim-warning) 14%, transparent)"
  error: "var(--nim-error)"
  error-subtle: "color-mix(in srgb, var(--nim-error) 12%, transparent)"
  accent-purple: "var(--nim-purple)"

typography:
  micro:
    fontSize: 10px
    lineHeight: 14px
    cssClass: text-ui-micro
    use: "极小徽标、紧凑状态标签、时间戳微标、角标数字"
  caption:
    fontSize: 11px
    lineHeight: 15px
    cssClass: text-ui-caption
    use: "辅助说明、字段名、代码标签、元数据与快捷键提示"
  compact:
    fontSize: 12px
    lineHeight: 16px
    cssClass: text-ui-compact
    use: "紧凑正文、次要说明、表单控件文字、小型按钮"
  body:
    fontSize: 13px
    lineHeight: 18px
    cssClass: text-ui-body
    use: "标准界面正文、卡片主体文本、列表项主文案"
  subhead:
    fontSize: 15px
    lineHeight: 20px
    cssClass: text-ui-subhead
    use: "小节副标题、强调指标数值、重点数据展示"
  title:
    fontSize: 18px
    lineHeight: 24px
    cssClass: text-ui-title
    use: "面板标题、卡片头部大字、分组标题"
  headline:
    fontSize: 24px
    lineHeight: 32px
    cssClass: text-ui-headline
    use: "主页面顶部标题、核心弹窗主标题"
  display:
    fontSize: 32px
    lineHeight: 40px
    cssClass: text-ui-display
    use: "超大看板数值、Hero 大数字统计"

rounded:
  base:
    value: 6px
    cssClass: rounded-ui-base
    use: "按钮、输入框、小控件"
  lg:
    value: 10px
    cssClass: rounded-ui-lg
    use: "卡片、面板、对话框"
  full:
    value: 9999px
    cssClass: rounded-ui-full
    use: "徽章、头像、药丸"
  # 过渡档（直角接缝）：
  # none: 0px (.rounded-ui-none) 直角接缝

spacing:
  micro:
    value: 2px
    cssClass: py-0.5
    use: "微内衬 2px：徽章、药丸、紧凑小标签上下内衬"
  tight:
    value: 4px
    cssClass: gap-1
    use: "紧密元素间距、图标与文字微隙"
  compact:
    value: 8px
    cssClass: gap-2
    use: "标准行内间距、Chip/Tag 边距、按钮内边距"
  normal:
    value: 12px
    cssClass: gap-3
    use: "标准表单/卡片行间隙、列表项常规间距"
  card:
    value: 16px
    cssClass: gap-4
    use: "卡片内边距、标准面板区块内边距"
  section:
    value: 24px
    cssClass: gap-6
    use: "大区块分隔、主弹窗内容内边距"

components: # 施工单 GB 补齐：七个通用展示零件（全产品共用，纯展示组件，零逻辑零状态）
  PageHeader:
    file: "packages/electron/src/renderer/components/common/PageHeader.tsx"
    use: "统一页面/面板顶部标题栏，左标题+计数+副标题，右侧主操作区"
    tokens: "text-ui-title, text-ui-caption, rounded-ui-full, gap-2, gap-3"
  EmptyStateMessage:
    file: "packages/electron/src/renderer/components/common/EmptyStateMessage.tsx"
    use: "统一两行式空状态，主标题+行动指引次行+可选操作按钮"
    tokens: "rounded-ui-lg, text-ui-body, text-ui-compact, var(--nim-text-subtle)"
  AgentBusyIndicator:
    file: "packages/electron/src/renderer/components/common/AgentBusyIndicator.tsx"
    use: "全局代理并发忙碌度紧凑胶囊，一句话概括+头像叠放+排队徽标"
    tokens: "bg-nim-primary-subtle, bg-nim-warning-subtle, rounded-ui-full, text-ui-micro, text-ui-compact"
  SettingsSection:
    file: "packages/electron/src/renderer/components/common/SettingsSection.tsx"
    use: "设置页分组统一外壳，小标题+可选说明+控件容器+底部分隔"
    tokens: "text-ui-subhead, text-ui-compact, border-b var(--nim-border), gap-1, gap-3"
  ItemCard:
    file: "packages/electron/src/renderer/components/common/ItemCard.tsx"
    use: "固定四段信息层级卡片（编号/徽章、两行截断标题、单行截断说明、底栏头像/时间）"
    tokens: "rounded-ui-lg, text-ui-body, text-ui-caption, text-ui-micro, line-clamp-2, truncate"
  StatusBadge:
    file: "packages/electron/src/renderer/components/common/StatusBadge.tsx"
    use: "五种固定状态徽章（在跑、等确认、已完成、失败、待办），全令牌色驱动"
    tokens: "bg-nim-*-subtle, border-nim-*-subtle, rounded-ui-full, text-ui-micro"
  Toolbar:
    file: "packages/electron/src/renderer/components/common/Toolbar.tsx"
    use: "固定摆法工具栏，左侧搜索框占主要宽度，右侧筛选+排序+操作按钮固定间距"
    tokens: "rounded-ui-base, gap-2, gap-3, bg-[var(--nim-bg-secondary)]"
---

# Nimbalyst 设计语言规范

## Overview

Nimbalyst 是一款面向工程开发与智能代理协作的专业工作台软件。在面对高密度数据流、频繁状态切换与复杂多代理交互时，界面的第一使命是**沉静、有序、零干扰**。

本设计系统的收敛思路借鉴业内优秀开源实践中"把值砍到很少、每值写清理由"的收敛哲学，但完全基于 Nimbalyst 自身产品形态、MIT 许可证规范以及既有 `--nim-*` 主题变量体系原生定制，不包含任何受限第三方界面的专有代码、类名或样式。

### 核心总原则
好看不是画得漂亮，是把"能选的值"砍到很少，并且每个值都写明理由。任何新增一档都必须在文件里写清为什么现有档位不够用。系统拒绝随意微调像素导致的视觉膨胀与排版紊乱。

---

## Colors

### 1. 变量驱动与单一真理源
所有颜色只走 `--nim-*` 主题变量，`src/renderer/index.css` 是唯一定义处。任何直接写死的色值都是错的，深浅主题会当场露馅。

- **品牌与交互主色**：`var(--nim-primary)`，仅用于核心操作焦点与选中状态。
- **正文墨色体系**：
  - 主文字：`var(--nim-text)`，保障最高对比度。
  - 次要说明：`var(--nim-text-secondary)`。
  - 淡文字：`var(--nim-text-muted)`。淡文字必须有自己的颜色档，绝不用透明度调淡；透明度会随底色漂移，同一个灰在不同底上对比度差一倍。
  - 极淡非文字记号：`var(--nim-text-subtle)`。只许用于分隔线、折叠箭头、空态大图标这类非文字记号，明令禁止用于文字。
- **状态语义色**：
  - 成功：`var(--nim-success)` 与 `bg-nim-success-subtle`。
  - 警示：`var(--nim-warning)` 与 `bg-nim-warning-subtle`。
  - 错误：`var(--nim-error)` 与 `bg-nim-error-subtle`。

### 2. 底色分四层，每层职责固定
- **Layer 1 外壳（Shell）**：`var(--nim-bg)`。最安静的外框，承载主窗口边缘与顶层结构。
- **Layer 2 页面画布（Canvas）**：`var(--nim-bg-secondary)`。列表、看板、对话住的地方。
- **Layer 3 面板（Panel）**：`var(--nim-bg-tertiary)` 或具有明确边框的内容区块。有边界的内容组。
- **Layer 4 浮层（Overlay / Popover）**：临时的菜单、下拉框与对话框。

**同屏最多同时存在两层浮起**；需要第三层就说明该用对话框而不是"浮层套浮层"。

---

## Typography

### 1. 字号 8 档，按用途命名，不按大小命名
沿用 FX 统一建立的 8 档字号阶梯：
- `micro` (10px / 14px, `.text-ui-micro`): 极小徽标、紧凑状态标签、时间戳微标、角标数字。
- `caption` (11px / 15px, `.text-ui-caption`): 辅助说明、字段名、代码标签、元数据与快捷键提示。
- `compact` (12px / 16px, `.text-ui-compact`): 紧凑正文、次要说明、表单控件文字、小型按钮。
- `body` (13px / 18px, `.text-ui-body`): 标准界面正文、卡片主体文本、列表项主文案。
- `subhead` (15px / 20px, `.text-ui-subhead`): 区块副标题、强调指标数值、重点数据展示。
- `title` (18px / 24px, `.text-ui-title`): 面板标题、卡片头部大字、分组标题。
- `headline` (24px / 32px, `.text-ui-headline`): 页面/弹窗主标题、看板大标题。
- `display` (32px / 40px, `.text-ui-display`): 超大看板数值、Hero 大数据展示。

### 2. 禁止项与理由
禁止使用 Tailwind 自带的 `text-sm` / `text-base` 等，也禁止 `text-[14px]` 这类写法。
理由：档位越多层级越糊——差一两像素的两档读起来是"一样但哪里不对"，不是两个层级。字号按用途命名后，开发者只需决定"这一行是说明还是正文"，而不需要猜测"这里该用 13px 还是 14px"。

---

## Layout

### 1. 4px 栅格与 5 档收敛间距（含微内衬 2px 专用档）
界面布局与结构间距严格遵循 4px 步长，禁止随意半档微调（严禁 `gap-*.5`、`p*-1.5/2.5/3.5` 及全部外边距半档 `m*-*.5`）。
收敛后保留 5 档核心结构间距与 1 档微内衬专用档：
- `micro` (2px, `py-0.5` / `p*-0.5`): **微内衬 2px**。专用于徽章（Badge）、药丸（Pill）、紧凑小标签的上下垂直微内衬。理由：10px/11px 微标若采用 4px（`py-1`）内衬会导致徽章垂直高度过高，在紧凑行内破坏文字基线与信息流；采用 0px 则贴边压抑，故保留 2px 作为合法微内衬档。除此以外任何半档一律严禁。
- `tight` (4px, `gap-1`): 图标与文字、紧凑标签内部间隙。
- `compact` (8px, `gap-2`): 标准行内间距、Chip/Tag 边距、常规按钮间距。
- `normal` (12px, `gap-3`): 卡片内部元素间隙、标准表单行距、列表项间隙。
- `card` (16px, `gap-4`): 卡片内边距、标准面板内容内边距。
- `section` (24px, `gap-6`): 大区块之间分隔、主弹窗整体内容边距。

### 2. 列表与卡片排版哲学
密集列表用带分隔线的行，不要用圆角卡片。卡片是给"有边界的独立对象"用的（一张工单、一个技能），不是给"一长条设置项"用的。设置项与数据行使用 `border-b border-[var(--nim-border)]` 分隔，消除多余的圆角框线嵌套。

---

## Elevation & Depth

### 1. 层次收敛
深度感知主要通过底色分层（Canvas -> Container -> Hover -> Selected）与细边框（1px `var(--nim-border)`）呈现，不滥用多重发光投影。

### 2. 投影仅用于浮动层
- 菜单与浮动气泡：使用轻量阴影 `shadow-md`。
- 模态对话框：使用 `shadow-xl`。
- 严禁浮层嵌套：同屏最多允许两层浮起，避免出现"菜单里再弹菜单再弹气泡"的嘈杂视觉堆叠。

---

## Shapes

### 1. 3 档正式圆角
圆角收敛至 3 档固定语义：
- `rounded-ui-base` (6px): 按钮、输入框、微小控件。
- `rounded-ui-lg` (10px): 卡片、面板、对话框、看板大容器。
- `rounded-ui-full` (9999px): 徽章、头像、胶囊形药丸状态灯。

### 2. 过渡档约束
FX 遗留的 `rounded-ui-none` (0px) 仅作为直角接缝过渡档保留。原 `rounded-ui-sm` (4px) 已在施工单 GA2 中完全废除并并入 base (6px)。

---

## Do's and Don'ts

遵循"默认选更安静的那个"。"太挤/太吵"是这个产品最常见的问题；拿不准时减一层边框、减一个底色、减一个图标。

1. **Do**: 字号使用 8 档语义类名（如 `text-ui-body`）。
   **Don't**: 使用写死像素 `text-[13px]` 或 `text-[14px]`。
   *反例*: `packages/electron/src/renderer/components/AIChat/SessionDropdown.tsx:111` (`text-[13px]`)
2. **Do**: 使用语义字号令牌管理层次。
   **Don't**: 使用 Tailwind 自带相对字号 `text-sm` 或 `text-base`。
   *反例*: `packages/electron/src/renderer/components/common/PageHeader.tsx:60` (`text-base sm:text-lg`)
3. **Do**: 所有颜色 100% 走 `--nim-*` 变量。
   **Don't**: 绕过主题变量硬编码原生或写死色值。
   *反例*: `packages/electron/src/renderer/components/AgentMode/TaskListPanel.tsx:118` (绕过主题变量直接写死绿色)
4. **Do**: 圆角严格限制在 3 档正式令牌（`rounded-ui-base` / `rounded-ui-lg` / `rounded-ui-full`）。
   **Don't**: 使用表外或任意自定义圆角（如 `rounded-xl`、`rounded-[10px]`、`rounded-[20px]`）。
   *反例*: `packages/runtime/src/editor/ui/ColorPicker.tsx:152` (`rounded-xl`)
5. **Do**: 间距严格走 4px 栅格整档（`gap-1`、`gap-2`、`gap-3`、`gap-4`、`gap-6`）。
   **Don't**: 使用半档微调（`gap-0.5`、`gap-1.5`、`gap-2.5`）。
   *反例*: `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/RequestUserInputWidget.tsx:631` (`gap-2.5`)
6. **Do**: 淡文字使用专门的颜色档位 `var(--nim-text-muted)`。
   **Don't**: 使用透明度（如 `opacity-80` 或 `opacity-60`）调淡文字。
   *反例*: `packages/electron/src/renderer/components/AIChat/WakeupBanner.tsx:106` (`opacity-80`)
7. **Do**: 密集列表使用带分隔线的行。
   **Don't**: 给长条设置列表套一层又一层的独立圆角小卡片。
   *反例*: `packages/electron/src/renderer/components/GlobalSettings/panels/ClaudeCodePluginsPanel.tsx:560`（给每个插件配置项嵌套独立 rounded 卡片）
8. **Do**: 一屏只能有一个实心主色按钮，其余一律次要或幽灵样式。
   **Don't**: 多个强调色块按钮同时抢占焦点。
   *反例*: `packages/electron/src/renderer/components/WindowsClaudeCodeWarning/WindowsClaudeCodeWarning.tsx:88`（多个渐变高亮强按钮混杂）
9. **Do**: 通过 CSS 类名应用排版规则。
   **Don't**: 在组件中使用行内 `style={{ fontSize: ... }}` 覆盖样式。
   *反例*: `packages/electron/src/renderer/components/DeveloperDashboard/DeveloperDashboard.tsx:217` (`tick={{ fontSize: 11 }}`)
10. **Do**: 极淡色 `var(--nim-text-subtle)` 仅用于分隔线、折叠箭头、大空态图标。
    **Don't**: 将极淡非文字记号色赋给可读正文或副标题，导致暗色模式对比度彻底失效。
    *反例*: `packages/electron/src/renderer/components/common/PageHeader.tsx:75`（副标题极度调淡导致几乎不可读）
11. **Do**: 严格保留陈述安全、隐私事实（谁能看到内容）、权限如实告知（授予了什么能力）、数据是否端到端加密、降级出错如实告知的说明，统一置于页头副信息位（`subtitle`）。
    *正例*: `packages/electron/src/renderer/components/Settings/panels/PrivilegedExtensionsPanel.tsx` (`Extensions that have been granted permission to run code outside the app`)
    **Don't**: 在常驻界面放置解释产品内部怎么运作的、介绍功能是干嘛的、或解释默认值的说明书式文案，一律清理。
    *反例*: `packages/electron/src/renderer/components/GlobalSettings/panels/SyncPanel.tsx` (历史说明: `Access and control Nimbalyst from the mobile app.`)

---

## Iteration Guide

1. **单件自律**：每次迭代只改动单一目标组件，绝不顺手修改邻近逻辑。
2. **零新增随意档**：若遇到新布局需求，优先通过现有 8 档字号、5 档间距、3 档圆角组合解决；确需新增档位，必须先行更新 DESIGN.md 并阐明无可替代之理由。
3. **深浅双色回归**：每次视觉变动必须在暗色模式与亮色模式下双向验证，确保无任何未绑定 `--nim-*` 的孤立色值。
4. **守卫保障**：每次提交前必须通过 `visualTokensGuard.test.ts` 门禁，违例天花板只降不升。

---

## Known Gaps

本单为设计语言文件与令牌底座铺设单，以下已知缺口在后续单据中逐一解决，不属于本单完备范围：
1. **通用零件待落成**：通用组件（SettingsSection、ItemCard、StatusBadge、Toolbar 等）尚未完成收口，由施工单 GB 补齐。
2. **各业务屏外观未全面重构**：本单不改动业务屏外观，会话页、主窗口、编码模式、事项看板、设置页的整体视觉重构分别留给 GC / GD / GE / GF / GG。
3. **引擎品牌图标素材**：不同 AI 引擎提供商（Claude、Codex、Gemini）的矢量图标与深浅自适应素材尚未形成规范资源库。
4. **动效与转场规范**：弹窗淡入淡出、抽屉滑出等动效目前沿用 Tailwind 基础类，尚未确立统一的时间函数与时长标准。
5. **复杂表单校验态**：行内实时校验错误提示、脏表单未保存警示等高级表单交互状态尚未定义统一规范。
