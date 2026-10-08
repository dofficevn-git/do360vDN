import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { KpiCriterion, KpiScore } from './kpi.entity';
import { Employee } from '../employees/employee.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { Actor, FactsService } from '../facts/facts.service';
import { CatalogService } from '../catalog/catalog.service';
import { evalExpr } from '../../common/expr';
import { parsePeriod } from '../../common/period';
import { MANAGER_ROLES } from '../../common/roles';

const OVERSEERS = [...MANAGER_ROLES, 'leader'] as readonly string[];

/** Biến nguồn theo cán bộ trong kỳ — giao diện dữ liệu tối thiểu với module KPI. */
export interface KpiInputs {
  task_total: number; task_done: number; task_on_time: number; task_overdue: number;
  vb_total: number; vb_done: number; vb_on_time: number;
  so_nop: number; so_bi_tra: number; so_dat: number;
  task_ids: number[]; doc_ids: number[]; fact_ids: string[];
}

/**
 * D6 — giao diện dữ liệu KPI hai chiều:
 *  ra:  cán bộ (dim_employee), việc (tasks) và văn bản được phân công theo kỳ → module KPI;
 *  vào: điểm đã duyệt từ module KPI (importScores) hoặc điểm DO360 tự tính đề xuất (compute) → kpi_score;
 *  báo cáo KPI: publish() đẩy 3 chỉ tiêu tổng hợp vào kho (capture api) để Report Spec kpi_dinh_ky dùng cùng bộ sinh.
 */
