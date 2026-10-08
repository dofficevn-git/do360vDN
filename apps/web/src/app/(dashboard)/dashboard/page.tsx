'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, apiGet } from '@/lib/api';
import { DeptProgressTable } from '@/components/work/DeptProgressTable';
import type { Progress } from '@/lib/work';
import { Callout, PageHeader, StatTile, Tag, EmptyState, LoadingState, Panel, PeriodBand, ProgressBar, ToolbarLink } from '@/components/ui/admin-ui';
import { RUN_STATUS, GATE_GROUP, fmtDate } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

type Run = { run_id: number; period: string; status: string; cutoff_date: string; spec_id: number; locked_at: string | null; output_file: string | null; signed_number?: string | null };

/** Tổng quan điều hành: kỳ đang làm ở bước nào, còn vướng gì trước khi chốt. */
export default function DashboardPage() {
  const lb = useLabels();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const { data: runs = [], isLoading } = useQuery<Run[]>({ queryKey: ['report-runs'], queryFn: () => apiGet('/admin/report-runs'), refetchInterval: 60_000 });
  const open = runs.find((r) => r.status === 'collecting') ?? runs.find((r) => r.status !== 'cancelled') ?? runs[0];
  const { data: detail } = useQuery<any>({ queryKey: ['report-run', open?.run_id], queryFn: () => apiGet(`/admin/report-runs/${open!.run_id}`), enabled: !!open, refetchInterval: 60_000 });
  const { data: files = [] } = useQuery<any[]>({ queryKey: ['files', open?.period], queryFn: () => apiGet(`/admin/files?period=${open!.period}`), enabled: !!open });
  const { data: quarantine = [] } = useQuery<any[]>({ queryKey: ['quarantine'], queryFn: () => apiGet('/admin/facts/quarantine') });
  const { data: progress } = useQuery<Progress>({ queryKey: ['progress-by-dept', open?.run_id], queryFn: () => apiGet(`/admin/report-runs/${open!.run_id}/progress-by-dept`), enabled: !!open && open.status === 'collecting', refetchInterval: 60_000 });
  const remind = useMutation({ mutationFn: () => api.post(`/admin/chat/remind/${open!.run_id}`).then((r) => r.data), onSuccess: (r) => { setNotice(r.depts?.length ? `Đã nhắc ${r.depts.length} bộ phận còn thiếu số (${r.sent} tin tới máy; chưa liên kết Zalo thì chỉ ghi nhật ký).` : 'Không bộ phận nào còn thiếu số.'); qc.invalidateQueries({ queryKey: ['progress-by-dept'] }); }, onError: () => setNotice('Không gửi được nhắc việc.') });

  if (isLoading) return <LoadingState />;
  const gate = detail?.gate;
  const slots: any[] = gate?.slots ?? [];
  const done = slots.filter((s) => s.complete).length;
  const byGroup: Record<string, number> = {};
  for (const e of gate?.errors ?? []) byGroup[e.group] = (byGroup[e.group] ?? 0) + 1;
  const pct = slots.length ? Math.round((done / slots.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Tổng quan" title="Kỳ báo cáo đang làm" description="Tiến độ theo từng mục của báo cáo, lỗi cần sửa trước khi chốt và số đang cách ly." />
      {!open ? (
        <EmptyState title="Chưa có kỳ báo cáo nào" description="Văn phòng mở kỳ để các bộ phận bắt đầu nộp số." action={<ToolbarLink href="/report-runs" variant="primary">Mở kỳ báo cáo</ToolbarLink>} />
      ) : (
        <>
          <PeriodBand period={open.period} label={detail?.spec?.title} status={open.status} cutoff={fmtDate(open.cutoff_date)}
            meta={open.locked_at ? <> · đã chốt {fmtDate(open.locked_at)}</> : null}
            actions={<><Link href={`/report-runs/${open.run_id}/read`} className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm2 font-semibold text-primary-600 transition-colors hover:bg-primary-50">Đọc báo cáo</Link><Link href={`/report-runs/${open.run_id}`} className="inline-flex h-10 items-center rounded-lg bg-white/15 px-4 text-sm2 font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/25">Tiến độ và kiểm tra</Link></>} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Mục đủ số đã duyệt" value={`${done}/${slots.length}`} sub={`${pct}% mẫu báo cáo`} color="#15803D" href={`/report-runs/${open.run_id}`} />
            <StatTile label="Lỗi cần sửa trước khi chốt" value={gate?.errors?.length ?? 0} sub={Object.entries(byGroup).map(([g, n]) => `${GATE_GROUP[g] ?? g}: ${n}`).join(', ') || 'không có lỗi'} color={gate?.errors?.length ? '#B91C1C' : '#15803D'} href={`/report-runs/${open.run_id}`} />
            <StatTile label="Số đang cách ly" value={quarantine.length} sub="chờ Data Owner xử lý" color={quarantine.length ? '#B45309' : '#64748B'} href="/facts?view=quarantine" />
            <StatTile label="File đã nộp trong kỳ" value={files.length} sub={`${files.filter((f) => f.status === 'extracted').length} đã bóc tách`} color="#0F3D6E" href={`/files?period=${open.period}`} />
          </div>

          {notice && <Callout tone="info">{notice}</Callout>}
          {progress && progress.departments.length > 0 && (
            <Panel title={<>Tiến độ theo bộ phận <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{progress.totals.done}/{progress.totals.depts} đủ số</span></>}
              actions={<span className="text-xs2 text-ink-muted">{progress.days_left < 0 ? `quá hạn chốt ${-progress.days_left} ngày` : progress.days_left === 0 ? 'hạn chốt hôm nay' : `còn ${progress.days_left} ngày đến hạn chốt`}</span>}>
              <DeptProgressTable progress={progress} onRemind={() => remind.mutate()} reminding={remind.isPending} />
            </Panel>
          )}

          <Panel title="Tiến độ theo mục báo cáo" actions={<div className="flex items-center gap-3 text-xs2 text-ink-muted"><span className="kpi-num">{done}/{slots.length}</span><ProgressBar percent={pct} color="#15803D" className="w-32" label="Tiến độ slot" /></div>}>
            {slots.length === 0 ? <p className="px-5 py-6 text-sm2 text-ink-muted">Mẫu báo cáo chưa có slot nào.</p> : (
              <ul className="divide-y divide-rule">
                {slots.map((s) => (
                  <li key={s.slot_code} className="row-hover flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm2 font-medium text-ink"><span className="kpi-num mr-1.5 text-ink-faint">{s.section}</span>{s.title ?? lb.slotTitle(open.spec_id, s.slot_code)}{s.owner_dept ? <span className="ml-2 text-xs2 font-normal text-ink-faint">{s.owner_dept_name ?? lb.dept(s.owner_dept)}</span> : null}</p>
                      <p className="mt-0.5 truncate text-xs2 text-ink-muted">{s.indicators.map((i: any) => `${i.name ?? lb.ind(i.id)}: ${i.fact ? lb.factStatus(i.fact.status) : 'chưa có số'}`).join(' · ')}</p>
                    </div>
                    <Tag preset={s.complete ? 'green' : 'gold'}>{s.complete ? 'Đủ' : 'Chưa đủ'}</Tag>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {runs.length > 1 && (
            <Panel title="Các kỳ khác">
              <ul className="divide-y divide-rule">
                {runs.filter((r) => r.run_id !== open.run_id).slice(0, 6).map((r) => (
                  <li key={r.run_id} className="row-hover flex items-center justify-between px-5 py-2.5">
                    <Link href={`/report-runs/${r.run_id}`} className="text-sm2 font-medium text-ink hover:underline">{lb.period(r.period, true)}{r.signed_number ? <span className="ml-2 text-xs2 text-ink-faint">số {r.signed_number}</span> : null}</Link>
                    <Tag preset={RUN_STATUS[r.status]?.preset ?? 'neutral'}>{RUN_STATUS[r.status]?.label ?? r.status}</Tag>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
