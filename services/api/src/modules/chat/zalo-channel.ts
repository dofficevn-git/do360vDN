import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '../admin-users/admin-user.entity';
import { ZaloOaService } from '../zalo-oa/zalo-oa.service';
import { AttachmentRef, Card, ChatChannel, StaffRef, cardToText } from './chat-channel';

/**
 * Bản cài Zalo OA của ChatChannel (kênh tạm trước khi có API Tammi).
 * - Tin chủ động = tin văn bản OA (Zalo không có thẻ nút bấm tuỳ biến) + liên kết mở web.
 * - Cán bộ ↔ tài khoản chat: admin_users.zalo_follower_id (liên kết khi đăng nhập QR / nhận lời mời qua OA).
 * - File cán bộ gửi vào OA: webhook user_send_file/user_send_image cho URL tải trực tiếp.
 */
@Injectable()
export class ZaloChatChannel implements ChatChannel {
  readonly name = 'zalo';
  private readonly logger = new Logger(ZaloChatChannel.name);

  constructor(private zaloOa: ZaloOaService, @InjectRepository(AdminUser) private admins: Repository<AdminUser>) {}

  async configured(): Promise<boolean> {
    try { return !!(await this.zaloOa.getCurrentToken()); } catch { return false; }
  }

  async sendCard(to: StaffRef, card: Card) {
    if (!to.channel_user_id) return { ok: false, messageId: null, error: 'Cán bộ chưa liên kết Zalo (zalo_follower_id trống).' };
    const ok = await this.zaloOa.notifyStaff({ followerId: to.channel_user_id, text: cardToText(card), type: 'manual', recipientName: to.full_name });
    return { ok, messageId: null, error: ok ? undefined : 'OA không gửi được (token/quyền gửi tin chủ động).' };
  }

  async sendText(to: StaffRef, text: string) {
    if (!to.channel_user_id) return { ok: false, error: 'Cán bộ chưa liên kết Zalo.' };
    const ok = await this.zaloOa.notifyStaff({ followerId: to.channel_user_id, text, type: 'manual', recipientName: to.full_name });
    return { ok, error: ok ? undefined : 'OA không gửi được.' };
  }

  async downloadAttachment(ref: AttachmentRef) {
    const res = await fetch(ref.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Tải file từ Zalo thất bại: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = ref.mime || res.headers.get('content-type') || 'application/octet-stream';
    let name = ref.name || '';
    if (!name) {
      try { name = decodeURIComponent(new URL(ref.url).pathname.split('/').pop() || ''); } catch { name = ''; }
      if (!name || !/\.[a-z0-9]{2,5}$/i.test(name)) name = `zalo-${Date.now()}${mime.includes('jpeg') ? '.jpg' : mime.includes('png') ? '.png' : mime.includes('pdf') ? '.pdf' : ''}`;
    }
    return { buffer, name, mime };
  }

  async resolveStaff(channelUserId: string): Promise<StaffRef | null> {
    if (!channelUserId) return null;
    const a = await this.admins.findOne({ where: { zalo_follower_id: channelUserId, is_active: true } });
    if (!a || !a.tenant_id) return null;
    return { admin_id: a.id, tenant_id: a.tenant_id, full_name: a.full_name, department: a.department ?? null, role: a.role, channel_user_id: a.zalo_follower_id };
  }
}
