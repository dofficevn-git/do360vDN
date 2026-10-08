import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  access_token: string;
}
