import { Body, Controller, Get, Module, Param, ParseIntPipe, Post, Query, Request, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatMessage } from './chat-message.entity';
import { ChatService } from './chat.service';
import { CHAT_CHANNEL } from './chat-channel';
import { ZaloChatChannel } from './zalo-channel';
import { TammiChatChannel } from './tammi-channel';
import { NotificationGateway } from './notification-gateway';
import { AdminUser } from '../admin-users/admin-user.entity';
import { Department } from '../departments/department.entity';
import { ReportRun } from '../reports/report-run.entity';
import { Indicator } from '../catalog/indicator.entity';
import { Task } from '../tasks/task.entity';
import { ZaloOaModule } from '../zalo-oa/zalo-oa.module';
import { FactsModule } from '../facts/facts.module';
import { BronzeModule } from '../bronze/bronze.module';
import { ExtractModule } from '../extract/extract.module';
import { StaffNotificationsModule } from '../staff-notifications/staff-notifications.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { MANAGER_ROLES } from '../../common/roles';
import { tenantOf } from '../../common/tenant';

@ApiTags('Chat')
@Controller('admin/chat')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(private service: ChatService) {}

  @Get('status')
  status(@Request() req) { return this.service.status(tenantOf(req)); }

  @Get('messages')
  @Roles(...MANAGER_ROLES, 'leader')
  messages(@Request() req, @Query('limit') limit?: string) { return this.service.recent(tenantOf(req), Number(limit) || 50); }

  @Post('test')
  @ApiOperation({ summary: 'Gửi thẻ thử cho chính mình' })
  test(@Request() req) { return this.service.sendTest(req.user.id); }

  @Post('remind/:runId')
  @Roles(...MANAGER_ROLES)
  @AuditLog({ module: 'chat', action: 'remind' })
  @ApiOperation({ summary: 'Nhắc ngay các phòng còn thiếu số của một kỳ' })
  remind(@Request() req, @Param('runId', ParseIntPipe) runId: number) { return this.service.remindRun(runId, tenantOf(req)); }

  @Post('remind-tasks')
  @Roles(...MANAGER_ROLES)
  @AuditLog({ module: 'chat', action: 'remind_tasks' })
  @ApiOperation({ summary: 'Nhắc ngay việc sắp đến hạn (48 giờ tới) của đơn vị' })
  remindTasks(@Request() req) { return this.service.remindUpcomingTasks(tenantOf(req)); }

  @Post('digest')
  @Roles(...MANAGER_ROLES)
  @ApiOperation({ summary: 'Tạo và gửi bản tổng hợp đầu ngày ngay (demo/kiểm thử)' })
  digest(@Request() req) { return this.service.dailyDigest(tenantOf(req)); }

  @Post('gateway-check')
  @ApiOperation({ summary: 'Thử cổng an toàn: nội dung này có được gửi qua Zalo không?' })
  gatewayCheck(@Body() body: { title?: string; lines?: string[] }) {
    const r = NotificationGateway.sanitize({ title: body?.title ?? 'DO360', lines: body?.lines ?? [], actions: [] }, this.service.webUrl());
    return { allowed: r.allowed, reasons: r.reasons, truncated: r.truncated, sent_card: r.card };
  }

  @Post('inbound')
  @AuditLog({ module: 'chat', action: 'inbound_sim' })
  @ApiOperation({ summary: 'Giả lập tin cán bộ gửi vào kênh chat (kiểm thử không cần OA) — thao tác dưới danh nghĩa người gọi' })
  inbound(@Request() req, @Body() body: any) { return this.service.simulateInbound(req.user.id, body ?? {}); }
}

@Module({
  imports: [TypeOrmModule.forFeature([ChatMessage, AdminUser, Department, ReportRun, Indicator, Task]), ZaloOaModule, FactsModule, BronzeModule, ExtractModule, StaffNotificationsModule],
  controllers: [ChatController],
  providers: [ChatService, ZaloChatChannel, TammiChatChannel,
    // Thiết kế Tami360: Tabot chạy trong Tammi OA (V1); kênh Zalo là bản tạm dùng OA của ZSC. Đổi env CHAT_CHANNEL, không đổi code.
    { provide: CHAT_CHANNEL, useFactory: (zalo: ZaloChatChannel, tammi: TammiChatChannel) => ((process.env.CHAT_CHANNEL || 'zalo').toLowerCase() === 'tammi' ? tammi : zalo), inject: [ZaloChatChannel, TammiChatChannel] }],
  exports: [ChatService],
})
export class ChatModule {}
