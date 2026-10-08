import { Controller, Get, Patch, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ALL_ADMIN_ROLES } from '../../common/roles';
import { StaffNotificationsService } from './staff-notifications.service';

@ApiTags('StaffNotifications')
@Roles(...ALL_ADMIN_ROLES) // hộp thư cá nhân — mọi admin (kể cả tổ trưởng), tự scope theo req.user.id
@Controller('admin/staff-notifications')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class StaffNotificationsController {
  constructor(private service: StaffNotificationsService) {}

  @Get()
  findAll(@Request() req: any, @Query('page') page = '1') {
    return this.service.findForUser(req.user.id, +page);
  }

  @Get('unread-count')
  async unreadCount(@Request() req: any) {
    const count = await this.service.countUnread(req.user.id);
    return { count };
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Request() req: any) {
    return this.service.markRead(+id, req.user.id);
  }

  @Patch('read-all')
  markAllRead(@Request() req: any) {
    return this.service.markAllRead(req.user.id);
  }
}