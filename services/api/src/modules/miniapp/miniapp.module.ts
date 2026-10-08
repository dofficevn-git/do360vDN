import { BadRequestException, Controller, HttpCode, Injectable, Logger, Module, Post, Query, UnauthorizedException, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminUser } from '../admin-users/admin-user.entity';
import { AuthModule } from '../auth/auth.module';
import { BronzeModule, BronzeService } from '../bronze/bronze.module';
import { ExtractModule, ExtractService } from '../extract/extract.module';

const MAX_SIZE = 30 * 1024 * 1024;

/**
 * Điểm nhận file từ Mini App Zalo (T1 tạm): `openMediaPicker({ serverUploadUrl })` để Zalo tự POST file lên máy chủ,
 * KHÔNG mang header Authorization → token cán bộ DO360 đi theo query `token`. Xác thực JWT (type admin) rồi mới nhận file,
 * lưu Bronze (channel miniapp) và bóc tách ngay. Trả JSON cho Mini App hiển thị.
 */
@Injectable()
export class MiniappUploadService {
  private readonly logger = new Logger(MiniappUploadService.name);
  constructor(private jwt: JwtService, @InjectRepository(AdminUser) private admins: Repository<AdminUser>, private bronze: BronzeService, private extract: ExtractService) {}

  async receive(token: string, period: string | undefined, file: Express.Multer.File, asOfDate?: string) {
    let payload: any;
    try { payload = this.jwt.verify(token); } catch { throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn.'); }
    if (payload?.type !== 'admin') throw new UnauthorizedException('Cần token cán bộ.');
    const admin = await this.admins.findOne({ where: { id: Number(payload.sub), is_active: true } });
    if (!admin?.tenant_id) throw new UnauthorizedException('Tài khoản không hợp lệ.');
    if (!file?.buffer?.length) throw new BadRequestException('Không nhận được file.');
    const actor = { id: admin.id, role: admin.role, department: admin.department ?? null, tenant_id: admin.tenant_id };
    const { file: saved, duplicate } = await this.bronze.receive({ tenantId: admin.tenant_id, file, uploadedBy: admin.id, department: admin.department ?? null, period: period || null, channel: 'miniapp', asOfDate: asOfDate || null });
    let extract: any = null;
    if (period && !(duplicate && saved.status === 'extracted')) {
      try { extract = await this.extract.run(actor, saved.id); } catch (err: any) { extract = { status: 'failed', message: err?.response?.message ?? err?.message ?? String(err) }; }
    }
    this.logger.log(`[miniapp upload] ${admin.id} → file ${saved.id} ${saved.original_name} (${duplicate ? 'trùng' : 'mới'}) → ${extract?.status ?? 'không bóc'}`);
    return { file: { id: saved.id, original_name: saved.original_name, status: saved.status, period: saved.period }, duplicate, extract };
  }
}

@ApiTags('Mini App')
@Controller('public/do360')
export class MiniappController {
  constructor(private service: MiniappUploadService) {}

  @Post('upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Zalo openMediaPicker tải file lên (token cán bộ theo query) → Bronze → bóc tách' })
  @UseInterceptors(AnyFilesInterceptor({ storage: memoryStorage(), limits: { fileSize: MAX_SIZE, files: 1 } }))
  upload(@Query('token') token: string, @Query('period') period: string | undefined, @Query('as_of') asOf: string | undefined, @UploadedFiles() files: Express.Multer.File[]) {
    if (!token) throw new UnauthorizedException('Thiếu token.');
    return this.service.receive(token, period || undefined, files?.[0], asOf || undefined);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([AdminUser]), AuthModule, BronzeModule, ExtractModule],
  controllers: [MiniappController],
  providers: [MiniappUploadService],
})
export class MiniappModule {}
