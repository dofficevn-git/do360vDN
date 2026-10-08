'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, FilterTabs, FormField, KeyValue, LoadingState, Modal, PageHeader, Panel, SelectInput, Tag, TechDetails, TextInput, ToolbarButton } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg, fmtDate, fmtNum } from '@/lib/do360';
import { useLabels } from '@/lib/labels';
import { dueText } from '@/lib/work';

type Tab = 'overview' | 'timeline' | 'indicators' | 'tasks' | 'documents' | 'quality';
const FRESH: Record<string, { label: string; preset: 'green' | 'gold' | 'red' }> = { current: { label: 'Mới', preset: 'green' }, stale: { label: 'Cũ', preset: 'gold' }, needs_refresh: { label: 'Cần cập nhật', preset: 'red' } };

/** Object 360 (Blueprint mục 52): tổng quan · thuộc tính · quan hệ · timeline · chỉ tiêu · nhiệm vụ · tài liệu · chất lượng · audit. */
export default function Object360Page() {
  const { uid } = useParams<{ uid: string }>();
  const qc = useQueryClient();
  const me = currentAdmin();
  const lb = useLabels();
  const [tab, setTab] = useState<Tab>('overview');
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger' | 'warning' | 'success'; text: string } | null>(null);
  const [evOpen, setEvOpen] = useState(false);
  const [ev, setEv] = useState<any>({ event_type: '', event_date: new Date().toISOString().slice(0, 10), so_tien: '', ty_le: '', tien_do: '', note: '' });
  const [attrOpen, setAttrOpen] = useState(false);
  const [attrs, setAttrs] = useState<Record<string, any>>({});
  const { data, isLoading } = useQuery<any>({ queryKey: ['object-360', uid], queryFn: () => apiGet(`/admin/objects/${uid}/360`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['object-360', uid] }); qc.invalidateQueries({ queryKey: ['objects'] }); };
  const fail = (e: any) => setNotice({ tone: 'danger', text: errMsg(e) });
  const addEvent = useMutation({ mutationFn: () => api.post(`/admin/objects/${uid}/events`, { event_type: ev.event_type, event_date: ev.event_date, note: ev.note || undefined, values: { ...(ev.so_tien ? { so_tien: Number(String(ev.so_tien).replace(/\./g, '')) } : {}), ...(ev.ty_le ? { ty_le: Number(ev.ty_le) } : {}), ...(ev.tien_do ? { tien_do: Number(ev.tien_do) } : {}) } }).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã ghi sự kiện. Thuộc tính liên quan tự cập nhật.' }); setEvOpen(false); refresh(); }, onError: fail });
  const saveAttrs = useMutation({ mutationFn: () => api.patch(`/admin/objects/${uid}`, { attributes: attrs }).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã cập nhật. Ngày cập nhật được làm mới.' }); setAttrOpen(false); refresh(); }, onError: fail });
  const verify = useMutation({ mutationFn: (status: 'verified' | 'rejected') => api.post(`/admin/objects/${uid}/verify`, { status }).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã cập nhật trạng thái xác minh.' }); refresh(); }, onError: fail });
  if (isLoading || !data) return <LoadingState />;
  const o = data.object; const fields: any[] = data.fields; const q = data.quality;
  const evTypes = (data.type?.events ?? []) as string[];
  const canEdit = me.role !== 'council';
  const fmtAttr = (f: any, v: any) => v == null || v === '' ? '—' : f.type === 'money' ? fmtNum(Number(v), 'money') : f.type === 'percent' ? `${v}%` : f.type === 'date' ? fmtDate(String(v)) : f.type === 'integer' ? Number(v).toLocaleString('vi-VN') : String(v);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={data.type?.name ?? 'Đối tượng'} title={`${o.code} · ${o.name}`} description={data.type?.master_source ? `Nguồn chủ: ${data.type.master_source}` : undefined}
        actions={<div className="flex flex-wrap gap-2">
          {canEdit && evTypes.length > 0 && <ToolbarButton variant="primary" onClick={() => { setEv({ ...ev, event_type: evTypes[0] }); setEvOpen(true); }}>+ Ghi sự kiện</ToolbarButton>}
          {canEdit && fields.length > 0 && <ToolbarButton onClick={() => { setAttrs({ ...o.attributes }); setAttrOpen(true); }}>Cập nhật thuộc tính</ToolbarButton>}
          {canEdit && o.verification_status !== 'verified' && <ToolbarButton onClick={() => verify.mutate('verified')}>Xác minh</ToolbarButton>}
          <Link href={`/objects?type=${o.object_type}`} className="inline-flex h-10 items-center rounded-lg border border-rule bg-white px-3 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Danh sách</Link>
        </div>} />
      <div className="flex flex-wrap items-center gap-2 text-xs2">
        <Tag preset={o.status === 'active' ? 'blue' : o.status === 'completed' ? 'green' : 'neutral'}>{o.status === 'active' ? 'Đang hoạt động' : o.status === 'completed' ? 'Hoàn thành' : o.status === 'inactive' ? 'Ngừng' : 'Khác'}</Tag>
        <Tag preset={o.verification_status === 'verified' ? 'green' : 'gold'}>{o.verification_status === 'verified' ? 'Đã xác minh' : 'Chờ xác minh'}</Tag>
        <Tag preset={FRESH[o.freshness_status]?.preset ?? 'neutral'}>{FRESH[o.freshness_status]?.label} · cập nhật {fmtDate(o.refreshed_at)}</Tag>
        {o.master_id ? <Tag preset="cyan">Master ID {o.master_id}</Tag> : <Tag preset="neutral">Chưa có Master ID</Tag>}
        {o.data_owner_dept && <span className="text-ink-muted">Phòng chủ dữ liệu: {lb.dept(o.data_owner_dept)}</span>}
        {o.alerts?.map((a: any) => <Tag key={a.key} preset="red">{a.name}</Tag>)}
      </div>
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      {o.alerts?.length > 0 && <Callout tone="warning" title="Cảnh báo"><ul className="list-disc pl-4">{o.alerts.map((a: any) => <li key={a.key}>{a.name}: {a.detail}</li>)}</ul></Callout>}
      <FilterTabs<Tab> value={tab} onChange={setTab} items={[{ value: 'overview', label: 'Tổng quan' }, { value: 'timeline', label: 'Timeline', count: data.events.length }, { value: 'indicators', label: 'Chỉ tiêu', count: data.indicators.length }, { value: 'tasks', label: 'Nhiệm vụ', count: data.tasks.length }, { value: 'documents', label: 'Tài liệu', count: data.documents.length }, { value: 'quality', label: 'Chất lượng & audit' }]} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Thuộc tính" padded>
            {fields.length ? <KeyValue items={fields.map((f: any) => ({ k: f.name, v: fmtAttr(f, o.attributes?.[f.key]) }))} /> : <p className="text-sm2 text-ink-muted">Loại đối tượng này chưa khai báo thuộc tính.</p>}
            {o.object_type === 'du_an' && o.attributes?.ke_hoach_von > 0 && <p className="mt-3 text-xs2 text-ink-muted">Giải ngân / kế hoạch vốn: <b className="kpi-num text-ink">{Math.round((Number(o.attributes.giai_ngan ?? 0) / Number(o.attributes.ke_hoach_von)) * 100)}%</b> · tiến độ thực hiện <b className="kpi-num text-ink">{o.attributes.tien_do ?? 0}%</b> · GPMB <b className="kpi-num text-ink">{o.attributes.gpmb ?? 0}%</b></p>}
          </Panel>
          <Panel title="Quan hệ">
            {data.relations.length + data.related_from.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa có quan hệ.</p> : (
              <ul className="divide-y divide-rule">
                {data.relations.map((r: any) => <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm2"><span className="text-ink-muted">{r.relation_name}</span>{r.target_uid.length === 36 ? <Link href={`/objects/${r.target_uid}`} className="font-medium text-primary-700 hover:underline">{r.target_name ?? r.target_uid}</Link> : <span className="font-medium text-ink">{r.target_name ?? r.target_uid}</span>}</li>)}
                {data.related_from.map((r: any) => <li key={`b${r.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm2"><span className="text-ink-muted">← {r.relation_name}</span>{r.source ? <Link href={`/objects/${r.source.uid}`} className="font-medium text-primary-700 hover:underline">{r.source.code} · {r.source.name}</Link> : <span>{r.source_uid}</span>}</li>)}
              </ul>
            )}
          </Panel>
          <Panel title="Sự kiện gần đây">
            {data.events.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa có sự kiện.</p> : <ul className="divide-y divide-rule">{data.events.slice(0, 5).map((e: any) => <li key={e.event_id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm2"><span><b className="text-ink">{e.event_name}</b>{e.payload?.values?.so_tien ? <span className="kpi-num ml-2 text-ink-2">{fmtNum(Number(e.payload.values.so_tien), 'money')}</span> : null}{e.payload?.note ? <span className="ml-2 text-ink-muted">{e.payload.note}</span> : null}</span><span className="kpi-num text-xs2 text-ink-muted">{fmtDate(e.event_date)}</span></li>)}</ul>}
          </Panel>
          <Panel title="Nhiệm vụ đang mở">
            {data.tasks.filter((t: any) => ['new', 'in_progress'].includes(t.status)).length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Không có nhiệm vụ đang mở.</p> : <ul className="divide-y divide-rule">{data.tasks.filter((t: any) => ['new', 'in_progress'].includes(t.status)).map((t: any) => { const d = dueText(t.due_at); return <li key={t.id} className="px-5 py-2 text-sm2"><p className="text-ink">{t.title}</p><p className={`text-xs2 ${d.overdue ? 'text-red-700' : 'text-ink-muted'}`}>{t.assignee ?? ''} · {d.text}</p></li>; })}</ul>}
          </Panel>
        </div>
      )}
      {tab === 'timeline' && (
        <Panel title="Timeline">
          {data.events.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa có sự kiện nào.</p> : (
            <ol className="divide-y divide-rule">{data.events.map((e: any) => <li key={e.event_id} className="flex gap-4 px-5 py-3 text-sm2"><span className="kpi-num w-24 shrink-0 text-ink-muted">{fmtDate(e.event_date)}</span><div><p className="font-medium text-ink">{e.event_name}</p>{e.payload?.values && Object.keys(e.payload.values).length > 0 && <p className="text-xs2 text-ink-2">{Object.entries(e.payload.values).map(([k, v]) => `${k === 'so_tien' ? 'Số tiền' : k === 'ty_le' ? 'Tỷ lệ' : k === 'tien_do' ? 'Tiến độ' : k}: ${k === 'so_tien' ? fmtNum(Number(v), 'money') : String(v)}${k !== 'so_tien' ? '%' : ''}`).join(' · ')}</p>}{e.payload?.note && <p className="text-xs2 text-ink-muted">{e.payload.note}</p>}<TechDetails inline label="nguồn">{e.source_system}{e.external_id ? ` · ${e.external_id}` : ''}</TechDetails></div></li>)}</ol>
          )}
        </Panel>
      )}
      {tab === 'indicators' && (
        <Panel title="Chỉ tiêu liên quan (giá trị toàn phường, kỳ gần nhất)">
          {data.indicators.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Loại đối tượng này chưa gắn chỉ tiêu.</p> : <ul className="divide-y divide-rule">{data.indicators.map((i: any) => <li key={i.indicator_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm2"><span className="text-ink">{i.name}</span><span className="kpi-num text-ink-2">{i.value != null ? `${fmtNum(i.value, i.value_type)} ${i.unit} · ${lb.period(i.period)}` : 'chưa có số'}</span></li>)}</ul>}
          {data.own_values.length > 0 && <div className="border-t border-rule px-5 py-3 text-xs2 text-ink-muted">Giá trị riêng của đối tượng: {data.own_values.map((v: any) => `${lb.ind(v.indicator_id)} ${v.value} (${lb.period(v.period)})`).join(' · ')}</div>}
        </Panel>
      )}
      {tab === 'tasks' && (
        <Panel title="Nhiệm vụ" actions={<Link href="/tasks" className="text-xs2 font-medium text-primary-600 hover:underline">Giao việc</Link>}>
          {data.tasks.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa có nhiệm vụ gắn đối tượng này.</p> : <ul className="divide-y divide-rule">{data.tasks.map((t: any) => { const d = dueText(t.due_at); return <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm2"><div><p className="text-ink">{t.title}</p><p className="text-xs2 text-ink-muted">{t.assignee ?? ''}{t.target_indicator_id ? ` · mục tiêu ${lb.ind(t.target_indicator_id)} = ${t.target_value}` : ''}</p></div><span className={`text-xs2 ${t.status === 'done' ? 'text-emerald-700' : d.overdue ? 'text-red-700' : 'text-ink-muted'}`}>{t.status === 'done' ? 'Đã xong' : d.text}</span></li>; })}</ul>}
        </Panel>
      )}
      {tab === 'documents' && (
        <Panel title="Tài liệu, văn bản gắn đối tượng">
          {data.documents.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa gắn tài liệu.</p> : <ul className="divide-y divide-rule">{data.documents.map((l: any) => <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm2"><span className="text-ink">{l.document_kind === 'qlvb_document' ? `${l.doc.loai ?? 'Văn bản'} ${l.doc.so_ky_hieu ?? ''} — ${l.doc.trich_yeu ?? ''}` : l.document_kind === 'source_file' ? l.doc.original_name : `Báo cáo ${lb.period(l.doc.period)}${l.doc.signed_number ? ` số ${l.doc.signed_number}` : ''}`}</span><span className="text-xs2 text-ink-muted">{l.link_type === 'decision' ? 'quyết định' : l.link_type === 'plan' ? 'kế hoạch' : l.link_type === 'report' ? 'báo cáo' : 'bằng chứng'}{l.doc.ngay ? ` · ${fmtDate(l.doc.ngay)}` : ''}</span></li>)}</ul>}
        </Panel>
      )}
      {tab === 'quality' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Chất lượng dữ liệu của đối tượng" padded>
            <KeyValue items={[{ k: 'Xác minh', v: q.verification_status === 'verified' ? 'Đã xác minh' : 'Chờ xác minh' }, { k: 'Độ mới', v: `${FRESH[q.freshness_status]?.label} (${q.age_days} ngày)` }, { k: 'Master ID', v: q.master_mapped ? 'Có' : 'Chưa' }, { k: 'Đủ thuộc tính', v: q.completeness != null ? `${q.completeness}%` : '—' }, { k: 'Nguồn tạo', v: String(q.provenance?.source_type ?? '—') }]} />
            <TechDetails>{JSON.stringify(q.provenance)}</TechDetails>
          </Panel>
          <Panel title="Nhật ký thay đổi">
            {data.audit.length === 0 ? <p className="px-5 py-4 text-sm2 text-ink-muted">Chưa có bản ghi.</p> : <ul className="divide-y divide-rule">{data.audit.map((a: any) => <li key={a.id} className="flex justify-between px-5 py-2 text-xs2"><span>{a.action} · tài khoản #{a.admin_user_id}</span><span className="kpi-num text-ink-muted">{fmtDate(a.created_at)}</span></li>)}</ul>}
          </Panel>
        </div>
      )}

      <Modal open={evOpen} onClose={() => setEvOpen(false)} title="Ghi sự kiện" footer={<><ToolbarButton variant="ghost" onClick={() => setEvOpen(false)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={!ev.event_type || addEvent.isPending} onClick={() => addEvent.mutate()}>Ghi</ToolbarButton></>}>
        <div className="space-y-3">
          <FormField label="Loại sự kiện"><SelectInput value={ev.event_type} onChange={(e) => setEv({ ...ev, event_type: e.target.value })}>{evTypes.map((k) => <option key={k} value={k}>{(data.events_dict ?? []).find?.((x: any) => x.key === k)?.name ?? k}</option>)}</SelectInput></FormField>
          <FormField label="Ngày"><TextInput type="date" value={ev.event_date} onChange={(e) => setEv({ ...ev, event_date: e.target.value })} /></FormField>
          {ev.event_type === 'giai_ngan' && <FormField label="Số tiền (đồng)"><TextInput value={ev.so_tien} onChange={(e) => setEv({ ...ev, so_tien: e.target.value })} /></FormField>}
          {ev.event_type === 'gpmb' && <FormField label="Tỷ lệ GPMB (%)"><TextInput value={ev.ty_le} onChange={(e) => setEv({ ...ev, ty_le: e.target.value })} /></FormField>}
          {['kiem_tra', 'dieu_chinh', 'nghiem_thu'].includes(ev.event_type) && <FormField label="Tiến độ sau sự kiện (%)"><TextInput value={ev.tien_do} onChange={(e) => setEv({ ...ev, tien_do: e.target.value })} /></FormField>}
          <FormField label="Ghi chú"><TextInput value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} /></FormField>
        </div>
      </Modal>
      <Modal open={attrOpen} onClose={() => setAttrOpen(false)} title="Cập nhật thuộc tính" footer={<><ToolbarButton variant="ghost" onClick={() => setAttrOpen(false)}>Huỷ</ToolbarButton><ToolbarButton variant="primary" disabled={saveAttrs.isPending} onClick={() => saveAttrs.mutate()}>Lưu</ToolbarButton></>}>
        <div className="grid grid-cols-2 gap-3">
          {fields.map((f: any) => <FormField key={f.key} label={f.name}>{f.type === 'date' ? <TextInput type="date" value={attrs[f.key] ?? ''} onChange={(e) => setAttrs({ ...attrs, [f.key]: e.target.value })} /> : <TextInput value={attrs[f.key] ?? ''} onChange={(e) => setAttrs({ ...attrs, [f.key]: ['money', 'integer', 'percent'].includes(f.type) ? (e.target.value === '' ? '' : Number(e.target.value.replace(/\./g, '').replace(',', '.'))) : e.target.value })} />}</FormField>)}
        </div>
      </Modal>
    </div>
  );
}
