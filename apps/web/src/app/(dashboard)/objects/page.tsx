'use client';

import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, DataTable, EmptyState, FilterTabs, FormField, Modal, PageHeader, SelectInput, Tag, TechDetails, TextInput, ToolbarButton, TABLE_HEAD_CLS, TABLE_TD_CLS, TABLE_TH_CLS } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg, fmtDate, fmtNum } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

const OWNERSHIP: Record<string, { label: string; hint: string; preset: 'blue' | 'cyan' | 'green' | 'purple' }> = {
  MASTER: { label: 'Dữ liệu chủ bên ngoài', hint: 'Nguồn chính thức ở hệ thống khác; DO360 không tạo lại', preset: 'blue' },
  REFERENCE: { label: 'Tham chiếu', hint: 'Giữ ID chuẩn và trường cần dùng từ nguồn chủ', preset: 'cyan' },
  LOCAL_MASTER: { label: 'Xã/phường quản lý', hint: 'Phường tạo lập, cập nhật; DO360 là nơi quản lý chính', preset: 'green' },
  DERIVED: { label: 'Dẫn xuất', hint: 'DO360 tính/tổng hợp từ nguồn khác, có lineage', preset: 'purple' },
};
const FRESH: Record<string, { label: string; preset: 'green' | 'gold' | 'red' }> = { current: { label: 'Mới', preset: 'green' }, stale: { label: 'Cũ', preset: 'gold' }, needs_refresh: { label: 'Cần cập nhật', preset: 'red' } };

