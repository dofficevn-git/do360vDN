import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Indicator } from '../catalog/indicator.entity';
import { ReportSlot } from '../catalog/report-spec.entity';
import { Department } from '../departments/department.entity';
import { parsePeriod, previousCumulative } from '../../common/period';
import { GateIssue, GateText, findPeriodWords } from '../../common/gate-text';

export type { GateIssue, GateLevel } from '../../common/gate-text';

/**
 * D3 — Quality Gate: sáu nhóm kiểm tra. Không con số nào vào bản báo cáo nếu chưa qua.
 *   so_hoc    tổng bằng thành phần (checks của slot)          → lỗi
 *   dinh_dang kiểu giá trị, tỷ lệ 0–100, số mơ hồ               → lỗi / cảnh báo
 *   ngay_chot mọi chỉ tiêu dùng chung cutoff_date, ngoại lệ ghi rõ → cảnh báo (lỗi nếu không có lý do khi chốt)
 *   xu_huong  lũy kế không giảm so với kỳ lũy kế trước; lệch > ngưỡng → cảnh báo
 *   day_du    slot bắt buộc phải có số đã duyệt                    → lỗi
 *   nhat_quan tên kỳ trong lời dẫn khớp kỳ báo cáo                → cảnh báo (truyền `narratives` vào evaluatePeriod)
 * Mọi vấn đề trả về có cấu trúc + câu tiếng Việt (common/gate-text.ts).
 */
export interface GateReport { ok: boolean; errors: GateIssue[]; warnings: GateIssue[]; checked_at: string }

export interface CurrentFact {
  id: string; indicator_id: string; value: number; as_of_date: string; status: string; capture_method: string;
  breakdown_key: string; aggregation: string; value_type: string; confidence?: number; snippet?: string | null;
}

const TOLERANCE = 1e-6;
const TREND_WARN_RATIO = 0.5; // lệch > 50% so kỳ trước → cảnh báo

/** Tách một vế của phép kiểm thành danh sách mã chỉ tiêu (chỉ hỗ trợ + và hằng số cho câu tiếng Việt). */
function termsOf(side: string): string[] {
  return (side.match(/[A-Za-z_][\w.]*/g) ?? []);
}

