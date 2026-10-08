import { IsString, IsIn, IsOptional, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminRole } from '../../admin-users/admin-user.entity';

export class CreateInvitationDto {
  @ApiProperty({ enum: ['super_admin', 'commune_admin', 'department_staff', 'leader', 'tdp_head'] })
  @IsIn(['super_admin', 'commune_admin', 'department_staff', 'leader', 'tdp_head'])
  role: AdminRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ description: 'Tổ dân phố gán cho tài khoản — bắt buộc khi mời tổ trưởng (tdp_head)' })
  @IsOptional()
  @IsInt()
  tdp_id?: number;

  @ApiPropertyOptional({ description: 'Tên gợi ý cho người được mời' })
  @IsOptional()
  @IsString()
  suggested_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  suggested_phone?: string;
}
