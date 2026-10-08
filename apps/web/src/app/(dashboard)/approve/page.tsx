'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Callout, LoadingState, PageHeader, Panel, StatTile, Tag, ToolbarButton } from '@/components/ui/admin-ui';
import { TaskList } from '@/components/work/TaskList';
import { errMsg, fmtDate, fmtNum } from '@/lib/do360';
import { CAPTURE_HINT, useLabels } from '@/lib/labels';
import { daysLeftText, useWork } from '@/lib/work';

/** Trang chủ DATA OWNER (người đại diện phòng): duyệt hàng loạt số đã xác nhận, quyết số cách ly, tiến độ phòng, việc. */
export default function ApprovePage() {
  const qc = useQueryClient();
  const lb = useLabels();
  const { data: w, isLoading } = useWork();
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const refresh = () => { ['me-work', 'facts', 'quarantine', 'report-run'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const approve = useMutation({ mutationFn: (ids: string[]) => api.post('/admin/facts/approve', { ids }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'success', text: `Đã duyệt ${r.approved} số. Văn phòng có thể chốt kỳ khi đủ.` }); setSelected([]); refresh(); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const reject = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/admin/facts/${id}/reject`, { reason }).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'info', text: 'Đã loại số cách ly. Bộ phận nộp lại số đúng.' }); refresh(); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const resolve = useMutation({ mutationFn: ({ id, decision, reason }: { id: string; decision: 'accept' | 'reject'; reason: string }) => api.post(`/admin/facts/${id}/resolve`, { decision, reason }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'success', text: r.decision === 'accept' ? 'Đã chấp nhận số này làm số hiện hành (đã duyệt); số cũ chuyển vào lịch sử. Lý do đã ghi nhật ký.' : 'Đã loại số cách ly, lý do đã ghi nhật ký.' }); refresh(); }, onError: (e: any) => setNotice({ tone: 'danger', text: e?.response?.data?.message?.message ?? errMsg(e) }) });
  const done = useMutation({ mutationFn: (id: number) => api.patch(`/admin/tasks/${id}/status`, { status: 'done' }).then((r) => r.data), onSuccess: refresh });

  const waiting: any[] = useMemo(() => (w?.awaiting_approval ?? []), [w]);
  const byPeriod = useMemo(() => { const m: Record<string, any[]> = {}; for (const f of waiting) (m[f.period] = m[f.period] ?? []).push(f); return m; }, [waiting]);
  if (isLoading || !w) return <LoadingState />;
  const quarantine = w.quarantine ?? [];
  const periods = w.periods ?? [];
  const toggleAll = (ids: string[], on: boolean) => setSelected((s) => on ? Array.from(new Set([...s, ...ids])) : s.filter((x) => !ids.includes(x)));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={w.me.department_name ?? 'Người đại diện phòng'} title="Duyệt số của phòng" description="Số chuyên viên đã xác nhận chờ bạn duyệt; số bị cách ly chờ bạn quyết. Duyệt rồi Văn phòng mới chốt được kỳ."
        actions={<ToolbarButton variant="primary" disabled={!selected.length || approve.isPending} onClick={() => approve.mutate(selected)}>Duyệt {selected.length ? `${selected.length} số đã chọn` : ''}</ToolbarButton>} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Chờ tôi duyệt" value={waiting.length} sub="số đã xác nhận" color={waiting.length ? '#B45309' : '#15803D'} />
        <StatTile label="Số bị cách ly" value={quarantine.length} sub="phải quyết: loại hoặc nộp lại" color={quarantine.length ? '#B91C1C' : '#64748B'} />
        {periods[0] ? <StatTile label={`Phòng trong ${periods[0].period_label}`} value={`${periods[0].counts.approved}/${periods[0].counts.total}`} sub={`đã duyệt · ${daysLeftText(periods[0].days_left)}`} color="#0F3D6E" href="/my" /> : <StatTile label="Kỳ đang mở" value="—" sub="chưa có" />}
        <StatTile label="Việc đang mở" value={w.tasks.open} sub={w.tasks.overdue ? `${w.tasks.overdue} quá hạn` : 'không quá hạn'} color={w.tasks.overdue ? '#B91C1C' : '#0F3D6E'} href="/tasks" />
      </div>

      {Object.keys(byPeriod).length === 0 && <Panel title="Chờ tôi duyệt"><p className="px-5 py-4 text-sm2 text-ink-muted">Không có số nào chờ duyệt. Khi chuyên viên xác nhận số mới, danh sách sẽ hiện ở đây.</p></Panel>}
      {Object.entries(byPeriod).map(([period, rows]) => (
        <Panel key={period} title={<>Chờ duyệt — {lb.period(period, true)} <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{rows.length} số</span></>}
          actions={<label className="flex items-center gap-1.5 text-xs2 text-ink-muted"><input type="checkbox" checked={rows.every((r) => selected.includes(r.id))} onChange={(e) => toggleAll(rows.map((r) => r.id), e.target.checked)} /> chọn cả kỳ</label>}>
          <ul className="divide-y divide-rule">
            {rows.map((f) => (
              <li key={f.id} className="row-hover flex flex-wrap items-center gap-3 px-5 py-2.5">
                <input type="checkbox" checked={selected.includes(f.id)} onChange={(e) => toggleAll([f.id], e.target.checked)} aria-label={`Chọn ${f.name}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm2 font-medium text-ink">{f.name}{w.me.role !== 'department_staff' && f.owner_dept ? <span className="ml-2 text-xs2 font-normal text-ink-faint">{lb.dept(f.owner_dept)}</span> : null}</p>
                  <p className="text-xs2 text-ink-muted" title={CAPTURE_HINT[f.capture_method]}>{lb.capture(f.capture_method)}{Number(f.confidence) < 1 ? ` · tin cậy ${Math.round(Number(f.confidence) * 100)}%` : ''}{f.source_ref?.sheet ? ` · ${f.source_ref.sheet}!${f.source_ref.cell}` : ''}{f.source_ref?.page ? ` · trang ${f.source_ref.page}` : ''} · chốt {fmtDate(f.as_of_date)}{f.version > 1 ? ` · phiên bản ${f.version}` : ''}</p>
                  {f.source_ref?.snippet && <p className="truncate text-xs2 italic text-ink-faint">“{String(f.source_ref.snippet).slice(0, 100)}”</p>}
                </div>
                <p className="kpi-num text-right text-base2 font-bold text-ink">{fmtNum(Number(f.value), f.value_type)} <span className="text-xs2 font-normal text-ink-faint">{f.unit}</span></p>
                <button type="button" disabled={approve.isPending} onClick={() => approve.mutate([f.id])} className="h-8 rounded-lg border border-rule bg-white px-3 text-xs2 font-semibold text-ink-2 hover:bg-slate-50 disabled:opacity-60">Duyệt</button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={<>Số bị cách ly <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{quarantine.length}</span></>}>
          {quarantine.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Không có số nào bị cách ly.</p> : (
            <ul className="divide-y divide-rule">
              {quarantine.map((q: any) => (
                <li key={q.id} className="px-5 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm2 font-medium text-ink">{q.name} <span className="kpi-num text-ink-muted">{fmtNum(Number(q.value))}</span> <span className="text-xs2 font-normal text-ink-faint">{lb.period(q.period)} · {lb.capture(q.capture_method)}</span></p>
                      <p className="text-xs2 text-amber-800">{q.note}</p>
                      {q.deadline && <p className={`text-xs2 ${q.overdue ? 'font-semibold text-red-700' : 'text-ink-muted'}`}>{q.overdue ? `Quá hạn quyết (hạn ${fmtDate(q.deadline)}, 2 ngày làm việc)` : `Hạn quyết ${fmtDate(q.deadline)} (2 ngày làm việc)`}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link href={`/facts?period=${q.period}`} className="text-xs2 font-semibold text-primary-600 hover:underline">Xem bảng số</Link>
                      <button type="button" disabled={resolve.isPending} onClick={() => { const r = window.prompt('Chấp nhận số này làm số hiện hành? Ghi lý do (bắt buộc, vào nhật ký):'); if (r) resolve.mutate({ id: q.id, decision: 'accept', reason: r }); }} className="text-xs2 font-semibold text-emerald-700 hover:underline">Chấp nhận số này</button>
                      <button type="button" disabled={reject.isPending} onClick={() => { const r = window.prompt('Lý do loại số này (bộ phận sẽ nộp lại số đúng):'); if (r) resolve.mutate({ id: q.id, decision: 'reject', reason: r }); }} className="text-xs2 font-semibold text-red-700 hover:underline">Loại</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={<>Việc của tôi <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{w.tasks.open} đang mở</span></>}>
          <TaskList items={w.tasks.items} onDone={(id) => done.mutate(id)} busy={done.isPending} />
        </Panel>
      </div>
      {periods[0] && <p className="text-xs2 text-ink-muted">Chỉ tiêu của phòng trong {periods[0].period_label}: <Tag preset="neutral">{periods[0].counts.missing} chưa có số</Tag> <Tag preset="gold">{periods[0].counts.extracted} chờ xác nhận</Tag> <Tag preset="blue">{periods[0].counts.confirmed} chờ duyệt</Tag> <Tag preset="green">{periods[0].counts.approved} đã duyệt</Tag> · <Link href="/my" className="font-medium text-primary-600 hover:underline">xem từng chỉ tiêu</Link></p>}
    </div>
  );
}
