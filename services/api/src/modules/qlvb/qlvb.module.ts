import { Body, Controller, Get, HttpCode, Logger, Module, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QlvbDocument } from './qlvb-document.entity';
import { QlvbService } from './qlvb.service';
import { LgspQlvbAdapter } from './lgsp-qlvb.adapter';
import { SimQlvbAdapter } from './sim-qlvb.adapter';
import { ReportRun } from '../reports/report-run.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { Task } from '../tasks/task.entity';
import { EventsModule } from '../events/events.module';
import { TasksModule } from '../tasks/tasks.module';
import { BronzeModule } from '../bronze/bronze.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { MANAGER_ROLES } from '../../common/roles';
import { tenantOf } from '../../common/tenant';
import { Actor } from '../facts/facts.service';

const actorOf = (req: any): Actor => ({ id: req.user.id, role: req.user.role, department: req.user.department ?? null, tenant_id: tenantOf(req) });

@ApiTags('QLVB')
@Controller('admin/qlvb')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class QlvbController {
  constructor(private service: QlvbService) {}

  @Get('status')
  status(@Request() req) { return this.service.status(tenantOf(req)); }

  @Get('documents')
  documents(@Request() req, @Query('period') period?: string, @Query('direction') direction?: string, @Query('limit') limit?: string) {
    return this.service.listDocuments(tenantOf(req), { period, direction, limit: Number(limit) || undefined });
  }

  @Post('sync')
  @Roles(...MANAGER_ROLES)
  @AuditLog({ module: 'qlvb', action: 'sync' })
  @ApiOperation({ summary: 'Đồng bộ sổ văn bản đi/đến → event_log + giao việc xử lý' })
  sync(@Request() req, @Body() body: { start?: string; end?: string; period?: string }) { return this.service.sync(actorOf(req), body ?? {}); }

  @Post('report-runs/:id/submit')
  @Roles(...MANAGER_ROLES)
  @AuditLog({ module: 'qlvb', action: 'submit', entity: 'report_run' })
  @ApiOperation({ summary: 'Trình ký bản nháp đã sinh (drafted → submitted)' })
  submit(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { signer?: string; recipients?: string[] }) { return this.service.submit(actorOf(req), id, body ?? {}); }

  @Post('report-runs/:id/check-sign')
  @Roles(...MANAGER_ROLES, 'leader')
  @AuditLog({ module: 'qlvb', action: 'check_sign', entity: 'report_run' })
  @ApiOperation({ summary: 'Hỏi QLVB bản đã ký chưa; ký rồi → signed + sự kiện ban hành' })
  check(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.service.checkSigned(tenantOf(req), id); }

  @Post('sim/documents')
  @Roles(...MANAGER_ROLES)
  @AuditLog({ module: 'qlvb', action: 'sim_seed' })
  @ApiOperation({ summary: 'Giả lập: nạp sổ văn bản (hoặc dán từ file export khi API gián đoạn)' })
  seed(@Request() req, @Body() body: { documents: any[] }) { return this.service.seedSim(actorOf(req), body?.documents ?? []); }

  @Post('sim/schedule')
  @Roles(...MANAGER_ROLES)
  @AuditLog({ module: 'qlvb', action: 'sim_schedule' })
  @ApiOperation({ summary: 'Giả lập: nạp lịch công tác → sự kiện họp (MTG)' })
  schedule(@Request() req, @Body() body: { items: any[] }) { return this.service.seedSchedule(actorOf(req), body?.items ?? []); }

  @Post('sim/sign/:docId')
  @Roles(...MANAGER_ROLES, 'leader')
  @AuditLog({ module: 'qlvb', action: 'sim_sign' })
  @ApiOperation({ summary: 'Giả lập lãnh đạo ký / trả lại văn bản đã trình' })
  sign(@Request() req, @Param('docId', ParseIntPipe) docId: number, @Body() body: { so_ky_hieu?: string; nguoi_ky?: string; reject?: string; ngay_ky?: string }) { return this.service.simSign(actorOf(req), docId, body ?? {}); }
}

/** Callback LGSP (responseMode CALLBACK) — hiện dùng POLLING; nhận và ghi log để không mất dữ liệu nếu LGSP vẫn gọi. */
@Controller('public/qlvb')
export class QlvbCallbackController {
  private readonly logger = new Logger('QlvbCallback');
  @Post('callback')
  @HttpCode(200)
  callback(@Body() body: any) {
    this.logger.log(`[LGSP callback] ${JSON.stringify(body).slice(0, 500)}`);
    return { ok: true };
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([QlvbDocument, ReportRun, AdminUser, Task]), EventsModule, TasksModule, BronzeModule, ReportsModule],
  controllers: [QlvbController, QlvbCallbackController],
  providers: [QlvbService, LgspQlvbAdapter, SimQlvbAdapter],
  exports: [QlvbService],
})
export class QlvbModule {}
