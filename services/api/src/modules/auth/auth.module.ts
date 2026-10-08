import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { CitizensController } from './citizens.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { AdminUser } from '../admin-users/admin-user.entity';
import { User } from '../users/user.entity';
import { AdminQrSession } from './entities/admin-qr-session.entity';
import { AdminInvitation } from './entities/admin-invitation.entity';
import { ZaloOaModule } from '../zalo-oa/zalo-oa.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminUser, User, AdminQrSession, AdminInvitation]),
    ZaloOaModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET', 'change-me-in-production'),
        signOptions: { expiresIn: configService.get('JWT_EXPIRES_IN', '7d') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, CitizensController],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
