'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, FormField, Modal, PageHeader, SelectInput, Tag, TextInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { RUN_STATUS, currentAdmin, errMsg, fmtDate, periodOptions } from '@/lib/do360';
import { periodLabel } from '@/lib/labels';

type Run = { run_id: number; period: string; status: string; cutoff_date: string; spec_id: number; locked_at: string | null; output_file: string | null; created_at: string };
type Spec = { id: number; spec_code: string; version: number; title: string; period_types: string[] };

export default function ReportRunsPage() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const periods = periodOptions();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ spec_id: '', period: periods[0].code, cutoff_date: new Date().toISOString().slice(0, 10) });
  const [notice, setNotice] = useState<string | null>(null);
  const { data: runs = [], isLoading } = useQuery<Run[]>({ queryKey: ['report-runs'], queryFn: () => apiGet('/admin/report-runs') });
  const { data: specs = [] } = useQuery<Spec[]>({ queryKey: ['specs'], queryFn: () => apiGet('/admin/catalog/report-specs') });
  const create = useMutation({ mutationFn: () => api.post('/admin/report-runs', { spec_id: Number(form.spec_id || specs[0]?.id), period: form.period, cutoff_date: form.cutoff_date }).then((r) => r.data),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['report-runs'] }); }, onError: (e) => setNotice(errMsg(e)) });
  const canManage = ['super_admin', 'commune_admin'].includes(me.role ?? '');

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Số liệu" title="Kỳ báo cáo" description="Mỗi kỳ đi qua năm bước: thu số, kiểm tra chất lượng, chốt kỳ, bản nháp Word, trình ký."
        actions={canManage ? <ToolbarButton variant="primary" onClick={() => setOpen(true)}>+ Mở kỳ</ToolbarButton> : undefined} />
      {notice && <Callout tone="danger">{notice}</Callout>}
      <DataTable isLoading={isLoading} empty={!runs.length ? <EmptyState title="Chưa có kỳ báo cáo" description="Văn phòng mở kỳ để bắt đầu thu số." /> : undefined}>
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Kỳ</th><th className={TABLE_TH_CLS}>Mẫu</th><th className={TABLE_TH_CLS}>Ngày chốt</th><th className={TABLE_TH_CLS}>Trạng thái</th><th className={TABLE_TH_CLS}>Chốt lúc</th><th className="px-3 py-1.5 text-right">Thao tác</th></tr></thead>
          <tbody className="divide-y divide-rule">
            {runs.map((r) => { const s = specs.find((x) => x.id === r.spec_id); return (
              <tr key={r.run_id} className="row-hover">
                <td className={`${TABLE_TD_CLS} font-semibold text-ink`}><Link href={`/report-runs/${r.run_id}`} className="hover:underline">{periodLabel(r.period, true)}</Link></td>
                <td className={TABLE_TD_CLS}>{s ? s.title : '—'}</td>
                <td className={`${TABLE_TD_CLS} kpi-num`}>{fmtDate(r.cutoff_date)}</td>
                <td className={TABLE_TD_CLS}><Tag preset={RUN_STATUS[r.status]?.preset ?? 'neutral'}>{RUN_STATUS[r.status]?.label ?? r.status}</Tag></td>
                <td className={`${TABLE_TD_CLS} kpi-num`}>{r.locked_at ? fmtDate(r.locked_at) : '—'}</td>
                <td className="px-3 py-1.5 text-right"><Link href={`/report-runs/${r.run_id}`} className="text-sm font-medium text-primary-600 hover:underline">Mở</Link>{r.output_file && <a className="ml-3 text-sm font-medium text-primary-600 hover:underline" href={`${process.env.NEXT_PUBLIC_API_URL}/admin/report-runs/${r.run_id}/download`}>Tải .docx</a>}</td>
              </tr>); })}
          </tbody>
        </table>
      </DataTable>
      <Modal open={open} onClose={() => setOpen(false)} title="Mở kỳ báo cáo" footer={<><ToolbarButton variant="ghost" onClick={() => setOpen(false)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>Mở kỳ</ToolbarButton></>}>
        <div className="space-y-3">
          <FormField label="Mẫu báo cáo"><SelectInput value={form.spec_id || String(specs[0]?.id ?? '')} onChange={(e) => setForm({ ...form, spec_id: e.target.value })}>{specs.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</SelectInput></FormField>
          <FormField label="Kỳ"><SelectInput value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>{periods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</SelectInput></FormField>
          <FormField label="Ngày chốt số liệu chung" hint="Mọi chỉ tiêu dùng mốc này; chỉ tiêu chốt ngày khác phải ghi lý do ngoại lệ."><TextInput type="date" value={form.cutoff_date} onChange={(e) => setForm({ ...form, cutoff_date: e.target.value })} /></FormField>
        </div>
      </Modal>
    </div>
  );
}
