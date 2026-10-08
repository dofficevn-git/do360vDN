'use client';

/**
 * Từ điển ngôn ngữ cán bộ: web hiện TÊN (chỉ tiêu, mục, phòng, trạng thái, kỳ) thay vì mã kỹ thuật.
 * Nguồn: GET /admin/catalog/labels (nạp một lần, cache 10 phút) + periodLabel() tính tại chỗ.
 * Mã kỹ thuật chỉ hiện trong khối <TechDetails>.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export type LabelPack = {
  indicators: Record<string, { name: string; unit: string; value_type: string; domain: string; owner_dept: string | null }>;
  specs: Record<string, { title: string; spec_code: string; version: number; sections: Record<string, string>; slots: Record<string, { title: string; section: string; slot_type: string }> }>;
  departments: Record<string, string>;
  fact_status: Record<string, string>;
  run_status: Record<string, string>;
  gate_group: Record<string, string>;
  capture: Record<string, string>;
  domains: Record<string, string>;
};

const EMPTY: LabelPack = { indicators: {}, specs: {}, departments: {}, fact_status: {}, run_status: {}, gate_group: {}, capture: {}, domains: {} };

/** "2026-9M" → "9 tháng đầu năm 2026"; cap=true viết hoa chữ đầu. Khớp common/period.ts của API. */
export function periodLabel(code: string | null | undefined, cap = false): string {
  if (!code) return '—';
  const m = /^(\d{4})-(M(0[1-9]|1[0-2])|Q([1-4])|6M|9M|Y)$/.exec(code.trim());
  if (!m) return code;
  const y = m[1]; const tag = m[2];
  let s: string;
  if (tag.startsWith('M')) s = `tháng ${Number(m[3])} năm ${y}`;
  else if (tag.startsWith('Q')) s = `quý ${['I', 'II', 'III', 'IV'][Number(m[4]) - 1]} năm ${y}`;
  else if (tag === '6M') s = `6 tháng đầu năm ${y}`;
  else if (tag === '9M') s = `9 tháng đầu năm ${y}`;
  else s = `năm ${y}`;
  return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Nhãn ngắn cho hộp chọn: "Tháng 9/2026", "Quý III/2026", "9 tháng 2026". */
export function periodShort(code: string): string {
  const m = /^(\d{4})-(M(0[1-9]|1[0-2])|Q([1-4])|6M|9M|Y)$/.exec(code);
  if (!m) return code;
  const y = m[1]; const tag = m[2];
  if (tag.startsWith('M')) return `Tháng ${Number(m[3])}/${y}`;
  if (tag.startsWith('Q')) return `Quý ${['I', 'II', 'III', 'IV'][Number(m[4]) - 1]}/${y}`;
  if (tag === '6M') return `6 tháng ${y}`;
  if (tag === '9M') return `9 tháng ${y}`;
  return `Năm ${y}`;
}

export const CAPTURE_HINT: Record<string, string> = {
  api: 'Bậc 1 — lấy thẳng từ hệ thống nguồn, tin cậy nhất',
  export: 'Bậc 2 — file xuất từ hệ thống nguồn, đọc từng ô',
  pdf_text: 'Bậc 3 — văn bản có lớp chữ, trích chữ và bảng',
  ocr: 'Bậc 4 — ảnh chụp/scan qua OCR, phải xác nhận từng số',
  form: 'Bậc 5 — nhập tay, tin cậy phụ thuộc người nhập',
};

export const FACT_STATUS_HINT: Record<string, string> = {
  extracted: 'Hệ thống bóc được hoặc cán bộ nhập; chưa ai xác nhận nên chưa dùng cho báo cáo.',
  confirmed: 'Chuyên viên đã xác nhận, đã qua kiểm tra số học; chờ người đại diện phòng duyệt.',
  approved: 'Người đại diện phòng đã duyệt; sẵn sàng để Văn phòng chốt kỳ.',
  locked: 'Văn phòng đã chốt kỳ; số nằm trong bộ số đóng băng của báo cáo.',
  quarantined: 'Không qua kiểm tra hoặc thua nguồn tin cậy hơn; chờ người đại diện phòng xử lý.',
  rejected: 'Đã loại (thường vì được thay bằng phiên bản mới).',
};

export function useLabels() {
  const { data } = useQuery<LabelPack>({ queryKey: ['labels'], queryFn: () => apiGet('/admin/catalog/labels'), staleTime: 10 * 60_000, gcTime: 30 * 60_000 });
  const L = data ?? EMPTY;
  const ind = (id: string | null | undefined) => (id ? L.indicators[id]?.name ?? id : '—');
  const unit = (id: string | null | undefined) => (id ? L.indicators[id]?.unit ?? '' : '');
  const dept = (key: string | null | undefined) => (key ? L.departments[key] ?? key : '—');
  const spec = (specId: number | string | null | undefined) => (specId != null ? L.specs[String(specId)] : undefined);
  const slotTitle = (specId: number | string | null | undefined, code: string) => spec(specId)?.slots[code]?.title ?? code;
  const section = (specId: number | string | null | undefined, sec: string) => {
    const sp = spec(specId); if (!sp) return sec;
    const name = sp.sections[sec]; return name ? `${sec} ${name}` : sec;
  };
  const factStatus = (s: string) => L.fact_status[s] ?? s;
  const runStatus = (s: string) => L.run_status[s] ?? s;
  const gateGroup = (g: string) => L.gate_group[g] ?? g;
  const capture = (c: string) => L.capture[c] ?? c;
  const domain = (d: string) => L.domains[d] ?? d;
  return { loaded: !!data, L, ind, unit, dept, spec, slotTitle, section, factStatus, runStatus, gateGroup, capture, domain, period: periodLabel, periodShort };
}
