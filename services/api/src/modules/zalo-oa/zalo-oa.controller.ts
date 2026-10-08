import { Body, Controller, Post, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZaloOaService } from './zalo-oa.service';

@ApiTags('zalo-oa')
@Controller('admin/zalo-oa')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class ZaloOaController {
  constructor(private readonly zaloOa: ZaloOaService) {}

  @Post('refresh-token')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Force refresh OA access_token ngay (chỉ super_admin)' })
  async forceRefresh() {
    return this.zaloOa.refreshOaTokenProactive();
  }

  @Post('set-tokens')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Dán cặp token OA mới (kiểm tra với Zalo rồi lưu vào file store — không cần sửa env)' })
  setTokens(@Body() body: { access_token: string; refresh_token?: string; expires_in?: number }) {
    return this.zaloOa.setTokens(body ?? ({} as any));
  }

  @Get('token-status')
  @ApiOperation({ summary: 'Xem trạng thái cache OA token hiện tại' })
  getStatus() {
    return this.zaloOa.getTokenStatus();
  }
}
