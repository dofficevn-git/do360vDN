import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const imageStorage = (subdir = '') =>
  diskStorage({
    destination: join(process.cwd(), 'uploads', subdir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + extname(file.originalname));
    },
  });

const imageFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  const allowed = /\.(jpeg|jpg|png|gif|webp)$/i;
  if (allowed.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new BadRequestException('Chỉ chấp nhận ảnh định dạng JPEG, PNG, GIF, WebP'), false);
  }
};

@ApiTags('Upload')
@Controller()
export class UploadController {
  @Post('admin/upload/image')
  @UseGuards(AdminGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: imageStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter }))
  uploadImageAdmin(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Không có file được upload');
    return { url: `${process.env.API_BASE_URL || 'http://localhost:3000'}/uploads/${file.filename}` };
  }

  @Post('public/upload/image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: imageStorage('feedback'), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter }))
  uploadImagePublic(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Không có file được upload');
    return { url: `${process.env.API_BASE_URL || 'http://localhost:3000'}/uploads/feedback/${file.filename}` };
  }
}
