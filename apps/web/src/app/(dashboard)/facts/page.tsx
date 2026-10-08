'use client';

import { Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, FilterTabs, FormField, Modal, PageHeader, SelectInput, Tag, TechDetails, TextInput, TextareaInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { CAPTURE_LABEL, CurrentFact, FACT_STATUS, currentAdmin, errMsg, fmtDate, fmtNum, periodOptions } from '@/lib/do360';
import { FACT_STATUS_HINT, useLabels } from '@/lib/labels';

type View = '' | 'pending' | 'quarantine';
type Indicator = { indicator_id: string; name: string; unit: string; value_type: string; domain: string; owner_dept: string | null };

/**
 * Màn xác nhận số của một kỳ: mỗi dòng là số hiện hành của một chỉ tiêu, cạnh nguồn (file, ô/trang).
 * Chuyên viên: xác nhận / sửa (thêm phiên bản) / loại. Data Owner: duyệt. Văn phòng: nhập tay số còn thiếu.
 */
function FactsPageInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const periods = periodOptions();
  const me = currentAdmin();
  const lb = useLabels();
  const [period, setPeriod] = useState(params.get('period') || periods[0].code);
  const [view, setView] = useState<View>((params.get('view') as View) || '');
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<CurrentFact | null>(null);
  const [form, setForm] = useState({ value: '', reason: '' });
  const [manual, setManual] = useState(false);
  const [mform, setMform] = useState({ indicator_id: '', value: '', as_of_date: new Date().toISOString().slice(0, 10) });
  const [selected, setSelected] = useState<string[]>([]);

  const { data: facts = [], isLoading } = useQuery<CurrentFact[]>({ queryKey: ['facts', period], queryFn: () => apiGet(`/admin/facts?period=${period}`) });
  const { data: quarantine = [] } = useQuery<any[]>({ queryKey: ['quarantine'], queryFn: () => apiGet('/admin/facts/quarantine') });
  const { data: indicators = [] } = useQuery<Indicator[]>({ queryKey: ['indicators'], queryFn: () => apiGet('/admin/catalog/indicators') });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['facts'] }); qc.invalidateQueries({ queryKey: ['quarantine'] }); qc.invalidateQueries({ queryKey: ['report-run'] }); };

  const confirm = useMutation({ mutationFn: (id: string) => api.post(`/admin/facts/${id}/confirm`).then((r) => r.data),
    onSuccess: (r) => { setNotice(r.status === 'quarantined' ? `Không qua kiểm tra số học — đã cách ly: ${r.note}` : 'Đã xác nhận.'); invalidate(); }, onError: (e) => setNotice(errMsg(e)) });
  const correct = useMutation({ mutationFn: () => api.post(`/admin/facts/${editing!.id}/correct`, { value: Number(form.value.replace(/\./g, '').replace(',', '.')), reason: form.reason }).then((r) => r.data),
    onSuccess: (r) => { setNotice(`Đã sửa — phiên bản ${r.version}, bản cũ giữ lại trong lịch sử.`); setEditing(null); invalidate(); }, onError: (e) => setNotice(errMsg(e)) });
  const approve = useMutation({ mutationFn: (ids: string[]) => api.post('/admin/facts/approve', { ids }).then((r) => r.data),
    onSuccess: (r) => { setNotice(`Đã duyệt ${r.approved} số.`); setSelected([]); invalidate(); }, onError: (e) => setNotice(errMsg(e)) });
  const reject = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/facts/${id}/reject`, { reason }).then((r) => r.data),
    onSuccess: () => { setNotice('Đã loại.'); invalidate(); }, onError: (e) => setNotice(errMsg(e)) });
  const resolve = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/facts/${id}/resolve`, { decision: 'accept', reason }).then((r) => r.data),
    onSuccess: () => { setNotice('Người đại diện phòng đã chấp nhận số cách ly làm số hiện hành; số cũ vào lịch sử.'); invalidate(); }, onError: (e: any) => setNotice(e?.response?.data?.message?.message ?? errMsg(e)) });
  const ingest = useMutation({ mutationFn: () => api.post('/admin/facts/ingest', { records: [{ indicator_id: mform.indicator_id, period, as_of_date: mform.as_of_date, value: Number(mform.value.replace(/\./g, '').replace(',', '.')), capture_method: 'form', source_ref: { system: 'form' } }] }).then((r) => r.data),
    onSuccess: (r) => { setNotice(r[0]?.status === 'quarantined' ? `Số vào vùng cách ly: ${r[0].note}` : r[0]?.note ?? 'Đã ghi nhận, chờ xác nhận.'); setManual(false); invalidate(); }, onError: (e) => setNotice(errMsg(e)) });

  const rows = useMemo(() => view === 'quarantine' ? quarantine.map((q) => ({ ...q, value: Number(q.value), name: indicators.find((i) => i.indicator_id === q.indicator_id)?.name ?? q.indicator_id, unit: '', value_type: 'integer' })) : view === 'pending' ? facts.filter((f) => f.status === 'extracted' || f.status === 'confirmed') : facts, [view, facts, quarantine, indicators]);
  const canApprove = ['super_admin', 'commune_admin', 'leader', 'department_staff'].includes(me.role ?? '');
  const confirmable = (f: CurrentFact) => f.status === 'extracted';

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Số liệu" title="Số liệu kỳ" description="Số bóc được đặt cạnh nguồn. Xác nhận → duyệt → Văn phòng chốt kỳ. Sửa số là thêm phiên bản, không ghi đè."
        actions={<div className="flex items-center gap-2">
          <SelectInput value={period} onChange={(e) => { setPeriod(e.target.value); setSelected([]); }}>{periods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</SelectInput>
          <ToolbarButton onClick={() => setManual(true)}>+ Nhập tay</ToolbarButton>
          {canApprove && <ToolbarButton variant="primary" disabled={!selected.length || approve.isPending} onClick={() => approve.mutate(selected)}>Duyệt {selected.length ? `(${selected.length})` : ''}</ToolbarButton>}
        </div>} />
      {notice && <Callout tone={/cách ly|Không|lỗi|không/i.test(notice) ? 'warning' : 'info'}>{notice}</Callout>}
      <FilterTabs<View> value={view} onChange={setView} items={[{ value: '', label: 'Tất cả', count: facts.length }, { value: 'pending', label: 'Chờ xác nhận / duyệt', count: facts.filter((f) => ['extracted', 'confirmed'].includes(f.status)).length }, { value: 'quarantine', label: 'Cách ly', count: quarantine.length }]} />
      <DataTable isLoading={isLoading} empty={!rows.length ? <EmptyState title="Chưa có số" description="Nộp file ở mục Nộp file hoặc Nhập tay." /> : undefined}>
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD_CLS}><tr>
            {canApprove && view !== 'quarantine' && <th className="px-3 py-1.5"><input type="checkbox" onChange={(e) => setSelected(e.target.checked ? rows.filter((r: any) => r.status === 'confirmed').map((r: any) => r.id) : [])} /></th>}
            <th className={TABLE_TH_CLS}>Chỉ tiêu</th><th className="px-3 py-1.5 text-right">Giá trị</th><th className={TABLE_TH_CLS}>Ngày chốt</th><th className={TABLE_TH_CLS}>Nguồn</th><th className={TABLE_TH_CLS}>Trạng thái</th><th className="px-3 py-1.5 text-right">Thao tác</th>
          </tr></thead>
          <tbody className="divide-y divide-rule">
            {rows.map((f: any) => (
              <tr key={f.id} className="row-hover align-top">
                {canApprove && view !== 'quarantine' && <td className="px-3 py-1.5">{f.status === 'confirmed' && <input type="checkbox" checked={selected.includes(f.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, f.id] : selected.filter((x) => x !== f.id))} />}</td>}
                <td className={TABLE_TD_CLS}><p className="font-medium text-ink">{f.name}</p><p className="text-xs2 text-ink-muted">{f.owner_dept ? lb.dept(f.owner_dept) : ''}{f.version > 1 ? ` · phiên bản ${f.version}` : ''}</p><TechDetails inline label="mã">{f.indicator_id} · mã số liệu {f.id}</TechDetails>{f.note && <p className="text-xs text-amber-700">{f.note}</p>}</td>
                <td className={`${TABLE_TD_CLS} kpi-num text-right font-semibold text-ink`}>{fmtNum(Number(f.value), f.value_type)} <span className="text-xs font-normal text-ink-faint">{f.unit}</span></td>
                <td className={`${TABLE_TD_CLS} kpi-num`}>{fmtDate(f.as_of_date)}</td>
                <td className={`${TABLE_TD_CLS} text-xs text-ink-muted`}>
                  <span className="font-medium text-ink-2">{CAPTURE_LABEL[f.capture_method] ?? f.capture_method}</span>{Number(f.confidence) < 1 ? ` · tin cậy ${Math.round(Number(f.confidence) * 100)}%` : ''}
                  {f.source_ref?.file_id && <> · <a className="text-primary-600 hover:underline" href={`${process.env.NEXT_PUBLIC_API_URL}/admin/files/${f.source_ref.file_id}/download`} target="_blank" rel="noreferrer">file #{f.source_ref.file_id}</a></>}
                  {f.source_ref?.sheet && ` · ${f.source_ref.sheet}!${f.source_ref.cell}`}{f.source_ref?.page && ` · trang ${f.source_ref.page}`}
                  {f.source_ref?.snippet && <p className="mt-0.5 italic text-ink-faint">“{String(f.source_ref.snippet).slice(0, 80)}”</p>}
                </td>
                <td className={TABLE_TD_CLS}><span title={FACT_STATUS_HINT[f.status]}><Tag preset={FACT_STATUS[f.status as keyof typeof FACT_STATUS]?.preset ?? 'neutral'}>{FACT_STATUS[f.status as keyof typeof FACT_STATUS]?.label ?? f.status}</Tag></span></td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {confirmable(f) && <ToolbarButton variant="primary" className="mr-1" disabled={confirm.isPending} onClick={() => confirm.mutate(f.id)}>Xác nhận</ToolbarButton>}
                  {f.status !== 'locked' && f.status !== 'rejected' && <ToolbarButton variant="ghost" className="mr-1" onClick={() => { setEditing(f); setForm({ value: String(f.value), reason: '' }); }}>Sửa</ToolbarButton>}
                  {f.status === 'quarantined' && canApprove && <ToolbarButton variant="ghost" className="mr-1" disabled={resolve.isPending} onClick={() => { const reason = window.prompt('Chấp nhận số cách ly này làm số hiện hành? Lý do (ghi nhật ký):'); if (reason) resolve.mutate({ id: f.id, reason }); }}>Chấp nhận</ToolbarButton>}
                  {['extracted', 'confirmed', 'quarantined'].includes(f.status) && <ToolbarButton variant="ghost" onClick={() => { const reason = window.prompt('Lý do loại số này?'); if (reason) reject.mutate({ id: f.id, reason }); }}>Loại</ToolbarButton>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Sửa số: ${editing?.name ?? ''}`}
        footer={<><ToolbarButton variant="ghost" onClick={() => setEditing(null)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={correct.isPending || !form.value} onClick={() => correct.mutate()}>Lưu phiên bản mới</ToolbarButton></>}>
        <div className="space-y-3">
          <Callout tone="info">Giá trị cũ {editing ? fmtNum(Number(editing.value), editing.value_type) : ''} được giữ nguyên trong lịch sử; số mới là phiên bản {editing ? editing.version + 1 : ''} do bạn xác nhận.</Callout>
          <FormField label="Giá trị mới"><TextInput value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></FormField>
          <FormField label="Lý do"><TextareaInput rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="vd: Bóc nhầm chữ số; đối chiếu lại file export" /></FormField>
        </div>
      </Modal>

      <Modal open={manual} onClose={() => setManual(false)} title={`Nhập tay số ${lb.period(period)}`}
        footer={<><ToolbarButton variant="ghost" onClick={() => setManual(false)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={ingest.isPending || !mform.indicator_id || !mform.value} onClick={() => ingest.mutate()}>Ghi nhận</ToolbarButton></>}>
        <div className="space-y-3">
          <Callout tone="warning">Nhập tay là bậc thu thập thấp nhất. Nếu hệ thống nguồn xuất được file thì nộp file thay vì nhập.</Callout>
          <FormField label="Chỉ tiêu"><SelectInput value={mform.indicator_id} onChange={(e) => setMform({ ...mform, indicator_id: e.target.value })}><option value="">— chọn —</option>{indicators.filter((i) => !me.department || me.role !== 'department_staff' || i.owner_dept === me.department).map((i) => <option key={i.indicator_id} value={i.indicator_id}>{i.name} ({i.unit})</option>)}</SelectInput></FormField>
          <div className="grid grid-cols-2 gap-3"><FormField label="Giá trị"><TextInput value={mform.value} onChange={(e) => setMform({ ...mform, value: e.target.value })} /></FormField><FormField label="Ngày chốt"><TextInput type="date" value={mform.as_of_date} onChange={(e) => setMform({ ...mform, as_of_date: e.target.value })} /></FormField></div>
        </div>
      </Modal>
    </div>
  );
}

/** Next 14: useSearchParams() cần nằm trong Suspense khi prerender. */
export default function FactsPage() {
  return <Suspense fallback={null}><FactsPageInner /></Suspense>;
}
