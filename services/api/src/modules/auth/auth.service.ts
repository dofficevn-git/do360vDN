import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { defaultTenantId } from '../../common/tenant';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, DataSource, IsNull } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as nodeCrypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Cron } from '@nestjs/schedule';
import { AdminUser } from '../admin-users/admin-user.entity';
import { User } from '../users/user.entity';
import { AdminQrSession } from './entities/admin-qr-session.entity';
import { AdminInvitation } from './entities/admin-invitation.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { maskPhone } from '../../common/mask';
import { ZaloOaService } from '../zalo-oa/zalo-oa.service';

@Injectable()
export class AuthService {
  // code_verifier lưu tạm trong memory, key = session_id
  private readonly codeVerifiers = new Map<string, string>();

  constructor(
    @InjectRepository(AdminUser)
    private adminUserRepo: Repository<AdminUser>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(AdminQrSession)
    private qrSessionRepo: Repository<AdminQrSession>,
    @InjectRepository(AdminInvitation)
    private invitationRepo: Repository<AdminInvitation>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private dataSource: DataSource,
    private zaloOa: ZaloOaService,
  ) {}

  // ─── Email/Password login (giữ nguyên) ───────────────────────────────────

  async validateAdminUser(email: string, password: string): Promise<AdminUser | null> {
    const user = await this.adminUserRepo.findOne({ where: { email, is_active: true } });
    if (!user || !user.password_hash) return null;
    const isValid = await bcrypt.compare(password, user.password_hash);
    return isValid ? user : null;
  }

