import { BadRequestException, Controller, Injectable, Logger, Module, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModuleRef } from '@nestjs/core';
import { BronzeModule, BronzeService } from '../bronze/bronze.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { FactsModule } from '../facts/facts.module';
import { Actor, ExtractedRecord, FactsService } from '../facts/facts.service';
import { CaptureMethod } from '../catalog/indicator.entity';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { tenantOf } from '../../common/tenant';

/** Bậc thu thập suy từ loại file services/reader nhận diện. */
const CAPTURE_BY_KIND: Record<string, CaptureMethod> = { xlsx: 'export', csv: 'export', docx: 'pdf_text', pdf_text: 'pdf_text', pdf_scan: 'ocr', image: 'ocr' };

/**
 * T3 (điều phối) — file Bronze → services/reader (đọc + chạy luật) → bản ghi `extracted` vào kho.
 * Reader không giữ gì; mọi thứ ghi ra đều đi qua FactsService.ingest với đủ quy tắc của D1.
 */
@Injectable()
export class ExtractService {
  private readonly logger = new Logger(ExtractService.name);

  constructor(private bronze: BronzeService, private catalog: CatalogService, private facts: FactsService, private moduleRef: ModuleRef) {}

  /** T4: thẻ xác nhận qua kênh chat — lấy ChatService muộn để không tạo vòng phụ thuộc module. */
  private chat(): any {
    try { return this.moduleRef.get(require('../chat/chat.service').ChatService, { strict: false }); } catch { return null; }
  }

  private readerUrl() {
    return (process.env.READER_URL || 'http://localhost:8000').replace(/\/$/, '');
  }

  async run(actor: Actor, fileId: number) {
    const file = await this.bronze.get(actor.tenant_id, fileId);
    if (actor.role === 'department_staff' && file.department !== actor.department) throw new BadRequestException('File không thuộc bộ phận của bạn.');
    if (!file.period) throw new BadRequestException('File chưa gắn kỳ báo cáo — chọn kỳ rồi bóc tách.');
    const [rules, indicators, buffer] = await Promise.all([this.catalog.activeRules(), this.catalog.listIndicators(), this.bronze.content(file)]);
    const types: Record<string, string> = {};
    for (const i of indicators) types[i.indicator_id] = i.value_type;
    const domainOfDept = new Set(indicators.filter((i) => i.owner_dept && i.owner_dept === file.department).map((i) => i.domain));

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: file.mime || 'application/octet-stream' }), file.original_name);
    form.append('rules', JSON.stringify(rules.map((r) => r.rule)));
    form.append('indicators', JSON.stringify(types));
    // tài khoản gửi thuộc lĩnh vực nào thì chỉ thử luật của lĩnh vực đó (khi phòng chỉ có 1 lĩnh vực)
    form.append('domain', domainOfDept.size === 1 ? [...domainOfDept][0] : '');

    let res: Response;
    try {
      res = await fetch(`${this.readerUrl()}/extract`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      await this.bronze.mark(file.id, { status: 'failed', error: `Không gọi được dịch vụ đọc file: ${err}` });
      throw new BadRequestException('Dịch vụ đọc file không sẵn sàng (services/reader).');
    }
    const body: any = await res.json().catch(() => ({}));
    const piiWarning: string | null = body?.pii?.warning ?? null;
    if (piiWarning) { await this.bronze.mark(file.id, { pii_warning: piiWarning }); this.logger.warn(`[extract] file ${file.id}: ${piiWarning}`); }
    // Thiết kế 03/10 mục 10: file Bronze có dữ liệu cá nhân thì che vùng hoặc TỪ CHỐI nhận (PII_POLICY=reject); mặc định cảnh báo
    if (piiWarning && (process.env.PII_POLICY || 'warn').toLowerCase() === 'reject') {
      await this.bronze.mark(file.id, { status: 'rejected', error: `Từ chối: ${piiWarning}. Chỉ nộp bảng tổng hợp, không nộp danh sách có họ tên, CCCD, số điện thoại.` });
      return { file_id: file.id, status: 'rejected', file_kind: body.file_kind, records: [], pii_warning: piiWarning, message: 'File có dữ liệu cá nhân — bị từ chối theo chính sách (PII_POLICY=reject). Che vùng dữ liệu cá nhân rồi nộp lại.' };
    }
    if (!res.ok) {
      const msg = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`;
      await this.bronze.mark(file.id, { status: 'failed', error: msg });
      throw new BadRequestException(msg);
    }
    if (!body.matched_rule) {
      await this.bronze.mark(file.id, { status: 'no_rule', file_kind: body.file_kind, error: (body.tried ?? []).map((t: any) => `${t.source_type}@${t.version}: ${t.why_not ?? 'không khớp'}`).join('; ') || 'Chưa có luật nào cho loại file này' });
      return { file_id: file.id, status: 'no_rule', file_kind: body.file_kind, tried: body.tried, records: [], pii_warning: piiWarning, message: 'Không nhận ra biểu mẫu — nhập số bằng form hoặc bổ sung luật bóc tách.' };
    }
    const capture = CAPTURE_BY_KIND[body.file_kind] ?? 'ocr';
    // ngày chốt: bộ phận khai khi nộp file (source_file.as_of_date); không khai → ngày nộp
    const asOf = (file as any).as_of_date ? String((file as any).as_of_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const records: ExtractedRecord[] = (body.records ?? []).map((r: any) => ({
      indicator_id: r.indicator_id, period: file.period!, as_of_date: asOf, value: r.value, capture_method: capture,
      confidence: r.confidence, source_file_id: file.id, source_ref: { ...r.source_ref, file_id: file.id },
    }));
    const outcomes = records.length ? await this.facts.ingest(actor, records, file.channel) : [];
    await this.bronze.mark(file.id, { status: 'extracted', file_kind: body.file_kind, source_type: String(body.matched_rule).split('@')[0], extracted_count: outcomes.length, error: null });
    this.logger.log(`[extract] file ${file.id} (${file.original_name}) → ${body.matched_rule}: ${outcomes.length} bản ghi, ${body.misses?.length ?? 0} nhãn không thấy`);
    const result = { file_id: file.id, status: 'extracted', file_kind: body.file_kind, matched_rule: body.matched_rule, ocr: body.ocr, misses: body.misses, warnings: body.warnings, pii_warning: piiWarning,
      records: outcomes.map((o, i) => ({ ...o, value: records[i]?.value, confidence: records[i]?.confidence, note: o.note ?? body.records[i]?.note })) };
    if (file.channel === 'web' && outcomes.length) this.chat()?.notifyExtracted(actor, file, result.records).catch((err: unknown) => this.logger.warn(`notifyExtracted: ${err}`));
    return result;
  }
}

@ApiTags('Extract')
@Controller('admin/files')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class ExtractController {
  constructor(private service: ExtractService) {}

  @Post(':id/extract')
  @AuditLog({ module: 'files', action: 'extract' })
  @ApiOperation({ summary: 'Đọc file gốc, chạy luật bóc tách, sinh bản ghi extracted' })
  run(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const actor: Actor = { id: req.user.id, role: req.user.role, department: req.user.department ?? null, tenant_id: tenantOf(req) };
    return this.service.run(actor, id);
  }
}

@Module({
  imports: [BronzeModule, CatalogModule, FactsModule],
  controllers: [ExtractController],
  providers: [ExtractService],
  exports: [ExtractService],
})
export class ExtractModule {}
