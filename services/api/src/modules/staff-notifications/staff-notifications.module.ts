import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffNotification } from './staff-notification.entity';
import { StaffNotificationsService } from './staff-notifications.service';
import { StaffNotificationsController } from './staff-notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StaffNotification])],
  providers: [StaffNotificationsService],
  controllers: [StaffNotificationsController],
  exports: [StaffNotificationsService],
})
export class StaffNotificationsModule {}