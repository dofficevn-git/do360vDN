import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DictionaryService } from './dictionary.service';
import { parsePeriod } from '../../common/period';

const REFRESH_DAYS: Record<string, number> = { daily: 2, weekly: 10, monthly: 45, quarterly: 120, yearly_or_on_change: 400, on_change: 400 };

/**
 * Data Map (Blueprint mục 20, 55) và Data Health 6 chỉ số (mục 19, 56): mọi con số đo từ kho, drill-down tới bản ghi và phòng chủ.
 */
@Injectable()
export class DataMapService {
  constructor(@InjectDataSource() private ds: DataSource, private dict: DictionaryService) {}

  private async deptNames(): Promise<Record<string, string>> {
    const rows = await this.ds.query(`SELECT key, name FROM departments`);
    return Object.fromEntries(rows.map((r: any) => [r.key, r.name]));
  }

  /** Bản đồ dữ liệu: cấu hình + số đo thật (lần nạp gần nhất, số bản ghi, chất lượng, nơi dùng). */
  async map(tenantId: string) {
    const depts = await this.deptNames();
    const specs: any[] = await this.ds.query(`SELECT s.spec_code, s.version, s.title, sl.indicator_ids FROM report_spec s JOIN report_slot sl ON sl.spec_id = s.id WHERE s.is_active`);
    const domains = this.dict.dashboardDomains();
    const usedBy = (inds: string[]) => {
      const reports = [...new Set(specs.filter((s) => (s.indicator_ids ?? []).some((i: string) => inds.includes(i))).map((s) => `${s.title} (${s.spec_code}@${s.version})`))];
      const dash = domains.filter((d) => [...(d.cards ?? []), ...(d.tabs ?? []).flatMap((t) => t.cards)].some((c) => inds.includes(c.indicator) || inds.includes(c.pair_with ?? ''))).map((d) => d.name);
      return { reports, dashboards: dash };
    };
    const sources = [];
    for (const s of this.dict.sources()) {
      const datasets = [];
      for (const d of s.datasets) {
        let last: string | null = null; let records = 0; let quality: number | null = null;
        const p = d.probe ?? {};
        if (p.rule) {
          const r = await this.ds.query(`SELECT COUNT(*)::int AS n, MAX(created_at)::text AS last FROM source_file WHERE tenant_id = $1 AND source_type = $2`, [tenantId, p.rule]);
          records = r[0]?.n ?? 0; last = r[0]?.last ?? null;
        } else if (p.table) {
          const col = p.table === 'qlvb_document' ? 'created_at' : 'created_at';
          const r = await this.ds.query(`SELECT COUNT(*)::int AS n, MAX(${col})::text AS last FROM ${p.table} WHERE tenant_id = $1`, [tenantId]).catch(() => [{ n: 0, last: null }]);
          records = r[0]?.n ?? 0; last = r[0]?.last ?? null;
        } else if (p.object_type) {
          const r = await this.ds.query(`SELECT COUNT(*)::int AS n, MAX(refreshed_at)::text AS last FROM dim_object WHERE tenant_id = $1 AND object_type = $2 AND status <> 'deleted'`, [tenantId, p.object_type]);
          records = r[0]?.n ?? 0; last = r[0]?.last ?? null;
        }
        if (d.indicators?.length) {
          const q = await this.ds.query(
            `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status IN ('approved','locked'))::int AS ok, MAX(created_at)::text AS last FROM (
               SELECT DISTINCT ON (indicator_id, period) status, created_at FROM fact_indicator WHERE tenant_id = $1 AND indicator_id = ANY($2) AND breakdown_key = '' AND status NOT IN ('rejected','quarantined') ORDER BY indicator_id, period, version DESC) f`, [tenantId, d.indicators]);
          if (q[0]?.n) { quality = Math.round((q[0].ok / q[0].n) * 100); if (!last) last = q[0].last; }
        }
        const ageDays = last ? (Date.now() - new Date(last).getTime()) / 86_400_000 : null;
        const window = REFRESH_DAYS[d.refresh] ?? 45;
        datasets.push({ ...d, records, last_sync: last, age_days: ageDays === null ? null : Math.floor(ageDays), freshness: s.status !== 'active' ? 'planned' : ageDays === null ? 'never' : ageDays > window ? 'stale' : 'current', quality_score: quality, used_by: usedBy(d.indicators ?? []) });
      }
      sources.push({ ...s, owner_name: depts[s.owner] ?? s.owner, datasets });
    }
    const totals = { sources: sources.length, active: sources.filter((s) => s.status === 'active').length, datasets: sources.reduce((n, s) => n + s.datasets.length, 0),
      stale: sources.reduce((n, s) => n + s.datasets.filter((d: any) => d.freshness === 'stale').length, 0), api: sources.filter((s) => s.api_available).length };
    return { totals, sources };
  }

