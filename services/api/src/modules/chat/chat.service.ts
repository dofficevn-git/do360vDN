import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationGateway } from './notification-gateway';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AttachmentRef, CHAT_CHANNEL, Card, ChatChannel, InboundEvent, StaffRef } from './chat-channel';
import { ChatMessage } from './chat-message.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { Department } from '../departments/department.entity';
import { ReportRun } from '../reports/report-run.entity';
import { Indicator } from '../catalog/indicator.entity';
import { SourceFile } from '../bronze/source-file.entity';
import { Task } from '../tasks/task.entity';
import { QualityGateService } from '../facts/quality-gate.service';
import { Actor, FactsService, IngestOutcome } from '../facts/facts.service';
import { BronzeService } from '../bronze/bronze.module';
import { ExtractService } from '../extract/extract.module';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { parseVnNumber } from '../../common/expr';
import { formatVnDate } from '../../common/format';

const PERIOD_RE = /\b(\d{4}-(?:M\d{2}|Q[1-4]|6M|9M|Y))\b/i;
/** "chốt 12/09/2026" hoặc "12/9/2026" trong lời nhắn kèm file → ngày chốt số liệu của file. */
const VN_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
function asOfFromText(text: string | undefined): string | null {
  const m = VN_DATE_RE.exec(text ?? ''); if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
const HELP = 'Lệnh: "XN <mã>" xác nhận số · "SUA <mã> = <số>" sửa số · "LOAI <mã> <lý do>" loại số · "NHAP <mã chỉ tiêu> = <số> [kỳ] [ngày dd/mm/yyyy]" nhập số không có file · "TIEN DO" chỉ tiêu còn thiếu. Gửi file Excel/Word/PDF/ảnh kèm mã kỳ (vd 2026-Q3) để bóc số.';

/**
 * T4 — nghiệp vụ Tabot trên kênh chat: nhận file → Bronze → bóc tách → thẻ xác nhận; lệnh xác nhận/sửa/loại/nhập;
 * thẻ form (hỏi số còn thiếu), nhắc hạn chốt và việc sắp đến hạn; báo Data Owner khi số bị cách ly.
 * Chỉ gọi ChatChannel, không biết Zalo hay Tammi. Tin ra/vào đều ghi chat_message (gửi được hay không).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CHAT_CHANNEL) private channel: ChatChannel,
    @InjectRepository(ChatMessage) private messages: Repository<ChatMessage>,
    @InjectRepository(AdminUser) private admins: Repository<AdminUser>,
    @InjectRepository(Department) private departments: Repository<Department>,
    @InjectRepository(ReportRun) private runs: Repository<ReportRun>,
    @InjectRepository(Indicator) private indicators: Repository<Indicator>,
    @InjectRepository(Task) private tasks: Repository<Task>,
    private gate: QualityGateService,
    private facts: FactsService,
    private bronze: BronzeService,
    private extract: ExtractService,
    private staffNotifications: StaffNotificationsService,
  ) {}

  webUrl() {
    return (process.env.WEB_PUBLIC_URL || (process.env.CORS_ORIGINS || '').split(',')[0] || 'http://localhost:3071').replace(/\/$/, '');
  }

  /** Liên kết trong thẻ: LUÔN về DO360 Web (Blueprint V0.5 mục 65.6: không dùng Mini App; deep link kiểm quyền lại khi mở). */
  deepLink(webPath: string, _appPath?: string) {
    return `${this.webUrl()}${webPath}`;
  }

  async status(tenantId: string) {
    const configured = await this.channel.configured();
    const linked = await this.admins.count({ where: { tenant_id: tenantId, is_active: true } });
    const linkedChat = await this.admins.createQueryBuilder('a').where('a.tenant_id = :t AND a.is_active = true AND a.zalo_follower_id IS NOT NULL', { t: tenantId }).getCount();
    const [sent, failed, inbound] = await Promise.all([
      this.messages.count({ where: { tenant_id: tenantId, direction: 'out', status: 'sent' } }),
      this.messages.count({ where: { tenant_id: tenantId, direction: 'out', status: In(['failed', 'skipped']) } }),
      this.messages.count({ where: { tenant_id: tenantId, direction: 'in' } }),
    ]);
    return { channel: this.channel.name, configured, web_url: this.webUrl(), staff_total: linked, staff_linked: linkedChat, sent, failed, inbound };
  }

  recent(tenantId: string, limit = 50) {
    return this.messages.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' }, take: Math.min(200, limit) });
  }

  // ── Người nhận ───────────────────────────────────────────────────────────

  private toRef(a: AdminUser): StaffRef {
    return { admin_id: a.id, tenant_id: a.tenant_id!, full_name: a.full_name, department: a.department ?? null, role: a.role, channel_user_id: a.zalo_follower_id ?? null };
  }

  private actorOf(s: StaffRef): Actor {
    return { id: s.admin_id, role: s.role, department: s.department, tenant_id: s.tenant_id };
  }

  /** Người đại diện phòng (Data Owner) + cán bộ chuyên môn của phòng. */
  async recipientsOfDept(tenantId: string, deptKey: string | null): Promise<StaffRef[]> {
    if (!deptKey) return [];
    const dept = await this.departments.findOne({ where: { key: deptKey } });
    const staff = await this.admins.find({ where: { tenant_id: tenantId, is_active: true, department: deptKey } });
    const map = new Map<number, AdminUser>(staff.map((a) => [a.id, a]));
    if (dept?.head_admin_id && !map.has(dept.head_admin_id)) {
      const head = await this.admins.findOne({ where: { id: dept.head_admin_id, is_active: true, tenant_id: tenantId } });
      if (head) map.set(head.id, head);
    }
    return [...map.values()].map((a) => this.toRef(a));
  }

  async refOfAdmin(adminId: number): Promise<StaffRef | null> {
    const a = await this.admins.findOne({ where: { id: adminId, is_active: true } });
    return a?.tenant_id ? this.toRef(a) : null;
  }

  // ── Gửi ──────────────────────────────────────────────────────────────────

  async deliver(to: StaffRef, card: Card, ref?: { type: string; id: string | number }, inApp = true) {
    // Cổng an toàn (Blueprint mục 69): CCCD/SĐT/bí mật/hồ sơ sức khoẻ → tin chung; dài → cắt. Zalo chỉ nhận payload tối thiểu.
    const gate = NotificationGateway.sanitize(card, this.webUrl());
    const outCard = gate.card;
    let result: { ok: boolean; messageId: string | null; error?: string };
    try { result = await this.channel.sendCard(to, outCard); } catch (err) { result = { ok: false, messageId: null, error: String(err) }; }
    const status = result.ok ? 'sent' : to.channel_user_id ? 'failed' : 'skipped';
    await this.messages.save(this.messages.create({ tenant_id: to.tenant_id, direction: 'out', kind: 'card', channel: this.channel.name, admin_id: to.admin_id, channel_user_id: to.channel_user_id,
      title: outCard.title, body: outCard as any, status, error: result.error ?? null, reference_type: ref?.type ?? null, reference_id: ref ? String(ref.id) : null,
      gateway: { allowed: gate.allowed, reasons: gate.reasons, truncated: gate.truncated, original_title: gate.allowed ? undefined : card.title } } as any));
    if (inApp) {
      await this.staffNotifications.create({ recipient_id: to.admin_id, type: 'chat_card', title: card.title, body: card.lines.join('\n'), reference_type: ref?.type, reference_id: typeof ref?.id === 'number' ? ref.id : Number(ref?.id) || undefined }).catch(() => {});
    }
    return status;
  }

  private async reply(to: StaffRef, text: string, ref?: { type: string; id: string | number }) {
    let r: { ok: boolean; error?: string };
    try { r = await this.channel.sendText(to, text); } catch (err) { r = { ok: false, error: String(err) }; }
    await this.messages.save(this.messages.create({ tenant_id: to.tenant_id, direction: 'out', kind: 'text', channel: this.channel.name, admin_id: to.admin_id, channel_user_id: to.channel_user_id,
      title: text.slice(0, 120), body: { text }, status: r.ok ? 'sent' : to.channel_user_id ? 'failed' : 'skipped', error: r.error ?? null, reference_type: ref?.type ?? null, reference_id: ref ? String(ref.id) : null }));
    return text;
  }

  /** Sau bóc tách: báo phòng chủ file có N số chờ xác nhận. */
  async notifyExtracted(actor: Actor, file: SourceFile, outcomes: Array<IngestOutcome & { value?: unknown }>) {
    if (!outcomes.length) return;
    const names = new Map((await this.indicators.find()).map((i) => [i.indicator_id, i]));
    const lines = outcomes.slice(0, 8).map((o) => `• ${names.get(o.indicator_id)?.name ?? o.indicator_id}: ${o.value ?? '?'} ${names.get(o.indicator_id)?.unit ?? ''} [mã ${o.fact_id}]${o.status === 'quarantined' ? ' — CÁCH LY' : ''}`);
    if (outcomes.length > 8) lines.push(`… và ${outcomes.length - 8} số khác`);
    if (file.pii_warning) lines.push(`⚠ ${file.pii_warning}`);
    lines.push('Trả lời "XN <mã>" để xác nhận, "SUA <mã> = <số>" nếu bóc sai.');
    const card: Card = { title: `Đã bóc ${outcomes.length} số từ "${file.original_name}" (kỳ ${file.period})`, lines,
      actions: [{ id: 'confirm', label: 'Xác nhận' }, { id: 'edit', label: 'Sửa' }], deepLink: this.deepLink(`/facts?period=${file.period}`, `do360-facts?period=${file.period}&view=pending`) };
    const recipients = await this.recipientsOfDept(actor.tenant_id, file.department);
    if (!recipients.some((r) => r.admin_id === actor.id)) { const me = await this.refOfAdmin(actor.id); if (me) recipients.push(me); }
    for (const r of recipients) await this.deliver(r, card, { type: 'source_file', id: file.id }, r.admin_id !== actor.id);
  }

  /** Số bị cách ly (sai số học / thua nguồn bậc cao hơn) → thẻ cho Data Owner của lĩnh vực. */
  async notifyQuarantined(ind: Indicator, factId: string, period: string, tenantId: string, note: string) {
    const recipients = await this.recipientsOfDept(tenantId, ind.owner_dept);
    const card: Card = { title: `Số "${ind.name}" kỳ ${period} bị cách ly`, lines: [note.slice(0, 600), `Mã số liệu: ${factId}. Trả lời "SUA ${factId} = <số đúng>" hoặc "LOAI ${factId} <lý do>".`],
      actions: [{ id: 'edit', label: 'Sửa' }, { id: 'reject', label: 'Loại' }], deepLink: this.deepLink('/facts?view=quarantine', 'do360-facts?view=quarantine') };
    for (const r of recipients) await this.deliver(r, card, { type: 'fact', id: factId }, false);
  }

  /** Thẻ form: nhắc chỉ tiêu còn thiếu/chưa duyệt theo từng phòng + hạn chốt + cách nhập thẳng bằng lệnh NHAP. */
  async remindRun(runId: number, tenantId?: string) {
    const run = await this.runs.findOne({ where: tenantId ? { run_id: runId, tenant_id: tenantId } : { run_id: runId } });
    if (!run) throw new BadRequestException('Không tìm thấy kỳ báo cáo.');
    if (run.status !== 'collecting') return { run_id: run.run_id, sent: 0, depts: [], note: `Kỳ ở trạng thái ${run.status}, không nhắc.` };
    const exceptions = (run.gate_report as any)?.exceptions ?? {};
    const gate = await this.gate.evaluatePeriod(run.tenant_id, run.period, run.spec_id, { cutoffDate: run.cutoff_date, exceptions });
    const meta = new Map((await this.indicators.find()).map((i) => [i.indicator_id, i]));
    const byDept = new Map<string, string[]>();
    const formHints = new Map<string, string[]>();
    for (const s of gate.slots) {
      if (s.complete) continue;
      for (const i of s.indicators) {
        if (i.fact && ['approved', 'locked'].includes(i.fact.status)) continue;
        const dept = s.owner_dept ?? meta.get(i.id)?.owner_dept ?? null;
        if (!dept) continue;
        const list = byDept.get(dept) ?? [];
        list.push(`• ${i.name ?? i.id} (${i.id}): ${i.fact ? `đang ${i.fact.status}, mã ${i.fact.id}` : 'chưa có số'}`);
        byDept.set(dept, list);
        if (!i.fact) { const h = formHints.get(dept) ?? []; h.push(`NHAP ${i.id} = <số>`); formHints.set(dept, h); }
      }
    }
    const days = Math.ceil((new Date(run.cutoff_date).getTime() - Date.now()) / 86_400_000);
    const deadline = days < 0 ? `quá hạn chốt ${-days} ngày` : days === 0 ? 'hạn chốt HÔM NAY' : `còn ${days} ngày đến hạn chốt`;
    let sent = 0; const depts: string[] = [];
    for (const [dept, lines] of byDept) {
      const hints = formHints.get(dept) ?? [];
      const card: Card = { title: `Kỳ ${run.period}: ${lines.length} chỉ tiêu chưa đủ — ${deadline} (${formatVnDate(run.cutoff_date)})`,
        lines: [...new Set(lines)].slice(0, 12).concat(hints.length ? [`Không có file thì trả lời: ${hints.slice(0, 3).join(' · ')}${hints.length > 3 ? ' …' : ''} (kỳ ${run.period})`] : []),
        actions: [{ id: 'open', label: 'Nộp số' }], deepLink: this.deepLink(`/facts?period=${run.period}`, `do360?period=${run.period}`) };
      for (const r of await this.recipientsOfDept(run.tenant_id, dept)) { if ((await this.deliver(r, card, { type: 'report_run', id: run.run_id })) === 'sent') sent++; }
      depts.push(dept);
    }
    this.logger.log(`[remind] run #${run.run_id} ${run.period}: ${depts.length} phòng, gửi được ${sent} tin`);
    return { run_id: run.run_id, period: run.period, sent, depts, missing: Object.fromEntries(byDept) };
  }

  /** Bản tổng hợp đầu ngày (Blueprint mục 47.5): một tin thay cho nhiều tin rời — việc đến hạn/quá hạn, chỉ tiêu thiếu, số cách ly, tiến độ kỳ. */
  async buildDigest(tenantId: string): Promise<Card> {
    const [t] = await this.tasks.query(`SELECT COUNT(*) FILTER (WHERE status IN ('new','in_progress') AND due_at::date = CURRENT_DATE)::int AS today, COUNT(*) FILTER (WHERE status IN ('new','in_progress') AND due_at < now())::int AS overdue FROM tasks WHERE tenant_id = $1`, [tenantId]);
    const open = await this.runs.find({ where: { tenant_id: tenantId, status: 'collecting' } });
    const lines: string[] = [`• ${t?.today ?? 0} nhiệm vụ đến hạn hôm nay`, `• ${t?.overdue ?? 0} nhiệm vụ quá hạn`];
    for (const r of open) {
      const g = await this.gate.evaluatePeriod(tenantId, r.period, r.spec_id, { cutoffDate: r.cutoff_date, exceptions: (r.gate_report as any)?.exceptions ?? {} });
      const missing = g.errors.filter((e) => e.kind === 'missing').length;
      lines.push(`• Kỳ ${r.period}: ${g.slots.filter((s) => s.complete).length}/${g.slots.length} mục đủ số, ${missing} mục chưa có số, ${g.errors.length} lỗi kiểm tra`);
    }
    const [q] = await this.tasks.query(`SELECT COUNT(*)::int AS n FROM fact_indicator WHERE tenant_id = $1 AND status = 'quarantined'`, [tenantId]);
    if (q?.n) lines.push(`• ${q.n} số đang cách ly chờ người đại diện phòng quyết`);
    return { title: 'DO360 | TỔNG HỢP ĐẦU NGÀY', lines, actions: [{ id: 'open', label: 'Xem bảng điều hành' }], deepLink: this.deepLink('/leadership') };
  }

  /** 07:00 hằng ngày: gửi tổng hợp cho lãnh đạo + Văn phòng (và nhóm chính danh khi có API nhóm). */
  @Cron('0 7 * * *')
  async dailyDigest(tenantId?: string) {
    const tenants: string[] = tenantId ? [tenantId] : (await this.runs.query(`SELECT DISTINCT tenant_id FROM admin_users WHERE is_active AND tenant_id IS NOT NULL`)).map((r: any) => r.tenant_id);
    const out: any[] = [];
    for (const t of tenants) {
      const card = await this.buildDigest(t);
      const leaders = await this.admins.find({ where: [{ tenant_id: t, is_active: true, role: 'leader' as any }, { tenant_id: t, is_active: true, role: 'commune_admin' as any }] });
      let sent = 0;
      for (const a of leaders) { if ((await this.deliver(this.toRef(a), card, { type: 'digest', id: new Date().toISOString().slice(0, 10) }, false)) === 'sent') sent++; }
      await this.sendToGroups(t, ['lanh_dao', 'van_phong'], card);
      out.push({ tenant_id: t, recipients: leaders.length, sent, card });
    }
    return out;
  }

  /** Gửi vào nhóm Zalo chính danh (đăng ký ở interaction_channel). OA cơ quan hành chính chưa có API nhóm → chỉ ghi nhật ký `skipped`. */
  async sendToGroups(tenantId: string, keys: string[], card: Card) {
    const rows: any[] = await this.runs.query(`SELECT id, key, name, external_group_id, classification_allowed FROM interaction_channel WHERE tenant_id = $1 AND status = 'active' AND key = ANY($2)`, [tenantId, keys]).catch(() => []);
    const gate = NotificationGateway.sanitize(card, this.webUrl());
    for (const g of rows) {
      await this.messages.save(this.messages.create({ tenant_id: tenantId, direction: 'out', kind: 'group', channel: this.channel.name, admin_id: null, channel_user_id: g.external_group_id ?? null,
        title: gate.card.title, body: gate.card as any, status: 'skipped', error: g.external_group_id ? 'Zalo chưa cấp API nhóm (GMF) cho OA cơ quan hành chính — chờ xác nhận với VNG' : 'Nhóm chưa có external_group_id',
        reference_type: 'channel', reference_id: String(g.id), gateway: { allowed: gate.allowed, reasons: gate.reasons, group: g.key } } as any));
    }
    return rows.length;
  }

  /** 08:00 hằng ngày: nhắc mọi kỳ đang thu số. */
  @Cron('0 8 * * *')
  async remindAll() {
    const open = await this.runs.find({ where: { status: 'collecting' } });
    for (const r of open) { try { await this.remindRun(r.run_id); } catch (err) { this.logger.warn(`remind #${r.run_id}: ${err}`); } }
  }

  /**
   * Nhắc việc SẮP đến hạn (thiết kế D6: Tabot nhắc nhiệm vụ sắp đến hạn). 07:30 hằng ngày, hai cửa sổ 24 giờ nên mỗi việc
   * được nhắc đúng hai lần: "còn 1 ngày" và "đến hạn hôm nay". Việc quá hạn do TaskReminderService (kế thừa ZSC) nhắc.
   */
  @Cron('30 7 * * *')
  async remindUpcomingTasks(tenantId?: string) {
    const qb = this.tasks.createQueryBuilder('t').where("t.status IN ('new','in_progress') AND t.due_at IS NOT NULL AND t.due_at >= now() AND t.due_at < now() + interval '48 hours'").orderBy('t.due_at', 'ASC');
    if (tenantId) qb.andWhere('t.tenant_id = :t', { t: tenantId });
    const due = await qb.getMany();
    const byAssignee = new Map<number, Task[]>();
    for (const t of due) byAssignee.set(t.assignee_id, [...(byAssignee.get(t.assignee_id) ?? []), t]);
    let sent = 0; let cards = 0;
    for (const [adminId, list] of byAssignee) {
      const to = await this.refOfAdmin(adminId);
      if (!to) continue;
      const lines = list.slice(0, 8).map((t) => { const h = (new Date(t.due_at!).getTime() - Date.now()) / 3_600_000; return `• ${t.code} — ${t.title.slice(0, 70)} — ${h < 24 ? 'đến hạn HÔM NAY' : 'còn 1 ngày'} (${new Date(t.due_at!).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })})`; });
      if (list.length > 8) lines.push(`… và ${list.length - 8} việc khác`);
      const card: Card = { title: `Bạn có ${list.length} việc sắp đến hạn`, lines, actions: [{ id: 'open', label: 'Xem việc' }], deepLink: this.deepLink('/dashboard', 'officer') };
      cards++;
      if ((await this.deliver(to, card, { type: 'task', id: list[0].id })) === 'sent') sent++;
    }
    this.logger.log(`[remind tasks] ${due.length} việc sắp đến hạn / ${byAssignee.size} cán bộ, gửi được ${sent}`);
    return { tasks: due.length, recipients: cards, sent };
  }

  async sendTest(adminId: number) {
    const me = await this.refOfAdmin(adminId);
    if (!me) throw new BadRequestException('Không tìm thấy tài khoản.');
    const status = await this.deliver(me, { title: 'Kiểm tra kênh chat', lines: ['Nếu bạn nhận được tin này, kênh chat của DO360 đã hoạt động.', HELP], actions: [], deepLink: this.webUrl() }, undefined, false);
    return { status, linked: !!me.channel_user_id, channel: this.channel.name };
  }

  // ── Nhận ─────────────────────────────────────────────────────────────────

  private async logIn(from: StaffRef, kind: string, body: Record<string, unknown>, status: string, error?: string) {
    await this.messages.save(this.messages.create({ tenant_id: from.tenant_id, direction: 'in', kind, channel: this.channel.name, admin_id: from.admin_id, channel_user_id: from.channel_user_id,
      title: String(body.text ?? body.name ?? kind).slice(0, 120), body, status, error: error ?? null }));
  }

  /** Kỳ mặc định khi cán bộ không ghi mã kỳ: kỳ duy nhất đang thu số của đơn vị. */
  private async defaultPeriod(tenantId: string): Promise<string | null> {
    const open = await this.runs.find({ where: { tenant_id: tenantId, status: 'collecting' }, order: { created_at: 'DESC' } });
    return open.length === 1 ? open[0].period : null;
  }

  /** Điểm vào chung cho mọi kênh. Trả về { handled, reply }. */
  async handleInbound(ev: InboundEvent): Promise<{ handled: boolean; reply: string | null; result?: unknown }> {
    const from = ev.from;
    const actor = this.actorOf(from);
    try {
      if (ev.type === 'file') {
        const att = ev.attachment;
        const dl = await this.channel.downloadAttachment(att);
        const period = PERIOD_RE.exec(ev.text ?? '')?.[1]?.toUpperCase() ?? (await this.defaultPeriod(from.tenant_id));
        const { file, duplicate } = await this.bronze.receive({ tenantId: from.tenant_id, file: { buffer: dl.buffer, originalname: Buffer.from(dl.name, 'utf8').toString('latin1'), mimetype: dl.mime, size: dl.buffer.length },
          uploadedBy: from.admin_id, department: from.department, period, channel: this.channel.name, asOfDate: asOfFromText(ev.text) });
        await this.logIn(from, 'file', { name: dl.name, size: dl.buffer.length, period, file_id: file.id, duplicate }, 'handled');
        if (duplicate && file.status === 'extracted') return { handled: true, reply: await this.reply(from, `File "${dl.name}" đã nộp trước đó (mã file ${file.id}, đã bóc ${file.extracted_count} số).`, { type: 'source_file', id: file.id }), result: { file_id: file.id, duplicate } };
        if (!period) return { handled: true, reply: await this.reply(from, `Đã nhận "${dl.name}" (mã file ${file.id}) nhưng chưa rõ kỳ. Gửi lại kèm mã kỳ (vd 2026-Q3) hoặc chọn kỳ rồi nộp lại trên Mini App/web: ${this.deepLink('/files', 'do360-upload')}`, { type: 'source_file', id: file.id }), result: { file_id: file.id } };
        const ex = await this.extract.run(actor, file.id);
        const pii = ex.pii_warning ? ` ⚠ ${ex.pii_warning}` : '';
        if (ex.status !== 'extracted') return { handled: true, reply: await this.reply(from, `Đã nhận "${dl.name}" (kỳ ${period}) nhưng không nhận ra biểu mẫu — nhập số bằng lệnh NHAP hoặc trên Mini App/web: ${this.deepLink(`/facts?period=${period}`, `do360-facts?period=${period}&manual=1`)}${pii}`, { type: 'source_file', id: file.id }), result: ex };
        await this.notifyExtracted(actor, { ...file, period, pii_warning: ex.pii_warning ?? null } as SourceFile, ex.records as any);
        return { handled: true, reply: `Đã bóc ${ex.records.length} số từ "${dl.name}" — xem thẻ xác nhận.${pii}`, result: ex };
      }

      if (ev.type === 'action') {
        const ids = (Array.isArray((ev.payload as any)?.fact_ids) ? (ev.payload as any).fact_ids : [ev.cardId]).map(String);
        const out: string[] = [];
        for (const id of ids) {
          if (ev.action === 'confirm') { const r: any = await this.facts.confirm(actor, id); out.push(`${id}: ${r.status}`); }
          else if (ev.action === 'reject') { await this.facts.reject(actor, id, String((ev.payload as any)?.reason ?? 'Loại từ kênh chat')); out.push(`${id}: rejected`); }
          else if (ev.action === 'edit') { const r: any = await this.facts.correct(actor, id, { value: Number((ev.payload as any)?.value), reason: 'Sửa từ kênh chat' }); out.push(`${id}: v${r.version} ${r.status}`); }
        }
        await this.logIn(from, 'action', { cardId: ev.cardId, action: ev.action, payload: ev.payload as any }, 'handled');
        return { handled: true, reply: await this.reply(from, out.join('\n')), result: out };
      }

      const text = ev.text.trim();
      let m: RegExpExecArray | null;
      if ((m = /^(XN|OK|XACNHAN|XÁC NHẬN)\s+(\d+)\s*$/i.exec(text))) {
        const r: any = await this.facts.confirm(actor, m[2]);
        await this.logIn(from, 'text', { text, command: 'confirm', fact_id: m[2] }, 'handled');
        const msg = r.status === 'confirmed' ? `Đã xác nhận số mã ${m[2]} (${r.indicator_id} = ${Number(r.value)}).` : `Số mã ${m[2]} bị CÁCH LY: ${r.note ?? ''}`;
        return { handled: true, reply: await this.reply(from, msg, { type: 'fact', id: m[2] }), result: r };
      }
      if ((m = /^(SUA|SỬA)\s+(\d+)\s*[=:]\s*([\d.,\-]+)\s*(.*)$/i.exec(text))) {
        const value = parseVnNumber(m[3]);
        if (value === null) return { handled: true, reply: await this.reply(from, `Không đọc được số "${m[3]}". Ví dụ: SUA ${m[2]} = 17.206`) };
        const r: any = await this.facts.correct(actor, m[2], { value, reason: m[4]?.trim() || 'Sửa từ kênh chat' });
        await this.logIn(from, 'text', { text, command: 'correct', fact_id: m[2], value }, 'handled');
        return { handled: true, reply: await this.reply(from, `Đã sửa: ${r.indicator_id} = ${Number(r.value)} (phiên bản ${r.version}, mã mới ${r.id}, đã xác nhận).`, { type: 'fact', id: r.id }), result: r };
      }
      if ((m = /^(LOAI|LOẠI)\s+(\d+)\s+(.+)$/i.exec(text))) {
        await this.facts.reject(actor, m[2], m[3].trim());
        await this.logIn(from, 'text', { text, command: 'reject', fact_id: m[2] }, 'handled');
        return { handled: true, reply: await this.reply(from, `Đã loại số mã ${m[2]}: ${m[3].trim()}`, { type: 'fact', id: m[2] }) };
      }
      // Thẻ form: nhập số không có file — "NHAP tthc.qua_han = 28 2026-Q3 30/09/2026"
      if ((m = /^(NHAP|NHẬP)\s+([A-Za-z_][\w.]*)\s*[=:]\s*([\d.,\-]+)\s*(.*)$/i.exec(text))) {
        const value = parseVnNumber(m[3]);
        if (value === null) return { handled: true, reply: await this.reply(from, `Không đọc được số "${m[3]}". Ví dụ: NHAP ${m[2]} = 28`) };
        const rest = m[4] ?? '';
        const period = PERIOD_RE.exec(rest)?.[1]?.toUpperCase() ?? (await this.defaultPeriod(from.tenant_id));
        if (!period) return { handled: true, reply: await this.reply(from, 'Chưa rõ kỳ — thêm mã kỳ vào lệnh, vd: NHAP ' + m[2] + ' = ' + m[3] + ' 2026-Q3') };
        const d = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(rest);
        const run = await this.runs.findOne({ where: { tenant_id: from.tenant_id, period, status: 'collecting' } });
        const asOf = d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : run?.cutoff_date ?? new Date().toISOString().slice(0, 10);
        const [o] = await this.facts.ingest(actor, [{ indicator_id: m[2].toLowerCase(), period, as_of_date: asOf, value, capture_method: 'form', confidence: 1, source_ref: { system: `form:${this.channel.name}`, snippet: text } }], this.channel.name);
        await this.logIn(from, 'text', { text, command: 'ingest', indicator_id: m[2], value, period }, 'handled');
        const msg = o.note ? `${m[2]} kỳ ${period}: ${o.note}` : `Đã ghi ${m[2]} = ${value} (kỳ ${period}, ngày chốt ${formatVnDate(asOf)}, mã ${o.fact_id}, trạng thái ${o.status}). Trả lời "XN ${o.fact_id}" để xác nhận.`;
        return { handled: true, reply: await this.reply(from, msg, { type: 'fact', id: o.fact_id }), result: o };
      }
      if (/^(TIEN DO|TIẾN ĐỘ|TD)\b/i.test(text)) {
        const open = await this.runs.find({ where: { tenant_id: from.tenant_id, status: 'collecting' } });
        const lines: string[] = [];
        for (const run of open) {
          const r = await this.remindRun(run.run_id, from.tenant_id);
          const mine = from.department ? (r.missing as any)?.[from.department] ?? [] : Object.values((r.missing as any) ?? {}).flat();
          lines.push(`Kỳ ${run.period}: ${mine.length ? mine.join('; ') : 'phòng bạn đã đủ số'}`);
        }
        await this.logIn(from, 'text', { text, command: 'progress' }, 'handled');
        return { handled: true, reply: await this.reply(from, lines.length ? lines.join('\n') : 'Không có kỳ nào đang thu số.') };
      }
      if (/^(HELP|TRO GIUP|TRỢ GIÚP|\?)$/i.test(text)) {
        await this.logIn(from, 'text', { text, command: 'help' }, 'handled');
        return { handled: true, reply: await this.reply(from, HELP) };
      }
      return { handled: false, reply: null };
    } catch (err: any) {
      const msg = err?.response?.message ?? err?.message ?? String(err);
      await this.logIn(from, ev.type, { text: (ev as any).text ?? null, name: (ev as any).attachment?.name ?? null }, 'error', String(msg));
      return { handled: true, reply: await this.reply(from, `Không thực hiện được: ${Array.isArray(msg) ? msg.join(', ') : msg}`) };
    }
  }

  /** Webhook Zalo OA → InboundEvent. Trả về true nếu đã xử lý (controller không chạy tiếp luồng QR). */
  async handleZaloWebhook(body: any): Promise<boolean> {
    const eventName: string = body?.event_name ?? '';
    const senderId: string | null = body?.sender?.id ?? body?.user_id_by_app ?? null;
    if (!senderId || !['user_send_file', 'user_send_image', 'user_send_text'].includes(eventName)) return false;
    const from = await this.channel.resolveStaff(senderId);
    if (!from) return false;
    if (eventName === 'user_send_text') {
      const text = String(body?.message?.text ?? '').trim();
      if (!text) return false;
      const r = await this.handleInbound({ type: 'text', from, text });
      return r.handled;
    }
    const atts: any[] = body?.message?.attachments ?? [];
    const a = atts.find((x) => x?.payload?.url);
    if (!a) return false;
    const attachment: AttachmentRef = { url: a.payload.url, name: a.payload.name ?? undefined, size: a.payload.size ? Number(a.payload.size) : undefined };
    await this.handleInbound({ type: 'file', from, attachment, text: body?.message?.text ?? '' });
    return true;
  }

  /** Giả lập tin đến (kiểm thử không cần OA): file dạng base64 được phục vụ qua data: URL. */
  async simulateInbound(adminId: number, input: { type: 'text' | 'file' | 'action'; text?: string; file?: { name: string; base64: string; mime?: string }; cardId?: string; action?: 'confirm' | 'edit' | 'reject'; payload?: unknown }) {
    const from = await this.refOfAdmin(adminId);
    if (!from) throw new BadRequestException('Không tìm thấy tài khoản.');
    if (input.type === 'text') return this.handleInbound({ type: 'text', from, text: input.text ?? '' });
    if (input.type === 'action') return this.handleInbound({ type: 'action', from, cardId: input.cardId ?? '', action: input.action ?? 'confirm', payload: input.payload });
    if (!input.file?.base64) throw new BadRequestException('Thiếu file.base64');
    const mime = input.file.mime || 'application/octet-stream';
    return this.handleInbound({ type: 'file', from, attachment: { url: `data:${mime};base64,${input.file.base64}`, name: input.file.name, mime }, text: input.text ?? '' });
  }
}
