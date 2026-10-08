import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-log.entity';
import { User } from '../users/user.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { Tdp } from '../tdp/tdp.entity';

// Refresh token Zalo rotate sau mỗi lần refresh. Lưu file để survive restart.
const TOKEN_STORE_FILE = path.join(process.env.UPLOAD_DIR ?? 'uploads', '.oa-tokens.json');

// Nhãn tiếng Việt cho danh mục phản ánh (đồng bộ với miniapp feedback-panel.tsx).
// Dùng để hiển thị trong tin OA; KHÔNG dùng cho định tuyến department.
const FEEDBACK_CATEGORY_LABEL: Record<string, string> = {
  infrastructure: 'Hạ tầng giao thông',
  environment: 'Môi trường',
  security: 'An ninh trật tự',
  administration: 'Hành chính',
  other: 'Khác',
};

@Injectable()
export class ZaloOaService implements OnModuleInit {
  private readonly logger = new Logger(ZaloOaService.name);

  // Cache token + refresh logic — đồng bộ với AuthService.getOaToken()
  private _oaAccessToken: string | null = null;
  private _oaTokenExpiry = 0;
  // Sau refresh thành công, Zalo trả về refresh_token MỚI (rotation). Lưu memory
  // để các lần refresh tiếp theo dùng. Khi restart → mất → fallback về env.
  private _currentRefreshToken: string | null = null;

  constructor(
    private config: ConfigService,
    private notifications: NotificationsService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(AdminUser)
    private adminRepo: Repository<AdminUser>,
    @InjectRepository(Tdp)
    private tdpRepo: Repository<Tdp>,
  ) {}

  /**
   * Public: lấy OA token hiện tại (cho service khác dùng — vd AuthService).
   * Delegate sang getOaToken() có sẵn refresh/file/fallback logic.
   */
  async getCurrentToken(): Promise<string | null> {
    return this.getOaToken();
  }

  /** Trạng thái cache token để admin monitor qua endpoint */
  getTokenStatus() {
    const now = Date.now();
    const hasToken = !!this._oaAccessToken;
    const remainingMs = Math.max(0, this._oaTokenExpiry - now);
    return {
      has_token: hasToken,
      expires_in_seconds: Math.round(remainingMs / 1000),
      expires_at: this._oaTokenExpiry ? new Date(this._oaTokenExpiry).toISOString() : null,
      is_expired: hasToken && now >= this._oaTokenExpiry,
      using_rotated_refresh_token: !!this._currentRefreshToken,
    };
  }

  /**
   * Nhận cặp token mới dán từ web admin (lấy ở developers.zalo.me/tools/explorer hoặc OAuth OA).
   * Kiểm tra bằng /v2.0/oa/getoa trước khi lưu; lưu vào file store để không cần sửa env/restart.
   * Refresh token có thể để trống (khi đó chỉ dùng được tới khi access token hết hạn ~25h).
   */
  async setTokens(input: { access_token: string; refresh_token?: string; expires_in?: number }) {
    const accessToken = (input.access_token ?? '').trim();
    if (!accessToken) throw new BadRequestException('Thiếu access_token');

    const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', { headers: { access_token: accessToken } });
    const data: any = await res.json().catch(() => ({}));
    if (data?.error !== 0) {
      throw new BadRequestException(`Zalo từ chối access_token (error ${data?.error ?? '?'}: ${data?.message ?? 'không rõ'})`);
    }

    this._oaAccessToken = accessToken;
    this._oaTokenExpiry = Date.now() + (Number(input.expires_in) || 24 * 3600) * 1000 - 60_000;
    const refresh = (input.refresh_token ?? '').trim();
    if (refresh) this._currentRefreshToken = refresh;
    await this.saveTokensToFile();
    this.logger.log(`[OA Token] Đã nhận token mới từ admin — OA "${data.data?.name ?? '?'}" (${data.data?.oa_id ?? '?'})`);
    return { ok: true, oa_id: data.data?.oa_id ?? null, oa_name: data.data?.name ?? null, has_refresh_token: !!this._currentRefreshToken };
  }

