'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { apiGet } from '@/lib/api';
import { homeForRole } from '@/lib/work';

/** Mở app → đúng trang chủ của vai (Văn phòng, Chủ tịch, HĐND, Data Owner, chuyên viên). */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = Cookies.get('access_token');
    if (!token) { router.replace('/login'); return; }
    let role: string | undefined;
    try { role = JSON.parse(Cookies.get('admin_user') || '{}').role; } catch { /* cookie hỏng */ }
    apiGet('/admin/me/work').then((w) => router.replace(w?.me?.home ?? homeForRole(role))).catch(() => router.replace(homeForRole(role)));
  }, [router]);
  return <div className="grid min-h-screen place-items-center bg-canvas text-sm2 text-ink-muted">Đang mở trang của bạn…</div>;
}
