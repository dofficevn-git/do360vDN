import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminUsersService } from './admin-users.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { ALL_ADMIN_ROLES, MANAGER_ROLES } from '../../common/roles';
import { tenantOf } from '../../common/tenant';

@ApiTags('Admin Users')
@Controller('admin/users')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class AdminUsersController {
  constructor(private service: AdminUsersService) {}

  /** Danh sách cán bộ nhận phân công (id/tên/phòng ban) — cho picker trên Mini App. */
  @Get('assignable')
  @Roles(...ALL_ADMIN_ROLES)
  findAssignable(@Request() req, @Query('include_tdp_head') includeTdpHead?: string, @Query('department') department?: string) {
    return this.service.findAssignable({ tenantId: tenantOf(req), includeTdpHead: includeTdpHead === '1' || includeTdpHead === 'true', department: department || undefined });
  }

  @Get()
  @Roles(...MANAGER_ROLES)
  findAll(@Request() req) {
    return this.service.findAll(tenantOf(req));
  }

  // Cấp/sửa/xoá tài khoản cán bộ đều phải để lại vết trong nhật ký hệ thống.
  // Interceptor tự che password/password_hash trước khi ghi.
  @Post()
  @Roles('super_admin')
  @AuditLog({ module: 'admin_users', action: 'create' })
  create(@Request() req, @Body() body: any) {
    // tenant_id KHÔNG nhận từ client: tài khoản mới thuộc đơn vị của người tạo
    return this.service.create({ ...body, tenant_id: tenantOf(req) });
  }

  @Patch(':id')
  @Roles('super_admin')
  @AuditLog({ module: 'admin_users', action: 'update', entity: 'admin_users' })
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(tenantOf(req), id, body);
  }

  @Delete(':id')
  @Roles('super_admin')
  @AuditLog({ module: 'admin_users', action: 'remove', entity: 'admin_users' })
  remove(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(tenantOf(req), id);
  }
}
