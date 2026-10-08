'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, FilterTabs, PageHeader, Tag, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { CAPTURE_LABEL, currentAdmin, errMsg } from '@/lib/do360';

type Indicator = { indicator_id: string; name: string; unit: string; value_type: string; domain: string; owner_dept: string | null; aggregation: string; capture_method: string; official_code: string | null; is_active: boolean };
type Tab = 'indicators' | 'specs' | 'rules';

/** Danh mục chỉ tiêu, mẫu báo cáo, luật bóc tách — chỉ đọc; nguồn sự thật là thư mục config/ (nạp lại khi đổi). */
export default function CatalogPage() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const [tab, setTab] = useState<Tab>('indicators');
  const [notice, setNotice] = useState<string | null>(null);
  const { data: indicators = [], isLoading } = useQuery<Indicator[]>({ queryKey: ['indicators'], queryFn: () => apiGet('/admin/catalog/indicators') });
  const { data: specs = [] } = useQuery<any[]>({ queryKey: ['specs'], queryFn: () => apiGet('/admin/catalog/report-specs') });
  const { data: rules = [] } = useQuery<any[]>({ queryKey: ['rules'], queryFn: () => apiGet('/admin/catalog/extract-rules') });
  const reload = useMutation({ mutationFn: () => api.post('/admin/catalog/reload').then((r) => r.data),
    onSuccess: (r) => { setNotice(`Đã nạp: ${r.indicators.upserted} chỉ tiêu; mẫu mới ${r.specs.created.length}; luật mới ${r.rules.created.length}${r.errors.length ? `; LỖI: ${r.errors.join(' | ')}` : ''}`); ['indicators', 'specs', 'rules'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => setNotice(errMsg(e)) });
  const AGG: Record<string, string> = { cumulative: 'Lũy kế', flow: 'Trong kỳ', point_in_time: 'Thời điểm' };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Cấu hình" title="Danh mục chỉ tiêu" description="Mã chỉ tiêu lấy theo văn bản của ngành/địa phương (official_code). Đổi danh mục = sửa file YAML trong config/ rồi nạp lại."
        actions={me.role === 'super_admin' ? <ToolbarButton variant="primary" disabled={reload.isPending} onClick={() => reload.mutate()}>Nạp lại từ config/</ToolbarButton> : undefined} />
      {notice && <Callout tone={/LỖI/.test(notice) ? 'danger' : 'info'}>{notice}</Callout>}
      <FilterTabs<Tab> value={tab} onChange={setTab} items={[{ value: 'indicators', label: 'Chỉ tiêu', count: indicators.length }, { value: 'specs', label: 'Mẫu báo cáo', count: specs.length }, { value: 'rules', label: 'Luật bóc tách', count: rules.length }]} />
      {tab === 'indicators' && (
        <DataTable isLoading={isLoading}>
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Mã</th><th className={TABLE_TH_CLS}>Tên</th><th className={TABLE_TH_CLS}>Đơn vị</th><th className={TABLE_TH_CLS}>Lĩnh vực / phòng</th><th className={TABLE_TH_CLS}>Cách tính</th><th className={TABLE_TH_CLS}>Thu thập</th><th className={TABLE_TH_CLS}>Mã ngành</th></tr></thead>
            <tbody className="divide-y divide-rule">{indicators.map((i) => (
              <tr key={i.indicator_id} className="row-hover"><td className={`${TABLE_TD_CLS} font-mono text-xs text-ink-muted`}>{i.indicator_id}</td><td className={`${TABLE_TD_CLS} font-medium text-ink`}>{i.name}</td><td className={TABLE_TD_CLS}>{i.unit}</td><td className={TABLE_TD_CLS}>{i.domain}{i.owner_dept ? ` · ${i.owner_dept}` : ''}</td><td className={TABLE_TD_CLS}>{AGG[i.aggregation] ?? i.aggregation}</td><td className={TABLE_TD_CLS}><Tag preset={i.capture_method === 'form' ? 'gold' : 'blue'}>{CAPTURE_LABEL[i.capture_method] ?? i.capture_method}</Tag></td><td className={`${TABLE_TD_CLS} kpi-num`}>{i.official_code ?? <span className="text-xs text-amber-600">chưa gán</span>}</td></tr>))}</tbody>
          </table>
        </DataTable>
      )}
      {tab === 'specs' && <div className="space-y-3">{specs.map((s) => <SpecCard key={s.id} spec={s} />)}</div>}
      {tab === 'rules' && (
        <DataTable>
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Loại nguồn</th><th className={TABLE_TH_CLS}>Loại file</th><th className={TABLE_TH_CLS}>Lĩnh vực</th><th className={TABLE_TH_CLS}>Nhận dạng</th><th className={TABLE_TH_CLS}>Số ánh xạ</th></tr></thead>
            <tbody className="divide-y divide-rule">{rules.map((r) => (
              <tr key={r.id} className="row-hover"><td className={`${TABLE_TD_CLS} font-medium text-ink`}>{r.source_type} <span className="text-xs text-ink-faint">v{r.version}</span></td><td className={TABLE_TD_CLS}>{r.file_kind}</td><td className={TABLE_TD_CLS}>{r.domain ?? '—'}</td><td className={`${TABLE_TD_CLS} text-xs text-ink-muted`}>{JSON.stringify(r.rule?.match ?? {})}</td><td className={`${TABLE_TD_CLS} kpi-num`}>{(r.rule?.map?.length ?? 0) + (r.rule?.sentences?.length ?? 0) + (r.rule?.regions?.length ?? 0)}</td></tr>))}</tbody>
          </table>
        </DataTable>
      )}
    </div>
  );
}

function SpecCard({ spec }: { spec: any }) {
  const { data } = useQuery<any>({ queryKey: ['spec', spec.id], queryFn: () => apiGet(`/admin/catalog/report-specs/${spec.id}`) });
  return (
    <div className="card">
      <div className="card-head"><p className="card-title">{spec.title} <span className="text-xs font-normal text-ink-faint">{spec.spec_code}@{spec.version} · kỳ: {(spec.period_types ?? []).join(', ')}</span></p></div>
      <ul className="divide-y divide-rule">{(data?.slots ?? []).map((s: any) => (
        <li key={s.id} className="px-5 py-2.5 text-xs"><p className="text-sm2 font-medium text-ink"><span className="kpi-num text-ink-faint">{s.section}</span> {s.slot_code} <Tag preset="neutral">{s.slot_type}</Tag>{s.owner_dept && <span className="ml-1 text-ink-faint">· {s.owner_dept}</span>}</p>{s.template && <p className="mt-0.5 italic text-ink-muted">{s.template}</p>}{s.checks?.length > 0 && <p className="mt-0.5 font-mono text-ink-muted">{s.checks.join(' · ')}</p>}</li>))}</ul>
    </div>
  );
}
