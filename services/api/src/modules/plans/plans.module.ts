import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlanTarget } from './plan-target.entity';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { MANAGER_ROLES, READER_ROLES } from '../../common/roles';
import { tenantOf } from '../../common/tenant';
import { Actor } from '../facts/facts.service';

export interface PlanRow { indicator_id: string; value: number; source_ref?: Record<string, unknown>; note?: string }

/** Kế hoạch năm: nguồn cho {id:plan%} trong khuôn câu và cột "đạt/kế hoạch" trên dashboard. */
@Injectable()
export class PlansService {
  constructor(@InjectRepository(PlanTarget) private repo: Repository<PlanTarget>, @InjectDataSource() private ds: DataSource, private catalog: CatalogService) {}

  /** Kế hoạch hiện hành (version mới nhất) của một năm: { indicator_id: { value, source_ref, version, id } } */
  async current(tenantId: string, year: number): Promise<Record<string, { id: number; value: number; source_ref: Record<string, unknown>; version: number }>> {
    const rows: any[] = await this.ds.query(
      `SELECT DISTINCT ON (indicator_id) id, indicator_id, value::float8 AS value, source_ref, version FROM plan_target WHERE tenant_id = $1 AND year = $2 ORDER BY indicator_id, version DESC`, [tenantId, year]);
    return Object.fromEntries(rows.map((r) => [r.indicator_id, { id: r.id, value: r.value, source_ref: r.source_ref ?? {}, version: r.version }]));
  }

  async list(tenantId: string, year: number) {
    const cur = await this.current(tenantId, year);
    const inds = await this.catalog.listIndicators();
    return inds.filter((i) => i.is_active).map((i) => ({ indicator_id: i.indicator_id, name: i.name, unit: i.unit, value_type: i.value_type, domain: i.domain, owner_dept: i.owner_dept, plan: cur[i.indicator_id] ?? null }));
  }

  async upsert(actor: Actor, year: number, rows: PlanRow[]) {
    if (!(MANAGER_ROLES as readonly string[]).includes(actor.role) && actor.role !== 'leader') throw new ForbiddenException('Chỉ Văn phòng/lãnh đạo được nhập kế hoạch năm.');
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new BadRequestException('Năm không hợp lệ.');
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException('Không có dòng kế hoạch nào.');
    const cur = await this.current(actor.tenant_id, year);
    let inserted = 0, unchanged = 0;
    for (const r of rows) {
      const ind = await this.catalog.getIndicatorOrFail(r.indicator_id);
      const v = Number(r.value);
      if (!Number.isFinite(v)) throw new BadRequestException(`Kế hoạch của "${ind.name}" không phải số.`);
      const prev = cur[r.indicator_id];
      if (prev && Math.abs(prev.value - v) < 1e-9) { unchanged++; continue; }
      await this.repo.save(this.repo.create({ tenant_id: actor.tenant_id, indicator_id: r.indicator_id, year, value: String(v), source_ref: r.source_ref ?? {}, note: r.note ?? null, version: (prev?.version ?? 0) + 1, created_by: actor.id }));
      inserted++;
    }
    return { inserted, unchanged };
  }

  /** Nhập từ biểu mẫu Excel (cột "Mã chỉ tiêu" + "Kế hoạch năm"): đọc qua services/reader /parse. */
  async importXlsx(actor: Actor, year: number, file: Express.Multer.File, sourceRef: Record<string, unknown>) {
    if (!file?.buffer?.length) throw new BadRequestException('Không có file.');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'application/octet-stream' }), Buffer.from(file.originalname, 'latin1').toString('utf8'));
    const readerUrl = (process.env.READER_URL || 'http://localhost:8000').replace(/\/$/, '');
    const res = await fetch(`${readerUrl}/parse`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    const parsed: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(`Không đọc được file: ${parsed?.detail ?? res.status}`);
    const rows: PlanRow[] = [];
    for (const t of parsed.tables ?? []) {
      const cells: any[] = t.cells ?? [];
      const head = cells.find((c) => /mã chỉ tiêu/i.test(c.text)); const valHead = cells.find((c) => /kế hoạch/i.test(c.text) && c.row === head?.row);
      if (!head || !valHead) continue;
      for (const c of cells) {
        if (c.col !== head.col || c.row <= head.row) continue;
        const v = cells.find((x) => x.row === c.row && x.col === valHead.col);
        if (!v?.text) continue;
        const n = Number(String(v.text).replace(/\./g, '').replace(',', '.'));
        if (Number.isFinite(n)) rows.push({ indicator_id: String(c.text).trim(), value: n, source_ref: { ...sourceRef, file: file.originalname, cell: v.ref } });
      }
    }
    if (!rows.length) throw new BadRequestException('Không thấy cột "Mã chỉ tiêu" và "Kế hoạch năm" trong file.');
    return { rows: rows.length, ...(await this.upsert(actor, year, rows)) };
  }
}

const actorOf = (req: any): Actor => ({ id: req.user.id, role: req.user.role, department: req.user.department ?? null, tenant_id: tenantOf(req) });

@ApiTags('Plans')
@Controller('admin/plan-targets')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class PlansController {
  constructor(private service: PlansService) {}

  @Get()
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Kế hoạch năm của mọi chỉ tiêu (null = chưa giao)' })
  list(@Request() req, @Query('year') year: string) { return this.service.list(tenantOf(req), Number(year) || new Date().getFullYear()); }

  @Post()
  @Roles(...MANAGER_ROLES, 'leader')
  @AuditLog({ module: 'plans', action: 'upsert' })
  upsert(@Request() req, @Body() body: { year: number; rows: PlanRow[] }) { return this.service.upsert(actorOf(req), Number(body?.year), body?.rows ?? []); }

  @Post('import')
  @Roles(...MANAGER_ROLES, 'leader')
  @AuditLog({ module: 'plans', action: 'import' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  importXlsx(@Request() req, @UploadedFile() file: Express.Multer.File, @Body() body: { year: string; so_ky_hieu?: string; ngay?: string }) {
    return this.service.importXlsx(actorOf(req), Number(body?.year), file, { so_ky_hieu: body?.so_ky_hieu ?? null, ngay: body?.ngay ?? null });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([PlanTarget]), CatalogModule],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
