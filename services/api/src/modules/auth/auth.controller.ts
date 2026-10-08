import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  Delete,
  UnauthorizedException,
  ForbiddenException,
  HttpCode,
  Param,
  Query,
  Redirect,
  Res,
  Req,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ModuleRef } from '@nestjs/core';
import { AdminLoginDto } from './dto/admin-login.dto';
import { ZaloLoginDto } from './dto/zalo-login.dto';
import { QrVerifyDto } from './dto/qr-verify.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ALL_ADMIN_ROLES } from '../../common/roles';

/**
 * Xác thực chữ ký webhook Zalo OA.
 * Zalo gửi header X-ZEvent-Signature = "mac=" + sha256(appId + rawBody + timestamp + oaSecretKey).
 * Trả về true khi hợp lệ, hoặc khi CHƯA cấu hình secret (dev) — kèm cảnh báo log.
 */
function verifyZaloWebhookSignature(rawBody: Buffer | undefined, body: any, signature?: string): boolean {
  // Chỉ xác thực khi đã có OA Secret Key (ZALO_WEBHOOK_SECRET). App Secret KHÔNG phải khoá ký webhook —
  // dùng nhầm sẽ từ chối cả request "Kiểm tra" của Zalo (HTTP 403) và không thiết lập được webhook.
  const secret = process.env.ZALO_WEBHOOK_SECRET || '';
  const appId = process.env.ZALO_OA_APP_ID || process.env.ZALO_APP_ID || '';
  if (!secret || !appId) {
    console.warn('[zalo webhook] ZALO_WEBHOOK_SECRET (OA Secret Key) chưa cấu hình — BỎ QUA xác thực chữ ký');
    return true;
  }
  if (!signature) return false;
  const mac = signature.startsWith('mac=') ? signature.slice(4) : signature;
  const data = rawBody ? rawBody.toString('utf8') : JSON.stringify(body ?? {});
  const timestamp = String(body?.timestamp ?? '');
  const expected = createHash('sha256').update(appId + data + timestamp + secret).digest('hex');
  return mac.toLowerCase() === expected.toLowerCase();
}

