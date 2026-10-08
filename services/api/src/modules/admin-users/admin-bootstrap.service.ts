import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from './admin-user.entity';

/**
 * Tạo tài khoản quản trị đầu tiên khi CSDL trống — để bản cài mới luôn đăng nhập được
 * web admin mà không phải INSERT tay. Idempotent: đã có bất kỳ admin nào thì bỏ qua.
 * Email/mật khẩu lấy từ env BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD.
 */
/** Giá trị env rỗng/toàn khoảng trắng phải rơi về mặc định, không dùng nguyên chuỗi rỗng. */
function envOr(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
}

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @InjectRepository(AdminUser) private repo: Repository<AdminUser>,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const count = await this.repo.count();
      if (count > 0) return;

      // Biến khai trong .env nhưng ĐỂ TRỐNG vẫn được coi là "đã khai", ConfigService
      // trả chuỗi rỗng chứ KHÔNG lấy giá trị mặc định — trước đây khiến tài khoản
      // quản trị đầu tiên bị tạo với mật khẩu rỗng và không đăng nhập được.
      const email = envOr(this.config.get('BOOTSTRAP_ADMIN_EMAIL'), 'admin@thanhcong.hanoi.gov.vn');
      const password = envOr(this.config.get('BOOTSTRAP_ADMIN_PASSWORD'), 'Admin@123');
      const password_hash = await bcrypt.hash(password, 10);

      await this.repo.save(
        this.repo.create({
          email,
          password_hash,
          full_name: 'Quản trị hệ thống',
          role: 'super_admin',
          is_active: true,
        } as Partial<AdminUser>),
      );
      this.logger.warn(
        `Đã tạo tài khoản quản trị đầu tiên: ${email}. ` +
          'ĐỔI MẬT KHẨU NGAY sau lần đăng nhập đầu (hoặc đặt BOOTSTRAP_ADMIN_PASSWORD riêng trước khi cài).',
      );
    } catch (err) {
      this.logger.error(`Bootstrap admin thất bại: ${err}`);
    }
  }
}
