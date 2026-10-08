'use client';

import { Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, FilterTabs, FormField, Modal, PageHeader, SelectInput, Tag, TextInput, TextareaInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg } from '@/lib/do360';
import { useLabels } from '@/lib/labels';
import { dueText } from '@/lib/work';

type View = 'open' | 'overdue' | 'done' | 'all';
type Task = { id: number; code: string; title: string; description: string | null; due_at: string | null; priority: string; status: string; source_type: string | null; source_id: number | null; assignee?: { id: number; full_name: string; department: string | null } | null; assigner?: { id: number; full_name: string } | null; result_note?: string | null };
const PRIORITY: Record<string, { label: string; preset: 'red' | 'gold' | 'neutral' }> = { urgent: { label: 'Khẩn', preset: 'red' }, high: { label: 'Gấp', preset: 'gold' }, normal: { label: 'Bình thường', preset: 'neutral' }, low: { label: 'Thấp', preset: 'neutral' } };
const STATUS: Record<string, { label: string; preset: 'blue' | 'green' | 'neutral' | 'red' }> = { new: { label: 'Mới giao', preset: 'blue' }, in_progress: { label: 'Đang làm', preset: 'blue' }, done: { label: 'Đã xong', preset: 'green' }, cancelled: { label: 'Đã huỷ', preset: 'neutral' } };
const SOURCE: Record<string, string> = { report_run: 'nhiệm vụ kỳ tới của báo cáo', qlvb: 'văn bản QLVB', meeting: 'kết luận họp' };

