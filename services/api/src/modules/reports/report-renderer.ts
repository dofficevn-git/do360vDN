import { Injectable } from '@nestjs/common';
import { AlignmentType, Document, FootnoteReferenceRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, BorderStyle, HeadingLevel } from 'docx';
import { ReportRun } from './report-run.entity';
import { ReportSlot, ReportSpec } from '../catalog/report-spec.entity';
import { formatDecimal, formatNumberOnly, formatValue, formatVnDate, ValueType } from '../../common/format';
import { parsePeriod } from '../../common/period';
import { findPeriodWords } from '../../common/gate-text';

/**
 * D4 — Bộ sinh báo cáo: pipeline một chiều theo từng slot.
 *   - Số do template render từ snapshot (không truy vấn kho sống, không mô hình nào sinh số).
 *   - Mỗi câu số được tách thành MẢNH (segments): mảnh số mang tham chiếu tới số liệu gốc → web cho bấm vào số thấy nguồn.
 *   - So sánh (kế hoạch năm, cùng kỳ năm trước, kỳ trước) đọc từ snapshot.comparisons đã đóng băng lúc chốt kỳ.
 *   - Lời dẫn (narrative) bước 1: snapshot.narratives[slot] (Văn phòng biên tập, A2); chưa có → ô trống đánh dấu.
 *   - Hậu kiểm: mọi con số trong câu số và lời dẫn phải khớp giá trị đã định dạng từ snapshot (hoặc số dẫn xuất);
 *     tên kỳ trong văn bản khớp kỳ báo cáo.
 * Thể thức: NĐ 30/2020/NĐ-CP; mục con theo `spec.sections`; chú thích cuối trang cho ngoại lệ ngày chốt, nguồn số, văn bản trích dẫn.
 */
export interface SnapshotFact { fact_id: string; value: number; unit: string; value_type: ValueType; name: string; as_of_date: string; capture_method?: string; source_ref?: any; approved_by?: number | null; version?: number }
export interface Comparison { plan?: { value: number; year: number; source_ref?: any } | null; same_period_last_year?: { value: number; period: string; fact_id?: string } | null; previous?: { value: number; period: string; fact_id?: string } | null }
export interface Snapshot {
  period: string; cutoff_date: string; spec: string; facts: Record<string, SnapshotFact>;
  events: { object_id: string; object_type: string; event_type: string; event_date: string; domain: string | null; payload: any }[];
  exceptions: { indicator_id: string; reason: string }[];
  narratives?: Record<string, string>;
  comparisons?: Record<string, Comparison>;
}
export type SegmentKind = 'text' | 'number' | 'ratio' | 'plan' | 'yoy' | 'prev' | 'period' | 'date';
export interface Segment { kind: SegmentKind; text: string; ref?: { indicator_id?: string; indicator_ids?: string[]; fact_id?: string; value?: number; unit?: string; name?: string; as_of_date?: string; capture_method?: string; source_ref?: any; approved_by?: number | null; version?: number; formula?: string; plan?: any; compare?: any } }
export interface RenderedSlot { slot_code: string; title: string | null; section: string; slot_type: string; text: string; segments: Segment[]; missing: string[]; table?: { columns: string[]; rows: (string | number | null)[][] } | null; footnotes?: string[] }
export interface DocumentTree { title: string; period_label: string; cutoff: string; sections: { code: string; title: string; depth: number; slots: RenderedSlot[] }[]; footnotes: string[] }
export interface RenderOutput { docx: Buffer; slots: RenderedSlot[]; document: DocumentTree; postcheck: { errors: string[]; warnings: string[] } }

const seg = (kind: SegmentKind, text: string, ref?: Segment['ref']): Segment => ({ kind, text, ref });

@Injectable()
export class ReportRenderer {
  private factRef(id: string, f: SnapshotFact): Segment['ref'] {
    return { indicator_id: id, fact_id: f.fact_id, value: f.value, unit: f.unit, name: f.name, as_of_date: f.as_of_date, capture_method: f.capture_method, source_ref: f.source_ref, approved_by: f.approved_by, version: f.version };
  }

