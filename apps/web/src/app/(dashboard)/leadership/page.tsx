'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import { apiGet } from '@/lib/api';
import { PageHeader, StatTile, SelectInput, LoadingState, EmptyState, Callout, PeriodBand, Panel, Tag } from '@/components/ui/admin-ui';
import { IndicatorCard, type ExecCard } from '@/components/work/IndicatorCard';
import { ProvenanceDrawer, type NumberRef } from '@/components/report/ProvenanceDrawer';
import { fmtDate, fmtNum, periodOptions } from '@/lib/do360';
import { periodShort, useLabels } from '@/lib/labels';
import { dueText } from '@/lib/work';

const COLORS = ['#0F3D6E', '#15803D', '#B45309', '#B91C1C', '#6D28D9'];

/**
 * Bảng điều hành tổng hợp (Blueprint V0.5 mục 50–51): "Việc cần xử lý" trên cùng, rồi từng lĩnh vực với thẻ chỉ tiêu
 * Mục tiêu – Thực hiện – Rủi ro – Hành động; chỉ số lấy từ bộ đã xác nhận/duyệt/chốt; mỗi con số bấm ra nguồn.
 */
export default function LeadershipPage() {
  const lb = useLabels();
  const periods = periodOptions();
  const [period, setPeriod] = useState<string>('');
  const [sel, setSel] = useState<ExecCard | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const { data: ex, isLoading } = useQuery<any>({ queryKey: ['executive', period], queryFn: () => apiGet(`/admin/data/executive${period ? `?period=${period}` : ''}`), refetchInterval: 60_000 });
  const p = ex?.period ?? period;
  const { data: indicators = [] } = useQuery<any[]>({ queryKey: ['indicators'], queryFn: () => apiGet('/admin/catalog/indicators') });
  const { data: pk } = useQuery<any>({ queryKey: ['project-kpis', p], queryFn: () => apiGet(`/admin/dashboard/project-kpis?period=${p}`), enabled: !!p });
  const ids = useMemo(() => (picked.length ? picked : ['tthc.tiep_nhan', 'tai_chinh.thu_ns', 'chi_dao.vb_den'].filter((i) => indicators.some((x) => x.indicator_id === i))), [picked, indicators]);
  const { data: trends } = useQuery<any>({ queryKey: ['dash-trends', p, ids.join(',')], queryFn: () => apiGet(`/admin/dashboard/trends?indicators=${encodeURIComponent(ids.join(','))}&period=${p}`), enabled: !!p && ids.length > 0 });
  const chartData = useMemo(() => (trends?.periods ?? []).map((pp: string, idx: number) => { const row: any = { period: pp }; for (const s of trends.series) row[s.indicator_id] = s.points[idx]?.value ?? null; return row; }), [trends]);

  if (isLoading || !ex) return <LoadingState />;
  const todo = ex.todo;
  const todoCount = todo ? todo.tasks_overdue.count + todo.indicators_missing.count + todo.projects_alert.count + todo.datasets_stale.count + todo.facts_pending.quarantined : 0;
  const ref: NumberRef | null = sel?.source ? { indicator_id: sel.indicator, fact_id: sel.source.fact_id, value: sel.value ?? undefined, unit: sel.unit, name: sel.name, as_of_date: sel.as_of_date ?? undefined, capture_method: sel.source.capture, source_ref: { file_id: sel.source.file_id, rule: sel.source.rule, system: sel.source.system } , plan: sel.plan ?? undefined } : null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Điều hành" title="Bảng điều hành" description="Mỗi chỉ tiêu đi cùng kế hoạch, xu hướng, ngày chốt, nguồn và phòng chủ số liệu. Chỉ hiện số đã qua người xác nhận."
        actions={<div className="flex items-center gap-2">
          <SelectInput value={p ?? ''} onChange={(e) => setPeriod(e.target.value)}><option value="">Kỳ đang làm</option>{periods.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</SelectInput>
          <Link href="/data-health" className="inline-flex h-10 items-center rounded-lg border border-rule bg-white px-3 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Sức khoẻ dữ liệu {ex.data_health?.overall != null ? <span className="kpi-num ml-1 text-emerald-700">{ex.data_health.overall}%</span> : null}</Link>
        </div>} />
      {!ex.period ? <Callout tone="warning">Chưa có kỳ báo cáo nào. <Link className="underline" href="/report-runs">Mở kỳ</Link></Callout> : (
        <PeriodBand period={ex.period} label={ex.run?.signed_number ? `số ${ex.run.signed_number}` : undefined} status={ex.run?.status ?? 'collecting'} cutoff={ex.run?.cutoff_date ? fmtDate(ex.run.cutoff_date) : undefined} meta={ex.last_updated ? <> · cập nhật gần nhất {fmtDate(ex.last_updated)}</> : null}
          actions={ex.run ? <Link href={`/report-runs/${ex.run.run_id}/read`} className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm2 font-semibold text-primary-600 transition-colors hover:bg-primary-50">Đọc báo cáo</Link> : undefined} />
      )}

      {todo && (
        <Panel title={<>Việc cần xử lý <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{todoCount}</span></>}>
          <div className="grid gap-3 px-5 py-4 md:grid-cols-5">
            <StatTile label="Nhiệm vụ quá hạn" value={todo.tasks_overdue.count} color={todo.tasks_overdue.count ? '#B91C1C' : '#15803D'} href="/tasks?overdue=1" sub={todo.tasks_overdue.items.slice(0, 2).map((t: any) => t.title).join(' · ') || 'không có'} />
            <StatTile label="Chỉ tiêu thiếu số" value={todo.indicators_missing.count} color={todo.indicators_missing.count ? '#B45309' : '#15803D'} href={`/facts?period=${ex.period}`} sub={todo.indicators_missing.items.slice(0, 2).map((i: any) => i.name).join(' · ') || 'đủ'} />
            <StatTile label="Dự án có cảnh báo" value={todo.projects_alert.count} color={todo.projects_alert.count ? '#B91C1C' : '#15803D'} href="/objects?type=du_an&alerts=1" sub={todo.projects_alert.items.slice(0, 2).map((o: any) => o.name).join(' · ') || 'không có'} />
            <StatTile label="Nguồn dữ liệu quá hạn cập nhật" value={todo.datasets_stale.count} color={todo.datasets_stale.count ? '#B45309' : '#15803D'} href="/data-map" sub={todo.datasets_stale.items.slice(0, 2).map((d: any) => d.name).join(' · ') || 'đều mới'} />
            <StatTile label="Số chờ xác nhận / cách ly" value={`${todo.facts_pending.extracted + todo.facts_pending.confirmed} / ${todo.facts_pending.quarantined}`} color={todo.facts_pending.quarantined ? '#B91C1C' : '#0F3D6E'} href="/facts?view=pending" sub="chờ bộ phận và người đại diện phòng" />
          </div>
        </Panel>
      )}

      {ex.domains.map((d: any) => (
        <section key={d.key} id={d.key} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base2 font-bold text-ink"><Link href={`/domain/${d.key}`} className="hover:underline">{d.name}</Link></h2>
            <div className="flex items-center gap-2 text-xs2">
              {d.summary.dat > 0 && <Tag preset="green">{d.summary.dat} đạt</Tag>}
              {d.summary.canh_bao > 0 && <Tag preset="red">{d.summary.canh_bao} cảnh báo</Tag>}
              {d.summary.thieu > 0 && <Tag preset="neutral">{d.summary.thieu} thiếu số</Tag>}
              {d.objects && <Link href={`/objects?type=${d.objects.type}`} className="font-medium text-primary-600 hover:underline">{d.objects.count} {lb.L.departments ? '' : ''}đối tượng{d.objects.alerts.length ? ` · ${d.objects.alerts.length} cảnh báo` : ''}</Link>}
            </div>
          </div>
          {d.cards.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{d.cards.map((c: ExecCard) => <IndicatorCard key={c.indicator} c={c} period={ex.period} onSource={setSel} />)}</div>}
          {d.tabs.map((t: any) => (
            <div key={t.key}>
              <p className="mb-2 text-xs2 font-semibold uppercase tracking-wide text-ink-muted">{t.name}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{t.cards.map((c: ExecCard) => <IndicatorCard key={c.indicator} c={c} period={ex.period} onSource={setSel} />)}</div>
            </div>
          ))}
          {d.objects?.alerts?.length > 0 && (
            <ul className="divide-y divide-rule rounded-card border border-red-200 bg-red-50/40">
              {d.objects.alerts.slice(0, 5).map((o: any) => <li key={o.uid} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm2"><Link href={`/objects/${o.uid}`} className="font-medium text-ink hover:underline">{o.code} · {o.name}</Link><span className="text-xs2 text-red-700">{o.alerts.map((a: any) => a.name).join(', ')}</span></li>)}
            </ul>
          )}
        </section>
      ))}

      <div className="card">
        <div className="card-head flex-wrap">
          <p className="card-title">Xu hướng chỉ tiêu qua các kỳ</p>
          <select multiple className="h-20 min-w-[260px] rounded border border-slate-200 px-2 text-xs" value={ids} onChange={(e) => setPicked(Array.from(e.target.selectedOptions).map((o) => o.value).slice(0, 5))}>
            {indicators.map((i) => <option key={i.indicator_id} value={i.indicator_id}>{i.name} ({i.unit})</option>)}
          </select>
        </div>
        <div className="h-72 px-2 py-3">
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} tickFormatter={(v) => periodShort(String(v))} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString('vi-VN')} />
                <Tooltip labelFormatter={(v) => periodShort(String(v))} formatter={(v: any) => (v == null ? '—' : Number(v).toLocaleString('vi-VN'))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {(trends?.series ?? []).map((s: any, i: number) => <Line key={s.indicator_id} type="monotone" dataKey={s.indicator_id} name={s.name ?? lb.ind(s.indicator_id)} stroke={COLORS[i % COLORS.length]} connectNulls dot={{ r: 3 }} />)}
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyState title="Chưa có số liệu đã xác nhận" description="Chọn chỉ tiêu ở hộp bên phải hoặc chờ các kỳ có số." />}
        </div>
        {trends?.series?.length > 0 && <div className="border-t border-rule px-5 py-2 text-xs text-ink-muted">{trends.series.map((s: any) => { const last = [...s.points].reverse().find((x: any) => x.value != null); return <span key={s.indicator_id} className="mr-4">{s.name}: <b className="kpi-num text-ink">{last ? fmtNum(last.value, s.value_type) : '—'}</b>{last ? ` (${periodShort(last.period)})` : ''}</span>; })}</div>}
      </div>
      {pk && (
        <div className="card">
          <div className="card-head"><p className="card-title">KPI dự án ({ex.period_label}) — đo từ dữ liệu kho</p></div>
          <div className="grid grid-cols-2 gap-3 px-5 py-3 md:grid-cols-4 xl:grid-cols-7">
            {([['ty_le_bac_1_3', 'Chỉ tiêu bậc 1–3 (API, file xuất, PDF chữ)', '%', '≥ 60'], ['ty_le_bac_4_5', 'Chỉ tiêu còn ở bậc 4–5 (OCR, nhập tay)', '%', 'giảm dần'], ['slot_tu_dien', 'Mục số tự điền', '%', '≥ 80'], ['so_boc_khong_can_sua', 'Số bóc không cần sửa', '%', '≥ 95'], ['thoi_gian_xac_nhan_phut', 'Thời gian xác nhận mỗi số', ' phút', 'theo dõi'], ['loi_doi_soat_lot_ban_ky', 'Lỗi đối soát lọt bản ký', '', '= 0'], ['thoi_gian_tong_hop_gio', 'Thời gian tổng hợp', ' giờ', '−70% so làm tay']] as [string, string, string, string][]).map(([k, label, unit, target]) => {
              const v = pk.kpis[k]; const t = pk.targets[k]; const ok = v == null || t == null ? null : k === 'loi_doi_soat_lot_ban_ky' ? v === t : v >= t;
              return <div key={k}><p className="text-xs2 text-ink-muted">{label}</p><p className={`kpi-num text-lg font-bold ${ok === null ? 'text-ink-2' : ok ? 'text-emerald-700' : 'text-red-700'}`}>{v == null ? '—' : `${v}${unit}`}</p><p className="text-2xs text-ink-faint">mục tiêu {target}</p></div>;
            })}
          </div>
        </div>
      )}
      {todo?.tasks_overdue?.items?.length > 0 && (
        <Panel title="Nhiệm vụ quá hạn">
          <ul className="divide-y divide-rule">{todo.tasks_overdue.items.map((t: any) => <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm2"><span className="text-ink">{t.title}<span className="ml-2 text-xs2 text-ink-muted">{t.assignee ?? ''}{t.department ? ` · ${lb.dept(t.department)}` : ''}</span></span><span className="text-xs2 font-medium text-red-700">{dueText(t.due_at).text}</span></li>)}</ul>
        </Panel>
      )}
      <ProvenanceDrawer open={!!sel && !!ref} onClose={() => setSel(null)} refData={ref} period={ex.period ?? ''} kind={sel?.pair ? 'number' : 'number'} text={sel ? fmtNum(sel.value ?? 0, sel.value_type) : ''} />
    </div>
  );
}
