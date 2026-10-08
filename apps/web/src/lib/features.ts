'use client';

/**
 * Tính năng theo gói (tier) — đọc từ GET /public/profile (env APP_TIER phía API).
 * Chưa nạp xong → coi như FULL để không khoá nhầm; khoá thật nằm ở API guard.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

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

type TierProfile = {
  tier?: 'full' | 'standard' | 'basic';
  features?: string[];
  allowed_roles?: string[];
};

export function useFeatures() {
  const { data } = useQuery<TierProfile>({
    queryKey: ['tier-profile'],
    queryFn: () => apiGet('/public/profile'),
    staleTime: 5 * 60_000,
  });

  const set = Array.isArray(data?.features) ? new Set(data!.features) : null;

  return {
    tier: data?.tier,
    allowedRoles: data?.allowed_roles,
    loaded: set !== null,
    // DO360 không phân gói: mọi tính năng luôn bật
    has: (_key: FeatureKey) => true,
  };
}