  /** Token hiện có còn được Zalo chấp nhận không (gọi /oa/getoa). Dùng trước các thao tác hàng loạt. */
  async verifyCurrentToken(): Promise<boolean> {
    const token = await this.getOaToken();
    if (!token) return false;
    try {
      const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', { headers: { access_token: token } });
      const data: any = await res.json().catch(() => ({}));
      if (data?.error === 0) return true;
      if (data?.error === -216 || data?.error === -213) { this._oaAccessToken = null; this._oaTokenExpiry = 0; }
      return false;
    } catch {
      return false;
    }
  }

  // ── Lifecycle: load persistent token → refresh proactive ───────────────
  async onModuleInit() {
    await this.loadTokensFromFile();
    setTimeout(() => {
      this.refreshOaTokenProactive().catch((err) =>
        this.logger.warn(`[OA Token] onModuleInit refresh failed: ${err}`),
      );
    }, 5_000);
  }

  private async loadTokensFromFile(): Promise<void> {
    try {
      const raw = await fs.readFile(TOKEN_STORE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data?.refresh_token) {
        this._currentRefreshToken = data.refresh_token;
        this.logger.log(`[OA Token] Loaded refresh_token from ${TOKEN_STORE_FILE}`);
      }
      if (data?.access_token && data?.expires_at && Date.now() < data.expires_at) {
        this._oaAccessToken = data.access_token;
        this._oaTokenExpiry = data.expires_at;
        this.logger.log(`[OA Token] Loaded access_token (còn ${Math.round((data.expires_at - Date.now())/1000)}s)`);
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        this.logger.warn(`[OA Token] Read ${TOKEN_STORE_FILE} failed: ${err}`);
      }
    }
  }

