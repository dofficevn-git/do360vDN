// Xuất dữ liệu ra CSV (mở trực tiếp bằng Excel). Dùng UTF-8 BOM để Excel hiển
// thị đúng tiếng Việt. Không phụ thuộc thư viện ngoài.

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const content = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