/** Giao việc: theo phòng, quá hạn, giao từ "Nhiệm vụ kỳ tới" của báo cáo đã chốt (mỗi dòng nhiệm vụ → một việc có người, có hạn). */
function TasksInner() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const lb = useLabels();
  const sp = useSearchParams();
  const [view, setView] = useState<View>(sp.get('overdue') ? 'overdue' : 'open');
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState(false);
  const [fromReport, setFromReport] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assignee_id: '', due_at: '', priority: 'normal', source_type: '', source_id: '', object_uid: '', target_indicator_id: '', target_value: '' });
  const { data: projects = [] } = useQuery<any[]>({ queryKey: ['objects', 'du_an', ''], queryFn: () => apiGet('/admin/objects?type=du_an&limit=200') });
  const { data: indicatorList = [] } = useQuery<any[]>({ queryKey: ['indicators'], queryFn: () => apiGet('/admin/catalog/indicators') });
  const [lines, setLines] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'success' | 'warning'; text: string } | null>(null);
  const overseer = ['super_admin', 'commune_admin', 'leader'].includes(me.role ?? '');
  const q = view === 'overdue' ? 'overdue=1' : view === 'all' ? '' : `status=${view === 'open' ? 'new' : 'done'}`;
  const { data, isLoading } = useQuery<{ data: Task[]; total: number }>({ queryKey: ['tasks', view], queryFn: () => apiGet(`/admin/tasks?limit=100${q ? '&' + q : ''}`) });
  const { data: inprog } = useQuery<{ data: Task[] }>({ queryKey: ['tasks', 'in_progress'], queryFn: () => apiGet('/admin/tasks?limit=100&status=in_progress'), enabled: view === 'open' });
  const { data: staff = [] } = useQuery<any[]>({ queryKey: ['assignable'], queryFn: () => apiGet('/admin/users/assignable') });
  const { data: runs = [] } = useQuery<any[]>({ queryKey: ['report-runs'], queryFn: () => apiGet('/admin/report-runs') });
  const { data: nar } = useQuery<any>({ queryKey: ['narratives', Number(form.source_id)], queryFn: () => apiGet(`/admin/report-runs/${form.source_id}/narratives`), enabled: fromReport && !!form.source_id });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['me-work'] }); };
  const create = useMutation({ mutationFn: (body: any) => api.post('/admin/tasks', body).then((r) => r.data), onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const status = useMutation({ mutationFn: ({ id, st, note }: { id: number; st: string; note?: string }) => api.patch(`/admin/tasks/${id}/status`, { status: st, result_note: note }).then((r) => r.data), onSuccess: refresh, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const remind = useMutation({ mutationFn: (id: number) => api.post(`/admin/tasks/${id}/remind`).then((r) => r.data), onSuccess: () => setNotice({ tone: 'info', text: 'Đã gửi nhắc việc.' }), onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });

  const rows = useMemo(() => {
    let list = [...(data?.data ?? []), ...(view === 'open' ? (inprog?.data ?? []) : [])];
    if (dept) list = list.filter((t) => t.assignee?.department === dept);
    return list;
  }, [data, inprog, view, dept]);
  const depts = Object.entries(lb.L.departments);
  const nextTasks = useMemo(() => {
    const s = (nar?.slots ?? []).find((x: any) => x.slot_type === 'next_tasks');
    const text: string = s?.accepted?.text ?? s?.latest?.text ?? s?.suggestions?.template ?? '';
    return text.split(/;\s*|\.\s+(?=[A-ZĐ])/).map((x) => x.replace(/\.$/, '').trim()).filter((x) => x.length > 8);
  }, [nar]);

  async function submit() {
    const body: any = { title: form.title.trim(), description: form.description || undefined, assignee_id: Number(form.assignee_id), due_at: form.due_at ? new Date(form.due_at + 'T17:00:00').toISOString() : undefined, priority: form.priority };
    if (fromReport && form.source_id) { body.source_type = 'report_run'; body.source_id = Number(form.source_id); }
    if (form.object_uid) body.object_uid = form.object_uid;
    if (form.target_indicator_id) { body.target_indicator_id = form.target_indicator_id; if (form.target_value) body.target_value = Number(form.target_value.replace(/\./g, '').replace(',', '.')); }
    try {
      if (fromReport && lines.length) { for (const l of lines) await create.mutateAsync({ ...body, title: l }); setNotice({ tone: 'success', text: `Đã giao ${lines.length} việc từ nhiệm vụ kỳ tới.` }); }
      else { await create.mutateAsync(body); setNotice({ tone: 'success', text: 'Đã giao việc.' }); }
      setOpen(false); setLines([]); setForm({ title: '', description: '', assignee_id: '', due_at: '', priority: 'normal', source_type: '', source_id: '', object_uid: '', target_indicator_id: '', target_value: '' }); refresh();
    } catch { /* đã báo lỗi */ }
  }
  const canAssign = ['super_admin', 'commune_admin', 'leader', 'department_staff'].includes(me.role ?? '');

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Việc" title="Giao việc" description="Việc giao trực tiếp, việc sinh từ văn bản QLVB và việc lấy từ mục Nhiệm vụ kỳ tới của báo cáo. Hoàn thành đúng hạn tính vào KPI."
        actions={canAssign ? <><ToolbarButton onClick={() => { setFromReport(true); setOpen(true); const r = runs.find((x) => ['signed', 'submitted', 'drafted', 'locked'].includes(x.status)); if (r) setForm((f) => ({ ...f, source_id: String(r.run_id) })); }}>Giao từ nhiệm vụ kỳ tới</ToolbarButton><ToolbarButton variant="primary" onClick={() => { setFromReport(false); setOpen(true); }}>+ Giao việc</ToolbarButton></> : undefined} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs<View> value={view} onChange={setView} items={[{ value: 'open', label: 'Đang mở' }, { value: 'overdue', label: 'Quá hạn' }, { value: 'done', label: 'Đã xong' }, { value: 'all', label: 'Tất cả' }]} />
        {overseer && <SelectInput value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 w-56"><option value="">Mọi bộ phận</option>{depts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</SelectInput>}
      </div>
      <DataTable isLoading={isLoading} empty={!rows.length ? <EmptyState title="Không có việc nào" description={view === 'overdue' ? 'Không có việc quá hạn.' : 'Giao việc mới hoặc lấy từ nhiệm vụ kỳ tới của báo cáo.'} /> : undefined}>
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Việc</th><th className={TABLE_TH_CLS}>Người làm</th><th className={TABLE_TH_CLS}>Hạn</th><th className={TABLE_TH_CLS}>Trạng thái</th><th className="px-3 py-1.5 text-right">Thao tác</th></tr></thead>
          <tbody className="divide-y divide-rule">
            {rows.map((t) => { const d = dueText(t.due_at); const mine = t.assignee?.id === me.id; return (
              <tr key={t.id} className="row-hover align-top">
                <td className={TABLE_TD_CLS}><p className="font-medium text-ink">{t.title}</p><p className="text-xs2 text-ink-muted">{t.source_type && SOURCE[t.source_type] ? `Từ ${SOURCE[t.source_type]}` : `Giao bởi ${t.assigner?.full_name ?? '—'}`}{PRIORITY[t.priority] && t.priority !== 'normal' ? <Tag preset={PRIORITY[t.priority].preset} className="ml-2">{PRIORITY[t.priority].label}</Tag> : null}</p>{t.result_note && <p className="text-xs2 text-ink-faint">Kết quả: {t.result_note}</p>}</td>
                <td className={TABLE_TD_CLS}>{t.assignee?.full_name ?? '—'}<p className="text-xs2 text-ink-muted">{t.assignee?.department ? lb.dept(t.assignee.department) : ''}</p></td>
                <td className={clsx(TABLE_TD_CLS, 'kpi-num', d.overdue && t.status !== 'done' ? 'font-semibold text-red-700' : '')}>{t.status === 'done' ? (t.due_at ? new Date(t.due_at).toLocaleDateString('vi-VN') : '—') : d.text}</td>
                <td className={TABLE_TD_CLS}><Tag preset={STATUS[t.status]?.preset ?? 'neutral'}>{STATUS[t.status]?.label ?? 'Khác'}</Tag></td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  {t.status === 'new' && mine && <ToolbarButton variant="ghost" onClick={() => status.mutate({ id: t.id, st: 'in_progress' })}>Bắt đầu</ToolbarButton>}
                  {['new', 'in_progress'].includes(t.status) && (mine || overseer) && <ToolbarButton variant="primary" className="ml-1" disabled={status.isPending} onClick={() => { const n = window.prompt('Ghi chú kết quả (tuỳ chọn):') ?? ''; status.mutate({ id: t.id, st: 'done', note: n || undefined }); }}>Xong</ToolbarButton>}
                  {['new', 'in_progress'].includes(t.status) && overseer && !mine && <ToolbarButton variant="ghost" className="ml-1" disabled={remind.isPending} onClick={() => remind.mutate(t.id)}>Nhắc</ToolbarButton>}
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
      </DataTable>

      <Modal open={open} onClose={() => setOpen(false)} title={fromReport ? 'Giao việc từ Nhiệm vụ kỳ tới' : 'Giao việc'} maxWidth="max-w-xl"
        footer={<><ToolbarButton variant="ghost" onClick={() => setOpen(false)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={create.isPending || !form.assignee_id || (fromReport ? !lines.length : !form.title.trim())} onClick={submit}>{fromReport ? `Giao ${lines.length} việc` : 'Giao việc'}</ToolbarButton></>}>
        <div className="space-y-3">
          {fromReport && (
            <>
              <FormField label="Báo cáo"><SelectInput value={form.source_id} onChange={(e) => { setForm({ ...form, source_id: e.target.value }); setLines([]); }}><option value="">— chọn kỳ —</option>{runs.filter((r) => r.status !== 'cancelled').map((r) => <option key={r.run_id} value={r.run_id}>{lb.period(r.period, true)}{r.signed_number ? ` · số ${r.signed_number}` : ''}</option>)}</SelectInput></FormField>
              <FormField label="Nhiệm vụ trong mục III (chọn dòng cần giao)">
                {nextTasks.length === 0 ? <p className="text-sm2 text-ink-muted">Kỳ này chưa có lời dẫn Nhiệm vụ kỳ tới.</p> : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-rule p-2">{nextTasks.map((l) => <li key={l}><label className="flex items-start gap-2 text-sm2 text-ink-2"><input type="checkbox" className="mt-1" checked={lines.includes(l)} onChange={(e) => setLines(e.target.checked ? [...lines, l] : lines.filter((x) => x !== l))} />{l}</label></li>)}</ul>
                )}
              </FormField>
            </>
          )}
          {!fromReport && <FormField label="Việc" required><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="vd: Rà soát hộ nghèo tổ 3 trước 15/10" /></FormField>}
          <FormField label="Người làm" required><SelectInput value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}><option value="">— chọn —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.department ? ` — ${lb.dept(s.department)}` : ''}</option>)}</SelectInput></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Hạn"><TextInput type="date" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} /></FormField>
            <FormField label="Mức ưu tiên"><SelectInput value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</SelectInput></FormField>
          </div>
          {!fromReport && <FormField label="Mô tả"><TextareaInput rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed border-rule p-3">
            <FormField label="Gắn dự án, công trình" hint="Việc hiện trong trang 360 của đối tượng"><SelectInput value={form.object_uid} onChange={(e) => setForm({ ...form, object_uid: e.target.value })}><option value="">— không —</option>{projects.map((o: any) => <option key={o.uid} value={o.uid}>{o.code} · {o.name}</option>)}</SelectInput></FormField>
            <FormField label="Mục tiêu đo được" hint="Chỉ tiêu + giá trị cần đạt; kỳ sau tự so"><div className="flex gap-2"><SelectInput value={form.target_indicator_id} onChange={(e) => setForm({ ...form, target_indicator_id: e.target.value })}><option value="">— không —</option>{indicatorList.map((i: any) => <option key={i.indicator_id} value={i.indicator_id}>{i.name}</option>)}</SelectInput><TextInput className="w-28" placeholder="giá trị" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} /></div></FormField>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function TasksPage() { return <Suspense fallback={null}><TasksInner /></Suspense>; }
