'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet } from '@/lib/api';
import { BoolCheck, Callout, DataTable, FormField, Modal, PageHeader, SelectInput, TechDetails, TextInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg } from '@/lib/do360';

type Department = { id: number; key: string; name: string; description: string | null; head_admin_id: number | null; is_active: boolean; sort_order: number };
type Staff = { id: number; full_name: string; role: string; department: string | null };

/** Phòng, bộ phận = chủ dữ liệu (Data Owner). Người đại diện phòng duyệt số của lĩnh vực mình và nhận cảnh báo cách ly. */
export default function DepartmentsPage() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: '', description: '', head_admin_id: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const { data: departments = [], isLoading } = useQuery<Department[]>({ queryKey: ['departments'], queryFn: () => apiGet('/admin/departments') });
  const { data: staff = [] } = useQuery<Staff[]>({ queryKey: ['assignable'], queryFn: () => apiGet('/admin/users/assignable') });
  const { data: indicators = [] } = useQuery<any[]>({ queryKey: ['indicators'], queryFn: () => apiGet('/admin/catalog/indicators') });
  const save = useMutation({ mutationFn: () => api.patch(`/admin/departments/${editing!.id}`, { name: form.name, description: form.description || null, head_admin_id: form.head_admin_id ? Number(form.head_admin_id) : null }).then((r) => r.data),
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['departments'] }); }, onError: (e) => setNotice(errMsg(e)) });
  const canEdit = ['super_admin', 'commune_admin'].includes(me.role ?? '');

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Cấu hình" title="Phòng, bộ phận" description="Theo NĐ 150/2025/NĐ-CP + các đơn vị gửi số định kỳ. Mỗi phòng có người đại diện duyệt số (Data Owner)." />
      {notice && <Callout tone="danger">{notice}</Callout>}
      <DataTable isLoading={isLoading}>
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Phòng, bộ phận</th><th className={TABLE_TH_CLS}>Phụ trách</th><th className={TABLE_TH_CLS}>Người đại diện (Data Owner)</th><th className="px-3 py-1.5 text-center">Chỉ tiêu</th><th className="px-3 py-1.5 text-center">Hoạt động</th><th className="px-3 py-1.5 text-right">Thao tác</th></tr></thead>
          <tbody className="divide-y divide-rule">{departments.map((d) => (
            <tr key={d.id} className="row-hover"><td className={`${TABLE_TD_CLS} font-medium text-ink`}>{d.name}<TechDetails inline label="mã">{d.key}</TechDetails></td><td className={`${TABLE_TD_CLS} text-ink-3`}>{d.description ?? '—'}</td>
              <td className={TABLE_TD_CLS}>{d.head_admin_id ? (staff.find((s) => s.id === d.head_admin_id)?.full_name ?? `#${d.head_admin_id}`) : <span className="text-xs text-amber-600">chưa gán — số của phòng không có ai duyệt</span>}</td>
              <td className={`${TABLE_TD_CLS} kpi-num text-center`}>{indicators.filter((i) => i.owner_dept === d.key).length}</td>
              <td className="px-3 py-1.5 text-center"><BoolCheck value={d.is_active} /></td>
              <td className="px-3 py-1.5 text-right">{canEdit && <ToolbarButton variant="ghost" onClick={() => { setEditing(d); setForm({ name: d.name, description: d.description ?? '', head_admin_id: d.head_admin_id ? String(d.head_admin_id) : '' }); }}>Sửa</ToolbarButton>}</td></tr>))}</tbody>
        </table>
      </DataTable>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Sửa: ${editing?.name ?? ''}`} footer={<><ToolbarButton variant="ghost" onClick={() => setEditing(null)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Lưu</ToolbarButton></>}>
        <div className="space-y-3">
          <FormField label="Tên"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
          <FormField label="Phụ trách"><TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
          <FormField label="Người đại diện (duyệt số, nhận cảnh báo)"><SelectInput value={form.head_admin_id} onChange={(e) => setForm({ ...form, head_admin_id: e.target.value })}><option value="">— chưa gán —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.department ? ` · ${s.department}` : ''}</option>)}</SelectInput></FormField>
        </div>
      </Modal>
    </div>
  );
}
