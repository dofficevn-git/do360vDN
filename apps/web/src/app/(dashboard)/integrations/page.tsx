'use client';

import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, FilterTabs, PageHeader, SelectInput, StatTile, Tag, TextInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg, fmtDate, periodOptions } from '@/lib/do360';
import { periodLabel } from '@/lib/labels';
const MSG_KIND: Record<string, string> = { card: 'thẻ', text: 'tin', file: 'file', action: 'thao tác' };
const MSG_STATUS: Record<string, string> = { sent: 'đã gửi', failed: 'không gửi được', skipped: 'chưa liên kết', handled: 'đã xử lý', ignored: 'bỏ qua', error: 'lỗi' };

type Tab = 'chat' | 'qlvb';

/** Kênh chat (T1/T4 — Zalo OA tạm thay Tammi) và QLVB (D5 — LGSP hoặc giả lập). */
function IntegrationsInner() {
  const qc = useQueryClient();
  const me = currentAdmin();
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || 'chat');
  const periods = periodOptions();
  const [period, setPeriod] = useState(periods[0].code);
  const [cmd, setCmd] = useState('TIEN DO');
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'warning'; text: string } | null>(null);
  const manager = ['super_admin', 'commune_admin'].includes(me.role ?? '');
  const onErr = (e: any) => setNotice({ tone: 'danger', text: errMsg(e) });

  const { data: chat } = useQuery<any>({ queryKey: ['chat-status'], queryFn: () => apiGet('/admin/chat/status'), refetchInterval: 60_000 });
  const { data: messages = [] } = useQuery<any[]>({ queryKey: ['chat-messages'], queryFn: () => apiGet('/admin/chat/messages?limit=60'), enabled: tab === 'chat' && ['super_admin', 'commune_admin', 'leader'].includes(me.role ?? '') });
  const { data: runs = [] } = useQuery<any[]>({ queryKey: ['report-runs'], queryFn: () => apiGet('/admin/report-runs') });
  const { data: qlvb } = useQuery<any>({ queryKey: ['qlvb-status'], queryFn: () => apiGet('/admin/qlvb/status') });
  const { data: docs = [] } = useQuery<any[]>({ queryKey: ['qlvb-docs', period], queryFn: () => apiGet(`/admin/qlvb/documents?period=${period}`), enabled: tab === 'qlvb' });

  const test = useMutation({ mutationFn: () => api.post('/admin/chat/test').then((r) => r.data), onSuccess: (r) => { setNotice({ tone: r.status === 'sent' ? 'info' : 'warning', text: r.status === 'sent' ? 'Đã gửi thẻ thử qua ' + r.channel : r.linked ? 'Kênh không gửi được (token OA?). Tin đã ghi nhật ký.' : 'Tài khoản của bạn chưa liên kết Zalo — tin ghi nhật ký với trạng thái bỏ qua.' }); qc.invalidateQueries({ queryKey: ['chat-messages'] }); qc.invalidateQueries({ queryKey: ['chat-status'] }); }, onError: onErr });
  const remind = useMutation({ mutationFn: (runId: number) => api.post(`/admin/chat/remind/${runId}`).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: r.note ?? `Đã nhắc ${r.depts.length} phòng (${r.sent} tin gửi được) cho kỳ ${r.period}.` }); qc.invalidateQueries({ queryKey: ['chat-messages'] }); }, onError: onErr });
  const remindTasks = useMutation({ mutationFn: () => api.post('/admin/chat/remind-tasks').then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Việc sắp đến hạn trong 48 giờ: ${r.tasks} việc / ${r.recipients} cán bộ, gửi được ${r.sent} tin.` }); qc.invalidateQueries({ queryKey: ['chat-messages'] }); }, onError: onErr });
  const simulate = useMutation({ mutationFn: (text: string) => api.post('/admin/chat/inbound', { type: 'text', text }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: r.handled ? 'info' : 'warning', text: r.handled ? `Bot trả lời: ${r.reply}` : 'Không phải lệnh của Tabot (sẽ đi tiếp luồng khác).' }); qc.invalidateQueries({ queryKey: ['chat-messages'] }); qc.invalidateQueries({ queryKey: ['facts'] }); }, onError: onErr });
  const sync = useMutation({ mutationFn: () => api.post('/admin/qlvb/sync', { period }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Đồng bộ ${r.mode}: ${r.fetched} văn bản, ${r.events_inserted} sự kiện mới, ${r.tasks_created} việc giao, ${r.tasks_completed} việc hoàn thành.` }); qc.invalidateQueries({ queryKey: ['qlvb-docs'] }); }, onError: onErr });
  const sign = useMutation({ mutationFn: (id: number) => api.post(`/admin/qlvb/sim/sign/${id}`, {}).then((r) => r.data), onSuccess: (d) => { setNotice({ tone: 'info', text: `Giả lập đã ký: số ${d.so_ky_hieu} ngày ${fmtDate(d.ngay)}. Vào kỳ báo cáo bấm "Kiểm tra ký".` }); qc.invalidateQueries({ queryKey: ['qlvb-docs'] }); }, onError: onErr });

  const collecting = runs.filter((r) => r.status === 'collecting');

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Tích hợp" title="Kênh chat và QLVB" description="Tabot nhận file, nhắc hạn, thẻ xác nhận qua kênh chat; QLVB cấp sổ văn bản, phân công xử lý và nhận bản ký." />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <FilterTabs<Tab> value={tab} onChange={setTab} items={[{ value: 'chat', label: 'Kênh chat (Tabot)' }, { value: 'qlvb', label: 'QLVB', count: docs.length }]} />

      {tab === 'chat' && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Kênh" value={chat?.channel === 'zalo' ? 'Zalo OA' : chat?.channel ?? '—'} sub={chat?.configured ? 'đã có token OA' : 'chưa có token OA — tin ghi nhật ký, không gửi'} color={chat?.configured ? '#15803D' : '#B45309'} />
            <StatTile label="Cán bộ đã liên kết chat" value={`${chat?.staff_linked ?? 0}/${chat?.staff_total ?? 0}`} sub="admin_users.zalo_follower_id" color="#0F3D6E" href="/accounts" />
            <StatTile label="Tin đã gửi" value={chat?.sent ?? 0} sub={`${chat?.failed ?? 0} không gửi được / bỏ qua`} color="#0F3D6E" />
            <StatTile label="Tin nhận từ cán bộ" value={chat?.inbound ?? 0} sub="file, lệnh XN/SUA/LOAI" color="#6D28D9" />
          </div>
          <div className="card px-5 py-4 text-sm">
            <p className="card-title">Thao tác</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ToolbarButton onClick={() => test.mutate()} disabled={test.isPending}>Gửi thẻ thử cho tôi</ToolbarButton>
              {manager && collecting.map((r) => <ToolbarButton key={r.run_id} variant="primary" onClick={() => remind.mutate(r.run_id)} disabled={remind.isPending}>Nhắc phòng còn thiếu — {periodLabel(r.period)}</ToolbarButton>)}
              {manager && <ToolbarButton onClick={() => remindTasks.mutate()} disabled={remindTasks.isPending}>Nhắc việc sắp đến hạn</ToolbarButton>}
              <span className="ml-2 text-xs text-ink-muted">Giả lập cán bộ nhắn vào bot (dưới danh nghĩa tôi):</span>
              <TextInput value={cmd} onChange={(e) => setCmd(e.target.value)} className="w-56" />
              <ToolbarButton variant="ghost" onClick={() => simulate.mutate(cmd)} disabled={simulate.isPending}>Gửi</ToolbarButton>
            </div>
            <p className="mt-2 text-xs text-ink-muted">Lệnh cán bộ dùng trong chat: <code>XN &lt;mã&gt;</code> xác nhận · <code>SUA &lt;mã&gt; = &lt;số&gt;</code> sửa · <code>LOAI &lt;mã&gt; &lt;lý do&gt;</code> loại · <code>NHAP &lt;mã chỉ tiêu&gt; = &lt;số&gt; [kỳ]</code> nhập số không có file · <code>TIEN DO</code> chỉ tiêu còn thiếu. Gửi file kèm mã kỳ (vd 2026-Q3) để bóc số. Nhắc tự động 08:00 hằng ngày cho kỳ đang thu số, 07:30 cho việc sắp đến hạn. Liên kết mở màn: {chat?.web_url}</p>
          </div>
          <DataTable>
            <table className="w-full text-sm"><thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Lúc</th><th className={TABLE_TH_CLS}>Chiều</th><th className={TABLE_TH_CLS}>Loại</th><th className={TABLE_TH_CLS}>Cán bộ</th><th className={TABLE_TH_CLS}>Nội dung</th><th className={TABLE_TH_CLS}>Kết quả</th></tr></thead>
              <tbody className="divide-y divide-rule">{messages.map((m) => <tr key={m.id}><td className={`${TABLE_TD_CLS} text-xs text-ink-muted`}>{new Date(m.created_at).toLocaleString('vi-VN')}</td><td className={TABLE_TD_CLS}>{m.direction === 'out' ? 'Bot →' : '→ Bot'}</td><td className={TABLE_TD_CLS}>{MSG_KIND[m.kind] ?? m.kind}</td><td className={`${TABLE_TD_CLS} text-xs2`}>{m.admin_id ? 'cán bộ' : '—'}</td><td className={`${TABLE_TD_CLS} max-w-xl truncate`} title={JSON.stringify(m.body)}>{m.title}</td><td className={TABLE_TD_CLS}><Tag preset={m.status === 'sent' || m.status === 'handled' ? 'green' : m.status === 'skipped' ? 'neutral' : 'red'}>{MSG_STATUS[m.status] ?? m.status}</Tag>{m.error && <p className="text-xs text-red-700">{m.error}</p>}</td></tr>)}
                {!messages.length && <tr><td className={`${TABLE_TD_CLS} text-ink-faint`} colSpan={6}>Chưa có tin nào.</td></tr>}</tbody></table>
          </DataTable>
        </>
      )}

      {tab === 'qlvb' && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Chế độ" value={qlvb?.mode === 'lgsp' ? 'LGSP Đà Nẵng' : 'Giả lập'} sub={qlvb?.note ?? (qlvb?.mode === 'lgsp' ? qlvb?.organ_id : 'QLVB_MODE=sim')} color={qlvb?.configured ? '#15803D' : '#B45309'} />
            <StatTile label="API trình ký" value={qlvb?.sign_api ?? '—'} sub="LGSP QLVBDH 1.0 chỉ có chiều đọc" color="#0F3D6E" />
            <StatTile label="Văn bản trong kỳ" value={docs.length} sub={`${docs.filter((d) => d.direction === 'den').length} đến · ${docs.filter((d) => d.direction === 'di').length} đi`} color="#0F3D6E" />
            <StatTile label="Chờ ký" value={docs.filter((d) => d.sign_status === 'pending').length} sub="văn bản DO360 đã trình" color="#B45309" />
          </div>
          <div className="card px-5 py-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <SelectInput value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</SelectInput>
              {manager && <ToolbarButton variant="primary" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? 'Đang đồng bộ…' : 'Đồng bộ sổ văn bản kỳ này'}</ToolbarButton>}
              <span className="text-xs text-ink-muted">Sổ đi/đến → sự kiện chỉ đạo (event_log); văn bản đến có người xử lý → giao việc. Tự chạy 02:00 khi nối LGSP. Trình ký / kiểm tra ký ở trang <Link className="underline" href="/report-runs">Kỳ báo cáo</Link>.</span>
            </div>
          </div>
          <DataTable>
            <table className="w-full text-sm"><thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Chiều</th><th className={TABLE_TH_CLS}>Số ký hiệu</th><th className={TABLE_TH_CLS}>Ngày</th><th className={TABLE_TH_CLS}>Loại</th><th className={TABLE_TH_CLS}>Trích yếu</th><th className={TABLE_TH_CLS}>Lĩnh vực</th><th className={TABLE_TH_CLS}>Người xử lý · hạn</th><th className={TABLE_TH_CLS}>Nguồn</th><th className="px-3 py-1.5 text-right"></th></tr></thead>
              <tbody className="divide-y divide-rule">{docs.map((d) => <tr key={d.id} className="row-hover"><td className={TABLE_TD_CLS}>{d.direction === 'den' ? 'Đến' : 'Đi'}</td><td className={`${TABLE_TD_CLS} font-medium`}>{d.so_ky_hieu ?? <i className="text-ink-faint">chưa cấp số</i>}</td><td className={`${TABLE_TD_CLS} text-xs`}>{fmtDate(d.ngay)}</td><td className={TABLE_TD_CLS}>{d.loai ?? '—'}</td><td className={`${TABLE_TD_CLS} max-w-md`}>{d.trich_yeu}</td><td className={`${TABLE_TD_CLS} text-xs`}>{d.domain ?? '—'}</td><td className={`${TABLE_TD_CLS} text-xs`}>{d.nguoi_xu_ly_email ?? '—'}{d.han_xu_ly ? ` · ${fmtDate(d.han_xu_ly)}` : ''}{d.ngay_hoan_thanh ? ` · xong ${fmtDate(d.ngay_hoan_thanh)}` : ''}</td><td className={`${TABLE_TD_CLS} text-xs`}>{d.source}{d.sign_status && <Tag preset={d.sign_status === 'signed' ? 'green' : d.sign_status === 'pending' ? 'gold' : 'red'}>{d.sign_status}</Tag>}</td>
                <td className="px-3 py-1.5 text-right">{manager && qlvb?.mode === 'sim' && d.sign_status === 'pending' && <ToolbarButton variant="primary" onClick={() => sign.mutate(d.id)}>Ký (giả lập)</ToolbarButton>}</td></tr>)}
                {!docs.length && <tr><td className={`${TABLE_TD_CLS} text-ink-faint`} colSpan={9}>Chưa có văn bản kỳ này — đồng bộ hoặc (giả lập) nạp qua API /admin/qlvb/sim/documents.</td></tr>}</tbody></table>
          </DataTable>
        </>
      )}
    </div>
  );
}

export default function IntegrationsPage() { return <Suspense><IntegrationsInner /></Suspense>; }
