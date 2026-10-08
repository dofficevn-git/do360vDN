import { Body, Controller, Get, Module, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KpiCriterion, KpiScore } from './kpi.entity';
import { KpiService } from './kpi.service';
import { Employee } from '../employees/employee.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { FactsModule } from '../facts/facts.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { MANAGER_ROLES } from '../../common/roles';
import { tenantOf } from '../../common/tenant';
import { Actor } from '../facts/facts.service';

const actorOf = (req: any): Actor => ({ id: req.user.id, role: req.user.role, department: req.user.department ?? null, tenant_id: tenantOf(req) });
const OVERSEERS = [...MANAGER_ROLES, 'leader'] as const;

@ApiTags('KPI')
@Controller('admin/kpi')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class KpiController {
  constructor(private service: KpiService) {}

  @Get('criteria')
  criteria() { return this.service.listCriteria(); }

  @Post('reload')
  @Roles('super_admin')
  @AuditLog({ module: 'kpi', action: 'reload' })
  reload() { return this.service.reload(); }

  @Get('employees')
  employees(@Request() req) { return this.service.listEmployees(tenantOf(req)); }

  @Post('employees')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'upsert_employee' })
  upsertEmployee(@Request() req, @Body() body: any) { return this.service.upsertEmployee(actorOf(req), body ?? {}); }

  @Post('employees/sync-from-accounts')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'sync_employees' })
  syncEmployees(@Request() req) { return this.service.syncFromAccounts(actorOf(req)); }

  @Get('export/tasks')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'export_tasks' })
  @ApiOperation({ summary: 'Dữ liệu việc theo cán bộ trong kỳ — cấp cho module KPI' })
  exportTasks(@Request() req, @Query('period') period: string) { return this.service.exportTasks(tenantOf(req), period); }

  @Post('compute')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'compute' })
  @ApiOperation({ summary: 'Tính điểm ĐỀ XUẤT từ việc/văn bản/số liệu theo công thức cấu hình' })
  compute(@Request() req, @Body() body: { period: string }) { return this.service.compute(actorOf(req), body?.period); }

  @Get('scores')
  @AuditLog({ module: 'kpi', action: 'view_scores' })
  @ApiOperation({ summary: 'Điểm KPI (cán bộ chỉ thấy của mình; lãnh đạo thấy đơn vị) — mọi lượt xem ghi nhật ký' })
  scores(@Request() req, @Query('period') period: string, @Query('employee_id') employeeId?: string) { return this.service.scoresFor(actorOf(req), period, Number(employeeId) || undefined); }

  @Post('scores/import')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'import_scores' })
  @ApiOperation({ summary: 'Nhận điểm đã duyệt từ module KPI / điểm định tính lãnh đạo nhập' })
  importScores(@Request() req, @Body() body: { rows: any[] }) { return this.service.importScores(actorOf(req), body?.rows ?? []); }

  @Post('scores/:id/explain')
  @AuditLog({ module: 'kpi', action: 'explain', entity: 'kpi_score' })
  explain(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { explanation: string }) { return this.service.explain(actorOf(req), id, body?.explanation); }

  @Post('scores/approve')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'approve' })
  approve(@Request() req, @Body() body: { ids: number[] }) { return this.service.approve(actorOf(req), (body?.ids ?? []).map(Number)); }

  @Get('summary')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'view_summary' })
  summary(@Request() req, @Query('period') period: string) { return this.service.summary(tenantOf(req), period); }

  @Post('publish')
  @Roles(...OVERSEERS)
  @AuditLog({ module: 'kpi', action: 'publish' })
  @ApiOperation({ summary: 'Đẩy số tổng hợp KPI vào kho chỉ tiêu cho báo cáo KPI' })
  publish(@Request() req, @Body() body: { period: string }) { return this.service.publish(actorOf(req), body?.period); }
}

@Module({
  imports: [TypeOrmModule.forFeature([KpiCriterion, KpiScore, Employee, AdminUser]), FactsModule, CatalogModule],
  controllers: [KpiController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
