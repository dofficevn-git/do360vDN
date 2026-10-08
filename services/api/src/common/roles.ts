/**
 * Nhóm role dùng cho phân quyền 3 lớp — nguồn sự thật duy nhất.
 *
 * - WARD_ROLES   : cán bộ xã — được tác nghiệp đầy đủ (web + Khu vực cán bộ trên Mini App).
 * - MANAGER_ROLES: lãnh đạo/quản trị — thêm quyền cấu hình (tổ dân phố, xem tài khoản, audit).
 * - ALL_ADMIN_ROLES: mọi admin, gồm cả tổ trưởng TDP (tdp_head) — chỉ dùng cho endpoint
 *   đã tự scope dữ liệu theo tdp_id (feedbacks read, announcements tổ, staff-notifications…).
 */
export const WARD_ROLES = [
  'super_admin',
  'commune_admin',
  'department_staff',
  'leader',
] as const;

export const MANAGER_ROLES = ['super_admin', 'commune_admin'] as const;

/** HĐND / người đọc: chỉ xem báo cáo đã chốt hoặc đã ký, bảng điều hành, danh mục. Không thấy số chưa duyệt. */
export const READER_ROLES = [...WARD_ROLES, 'council'] as const;

export const ALL_ADMIN_ROLES = [...WARD_ROLES, 'tdp_head', 'council'] as const;
