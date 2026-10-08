import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminRole } from '../../admin-users/admin-user.entity';

/** Bổ nhiệm một người dân (đã mở Mini App) thành cán bộ/quản trị — không cần lời mời QR. */
export class PromoteCitizenDto {
  @ApiProperty({ enum: ['super_admin', 'commune_admin', 'department_staff', 'leader', 'tdp_head'] })
  @IsIn(['super_admin', 'commune_admin', 'department_staff', 'leader', 'tdp_head'])
  role: AdminRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Bắt buộc khi role = tdp_head' })
  @IsOptional()
  @IsInt()
  tdp_id?: number;
}