  private async saveTokensToFile(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(TOKEN_STORE_FILE), { recursive: true });
      const payload = {
        access_token: this._oaAccessToken,
        refresh_token: this._currentRefreshToken,
        expires_at: this._oaTokenExpiry,
        saved_at: new Date().toISOString(),
      };
      await fs.writeFile(TOKEN_STORE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      this.logger.warn(`[OA Token] Save ${TOKEN_STORE_FILE} failed: ${err}`);
    }
  }

  // ── Cron: chủ động refresh mỗi 6h để không bao giờ chạm tới expiry ─────
  @Cron(CronExpression.EVERY_6_HOURS)
  async refreshOaTokenProactive(): Promise<{ ok: boolean; message: string }> {
    const refreshToken = this._currentRefreshToken ?? this.config.get<string>('ZALO_REFRESH_TOKEN');
    // OA token refresh dùng ZALO_OA_APP_ID + ZALO_OA_APP_SECRET (của zoaplgprod),
    // fallback xuống ZALO_APP_ID + ZALO_APP_SECRET (Mini App) nếu chưa cấu hình
    const appId = this.config.get<string>('ZALO_OA_APP_ID') ?? this.config.get<string>('ZALO_APP_ID');
    const appSecret = this.config.get<string>('ZALO_OA_APP_SECRET') ?? this.config.get<string>('ZALO_APP_SECRET');

    if (!refreshToken || !appId || !appSecret) {
      const msg = 'Thiếu ZALO_REFRESH_TOKEN/APP_ID/APP_SECRET — skip refresh';
      this.logger.warn(`[OA Token] ${msg}`);
      return { ok: false, message: msg };
    }

    try {
      // QUAN TRỌNG (đã verify thực tế 2026-05-18):
      // - secret_key PHẢI trong HEADER (không phải body)
      // - PHẢI có User-Agent (nếu không → Zalo trả body rỗng vì tưởng là browser)
      // - Endpoint v4/oa/access_token
      const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'mini-app-500tr-api/1.0',
          secret_key: appSecret,
        },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          app_id: appId,
          grant_type: 'refresh_token',
        }).toString(),
      });
      const raw = await res.text();
      const bodyLen = raw.length;
      let data: any = {};
      try { data = JSON.parse(raw); } catch { /* keep empty */ }

      if (data?.access_token) {
        this._oaAccessToken = data.access_token;
        this._oaTokenExpiry = Date.now() + (parseInt(data.expires_in, 10) || 86400) * 1000 - 60_000;
        if (data.refresh_token) this._currentRefreshToken = data.refresh_token;
        // Persist sang file để survive container restart (Zalo rotate refresh_token sau mỗi lần dùng)
        await this.saveTokensToFile();
        const ttl = data.expires_in ?? '?';
        this.logger.log(`[OA Token] Refresh OK (expires_in=${ttl}s, body=${bodyLen}B)`);
        await this.notifications.log({
          type: 'manual',
          recipient_zalo_id: 'system',
          recipient_name: 'OA Token Refresh',
          content: `OA access_token refreshed (expires_in=${ttl}s)`,
          status: 'sent',
        }).catch(() => {});
        return { ok: true, message: `Refreshed, expires_in=${ttl}s` };
      }

      const errMsg = bodyLen === 0
        ? 'Body rỗng — refresh_token sai loại hoặc đã hết hạn. Vào oa.zalo.me lấy token mới.'
        : `Response: ${raw.slice(0, 200)}`;
      this.logger.warn(`[OA Token] Refresh FAILED (HTTP ${res.status}, body=${bodyLen}B): ${errMsg}`);
      await this.notifications.log({
        type: 'manual',
        recipient_zalo_id: 'system',
        recipient_name: 'OA Token Refresh',
        content: 'OA access_token refresh failed',
        status: 'failed',
        error_message: `HTTP ${res.status}, body=${bodyLen}B: ${errMsg}`,
      }).catch(() => {});
      return { ok: false, message: errMsg };
    } catch (err) {
      const msg = String(err);
      this.logger.warn(`[OA Token] Refresh exception: ${msg}`);
      await this.notifications.log({
        type: 'manual',
        recipient_zalo_id: 'system',
        recipient_name: 'OA Token Refresh',
        content: 'OA access_token refresh exception',
        status: 'failed',
        error_message: msg,
      }).catch(() => {});
      return { ok: false, message: msg };
    }
  }

  /**
   * Lấy OA access token. Ưu tiên cache trong memory, fallback gọi refresh hoặc
   * dùng static ZALO_ACCESS_TOKEN. Được gọi bởi mọi method gửi tin.
   */
  private async getOaToken(): Promise<string | null> {
    const now = Date.now();
    if (this._oaAccessToken && now < this._oaTokenExpiry) return this._oaAccessToken;

    // Cache hết hạn → thử refresh on-demand
    const refreshResult = await this.refreshOaTokenProactive();
    if (refreshResult.ok && this._oaAccessToken) return this._oaAccessToken;

    // Refresh fail → fallback xuống static token từ env (cấu hình thủ công)
    const staticToken =
      this.config.get<string>('ZALO_ACCESS_TOKEN') ?? process.env.ZALO_ACCESS_TOKEN;
    if (staticToken && staticToken.trim()) {
      this._oaAccessToken = staticToken.trim();
      this._oaTokenExpiry = now + 24 * 3600 * 1000; // cache 24h
      return this._oaAccessToken;
    }
    this.logger.warn('getOaToken: cả refresh và ZALO_ACCESS_TOKEN đều fail');
    return null;
  }

  /**
   * Translate `user_id_by_app` (`zalo_user_id` trong DB) → `user_id_by_oa` qua
   * endpoint `/v3.0/oa/user/detail`. Có cache trong DB qua `zalo_follower_id`.
   *
   * Chỉ tin được giá trị đã cache nếu nó KHÁC `zalo_user_id` (vì legacy code
   * có thể đã ghi nhầm `user_id_by_app` vào `zalo_follower_id` lúc login).
   */
  private async resolveOaUserId(zaloUserId: string): Promise<string | null> {
    let user: User | null = null;
    try {
      user = await this.userRepo.findOne({ where: { zalo_user_id: zaloUserId } });
    } catch {
      return null;
    }
    if (!user) return null;

    // Đã có giá trị hợp lệ (không trùng với user_id_by_app) → dùng cache
    if (user.zalo_follower_id && user.zalo_follower_id !== user.zalo_user_id) {
      return user.zalo_follower_id;
    }

    // Cần gọi OA detail API để lấy user_id_by_oa thật
    const token = await this.getOaToken();
    if (!token) return null;

    try {
      const url = `https://openapi.zalo.me/v3.0/oa/user/detail?data=${encodeURIComponent(
        JSON.stringify({ user_id: zaloUserId }),
      )}`;
      const res = await fetch(url, { headers: { access_token: token } });
      const data: any = await res.json().catch(() => ({}));

      if (data?.error === -216 || data?.error === -213) {
        this._oaAccessToken = null;
        this._oaTokenExpiry = 0;
        this.logger.warn('OA token invalid during user/detail — cache cleared');
        return null;
      }

      // Field thực tế từ Zalo: data.data.user_id_by_oa hoặc data.data.user_id
      const oaUserId: string | null =
        data?.data?.user_id_by_oa ?? data?.data?.user_id ?? null;

      if (oaUserId && oaUserId !== zaloUserId) {
        // Cache lại vào DB để lần sau khỏi gọi
        try {
          await this.userRepo.update(user.id, { zalo_follower_id: oaUserId });
        } catch (err) {
          this.logger.warn(`Cache zalo_follower_id failed: ${err}`);
        }
        return oaUserId;
      }

      this.logger.warn(
        `OA user/detail không trả về user_id_by_oa cho zaloUserId=${zaloUserId} (data=${JSON.stringify(
          data,
        ).slice(0, 200)})`,
      );
      return null;
    } catch (err) {
      this.logger.warn(`OA user/detail error: ${err}`);
      return null;
    }
  }

  private async send(opts: {
    zaloUserId: string;
    text: string;
    type: NotificationType;
    recipientName?: string;
  }): Promise<void> {
    const oaUserId = await this.resolveOaUserId(opts.zaloUserId);
    await this.postOaMessage({
      oaUserId,
      text: opts.text,
      type: opts.type,
      recipientName: opts.recipientName,
      fallbackId: opts.zaloUserId,
    });
  }

  /**
   * Gửi tin OA tới một oa_user_id đã biết trước (không cần resolve).
   * Dùng cho admin: zalo_follower_id trong admin_users đã là user_id_by_oa.
   */
  private async postOaMessage(opts: {
    oaUserId: string | null;
    text: string;
    type: NotificationType;
    recipientName?: string;
    fallbackId?: string;
  }): Promise<boolean> {
    const { oaUserId, text, type, recipientName, fallbackId } = opts;
    const token = await this.getOaToken();

    if (!token || !oaUserId) {
      await this.notifications.log({
        type,
        recipient_zalo_id: oaUserId ?? fallbackId ?? '',
        recipient_name: recipientName,
        content: text,
        status: 'skipped',
        error_message: !token
          ? 'ZALO_ACCESS_TOKEN chưa cấu hình'
          : 'Thiếu zalo_follower_id (admin/user chưa liên kết Zalo OA)',
      });
      this.logger.warn(
        `Zalo OA [${type}] skipped: ${!token ? 'no token' : 'no follower_id'} (fallback=${fallbackId ?? '-'})`,
      );
      return false;
    }

    try {
      const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: token },
        body: JSON.stringify({
          recipient: { user_id: oaUserId },
          message: { text },
        }),
      });

      const data: any = await res.json().catch(() => ({}));
      const apiError = typeof data?.error === 'number' ? data.error : null;
      const apiMsg = data?.message ?? '';
      const success = res.ok && apiError === 0;

      if (apiError === -216 || apiError === -213) {
        this._oaAccessToken = null;
        this._oaTokenExpiry = 0;
        this.logger.warn('OA token invalid — cache cleared, sẽ refresh lần sau');
      }

      await this.notifications.log({
        type,
        recipient_zalo_id: oaUserId,
        recipient_name: recipientName,
        content: text,
        status: success ? 'sent' : 'failed',
        error_message: success
          ? undefined
          : apiError !== null
            ? `Zalo error ${apiError}: ${apiMsg}`
            : `HTTP ${res.status}`,
      });

      if (!success) {
        this.logger.warn(
          `Zalo OA [${type}] failed for follower=${oaUserId}: error=${apiError} msg="${apiMsg}" http=${res.status}`,
        );
      }
      return success;
    } catch (err) {
      await this.notifications.log({
        type,
        recipient_zalo_id: oaUserId,
        recipient_name: recipientName,
        content: text,
        status: 'failed',
        error_message: String(err),
      });
      this.logger.warn(`Zalo OA [${type}] exception: ${err}`);
      return false;
    }
  }

  /**
   * Bắn tin OA tới các admin liên quan.
   * - super_admin / commune_admin / leader: luôn nhận
   * - department_staff: chỉ nhận nếu admin.department khớp opts.department
   */
  /** Đôn đốc tổ trưởng của một TDP khi có phản ánh mới phát sinh trong tổ. */
  async notifyTdpHeadOfFeedback(tdpId: number, code: string, title: string): Promise<void> {
    try {
      const heads = await this.adminRepo.find({
        where: {
          is_active: true,
          zalo_follower_id: Not(IsNull()) as any,
          role: 'tdp_head' as any,
          tdp_id: tdpId as any,
        },
      });
      await Promise.all(
        heads.map((a) =>
          this.postOaMessage({
            oaUserId: a.zalo_follower_id,
            text: `[Phản ánh mới trong tổ] Mã ${code}: ${title}\nMở Mini App → Khu vực cán bộ để theo dõi.`,
            type: 'feedback_update' as NotificationType,
            recipientName: a.full_name,
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`notifyTdpHeadOfFeedback error: ${err}`);
    }
  }

  /**
   * Gửi tin OA cho MỘT cán bộ theo zalo_follower_id (= user_id_by_oa) — dùng cho giao việc/nhắc việc.
   * Bọc postOaMessage (private) để module khác không phải biết chi tiết resolve id. Không ném lỗi.
   */
  async notifyStaff(opts: { followerId: string | null; text: string; type: NotificationType; recipientName?: string }): Promise<boolean> {
    if (!opts.followerId) return false;
    try {
      return await this.postOaMessage({ oaUserId: opts.followerId, text: opts.text, type: opts.type, recipientName: opts.recipientName });
    } catch (err) {
      this.logger.warn(`[OA] notifyStaff lỗi: ${err}`);
      return false;
    }
  }

  private async notifyAdmins(opts: {
    text: string;
    type: NotificationType;
    department?: string | null;
  }): Promise<void> {
    const { text, type, department } = opts;
    try {
      const admins = await this.adminRepo.find({
        where: {
          is_active: true,
          zalo_follower_id: Not(IsNull()) as any,
          role: In(['super_admin', 'commune_admin', 'leader', 'department_staff']) as any,
        },
      });

      const recipients = admins.filter((a) => {
        if (a.role === 'department_staff') {
          return !!department && a.department === department;
        }
        return true;
      });

      if (recipients.length === 0) {
        this.logger.warn(
          `Zalo OA [${type}] no admin recipients (dept=${department ?? '-'}). ` +
            `Cần admin liên kết Zalo (admin_users.zalo_follower_id != NULL) và is_active=true.`,
        );
        return;
      }

      await Promise.all(
        recipients.map((a) =>
          this.postOaMessage({
            oaUserId: a.zalo_follower_id,
            text,
            type,
            recipientName: a.full_name,
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`notifyAdmins error: ${err}`);
    }
  }

  // ── Phản ánh ──────────────────────────────────────────────────────────

  async notifyFeedbackSubmitted(zaloUserId: string, code: string, title?: string): Promise<void> {
    const titleLine = title ? `\n📋 Nội dung: "${title.slice(0, 80)}${title.length > 80 ? '…' : ''}"` : '';
    return this.send({
      zaloUserId,
      type: 'feedback_update',
      text: `[Phản ánh ${code}]\n✅ UBND xã đã tiếp nhận phản ánh của bạn.${titleLine}\nMã tra cứu: ${code}\nChúng tôi sẽ xem xét và phản hồi sớm.`,
    });
  }

  async notifyFeedbackCompleted(zaloUserId: string, code: string): Promise<void> {
    return this.send({
      zaloUserId,
      type: 'feedback_update',
      text: `[Phản ánh ${code}]\nPhản ánh của bạn đã được xử lý hoàn thành. Vui lòng đăng nhập để xem chi tiết và đánh giá.`,
    });
  }

  async notifyFeedbackReplied(zaloUserId: string, code: string, reply: string): Promise<void> {
    const excerpt = reply.length > 100 ? reply.slice(0, 100) + '...' : reply;
    return this.send({
      zaloUserId,
      type: 'feedback_update',
      text: `[Phản ánh ${code}]\nUBND xã đã phản hồi: "${excerpt}"`,
    });
  }

  // ── Lịch hẹn ──────────────────────────────────────────────────────────

  async notifyAppointmentSubmitted(
    zaloUserId: string,
    code: string,
    department: string,
    date: string,
    timeSlot: string,
  ): Promise<void> {
    return this.send({
      zaloUserId,
      type: 'appointment_confirmed',
      text: `[Lịch hẹn ${code}]\n✅ Đã nhận yêu cầu đặt lịch.\n🏛 Bộ phận: ${department}\n📅 Ngày: ${date}\n⏰ Giờ: ${timeSlot}\nMã tra cứu: ${code}\nUBND xã sẽ xác nhận trong thời gian sớm.`,
    });
  }

  async notifyAppointmentConfirmed(
    zaloUserId: string,
    code: string,
    timeSlot: string,
    date: string,
  ): Promise<void> {
    return this.send({
      zaloUserId,
      type: 'appointment_confirmed',
      text: `[Lịch hẹn ${code}]\nLịch hẹn của bạn đã được xác nhận.\n📅 Ngày: ${date}\n⏰ Giờ: ${timeSlot}\nVui lòng có mặt đúng giờ tại UBND xã.`,
    });
  }

  async notifyAppointmentCancelled(
    zaloUserId: string,
    code: string,
    reason?: string,
  ): Promise<void> {
    const note = reason ? `\nLý do: ${reason}` : '';
    return this.send({
      zaloUserId,
      type: 'appointment_cancelled',
      text: `[Lịch hẹn ${code}]\nLịch hẹn của bạn đã bị hủy.${note}\nVui lòng liên hệ UBND xã để biết thêm thông tin.`,
    });
  }

  async notifyAppointmentCompleted(zaloUserId: string, code: string): Promise<void> {
    return this.send({
      zaloUserId,
      type: 'appointment_confirmed',
      text: `[Lịch hẹn ${code}]\nBuổi làm việc của bạn đã hoàn thành. Cảm ơn bạn đã đến đúng hẹn.\nVui lòng mở Mini App, mục "Lịch hẹn của tôi" để đánh giá mức độ hài lòng.`,
    });
  }

  /**
   * Gửi một tin văn bản bất kỳ tới người dân (tự resolve user_id_by_app → user_id_by_oa,
   * tự refresh token, tự ghi notification_logs). Dùng cho các cron/tiện ích ngoài module này.
   */
  async sendPlainText(
    zaloUserId: string,
    text: string,
    type: NotificationType,
    recipientName?: string,
  ): Promise<void> {
    return this.send({ zaloUserId, text, type, recipientName });
  }

  // ── Tin gửi admin (khi có người dân nộp phản ánh / đặt lịch) ──────────

  async notifyAdminsNewFeedback(opts: {
    code: string;
    title?: string | null;
    citizenName?: string | null;
    citizenPhone?: string | null;
    category?: string | null;
  }): Promise<void> {
    const lines = [
      `🔔 [Phản ánh mới ${opts.code}]`,
      opts.citizenName ? `👤 Người gửi: ${opts.citizenName}${opts.citizenPhone ? ` (${opts.citizenPhone})` : ''}` : null,
      opts.title ? `📋 Nội dung: "${opts.title.slice(0, 100)}${opts.title.length > 100 ? '…' : ''}"` : null,
      `📂 Mục: ${opts.category ? (FEEDBACK_CATEGORY_LABEL[opts.category] ?? opts.category) : '—'}`,
      `Vui lòng đăng nhập admin để xử lý.`,
    ].filter(Boolean) as string[];

    return this.notifyAdmins({
      type: 'feedback_update',
      text: lines.join('\n'),
      department: opts.category ?? null,
    });
  }

  async notifyAdminsNewAppointment(opts: {
    code: string;
    citizenName?: string | null;
    citizenPhone?: string | null;
    department: string;
    departmentLabel: string;
    date: string;
    timeSlot: string;
    purpose?: string | null;
  }): Promise<void> {
    const lines = [
      `🔔 [Lịch hẹn mới ${opts.code}]`,
      opts.citizenName ? `👤 Người đặt: ${opts.citizenName}${opts.citizenPhone ? ` (${opts.citizenPhone})` : ''}` : null,
      `🏛 Bộ phận: ${opts.departmentLabel}`,
      `📅 Ngày: ${opts.date}`,
      `⏰ Giờ: ${opts.timeSlot}`,
      opts.purpose ? `📝 Việc: ${opts.purpose.slice(0, 100)}${opts.purpose.length > 100 ? '…' : ''}` : null,
      `Vui lòng vào admin xác nhận hoặc liên hệ người dân.`,
    ].filter(Boolean) as string[];

    return this.notifyAdmins({
      type: 'appointment_confirmed',
      text: lines.join('\n'),
      department: opts.department,
    });
  }

  // ── Khảo sát ────────────────────────────────────────────────────────

  async broadcastSurveyNotification(
    zaloUserId: string,
    surveyTitle: string,
    _surveyId: number,
  ): Promise<void> {
    return this.send({
      zaloUserId,
      type: 'survey_broadcast',
      text: `📊 Khảo sát mới: "${surveyTitle}"\nUBND xã mời bạn tham gia để đóng góp ý kiến. Mở ứng dụng Zalo Mini App để tham gia ngay!`,
    });
  }

  // ── Thông báo / Truyền thông (gửi vào NHÓM Cộng đồng của Tổ dân phố) ──────

  /**
   * Gửi 1 tin text vào một nhóm Cộng đồng Zalo (OA xã là trưởng nhóm) qua
   * Group Message Feature (GMF). Trả về true nếu Zalo nhận; log vào
   * notification_logs (kèm error code/message nguyên văn để soi).
   *
   * Endpoint cấu hình qua env ZALO_GROUP_MESSAGE_URL (mặc định GMF v3.0) để
   * dễ chỉnh nếu Zalo đổi path mà không cần build lại.
   */
  private async sendGroupMessage(opts: {
    groupId: string;
    text: string;
    recipientName?: string;
  }): Promise<boolean> {
    const { groupId, text, recipientName } = opts;
    const token = await this.getOaToken();
    if (!token) {
      await this.notifications.log({
        type: 'announcement',
        recipient_zalo_id: groupId,
        recipient_name: recipientName,
        content: text,
        status: 'skipped',
        error_message: 'ZALO_ACCESS_TOKEN chưa cấu hình',
      });
      return false;
    }

    const url =
      this.config.get<string>('ZALO_GROUP_MESSAGE_URL') ??
      'https://openapi.zalo.me/v3.0/oa/group/message';

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: token },
        body: JSON.stringify({
          recipient: { group_id: groupId },
          message: { text },
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      const apiError = typeof data?.error === 'number' ? data.error : null;
      const apiMsg = data?.message ?? '';
      const success = res.ok && apiError === 0;

      if (apiError === -216 || apiError === -213) {
        this._oaAccessToken = null;
        this._oaTokenExpiry = 0;
      }

      await this.notifications.log({
        type: 'announcement',
        recipient_zalo_id: groupId,
        recipient_name: recipientName,
        content: text,
        status: success ? 'sent' : 'failed',
        error_message: success
          ? undefined
          : apiError !== null
            ? `Zalo error ${apiError}: ${apiMsg}`
            : `HTTP ${res.status}`,
      });
      if (!success) {
        this.logger.warn(
          `Group message failed for group=${groupId}: error=${apiError} msg="${apiMsg}" http=${res.status}`,
        );
      }
      return success;
    } catch (err) {
      await this.notifications.log({
        type: 'announcement',
        recipient_zalo_id: groupId,
        recipient_name: recipientName,
        content: text,
        status: 'failed',
        error_message: String(err),
      });
      this.logger.warn(`Group message exception group=${groupId}: ${err}`);
      return false;
    }
  }

  /**
   * Đẩy 1 thông báo (announcement) vào các NHÓM Cộng đồng của Tổ dân phố.
   * - scope='all': gửi vào nhóm của TẤT CẢ tổ đang hoạt động (có group_id)
   * - scope='tdp': chỉ gửi vào nhóm các tổ trong tdpIds
   *
   * OA xã là trưởng nhóm nên gửi được trực tiếp vào nhóm (Group Message Feature).
   * Kết quả sent/failed theo SỐ NHÓM (mỗi tổ = 1 nhóm), log chi tiết.
   */
  async broadcastAnnouncement(opts: {
    content: string;
    scope?: 'all' | 'tdp';
    tdpIds?: number[] | null;
  }): Promise<{ sent: number; failed: number; total: number }> {
    const { content, scope = 'all', tdpIds } = opts;

    const where: any = { is_active: true, group_id: Not(IsNull()) };
    if (scope === 'tdp') {
      if (!tdpIds || tdpIds.length === 0) {
        return { sent: 0, failed: 0, total: 0 };
      }
      where.id = In(tdpIds);
    }

    const groups = await this.tdpRepo.find({ where });
    if (groups.length === 0) {
      this.logger.warn(
        `broadcastAnnouncement: no TDP groups (scope=${scope}, tdpIds=${tdpIds ?? '-'}). ` +
          `Cần gán group_id (GRID) cho Tổ dân phố.`,
      );
      return { sent: 0, failed: 0, total: 0 };
    }

    const text = `📢 THÔNG BÁO\n${content}`;
    let sent = 0;
    let failed = 0;

    // Gửi tuần tự vào từng nhóm, có delay nhỏ để tránh rate-limit
    for (const g of groups) {
      const ok = await this.sendGroupMessage({
        groupId: g.group_id as string,
        text,
        recipientName: g.name,
      });
      ok ? sent++ : failed++;
      await new Promise((r) => setTimeout(r, 300));
    }

    this.logger.log(
      `broadcastAnnouncement done: sent=${sent} failed=${failed} groups=${groups.length}`,
    );
    return { sent, failed, total: groups.length };
  }
}
