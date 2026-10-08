import { Body, Controller, Get, Module, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FactIndicator, FactStatusLog } from './fact-indicator.entity';
import { Actor, ExtractedRecord, FactsService } from './facts.service';
import { CatalogModule } from '../catalog/catalog.module';
import { QualityGateService } from './quality-gate.service';
import { StaffNotificationsModule } from '../staff-notifications/staff-notifications.module';
import { DepartmentsModule } from '../departments/departments.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { tenantOf } from '../../common/tenant';

const APPROVERS = ['super_admin', 'commune_admin', 'leader'] as const;

function actorOf(req: any): Actor {
  return { id: req.user.id, role: req.user.role, department: req.user.department ?? null, tenant_id: tenantOf(req) };
}

@ApiTags('Facts')
@Controller('admin/facts')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class FactsController {
  constructor(private service: FactsService) {}

  @Get()
  @ApiOperation({ summary: 'Bộ số hiện hành của một kỳ (cán bộ phòng chỉ thấy chỉ tiêu của phòng mình)' })
  current(@Request() req, @Query('period') period: string, @Query('domain') domain?: string) {
    const a = actorOf(req);
    const ownerDept = a.role === 'department_staff' ? a.department ?? '__none__' : undefined;
    return this.service.currentForPeriod(a.tenant_id, period, { domain: domain || undefined, ownerDept });
  }

  @Get('quarantine')
  quarantine(@Request() req) {
    return this.service.quarantine(tenantOf(req));
  }

  @Get('history')
  history(@Request() req, @Query('indicator_id') indicatorId: string, @Query('period') period: string) {
    return this.service.history(tenantOf(req), indicatorId, period);
  }

  @Post('ingest')
  @AuditLog({ module: 'facts', action: 'ingest' })
  @ApiOperation({ summary: 'Nộp số (form nhập tay hoặc kết quả bóc tách) — luôn vào trạng thái extracted' })
  ingest(@Request() req, @Body() body: { records: ExtractedRecord[]; channel?: string }) {
    return this.service.ingest(actorOf(req), body?.records, body?.channel ?? 'web');
  }

  @Post(':id/confirm')
  @AuditLog({ module: 'facts', action: 'confirm', entity: 'fact_indicator' })
  confirm(@Request() req, @Param('id') id: string) {
    return this.service.confirm(actorOf(req), id);
  }

  @Post(':id/correct')
  @AuditLog({ module: 'facts', action: 'correct', entity: 'fact_indicator' })
  @ApiOperation({ summary: 'Sửa số bóc sai — thêm phiên bản mới, không ghi đè' })
  correct(@Request() req, @Param('id') id: string, @Body() body: { value: number | string; as_of_date?: string; reason?: string }) {
    return this.service.correct(actorOf(req), id, body);
  }

  @Post('approve')
  @Roles(...APPROVERS, 'department_staff')
  @AuditLog({ module: 'facts', action: 'approve' })
  @ApiOperation({ summary: 'Data Owner duyệt số của lĩnh vực mình: confirmed → approved' })
  approve(@Request() req, @Body() body: { ids: string[] }) {
    return this.service.approve(actorOf(req), (body?.ids ?? []).map(String));
  }

  @Post(':id/resolve')
  @AuditLog({ module: 'facts', action: 'resolve', entity: 'fact_indicator' })
  @ApiOperation({ summary: 'Data Owner quyết số đang cách ly: accept (thay số hiện hành) | reject — lý do bắt buộc' })
  resolve(@Request() req, @Param('id') id: string, @Body() body: { decision: 'accept' | 'reject'; reason: string }) {
    return this.service.resolve(actorOf(req), id, body?.decision, body?.reason);
  }

  @Post(':id/reject')
  @AuditLog({ module: 'facts', action: 'reject', entity: 'fact_indicator' })
  reject(@Request() req, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.service.reject(actorOf(req), id, body?.reason);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([FactIndicator, FactStatusLog]), CatalogModule, StaffNotificationsModule, DepartmentsModule],
  controllers: [FactsController],
  providers: [FactsService, QualityGateService],
  exports: [FactsService, QualityGateService, TypeOrmModule],
})
export class FactsModule {}
