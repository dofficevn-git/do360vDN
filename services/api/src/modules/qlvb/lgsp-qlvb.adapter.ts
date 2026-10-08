import { Injectable, Logger, NotImplementedException, ServiceUnavailableException } from '@nestjs/common';
import { QlvbAdapter, QlvbDoc, ScheduleItem, SignStatus, SubmitInput, toIsoDate, toVnDate } from './qlvb-adapter';

/**
 * Adapter QLVB điều hành qua trục LGSP Đà Nẵng (TaiLieu_LGSPv2_API_QLVBDH_LienThongTichHop, v1.0, 13/7/2026).
 *  - Token: POST {LGSP_TOKEN_URL} Basic(ConsumerKey:ConsumerSecret) grant_type=client_credentials (hết hạn 3600s).
 *  - Gọi: POST {LGSP_QLVB_URL}/api { actionName, organId, organKey, params{…, responseMode: POLLING} }
 *    → jobId → GET /api/jobs?jobId (trạng thái) → GET /api/jobs/artifact?jobId (kết quả).
 *  - Có getVanBanDen, getVanBanDi, LichCongTac. KHÔNG có API trình ký/nhận bản ký → submitForSignature ném 501.
 * Cấu trúc JSON trả về chưa được tài liệu mô tả → đọc phòng thủ theo nhiều tên trường; mẫu thật lưu ở eval/private/qlvb/.
 */
@Injectable()
export class LgspQlvbAdapter implements QlvbAdapter {
  readonly name = 'lgsp' as const;
  private readonly logger = new Logger(LgspQlvbAdapter.name);
  private token: string | null = null;
  private tokenExp = 0;

  private env(k: string, d = '') { return (process.env[k] ?? d).trim(); }
  private base() { return this.env('LGSP_QLVB_URL', 'https://apiv2.danang.gov.vn/LGSP/QLVBDH/1.0').replace(/\/$/, ''); }

