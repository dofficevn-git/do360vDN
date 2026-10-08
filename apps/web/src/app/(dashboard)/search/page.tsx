'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { EmptyState, PageHeader, Panel, Tag, TextInput } from '@/components/ui/admin-ui';

/** Tìm kiếm toàn hệ thống (Blueprint mục 57): đối tượng, chỉ tiêu, văn bản, nhiệm vụ, báo cáo, file — kết quả phân biệt Dữ liệu / Tài liệu. Hỏi đáp số liệu không cần mô hình ngôn ngữ. */
function SearchInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [term, setTerm] = useState(sp.get('q') || '');
  const { data, isFetching } = useQuery<any>({ queryKey: ['search', term], queryFn: () => apiGet(`/admin/data/search?q=${encodeURIComponent(term)}`), enabled: term.trim().length >= 2 });
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Dữ liệu" title="Tìm kiếm" description="Gõ tên dự án, hộ kinh doanh, số văn bản, chỉ tiêu (“thu ngân sách”, “hồ sơ một cửa”)… Kết quả phân biệt dữ liệu có cấu trúc và tài liệu nguồn." />
      <form onSubmit={(e) => { e.preventDefault(); setTerm(q); }} className="flex gap-2">
        <TextInput className="h-11 flex-1 text-base2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ví dụ: Dự án A · 253/KH-UBND · thu ngân sách · hộ kinh doanh" autoFocus />
        <button type="submit" className="h-11 rounded-lg bg-primary-500 px-5 text-sm2 font-semibold text-white hover:bg-primary-600">Tìm</button>
      </form>
      {term.length >= 2 && !isFetching && (!data || data.groups.length === 0) && <EmptyState title="Không thấy" description="Thử từ khác hoặc ngắn hơn." />}
      {data?.groups?.map((g: any) => (
        <Panel key={g.key} title={<>{g.name} <Tag preset={g.kind === 'data' ? 'blue' : 'neutral'} className="ml-2">{g.kind === 'data' ? 'Dữ liệu' : 'Tài liệu'}</Tag></>}>
          <ul className="divide-y divide-rule">{g.items.map((it: any, i: number) => <li key={i} className="row-hover px-5 py-2.5 text-sm2"><Link href={it.href} className="font-medium text-ink hover:underline">{it.title}</Link><p className="text-xs2 text-ink-muted">{it.sub}</p></li>)}</ul>
        </Panel>
      ))}
    </div>
  );
}

export default function SearchPage() { return <Suspense fallback={null}><SearchInner /></Suspense>; }
