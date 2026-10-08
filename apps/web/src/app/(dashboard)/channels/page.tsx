'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, FormField, Modal, PageHeader, Panel, SelectInput, Tag, TextInput, TextareaInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { errMsg, fmtDate } from '@/lib/do360';

const SCOPE: Record<string, string> = { EXECUTIVE: 'Ban lãnh đạo', DEPARTMENT: 'Phòng, bộ phận', REPORTING: 'Báo cáo', PROJECT: 'Dự án', TOPIC: 'Chuyên đề' };

/** Zalo và kênh tương tác chính danh (Blueprint mục 46–48, 65–69): đăng nhập bằng Zalo, OA gửi thông báo qua cổng an toàn, nhóm do OA sở hữu; không Mini App. */
export default function ChannelsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ key: '', name: '', scope_type: 'TOPIC', external_group_id: '', classification_allowed: 'INTERNAL', member_rules: '' });
  const [test, setTest] = useState({ title: 'DO360 | NHIỆM VỤ SẮP QUÁ HẠN', lines: 'Rà soát hồ sơ GPMB Dự án A\nHạn: 16:00 10/10/2026\nPhụ trách: Nguyễn Văn A' });
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'warning' | 'success'; text: string } | null>(null);
  const { data: chat } = useQuery<any>({ queryKey: ['chat-status'], queryFn: () => apiGet('/admin/chat/status') });
  const { data: channels = [], isLoading } = useQuery<any[]>({ queryKey: ['channels'], queryFn: () => apiGet('/admin/data/channels') });
  const { data: messages = [] } = useQuery<any[]>({ queryKey: ['chat-messages'], queryFn: () => apiGet('/admin/chat/messages?limit=40') });
  const save = useMutation({ mutationFn: () => api.post('/admin/data/channels', { ...form, member_rules: form.member_rules.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean) }).then((r) => r.data), onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['channels'] }); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const gate = useMutation({ mutationFn: () => api.post('/admin/chat/gateway-check', { title: test.title, lines: test.lines.split('\n') }).then((r) => r.data), onSuccess: (r) => setNotice(r.allowed ? { tone: 'success', text: `Được gửi${r.truncated ? ' (đã cắt bớt)' : ''}: ${r.sent_card.title} — ${r.sent_card.lines.join(' / ')}` } : { tone: 'warning', text: `Cổng CHẶN (${r.reasons.join(', ')}). Zalo chỉ nhận: “${r.sent_card.lines[0]}”` }) });
  const digest = useMutation({ mutationFn: () => api.post('/admin/chat/digest').then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'info', text: `Đã tạo bản tổng hợp đầu ngày: ${r[0]?.card?.lines?.join(' · ')}` }); qc.invalidateQueries({ queryKey: ['chat-messages'] }); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Quản trị" title="Zalo, kênh tương tác" description="Zalo xác thực “anh là ai”; DO360 quyết định “anh được làm gì”. OA chỉ gửi thông báo đã qua cổng an toàn, chi tiết xem trên web. Không dùng Mini App."
        actions={<><ToolbarButton onClick={() => digest.mutate()} disabled={digest.isPending}>Tạo tổng hợp đầu ngày</ToolbarButton><ToolbarButton variant="primary" onClick={() => setOpen(true)}>+ Nhóm chính danh</ToolbarButton></>} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card p-4"><p className="text-xs2 font-medium text-ink-muted">Đăng nhập bằng Zalo</p><p className="mt-1 text-sm2 text-ink">Zalo ID chỉ là định danh ngoài, liên kết với tài khoản DO360 đã được Văn phòng cấp; quyền do DO360 quản. <span className="kpi-num font-semibold">{chat?.staff_linked ?? 0}/{chat?.staff_total ?? 0}</span> cán bộ đã liên kết.</p></div>
        <div className="card p-4"><p className="text-xs2 font-medium text-ink-muted">OA gửi thông báo</p><p className="mt-1 text-sm2 text-ink">{chat?.configured ? 'OA đã cấu hình.' : 'OA chưa cấu hình token — tin chỉ ghi nhật ký.'} Đã gửi <span className="kpi-num font-semibold">{chat?.sent ?? 0}</span>, không gửi được/chưa liên kết <span className="kpi-num font-semibold">{chat?.failed ?? 0}</span>.</p></div>
        <div className="card p-4"><p className="text-xs2 font-medium text-ink-muted">Cổng an toàn nội dung</p><p className="mt-1 text-sm2 text-ink">Chặn CCCD, số điện thoại, email, bí mật nhà nước, hồ sơ sức khoẻ; cắt tin dài; deep link kiểm quyền lại khi mở. Cấu hình `config/notifications/rules.yaml`.</p></div>
      </div>
      <Panel title="Thử cổng an toàn" padded>
        <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <TextInput value={test.title} onChange={(e) => setTest({ ...test, title: e.target.value })} />
          <TextareaInput rows={3} value={test.lines} onChange={(e) => setTest({ ...test, lines: e.target.value })} />
          <ToolbarButton variant="primary" onClick={() => gate.mutate()} disabled={gate.isPending}>Kiểm tra</ToolbarButton>
        </div>
        <p className="mt-2 text-xs2 text-ink-muted">Thử dán “CCCD 048090001234” hoặc “Tuyệt mật” để thấy cổng thay bằng tin chung.</p>
      </Panel>
      <Panel title={<>Nhóm Zalo chính danh do OA sở hữu <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{channels.length}</span></>}>
        <DataTable isLoading={isLoading} empty={!channels.length ? <EmptyState title="Chưa đăng ký nhóm" description="Mỗi nhóm công vụ phải có mục đích, phạm vi, thành viên theo vai và mức nội dung cho phép." /> : undefined}>
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Nhóm</th><th className={TABLE_TH_CLS}>Phạm vi</th><th className={TABLE_TH_CLS}>Thành viên theo</th><th className={TABLE_TH_CLS}>Nội dung tối đa</th><th className={TABLE_TH_CLS}>Mã nhóm Zalo</th><th className={TABLE_TH_CLS}>Trạng thái</th></tr></thead>
            <tbody className="divide-y divide-rule">{channels.map((c) => <tr key={c.id} className="row-hover"><td className={`${TABLE_TD_CLS} font-medium text-ink`}>{c.name}</td><td className={TABLE_TD_CLS}>{SCOPE[c.scope_type] ?? c.scope_type}</td><td className={`${TABLE_TD_CLS} text-xs2 text-ink-2`}>{(c.member_rules ?? []).join(', ')}</td><td className={TABLE_TD_CLS}>{c.classification_allowed}</td><td className={`${TABLE_TD_CLS} kpi-num`}>{c.external_group_id ?? <span className="text-amber-700">chưa có — chờ VNG cấp API nhóm cho OA cơ quan</span>}</td><td className={TABLE_TD_CLS}><Tag preset={c.status === 'active' ? 'green' : 'neutral'}>{c.status === 'active' ? 'Hoạt động' : 'Đóng'}</Tag></td></tr>)}</tbody>
          </table>
        </DataTable>
      </Panel>
      <Panel title="Nhật ký gửi gần đây (đã qua cổng)">
        {messages.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa có tin.</p> : <ul className="divide-y divide-rule">{messages.filter((m) => m.direction === 'out').slice(0, 20).map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm2"><span className="text-ink">{m.title}<span className="ml-2 text-xs2 text-ink-muted">{m.kind === 'group' ? 'nhóm' : 'cá nhân'}{m.gateway?.allowed === false ? ` · cổng chặn (${(m.gateway.reasons ?? []).join(', ')})` : ''}</span></span><span className="text-xs2 text-ink-muted">{m.status === 'sent' ? 'đã gửi' : m.status === 'skipped' ? 'ghi nhật ký (chưa gửi được)' : 'không gửi được'} · {fmtDate(m.created_at)}</span></li>)}</ul>}
      </Panel>
      <Modal open={open} onClose={() => setOpen(false)} title="Đăng ký nhóm Zalo chính danh" footer={<><ToolbarButton variant="ghost" onClick={() => setOpen(false)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={!form.key || !form.name || save.isPending} onClick={() => save.mutate()}>Lưu</ToolbarButton></>}>
        <div className="space-y-3">
          <Callout tone="info">Nhóm chỉ phục vụ công vụ, OA là chủ thể quản trị; không gửi bí mật nhà nước, dữ liệu cá nhân; tin nhắn không thay văn bản, phê duyệt chính thức.</Callout>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Khoá (lanh_dao, van_phong, bao_cao, du_an, kinh_te…)" required><TextInput value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></FormField>
            <FormField label="Tên nhóm" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="DO360 | Ban lãnh đạo" /></FormField>
            <FormField label="Phạm vi"><SelectInput value={form.scope_type} onChange={(e) => setForm({ ...form, scope_type: e.target.value })}>{Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectInput></FormField>
            <FormField label="Nội dung tối đa"><SelectInput value={form.classification_allowed} onChange={(e) => setForm({ ...form, classification_allowed: e.target.value })}><option value="PUBLIC">Công khai</option><option value="INTERNAL">Nội bộ</option></SelectInput></FormField>
            <FormField label="Mã nhóm Zalo (GMF)"><TextInput value={form.external_group_id} onChange={(e) => setForm({ ...form, external_group_id: e.target.value })} /></FormField>
          </div>
          <FormField label="Thành viên theo vai/phòng (role:leader, dept:kinh_te, user:12)"><TextareaInput rows={2} value={form.member_rules} onChange={(e) => setForm({ ...form, member_rules: e.target.value })} /></FormField>
        </div>
      </Modal>
    </div>
  );
}
