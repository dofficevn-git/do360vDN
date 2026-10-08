import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class QrVerifyDto {
  @ApiProperty()
  @IsUUID()
  session_id: string;

  @ApiProperty()
  @IsString()
  access_token: string;
}
