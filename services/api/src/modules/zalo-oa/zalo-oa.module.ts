import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZaloOaService } from './zalo-oa.service';
import { ZaloOaController } from './zalo-oa.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { AdminUser } from '../admin-users/admin-user.entity';
import { Tdp } from '../tdp/tdp.entity';

@Module({
  imports: [NotificationsModule, TypeOrmModule.forFeature([User, AdminUser, Tdp])],
  controllers: [ZaloOaController],
  providers: [ZaloOaService],
  exports: [ZaloOaService],
})
export class ZaloOaModule {}
