// House style cho recharts (port từ KPI335, palette xanh lam công vụ).
// Dùng: <CartesianGrid {...GRID} /> <XAxis tick={TICK} axisLine={AXIS_LINE} /> ...

import type { ReactNode } from 'react';

/** Lưới ngang mảnh, đứt nét — không kẻ dọc. */
export const GRID = { stroke: '#E2E8F0', strokeDasharray: '3 3', vertical: false } as const;

/** Chữ trục 10.5px slate. */
export const TICK = { fontSize: 10.5, fill: '#64748B' } as const;

/** Đường trục category. */
export const AXIS_LINE = { stroke: '#E2E8F0' } as const;

/** Cột: bo đầu, tách nhau bằng viền trắng. */
export const BAR = { radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 32 };
export const BAR_H = { radius: [0, 4, 4, 0] as [number, number, number, number], maxBarSize: 16 };

/** Donut chuẩn. */
export const DONUT = { innerRadius: 46, outerRadius: 66, paddingAngle: 3, stroke: '#fff', strokeWidth: 2 } as const;

/** Tooltip. */
export const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: '1px solid #E2E8F0',
  boxShadow: '0 6px 20px rgba(0,0,0,.12)',
  fontSize: 12,
} as const;

export const CURSOR_FILL = { fill: 'rgba(0,0,0,.04)' } as const;

/** Palette series (brand xanh dẫn đầu). */
export const SERIES = ['#0F3D6E', '#D9A441', '#15803D', '#64748B', '#4A72A6', '#081F37'];

/** Chú thích dưới biểu đồ — giải thích CÁCH ĐỌC (tín hiệu tin cậy kiểu KPI335). */
export function ChartFootnote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{children}</p>;
}
