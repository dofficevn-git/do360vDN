import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { CommuneProfileModule } from './modules/commune-profile/commune-profile.module';
import { UsersModule } from './modules/users/users.module';
import { UploadModule } from './modules/upload/upload.module';
import { ZaloOaModule } from './modules/zalo-oa/zalo-oa.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StaffNotificationsModule } from './modules/staff-notifications/staff-notifications.module';
import { TdpModule } from './modules/tdp/tdp.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { FactsModule } from './modules/facts/facts.module';
import { BronzeModule } from './modules/bronze/bronze.module';
import { CoreDataModule } from './modules/core-data.module';
import { ExtractModule } from './modules/extract/extract.module';
import { EventsModule } from './modules/events/events.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ChatModule } from './modules/chat/chat.module';
import { QlvbModule } from './modules/qlvb/qlvb.module';
import { KpiModule } from './modules/kpi/kpi.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MiniappModule } from './modules/miniapp/miniapp.module';
import { PlansModule } from './modules/plans/plans.module';
import { WorkModule } from './modules/work/work.module';
import { DataCoreModule } from './modules/datacore/datacore.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';


@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env',
      ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'postgres'),
        database: configService.get('DB_NAME', 'do360'),
        autoLoadEntities: true,
        migrations: [__dirname + '/database/migrations/**/*{.ts,.js}'],
        // Prod: schema đi qua migration, tự chạy khi API khởi động (bản cài mới không cần ALTER tay)
        migrationsRun: configService.get('NODE_ENV') === 'production',
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    AdminUsersModule,
    CommuneProfileModule,
    UsersModule,
    UploadModule,
    ZaloOaModule,
    AuditLogsModule,
    NotificationsModule,
    StaffNotificationsModule,
    TdpModule,
    TasksModule,
    // ── DO360 ──
    TenantsModule,
    DepartmentsModule,
    CatalogModule,
    FactsModule,
    BronzeModule,
    CoreDataModule,
    ExtractModule,
    EventsModule,
    ReportsModule,
    ChatModule,
    QlvbModule,
    KpiModule,
    DashboardModule,
    MiniappModule,
    PlansModule,
    WorkModule,
    DataCoreModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}


