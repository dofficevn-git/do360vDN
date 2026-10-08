'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Callout, EmptyState, LoadingState, PageHeader, Panel, PeriodBand, StatTile, Tag } from '@/components/ui/admin-ui';
import { TaskList } from '@/components/work/TaskList';
import { FACT_STATUS, errMsg, fmtDate, fmtNum } from '@/lib/do360';
import { FACT_STATUS_HINT, useLabels } from '@/lib/labels';
import { daysLeftText, useWork, type WorkItem } from '@/lib/work';

/** Trang chủ CHUYÊN VIÊN: chỉ tiêu phòng mình còn thiếu/chờ trong kỳ đang mở, số bị cách ly, việc được giao. */
export default function MyWorkPage() {
  const qc = useQueryClient();
  const lb = useLabels();
  const { data: w, isLoading } = useWork();
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const refresh = () => { ['me-work', 'facts', 'quarantine', 'report-run'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const confirm = useMutation({ mutationFn: (id: string) => api.post(`/admin/facts/${id}/confirm`).then((r) => r.data), onSuccess: (r) => { setNotice(r.status === 'quarantined' ? { tone: 'warning', text: `Không qua kiểm tra số học — đã cách ly: ${r.note}` } : { tone: 'success', text: 'Đã xác nhận. Chờ người đại diện phòng duyệt.' }); refresh(); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const done = useMutation({ mutationFn: (id: number) => api.patch(`/admin/tasks/${id}/status`, { status: 'done' }).then((r) => r.data), onSuccess: refresh, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });

  if (isLoading || !w) return <LoadingState />;
  const periods = w.periods ?? [];
  const quarantine = w.quarantine ?? [];
  const tone = (it: WorkItem) => (!it.fact ? 'missing' : it.fact.status);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={w.me.department_name ?? 'Việc của tôi'} title={`Việc của tôi${w.me.full_name ? ` — ${w.me.full_name}` : ''}`} description="Số của phòng còn thiếu hoặc chờ xử lý trong kỳ đang thu số, số bị cách ly và việc được giao. Nộp file xuất từ hệ thống thì không phải nhập tay." />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Chỉ tiêu phòng còn thiếu" value={periods.reduce((n, p) => n + p.counts.missing, 0)} sub={periods.length ? periods.map((p) => p.period_label).join(', ') : 'chưa có kỳ mở'} color="#B91C1C" />
        <StatTile label="Chờ tôi xác nhận" value={periods.reduce((n, p) => n + p.counts.extracted, 0)} sub="số bóc từ file" color="#B45309" />
        <StatTile label="Số bị cách ly" value={quarantine.length} sub="chờ người đại diện phòng quyết" color={quarantine.length ? '#B91C1C' : '#64748B'} href="/facts?view=quarantine" />
        <StatTile label="Việc đang mở" value={w.tasks.open} sub={w.tasks.overdue ? `${w.tasks.overdue} quá hạn` : w.tasks.due_soon ? `${w.tasks.due_soon} sắp đến hạn` : 'không quá hạn'} color={w.tasks.overdue ? '#B91C1C' : '#0F3D6E'} href="/tasks" />
      </div>

      {periods.length === 0 && <EmptyState title="Không có kỳ nào đang thu số" description="Văn phòng sẽ mở kỳ và nhắc khi cần số của phòng bạn." />}
      {periods.map((p) => (
        <div key={p.run_id} className="space-y-3">
          <PeriodBand period={p.period} label={p.spec_title ?? undefined} status={p.status} cutoff={fmtDate(p.cutoff_date)} meta={<> · {daysLeftText(p.days_left)}</>}
            actions={<><Link href={`/files?period=${p.period}`} className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm2 font-semibold text-primary-600 transition-colors hover:bg-primary-50">Nộp file</Link><Link href={`/facts?period=${p.period}`} className="inline-flex h-10 items-center rounded-lg bg-white/15 px-4 text-sm2 font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/25">Bảng số liệu</Link></>} />
          {p.errors.length > 0 && (
            <Callout tone="warning" title={`${p.errors.length} vấn đề kiểm tra thuộc phòng bạn`}>
              <ul className="list-disc space-y-0.5 pl-4">{p.errors.slice(0, 6).map((e: any, i: number) => <li key={i}>{e.title ?? e.message}{e.fix_hint ? <span className="text-ink-muted"> — {e.fix_hint}</span> : null}</li>)}</ul>
            </Callout>
          )}
          <Panel title={<>Chỉ tiêu của phòng trong kỳ <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{p.counts.approved}/{p.counts.total} đã duyệt</span></>}>
            {p.items.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Mẫu báo cáo kỳ này không có chỉ tiêu nào của phòng bạn.</p> : (
              <ul className="divide-y divide-rule">
                {p.items.map((it) => (
                  <li key={it.id} className="row-hover flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm2 font-medium text-ink">{it.name}<span className="ml-2 text-xs2 font-normal text-ink-faint">{it.section} {it.slot_title ?? ''}</span></p>
                      <p className="text-xs2 text-ink-muted">{it.fact ? <>{fmtNum(Number(it.fact.value), lb.L.indicators[it.id]?.value_type)} {it.unit} · {lb.capture(it.fact.capture_method)} · chốt {fmtDate(it.fact.as_of_date)}{it.fact.version && it.fact.version > 1 ? ` · phiên bản ${it.fact.version}` : ''}</> : it.required ? 'Chưa có số — mục bắt buộc của báo cáo' : 'Chưa có số (mục không bắt buộc)'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {tone(it) === 'missing' ? <Tag preset={it.required ? 'red' : 'neutral'}>Chưa có số</Tag> : <span title={FACT_STATUS_HINT[it.fact!.status]}><Tag preset={FACT_STATUS[it.fact!.status as keyof typeof FACT_STATUS]?.preset ?? 'neutral'}>{lb.factStatus(it.fact!.status)}</Tag></span>}
                      {it.fact?.status === 'extracted' && <button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate(it.fact!.id)} className="h-8 rounded-lg bg-primary-500 px-3 text-xs2 font-semibold text-white hover:bg-primary-600 disabled:opacity-60">Xác nhận</button>}
                      {!it.fact && <Link href={`/facts?period=${p.period}&manual=1&indicator=${encodeURIComponent(it.id)}`} className="text-xs2 font-semibold text-primary-600 hover:underline">Nhập tay</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={<>Số bị cách ly của phòng <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{quarantine.length}</span></>}>
          {quarantine.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Không có số nào bị cách ly.</p> : (
            <ul className="divide-y divide-rule">
              {quarantine.slice(0, 8).map((q: any) => (
                <li key={q.id} className="px-5 py-2.5">
                  <p className="text-sm2 font-medium text-ink">{q.name} <span className="kpi-num text-ink-muted">{fmtNum(Number(q.value))}</span> <span className="text-xs2 font-normal text-ink-faint">{lb.period(q.period)}</span></p>
                  <p className="text-xs2 text-amber-800">{q.note}</p>
                  <p className="text-xs2 text-ink-muted">Nộp lại số đúng (file xuất hoặc nhập tay) — người đại diện phòng sẽ loại số sai.</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={<>Việc được giao <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{w.tasks.open} đang mở</span></>}>
          <TaskList items={w.tasks.items} onDone={(id) => done.mutate(id)} busy={done.isPending} />
        </Panel>
      </div>
    </div>
  );
}
