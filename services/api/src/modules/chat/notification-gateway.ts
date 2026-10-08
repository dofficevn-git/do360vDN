import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Card } from './chat-channel';

/**
 * Notification Security Gateway (Blueprint V0.5 mục 69): mọi tin DO360 → Zalo đi qua cổng này.
 * Phân loại nội dung theo config/notifications/rules.yaml: trúng mẫu cấm (CCCD, SĐT, email, bí mật nhà nước, hồ sơ sức khoẻ…)
 * → thay bằng tin chung, chi tiết chỉ xem trên DO360 Web sau khi đăng nhập. Payload tối thiểu, cắt độ dài.
 */
export interface GateResult { allowed: boolean; reasons: string[]; card: Card; truncated: boolean }

export class NotificationGateway {
  private static cache: { at: number; cfg: any } | null = null;

  static config(): any {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.cfg;
    const dir = process.env.CONFIG_DIR || path.resolve(process.cwd(), '..', '..', 'config');
    let cfg: any = { classification: { deny_patterns: [], generic_text: 'DO360: có việc mới cần bạn xử lý. Đăng nhập DO360 để xem chi tiết.', max_length: 600 }, tiers: {}, rules: [], digest: {} };
    try { const p = path.join(dir, 'notifications', 'rules.yaml'); if (fs.existsSync(p)) cfg = { ...cfg, ...(yaml.load(fs.readFileSync(p, 'utf8')) as any) }; } catch { /* dùng mặc định */ }
    this.cache = { at: Date.now(), cfg };
    return cfg;
  }

  /** Kiểm một đoạn văn bản: trả về danh sách lý do vi phạm (rỗng = được gửi). */
  static inspect(text: string): string[] {
    const cfg = this.config(); const reasons: string[] = [];
    for (const p of cfg.classification?.deny_patterns ?? []) {
      let rx: RegExp;
      try {
        const src = String(p.regex); const ci = src.startsWith('(?i)');
        rx = new RegExp(ci ? src.slice(4) : src, ci ? 'iu' : 'u');
      } catch { continue; }
      if (rx.test(text)) reasons.push(p.key);
    }
    return reasons;
  }

  /** Lọc thẻ trước khi gửi: vi phạm → thẻ chung; dài → cắt. Luôn giữ deepLink (web, kiểm quyền lại khi mở). */
  static sanitize(card: Card, webUrl: string): GateResult {
    const cfg = this.config();
    const text = [card.title, ...(card.lines ?? [])].join('\n');
    const reasons = this.inspect(text);
    if (reasons.length) {
      return { allowed: false, reasons, truncated: false, card: { title: 'DO360', lines: [cfg.classification?.generic_text ?? 'Có việc mới cần bạn xử lý. Đăng nhập DO360 để xem chi tiết.'], actions: [{ id: 'open', label: 'Mở DO360' }], deepLink: card.deepLink ?? webUrl } };
    }
    const max = Number(cfg.classification?.max_length ?? 600);
    let truncated = false; const lines: string[] = []; let len = card.title.length;
    for (const l of card.lines ?? []) { if (len + l.length > max) { truncated = true; lines.push('… (xem đầy đủ trên DO360)'); break; } lines.push(l); len += l.length; }
    return { allowed: true, reasons: [], truncated, card: { ...card, lines, deepLink: card.deepLink ?? webUrl } };
  }

  static tierOf(event: string): { tier: string; channels: string[]; recipients: string[] } {
    const cfg = this.config();
    const rule = (cfg.rules ?? []).find((r: any) => r.event === event);
    const tier = rule?.tier ?? 'info';
    return { tier, channels: cfg.tiers?.[tier]?.channels ?? ['IN_APP'], recipients: rule?.recipients ?? [] };
  }
}
