'use client';

import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, FilterTabs, PageHeader, SelectInput, Tag, TechDetails, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
const KPI_SOURCE: Record<string, string> = { task: 'từ việc được giao', qlvb: 'từ văn bản xử lý', do360: 'từ số liệu nộp', indicator: 'từ chỉ tiêu', manual: 'lãnh đạo nhập' };
import { KPI_STATUS, currentAdmin, errMsg, fmtDate, periodOptions } from '@/lib/do360';

type View = 'scores' | 'summary' | 'criteria' | 'employees';

/** D6 — KPI cán bộ: tính điểm đề xuất, giải trình, duyệt, tổng hợp và đẩy số vào kho cho báo cáo KPI. */
function KpiInner() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const sp = useSearchParams();
  const periods = periodOptions();
  const [period, setPeriod] = useState(sp.get('period') || periods[0].code);
  const [view, setView] = useState<View>('scores');
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'warning'; text: string } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const overseer = ['super_admin', 'commune_admin', 'leader'].includes(me.role ?? '');

  const { data: scores = [], isLoading } = useQuery<any[]>({ queryKey: ['kpi-scores', period], queryFn: () => apiGet(`/admin/kpi/scores?period=${period}`) });
  const { data: summary } = useQuery<any>({ queryKey: ['kpi-summary', period], queryFn: () => apiGet(`/admin/kpi/summary?period=${period}`), enabled: overseer });
  const { data: criteria = [] } = useQuery<any[]>({ queryKey: ['kpi-criteria'], queryFn: () => apiGet('/admin/kpi/criteria') });
  const { data: employees = [] } = useQuery<any[]>({ queryKey: ['kpi-employees'], queryFn: () => apiGet('/admin/kpi/employees') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['kpi-scores'] }); qc.invalidateQueries({ queryKey: ['kpi-summary'] }); qc.invalidateQueries({ queryKey: ['kpi-employees'] }); };
  const onErr = (e: any) => setNotice({ tone: 'danger', text: errMsg(e) });

  const syncEmp = useMutation({ mutationFn: () => api.post('/admin/kpi/employees/sync-from-accounts').then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Đồng bộ cán bộ: thêm ${r.created}, cập nhật ${r.updated}.` }); refresh(); }, onError: onErr });
  const compute = useMutation({ mutationFn: () => api.post('/admin/kpi/compute', { period }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Đã tính ${r.written} điểm đề xuất cho ${r.employees} cán bộ (giữ ${r.kept_approved} đã duyệt, ${r.no_data} thiếu dữ liệu).` }); refresh(); }, onError: onErr });
  const approve = useMutation({ mutationFn: (ids: number[]) => api.post('/admin/kpi/scores/approve', { ids }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Đã duyệt ${r.approved} điểm.` }); setSelected([]); refresh(); }, onError: onErr });
  const explain = useMutation({ mutationFn: ({ id, explanation }: { id: number; explanation: string }) => api.post(`/admin/kpi/scores/${id}/explain`, { explanation }).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'info', text: 'Đã ghi giải trình.' }); refresh(); }, onError: onErr });
  const publish = useMutation({ mutationFn: () => api.post('/admin/kpi/publish', { period }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Đã đẩy ${r.length} số KPI vào kho (trạng thái extracted — xác nhận và duyệt ở Số liệu kỳ).` }); }, onError: onErr });
  const reload = useMutation({ mutationFn: () => api.post('/admin/kpi/reload').then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Đã nạp ${r.criteria} tiêu chí từ config/kpi.` }); qc.invalidateQueries({ queryKey: ['kpi-criteria'] }); }, onError: onErr });

  const pending = scores.filter((s) => s.status !== 'approved').map((s) => s.id);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Cán bộ" title="KPI cán bộ, công chức" description="Hệ thống chỉ tính điểm đề xuất từ việc, văn bản, số liệu; cán bộ giải trình, lãnh đạo duyệt mới chốt. Mỗi điểm truy được về bằng chứng; mọi lượt xem đều ghi nhật ký."
        actions={<div className="flex flex-wrap items-center gap-2">
          <SelectInput value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</SelectInput>
          {overseer && <ToolbarButton onClick={() => syncEmp.mutate()} disabled={syncEmp.isPending}>Đồng bộ cán bộ từ tài khoản</ToolbarButton>}
          {overseer && <ToolbarButton variant="primary" onClick={() => compute.mutate()} disabled={compute.isPending}>{compute.isPending ? 'Đang tính…' : 'Tính điểm đề xuất'}</ToolbarButton>}
          {overseer && <ToolbarButton onClick={() => publish.mutate()} disabled={publish.isPending || !summary?.totals?.so_can_bo_danh_gia} title="Đẩy 3 số tổng hợp vào kho chỉ tiêu cho báo cáo KPI">Đẩy số vào kho</ToolbarButton>}
        </div>} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <FilterTabs<View> value={view} onChange={setView} items={[{ value: 'scores', label: 'Điểm theo tiêu chí', count: scores.length }, { value: 'summary', label: 'Tổng hợp' }, { value: 'criteria', label: 'Tiêu chí (cấu hình)', count: criteria.length }, { value: 'employees', label: 'Cán bộ', count: employees.length }]} />

      {view === 'scores' && (
        <DataTable isLoading={isLoading}>
          {overseer && pending.length > 0 && <div className="flex items-center gap-2 border-b border-rule px-4 py-2 text-xs text-ink-3"><span>{selected.length} điểm đã chọn</span><ToolbarButton variant="primary" disabled={!selected.length || approve.isPending} onClick={() => approve.mutate(selected)}>Duyệt đã chọn</ToolbarButton><ToolbarButton variant="ghost" onClick={() => setSelected(pending)}>Chọn tất cả chưa duyệt</ToolbarButton></div>}
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD_CLS}><tr>{overseer && <th className="px-3 py-1.5"></th>}<th className={TABLE_TH_CLS}>Cán bộ</th><th className={TABLE_TH_CLS}>Phòng</th><th className={TABLE_TH_CLS}>Tiêu chí</th><th className="px-3 py-1.5 text-right">Giá trị</th><th className="px-3 py-1.5 text-right">Điểm / trọng số</th><th className={TABLE_TH_CLS}>Bằng chứng</th><th className={TABLE_TH_CLS}>Trạng thái</th><th className="px-3 py-1.5 text-right"></th></tr></thead>
            <tbody className="divide-y divide-rule">
              {scores.map((s) => { const inp = s.evidence_ref?.inputs ?? {}; return (
                <tr key={s.id} className="row-hover">
                  {overseer && <td className="px-3 py-1.5"><input type="checkbox" disabled={s.status === 'approved'} checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} /></td>}
                  <td className={`${TABLE_TD_CLS} font-medium text-ink`}>{s.employee_name}</td><td className={`${TABLE_TD_CLS} text-ink-muted`}>{s.dept ?? '—'}</td>
                  <td className={TABLE_TD_CLS}>{s.criterion_name}<p className="text-xs2 text-ink-muted">{KPI_SOURCE[s.source] ?? s.source}</p><TechDetails inline label="mã">{s.criterion_id}</TechDetails></td>
                  <td className={`${TABLE_TD_CLS} kpi-num text-right`}>{s.value != null ? `${Number(s.value).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ${s.unit}` : <span className="text-ink-faint">thiếu dữ liệu</span>}</td>
                  <td className={`${TABLE_TD_CLS} kpi-num text-right`}>{s.score != null ? `${Number(s.score).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} / ${s.weight}` : '—'}</td>
                  <td className={`${TABLE_TD_CLS} text-xs text-ink-muted`}>{inp.task_total != null ? `việc ${inp.task_on_time}/${inp.task_total} đúng hạn · VB ${inp.vb_on_time}/${inp.vb_total} · số ${inp.so_dat}/${inp.so_nop}` : s.evidence_ref?.note ?? '—'}{s.explanation && <p className="italic text-amber-700">Giải trình: {s.explanation}</p>}</td>
                  <td className={TABLE_TD_CLS}><Tag preset={KPI_STATUS[s.status]?.preset ?? 'neutral'}>{KPI_STATUS[s.status]?.label ?? s.status}</Tag>{s.approved_at && <p className="text-xs text-ink-faint">{fmtDate(s.approved_at)}</p>}</td>
                  <td className="px-3 py-1.5 text-right">{s.status !== 'approved' && <button className="text-xs text-primary-600 hover:underline" onClick={() => { const t = window.prompt('Giải trình cho điểm này:'); if (t) explain.mutate({ id: s.id, explanation: t }); }}>Giải trình</button>}</td>
                </tr>); })}
              {!scores.length && !isLoading && <tr><td className={`${TABLE_TD_CLS} text-ink-faint`} colSpan={9}>Chưa có điểm kỳ này. {overseer ? 'Bấm "Tính điểm đề xuất".' : 'Chờ Văn phòng tính điểm.'}</td></tr>}
            </tbody>
          </table>
        </DataTable>
      )}

      {view === 'summary' && (overseer ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card px-5 py-4 text-sm">
            <p className="text-xs2 font-medium text-ink-faint">Số tổng hợp cho báo cáo KPI</p>
            <p className="mt-2">Cán bộ được đánh giá: <b className="kpi-num">{summary?.totals?.so_can_bo_danh_gia ?? 0}</b></p>
            <p>Điểm trung bình: <b className="kpi-num">{summary?.totals?.diem_trung_binh ?? '—'}</b> / 100</p>
            <p>Việc đúng hạn toàn đơn vị: <b className="kpi-num">{summary?.totals?.ty_le_viec_dung_han ?? '—'}%</b></p>
            <p className="mt-2 text-xs text-ink-muted">{summary?.totals?.approved_all ? 'Mọi điểm đã duyệt — có thể đẩy vào kho.' : 'Còn điểm chưa duyệt; số đẩy vào kho sẽ ghi chú approved_all=false.'}</p>
          </div>
          <div className="lg:col-span-2"><DataTable>
            <table className="w-full text-sm"><thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Cán bộ</th><th className={TABLE_TH_CLS}>Phòng</th><th className="px-3 py-1.5 text-right">Tiêu chí</th><th className="px-3 py-1.5 text-right">Đã duyệt</th><th className="px-3 py-1.5 text-right">Điểm</th><th className="px-3 py-1.5 text-right">%</th></tr></thead>
              <tbody className="divide-y divide-rule">{(summary?.employees ?? []).map((e: any) => <tr key={e.employee_id}><td className={`${TABLE_TD_CLS} font-medium`}>{e.name}</td><td className={`${TABLE_TD_CLS} text-ink-muted`}>{e.dept ?? '—'}</td><td className={`${TABLE_TD_CLS} kpi-num text-right`}>{e.n}</td><td className={`${TABLE_TD_CLS} kpi-num text-right`}>{e.n_approved}</td><td className={`${TABLE_TD_CLS} kpi-num text-right`}>{e.total != null ? Number(e.total).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '—'}{e.max_total ? ` / ${e.max_total}` : ''}</td><td className={`${TABLE_TD_CLS} kpi-num text-right font-semibold`}>{e.pct ?? '—'}</td></tr>)}</tbody></table>
          </DataTable></div>
        </div>
      ) : <EmptyState title="Chỉ lãnh đạo/Văn phòng xem tổng hợp" />)}

      {view === 'criteria' && (
        <DataTable>
          <div className="flex items-center justify-between border-b border-rule px-4 py-2 text-xs text-ink-muted"><span>Nguồn: config/kpi/*.yaml — đổi công thức/trọng số không sửa code.</span>{me.role === 'super_admin' && <ToolbarButton variant="ghost" onClick={() => reload.mutate()}>Nạp lại</ToolbarButton>}</div>
          <table className="w-full text-sm"><thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Mã</th><th className={TABLE_TH_CLS}>Tên</th><th className={TABLE_TH_CLS}>Nguồn</th><th className={TABLE_TH_CLS}>Công thức</th><th className="px-3 py-1.5 text-right">Trọng số</th><th className={TABLE_TH_CLS}>Căn cứ</th></tr></thead>
            <tbody className="divide-y divide-rule">{criteria.map((c) => <tr key={c.criterion_id} className={c.is_active ? '' : 'opacity-50'}>{/* tech-ok: tab cấu hình */}<td className={`${TABLE_TD_CLS} font-mono text-xs`}>{c.criterion_id}</td><td className={TABLE_TD_CLS}>{c.name}<p className="text-xs text-ink-faint">{c.description}</p></td><td className={TABLE_TD_CLS}>{c.source}</td><td className={`${TABLE_TD_CLS} font-mono text-xs`}>{c.formula}</td><td className={`${TABLE_TD_CLS} kpi-num text-right`}>{Number(c.weight)}</td><td className={`${TABLE_TD_CLS} text-xs text-ink-muted`}>{c.regulation_ref ?? '—'}</td></tr>)}</tbody></table>
        </DataTable>
      )}

      {view === 'employees' && (
        <DataTable>
          <table className="w-full text-sm"><thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Mã (email công vụ)</th><th className={TABLE_TH_CLS}>Họ tên</th><th className={TABLE_TH_CLS}>Phòng</th><th className={TABLE_TH_CLS}>Chức danh</th><th className={TABLE_TH_CLS}>Tài khoản</th><th className={TABLE_TH_CLS}>Trạng thái</th></tr></thead>
            <tbody className="divide-y divide-rule">{employees.map((e) => <tr key={e.employee_id}>{/* tech-ok: mã cán bộ = email công vụ */}<td className={`${TABLE_TD_CLS} font-mono text-xs`}>{e.employee_code}</td><td className={`${TABLE_TD_CLS} font-medium`}>{e.name}</td><td className={TABLE_TD_CLS}>{e.dept ?? '—'}</td><td className={TABLE_TD_CLS}>{e.position ?? '—'}</td><td className={`${TABLE_TD_CLS} text-xs2 text-ink-muted`}>{e.admin_user_id ? 'có' : 'không'}</td><td className={TABLE_TD_CLS}>{e.status}</td></tr>)}
              {!employees.length && <tr><td className={`${TABLE_TD_CLS} text-ink-faint`} colSpan={6}>Chưa có cán bộ — bấm "Đồng bộ cán bộ từ tài khoản" hoặc nhập qua API.</td></tr>}</tbody></table>
        </DataTable>
      )}
    </div>
  );
}

export default function KpiPage() { return <Suspense><KpiInner /></Suspense>; }
