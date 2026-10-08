import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskReminderService } from './task-reminder.service';
import { AdminUser } from '../admin-users/admin-user.entity';
import { StaffNotificationsModule } from '../staff-notifications/staff-notifications.module';
import { ZaloOaModule } from '../zalo-oa/zalo-oa.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [TypeOrmModule.forFeature([Task, AdminUser]), StaffNotificationsModule, ZaloOaModule, EventsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskReminderService],
  exports: [TasksService],
})
export class TasksModule {}
