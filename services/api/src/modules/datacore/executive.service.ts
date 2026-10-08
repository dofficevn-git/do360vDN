import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DictionaryService, DashboardCard } from './dictionary.service';
import { DataMapService } from './datamap.service';
import { ObjectsService } from './objects.service';
import { PlansService } from '../plans/plans.module';
import { FactsService, Actor } from '../facts/facts.service';
import { parsePeriod, previousComparable } from '../../common/period';

/**
 * Bảng điều hành tổng hợp theo Blueprint mục 50–51, 61: "Việc cần xử lý" trước, rồi từng lĩnh vực với thẻ chỉ tiêu
 * Mục tiêu – Thực hiện – Rủi ro – Hành động (kế hoạch, thực hiện, %, xu hướng, ngày chốt, trạng thái, nguồn, phòng chủ, việc liên quan).
 * Chỉ dùng số đã xác nhận/duyệt/chốt. Ngoài ra: tìm kiếm toàn hệ thống và chỉ tiêu DERIVED từ sổ giao việc.
 */
@Injectable()
export class ExecutiveService {
  constructor(@InjectDataSource() private ds: DataSource, private dict: DictionaryService, private datamap: DataMapService, private objects: ObjectsService, private plans: PlansService, private facts: FactsService) {}

  private async factsOf(tenantId: string, period: string) {
    const rows: any[] = await this.ds.query(
      `SELECT f.id, f.indicator_id, f.value::float8 AS value, f.status, f.capture_method, f.as_of_date::text AS as_of_date, f.source_ref, f.version
         FROM (SELECT DISTINCT ON (indicator_id) * FROM fact_indicator WHERE tenant_id = $1 AND period = $2 AND breakdown_key = '' AND status IN ('confirmed','approved','locked') ORDER BY indicator_id, version DESC) f`, [tenantId, period]);
    return new Map(rows.map((r) => [r.indicator_id, r]));
  }

