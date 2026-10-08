import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { MANAGER_ROLES } from '../../common/roles';
import { PromoteCitizenDto } from './dto/promote-citizen.dto';

/**
 * Danh sách người dân đã mở Mini App + bổ nhiệm thẳng thành cán bộ (mẫu CT5D).
 * Mỗi lần dân đăng nhập Zalo là có một dòng `users`; lãnh đạo chọn người trong danh sách
 * này để cấp quyền, không phải gửi lời mời QR. Điều kiện: người đó đã quan tâm OA
 * (có `zalo_follower_id`) — vì Khu vực cán bộ nhận diện qua chính cột đó.
 */
@ApiTags('Citizens')
@Controller('admin/citizens')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class CitizensController {
  constructor(private auth: AuthService) {}

  @Get()
  @Roles(...MANAGER_ROLES)
  @ApiOperation({ summary: 'Người dân đã truy cập Mini App, kèm cờ đã quan tâm OA và vai trò cán bộ (nếu có)' })
  list(
    @Request() req,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tdp_id') tdpId?: string,
    @Query('filter') filter?: 'followers' | 'staff' | '',
  ) {
    return this.auth.listCitizens({
      q: q?.trim() || undefined,
      page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
      tdpId: tdpId ? parseInt(tdpId, 10) : undefined,
      filter: filter || undefined,
      viewerRole: req.user?.role,
    });
  }

  @Post('refresh-followers')
  @Roles(...MANAGER_ROLES)
  @ApiOperation({ summary: 'Hỏi lại Zalo cờ "đã quan tâm OA" cho người dân chưa có follower id (dùng sau khi đổi token OA)' })
  refreshFollowers() {
    return this.auth.refreshFollowerFlags();
  }

  @Post(':id/promote')
  @Roles('super_admin')
  @AuditLog({ module: 'citizens', action: 'promote', entity: 'users' })
  @ApiOperation({ summary: 'Bổ nhiệm người dân thành cán bộ/quản trị' })
  promote(@Param('id', ParseIntPipe) id: number, @Body() dto: PromoteCitizenDto) {
    return this.auth.promoteCitizen(id, dto);
  }

  @Post(':id/revoke')
  @Roles('super_admin')
  @AuditLog({ module: 'citizens', action: 'revoke', entity: 'users' })
  @ApiOperation({ summary: 'Thu hồi quyền cán bộ (khoá tài khoản admin gắn với người dân này)' })
  revoke(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.auth.revokeCitizen(id, req.user?.id);
  }
}
