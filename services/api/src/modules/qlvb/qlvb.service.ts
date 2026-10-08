import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { QlvbDocument } from './qlvb-document.entity';
import { QlvbAdapter, QlvbDoc, ScheduleItem } from './qlvb-adapter';
import { LgspQlvbAdapter } from './lgsp-qlvb.adapter';
import { SimQlvbAdapter } from './sim-qlvb.adapter';
import { ReportRun } from '../reports/report-run.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { Task } from '../tasks/task.entity';
import { EventsService } from '../events/events.module';
import { TasksService } from '../tasks/tasks.service';
import { BronzeStorage } from '../bronze/bronze.module';
import { Actor } from '../facts/facts.service';
import { ReportsService } from '../reports/reports.service';
import { parsePeriod } from '../../common/period';
import { MANAGER_ROLES } from '../../common/roles';

interface DomainRule { domain: string; keywords: string[] }

/**
 * D5 — tích hợp QLVB qua adapter (LGSP thật hoặc giả lập):
 *  1. Trình ký bản nháp đã sinh (drafted → submitted) và nhận bản ký (→ signed: số, ký hiệu, ngày, file; khoá kỳ).
 *  2. Đồng bộ sổ văn bản đi/đến → qlvb_document → event_log (DOC) có lĩnh vực theo luật từ khoá.
 *  3. Phân công xử lý văn bản đến (nguoiXuLyEmail + hạn) → tasks (source_type 'qlvb') cho KPI.
 */
@Injectable()
export class QlvbService {
  private readonly logger = new Logger(QlvbService.name);

  constructor(
    @InjectRepository(QlvbDocument) private docs: Repository<QlvbDocument>,
    @InjectRepository(ReportRun) private runs: Repository<ReportRun>,
    @InjectRepository(AdminUser) private admins: Repository<AdminUser>,
    @InjectRepository(Task) private tasks: Repository<Task>,
    @InjectDataSource() private ds: DataSource,
    private lgsp: LgspQlvbAdapter,
    private sim: SimQlvbAdapter,
    private events: EventsService,
    private tasksService: TasksService,
    private storage: BronzeStorage,
    private reports: ReportsService,
  ) {}

  mode(): 'lgsp' | 'sim' { return (process.env.QLVB_MODE || '').toLowerCase() === 'lgsp' ? 'lgsp' : 'sim'; }
  private adapter(tenantId: string): QlvbAdapter { return this.mode() === 'lgsp' ? this.lgsp : this.sim.withTenant(tenantId); }

  status(tenantId: string) {
    const a = this.adapter(tenantId);
    return { mode: a.name, configured: a.configured(), organ_id: process.env.QLVB_ORGAN_ID || null, base_url: process.env.LGSP_QLVB_URL || 'https://apiv2.danang.gov.vn/LGSP/QLVBDH/1.0',
      sign_api: a.name === 'sim' ? 'giả lập' : 'LGSP chưa cung cấp', note: a.name === 'lgsp' && !a.configured() ? 'Thiếu LGSP_CONSUMER_KEY/SECRET hoặc QLVB_ORGAN_ID/KEY' : null };
  }

  private assertManager(actor: Actor, verb: string) {
    if (!(MANAGER_ROLES as readonly string[]).includes(actor.role)) throw new ForbiddenException(`Chỉ Văn phòng/quản trị được ${verb}.`);
  }

  // ── Phân loại lĩnh vực theo luật ─────────────────────────────────────────

