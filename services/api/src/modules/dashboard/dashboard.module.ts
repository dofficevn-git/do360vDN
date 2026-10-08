import { Controller, Get, Injectable, Module, Query, Request, UseGuards } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportRun } from '../reports/report-run.entity';
import { ReportSpec } from '../catalog/report-spec.entity';
import { QualityGateService } from '../facts/quality-gate.service';
import { FactsModule } from '../facts/facts.module';
import { CatalogModule } from '../catalog/catalog.module';
import { KpiModule } from '../kpi/kpi.module';
import { KpiService } from '../kpi/kpi.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { tenantOf } from '../../common/tenant';
import { Roles } from '../../common/decorators/roles.decorator';
import { READER_ROLES } from '../../common/roles';
import { parsePeriod } from '../../common/period';

/**
 * D7 — dashboard lãnh đạo: tình hình kỳ (tiến độ, gate, cách ly), độ phủ theo lĩnh vực, xu hướng chỉ tiêu qua các kỳ,
 * việc theo phòng, văn bản QLVB, KPI. Chỉ đọc; số lấy từ bộ hiện hành đã xác nhận/duyệt/chốt (không lấy extracted).
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(ReportRun) private runs: Repository<ReportRun>,
    @InjectRepository(ReportSpec) private specs: Repository<ReportSpec>,
    private gate: QualityGateService,
    private kpi: KpiService,
  ) {}

  async overview(tenantId: string, period?: string) {
    const runs = await this.runs.find({ where: period ? { tenant_id: tenantId, period } : { tenant_id: tenantId }, order: { created_at: 'DESC' }, take: period ? 20 : 1 });
    const run = runs[0] ?? null;
    const p = period ?? run?.period ?? null;
    const specMap = new Map((await this.specs.find()).map((s) => [s.id, s]));
    let gate: any = null;
    if (run && run.status === 'collecting') {
      const g = await this.gate.evaluatePeriod(tenantId, run.period, run.spec_id, { cutoffDate: run.cutoff_date, exceptions: (run.gate_report as any)?.exceptions ?? {} });
      const byGroup: Record<string, number> = {};
      for (const e of g.errors) byGroup[e.group] = (byGroup[e.group] ?? 0) + 1;
      gate = { ok: g.ok, errors: g.errors.length, warnings: g.warnings.length, by_group: byGroup, slots_total: g.slots.length, slots_complete: g.slots.filter((s) => s.complete).length };
    } else if (run?.gate_report) {
      const gr: any = run.gate_report;
      gate = { ok: gr.ok ?? true, errors: gr.errors?.length ?? 0, warnings: gr.warnings?.length ?? 0, by_group: {}, slots_total: null, slots_complete: null, frozen: true };
    }
    const domains = p ? await this.ds.query(
      `SELECT i.domain, COUNT(*)::int AS indicators, COUNT(f.id)::int AS with_value,
              COUNT(f.id) FILTER (WHERE f.status IN ('approved','locked'))::int AS approved, COUNT(f.id) FILTER (WHERE f.status = 'extracted')::int AS pending
         FROM dim_indicator i LEFT JOIN LATERAL (
              SELECT id, status FROM fact_indicator x WHERE x.tenant_id = $1 AND x.period = $2 AND x.indicator_id = i.indicator_id AND x.breakdown_key = '' AND x.status NOT IN ('rejected','quarantined')
              ORDER BY x.version DESC LIMIT 1) f ON true
        WHERE i.is_active GROUP BY i.domain ORDER BY i.domain`, [tenantId, p]) : [];
    const [q] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM fact_indicator WHERE tenant_id = $1 AND status = 'quarantined'`, [tenantId]);
    const files = p ? (await this.ds.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'extracted')::int AS extracted FROM source_file WHERE tenant_id = $1 AND period = $2`, [tenantId, p]))[0] : { n: 0, extracted: 0 };
    const range = p ? parsePeriod(p) : null;
    const docs = range ? (await this.ds.query(`SELECT COUNT(*) FILTER (WHERE direction = 'den')::int AS den, COUNT(*) FILTER (WHERE direction = 'di')::int AS di FROM qlvb_document WHERE tenant_id = $1 AND ngay BETWEEN $2 AND $3`, [tenantId, range.start, range.end]))[0] : { den: 0, di: 0 };
    const events = range ? (await this.ds.query(`SELECT COUNT(*)::int AS n FROM event_log WHERE tenant_id = $1 AND event_date BETWEEN $2 AND $3`, [tenantId, range.start, range.end]))[0] : { n: 0 };
    const tasks = await this.ds.query(
      `SELECT COALESCE(a.department, '—') AS dept, COUNT(*) FILTER (WHERE t.status IN ('new','in_progress'))::int AS open,
              COUNT(*) FILTER (WHERE t.status IN ('new','in_progress') AND t.due_at < now())::int AS overdue, COUNT(*) FILTER (WHERE t.status = 'done')::int AS done
         FROM tasks t JOIN admin_users a ON a.id = t.assignee_id WHERE t.tenant_id = $1 ${range ? 'AND COALESCE(t.due_at, t.created_at)::date BETWEEN $2 AND $3' : ''}
        GROUP BY 1 ORDER BY 1`, range ? [tenantId, range.start, range.end] : [tenantId]);
    let kpi: any = null;
    if (p) { try { const s = await this.kpi.summary(tenantId, p); kpi = { ...s.totals, departments: s.departments }; } catch { kpi = null; } }
    return {
      period: p, run: run ? { run_id: run.run_id, status: run.status, cutoff_date: run.cutoff_date, spec: specMap.get(run.spec_id)?.title ?? null, locked_at: run.locked_at, signed_number: run.signed_number, signed_date: run.signed_date } : null,
      runs: runs.map((r) => ({ run_id: r.run_id, period: r.period, status: r.status, spec: specMap.get(r.spec_id)?.title ?? null })),
      gate, domains, quarantine: q?.n ?? 0, files, documents: docs, events: events?.n ?? 0, tasks, kpi,
    };
  }

  /** Giá trị chỉ tiêu qua các kỳ (chỉ số đã xác nhận/duyệt/chốt). */
  async trends(tenantId: string, indicatorIds: string[], periods: string[]) {
    if (!indicatorIds.length || !periods.length) return { indicators: [], periods, series: [] };
    for (const p of periods) parsePeriod(p);
    const rows: any[] = await this.ds.query(
      `SELECT DISTINCT ON (f.indicator_id, f.period) f.indicator_id, f.period, f.value::float8 AS value, f.status, f.as_of_date::text AS as_of_date, f.capture_method
         FROM fact_indicator f WHERE f.tenant_id = $1 AND f.indicator_id = ANY($2) AND f.period = ANY($3) AND f.breakdown_key = '' AND f.status IN ('confirmed','approved','locked')
        ORDER BY f.indicator_id, f.period, f.version DESC`, [tenantId, indicatorIds, periods]);
    const meta: any[] = await this.ds.query(`SELECT indicator_id, name, unit, value_type, domain, aggregation FROM dim_indicator WHERE indicator_id = ANY($1)`, [indicatorIds]);
    const series = indicatorIds.map((id) => ({ indicator_id: id, ...(meta.find((m) => m.indicator_id === id) ?? {}),
      points: periods.map((p) => { const r = rows.find((x) => x.indicator_id === id && x.period === p); return { period: p, value: r?.value ?? null, status: r?.status ?? null, as_of_date: r?.as_of_date ?? null }; }) }));
    return { indicators: meta, periods, series };
  }

  /**
   * 5 KPI dự án (mục tiêu trong tài liệu thiết kế), đo từ dữ liệu thật của kho:
   *  ty_le_bac_1_3 ≥60 · slot_tu_dien ≥80 · so_boc_khong_can_sua ≥95 · loi_doi_soat_lot_ban_ky = 0 · thoi_gian_tong_hop_gio (−70% so làm tay, cần mốc làm tay của xã).
   */
  async projectKpis(tenantId: string, period?: string) {
    const pf = period ? ' AND f.period = $2' : '';
    const params = period ? [tenantId, period] : [tenantId];
    const [cur] = await this.ds.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE f.capture_method IN ('api','export','pdf_text'))::int AS high, COUNT(*) FILTER (WHERE f.capture_method <> 'form')::int AS auto
         FROM (SELECT DISTINCT ON (f.indicator_id, f.period, f.breakdown_key) f.* FROM fact_indicator f WHERE f.tenant_id = $1${pf} AND f.status NOT IN ('rejected','quarantined') ORDER BY f.indicator_id, f.period, f.breakdown_key, f.version DESC) f`, params);
    const [slot] = await this.ds.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE f.capture_method <> 'form')::int AS auto
         FROM report_run r JOIN report_slot s ON s.spec_id = r.spec_id CROSS JOIN LATERAL jsonb_array_elements_text(s.indicator_ids) ind
         JOIN LATERAL (SELECT capture_method FROM fact_indicator x WHERE x.tenant_id = r.tenant_id AND x.period = r.period AND x.indicator_id = ind AND x.breakdown_key = '' AND x.status NOT IN ('rejected','quarantined') ORDER BY x.version DESC LIMIT 1) f ON true
        WHERE r.tenant_id = $1 AND r.status <> 'cancelled'${period ? ' AND r.period = $2' : ''}`, params);
    const [ext] = await this.ds.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE f.status = 'rejected' AND f.note LIKE 'Thay bằng phiên bản%')::int AS corrected
         FROM fact_indicator f WHERE f.tenant_id = $1${pf} AND f.version = 1 AND f.capture_method IN ('export','pdf_text','ocr','api')`, params);
    const [leak] = await this.ds.query(
      `SELECT COUNT(*)::int AS signed, COUNT(*) FILTER (WHERE (edited_check->>'ok') = 'false' OR jsonb_array_length(COALESCE(gate_report->'errors','[]'::jsonb)) > 0)::int AS leaked
         FROM report_run r WHERE r.tenant_id = $1 AND r.status = 'signed'${period ? ' AND r.period = $2' : ''}`, params);
    const times = await this.ds.query(
      `SELECT r.run_id, r.period, EXTRACT(EPOCH FROM (r.locked_at - LEAST(COALESCE(sf.first_file, r.created_at), COALESCE(ff.first_fact, r.created_at)))) / 3600 AS hours
         FROM report_run r
         LEFT JOIN LATERAL (SELECT MIN(created_at) AS first_file FROM source_file s WHERE s.tenant_id = r.tenant_id AND s.period = r.period) sf ON true
         LEFT JOIN LATERAL (SELECT MIN(created_at) AS first_fact FROM fact_indicator x WHERE x.tenant_id = r.tenant_id AND x.period = r.period) ff ON true
        WHERE r.tenant_id = $1 AND r.locked_at IS NOT NULL AND r.status <> 'cancelled'${period ? ' AND r.period = $2' : ''}`, params);
    const [conf] = await this.ds.query(`SELECT AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at)) / 60)::float8 AS minutes, COUNT(*)::int AS n FROM fact_indicator f WHERE f.tenant_id = $1${pf} AND f.confirmed_at IS NOT NULL AND f.capture_method IN ('export','pdf_text','ocr')`, params);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const hours = times.length ? Math.round((times.reduce((s: number, t: any) => s + Number(t.hours), 0) / times.length) * 10) / 10 : null;
    return {
      period: period ?? null,
      kpis: { ty_le_bac_1_3: pct(cur.high, cur.n), slot_tu_dien: pct(slot.auto, slot.n), so_boc_khong_can_sua: pct(ext.n - ext.corrected, ext.n), loi_doi_soat_lot_ban_ky: leak.leaked, thoi_gian_tong_hop_gio: hours,
        ty_le_bac_4_5: cur.n ? Math.round(((cur.n - cur.high) / cur.n) * 1000) / 10 : null, thoi_gian_xac_nhan_phut: conf?.minutes != null ? Math.round(conf.minutes * 10) / 10 : null },
      targets: { ty_le_bac_1_3: 60, slot_tu_dien: 80, so_boc_khong_can_sua: 95, loi_doi_soat_lot_ban_ky: 0, thoi_gian_tong_hop_gio: null, ty_le_bac_4_5: null, thoi_gian_xac_nhan_phut: null },
      samples: { chi_tieu_hien_hanh: cur.n, slot_co_so: slot.n, so_boc_tu_dong: ext.n, ky_da_ky: leak.signed, ky_da_chot: times.length },
    };
  }

  /** Dãy kỳ cùng loại để vẽ xu hướng: 12 tháng / 8 quý / 4 năm gần nhất tính từ kỳ chọn. */
  periodSeries(code: string, n?: number): string[] {
    const p = parsePeriod(code);
    const out: string[] = [];
    if (p.type === 'month') { let y = p.year, m = Number(code.split('-M')[1]); for (let i = 0; i < (n ?? 12); i++) { out.unshift(`${y}-M${String(m).padStart(2, '0')}`); m--; if (m === 0) { m = 12; y--; } } }
    else if (p.type === 'quarter') { let y = p.year, q = Number(code.split('-Q')[1]); for (let i = 0; i < (n ?? 8); i++) { out.unshift(`${y}-Q${q}`); q--; if (q === 0) { q = 4; y--; } } }
    else { const tag = code.split('-')[1]; for (let i = 0; i < (n ?? 4); i++) out.unshift(`${p.year - i}-${tag}`); }
    return out;
  }
}

@ApiTags('Dashboard')
@Controller('admin/dashboard')
@UseGuards(AdminGuard, RolesGuard)
@Roles(...READER_ROLES)
@ApiBearerAuth()
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Bảng điều hành lãnh đạo cho một kỳ' })
  overview(@Request() req, @Query('period') period?: string) { return this.service.overview(tenantOf(req), period || undefined); }

  @Get('project-kpis')
  @ApiOperation({ summary: '5 KPI dự án đo từ dữ liệu kho (period trống = toàn bộ)' })
  projectKpis(@Request() req, @Query('period') period?: string) { return this.service.projectKpis(tenantOf(req), period || undefined); }

  @Get('trends')
  @ApiOperation({ summary: 'Xu hướng chỉ tiêu qua các kỳ: indicators=a,b&period=2026-M09 (tự lập dãy) hoặc periods=…' })
  trends(@Request() req, @Query('indicators') indicators = '', @Query('period') period?: string, @Query('periods') periods?: string, @Query('n') n?: string) {
    const ids = indicators.split(',').map((s) => s.trim()).filter(Boolean);
    const list = periods ? periods.split(',').map((s) => s.trim()).filter(Boolean) : period ? this.service.periodSeries(period, Number(n) || undefined) : [];
    return this.service.trends(tenantOf(req), ids, list);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ReportRun, ReportSpec]), FactsModule, CatalogModule, KpiModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
