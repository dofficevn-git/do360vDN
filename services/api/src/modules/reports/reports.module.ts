import { Body, Controller, Get, Module, Param, ParseIntPipe, Post, Query, Request, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../../common/decorators/roles.decorator';
import { READER_ROLES } from '../../common/roles';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportRun } from './report-run.entity';
import { ReportsService } from './reports.service';
import { ReportRenderer } from './report-renderer';
import { ReportNarrative } from './report-narrative.entity';
import { LocalLlmWriter, TemplateWriter } from './narrative-writer';
import { CatalogModule } from '../catalog/catalog.module';
import { FactsModule } from '../facts/facts.module';
import { EventsModule } from '../events/events.module';
import { BronzeModule } from '../bronze/bronze.module';
import { PlansModule } from '../plans/plans.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { tenantOf } from '../../common/tenant';
import { Actor } from '../facts/facts.service';

const actorOf = (req: any): Actor => ({ id: req.user.id, role: req.user.role, department: req.user.department ?? null, tenant_id: tenantOf(req) });

@ApiTags('Reports')
@Controller('admin/report-runs')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get()
  @Roles(...READER_ROLES)
  list(@Request() req) { return this.service.list(tenantOf(req), req.user.role); }

  @Post()
  @AuditLog({ module: 'reports', action: 'create_run' })
  @ApiOperation({ summary: 'Mở kỳ báo cáo: chọn mẫu, kỳ, ngày chốt' })
  create(@Request() req, @Body() body: { spec_id: number; period: string; cutoff_date: string }) { return this.service.create(actorOf(req), body); }

  @Get(':id')
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Tiến độ + Quality Gate của kỳ' })
  status(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.service.status(tenantOf(req), id, req.user.role); }

  @Post(':id/exceptions')
  @AuditLog({ module: 'reports', action: 'set_exception', entity: 'report_run' })
  exception(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { indicator_id?: string; indicator_ids?: string[]; reason: string }) {
    return this.service.setException(actorOf(req), id, body?.indicator_ids?.length ? body.indicator_ids : body?.indicator_id ?? [], body?.reason);
  }

  @Post(':id/lock')
  @AuditLog({ module: 'reports', action: 'lock', entity: 'report_run' })
  @ApiOperation({ summary: 'Chốt kỳ: Quality Gate phải đạt, đóng băng snapshot, khoá số' })
  lock(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.service.lock(actorOf(req), id); }

  @Post(':id/unlock')
  @AuditLog({ module: 'reports', action: 'unlock', entity: 'report_run' })
  unlock(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { reason: string }) { return this.service.unlock(actorOf(req), id, body?.reason); }

  @Post(':id/cancel')
  @Roles('super_admin')
  @AuditLog({ module: 'reports', action: 'cancel', entity: 'report_run' })
  @ApiOperation({ summary: 'Huỷ lần lập báo cáo (lập nhầm / thu hồi) — chỉ super_admin, có lý do' })
  cancel(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: { reason: string }) { return this.service.cancel(actorOf(req), id, body?.reason); }

  @Post(':id/render')
  @AuditLog({ module: 'reports', action: 'render', entity: 'report_run' })
  @ApiOperation({ summary: 'Sinh bản nháp .docx từ snapshot + hậu kiểm' })
  async render(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const { docx: _d, ...rest } = await this.service.render(actorOf(req), id);
    return rest;
  }

  @Get(':id/preview')
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Cây tài liệu để đọc báo cáo trên web (mục, câu số dạng mảnh có nguồn, lời dẫn, chú thích)' })
  preview(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.service.preview(tenantOf(req), id, req.user.role); }

  @Get(':id/narratives')
  @Roles(...READER_ROLES)
  narratives(@Request() req, @Param('id', ParseIntPipe) id: number) { return this.service.listNarratives(tenantOf(req), id, req.user.role); }

  @Post(':id/narratives/:slot')
  @AuditLog({ module: 'reports', action: 'narrative_save' })
  saveNarrative(@Request() req, @Param('id', ParseIntPipe) id: number, @Param('slot') slot: string, @Body() body: { text: string; source?: string }) { return this.service.saveNarrative(actorOf(req), id, slot, body?.text, body?.source); }

  @Post(':id/narratives/:slot/accept')
  @AuditLog({ module: 'reports', action: 'narrative_accept' })
  acceptNarrative(@Request() req, @Param('id', ParseIntPipe) id: number, @Param('slot') slot: string) { return this.service.acceptNarrative(actorOf(req), id, slot); }

  @Post(':id/narratives/:slot/suggest')
  @AuditLog({ module: 'reports', action: 'narrative_suggest' })
  suggestNarrative(@Request() req, @Param('id', ParseIntPipe) id: number, @Param('slot') slot: string, @Body() body: { provider?: 'template' | 'llm' }) { return this.service.suggestNarrative(actorOf(req), id, slot, body?.provider ?? 'template'); }

  @Get(':id/download')
  @Roles(...READER_ROLES)
  async download(@Request() req, @Param('id', ParseIntPipe) id: number, @Res() res: Response, @Query('which') which?: 'draft' | 'edited' | 'signed') {
    const { run, stream } = await this.service.download(tenantOf(req), id, which ?? 'draft');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-${run.period}-run${run.run_id}${which && which !== 'draft' ? '-' + which : ''}.docx"`);
    stream.pipe(res);
  }

  @Post(':id/edited')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }))
  @AuditLog({ module: 'reports', action: 'check_edited', entity: 'report_run' })
  @ApiOperation({ summary: 'Tải bản Word đã biên tập để đối chiếu số với snapshot' })
  edited(@Request() req, @Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) throw new Error('Thiếu file');
    return this.service.checkEdited(actorOf(req), id, { buffer: file.buffer, originalname: file.originalname });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ReportRun, ReportNarrative]), CatalogModule, FactsModule, EventsModule, BronzeModule, PlansModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportRenderer, TemplateWriter, LocalLlmWriter],
  exports: [ReportsService],
})
export class ReportsModule {}
