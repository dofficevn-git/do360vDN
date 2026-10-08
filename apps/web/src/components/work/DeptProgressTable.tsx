'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import { Tag, ProgressBar } from '@/components/ui/admin-ui';
import { fmtDate } from '@/lib/do360';
import type { Progress } from '@/lib/work';

const STATE: Record<string, { label: string; preset: 'green' | 'gold' | 'red' | 'neutral' | 'blue' }> = {
  done: { label: 'Đủ số đã duyệt', preset: 'green' }, in_progress: { label: 'Đang nộp', preset: 'blue' }, not_started: { label: 'Chưa nộp', preset: 'red' }, none: { label: '—', preset: 'neutral' },
};

/** Bảng tiến độ theo bộ phận của một kỳ (Văn phòng): ai nợ số, nợ gì, đã nhắc mấy lần, nút nhắc. */
export function DeptProgressTable({ progress, onRemind, reminding }: { progress: Progress; onRemind?: () => void; reminding?: boolean }) {
  const rows = progress.departments;
  return (
    <div className="tbl-wrap">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs2 font-semibold text-ink-muted">
          <tr>
            <th className="px-4 py-2.5 text-left">Bộ phận</th>
            <th className="px-3 py-2.5 text-left">Số liệu</th>
            <th className="px-3 py-2.5 text-left">Còn thiếu / chờ</th>
            <th className="px-3 py-2.5 text-center">Cách ly</th>
            <th className="px-3 py-2.5 text-center">File</th>
            <th className="px-3 py-2.5 text-center">Đã nhắc</th>
            <th className="px-3 py-2.5 text-right">Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((d) => {
            const c = d.indicators; const pct = c.total ? Math.round((c.approved / c.total) * 100) : 0;
            return (
              <tr key={d.key} className={clsx('row-hover align-top', d.state === 'not_started' && 'bg-red-50/40')}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink">{d.name}</p>
                  <p className="text-xs2 text-ink-muted">{d.head ? <>Đại diện: {d.head.full_name}</> : <span className="text-amber-700">chưa gán người đại diện</span>}</p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2"><span className="kpi-num font-semibold text-ink">{c.approved}/{c.total}</span><ProgressBar percent={pct} color={pct === 100 ? '#15803D' : '#0F3D6E'} className="w-24" label={`${d.name}: ${pct}%`} /></div>
                  <p className="mt-0.5 text-xs2 text-ink-muted">{c.confirmed ? `${c.confirmed} chờ duyệt` : ''}{c.confirmed && c.extracted ? ' · ' : ''}{c.extracted ? `${c.extracted} chờ xác nhận` : ''}{!c.confirmed && !c.extracted ? (c.missing ? `${c.missing} chưa có số` : 'đã duyệt đủ') : ''}</p>
                </td>
                <td className="max-w-[320px] px-3 py-3 text-xs2 text-ink-3">
                  {d.missing_names.length > 0 && <p><span className="font-medium text-red-700">Chưa có: </span>{d.missing_names.join(', ')}{c.missing > d.missing_names.length ? '…' : ''}</p>}
                  {d.waiting_names.length > 0 && <p><span className="font-medium text-amber-700">Chờ xử lý: </span>{d.waiting_names.join(', ')}</p>}
                  {!d.missing_names.length && !d.waiting_names.length && <span className="text-ink-faint">—</span>}
                </td>
                <td className="kpi-num px-3 py-3 text-center">{d.quarantined ? <Link href="/facts?view=quarantine" className="font-semibold text-red-700 hover:underline">{d.quarantined}</Link> : <span className="text-ink-faint">0</span>}</td>
                <td className="kpi-num px-3 py-3 text-center" title={d.last_file_at ? `gần nhất ${fmtDate(d.last_file_at)}` : ''}>{d.files || <span className="text-ink-faint">0</span>}</td>
                <td className="kpi-num px-3 py-3 text-center" title={d.last_remind_at ? `lần cuối ${fmtDate(d.last_remind_at)}` : ''}>{d.reminds || <span className="text-ink-faint">0</span>}</td>
                <td className="px-3 py-3 text-right"><Tag preset={STATE[d.state].preset}>{STATE[d.state].label}</Tag></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {onRemind && (
        <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5 text-xs2 text-ink-muted">
          <span><span className="kpi-num font-semibold text-ink">{progress.totals.done}/{progress.totals.depts}</span> bộ phận đủ số · <span className="kpi-num">{progress.totals.slots_complete}/{progress.totals.slots_total}</span> mục báo cáo đủ</span>
          <button type="button" onClick={onRemind} disabled={reminding} className="h-8 rounded-lg border border-rule bg-white px-3 text-xs2 font-semibold text-ink-2 transition-colors hover:bg-slate-50 disabled:opacity-60">{reminding ? 'Đang nhắc…' : 'Nhắc các bộ phận còn thiếu'}</button>
        </div>
      )}
    </div>
  );
}