@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly moduleRef: ModuleRef,) {}

  // ─── Email/Password login ───────────────────────────────────────────────

  @Post('admin/auth/login')
  @ApiOperation({ summary: 'Đăng nhập admin bằng email/password' })
  async adminLogin(@Body() dto: AdminLoginDto) {
    const user = await this.authService.validateAdminUser(dto.email, dto.password);
    if (!user) throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    return this.authService.loginAdmin(user);
  }

  // ─── Zalo Mini App login ────────────────────────────────────────────────

  @Post('public/zalo/login')
  @ApiOperation({ summary: 'Đăng nhập bằng Zalo (Mini App)' })
  async zaloLogin(@Body() dto: ZaloLoginDto) {
    return this.authService.loginZalo(dto.zalo_user_id, dto.name, dto.avatar, dto.zalo_access_token);
  }

  @Post('public/zalo/phone')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy số điện thoại qua Zalo SDK (cần phone_token từ getPhoneNumber)' })
  resolvePhone(
    @Request() req,
    @Body() body: { phone_token: string; zalo_access_token: string },
  ) {
    return this.authService.resolveUserPhone(req.user.id, body.phone_token, body.zalo_access_token);
  }

  @Post('public/staff/login')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nhận diện cán bộ/tổ trưởng từ token cư dân → cấp token admin (Khu vực cán bộ)' })
  staffLogin(@Request() req) {
    if (req.user?.type !== 'user') {
      throw new ForbiddenException('Chỉ dùng với phiên đăng nhập cư dân.');
    }
    return this.authService.staffLogin(req.user.id);
  }

  // ─── Admin info ─────────────────────────────────────────────────────────

  @Get('admin/me')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...ALL_ADMIN_ROLES) // tổ trưởng cũng cần xem thông tin phiên của mình
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thông tin admin hiện tại' })
  getMe(@Request() req) {
    return req.user;
  }

  // ─── QR Login session ───────────────────────────────────────────────────

  @Post('admin/auth/qr-session')
  @ApiOperation({ summary: 'Tạo phiên đăng nhập QR (admin panel gọi)' })
  createQrSession() {
    return this.authService.createQrSession();
  }

  @Post('admin/auth/link-zalo-session')
  @UseGuards(AdminGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo QR để liên kết Zalo vào tài khoản hiện tại' })
  createLinkZaloSession(@Request() req) {
    return this.authService.createLinkZaloSession(req.user.id);
  }

  @Get('admin/auth/qr-session/:id')
  @ApiOperation({ summary: 'Poll trạng thái phiên QR' })
  pollQrSession(@Param('id') id: string) {
    return this.authService.pollQrSession(id);
  }

  @Post('admin/auth/qr-verify')
  @ApiOperation({ summary: 'Xác thực QR từ Mini App sau khi quét' })
  verifyQrScan(@Body() dto: QrVerifyDto) {
    return this.authService.verifyQrScan(dto.session_id, dto.access_token);
  }

  // ─── Invitation / Cấp quyền ─────────────────────────────────────────────

  // ─── Zalo OAuth cho admin (không cần Mini App) ──────────────────────────────

  @Get('admin/auth/zalo-login')
  @Redirect()
  @ApiOperation({ summary: 'Redirect đến Zalo OAuth — admin quét QR mở URL này' })
  zaloOauthLogin(@Query('session_id') sessionId: string) {
    if (!sessionId) throw new BadRequestException('Thiếu session_id');
    const url = this.authService.startZaloOauth(sessionId);
    return { url, statusCode: 302 };
  }

  @Get('admin/auth/oauth-callback')
  @ApiOperation({ summary: 'Callback từ Zalo OAuth sau khi admin xác nhận' })
  async zaloOauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const style = `body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
      .box{text-align:center;padding:32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:340px;width:90%}
      .icon{font-size:48px;margin-bottom:16px}.title{font-size:18px;font-weight:600;color:#111;margin-bottom:8px}
      .sub{font-size:14px;color:#6b7280}`;
    try {
      if (!code || !state) throw new Error('Thiếu thông tin xác thực');
      const type = await this.authService.handleOauthCallback(code, state);
      const msg = type === 'invite'
        ? { title: 'Đăng ký thành công!', sub: 'Tài khoản đã được tạo. Bạn có thể đăng nhập ngay.' }
        : { title: 'Đăng nhập thành công!', sub: 'Kiểm tra trình duyệt trên máy tính của bạn.' };
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${msg.title}</title><style>${style}</style></head>
        <body><div class="box"><div class="icon">✅</div>
        <div class="title">${msg.title}</div><div class="sub">${msg.sub}</div>
        </div></body></html>`);
    } catch (err: any) {
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Lỗi</title><style>${style.replace('color:#111', 'color:#dc2626')}</style></head>
        <body><div class="box"><div class="icon">⚠️</div>
        <div class="title">Có lỗi xảy ra</div>
        <div class="sub">${err?.message ?? 'Vui lòng thử lại.'}</div>
        </div></body></html>`);
    }
  }

  @Get('public/invite/:token/oauth-start')
  @Redirect()
  @ApiOperation({ summary: 'Bắt đầu Zalo OAuth để chấp nhận lời mời' })
  startInviteOauth(@Param('token') token: string) {
    const url = this.authService.startInviteOauth(token);
    return { url, statusCode: 302 };
  }

  // ─── Zalo OA Webhook ────────────────────────────────────────────────────────

  @Get('public/zalo/webhook')
  @ApiOperation({ summary: 'Zalo OA webhook verification' })
  verifyWebhook(@Query('hub.challenge') challenge: string) {
    return challenge ? challenge : { ok: true };
  }

  @Post('public/zalo/webhook')
  @HttpCode(200) // Zalo chỉ chấp nhận webhook trả đúng 200 (Nest mặc định POST = 201)
  @ApiOperation({ summary: 'Nhận event từ Zalo OA (tin nhắn, follow, scan QR)' })
  async zaloWebhook(
    @Body() body: any,
    @Req() req: any,
    @Headers('x-zevent-signature') signature?: string,
  ) {
    // Chặn event giả mạo: xác thực chữ ký khi đã cấu hình secret
    // (mac = sha256(appId + rawBody + timestamp + oaSecretKey), header X-ZEvent-Signature).
    // Chưa cấu hình secret (môi trường dev) → cho qua kèm cảnh báo.
    if (!verifyZaloWebhookSignature(req.rawBody, body, signature)) {
      // Zalo yêu cầu webhook luôn trả 200 (trả lỗi → Zalo retry rồi tắt webhook). Bỏ qua event, không xử lý.
      console.warn(`[zalo webhook] BỎ QUA event "${body?.event_name ?? '?'}" — chữ ký không khớp. Kiểm tra ZALO_WEBHOOK_SECRET = OA Secret Key (developers.zalo.me → ứng dụng → Official Account).`);
      return { ok: false, reason: 'invalid_signature' };
    }
    console.log(`[zalo webhook] event=${body?.event_name ?? '?'} sender=${body?.sender?.id ?? body?.follower?.id ?? '?'}`);

    const eventName = body?.event_name ?? body?.type ?? '';
    const followerId =
      body?.user_id_by_app ??
      body?.sender?.id ??
      body?.follower?.id ??
      null;

    if (!followerId) return { ok: true };

    // Ưu tiên 1: qr_data từ OA Custom QR (nếu API khả dụng)
    const qrData = body?.qr_data ?? body?.attachments?.[0]?.payload?.value ?? null;
    if (qrData) {
      await this.authService.verifyQrByFollowerId(qrData, followerId);
      return { ok: true };
    }

    // Ưu tiên 2: ref từ OA URL (?ref=session_id) — Zalo gửi khi follow/mở OA từ ref link
    const ref = body?.ref ?? body?.follow?.ref ?? body?.message?.ref ?? null;
    if (ref) {
      await this.authService.verifyQrByFollowerId(ref, followerId);
      return { ok: true };
    }

    // Cán bộ đã liên kết gửi file / lệnh XN-SUA-LOAI-TIEN DO → Tabot (ChatService) xử lý, không đi tiếp luồng QR
    if (!(body?.message?.text ?? '').trim().toUpperCase().startsWith('INVITE ')) {
      try {
        const chat = this.moduleRef.get(require('../chat/chat.service').ChatService, { strict: false });
        if (chat && (await chat.handleZaloWebhook(body))) return { ok: true };
      } catch (err) { console.warn(`[zalo webhook] chat: ${err}`); }
    }

    // Kiểm tra mã mời "INVITE {token}" — tạo tài khoản admin mới
    if (eventName === 'user_send_text') {
      const msgText: string = (body?.message?.text ?? '').trim();
      if (msgText.toUpperCase().startsWith('INVITE ')) {
        const token = msgText.slice(7).trim();
        const senderName: string | null =
          body?.sender?.display_name ??
          body?.sender?.name ??
          body?.follower?.display_name ??
          body?.follower?.name ??
          null;
        console.log(`[OA invite] token=${token.slice(0, 12)}... follower=${followerId} name=${senderName}`);
        await this.authService.acceptInvitationByMessage(token, followerId, senderName);
        return { ok: true };
      }
    }

    // Fallback: admin nhắn tin / follow → tìm session login pending gần nhất
    const msgEvents = ['user_send_text', 'user_send_sticker', 'user_send_image', 'follow',
                       'user_scan_qr', 'user_scan_qr_code', 'scan_qr_code'];
    if (msgEvents.includes(eventName)) {
      await this.authService.verifyQrByMessage(followerId);
    }

    return { ok: true };
  }

  // ─── System health ───────────────────────────────────────────────────────

  @Get('admin/system-health')
  @UseGuards(AdminGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kiểm tra sức khoẻ hệ thống (OA token, cấu hình)' })
  async systemHealth() {
    return this.authService.checkSystemHealth();
  }

  // ─── Invitation / Cấp quyền ─────────────────────────────────────────────

  @Post('admin/auth/invitations')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles('super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo lời mời QR (chỉ super_admin)' })
  createInvitation(@Body() dto: CreateInvitationDto, @Request() req) {
    return this.authService.createInvitation(dto, req.user.id);
  }

  @Get('admin/auth/invitations')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles('super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Danh sách lời mời (chỉ super_admin)' })
  listInvitations() {
    return this.authService.listInvitations();
  }

  @Delete('admin/auth/invitations/:id')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles('super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thu hồi lời mời chưa dùng (chỉ super_admin)' })
  revokeInvitation(@Param('id') id: string) {
    return this.authService.revokeInvitation(+id);
  }

  @Get('admin/auth/invitations/:token/preview')
  @ApiOperation({ summary: 'Xem thông tin lời mời (Mini App gọi trước khi xác nhận)' })
  previewInvitation(@Param('token') token: string) {
    return this.authService.previewInvitation(token);
  }

  @Post('admin/auth/invitations/:token/accept')
  @ApiOperation({ summary: 'Chấp nhận lời mời từ Mini App' })
  acceptInvitation(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(token, dto.access_token);
  }
}
