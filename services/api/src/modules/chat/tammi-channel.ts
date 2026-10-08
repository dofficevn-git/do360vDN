import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '../admin-users/admin-user.entity';
import { AttachmentRef, Card, ChatChannel, StaffRef } from './chat-channel';

/**
 * T1 — Kênh Tammi (siêu ứng dụng của Viettel, OA của UBND). Tabot chạy trong Tammi OA theo thiết kế Tami360 03/10/2026.
 * Chỗ cắm sẵn: API Tammi (V1) chưa mở nên mọi thao tác trả "chưa cấu hình" và ghi nhật ký; khi Viettel cấp tài liệu API
 * chỉ cài phần gọi HTTP ở đây (sendCard/sendText/downloadAttachment/resolveStaff), ChatService và Tabot không đổi.
 * Chọn kênh bằng env CHAT_CHANNEL=tammi|zalo (mặc định zalo — kênh tạm dùng OA Zalo của ZSC).
 */
@Injectable()
export class TammiChatChannel implements ChatChannel {
  readonly name = 'tammi';
  private readonly logger = new Logger(TammiChatChannel.name);

  constructor(@InjectRepository(AdminUser) private admins: Repository<AdminUser>) {}

  private base() { return (process.env.TAMMI_API_URL || '').trim(); }
  private token() { return (process.env.TAMMI_API_TOKEN || '').trim(); }

  async configured(): Promise<boolean> { return !!(this.base() && this.token()); }

  async sendCard(to: StaffRef, card: Card) {
    if (!(await this.configured())) return { ok: false, messageId: null, error: 'Tammi API (V1) chưa mở — đặt TAMMI_API_URL/TAMMI_API_TOKEN khi Viettel cấp.' };
    if (!to.channel_user_id) return { ok: false, messageId: null, error: 'Cán bộ chưa liên kết tài khoản Tammi.' };
    // TODO khi có tài liệu V1: POST {base}/oa/messages {user_id, text, buttons: card.actions, link: card.deepLink}
    this.logger.warn(`[tammi] sendCard tới ${to.channel_user_id}: chưa cài phần gọi API V1`);
    return { ok: false, messageId: null, error: 'Chưa cài phần gọi API Tammi V1.' };
  }

  async sendText(to: StaffRef, _text: string) {
    if (!(await this.configured())) return { ok: false, error: 'Tammi API (V1) chưa mở.' };
    if (!to.channel_user_id) return { ok: false, error: 'Cán bộ chưa liên kết tài khoản Tammi.' };
    return { ok: false, error: 'Chưa cài phần gọi API Tammi V1.' };
  }

  async downloadAttachment(ref: AttachmentRef): Promise<{ buffer: Buffer; name: string; mime: string }> {
    const res = await fetch(ref.url, { headers: this.token() ? { Authorization: `Bearer ${this.token()}` } : {}, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Không tải được file từ Tammi: HTTP ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), name: ref.name ?? 'tai-lieu', mime: ref.mime ?? res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  /** Ánh xạ tài khoản Tammi ↔ cán bộ: dùng lại cột zalo_follower_id dạng "tammi:<id>" cho tới khi có cột riêng. */
  async resolveStaff(channelUserId: string): Promise<StaffRef | null> {
    const a = await this.admins.findOne({ where: { zalo_follower_id: `tammi:${channelUserId}`, is_active: true } });
    return a?.tenant_id ? { admin_id: a.id, tenant_id: a.tenant_id, full_name: a.full_name, department: a.department ?? null, role: a.role, channel_user_id: channelUserId } : null;
  }
}
