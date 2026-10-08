import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tdp } from './tdp.entity';
import { User } from '../users/user.entity';
import { TdpService } from './tdp.service';
import { TdpController } from './tdp.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tdp, User])],
  controllers: [TdpController],
  providers: [TdpService],
  exports: [TdpService],
})
export class TdpModule {}
