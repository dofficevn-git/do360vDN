/**
 * D5 — giao diện Adapter QLVB. Mỗi phần mềm QLVB một bản cài; nghiệp vụ (QlvbService) chỉ gọi interface này.
 * Bốn luồng theo thiết kế: trình ký ↔ nhận bản ký; sổ văn bản đi/đến → event_log; phân công xử lý → task/KPI.
 */
export interface QlvbDoc {
  external_id: string;
  direction: 'den' | 'di';
  so_ky_hieu: string | null;
  /** YYYY-MM-DD */
  ngay: string | null;
  loai: string | null;
  trich_yeu: string | null;
  nguoi_ky: string | null;
  nguoi_xu_ly_email: string | null;
  han_xu_ly: string | null;
  ngay_hoan_thanh: string | null;
  raw?: Record<string, unknown>;
}

export interface SubmitInput {
  tenant_id: string;
  run_id: number;
  title: string;
  docx: Buffer;
  file_name: string;
  signer?: string | null;
  recipients?: string[];
}

export interface SignStatus {
  status: 'pending' | 'signed' | 'rejected';
  so_ky_hieu?: string | null;
  ngay_ky?: string | null;
  /** Bản đã ký nếu QLVB trả file; null = dùng bản nháp đã trình */
  signed_file?: Buffer | null;
  note?: string | null;
}

export interface ScheduleItem {
  external_id: string;
  /** YYYY-MM-DD */
  date: string;
  time: string | null;
  title: string;
  location: string | null;
  attendees: string | null;
  raw?: Record<string, unknown>;
}

export interface QlvbAdapter {
  readonly name: 'lgsp' | 'sim';
  configured(): boolean;
  /** Sổ văn bản trong khoảng ngày (YYYY-MM-DD). */
  fetchDocuments(direction: 'den' | 'di', start: string, end: string): Promise<QlvbDoc[]>;
  /** Lịch công tác (họp, làm việc) → event_log MTG; nguồn "họp" cho nhiệm vụ/KPI. */
  fetchSchedule(start: string, end: string): Promise<ScheduleItem[]>;
  /** Trình ký số. LGSP QLVBDH 1.0 chưa có API này → adapter ném NotImplemented. */
  submitForSignature(input: SubmitInput): Promise<{ external_id: string }>;
  getSignStatus(tenantId: string, externalId: string): Promise<SignStatus>;
}

export const QLVB_ADAPTER = 'QLVB_ADAPTER';

/** dd/MM/yyyy | yyyy-MM-dd | ISO → YYYY-MM-DD; không đọc được → null */
export function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → dd/MM/yyyy (định dạng LGSP) */
export function toVnDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