/** Danh bạ đối tượng (Object Directory): mỗi loại = một dòng từ điển với quyền sở hữu, số lượng, số đã xác minh/đã map Master ID; mở danh sách và Object 360. */
function ObjectsInner() {
  const qc = useQueryClient();
  const sp = useSearchParams();
  const me = currentAdmin();
  const lb = useLabels();
  const [type, setType] = useState(sp.get('type') || '');
  const [q, setQ] = useState('');
  const [onlyAlerts, setOnlyAlerts] = useState(sp.get('alerts') === '1');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ object_type: sp.get('type') || 'du_an', name: '', master_id: '', attributes: {} });
  const [cands, setCands] = useState<any[]>([]);
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'warning' | 'success'; text: string } | null>(null);
  const { data: counts = [] } = useQuery<any[]>({ queryKey: ['object-counts'], queryFn: () => apiGet('/admin/objects/counts') });
  const { data: dict } = useQuery<any>({ queryKey: ['object-dict'], queryFn: () => apiGet('/admin/objects/dictionary') });
  const { data: rows = [], isLoading } = useQuery<any[]>({ queryKey: ['objects', type, q], queryFn: () => apiGet(`/admin/objects?${type ? `type=${type}&` : ''}${q ? `q=${encodeURIComponent(q)}&` : ''}limit=300`), enabled: !!type });
  const typeDef = dict?.types?.find((t: any) => t.key === type);
  const canCreate = me.role !== 'council' && typeDef?.storage === 'dim_object';
  const resolve = useMutation({ mutationFn: () => api.post('/admin/objects/resolve', { object_type: form.object_type, name: form.name, master_id: form.master_id || undefined }).then((r) => r.data), onSuccess: (r) => setCands(r) });
  const create = useMutation({ mutationFn: (force: boolean) => api.post('/admin/objects', { ...form, master_id: form.master_id || null, force }).then((r) => r.data),
    onSuccess: (o) => { setNotice({ tone: 'success', text: `Đã tạo ${o.code} · ${o.name}.` }); setOpen(false); setCands([]); qc.invalidateQueries({ queryKey: ['objects'] }); qc.invalidateQueries({ queryKey: ['object-counts'] }); },
    onError: (e: any) => { const c = e?.response?.data?.candidates; if (c) { setCands(c); setNotice({ tone: 'warning', text: String(e.response.data.message) }); } else setNotice({ tone: 'danger', text: errMsg(e) }); } });
  const importList = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); fd.append('object_type', type); return api.post('/admin/objects/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data); },
    onSuccess: (r) => { setNotice({ tone: 'success', text: `Đã nạp từ Excel: ${r.created} tạo mới, ${r.updated} cập nhật theo Mã định danh${r.skipped_rows?.length ? `, bỏ qua ${r.skipped_rows.length} dòng không có Tên` : ''}.` }); qc.invalidateQueries({ queryKey: ['objects'] }); qc.invalidateQueries({ queryKey: ['object-counts'] }); }, onError: (e) => setNotice({ tone: 'danger', text: errMsg(e) }) });
  const list = onlyAlerts ? rows.filter((r) => r.alerts?.length) : rows;
  const fieldDefs: any[] = typeDef?.fields ?? [];

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Dữ liệu" title="Danh bạ đối tượng" description="Đối tượng chính quyền đang quản lý: dự án, hộ kinh doanh, địa bàn, tổ chức… Mỗi đối tượng có ID nội bộ ổn định, nguồn, quyền sở hữu dữ liệu và trang 360."
        actions={canCreate ? <div className="flex gap-2"><label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 hover:bg-slate-50" title={`Bảng danh sách: cột Tên, Mã định danh, ${fieldDefs.map((f: any) => f.name).join(', ')}`}>{importList.isPending ? 'Đang nạp…' : 'Nạp từ Excel'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importList.mutate(f); e.target.value = ''; }} /></label><ToolbarButton variant="primary" onClick={() => { setForm({ object_type: type, name: '', master_id: '', attributes: {} }); setCands([]); setOpen(true); }}>+ Thêm {typeDef?.name?.toLowerCase()}</ToolbarButton></div> : undefined} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {counts.map((c) => (
          <button key={c.key} type="button" onClick={() => { setType(c.key); setOnlyAlerts(false); }} className={`card cursor-pointer p-3.5 text-left transition-colors hover:border-rule-strong ${type === c.key ? 'border-primary-400 bg-primary-50/40' : ''}`}>
            <p className="text-sm2 font-semibold text-ink">{c.name}</p>
            <p className="kpi-num mt-1 text-xl font-bold text-ink">{c.count ?? '—'}</p>
            <p className="mt-1 text-xs2 text-ink-muted" title={OWNERSHIP[c.ownership]?.hint}>{OWNERSHIP[c.ownership]?.label ?? c.ownership}{c.storage !== 'dim_object' ? ' · bảng riêng' : ''}</p>
            {c.storage === 'dim_object' && c.count > 0 && <p className="text-2xs text-ink-faint">{c.verified}/{c.count} đã xác minh · {c.mapped} có Master ID{c.stale ? ` · ${c.stale} cũ` : ''}</p>}
          </button>
        ))}
      </div>
      {!type ? <EmptyState title="Chọn một loại đối tượng" description="Bấm vào thẻ phía trên để mở danh sách." /> : typeDef?.storage !== 'dim_object' ? (
        <Callout tone="info" title={`${typeDef?.name}: quản lý ở bảng riêng`}>
          {typeDef?.key === 'van_ban' && <>Văn bản đồng bộ từ QLVB. <Link className="underline" href="/integrations?tab=qlvb">Mở sổ văn bản</Link>.</>}
          {typeDef?.key === 'nhiem_vu' && <>Nhiệm vụ nằm ở sổ giao việc. <Link className="underline" href="/tasks">Mở Nhiệm vụ</Link>.</>}
          {typeDef?.key === 'bao_cao' && <>Báo cáo là góc nhìn trên kho số. <Link className="underline" href="/report-runs">Mở Kỳ báo cáo</Link>.</>}
          {typeDef?.key === 'chi_tieu' && <>Chỉ tiêu theo danh mục cấu hình. <Link className="underline" href="/catalog">Mở Danh mục</Link>.</>}
          {typeDef?.key === 'ho_so' && <>Hồ sơ TTHC chỉ nhận số tổng hợp theo kỳ từ Hệ thống thông tin giải quyết TTHC. <Link className="underline" href="/domain/noi_vu_cchc">Xem lĩnh vực Nội vụ – CCHC</Link>.</>}
          {typeDef?.key === 'don_vi' && <>Đơn vị hành chính lấy theo danh mục ĐVHC (dim_tenant).</>}
          <p className="mt-1 text-xs2 text-ink-muted">Nguồn chủ: {typeDef?.master_source}</p>
        </Callout>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput className="h-9 w-72" placeholder={`Tìm ${typeDef?.name?.toLowerCase()} theo tên, mã, Master ID`} value={q} onChange={(e) => setQ(e.target.value)} />
            <FilterTabs value={onlyAlerts ? 'alerts' : 'all'} onChange={(v) => setOnlyAlerts(v === 'alerts')} items={[{ value: 'all', label: 'Tất cả', count: rows.length }, { value: 'alerts', label: 'Có cảnh báo', count: rows.filter((r) => r.alerts?.length).length }]} />
            <span className="ml-auto text-xs2 text-ink-muted" title={OWNERSHIP[typeDef.ownership]?.hint}>{OWNERSHIP[typeDef.ownership]?.label} · nguồn chủ: {typeDef.master_source}</span>
          </div>
          <DataTable isLoading={isLoading} empty={!list.length ? <EmptyState title={`Chưa có ${typeDef?.name?.toLowerCase()}`} description={canCreate ? 'Thêm mới hoặc nạp từ file danh sách.' : ''} /> : undefined}>
            <table className="w-full text-sm">
              <thead className={TABLE_HEAD_CLS}><tr><th className={TABLE_TH_CLS}>Mã</th><th className={TABLE_TH_CLS}>Tên</th>{fieldDefs.slice(0, 4).map((f) => <th key={f.key} className={`${TABLE_TH_CLS} ${['money', 'integer', 'percent'].includes(f.type) ? 'text-right' : ''}`}>{f.name}</th>)}<th className={TABLE_TH_CLS}>Phòng chủ</th><th className={TABLE_TH_CLS}>Cập nhật</th><th className={TABLE_TH_CLS}>Trạng thái</th></tr></thead>
              <tbody className="divide-y divide-rule">
                {list.map((o) => (
                  <tr key={o.uid} className="row-hover">
                    <td className={`${TABLE_TD_CLS} kpi-num text-ink-muted`}>{o.code}</td>
                    <td className={`${TABLE_TD_CLS} font-medium text-ink`}><Link href={`/objects/${o.uid}`} className="hover:underline">{o.name}</Link>{o.master_id && <p className="text-xs2 font-normal text-ink-faint">Master ID {o.master_id}</p>}{o.alerts?.length > 0 && <p className="text-xs2 font-normal text-red-700">{o.alerts.map((a: any) => a.name).join(' · ')}</p>}</td>
                    {fieldDefs.slice(0, 4).map((f) => { const v = o.attributes?.[f.key]; return <td key={f.key} className={`${TABLE_TD_CLS} ${['money', 'integer', 'percent'].includes(f.type) ? 'kpi-num text-right' : ''}`}>{v == null || v === '' ? <span className="text-ink-faint">—</span> : f.type === 'money' ? fmtNum(Number(v), 'money') : f.type === 'percent' ? `${v}%` : f.type === 'date' ? fmtDate(String(v)) : f.type === 'integer' ? Number(v).toLocaleString('vi-VN') : String(v)}</td>; })}
                    <td className={`${TABLE_TD_CLS} text-ink-3`}>{o.data_owner_dept ? lb.dept(o.data_owner_dept) : '—'}</td>
                    <td className={`${TABLE_TD_CLS} kpi-num`}>{fmtDate(o.refreshed_at)} <Tag preset={FRESH[o.freshness_status]?.preset ?? 'neutral'} dot={false}>{FRESH[o.freshness_status]?.label}</Tag></td>
                    <td className={TABLE_TD_CLS}><Tag preset={o.verification_status === 'verified' ? 'green' : 'gold'}>{o.verification_status === 'verified' ? 'Đã xác minh' : 'Chờ xác minh'}</Tag>{o.status !== 'active' && <Tag preset="neutral" className="ml-1">{o.status === 'completed' ? 'Hoàn thành' : o.status === 'inactive' ? 'Ngừng' : 'Khác'}</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={`Thêm ${typeDef?.name?.toLowerCase() ?? 'đối tượng'}`} maxWidth="max-w-xl"
        footer={<><ToolbarButton variant="ghost" onClick={() => setOpen(false)}>Huỷ</ToolbarButton>{cands.length > 0 && <ToolbarButton variant="secondary" onClick={() => create.mutate(true)}>Vẫn tạo mới</ToolbarButton>}<ToolbarButton variant="primary" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate(false)}>Tạo</ToolbarButton></>}>
        <div className="space-y-3">
          <Callout tone="info">Trước khi tạo, hệ thống đối soát trùng theo Master ID, mã định danh và tên chuẩn hoá — không để mỗi tài liệu sinh một đối tượng mới.</Callout>
          <FormField label="Tên" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={() => form.name.trim() && resolve.mutate()} /></FormField>
          <FormField label={`Master ID (${typeDef?.master_source ?? 'nguồn chuẩn'})`}><TextInput value={form.master_id} onChange={(e) => setForm({ ...form, master_id: e.target.value })} /></FormField>
          {cands.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm2"><p className="font-semibold text-amber-900">Có thể đã tồn tại:</p><ul className="mt-1 space-y-0.5">{cands.map((c) => <li key={c.uid}><Link href={`/objects/${c.uid}`} className="text-primary-700 hover:underline">{c.code} · {c.name}</Link> <span className="text-xs2 text-ink-muted">— {c.reason} ({Math.round(c.score * 100)}%)</span></li>)}</ul></div>}
          <div className="grid grid-cols-2 gap-3">
            {fieldDefs.map((f) => (
              <FormField key={f.key} label={f.name}>
                {f.type === 'date' ? <TextInput type="date" value={form.attributes[f.key] ?? ''} onChange={(e) => setForm({ ...form, attributes: { ...form.attributes, [f.key]: e.target.value } })} />
                  : <TextInput value={form.attributes[f.key] ?? ''} placeholder={f.type === 'money' ? 'đồng' : f.type === 'percent' ? '%' : ''} onChange={(e) => setForm({ ...form, attributes: { ...form.attributes, [f.key]: ['money', 'integer', 'percent'].includes(f.type) ? (e.target.value === '' ? '' : Number(e.target.value.replace(/\./g, '').replace(',', '.'))) : e.target.value } })} />}
              </FormField>
            ))}
          </div>
          <TechDetails>object_type {form.object_type} · ownership {typeDef?.ownership}</TechDetails>
        </div>
      </Modal>
    </div>
  );
}

export default function ObjectsPage() { return <Suspense fallback={null}><ObjectsInner /></Suspense>; }