  configured() {
    return !!(this.env('LGSP_CONSUMER_KEY') && this.env('LGSP_CONSUMER_SECRET') && this.env('QLVB_ORGAN_ID') && this.env('QLVB_ORGAN_KEY'));
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    const url = this.env('LGSP_TOKEN_URL', 'https://apiv2.danang.gov.vn/oauth2/token');
    const basic = Buffer.from(`${this.env('LGSP_CONSUMER_KEY')}:${this.env('LGSP_CONSUMER_SECRET')}`).toString('base64');
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20_000) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new ServiceUnavailableException(`LGSP không cấp token: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    this.token = data.access_token;
    this.tokenExp = Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000;
    return this.token!;
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.base()}${path}`, { headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ServiceUnavailableException(`LGSP ${path}: HTTP ${res.status}`);
    return data;
  }

  /** Gọi một action và chờ kết quả (POLLING). */
  async call(actionName: string, params: Record<string, unknown>): Promise<any> {
    if (!this.configured()) throw new ServiceUnavailableException('Chưa cấu hình LGSP (LGSP_CONSUMER_KEY/SECRET, QLVB_ORGAN_ID/KEY).');
    const body = { actionName, organId: this.env('QLVB_ORGAN_ID'), organKey: this.env('QLVB_ORGAN_KEY'), params: { ...params, responseMode: 'POLLING' }, use_callback: false };
    const res = await fetch(`${this.base()}/api`, { method: 'POST', headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const first: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new ServiceUnavailableException(`LGSP ${actionName}: HTTP ${res.status} ${JSON.stringify(first).slice(0, 200)}`);
    const jobId = first?.jobId ?? first?.data?.jobId ?? first?.requestCode ?? first?.data?.requestCode;
    if (!jobId) return first; // trả đồng bộ
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await this.get(`/api/jobs?jobId=${encodeURIComponent(jobId)}`);
      const status = String(st?.status ?? st?.data?.status ?? '').toUpperCase();
      if (['DONE', 'COMPLETED', 'SUCCESS', 'FINISHED'].includes(status)) return this.get(`/api/jobs/artifact?jobId=${encodeURIComponent(jobId)}`);
      if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) throw new ServiceUnavailableException(`LGSP job ${jobId} thất bại: ${JSON.stringify(st).slice(0, 200)}`);
    }
    throw new ServiceUnavailableException(`LGSP job ${jobId} quá thời gian chờ.`);
  }

  /** Tìm mảng bản ghi trong kết quả (cấu trúc chưa có tài liệu). */
  private rows(out: any): any[] {
    if (Array.isArray(out)) return out;
    for (const k of ['data', 'items', 'result', 'rows', 'list', 'content', 'records']) {
      const v = out?.[k];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') { const inner = this.rows(v); if (inner.length) return inner; }
    }
    return [];
  }

  private pick(r: any, ...keys: string[]): string | null {
    for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); }
    return null;
  }

  async fetchDocuments(direction: 'den' | 'di', start: string, end: string): Promise<QlvbDoc[]> {
    const out = await this.call(direction === 'den' ? 'getVanBanDen' : 'getVanBanDi', { startDate: toVnDate(start), endDate: toVnDate(end), type: '001', soKyHieu: '', id: '', page: '1', pageSize: '500', ...(direction === 'den' ? { soDen: '', vanBanDiId: '' } : { soDi: '', nguoiXuLyEmail: '' }) });
    return this.rows(out).map((r) => ({
      external_id: this.pick(r, 'id', 'vanBanId', 'vanBanDenId', 'vanBanDiId', 'ID') ?? `${this.pick(r, 'soKyHieu', 'so_ky_hieu') ?? ''}#${this.pick(r, 'ngayBanHanh', 'ngayDen', 'ngayVanBan') ?? ''}`,
      direction,
      so_ky_hieu: this.pick(r, 'soKyHieu', 'so_ky_hieu', 'kyHieu', 'soDen', 'soDi'),
      ngay: toIsoDate(this.pick(r, direction === 'di' ? 'ngayBanHanh' : 'ngayDen', 'ngayKy', 'ngayVanBan', 'ngayBanHanh', 'ngayDen', 'ngay')),
      loai: this.pick(r, 'tenLoaiVanBan', 'loaiVanBan', 'loai'),
      trich_yeu: this.pick(r, 'trichYeu', 'trich_yeu', 'tieuDe'),
      nguoi_ky: this.pick(r, 'nguoiKy', 'nguoi_ky'),
      nguoi_xu_ly_email: this.pick(r, 'nguoiXuLyEmail', 'nguoiXuLy', 'emailNguoiXuLy'),
      han_xu_ly: toIsoDate(this.pick(r, 'hanXuLy', 'han_xu_ly', 'hanGiaiQuyet')),
      ngay_hoan_thanh: toIsoDate(this.pick(r, 'ngayHoanThanh', 'ngay_hoan_thanh', 'ngayXuLyXong')),
      raw: r,
    }));
  }

  async fetchSchedule(start: string, end: string): Promise<ScheduleItem[]> {
    const out = await this.call('LichCongTac', { kieuLCT: 1, username: this.env('QLVB_LCT_USERNAME'), maPhongBan: this.env('QLVB_LCT_PHONGBAN'), startDate: toVnDate(start), endDate: toVnDate(end) });
    return this.rows(out).map((r) => ({
      external_id: this.pick(r, 'id', 'lichId', 'ID') ?? `${this.pick(r, 'ngay', 'ngayLam', 'thoiGian') ?? ''}#${(this.pick(r, 'noiDung', 'tieuDe', 'noiDungCongViec') ?? '').slice(0, 40)}`,
      date: toIsoDate(this.pick(r, 'ngay', 'ngayLam', 'ngayBatDau', 'thoiGianBatDau', 'thoiGian')) ?? start,
      time: this.pick(r, 'gio', 'gioBatDau', 'thoiGianBatDau'),
      title: this.pick(r, 'noiDung', 'tieuDe', 'noiDungCongViec') ?? '(không có nội dung)',
      location: this.pick(r, 'diaDiem', 'diaDiemHop'),
      attendees: this.pick(r, 'thanhPhan', 'nguoiThamDu', 'thanhPhanThamDu'),
      raw: r,
    }));
  }

  async submitForSignature(_input: SubmitInput): Promise<{ external_id: string }> {
    throw new NotImplementedException('LGSP QLVBDH 1.0 chỉ có API đọc (getVanBanDen/Di, LichCongTac) — chưa có API trình ký. Dùng QLVB_MODE=sim hoặc chờ đơn vị chủ quản mở API.');
  }

  async getSignStatus(_tenantId: string, _externalId: string): Promise<SignStatus> {
    throw new NotImplementedException('LGSP QLVBDH 1.0 chưa có API nhận bản đã ký.');
  }
}
