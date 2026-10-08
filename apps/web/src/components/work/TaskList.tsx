'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import { dueText } from '@/lib/work';

const PRIORITY: Record<string, string> = { high: 'Gấp', normal: '', low: 'Thấp', urgent: 'Khẩn' };
const SOURCE: Record<string, string> = { report_run: 'từ nhiệm vụ kỳ tới của báo cáo', qlvb: 'từ văn bản QLVB', meeting: 'từ kết luận họp' };

/** Danh sách việc ngắn cho trang chủ theo vai. */
export function TaskList({ items, empty = 'Không có việc nào đang mở.', onDone, busy }: { items: { id: number; code?: string; title: string; due_at: string | null; priority: string; status: string; source_type?: string | null }[]; empty?: string; onDone?: (id: number) => void; busy?: boolean }) {
  if (!items.length) return <p className="px-5 py-4 text-sm2 text-ink-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-rule">
      {items.map((t) => {
        const d = dueText(t.due_at);
        return (
          <li key={t.id} className="row-hover flex items-start justify-between gap-3 px-5 py-2.5">
            <div className="min-w-0">
              <p className="text-sm2 font-medium text-ink">{t.title}{PRIORITY[t.priority] && <span className="ml-2 rounded bg-red-50 px-1.5 py-px text-2xs font-semibold text-red-700">{PRIORITY[t.priority]}</span>}</p>
              <p className={clsx('text-xs2', d.overdue ? 'font-medium text-red-700' : 'text-ink-muted')}>{d.text}{t.source_type && SOURCE[t.source_type] ? ` · ${SOURCE[t.source_type]}` : ''}</p>
            </div>
            {onDone && t.status !== 'done' && <button type="button" disabled={busy} onClick={() => onDone(t.id)} className="shrink-0 text-xs2 font-semibold text-primary-600 hover:underline disabled:opacity-50">Xong</button>}
          </li>
        );
      })}
      <li className="px-5 py-2 text-right"><Link href="/tasks" className="text-xs2 font-medium text-primary-600 hover:underline">Tất cả việc</Link></li>
    </ul>
  );
}
