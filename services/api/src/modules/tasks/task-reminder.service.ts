import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TasksService } from './tasks.service';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { ZaloOaService } from '../zalo-oa/zalo-oa.service';

/**
 * Nhắc việc quá hạn — mẫu appointment-reminder.service.
 * Mỗi sáng 7:30 (giờ máy chủ = giờ VN theo cấu hình container): gom việc quá hạn theo từng cán bộ,
 * gửi MỘT tin OA + một thông báo in-app, rồi đánh dấu reminded_overdue_at để 24h sau mới nhắc lại.
 */
@Injectable()
export class TaskReminderService {
  private readonly logger = new Logger(TaskReminderService.name);

  constructor(
    private tasks: TasksService,
    private staffNotifications: StaffNotificationsService,
    private zaloOa: ZaloOaService,
  ) {}

  @Cron('30 7 * * *')
  async remindOverdue() {
    const due = await this.tasks.findOverdueToRemind();
    if (!due.length) return;

    const byAssignee = new Map<number, typeof due>();
    for (const t of due) {
      const list = byAssignee.get(t.assignee_id) ?? [];
      list.push(t);
      byAssignee.set(t.assignee_id, list);
    }

    let sent = 0;
    const doneIds: number[] = [];
    for (const [, list] of byAssignee) {
      const assignee = list[0].assignee;
      const lines = list.slice(0, 5).map((t) => `• ${t.code} — ${t.title.slice(0, 60)}`);
      if (list.length > 5) lines.push(`… và ${list.length - 5} việc khác`);
      const text = [
        `⏰ [Nhắc việc] Bạn có ${list.length} việc QUÁ HẠN:`,
        ...lines,
        'Mở Mini App → Khu vực cán bộ → Việc của tôi để cập nhật.',
      ].join('\n');

      const ok = await this.zaloOa.notifyStaff({ followerId: assignee.zalo_follower_id, text, type: 'task_overdue', recipientName: assignee.full_name });
      if (ok) sent += 1;
      await this.staffNotifications.create({
        recipient_id: assignee.id,
        type: 'task_overdue',
        title: `${list.length} việc quá hạn`,
        body: lines.join('\n'),
        reference_type: 'task',
        reference_id: list[0].id,
      });
      doneIds.push(...list.map((t) => t.id));
    }
    await this.tasks.markReminded(doneIds);
    this.logger.log(`Nhắc quá hạn: ${due.length} việc / ${byAssignee.size} cán bộ, OA gửi được ${sent}.`);
  }
}
