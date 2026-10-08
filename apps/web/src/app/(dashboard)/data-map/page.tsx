'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Callout, LoadingState, PageHeader, Panel, StatTile, Tag, TechDetails } from '@/components/ui/admin-ui';
import { fmtDate, fmtNum } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

const ING: Record<string, string> = { API: 'Kết nối API', FILE: 'File xuất', DOCUMENT: 'Văn bản', SCAN: 'Scan', HUMAN: 'Nhập tay' };
const OWN: Record<string, string> = { MASTER: 'Dữ liệu chủ bên ngoài', REFERENCE: 'Tham chiếu', LOCAL_MASTER: 'Phường quản lý', DERIVED: 'Dẫn xuất' };
const FRESH: Record<string, { label: string; preset: 'green' | 'gold' | 'red' | 'neutral' }> = { current: { label: 'Mới', preset: 'green' }, stale: { label: 'Quá hạn cập nhật', preset: 'red' }, never: { label: 'Chưa nạp', preset: 'neutral' }, planned: { label: 'Chờ kết nối', preset: 'gold' } };
const REFRESH: Record<string, string> = { daily: 'hằng ngày', weekly: 'hằng tuần', monthly: 'hằng tháng', quarterly: 'hằng quý', yearly_or_on_change: 'hằng năm / khi đổi', on_change: 'khi có thay đổi' };
const CLS: Record<string, string> = { PUBLIC: 'Công khai', INTERNAL: 'Nội bộ', CONFIDENTIAL: 'Hạn chế', RESTRICTED: 'Mật' };