  /** Một biến {…} → mảnh; null = thiếu dữ liệu. */
  private resolveVar(expr: string, snap: Snapshot, p: ReturnType<typeof parsePeriod>): Segment | null {
    const e = expr.trim();
    if (e === 'ky') return seg('period', p.label);
    if (e === 'ngay_chot') return seg('date', formatVnDate(snap.cutoff_date));
    const ratio = /^([\w.]+)\s*\/\s*([\w.]+):%$/.exec(e);
    if (ratio) {
      const a = snap.facts[ratio[1]], b = snap.facts[ratio[2]];
      if (!a || !b || !b.value) return null;
      const v = (a.value / b.value) * 100;
      return seg('ratio', formatNumberOnly(v, 'percent') + '%', { indicator_ids: [ratio[1], ratio[2]], value: v, formula: `${a.name} ${formatNumberOnly(a.value, a.value_type)} / ${b.name} ${formatNumberOnly(b.value, b.value_type)}` });
    }
    const m = /^([\w.]+)(?::(unit|plan%|yoy|prev|kh))?$/.exec(e);
    if (!m) return null;
    const id = m[1]; const mod = m[2];
    const f = snap.facts[id];
    if (!f) return null;
    if (!mod) return seg('number', formatNumberOnly(f.value, f.value_type), this.factRef(id, f));
    if (mod === 'unit') return seg('number', formatValue(f.value, f.value_type, f.unit), this.factRef(id, f));
    const c = snap.comparisons?.[id];
    if (mod === 'kh') { if (!c?.plan) return null; return seg('plan', formatValue(c.plan.value, f.value_type, f.unit), { ...this.factRef(id, f), plan: c.plan, formula: `kế hoạch năm ${c.plan.year}` }); }
    if (mod === 'plan%') {
      if (!c?.plan || !c.plan.value) return null;
      const pct = (f.value / c.plan.value) * 100;
      return seg('plan', `đạt ${formatDecimal(pct, 1)}% kế hoạch năm`, { ...this.factRef(id, f), plan: c.plan, value: pct, formula: `${formatNumberOnly(f.value, f.value_type)} / kế hoạch ${formatNumberOnly(c.plan.value, f.value_type)} (năm ${c.plan.year})` });
    }
    const cmp = mod === 'yoy' ? c?.same_period_last_year : c?.previous;
    if (!cmp || !cmp.value) return null;
    const pct = ((f.value - cmp.value) / cmp.value) * 100;
    const label = mod === 'yoy' ? `so với cùng kỳ năm ${parsePeriod(cmp.period).year}` : `so với ${parsePeriod(cmp.period).label}`;
    const word = Math.abs(pct) < 0.05 ? 'bằng' : pct > 0 ? 'tăng' : 'giảm';
    const text = word === 'bằng' ? `bằng ${label.replace(/^so với /, '')}` : `${word} ${formatDecimal(Math.abs(pct), 1)}% ${label}`;
    return seg(mod as SegmentKind, text, { ...this.factRef(id, f), compare: cmp, value: pct, formula: `${formatNumberOnly(f.value, f.value_type)} so với ${formatNumberOnly(cmp.value, f.value_type)} (${cmp.period})` });
  }

  /**
   * Thay biến trong khuôn câu thành mảnh. Đoạn [[ … ]] là tuỳ chọn: thiếu biến bên trong thì bỏ cả đoạn, không báo thiếu.
   */
  fillSegments(template: string, snap: Snapshot): { segments: Segment[]; missing: string[] } {
    const p = parsePeriod(snap.period);
    const missing: string[] = [];
    const out: Segment[] = [];
    const pushText = (t: string) => { if (!t) return; const last = out[out.length - 1]; if (last && last.kind === 'text') last.text += t; else out.push(seg('text', t)); };
    const parts = template.split(/(\[\[[\s\S]*?\]\])/g);
    for (const part of parts) {
      const optional = part.startsWith('[[') && part.endsWith(']]');
      const body = optional ? part.slice(2, -2) : part;
      const local: Segment[] = []; let ok = true;
      const tokens = body.split(/(\{[^{}]+\})/g);
      for (const t of tokens) {
        const v = /^\{([^{}]+)\}$/.exec(t);
        if (!v) { if (t) local.push(seg('text', t)); continue; }
        const s = this.resolveVar(v[1], snap, p);
        if (!s) { ok = false; if (!optional) { missing.push(v[1].trim()); local.push(seg('text', `[thiếu ${v[1].trim()}]`)); } continue; }
        local.push(s);
      }
      if (optional && !ok) continue;
      for (const s of local) s.kind === 'text' ? pushText(s.text) : out.push(s);
    }
    // gọn khoảng trắng trong mảnh chữ
    for (const s of out) if (s.kind === 'text') s.text = s.text.replace(/\s+/g, ' ');
    if (out.length && out[0].kind === 'text') out[0].text = out[0].text.replace(/^\s+/, '');
    if (out.length && out[out.length - 1].kind === 'text') out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
    return { segments: out, missing: [...new Set(missing)] };
  }

