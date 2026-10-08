import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Task, TaskPriority, TaskStatus } from './task.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { ZaloOaService } from '../zalo-oa/zalo-oa.service';
import { MANAGER_ROLES, WARD_ROLES } from '../../common/roles';
import { EventsService } from '../events/events.module';

/** Ai được giao việc: lãnh đạo/quản trị + cán bộ chuyên môn (giới hạn cùng phòng ban). Tổ trưởng chỉ nhận. */
const ASSIGNER_ROLES = ['super_admin', 'commune_admin', 'leader', 'department_staff'] as const;
/** Ai xem được mọi việc (không chỉ việc mình giao/nhận). */
const OVERSEER_ROLES = [...MANAGER_ROLES, 'leader'] as const;

export interface Actor {
  id: number;
  role: string;
  department?: string | null;
  full_name?: string;
  tenant_id?: string | null;
}

export interface TaskListQuery {
  status?: string;
  assignee_id?: number;
  assigner_id?: number;
  overdue?: boolean;
  page: number;
  limit: number;
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Thấp',
  normal: 'Bình thường',
  high: 'Cao',
  urgent: 'Khẩn',
};

function isOverdue(t: Pick<Task, 'status' | 'due_at'>): boolean {
  return !!t.due_at && (t.status === 'new' || t.status === 'in_progress') && new Date(t.due_at).getTime() < Date.now();
}

