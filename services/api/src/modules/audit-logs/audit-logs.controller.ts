import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuditLogsService } from './audit-logs.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MANAGER_ROLES } from '../../common/roles';

@ApiTags('Audit Logs')
@Roles(...MANAGER_ROLES)
@Controller('admin/audit-logs')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class AuditLogsController {
  constructor(private service: AuditLogsService) {}

  @Get()
  findAll(@Request() req) {
    return this.service.findAll(req.user?.tenant_id ?? undefined);
  }
}
