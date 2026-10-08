// Kiểu dữ liệu + nhãn dùng chung cho các màn DO360.
import Cookies from 'js-cookie';

export type FactStatus = 'extracted' | 'confirmed' | 'approved' | 'locked' | 'quarantined' | 'rejected';
export const FACT_STATUS: Record<FactStatus, { label: string; preset: 'neutral' | 'blue' | 'green' | 'gold' | 'red' | 'cyan' }> = {
  extracted: { label: 'Chờ xác nhận', preset: 'blue' },
  confirmed: { label: 'Đã xác nhận', preset: 'cyan' },
  approved: { label: 'Đã duyệt', preset: 'green' },
  locked: { label: 'Đã chốt', preset: 'neutral' },
  quarantined: { label: 'Cách ly', preset: 'red' },
  rejected: { label: 'Đã loại', preset: 'neutral' },
};

export const CAPTURE_LABEL: Record<string, string> = { api: 'API', export: 'File xuất', pdf_text: 'PDF/Word', ocr: 'OCR', form: 'Nhập tay' };
export const FILE_STATUS: Record<string, { label: string; preset: 'neutral' | 'blue' | 'green' | 'gold' | 'red' }> = {
  received: { label: 'Đã nhận', preset: 'blue' }, parsed: { label: 'Đã đọc', preset: 'blue' }, extracted: { label: 'Đã bóc tách', preset: 'green' },
  no_rule: { label: 'Chưa có luật', preset: 'gold' }, failed: { label: 'Lỗi', preset: 'red' },
};
export const RUN_STATUS: Record<string, { label: string; preset: 'neutral' | 'blue' | 'green' | 'gold' | 'red' | 'cyan' }> = {
  collecting: { label: 'Đang thu số', preset: 'blue' }, locked: { label: 'Đã chốt', preset: 'gold' }, drafted: { label: 'Có bản nháp', preset: 'cyan' },
  submitted: { label: 'Đã trình ký', preset: 'green' }, signed: { label: 'Đã ký', preset: 'green' }, cancelled: { label: 'Huỷ', preset: 'neutral' },
};
export const KPI_STATUS: Record<string, { label: string; preset: 'neutral' | 'blue' | 'green' | 'gold' | 'red' | 'cyan' }> = {
  proposed: { label: 'Đề xuất', preset: 'blue' }, explained: { label: 'Đã giải trình', preset: 'gold' }, approved: { label: 'Đã duyệt', preset: 'green' },
};
export const GATE_GROUP: Record<string, string> = { so_hoc: 'Số học', dinh_dang: 'Định dạng', ngay_chot: 'Ngày chốt', xu_huong: 'Xu hướng', day_du: 'Đầy đủ', nhat_quan: 'Nhất quán kỳ' };

export interface CurrentFact {
  id: string; indicator_id: string; name: string; unit: string; value_type: string; domain: string; owner_dept: string | null; aggregation: string;
  period: string; as_of_date: string; value: number; breakdown: Record<string, string>; source_ref: any; source_file_id: number | null;
  capture_method: string; confidence: number; status: FactStatus; version: number; note: string | null;
}

/** Kỳ gần nhất để chọn mặc định: tháng trước, quý trước, 6M/9M/Y của năm hiện tại. */
export function periodOptions(): { code: string; label: string }[] {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth() + 1;
  const out: { code: string; label: string }[] = [];
  for (let i = 0; i < 3; i++) { const mm = m - i; const yy = mm <= 0 ? y - 1 : y; const mo = ((mm - 1 + 12) % 12) + 1; out.push({ code: `${yy}-M${String(mo).padStart(2, '0')}`, label: `Tháng ${mo}/${yy}` }); }
  const q = Math.ceil(m / 3);
  for (let i = 0; i < 2; i++) { const qq = q - i; const yy = qq <= 0 ? y - 1 : y; const qn = ((qq - 1 + 4) % 4) + 1; out.push({ code: `${yy}-Q${qn}`, label: `Quý ${['I', 'II', 'III', 'IV'][qn - 1]}/${yy}` }); }
  out.push({ code: `${y}-6M`, label: `6 tháng ${y}` }, { code: `${y}-9M`, label: `9 tháng ${y}` }, { code: `${y}-Y`, label: `Năm ${y}` }, { code: `${y - 1}-Y`, label: `Năm ${y - 1}` });
  return out;
}

export function currentAdmin(): { id?: number; role?: string; department?: string | null; full_name?: string } {
  try { return JSON.parse(Cookies.get('admin_user') || '{}'); } catch { return {}; }
}

export const fmtNum = (v: number, type = 'integer') =>
  type === 'money' ? (Math.abs(v) >= 1e9 ? `${(v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} tỷ` : `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} triệu`)
  : type === 'percent' ? `${v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%` : v.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
export const fmtDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const errMsg = (err: any, fallback = 'Có lỗi xảy ra') => {
  const m = err?.response?.data?.message; return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};
