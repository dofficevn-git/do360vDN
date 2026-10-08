import { BadRequestException } from '@nestjs/common';

/**
 * Mã kỳ báo cáo dùng thống nhất trong kho:
 *   2026-M09  tháng 9        2026-Q3  quý III
 *   2026-6M   6 tháng đầu năm 2026-9M  9 tháng đầu năm     2026-Y  cả năm
 * Kỳ lũy kế (6M, 9M, Y) dùng cho chỉ tiêu `cumulative`; kỳ tháng/quý cho chỉ tiêu `flow`.
 */
export type PeriodType = 'month' | 'quarter' | 'half' | 'nine_months' | 'year';

export interface PeriodInfo {
  code: string;
  year: number;
  type: PeriodType;
  /** Ngày đầu và ngày cuối của kỳ (YYYY-MM-DD) */
  start: string;
  end: string;
  /** Tên kỳ viết trong văn bản: "9 tháng đầu năm 2026" */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function parsePeriod(code: string): PeriodInfo {
  const m = /^(\d{4})-(M(0[1-9]|1[0-2])|Q([1-4])|6M|9M|Y)$/.exec((code ?? '').trim());
  if (!m) throw new BadRequestException(`Mã kỳ không hợp lệ: "${code}" (đúng dạng 2026-M09, 2026-Q3, 2026-6M, 2026-9M, 2026-Y)`);
  const year = Number(m[1]);
  const tag = m[2];
  if (tag.startsWith('M')) {
    const mo = Number(m[3]);
    return { code, year, type: 'month', start: `${year}-${pad(mo)}-01`, end: `${year}-${pad(mo)}-${pad(lastDay(year, mo))}`, label: `tháng ${mo} năm ${year}` };
  }
  if (tag.startsWith('Q')) {
    const q = Number(m[4]);
    const endMo = q * 3;
    const roman = ['I', 'II', 'III', 'IV'][q - 1];
    return { code, year, type: 'quarter', start: `${year}-${pad(endMo - 2)}-01`, end: `${year}-${pad(endMo)}-${pad(lastDay(year, endMo))}`, label: `quý ${roman} năm ${year}` };
  }
  if (tag === '6M') return { code, year, type: 'half', start: `${year}-01-01`, end: `${year}-06-30`, label: `6 tháng đầu năm ${year}` };
  if (tag === '9M') return { code, year, type: 'nine_months', start: `${year}-01-01`, end: `${year}-09-30`, label: `9 tháng đầu năm ${year}` };
  return { code, year, type: 'year', start: `${year}-01-01`, end: `${year}-12-31`, label: `năm ${year}` };
}

/** Cùng kỳ năm trước: 2026-9M → 2025-9M, 2026-M10 → 2025-M10. */
export function samePeriodLastYear(code: string): string {
  const p = parsePeriod(code);
  return `${p.year - 1}-${code.slice(5)}`;
}

/** Kỳ liền trước cùng loại: M10 → M09 (M01 → M12 năm trước), Q3 → Q2, 9M → 6M, Y → 9M, 6M → Q1? (6M không có kỳ cùng loại trước → null). */
export function previousComparable(code: string): string | null {
  const p = parsePeriod(code);
  if (p.type === 'month') { const mo = Number(code.slice(6)); return mo === 1 ? `${p.year - 1}-M12` : `${p.year}-M${String(mo - 1).padStart(2, '0')}`; }
  if (p.type === 'quarter') { const q = Number(code.slice(6)); return q === 1 ? `${p.year - 1}-Q4` : `${p.year}-Q${q - 1}`; }
  return previousCumulative(code);
}

/** Kỳ lũy kế liền trước trong cùng năm (để kiểm "lũy kế không giảm"); null nếu không có. */
export function previousCumulative(code: string): string | null {
  const p = parsePeriod(code);
  if (p.type === 'year') return `${p.year}-9M`;
  if (p.type === 'nine_months') return `${p.year}-6M`;
  return null;
}