  /** Tương thích cũ: chuỗi phẳng. */
  fillTemplate(template: string, snap: Snapshot): { text: string; missing: string[] } {
    const r = this.fillSegments(template, snap);
    return { text: joinSegments(r.segments), missing: r.missing };
  }

  renderSlots(slots: ReportSlot[], snap: Snapshot): RenderedSlot[] {
    return slots.map((s) => {
      const base = { slot_code: s.slot_code, title: s.title ?? null, section: s.section, slot_type: s.slot_type };
      if (s.slot_type === 'metric_sentence') {
        const { segments, missing } = this.fillSegments(s.template ?? '', snap);
        let text = joinSegments(segments);
        if (text) { text = text.charAt(0).toUpperCase() + text.slice(1) + (/[.;:]$/.test(text) ? '' : '.'); if (segments[0]?.kind === 'text') segments[0].text = segments[0].text.charAt(0).toUpperCase() + segments[0].text.slice(1); if (!/[.;:]$/.test(joinSegments(segments))) segments.push(seg('text', '.')); }
        return { ...base, text, segments, missing };
      }
      if (s.slot_type === 'metric_table') {
        const rows: (string | number | null)[][] = []; const missing: string[] = []; const segments: Segment[] = [];
        for (const id of s.indicator_ids ?? []) {
          const f = snap.facts[id]; const c = snap.comparisons?.[id];
          if (!f) { missing.push(id); continue; }
          const plan = c?.plan?.value ? formatDecimal((f.value / c.plan.value) * 100, 1) + '%' : null;
          const yoy = c?.same_period_last_year?.value ? formatDecimal(((f.value - c.same_period_last_year.value) / c.same_period_last_year.value) * 100, 1) + '%' : null;
          rows.push([f.name, formatNumberOnly(f.value, f.value_type), f.unit, c?.plan ? formatNumberOnly(c.plan.value, f.value_type) : null, plan, yoy]);
          segments.push(seg('number', formatNumberOnly(f.value, f.value_type), this.factRef(id, f)));
        }
        const table = { columns: ['Chỉ tiêu', 'Thực hiện', 'Đơn vị', 'Kế hoạch năm', '% kế hoạch', 'So cùng kỳ'], rows };
        return { ...base, text: rows.map((r) => `${r[0]}: ${r[1]} ${r[2]}`).join('; '), segments, missing, table };
      }
      if (s.slot_type === 'event_list') {
        const q: any = s.event_query ?? {};
        const evs = snap.events.filter((e) => (!q.domain || e.domain === q.domain) && (!q.object_types?.length || q.object_types.includes(e.object_type)) && (!q.event_types?.length || q.event_types.includes(e.event_type)));
        const lines = evs.map((e) => `${e.payload?.loai ?? e.object_type} số ${e.object_id} ngày ${formatVnDate(e.event_date)}${e.payload?.trich_yeu ? ` về ${e.payload.trich_yeu}` : ''}`);
        const text = lines.length ? lines.join('; ') + '.' : '';
        return { ...base, text, segments: text ? [seg('text', text)] : [], missing: lines.length ? [] : ['không có sự kiện trong kỳ'], footnotes: evs.map((e) => `${e.payload?.loai ?? 'Văn bản'} số ${e.object_id} ngày ${formatVnDate(e.event_date)} của UBND phường${e.payload?.trich_yeu ? `: ${e.payload.trich_yeu}` : ''}.`) };
      }
      if (s.slot_type === 'narrative' || s.slot_type === 'next_tasks') {
        const t = snap.narratives?.[s.slot_code]?.trim();
        return { ...base, text: t ?? '', segments: t ? [seg('text', t)] : [], missing: t ? [] : ['Văn phòng biên tập'] };
      }
      const t = (s.template ?? '').trim();
      return { ...base, text: t, segments: t ? [seg('text', t)] : [], missing: [] };
    });
  }

