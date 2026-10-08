import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Tenant } from './tenant.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { defaultTenantId } from '../../common/tenant';

/**
 * Khi CSDL chưa có đơn vị nào: tạo đơn vị mặc định từ env (DEFAULT_TENANT_ID / DEFAULT_TENANT_NAME)
 * và gán cho các tài khoản chưa có tenant — để bản cài mới đăng nhập là dùng được.
 */
@Injectable()
export class TenantBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantBootstrapService.name);

  constructor(
    @InjectRepository(Tenant) private repo: Repository<Tenant>,
    @InjectRepository(AdminUser) private admins: Repository<AdminUser>,
  ) {}

  async onApplicationBootstrap() {
    try {
      const id = defaultTenantId();
      if ((await this.repo.count()) === 0) {
        await this.repo.save(
          this.repo.create({
            tenant_id: id,
            name: process.env.DEFAULT_TENANT_NAME || 'Đơn vị thí điểm',
            unit_type: process.env.DEFAULT_TENANT_TYPE || 'phuong',
            parent_id: process.env.DEFAULT_TENANT_PARENT_ID || null,
            parent_name: process.env.DEFAULT_TENANT_PARENT_NAME || null,
          }),
        );
        this.logger.log(`Đã tạo đơn vị mặc định ${id}.`);
      }
      const r = await this.admins.update({ tenant_id: IsNull() }, { tenant_id: id });
      if (r.affected) this.logger.log(`Gán đơn vị ${id} cho ${r.affected} tài khoản chưa có tenant.`);
      await this.repo.manager.query('UPDATE tasks SET tenant_id = $1 WHERE tenant_id IS NULL', [id]);
      await this.repo.manager.query('UPDATE audit_logs SET tenant_id = $1 WHERE tenant_id IS NULL', [id]);
    } catch (err) {
      this.logger.error(`Khởi tạo đơn vị mặc định thất bại: ${err}`);
    }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, AdminUser])],
  providers: [TenantBootstrapService],
  exports: [TypeOrmModule],
})
export class TenantsModule {}
