'use client';

/**
 * "Việc của tôi kỳ này" theo vai — GET /admin/me/work (một gói cho trang chủ theo vai, sidebar, Mini App).
 * Trang chủ: Văn phòng → /dashboard, Chủ tịch → /sign, HĐND → /read, Data Owner → /approve, chuyên viên → /my.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export type WorkRun = { run_id: number; period: string; period_label: string; status: string; cutoff_date: string; days_left: number; spec_id: number; spec_title: string | null; signed_number: string | null; signed_date: string | null; locked_at: string | null; output_file: boolean };
export type WorkItem = { id: string; name: string; unit: string; owner_dept: string | null; slot: string; section: string; slot_title: string | null; required: boolean; fact: { id: string; status: string; value: number; as_of_date: string; capture_method: string; version: number | null } | null };
export type WorkPeriod = WorkRun & { counts: { total: number; missing: number; extracted: number; confirmed: number; approved: number }; items: WorkItem[]; errors: any[]; gate_ok: boolean; slots_total: number; slots_complete: number };
export type DeptProgress = { key: string; name: string; head: { id: number; full_name: string } | null; slots_total: number; slots_complete: number; indicators: { total: number; approved: number; confirmed: number; extracted: number; missing: number }; missing_names: string[]; waiting_names: string[]; quarantined: number; errors: number; files: number; last_file_at: string | null; reminds: number; last_remind_at: string | null; state: 'none' | 'done' | 'not_started' | 'in_progress' };
export type Progress = { run_id: number; period: string; period_label: string; status: string; cutoff_date: string; days_left: number; gate: { ok: boolean; errors: number; warnings: number }; totals: { depts: number; done: number; slots_total: number; slots_complete: number }; departments: DeptProgress[] };
export type Work = {
  me: { id: number; full_name?: string; role: string; department: string | null; department_name: string | null; is_data_owner: boolean; home: string };
  open_runs: WorkRun[]; runs: WorkRun[];
  tasks: { open: number; overdue: number; due_soon: number; items: { id: number; code: string; title: string; due_at: string | null; priority: string; status: string; source_type: string | null }[] };
  periods?: WorkPeriod[]; quarantine?: any[]; awaiting_approval?: any[]; progress?: Progress | null; to_sign?: WorkRun[]; drafted?: WorkRun[]; signed: WorkRun[]; readable?: WorkRun[];
};

export function useWork(enabled = true) {
  return useQuery<Work>({ queryKey: ['me-work'], queryFn: () => apiGet('/admin/me/work'), enabled, staleTime: 20_000, refetchInterval: 60_000 });
}

/** Dự phòng khi chưa gọi được API (cookie chỉ có vai, chưa biết có phải Data Owner). */
export function homeForRole(role?: string | null): string {
  if (role === 'leader') return '/sign';
  if (role === 'council') return '/read';
  if (role === 'department_staff') return '/my';
  return '/dashboard';
}

export const ROLE_HOME_LABEL: Record<string, string> = { '/dashboard': 'Tổng quan Văn phòng', '/sign': 'Bàn ký của Chủ tịch', '/read': 'Đọc báo cáo', '/approve': 'Duyệt số của phòng', '/my': 'Việc của tôi' };

export function daysLeftText(d: number): string {
  if (d < 0) return `quá hạn chốt ${-d} ngày`;
  if (d === 0) return 'hạn chốt hôm nay';
  return `còn ${d} ngày đến hạn chốt`;
}

export function dueText(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: 'không hạn', overdue: false };
  const d = new Date(iso); const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const date = d.toLocaleDateString('vi-VN');
  if (days < 0) return { text: `quá hạn ${-days} ngày (${date})`, overdue: true };
  if (days === 0) return { text: `hạn hôm nay (${date})`, overdue: false };
  return { text: `còn ${days} ngày (${date})`, overdue: false };
}
