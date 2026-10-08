import {
  BadRequestException, Body, Controller, Get, Injectable, Logger, Module, NotFoundException, Param, ParseIntPipe,
  Post, Query, Request, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { extname } from 'path';
import { Client as MinioClient } from 'minio';
import { Response } from 'express';
import { SourceFile } from './source-file.entity';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { tenantOf } from '../../common/tenant';
import { parsePeriod } from '../../common/period';

const ALLOWED = /\.(xlsx|xls|docx|doc|pdf|png|jpe?g|webp|csv)$/i;
const MAX_SIZE = 30 * 1024 * 1024;

/** Lưu file gốc trên MinIO (S3 tại chỗ). Cấu hình qua env MINIO_*; bucket tự tạo khi chưa có. */
@Injectable()
export class BronzeStorage {
  private readonly logger = new Logger(BronzeStorage.name);
  private client: MinioClient | null = null;
  private ready: Promise<void> | null = null;
  readonly bucket = process.env.MINIO_BUCKET || 'do360-bronze';

  private get(): MinioClient {
    if (!this.client) {
      this.client = new MinioClient({
        endPoint: process.env.MINIO_ENDPOINT || 'localhost',
        port: parseInt(process.env.MINIO_PORT || '9000', 10),
        useSSL: process.env.MINIO_USE_SSL === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY || '',
        secretKey: process.env.MINIO_SECRET_KEY || '',
      });
    }
    return this.client;
  }

  private ensureBucket(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const c = this.get();
        if (!(await c.bucketExists(this.bucket))) {
          await c.makeBucket(this.bucket);
          this.logger.log(`Đã tạo bucket ${this.bucket}`);
        }
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async put(key: string, data: Buffer, mime?: string) {
    await this.ensureBucket();
    await this.get().putObject(this.bucket, key, data, data.length, mime ? { 'Content-Type': mime } : undefined);
  }

  async stream(key: string) {
    await this.ensureBucket();
    return this.get().getObject(this.bucket, key);
  }

  async buffer(key: string): Promise<Buffer> {
    const s = await this.stream(key);
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
}

@Injectable()
export class BronzeService {
  constructor(
    @InjectRepository(SourceFile) private repo: Repository<SourceFile>,
    private storage: BronzeStorage,
  ) {}

  /**
   * Nhận file gốc: băm nội dung → nếu đơn vị đã nộp đúng file này thì trả lại bản ghi cũ
   * (`duplicate: true`), không lưu lần hai.
   */
  async receive(opts: {
    tenantId: string; file: { buffer: Buffer; originalname: string; mimetype?: string; size: number };
    uploadedBy: number | null; department: string | null; period?: string | null; channel?: string; asOfDate?: string | null;
  }): Promise<{ file: SourceFile; duplicate: boolean }> {
    const { tenantId, file } = opts;
    if (!file?.buffer?.length) throw new BadRequestException('Không có file.');
    // multer đọc tên file theo latin1 — chuyển lại UTF-8 để giữ dấu tiếng Việt
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!ALLOWED.test(name)) throw new BadRequestException('Chỉ nhận Excel, Word, PDF, CSV hoặc ảnh.');
    if (opts.period) parsePeriod(opts.period);
    const asOf = (opts.asOfDate ?? '').trim() || null;
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new BadRequestException('Ngày chốt số liệu phải dạng YYYY-MM-DD.');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.repo.findOne({ where: { tenant_id: tenantId, sha256 } });
    if (existing) return { file: existing, duplicate: true };

    const now = new Date();
    const key = `${tenantId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${sha256}${extname(name).toLowerCase()}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const saved = await this.repo.save(
      this.repo.create({
        tenant_id: tenantId, sha256, object_key: key, original_name: name, mime: file.mimetype ?? null, size: file.size,
        department: opts.department, period: opts.period ?? null, as_of_date: asOf, uploaded_by: opts.uploadedBy, channel: opts.channel ?? 'web',
      }),
    );
    return { file: saved, duplicate: false };
  }

  list(tenantId: string, q: { period?: string; department?: string | null }) {
    const where: any = { tenant_id: tenantId };
    if (q.period) where.period = q.period;
    if (q.department) where.department = q.department;
    return this.repo.find({ where, order: { created_at: 'DESC' }, take: 200 });
  }

  async get(tenantId: string, id: number) {
    const f = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!f) throw new NotFoundException('Không tìm thấy file.');
    return f;
  }

  async mark(id: number, patch: Partial<Pick<SourceFile, 'status' | 'error' | 'file_kind' | 'source_type' | 'extracted_count' | 'pii_warning'>>) {
    await this.repo.update(id, patch);
  }

  content(file: SourceFile) {
    return this.storage.buffer(file.object_key);
  }

  stream(file: SourceFile) {
    return this.storage.stream(file.object_key);
  }
}

@ApiTags('Bronze')
@Controller('admin/files')
@UseGuards(AdminGuard, RolesGuard)
@ApiBearerAuth()
export class BronzeController {
  constructor(private service: BronzeService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @AuditLog({ module: 'files', action: 'upload' })
  @ApiOperation({ summary: 'Nộp file gốc (Excel/Word/PDF/ảnh) kèm kỳ báo cáo' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SIZE } }))
  upload(@Request() req, @UploadedFile() file: Express.Multer.File, @Body() body: { period?: string; as_of_date?: string }) {
    return this.service.receive({
      tenantId: tenantOf(req), file, uploadedBy: req.user.id, department: req.user.department ?? null, period: body?.period || null, asOfDate: body?.as_of_date || null,
    });
  }

  @Get()
  list(@Request() req, @Query('period') period?: string) {
    const dept = req.user.role === 'department_staff' ? req.user.department ?? '__none__' : undefined;
    return this.service.list(tenantOf(req), { period: period || undefined, department: dept });
  }

  @Get(':id/download')
  async download(@Request() req, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.service.get(tenantOf(req), id);
    if (req.user.role === 'department_staff' && f.department !== req.user.department) throw new NotFoundException('Không tìm thấy file.');
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    (await this.service.stream(f)).pipe(res);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([SourceFile])],
  controllers: [BronzeController],
  providers: [BronzeService, BronzeStorage],
  exports: [BronzeService, BronzeStorage],
})
export class BronzeModule {}
