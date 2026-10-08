/**
 * Lớp TIER đã được GỠ ở ZSC (bản đầy đủ, không bán theo gói).
 * Giữ nguyên tên hàm/kiểu để code dùng chung với Vũ Thư (có TIER) vẫn biên dịch,
 * nhưng mọi truy vấn đều trả về "full": không tính năng nào bị khoá, không giới hạn
 * số tài khoản, đủ 3 tin OA mỗi giao dịch.
 */

export type Tier = 'full';

export type FeatureKey =
  | 'satisfaction'
  | 'appointment-reminder'
  | 'tdp-targeting'
  | 'ai'
  | 'ai-rag'
  | 'surveys'
  | 'economy'
  | 'cameras'
  | 'broadcasts'
  | 'dashboard-advanced'
  | 'audit-log'
  | 'legal';

const ALL_FEATURES: FeatureKey[] = [
  'satisfaction',
  'appointment-reminder',
  'tdp-targeting',
  'ai',
  'ai-rag',
  'surveys',
  'economy',
  'cameras',
  'broadcasts',
  'dashboard-advanced',
  'audit-log',
  'legal',
];

export const MSG_LEVEL: Record<Tier, number> = { full: 3 };

export const ALLOWED_ROLES: Record<Tier, string[]> = {
  full: ['super_admin', 'commune_admin', 'department_staff', 'leader', 'tdp_head', 'council'],
};

export const MAX_ADMIN_ACCOUNTS: Record<Tier, number> = { full: Number.MAX_SAFE_INTEGER };

export function getTier(): Tier {
  return 'full';
}

export function getFeatures(): FeatureKey[] {
  return ALL_FEATURES;
}

export function hasFeature(_key: FeatureKey): boolean {
  return true;
}

export function msgLevel(): number {
  return MSG_LEVEL.full;
}
