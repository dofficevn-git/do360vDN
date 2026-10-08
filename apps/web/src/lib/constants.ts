// Nguồn duy nhất cho status & category dùng chung nhiều trang (gom từ các bản trùng).

export type Tone = 'primary' | 'blue' | 'green' | 'amber' | 'red' | 'slate';

/** Trạng thái phản ánh — tone dùng cho <StatusBadge>. */
export const FEEDBACK_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'Mới', tone: 'blue' },
  received: { label: 'Đã tiếp nhận', tone: 'blue' },
  processing: { label: 'Đang xử lý', tone: 'amber' },
  need_more_info: { label: 'Cần bổ sung', tone: 'amber' },
  completed: { label: 'Hoàn thành', tone: 'green' },
  rejected: { label: 'Từ chối', tone: 'slate' },
  overdue: { label: 'Quá hạn', tone: 'red' },
};

export function feedbackStatus(status: string): { label: string; tone: Tone } {
  return FEEDBACK_STATUS[status] ?? { label: status, tone: 'slate' };
}

/** Lĩnh vực / bộ phận của phản ánh. */
export const FEEDBACK_CATEGORY: Record<string, string> = {
  infrastructure: 'Hạ tầng giao thông',
  environment: 'Môi trường',
  security: 'An ninh trật tự',
  administration: 'Hành chính',
  other: 'Khác',
};

export const catLabel = (c: string): string => FEEDBACK_CATEGORY[c] ?? c;