@Injectable()
export class KpiService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    @InjectRepository(KpiCriterion) private criteria: Repository<KpiCriterion>,
    @InjectRepository(KpiScore) private scores: Repository<KpiScore>,
    @InjectRepository(Employee) private employees: Repository<Employee>,
    @InjectRepository(AdminUser) private admins: Repository<AdminUser>,
    @InjectDataSource() private ds: DataSource,
    private facts: FactsService,
    private catalog: CatalogService,
  ) {}

  async onApplicationBootstrap() {
    try { if ((await this.criteria.count()) === 0) await this.reload(); } catch (err) { this.logger.warn(`Nạp tiêu chí KPI: ${err}`); }
  }

  // ── Tiêu chí (cấu hình) ──────────────────────────────────────────────────

  private configDir() { return path.join(process.env.CONFIG_DIR || path.resolve(process.cwd(), '..', '..', 'config'), 'kpi'); }

  async reload() {
    const dir = this.configDir();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : [];
    const seen = new Set<string>(); let upserted = 0;
    for (const f of files) {
      const doc: any = yaml.load(fs.readFileSync(path.join(dir, f), 'utf-8'));
      for (const c of doc?.criteria ?? []) {
        if (!c?.id || !c?.formula) throw new BadRequestException(`${f}: tiêu chí thiếu id/formula`);
        const probe = evalExpr(String(c.formula), {});
        if (probe.error) throw new BadRequestException(`${f}: công thức "${c.id}" lỗi: ${probe.error}`);
        await this.criteria.save(this.criteria.create({ criterion_id: String(c.id), name: String(c.name ?? c.id), formula: String(c.formula), weight: String(c.weight ?? 1), source: String(c.source ?? 'task'),
          unit: String(c.unit ?? '%'), max_score: String(c.max_score ?? 100), regulation_ref: c.regulation_ref ?? doc?.regulation_ref ?? null, description: c.description ?? null, is_active: c.is_active ?? true, version: Number(doc?.version ?? 1) }));
        seen.add(String(c.id)); upserted++;
      }
    }
    const all = await this.criteria.find();
    for (const c of all) if (!seen.has(c.criterion_id) && c.is_active) await this.criteria.update(c.criterion_id, { is_active: false });
    return { files: files.length, criteria: upserted };
  }

  listCriteria() { return this.criteria.find({ order: { criterion_id: 'ASC' } }); }

  // ── Cán bộ ───────────────────────────────────────────────────────────────

  listEmployees(tenantId: string) { return this.employees.find({ where: { tenant_id: tenantId }, order: { dept: 'ASC', name: 'ASC' } }); }

  async upsertEmployee(actor: Actor, dto: { employee_code: string; name: string; dept?: string | null; position?: string | null; status?: string; admin_user_id?: number | null }) {
    this.assertOverseer(actor, 'sửa danh sách cán bộ');
    if (!dto.employee_code?.trim() || !dto.name?.trim()) throw new BadRequestException('Cần employee_code và name.');
    const existing = await this.employees.findOne({ where: { tenant_id: actor.tenant_id, employee_code: dto.employee_code.trim() } });
    const data = { tenant_id: actor.tenant_id, employee_code: dto.employee_code.trim(), name: dto.name.trim(), dept: dto.dept ?? null, position: dto.position ?? null, status: dto.status ?? 'active', admin_user_id: dto.admin_user_id ?? null };
    if (existing) { await this.employees.update(existing.employee_id, data); return this.employees.findOne({ where: { employee_id: existing.employee_id } }); }
    return this.employees.save(this.employees.create(data));
  }

  /** Lập danh sách cán bộ từ tài khoản của đơn vị (email công vụ = employee_code). */
  async syncFromAccounts(actor: Actor) {
    this.assertOverseer(actor, 'đồng bộ cán bộ');
    const accounts = await this.admins.find({ where: { tenant_id: actor.tenant_id, is_active: true } });
    let created = 0, updated = 0;
    for (const a of accounts) {
      if (a.role === 'tdp_head') continue;
      const code = (a.email ?? `acc-${a.id}`).toLowerCase();
      const existing = (await this.employees.findOne({ where: { tenant_id: actor.tenant_id, admin_user_id: a.id } })) ?? (await this.employees.findOne({ where: { tenant_id: actor.tenant_id, employee_code: code } }));
      if (existing) { await this.employees.update(existing.employee_id, { name: a.full_name, dept: a.department ?? existing.dept, admin_user_id: a.id, status: 'active' }); updated++; }
      else { await this.employees.save(this.employees.create({ tenant_id: actor.tenant_id, employee_code: code, name: a.full_name, dept: a.department ?? null, position: a.role, status: 'active', admin_user_id: a.id })); created++; }
    }
    return { created, updated };
  }

  /** Dữ liệu việc theo cán bộ trong kỳ — cấp cho module KPI (bảng `task` tối thiểu của thiết kế). */
  async exportTasks(tenantId: string, period: string) {
    const p = parsePeriod(period);
    return this.ds.query(
      `SELECT t.id AS task_id, t.code, COALESCE(t.source_type, 'do360') AS source, t.source_id AS source_ref, e.employee_id, e.employee_code AS assignee, a2.email AS assigned_by,
              t.due_at::date::text AS due_date, t.completed_at::date::text AS done_date, t.status, t.title
         FROM tasks t JOIN dim_employee e ON e.admin_user_id = t.assignee_id AND e.tenant_id = t.tenant_id
         LEFT JOIN admin_users a2 ON a2.id = t.assigner_id
        WHERE t.tenant_id = $1 AND COALESCE(t.due_at, t.created_at)::date BETWEEN $2 AND $3
        ORDER BY e.employee_code, t.due_at NULLS LAST`, [tenantId, p.start, p.end]);
  }

  // ── Tính điểm đề xuất ────────────────────────────────────────────────────

  async inputsFor(tenantId: string, period: string, emp: Employee): Promise<KpiInputs> {
    const p = parsePeriod(period);
    const out: KpiInputs = { task_total: 0, task_done: 0, task_on_time: 0, task_overdue: 0, vb_total: 0, vb_done: 0, vb_on_time: 0, so_nop: 0, so_bi_tra: 0, so_dat: 0, task_ids: [], doc_ids: [], fact_ids: [] };
    if (emp.admin_user_id) {
      const tasks = await this.ds.query(
        `SELECT id, status, due_at, completed_at FROM tasks WHERE tenant_id = $1 AND assignee_id = $2 AND status <> 'cancelled' AND COALESCE(due_at, created_at)::date BETWEEN $3 AND $4`, [tenantId, emp.admin_user_id, p.start, p.end]);
      for (const t of tasks) {
        out.task_total++; out.task_ids.push(t.id);
        const done = t.status === 'done';
        if (done) out.task_done++;
        const late = t.due_at && ((done && t.completed_at && new Date(t.completed_at) > new Date(t.due_at)) || (!done && new Date(t.due_at) < new Date()));
        if (done && !late) out.task_on_time++;
        if (late) out.task_overdue++;
      }
      const facts = await this.ds.query(`SELECT id, status FROM fact_indicator WHERE tenant_id = $1 AND created_by = $2 AND period = $3`, [tenantId, emp.admin_user_id, period]);
      for (const f of facts) { out.so_nop++; out.fact_ids.push(String(f.id)); if (['rejected', 'quarantined'].includes(f.status)) out.so_bi_tra++; }
      out.so_dat = out.so_nop - out.so_bi_tra;
    }
    const docs = await this.ds.query(
      `SELECT id, han_xu_ly, ngay_hoan_thanh FROM qlvb_document WHERE tenant_id = $1 AND direction = 'den' AND lower(nguoi_xu_ly_email) = lower($2) AND COALESCE(han_xu_ly, ngay) BETWEEN $3 AND $4`, [tenantId, emp.employee_code, p.start, p.end]);
    for (const d of docs) {
      out.vb_total++; out.doc_ids.push(d.id);
      if (d.ngay_hoan_thanh) { out.vb_done++; if (!d.han_xu_ly || d.ngay_hoan_thanh <= d.han_xu_ly) out.vb_on_time++; }
    }
    return out;
  }

  async compute(actor: Actor, period: string) {
    this.assertOverseer(actor, 'tính điểm KPI');
    parsePeriod(period);
    const crits = (await this.criteria.find({ where: { is_active: true } })).filter((c) => c.source !== 'manual');
    const emps = await this.employees.find({ where: { tenant_id: actor.tenant_id, status: 'active' } });
    let written = 0, keptApproved = 0, noData = 0;
    const now = new Date();
    for (const e of emps) {
      const inputs = await this.inputsFor(actor.tenant_id, period, e);
      const vars: Record<string, number> = { task_total: inputs.task_total, task_done: inputs.task_done, task_on_time: inputs.task_on_time, task_overdue: inputs.task_overdue, vb_total: inputs.vb_total, vb_done: inputs.vb_done, vb_on_time: inputs.vb_on_time, so_nop: inputs.so_nop, so_bi_tra: inputs.so_bi_tra, so_dat: inputs.so_dat };
      for (const c of crits) {
        const r = evalExpr(c.formula, vars);
        const existing = await this.scores.findOne({ where: { tenant_id: actor.tenant_id, employee_id: e.employee_id, period, criterion_id: c.criterion_id } });
        if (existing?.status === 'approved') { keptApproved++; continue; }
        if (r.value === null) { noData++; if (existing && existing.source === 'do360') await this.scores.update(existing.id, { value: null, score: null, computed_at: now, evidence_ref: { inputs: vars, note: r.error ?? 'thiếu dữ liệu' } }); continue; }
        const max = Number(c.max_score) || 100;
        const score = (Math.max(0, Math.min(max, r.value)) / max) * Number(c.weight);
        const evidence = { inputs: vars, task_ids: inputs.task_ids.slice(0, 100), doc_ids: inputs.doc_ids.slice(0, 100), fact_ids: inputs.fact_ids.slice(0, 100), formula: c.formula };
        if (existing) await this.scores.update(existing.id, { value: String(r.value), score: String(score), evidence_ref: evidence, computed_at: now, source: 'do360', status: existing.status === 'explained' ? 'explained' : 'proposed' });
        else await this.scores.save(this.scores.create({ tenant_id: actor.tenant_id, employee_id: e.employee_id, period, criterion_id: c.criterion_id, value: String(r.value), score: String(score), evidence_ref: evidence, status: 'proposed', source: 'do360', computed_at: now }));
        written++;
      }
    }
    this.logger.log(`[kpi compute] ${actor.tenant_id} ${period}: ${emps.length} cán bộ × ${crits.length} tiêu chí → ${written} điểm, giữ ${keptApproved} đã duyệt, ${noData} thiếu dữ liệu`);
    return { employees: emps.length, criteria: crits.length, written, kept_approved: keptApproved, no_data: noData };
  }

  /** Nhận điểm đã duyệt từ module KPI (hoặc điểm định tính lãnh đạo nhập). */
  async importScores(actor: Actor, rows: Array<{ employee_code: string; period: string; criterion_id: string; value?: number | null; score?: number | null; evidence_ref?: Record<string, unknown>; status?: string; source?: string }>) {
    this.assertOverseer(actor, 'nhận điểm KPI');
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException('Không có dòng nào.');
    let upserted = 0;
    for (const r of rows) {
      parsePeriod(r.period);
      const emp = await this.employees.findOne({ where: { tenant_id: actor.tenant_id, employee_code: r.employee_code } });
      if (!emp) throw new BadRequestException(`Không có cán bộ "${r.employee_code}" trong đơn vị.`);
      const crit = await this.criteria.findOne({ where: { criterion_id: r.criterion_id } });
      if (!crit) throw new BadRequestException(`Tiêu chí "${r.criterion_id}" chưa có trong cấu hình.`);
      const status = ['proposed', 'explained', 'approved'].includes(r.status ?? '') ? r.status! : 'approved';
      const score = r.score ?? (r.value !== null && r.value !== undefined ? (Math.max(0, Math.min(Number(crit.max_score), r.value)) / Number(crit.max_score)) * Number(crit.weight) : null);
      const data = { value: r.value === undefined || r.value === null ? null : String(r.value), score: score === null ? null : String(score), evidence_ref: r.evidence_ref ?? {}, status, source: r.source ?? 'kpi_module', computed_at: new Date(),
        approved_by: status === 'approved' ? actor.id : null, approved_at: status === 'approved' ? new Date() : null };
      const existing = await this.scores.findOne({ where: { tenant_id: actor.tenant_id, employee_id: emp.employee_id, period: r.period, criterion_id: r.criterion_id } });
      if (existing) await this.scores.update(existing.id, data);
      else await this.scores.save(this.scores.create({ tenant_id: actor.tenant_id, employee_id: emp.employee_id, period: r.period, criterion_id: r.criterion_id, ...data }));
      upserted++;
    }
    return { upserted };
  }

  // ── Xem / giải trình / duyệt ─────────────────────────────────────────────

  private assertOverseer(actor: Actor, verb: string) {
    if (!OVERSEERS.includes(actor.role)) throw new ForbiddenException(`Chỉ lãnh đạo/Văn phòng được ${verb}.`);
  }

  async scoresFor(actor: Actor, period: string, employeeId?: number) {
    parsePeriod(period);
    let empFilter = '';
    const params: any[] = [actor.tenant_id, period];
    if (!OVERSEERS.includes(actor.role)) {
      const mine = await this.employees.findOne({ where: { tenant_id: actor.tenant_id, admin_user_id: actor.id } });
      if (!mine) return [];
      params.push(mine.employee_id); empFilter = ` AND s.employee_id = $${params.length}`;
    } else if (employeeId) { params.push(employeeId); empFilter = ` AND s.employee_id = $${params.length}`; }
    return this.ds.query(
      `SELECT s.id, s.employee_id, e.employee_code, e.name AS employee_name, e.dept, s.period, s.criterion_id, c.name AS criterion_name, c.weight::float8 AS weight, c.max_score::float8 AS max_score, c.unit,
              s.value::float8 AS value, s.score::float8 AS score, s.status, s.source, s.explanation, s.evidence_ref, s.approved_by, s.approved_at, s.computed_at
         FROM kpi_score s JOIN dim_employee e ON e.employee_id = s.employee_id JOIN kpi_criterion c ON c.criterion_id = s.criterion_id
        WHERE s.tenant_id = $1 AND s.period = $2${empFilter}
        ORDER BY e.dept NULLS LAST, e.name, s.criterion_id`, params);
  }

  async explain(actor: Actor, id: number, text: string) {
    const s = await this.scores.findOne({ where: { id, tenant_id: actor.tenant_id } });
    if (!s) throw new NotFoundException('Không tìm thấy điểm.');
    const emp = await this.employees.findOne({ where: { employee_id: s.employee_id } });
    if (emp?.admin_user_id !== actor.id && !OVERSEERS.includes(actor.role)) throw new ForbiddenException('Chỉ giải trình điểm của chính mình.');
    if (s.status === 'approved') throw new BadRequestException('Điểm đã duyệt.');
    if (!text?.trim()) throw new BadRequestException('Thiếu nội dung giải trình.');
    await this.scores.update(id, { status: 'explained', explanation: text.trim() });
    return this.scores.findOne({ where: { id } });
  }

  async approve(actor: Actor, ids: number[]) {
    this.assertOverseer(actor, 'duyệt điểm KPI');
    const rows = await this.scores.find({ where: { id: In(ids), tenant_id: actor.tenant_id } });
    if (rows.length !== ids.length) throw new NotFoundException('Có điểm không tồn tại.');
    for (const r of rows) await this.scores.update(r.id, { status: 'approved', approved_by: actor.id, approved_at: new Date() });
    return { approved: rows.length };
  }

  /** Tổng hợp kỳ: theo cán bộ, theo phòng và 3 số cấp đơn vị cho báo cáo KPI. */
  async summary(tenantId: string, period: string) {
    parsePeriod(period);
    const rows: any[] = await this.ds.query(
      `SELECT e.employee_id, e.employee_code, e.name, e.dept,
              COUNT(s.id)::int AS n, COUNT(s.id) FILTER (WHERE s.status = 'approved')::int AS n_approved,
              SUM(s.score)::float8 AS total, SUM(c.weight) FILTER (WHERE s.score IS NOT NULL)::float8 AS max_total,
              MAX((s.evidence_ref->'inputs'->>'task_total')::int) AS task_total, MAX((s.evidence_ref->'inputs'->>'task_on_time')::int) AS task_on_time
         FROM dim_employee e LEFT JOIN kpi_score s ON s.employee_id = e.employee_id AND s.period = $2 LEFT JOIN kpi_criterion c ON c.criterion_id = s.criterion_id
        WHERE e.tenant_id = $1 AND e.status = 'active'
        GROUP BY e.employee_id ORDER BY e.dept NULLS LAST, e.name`, [tenantId, period]);
    const employees = rows.map((r) => ({ ...r, pct: r.max_total ? Math.round((r.total / r.max_total) * 1000) / 10 : null }));
    const byDept: Record<string, { n: number; sum: number }> = {};
    for (const e of employees) if (e.pct !== null) { const k = e.dept ?? '—'; byDept[k] = byDept[k] ?? { n: 0, sum: 0 }; byDept[k].n++; byDept[k].sum += e.pct; }
    const scored = employees.filter((e) => e.pct !== null);
    const taskTotal = employees.reduce((a, e) => a + (e.task_total ?? 0), 0);
    const taskOnTime = employees.reduce((a, e) => a + (e.task_on_time ?? 0), 0);
    return {
      period, employees,
      departments: Object.entries(byDept).map(([dept, v]) => ({ dept, n: v.n, avg_pct: Math.round((v.sum / v.n) * 10) / 10 })),
      totals: { so_can_bo_danh_gia: scored.length, diem_trung_binh: scored.length ? Math.round((scored.reduce((a, e) => a + e.pct, 0) / scored.length) * 10) / 10 : null,
        ty_le_viec_dung_han: taskTotal ? Math.round((taskOnTime / taskTotal) * 1000) / 10 : null, approved_all: scored.length > 0 && scored.every((e) => e.n_approved === e.n) },
    };
  }

  /** Đẩy số tổng hợp KPI vào kho chỉ tiêu (capture 'api', nguồn kpi) để báo cáo KPI dùng cùng bộ sinh. */
  async publish(actor: Actor, period: string) {
    this.assertOverseer(actor, 'đẩy số KPI vào kho');
    const s = await this.summary(actor.tenant_id, period);
    if (!s.totals.so_can_bo_danh_gia) throw new BadRequestException('Chưa có điểm KPI nào trong kỳ — tính điểm trước.');
    const asOf = parsePeriod(period).end;
    const records = [
      { indicator_id: 'kpi.so_can_bo_danh_gia', value: s.totals.so_can_bo_danh_gia },
      { indicator_id: 'kpi.diem_trung_binh', value: s.totals.diem_trung_binh },
      { indicator_id: 'kpi.ty_le_viec_dung_han', value: s.totals.ty_le_viec_dung_han },
    ].filter((r) => r.value !== null && r.value !== undefined) as Array<{ indicator_id: string; value: number }>;
    for (const r of records) await this.catalog.getIndicatorOrFail(r.indicator_id);
    return this.facts.ingest(actor, records.map((r) => ({ ...r, period, as_of_date: asOf, capture_method: 'api' as const, confidence: 1, source_ref: { system: 'kpi', computed_at: new Date().toISOString(), approved_all: s.totals.approved_all } })), 'api');
  }
}
