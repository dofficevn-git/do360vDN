'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Cookies from 'js-cookie';
import { api, apiGet } from '@/lib/api';
import { ConfirmDialog, BoolCheck, PageHeader, Modal, FormField, TextInput, SelectInput } from '@/components/ui/admin-ui';

// ─── Types ───────────────────────────────────────────────────────────────────

type AdminRole = 'super_admin' | 'commune_admin' | 'department_staff' | 'leader' | 'tdp_head' | 'council';

type AdminUser = {
  id: number;
  full_name: string;
  email: string | null;
  zalo_name: string | null;
  role: AdminRole;
  department: string | null;
  tdp_id: number | null;
  is_active: boolean;
};

type TdpOption = { id: number; name: string };

type Invitation = {
  id: number;
  token: string;
  role: string;
  department: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  is_used: boolean;
  is_expired: boolean;
};

import { useFeatures } from '@/lib/features';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_MAP: Record<AdminRole, string> = {
  super_admin: 'Quản trị tối cao',
  commune_admin: 'Quản trị xã',
  department_staff: 'Cán bộ bộ phận',
  leader: 'Lãnh đạo',
  tdp_head: 'Trưởng Tổ dân phố',
  council: 'HĐND (chỉ đọc báo cáo)',
};

const EMPTY_USER = { full_name: '', email: '', password: '', role: 'department_staff', department: '', tdp_id: '', is_active: true } as const;