  /** Lineage ngược: "chỉ tiêu này lấy từ đâu?" — dataset → file/bản ghi → số theo kỳ → báo cáo đã dùng. */
  async lineage(tenantId: string, indicatorId: string) {
    const ind = (await this.ds.query(`SELECT indicator_id, name, unit, domain, owner_dept, capture_method FROM dim_indicator WHERE indicator_id = $1`, [indicatorId]))[0];
    const datasets = this.dict.sources().flatMap((s) => s.datasets.filter((d) => (d.indicators ?? []).includes(indicatorId)).map((d) => ({ source: s.name, source_key: s.key, dataset: d.name, code: d.code, ownership: d.ownership, ingestion: s.ingestion, refresh: d.refresh, status: s.status })));
    const facts = await this.ds.query(
      `SELECT DISTINCT ON (period) id, period, value::float8 AS value, status, capture_method, as_of_date::text AS as_of_date, source_ref, version, created_at::text AS created_at
         FROM fact_indicator WHERE tenant_id = $1 AND indicator_id = $2 AND breakdown_key = '' AND status NOT IN ('rejected','quarantined') ORDER BY period DESC, version DESC`, [tenantId, indicatorId]);
    const files = facts.filter((f: any) => f.source_ref?.file_id).map((f: any) => f.source_ref.file_id);
    const fileRows = files.length ? await this.ds.query(`SELECT id, original_name, source_type, period, created_at::text AS created_at FROM source_file WHERE id = ANY($1)`, [files]) : [];
    const runs = await this.ds.query(`SELECT run_id, period, status, signed_number, signed_date::text AS signed_date FROM report_run WHERE tenant_id = $1 AND status <> 'cancelled' AND fact_snapshot->'facts' ? $2 ORDER BY period DESC`, [tenantId, indicatorId]);
    const specs = await this.ds.query(`SELECT DISTINCT s.title, s.spec_code, s.version FROM report_spec s JOIN report_slot sl ON sl.spec_id = s.id WHERE s.is_active AND sl.indicator_ids ? $1`, [indicatorId]);
    const dashboards = this.dict.dashboardDomains().filter((d) => [...(d.cards ?? []), ...(d.tabs ?? []).flatMap((t) => t.cards)].some((c) => c.indicator === indicatorId || c.pair_with === indicatorId)).map((d) => d.name);
    return { indicator: ind ?? null, datasets, facts: facts.map((f: any) => ({ ...f, file: fileRows.find((x: any) => x.id === f.source_ref?.file_id) ?? null })), used_in: { reports: runs, specs, dashboards } };
  }

  /** Tác động xuôi: "dataset này lỗi thì ảnh hưởng gì?" */
  async impact(tenantId: string, datasetCode: string) {
    const ds = this.dict.sources().flatMap((s) => s.datasets.map((d) => ({ ...d, source: s }))).find((d) => d.code === datasetCode);
    if (!ds) return null;
    const inds = ds.indicators ?? [];
    const specs = inds.length ? await this.ds.query(`SELECT DISTINCT s.title, s.spec_code, s.version FROM report_spec s JOIN report_slot sl ON sl.spec_id = s.id WHERE s.is_active AND sl.indicator_ids ?| $1`, [inds]) : [];
    const open = inds.length ? await this.ds.query(`SELECT r.run_id, r.period, r.status FROM report_run r JOIN report_slot sl ON sl.spec_id = r.spec_id WHERE r.tenant_id = $1 AND r.status = 'collecting' AND sl.indicator_ids ?| $2 GROUP BY r.run_id, r.period, r.status`, [tenantId, inds]) : [];
    const dashboards = this.dict.dashboardDomains().filter((d) => [...(d.cards ?? []), ...(d.tabs ?? []).flatMap((t) => t.cards)].some((c) => inds.includes(c.indicator) || inds.includes(c.pair_with ?? ''))).map((d) => d.name);
    const names = inds.length ? await this.ds.query(`SELECT indicator_id, name FROM dim_indicator WHERE indicator_id = ANY($1)`, [inds]) : [];
    return { dataset: { code: ds.code, name: ds.name, source: ds.source.name }, indicators: names, reports: specs, open_runs: open, dashboards };
  }

