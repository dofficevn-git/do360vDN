'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { clsx } from 'clsx';
import { api, apiGet } from '@/lib/api';
import { Callout, LoadingState, PageHeader, Panel, SelectInput, ToolbarButton } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg, fmtDate, periodOptions } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

/** Sức khoẻ dữ liệu (Blueprint mục 19, 56): 6 chỉ số đo được, drill-down tới phòng và bản ghi, nút nhắc cập nhật. */
export default function DataHealthPage() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const lb = useLabels();
  const periods = periodOptions();
  const [period, setPeriod] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data, isLoading } = useQuery<any>({ queryKey: ['data-health', period], queryFn: () => apiGet(`/admin/data/health${period ? `?period=${period}` : ''}`) });
  const publish = useMutation({ mutationFn: () => api.post('/admin/data/health/publish', { period: data.period }).then((r) => r.data), onSuccess: (r) => { setNotice(`Đã đẩy chỉ số sức khoẻ dữ liệu ${r.overall}% vào kho như một chỉ tiêu dẫn xuất (chờ xác nhận).`); qc.invalidateQueries({ queryKey: ['facts'] }); }, onError: (e) => setNotice(errMsg(e)) });
  const remind = useMutation({ mutationFn: (runId: number) => api.post(`/admin/chat/remind/${runId}`).then((r) => r.data), onSuccess: (r) => setNotice(`Đã nhắc ${r.depts?.length ?? 0} bộ phận.`), onError: (e) => setNotice(errMsg(e)) });
  const { data: runs = [] } = useQuery<any[]>({ queryKey: ['report-runs'], queryFn: () => apiGet('/admin/report-runs') });
  if (isLoading || !data) return <LoadingState />;
  const openRun = runs.find((r) => r.period === data.period && r.status === 'collecting');
  const color = (lv: string) => (lv === 'good' ? 'text-emerald-700' : lv === 'warn' ? 'text-amber-700' : lv === 'bad' ? 'text-red-700' : 'text-ink-faint');
  const bar = (lv: string) => (lv === 'good' ? '#15803D' : lv === 'warn' ? '#B45309' : lv === 'bad' ? '#B91C1C' : '#CBD5E1');
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Dữ liệu" title="Sức khoẻ dữ liệu" description="Đúng – đủ – sạch – sống – thống nhất – dùng chung không là khẩu hiệu: mỗi tiêu chí là một con số đo từ kho, bấm xuống tới bản ghi và phòng chủ."
        actions={<div className="flex items-center gap-2"><SelectInput value={period} onChange={(e) => setPeriod(e.target.value)}><option value="">Kỳ đang làm</option>{periods.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</SelectInput>{['super_admin', 'commune_admin'].includes(me.role ?? '') && data.overall != null && <ToolbarButton onClick={() => publish.mutate()} disabled={publish.isPending}>Đẩy vào kho</ToolbarButton>}</div>} />
      {notice && <Callout tone="info">{notice}</Callout>}
      {!data.period ? <Callout tone="warning">Chưa có kỳ báo cáo nào để đo.</Callout> : (
        <>
          <div className="card flex flex-wrap items-center gap-6 px-6 py-5">
            <div><p className="text-xs2 font-medium text-ink-muted">DATA HEALTH · {data.period_label}</p><p className={clsx('kpi-num text-[40px] font-bold leading-none', data.overall >= 90 ? 'text-emerald-700' : data.overall >= 75 ? 'text-amber-700' : 'text-red-700')}>{data.overall ?? '—'}%</p></div>
            <div className="grid flex-1 grid-cols-3 gap-3 sm:grid-cols-6">
              {data.metrics.map((m: any) => (
                <button key={m.key} type="button" onClick={() => setOpen(open === m.key ? null : m.key)} className={clsx('rounded-lg border px-3 py-2 text-left transition-colors hover:bg-slate-50', open === m.key ? 'border-primary-400 bg-primary-50/40' : 'border-rule')}>
                  <p className="text-xs2 font-semibold uppercase text-ink-muted">{m.name}</p>
                  <p className={clsx('kpi-num text-xl font-bold', color(m.level))}>{m.score ?? '—'}{m.score != null ? '%' : ''}</p>
                  <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded" style={{ width: `${m.score ?? 0}%`, backgroundColor: bar(m.level) }} /></div>
                </button>
              ))}
            </div>
          </div>
          {data.metrics.filter((m: any) => !open || m.key === open).map((m: any) => (
            <Panel key={m.key} title={<>{m.name} <span className={clsx('kpi-num ml-1', color(m.level))}>{m.score ?? '—'}%</span> <span className="ml-2 text-xs2 font-normal text-ink-muted">{m.hint}</span></>}
              actions={<div className="flex items-center gap-2 text-xs2">{m.by_dept?.slice(0, 4).map((d: any) => <span key={d.dept} className="rounded bg-slate-100 px-2 py-0.5 text-ink-2">{d.dept_name}: {d.n}</span>)}{openRun && m.issues.length > 0 && ['super_admin', 'commune_admin'].includes(me.role ?? '') && <ToolbarButton size="sm" onClick={() => remind.mutate(openRun.run_id)}>Nhắc cập nhật</ToolbarButton>}</div>}>
              {m.issues.length === 0 ? <p className="px-5 py-3 text-sm2 text-emerald-700">Không có vấn đề.</p> : (
                <ul className="max-h-80 divide-y divide-rule overflow-y-auto">
                  {m.issues.map((i: any, idx: number) => (
                    <li key={idx} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm2">
                      <span className="text-ink">{i.kind === 'object' ? <Link href={`/objects/${i.id}`} className="hover:underline">{i.name}</Link> : i.name}<span className="ml-2 text-xs2 text-ink-muted">{i.kind === 'object' ? 'đối tượng' : i.kind === 'indicator' ? 'chỉ tiêu' : 'số liệu'}{i.owner_dept ? ` · ${lb.dept(i.owner_dept)}` : ''}</span></span>
                      <span className="text-xs2 text-amber-800">{i.status ? (lb.L.fact_status[i.status] ?? i.status) : ''}{i.as_of_date ? `chốt ${fmtDate(i.as_of_date)}` : ''}{i.refreshed_at ? `cập nhật ${fmtDate(i.refreshed_at)}` : ''}{i.note ? ` — ${String(i.note).slice(0, 80)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
