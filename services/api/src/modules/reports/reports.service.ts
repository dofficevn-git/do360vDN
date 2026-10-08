import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReportRun } from './report-run.entity';
import { ReportSlot, ReportSpec } from '../catalog/report-spec.entity';
import { Indicator } from '../catalog/indicator.entity';
import { FactIndicator, FactStatusLog } from '../facts/fact-indicator.entity';
import { QualityGateService } from '../facts/quality-gate.service';
import { EventsService } from '../events/events.module';
import { Actor } from '../facts/facts.service';
import { parsePeriod, previousComparable, samePeriodLastYear } from '../../common/period';
import { PlansService } from '../plans/plans.module';
import { MANAGER_ROLES } from '../../common/roles';
import { ReportRenderer, RenderOutput, Snapshot, joinSegments } from './report-renderer';
import { ReportNarrative } from './report-narrative.entity';
import { LocalLlmWriter, TemplateWriter, WriterInput } from './narrative-writer';
import { findPeriodWords } from '../../common/gate-text';
import { BronzeStorage } from '../bronze/bronze.module';

const CAN_LOCK = [...MANAGER_ROLES] as string[]; // Văn phòng = commune_admin; super_admin khi vận hành

/**
 * D3 (chốt kỳ) + D4 (sinh báo cáo). Một report_run = một lần lập báo cáo của một đơn vị cho một kỳ.
 * collecting → (Quality Gate đạt) lock: đóng băng bộ số vào fact_snapshot, số chuyển `locked`
 *            → render: bản nháp .docx chỉ đọc snapshot → submitted/signed (D5).
 * unlock: chỉ quản trị/Văn phòng, phải có lý do; là thao tác duy nhất bật cờ `do360.allow_unlock` của trigger CSDL.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(ReportRun) private runs: Repository<ReportRun>,
    @InjectRepository(ReportNarrative) private narratives: Repository<ReportNarrative>,
    @InjectRepository(ReportSpec) private specs: Repository<ReportSpec>,
    @InjectRepository(ReportSlot) private slots: Repository<ReportSlot>,
    @InjectRepository(Indicator) private indicators: Repository<Indicator>,
    @InjectDataSource() private ds: DataSource,
    private gate: QualityGateService,
    private events: EventsService,
    private renderer: ReportRenderer,
    private storage: BronzeStorage,
    private plans: PlansService,
    private templateWriter: TemplateWriter,
    private llmWriter: LocalLlmWriter,
  ) {}

  private assertManager(actor: Actor, verb: string) {
    if (!CAN_LOCK.includes(actor.role)) throw new ForbiddenException(`Chỉ Văn phòng/quản trị được ${verb}.`);
  }

  async create(actor: Actor, dto: { spec_id: number; period: string; cutoff_date: string }) {
    this.assertManager(actor, 'tạo kỳ báo cáo');
    const p = parsePeriod(dto.period);
    const spec = await this.specs.findOne({ where: { id: dto.spec_id, is_active: true } });
    if (!spec) throw new BadRequestException('Mẫu báo cáo không tồn tại.');
    if (spec.period_types?.length && !spec.period_types.includes(p.type)) throw new BadRequestException(`Mẫu "${spec.title}" không áp dụng cho kỳ ${p.label}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.cutoff_date)) throw new BadRequestException('cutoff_date phải dạng YYYY-MM-DD.');
    const open = await this.runs.findOne({ where: { tenant_id: actor.tenant_id, spec_id: spec.id, period: dto.period } });
    if (open && open.status !== 'cancelled') throw new BadRequestException(`Kỳ ${dto.period} đã có lần lập báo cáo #${open.run_id} (${open.status}).`);
    return this.runs.save(this.runs.create({ tenant_id: actor.tenant_id, spec_id: spec.id, period: dto.period, cutoff_date: dto.cutoff_date, status: 'collecting', created_by: actor.id }));
  }

  /** HĐND (council) chỉ thấy kỳ đã chốt trở đi — không thấy số đang thu. */
  private static readonly READER_VISIBLE = ['locked', 'drafted', 'submitted', 'signed'];

  async list(tenantId: string, role?: string) {
    const rows = await this.runs.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' }, take: 100 });
    return role === 'council' ? rows.filter((r) => ReportsService.READER_VISIBLE.includes(r.status)) : rows;
  }

  async get(tenantId: string, runId: number, role?: string) {
    const run = await this.runs.findOne({ where: { run_id: runId, tenant_id: tenantId } });
    if (!run) throw new NotFoundException('Không tìm thấy lần lập báo cáo.');
    if (role === 'council' && !ReportsService.READER_VISIBLE.includes(run.status)) throw new ForbiddenException('Kỳ này chưa chốt — HĐND chỉ xem báo cáo đã chốt hoặc đã ký.');
    return run;
  }

  /** Tiến độ + Quality Gate hiện tại của kỳ (màn Văn phòng). */
  async status(tenantId: string, runId: number, role?: string) {
    const run = await this.get(tenantId, runId, role);
    const spec = await this.specs.findOne({ where: { id: run.spec_id } });
    const exceptions = (run.gate_report as any)?.exceptions ?? {};
    const narratives = await this.narrativeMap(run);
    const gate = await this.gate.evaluatePeriod(tenantId, run.period, run.spec_id, { cutoffDate: run.cutoff_date, exceptions, narratives });
    return { run, spec, gate };
  }

  /** Ghi ngoại lệ ngày chốt cho chỉ tiêu (lý do bắt buộc) — nhóm kiểm tra "Ngày chốt" sẽ hạ xuống cảnh báo. */
  async setException(actor: Actor, runId: number, indicatorId: string | string[], reason: string) {
    this.assertManager(actor, 'ghi ngoại lệ ngày chốt');
    const run = await this.get(actor.tenant_id, runId);
    if (run.status !== 'collecting') throw new BadRequestException('Kỳ đã chốt.');
    if (!reason?.trim()) throw new BadRequestException('Phải ghi lý do.');
    const ids = (Array.isArray(indicatorId) ? indicatorId : [indicatorId]).filter(Boolean);
    if (!ids.length) throw new BadRequestException('Thiếu chỉ tiêu.');
    const gr: any = run.gate_report ?? {};
    gr.exceptions = { ...(gr.exceptions ?? {}), ...Object.fromEntries(ids.map((id) => [id, reason.trim()])) };
    await this.runs.update(run.run_id, { gate_report: gr });
    return gr.exceptions;
  }

  /** Chốt kỳ: Quality Gate phải đạt; đóng băng snapshot; số approved → locked (trong 1 giao dịch). */
  async lock(actor: Actor, runId: number) {
    this.assertManager(actor, 'chốt kỳ');
    const run = await this.get(actor.tenant_id, runId);
    if (run.status !== 'collecting') throw new BadRequestException(`Kỳ đang ở trạng thái ${run.status}.`);
    const exceptions = (run.gate_report as any)?.exceptions ?? {};
    const gate = await this.gate.evaluatePeriod(actor.tenant_id, run.period, run.spec_id, { cutoffDate: run.cutoff_date, exceptions });
    if (!gate.ok) {
      await this.runs.update(run.run_id, { gate_report: { ...gate, exceptions, slots: undefined } });
      throw new BadRequestException({ message: `Chưa chốt được: ${gate.errors.length} lỗi Quality Gate.`, gate: { errors: gate.errors, warnings: gate.warnings } });
    }
    const spec = await this.specs.findOne({ where: { id: run.spec_id } });
    const slotRows = await this.slots.find({ where: { spec_id: run.spec_id } });
    const needed = new Set(slotRows.flatMap((s) => s.indicator_ids ?? []));
    const cur = await this.gate.currentFacts(actor.tenant_id, run.period);
    const meta = new Map((await this.indicators.find()).map((i) => [i.indicator_id, i]));
    const facts: Record<string, unknown> = {};
    const lockIds: string[] = [];
    for (const id of needed) {
      const f = cur.get(id); if (!f) continue;
      const full = await this.ds.getRepository(FactIndicator).findOne({ where: { id: f.id } });
      facts[id] = { fact_id: f.id, value: f.value, unit: meta.get(id)?.unit, value_type: meta.get(id)?.value_type, name: meta.get(id)?.name,
        as_of_date: f.as_of_date, capture_method: f.capture_method, source_ref: full?.source_ref ?? {}, approved_by: full?.approved_by ?? null, version: full?.version };
      lockIds.push(f.id);
    }
    const events = await this.events.inPeriod(actor.tenant_id, run.period);
    // So sánh đóng băng cùng snapshot: kế hoạch năm, cùng kỳ năm trước, kỳ trước cùng loại (bản ký tái lập được dù kế hoạch sửa sau)
    const p = parsePeriod(run.period);
    const plan = await this.plans.current(actor.tenant_id, p.year);
    const lastYear = await this.gate.currentFacts(actor.tenant_id, samePeriodLastYear(run.period), true);
    const prevCode = previousComparable(run.period);
    const prev = prevCode ? await this.gate.currentFacts(actor.tenant_id, prevCode, true) : new Map();
    const comparisons: Record<string, unknown> = {};
    for (const id of Object.keys(facts)) {
      const c: any = {};
      if (plan[id]) c.plan = { value: plan[id].value, year: p.year, source_ref: plan[id].source_ref };
      const ly = lastYear.get(id); if (ly) c.same_period_last_year = { value: ly.value, period: samePeriodLastYear(run.period), fact_id: ly.id };
      const pv = prevCode ? prev.get(id) : undefined; if (pv) c.previous = { value: pv.value, period: prevCode, fact_id: pv.id };
      if (Object.keys(c).length) comparisons[id] = c;
    }
    const snapshot = {
      tenant_id: actor.tenant_id, period: run.period, cutoff_date: run.cutoff_date, spec: `${spec?.spec_code}@${spec?.version}`,
      locked_at: new Date().toISOString(), locked_by: actor.id, facts,
      events: events.map((e) => ({ event_id: e.event_id, object_type: e.object_type, object_id: e.object_id, event_type: e.event_type, event_date: e.event_date, domain: e.domain, payload: e.payload })),
      exceptions: Object.entries(exceptions).map(([indicator_id, reason]) => ({ indicator_id, reason })),
      comparisons, narratives: {},
    };
    await this.ds.transaction(async (m) => {
      for (const id of lockIds) {
        await m.update(FactIndicator, id, { status: 'locked', locked_by: actor.id, locked_at: new Date() });
        await m.save(m.create(FactStatusLog, { tenant_id: actor.tenant_id, fact_id: id, from_status: 'approved', to_status: 'locked', actor_id: actor.id, reason: `Chốt kỳ #${run.run_id}` }));
      }
      await m.update(ReportRun, run.run_id, { status: 'locked', fact_snapshot: snapshot, gate_report: { ...gate, exceptions, slots: undefined }, locked_by: actor.id, locked_at: new Date() });
    });
    this.logger.log(`[lock] run #${run.run_id} ${run.period}: khoá ${lockIds.length} số, ${events.length} sự kiện`);
    return this.get(actor.tenant_id, run.run_id);
  }

  /** Mở lại kỳ đã chốt (chưa trình ký): số locked → approved, snapshot giữ lại trong gate_report.history để truy vết. */
  async unlock(actor: Actor, runId: number, reason: string) {
    this.assertManager(actor, 'mở lại kỳ');
    if (!reason?.trim()) throw new BadRequestException('Phải ghi lý do mở lại kỳ.');
    const run = await this.get(actor.tenant_id, runId);
    if (!['locked', 'drafted'].includes(run.status)) throw new BadRequestException(`Không mở lại được kỳ ở trạng thái ${run.status}${run.status === 'submitted' || run.status === 'signed' ? ' (đã trình ký)' : ''}.`);
    const ids = Object.values((run.fact_snapshot as any)?.facts ?? {}).map((f: any) => String(f.fact_id));
    await this.ds.transaction(async (m) => {
      await m.query(`SELECT set_config('do360.allow_unlock', 'on', true)`);
      for (const id of ids) {
        await m.update(FactIndicator, id, { status: 'approved', locked_by: null, locked_at: null });
        await m.save(m.create(FactStatusLog, { tenant_id: actor.tenant_id, fact_id: id, from_status: 'locked', to_status: 'approved', actor_id: actor.id, reason: `Mở lại kỳ #${run.run_id}: ${reason.trim()}` }));
      }
      const gr: any = run.gate_report ?? {};
      gr.history = [...(gr.history ?? []), { unlocked_at: new Date().toISOString(), by: actor.id, reason: reason.trim(), snapshot: run.fact_snapshot }];
      await m.update(ReportRun, run.run_id, { status: 'collecting', fact_snapshot: null, output_file: null, gate_report: gr, locked_by: null, locked_at: null });
    });
    return this.get(actor.tenant_id, run.run_id);
  }

  /**
   * Huỷ một lần lập báo cáo (lập nhầm kỳ/mẫu, hoặc thu hồi bản đã trình). Chỉ super_admin, phải có lý do.
   * Số đang `locked` của kỳ được trả về `approved` (bật cờ allow_unlock trong giao dịch); snapshot giữ trong gate_report.history.
   */
  async cancel(actor: Actor, runId: number, reason: string) {
    if (actor.role !== 'super_admin') throw new ForbiddenException('Chỉ quản trị hệ thống được huỷ kỳ báo cáo.');
    if (!reason?.trim()) throw new BadRequestException('Phải ghi lý do huỷ.');
    const run = await this.get(actor.tenant_id, runId);
    if (run.status === 'cancelled') return run;
    const ids = Object.values((run.fact_snapshot as any)?.facts ?? {}).map((f: any) => String(f.fact_id));
    await this.ds.transaction(async (m) => {
      await m.query(`SELECT set_config('do360.allow_unlock', 'on', true)`);
      for (const id of ids) {
        const cur = await m.findOne(FactIndicator, { where: { id } });
        if (cur?.status !== 'locked') continue;
        await m.update(FactIndicator, id, { status: 'approved', locked_by: null, locked_at: null });
        await m.save(m.create(FactStatusLog, { tenant_id: actor.tenant_id, fact_id: id, from_status: 'locked', to_status: 'approved', actor_id: actor.id, reason: `Huỷ kỳ #${run.run_id}: ${reason.trim()}` }));
      }
      const gr: any = run.gate_report ?? {};
      gr.history = [...(gr.history ?? []), { cancelled_at: new Date().toISOString(), by: actor.id, reason: reason.trim(), status_before: run.status, snapshot: run.fact_snapshot, signed_number: run.signed_number }];
      await m.update(ReportRun, run.run_id, { status: 'cancelled', gate_report: gr });
    });
    this.logger.warn(`[cancel] run #${run.run_id} ${run.period} (${run.status}) bởi ${actor.id}: ${reason.trim()}`);
    return this.get(actor.tenant_id, run.run_id);
  }

  /** D4 — sinh bản nháp .docx từ snapshot (không đọc kho sống). */
  async render(actor: Actor, runId: number): Promise<RenderOutput & { run: ReportRun }> {
    this.assertManager(actor, 'sinh bản nháp');
    const run = await this.get(actor.tenant_id, runId);
    if (!run.fact_snapshot) throw new BadRequestException('Kỳ chưa chốt — chốt kỳ trước khi sinh bản nháp.');
    const spec = await this.specs.findOne({ where: { id: run.spec_id } });
    const slots = await this.slots.find({ where: { spec_id: run.spec_id }, order: { ord: 'ASC' } });
    const tenant = await this.ds.query('SELECT name, unit_type, parent_name FROM dim_tenant WHERE tenant_id = $1', [actor.tenant_id]);
    const snapshot = { ...(run.fact_snapshot as any), narratives: await this.narrativeMap(run) } as Snapshot;
    const out = await this.renderer.render({ run, spec: spec!, slots, snapshot, tenant: tenant?.[0] ?? { name: actor.tenant_id } });
    if (out.postcheck.errors.length) {
      throw new BadRequestException({ message: `Hậu kiểm bản nháp thất bại: ${out.postcheck.errors.length} chỗ số không khớp snapshot.`, postcheck: out.postcheck });
    }
    const key = `reports/${actor.tenant_id}/${run.period}/run-${run.run_id}-${Date.now()}.docx`;
    await this.storage.put(key, out.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await this.runs.update(run.run_id, { fact_snapshot: snapshot as any });
    await this.runs.update(run.run_id, { output_file: key, status: run.status === 'locked' ? 'drafted' : run.status });
    return { ...out, run: await this.get(actor.tenant_id, run.run_id) };
  }

  // ── Lời dẫn (A2) ─────────────────────────────────────────────────────────

  /** Bản accepted mới nhất của từng slot — nguồn cho render và gate nhất quán kỳ. Đã trình ký → đọc bản đóng băng. */
  async narrativeMap(run: ReportRun): Promise<Record<string, string>> {
    if (['submitted', 'signed'].includes(run.status) && (run.fact_snapshot as any)?.narratives) return (run.fact_snapshot as any).narratives;
    const rows = await this.narratives.find({ where: { run_id: run.run_id, status: 'accepted' }, order: { version: 'DESC' } });
    const out: Record<string, string> = {};
    for (const r of rows) if (!(r.slot_code in out)) out[r.slot_code] = r.text;
    return out;
  }

  /** Snapshot để hậu kiểm/preview: đã chốt → snapshot thật; đang thu số → dựng tạm từ số hiện hành (đánh dấu live). */
  private async workingSnapshot(run: ReportRun): Promise<Snapshot & { live?: boolean }> {
    const narratives = await this.narrativeMap(run);
    if (run.fact_snapshot) return { ...(run.fact_snapshot as any), narratives };
    const cur = await this.gate.currentFacts(run.tenant_id, run.period);
    const meta = new Map((await this.indicators.find()).map((i) => [i.indicator_id, i]));
    const facts: Record<string, any> = {};
    cur.forEach((f, id) => { facts[id] = { fact_id: f.id, value: f.value, unit: meta.get(id)?.unit, value_type: meta.get(id)?.value_type, name: meta.get(id)?.name, as_of_date: f.as_of_date, capture_method: f.capture_method, source_ref: { snippet: f.snippet } }; });
    const events = await this.events.inPeriod(run.tenant_id, run.period);
    const exceptions = (run.gate_report as any)?.exceptions ?? {};
    return { period: run.period, cutoff_date: run.cutoff_date, spec: String(run.spec_id), facts, narratives, live: true,
      events: events.map((e) => ({ object_id: e.object_id, object_type: e.object_type, event_type: e.event_type, event_date: e.event_date, domain: e.domain, payload: e.payload })),
      exceptions: Object.entries(exceptions).map(([indicator_id, reason]) => ({ indicator_id, reason: String(reason) })) };
  }

  /** Cây tài liệu để web hiện "Đọc báo cáo" (cùng hàm render với Word → cái thấy = cái ký). */
  async preview(tenantId: string, runId: number, role?: string) {
    const run = await this.get(tenantId, runId, role);
    const spec = await this.specs.findOne({ where: { id: run.spec_id } });
    const slots = await this.slots.find({ where: { spec_id: run.spec_id }, order: { ord: 'ASC' } });
    const snapshot = await this.workingSnapshot(run);
    const rendered = this.renderer.renderSlots(slots, snapshot);
    const postcheck = this.renderer.postcheck(rendered, snapshot);
    const document = this.renderer.buildTree(spec!, rendered, snapshot);
    const tenant = await this.ds.query('SELECT name, unit_type, parent_name FROM dim_tenant WHERE tenant_id = $1', [tenantId]);
    return { run, spec, document, postcheck, live: !!snapshot.live, tenant: tenant?.[0] ?? null, comparisons: snapshot.comparisons ?? {} };
  }

  private async narrativeSlots(run: ReportRun) {
    return (await this.slots.find({ where: { spec_id: run.spec_id }, order: { ord: 'ASC' } })).filter((s) => s.slot_type === 'narrative' || s.slot_type === 'next_tasks');
  }

  /** Hậu kiểm một đoạn lời dẫn: số lạ → errors; tên kỳ lệch → warnings. */
  private checkNarrative(text: string, snapshot: Snapshot) {
    const allowed = this.renderer.allowedNumbers(snapshot);
    const p = parsePeriod(snapshot.period);
    const errors: string[] = []; const warnings: string[] = [];
    for (const tok of text.match(/\d[\d.,]*/g) ?? []) { const t = tok.replace(/[.,]$/, ''); if (!allowed.has(t) && !/^\d{1,2}$/.test(t)) errors.push(`Số "${t}" không có trong bộ số của kỳ — lời dẫn không được nêu số mới.`); }
    for (const w of findPeriodWords(text, p.label)) warnings.push(`Lời văn nhắc "${w}" trong khi đây là báo cáo ${p.label}.`);
    return { errors, warnings };
  }

  /** Danh sách slot lời dẫn kèm bản hiện hành, bản nháp mới nhất và 3 gợi ý (khuôn câu, lời kỳ trước, sự kiện). */
  async listNarratives(tenantId: string, runId: number, role?: string) {
    const run = await this.get(tenantId, runId, role);
    const spec = await this.specs.findOne({ where: { id: run.spec_id } });
    const slots = await this.narrativeSlots(run);
    const snapshot = await this.workingSnapshot(run);
    const rows = await this.narratives.find({ where: { run_id: run.run_id }, order: { version: 'DESC' } });
    // lời kỳ trước: run gần nhất cùng mẫu (ưu tiên cùng loại kỳ) đã có bản accepted
    const prevRuns = await this.runs.find({ where: { tenant_id: tenantId, spec_id: run.spec_id }, order: { created_at: 'DESC' } });
    const p = parsePeriod(run.period);
    const candidates = prevRuns.filter((r) => r.run_id !== run.run_id && r.status !== 'cancelled').sort((a, b) => (parsePeriod(b.period).type === p.type ? 1 : 0) - (parsePeriod(a.period).type === p.type ? 1 : 0));
    const prevMaps: Record<string, { text: string; period: string }> = {};
    for (const r of candidates) { const m = await this.narrativeMap(r); for (const [k, v] of Object.entries(m)) if (!(k in prevMaps)) prevMaps[k] = { text: v, period: r.period }; }
    const allRendered = this.renderer.renderSlots(await this.slots.find({ where: { spec_id: run.spec_id }, order: { ord: 'ASC' } }), snapshot);
    const out = [];
    for (const s of slots) {
      const mine = rows.filter((r) => r.slot_code === s.slot_code);
      const accepted = mine.find((r) => r.status === 'accepted') ?? null;
      const latest = mine[0] ?? null;
      const tpl = s.slot_type === 'next_tasks' ? { text: await this.suggestNextTasks(tenantId, snapshot, s.narrative_template ? this.renderer.fillTemplate(s.narrative_template, snapshot).text : '') } : s.narrative_template ? this.renderer.fillTemplate(s.narrative_template, snapshot) : null;
      const prev = prevMaps[s.slot_code] ?? null;
      const prevText = prev ? prev.text.replace(new RegExp(parsePeriod(prev.period).label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), p.label) : null;
      const top = s.section.split('.')[0];
      const metric = allRendered.filter((r) => r.section.split('.')[0] === top && (r.slot_type === 'metric_sentence')).map((r) => r.text).filter(Boolean);
      const domainOfSection = allRendered.filter((r) => r.section.split('.')[0] === top).flatMap((r) => r.segments.map((g) => g.ref?.indicator_id?.split('.')[0]).filter(Boolean));
      const events = snapshot.events.filter((e) => !domainOfSection.length || !e.domain || domainOfSection.includes(e.domain)).map((e) => `${e.payload?.loai ?? 'Văn bản'} số ${e.object_id} ngày ${formatVnDateSafe(e.event_date)}${e.payload?.trich_yeu ? ` về ${e.payload.trich_yeu}` : ''}`);
      out.push({ slot_code: s.slot_code, title: s.title, section: s.section, section_title: spec?.sections?.[s.section] ?? null, slot_type: s.slot_type, owner_dept: s.owner_dept,
        accepted: accepted ? { id: accepted.id, text: accepted.text, version: accepted.version, source: accepted.source, author_id: accepted.author_id, created_at: accepted.created_at } : null,
        latest: latest ? { id: latest.id, text: latest.text, version: latest.version, status: latest.status, source: latest.source, postcheck: latest.postcheck, author_id: latest.author_id, created_at: latest.created_at } : null,
        suggestions: { template: tpl?.text ?? null, previous: prevText ? { text: prevText, period: prev!.period, period_label: parsePeriod(prev!.period).label } : null, events, metric_sentences: metric },
        llm_enabled: this.llmWriter.enabled(), editable: !['submitted', 'signed', 'cancelled'].includes(run.status) });
    }
    return { run_id: run.run_id, status: run.status, period_label: p.label, slots: out };
  }

  /**
   * Nhiệm vụ kỳ tới CHỈ LÀ GỢI Ý (thiết kế 03/10 mục 9): rút theo luật từ chỉ tiêu chưa đạt kế hoạch năm (snapshot.comparisons),
   * nhiệm vụ còn mở/quá hạn và văn bản đến chưa xử lý; Văn phòng biên tập, lãnh đạo quyết. Mọi số nêu ra đều thuộc bộ số (qua hậu kiểm).
   */
  async suggestNextTasks(tenantId: string, snapshot: any, fallback = ''): Promise<string> {
    const parts: string[] = [];
    const below: string[] = [];
    for (const [id, c] of Object.entries((snapshot.comparisons ?? {}) as Record<string, any>)) {
      const f = snapshot.facts?.[id]; if (!f || !c?.plan?.value) continue;
      const pct = (f.value / c.plan.value) * 100;
      if (pct < 100) below.push([pct, `${String(f.name).toLowerCase()} (đạt ${pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}% kế hoạch)`] as any);
    }
    // chỉ tiêu xa kế hoạch nhất lên trước; mỗi chỉ tiêu một mệnh đề
    const belowSorted = (below as any[]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    if (belowSorted.length) parts.push(`Tập trung hoàn thành các chỉ tiêu chưa đạt kế hoạch năm: ${belowSorted.slice(0, 6).join('; ')}.`);
    const [t] = await this.ds.query(`SELECT COUNT(*) FILTER (WHERE status IN ('new','in_progress'))::int AS open, COUNT(*) FILTER (WHERE status IN ('new','in_progress') AND due_at < now())::int AS overdue FROM tasks WHERE tenant_id = $1`, [tenantId]);
    if (t?.open) parts.push(`Giải quyết dứt điểm ${t.open} nhiệm vụ còn mở${t.overdue ? `, trong đó ${t.overdue} nhiệm vụ đã quá hạn` : ''}.`);
    const [d] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM qlvb_document WHERE tenant_id = $1 AND direction = 'den' AND han_xu_ly IS NOT NULL AND ngay_hoan_thanh IS NULL`, [tenantId]);
    if (d?.n) parts.push(`Hoàn thành xử lý ${d.n} văn bản đến còn trong hạn theo phân công trên QLVB.`);
    if (!parts.length) return fallback;
    return `${parts.join(' ')}${fallback ? ` ${fallback.trim()}` : ''}`.trim();
  }

  async saveNarrative(actor: Actor, runId: number, slotCode: string, text: string, source = 'edited') {
    const run = await this.get(actor.tenant_id, runId);
    if (['submitted', 'signed', 'cancelled'].includes(run.status)) throw new BadRequestException('Kỳ đã trình ký — lời dẫn đã đóng băng.');
    const slot = (await this.narrativeSlots(run)).find((s) => s.slot_code === slotCode);
    if (!slot) throw new BadRequestException('Mục này không phải lời dẫn.');
    const isManager = (MANAGER_ROLES as readonly string[]).includes(actor.role) || actor.role === 'leader';
    if (!isManager && (!slot.owner_dept || slot.owner_dept !== actor.department)) throw new ForbiddenException('Chỉ phòng chủ mục hoặc Văn phòng được soạn lời dẫn này.');
    const clean = (text ?? '').trim();
    if (!clean) throw new BadRequestException('Lời dẫn trống.');
    const snapshot = await this.workingSnapshot(run);
    const pc = this.checkNarrative(clean, snapshot);
    if (pc.errors.length) throw new BadRequestException({ message: 'Lời dẫn có số không thuộc bộ số của kỳ.', postcheck: pc });
    const last = await this.narratives.findOne({ where: { run_id: run.run_id, slot_code: slotCode }, order: { version: 'DESC' } });
    const row = await this.narratives.save(this.narratives.create({ run_id: run.run_id, slot_code: slotCode, version: (last?.version ?? 0) + 1, text: clean, source: isManager ? source : 'dept', status: 'draft', postcheck: pc, author_id: actor.id }));
    return { ...row, postcheck: pc };
  }

  /** Văn phòng chấp nhận bản nháp mới nhất (thêm một phiên bản accepted — không sửa dòng cũ). */
  async acceptNarrative(actor: Actor, runId: number, slotCode: string) {
    this.assertManager(actor, 'chấp nhận lời dẫn');
    const run = await this.get(actor.tenant_id, runId);
    if (['submitted', 'signed', 'cancelled'].includes(run.status)) throw new BadRequestException('Kỳ đã trình ký — lời dẫn đã đóng băng.');
    const last = await this.narratives.findOne({ where: { run_id: run.run_id, slot_code: slotCode }, order: { version: 'DESC' } });
    if (!last) throw new BadRequestException('Chưa có bản nháp để chấp nhận.');
    if (last.status === 'accepted') return last;
    const snapshot = await this.workingSnapshot(run);
    const pc = this.checkNarrative(last.text, snapshot);
    if (pc.errors.length) throw new BadRequestException({ message: 'Bản nháp có số không thuộc bộ số của kỳ — sửa trước khi chấp nhận.', postcheck: pc });
    return this.narratives.save(this.narratives.create({ run_id: run.run_id, slot_code: slotCode, version: last.version + 1, text: last.text, source: last.source, status: 'accepted', postcheck: pc, author_id: actor.id }));
  }

  /** Gợi ý lời dẫn bằng writer (template mặc định; llm khi bật) → lưu thành bản nháp đã hậu kiểm. */
  async suggestNarrative(actor: Actor, runId: number, slotCode: string, provider: 'template' | 'llm' = 'template') {
    const run = await this.get(actor.tenant_id, runId);
    const list = await this.listNarratives(actor.tenant_id, runId);
    const s = list.slots.find((x) => x.slot_code === slotCode);
    if (!s) throw new BadRequestException('Mục này không phải lời dẫn.');
    const writer = provider === 'llm' ? this.llmWriter : this.templateWriter;
    if (!writer.enabled()) throw new BadRequestException('Mô hình ngôn ngữ cục bộ chưa bật (LLM_URL).');
    const input: WriterInput = { slot_code: s.slot_code, slot_title: s.title, section: s.section, period_label: list.period_label, template_text: s.suggestions.template, metric_sentences: s.suggestions.metric_sentences, previous_text: s.suggestions.previous?.text ?? null, events: s.suggestions.events };
    const r = await writer.suggest(input);
    const saved = await this.saveNarrative(actor, run.run_id, slotCode, r.text, writer.name === 'llm' ? 'llm' : 'template');
    return { ...saved, note: r.note };
  }

  /** Đóng băng lời dẫn vào snapshot khi trình ký (QlvbService gọi). */
  async freezeNarratives(tenantId: string, runId: number) {
    const run = await this.get(tenantId, runId);
    const narratives = await this.narrativeMap(run);
    await this.runs.update(run.run_id, { fact_snapshot: { ...(run.fact_snapshot as any), narratives } });
    return narratives;
  }

  async download(tenantId: string, runId: number, which: 'draft' | 'edited' | 'signed' = 'draft') {
    const run = await this.get(tenantId, runId, undefined);
    const key = which === 'edited' ? run.edited_file : which === 'signed' ? run.signed_file : run.output_file;
    if (!key) throw new NotFoundException(which === 'edited' ? 'Chưa có bản biên tập.' : which === 'signed' ? 'Chưa có bản ký.' : 'Chưa có bản nháp.');
    return { run, stream: await this.storage.stream(key), key };
  }

  /**
   * D4 — tải lại bản Word Văn phòng đã biên tập để ĐỐI CHIẾU với snapshot: mọi số của snapshot có trong bản nháp phải còn
   * nguyên trong bản biên tập (thiếu/đổi → lỗi); số lạ xuất hiện thêm (không từ kho, không phải năm/ngày/số mục) → cảnh báo
   * để Văn phòng soát. Văn bản đọc qua services/reader (/parse). Kết quả lưu run.edited_check, file lưu MinIO.
   */
  async checkEdited(actor: Actor, runId: number, file: { buffer: Buffer; originalname: string }) {
    this.assertManager(actor, 'đối chiếu bản biên tập');
    const run = await this.get(actor.tenant_id, runId);
    if (!run.fact_snapshot) throw new BadRequestException('Kỳ chưa chốt — không có snapshot để đối chiếu.');
    if (!/\.docx$/i.test(file.originalname)) throw new BadRequestException('Chỉ nhận file .docx.');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'edited.docx');
    const readerUrl = (process.env.READER_URL || 'http://localhost:8000').replace(/\/$/, '');
    let parsed: any;
    try {
      const res = await fetch(`${readerUrl}/parse`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
      parsed = await res.json();
      if (!res.ok) throw new Error(parsed?.detail ?? `HTTP ${res.status}`);
    } catch (err) { throw new BadRequestException(`Không đọc được file: ${err}`); }
    const text = [...(parsed.blocks ?? []).map((b: any) => b.text), ...(parsed.tables ?? []).flatMap((t: any) => t.cells.map((c: any) => c.text))].join('\n');
    const snap = run.fact_snapshot as any;
    const slots = await this.slots.find({ where: { spec_id: run.spec_id }, order: { ord: 'ASC' } });
    const draft = this.renderer.renderSlots(slots, snap);
    const numsOf = (s: string) => (s.match(/\d[\d.,]*/g) ?? []).map((t) => t.replace(/[.,]$/, '')).filter((t) => !/^\d{1,2}$/.test(t));
    const editedNums = new Set(numsOf(text));
    const draftNums = new Set(draft.flatMap((d) => numsOf(d.text)));
    const allowed = new Set<string>(draftNums);
    const p = parsePeriod(run.period);
    allowed.add(String(p.year)); allowed.add(String(p.year - 1)); allowed.add(String(p.year + 1));
    for (const f of Object.values(snap.facts ?? {}) as any[]) { allowed.add(String(f.value)); }
    if (run.signed_number) for (const t of numsOf(run.signed_number)) allowed.add(t);
    const dateLike = new Set(text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g)?.flatMap((d) => numsOf(d)) ?? []);
    // số mục "II.3.4", "1.2" (nhóm ≤ 2 chữ số) — không bắt nhầm số có dấu chấm nghìn như "4.808"
    const sectionLike = new Set([...(text.match(/\b[IVX]+\.\d{1,2}(?:\.\d{1,2})*\b/g) ?? []), ...(text.match(/(?<![\d.])\d{1,2}\.\d{1,2}(?:\.\d{1,2})*(?![\d.])/g) ?? [])].flatMap((d) => numsOf(d)));
    const missing = [...draftNums].filter((n) => !editedNums.has(n));
    const unknown = [...editedNums].filter((n) => !allowed.has(n) && !dateLike.has(n) && !sectionLike.has(n));
    const key = `reports/${actor.tenant_id}/${run.period}/edited-run-${run.run_id}-${Date.now()}.docx`;
    await this.storage.put(key, file.buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const check = { checked_at: new Date().toISOString(), by: actor.id, file: Buffer.from(file.originalname, 'latin1').toString('utf8'), ok: missing.length === 0, missing, unknown, draft_numbers: draftNums.size, edited_numbers: editedNums.size };
    await this.runs.update(run.run_id, { edited_file: key, edited_check: check });
    this.logger.log(`[edited] run #${run.run_id}: thiếu ${missing.length}, số lạ ${unknown.length}`);
    return check;
  }
}

function formatVnDateSafe(iso: string | null | undefined): string { return iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''; }
