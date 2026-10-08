import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TdpService } from './tdp.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ALL_ADMIN_ROLES, MANAGER_ROLES } from '../../common/roles';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

@ApiTags('Tdp')
@Controller()
export class TdpController {
  constructor(private service: TdpService) {}

  @Get('public/tdp')
  listActive() {
    return this.service.listActive();
  }

  @Get('admin/tdp')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...ALL_ADMIN_ROLES) // cán bộ cần list tổ cho form thông báo; tổ trưởng vô hại
  @ApiBearerAuth()
  findAll() {
    return this.service.findAll();
  }

  // ── Khu vực tổ trưởng (Mini App) ──
  @Get('admin/tdp/me')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...ALL_ADMIN_ROLES)
  @ApiBearerAuth()
  myTdp(@Request() req) {
    return this.service.getMyTdp(req.user?.tdp_id ?? null);
  }

  @Get('admin/tdp/me/residents')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...ALL_ADMIN_ROLES)
  @ApiBearerAuth()
  myResidents(@Request() req) {
    return this.service.getResidents(req.user?.tdp_id ?? null);
  }

  @Post('admin/tdp')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...MANAGER_ROLES)
  @ApiBearerAuth()
  @AuditLog({ module: 'tdp', action: 'create' })
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Patch('admin/tdp/:id')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...MANAGER_ROLES)
  @ApiBearerAuth()
  @AuditLog({ module: 'tdp', action: 'update', entity: 'tdp' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(+id, body);
  }

  @Delete('admin/tdp/:id')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...MANAGER_ROLES)
  @ApiBearerAuth()
  @AuditLog({ module: 'tdp', action: 'delete', entity: 'tdp' })
  remove(@Param('id') id: string) {
    return this.service.remove(+id);
  }
}
