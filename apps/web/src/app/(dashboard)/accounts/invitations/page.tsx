'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, apiGet } from '@/lib/api';
import { PageHeader, Modal, FormField, TextInput, SelectInput } from '@/components/ui/admin-ui';
import { useFeatures } from '@/lib/features';

type Invitation = {
  id: number;
  token: string;
  role: string;
  department: string | null;
  tdp_id: number | null;
  suggested_name: string | null;
  suggested_phone: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  is_used: boolean;
  is_expired: boolean;
  mini_app_url: string | null;
  oa_url: string | null;
  invite_text: string;
};

type TdpOption = { id: number; name: string };

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Quản trị tối cao',
  commune_admin: 'Quản trị xã',
  department_staff: 'Cán bộ bộ phận',
  leader: 'Lãnh đạo',
  tdp_head: 'Trưởng Tổ dân phố',
};

export default function InvitationsPage() {
  const qc = useQueryClient();
  const { allowedRoles, has } = useFeatures();
  const { data: invitations = [], isLoading } = useQuery<Invitation[]>({
    queryKey: ['admin-invitations'],
    queryFn: () => apiGet('/admin/auth/invitations'),
  });
  const { data: tdpList = [] } = useQuery<TdpOption[]>({
    queryKey: ['tdp'],
    queryFn: () => apiGet('/admin/tdp'),
    enabled: has('tdp-targeting'),
  });

  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState('department_staff');
  const [department, setDepartment] = useState('');
  const [tdpId, setTdpId] = useState<number | ''>('');
  const [suggestedName, setSuggestedName] = useState('');
  const [suggestedPhone, setSuggestedPhone] = useState('');
  const [qrInv, setQrInv] = useState<Invitation | null>(null);
  const [qrTab, setQrTab] = useState<'miniapp' | 'oa'>('miniapp');

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/admin/auth/invitations', {
        role,
        department: department || undefined,
        tdp_id: role === 'tdp_head' && tdpId !== '' ? tdpId : undefined,
        suggested_name: suggestedName || undefined,
        suggested_phone: suggestedPhone || undefined,
      }),
    onSuccess: async (res) => {
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ['admin-invitations'] });
      const created: Invitation = {
        ...(res.data as any),
        role, department: department || null,
        tdp_id: role === 'tdp_head' && tdpId !== '' ? Number(tdpId) : null,
        suggested_name: suggestedName || null, suggested_phone: suggestedPhone || null,
        id: 0, created_at: '', used_at: null, is_used: false, is_expired: false,
      };
      setQrTab(created.mini_app_url ? 'miniapp' : 'oa');
      setQrInv(created);
      setSuggestedName(''); setSuggestedPhone(''); setDepartment(''); setTdpId('');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/auth/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-invitations'] }),
  });

  function statusBadge(inv: Invitation) {
    if (inv.is_used) return <span className="px-2 py-0.5 text-xs bg-slate-100 text-ink-3 rounded-full">Đã dùng</span>;
    if (inv.is_expired) return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded-full">Hết hạn/thu hồi</span>;
    return <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">Còn hiệu lực</span>;
  }

  const canCreate = role !== 'tdp_head' || tdpId !== '';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <PageHeader
          title="Lời mời QR"
          description="Mời cán bộ / tổ trưởng nhận quyền bằng Zalo — quét QR là xong."
          actions={
            <button
              onClick={() => { setShowForm(true); setQrInv(null); }}
              className="h-10 rounded-lg bg-primary-500 px-3.5 text-sm2 font-semibold text-white transition-colors hover:bg-primary-600"
            >
              + Tạo lời mời
            </button>
          }
        />
      </div>

      {/* Modal tạo lời mời */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Tạo lời mời mới"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setShowForm(false)}
              className="h-10 rounded-lg border border-rule px-3.5 text-sm2 text-ink-3 transition-colors hover:bg-slate-50"
            >
              Huỷ
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !canCreate}
              className="h-10 rounded-lg bg-primary-500 px-3.5 text-sm2 font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Đang tạo...' : 'Tạo QR'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Vai trò">
            <SelectInput value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABELS)
                .filter(([k]) => !allowedRoles || allowedRoles.includes(k))
                .filter(([k]) => k !== 'tdp_head' || has('tdp-targeting'))
                .map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </SelectInput>
          </FormField>
          {role === 'tdp_head' && (
            <FormField label="Tổ dân phố phụ trách (bắt buộc)">
              <SelectInput value={String(tdpId)} onChange={(e) => setTdpId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">-- Chọn tổ --</option>
                {tdpList.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </SelectInput>
            </FormField>
          )}
          <FormField label="Tên gợi ý (tuỳ chọn)">
            <TextInput
              type="text"
              value={suggestedName}
              onChange={(e) => setSuggestedName(e.target.value)}
              placeholder="VD: Nguyễn Văn Bình"
            />
          </FormField>
          <FormField label="SĐT gợi ý (tuỳ chọn)">
            <TextInput
              type="text"
              value={suggestedPhone}
              onChange={(e) => setSuggestedPhone(e.target.value)}
              placeholder="VD: 0912 345 678"
            />
          </FormField>
          <FormField label="Bộ phận (tuỳ chọn)">
            <TextInput
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="VD: Văn phòng UBND"
            />
          </FormField>
        </div>
      </Modal>

      {/* QR mời — 2 tab: Mini App (chính) / OA chat (fallback) */}
      <Modal open={qrInv !== null} onClose={() => setQrInv(null)} title="Lời mời quản trị" maxWidth="max-w-md">
        {qrInv && (
          <div className="text-center">
            <div className="flex gap-1 mb-4 rounded-lg bg-slate-100 p-1">
              {qrInv.mini_app_url && (
                <button
                  onClick={() => setQrTab('miniapp')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${qrTab === 'miniapp' ? 'bg-white shadow text-primary-600' : 'text-ink-muted'}`}
                >
                  QR Mini App
                </button>
              )}
              <button
                onClick={() => setQrTab('oa')}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${qrTab === 'oa' ? 'bg-white shadow text-primary-600' : 'text-ink-muted'}`}
              >
                QR OA (dự phòng)
              </button>
            </div>

            {qrTab === 'miniapp' && qrInv.mini_app_url ? (
              <div className="text-left mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="font-semibold text-ink text-sm mb-1">Quét QR bằng Zalo → mở Mini App → bấm Xác nhận</div>
                <p className="text-xs text-ink-3">
                  Nhanh nhất: hệ thống tự liên kết Zalo và cấp quyền ngay trong app.
                  Nếu chưa theo dõi OA, app sẽ tự mời theo dõi rồi tiếp tục.
                </p>
                <div className="flex justify-center mt-3">
                  <div className="p-3 border-2 border-blue-300 rounded-lg bg-white">
                    <QRCodeSVG value={qrInv.mini_app_url} size={180} />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="text-left mb-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="font-semibold text-ink text-sm mb-1">Bước 1 — Quét QR mở chat OA</div>
                  <div className="flex justify-center mt-3">
                    <div className="p-3 border-2 border-blue-300 rounded-lg bg-white">
                      <QRCodeSVG value={qrInv.oa_url ?? ''} size={160} />
                    </div>
                  </div>
                </div>
                <div className="text-left p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                  <div className="font-semibold text-ink text-sm mb-1">Bước 2 — Gửi tin nhắn này vào chat OA</div>
                  <div className="bg-white border border-amber-300 rounded-lg p-2 font-mono text-xs text-ink break-all select-all">
                    {qrInv.invite_text}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(qrInv.invite_text)}
                    className="mt-2 w-full bg-amber-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-amber-700 transition"
                  >
                    Sao chép tin nhắn
                  </button>
                </div>
              </>
            )}

            <p className="text-xs text-ink-faint mb-3">Hiệu lực 7 ngày · Chỉ dùng được 1 lần</p>
            <button
              onClick={() => setQrInv(null)}
              className="w-full bg-primary-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-600 transition"
            >
              Đóng
            </button>
          </div>
        )}
      </Modal>

      {/* Danh sách lời mời */}
      {isLoading ? (
        <div className="text-center py-12 text-ink-faint">Đang tải...</div>
      ) : invitations.length === 0 ? (
        <div className="text-center py-12 text-ink-faint">Chưa có lời mời nào.</div>
      ) : (
        <div className="bg-white rounded-lg border border-rule overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-ink-3">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Vai trò</th>
                <th className="text-left px-4 py-3 font-medium">Người được mời</th>
                <th className="text-left px-4 py-3 font-medium">Bộ phận / Tổ</th>
                <th className="text-left px-4 py-3 font-medium">Hết hạn</th>
                <th className="text-left px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {invitations.map((inv) => (
                <tr key={inv.id} className="row-hover">
                  <td className="px-3 py-2 font-medium text-ink">{ROLE_LABELS[inv.role] ?? inv.role}</td>
                  <td className="px-3 py-2 text-ink-3">
                    {inv.suggested_name ?? '—'}
                    {inv.suggested_phone && <span className="text-ink-faint"> · {inv.suggested_phone}</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-3">
                    {inv.department ?? (inv.tdp_id ? `Tổ #${inv.tdp_id}` : '—')}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{new Date(inv.expires_at).toLocaleDateString('vi-VN')}</td>
                  <td className="px-3 py-2">{statusBadge(inv)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {!inv.is_used && !inv.is_expired && (
                      <>
                        <button
                          onClick={() => { setQrTab(inv.mini_app_url ? 'miniapp' : 'oa'); setQrInv(inv); }}
                          className="text-primary-500 text-xs font-medium hover:underline"
                        >
                          Xem QR
                        </button>
                        <button
                          onClick={() => revokeMutation.mutate(inv.id)}
                          className="ml-3 text-red-500 text-xs font-medium hover:underline"
                        >
                          Thu hồi
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
