import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepo: Repository<AuditLog>,
  ) {}

  async log(data: Partial<AuditLog>) {
    return this.auditLogRepo.save(this.auditLogRepo.create(data));
  }

  async findAll(tenantId?: string) {
    return this.auditLogRepo.find({
      where: tenantId ? { tenant_id: tenantId } : {},
      order: { created_at: 'DESC' },
      take: 100,
    });
  }
}
