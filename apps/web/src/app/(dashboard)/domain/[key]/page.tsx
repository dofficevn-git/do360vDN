'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { EmptyState, LoadingState, PageHeader, Panel, SelectInput, Tag } from '@/components/ui/admin-ui';
import { IndicatorCard, type ExecCard } from '@/components/work/IndicatorCard';
import { ProvenanceDrawer, type NumberRef } from '@/components/report/ProvenanceDrawer';
import { fmtNum, periodOptions } from '@/lib/do360';

/** Một lĩnh vực của bảng điều hành (Blueprint mục 50.3–50.11): thẻ chỉ tiêu + đối tượng có cảnh báo + đường đi tới nguồn. */
export default function DomainPage() {
  const { key } = useParams<{ key: string }>();
  const periods = periodOptions();
  const [period, setPeriod] = useState('');
  const [sel, setSel] = useState<ExecCard | null>(null);
  const { data: ex, isLoading } = useQuery<any>({ queryKey: ['executive', period], queryFn: () => apiGet(`/admin/data/executive${period ? `?period=${period}` : ''}`) });
  if (isLoading || !ex) return <LoadingState />;
  const d = (ex.domains ?? []).find((x: any) => x.key === key);
  if (!d) return <EmptyState title="Không có lĩnh vực này" description="Kiểm tra config/dashboard/domains.yaml." />;
  const ref: NumberRef | null = sel?.source ? { indicator_id: sel.indicator, fact_id: sel.source.fact_id, value: sel.value ?? undefined, unit: sel.unit, name: sel.name, as_of_date: sel.as_of_date ?? undefined, capture_method: sel.source.capture, source_ref: { file_id: sel.source.file_id, rule: sel.source.rule, system: sel.source.system }, plan: sel.plan ?? undefined } : null;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Lĩnh vực" title={d.name} description={`Kỳ ${ex.period_label}. Thẻ chỉ tiêu theo cấu trúc Mục tiêu – Thực hiện – Rủi ro – Hành động; bấm số để xem nguồn.`}
        actions={<SelectInput value={period} onChange={(e) => setPeriod(e.target.value)}><option value="">Kỳ đang làm</option>{periods.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</SelectInput>} />
      <div className="flex flex-wrap gap-2 text-xs2">{d.summary.dat > 0 && <Tag preset="green">{d.summary.dat} đạt</Tag>}{d.summary.canh_bao > 0 && <Tag preset="red">{d.summary.canh_bao} cảnh báo</Tag>}{d.summary.thieu > 0 && <Tag preset="neutral">{d.summary.thieu} thiếu số</Tag>}</div>
      {d.cards.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{d.cards.map((c: ExecCard) => <IndicatorCard key={c.indicator} c={c} period={ex.period} onSource={setSel} />)}</div>}
      {d.tabs.map((t: any) => (
        <Panel key={t.key} title={t.name} padded><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{t.cards.map((c: ExecCard) => <IndicatorCard key={c.indicator} c={c} period={ex.period} onSource={setSel} />)}</div></Panel>
      ))}
      {d.objects && (
        <Panel title={<>Đối tượng của lĩnh vực <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{d.objects.count}</span></>} actions={<Link href={`/objects?type=${d.objects.type}`} className="text-xs2 font-medium text-primary-600 hover:underline">Danh sách đầy đủ</Link>}>
          {d.objects.alerts.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Không có đối tượng nào đang cảnh báo.</p> : (
            <ul className="divide-y divide-rule">{d.objects.alerts.map((o: any) => <li key={o.uid} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm2"><Link href={`/objects/${o.uid}`} className="font-medium text-ink hover:underline">{o.code} · {o.name}</Link><span className="text-xs2 text-red-700">{o.alerts.map((a: any) => `${a.name}: ${a.detail}`).join(' · ')}</span></li>)}</ul>
          )}
        </Panel>
      )}
      <ProvenanceDrawer open={!!sel && !!ref} onClose={() => setSel(null)} refData={ref} period={ex.period ?? ''} kind="number" text={sel ? fmtNum(sel.value ?? 0, sel.value_type) : ''} />
    </div>
  );
}
