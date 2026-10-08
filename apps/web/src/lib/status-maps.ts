// Nguồn duy nhất cho map trạng thái → nhãn + Tag preset (gom từ ~6 bản trùng lặp).
// Dùng với <Tag preset={...}> trong admin-ui. Key khớp đúng giá trị API trả về.

import type { TagPreset } from '@/components/ui/admin-ui';

export type StatusEntry = { label: string; tag: TagPreset };

const fallback = (status: string): StatusEntry => ({ label: status, tag: 'neutral' });

/** Trạng thái phản ánh (feedbacks). */
export const FEEDBACK_STATUS: Record<string, StatusEntry> = {
  new: { label: 'Mới', tag: 'blue' },
  received: { label: 'Đã tiếp nhận', tag: 'blue' },
  processing: { label: 'Đang xử lý', tag: 'gold' },
  need_more_info: { label: 'Cần bổ sung', tag: 'gold' },
  completed: { label: 'Hoàn thành', tag: 'green' },
  rejected: { label: 'Từ chối', tag: 'neutral' },
  overdue: { label: 'Quá hạn', tag: 'red' },
};
export const feedbackStatus = (s: string): StatusEntry => FEEDBACK_STATUS[s] ?? fallback(s);

/** Trạng thái lịch hẹn (appointments). */
export const APPOINTMENT_STATUS: Record<string, StatusEntry> = {
  pending: { label: 'Chờ xác nhận', tag: 'gold' },
  confirmed: { label: 'Đã xác nhận', tag: 'green' },
  cancelled: { label: 'Đã hủy', tag: 'red' },
  completed: { label: 'Hoàn thành', tag: 'neutral' },
};
export const appointmentStatus = (s: string): StatusEntry => APPOINTMENT_STATUS[s] ?? fallback(s);

/** Trạng thái khảo sát (surveys). */
export const SURVEY_STATUS: Record<string, StatusEntry> = {
  draft: { label: 'Nháp', tag: 'neutral' },
  active: { label: 'Đang mở', tag: 'green' },
  closed: { label: 'Đã đóng', tag: 'blue' },
};
export const surveyStatus = (s: string): StatusEntry => SURVEY_STATUS[s] ?? fallback(s);

/** Trạng thái gửi thông báo (notification logs). */
export const NOTIFY_STATUS: Record<string, StatusEntry> = {
  sent: { label: 'Đã gửi', tag: 'green' },
  failed: { label: 'Thất bại', tag: 'red' },
  skipped: { label: 'Bỏ qua', tag: 'gold' },
};
export const notifyStatus = (s: string): StatusEntry => NOTIFY_STATUS[s] ?? fallback(s);

/** Vai trò tài khoản quản trị. */
export const ADMIN_ROLE: Record<string, StatusEntry> = {
  super_admin: { label: 'Quản trị hệ thống', tag: 'geekblue' },
  commune_admin: { label: 'Văn phòng HĐND và UBND', tag: 'blue' },
  leader: { label: 'Chủ tịch, Phó Chủ tịch', tag: 'gold' },
  department_staff: { label: 'Cán bộ bộ phận', tag: 'cyan' },
  council: { label: 'HĐND (chỉ đọc)', tag: 'neutral' },
};
export const adminRole = (s: string): StatusEntry => ADMIN_ROLE[s] ?? fallback(s);