const ZALO_OA_ID = process.env.NEXT_PUBLIC_ZALO_OA_ID ?? '';
// Mini App chưa được Zalo duyệt → dùng OA chat mode (giống QR login).
// User quét QR → mở chat OA → dán "INVITE <token>" → webhook tạo admin tự động.
function buildOaChatLink() {
  return `https://zalo.me/${ZALO_OA_ID}`;
}
function buildInviteMessage(token: string) {
  return `INVITE ${token}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Danh sách vai trò theo GÓI triển khai (allowed_roles từ /public/profile). */
function RoleOptions() {
  const { allowedRoles } = useFeatures();
  return (
    <>
      {(Object.entries(ROLE_MAP) as [AdminRole, string][])
        .filter(([k]) => !allowedRoles || allowedRoles.includes(k))
        .map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
    </>
  );
}

function RoleBadge({ role }: { role: string }) {
  const label = ROLE_MAP[role as AdminRole] ?? role;
  const cls =
    role === 'super_admin' ? 'bg-primary-50 text-primary-700' :
    role === 'commune_admin' ? 'bg-blue-100 text-blue-700' :
    role === 'leader' ? 'bg-amber-100 text-amber-700' :
    role === 'tdp_head' ? 'bg-emerald-100 text-emerald-700' :
    'bg-slate-100 text-ink-3';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}

function InvStatusBadge({ inv }: { inv: Invitation }) {
  if (inv.is_used)    return <span className="px-2 py-0.5 text-xs bg-slate-100 text-ink-3 rounded-full">Đã dùng</span>;
  if (inv.is_expired) return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded-full">Hết hạn</span>;
  return <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">Còn hiệu lực</span>;
}

// ─── Accounts tab ─────────────────────────────────────────────────────────────

function AccountsTab() {
  const qc = useQueryClient();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { data: users = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: () => apiGet('/admin/users'),
  });
  const { data: tdpList = [] } = useQuery<TdpOption[]>({
    queryKey: ['tdp'],
    queryFn: () => apiGet('/admin/tdp'),
  });

  const [form, setForm] = useState<Record<string, string | boolean>>(EMPTY_USER);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Chuẩn hoá tdp_id: chỉ giữ khi role = tdp_head, ép về số/null
      const payload: Record<string, any> = { ...form };
      payload.tdp_id =
        form.role === 'tdp_head' && form.tdp_id ? Number(form.tdp_id) : null;
      return editId
        ? api.patch(`/admin/users/${editId}`, payload)
        : api.post('/admin/users', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setShowForm(false);
      setForm(EMPTY_USER);
      setEditId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  function startEdit(u: AdminUser) {
    const { id: _id, zalo_name: _z, tdp_id, ...rest } = u;
    setForm({ ...rest, tdp_id: tdp_id ? String(tdp_id) : '', password: '' });
    setEditId(u.id);
    setShowForm(true);
  }

  function closeForm() { setShowForm(false); setForm(EMPTY_USER); setEditId(null); }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { setForm(EMPTY_USER); setEditId(null); setShowForm(true); }}
          className="h-10 rounded-lg bg-primary-500 px-3.5 text-sm2 font-semibold text-white transition-colors hover:bg-primary-600"
        >
          + Thêm tài khoản
        </button>
      </div>

      {showForm && (
        <div className="card p-5 mb-5">
          <h2 className="text-sm font-semibold text-ink-2 mb-4">{editId ? 'Sửa tài khoản' : 'Thêm tài khoản mới'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Họ tên">
              <TextInput value={form.full_name as string} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </FormField>
            <FormField label="Email">
              <TextInput type="email" value={form.email as string} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </FormField>
            <FormField label={`Mật khẩu ${editId ? '(để trống = không đổi)' : ''}`.trim()}>
              <TextInput type="password" value={form.password as string} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </FormField>
            <FormField label="Vai trò">
              <SelectInput value={form.role as string} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <RoleOptions />
              </SelectInput>
            </FormField>
            <FormField label="Phòng ban">
              <TextInput value={form.department as string} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </FormField>
            {form.role === 'tdp_head' && (
              <FormField label="Tổ dân phố phụ trách">
                <SelectInput value={(form.tdp_id as string) ?? ''} onChange={(e) => setForm({ ...form, tdp_id: e.target.value })}>
                  <option value="">— Chọn Tổ dân phố —</option>
                  {tdpList.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </SelectInput>
              </FormField>
            )}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="h-10 rounded-lg bg-primary-500 px-3.5 text-sm2 font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50">
              {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
            </button>
            <button onClick={closeForm} className="h-10 rounded-lg px-3.5 text-sm2 font-semibold text-ink-3 transition-colors hover:bg-slate-100">Huỷ</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? <p className="p-6 text-ink-faint text-sm">Đang tải...</p> :
          users.length === 0 ? <p className="p-6 text-ink-faint text-sm">Chưa có tài khoản nào.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs2 font-semibold text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Họ tên</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-center">Vai trò</th>
                <th className="px-3 py-2 text-center">Phòng ban</th>
                <th className="px-3 py-2 text-center">Trạng thái</th>
                <th className="px-3 py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {users.map((u) => (
                <tr key={u.id} className="row-hover">
                  <td className="px-3 py-2 font-medium text-ink">
                    {u.full_name}
                    {u.zalo_name && u.zalo_name !== u.full_name && (
                      <span className="ml-1 text-xs text-ink-faint">(Zalo: {u.zalo_name})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{u.email ?? <span className="text-slate-300 italic">Zalo</span>}</td>
                  <td className="px-3 py-2 text-center"><RoleBadge role={u.role} /></td>
                  <td className="px-3 py-2 text-center text-ink-muted">{u.department ?? '—'}</td>
                  <td className="px-3 py-2 text-center"><BoolCheck value={u.is_active} /></td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button onClick={() => startEdit(u)} className="text-xs font-medium text-primary-500 hover:underline">Sửa</button>
                    <button onClick={() => setDeleteId(u.id)}
                      className="text-xs font-medium text-red-500 hover:underline">Xoá</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    <ConfirmDialog
        open={deleteId !== null}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId !== null) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Xoá tài khoản này?"
        description="Cán bộ sẽ mất quyền truy cập hệ thống quản trị ngay lập tức."
      />
    </div>
  );
}

// ─── Invitations tab ──────────────────────────────────────────────────────────

function InvitationsTab() {
  const qc = useQueryClient();
  const { data: invitations = [], isLoading } = useQuery<Invitation[]>({
    queryKey: ['admin-invitations'],
    queryFn: () => apiGet('/admin/auth/invitations'),
  });

  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState('department_staff');
  const [department, setDepartment] = useState('');
  const [qrToken, setQrToken] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/auth/invitations', { role, department: department || undefined }),
    onSuccess: (res) => {
      setQrToken(res.data.token);
      setShowForm(false);
      setDepartment('');
      qc.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => { setShowForm(true); setQrToken(null); }}
          className="h-10 rounded-lg bg-primary-500 px-3.5 text-sm2 font-semibold text-white transition-colors hover:bg-primary-600"
        >
          + Tạo lời mời
        </button>
      </div>

      {/* Modal tạo lời mời */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Tạo lời mời mới"
        maxWidth="max-w-sm"
        footer={
          <>
            <button onClick={() => setShowForm(false)}
              className="h-10 rounded-lg border border-rule px-3.5 text-sm2 text-ink-3 transition-colors hover:bg-slate-50">
              Huỷ
            </button>
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
              className="h-10 rounded-lg bg-primary-500 px-3.5 text-sm2 font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-60">
              {createMutation.isPending ? 'Đang tạo...' : 'Tạo QR'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="Vai trò">
            <SelectInput value={role} onChange={(e) => setRole(e.target.value)}>
              <RoleOptions />
            </SelectInput>
          </FormField>
          <FormField label="Bộ phận (tuỳ chọn)">
            <TextInput type="text" value={department} onChange={(e) => setDepartment(e.target.value)}
              placeholder="VD: Văn phòng UBND" />
          </FormField>
        </div>
      </Modal>

      {/* Modal QR — OA chat mode (Mini App chưa duyệt) */}
      <Modal open={qrToken !== null} onClose={() => setQrToken(null)} title="Lời mời quản trị" maxWidth="max-w-md">
        {qrToken && (
          <div className="text-center">
            <p className="text-sm text-ink-muted mb-4">
              Người được mời làm theo <b>2 bước</b> dưới đây
            </p>

            {/* Bước 1: QR mở chat OA */}
            <div className="text-left mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">1</div>
                <div className="flex-1">
                  <div className="font-semibold text-ink text-sm mb-1">Quét QR mở chat OA của đơn vị</div>
                  <p className="text-xs text-ink-3">Dùng camera trong Zalo (hoặc camera điện thoại) quét mã bên dưới</p>
                </div>
              </div>
              <div className="flex justify-center mt-3">
                <div className="p-3 border-2 border-blue-300 rounded-lg bg-white">
                  <QRCodeSVG value={buildOaChatLink()} size={180} />
                </div>
              </div>
            </div>

            {/* Bước 2: Gửi mã invite */}
            <div className="text-left p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">2</div>
                <div className="flex-1">
                  <div className="font-semibold text-ink text-sm mb-1">Gửi tin nhắn này vào chat OA</div>
                  <p className="text-xs text-ink-3 mb-2">Sao chép → dán vào chat OA vừa mở → gửi</p>
                  <div className="bg-white border border-amber-300 rounded-lg p-2 font-mono text-xs text-ink break-all select-all">
                    {buildInviteMessage(qrToken)}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(buildInviteMessage(qrToken))}
                    className="mt-2 w-full bg-amber-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-amber-700 transition"
                  >
                    Sao chép tin nhắn
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-ink-faint mb-3">
              Sau khi gửi, hệ thống tự tạo tài khoản admin và liên kết Zalo.
              <br />Hiệu lực 7 ngày · Chỉ dùng được 1 lần
            </p>
            <button onClick={() => setQrToken(null)}
              className="w-full bg-primary-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-primary-600 transition">
              Đóng
            </button>
          </div>
        )}
      </Modal>

      {/* Danh sách */}
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
                <th className="text-left px-4 py-3 font-medium">Bộ phận</th>
                <th className="text-left px-4 py-3 font-medium">Tạo lúc</th>
                <th className="text-left px-4 py-3 font-medium">Hết hạn</th>
                <th className="text-left px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {invitations.map((inv) => (
                <tr key={inv.id} className="row-hover">
                  <td className="px-3 py-2"><RoleBadge role={inv.role} /></td>
                  <td className="px-3 py-2 text-ink-3">{inv.department ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-muted">{new Date(inv.created_at).toLocaleDateString('vi-VN')}</td>
                  <td className="px-3 py-2 text-ink-muted">{new Date(inv.expires_at).toLocaleDateString('vi-VN')}</td>
                  <td className="px-3 py-2"><InvStatusBadge inv={inv} /></td>
                  <td className="px-3 py-2 text-right">
                    {!inv.is_used && !inv.is_expired && (
                      <button onClick={() => setQrToken(inv.token)}
                        className="text-primary-500 text-xs font-medium hover:underline">
                        Xem QR
                      </button>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const adminRole = (() => {
    try { return JSON.parse(Cookies.get('admin_user') ?? '{}')?.role; } catch { return null; }
  })();

  const [tab, setTab] = useState<'accounts' | 'invitations'>('accounts');

  const tabs = [
    { key: 'accounts', label: 'Tài khoản' },
    ...(adminRole === 'super_admin' ? [{ key: 'invitations', label: 'Lời mời QR' }] : []),
  ] as { key: 'accounts' | 'invitations'; label: string }[];

  return (
    <div>
      <div className="mb-6">
        <PageHeader
          title="Quản lý Tài khoản"
          description="Tài khoản cán bộ, phân quyền và lời mời truy cập hệ thống."
          actions={
            <Link
              href="/citizens"
              className="inline-flex h-9 items-center card px-3 text-sm font-medium text-ink-2 hover:bg-slate-50"
            >
              Bổ nhiệm từ danh sách người dân
            </Link>
          }
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-rule">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary-500 text-primary-500'
                : 'border-transparent text-ink-muted hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'accounts' && <AccountsTab />}
      {tab === 'invitations' && <InvitationsTab />}
    </div>
  );
}