@Injectable()
export class QualityGateService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(ReportSlot) private slots: Repository<ReportSlot>,
    @InjectRepository(Indicator) private indicators: Repository<Indicator>,
    @InjectRepository(Department) private departments: Repository<Department>,
  ) {}

  /** Số hiện hành của kỳ (không gồm rejected/quarantined), chỉ phần tổng (không phân tổ). */
  async currentFacts(tenantId: string, period: string, onlyVerified = false): Promise<Map<string, CurrentFact>> {
    const rows: CurrentFact[] = await this.ds.query(
      `SELECT DISTINCT ON (f.indicator_id) f.id, f.indicator_id, f.value::float8 AS value, f.as_of_date::text AS as_of_date,
              f.status, f.capture_method, f.breakdown_key, i.aggregation, i.value_type, f.confidence::float8 AS confidence, f.source_ref->>'snippet' AS snippet
         FROM fact_indicator f JOIN dim_indicator i ON i.indicator_id = f.indicator_id
        WHERE f.tenant_id = $1 AND f.period = $2 AND f.breakdown_key = '' AND f.status NOT IN ('rejected','quarantined')
        ORDER BY f.indicator_id, f.version DESC`,
      [tenantId, period],
    );
    const kept = onlyVerified ? rows.filter((r) => ['confirmed', 'approved', 'locked'].includes(r.status)) : rows;
    return new Map(kept.map((r) => [r.indicator_id, r]));
  }

  private async deptNames(): Promise<Map<string, string>> {
    return new Map((await this.departments.find()).map((d) => [d.key, d.name]));
  }

  /**
   * Phép kiểm số học: biểu thức chỉ gồm mã chỉ tiêu, số, + - * / ( ) và một phép so sánh == <= >= < >.
   * Không dùng eval: tự tách token để không chạy được mã lạ từ file cấu hình.
   */
  evaluateCheck(expr: string, values: Record<string, number>): { ok: boolean; missing: string[]; detail: string; lhs: number | null; rhs: number | null; op: string } {
    const m = /^(.+?)\s*(==|<=|>=|<|>)\s*(.+)$/.exec(expr.trim());
    if (!m) throw new BadRequestException(`Phép kiểm không hợp lệ: "${expr}"`);
    const missing: string[] = [];
    const side = (s: string): number | null => {
      const tokens = s.match(/[A-Za-z_][\w.]*|\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
      if (tokens.join('').replace(/\s/g, '') !== s.replace(/\s/g, '')) throw new BadRequestException(`Ký tự lạ trong phép kiểm: "${expr}"`);
      const rpn: (number | string)[] = []; const ops: string[] = [];
      const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
      for (const t of tokens) {
        if (/^\d/.test(t)) rpn.push(Number(t));
        else if (/^[A-Za-z_]/.test(t)) { if (!(t in values)) { missing.push(t); rpn.push(NaN); } else rpn.push(values[t]); }
        else if (t === '(') ops.push(t);
        else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') rpn.push(ops.pop()!); ops.pop(); }
        else { while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) rpn.push(ops.pop()!); ops.push(t); }
      }
      while (ops.length) rpn.push(ops.pop()!);
      const st: number[] = [];
      for (const t of rpn) {
        if (typeof t === 'number') st.push(t);
        else { const b = st.pop()!, a = st.pop()!; st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : a / b); }
      }
      return st.length === 1 && !Number.isNaN(st[0]) ? st[0] : null;
    };
    const l = side(m[1]), r = side(m[3]);
    const op = m[2];
    if (missing.length || l === null || r === null) return { ok: false, missing: [...new Set(missing)], detail: 'thiếu số', lhs: l, rhs: r, op };
    const ok = op === '==' ? Math.abs(l - r) < TOLERANCE : op === '<=' ? l <= r + TOLERANCE : op === '>=' ? l >= r - TOLERANCE : op === '<' ? l < r : l > r;
    return { ok, missing: [], detail: `${m[1].trim()} = ${l} ${op} ${m[3].trim()} = ${r}`, lhs: l, rhs: r, op };
  }

  private sumIssue(slot: ReportSlot, expr: string, values: Record<string, number>, r: { lhs: number | null; rhs: number | null; op: string }, meta: Map<string, Indicator>, depts: Map<string, string>, indicatorId?: string): GateIssue {
    const m = /^(.+?)\s*(==|<=|>=|<|>)\s*(.+)$/.exec(expr.trim())!;
    const term = (id: string) => ({ name: meta.get(id)?.name ?? id, value: values[id] ?? NaN });
    const label = (slot.check_labels as any)?.[expr] ?? undefined;
    return GateText.sumMismatch({ slot: slot.slot_code, slot_title: slot.title ?? undefined, owner_dept: slot.owner_dept, owner_dept_name: slot.owner_dept ? depts.get(slot.owner_dept) ?? null : null },
      { label, expr, lhsTerms: termsOf(m[1]).map(term), rhsTerms: termsOf(m[3]).map(term), lhs: r.lhs ?? NaN, rhs: r.rhs ?? NaN, op: r.op, indicator: indicatorId, indicator_name: indicatorId ? meta.get(indicatorId)?.name : undefined });
  }

  /**
   * Các phép kiểm số học liên quan tới một chỉ tiêu khi xác nhận. Chỉ đối chiếu với số ĐÃ xác nhận/duyệt của các
   * chỉ tiêu khác; phép kiểm còn thiếu vế thì chưa chạy — người xác nhận cuối cùng khép kín phép kiểm là người bị chặn nếu tổng không khớp.
   */
  async checksForIndicator(tenantId: string, period: string, indicatorId: string, candidate: number): Promise<GateIssue[]> {
    const slots = await this.slots.createQueryBuilder('s').where(`s.indicator_ids @> :id`, { id: JSON.stringify([indicatorId]) }).getMany();
    if (!slots.length) return [];
    const cur = await this.currentFacts(tenantId, period, true);
    const values: Record<string, number> = {};
    cur.forEach((f, k) => { values[k] = f.value; });
    values[indicatorId] = candidate;
    const meta = new Map((await this.indicators.find()).map((i) => [i.indicator_id, i]));
    const depts = await this.deptNames();
    const issues: GateIssue[] = [];
    for (const s of slots) {
      for (const c of s.checks ?? []) {
        if (!c.includes(indicatorId)) continue;
        const r = this.evaluateCheck(c, values);
        if (!r.ok && !r.missing.length) issues.push(this.sumIssue(s, c, values, r, meta, depts, indicatorId));
      }
    }
    return issues;
  }

  /** Kiểm toàn kỳ theo một mẫu báo cáo — dùng ở màn tiến độ và khi chốt kỳ. */
  async evaluatePeriod(tenantId: string, period: string, specId: number, opts: { cutoffDate?: string; exceptions?: Record<string, string>; narratives?: Record<string, string> } = {}): Promise<GateReport & { slots: any[] }> {
    const p = parsePeriod(period);
    const slots = await this.slots.find({ where: { spec_id: specId }, order: { ord: 'ASC' } });
    const cur = await this.currentFacts(tenantId, period);
    const prevCode = previousCumulative(period);
    const prev = prevCode ? await this.currentFacts(tenantId, prevCode) : new Map<string, CurrentFact>();
    const prevLabel = prevCode ? parsePeriod(prevCode).label : '';
    // kỳ lũy kế ngắn hơn (9 tháng so 6 tháng): số lũy kế kỳ vọng tăng theo tỷ lệ số tháng → so với mức kỳ vọng, không so thô
    const months = (c: string) => { const q = parsePeriod(c); return Math.max(1, Math.round((new Date(q.end).getTime() - new Date(q.start).getTime()) / (30.4 * 86_400_000))); };
    const scale = prevCode ? months(period) / months(prevCode) : 1;
    const indMeta = new Map((await this.indicators.find()).map((i) => [i.indicator_id, i]));
    const depts = await this.deptNames();
    const values: Record<string, number> = {};
    cur.forEach((f, k) => { values[k] = f.value; });
    const errors: GateIssue[] = []; const warnings: GateIssue[] = [];
    const seen = new Set<string>();
    const slotOut: any[] = [];
    const push = (i: GateIssue) => (i.level === 'error' ? errors : warnings).push(i);

    for (const s of slots) {
      const base = { slot: s.slot_code, slot_title: s.title ?? undefined, owner_dept: s.owner_dept, owner_dept_name: s.owner_dept ? depts.get(s.owner_dept) ?? null : null, fix_link: `/facts?period=${period}` };
      const missing: string[] = []; const unapproved: { name: string; status: string; id: string }[] = [];
      for (const id of s.indicator_ids ?? []) {
        const f = cur.get(id);
        if (!f) missing.push(id);
        else if (!['approved', 'locked'].includes(f.status)) unapproved.push({ name: indMeta.get(id)?.name ?? id, status: f.status, id });
      }
      if (s.required && (missing.length || unapproved.length)) {
        if (missing.length) push(GateText.missing(base, missing.map((id) => indMeta.get(id)?.name ?? id), missing));
        if (unapproved.length) push(GateText.unapproved(base, unapproved));
      }
      const checkResults: any[] = [];
      for (const c of s.checks ?? []) {
        const r = this.evaluateCheck(c, values);
        checkResults.push({ check: c, label: (s.check_labels as any)?.[c] ?? null, ok: r.ok, missing: r.missing, detail: r.detail });
        if (!r.ok && !r.missing.length) push(this.sumIssue(s, c, values, r, indMeta, depts));
      }
      const cutoffGroups = new Map<string, { id: string; name: string; fact_id?: string; reason?: string | null }[]>();
      for (const id of s.indicator_ids ?? []) {
        if (seen.has(id)) continue; seen.add(id);
        const f = cur.get(id); const meta = indMeta.get(id);
        if (!f || !meta) continue;
        const ib = { ...base, owner_dept: meta.owner_dept ?? s.owner_dept, owner_dept_name: (meta.owner_dept && depts.get(meta.owner_dept)) || base.owner_dept_name };
        const named = { indicator: id, indicator_name: meta.name };
        // định dạng
        if (meta.value_type === 'integer' && !Number.isInteger(f.value)) push(GateText.notInteger(ib, { ...named, value: f.value }));
        if (meta.value_type === 'percent' && (f.value < 0 || f.value > 100)) push(GateText.percentRange(ib, { ...named, value: f.value }));
        if (f.value < 0 && meta.value_type !== 'decimal') push(GateText.negative(ib, { ...named, value: f.value }));
        if (f.confidence !== undefined && f.confidence !== null && Number(f.confidence) <= 0.6 && f.snippet && !['approved', 'locked'].includes(f.status)) push(GateText.ambiguous(ib, { ...named, snippet: String(f.snippet).slice(0, 60) }));
        // ngày chốt
        if (opts.cutoffDate && f.as_of_date !== opts.cutoffDate) { const g = cutoffGroups.get(f.as_of_date) ?? []; g.push({ id, name: meta.name, fact_id: f.id, reason: opts.exceptions?.[id] ?? null }); cutoffGroups.set(f.as_of_date, g); }
        if (f.as_of_date > p.end && meta.aggregation !== 'point_in_time') push(GateText.cutoffAfterPeriod(ib, { ...named, as_of: f.as_of_date, period_end: p.end }));
        // xu hướng
        const pf = prev.get(id);
        if (pf && meta.aggregation === 'cumulative') {
          if (f.value + TOLERANCE < pf.value) push(GateText.cumulativeDrop(ib, { ...named, value: f.value, prev: pf.value, prev_label: prevLabel }));
          else if (pf.value > 0 && Math.abs(f.value - pf.value * scale) / (pf.value * scale) > TREND_WARN_RATIO) push(GateText.bigChange(ib, { ...named, value: f.value, prev: pf.value, prev_label: prevLabel, pct: ((f.value - pf.value) / pf.value) * 100 }));
        }
      }
      // ngày chốt: gom theo mục + cùng ngày (phòng chủ số liệu lấy theo chỉ tiêu đầu nhóm)
      for (const [asOf, items] of cutoffGroups) {
        const m0 = indMeta.get(items[0].id);
        const gb = { ...base, owner_dept: m0?.owner_dept ?? s.owner_dept, owner_dept_name: (m0?.owner_dept && depts.get(m0.owner_dept)) || base.owner_dept_name };
        push(GateText.cutoffMismatchGroup(gb, { items, as_of: asOf, cutoff: opts.cutoffDate! }));
      }
      // nhất quán kỳ: lời dẫn của slot
      const text = opts.narratives?.[s.slot_code];
      if (text) for (const w of findPeriodWords(text, p.label)) push(GateText.periodWord(base, { found: w, period_label: p.label, where: `Lời dẫn mục ${s.section}${s.title ? ` (${s.title})` : ''}` }));
      slotOut.push({ slot_code: s.slot_code, title: s.title ?? null, section: s.section, slot_type: s.slot_type, required: s.required, owner_dept: s.owner_dept, owner_dept_name: s.owner_dept ? depts.get(s.owner_dept) ?? null : null,
        indicators: (s.indicator_ids ?? []).map((id) => ({ id, name: indMeta.get(id)?.name, unit: indMeta.get(id)?.unit, fact: cur.get(id) ?? null })), checks: checkResults,
        complete: !missing.length && !unapproved.length });
    }
    return { ok: errors.length === 0, errors, warnings, checked_at: new Date().toISOString(), slots: slotOut };
  }
}
