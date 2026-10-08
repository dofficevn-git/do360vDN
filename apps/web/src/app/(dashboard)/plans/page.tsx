'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, PageHeader, SelectInput, TechDetails, TextInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg, fmtNum } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

type Row = { indicator_id: string; name: string; unit: string; value_type: string; domain: string; owner_dept: string | null; plan: { id: number; value: number; source_ref: any; version: number } | null };

/** Kế hoạch năm: chỉ tiêu HĐND/UBND giao; báo cáo tự ghi "đạt x% kế hoạch". Sửa là thêm phiên bản, bản ký giữ kế hoạch lúc chốt. */
export default function PlansPage() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const lb = useLabels();
  const [year, setYear] = useState(new Date().getFullYear());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [src, setSrc] = useState({ so_ky_hieu: '', ngay: '' });
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'success' | 'warning'; text: string } | null>(null);
  const { data: rows = [], isLoading } = useQuery<Row[]>({ queryKey: ['plan-targets', year], queryFn: () => apiGet(`/admin/plan-targets?year=${year}`) });
  const canEdit = ['super_admin', 'commune_admin', 'leader'].includes(me.role ?? '');
  const refresh = () => qc.invalidateQueries({ queryKey: ['plan-targets', year] });
  const save = useMutation({ mutationFn: () => api.post('/admin/plan-targets', { year, rows: Object.entries(edits).filter(([, v]) => v.trim() !== '').map(([indicator_id, v]) => ({ indicator_id, value: parse(v, rows.find((r) => r.indicator_id === indicator_id)?.value_type), source_ref: src.so_ky_hieu ? { so_ky_hieu: src.so_ky_hieu, ngay: src.ngay || null } : {} })) }).then((r) => r.data),
    onSuccess: (r) => { setNotice({ tone: 'success', text: `Đã ghi kế hoạch: ${r.inserted ?? 0} chỉ tiêu mới/đổi, ${r.unchanged ?? 0} giữ nguyên.` }); setEdits({}); refresh(); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const importXlsx = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); fd.append('year', String(year)); if (src.so_ky_hieu) fd.append('so_ky_hieu', src.so_ky_hieu); if (src.ngay) fd.append('ngay', src.ngay); return api.post('/admin/plan-targets/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data); },
    onSuccess: (r) => { setNotice({ tone: 'success', text: `Đã nhập từ Excel: ${r.inserted ?? 0} chỉ tiêu.` }); refresh(); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const parse = (v: string, type?: string) => { const n = Number(v.replace(/\./g, '').replace(',', '.')); return type === 'money' && Math.abs(n) < 1e6 ? Math.round(n * 1e9) : n; };
  const byDomain = useMemo(() => { const m: Record<string, Row[]> = {}; for (const r of rows) (m[r.domain] = m[r.domain] ?? []).push(r); return m; }, [rows]);
  const planned = rows.filter((r) => r.plan).length;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Số liệu" title={`Kế hoạch năm ${year}`} description="Chỉ tiêu kế hoạch được giao (Nghị quyết HĐND, kế hoạch UBND). Báo cáo tự ghi “đạt x% kế hoạch”; bản ký giữ nguyên kế hoạch tại thời điểm chốt."
        actions={<div className="flex flex-wrap items-center gap-2">
          <SelectInput value={year} onChange={(e) => { setYear(Number(e.target.value)); setEdits({}); }}>{[year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i).sort().map((y) => <option key={y} value={y}>Năm {y}</option>)}</SelectInput>
          {canEdit && <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">{importXlsx.isPending ? 'Đang nhập…' : 'Nhập Excel'}<input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx.mutate(f); e.target.value = ''; }} /></label>}
          {canEdit && <ToolbarButton variant="primary" disabled={!Object.keys(edits).length || save.isPending} onClick={() => save.mutate()}>Ghi {Object.keys(edits).length ? `${Object.keys(edits).length} chỉ tiêu` : ''}</ToolbarButton>}
        </div>} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      {canEdit && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div className="w-56"><label className="mb-1 block text-xs2 font-semibold text-ink-2">Văn bản giao kế hoạch</label><TextInput value={src.so_ky_hieu} onChange={(e) => setSrc({ ...src, so_ky_hieu: e.target.value })} placeholder="vd 15/NQ-HĐND" /></div>
          <div className="w-44"><label className="mb-1 block text-xs2 font-semibold text-ink-2">Ngày ban hành</label><TextInput type="date" value={src.ngay} onChange={(e) => setSrc({ ...src, ngay: e.target.value })} /></div>
          <p className="text-xs2 text-ink-muted">Tiền nhập theo <b>tỷ đồng</b> (vd 52 hoặc 253,5); số khác nhập đúng đơn vị. Để trống = không giao kế hoạch.</p>
        </div>
      )}
      <p className="text-xs2 text-ink-muted"><span className="kpi-num font-semibold text-ink">{planned}</span>/{rows.length} chỉ tiêu có kế hoạch năm {year}.</p>
      <DataTable isLoading={isLoading} empty={!rows.length ? <EmptyState title="Chưa có danh mục chỉ tiêu" /> : undefined}>
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Chỉ tiêu</th><th className={TABLE_TH_CLS}>Phòng chủ số liệu</th><th className="px-3 py-2.5 text-right">Kế hoạch {year}</th><th className={TABLE_TH_CLS}>Văn bản giao</th>{canEdit && <th className="px-3 py-2.5 text-right">Nhập / sửa</th>}</tr></thead>
          <tbody className="divide-y divide-rule">
            {Object.entries(byDomain).map(([domain, list]) => (
              <>
                <tr key={`d-${domain}`} className="bg-slate-50/70"><td colSpan={canEdit ? 5 : 4} className="px-3 py-1.5 text-xs2 font-semibold uppercase tracking-wide text-ink-muted">{lb.domain(domain)}</td></tr>
                {list.map((r) => (
                  <tr key={r.indicator_id} className="row-hover">
                    <td className={TABLE_TD_CLS}><p className="font-medium text-ink">{r.name}</p><p className="text-xs2 text-ink-faint">{r.unit}{r.plan?.version && r.plan.version > 1 ? ` · phiên bản ${r.plan.version}` : ''}</p><TechDetails inline label="mã">{r.indicator_id}</TechDetails></td>
                    <td className={`${TABLE_TD_CLS} text-ink-3`}>{r.owner_dept ? lb.dept(r.owner_dept) : '—'}</td>
                    <td className={`${TABLE_TD_CLS} kpi-num text-right font-semibold text-ink`}>{r.plan ? fmtNum(Number(r.plan.value), r.value_type) : <span className="font-normal text-ink-faint">chưa giao</span>}</td>
                    <td className={`${TABLE_TD_CLS} text-xs2 text-ink-muted`}>{r.plan?.source_ref?.so_ky_hieu ? `${r.plan.source_ref.so_ky_hieu}${r.plan.source_ref.ngay ? ` ngày ${String(r.plan.source_ref.ngay).split('-').reverse().join('/')}` : ''}` : r.plan?.source_ref?.file ? `từ ${r.plan.source_ref.file}` : '—'}</td>
                    {canEdit && <td className="px-3 py-1.5 text-right"><TextInput className="h-8 w-32 text-right" value={edits[r.indicator_id] ?? ''} onChange={(e) => setEdits({ ...edits, [r.indicator_id]: e.target.value })} placeholder={r.plan ? fmtNum(Number(r.plan.value), r.value_type) : r.value_type === 'money' ? 'tỷ đồng' : r.unit} /></td>}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}
