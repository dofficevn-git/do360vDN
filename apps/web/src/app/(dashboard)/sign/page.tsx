'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, EmptyState, LoadingState, PageHeader, Panel, RunStepper, StatTile, Tag, ToolbarButton } from '@/components/ui/admin-ui';
import { TaskList } from '@/components/work/TaskList';
import { RUN_STATUS, errMsg, fmtDate } from '@/lib/do360';
import { useWork } from '@/lib/work';

/** Trang chủ CHỦ TỊCH: hàng chờ ký (đọc báo cáo rồi ký hoặc trả lại), kỳ đang chuẩn bị, báo cáo đã ký, việc quá hạn. */
export default function SignPage() {
  const qc = useQueryClient();
  const { data: w, isLoading } = useWork();
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const { data: docs = [] } = useQuery<any[]>({ queryKey: ['qlvb-docs-di'], queryFn: () => apiGet('/admin/qlvb/documents?direction=di&limit=50'), refetchInterval: 60_000 });
  const { data: qs } = useQuery<any>({ queryKey: ['qlvb-status'], queryFn: () => apiGet('/admin/qlvb/status') });
  const refresh = () => { ['me-work', 'qlvb-docs-di', 'report-runs', 'report-run'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const fail = (e: any) => setNotice({ tone: 'danger', text: errMsg(e) });
  const sign = useMutation({ mutationFn: async ({ runId, reject }: { runId: number; reject?: string }) => {
    const pend = docs.find((d) => d.run_id === runId && d.sign_status === 'pending');
    if (!pend) throw new Error('Không thấy văn bản trình ký trên QLVB.');
    await api.post(`/admin/qlvb/sim/sign/${pend.id}`, reject ? { reject } : { nguoi_ky: w?.me.full_name ?? 'Chủ tịch UBND phường' });
    return (await api.post(`/admin/qlvb/report-runs/${runId}/check-sign`)).data;
  }, onSuccess: (r) => { setNotice(r.status === 'signed' ? { tone: 'success', text: `Đã ký: số ${r.run.signed_number} ngày ${fmtDate(r.run.signed_date)}. Bộ số của kỳ khoá vĩnh viễn, không ai sửa được.` } : { tone: 'warning', text: 'Đã trả lại Văn phòng để chỉnh sửa.' }); refresh(); }, onError: fail });
  const done = useMutation({ mutationFn: (id: number) => api.patch(`/admin/tasks/${id}/status`, { status: 'done' }).then((r) => r.data), onSuccess: refresh });

  if (isLoading || !w) return <LoadingState />;
  const toSign = w.to_sign ?? []; const drafted = w.drafted ?? []; const open = w.open_runs;
  const sim = qs?.mode === 'sim';

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Chủ tịch UBND" title={`Bàn ký${w.me.full_name ? ` — ${w.me.full_name}` : ''}`} description="Báo cáo Văn phòng trình: đọc trên web (mỗi con số bấm ra nguồn) rồi ký hoặc trả lại. Ký xong bộ số của kỳ khoá vĩnh viễn."
        actions={<Link href="/leadership" className="inline-flex h-10 items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Bảng điều hành</Link>} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Chờ ký" value={toSign.length} sub="báo cáo đã trình" color={toSign.length ? '#B45309' : '#15803D'} />
        <StatTile label="Đang chuẩn bị" value={drafted.length + open.length} sub={`${open.length} đang thu số · ${drafted.length} đã chốt/nháp`} color="#0F3D6E" href="/report-runs" />
        <StatTile label="Số đang cách ly" value={(w.quarantine ?? []).length} sub="toàn đơn vị" color={(w.quarantine ?? []).length ? '#B91C1C' : '#64748B'} href="/facts?view=quarantine" />
        <StatTile label="Việc tôi giao quá hạn" value={w.tasks.overdue} sub={`${w.tasks.open} việc đang mở của tôi`} color={w.tasks.overdue ? '#B91C1C' : '#0F3D6E'} href="/tasks?overdue=1" />
      </div>

      <Panel title={<>Chờ ký <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{toSign.length}</span></>}>
        {toSign.length === 0 ? <EmptyState title="Không có báo cáo nào chờ ký" description="Khi Văn phòng trình ký, báo cáo sẽ hiện ở đây kèm nút đọc và ký." /> : (
          <ul className="divide-y divide-rule">
            {toSign.map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-base2 font-semibold text-ink">{r.spec_title ?? 'Báo cáo'} {r.period_label}</p>
                  <p className="text-xs2 text-ink-muted">Chốt số liệu {fmtDate(r.cutoff_date)}{r.locked_at ? ` · đóng băng ${fmtDate(r.locked_at)}` : ''} · Văn phòng đã trình{sim ? ' (QLVB giả lập)' : ' trên QLVB'}</p>
                  <RunStepper status={r.status} light className="mt-1.5" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/report-runs/${r.run_id}/read`} className="inline-flex h-9 items-center rounded-lg border border-rule bg-white px-3 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Đọc báo cáo</Link>
                  <a href={`${process.env.NEXT_PUBLIC_API_URL}/admin/report-runs/${r.run_id}/download`} className="inline-flex h-9 items-center rounded-lg border border-rule bg-white px-3 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Tải Word</a>
                  {sim && <ToolbarButton variant="ghost" disabled={sign.isPending} onClick={() => { const why = window.prompt('Lý do trả lại Văn phòng:'); if (why) sign.mutate({ runId: r.run_id, reject: why }); }}>Trả lại</ToolbarButton>}
                  {sim && <ToolbarButton variant="primary" loading={sign.isPending} onClick={() => { if (window.confirm(`Ký ${r.spec_title ?? 'báo cáo'} ${r.period_label}? Sau khi ký, bộ số của kỳ khoá vĩnh viễn.`)) sign.mutate({ runId: r.run_id }); }}>Ký</ToolbarButton>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Kỳ đang chuẩn bị">
          {open.length + drafted.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Không có kỳ nào đang làm.</p> : (
            <ul className="divide-y divide-rule">
              {[...open, ...drafted].map((r) => (
                <li key={r.run_id} className="row-hover flex items-center justify-between gap-3 px-5 py-2.5">
                  <div><Link href={`/report-runs/${r.run_id}/read`} className="text-sm2 font-medium text-ink hover:underline">{r.period_label.charAt(0).toUpperCase() + r.period_label.slice(1)}</Link><p className="text-xs2 text-ink-muted">chốt {fmtDate(r.cutoff_date)}{r.status === 'collecting' ? (r.days_left < 0 ? ` · quá hạn ${-r.days_left} ngày` : ` · còn ${r.days_left} ngày`) : ''}</p></div>
                  <Tag preset={RUN_STATUS[r.status]?.preset ?? 'neutral'}>{RUN_STATUS[r.status]?.label ?? r.status}</Tag>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Đã ký gần đây">
          {w.signed.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa có báo cáo nào được ký.</p> : (
            <ul className="divide-y divide-rule">
              {w.signed.map((r) => (
                <li key={r.run_id} className="row-hover flex items-center justify-between gap-3 px-5 py-2.5">
                  <div><Link href={`/report-runs/${r.run_id}/read`} className="text-sm2 font-medium text-ink hover:underline">{r.period_label.charAt(0).toUpperCase() + r.period_label.slice(1)}</Link><p className="text-xs2 text-ink-muted">số {r.signed_number} · ký ngày {fmtDate(r.signed_date)}</p></div>
                  <Tag preset="green">Đã ký</Tag>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title={<>Việc tôi giao đang mở <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{w.tasks.open}</span></>}>
        <TaskList items={w.tasks.items} onDone={(id) => done.mutate(id)} busy={done.isPending} empty="Bạn không có việc nào đang mở." />
      </Panel>
    </div>
  );
}
