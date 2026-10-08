import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TasksService, Actor } from './tasks.service';
import { CreateTaskDto, ReassignTaskDto, UpdateTaskStatusDto } from './dto/task.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { ALL_ADMIN_ROLES } from '../../common/roles';

/**
 * Giao việc nhanh. Mọi endpoint yêu cầu token cán bộ (AdminGuard).
 * Tổ trưởng (tdp_head) nhận việc và cập nhật tiến độ → các endpoint đọc/đổi trạng thái mở ALL_ADMIN_ROLES;
 * giao/chuyển giao/nhắc mặc định WARD_ROLES (RolesGuard default-deny) và service kiểm thêm theo ma trận.
 */
@ApiTags('Tasks')
@Controller('admin/tasks')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private service: TasksService) {}

  private actor(req: any): Actor {
    return { id: req.user.id, role: req.user.role, department: req.user.department ?? null, full_name: req.user.full_name, tenant_id: req.user.tenant_id ?? null };
  }

  @Post()
  @AuditLog({ module: 'tasks', action: 'create' })
  @ApiOperation({ summary: 'Giao việc' })
  create(@Request() req, @Body() dto: CreateTaskDto) {
    return this.service.create(this.actor(req), dto);
  }

  @Get()
  @Roles(...ALL_ADMIN_ROLES)
  @ApiOperation({ summary: 'Danh sách việc (lãnh đạo thấy tất cả; người khác thấy việc mình giao/nhận)' })
  list(
    @Request() req,
    @Query('status') status?: string,
    @Query('assignee_id') assigneeId?: string,
    @Query('assigner_id') assignerId?: string,
    @Query('overdue') overdue?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(this.actor(req), {
      status: status || undefined,
      assignee_id: assigneeId ? parseInt(assigneeId, 10) : undefined,
      assigner_id: assignerId ? parseInt(assignerId, 10) : undefined,
      overdue: overdue === '1' || overdue === 'true',
      page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
    });
  }

  @Get('my')
  @Roles(...ALL_ADMIN_ROLES)
  @ApiOperation({ summary: 'Việc của tôi (người nhận)' })
  my(@Request() req, @Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.myTasks(
      this.actor(req),
      status || undefined,
      page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
    );
  }

  @Get('my/summary')
  @Roles(...ALL_ADMIN_ROLES)
  @ApiOperation({ summary: 'Đếm việc của tôi (KPI + badge)' })
  mySummary(@Request() req) {
    return this.service.mySummary(this.actor(req));
  }

  @Get(':id')
  @Roles(...ALL_ADMIN_ROLES)
  findOne(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(this.actor(req), id);
  }

  @Patch(':id/status')
  @Roles(...ALL_ADMIN_ROLES)
  @AuditLog({ module: 'tasks', action: 'update_status', entity: 'tasks' })
  updateStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskStatusDto) {
    return this.service.updateStatus(this.actor(req), id, dto);
  }

  @Patch(':id/reassign')
  @AuditLog({ module: 'tasks', action: 'reassign', entity: 'tasks' })
  reassign(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() dto: ReassignTaskDto) {
    return this.service.reassign(this.actor(req), id, dto);
  }

  @Post(':id/remind')
  @AuditLog({ module: 'tasks', action: 'remind' })
  remind(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.service.remind(this.actor(req), id);
  }
}
