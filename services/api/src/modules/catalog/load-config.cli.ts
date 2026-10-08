/**
 * Nạp cấu hình từ config/ vào CSDL, không cần bật API:  npm run config:load
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { CatalogService } from './catalog.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const result = await app.get(CatalogService).loadAll();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  await app.close();
  process.exit(result.errors.length ? 1 : 0);
}

main();
