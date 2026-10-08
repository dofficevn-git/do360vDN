import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsersService, UpdateMyProfileDto } from './users.service';

@ApiTags('Users')
@Controller('public/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thông tin người dùng Mini App hiện tại' })
  async getMe(@Request() req) {
    if (req.user.type !== 'user') {
      throw new ForbiddenException('Endpoint chỉ dành cho user Mini App');
    }
    return this.usersService.getById(req.user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cập nhật thông tin cá nhân (phone/address)' })
  async updateMe(@Request() req, @Body() dto: UpdateMyProfileDto) {
    if (req.user.type !== 'user') {
      throw new ForbiddenException('Endpoint chỉ dành cho user Mini App');
    }
    return this.usersService.updateMine(req.user.id, dto);
  }
}
