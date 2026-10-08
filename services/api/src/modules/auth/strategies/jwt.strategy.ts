import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '../../admin-users/admin-user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(AdminUser)
    private adminUserRepo: Repository<AdminUser>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET', 'change-me-in-production'),
    });
  }

  async validate(payload: any) {
    let tdp_id: number | null = null;
    let department: string | null = null;
    let tenant_id: string | null = null;
    // Role lấy TƯƠI từ DB (không tin payload) — đổi role/khoá tài khoản có hiệu lực ngay,
    // không phải chờ token 7 ngày hết hạn.
    let role: string = payload.role;
    if (payload.type === 'admin') {
      const user = await this.adminUserRepo.findOne({
        where: { id: payload.sub, is_active: true },
      });
      if (!user) throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị vô hiệu');
      tdp_id = user.tdp_id ?? null;
      department = user.department ?? null;
      tenant_id = user.tenant_id ?? null;
      role = user.role;
    }
    return {
      id: payload.sub,
      email: payload.email,
      role,
      type: payload.type,
      tdp_id,
      department,
      tenant_id,
    };
  }
}
