import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { assertProductionSecrets } from './common/env-guard';

async function bootstrap() {
  // Kiểm tra secret TRƯỚC khi dựng app — prod còn placeholder thì thoát luôn
  assertProductionSecrets();

  // rawBody: cần cho việc xác thực chữ ký webhook Zalo (X-ZEvent-Signature)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Ensure uploads directories exist
  const uploadsDir = join(process.cwd(), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Serve uploaded files as static assets
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  app.setGlobalPrefix('api', { exclude: ['health'] });
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',') ?? [];
  const allowAll = allowedOrigins.includes('*');
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowAll || /^http:\/\/localhost(:\d+)?$/.test(origin) || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Chính quyền số Xã Thành Công API')
    .setDescription('API cho hệ thống Zalo Mini App / Xã thông minh tích hợp AI')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