  loginAdmin(user: AdminUser) {
    const payload = { sub: user.id, email: user.email, role: user.role, type: 'admin' };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        department: user.department,
      },
    };
  }

  /**
   * Nhận diện cán bộ từ token cư dân (Mini App): cư dân đã follow OA có
   * users.zalo_follower_id (= user_id_by_oa) trùng admin_users.zalo_follower_id
   * ⇒ cấp thêm token admin để mở "Khu vực cán bộ". Không khớp → trả staff:null.
   */
  async staffLogin(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return { staff: null };

    // Lấy user_id_by_oa: ưu tiên cache; nếu chưa có, thử dịch qua OA (cần đã follow).
    let followerId = user.zalo_follower_id;
    if (!followerId && user.zalo_user_id) {
      const profile = await this.getFollowerProfile(user.zalo_user_id);
      if (profile?.user_id_by_oa) {
        followerId = profile.user_id_by_oa;
        user.zalo_follower_id = followerId;
        await this.userRepo.save(user);
      }
    }
    if (!followerId) return { staff: null };

    const admin = await this.adminUserRepo.findOne({
      where: { zalo_follower_id: followerId, is_active: true },
    });
    if (!admin) return { staff: null };

    let tdpName: string | null = null;
    if (admin.tdp_id) {
      const rows = await this.dataSource.query(
        'SELECT name FROM tdp WHERE id = $1',
        [admin.tdp_id],
      );
      tdpName = rows?.[0]?.name ?? null;
    }

    const { access_token } = this.loginAdmin(admin);
    return {
      access_token,
      staff: {
        id: admin.id,
        full_name: admin.full_name,
        role: admin.role,
        department: admin.department,
        tdp_id: admin.tdp_id,
        tdp_name: tdpName,
      },
    };
  }

  // ─── Zalo Mini App login (giữ nguyên) ────────────────────────────────────

  // Theo hướng dẫn Zalo (https://miniapp.zaloplatforms.com/intro/authen-user/):
  //   Mini App gọi sdk.getAccessToken() → gửi access_token sang server →
  //   server dùng Graph API derive user_id + name + avatar → register/login.
  // HOÀN TOÀN SILENT (không popup), chạy auto khi user mở app. (giống CT5D)
  async loginZalo(
    zaloUserId?: string,
    name?: string,
    avatar?: string,
    zaloAccessToken?: string,
  ) {
    // 1. Có access_token → LUÔN derive identity từ Graph API (tin cậy hơn client).
    if (zaloAccessToken) {
      const verified = await this.verifyGraphAccessToken(zaloAccessToken);
      if (verified) {
        if (zaloUserId && zaloUserId !== verified.id) {
          console.warn(`[loginZalo] mismatch client=${zaloUserId} verified=${verified.id}`);
          throw new UnauthorizedException('zalo_user_id không khớp với access token');
        }
        zaloUserId = verified.id;
        // Graph API chỉ trả name/picture khi người dùng đã cấp scope.userInfo;
        // chưa cấp thì trả rỗng → giữ name/avatar Mini App gửi lên (từ getUserInfo).
        name = verified.name || name;
        avatar = verified.picture || avatar;
      } else if (this.isVerifyEnabled()) {
        throw new UnauthorizedException('Access token Zalo không hợp lệ');
      }
      // dev mode (verify off + token không verify được): dùng zaloUserId client gửi (nếu có)
    } else if (this.isVerifyEnabled()) {
      throw new UnauthorizedException('Thiếu zalo_access_token');
    }

    if (!zaloUserId) {
      throw new UnauthorizedException('Thiếu zalo_user_id (không derive được từ access_token)');
    }

    // 2. Upsert user theo zalo_user_id (= user_id_by_app).
    let user = await this.userRepo.findOne({ where: { zalo_user_id: zaloUserId } });
    if (!user) {
      user = this.userRepo.create({ zalo_user_id: zaloUserId, name, avatar });
    } else {
      if (name) user.name = name;
      if (avatar) user.avatar = avatar;
    }

    // 3. Eager translate user_id_by_app → user_id_by_oa (cache để OA gửi tin về sau).
    if (zaloAccessToken) {
      const profile = await this.getFollowerProfile(zaloUserId);
      if (profile) {
        user.zalo_follower_id = profile.user_id_by_oa ?? user.zalo_follower_id;
        if (profile.display_name && !user.name) user.name = profile.display_name;
      }
    }

    await this.userRepo.save(user);

    const payload = { sub: user.id, zalo_user_id: zaloUserId, type: 'user' };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, name: user.name, avatar: user.avatar },
      zalo_user_id: user.zalo_user_id,
      is_follower: !!user.zalo_follower_id,
    };
  }

  // Bật verify strict (prod) qua env ZALO_VERIFY_ENABLED=true; mặc định tắt (dev/simulator).
  private isVerifyEnabled(): boolean {
    return this.configService.get<string>('ZALO_VERIFY_ENABLED', 'false') === 'true';
  }

  // Derive { id, name, picture } từ user access token qua Zalo Graph API.
  private async verifyGraphAccessToken(
    accessToken: string,
  ): Promise<{ id: string; name: string | null; picture: string | null } | null> {
    try {
      const res = await fetch('https://graph.zalo.me/v2.0/me?fields=id,name,picture', {
        headers: { access_token: accessToken },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.id) return null;
      const picture = data?.picture?.data?.url ?? null;
      return { id: data.id, name: data.name || null, picture: picture || null };
    } catch {
      return null;
    }
  }

  // ─── Số điện thoại qua Zalo SDK (giống smart-apartment-ct5d) ──────────────
  // Frontend gọi getPhoneNumber() → nhận phone_token mã hoá → gửi kèm access_token
  // sang đây → backend decode qua Graph API → lưu vào users.phone.
  async resolveUserPhone(userId: number, phoneToken: string, userAccessToken: string) {
    if (!phoneToken) throw new BadRequestException('Thiếu phone_token');
    if (!userAccessToken) throw new BadRequestException('Thiếu zalo_access_token');

    const phone = await this.decodePhoneNumber(userAccessToken, phoneToken);
    if (!phone) {
      throw new BadRequestException(
        'Không lấy được số điện thoại. Vui lòng cấp lại quyền hoặc thử lại sau.',
      );
    }
    await this.userRepo.update(userId, { phone });
    return { ok: true, phone };
  }

  private async decodePhoneNumber(
    userAccessToken: string,
    phoneToken: string,
  ): Promise<string | null> {
    try {
      const res = await fetch('https://graph.zalo.me/v2.0/me/info', {
        headers: {
          access_token: userAccessToken,
          code: phoneToken,
          secret_key: this.configService.get<string>('ZALO_APP_SECRET', ''),
        },
      });
      const data = await res.json();
      if (data?.error && data.error !== 0) {
        console.warn(`[zaloPhone] error=${data.error} msg=${data.message}`);
        return null;
      }
      const phone = data?.data?.number ?? data?.data?.phone ?? null;
      return phone ? String(phone) : null;
    } catch (err) {
      console.warn('[zaloPhone] exception:', err);
      return null;
    }
  }

  // ─── QR Login session ─────────────────────────────────────────────────────

  async createQrSession() {
    const sessionId = uuidv4();
    const session = this.qrSessionRepo.create({
      id: sessionId,
      session_type: 'login',
      status: 'pending',
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
    });
    await this.qrSessionRepo.save(session);

    // KHÔNG fallback sang OA của dự án khác — thiếu ZALO_OA_ID thì trả null để FE hiển thị hướng dẫn
    const oaId = this.configService.get('ZALO_OA_ID', '');
    if (!oaId) {
      console.warn('[auth] ZALO_OA_ID chưa cấu hình — QR login qua OA sẽ không hoạt động');
    }
    const oaQrUrl = this.configService.get(
      'ZALO_OA_QR_URL',
      oaId ? `https://zalo.me/${oaId}` : null,
    );

    return {
      session_id: session.id,
      expires_at: session.expires_at,
      qr_image_url: null,
      oa_url: oaQrUrl,
    };
  }

  private async generateOaQr(data: string): Promise<string | null> {
    try {
      const oaToken = this.configService.get<string>('ZALO_ACCESS_TOKEN');
      if (!oaToken) return null;

      // Thử v3 trước, fallback v2
      const endpoints = [
        { url: 'https://openapi.zalo.me/v3.0/oa/qr/create', body: { params: { data } } },
        { url: 'https://openapi.zalo.me/v2.0/oa/qrcode/generate', body: { size: 200, data } },
      ];

      for (const ep of endpoints) {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: { 'access_token': oaToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(ep.body),
        });
        const json = await res.json();
        if (json.error === 0) {
          const qrUrl = json.data?.qr_url ?? json.data?.qr_code ?? null;
          if (qrUrl) return qrUrl;
        }
        console.warn('[OA QR]', ep.url, '->', json.error, json.message);
      }
      return null;
    } catch (err) {
      console.warn('[OA QR] generate error:', err);
      return null;
    }
  }

  // Xác thực khi admin nhắn tin vào OA — webhook user_send_text gửi về
  async verifyQrByMessage(followerId: string) {
    const adminUser = await this.adminUserRepo.findOne({
      where: { zalo_follower_id: followerId, is_active: true },
    });
    if (!adminUser) {
      console.log(`[QR login] follower ${followerId} — không tìm thấy admin, bỏ qua`);
      return;
    }

    // Tìm session login pending gần nhất (trong vòng 5 phút)
    const session = await this.qrSessionRepo.findOne({
      where: { status: 'pending', session_type: 'login' },
      order: { created_at: 'DESC' },
    });
    if (!session || session.expires_at < new Date()) {
      console.log(`[QR login] admin ${adminUser.full_name} (id=${adminUser.id}) — không có session pending`);
      return;
    }

    // Cập nhật zalo_name và full_name nếu đang là placeholder
    const profile = await this.getFollowerProfile(followerId);
    if (profile?.display_name && profile.display_name !== adminUser.zalo_name) {
      const updates: Partial<AdminUser> = { zalo_name: profile.display_name };
      if (!adminUser.zalo_name || adminUser.full_name === 'Admin') {
        updates.full_name = profile.display_name;
      }
      await this.adminUserRepo.update(adminUser.id, updates);
      adminUser.zalo_name = profile.display_name;
      if (updates.full_name) adminUser.full_name = profile.display_name;
    }

    console.log(`[QR login] ✅ Authenticated: ${adminUser.full_name} (id=${adminUser.id}, role=${adminUser.role}), session=${session.id}`);
    const { access_token } = this.loginAdmin(adminUser);
    await this.qrSessionRepo.update(session.id, {
      status: 'authenticated',
      admin_user_id: adminUser.id,
      jwt_token: access_token,
    });
  }

  // Xác thực QR qua follower_id (từ webhook OA hoặc OAuth callback).
  // Webhook gửi sender.id = user_id_by_oa sẵn; OAuth callback gửi user_id_by_app
  // → dịch trước khi lookup admin để khớp với chuẩn lưu mới (user_id_by_oa).
  async verifyQrByFollowerId(sessionId: string, rawId: string) {
    const session = await this.qrSessionRepo.findOne({ where: { id: sessionId } });
    if (!session || session.status !== 'pending') return;
    if (session.expires_at < new Date()) {
      await this.qrSessionRepo.update(sessionId, { status: 'expired' });
      return;
    }

    const profile = await this.getFollowerProfile(rawId);
    const followerId = profile?.user_id_by_oa ?? rawId;

    // Tìm theo user_id_by_oa trước; fallback sang rawId (admin cũ có thể lưu nhầm user_id_by_app)
    let adminUser = await this.adminUserRepo.findOne({
      where: { zalo_follower_id: followerId, is_active: true },
    });
    if (!adminUser && followerId !== rawId) {
      adminUser = await this.adminUserRepo.findOne({
        where: { zalo_follower_id: rawId, is_active: true },
      });
      if (adminUser) {
        await this.adminUserRepo.update(adminUser.id, { zalo_follower_id: followerId });
        adminUser.zalo_follower_id = followerId;
      }
    }
    if (!adminUser) return;

    if (profile?.display_name && profile.display_name !== adminUser.zalo_name) {
      const updates: Partial<AdminUser> = { zalo_name: profile.display_name };
      if (!adminUser.zalo_name || adminUser.full_name === 'Admin') {
        updates.full_name = profile.display_name;
      }
      await this.adminUserRepo.update(adminUser.id, updates);
      if (updates.full_name) adminUser.full_name = profile.display_name;
    }

    const { access_token } = this.loginAdmin(adminUser);
    await this.qrSessionRepo.update(sessionId, {
      status: 'authenticated',
      admin_user_id: adminUser.id,
      jwt_token: access_token,
    });
  }

  async createLinkZaloSession(adminUserId: number) {
    const session = this.qrSessionRepo.create({
      id: uuidv4(),
      session_type: 'link',
      status: 'pending',
      admin_user_id: adminUserId,
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
    });
    await this.qrSessionRepo.save(session);
    return { session_id: session.id, expires_at: session.expires_at };
  }

  async pollQrSession(sessionId: string) {
    const session = await this.qrSessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Phiên đăng nhập không tồn tại');

    if (session.status === 'pending' && session.expires_at < new Date()) {
      await this.qrSessionRepo.update(sessionId, { status: 'expired' });
      return { status: 'expired' };
    }

    if (session.status === 'authenticated') {
      const adminUser = await this.adminUserRepo.findOne({ where: { id: session.admin_user_id } });
      if (session.session_type === 'link') {
        return { status: 'linked', zalo_name: adminUser.zalo_name };
      }
      return {
        status: 'authenticated',
        access_token: session.jwt_token,
        user: {
          id: adminUser.id,
          full_name: adminUser.full_name,
          email: adminUser.email,
          role: adminUser.role,
          department: adminUser.department,
        },
      };
    }

    return { status: session.status };
  }

  async verifyQrScan(sessionId: string, accessToken: string) {
    const session = await this.qrSessionRepo.findOne({ where: { id: sessionId } });
    if (!session || session.status !== 'pending') {
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    if (session.expires_at < new Date()) {
      await this.qrSessionRepo.update(sessionId, { status: 'expired' });
      throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');
    }

    const rawId = await this.resolveFollowerId(accessToken);
    if (!rawId) throw new UnauthorizedException('Không thể xác thực tài khoản Zalo');

    // Graph API trả user_id_by_app — phải dịch sang user_id_by_oa qua OA detail
    // để khớp với ID Zalo gửi tin OA về sau. Nếu dịch fail, fallback dùng rawId.
    const profile = await this.getFollowerProfile(rawId);
    const followerId = profile?.user_id_by_oa ?? rawId;
    const zaloName = profile?.display_name ?? null;

    // ── Link mode: gắn Zalo vào tài khoản đã có ────────────────────────────
    if (session.session_type === 'link') {
      const duplicate = await this.adminUserRepo.findOne({ where: { zalo_follower_id: followerId } });
      if (duplicate && duplicate.id !== session.admin_user_id) {
        throw new BadRequestException('Tài khoản Zalo này đã được liên kết với admin khác');
      }
      await this.adminUserRepo.update(session.admin_user_id, {
        zalo_follower_id: followerId,
        zalo_name: zaloName,
      });
      await this.qrSessionRepo.update(sessionId, { status: 'authenticated' });
      return { ok: true };
    }

    // ── Login mode: xác thực bằng ZaloID ────────────────────────────────────
    // Lookup theo user_id_by_oa (chuẩn mới); fallback theo rawId (user_id_by_app)
    // để tương thích với admin cũ có thể lưu nhầm user_id_by_app.
    let adminUser = await this.adminUserRepo.findOne({
      where: { zalo_follower_id: followerId, is_active: true },
    });
    if (!adminUser && followerId !== rawId) {
      adminUser = await this.adminUserRepo.findOne({
        where: { zalo_follower_id: rawId, is_active: true },
      });
      if (adminUser) {
        // Migrate: cập nhật sang user_id_by_oa đúng để OA gửi tin được
        await this.adminUserRepo.update(adminUser.id, { zalo_follower_id: followerId });
        adminUser.zalo_follower_id = followerId;
      }
    }
    if (!adminUser) throw new UnauthorizedException('Tài khoản không có quyền truy cập hệ thống');

    if (zaloName && zaloName !== adminUser.zalo_name) {
      await this.adminUserRepo.update(adminUser.id, { zalo_name: zaloName });
    }

    const { access_token } = this.loginAdmin(adminUser);
    await this.qrSessionRepo.update(sessionId, {
      status: 'authenticated',
      admin_user_id: adminUser.id,
      jwt_token: access_token,
    });

    return { ok: true };
  }

  // ─── Invitation / Cấp quyền ──────────────────────────────────────────────

  /** 3 kênh phát tán lời mời (pattern CT5D): QR Mini App (chính) + link OA + text fallback. */
  private buildInviteChannels(token: string) {
    const appId = this.configService.get('ZALO_APP_ID');
    const oaId = this.configService.get('ZALO_OA_ID');
    return {
      mini_app_url: appId ? `https://zalo.me/s/${appId}/admin-auth?mode=invite&token=${token}` : null,
      oa_url: oaId ? `https://zalo.me/${oaId}?ref=INVITE-${token}` : null,
      invite_text: `INVITE ${token}`,
    };
  }

  async createInvitation(dto: CreateInvitationDto, createdById: number) {
    // Giới hạn theo gói: role hợp lệ + số tài khoản tối đa
    const { ALLOWED_ROLES, MAX_ADMIN_ACCOUNTS, getTier } = await import('../../common/features');
    const tier = getTier();
    if (!ALLOWED_ROLES[tier].includes(dto.role)) {
      throw new BadRequestException(
        `Vai trò "${dto.role}" không thuộc gói triển khai hiện tại. Vai trò khả dụng: ${ALLOWED_ROLES[tier].join(', ')}.`,
      );
    }
    if (dto.role === 'tdp_head') {
      if (!dto.tdp_id) throw new BadRequestException('Mời tổ trưởng phải chọn Tổ dân phố phụ trách.');
      const rows = await this.dataSource.query('SELECT id FROM tdp WHERE id = $1 AND is_active = true', [dto.tdp_id]);
      if (!rows?.length) throw new BadRequestException('Tổ dân phố không tồn tại hoặc đã ngừng hoạt động.');
    }
    const activeCount = await this.adminUserRepo.count({ where: { is_active: true } });
    if (activeCount >= MAX_ADMIN_ACCOUNTS[tier]) {
      throw new BadRequestException(
        'Gói tối thiểu chỉ hỗ trợ 1 tài khoản quản trị. Vui lòng nâng cấp gói để thêm cán bộ.',
      );
    }
    const invitation = this.invitationRepo.create({
      token: uuidv4(),
      role: dto.role,
      department: dto.department ?? null,
      tdp_id: dto.tdp_id ?? null,
      suggested_name: dto.suggested_name ?? null,
      suggested_phone: dto.suggested_phone ?? null,
      created_by: createdById,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await this.invitationRepo.save(invitation);
    return {
      token: invitation.token,
      expires_at: invitation.expires_at,
      ...this.buildInviteChannels(invitation.token),
    };
  }

  /** Thu hồi lời mời chưa dùng: đưa expires_at về quá khứ (giữ lịch sử). */
  async revokeInvitation(id: number) {
    const inv = await this.invitationRepo.findOne({ where: { id } });
    if (!inv) throw new NotFoundException('Lời mời không tồn tại');
    if (inv.used_at) throw new BadRequestException('Lời mời đã được sử dụng, không thể thu hồi');
    await this.invitationRepo.update(id, { expires_at: new Date(Date.now() - 1000) });
    return { ok: true };
  }

  async previewInvitation(token: string) {
    const inv = await this.invitationRepo.findOne({ where: { token } });
    if (!inv) throw new NotFoundException('Lời mời không tồn tại');
    if (inv.used_at) throw new BadRequestException('Lời mời đã được sử dụng');
    if (inv.expires_at < new Date()) throw new BadRequestException('Lời mời đã hết hạn');
    let tdp_name: string | null = null;
    if (inv.tdp_id) {
      const rows = await this.dataSource.query('SELECT name FROM tdp WHERE id = $1', [inv.tdp_id]);
      tdp_name = rows?.[0]?.name ?? null;
    }
    return {
      role: inv.role,
      department: inv.department,
      tdp_id: inv.tdp_id,
      tdp_name,
      suggested_name: inv.suggested_name,
      expires_at: inv.expires_at,
    };
  }

  async acceptInvitation(token: string, accessToken: string) {
    const inv = await this.invitationRepo.findOne({ where: { token } });
    if (!inv) throw new NotFoundException('Lời mời không tồn tại');
    if (inv.used_at) throw new BadRequestException('Lời mời đã được sử dụng');
    if (inv.expires_at < new Date()) throw new BadRequestException('Lời mời đã hết hạn');

    const rawId = await this.resolveFollowerId(accessToken);
    if (!rawId) throw new UnauthorizedException('Không thể xác thực tài khoản Zalo');

    // Dịch user_id_by_app (Graph API) → user_id_by_oa (cần để OA gửi tin sau này)
    const [profile, graphName] = await Promise.all([
      this.getFollowerProfile(rawId),
      this.getZaloGraphName(accessToken),
    ]);
    // OA đã cấu hình mà không lấy được profile ⇒ người này CHƯA follow OA.
    // Trả 409 NOT_FOLLOWED để Mini App tự followOA() rồi thử lại (pattern CT5D).
    // Thiếu follower_id thật thì staff-login về sau không khớp được — không cho fallback.
    const oaConfigured = !!(
      this.configService.get('ZALO_ACCESS_TOKEN') || this.configService.get('ZALO_REFRESH_TOKEN')
    );
    if (oaConfigured && !profile) {
      throw new ConflictException({ code: 'NOT_FOLLOWED', message: 'Bạn cần theo dõi OA của xã trước khi nhận quyền.' });
    }
    const followerId = profile?.user_id_by_oa ?? rawId;
    const zaloName = profile?.display_name ?? graphName ?? 'Admin';

    const existing = await this.adminUserRepo.findOne({ where: { zalo_follower_id: followerId } });
    if (existing) throw new BadRequestException('Tài khoản Zalo này đã được đăng ký trong hệ thống');

    // Transaction: tạo admin_user + mark invitation.used_at cùng lúc
    const newAdmin = await this.dataSource.transaction(async (manager) => {
      const adminUser = manager.create(AdminUser, {
        tenant_id: defaultTenantId(),
        full_name: inv.suggested_name ?? zaloName,
        zalo_follower_id: followerId,
        zalo_name: zaloName,
        role: inv.role,
        department: inv.department ?? null,
        tdp_id: inv.tdp_id ?? null,
        is_active: true,
      });
      await manager.save(adminUser);
      await manager.update(AdminInvitation, inv.id, {
        used_by: adminUser.id,
        used_at: new Date(),
      });
      return adminUser;
    });

    // Đồng bộ follower_id vào bản ghi cư dân (nếu có) để staff-login khớp ngay lần mở app sau
    await this.userRepo.update({ zalo_user_id: rawId }, { zalo_follower_id: followerId }).catch(() => {});

    return { ok: true, full_name: newAdmin.full_name, role: newAdmin.role };
  }

  // Người mới gửi "INVITE {token}" vào OA → tự động tạo tài khoản admin
  async acceptInvitationByMessage(token: string, followerId: string, senderName?: string | null) {
    const inv = await this.invitationRepo.findOne({ where: { token } });
    if (!inv || inv.used_at || inv.expires_at < new Date()) return;

    const existing = await this.adminUserRepo.findOne({ where: { zalo_follower_id: followerId } });
    if (existing) return;

    const profile = await this.getFollowerProfile(followerId);
    const zaloName = profile?.display_name ?? senderName ?? 'Admin';

    await this.dataSource.transaction(async (manager) => {
      const adminUser = manager.create(AdminUser, {
        tenant_id: defaultTenantId(),
        full_name: inv.suggested_name ?? zaloName,
        zalo_follower_id: followerId,
        zalo_name: zaloName,
        role: inv.role,
        department: inv.department ?? null,
        tdp_id: inv.tdp_id ?? null,
        is_active: true,
      });
      await manager.save(adminUser);
      await manager.update(AdminInvitation, inv.id, {
        used_by: adminUser.id,
        used_at: new Date(),
      });
    });
  }

  async listInvitations() {
    const invitations = await this.invitationRepo.find({
      order: { created_at: 'DESC' },
    });
    const now = new Date();
    return invitations.map((inv) => ({
      id: inv.id,
      token: inv.token,
      role: inv.role,
      department: inv.department,
      tdp_id: inv.tdp_id,
      suggested_name: inv.suggested_name,
      suggested_phone: inv.suggested_phone,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
      used_at: inv.used_at,
      is_used: !!inv.used_at,
      is_expired: !inv.used_at && inv.expires_at < now,
      ...this.buildInviteChannels(inv.token),
    }));
  }

  // ─── Zalo OAuth (Login bằng Zalo cho admin) ──────────────────────────────

  startZaloOauth(sessionId: string): string {
    return this.buildOauthUrl(sessionId);
  }

  startInviteOauth(token: string): string {
    return this.buildOauthUrl(`invite:${token}`);
  }

  private buildOauthUrl(state: string): string {
    const codeVerifier = nodeCrypto.randomBytes(32).toString('base64url');
    this.codeVerifiers.set(state, codeVerifier);
    const codeChallenge = nodeCrypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const appId = this.configService.get('ZALO_APP_ID');
    const baseUrl = this.configService.get('API_BASE_URL', 'https://do360-api.khodulieu.vn');
    const redirectUri = encodeURIComponent(`${baseUrl}/api/admin/auth/oauth-callback`);
    return `https://oauth.zalo.me/authorize?app_id=${appId}&redirect_uri=${redirectUri}&code_challenge=${codeChallenge}&state=${encodeURIComponent(state)}`;
  }

  async handleOauthCallback(code: string, rawState: string): Promise<'login' | 'invite'> {
    const state = decodeURIComponent(rawState);
    const codeVerifier = this.codeVerifiers.get(state);
    if (!codeVerifier) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    this.codeVerifiers.delete(state);

    const accessToken = await this.exchangeOauthCode(code, codeVerifier);
    if (!accessToken) throw new UnauthorizedException('Zalo OAuth thất bại');

    const [followerId, graphName] = await Promise.all([
      this.resolveFollowerId(accessToken),
      this.getZaloGraphName(accessToken),
    ]);
    if (!followerId) throw new UnauthorizedException('Không thể lấy thông tin tài khoản Zalo');

    if (state.startsWith('invite:')) {
      const token = state.slice(7);
      await this.acceptInvitationByOauth(token, followerId, graphName);
      return 'invite';
    }

    await this.verifyQrByFollowerId(state, followerId);
    return 'login';
  }

  private async exchangeOauthCode(code: string, codeVerifier: string): Promise<string | null> {
    const appId = this.configService.get('ZALO_APP_ID');
    const appSecret = this.configService.get('ZALO_APP_SECRET');
    const baseUrl = this.configService.get('API_BASE_URL', 'https://do360-api.khodulieu.vn');
    const redirectUri = `${baseUrl}/api/admin/auth/oauth-callback`;
    const secretKey = nodeCrypto.createHmac('sha256', appSecret).update(`${appId}|${code}`).digest('hex');
    const res = await fetch('https://oauth.zalo.me/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, app_id: appId, grant_type: 'authorization_code',
        code_verifier: codeVerifier, redirect_uri: redirectUri, secret_key: secretKey }).toString(),
    });
    const data = await res.json();
    return data?.access_token ?? null;
  }

  private async acceptInvitationByOauth(token: string, rawId: string, graphName?: string | null): Promise<void> {
    const inv = await this.invitationRepo.findOne({ where: { token } });
    if (!inv) throw new NotFoundException('Lời mời không tồn tại');
    if (inv.used_at) throw new BadRequestException('Lời mời đã được sử dụng');
    if (inv.expires_at < new Date()) throw new BadRequestException('Lời mời đã hết hạn');

    // Dịch user_id_by_app → user_id_by_oa qua OA detail API
    const profile = await this.getFollowerProfile(rawId);
    const followerId = profile?.user_id_by_oa ?? rawId;
    const zaloName = profile?.display_name ?? graphName ?? 'Admin';

    const existing = await this.adminUserRepo.findOne({ where: { zalo_follower_id: followerId } });
    if (existing) throw new BadRequestException('Tài khoản Zalo này đã được đăng ký');

    await this.dataSource.transaction(async (manager) => {
      const adminUser = manager.create(AdminUser, {
        tenant_id: defaultTenantId(),
        full_name: inv.suggested_name ?? zaloName, zalo_follower_id: followerId, zalo_name: zaloName,
        role: inv.role, department: inv.department ?? null, tdp_id: inv.tdp_id ?? null, is_active: true,
      });
      await manager.save(adminUser);
      await manager.update(AdminInvitation, inv.id, { used_by: adminUser.id, used_at: new Date() });
    });
  }

  // ─── Zalo API helpers ────────────────────────────────────────────────────

  private async resolveFollowerId(accessToken: string): Promise<string | null> {
    try {
      const res = await fetch('https://graph.zalo.me/v2.0/me?fields=id,name,picture', {
        headers: { access_token: accessToken },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.id ?? null;
    } catch {
      return null;
    }
  }

  private async getZaloGraphName(accessToken: string): Promise<string | null> {
    try {
      const res = await fetch('https://graph.zalo.me/v2.0/me?fields=id,name', {
        headers: { access_token: accessToken },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.name ?? null;
    } catch {
      return null;
    }
  }

  // OA token quản lý tập trung ở ZaloOaService (có cron refresh + persistence
  // qua file /app/uploads/.oa-tokens.json). Auth chỉ delegate sang đó để
  // tránh duplicate refresh logic + race condition giữa 2 cache độc lập.
  private async getOaToken(): Promise<string | null> {
    return this.zaloOa.getCurrentToken();
  }


  // --- Nguoi dan da truy cap Mini App & bo nhiem thang (mau CT5D) ---------------

  /**
   * Cập nhật lại cờ "đã quan tâm OA" cho những người dân chưa có zalo_follower_id
   * (thường vì lúc họ mở app OA token đang hỏng). Gọi sau khi dán token OA mới.
   */
  async refreshFollowerFlags(limit = 200): Promise<{ checked: number; updated: number; token_ok: boolean }> {
    // getOaToken() có thể trả token tĩnh từ env đã hỏng → phải hỏi Zalo trước, không thì báo "ok" giả.
    if (!(await this.zaloOa.verifyCurrentToken())) return { checked: 0, updated: 0, token_ok: false };
    const users = await this.userRepo.find({
      where: { zalo_follower_id: IsNull() },
      order: { updated_at: 'DESC' },
      take: limit,
    });
    let updated = 0;
    for (const u of users) {
      if (!u.zalo_user_id) continue;
      const profile = await this.getFollowerProfile(u.zalo_user_id);
      if (profile?.user_id_by_oa) {
        u.zalo_follower_id = profile.user_id_by_oa;
        if (profile.display_name && !u.name) u.name = profile.display_name;
        await this.userRepo.save(u);
        updated += 1;
      }
    }
    return { checked: users.length, updated, token_ok: true };
  }

  /**
   * Danh sách `users` (mỗi lần dân đăng nhập Zalo là một dòng) kèm cờ đã quan tâm OA
   * và tài khoản cán bộ đang gắn (join theo zalo_follower_id). Mới truy cập lên đầu.
   */
  async listCitizens(opts: {
    q?: string; page: number; limit: number; tdpId?: number;
    filter?: 'followers' | 'staff'; viewerRole?: string;
  }) {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.q) {
      params.push(`%${opts.q}%`);
      where.push(`(u.name ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR u.zalo_user_id ILIKE $${params.length})`);
    }
    if (opts.tdpId) { params.push(opts.tdpId); where.push(`u.tdp_id = $${params.length}`); }
    if (opts.filter === 'followers') where.push(`u.zalo_follower_id IS NOT NULL`);
    if (opts.filter === 'staff') where.push(`a.id IS NOT NULL`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const base = `
      FROM users u
      LEFT JOIN admin_users a ON a.zalo_follower_id = u.zalo_follower_id AND a.is_active = true
      LEFT JOIN tdp t ON t.id = u.tdp_id
      ${whereSql}`;
    const countRows = await this.dataSource.query(`SELECT count(*)::int AS total ${base}`, params);
    const total: number = countRows?.[0]?.total ?? 0;

    const offset = (opts.page - 1) * opts.limit;
    const rows = await this.dataSource.query(
      `SELECT u.id, u.zalo_user_id, u.name, u.avatar, u.phone, u.address, u.tdp_id, t.name AS tdp_name,
              (u.zalo_follower_id IS NOT NULL) AS is_follower,
              u.created_at, u.updated_at AS last_seen_at,
              a.id AS staff_id, a.role AS staff_role, a.department AS staff_department
       ${base}
       ORDER BY u.updated_at DESC
       LIMIT ${opts.limit} OFFSET ${offset}`,
      params,
    );
    // SĐT chỉ hiện đầy đủ cho super_admin — người khác xem dạng che
    const mask = opts.viewerRole !== 'super_admin';
    const data = rows.map((r: any) => ({ ...r, phone: mask ? maskPhone(r.phone) : r.phone }));
    return { data, total, page: opts.page, totalPages: Math.max(1, Math.ceil(total / opts.limit)) };
  }

  /**
   * Bổ nhiệm: tạo/kích hoạt lại admin_users gắn với zalo_follower_id của người dân.
   * Chưa có follower id → thử dịch user_id_by_app → user_id_by_oa; vẫn không có → 409 NOT_FOLLOWED.
   */
  async promoteCitizen(userId: number, dto: { role: string; department?: string; tdp_id?: number }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dân này.');

    if (dto.role === 'tdp_head' && !dto.tdp_id) {
      throw new BadRequestException('Bổ nhiệm tổ trưởng phải chọn tổ dân phố.');
    }
    if (dto.tdp_id) {
      const rows = await this.dataSource.query('SELECT id FROM tdp WHERE id = $1 AND is_active = true', [dto.tdp_id]);
      if (!rows?.length) throw new BadRequestException('Tổ dân phố không tồn tại hoặc đã ngừng hoạt động.');
    }

    let followerId = user.zalo_follower_id;
    if (!followerId && user.zalo_user_id) {
      const profile = await this.getFollowerProfile(user.zalo_user_id);
      if (profile?.user_id_by_oa) {
        followerId = profile.user_id_by_oa;
        user.zalo_follower_id = followerId;
        await this.userRepo.save(user);
      }
    }
    if (!followerId) {
      throw new ConflictException({
        code: 'NOT_FOLLOWED',
        message: 'Người này chưa quan tâm Zalo OA của xã nên chưa gắn được tài khoản cán bộ. Hãy nhờ họ quan tâm OA rồi thử lại, hoặc dùng lời mời QR.',
      });
    }

    // 1 Zalo = 1 tài khoản cán bộ: có rồi thì cập nhật vai trò + kích hoạt lại
    let admin = await this.adminUserRepo.findOne({ where: { zalo_follower_id: followerId } });
    if (admin) {
      admin.role = dto.role as any;
      admin.department = dto.department ?? admin.department ?? null;
      admin.tdp_id = dto.role === 'tdp_head' ? (dto.tdp_id ?? admin.tdp_id ?? null) : null;
      admin.is_active = true;
      if (!admin.full_name && user.name) admin.full_name = user.name;
      admin = await this.adminUserRepo.save(admin);
    } else {
      admin = await this.adminUserRepo.save(
        this.adminUserRepo.create({
          full_name: user.name || 'Cán bộ',
          email: null,
          password_hash: null,
          zalo_follower_id: followerId,
          zalo_name: user.name ?? null,
          role: dto.role as any,
          department: dto.department ?? null,
          tdp_id: dto.role === 'tdp_head' ? dto.tdp_id ?? null : null,
          tenant_id: defaultTenantId(),
          is_active: true,
        } as Partial<AdminUser>),
      );
    }
    return {
      id: user.id,
      staff_id: admin.id,
      role: admin.role,
      department: admin.department,
      tdp_id: admin.tdp_id,
      message: 'Đã bổ nhiệm. Người này cần đóng và mở lại Mini App để thấy Khu vực cán bộ.',
    };
  }

  /** Thu hồi: khoá tài khoản admin gắn với người dân (không xoá, giữ nhật ký). */
  async revokeCitizen(userId: number, actorAdminId?: number) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dân này.');
    if (!user.zalo_follower_id) throw new NotFoundException('Người này chưa có tài khoản cán bộ.');
    const admin = await this.adminUserRepo.findOne({ where: { zalo_follower_id: user.zalo_follower_id, is_active: true } });
    if (!admin) throw new NotFoundException('Người này chưa có tài khoản cán bộ đang hoạt động.');
    if (actorAdminId && admin.id === actorAdminId) {
      throw new BadRequestException('Không thể tự thu hồi quyền của chính mình.');
    }
    await this.adminUserRepo.update(admin.id, { is_active: false });
    return { id: user.id, staff_id: admin.id, revoked: true };
  }

  private async getFollowerProfile(followerId: string): Promise<{ display_name: string; user_id_by_oa: string | null } | null> {
    try {
      const oaToken = await this.getOaToken();
      if (!oaToken) {
        console.warn('[getFollowerProfile] No OA token available');
        return null;
      }
      // V3 API (v2.0/oa/getprofile đã bị tắt từ 06/2024)
      const url = `https://openapi.zalo.me/v3.0/oa/user/detail?data=${encodeURIComponent(JSON.stringify({ user_id: followerId }))}`;
      const res = await fetch(url, { headers: { access_token: oaToken } });
      if (!res.ok) {
        console.warn('[getFollowerProfile] HTTP', res.status, res.statusText);
        return null;
      }
      const data = await res.json();
      if (data.error !== 0) {
        console.warn('[getFollowerProfile] API error', data.error, data.message);
        if (data.error === -216 || data.error === -213) {
          // Token invalid — force ZaloOaService refresh ngay
          await this.zaloOa.refreshOaTokenProactive().catch(() => {});
          console.warn('[getFollowerProfile] Token invalid — triggered refresh');
        }
        return null;
      }
      const displayName = data.data?.display_name ?? data.data?.name ?? null;
      // Response Zalo /v3.0/oa/user/detail:
      //   data.user_id        = ID trong scope OA (cái cần để gửi tin OA)
      //   data.user_id_by_app = ID trong scope Mini App (echo input nếu input là by_app)
      // Lấy user_id trước, fallback user_id_by_oa nếu Zalo đổi format.
      const userIdByOa: string | null =
        data.data?.user_id ?? data.data?.user_id_by_oa ?? null;
      if (!displayName) return null;
      return { display_name: displayName, user_id_by_oa: userIdByOa };
    } catch (err) {
      console.warn('[getFollowerProfile] exception:', err);
      return null;
    }
  }


  // ─── System health ────────────────────────────────────────────────────────

  async checkSystemHealth() {
    const issues: { type: string; message: string; severity: 'warning' | 'error' }[] = [];

    // DO360: kênh Zalo là tuỳ chọn (kênh tạm trước Tammi). Chưa khai báo ZALO_* nào → không coi là lỗi, không hiện banner.
    const zaloIntended = ['ZALO_APP_ID', 'ZALO_OA_APP_ID', 'ZALO_ACCESS_TOKEN', 'ZALO_REFRESH_TOKEN'].some((k) => (this.configService.get<string>(k) || '').trim());
    if (!zaloIntended) return { ok: true, issues };

    const oaToken = await this.getOaToken();
    if (!oaToken) {
      issues.push({ type: 'oa_token', message: 'ZALO_ACCESS_TOKEN chưa được cấu hình', severity: 'error' });
    } else {
      try {
        const res = await fetch('https://openapi.zalo.me/v3.0/oa/getoa', {
          headers: { access_token: oaToken },
        });
        const data = await res.json();
        if (data.error === -216) {
          issues.push({ type: 'oa_token', message: 'OA Access Token đã hết hạn — đang refresh tự động', severity: 'warning' });
          await this.zaloOa.refreshOaTokenProactive().catch(() => {});
        }
      } catch {
        issues.push({ type: 'oa_token', message: 'Không thể kết nối Zalo OA API', severity: 'warning' });
      }
    }

    const appId = this.configService.get('ZALO_APP_ID');
    const appSecret = this.configService.get('ZALO_APP_SECRET');
    if (!appId || !appSecret) {
      issues.push({ type: 'zalo_app', message: 'ZALO_APP_ID hoặc ZALO_APP_SECRET chưa cấu hình', severity: 'error' });
    }

    return { ok: issues.length === 0, issues };
  }

  // ─── Cron: dọn session cũ ────────────────────────────────────────────────

  @Cron('*/10 * * * *')
  async cleanExpiredSessions() {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    await this.qrSessionRepo
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff })
      .execute();
  }
}
