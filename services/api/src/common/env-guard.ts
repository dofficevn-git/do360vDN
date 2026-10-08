/**
 * Chặn khởi động production khi còn secret mặc định / yếu.
 *
 * Lý do: hai vòng vận hành trước đã có lần lên prod mà JWT_SECRET vẫn là chuỗi
 * placeholder. Để app tự chết lúc khởi động rõ ràng hơn là chạy êm rồi thủng.
 * Ở môi trường dev chỉ cảnh báo, không chặn.
 */

import * as dotenv from 'dotenv';

/**
 * Guard chạy TRƯỚC NestFactory nên ConfigModule chưa nạp file .env.
 * Trên Docker thì compose đã tiêm env sẵn (env_file) nên không cần,
 * nhưng chạy tay `node dist/main` thì phải tự nạp — nếu không sẽ báo nhầm là thiếu secret.
 * dotenv KHÔNG ghi đè biến đã có sẵn, đúng thứ tự ưu tiên mà ConfigModule dùng.
 */
export function loadEnvFiles(): void {
  dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}` });
  dotenv.config({ path: '.env' });
}

/** Giá trị placeholder tuyệt đối không được mang lên prod. */
const FORBIDDEN_VALUES = [
  'change-me-in-production',
  'doi-khi-golive',
  'postgres',
  'password',
  'admin',
  '123456',
  'Admin@123',
];

const MIN_SECRET_LENGTH = 32;

function contains(value: string, needle: string) {
  return value.toLowerCase().includes(needle.toLowerCase());
}

/** Trả về danh sách lỗi cấu hình; rỗng nghĩa là đạt. */
export function checkProductionSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];

  const jwt = env.JWT_SECRET ?? '';
  if (!jwt) {
    errors.push('JWT_SECRET chưa được đặt.');
  } else {
    if (jwt.length < MIN_SECRET_LENGTH) {
      errors.push(`JWT_SECRET quá ngắn (${jwt.length} ký tự, tối thiểu ${MIN_SECRET_LENGTH}).`);
    }
    const hit = FORBIDDEN_VALUES.find((v) => contains(jwt, v));
    if (hit) errors.push(`JWT_SECRET còn chứa chuỗi mặc định "${hit}" — phải sinh chuỗi ngẫu nhiên mới.`);
  }

  const dbPass = env.DB_PASSWORD ?? '';
  if (!dbPass) {
    errors.push('DB_PASSWORD chưa được đặt.');
  } else if (FORBIDDEN_VALUES.includes(dbPass.toLowerCase()) || dbPass.length < 12) {
    errors.push('DB_PASSWORD quá yếu hoặc còn là mật khẩu mặc định (tối thiểu 12 ký tự).');
  }

  const bootstrapPass = env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  if (bootstrapPass && FORBIDDEN_VALUES.includes(bootstrapPass)) {
    errors.push('BOOTSTRAP_ADMIN_PASSWORD còn là mật khẩu mặc định — đổi trước khi mở cho cán bộ dùng.');
  }

  return errors;
}

/**
 * Gọi ở đầu bootstrap. Trên production: in lỗi rồi thoát (exit 1).
 * Trên dev/test: chỉ cảnh báo để không cản việc chạy thử.
 */
export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env === process.env) loadEnvFiles();
  const errors = checkProductionSecrets(env);
  if (errors.length === 0) return;

  const isProd = env.NODE_ENV === 'production';
  const header = isProd
    ? 'DỪNG KHỞI ĐỘNG — cấu hình bảo mật chưa đạt:'
    : 'Cảnh báo cấu hình bảo mật (dev nên bỏ qua được, prod sẽ chặn):';

  console.error(`\n${header}`);
  for (const e of errors) console.error(`  - ${e}`);

  if (isProd) {
    console.error('\nSinh secret mới: openssl rand -base64 48\n');
    process.exit(1);
  }
  console.error('');
}