  /** Tập số được phép xuất hiện: số snapshot (mọi định dạng), tỷ lệ cặp, số kế hoạch/cùng kỳ và % dẫn xuất, năm, ngày chốt. */
  allowedNumbers(snap: Snapshot): Set<string> {
    const allowed = new Set<string>();
    const add = (v: number, t: ValueType, unit = '') => { allowed.add(formatNumberOnly(v, t)); allowed.add(formatValue(v, t, unit).replace(/\s*(tỷ đồng|triệu đồng|đồng|%)$/, '')); };
    const facts = Object.entries(snap.facts);
    for (const [, f] of facts) add(f.value, f.value_type, f.unit);
    for (const [, a] of facts) for (const [, b] of facts) if (b.value) allowed.add(formatNumberOnly((a.value / b.value) * 100, 'percent'));
    for (const [id, c] of Object.entries(snap.comparisons ?? {})) {
      const f = snap.facts[id]; if (!f) continue;
      if (c.plan?.value) { add(c.plan.value, f.value_type, f.unit); allowed.add(formatDecimal((f.value / c.plan.value) * 100, 1)); }
      for (const cmp of [c.same_period_last_year, c.previous]) if (cmp?.value) { add(cmp.value, f.value_type, f.unit); allowed.add(formatDecimal(Math.abs((f.value - cmp.value) / cmp.value) * 100, 1)); allowed.add(String(parsePeriod(cmp.period).year)); }
    }
    const p = parsePeriod(snap.period);
    allowed.add(String(p.year)); allowed.add(String(p.year - 1)); allowed.add(formatVnDate(snap.cutoff_date));
    for (const e of snap.events) { for (const tok of `${e.object_id} ${formatVnDate(e.event_date)}`.match(/\d[\d.,/]*/g) ?? []) for (const t of tok.split('/')) allowed.add(t.replace(/[.,]$/, '')); }
    return allowed;
  }

  /** Hậu kiểm: số trong câu số và lời dẫn ⊆ allowed; tên kỳ trong lời văn khớp kỳ báo cáo. */
  postcheck(rendered: RenderedSlot[], snap: Snapshot): { errors: string[]; warnings: string[] } {
    const errors: string[] = []; const warnings: string[] = [];
    const allowed = this.allowedNumbers(snap);
    const p = parsePeriod(snap.period);
    for (const r of rendered) {
      const label = r.title ? `${r.section} ${r.title}` : r.slot_code;
      if (r.missing.length && r.slot_type !== 'narrative' && r.slot_type !== 'next_tasks' && r.slot_type !== 'event_list') errors.push(`${label}: thiếu ${r.missing.map((m) => snap.facts[m]?.name ?? m).join(', ')}`);
      if (['metric_sentence', 'metric_table', 'narrative', 'next_tasks'].includes(r.slot_type)) {
        for (const tok of r.text.match(/\d[\d.,]*/g) ?? []) {
          const t = tok.replace(/[.,]$/, '');
          if (!allowed.has(t) && !/^\d{1,2}$/.test(t)) (r.slot_type === 'narrative' || r.slot_type === 'next_tasks' ? errors : errors).push(`${label}: số "${t}" không có trong bộ số đã chốt`);
        }
      }
      for (const w of findPeriodWords(r.text, p.label)) warnings.push(`${label}: lời văn nhắc "${w}" trong khi kỳ báo cáo là ${p.label} (nhóm "Nhất quán kỳ")`);
    }
    return { errors, warnings };
  }

