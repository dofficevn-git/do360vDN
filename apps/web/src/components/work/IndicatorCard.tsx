'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import { Tag } from '@/components/ui/admin-ui';
import { fmtDate, fmtNum } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

export type ExecCard = {
  indicator: string; name: string; unit: string; value_type: string; label: string | null; value: number | null;
  pair: { indicator: string; name: string; value: number } | null; plan: { value: number; source_ref: any } | null; pct: number | null; trend: number | null; prev_label: string | null;
  as_of_date: string | null; fact_status: string | null; status: 'dat' | 'theo_doi' | 'canh_bao' | 'thieu' | 'co_so';
  source: { capture: string; file_id: number | null; rule: string | null; system: string | null; cell: string | null; page: number | null; fact_id: string } | null;
  owner_dept: string | null; owner_dept_name: string | null; related_tasks: number; drill: string | null; lower_is_better: boolean; data_health?: number | null;
  breakdown: { indicator: string; name: string; value: number | null }[] | null; funnel: { indicator: string; name: string; value: number | null }[] | null;
};

const STATUS: Record<string, { label: string; preset: 'green' | 'gold' | 'red' | 'neutral' | 'blue' }> = {
  dat: { label: 'Đạt', preset: 'green' }, theo_doi: { label: 'Cần theo dõi', preset: 'gold' }, canh_bao: { label: 'Cảnh báo', preset: 'red' }, thieu: { label: 'Thiếu số', preset: 'neutral' }, co_so: { label: 'Có số', preset: 'blue' },
};

/** Thẻ chỉ tiêu "Mục tiêu – Thực hiện – Rủi ro – Hành động" (Blueprint mục 51): một con số luôn đi cùng kế hoạch, xu hướng, ngày chốt, nguồn, phòng chủ, việc liên quan. */
export function IndicatorCard({ c, period, onSource }: { c: ExecCard; period: string; onSource?: (c: ExecCard) => void }) {
  const lb = useLabels();
  const st = STATUS[c.status];
  const pctColor = c.pct === null ? '' : c.status === 'dat' ? 'text-emerald-700' : c.status === 'canh_bao' ? 'text-red-700' : 'text-amber-700';
  return (
    <div className={clsx('card flex flex-col gap-2 p-4', c.status === 'canh_bao' && 'border-red-200', c.status === 'thieu' && 'border-dashed')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm2 font-medium leading-snug text-ink-2">{c.label ?? c.name}</p>
        <Tag preset={st.preset}>{st.label}</Tag>
      </div>
      <div className="flex items-baseline gap-2">
        {c.value === null ? <span className="text-xl font-semibold text-ink-faint">—</span> : (
          <button type="button" onClick={() => onSource?.(c)} className="kpi-num text-left text-[24px] font-bold leading-none tracking-[-0.4px] text-ink underline decoration-dotted decoration-primary-300 underline-offset-4 hover:text-primary-700" title="Bấm để xem nguồn của con số">
            {c.data_health != null ? `${c.data_health}%` : fmtNum(c.pair ? c.pair.value : c.value, c.value_type)}
          </button>
        )}
        {c.pair && c.value !== null && <span className="kpi-num text-sm2 text-ink-muted">/ {fmtNum(c.value, c.value_type)} {c.unit}</span>}
        {!c.pair && c.value !== null && c.data_health == null && <span className="text-xs2 text-ink-muted">{c.unit}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs2">
        {c.plan && <><span className="text-ink-muted">Kế hoạch năm</span><span className="kpi-num text-right text-ink-2">{fmtNum(c.plan.value, c.value_type)}</span></>}
        {c.pct !== null && <><span className="text-ink-muted">{c.plan ? 'Đạt kế hoạch' : 'Tỷ lệ'}</span><span className={clsx('kpi-num text-right font-semibold', pctColor)}>{c.pct.toLocaleString('vi-VN')}%</span></>}
        {c.trend !== null && <><span className="text-ink-muted">So {c.prev_label ?? 'kỳ trước'}</span><span className={clsx('kpi-num text-right', c.trend >= 0 ? 'text-emerald-700' : 'text-red-700')}>{c.trend >= 0 ? '↑' : '↓'} {Math.abs(c.trend).toLocaleString('vi-VN')}%</span></>}
        {c.as_of_date && <><span className="text-ink-muted">Ngày chốt</span><span className="kpi-num text-right text-ink-2">{fmtDate(c.as_of_date)}{c.fact_status && c.fact_status !== 'locked' && c.fact_status !== 'approved' ? <span className="ml-1 text-amber-700">({lb.factStatus(c.fact_status)})</span> : null}</span></>}
        {c.source && <><span className="text-ink-muted">Nguồn</span><span className="truncate text-right text-ink-2">{lb.capture(c.source.capture)}{c.source.cell ? ` · ${c.source.cell}` : c.source.page ? ` · trang ${c.source.page}` : ''}</span></>}
        {c.owner_dept_name && <><span className="text-ink-muted">Phòng chủ</span><span className="truncate text-right text-ink-2">{c.owner_dept_name}</span></>}
      </div>
      {c.breakdown && c.breakdown.some((b) => b.value !== null) && (
        <p className="text-xs2 text-ink-muted">{c.breakdown.filter((b) => b.value !== null).map((b) => `${b.name.replace(/ đã ban hành$/, '')} ${fmtNum(b.value!, 'integer')}`).join(' · ')}</p>
      )}
      {c.funnel && c.funnel.some((b) => b.value !== null) && (
        <ol className="mt-1 space-y-1">
          {c.funnel.filter((b) => b.value !== null).map((b, i, arr) => { const max = Math.max(...arr.map((x) => x.value!)); const w = max ? Math.max(4, Math.round((b.value! / max) * 100)) : 0; return (
            <li key={b.indicator} className="flex items-center gap-2 text-xs2"><span className="w-36 truncate text-ink-muted" title={b.name}>{b.name.replace(/^Số hồ sơ |^Tổng số hồ sơ /, '')}</span><span className="h-2 rounded bg-primary-500/70" style={{ width: `${w}%` }} /><span className="kpi-num text-ink-2">{fmtNum(b.value!, 'integer')}</span></li>); })}
        </ol>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs2">
        {c.related_tasks > 0 && <Link href={`/tasks`} className="font-medium text-primary-600 hover:underline">{c.related_tasks} việc liên quan</Link>}
        {c.drill && <Link href={`/objects?type=${c.drill}`} className="font-medium text-primary-600 hover:underline">Danh sách đối tượng</Link>}
        <Link href={`/data-map?indicator=${encodeURIComponent(c.indicator)}`} className="text-ink-muted hover:underline">Nguồn dữ liệu</Link>
        {c.status === 'thieu' && <Link href={`/facts?period=${period}`} className="font-medium text-amber-700 hover:underline">Nộp số</Link>}
      </div>
    </div>
  );
}
