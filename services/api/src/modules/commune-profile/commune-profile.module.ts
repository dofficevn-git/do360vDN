import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommuneProfile } from './commune-profile.entity';
import { CommuneProfileController } from './commune-profile.controller';
import { CommuneProfileService } from './commune-profile.service';

@Module({
  imports: [TypeOrmModule.forFeature([CommuneProfile])],
  controllers: [CommuneProfileController],
  providers: [CommuneProfileService],
  exports: [CommuneProfileService],
})
export class CommuneProfileModule {}