  /** Cây mục → dùng chung cho web (Đọc báo cáo) và Word. */
  buildTree(spec: ReportSpec, rendered: RenderedSlot[], snap: Snapshot): DocumentTree {
    const p = parsePeriod(snap.period);
    const sections: DocumentTree['sections'] = [];
    const seen = new Set<string>();
    const names = spec.sections ?? {};
    const ensure = (code: string) => {
      const parts = code.split('.');
      for (let i = 1; i <= parts.length; i++) {
        const c = parts.slice(0, i).join('.');
        if (seen.has(c)) continue; seen.add(c);
        sections.push({ code: c, title: names[c] ?? (i === 1 ? DEFAULT_TOP[c] ?? c : ''), depth: i, slots: [] });
      }
      return sections.find((s) => s.code === code)!;
    };
    const footnotes: string[] = [];
    for (const r of rendered) {
      const sec = ensure(r.section);
      sec.slots.push(r);
      for (const fn of r.footnotes ?? []) footnotes.push(fn);
    }
    for (const e of snap.exceptions ?? []) footnotes.push(`${snap.facts[e.indicator_id]?.name ?? e.indicator_id}: chốt số liệu khác ngày chốt chung — ${e.reason}.`);
    return { title: spec.title, period_label: p.label, cutoff: formatVnDate(snap.cutoff_date), sections, footnotes };
  }

  async render(input: { run: ReportRun; spec: ReportSpec; slots: ReportSlot[]; snapshot: Snapshot; tenant: { name: string; unit_type?: string; parent_name?: string | null } }): Promise<RenderOutput> {
    const { run, spec, slots, snapshot, tenant } = input;
    const p = parsePeriod(run.period);
    const rendered = this.renderSlots(slots, snapshot);
    const postcheck = this.postcheck(rendered, snapshot);
    const tree = this.buildTree(spec, rendered, snapshot);
    const unitName = `UBND ${tenant.unit_type === 'phuong' ? 'PHƯỜNG' : 'XÃ'} ${tendUpper(tenant.name)}`;
    const font = { font: 'Times New Roman', size: 28 };
    const P = (children: any[], o: Partial<{ align: any; after: number; indent: boolean; before: number }> = {}) =>
      new Paragraph({ alignment: o.align ?? AlignmentType.JUSTIFIED, spacing: { after: o.after ?? 120, before: o.before, line: 360 }, indent: o.indent === false ? undefined : { firstLine: 720 }, children });
    const T = (text: string, o: Partial<{ bold: boolean; italic: boolean; size: number }> = {}) => new TextRun({ text, bold: o.bold, italics: o.italic, ...font, size: o.size ?? font.size });

    // chú thích cuối trang: số thứ tự theo thứ tự xuất hiện
    const footnotes: Record<number, { children: Paragraph[] }> = {};
    let fnId = 0;
    const footnote = (text: string) => { fnId += 1; footnotes[fnId] = { children: [new Paragraph({ children: [new TextRun({ text, ...font, size: 20 })] })] }; return new FootnoteReferenceRun(fnId); };
    const exceptionBy = new Map((snapshot.exceptions ?? []).map((e) => [e.indicator_id, e.reason]));
    const footnotedExc = new Set<string>();

    const header = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders(), rows: [new TableRow({ children: [
      new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T(unitName, { size: 26 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T(run.signed_number ? `Số: ${run.signed_number}` : 'Số:        /BC-UBND', { size: 26 })] }) ] }),
      new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { bold: true, size: 26 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T('Độc lập - Tự do - Hạnh phúc', { bold: true, size: 26 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T(run.signed_date ? `${capital(tenant.name)}, ngày ${formatVnDate(run.signed_date)}` : `${capital(tenant.name)}, ngày      tháng      năm ${p.year}`, { italic: true, size: 26 })] }) ] }) ] })] });

    const children: any[] = [header, new Paragraph({ spacing: { after: 240 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [T('BÁO CÁO', { bold: true, size: 30 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [T(`${spec.title.replace(/^Báo cáo\s+/i, '')} ${p.label}`, { bold: true })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [T(`(Số liệu tính đến ngày ${formatVnDate(run.cutoff_date)})`, { italic: true, size: 26 })] }),
    ];

    for (const sec of tree.sections) {
      const title = sec.depth === 1 ? `${sec.code}. ${sec.title.toLocaleUpperCase('vi-VN')}` : `${sec.code}. ${sec.title}`;
      if (sec.title) children.push(P([T(title, { bold: sec.depth <= 2, italic: sec.depth >= 3 })], { align: AlignmentType.LEFT, indent: false, before: sec.depth === 1 ? 240 : 120 }));
      for (const r of sec.slots) {
        if (r.slot_type === 'metric_table' && r.table) {
          const cols = r.table.columns;
          const rows = [new TableRow({ tableHeader: true, children: cols.map((c) => new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [T(c, { bold: true, size: 24 })] })] })) }),
            ...r.table.rows.map((row) => new TableRow({ children: row.map((v, i) => new TableCell({ children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [T(v == null ? '—' : String(v), { size: 24 })] })] })) }))];
          children.push(P([T(r.title ?? 'Bảng tổng hợp', { italic: true })], { indent: false }));
          children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
          children.push(new Paragraph({ spacing: { after: 120 } }));
          continue;
        }
        if (!r.text && r.slot_type !== 'narrative' && r.slot_type !== 'next_tasks') continue;
        if (!r.text) { children.push(P([T(`[${r.section}${r.title ? ` ${r.title}` : ''}] (Văn phòng biên tập)`, { italic: true })])); continue; }
        const runs: any[] = [];
        for (const s of r.segments) {
          runs.push(T(s.text));
          if (s.kind === 'number' && s.ref?.indicator_id && exceptionBy.has(s.ref.indicator_id) && !footnotedExc.has(s.ref.indicator_id)) {
            footnotedExc.add(s.ref.indicator_id);
            runs.push(footnote(`${s.ref.name}: số liệu chốt ngày ${formatVnDate(s.ref.as_of_date ?? snapshot.cutoff_date)} — ${exceptionBy.get(s.ref.indicator_id)}.`));
          }
        }
        if (r.slot_type === 'metric_sentence') {
          const srcs = describeSources(r.segments);
          if (srcs) runs.push(footnote(`Nguồn: ${srcs}.`));
        }
        if (r.slot_type === 'event_list') for (const fn of r.footnotes ?? []) runs.push(footnote(fn));
        children.push(P(runs));
      }
    }
    children.push(new Paragraph({ spacing: { before: 480 } }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders(), rows: [new TableRow({ children: [
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [
        new Paragraph({ children: [T('Nơi nhận:', { bold: true, italic: true, size: 24 })] }),
        new Paragraph({ children: [T('- UBND thành phố (để báo cáo);', { size: 22 })] }),
        new Paragraph({ children: [T('- TT Đảng ủy, TT HĐND;', { size: 22 })] }),
        new Paragraph({ children: [T('- Lưu: VT.', { size: 22 })] }) ] }),
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders(), children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T('TM. ỦY BAN NHÂN DÂN', { bold: true, size: 26 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T('CHỦ TỊCH', { bold: true, size: 26 })] }) ] }) ] })] }));

    const doc = new Document({ footnotes, sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 } } }, children }] });
    const docx = await Packer.toBuffer(doc);
    return { docx, slots: rendered, document: tree, postcheck };
  }
}