/** Bản đồ dữ liệu (Blueprint mục 20, 55): dữ liệu ở đâu, ai sở hữu, nạp cách nào, mới tới đâu, chất lượng, báo cáo nào đang dùng; lineage ngược và tác động xuôi. */
function DataMapInner() {
  const sp = useSearchParams();
  const lb = useLabels();
  const [indicator, setIndicator] = useState(sp.get('indicator') || '');
  const [dataset, setDataset] = useState('');
  const { data, isLoading } = useQuery<any>({ queryKey: ['data-map'], queryFn: () => apiGet('/admin/data/map'), refetchInterval: 120_000 });
  const { data: lin } = useQuery<any>({ queryKey: ['lineage', indicator], queryFn: () => apiGet(`/admin/data/lineage?indicator_id=${encodeURIComponent(indicator)}`), enabled: !!indicator });
  const { data: imp } = useQuery<any>({ queryKey: ['impact', dataset], queryFn: () => apiGet(`/admin/data/impact?dataset=${encodeURIComponent(dataset)}`), enabled: !!dataset });
  if (isLoading || !data) return <LoadingState />;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Dữ liệu" title="Bản đồ dữ liệu" description="Thành phố có gì dùng chung thì kết nối, phường phát sinh gì thì chuẩn hoá. Mỗi nguồn ghi rõ chủ sở hữu, cách nạp, chu kỳ, lần nạp gần nhất và nơi đang dùng." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Nguồn dữ liệu" value={data.totals.sources} sub={`${data.totals.active} đang hoạt động · ${data.totals.sources - data.totals.active} chờ kết nối`} />
        <StatTile label="Bộ dữ liệu" value={data.totals.datasets} sub="theo Data Contract" />
        <StatTile label="Có API" value={data.totals.api} sub="kết nối tự động" color="#15803D" />
        <StatTile label="Quá hạn cập nhật" value={data.totals.stale} sub="cần nhắc chủ dữ liệu" color={data.totals.stale ? '#B91C1C' : '#15803D'} />
        <StatTile label="Sức khoẻ dữ liệu" value="→" sub="6 chỉ số đúng–đủ–sạch–sống–thống nhất–dùng chung" href="/data-health" />
      </div>
      {(indicator || dataset) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {indicator && lin && (
            <Panel title={<>Chỉ tiêu “{lin.indicator?.name ?? indicator}” lấy từ đâu?</>} actions={<button type="button" className="text-xs2 text-ink-muted hover:underline" onClick={() => setIndicator('')}>Đóng</button>}>
              <div className="space-y-3 px-5 py-4 text-sm2">
                <div><p className="text-xs2 font-semibold uppercase text-ink-muted">Nguồn</p>{lin.datasets.length ? <ul className="mt-1 list-disc pl-4">{lin.datasets.map((d: any) => <li key={d.code}>{d.source} → {d.dataset} <span className="text-xs2 text-ink-muted">({OWN[d.ownership] ?? d.ownership}, {ING[d.ingestion] ?? d.ingestion}, {d.refresh})</span></li>)}</ul> : <p className="text-ink-muted">Chưa khai trong bản đồ dữ liệu.</p>}</div>
                <div><p className="text-xs2 font-semibold uppercase text-ink-muted">Số theo kỳ</p><ul className="mt-1 divide-y divide-rule">{lin.facts.slice(0, 8).map((f: any) => <li key={f.id} className="flex justify-between py-1"><span>{lb.period(f.period, true)} · {lb.capture(f.capture_method)}{f.file ? ` · ${f.file.original_name}` : f.source_ref?.system ? ` · ${f.source_ref.system}` : ''}</span><span className="kpi-num">{fmtNum(f.value, lin.indicator?.value_type ?? 'integer')} · {lb.factStatus(f.status)}</span></li>)}</ul></div>
                <div><p className="text-xs2 font-semibold uppercase text-ink-muted">Đang dùng ở</p><p className="mt-1">{[...lin.used_in.reports.map((r: any) => `Báo cáo ${lb.period(r.period)}${r.signed_number ? ` (số ${r.signed_number})` : ''}`), ...lin.used_in.dashboards.map((d: string) => `Bảng điều hành: ${d}`)].join(' · ') || 'chưa dùng'}</p></div>
              </div>
            </Panel>
          )}
          {dataset && imp && (
            <Panel title={<>Nếu “{imp.dataset.name}” lỗi thì ảnh hưởng gì?</>} actions={<button type="button" className="text-xs2 text-ink-muted hover:underline" onClick={() => setDataset('')}>Đóng</button>}>
              <div className="space-y-2 px-5 py-4 text-sm2">
                <p><b>{imp.indicators.length}</b> chỉ tiêu: {imp.indicators.map((i: any) => i.name).join(', ')}</p>
                <p><b>{imp.reports.length}</b> mẫu báo cáo: {imp.reports.map((r: any) => r.title).join(', ') || '—'}</p>
                <p><b>{imp.open_runs.length}</b> kỳ đang thu số bị ảnh hưởng: {imp.open_runs.map((r: any) => lb.period(r.period)).join(', ') || '—'}</p>
                <p><b>{imp.dashboards.length}</b> khối bảng điều hành: {imp.dashboards.join(', ') || '—'}</p>
              </div>
            </Panel>
          )}
        </div>
      )}
      {data.sources.map((s: any) => (
        <Panel key={s.key} title={<>{s.name} <Tag preset={s.status === 'active' ? 'green' : 'gold'} className="ml-2">{s.status === 'active' ? 'Đang dùng' : 'Chờ kết nối'}</Tag></>}
          actions={<span className="text-xs2 text-ink-muted">Chủ: {s.owner_name} · Đầu mối: {s.steward ?? '—'} · {ING[s.ingestion] ?? s.ingestion}{s.api_available ? ' · có API' : ''} · {CLS[s.permission_class] ?? s.permission_class}</span>}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs2 font-semibold text-ink-muted"><tr><th className="px-4 py-2 text-left">Bộ dữ liệu</th><th className="px-3 py-2 text-left">Sở hữu</th><th className="px-3 py-2 text-left">Chu kỳ</th><th className="px-3 py-2 text-right">Bản ghi</th><th className="px-3 py-2 text-left">Lần nạp gần nhất</th><th className="px-3 py-2 text-right">Chất lượng</th><th className="px-3 py-2 text-left">Nơi dùng</th></tr></thead>
            <tbody className="divide-y divide-rule">
              {s.datasets.map((d: any) => (
                <tr key={d.code} className="row-hover align-top">
                  <td className="px-4 py-2.5"><p className="font-medium text-ink">{d.name}</p><p className="text-xs2 text-ink-muted">{d.indicators.slice(0, 4).map((i: string) => <button key={i} type="button" className="mr-2 text-primary-600 hover:underline" onClick={() => setIndicator(i)}>{lb.ind(i)}</button>)}{d.indicators.length > 4 ? `… +${d.indicators.length - 4}` : ''}</p><TechDetails inline label="mã">{d.code} · {d.object_types.join(', ')}</TechDetails></td>
                  <td className="px-3 py-2.5 text-xs2 text-ink-2">{OWN[d.ownership] ?? d.ownership}</td>
                  <td className="px-3 py-2.5 text-xs2 text-ink-2">{REFRESH[d.refresh] ?? d.refresh}</td>
                  <td className="kpi-num px-3 py-2.5 text-right">{d.records}</td>
                  <td className="px-3 py-2.5 text-xs2">{d.last_sync ? <>{fmtDate(d.last_sync)} <Tag preset={FRESH[d.freshness]?.preset ?? 'neutral'} dot={false}>{FRESH[d.freshness]?.label}</Tag></> : <Tag preset={FRESH[d.freshness]?.preset ?? 'neutral'} dot={false}>{FRESH[d.freshness]?.label}</Tag>}</td>
                  <td className={`kpi-num px-3 py-2.5 text-right ${d.quality_score != null && d.quality_score < 80 ? 'text-amber-700' : 'text-ink'}`}>{d.quality_score != null ? `${d.quality_score}%` : '—'}</td>
                  <td className="px-3 py-2.5 text-xs2 text-ink-2">{d.used_by.reports.length} báo cáo · {d.used_by.dashboards.length} khối điều hành <button type="button" className="ml-1 text-primary-600 hover:underline" onClick={() => setDataset(d.code)}>tác động</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
      <Callout tone="info">Nguồn chờ kết nối (QLVB qua LGSP, 1022/IOC, CSDL dân cư, đất đai) đang chạy giả lập hoặc nhận số tổng hợp; khi Thành phố cấp khoá chỉ đổi cấu hình `config/data-map/sources.yaml` và adapter, không đổi mô hình dữ liệu.</Callout>
    </div>
  );
}

export default function DataMapPage() { return <Suspense fallback={null}><DataMapInner /></Suspense>; }
