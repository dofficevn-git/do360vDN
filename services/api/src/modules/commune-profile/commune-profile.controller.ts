import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CommuneProfileService } from './commune-profile.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { getFeatures, getTier, ALLOWED_ROLES, MSG_LEVEL } from '../../common/features';

@ApiTags('Commune Profile')
@Controller()
export class CommuneProfileController {
  constructor(private service: CommuneProfileService) {}

  /** Kèm thông tin gói (tier/features) — FE đọc để ẩn/hiện tính năng.
   *  Tier chỉ đến từ env APP_TIER, KHÔNG sửa được qua API. */
  private tierInfo() {
    const tier = getTier();
    return {
      tier,
      features: getFeatures(),
      allowed_roles: ALLOWED_ROLES[tier],
      msg_level: MSG_LEVEL[tier],
    };
  }

  @Get('public/profile')
  async getPublic() {
    const profile = await this.service.getProfile();
    return { ...profile, ...this.tierInfo() };
  }

  @Get('admin/profile')
  @UseGuards(AdminGuard, RolesGuard)
  @ApiBearerAuth()
  async getAdmin() {
    const profile = await this.service.getProfile();
    return { ...profile, ...this.tierInfo() };
  }

  @Patch('admin/profile')
  @UseGuards(AdminGuard, RolesGuard)
  @ApiBearerAuth()
  update(@Body() body: any) {
    // Chặn mọi ý đồ ghi đè thông tin gói qua API
    const { tier, features, allowed_roles, msg_level, ...rest } = body ?? {};
    return this.service.updateProfile(rest);
  }
}