  private rulesCache: { at: number; rules: DomainRule[] } | null = null;
  private domainRules(): DomainRule[] {
    if (this.rulesCache && Date.now() - this.rulesCache.at < 60_000) return this.rulesCache.rules;
    const dir = path.join(process.env.CONFIG_DIR || path.resolve(process.cwd(), '..', '..', 'config'), 'event-rules');
    let rules: DomainRule[] = [];
    try {
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)) : []) {
        const doc: any = yaml.load(fs.readFileSync(path.join(dir, f), 'utf-8'));
        for (const r of doc?.rules ?? []) if (r?.domain && Array.isArray(r.keywords)) rules.push({ domain: String(r.domain), keywords: r.keywords.map((k: unknown) => String(k).toLowerCase()) });
      }
    } catch (err) { this.logger.warn(`Không đọc được event-rules: ${err}`); }
    this.rulesCache = { at: Date.now(), rules };
    return rules;
  }

  classify(text: string): string | null {
    const t = (text ?? '').toLowerCase();
    for (const r of this.domainRules()) if (r.keywords.some((k) => t.includes(k))) return r.domain;
    return null;
  }

  // ── Sổ văn bản → event_log + task ────────────────────────────────────────

  async sync(actor: Actor, q: { start?: string; end?: string; period?: string }) {
    this.assertManager(actor, 'đồng bộ QLVB');
    let start = q.start, end = q.end;
    if (q.period) { const p = parsePeriod(q.period); start = p.start; end = p.end; }
    if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new BadRequestException('Cần start/end (YYYY-MM-DD) hoặc period.');
    const a = this.adapter(actor.tenant_id);
    if (!a.configured()) throw new BadRequestException('Adapter QLVB chưa cấu hình.');
    const summary = { mode: a.name, start, end, fetched: 0, upserted: 0, events_inserted: 0, events_skipped: 0, tasks_created: 0, tasks_completed: 0, schedule: 0 };
    for (const direction of ['den', 'di'] as const) {
      const list = await a.fetchDocuments(direction, start, end);
      summary.fetched += list.length;
      for (const d of list) {
        const row = await this.upsert(actor.tenant_id, a.name, d);
        if (row) summary.upserted++;
        const ev = await this.events.record(actor.tenant_id, [{
          object_type: 'DOC', object_id: d.so_ky_hieu || d.external_id, event_type: direction === 'di' ? 'ban_hanh' : 'tiep_nhan', event_date: d.ngay ?? start,
          domain: row?.domain ?? this.classify(`${d.loai ?? ''} ${d.trich_yeu ?? ''}`), payload: { so_ky_hieu: d.so_ky_hieu, loai: d.loai, trich_yeu: d.trich_yeu, nguoi_ky: d.nguoi_ky, direction },
          source_ref: { system: 'qlvb', adapter: a.name, external_id: d.external_id }, source_system: 'qlvb', external_id: `${direction}:${d.external_id}`,
        }]);
        summary.events_inserted += ev.inserted; summary.events_skipped += ev.skipped;
        if (direction === 'den' && row && d.nguoi_xu_ly_email) {
          const r = await this.assignTask(actor, row);
          if (r === 'created') summary.tasks_created++; else if (r === 'completed') summary.tasks_completed++;
        }
      }
    }
    try {
      const sched = await a.fetchSchedule(start, end);
      const r = await this.recordSchedule(actor.tenant_id, a.name, sched);
      summary.schedule = sched.length; summary.events_inserted += r.inserted; summary.events_skipped += r.skipped;
    } catch (err) { this.logger.warn(`[qlvb sync] lịch công tác: ${err}`); }
    this.logger.log(`[qlvb sync] ${a.name} ${start}..${end}: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** Lịch công tác → event_log (object_type MTG, event_type hop); không nhân đôi theo external_id. */
  recordSchedule(tenantId: string, adapter: string, items: ScheduleItem[]) {
    return this.events.record(tenantId, items.map((s) => ({
      object_type: 'MTG', object_id: s.title.slice(0, 200), event_type: 'hop', event_date: s.date, domain: this.classify(s.title),
      payload: { tieu_de: s.title, gio: s.time, dia_diem: s.location, thanh_phan: s.attendees }, source_ref: { system: 'qlvb', adapter, external_id: s.external_id, kind: 'lich_cong_tac' },
      source_system: 'qlvb', external_id: `lct:${s.external_id}`,
    })));
  }

  /** Giả lập: nạp lịch công tác mẫu (hoặc dán từ file export lịch). */
  async seedSchedule(actor: Actor, items: Array<Partial<ScheduleItem> & { date: string; title: string }>) {
    this.assertManager(actor, 'nạp lịch công tác');
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('Không có mục lịch nào.');
    for (const it of items) if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date ?? '') || !it.title) throw new BadRequestException('Mỗi mục cần date (YYYY-MM-DD) và title.');
    return this.recordSchedule(actor.tenant_id, 'sim', items.map((it, i) => ({ external_id: it.external_id ?? `sim-${it.date}-${i}-${it.title.slice(0, 20)}`, date: it.date, time: it.time ?? null, title: it.title, location: it.location ?? null, attendees: it.attendees ?? null })));
  }

  private async upsert(tenantId: string, source: string, d: QlvbDoc): Promise<QlvbDocument | null> {
    const domain = this.classify(`${d.loai ?? ''} ${d.trich_yeu ?? ''}`);
    const existing = await this.docs.findOne({ where: { tenant_id: tenantId, source, direction: d.direction, external_id: d.external_id } });
    if (existing) {
      // giả lập: dòng gốc chính là dòng sổ; thật: cập nhật trường có thể đổi (hoàn thành, hạn)
      if (source !== 'sim') await this.docs.update(existing.id, { so_ky_hieu: d.so_ky_hieu, ngay: d.ngay, loai: d.loai, trich_yeu: d.trich_yeu, nguoi_ky: d.nguoi_ky, nguoi_xu_ly_email: d.nguoi_xu_ly_email, han_xu_ly: d.han_xu_ly, ngay_hoan_thanh: d.ngay_hoan_thanh, domain, payload: (d.raw ?? {}) as any });
      else if (!existing.domain && domain) await this.docs.update(existing.id, { domain });
      return this.docs.findOne({ where: { id: existing.id } });
    }
    return this.docs.save(this.docs.create({ tenant_id: tenantId, direction: d.direction, external_id: d.external_id, so_ky_hieu: d.so_ky_hieu, ngay: d.ngay, loai: d.loai, trich_yeu: d.trich_yeu, nguoi_ky: d.nguoi_ky,
      nguoi_xu_ly_email: d.nguoi_xu_ly_email, han_xu_ly: d.han_xu_ly, ngay_hoan_thanh: d.ngay_hoan_thanh, domain, payload: (d.raw ?? {}) as any, source }));
  }

  /** Phân công xử lý văn bản đến → việc cho cán bộ (khớp email công vụ). Không nhân đôi: (source_type 'qlvb', source_id = qlvb_document.id). */
  private async assignTask(actor: Actor, doc: QlvbDocument): Promise<'created' | 'completed' | 'exists' | 'no_user'> {
    const assignee = await this.admins.findOne({ where: { tenant_id: actor.tenant_id, email: doc.nguoi_xu_ly_email!, is_active: true } });
    if (!assignee) return 'no_user';
    const existing = await this.tasks.findOne({ where: { tenant_id: actor.tenant_id, source_type: 'qlvb', source_id: doc.id } });
    if (existing) {
      if (doc.ngay_hoan_thanh && !['done', 'cancelled'].includes(existing.status)) { await this.tasks.update(existing.id, { status: 'done', completed_at: new Date(doc.ngay_hoan_thanh), result_note: 'Hoàn thành theo QLVB' }); return 'completed'; }
      return 'exists';
    }
    const created = await this.tasksService.create(actor, { title: `Xử lý văn bản ${doc.so_ky_hieu ?? doc.external_id}: ${(doc.trich_yeu ?? '').slice(0, 120)}`, description: `Phân công từ QLVB (${doc.loai ?? 'văn bản'}).`,
      assignee_id: assignee.id, due_at: doc.han_xu_ly ? `${doc.han_xu_ly}T17:00:00+07:00` : undefined, priority: 'normal', source_type: 'qlvb', source_id: doc.id });
    if (doc.ngay_hoan_thanh) { await this.tasks.update(created.id, { status: 'done', completed_at: new Date(doc.ngay_hoan_thanh), result_note: 'Hoàn thành theo QLVB' }); return 'completed'; }
    return 'created';
  }

  listDocuments(tenantId: string, q: { period?: string; direction?: string; limit?: number }) {
    const qb = this.docs.createQueryBuilder('d').where('d.tenant_id = :t', { t: tenantId }).orderBy('d.ngay', 'DESC', 'NULLS FIRST').addOrderBy('d.id', 'DESC').take(Math.min(500, q.limit || 200));
    if (q.period) { const p = parsePeriod(q.period); qb.andWhere('(d.ngay BETWEEN :a AND :b OR d.ngay IS NULL)', { a: p.start, b: p.end }); }
    if (q.direction) qb.andWhere('d.direction = :dir', { dir: q.direction });
    return qb.getMany();
  }

  /** Giả lập: nạp sổ văn bản mẫu (Văn phòng dán từ file export QLVB khi API gián đoạn cũng dùng đường này). */
  async seedSim(actor: Actor, items: Array<Partial<QlvbDoc> & { direction: 'den' | 'di' }>) {
    this.assertManager(actor, 'nạp sổ văn bản');
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('Không có văn bản nào.');
    let n = 0;
    for (const it of items) {
      if (!it.direction || !it.so_ky_hieu) throw new BadRequestException('Mỗi văn bản cần direction (den|di) và so_ky_hieu.');
      const ext = it.external_id || `${it.direction}-${it.so_ky_hieu}`;
      const row = await this.upsert(actor.tenant_id, 'sim', { external_id: ext, direction: it.direction, so_ky_hieu: it.so_ky_hieu, ngay: it.ngay ?? null, loai: it.loai ?? null, trich_yeu: it.trich_yeu ?? null,
        nguoi_ky: it.nguoi_ky ?? null, nguoi_xu_ly_email: it.nguoi_xu_ly_email ?? null, han_xu_ly: it.han_xu_ly ?? null, ngay_hoan_thanh: it.ngay_hoan_thanh ?? null, raw: {} });
      if (row) n++;
    }
    return { seeded: n };
  }

  // ── Trình ký / nhận bản ký ───────────────────────────────────────────────

  async submit(actor: Actor, runId: number, opts: { signer?: string; recipients?: string[] } = {}) {
    this.assertManager(actor, 'trình ký');
    const run = await this.runs.findOne({ where: { run_id: runId, tenant_id: actor.tenant_id } });
    if (!run) throw new NotFoundException('Không tìm thấy kỳ báo cáo.');
    if (run.status !== 'drafted' || !run.output_file) throw new BadRequestException(`Chỉ trình ký kỳ đã có bản nháp (hiện: ${run.status}).`);
    const a = this.adapter(actor.tenant_id);
    await this.reports.freezeNarratives(actor.tenant_id, run.run_id);
    const docx = await this.storage.buffer(run.output_file);
    const tenant = await this.ds.query('SELECT name FROM dim_tenant WHERE tenant_id = $1', [actor.tenant_id]);
    const title = `Báo cáo ${parsePeriod(run.period).label} — ${tenant?.[0]?.name ?? actor.tenant_id}`;
    const { external_id } = await a.submitForSignature({ tenant_id: actor.tenant_id, run_id: run.run_id, title, docx, file_name: run.output_file.split('/').pop() ?? 'bao-cao.docx', signer: opts.signer ?? null, recipients: opts.recipients ?? [] });
    await this.runs.update(run.run_id, { status: 'submitted', qlvb_doc_id: external_id });
    this.logger.log(`[qlvb submit] run #${run.run_id} → ${a.name}:${external_id}`);
    return this.runs.findOne({ where: { run_id: run.run_id } });
  }

  /** Hỏi QLVB bản đã ký chưa; ký rồi → ghi số/ngày/file, run.status = signed, event DOC ban_hanh. */
  async checkSigned(tenantId: string, runId: number) {
    const run = await this.runs.findOne({ where: { run_id: runId, tenant_id: tenantId } });
    if (!run) throw new NotFoundException('Không tìm thấy kỳ báo cáo.');
    if (run.status === 'signed') return { run, status: 'signed' as const };
    if (run.status !== 'submitted' || !run.qlvb_doc_id) throw new BadRequestException(`Kỳ chưa trình ký (hiện: ${run.status}).`);
    const a = this.adapter(tenantId);
    const st = await a.getSignStatus(tenantId, run.qlvb_doc_id);
    if (st.status === 'pending') return { run, status: 'pending' as const };
    if (st.status === 'rejected') {
      await this.runs.update(run.run_id, { status: 'drafted', qlvb_doc_id: null });
      return { run: await this.runs.findOne({ where: { run_id: run.run_id } }), status: 'rejected' as const, note: st.note ?? null };
    }
    const signedDate = st.ngay_ky ?? new Date().toISOString().slice(0, 10);
    const key = `reports/${tenantId}/${run.period}/signed-run-${run.run_id}-${Date.now()}.docx`;
    const buf = st.signed_file ?? (run.output_file ? await this.storage.buffer(run.output_file) : null);
    if (buf) await this.storage.put(key, buf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await this.runs.update(run.run_id, { status: 'signed', signed_number: st.so_ky_hieu ?? null, signed_date: signedDate, signed_file: buf ? key : null });
    await this.docs.update({ tenant_id: tenantId, external_id: run.qlvb_doc_id }, { signed_file: buf ? key : null }).catch(() => {});
    await this.events.record(tenantId, [{ object_type: 'DOC', object_id: st.so_ky_hieu ?? run.qlvb_doc_id, event_type: 'ban_hanh', event_date: signedDate, domain: null,
      payload: { so_ky_hieu: st.so_ky_hieu, loai: 'Báo cáo', trich_yeu: `Báo cáo ${parsePeriod(run.period).label}`, run_id: run.run_id, direction: 'di' },
      source_ref: { system: 'qlvb', adapter: a.name, external_id: run.qlvb_doc_id }, source_system: 'qlvb', external_id: `di:${run.qlvb_doc_id}` }]);
    this.logger.log(`[qlvb signed] run #${run.run_id}: ${st.so_ky_hieu} ngày ${signedDate}`);
    return { run: await this.runs.findOne({ where: { run_id: run.run_id } }), status: 'signed' as const };
  }

  /** 15 phút/lần: hỏi bản ký cho các kỳ đã trình. */
  @Cron('0 */15 * * * *')
  async pollSigned() {
    const submitted = await this.runs.find({ where: { status: 'submitted' } });
    for (const r of submitted) { try { await this.checkSigned(r.tenant_id, r.run_id); } catch (err) { this.logger.warn(`pollSigned #${r.run_id}: ${err}`); } }
  }

  /** 02:00 hằng ngày (chỉ khi nối LGSP thật): đồng bộ 7 ngày gần nhất cho mọi đơn vị có kỳ đang mở. */
  @Cron('0 2 * * *')
  async nightlySync() {
    if (this.mode() !== 'lgsp' || !this.lgsp.configured()) return;
    const tenants: Array<{ tenant_id: string }> = await this.ds.query(`SELECT DISTINCT tenant_id FROM report_run WHERE status = 'collecting'`);
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    for (const t of tenants) {
      const vp = await this.admins.findOne({ where: { tenant_id: t.tenant_id, role: 'commune_admin', is_active: true } });
      if (!vp) continue;
      try { await this.sync({ id: vp.id, role: vp.role, department: vp.department ?? null, tenant_id: t.tenant_id }, { start, end }); } catch (err) { this.logger.warn(`nightlySync ${t.tenant_id}: ${err}`); }
    }
  }

  async simSign(actor: Actor, docId: number, body: { so_ky_hieu?: string; nguoi_ky?: string; reject?: string; ngay_ky?: string }) {
    if (actor.role !== 'leader') this.assertManager(actor, 'ký giả lập');
    if (this.mode() !== 'sim') throw new BadRequestException('Chỉ dùng khi QLVB_MODE=sim.');
    return this.sim.sign(actor.tenant_id, docId, body ?? {});
  }
}
