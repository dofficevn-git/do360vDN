/**
 * Biểu thức số học an toàn — KHÔNG dùng eval. Dùng cho công thức KPI trong cấu hình.
 * Cho phép: tên biến (chữ, số, _ .), số, + - * / ( ). Thiếu biến → value null; chia cho 0 → null.
 */
export function evalExpr(expr: string, values: Record<string, number | null | undefined>): { value: number | null; missing: string[]; error?: string } {
  const src = String(expr ?? '').trim();
  if (!src) return { value: null, missing: [], error: 'Biểu thức rỗng' };
  const tokens = src.match(/[A-Za-z_][\w.]*|\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  if (tokens.join('') !== src.replace(/\s/g, '')) return { value: null, missing: [], error: `Ký tự lạ trong biểu thức: "${src}"` };
  const missing: string[] = [];
  const rpn: (number | string)[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  let prevIsValue = false;
  for (const t of tokens) {
    if (/^\d/.test(t)) { rpn.push(Number(t)); prevIsValue = true; }
    else if (/^[A-Za-z_]/.test(t)) {
      const v = values[t];
      if (v === null || v === undefined || Number.isNaN(Number(v))) { missing.push(t); rpn.push(NaN); } else rpn.push(Number(v));
      prevIsValue = true;
    }
    else if (t === '(') { ops.push(t); prevIsValue = false; }
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') rpn.push(ops.pop()!); ops.pop(); prevIsValue = true; }
    else {
      // dấu trừ đơn: "-x" → "0 - x"
      if (t === '-' && !prevIsValue) rpn.push(0);
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) rpn.push(ops.pop()!);
      ops.push(t); prevIsValue = false;
    }
  }
  while (ops.length) rpn.push(ops.pop()!);
  if (missing.length) return { value: null, missing: [...new Set(missing)] };
  const st: number[] = [];
  for (const t of rpn) {
    if (typeof t === 'number') { st.push(t); continue; }
    const b = st.pop(), a = st.pop();
    if (a === undefined || b === undefined) return { value: null, missing: [], error: `Biểu thức không hợp lệ: "${src}"` };
    if (t === '/') { if (b === 0) return { value: null, missing: [], error: 'Chia cho 0' }; st.push(a / b); }
    else st.push(t === '+' ? a + b : t === '-' ? a - b : a * b);
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) return { value: null, missing: [], error: `Biểu thức không hợp lệ: "${src}"` };
  return { value: st[0], missing: [] };
}

/** Chuỗi số kiểu Việt ("17.206", "3,5", "1.234,5") → number; không hợp lệ → null. */
export function parseVnNumber(raw: string): number | null {
  let s = String(raw ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