function fmtVn(d: Date | string | null | undefined): string {
  if (!d) return 'không đặt hạn';
  const x = new Date(d);
  if (isNaN(x.getTime())) return 'không đặt hạn';
  return x.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    @InjectRepository(AdminUser) private adminRepo: Repository<AdminUser>,
    @InjectDataSource() private ds: DataSource,
    private staffNotifications: StaffNotificationsService,
    private zaloOa: ZaloOaService,
    private events: EventsService,
  ) {}

  // ── Tạo / giao ───────────────────────────────────────────────────────────

  async create(actor: Actor, dto: { title: string; description?: string; assignee_id: number; due_at?: string; priority?: TaskPriority; source_type?: string; source_id?: number; object_uid?: string; target_indicator_id?: string; target_value?: number }) {
    this.assertCanAssign(actor);
    const assignee = await this.loadAssignee(actor, dto.assignee_id);

    const task = this.repo.create({
      tenant_id: actor.tenant_id ?? null,
      code: await this.nextCode(),
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      assigner_id: actor.id,
      assignee_id: assignee.id,
      priority: dto.priority ?? 'normal',
      status: 'new',
      due_at: dto.due_at ? new Date(dto.due_at) : null,
      source_type: dto.source_type ?? null,
      source_id: dto.source_id ?? null,
      object_uid: dto.object_uid ?? null,
      target_indicator_id: dto.target_indicator_id ?? null,
      target_value: dto.target_value != null ? String(dto.target_value) : null,
    });
    const saved = await this.repo.save(task);
    // Data Core: giao việc = Event trên Object (nếu có) — vòng Report → Task → Event
    if (actor.tenant_id) this.events.record(actor.tenant_id, [{ object_type: 'TSK', object_id: saved.code, event_type: 'giao', event_date: new Date().toISOString().slice(0, 10), domain: null,
      payload: { task_id: saved.id, title: saved.title, assignee_id: saved.assignee_id, target_indicator_id: saved.target_indicator_id, target_value: saved.target_value, name: saved.title, event_name: 'Giao việc' },
      source_ref: { system: 'do360_tasks', by: actor.id }, source_system: 'do360', external_id: `task:${saved.id}:giao`, object_uid: saved.object_uid ?? null, actor_id: actor.id } as any]).catch((err) => this.logger.warn(`event giao: ${err}`));
    this.notifyAssigned(saved, assignee, actor).catch((err) => this.logger.warn(`notifyAssigned: ${err}`));
    return this.decorate(saved);
  }

  // ── Đọc ──────────────────────────────────────────────────────────────────

  async list(actor: Actor, q: TaskListQuery) {
    const qb = this.repo.createQueryBuilder('t');
    if (actor.tenant_id) qb.andWhere('t.tenant_id = :tenant', { tenant: actor.tenant_id });
    // Không phải lãnh đạo/quản trị → chỉ thấy việc mình giao hoặc mình nhận
    if (!this.isOverseer(actor)) {
      qb.andWhere('(t.assignee_id = :me OR t.assigner_id = :me)', { me: actor.id });
    }
    if (q.assignee_id) qb.andWhere('t.assignee_id = :assignee', { assignee: q.assignee_id });
    if (q.assigner_id) qb.andWhere('t.assigner_id = :assigner', { assigner: q.assigner_id });
    if (q.overdue) {
      qb.andWhere("t.status IN ('new','in_progress') AND t.due_at IS NOT NULL AND t.due_at < now()");
    } else if (q.status) {
      qb.andWhere('t.status = :status', { status: q.status });
    }
    qb.orderBy(`CASE WHEN t.status IN ('new','in_progress') THEN 0 ELSE 1 END`, 'ASC')
      .addOrderBy('t.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('t.created_at', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);
    const [items, total] = await qb.getManyAndCount();
    const data = await this.decorateMany(items);
    return { data, total, page: q.page, totalPages: Math.max(1, Math.ceil(total / q.limit)) };
  }

  async myTasks(actor: Actor, status?: string, page = 1, limit = 20) {
    return this.list({ ...actor, role: 'department_staff' }, { assignee_id: actor.id, status, page, limit, overdue: status === 'overdue' });
  }

  /** Đếm cho thẻ KPI + badge: việc của tôi theo trạng thái, quá hạn; việc tôi giao đang mở. */
  async mySummary(actor: Actor) {
    const rows = await this.ds.query(
      `SELECT
         count(*) FILTER (WHERE assignee_id = $1 AND status = 'new')                                  ::int AS my_new,
         count(*) FILTER (WHERE assignee_id = $1 AND status = 'in_progress')                          ::int AS my_in_progress,
         count(*) FILTER (WHERE assignee_id = $1 AND status IN ('new','in_progress') AND due_at < now()) ::int AS my_overdue,
         count(*) FILTER (WHERE assignee_id = $1 AND status = 'done')                                 ::int AS my_done,
         count(*) FILTER (WHERE assigner_id = $1 AND status IN ('new','in_progress'))                  ::int AS assigned_open,
         count(*) FILTER (WHERE assigner_id = $1 AND status IN ('new','in_progress') AND due_at < now()) ::int AS assigned_overdue
       FROM tasks`,
      [actor.id],
    );
    const r = rows?.[0] ?? {};
    return {
      my_new: r.my_new ?? 0,
      my_in_progress: r.my_in_progress ?? 0,
      my_overdue: r.my_overdue ?? 0,
      my_done: r.my_done ?? 0,
      my_open: (r.my_new ?? 0) + (r.my_in_progress ?? 0),
      assigned_open: r.assigned_open ?? 0,
      assigned_overdue: r.assigned_overdue ?? 0,
    };
  }

  async findOne(actor: Actor, id: number) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy công việc.');
    this.assertCanView(actor, task);
    return this.decorate(task);
  }

  // ── Cập nhật ─────────────────────────────────────────────────────────────

  async updateStatus(actor: Actor, id: number, dto: { status: TaskStatus; result_note?: string; result_image_url?: string }) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy công việc.');
    const isAssignee = task.assignee_id === actor.id;
    const isAssigner = task.assigner_id === actor.id;
    const overseer = this.isOverseer(actor);

    if (task.status === 'done' || task.status === 'cancelled') {
      throw new BadRequestException('Việc đã kết thúc, không đổi trạng thái được.');
    }
    if (dto.status === 'cancelled') {
      if (!isAssigner && !overseer) throw new ForbiddenException('Chỉ người giao hoặc lãnh đạo mới huỷ được việc.');
    } else if (!isAssignee && !isAssigner && !overseer) {
      throw new ForbiddenException('Bạn không phải người nhận việc này.');
    }

    const patch: Partial<Task> = { status: dto.status };
    if (dto.status === 'in_progress' && !task.started_at) patch.started_at = new Date();
    if (dto.status === 'done' || dto.status === 'cancelled') {
      patch.completed_at = new Date();
      if (dto.result_note !== undefined) patch.result_note = dto.result_note.trim() || null;
      if (dto.result_image_url !== undefined) patch.result_image_url = dto.result_image_url || null;
    }
    await this.repo.update(id, patch);
    const updated = await this.repo.findOne({ where: { id } });
    if (updated && actor.tenant_id) {
      const et = dto.status === 'done' ? 'hoan_thanh' : dto.status === 'cancelled' ? 'huy' : 'bat_dau';
      this.events.record(actor.tenant_id, [{ object_type: 'TSK', object_id: updated.code, event_type: et, event_date: new Date().toISOString().slice(0, 10), domain: null,
        payload: { task_id: updated.id, title: updated.title, result_note: updated.result_note, name: updated.title, event_name: et === 'hoan_thanh' ? 'Hoàn thành' : et === 'huy' ? 'Huỷ' : 'Bắt đầu thực hiện' },
        source_ref: { system: 'do360_tasks', by: actor.id }, source_system: 'do360', external_id: `task:${updated.id}:${et}`, object_uid: updated.object_uid ?? null, actor_id: actor.id } as any]).catch((err) => this.logger.warn(`event ${et}: ${err}`));
    }

    // Báo cho người giao khi xong/huỷ (in-app là đủ — không tốn tin OA)
    if (updated && (dto.status === 'done' || dto.status === 'cancelled') && updated.assigner_id !== actor.id) {
      const by = actor.full_name ?? 'Cán bộ';
      await this.staffNotifications.create({
        recipient_id: updated.assigner_id,
        type: 'task_done',
        title: dto.status === 'done' ? `Việc ${updated.code} đã hoàn thành` : `Việc ${updated.code} bị huỷ`,
        body: `${by}: ${updated.title}${updated.result_note ? ` — ${updated.result_note.slice(0, 120)}` : ''}`,
        reference_type: 'task',
        reference_id: updated.id,
      });
    }
    return this.decorate(updated!);
  }

  async reassign(actor: Actor, id: number, dto: { assignee_id: number; due_at?: string }) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy công việc.');
    if (task.assigner_id !== actor.id && !this.isOverseer(actor)) {
      throw new ForbiddenException('Chỉ người giao hoặc lãnh đạo mới chuyển giao được.');
    }
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new BadRequestException('Việc đã kết thúc, không chuyển giao được.');
    }
    const assignee = await this.loadAssignee(actor, dto.assignee_id);
    await this.repo.update(id, {
      assignee_id: assignee.id,
      due_at: dto.due_at ? new Date(dto.due_at) : task.due_at,
      status: 'new',
      started_at: null,
      reminded_overdue_at: null,
    });
    const updated = (await this.repo.findOne({ where: { id } }))!;
    this.notifyAssigned(updated, assignee, actor).catch((err) => this.logger.warn(`notifyAssigned: ${err}`));
    return this.decorate(updated);
  }

  /** Nhắc lại thủ công — gửi OA + in-app cho người nhận. */
  async remind(actor: Actor, id: number) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy công việc.');
    if (task.assigner_id !== actor.id && !this.isOverseer(actor)) {
      throw new ForbiddenException('Chỉ người giao hoặc lãnh đạo mới nhắc được.');
    }
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new BadRequestException('Việc đã kết thúc.');
    }
    const assignee = await this.adminRepo.findOne({ where: { id: task.assignee_id } });
    if (!assignee) throw new NotFoundException('Người nhận việc không còn tồn tại.');
    const overdue = isOverdue(task);
    const text = [
      `⏰ [Nhắc việc ${task.code}]${overdue ? ' — QUÁ HẠN' : ''}`,
      `📌 ${task.title}`,
      `🗓 Hạn: ${fmtVn(task.due_at)}`,
      `👤 Người nhắc: ${actor.full_name ?? 'Lãnh đạo'}`,
      'Mở Mini App → Khu vực cán bộ → Việc của tôi để cập nhật.',
    ].join('\n');
    const sent = await this.zaloOa.notifyStaff({ followerId: assignee.zalo_follower_id, text, type: 'task_overdue', recipientName: assignee.full_name });
    await this.staffNotifications.create({
      recipient_id: assignee.id,
      type: overdue ? 'task_overdue' : 'task_assigned',
      title: `${overdue ? 'Việc quá hạn' : 'Nhắc việc'}: ${task.code}`,
      body: `${task.title} — hạn ${fmtVn(task.due_at)}`,
      reference_type: 'task',
      reference_id: task.id,
    });
    return { id: task.id, oa_sent: sent };
  }

  // ── Cron dùng: việc quá hạn chưa nhắc trong 24h, gộp theo người nhận ─────

  async findOverdueToRemind(): Promise<Array<Task & { assignee: AdminUser }>> {
    const tasks = await this.repo
      .createQueryBuilder('t')
      .where("t.status IN ('new','in_progress')")
      .andWhere('t.due_at IS NOT NULL AND t.due_at < now()')
      .andWhere("(t.reminded_overdue_at IS NULL OR t.reminded_overdue_at < now() - interval '24 hours')")
      .orderBy('t.due_at', 'ASC')
      .getMany();
    if (!tasks.length) return [];
    const ids = [...new Set(tasks.map((t) => t.assignee_id))];
    const admins = await this.adminRepo.find({ where: { id: In(ids), is_active: true } });
    const byId = new Map(admins.map((a) => [a.id, a]));
    return tasks.filter((t) => byId.has(t.assignee_id)).map((t) => Object.assign(t, { assignee: byId.get(t.assignee_id)! }));
  }

  async markReminded(ids: number[]) {
    if (!ids.length) return;
    await this.repo.update(ids, { reminded_overdue_at: new Date() });
  }

  // ── Nội bộ ───────────────────────────────────────────────────────────────

  private isOverseer(actor: Actor) {
    return (OVERSEER_ROLES as readonly string[]).includes(actor.role);
  }

  private assertCanAssign(actor: Actor) {
    if (!(ASSIGNER_ROLES as readonly string[]).includes(actor.role)) {
      throw new ForbiddenException('Vai trò của bạn không được giao việc.');
    }
  }

  private assertCanView(actor: Actor, task: Task) {
    if (this.isOverseer(actor)) return;
    if (task.assignee_id !== actor.id && task.assigner_id !== actor.id) {
      throw new ForbiddenException('Bạn không có quyền xem việc này.');
    }
  }

  /** Người nhận phải đang hoạt động; cán bộ chuyên môn chỉ giao trong phòng ban mình (hoặc cho tổ trưởng). */
  private async loadAssignee(actor: Actor, assigneeId: number): Promise<AdminUser> {
    const assignee = await this.adminRepo.findOne({ where: { id: assigneeId, is_active: true } });
    if (!assignee || (actor.tenant_id && assignee.tenant_id !== actor.tenant_id)) throw new BadRequestException('Người nhận việc không tồn tại hoặc đã bị khoá.');
    if (actor.role === 'department_staff') {
      const sameDept = !!actor.department && assignee.department === actor.department;
      const isTdpHead = assignee.role === 'tdp_head';
      if (!sameDept && !isTdpHead && assignee.id !== actor.id) {
        throw new ForbiddenException('Cán bộ chuyên môn chỉ giao việc cho người cùng phòng ban hoặc tổ trưởng.');
      }
    }
    return assignee;
  }

  private async nextCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = `CV-${String(Date.now()).slice(-6)}${i ? String(i) : ''}`.slice(0, 20);
      const exists = await this.repo.findOne({ where: { code } });
      if (!exists) return code;
      await new Promise((r) => setTimeout(r, 3));
    }
    return `CV-${Math.floor(Math.random() * 1e9).toString(36).toUpperCase()}`.slice(0, 20);
  }

  private async notifyAssigned(task: Task, assignee: AdminUser, actor: Actor) {
    const assigner = actor.full_name ?? (await this.adminRepo.findOne({ where: { id: actor.id } }))?.full_name ?? 'Lãnh đạo';
    await this.staffNotifications.create({
      recipient_id: assignee.id,
      type: 'task_assigned',
      title: `Việc mới ${task.code}: ${task.title.slice(0, 60)}`,
      body: `${assigner} giao cho bạn. Hạn: ${fmtVn(task.due_at)}. Ưu tiên: ${PRIORITY_LABEL[task.priority]}.`,
      reference_type: 'task',
      reference_id: task.id,
    });
    const text = [
      `📋 [Giao việc ${task.code}]`,
      `📌 ${task.title}`,
      task.description ? `📝 ${task.description.slice(0, 200)}${task.description.length > 200 ? '…' : ''}` : null,
      `🗓 Hạn: ${fmtVn(task.due_at)} · Ưu tiên: ${PRIORITY_LABEL[task.priority]}`,
      `👤 Người giao: ${assigner}`,
      'Mở Mini App → Khu vực cán bộ → Việc của tôi để nhận và cập nhật.',
    ].filter(Boolean).join('\n');
    await this.zaloOa.notifyStaff({ followerId: assignee.zalo_follower_id, text, type: 'task_assigned', recipientName: assignee.full_name });
  }

  private async decorateMany(tasks: Task[]) {
    if (!tasks.length) return [];
    const ids = [...new Set(tasks.flatMap((t) => [t.assignee_id, t.assigner_id]))];
    const admins = await this.adminRepo.find({ where: { id: In(ids) }, select: ['id', 'full_name', 'role', 'department', 'tdp_id'] });
    const byId = new Map(admins.map((a) => [a.id, a]));
    return tasks.map((t) => this.shape(t, byId.get(t.assignee_id), byId.get(t.assigner_id)));
  }

  private async decorate(task: Task) {
    const [d] = await this.decorateMany([task]);
    return d;
  }

  private shape(t: Task, assignee?: Partial<AdminUser>, assigner?: Partial<AdminUser>) {
    return {
      ...t,
      is_overdue: isOverdue(t),
      assignee: assignee ? { id: assignee.id, full_name: assignee.full_name, role: assignee.role, department: assignee.department } : null,
      assigner: assigner ? { id: assigner.id, full_name: assigner.full_name, role: assigner.role } : null,
    };
  }
}
