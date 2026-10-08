/**
 * T1 ↔ T4: giao diện kênh chat (docs/GIAO-DIEN.md §5). Nghiệp vụ (ChatService) chỉ gọi interface này.
 * Hai bản cài: Zalo OA (dùng ngay, zalo-channel.ts) và Tammi (khi Viettel mở API — thêm tammi-channel.ts, không sửa nghiệp vụ).
 */
export interface StaffRef {
  admin_id: number;
  tenant_id: string;
  full_name: string;
  department: string | null;
  role: string;
  /** Định danh trên kênh chat (Zalo: user_id_by_oa / follower id; Tammi: user id) — null nếu chưa liên kết */
  channel_user_id: string | null;
}

export interface Card {
  title: string;
  lines: string[];
  actions: { id: string; label: string }[];
  /** Liên kết mở màn tương ứng trên web/Mini App (Zalo không có thẻ nút bấm tuỳ biến cho tin chủ động) */
  deepLink?: string;
}

export interface AttachmentRef { url: string; name?: string; mime?: string; size?: number }

export type InboundEvent =
  | { type: 'file'; from: StaffRef; attachment: AttachmentRef; text?: string }
  | { type: 'action'; from: StaffRef; cardId: string; action: 'confirm' | 'edit' | 'reject'; payload?: unknown }
  | { type: 'text'; from: StaffRef; text: string };

export interface ChatChannel {
  readonly name: string;
  /** Kênh đã có cấu hình/token để gửi được chưa */
  configured(): Promise<boolean>;
  /** Gửi thẻ có nút bấm (xác nhận số, điền form, nhắc hạn). Trả về id tin để cập nhật sau. */
  sendCard(to: StaffRef, card: Card): Promise<{ ok: boolean; messageId: string | null; error?: string }>;
  sendText(to: StaffRef, text: string): Promise<{ ok: boolean; error?: string }>;
  /** Tải file cán bộ gửi vào chat về để lưu Bronze. */
  downloadAttachment(ref: AttachmentRef): Promise<{ buffer: Buffer; name: string; mime: string }>;
  /** Đổi tài khoản chat ↔ cán bộ + bộ phận (ánh xạ lưu ở admin_users). */
  resolveStaff(channelUserId: string): Promise<StaffRef | null>;
}

export const CHAT_CHANNEL = 'CHAT_CHANNEL';

/** Thẻ → văn bản thuần (cho kênh không có thẻ nút bấm). Cắt ở ~1900 ký tự (giới hạn tin OA). */
export function cardToText(card: Card): string {
  const parts = [`[DO360] ${card.title}`, ...card.lines];
  if (card.actions.length) parts.push('Thao tác: ' + card.actions.map((a) => a.label).join(' · '));
  if (card.deepLink) parts.push(`Mở: ${card.deepLink}`);
  const text = parts.join('\n');
  return text.length > 1900 ? text.slice(0, 1890) + '…' : text;
}
