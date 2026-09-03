/**
 * Electron Package Tailwind Configuration
 *
 * Extends the shared monorepo Tailwind config with Electron-specific settings.
 */

import baseConfig from '../../tailwind.config';
import type { Config } from 'tailwindcss';

const config: Config = {
  ...baseConfig,
  content: [
    './src/renderer/**/*.{ts,tsx,js,jsx}',
    // Include runtime components (AI, editor, etc.)
    '../runtime/src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    ...baseConfig.theme,
    extend: {
      ...baseConfig.theme?.extend,
      // 视觉令牌注册成真正的 Tailwind 工具类，否则 before:/hover:/focus-visible: 这类
      // 变体前缀加在纯 CSS 类上会静默失效（开关圆钮曾因此变成方块，FB-175）。
      borderRadius: {
        'ui-base': '6px',
        'ui-lg': '10px',
        'ui-full': '9999px',
        'ui-none': '0px',
      },
      fontSize: {
        'ui-micro': ['10px', '14px'],
        'ui-caption': ['11px', '15px'],
        'ui-compact': ['12px', '16px'],
        'ui-body': ['13px', '18px'],
        'ui-subhead': ['15px', '20px'],
        'ui-title': ['18px', '24px'],
        'ui-headline': ['24px', '32px'],
        'ui-display': ['32px', '40px'],
      },
    },
  },
};

export default config;
