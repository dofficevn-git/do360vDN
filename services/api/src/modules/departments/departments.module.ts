import { Body, Controller, Get, Injectable, Logger, Module, OnApplicationBootstrap, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Department } from './department.entity';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MANAGER_ROLES } from '../../common/roles';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

/** Cơ cấu UBND cấp xã theo NĐ 150/2025/NĐ-CP + các đơn vị gửi số định kỳ (Công an, Trạm Y tế). */
export const DEFAULT_DEPARTMENTS: Array<{ key: string; name: string; description: string }> = [
  { key: 'van_phong',       name: 'Văn phòng HĐND và UBND',            description: 'Tổng hợp, chốt kỳ báo cáo; hành chính, tư pháp - hộ tịch, tiếp công dân' },
  { key: 'kinh_te',         name: 'Phòng Kinh tế, Hạ tầng và Đô thị',  description: 'Tài chính - ngân sách, đầu tư công, đất đai, xây dựng, môi trường, nông nghiệp' },
  { key: 'van_hoa_xa_hoi',  name: 'Phòng Văn hóa - Xã hội',            description: 'Văn hóa, giáo dục, y tế, lao động, chính sách xã hội' },
  { key: 'hanh_chinh_cong', name: 'Trung tâm phục vụ hành chính công', description: 'Tiếp nhận và trả kết quả thủ tục hành chính (một cửa)' },
  { key: 'cong_an',         name: 'Công an',                           description: 'An ninh trật tự, cư trú' },
  { key: 'y_te',            name: 'Trạm Y tế',                         description: 'Khám chữa bệnh, tiêm chủng, y tế dự phòng' },
  { key: 'quan_su',         name: 'Ban Chỉ huy quân sự',               description: 'Quốc phòng, tuyển quân' },
];

@Injectable()
export class DepartmentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DepartmentsService.name);
  constructor(@InjectRepository(Department) private repo: Repository<Department>) {}

  async onApplicationBootstrap() {
    try {
      if ((await this.repo.count()) > 0) return;
      await this.repo.save(DEFAULT_DEPARTMENTS.map((d, i) => this.repo.create({ ...d, sort_order: i + 1, is_active: true })));
      this.logger.log(`Đã tạo ${DEFAULT_DEPARTMENTS.length} bộ phận mặc định.`);
    } catch (err) {
      this.logger.error(`Tạo bộ phận mặc định thất bại: ${err}`);
    }
  }

  list() {
    return this.repo.find({ order: { sort_order: 'ASC', name: 'ASC' } });
  }

  async update(id: number, data: Partial<Pick<Department, 'name' | 'description' | 'head_admin_id' | 'phone' | 'location' | 'sort_order' | 'is_active'>>) {
    await this.repo.update(id, data);
    return this.repo.findOne({ where: { id } });
  }
}

@ApiTags('Departments')
@Controller('admin/departments')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class DepartmentsController {
  constructor(private service: DepartmentsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Patch(':id')
  @Roles(...MANAGER_ROLES)
  @AuditLog({ module: 'departments', action: 'update', entity: 'departments' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; description?: string; head_admin_id?: number | null; is_active?: boolean; sort_order?: number }) {
    const { name, description, head_admin_id, is_active, sort_order } = body ?? {};
    return this.service.update(id, { name, description, head_admin_id, is_active, sort_order });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Department])],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService, TypeOrmModule],
})
export class DepartmentsModule {}
