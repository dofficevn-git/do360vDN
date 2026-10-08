'use client';

import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, FormField, PageHeader, SelectInput, Tag, TechDetails, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
const CHANNEL_LABEL: Record<string, string> = { web: 'nộp trên web', zalo: 'gửi qua Zalo', miniapp: 'gửi từ Mini App', api: 'kết nối tự động' };
import { FILE_STATUS, errMsg, fmtDate, periodOptions } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

type SourceFile = { id: number; original_name: string; size: number; period: string | null; department: string | null; status: string; file_kind: string | null; source_type: string | null; extracted_count: number; error: string | null; pii_warning?: string | null; created_at: string; channel: string };

/** Nộp file gốc của bộ phận (Excel/Word/PDF/ảnh) → bóc tách thành số chờ xác nhận. */
function FilesPageInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const periods = periodOptions();
  const lb = useLabels();
  const [period, setPeriod] = useState(params.get('period') || periods[0].code);
  const [file, setFile] = useState<File | null>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger'; text: string } | null>(null);

  const { data: files = [], isLoading } = useQuery<SourceFile[]>({ queryKey: ['files', period], queryFn: () => apiGet(`/admin/files?period=${period}`) });

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData(); fd.append('file', file!); fd.append('period', period); if (asOf) fd.append('as_of_date', asOf);
      return (await api.post('/admin/files', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: (r) => { setNotice(r.duplicate ? { tone: 'warning', text: `File này đã nộp trước đó (#${r.file.id}) — không lưu lần hai.` } : { tone: 'info', text: `Đã nhận ${r.file.original_name}. Bấm "Bóc tách" để đọc số.` }); setFile(null); qc.invalidateQueries({ queryKey: ['files'] }); },
    onError: (e) => setNotice({ tone: 'danger', text: errMsg(e, 'Không nộp được file') }),
  });
  const extract = useMutation({
    mutationFn: (id: number) => api.post(`/admin/files/${id}/extract`).then((r) => r.data),
    onSuccess: (r) => {
      if (r.status === 'no_rule') setNotice({ tone: 'warning', text: r.message + (r.tried?.length ? ` (đã thử: ${r.tried.map((t: any) => t.source_type).join(', ')})` : '') });
      else {
        const q = r.records.filter((x: any) => x.status === 'quarantined').length;
        setNotice({ tone: 'info', text: `Khớp luật ${r.matched_rule}: ${r.records.length} số chờ xác nhận${q ? `, ${q} số bị cách ly` : ''}${r.misses?.length ? `; không thấy: ${r.misses.join(', ')}` : ''}.` });
      }
      qc.invalidateQueries({ queryKey: ['files'] }); qc.invalidateQueries({ queryKey: ['facts'] });
    },
    onError: (e) => { setNotice({ tone: 'danger', text: errMsg(e, 'Bóc tách thất bại') }); qc.invalidateQueries({ queryKey: ['files'] }); },
  });

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Số liệu" title="Nộp file" description="Thang thu thập: file xuất từ hệ thống → PDF có lớp chữ → ảnh chụp (OCR) → nhập tay. Nộp file xuất được thì không chụp màn hình." />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <div className="card p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <FormField label="Kỳ báo cáo">
            <SelectInput value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</SelectInput>
          </FormField>
          <FormField label="Ngày chốt số liệu trong file" hint="Số bóc từ file mang ngày này; lệch ngày chốt kỳ sẽ phải ghi lý do.">
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-10 w-full rounded-lg border border-rule-strong bg-white px-3 text-sm2 text-ink" />
          </FormField>
          <FormField label="File (Excel, Word, PDF, CSV, ảnh — tối đa 30 MB)">
            <input type="file" accept=".xlsx,.xls,.docx,.doc,.pdf,.csv,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium" />
          </FormField>
          <div className="flex items-end"><ToolbarButton variant="primary" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? 'Đang nộp…' : 'Nộp file'}</ToolbarButton></div>
        </div>
      </div>
      <DataTable isLoading={isLoading} empty={!files.length ? <EmptyState title="Chưa có file trong kỳ này" description="Nộp file xuất từ hệ thống nghiệp vụ hoặc báo cáo của bộ phận." /> : undefined}>
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>File</th><th className={TABLE_TH_CLS}>Bộ phận</th><th className={TABLE_TH_CLS}>Nhận lúc</th><th className={TABLE_TH_CLS}>Trạng thái</th><th className={TABLE_TH_CLS}>Luật / kết quả</th><th className="px-3 py-1.5 text-right">Thao tác</th></tr></thead>
          <tbody className="divide-y divide-rule">
            {files.map((f) => (
              <tr key={f.id} className="row-hover">
                <td className={`${TABLE_TD_CLS} font-medium text-ink`}><a className="hover:underline" href={`${process.env.NEXT_PUBLIC_API_URL}/admin/files/${f.id}/download`} target="_blank" rel="noreferrer">{f.original_name}</a><span className="ml-2 text-xs2 text-ink-muted">{(f.size / 1024).toFixed(0)} KB · {CHANNEL_LABEL[f.channel] ?? f.channel}</span></td>
                <td className={TABLE_TD_CLS}>{lb.dept(f.department)}</td>
                <td className={`${TABLE_TD_CLS} kpi-num`}>{fmtDate(f.created_at)}</td>
                <td className={TABLE_TD_CLS}><Tag preset={FILE_STATUS[f.status]?.preset ?? 'neutral'}>{FILE_STATUS[f.status]?.label ?? f.status}</Tag>{f.pii_warning && <p className="mt-1 text-xs text-red-700" title={f.pii_warning}>⚠ Có dữ liệu cá nhân</p>}</td>
                <td className={`${TABLE_TD_CLS} text-ink-3`}>{f.status === 'extracted' ? <>Nhận ra biểu mẫu · <Link href={`/facts?period=${f.period}`} className="text-primary-600 hover:underline">{f.extracted_count} số chờ xác nhận</Link><TechDetails inline label="luật">{f.source_type}</TechDetails></> : f.error ? <span className="text-xs2 text-amber-700">{f.error}</span> : '—'}</td>
                <td className="px-3 py-1.5 text-right"><ToolbarButton variant={f.status === 'extracted' ? 'ghost' : 'primary'} disabled={extract.isPending} onClick={() => extract.mutate(f.id)}>{f.status === 'extracted' ? 'Bóc lại' : 'Bóc tách'}</ToolbarButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}

/** Next 14: useSearchParams() cần nằm trong Suspense khi prerender. */
export default function FilesPage() {
  return <Suspense fallback={null}><FilesPageInner /></Suspense>;
}
