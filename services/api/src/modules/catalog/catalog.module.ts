import { Controller, Get, Module, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Indicator } from './indicator.entity';
import { ExtractRule, ReportSlot, ReportSpec } from './report-spec.entity';
import { CatalogService } from './catalog.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { READER_ROLES } from '../../common/roles';
import { DepartmentsModule } from '../departments/departments.module';

@ApiTags('Catalog')
@Controller('admin/catalog')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class CatalogController {
  constructor(private service: CatalogService) {}

  @Get('labels')
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Gói nhãn tiếng Việt: chỉ tiêu, mục, slot, phòng, trạng thái' })
  labels() { return this.service.labels(); }

  @Get('indicators')
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Danh mục chỉ tiêu' })
  indicators(@Query('domain') domain?: string) {
    return this.service.listIndicators(domain || undefined);
  }

  @Get('report-specs')
  @Roles(...READER_ROLES)
  specs() {
    return this.service.listSpecs();
  }

  @Get('report-specs/:id')
  spec(@Param('id', ParseIntPipe) id: number) {
    return this.service.getSpecWithSlots(id);
  }

  @Get('extract-rules')
  rules() {
    return this.service.activeRules();
  }

  @Get('package/:domain')
  @Roles(...READER_ROLES)
  @ApiOperation({ summary: 'Gói lĩnh vực (thiết kế 03/10 "từ kho chỉ tiêu đến CSDL cấp Sở"): danh mục chỉ tiêu + mẫu bản ghi + quy tắc đối soát + luật bóc tách, để Sở tương ứng thẩm định' })
  package(@Param('domain') domain: string) {
    return this.service.domainPackage(domain);
  }

  @Post('reload')
  @Roles('super_admin')
  @AuditLog({ module: 'catalog', action: 'reload' })
  @ApiOperation({ summary: 'Nạp lại cấu hình từ thư mục config/ (danh mục chỉ tiêu, Report Spec, luật bóc tách)' })
  reload() {
    return this.service.loadAll();
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Indicator, ReportSpec, ReportSlot, ExtractRule]), DepartmentsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService, TypeOrmModule],
})
export class CatalogModule {}
