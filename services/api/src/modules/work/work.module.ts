import { Controller, Get, Injectable, Module, Param, ParseIntPipe, Request, UseGuards } from '@nestjs/common';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ReportRun } from '../reports/report-run.entity';
import { ReportSpec } from '../catalog/report-spec.entity';
import { Department } from '../departments/department.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { QualityGateService } from '../facts/quality-gate.service';
import { businessDaysFrom } from '../facts/facts.service';
import { FactsModule } from '../facts/facts.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { READER_ROLES, MANAGER_ROLES } from '../../common/roles';
import { tenantOf } from '../../common/tenant';
import { parsePeriod } from '../../common/period';

/**
 * GĐ B — "mở app thấy đúng việc của mình kỳ này":
 *  - GET /admin/me/work: gói việc theo vai (chuyên viên, Data Owner, Văn phòng, Chủ tịch, HĐND) + trang chủ nên mở.
 *  - GET /admin/report-runs/:id/progress-by-dept: bảng tiến độ theo bộ phận cho Văn phòng (slot đủ/tổng, số chờ, cách ly, file, lần nhắc).
 *  - GET /public/demo/accounts: danh sách tài khoản demo cho trang đăng nhập (chỉ khi DEMO_MODE=1).
 */
@Injectable()
export class WorkService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(ReportRun) private runs: Repository<ReportRun>,
    @InjectRepository(ReportSpec) private specs: Repository<ReportSpec>,
    @InjectRepository(Department) private depts: Repository<Department>,
    @InjectRepository(AdminUser) private admins: Repository<AdminUser>,
    private gate: QualityGateService,
  ) {}

  /** Trang chủ theo vai: Văn phòng → /dashboard, Chủ tịch → /sign, HĐND → /read, Data Owner → /approve, chuyên viên → /my. */
  static homeFor(role: string, isDataOwner: boolean): string {
    if (role === 'super_admin' || role === 'commune_admin') return '/dashboard';
    if (role === 'leader') return '/sign';
    if (role === 'council') return '/read';
    if (role === 'department_staff') return isDataOwner ? '/approve' : '/my';
    return '/dashboard';
  }

  private daysLeft(cutoff: string) { return Math.ceil((new Date(cutoff).getTime() - Date.now()) / 86_400_000); }

  async progressByDept(tenantId: string, runId: number) {
    const run = await this.runs.findOne({ where: { run_id: runId, tenant_id: tenantId } });
    if (!run) return null;
    const exceptions = (run.gate_report as any)?.exceptions ?? {};
    const g = await this.gate.evaluatePeriod(tenantId, run.period, run.spec_id, { cutoffDate: run.cutoff_date, exceptions });
    const depts = await this.depts.find({ where: { is_active: true }, order: { sort_order: 'ASC' } });
    const heads = new Map((await this.admins.find({ where: { tenant_id: tenantId, is_active: true } })).map((a) => [a.id, a]));
    const inds: Array<{ indicator_id: string; owner_dept: string | null }> = await this.ds.query('SELECT indicator_id, owner_dept FROM dim_indicator');
    const ownerOf = new Map(inds.map((i) => [i.indicator_id, i.owner_dept]));
    const quarantined: Array<{ indicator_id: string; n: number }> = await this.ds.query(`SELECT indicator_id, COUNT(*)::int AS n FROM fact_indicator WHERE tenant_id = $1 AND period = $2 AND status = 'quarantined' GROUP BY indicator_id`, [tenantId, run.period]);
    const qByDept = new Map<string, number>();
    for (const q of quarantined) { const d = ownerOf.get(q.indicator_id); if (d) qByDept.set(d, (qByDept.get(d) ?? 0) + q.n); }
    const files: Array<{ department: string | null; n: number; last: string | null }> = await this.ds.query(`SELECT department, COUNT(*)::int AS n, MAX(created_at)::text AS last FROM source_file WHERE tenant_id = $1 AND period = $2 GROUP BY department`, [tenantId, run.period]);
    const fByDept = new Map(files.map((f) => [f.department ?? '', f]));
    const reminds: Array<{ department: string | null; n: number; last: string | null }> = await this.ds.query(
      `SELECT u.department, COUNT(*)::int AS n, MAX(m.created_at)::text AS last FROM chat_message m JOIN admin_users u ON u.id = m.admin_id
        WHERE m.tenant_id = $1 AND m.direction = 'out' AND m.reference_type = 'report_run' AND m.reference_id = $2 GROUP BY u.department`, [tenantId, String(run.run_id)]);
    const rByDept = new Map(reminds.map((r) => [r.department ?? '', r]));
    const errByDept = new Map<string, number>();
    for (const e of g.errors) if (e.owner_dept) errByDept.set(e.owner_dept, (errByDept.get(e.owner_dept) ?? 0) + 1);

    const rows = depts.map((d) => {
      const slots = g.slots.filter((s) => (s.owner_dept ?? null) === d.key && s.slot_type !== 'narrative' && s.slot_type !== 'next_tasks' && s.slot_type !== 'event_list');
      const seen = new Set<string>();
      const counts = { total: 0, approved: 0, confirmed: 0, extracted: 0, missing: 0 };
      const missing: string[] = []; const waiting: string[] = [];
      for (const s of g.slots) for (const i of s.indicators) {
        if ((ownerOf.get(i.id) ?? s.owner_dept) !== d.key || seen.has(i.id)) continue;
        seen.add(i.id); counts.total++;
        const st = i.fact?.status;
        if (!i.fact) { counts.missing++; missing.push(i.name ?? i.id); }
        else if (st === 'approved' || st === 'locked') counts.approved++;
        else if (st === 'confirmed') { counts.confirmed++; waiting.push(i.name ?? i.id); }
        else { counts.extracted++; waiting.push(i.name ?? i.id); }
      }
      const head = d.head_admin_id ? heads.get(d.head_admin_id) : null;
      const f = fByDept.get(d.key); const r = rByDept.get(d.key);
      const done = counts.total > 0 && counts.approved === counts.total;
      return { key: d.key, name: d.name, head: head ? { id: head.id, full_name: head.full_name } : null,
        slots_total: slots.length, slots_complete: slots.filter((s) => s.complete).length, indicators: counts, missing_names: missing.slice(0, 8), waiting_names: waiting.slice(0, 8),
        quarantined: qByDept.get(d.key) ?? 0, errors: errByDept.get(d.key) ?? 0, files: f?.n ?? 0, last_file_at: f?.last ?? null, reminds: r?.n ?? 0, last_remind_at: r?.last ?? null,
        state: counts.total === 0 ? 'none' : done ? 'done' : counts.missing === counts.total ? 'not_started' : 'in_progress' };
    }).filter((d) => d.indicators.total > 0);
    const p = parsePeriod(run.period);
    return { run_id: run.run_id, period: run.period, period_label: p.label, status: run.status, cutoff_date: run.cutoff_date, days_left: this.daysLeft(run.cutoff_date), gate: { ok: g.ok, errors: g.errors.length, warnings: g.warnings.length },
      totals: { depts: rows.length, done: rows.filter((r) => r.state === 'done').length, slots_total: g.slots.length, slots_complete: g.slots.filter((s) => s.complete).length }, departments: rows };
  }

  async myWork(user: { id: number; role: string; department: string | null; full_name?: string }, tenantId: string) {
    const depts = await this.depts.find({ where: { is_active: true }, order: { sort_order: 'ASC' } });
    const myDept = user.department ? depts.find((d) => d.key === user.department) ?? null : null;
    const isDataOwner = !!myDept && myDept.head_admin_id === user.id;
    const specMap = new Map((await this.specs.find()).map((s) => [s.id, s]));
    const all = await this.runs.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' }, take: 50 });
    const runOut = (r: ReportRun) => ({ run_id: r.run_id, period: r.period, period_label: parsePeriod(r.period).label, status: r.status, cutoff_date: r.cutoff_date, days_left: this.daysLeft(r.cutoff_date), spec_id: r.spec_id, spec_title: specMap.get(r.spec_id)?.title ?? null, signed_number: r.signed_number ?? null, signed_date: r.signed_date ?? null, locked_at: r.locked_at ?? null, output_file: !!r.output_file });
    const open = all.filter((r) => r.status === 'collecting');
    const out: any = { me: { id: user.id, full_name: user.full_name, role: user.role, department: user.department, department_name: myDept?.name ?? null, is_data_owner: isDataOwner, home: WorkService.homeFor(user.role, isDataOwner) },
      open_runs: open.map(runOut), runs: all.filter((r) => r.status !== 'cancelled').slice(0, 12).map(runOut) };
    // Việc của tôi (mọi vai)
    const t = (await this.ds.query(`SELECT count(*) FILTER (WHERE status IN ('new','in_progress'))::int AS open, count(*) FILTER (WHERE status IN ('new','in_progress') AND due_at < now())::int AS overdue,
        count(*) FILTER (WHERE status IN ('new','in_progress') AND due_at >= now() AND due_at < now() + interval '3 days')::int AS due_soon FROM tasks WHERE assignee_id = $1`, [user.id]))[0];
    const taskRows = await this.ds.query(`SELECT id, code, title, due_at::text AS due_at, priority, status, source_type FROM tasks WHERE assignee_id = $1 AND status IN ('new','in_progress') ORDER BY due_at ASC NULLS LAST LIMIT 6`, [user.id]);
    out.tasks = { open: t?.open ?? 0, overdue: t?.overdue ?? 0, due_soon: t?.due_soon ?? 0, items: taskRows };

    const isManager = (MANAGER_ROLES as readonly string[]).includes(user.role);
    if (user.role === 'department_staff' || isManager || user.role === 'leader') {
      // Chỉ tiêu của phòng tôi (chuyên viên/Data Owner) hoặc toàn đơn vị (Văn phòng, lãnh đạo) trong từng kỳ đang mở
      const inds: Array<{ indicator_id: string; owner_dept: string | null; name: string; unit: string }> = await this.ds.query('SELECT indicator_id, owner_dept, name, unit FROM dim_indicator WHERE is_active');
      const ownerOf = new Map(inds.map((i) => [i.indicator_id, i.owner_dept]));
      out.periods = [];
      for (const r of open) {
        const g = await this.gate.evaluatePeriod(tenantId, r.period, r.spec_id, { cutoffDate: r.cutoff_date, exceptions: (r.gate_report as any)?.exceptions ?? {} });
        const seen = new Set<string>(); const items: any[] = [];
        for (const s of g.slots) for (const i of s.indicators) {
          const owner = ownerOf.get(i.id) ?? s.owner_dept ?? null;
          if (user.role === 'department_staff' && owner !== user.department) continue;
          if (seen.has(i.id)) continue; seen.add(i.id);
          items.push({ id: i.id, name: i.name, unit: i.unit, owner_dept: owner, slot: s.slot_code, section: s.section, slot_title: s.title, required: s.required, fact: i.fact ? { id: i.fact.id, status: i.fact.status, value: i.fact.value, as_of_date: i.fact.as_of_date, capture_method: i.fact.capture_method, version: (i.fact as any).version ?? null } : null });
        }
        const myErrors = g.errors.filter((e) => user.role !== 'department_staff' || e.owner_dept === user.department);
        const counts = { total: items.length, missing: items.filter((x) => !x.fact).length, extracted: items.filter((x) => x.fact?.status === 'extracted').length, confirmed: items.filter((x) => x.fact?.status === 'confirmed').length, approved: items.filter((x) => x.fact && ['approved', 'locked'].includes(x.fact.status)).length };
        out.periods.push({ ...runOut(r), counts, items, errors: myErrors.slice(0, 20), gate_ok: g.ok, slots_total: g.slots.length, slots_complete: g.slots.filter((s) => s.complete).length });
      }
      const qrows = await this.ds.query(`SELECT f.id, f.indicator_id, i.name, i.owner_dept, f.period, f.value::float8 AS value, f.as_of_date::text AS as_of_date, f.capture_method, f.note, f.created_at::text AS created_at FROM fact_indicator f JOIN dim_indicator i ON i.indicator_id = f.indicator_id WHERE f.tenant_id = $1 AND f.status = 'quarantined' ORDER BY f.created_at DESC LIMIT 50`, [tenantId]);
      out.quarantine = qrows.filter((q: any) => user.role !== 'department_staff' || q.owner_dept === user.department).map((q: any) => { const dl = businessDaysFrom(new Date(q.created_at), 2); return { ...q, deadline: dl.toISOString().slice(0, 10), overdue: Date.now() > dl.getTime() }; });
      // Chờ tôi duyệt (Data Owner) / chờ duyệt toàn đơn vị (Văn phòng, lãnh đạo)
      if (isDataOwner || isManager || user.role === 'leader') {
        const wrows = await this.ds.query(`SELECT f.id, f.indicator_id, i.name, i.unit, i.value_type, i.owner_dept, f.period, f.value::float8 AS value, f.as_of_date::text AS as_of_date, f.capture_method, f.confidence::float8 AS confidence, f.source_ref, f.version, f.confirmed_at::text AS confirmed_at
          FROM fact_indicator f JOIN dim_indicator i ON i.indicator_id = f.indicator_id WHERE f.tenant_id = $1 AND f.status = 'confirmed' AND f.breakdown_key = '' ORDER BY f.period DESC, i.owner_dept, i.indicator_id`, [tenantId]);
        out.awaiting_approval = wrows.filter((w: any) => isManager || user.role === 'leader' || w.owner_dept === user.department);
      }
    }
    if (isManager) out.progress = open.length ? await this.progressByDept(tenantId, open[0].run_id) : null;
    if (user.role === 'leader' || isManager) {
      out.to_sign = all.filter((r) => r.status === 'submitted').map(runOut);
      out.drafted = all.filter((r) => ['locked', 'drafted'].includes(r.status)).map(runOut);
    }
    out.signed = all.filter((r) => r.status === 'signed').slice(0, 6).map(runOut);
    if (user.role === 'council') out.readable = all.filter((r) => ['locked', 'drafted', 'submitted', 'signed'].includes(r.status)).map(runOut);
    return out;
  }

  /** Tài khoản demo cho trang đăng nhập — đọc từ config/demo/<bộ>/accounts.yaml khi DEMO_MODE=1 (không đọc CSDL, không lộ hash). */
  demoAccounts() {
    if (process.env.DEMO_MODE !== '1') return { enabled: false, accounts: [] };
    const cfg = process.env.CONFIG_DIR || path.resolve(process.cwd(), '..', '..', 'config');
    const file = process.env.DEMO_ACCOUNTS_FILE || path.join(cfg, 'demo', process.env.DEMO_SET || 'dien-ban-bac', 'accounts.yaml');
    try {
      const doc: any = yaml.load(fs.readFileSync(file, 'utf8'));
      const accounts = (doc?.accounts ?? []).filter((a: any) => a.show_on_login !== false).map((a: any) => ({ email: a.email, full_name: a.full_name, title: a.title ?? null, role: a.role, department: a.department ?? null, home: WorkService.homeFor(a.role, !!a.head_of) }));
      return { enabled: true, unit: doc?.unit ?? null, password: doc?.password ?? null, accounts };
    } catch { return { enabled: true, accounts: [], note: `Không đọc được ${file}` }; }
  }
}

@ApiTags('Work')
@Controller('admin')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class WorkController {
  constructor(private service: WorkService) {}

  @Get('me/work')
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Việc của tôi kỳ này theo vai + trang chủ nên mở' })
  myWork(@Request() req) { return this.service.myWork(req.user, tenantOf(req)); }

  @Get('report-runs/:id/progress-by-dept')
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Bảng tiến độ theo bộ phận của một kỳ (Văn phòng)' })
  progress(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.service.progressByDept(tenantOf(req), id); }
}

@ApiTags('Work')
@Controller('public/demo')
export class DemoController {
  constructor(private service: WorkService) {}
  @Get('accounts')
  @ApiOperation({ summary: 'Tài khoản demo cho trang đăng nhập (DEMO_MODE=1)' })
  accounts() { return this.service.demoAccounts(); }
}

@Module({
  imports: [TypeOrmModule.forFeature([ReportRun, ReportSpec, Department, AdminUser]), FactsModule, CatalogModule],
  controllers: [WorkController, DemoController],
  providers: [WorkService],
  exports: [WorkService],
})
export class WorkModule {}