  async executive(tenantId: string, role: string, period?: string) {
    if (!period) { const r = await this.ds.query(`SELECT period FROM report_run WHERE tenant_id = $1 AND status <> 'cancelled' ORDER BY (status = 'collecting') DESC, created_at DESC LIMIT 1`, [tenantId]); period = r[0]?.period; }
    if (!period) return { period: null, todo: null, domains: [] };
    const p = parsePeriod(period);
    const meta = new Map<string, any>((await this.ds.query(`SELECT indicator_id, name, unit, value_type, domain, owner_dept, aggregation FROM dim_indicator`)).map((i: any) => [i.indicator_id, i]));
    const depts: Record<string, string> = Object.fromEntries((await this.ds.query(`SELECT key, name FROM departments`)).map((d: any) => [d.key, d.name]));
    const cur = await this.factsOf(tenantId, period);
    const prevCode = previousComparable(period);
    const prev = prevCode ? await this.factsOf(tenantId, prevCode) : new Map();
    const plan = await this.plans.current(tenantId, p.year);
    const taskByInd: Record<string, number> = Object.fromEntries((await this.ds.query(`SELECT target_indicator_id AS id, COUNT(*)::int AS n FROM tasks WHERE tenant_id = $1 AND status IN ('new','in_progress') AND target_indicator_id IS NOT NULL GROUP BY 1`, [tenantId])).map((r: any) => [r.id, r.n]));
    const [lastUpd] = await this.ds.query(`SELECT MAX(created_at)::text AS last FROM fact_indicator WHERE tenant_id = $1`, [tenantId]);
    const health = await this.datamap.health(tenantId, period);
    const fmtMoney = (v: number) => v;
    const card = (c: DashboardCard) => {
      const m = meta.get(c.indicator); const f = cur.get(c.indicator); const pf = prev.get(c.indicator);
      const pl = c.plan ? plan[c.indicator] : null;
      const pair = c.pair_with ? cur.get(c.pair_with) : null;
      const value = f?.value ?? null;
      const pct = pl?.value ? Math.round((value / pl.value) * 1000) / 10 : pair && f?.value ? Math.round((pair.value / f.value) * 1000) / 10 : null;
      let status: 'dat' | 'theo_doi' | 'canh_bao' | 'thieu' | 'co_so' = value === null ? 'thieu' : 'co_so';
      if (value !== null && pl?.value) status = (c.lower_is_better ? value <= pl.value : pct! >= 100) ? 'dat' : pct! >= 70 ? 'theo_doi' : 'canh_bao';
      if (value !== null && c.bad_if === '>0' && value > 0) status = 'canh_bao';
      const trend = pf && pf.value ? Math.round(((value - pf.value) / pf.value) * 1000) / 10 : null;
      const sr = f?.source_ref ?? {};
      return { indicator: c.indicator, name: m?.name ?? c.indicator, unit: m?.unit ?? '', value_type: m?.value_type ?? 'integer', label: c.label ?? null, value: fmtMoney(value),
        pair: pair ? { indicator: c.pair_with, name: meta.get(c.pair_with!)?.name, value: pair.value } : null, plan: pl ? { value: pl.value, source_ref: pl.source_ref } : null, pct, trend, prev_label: prevCode ? parsePeriod(prevCode).label : null,
        as_of_date: f?.as_of_date ?? null, fact_status: f?.status ?? null, status, source: f ? { capture: f.capture_method, file_id: sr.file_id ?? null, rule: sr.rule ?? null, system: sr.system ?? null, cell: sr.sheet ? `${sr.sheet}!${sr.cell}` : null, page: sr.page ?? null, fact_id: f.id } : null,
        owner_dept: m?.owner_dept ?? null, owner_dept_name: depts[m?.owner_dept] ?? null, related_tasks: taskByInd[c.indicator] ?? 0, drill: c.drill ?? null, lower_is_better: !!c.lower_is_better, data_health: c.data_health ? health.overall : undefined,
        breakdown: c.breakdown?.map((b) => ({ indicator: b, name: meta.get(b)?.name ?? b, value: cur.get(b)?.value ?? null })) ?? null, funnel: c.funnel?.map((b) => ({ indicator: b, name: meta.get(b)?.name ?? b, value: cur.get(b)?.value ?? null })) ?? null };
    };
    const domains = [];
    for (const d of this.dict.dashboardDomains()) {
      if (d.roles && !d.roles.includes(role)) continue;
      const cards = (d.cards ?? []).map(card);
      const tabs = (d.tabs ?? []).map((t) => ({ key: t.key, name: t.name, cards: t.cards.map(card) }));
      const all = [...cards, ...tabs.flatMap((t) => t.cards)];
      const objs = d.objects ? await this.objects.alerts(tenantId, d.objects) : [];
      const objCount = d.objects ? (await this.ds.query(`SELECT COUNT(*)::int AS n FROM dim_object WHERE tenant_id = $1 AND object_type = $2 AND status = 'active'`, [tenantId, d.objects]))[0]?.n ?? 0 : null;
      domains.push({ key: d.key, name: d.name, cards, tabs, summary: { total: all.length, dat: all.filter((c) => c.status === 'dat').length, canh_bao: all.filter((c) => c.status === 'canh_bao').length, thieu: all.filter((c) => c.status === 'thieu').length },
        objects: d.objects ? { type: d.objects, count: objCount, alerts: objs } : null });
    }
    // Việc cần xử lý
    const overdue = await this.ds.query(`SELECT t.id, t.code, t.title, t.due_at::text AS due_at, a.full_name AS assignee, a.department FROM tasks t LEFT JOIN admin_users a ON a.id = t.assignee_id WHERE t.tenant_id = $1 AND t.status IN ('new','in_progress') AND t.due_at < now() ORDER BY t.due_at LIMIT 10`, [tenantId]);
    const missingMetric = health.metrics.find((m: any) => m.key === 'du');
    const projAlerts = await this.objects.alerts(tenantId, 'du_an');
    const map = await this.datamap.map(tenantId);
    const staleDatasets = map.sources.flatMap((s: any) => s.datasets.filter((d: any) => d.freshness === 'stale').map((d: any) => ({ code: d.code, name: d.name, source: s.name, age_days: d.age_days, owner: s.owner_name })));
    const [pend] = await this.ds.query(`SELECT COUNT(*) FILTER (WHERE status = 'extracted')::int AS extracted, COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed, COUNT(*) FILTER (WHERE status = 'quarantined')::int AS quarantined FROM (SELECT DISTINCT ON (indicator_id) status FROM fact_indicator WHERE tenant_id = $1 AND period = $2 AND breakdown_key = '' AND status NOT IN ('rejected') ORDER BY indicator_id, version DESC) f`, [tenantId, period]);
    const run = (await this.ds.query(`SELECT run_id, status, cutoff_date::text AS cutoff_date, signed_number FROM report_run WHERE tenant_id = $1 AND period = $2 AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1`, [tenantId, period]))[0] ?? null;
    const todo = { tasks_overdue: { count: overdue.length, items: overdue }, indicators_missing: { count: missingMetric?.missing ?? 0, items: (missingMetric?.issues ?? []).slice(0, 10) },
      projects_alert: { count: projAlerts.length, items: projAlerts.slice(0, 10) }, datasets_stale: { count: staleDatasets.length, items: staleDatasets.slice(0, 10) },
      facts_pending: { extracted: pend?.extracted ?? 0, confirmed: pend?.confirmed ?? 0, quarantined: pend?.quarantined ?? 0 } };
    return { period, period_label: p.label, run, last_updated: lastUpd?.last ?? null, data_health: { overall: health.overall, scores: health.scores }, todo, domains };
  }

