import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommuneProfile } from './commune-profile.entity';

@Injectable()
export class CommuneProfileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommuneProfileService.name);

  /**
   * CSDL cài mới không có dòng hồ sơ nào → PATCH /admin/profile từng chết vì cột `name` NOT NULL
   * (service tạo dòng mới chỉ với vài trường admin gửi). Tạo sẵn 1 dòng mặc định, admin sửa sau.
   */
  async onApplicationBootstrap() {
    try {
      const count = await this.repo.count();
      if (count > 0) return;
      await this.repo.save(this.repo.create({ name: process.env.COMMUNE_NAME || 'Xã Thành Công', primary_color: CommuneProfileService.BRAND_COLOR }));
      this.logger.log('Đã tạo hồ sơ xã mặc định (CSDL trống) — cập nhật tên/địa chỉ ở Cài đặt.');
    } catch (err) {
      this.logger.error(`Tạo hồ sơ xã mặc định thất bại: ${err}`);
    }
  }

  constructor(@InjectRepository(CommuneProfile) private repo: Repository<CommuneProfile>) {}

  getProfile() {
    return this.repo.findOne({ where: {} });
  }

  async updateProfile(data: Partial<CommuneProfile>) {
    const profile = await this.repo.findOne({ where: {} });
    let saved: CommuneProfile;
    if (profile) {
      saved = await this.repo.save({ ...profile, ...data });
    } else {
      saved = await this.repo.save(this.repo.create(data));
    }
    this.syncAppConfig(saved);
    return saved;
  }

  // Màu thương hiệu fix cứng — không lấy từ DB/hồ sơ nữa.
  private static readonly BRAND_COLOR = '#0F3D6E';
  private static readonly BRAND_TEXT_COLOR = '#ffffff';

  private syncAppConfig(profile: CommuneProfile) {
    // Cập nhật app-config.json để ZMP simulator dùng đúng tên xã sau khi restart.
    // Màu header/status bar đã fix cứng, không đổi theo hồ sơ.
    const targets = [
      path.join(__dirname, '../../../../../apps/miniapp/app-config.json'),
      path.join(__dirname, '../../../../../apps/miniapp/www/app-config.json'),
    ];

    for (const configPath of targets) {
      try {
        if (!fs.existsSync(configPath)) continue;
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        config.app.headerColor = CommuneProfileService.BRAND_COLOR;
        config.app.statusBarColor = CommuneProfileService.BRAND_COLOR;
        config.app.textColor = CommuneProfileService.BRAND_TEXT_COLOR;
        if (profile.name) {
          config.app.title = profile.name;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } catch {
        // không crash nếu không ghi được file
      }
    }
  }
}
