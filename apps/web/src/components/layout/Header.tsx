'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Cookies from 'js-cookie';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, api } from '@/lib/api';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Bell, FileText, Link2, CheckCircle2, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/admin-ui';
import { getPageTitle, getPageGroup } from './nav-config';

const QRCodeSVG = dynamic(() => import('qrcode.react').then((m) => m.QRCodeSVG), { ssr: false });

const ZALO_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ZALO_LOGIN === 'true';
const APP_ID = process.env.NEXT_PUBLIC_ZALO_APP_ID ?? '';

type StaffNotif = {
  id: number;
  type: string;
  title: string;
  body: string;
  reference_type: string;
  reference_id: number;
  is_read: boolean;
  created_at: string;
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ id: number; full_name: string; role: string } | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [linkZaloSession, setLinkZaloSession] = useState<{ session_id: string; expires_at: string } | null>(null);
  const [linkZaloStatus, setLinkZaloStatus] = useState<'idle' | 'loading' | 'linked'>('idle');
  const qc = useQueryClient();

  useEffect(() => {
    const userStr = Cookies.get('admin_user');
    if (userStr) {
      try { setUser(JSON.parse(userStr)); } catch {}
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['staff-notif-count'],
    queryFn: () => apiGet('/admin/staff-notifications/unread-count'),
    refetchInterval: 30_000,
    enabled: !!user,
  });

  const { data: notifData } = useQuery<{ items: StaffNotif[] }>({
    queryKey: ['staff-notifs'],
    queryFn: () => apiGet('/admin/staff-notifications?page=1'),
    enabled: bellOpen && !!user,
    staleTime: 10_000,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.patch(`/admin/staff-notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-notif-count'] });
      qc.invalidateQueries({ queryKey: ['staff-notifs'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.patch('/admin/staff-notifications/read-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-notif-count'] });
      qc.invalidateQueries({ queryKey: ['staff-notifs'] });
    },
  });

  async function openLinkZalo() {
    setUserMenuOpen(false);
    setLinkZaloStatus('loading');
    setLinkZaloSession(null);
    try {
      const { data } = await api.post('/admin/auth/link-zalo-session');
      setLinkZaloSession(data);
      setLinkZaloStatus('idle');

      // Poll session status
      const pollId = setInterval(async () => {
        try {
          const { data: poll } = await api.get(`/admin/auth/qr-session/${data.session_id}`);
          if (poll.status === 'linked') {
            clearInterval(pollId);
            setLinkZaloStatus('linked');
          } else if (poll.status === 'expired') {
            clearInterval(pollId);
            setLinkZaloSession(null);
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch {
      setLinkZaloStatus('idle');
    }
  }

  function handleNotifClick(n: StaffNotif) {
    if (!n.is_read) markRead.mutate(n.id);
    setBellOpen(false);
    if (n.reference_type === 'fact') {
      router.push('/facts?view=quarantine');
    } else if (n.reference_type === 'task') {
      router.push('/dashboard');
    } else if (n.reference_type === 'source_file') {
      router.push('/facts');
    } else if (n.reference_type === 'report_run' && n.reference_id) {
      router.push(`/report-runs/${n.reference_id}`);
    }
  }

  const unreadCount = unreadData?.count ?? 0;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule bg-white px-5 md:px-7">
      {/* Left: breadcrumb một dòng (ẩn nhóm khi trùng tên trang) */}
      <div className="flex min-w-0 items-baseline gap-1.5">
        {getPageGroup(pathname) !== getPageTitle(pathname) && (
          <>
            <span className="text-xs2 font-medium text-slate-400">{getPageGroup(pathname)}</span>
            <span className="text-xs2 text-slate-300">/</span>
          </>
        )}
        <h2 className="m-0 truncate text-[14.5px] font-bold leading-tight tracking-tight text-slate-900">
          {getPageTitle(pathname)}
        </h2>
      </div>

      {/* Right: tìm kiếm toàn hệ thống + bell + user */}
      <div className="flex items-center gap-3">
        <form onSubmit={(e) => { e.preventDefault(); const q = (new FormData(e.currentTarget).get('q') as string)?.trim(); if (q) router.push(`/search?q=${encodeURIComponent(q)}`); }} className="hidden md:block" role="search">
          <input name="q" placeholder="Tìm đối tượng, chỉ tiêu, văn bản…" aria-label="Tìm kiếm toàn hệ thống" className="h-9 w-64 rounded-lg border border-rule bg-slate-50 px-3 text-sm2 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary-500 focus:bg-white" />
        </form>
        {/* Notification bell */}
        {user && (
          <div ref={bellRef} className="relative">
            <button
              onClick={() => setBellOpen(o => !o)}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <Bell className="h-5 w-5" strokeWidth={2} />
              {unreadCount > 0 && (
                <span className="kpi-num absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {bellOpen && (
              <div className="fade-in-up absolute right-0 top-12 z-dropdown w-80 overflow-hidden rounded-panel border border-rule bg-white shadow-panel">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800">Thông báo của tôi</p>
                  {unreadCount > 0 && (
                    <button
                      onClick={() => markAllRead.mutate()}
                      className="text-xs font-medium text-primary-500 hover:underline"
                    >
                      Đọc tất cả
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {!notifData?.items?.length ? (
                    <div className="py-8 text-center text-sm text-slate-400">
                      Chưa có thông báo mới.
                    </div>
                  ) : (
                    notifData.items.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
                        className={`row-hover w-full border-b border-slate-50 px-4 py-3 text-left ${!n.is_read ? 'bg-primary-50/60' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" strokeWidth={2} />
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs leading-snug ${!n.is_read ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                              {n.title}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-500">{n.body}</p>
                            <p className="kpi-num mt-1 text-[10px] text-slate-400">
                              {new Date(n.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
                            </p>
                          </div>
                          {!n.is_read && (
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2.5">
                  <Link
                    href="/notifications"
                    onClick={() => setBellOpen(false)}
                    className="text-xs font-medium text-primary-500 hover:underline"
                  >
                    Xem toàn bộ nhật ký thông báo →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* User avatar + dropdown (tên/vai trò đã hiển thị ở user card sidebar) */}
        {user && (
          <div ref={userMenuRef} className="relative">
            <button
              onClick={() => setUserMenuOpen((o) => !o)}
              aria-label="Tài khoản" aria-expanded={userMenuOpen} className="flex items-center rounded-lg p-1 transition-colors hover:bg-slate-100"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ background: '#0F3D6E' }}
              >
                {user.full_name?.charAt(0)?.toUpperCase() || 'A'}
              </div>
            </button>

            {userMenuOpen && ZALO_LOGIN_ENABLED && (
              <div className="fade-in-up absolute right-0 top-12 z-dropdown w-52 overflow-hidden rounded-panel border border-rule bg-white py-1 shadow-panel">
                <button
                  onClick={openLinkZalo}
                  className="row-hover flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700"
                >
                  <Link2 className="h-4 w-4 text-primary-500" strokeWidth={2} />
                  Liên kết tài khoản Zalo
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal liên kết Zalo */}
      <Modal
        open={linkZaloSession !== null}
        onClose={() => { setLinkZaloSession(null); setLinkZaloStatus('idle'); }}
        maxWidth="max-w-sm"
      >
        {linkZaloSession && (
          <div className="text-center">
            {linkZaloStatus === 'linked' ? (
              <>
                <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" strokeWidth={2} />
                <p className="mb-1 font-semibold text-slate-900">Liên kết thành công!</p>
                <p className="mb-4 text-sm text-slate-500">Từ nay bạn có thể đăng nhập bằng QR Zalo.</p>
                <button onClick={() => { setLinkZaloSession(null); setLinkZaloStatus('idle'); }}
                  className="h-9 rounded-lg bg-primary-500 px-6 text-sm2 font-semibold text-white transition hover:bg-primary-600">
                  Đóng
                </button>
              </>
            ) : (
              <>
                <h2 className="mb-1 font-bold text-slate-900">Liên kết tài khoản Zalo</h2>
                <p className="mb-4 text-sm text-slate-500">Mở Zalo → quét mã này để liên kết</p>
                <div className="mb-4 flex justify-center">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    {QRCodeSVG && (
                      <QRCodeSVG
                        value={`https://zalo.me/miniapp?id=${APP_ID}&path=${encodeURIComponent(`/admin-auth?session_id=${linkZaloSession.session_id}&mode=link`)}`}
                        size={180}
                        fgColor="#06283D"
                      />
                    )}
                  </div>
                </div>
                <p className="mb-4 text-xs text-slate-400">Sau khi quét, trang này tự cập nhật</p>
                <button onClick={() => setLinkZaloSession(null)}
                  className="text-sm text-slate-500 hover:underline">Đóng</button>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={linkZaloStatus === 'loading'} onClose={() => {}} maxWidth="max-w-xs">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" strokeWidth={2.5} />
          <span className="text-sm text-slate-700">Đang tạo mã QR...</span>
        </div>
      </Modal>
    </header>
  );
}