const footnotedExc = new Set<string>();
const DEFAULT_TOP: Record<string, string> = { I: 'Công tác chỉ đạo, điều hành', II: 'Kết quả thực hiện', III: 'Nhiệm vụ trọng tâm kỳ tới' };

export function joinSegments(segments: Segment[]): string { return segments.map((s) => s.text).join('').replace(/\s+/g, ' ').trim(); }

function describeSources(segments: Segment[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const s of segments) {
    if (s.kind !== 'number' || !s.ref) continue;
    const sr = s.ref.source_ref ?? {};
    const key = sr.file_id ? `file ${sr.file_id}` : sr.system ? String(sr.system) : s.ref.capture_method ?? '';
    if (!key || seen.has(key)) continue; seen.add(key);
    const where = sr.sheet && sr.cell ? ` (${sr.sheet}!${sr.cell})` : sr.page ? ` (trang ${sr.page})` : '';
    const how = s.ref.capture_method === 'export' ? 'file xuất từ hệ thống' : s.ref.capture_method === 'pdf_text' ? 'văn bản điện tử' : s.ref.capture_method === 'ocr' ? 'bản scan' : s.ref.capture_method === 'api' ? 'kết nối hệ thống' : 'nhập trực tiếp';
    parts.push(`${how}${sr.file_id ? ` số ${sr.file_id}` : ''}${where}, chốt ngày ${formatVnDate(s.ref.as_of_date ?? '')}`);
  }
  return parts.join('; ');
}
function noBorders() { const b = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }; return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b }; }
function tendUpper(s: string) { return (s || '').replace(/^(Phường|Xã)\s+/i, '').toLocaleUpperCase('vi-VN'); }
function capital(s: string) { return (s || '').replace(/^(Phường|Xã)\s+/i, ''); }