  /** Tìm kiếm toàn hệ thống (Blueprint mục 57): đối tượng, chỉ tiêu, văn bản, nhiệm vụ, báo cáo — kết quả phân biệt Data / Document. */
  async search(tenantId: string, role: string, q: string) {
    const term = q.trim(); if (!term) return { q, groups: [] };
    const like = `%${term}%`; const norm = `%${DictionaryService.normalizeName(term)}%`;
    const objs = await this.ds.query(`SELECT uid, object_type, code, name, status FROM dim_object WHERE tenant_id = $1 AND status <> 'deleted' AND (name_norm LIKE $2 OR code ILIKE $3 OR master_id ILIKE $3) LIMIT 10`, [tenantId, norm, like]);
    const inds = await this.ds.query(`SELECT i.indicator_id, i.name, i.unit, i.value_type, f.period, f.value::float8 AS value, f.status, f.as_of_date::text AS as_of_date FROM dim_indicator i LEFT JOIN LATERAL (SELECT period, value, status, as_of_date FROM fact_indicator x WHERE x.tenant_id = $1 AND x.indicator_id = i.indicator_id AND x.breakdown_key = '' AND x.status IN ('confirmed','approved','locked') ORDER BY x.period DESC, x.version DESC LIMIT 1) f ON true WHERE i.is_active AND (unaccent(i.name) ILIKE unaccent($2) OR i.indicator_id ILIKE $2) LIMIT 10`, [tenantId, like]).catch(async () => this.ds.query(`SELECT i.indicator_id, i.name, i.unit, i.value_type, f.period, f.value::float8 AS value, f.status, f.as_of_date::text AS as_of_date FROM dim_indicator i LEFT JOIN LATERAL (SELECT period, value, status, as_of_date FROM fact_indicator x WHERE x.tenant_id = $1 AND x.indicator_id = i.indicator_id AND x.breakdown_key = '' AND x.status IN ('confirmed','approved','locked') ORDER BY x.period DESC, x.version DESC LIMIT 1) f ON true WHERE i.is_active AND (i.name ILIKE $2 OR i.indicator_id ILIKE $2) LIMIT 10`, [tenantId, like]));
    const docs = await this.ds.query(`SELECT id, so_ky_hieu, ngay::text AS ngay, loai, trich_yeu, direction FROM qlvb_document WHERE tenant_id = $1 AND (so_ky_hieu ILIKE $2 OR trich_yeu ILIKE $2) ORDER BY ngay DESC NULLS LAST LIMIT 10`, [tenantId, like]);
    const tasks = role === 'council' ? [] : await this.ds.query(`SELECT t.id, t.code, t.title, t.status, t.due_at::text AS due_at, a.full_name AS assignee FROM tasks t LEFT JOIN admin_users a ON a.id = t.assignee_id WHERE t.tenant_id = $1 AND (t.title ILIKE $2 OR t.code ILIKE $2) ORDER BY t.created_at DESC LIMIT 10`, [tenantId, like]);
    const runs = await this.ds.query(`SELECT run_id, period, status, signed_number FROM report_run WHERE tenant_id = $1 AND status <> 'cancelled' AND (signed_number ILIKE $2 OR period ILIKE $2) ${role === 'council' ? "AND status IN ('locked','drafted','submitted','signed')" : ''} LIMIT 10`, [tenantId, like]);
    const files = role === 'council' ? [] : await this.ds.query(`SELECT id, original_name, period, status FROM source_file WHERE tenant_id = $1 AND original_name ILIKE $2 ORDER BY created_at DESC LIMIT 10`, [tenantId, like]);
    const groups = [
      { key: 'objects', name: 'Đối tượng', kind: 'data', items: objs.map((o: any) => ({ title: `${o.code} · ${o.name}`, sub: this.dict.objectType(o.object_type)?.name ?? o.object_type, href: `/objects/${o.uid}` })) },
      { key: 'indicators', name: 'Chỉ tiêu', kind: 'data', items: inds.map((i: any) => ({ title: i.name, sub: i.value != null ? `${i.value.toLocaleString('vi-VN')} ${i.unit} · ${parsePeriod(i.period).label}` : 'chưa có số', href: `/facts?period=${i.period ?? ''}&indicator=${encodeURIComponent(i.indicator_id)}`, indicator_id: i.indicator_id, value: i.value, period: i.period })) },
      { key: 'documents', name: 'Văn bản', kind: 'document', items: docs.map((d: any) => ({ title: `${d.so_ky_hieu ?? ''} · ${d.loai ?? 'Văn bản'}`, sub: `${d.trich_yeu ?? ''} · ${d.ngay ? d.ngay.split('-').reverse().join('/') : ''}`, href: `/integrations?tab=qlvb` })) },
      { key: 'tasks', name: 'Nhiệm vụ', kind: 'data', items: tasks.map((t: any) => ({ title: t.title, sub: `${t.assignee ?? ''} · ${({ new: 'mới giao', in_progress: 'đang làm', done: 'đã xong', cancelled: 'đã huỷ' } as Record<string, string>)[t.status] ?? t.status}`, href: `/tasks` })) },
      { key: 'reports', name: 'Báo cáo', kind: 'document', items: runs.map((r: any) => ({ title: `Báo cáo ${parsePeriod(r.period).label}`, sub: r.signed_number ? `số ${r.signed_number}` : ({ collecting: 'đang thu số', locked: 'đã chốt', drafted: 'có bản nháp', submitted: 'đã trình ký' } as Record<string, string>)[r.status] ?? 'khác', href: `/report-runs/${r.run_id}/read` })) },
      { key: 'files', name: 'File nguồn', kind: 'document', items: files.map((f: any) => ({ title: f.original_name, sub: f.period ?? '', href: `/files?period=${f.period ?? ''}` })) },
    ].filter((g) => g.items.length);
    return { q, groups };
  }

