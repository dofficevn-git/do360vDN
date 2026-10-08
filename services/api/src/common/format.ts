/** Định dạng số trong văn bản hành chính VN: dấu chấm phân nghìn, dấu phẩy thập phân. */
export type ValueType = 'integer' | 'decimal' | 'percent' | 'money';

const groupInt = (n: number) => Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function formatDecimal(n: number, maxFrac = 3): string {
  const sign = n < 0 ? '-' : '';
  const fixed = Math.abs(n).toFixed(maxFrac);
  const [i, f] = fixed.split('.');
  const frac = (f ?? '').replace(/0+$/, '');
  return sign + groupInt(Number(i)) + (frac ? ',' + frac : '');
}

/** Giá trị gốc (đồng, hồ sơ, %…) → chuỗi để ghép vào câu, kèm đơn vị hiển thị. */
export function formatValue(value: number, valueType: ValueType, unit: string): string {
  if (valueType === 'money') {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${formatDecimal(value / 1e9, 3)} tỷ đồng`;
    if (abs >= 1e6) return `${formatDecimal(value / 1e6, 1)} triệu đồng`;
    return `${groupInt(value)} đồng`;
  }
  if (valueType === 'percent') return `${formatDecimal(value, 2)}%`;
  if (valueType === 'decimal') return `${formatDecimal(value, 3)}${unit ? ' ' + unit : ''}`;
  return (value < 0 ? '-' : '') + groupInt(value);
}

/** Chỉ con số (không đơn vị) — để thay vào khuôn câu đã có đơn vị sẵn. */
export function formatNumberOnly(value: number, valueType: ValueType): string {
  if (valueType === 'money') return formatValue(value, 'money', '').replace(/ (tỷ|triệu) đồng| đồng/, '');
  if (valueType === 'percent') return formatDecimal(value, 2);
  if (valueType === 'decimal') return formatDecimal(value, 3);
  return (value < 0 ? '-' : '') + groupInt(value);
}

export function formatVnDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
