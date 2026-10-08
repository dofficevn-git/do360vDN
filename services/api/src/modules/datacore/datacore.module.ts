import { Body, Controller, Get, Module, Param, Patch, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DimObject, DocumentObjectLink, InteractionChannel, ObjectRelation } from './datacore.entities';
import { DictionaryService } from './dictionary.service';
import { ObjectInput, ObjectsService } from './objects.service';
import { DataMapService } from './datamap.service';
import { ExecutiveService } from './executive.service';
import { EventLog } from '../events/event-log.entity';
import { FactsModule } from '../facts/facts.module';
import { PlansModule } from '../plans/plans.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { MANAGER_ROLES, READER_ROLES } from '../../common/roles';
import { tenantOf } from '../../common/tenant';
import { Actor } from '../facts/facts.service';

const actorOf = (req: any): Actor => ({ id: req.user.id, role: req.user.role, department: req.user.department ?? null, tenant_id: tenantOf(req) });

/** Object Directory + Object 360 + Entity Resolution (Blueprint mục 8–11, 18, 52). */
@ApiTags('Data Core')
@Controller('admin/objects')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class ObjectsController {
  constructor(private service: ObjectsService) {}

  @Get('dictionary') @Roles(...READER_ROLES) dictionary() { return this.service.dictionary(); }
  @Get('counts') @Roles(...READER_ROLES) counts(@Request() req) { return this.service.counts(tenantOf(req)); }
  @Get('alerts') @Roles(...READER_ROLES) alerts(@Request() req, @Query('type') type?: string) { return this.service.alerts(tenantOf(req), type || undefined); }
  @Get() @Roles(...READER_ROLES)
  list(@Request() req, @Query('type') type?: string, @Query('q') q?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.service.list(tenantOf(req), { type: type || undefined, q: q || undefined, status: status || undefined, limit: Number(limit) || undefined });
  }
  @Post('resolve') @ApiOperation({ summary: 'Đối soát trùng trước khi tạo (Entity Resolution)' })
  resolve(@Request() req, @Body() body: { object_type: string; name?: string; master_id?: string; external_ids?: Record<string, string> }) { return this.service.resolve(tenantOf(req), body); }
  @Post() @AuditLog({ module: 'objects', action: 'create' }) create(@Request() req, @Body() body: ObjectInput) { return this.service.create(actorOf(req), body); }
  @Post('import') @AuditLog({ module: 'objects', action: 'import' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Nạp Object từ bảng danh sách Excel (mỗi dòng một công trình, một hộ…; cột Mã định danh chống trùng)' })
  importList(@Request() req, @UploadedFile() file: Express.Multer.File, @Body() body: { object_type: string }) {
    if (!file?.buffer) throw new Error('Thiếu file');
    return this.service.importList(actorOf(req), body?.object_type, { buffer: file.buffer, originalname: Buffer.from(file.originalname, 'latin1').toString('utf8') });
  }
  @Post('bulk') @AuditLog({ module: 'objects', action: 'bulk' }) bulk(@Request() req, @Body() body: { items: ObjectInput[] }) { return this.service.bulk(actorOf(req), body?.items ?? []); }
  @Get(':uid/360') @Roles(...READER_ROLES) @ApiOperation({ summary: 'Object 360: tổng quan, quan hệ, timeline, chỉ tiêu, nhiệm vụ, tài liệu, chất lượng, audit' })
  object360(@Request() req, @Param('uid') uid: string) { return this.service.object360(tenantOf(req), uid); }
  @Patch(':uid') @AuditLog({ module: 'objects', action: 'update' }) update(@Request() req, @Param('uid') uid: string, @Body() body: Partial<ObjectInput>) { return this.service.update(actorOf(req), uid, body); }
  @Post(':uid/verify') @AuditLog({ module: 'objects', action: 'verify' }) verify(@Request() req, @Param('uid') uid: string, @Body() body: { status: 'verified' | 'rejected'; note?: string }) { return this.service.verify(actorOf(req), uid, body.status, body.note); }
  @Post(':uid/relations') @AuditLog({ module: 'objects', action: 'relation' }) relation(@Request() req, @Param('uid') uid: string, @Body() body: any) { return this.service.addRelation(actorOf(req), uid, body); }
  @Post(':uid/events') @AuditLog({ module: 'objects', action: 'event' }) event(@Request() req, @Param('uid') uid: string, @Body() body: any) { return this.service.addEvent(actorOf(req), uid, body); }
  @Post(':uid/documents') @AuditLog({ module: 'objects', action: 'link_document' }) link(@Request() req, @Param('uid') uid: string, @Body() body: any) { return this.service.linkDocument(actorOf(req), uid, body); }
}

/** Data Map, lineage, Data Health (mục 19–20, 55–56). */
@ApiTags('Data Core')
@Controller('admin/data')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class DataController {
  constructor(private datamap: DataMapService, private dict: DictionaryService, private exec: ExecutiveService, @InjectRepository(InteractionChannel) private channels: Repository<InteractionChannel>) {}

  @Get('map') @Roles(...READER_ROLES) map(@Request() req) { return this.datamap.map(tenantOf(req)); }
  @Get('lineage') @Roles(...READER_ROLES) lineage(@Request() req, @Query('indicator_id') id: string) { return this.datamap.lineage(tenantOf(req), id); }
  @Get('impact') @Roles(...READER_ROLES) impact(@Request() req, @Query('dataset') code: string) { return this.datamap.impact(tenantOf(req), code); }
  @Get('health') @Roles(...READER_ROLES) health(@Request() req, @Query('period') period?: string) { return this.datamap.health(tenantOf(req), period || undefined); }
  @Post('health/publish') @Roles(...MANAGER_ROLES) @AuditLog({ module: 'data', action: 'publish_health' })
  @ApiOperation({ summary: 'Đẩy chỉ số sức khoẻ dữ liệu (DERIVED) vào kho như một chỉ tiêu' })
  async publishHealth(@Request() req, @Body() body: { period: string }) {
    const h = await this.datamap.health(tenantOf(req), body.period);
    if (h.overall === null) return { published: 0 };
    const out = await this.exec['facts'].ingest(actorOf(req), [{ indicator_id: 'cds.data_health', period: body.period, as_of_date: new Date().toISOString().slice(0, 10), value: h.overall, capture_method: 'api', source_ref: { system: 'do360_data_health', derived: true, scores: h.scores } as any }], 'api');
    return { published: out.length, overall: h.overall, outcomes: out };
  }
  @Post('reload') @Roles(...MANAGER_ROLES) reload() { return this.dict.reload(); }
  @Get('search') @Roles(...READER_ROLES) search(@Request() req, @Query('q') q: string) { return this.exec.search(tenantOf(req), req.user.role, q ?? ''); }
  @Get('executive') @Roles(...READER_ROLES) @ApiOperation({ summary: 'Bảng điều hành tổng hợp theo lĩnh vực: việc cần xử lý + thẻ Mục tiêu – Thực hiện – Rủi ro – Hành động' })
  executive(@Request() req, @Query('period') period?: string) { return this.exec.executive(tenantOf(req), req.user.role, period || undefined); }
  @Post('derive-tasks') @Roles(...MANAGER_ROLES) @AuditLog({ module: 'data', action: 'derive_tasks' })
  @ApiOperation({ summary: 'Chỉ tiêu nhiệm vụ (giao/hoàn thành/quá hạn) dẫn xuất từ sổ giao việc → nộp vào kho' })
  derive(@Request() req, @Body() body: { period: string }) { return this.exec.deriveTaskIndicators(actorOf(req), body.period); }

  // Kênh tương tác chính danh (nhóm Zalo do OA sở hữu) — đăng ký, không lưu nội dung chat
  @Get('channels') @Roles(...MANAGER_ROLES, 'leader') listChannels(@Request() req) { return this.channels.find({ where: { tenant_id: tenantOf(req) }, order: { id: 'ASC' } }); }
  @Post('channels') @Roles(...MANAGER_ROLES) @AuditLog({ module: 'channels', action: 'create' })
  async createChannel(@Request() req, @Body() body: Partial<InteractionChannel>) {
    const t = tenantOf(req);
    const existing = await this.channels.findOne({ where: { tenant_id: t, key: body.key! } });
    if (existing) { await this.channels.update(existing.id, { ...body, tenant_id: t }); return this.channels.findOne({ where: { id: existing.id } }); }
    return this.channels.save(this.channels.create({ ...body, tenant_id: t, approved_by: req.user.id }));
  }
  @Patch('channels/:id') @Roles(...MANAGER_ROLES) @AuditLog({ module: 'channels', action: 'update' })
  async updateChannel(@Request() req, @Param('id') id: string, @Body() body: Partial<InteractionChannel>) { await this.channels.update({ id: Number(id), tenant_id: tenantOf(req) }, body); return this.channels.findOne({ where: { id: Number(id) } }); }
}

@Module({
  imports: [TypeOrmModule.forFeature([DimObject, ObjectRelation, DocumentObjectLink, InteractionChannel, EventLog]), FactsModule, PlansModule],
  controllers: [ObjectsController, DataController],
  providers: [DictionaryService, ObjectsService, DataMapService, ExecutiveService],
  exports: [DictionaryService, ObjectsService, DataMapService, ExecutiveService, TypeOrmModule],
})
export class DataCoreModule {}
