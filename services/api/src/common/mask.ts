/** Che giữa SĐT cho các endpoint tra cứu công khai: 0912345678 → 091****678 */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null;
  const digits = phone.trim();
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

/** Tên trường không được ghi nguyên văn vào nhật ký (mật khẩu, token, khoá API...). */
const SENSITIVE_KEY = /pass|secret|token|hash|api[_-]?key|authorization|credential/i;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Thay giá trị các trường nhạy cảm bằng '[đã ẩn]' trước khi ghi audit log.
 * Nhật ký hệ thống cán bộ đọc được — không để lọt mật khẩu ra đó.
 */
export function redactSensitive(value: any): any {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value === null || typeof value !== 'object') return value;
  // Chỉ bóc object THUẦN. Date/Buffer... bóc ra sẽ thành {} vì không có thuộc tính
  // liệt kê được — trả nguyên để JSON.stringify tự lo (Date -> chuỗi ISO).
  if (!isPlainObject(value)) return value;
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[đã ẩn]' : redactSensitive(val);
  }
  return out;
}
