'use client';

import Link from 'next/link';
import { EmptyState, LoadingState, PageHeader, Panel, Tag } from '@/components/ui/admin-ui';
import { RUN_STATUS, fmtDate } from '@/lib/do360';
import { useWork } from '@/lib/work';

/** Trang chủ HĐND (chỉ đọc): báo cáo đã chốt/đã ký, mở đọc trên web — mỗi con số bấm ra nguồn. Không thấy số đang thu. */
export default function ReadHomePage() {
  const { data: w, isLoading } = useWork();
  if (isLoading || !w) return <LoadingState />;
  const list = (w.readable ?? w.runs).filter((r) => ['locked', 'drafted', 'submitted', 'signed'].includes(r.status));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Hội đồng nhân dân" title="Đọc báo cáo" description="Báo cáo của UBND phường đã chốt số hoặc đã ký. Mở để đọc như văn bản; bấm vào từng con số để thấy nguồn, ngày chốt, ai duyệt."
        actions={<Link href="/leadership" className="inline-flex h-10 items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Bảng điều hành</Link>} />
      {list.length === 0 ? <EmptyState title="Chưa có báo cáo nào đã chốt" description="Kỳ đang thu số chưa hiện ở đây." /> : (
        <Panel title="Báo cáo">
          <ul className="divide-y divide-rule">
            {list.map((r) => (
              <li key={r.run_id} className="row-hover flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/report-runs/${r.run_id}/read`} className="text-base2 font-semibold text-ink hover:underline">{r.spec_title ?? 'Báo cáo'} {r.period_label}</Link>
                  <p className="text-xs2 text-ink-muted">{r.signed_number ? `Số ${r.signed_number} · ký ngày ${fmtDate(r.signed_date)}` : `Chốt số liệu ${fmtDate(r.cutoff_date)}${r.locked_at ? ` · đóng băng ${fmtDate(r.locked_at)}` : ''}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Tag preset={RUN_STATUS[r.status]?.preset ?? 'neutral'}>{RUN_STATUS[r.status]?.label ?? cap(r.period_label)}</Tag>
                  <Link href={`/report-runs/${r.run_id}/read`} className="inline-flex h-9 items-center rounded-lg bg-primary-50 px-3 text-sm2 font-semibold text-primary-700 hover:bg-primary-100">Đọc</Link>
                  {r.signed_number && <a href={`${process.env.NEXT_PUBLIC_API_URL}/admin/report-runs/${r.run_id}/download?which=signed`} className="inline-flex h-9 items-center rounded-lg border border-rule bg-white px-3 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Bản ký</a>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
