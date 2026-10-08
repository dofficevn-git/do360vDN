import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { QlvbDocument } from './qlvb-document.entity';
import { QlvbAdapter, QlvbDoc, ScheduleItem, SignStatus, SubmitInput } from './qlvb-adapter';

/**
 * Bản giả lập QLVB (QLVB_MODE=sim): sổ văn bản là các dòng source='sim' trong qlvb_document (nạp qua
 * POST /admin/qlvb/sim/documents); trình ký = tạo văn bản đi 'pending'; ký = POST /admin/qlvb/sim/sign/:id
 * cấp số ký hiệu NN/BC-UBND. Dùng để chạy trọn luồng D5 khi chưa có API thật.
 */
@Injectable()
export class SimQlvbAdapter implements QlvbAdapter {
  readonly name = 'sim' as const;

  constructor(@InjectRepository(QlvbDocument) private docs: Repository<QlvbDocument>) {}

  configured() { return true; }

  /** Giả lập chỉ "thấy" sổ văn bản của đơn vị đang xét; service gọi với tenant qua withTenant(). */
  private tenantId: string | null = null;
  withTenant(tenantId: string) { this.tenantId = tenantId; return this; }

  async fetchDocuments(direction: 'den' | 'di', start: string, end: string): Promise<QlvbDoc[]> {
    const where: any = { direction, source: 'sim', ngay: Between(start, end) };
    if (this.tenantId) where.tenant_id = this.tenantId;
    const rows = await this.docs.find({ where, order: { ngay: 'ASC' } });
    return rows.map((r) => ({ external_id: r.external_id ?? `sim-${r.id}`, direction, so_ky_hieu: r.so_ky_hieu, ngay: r.ngay, loai: r.loai, trich_yeu: r.trich_yeu, nguoi_ky: r.nguoi_ky,
      nguoi_xu_ly_email: r.nguoi_xu_ly_email, han_xu_ly: r.han_xu_ly, ngay_hoan_thanh: r.ngay_hoan_thanh, raw: r.payload }));
  }

  /** Giả lập không có lịch riêng: lịch nạp qua POST /admin/qlvb/sim/schedule đi thẳng vào event_log. */
  async fetchSchedule(_start: string, _end: string): Promise<ScheduleItem[]> { return []; }

  async submitForSignature(input: SubmitInput): Promise<{ external_id: string }> {
    const external_id = `sim-trinh-ky-${input.run_id}-${Date.now()}`;
    await this.docs.save(this.docs.create({ tenant_id: input.tenant_id, direction: 'di', external_id, so_ky_hieu: null, ngay: null, loai: 'Báo cáo', trich_yeu: input.title,
      nguoi_ky: input.signer ?? null, payload: { file_name: input.file_name, size: input.docx.length, recipients: input.recipients ?? [] }, source: 'sim', run_id: input.run_id, sign_status: 'pending' }));
    return { external_id };
  }

  async getSignStatus(tenantId: string, externalId: string): Promise<SignStatus> {
    const d = await this.docs.findOne({ where: { tenant_id: tenantId, external_id: externalId, source: 'sim' } });
    if (!d) return { status: 'rejected', note: 'Không tìm thấy văn bản trình ký trong QLVB giả lập.' };
    if (d.sign_status === 'signed') return { status: 'signed', so_ky_hieu: d.so_ky_hieu, ngay_ky: d.ngay, signed_file: null };
    if (d.sign_status === 'rejected') return { status: 'rejected', note: String(d.payload?.note ?? 'Bị trả lại') };
    return { status: 'pending' };
  }

  /** Thao tác "lãnh đạo ký" trong giả lập: cấp số ký hiệu, ngày ký = hôm nay. */
  async sign(tenantId: string, docId: number, opts: { so_ky_hieu?: string; nguoi_ky?: string; reject?: string; ngay_ky?: string } = {}) {
    const d = await this.docs.findOne({ where: { id: docId, tenant_id: tenantId, source: 'sim' } });
    if (!d || d.direction !== 'di' || !d.run_id) throw new BadRequestException('Không phải văn bản DO360 trình ký trong QLVB giả lập.');
    if (d.sign_status === 'signed') throw new BadRequestException('Văn bản đã ký.');
    if (opts.reject) { await this.docs.update(d.id, { sign_status: 'rejected', payload: { ...d.payload, note: opts.reject } }); return this.docs.findOne({ where: { id: d.id } }); }
    const ngayKy = opts.ngay_ky && /^\d{4}-\d{2}-\d{2}$/.test(opts.ngay_ky) ? opts.ngay_ky : new Date().toISOString().slice(0, 10);
    const year = Number(ngayKy.slice(0, 4));
    const n = (await this.docs.count({ where: { tenant_id: tenantId, source: 'sim', direction: 'di', sign_status: 'signed' } })) + 1;
    await this.docs.update(d.id, { sign_status: 'signed', so_ky_hieu: opts.so_ky_hieu?.trim() || `${n}/BC-UBND`, ngay: ngayKy, nguoi_ky: opts.nguoi_ky ?? d.nguoi_ky, payload: { ...d.payload, signed_year: year } });
    return this.docs.findOne({ where: { id: d.id } });
  }
}
