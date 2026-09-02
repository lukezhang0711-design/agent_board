/**
 * Visual Token Table (视觉令牌统一表)
 * Single Source of Truth for Nimbalyst Visual Tokens
 * 
 * 施工单 FX (FB-163): 机械式收敛 71 种散落取值到按用途命名的统一令牌表。
 */

export interface TokenItem {
  id: string;
  name: string;
  value: string;
  cssClass: string;
  description: string;
  legacySources: string[];
}

export interface VisualTokensTable {
  fontSize: Record<string, TokenItem>;
  spacing: Record<string, TokenItem>;
  radius: Record<string, TokenItem>;
  surfaceLayer: Record<string, TokenItem>;
}

export const visualTokens: VisualTokensTable = {
  // 1. 字号令牌（8 档 <= 10 档，按用途命名）
  fontSize: {
    micro: {
      id: 'micro',
      name: '极小微标/时间戳',
      value: '10px',
      cssClass: 'text-ui-micro',
      description: '极小徽标、紧凑状态标签、时间戳微标、角标数字',
      legacySources: ['7px', '9px', '10px'],
    },
    caption: {
      id: 'caption',
      name: '辅助说明/元数据',
      value: '11px',
      cssClass: 'text-ui-caption',
      description: '辅助说明、字段名、代码标签、元数据与快捷键提示',
      legacySources: ['11px'],
    },
    compact: {
      id: 'compact',
      name: '紧凑正文/次要标签',
      value: '12px',
      cssClass: 'text-ui-compact',
      description: '紧凑正文、次要说明、表单控件文字、小型按钮',
      legacySources: ['12px', '12.5px', 'text-xs'],
    },
    body: {
      id: 'body',
      name: '标准界面正文',
      value: '13px',
      cssClass: 'text-ui-body',
      description: '标准界面正文、卡片主体文本、列表项主文案',
      legacySources: ['13px', '14px', 'text-sm'],
    },
    subhead: {
      id: 'subhead',
      name: '区块副标题/强调',
      value: '15px',
      cssClass: 'text-ui-subhead',
      description: '小节副标题、强调指标数值、重点数据展示',
      legacySources: ['15px', '16px', 'text-base'],
    },
    title: {
      id: 'title',
      name: '面板/卡片标题',
      value: '18px',
      cssClass: 'text-ui-title',
      description: '面板标题、卡片头部大字、分组标题',
      legacySources: ['17px', '18px', '20px', 'text-lg', 'text-xl'],
    },
    headline: {
      id: 'headline',
      name: '页面/弹窗主标题',
      value: '24px',
      cssClass: 'text-ui-headline',
      description: '主页面顶部标题、核心弹窗主标题',
      legacySources: ['21px', '22px', '24px', '26px', '28px', 'text-2xl'],
    },
    display: {
      id: 'display',
      name: '超大看板数值/Hero',
      value: '32px',
      cssClass: 'text-ui-display',
      description: '大盘核心数据统计、空状态 Hero 标题',
      legacySources: ['32px', '48px', 'text-5xl'],
    },
  },

  // 2. 间距令牌（8 档 <= 8 档，基准步长 4px）
  spacing: {
    none: {
      id: 'none',
      name: '清零',
      value: '0px',
      cssClass: 'p-0 / m-0 / gap-0',
      description: '间距清零',
      legacySources: ['0'],
    },
    micro: {
      id: 'micro',
      name: '微间距 (0.5x)',
      value: '2px',
      cssClass: 'p-0.5 / m-0.5 / gap-0.5',
      description: '紧凑徽标内边距、状态指示点间隙',
      legacySources: ['1px', '2px', '3px'],
    },
    tight: {
      id: 'tight',
      name: '紧密间距 (1x)',
      value: '4px',
      cssClass: 'p-1 / m-1 / gap-1',
      description: '紧密元素间距、图标与文字间隙、Tag 行内内边距',
      legacySources: ['5px', '7px'],
    },
    compact: {
      id: 'compact',
      name: '紧凑间距 (2x)',
      value: '8px',
      cssClass: 'p-2 / m-2 / gap-2',
      description: '标准行内间距、Chip/Tag 边距、按钮内边距',
      legacySources: ['9px'],
    },
    normal: {
      id: 'normal',
      name: '常规间距 (3x)',
      value: '12px',
      cssClass: 'p-3 / m-3 / gap-3',
      description: '标准表单/卡片行间隙、列表项内边距',
      legacySources: ['13px'],
    },
    card: {
      id: 'card',
      name: '卡片内边距 (4x)',
      value: '16px',
      cssClass: 'p-4 / m-4 / gap-4',
      description: '卡片主体内边距、标准面板区块边距',
      legacySources: ['17px', '18px'],
    },
    section: {
      id: 'section',
      name: '区块间距 (6x)',
      value: '24px',
      cssClass: 'p-6 / m-6 / gap-6',
      description: '大区块分隔、主弹窗内容内边距',
      legacySources: ['21px', '38px'],
    },
    spacious: {
      id: 'spacious',
      name: '页面外边距 (8x)',
      value: '32px',
      cssClass: 'p-8 / m-8 / gap-8',
      description: '页面级大容器边距、空状态外边距',
      legacySources: ['50px', '60px', '120px', '156px'],
    },
  },

  // 3. 圆角令牌（5 档 <= 5 档，从基准 6px 推导）
  radius: {
    none: {
      id: 'none',
      name: '无圆角',
      value: '0px',
      cssClass: 'rounded-none / rounded-ui-none',
      description: '直角容器、无圆角表格与边缘接缝',
      legacySources: ['rounded-none'],
    },
    sm: {
      id: 'sm',
      name: '小圆角',
      value: '4px',
      cssClass: 'rounded-sm / rounded-ui-sm',
      description: '紧凑徽标、小按钮、状态 Tag',
      legacySources: ['rounded-sm', 'rounded'],
    },
    base: {
      id: 'base',
      name: '标准圆角 (基准)',
      value: '6px',
      cssClass: 'rounded-md / rounded-ui-base',
      description: '标准按钮、输入框、列表项、操作条',
      legacySources: ['rounded-md'],
    },
    lg: {
      id: 'lg',
      name: '大圆角',
      value: '10px',
      cssClass: 'rounded-lg / rounded-ui-lg',
      description: '面板容器、卡片、浮窗、主弹窗、看板大列',
      legacySources: ['rounded-[10px]', 'rounded-lg', 'rounded-xl', 'rounded-2xl'],
    },
    full: {
      id: 'full',
      name: '全圆角/胶囊',
      value: '9999px',
      cssClass: 'rounded-full / rounded-ui-full',
      description: '胶囊形 Pill 徽标、头像、圆形状态灯',
      legacySources: ['rounded-full'],
    },
  },

  // 4. 底色分层令牌（4 层 <= 4 层，100% 走既有 --nim-* 变量）
  surfaceLayer: {
    canvas: {
      id: 'canvas',
      name: 'Layer 1: 页面底板层',
      value: 'var(--nim-bg)',
      cssClass: 'bg-nim',
      description: '主窗口与页面底层底板，深浅模式由主题变量自动适配',
      legacySources: ['#ffffff', '#111827'],
    },
    container: {
      id: 'container',
      name: 'Layer 2: 卡片与容器层',
      value: 'var(--nim-bg-secondary)',
      cssClass: 'bg-nim-secondary',
      description: '卡片、侧边栏、工具栏及次级承载容器',
      legacySources: ['#f9fafb', '#1f2937'],
    },
    interactive: {
      id: 'interactive',
      name: 'Layer 3: 悬浮与交互层',
      value: 'var(--nim-bg-hover)',
      cssClass: 'bg-nim-hover / bg-nim-tertiary',
      description: '列表悬浮项、不可用或第三级背景',
      legacySources: ['rgba(0,0,0,0.05)', '#f3f4f6'],
    },
    accent: {
      id: 'accent',
      name: 'Layer 4: 强调与选中层',
      value: 'var(--nim-bg-selected)',
      cssClass: 'bg-nim-selected',
      description: '选中高亮状态、品牌主色半透激活态',
      legacySources: ['rgba(59,130,246,0.1)'],
    },
  },
};
