import type { Config } from 'tailwindcss';

/**
 * Hệ thống token DO360 cấp xã (06/10/2026).
 * Nguyên tắc: nền phẳng, viền mảnh, màu chỉ dành cho trạng thái; chữ 14px làm nền; số dạng bảng (.kpi-num);
 * chuyển động chỉ cho popover/modal và phản hồi thao tác. Chi tiết: docs/GIAO-DIEN-WEB.md.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
      },
      colors: {
        // Xanh lam công vụ — nhận diện DO360/ZSC
        primary: {
          50: '#EEF3F9',
          100: '#DAE4F0',
          200: '#B6C9E1',
          300: '#86A4C8',
          400: '#4D77A8',
          500: '#0F3D6E',
          600: '#0D3560',
          700: '#0B2D52',
          800: '#092545',
          900: '#071C36',
          glow: '#1B6BD6',
        },
        // Vàng quốc huy — chỉ dùng cho nhấn mạnh hiếm (dải kỳ, cảnh báo)
        accent: { DEFAULT: '#C9962B', light: '#E6C06C', soft: '#FBF3DF' },
        canvas: '#F4F6F8',
        ink: { DEFAULT: '#0F172A', 2: '#1E293B', 3: '#334155', muted: '#475569', faint: '#64748B' },
        rule: { DEFAULT: '#E2E8F0', strong: '#CBD5E1' },
      },
      borderRadius: {
        chip: '8px',
        menu: '10px',
        card: '12px',
        logo: '10px',
        panel: '14px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(15, 23, 42, 0.04)',
        'card-hover': '0 6px 18px rgba(15, 61, 110, 0.10)',
        'chip-glow': '0 1px 2px rgba(15, 61, 110, 0.12)',
        logo: 'none',
        panel: '0 12px 32px rgba(15, 23, 42, 0.14)',
        login: '0 16px 48px rgba(15, 23, 42, 0.12)',
        band: '0 10px 30px rgba(7, 28, 54, 0.25)',
      },
      // Thang chữ: giữ tên cũ để trang hiện có không phải sửa, nâng cỡ cho dễ đọc (tối thiểu 12px)
      fontSize: {
        '2xs': ['12px', '1.35'],
        xs2: ['12.5px', '1.4'],
        sm2: ['13.5px', '1.45'],
        base2: ['14px', '1.5'],
        md2: ['15px', '1.5'],
        stat: ['28px', '1.05'],
      },
      spacing: { 13: '3.25rem', 15: '3.75rem', 18: '4.5rem' },
      zIndex: { dropdown: '30', sticky: '20', modal: '50', toast: '60' },
      keyframes: {
        'fade-in-up': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: { 'fade-in-up': 'fade-in-up 160ms ease-out', shimmer: 'shimmer 1.4s linear infinite' },
    },
  },
  plugins: [],
};

export default config;
