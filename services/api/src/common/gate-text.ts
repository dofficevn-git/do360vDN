/**
 * Quality Gate nói bằng câu. Mỗi vấn đề có `kind` (máy đọc), `title`/`detail`/`fix_hint` (người đọc) và `message`
 * (câu gộp cho web, Tabot, .docx). Mã kỹ thuật giữ trong `tech` để khối "Chi tiết kỹ thuật" hiển thị.
 */
export type GateGroup = 'so_hoc' | 'dinh_dang' | 'ngay_chot' | 'xu_huong' | 'day_du' | 'nhat_quan';
export type GateKind =
  | 'sum_mismatch' | 'missing' | 'unapproved' | 'cutoff_mismatch' | 'cutoff_after_period' | 'cumulative_drop' | 'big_change'
  | 'not_integer' | 'percent_range' | 'negative' | 'period_word' | 'ambiguous_number';
export type GateLevel = 'error' | 'warning';

export interface GateIssue {
  group: GateGroup;
  kind: GateKind;
  level: GateLevel;
  /** Một câu ngắn, ngôn ngữ cán bộ */
  title: string;
  /** Giải thích thêm (tuỳ chọn) */
  detail?: string;
  /** Ai sửa, sửa ở đâu */
  fix_hint?: string;
  /** Đường dẫn web để đi sửa */
  fix_link?: string;
  /** Câu gộp dùng cho mọi kênh (= title + detail) — giữ tương thích API cũ */
  message: string;
  /** Chuỗi kỹ thuật: biểu thức, mã chỉ tiêu, giá trị thô */
  tech?: string;
  slot?: string;
  slot_title?: string;
  indicator?: string;
  indicator_name?: string;
  owner_dept?: string | null;
  owner_dept_name?: string | null;
  /** Số liệu liên quan (mã) để UI mở đúng dòng */
  fact_ids?: string[];
  /** Nhiều chỉ tiêu trong cùng một vấn đề (vd cả mục chốt cùng một ngày lệch) */
  indicator_ids?: string[];
}

export const GATE_GROUP_LABEL: Record<GateGroup, string> = {
  so_hoc: 'Số học', dinh_dang: 'Định dạng', ngay_chot: 'Ngày chốt', xu_huong: 'Xu hướng', day_du: 'Đầy đủ', nhat_quan: 'Nhất quán kỳ',
};

export const FACT_STATUS_LABEL: Record<string, string> = {
  extracted: 'chờ xác nhận', confirmed: 'đã xác nhận, chờ duyệt', approved: 'đã duyệt', locked: 'đã chốt', quarantined: 'đang cách ly', rejected: 'đã loại',
};

const vn = (n: number) => (Number.isInteger(n) ? n.toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { maximumFractionDigits: 3 }));
const vnDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

/** Ghép câu gộp; dùng chung cho mọi nơi tạo issue. */
export function finalize(i: Omit<GateIssue, 'message'>): GateIssue {
  const message = [i.title, i.detail].filter(Boolean).join(' ');
  return { ...i, message };
}

type Base = { slot?: string; slot_title?: string; owner_dept?: string | null; owner_dept_name?: string | null; fix_link?: string };
const who = (b: Base) => (b.owner_dept_name ? `${b.owner_dept_name} kiểm lại` : 'bộ phận phụ trách kiểm lại');

