import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ZaloLoginDto {
  // Silent login: tất cả optional — server derive zalo_user_id/name/avatar từ
  // zalo_access_token qua Graph API (giống smart-apartment-ct5d).
  @ApiProperty({ example: 'zalo_uid_123456', required: false })
  @IsOptional()
  @IsString()
  zalo_user_id?: string;

  @ApiProperty({ example: 'Nguyễn Văn A', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiProperty({ required: false, description: 'Access token từ ZMP SDK — server derive user + lấy OA Follower ID' })
  @IsOptional()
  @IsString()
  zalo_access_token?: string;
}
