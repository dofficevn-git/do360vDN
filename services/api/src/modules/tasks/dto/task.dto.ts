import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_PRIORITIES, TaskPriority, TaskStatus } from '../task.entity';

export class CreateTaskDto {
  @ApiProperty({ example: 'Rà soát hộ nghèo tổ 3' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'admin_users.id người nhận việc' })
  @IsInt()
  assignee_id: number;

  @ApiPropertyOptional({ example: '2026-09-20T10:00:00+07:00' })
  @IsOptional()
  @IsDateString()
  due_at?: string;

  @ApiPropertyOptional({ enum: TASK_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'Nguồn việc: report_run (nhiệm vụ kỳ tới của báo cáo), qlvb, meeting…' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  source_type?: string;

  @ApiPropertyOptional({ description: 'Mã đối tượng nguồn (vd run_id)' })
  @IsOptional()
  @IsInt()
  source_id?: number;

  @ApiPropertyOptional({ description: 'Object liên quan (uid trong dim_object)' })
  @IsOptional()
  @IsString()
  object_uid?: string;

  @ApiPropertyOptional({ description: 'Chỉ tiêu mục tiêu của việc' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  target_indicator_id?: string;

  @ApiPropertyOptional({ description: 'Giá trị mục tiêu' })
  @IsOptional()
  target_value?: number;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: ['in_progress', 'done', 'cancelled'] })
  @IsIn(['in_progress', 'done', 'cancelled'])
  status: Exclude<TaskStatus, 'new'>;

  @ApiPropertyOptional({ description: 'Ghi chú kết quả — nên có khi hoàn thành/huỷ' })
  @IsOptional()
  @IsString()
  result_note?: string;

  @ApiPropertyOptional({ description: 'Ảnh kết quả (URL trả về từ /admin/upload/image)' })
  @IsOptional()
  @IsString()
  result_image_url?: string;
}

export class ReassignTaskDto {
  @ApiProperty()
  @IsInt()
  assignee_id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  due_at?: string;
}
