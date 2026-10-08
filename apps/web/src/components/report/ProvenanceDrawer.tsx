'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { Tag, TechDetails } from '@/components/ui/admin-ui';
import { FACT_STATUS, fmtDate, fmtNum } from '@/lib/do360';
import { CAPTURE_HINT, useLabels } from '@/lib/labels';

/** Một con số trong báo cáo: mảnh `ref` do bộ sinh trả về (indicator, fact_id, nguồn, người duyệt, so sánh…). */
export type NumberRef = {
  indicator_id?: string; indicator_ids?: string[]; fact_id?: string; value?: number; unit?: string; name?: string; as_of_date?: string;
  capture_method?: string; source_ref?: any; approved_by?: number | null; version?: number; formula?: string; plan?: any; compare?: any;
};

/**
 * Ngăn "Nguồn của con số": giá trị, file và ô/trang, câu gốc, bậc thu thập, ai xác nhận/duyệt, lịch sử phiên bản, so kế hoạch/cùng kỳ.
 * Dùng chung cho trang Đọc báo cáo, bảng Số liệu kỳ và bảng điều hành.
 */
export function ProvenanceDrawer({ open, onClose, refData, period, kind, text }: { open: boolean; onClose: () => void; refData: NumberRef | null; period: string; kind?: string; text?: string }) {
  const lb = useLabels();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const indId = refData?.indicator_id;
  const { data: hist } = useQuery<any>({ queryKey: ['fact-history', indId, period], queryFn: () => apiGet(`/admin/facts/history?indicator_id=${encodeURIComponent(indId!)}&period=${period}`), enabled: open && !!indId });
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open || !refData) return null;
  const sr = refData.source_ref ?? {};
  const versions: any[] = hist?.versions ?? [];
  const current = versions.find((v) => String(v.id) === String(refData.fact_id)) ?? versions[versions.length - 1];
  const logs: any[] = hist?.logs ?? [];
  const who = (id?: number | null) => (id ? `tài khoản #${id}` : '—');
  const derived = kind === 'ratio' || kind === 'plan' || kind === 'yoy' || kind === 'prev';

  return (
    <div className="fixed inset-0 z-modal flex justify-end bg-slate-900/35" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Nguồn của con số" className="fade-in-up flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs2 font-medium text-ink-faint">Nguồn của con số</p>
            <p className="kpi-num mt-0.5 text-[26px] font-bold leading-none text-ink">{text ?? (refData.value != null ? fmtNum(refData.value, current?.value_type) : '—')}</p>
            <p className="mt-1 text-sm2 font-medium text-ink-2">{refData.name ?? lb.ind(indId)}{refData.unit ? <span className="text-ink-muted"> · {refData.unit}</span> : null}</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-slate-100 hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm2">
          {derived && (
            <section>
              <p className="text-xs2 font-semibold text-ink-muted">Cách tính</p>
              <p className="mt-1 text-ink-2">{refData.formula ?? '—'}</p>
              {refData.plan && <p className="mt-1 text-xs2 text-ink-muted">Kế hoạch năm {refData.plan.year}: <b className="kpi-num">{fmtNum(refData.plan.value, current?.value_type)}</b>{refData.plan.source_ref?.so_ky_hieu ? ` · giao tại ${refData.plan.source_ref.so_ky_hieu}` : ''}</p>}
              {refData.compare && <p className="mt-1 text-xs2 text-ink-muted">Số so sánh: <b className="kpi-num">{fmtNum(refData.compare.value, current?.value_type)}</b> ({lb.period(refData.compare.period)})</p>}
            </section>
          )}
          <section className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div><p className="text-xs2 font-semibold text-ink-muted">Ngày chốt số liệu</p><p className="kpi-num">{fmtDate(refData.as_of_date ?? current?.as_of_date)}</p></div>
            <div><p className="text-xs2 font-semibold text-ink-muted">Trạng thái</p>{current ? <Tag preset={FACT_STATUS[current.status as keyof typeof FACT_STATUS]?.preset ?? 'neutral'}>{FACT_STATUS[current.status as keyof typeof FACT_STATUS]?.label ?? current.status}</Tag> : '—'}</div>
            <div className="col-span-2"><p className="text-xs2 font-semibold text-ink-muted">Cách thu thập</p><p>{lb.capture(refData.capture_method ?? current?.capture_method ?? '')}</p><p className="text-xs2 text-ink-faint">{CAPTURE_HINT[refData.capture_method ?? current?.capture_method ?? '']}</p></div>
          </section>
          <section>
            <p className="text-xs2 font-semibold text-ink-muted">Vị trí trong nguồn</p>
            {sr.file_id ? (
              <p className="mt-1">File gốc <a className="font-medium text-primary-600 hover:underline" href={`${apiUrl}/admin/files/${sr.file_id}/download`} target="_blank" rel="noreferrer">tải về</a>{sr.sheet ? ` · sheet ${sr.sheet}` : ''}{sr.cell ? ` · ô ${sr.cell}` : ''}{sr.page ? ` · trang ${sr.page}` : ''}</p>
            ) : <p className="mt-1 text-ink-muted">{sr.system ? `Nguồn: ${String(sr.system).replace(/^form:?/, 'nhập tay ')}` : 'Nhập trực tiếp, không có file gốc.'}</p>}
            {sr.snippet && <blockquote className="mt-2 rounded-md border-l-4 border-rule-strong bg-slate-50 px-3 py-2 text-xs2 italic text-ink-3">“{String(sr.snippet).slice(0, 240)}”</blockquote>}
            {sr.rule && <p className="mt-1 text-xs2 text-ink-faint">Luật bóc tách: {sr.rule}</p>}
          </section>
          {current && (
            <section>
              <p className="text-xs2 font-semibold text-ink-muted">Ai làm gì</p>
              <ul className="mt-1 space-y-1 text-xs2 text-ink-3">
                <li>Nộp/bóc: {who(current.created_by)} · {fmtDate(current.created_at)}</li>
                {current.confirmed_by && <li>Xác nhận: {who(current.confirmed_by)} · {fmtDate(current.confirmed_at)}</li>}
                {current.approved_by && <li>Duyệt: {who(current.approved_by)} · {fmtDate(current.approved_at)}</li>}
                {current.locked_by && <li>Chốt kỳ: {who(current.locked_by)} · {fmtDate(current.locked_at)}</li>}
              </ul>
            </section>
          )}
          {versions.length > 1 && (
            <section>
              <p className="text-xs2 font-semibold text-ink-muted">Lịch sử phiên bản (không ghi đè)</p>
              <ul className="mt-1 space-y-1">
                {versions.map((v) => <li key={v.id} className={`flex items-center justify-between rounded-md px-2 py-1 text-xs2 ${String(v.id) === String(current?.id) ? 'bg-primary-50 text-ink' : 'text-ink-muted'}`}><span>Phiên bản {v.version} · <b className="kpi-num">{fmtNum(Number(v.value), v.value_type)}</b></span><span>{FACT_STATUS[v.status as keyof typeof FACT_STATUS]?.label ?? v.status}{v.note ? ` · ${String(v.note).slice(0, 60)}` : ''}</span></li>)}
              </ul>
            </section>
          )}
          {logs.length > 0 && (
            <section>
              <p className="text-xs2 font-semibold text-ink-muted">Nhật ký trạng thái</p>
              <ul className="mt-1 space-y-0.5 text-xs2 text-ink-muted">{logs.slice(-8).map((l) => <li key={l.id}>{fmtDate(l.created_at)}: {l.from_status ? `${FACT_STATUS[l.from_status as keyof typeof FACT_STATUS]?.label ?? l.from_status} → ` : ''}{FACT_STATUS[l.to_status as keyof typeof FACT_STATUS]?.label ?? l.to_status}{l.reason ? ` — ${l.reason}` : ''}</li>)}</ul>
            </section>
          )}
          <TechDetails>{indId ?? refData.indicator_ids?.join(' / ')} · mã số liệu {refData.fact_id ?? '—'} · phiên bản {refData.version ?? current?.version ?? '—'}</TechDetails>
        </div>
      </aside>
    </div>
  );
}
