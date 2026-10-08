import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query, Request, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventLog } from './event-log.entity';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { tenantOf } from '../../common/tenant';
import { parsePeriod } from '../../common/period';

export interface EventInput {
  object_type: string; object_id: string; event_type: string; event_date: string; domain?: string | null;
  payload?: Record<string, unknown>; source_ref?: Record<string, unknown>; source_system?: string; external_id?: string | null;
  object_uid?: string | null; actor_id?: number | null;
}

/** Nhật ký sự kiện chỉ đạo (văn bản, nhiệm vụ, công trình). Chỉ thêm; đồng bộ từ QLVB không nhân đôi nhờ (source_system, external_id). */
@Injectable()
export class EventsService {
  constructor(@InjectRepository(EventLog) private repo: Repository<EventLog>) {}

  async record(tenantId: string, items: EventInput[]) {
    let inserted = 0, skipped = 0;
    for (const e of items) {
      if (!e.object_type || !e.object_id || !e.event_type || !/^\d{4}-\d{2}-\d{2}$/.test(e.event_date ?? '')) throw new BadRequestException('Sự kiện thiếu object_type/object_id/event_type/event_date (YYYY-MM-DD).');
      if (e.external_id && (await this.repo.findOne({ where: { tenant_id: tenantId, source_system: e.source_system ?? 'form', external_id: e.external_id } }))) { skipped++; continue; }
      await this.repo.save(this.repo.create({ tenant_id: tenantId, object_type: e.object_type, object_id: e.object_id, event_type: e.event_type, event_date: e.event_date,
        domain: e.domain ?? null, payload: e.payload ?? {}, source_ref: e.source_ref ?? {}, source_system: e.source_system ?? 'form', external_id: e.external_id ?? null, object_uid: e.object_uid ?? null, actor_id: e.actor_id ?? null }));
      inserted++;
    }
    return { inserted, skipped };
  }

  /** Sự kiện trong kỳ, lọc theo lĩnh vực / loại đối tượng (truy vấn của slot event_list). */
  inPeriod(tenantId: string, period: string, q: { domain?: string; object_types?: string[]; event_types?: string[] } = {}) {
    const p = parsePeriod(period);
    const qb = this.repo.createQueryBuilder('e').where('e.tenant_id = :t AND e.event_date BETWEEN :a AND :b', { t: tenantId, a: p.start, b: p.end }).orderBy('e.event_date', 'ASC');
    if (q.domain) qb.andWhere('e.domain = :d', { d: q.domain });
    if (q.object_types?.length) qb.andWhere('e.object_type IN (:...ot)', { ot: q.object_types });
    if (q.event_types?.length) qb.andWhere('e.event_type IN (:...et)', { et: q.event_types });
    return qb.getMany();
  }
}

@ApiTags('Events')
@Controller('admin/events')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class EventsController {
  constructor(private service: EventsService) {}

  @Get()
  list(@Request() req, @Query('period') period: string, @Query('domain') domain?: string) {
    return this.service.inPeriod(tenantOf(req), period, { domain: domain || undefined });
  }

  @Post()
  @AuditLog({ module: 'events', action: 'record' })
  @ApiOperation({ summary: 'Ghi sự kiện chỉ đạo (văn bản ban hành, nhiệm vụ giao…)' })
  record(@Request() req, @Body() body: { events: EventInput[] }) {
    return this.service.record(tenantOf(req), body?.events ?? []);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([EventLog])],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