  /** Chỉ tiêu DERIVED từ sổ giao việc: giao / hoàn thành / quá hạn trong kỳ → nộp vào kho (capture api, nguồn do360_tasks), vẫn qua xác nhận. */
  async deriveTaskIndicators(actor: Actor, period: string) {
    const p = parsePeriod(period);
    const [r] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE created_at::date BETWEEN $2 AND $3)::int AS giao,
              COUNT(*) FILTER (WHERE status = 'done' AND completed_at::date BETWEEN $2 AND $3)::int AS hoan_thanh,
              COUNT(*) FILTER (WHERE status IN ('new','in_progress') AND due_at < LEAST(now(), ($3::date + 1)::timestamptz))::int AS qua_han,
              array_agg(id) FILTER (WHERE created_at::date BETWEEN $2 AND $3) AS ids
         FROM tasks WHERE tenant_id = $1`, [actor.tenant_id, p.start, p.end]);
    const asOf = new Date() < new Date(p.end) ? new Date().toISOString().slice(0, 10) : p.end;
    const src: any = { system: 'do360_tasks', derived: true, task_ids: (r.ids ?? []).slice(0, 200), note: 'Dẫn xuất từ sổ giao việc DO360' };
    const records = [
      { indicator_id: 'chi_dao.nhiem_vu_giao', period, as_of_date: asOf, value: r.giao, capture_method: 'api' as const, source_ref: src },
      { indicator_id: 'chi_dao.nhiem_vu_hoan_thanh', period, as_of_date: asOf, value: r.hoan_thanh, capture_method: 'api' as const, source_ref: src },
      { indicator_id: 'chi_dao.nhiem_vu_qua_han', period, as_of_date: asOf, value: r.qua_han, capture_method: 'api' as const, source_ref: src },
    ];
    const out = await this.facts.ingest(actor, records, 'api');
    return { period, inputs: { giao: r.giao, hoan_thanh: r.hoan_thanh, qua_han: r.qua_han }, outcomes: out };
  }
}
