import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventLog } from './events/event-log.entity';
import { ReportRun } from './reports/report-run.entity';
import { Employee } from './employees/employee.entity';

/** Đăng ký các bảng lõi chưa có service riêng (event_log, report_run, dim_employee) — service thêm ở GĐ3–GĐ6. */
@Module({
  imports: [TypeOrmModule.forFeature([EventLog, ReportRun, Employee])],
  exports: [TypeOrmModule],
})
export class CoreDataModule {}