export const GateText = {
  /** Phép kiểm tổng/thành phần không khớp. terms: [{name, value}], lhs/rhs đã tính, op */
  sumMismatch(b: Base, p: { label?: string; expr: string; lhsTerms: { name: string; value: number }[]; rhsTerms: { name: string; value: number }[]; lhs: number; rhs: number; op: string; indicator?: string; indicator_name?: string }): GateIssue {
    const side = (t: { name: string; value: number }[], total: number) => (t.length > 1 ? `${t.map((x) => `${x.name} ${vn(x.value)}`).join(' + ')} = ${vn(total)}` : `${t[0]?.name ?? ''} ${vn(total)}`);
    const title = p.label
      ? `${p.label}: không khớp (${side(p.lhsTerms, p.lhs)} so với ${side(p.rhsTerms, p.rhs)}).`
      : `${side(p.lhsTerms, p.lhs)} không bằng ${side(p.rhsTerms, p.rhs)}.`;
    return finalize({ group: 'so_hoc', kind: 'sum_mismatch', level: 'error', title, fix_hint: `${who(b)}: một trong các số trên bóc sai hoặc nhập sai — sửa số (thêm phiên bản) rồi xác nhận lại.`, tech: `${p.expr} (${p.lhs} ${p.op} ${p.rhs})`, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  missing(b: Base, names: string[], ids: string[]): GateIssue {
    return finalize({ group: 'day_du', kind: 'missing', level: 'error', title: `Chưa có số: ${names.join(', ')}.`, fix_hint: `${who(b)}: nộp file hoặc nhập số cho các chỉ tiêu này.`, tech: `thiếu ${ids.join(', ')}`, ...b });
  },
  unapproved(b: Base, items: { name: string; status: string; id: string }[]): GateIssue {
    const title = `Chưa duyệt: ${items.map((x) => `${x.name} (${FACT_STATUS_LABEL[x.status] ?? x.status})`).join(', ')}.`;
    return finalize({ group: 'day_du', kind: 'unapproved', level: 'error', title, fix_hint: 'Chuyên viên xác nhận rồi người đại diện phòng duyệt; số đã duyệt mới được chốt kỳ.', tech: items.map((x) => `${x.id}:${x.status}`).join(', '), ...b });
  },
  cutoffMismatch(b: Base, p: { indicator: string; indicator_name: string; as_of: string; cutoff: string; reason?: string | null; fact_id?: string }): GateIssue {
    const hasReason = !!p.reason;
    return finalize({ group: 'ngay_chot', kind: 'cutoff_mismatch', level: hasReason ? 'warning' : 'error',
      title: `${p.indicator_name} chốt ngày ${vnDate(p.as_of)} trong khi kỳ chốt ngày ${vnDate(p.cutoff)}.`,
      detail: hasReason ? `Ngoại lệ đã ghi: ${p.reason}.` : 'Chưa có lý do ngoại lệ.',
      fix_hint: hasReason ? undefined : 'Văn phòng ghi lý do ngoại lệ (nút "ghi ngoại lệ") hoặc bộ phận nộp lại số theo đúng ngày chốt.',
      tech: `${p.indicator}: as_of=${p.as_of} cutoff=${p.cutoff}`, indicator: p.indicator, indicator_name: p.indicator_name, fact_ids: p.fact_id ? [p.fact_id] : undefined, ...b });
  },
  /** Cả mục (hoặc một nhóm chỉ tiêu trong mục) chốt cùng một ngày lệch ngày chốt kỳ — một dòng thay vì mỗi chỉ tiêu một dòng. */
  cutoffMismatchGroup(b: Base, p: { items: { id: string; name: string; fact_id?: string; reason?: string | null }[]; as_of: string; cutoff: string }): GateIssue {
    const noReason = p.items.filter((i) => !i.reason);
    const hasReason = noReason.length === 0;
    const names = p.items.map((i) => i.name);
    const list = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} và ${names.length - 3} chỉ tiêu khác`;
    const title = p.items.length === 1 ? `${names[0]} chốt ngày ${vnDate(p.as_of)} trong khi kỳ chốt ngày ${vnDate(p.cutoff)}.`
      : `${b.slot_title ? `Mục "${b.slot_title}"` : 'Mục này'}: ${p.items.length} chỉ tiêu chốt ngày ${vnDate(p.as_of)} trong khi kỳ chốt ngày ${vnDate(p.cutoff)} (${list}).`;
    return finalize({ group: 'ngay_chot', kind: 'cutoff_mismatch', level: hasReason ? 'warning' : 'error', title,
      detail: hasReason ? `Ngoại lệ đã ghi: ${p.items[0].reason}.` : noReason.length < p.items.length ? `Còn ${noReason.length} chỉ tiêu chưa có lý do ngoại lệ.` : 'Chưa có lý do ngoại lệ.',
      fix_hint: hasReason ? undefined : 'Văn phòng ghi lý do ngoại lệ cho cả nhóm (nút "Ghi lý do ngoại lệ") hoặc bộ phận nộp lại số theo đúng ngày chốt.',
      tech: `${p.items.map((i) => i.id).join(',')}: as_of=${p.as_of} cutoff=${p.cutoff}`, indicator: p.items[0].id, indicator_name: p.items.length === 1 ? names[0] : undefined,
      indicator_ids: p.items.map((i) => i.id), fact_ids: p.items.map((i) => i.fact_id).filter((x): x is string => !!x), ...b });
  },
  cutoffAfterPeriod(b: Base, p: { indicator: string; indicator_name: string; as_of: string; period_end: string }): GateIssue {
    return finalize({ group: 'ngay_chot', kind: 'cutoff_after_period', level: 'warning', title: `${p.indicator_name} chốt ngày ${vnDate(p.as_of)}, sau ngày cuối kỳ ${vnDate(p.period_end)}.`, tech: `${p.indicator}: as_of=${p.as_of} > ${p.period_end}`, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  cumulativeDrop(b: Base, p: { indicator: string; indicator_name: string; value: number; prev: number; prev_label: string }): GateIssue {
    return finalize({ group: 'xu_huong', kind: 'cumulative_drop', level: 'error', title: `${p.indicator_name} lũy kế ${vn(p.value)} nhỏ hơn ${p.prev_label} (${vn(p.prev)}).`, detail: 'Số lũy kế từ đầu năm không thể giảm.', fix_hint: `${who(b)}: kiểm xem đã nhầm số phát sinh trong kỳ với số lũy kế chưa.`, tech: `${p.indicator}: ${p.value} < ${p.prev}`, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  bigChange(b: Base, p: { indicator: string; indicator_name: string; value: number; prev: number; prev_label: string; pct: number }): GateIssue {
    return finalize({ group: 'xu_huong', kind: 'big_change', level: 'warning', title: `${p.indicator_name} ${p.pct >= 0 ? 'tăng' : 'giảm'} ${Math.abs(Math.round(p.pct))}% so với ${p.prev_label} (${vn(p.prev)} → ${vn(p.value)}).`, detail: 'Lệch lớn so với kỳ trước, nên đối chiếu lại nguồn.', tech: `${p.indicator}: ${p.prev} -> ${p.value}`, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  notInteger(b: Base, p: { indicator: string; indicator_name: string; value: number }): GateIssue {
    return finalize({ group: 'dinh_dang', kind: 'not_integer', level: 'error', title: `${p.indicator_name} phải là số nguyên, đang là ${vn(p.value)}.`, fix_hint: `${who(b)}: có thể lẫn dấu chấm nghìn với dấu phẩy thập phân — sửa số.`, tech: `${p.indicator}=${p.value}`, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  percentRange(b: Base, p: { indicator: string; indicator_name: string; value: number }): GateIssue {
    return finalize({ group: 'dinh_dang', kind: 'percent_range', level: 'warning', title: `${p.indicator_name} là ${vn(p.value)}%, ngoài khoảng 0–100%.`, tech: `${p.indicator}=${p.value}`, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  negative(b: Base, p: { indicator: string; indicator_name: string; value: number }): GateIssue {
    return finalize({ group: 'dinh_dang', kind: 'negative', level: 'warning', title: `${p.indicator_name} có giá trị âm (${vn(p.value)}).`, tech: `${p.indicator}=${p.value}`, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  ambiguous(b: Base, p: { indicator: string; indicator_name: string; snippet: string }): GateIssue {
    return finalize({ group: 'dinh_dang', kind: 'ambiguous_number', level: 'warning', title: `${p.indicator_name} bóc từ "${p.snippet}" có thể lẫn dấu thập phân.`, fix_hint: `${who(b)}: đối chiếu với sổ gốc rồi xác nhận hoặc sửa.`, tech: p.snippet, indicator: p.indicator, indicator_name: p.indicator_name, ...b });
  },
  periodWord(b: Base, p: { found: string; period_label: string; where: string }): GateIssue {
    return finalize({ group: 'nhat_quan', kind: 'period_word', level: 'warning', title: `${p.where} nhắc "${p.found}" trong khi đây là báo cáo ${p.period_label}.`, fix_hint: 'Văn phòng sửa lời dẫn cho đúng tên kỳ.', tech: `"${p.found}" vs ${p.period_label}`, ...b });
  },
};

/** Các từ chỉ kỳ hay gặp trong lời văn — để kiểm "nhất quán kỳ". */
export const PERIOD_WORDS: RegExp[] = [
  /\b6 tháng đầu năm(?:\s+\d{4})?/i, /\b9 tháng đầu năm(?:\s+\d{4})?/i, /\bquý\s+(?:I{1,3}|IV|[1-4])(?:\s+năm\s+\d{4})?/i,
  /\btháng\s+(?:0?[1-9]|1[0-2])(?:\s+năm\s+\d{4})?/i, /\bcả năm(?:\s+\d{4})?/i, /\bnăm\s+\d{4}\b/i,
];

/** Tìm từ chỉ kỳ trong lời văn không khớp kỳ báo cáo. */
export function findPeriodWords(text: string, periodLabel: string): string[] {
  const label = periodLabel.toLowerCase();
  const out: string[] = [];
  for (const rx of PERIOD_WORDS) {
    const m = rx.exec(text);
    if (!m) continue;
    const found = m[0].trim();
    if (label.includes(found.toLowerCase())) continue;
    // "năm 2026" đơn lẻ trong "9 tháng đầu năm 2026" là hợp lệ
    if (/^năm\s+\d{4}$/i.test(found) && label.endsWith(found.toLowerCase())) continue;
    out.push(found);
  }
  return [...new Set(out)];
}
