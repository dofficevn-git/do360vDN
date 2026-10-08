'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import type { NumberRef } from './ProvenanceDrawer';

export type Segment = { kind: string; text: string; ref?: NumberRef };
export type RenderedSlot = { slot_code: string; title: string | null; section: string; slot_type: string; text: string; segments: Segment[]; missing: string[]; table?: { columns: string[]; rows: (string | number | null)[][] } | null; footnotes?: string[] };
export type DocumentTree = { title: string; period_label: string; cutoff: string; sections: { code: string; title: string; depth: number; slots: RenderedSlot[] }[]; footnotes: string[] };

const KIND_CLS: Record<string, string> = {
  number: 'border-primary-300 text-primary-700 hover:bg-primary-50',
  ratio: 'border-emerald-300 text-emerald-800 hover:bg-emerald-50',
  plan: 'border-amber-300 text-amber-800 hover:bg-amber-50',
  yoy: 'border-cyan-300 text-cyan-800 hover:bg-cyan-50',
  prev: 'border-cyan-300 text-cyan-800 hover:bg-cyan-50',
};

/** Một con số trong văn bản: nút bấm mở ngăn Nguồn. Màu viền theo loại (số gốc, tỷ lệ, so kế hoạch, so cùng kỳ). */
export function NumberChip({ seg, onOpen }: { seg: Segment; onOpen: (seg: Segment) => void }) {
  return (
    <button type="button" onClick={() => onOpen(seg)} title="Xem nguồn của con số"
      className={clsx('kpi-num mx-px inline rounded border-b-2 border-dotted px-0.5 font-semibold transition-colors', KIND_CLS[seg.kind] ?? KIND_CLS.number)}>
      {seg.text}
    </button>
  );
}

export function SegmentsText({ segments, onOpen }: { segments: Segment[]; onOpen: (seg: Segment) => void }) {
  return <>{segments.map((s, i) => (s.kind === 'text' || s.kind === 'period' || s.kind === 'date' || !s.ref ? <span key={i}>{s.text}</span> : <NumberChip key={i} seg={s} onOpen={onOpen} />))}</>;
}

/**
 * Trang văn bản: tiêu đề, kỳ, mục con theo cây `sections`, mỗi slot là một đoạn; lời dẫn trống hiện khung mời biên tập.
 * `renderNarrative` cho phép trang cha chèn ô soạn tại chỗ cho slot lời dẫn.
 */
export function ReportDocument({ doc, unitName, onOpen, renderNarrative, issuesBySlot, signedNumber, signedDate }: {
  doc: DocumentTree; unitName: string; onOpen: (seg: Segment) => void; renderNarrative?: (slot: RenderedSlot) => ReactNode; issuesBySlot?: Record<string, ReactNode>; signedNumber?: string | null; signedDate?: string | null;
}) {
  let fn = 0;
  return (
    <article className="mx-auto max-w-[820px] bg-white px-8 py-10 text-[15px] leading-[1.7] text-ink shadow-sm md:px-14 md:py-14" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
      <div className="grid grid-cols-5 gap-4 text-center text-[13px]">
        <div className="col-span-2"><p className="uppercase">{unitName}</p><p className="mt-1">Số: {signedNumber ?? '        /BC-UBND'}</p></div>
        <div className="col-span-3"><p className="font-bold uppercase">Cộng hòa xã hội chủ nghĩa Việt Nam</p><p className="font-bold">Độc lập - Tự do - Hạnh phúc</p><p className="mt-1 italic">{signedDate ? `ngày ${signedDate}` : 'ngày … tháng … năm'}</p></div>
      </div>
      <h1 className="mt-8 text-center text-[17px] font-bold uppercase">Báo cáo</h1>
      <p className="text-center font-bold">{doc.title.replace(/^Báo cáo\s+/i, '')} {doc.period_label}</p>
      <p className="mb-6 text-center text-[13px] italic">(Số liệu tính đến ngày {doc.cutoff})</p>

      {doc.sections.map((sec) => (
        <section key={sec.code} id={`sec-${sec.code}`} className={clsx(sec.depth === 1 ? 'mt-6' : 'mt-3')}>
          {sec.title && <h2 className={clsx('scroll-mt-20', sec.depth === 1 ? 'text-[15px] font-bold uppercase' : sec.depth === 2 ? 'font-bold' : 'italic')}>{sec.code}. {sec.title}</h2>}
          {sec.slots.map((s) => {
            const issues = issuesBySlot?.[s.slot_code];
            if (s.slot_type === 'metric_table' && s.table) {
              return (
                <div key={s.slot_code} className="my-3">
                  <p className="italic">{s.title ?? 'Bảng tổng hợp'}</p>
                  <table className="mt-1 w-full border-collapse text-[13px]">
                    <thead><tr>{s.table.columns.map((c) => <th key={c} className="border border-slate-400 px-2 py-1 text-center font-bold">{c}</th>)}</tr></thead>
                    <tbody>{s.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={clsx('border border-slate-400 px-2 py-1', j === 0 ? 'text-left' : 'kpi-num text-right')}>{j === 1 && s.segments[i] ? <NumberChip seg={s.segments[i]} onOpen={onOpen} /> : (v ?? '—')}</td>)}</tr>)}</tbody>
                  </table>
                  {issues}
                </div>
              );
            }
            if (s.slot_type === 'narrative' || s.slot_type === 'next_tasks') {
              return (
                <div key={s.slot_code} className="my-2">
                  {renderNarrative ? renderNarrative(s) : s.text ? <p className="indent-8 text-justify">{s.text}</p> : <p className="indent-8 italic text-ink-faint">[{s.section}{s.title ? ` ${s.title}` : ''}] Văn phòng chưa biên tập.</p>}
                  {issues}
                </div>
              );
            }
            if (!s.text) return null;
            const notes = s.footnotes ?? [];
            return (
              <div key={s.slot_code} className="my-2">
                <p className="indent-8 text-justify"><SegmentsText segments={s.segments} onOpen={onOpen} />{notes.map((n) => { fn += 1; return <sup key={n} className="ml-0.5 text-[11px] text-ink-muted" title={n}>{fn}</sup>; })}</p>
                {issues}
              </div>
            );
          })}
        </section>
      ))}

      {doc.footnotes.length > 0 && (
        <footer className="mt-8 border-t border-slate-400 pt-2 text-[12px] text-ink-3">
          {doc.footnotes.map((f, i) => <p key={i}><sup>{i + 1}</sup> {f}</p>)}
        </footer>
      )}
      <div className="mt-10 grid grid-cols-2 text-[13px]">
        <div><p className="font-bold italic">Nơi nhận:</p><p>- UBND thành phố (để báo cáo);</p><p>- TT Đảng ủy, TT HĐND;</p><p>- Lưu: VT.</p></div>
        <div className="text-center font-bold"><p>TM. ỦY BAN NHÂN DÂN</p><p>CHỦ TỊCH</p></div>
      </div>
    </article>
  );
}
