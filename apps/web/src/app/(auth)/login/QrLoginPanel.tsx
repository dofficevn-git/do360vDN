'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import Cookies from 'js-cookie';

const POLL_INTERVAL = 2000;
const SESSION_TTL = 5 * 60; // giây
const ZALO_APP_ID = process.env.NEXT_PUBLIC_ZALO_APP_ID ?? '';
const ZALO_OA_ID = process.env.NEXT_PUBLIC_ZALO_OA_ID ?? '';

// 'oa' = quét QR mở chat OA, gửi 1 tin nhắn → webhook xác thực (hoạt động ngay khi chưa duyệt Mini App)
// 'miniapp' = quét QR deep link Mini App → tự gọi getAccessToken (yêu cầu Mini App đã duyệt)
type QrMode = 'oa' | 'miniapp';
const DEFAULT_MODE: QrMode =
  (process.env.NEXT_PUBLIC_LOGIN_QR_MODE as QrMode) === 'miniapp' ? 'miniapp' : 'oa';

function buildMiniAppDeepLink(sessionId: string) {
  const path = `/admin-auth?session_id=${sessionId}&mode=login`;
  return `https://zalo.me/miniapp?id=${ZALO_APP_ID}&path=${encodeURIComponent(path)}`;
}

function buildOaChatLink() {
  return `https://zalo.me/${ZALO_OA_ID}`;
}

export default function QrLoginPanel() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [, setExpiresAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(SESSION_TTL);
  const [status, setStatus] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading');
  const [mode, setMode] = useState<QrMode>(DEFAULT_MODE);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  const startSession = useCallback(async () => {
    clearTimers();
    setStatus('loading');
    setSessionId(null);
    try {
      const { data } = await api.post('/admin/auth/qr-session');
      setSessionId(data.session_id);
      const exp = new Date(data.expires_at);
      setExpiresAt(exp);
      setCountdown(Math.max(0, Math.round((exp.getTime() - Date.now()) / 1000)));
      setStatus('ready');

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      intervalRef.current = setInterval(async () => {
        try {
          const { data: poll } = await api.get(`/admin/auth/qr-session/${data.session_id}`);
          if (poll.status === 'authenticated') {
            clearTimers();
            Cookies.set('access_token', poll.access_token, { expires: 7 });
            Cookies.set('admin_user', JSON.stringify(poll.user), { expires: 7 });
            router.push('/dashboard');
          } else if (poll.status === 'expired') {
            clearTimers();
            setStatus('expired');
          }
        } catch {
          // bỏ qua lỗi network tạm thời
        }
      }, POLL_INTERVAL);
    } catch {
      setStatus('error');
    }
  }, [router]);

  useEffect(() => {
    startSession();
    return clearTimers;
  }, [startSession]);

  useEffect(() => {
    if (countdown === 0 && status === 'ready') {
      clearTimers();
      setStatus('expired');
    }
  }, [countdown, status]);

  const minutes = String(Math.floor(countdown / 60)).padStart(2, '0');
  const seconds = String(countdown % 60).padStart(2, '0');

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-ink-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
        <p className="text-sm">Đang tạo mã QR...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-8">
        <p className="mb-4 text-sm text-red-600">Không thể tạo mã QR. Vui lòng thử lại.</p>
        <button onClick={startSession} className="text-sm font-medium text-primary-500 underline">
          Thử lại
        </button>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="text-center py-8">
        <p className="mb-4 text-sm text-ink-muted">Mã QR đã hết hạn.</p>
        <button
          onClick={startSession}
          className="h-10 rounded-lg bg-primary-500 px-4 text-sm2 font-semibold text-white transition-colors hover:bg-primary-600"
        >
          Tạo mã mới
        </button>
      </div>
    );
  }

  const qrValue = mode === 'miniapp' && sessionId ? buildMiniAppDeepLink(sessionId) : buildOaChatLink();

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Tab chuyển mode */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode('oa')}
          className={`px-3 py-1.5 rounded-md font-medium transition ${
            mode === 'oa' ? 'bg-white text-primary-600 ring-1 ring-rule' : 'text-ink-muted'
          }`}>
          Qua chat OA
        </button>
        <button
          type="button"
          onClick={() => setMode('miniapp')}
          className={`px-3 py-1.5 rounded-md font-medium transition ${
            mode === 'miniapp' ? 'bg-white text-primary-600 ring-1 ring-rule' : 'text-ink-muted'
          }`}>
          Qua Mini App
        </button>
      </div>

      <div className="rounded-xl border border-rule bg-white p-3">
        <QRCodeSVG value={qrValue} size={200} level="M" fgColor="#081F37" />
      </div>

      {mode === 'oa' ? (
        <div className="text-center">
          <p className="text-sm leading-relaxed text-ink-3">
            Quét mã → mở chat OA → <span className="font-semibold">gửi bất kỳ tin nhắn nào</span>
          </p>
        </div>
      ) : (
        <div className="text-center">
          <p className="text-sm text-ink-3">
            Mở Zalo → quét mã → <span className="font-semibold">đăng nhập ngay</span>
          </p>
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Mã hết hạn sau{' '}
        <span className={`kpi-num font-medium ${countdown < 60 ? 'text-red-500' : 'text-ink-3'}`}>
          {minutes}:{seconds}
        </span>
      </p>

      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        Đang chờ xác thực...
      </div>
    </div>
  );
}