  /**
   * Data Health 6 chỉ số (ĐÚNG – ĐỦ – SẠCH – SỐNG – THỐNG NHẤT – DÙNG CHUNG) cho một kỳ; mỗi chỉ số có drill-down theo lĩnh vực/chỉ tiêu/bản ghi.
   */
  async health(tenantId: string, period?: string) {
    const depts = await this.deptNames();
    if (!period) { const r = await this.ds.query(`SELECT period FROM report_run WHERE tenant_id = $1 AND status <> 'cancelled' ORDER BY (status = 'collecting') DESC, created_at DESC LIMIT 1`, [tenantId]); period = r[0]?.period; }
    if (!period) return { period: null, scores: {}, overall: null, metrics: [] };
    const p = parsePeriod(period);
    const cur: any[] = await this.ds.query(
      `SELECT f.id, f.indicator_id, i.name, i.domain, i.owner_dept, f.status, f.capture_method, f.as_of_date::text AS as_of_date, f.source_ref, f.confidence::float8 AS confidence, f.version
         FROM (SELECT DISTINCT ON (indicator_id) * FROM fact_indicator WHERE tenant_id = $1 AND period = $2 AND breakdown_key = '' AND status NOT IN ('rejected','quarantined') ORDER BY indicator_id, version DESC) f
         JOIN dim_indicator i ON i.indicator_id = f.indicator_id`, [tenantId, period]);
    const allVersions: any[] = await this.ds.query(`SELECT f.indicator_id, i.name, i.owner_dept, f.status, f.note FROM fact_indicator f JOIN dim_indicator i ON i.indicator_id = f.indicator_id WHERE f.tenant_id = $1 AND f.period = $2 AND f.breakdown_key = ''`, [tenantId, period]);
    const required: any[] = await this.ds.query(
      `SELECT DISTINCT ind AS indicator_id, i.name, i.owner_dept, i.domain FROM report_run r JOIN report_slot sl ON sl.spec_id = r.spec_id AND sl.required CROSS JOIN LATERAL jsonb_array_elements_text(sl.indicator_ids) ind JOIN dim_indicator i ON i.indicator_id = ind
        WHERE r.tenant_id = $1 AND r.period = $2 AND r.status <> 'cancelled'`, [tenantId, period]);
    const objects: any[] = await this.ds.query(`SELECT uid, object_type, code, name, master_id, verification_status, refreshed_at::text AS refreshed_at, name_norm, data_owner_dept FROM dim_object WHERE tenant_id = $1 AND status <> 'deleted'`, [tenantId]);
    const specUse: any[] = await this.ds.query(`SELECT ind AS indicator_id, COUNT(DISTINCT s.spec_code)::int AS n FROM report_spec s JOIN report_slot sl ON sl.spec_id = s.id CROSS JOIN LATERAL jsonb_array_elements_text(sl.indicator_ids) ind WHERE s.is_active GROUP BY ind`);
    const dashUse = new Map<string, number>();
    for (const d of this.dict.dashboardDomains()) for (const c of [...(d.cards ?? []), ...(d.tabs ?? []).flatMap((t) => t.cards)]) { dashUse.set(c.indicator, (dashUse.get(c.indicator) ?? 0) + 1); if (c.pair_with) dashUse.set(c.pair_with, (dashUse.get(c.pair_with) ?? 0) + 1); }
    const kpiUse = new Set(['chi_dao.nhiem_vu_giao', 'chi_dao.nhiem_vu_hoan_thanh', 'kpi.diem_trung_binh', 'kpi.ty_le_viec_dung_han', 'kpi.so_can_bo_danh_gia']);
    const typeDefs = new Map(this.dict.objectTypes().map((t) => [t.key, t]));
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    const byDept = (rows: any[]) => Object.entries(rows.reduce((m: Record<string, number>, r) => { const k = r.owner_dept ?? r.data_owner_dept ?? '—'; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([k, n]) => ({ dept: k, dept_name: depts[k] ?? k, n })).sort((a: any, b: any) => b.n - a.n);

    // ĐÚNG: số đã duyệt/chốt (đối soát bởi người có thẩm quyền) + object đã xác minh
    const verifiedFacts = cur.filter((f) => ['approved', 'locked'].includes(f.status));
    const badDung = cur.filter((f) => !['approved', 'locked'].includes(f.status));
    const dung = { score: pct(verifiedFacts.length + objects.filter((o) => o.verification_status === 'verified').length, cur.length + objects.length), facts_total: cur.length, facts_verified: verifiedFacts.length, objects_total: objects.length, objects_verified: objects.filter((o) => o.verification_status === 'verified').length,
      issues: [...(badDung.map((f) => ({ kind: 'fact', id: f.id, indicator_id: f.indicator_id, name: f.name, status: f.status, owner_dept: f.owner_dept })) as any[]), ...(objects.filter((o) => o.verification_status !== 'verified').map((o) => ({ kind: 'object', id: o.uid, name: `${o.code} ${o.name}`, status: o.verification_status, owner_dept: o.data_owner_dept })) as any[])], by_dept: byDept(badDung) };
    // ĐỦ: chỉ tiêu bắt buộc của mẫu có số
    const have = new Set(cur.map((f) => f.indicator_id));
    const missing = required.filter((r) => !have.has(r.indicator_id));
    const du = { score: pct(required.length - missing.length, required.length), required: required.length, missing: missing.length, issues: (missing as any[]).map((m) => ({ kind: 'indicator', indicator_id: m.indicator_id, name: m.name, owner_dept: m.owner_dept, domain: m.domain })), by_dept: byDept(missing) };
    // SẠCH: không bị cách ly/loại do sai; object không trùng tên
    const dirty = allVersions.filter((v) => v.status === 'quarantined' || (v.status === 'rejected' && !(v.note ?? '').startsWith('Thay bằng phiên bản')));
    const dupMap = new Map<string, any[]>(); for (const o of objects) { const k = `${o.object_type}|${o.name_norm}`; dupMap.set(k, [...(dupMap.get(k) ?? []), o]); }
    const dups = [...dupMap.values()].filter((g) => g.length > 1);
    const sach = { score: pct(allVersions.length - dirty.length + objects.length - dups.flat().length, allVersions.length + objects.length), versions: allVersions.length, quarantined: dirty.length, duplicate_objects: dups.flat().length,
      issues: [...(dirty.map((d) => ({ kind: 'fact', indicator_id: d.indicator_id, name: d.name, status: d.status, owner_dept: d.owner_dept, note: d.note })) as any[]), ...(dups.flat().map((o) => ({ kind: 'object', id: o.uid, name: `${o.code} ${o.name}`, status: 'trùng tên', owner_dept: o.data_owner_dept })) as any[])], by_dept: byDept(dirty) };
    // SỐNG: số chốt không quá 30 ngày trước ngày cuối kỳ; object trong chu kỳ cập nhật
    const endMs = new Date(p.end).getTime();
    const staleFacts = cur.filter((f) => f.as_of_date && endMs - new Date(f.as_of_date).getTime() > 30 * 86_400_000);
    const staleObjs = objects.filter((o) => (Date.now() - new Date(o.refreshed_at).getTime()) / 86_400_000 > (typeDefs.get(o.object_type)?.freshness_days ?? 30));
    const song = { score: pct(cur.length - staleFacts.length + objects.length - staleObjs.length, cur.length + objects.length), stale_facts: staleFacts.length, stale_objects: staleObjs.length,
      issues: [...(staleFacts.map((f) => ({ kind: 'fact', id: f.id, indicator_id: f.indicator_id, name: f.name, as_of_date: f.as_of_date, owner_dept: f.owner_dept })) as any[]), ...(staleObjs.map((o) => ({ kind: 'object', id: o.uid, name: `${o.code} ${o.name}`, refreshed_at: o.refreshed_at, owner_dept: o.data_owner_dept })) as any[])], by_dept: byDept([...staleFacts, ...staleObjs]) };
    // THỐNG NHẤT: object loại MASTER/REFERENCE có master_id; số có nguồn truy vết (file/hệ thống)
    const refObjs = objects.filter((o) => ['MASTER', 'REFERENCE'].includes(typeDefs.get(o.object_type)?.ownership ?? ''));
    const mapped = refObjs.filter((o) => o.master_id);
    const sourced = cur.filter((f) => f.source_ref?.file_id || f.source_ref?.system || f.capture_method === 'api');
    const thongNhat = { score: pct(mapped.length + sourced.length, refObjs.length + cur.length), objects_reference: refObjs.length, objects_mapped: mapped.length, facts_sourced: sourced.length,
      issues: [...(refObjs.filter((o) => !o.master_id).map((o) => ({ kind: 'object', id: o.uid, name: `${o.code} ${o.name}`, status: 'chưa có Master ID', owner_dept: o.data_owner_dept })) as any[]), ...(cur.filter((f) => !(f.source_ref?.file_id || f.source_ref?.system || f.capture_method === 'api')).map((f) => ({ kind: 'fact', id: f.id, indicator_id: f.indicator_id, name: f.name, status: 'nhập tay không có nguồn', owner_dept: f.owner_dept })) as any[])], by_dept: byDept(refObjs.filter((o) => !o.master_id)) };
    // DÙNG CHUNG: chỉ tiêu có số được ≥ 2 nơi dùng (báo cáo, bảng điều hành, KPI)
    const reuse = cur.map((f) => ({ indicator_id: f.indicator_id, name: f.name, owner_dept: f.owner_dept, uses: (specUse.find((s) => s.indicator_id === f.indicator_id)?.n ?? 0) + (dashUse.get(f.indicator_id) ?? 0) + (kpiUse.has(f.indicator_id) ? 1 : 0) }));
    const shared = reuse.filter((r) => r.uses >= 2);
    const dungChung = { score: pct(shared.length, reuse.length), indicators: reuse.length, shared: shared.length, issues: (reuse as any[]).filter((r) => r.uses < 2).map((r) => ({ kind: 'indicator', indicator_id: r.indicator_id, name: r.name, status: `${r.uses} nơi dùng`, owner_dept: r.owner_dept })), by_dept: byDept(reuse.filter((r) => r.uses < 2)) };
    const metrics = [
      { key: 'dung', name: 'Đúng', hint: 'Số đã được người có thẩm quyền duyệt/chốt; đối tượng đã xác minh', ...dung },
      { key: 'du', name: 'Đủ', hint: 'Chỉ tiêu bắt buộc của mẫu báo cáo đã có số', ...du },
      { key: 'sach', name: 'Sạch', hint: 'Không bị cách ly/loại vì sai; đối tượng không trùng', ...sach },
      { key: 'song', name: 'Sống', hint: 'Số chốt trong 30 ngày quanh cuối kỳ; đối tượng cập nhật trong chu kỳ', ...song },
      { key: 'thong_nhat', name: 'Thống nhất', hint: 'Đối tượng tham chiếu có Master ID; số có nguồn truy vết', ...thongNhat },
      { key: 'dung_chung', name: 'Dùng chung', hint: 'Chỉ tiêu được ≥ 2 nghiệp vụ dùng lại (báo cáo, bảng điều hành, KPI)', ...dungChung },
    ].map((m) => ({ ...m, level: m.score === null ? 'na' : m.score >= 90 ? 'good' : m.score >= 75 ? 'warn' : 'bad', issues: m.issues.slice(0, 60) }));
    const vals = metrics.map((m) => m.score).filter((s): s is number => s !== null);
    const overall = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    return { period, period_label: p.label, overall, scores: Object.fromEntries(metrics.map((m) => [m.key, m.score])), metrics };
  }
}
