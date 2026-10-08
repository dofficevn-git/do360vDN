'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, Landmark } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Quản trị tối cao',
  commune_admin: 'Quản trị xã',
  department_staff: 'Cán bộ bộ phận',
  leader: 'Lãnh đạo',
};

type Preview = { role: string; department: string | null; expires_at: string };

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/admin/auth/invitations/${token}/preview`)
      .then((r) => r.json())
      .then((d) => {
        if (d.statusCode >= 400) setError(d.message ?? 'Lời mời không hợp lệ');
        else setPreview(d);
      })
      .catch(() => setError('Không thể tải thông tin lời mời'));
  }, [token]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center p-4" style={{ background: '#FBFCFD' }}>
        <div className="w-full max-w-sm rounded-panel bg-white p-8 text-center shadow-login">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
          <h1 className="mb-2 text-lg font-bold text-red-600">Lời mời không hợp lệ</h1>
          <p className="text-sm text-ink-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="grid min-h-screen place-items-center" style={{ background: '#FBFCFD' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/80 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center p-4" style={{ background: '#FBFCFD' }}>
      <div className="w-full max-w-sm rounded-panel bg-white p-8 text-center shadow-login">
        <Landmark className="h-12 w-12 mx-auto mb-4 text-primary-500" />
        <h1 className="mb-1 text-xl font-bold text-ink">Lời mời cấp quyền</h1>
        <p className="mb-6 text-sm text-ink-muted">DO360 cấp xã — Tổng hợp số liệu và sinh báo cáo</p>

        <div className="mb-6 space-y-2 rounded-lg bg-slate-50 p-4 text-left">
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Vai trò</span>
            <span className="font-semibold text-ink">{ROLE_LABELS[preview.role] ?? preview.role}</span>
          </div>
          {preview.department && (
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Bộ phận</span>
              <span className="font-semibold text-ink">{preview.department}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-ink-muted">Hết hạn</span>
            <span className="kpi-num text-ink-2">{new Date(preview.expires_at).toLocaleDateString('vi-VN')}</span>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-dashed p-3 text-left" style={{ background: 'rgba(14,116,144,.055)', borderColor: 'rgba(14,116,144,.34)' }}>
          <p className="mb-1 text-xs text-primary-500">Tin nhắn cần gửi vào OA Zalo xã:</p>
          <p className="select-all break-all font-mono text-sm font-bold text-primary-500">INVITE {token}</p>
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText(`INVITE ${token}`).catch(() => {});
            // OA của xã lấy từ env — không hardcode OA của dự án khác
            const oaId = process.env.NEXT_PUBLIC_ZALO_OA_ID;
            if (oaId) window.location.href = `https://zalo.me/${oaId}`;
            else alert('Chưa cấu hình NEXT_PUBLIC_ZALO_OA_ID — vui lòng mở OA Zalo của xã và gửi tin nhắn đã sao chép.');
          }}
          className="mb-2 block w-full rounded-lg bg-primary-500 py-3 text-sm font-semibold text-white transition hover:bg-primary-600"
        >
          Sao chép mã &amp; mở OA Zalo
        </button>
        <p className="text-xs text-ink-faint">Sau khi mở OA, dán và gửi tin nhắn vừa copy để hoàn tất</p>
      </div>
    </div>
  );
}
