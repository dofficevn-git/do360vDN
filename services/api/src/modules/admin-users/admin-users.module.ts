import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from './admin-user.entity';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminBootstrapService } from './admin-bootstrap.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminUser])],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, AdminBootstrapService],
  exports: [TypeOrmModule],
})
export class AdminUsersModule {}
