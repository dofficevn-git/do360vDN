'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, GateIssueList, LoadingState, PageHeader, Panel, RunStepper, Tag, TextareaInput, ToolbarButton } from '@/components/ui/admin-ui';
import { ReportDocument, type Segment, type RenderedSlot } from '@/components/report/ReportDocument';
import { ProvenanceDrawer, type NumberRef } from '@/components/report/ProvenanceDrawer';
import { currentAdmin, errMsg, fmtDate } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

/**
 * Đọc báo cáo: văn bản dựng từ đúng bộ số và lời dẫn mà Word sẽ xuất ("cái thấy = cái ký").
 * Mỗi con số bấm được → ngăn Nguồn. Văn phòng soạn lời dẫn tại chỗ với 3 gợi ý (khuôn câu, lời kỳ trước, sự kiện).
 */
export default function ReadReportPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const me = currentAdmin();
  const lb = useLabels();
  const [sel, setSel] = useState<{ ref: NumberRef; kind: string; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const { data, isLoading } = useQuery<any>({ queryKey: ['report-preview', Number(id)], queryFn: () => apiGet(`/admin/report-runs/${id}/preview`), refetchInterval: 60_000 });
  const { data: status } = useQuery<any>({ queryKey: ['report-run', Number(id)], queryFn: () => apiGet(`/admin/report-runs/${id}`) });
  const { data: nar } = useQuery<any>({ queryKey: ['narratives', Number(id)], queryFn: () => apiGet(`/admin/report-runs/${id}/narratives`), enabled: me.role !== 'council' });
  const refresh = () => { ['report-preview', 'report-run', 'narratives', 'report-runs'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const fail = (e: any) => setNotice({ tone: 'danger', text: e?.response?.data?.message?.message ?? errMsg(e) });
  const save = useMutation({ mutationFn: ({ slot, text }: { slot: string; text: string }) => api.post(`/admin/report-runs/${id}/narratives/${slot}`, { text }).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: r.postcheck?.warnings?.length ? 'warning' : 'success', text: r.postcheck?.warnings?.length ? `Đã lưu bản nháp, có cảnh báo: ${r.postcheck.warnings.join(' ')}` : 'Đã lưu bản nháp lời dẫn.' }); refresh(); }, onError: fail });
  const accept = useMutation({ mutationFn: (slot: string) => api.post(`/admin/report-runs/${id}/narratives/${slot}/accept`).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã chấp nhận lời dẫn — sẽ dùng khi sinh Word.' }); setEditing(null); refresh(); }, onError: fail });
  const suggest = useMutation({ mutationFn: ({ slot, provider }: { slot: string; provider: 'template' | 'llm' }) => api.post(`/admin/report-runs/${id}/narratives/${slot}/suggest`, { provider }).then((r) => r.data), onSuccess: (r) => { setDraft(r.text); setNotice({ tone: 'info', text: `Đã gợi ý (${r.note ?? r.source}). Sửa rồi lưu.` }); refresh(); }, onError: fail });
  const lock = useMutation({ mutationFn: () => api.post(`/admin/report-runs/${id}/lock`).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã chốt kỳ. Bộ số đóng băng.' }); refresh(); }, onError: fail });
  const render = useMutation({ mutationFn: () => api.post(`/admin/report-runs/${id}/render`).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: 'success', text: `Đã sinh Word. Hậu kiểm: ${r.postcheck.errors.length} lỗi, ${r.postcheck.warnings.length} cảnh báo.` }); refresh(); }, onError: fail });
  const submit = useMutation({ mutationFn: () => api.post(`/admin/qlvb/report-runs/${id}/submit`, {}).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã trình ký. Lời dẫn và bộ số đã đóng băng.' }); refresh(); }, onError: fail });
  const checkSign = useMutation({ mutationFn: () => api.post(`/admin/qlvb/report-runs/${id}/check-sign`).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: r.status === 'signed' ? 'success' : 'warning', text: r.status === 'signed' ? `Đã ký: số ${r.run.signed_number} ngày ${fmtDate(r.run.signed_date)}.` : 'QLVB chưa ký.' }); refresh(); }, onError: fail });

  const narBySlot = useMemo(() => Object.fromEntries(((nar?.slots ?? []) as any[]).map((s) => [s.slot_code, s])), [nar]);
  const gate = status?.gate;
  const issuesBySlot = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const i of [...(gate?.errors ?? []), ...(gate?.warnings ?? [])]) if (i.slot) (m[i.slot] = m[i.slot] ?? []).push(i);
    return m;
  }, [gate]);

  if (isLoading || !data) return <LoadingState />;
  const { run, spec, document, postcheck, live, tenant } = data;
  const canManage = ['super_admin', 'commune_admin'].includes(me.role ?? '');
  const canEdit = nar?.slots?.[0]?.editable !== false && me.role !== 'council';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const unitName = `UBND ${tenant?.unit_type === 'phuong' ? 'phường' : 'xã'} ${String(tenant?.name ?? '').replace(/^(Phường|Xã)\s+/i, '')}`;

  const renderNarrative = (slot: RenderedSlot) => {
    const n = narBySlot[slot.slot_code];
    const isEditing = editing === slot.slot_code;
    if (!n) return slot.text ? <p className="indent-8 text-justify">{slot.text}</p> : <p className="indent-8 italic text-ink-faint">[{slot.section}{slot.title ? ` ${slot.title}` : ''}] Văn phòng chưa biên tập.</p>;
    const latest = n.latest; const accepted = n.accepted;
    return (
      <div className={`rounded-lg ${isEditing ? 'border border-primary-200 bg-primary-50/40 p-3' : ''}`} style={{ fontFamily: 'inherit' }}>
        {!isEditing && (accepted ? <p className="indent-8 text-justify">{accepted.text}</p> : <p className="indent-8 italic text-ink-faint">[{slot.section}{slot.title ? ` ${slot.title}` : ''}] Văn phòng chưa biên tập.</p>)}
        {!isEditing && latest && latest.status === 'draft' && (!accepted || latest.version > accepted.version) && <p className="mt-1 text-[12px] text-amber-800" style={{ fontFamily: 'var(--font-sans)' }}>Có bản nháp mới (phiên bản {latest.version}, {latest.source === 'llm' ? 'mô hình gợi ý' : latest.source === 'dept' ? 'bộ phận gửi' : 'đang soạn'}) chưa được chấp nhận.</p>}
        {n.editable && canEdit && !isEditing && <button type="button" className="mt-1 text-[12.5px] font-semibold text-primary-600 hover:underline" style={{ fontFamily: 'var(--font-sans)' }} onClick={() => { setEditing(slot.slot_code); setDraft(latest?.text ?? accepted?.text ?? n.suggestions.template ?? n.suggestions.previous?.text ?? ''); }}>{accepted ? 'Sửa lời dẫn' : 'Biên tập lời dẫn'}</button>}
        {isEditing && (
          <div className="space-y-2" style={{ fontFamily: 'var(--font-sans)' }}>
            <div className="flex flex-wrap gap-1.5 text-xs2">
              {n.suggestions.template && <ToolbarButton size="sm" onClick={() => setDraft(n.suggestions.template)}>Dùng khuôn câu</ToolbarButton>}
              {n.suggestions.previous && <ToolbarButton size="sm" onClick={() => setDraft(n.suggestions.previous.text)} title={`Lời dẫn ${n.suggestions.previous.period_label}, đã đổi tên kỳ`}>Dùng lời kỳ trước</ToolbarButton>}
              {n.suggestions.events?.length > 0 && <ToolbarButton size="sm" onClick={() => setDraft((d) => `${d.trim()} ${d.trim() ? ' ' : ''}Trong ${data.document.period_label}, UBND đã ban hành ${n.suggestions.events.slice(0, 3).join('; ')}.`)}>Thêm sự kiện</ToolbarButton>}
              <ToolbarButton size="sm" onClick={() => suggest.mutate({ slot: slot.slot_code, provider: 'template' })} loading={suggest.isPending}>Gợi ý tự động</ToolbarButton>
              {n.llm_enabled && <ToolbarButton size="sm" onClick={() => suggest.mutate({ slot: slot.slot_code, provider: 'llm' })} loading={suggest.isPending}>Gợi ý bằng mô hình</ToolbarButton>}
            </div>
            <TextareaInput rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
            {n.suggestions.metric_sentences?.length > 0 && <p className="text-xs2 text-ink-muted">Câu số đã khoá trong mục này (không nêu số khác): {n.suggestions.metric_sentences.join(' ')}</p>}
            {latest?.postcheck?.warnings?.length > 0 && <p className="text-xs2 text-amber-800">{latest.postcheck.warnings.join(' ')}</p>}
            <div className="flex flex-wrap gap-2">
              <ToolbarButton variant="primary" size="sm" loading={save.isPending} disabled={!draft.trim()} onClick={() => save.mutate({ slot: slot.slot_code, text: draft })}>Lưu bản nháp</ToolbarButton>
              {canManage && latest && latest.status === 'draft' && <ToolbarButton size="sm" loading={accept.isPending} onClick={() => accept.mutate(slot.slot_code)}>Chấp nhận bản nháp {latest.version}</ToolbarButton>}
              <ToolbarButton variant="ghost" size="sm" onClick={() => setEditing(null)}>Đóng</ToolbarButton>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Kỳ báo cáo" title={`Đọc báo cáo ${document.period_label}`} description={live ? 'Kỳ chưa chốt: văn bản dựng từ số hiện hành, có thể còn đổi. Bấm vào từng con số để xem nguồn.' : 'Văn bản dựng từ bộ số đã chốt. Bấm vào từng con số để xem nguồn, ai xác nhận, ai duyệt.'}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Link href={`/report-runs/${id}`} className="inline-flex h-10 items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 hover:bg-slate-50">Tiến độ và kiểm tra</Link>
          {canManage && run.status === 'collecting' && <ToolbarButton variant="primary" disabled={!gate?.ok} loading={lock.isPending} title={gate?.ok ? '' : 'Còn lỗi kiểm tra'} onClick={() => lock.mutate()}>Chốt kỳ</ToolbarButton>}
          {canManage && ['locked', 'drafted'].includes(run.status) && <ToolbarButton variant="primary" loading={render.isPending} onClick={() => render.mutate()}>{run.output_file ? 'Sinh lại Word' : 'Sinh Word'}</ToolbarButton>}
          {run.output_file && <a className="inline-flex h-10 items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 hover:bg-slate-50" href={`${apiUrl}/admin/report-runs/${run.run_id}/download`}>Tải Word</a>}
          {canManage && run.status === 'drafted' && <ToolbarButton variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>Trình ký</ToolbarButton>}
          {canManage && run.status === 'submitted' && <ToolbarButton variant="primary" loading={checkSign.isPending} onClick={() => checkSign.mutate()}>Kiểm tra ký</ToolbarButton>}
        </div>} />
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-rule bg-white px-4 py-2.5">
        <RunStepper status={run.status} light />
        <span className="ml-auto text-xs2 text-ink-muted">{spec?.title}{run.signed_number ? ` · số ${run.signed_number}` : ''}</span>
      </div>
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
      {postcheck?.errors?.length > 0 && <Callout tone="danger" title="Bản văn bản còn chỗ không khớp bộ số">{postcheck.errors.join(' · ')}</Callout>}
      {postcheck?.warnings?.length > 0 && <Callout tone="warning" title="Cảnh báo nhất quán kỳ">{postcheck.warnings.join(' · ')}</Callout>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-x-auto rounded-card bg-slate-200/60 p-3 md:p-6">
          <ReportDocument doc={document} unitName={unitName} signedNumber={run.signed_number} signedDate={run.signed_date ? fmtDate(run.signed_date) : null}
            onOpen={(seg: Segment) => setSel({ ref: seg.ref!, kind: seg.kind, text: seg.text })} renderNarrative={me.role === 'council' ? undefined : renderNarrative}
            issuesBySlot={Object.fromEntries(Object.entries(issuesBySlot).map(([k, v]) => [k, <div key={k} className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[12.5px] text-amber-900" style={{ fontFamily: 'var(--font-sans)' }}>{v.map((i: any, idx: number) => <p key={idx}>{i.level === 'error' ? '✗' : '!'} {i.title ?? i.message}</p>)}</div>]))} />
        </div>
        <div className="space-y-4">
          <Panel title={<>Kiểm tra chất lượng {gate ? (gate.ok ? <Tag preset="green">Đạt</Tag> : <Tag preset="red">{gate.errors.length} lỗi</Tag>) : null}</>}>
            <GateIssueList issues={[...(gate?.errors ?? []), ...(gate?.warnings ?? [])]} groupLabel={lb.gateGroup} />
          </Panel>
          <Panel title="Chú giải màu số" padded>
            <ul className="space-y-1 text-xs2 text-ink-3">
              <li><span className="kpi-num rounded border-b-2 border-dotted border-primary-300 px-0.5 font-semibold text-primary-700">17.206</span> số gốc từ kho, bấm để xem nguồn</li>
              <li><span className="kpi-num rounded border-b-2 border-dotted border-emerald-300 px-0.5 font-semibold text-emerald-800">98,8%</span> tỷ lệ tính từ hai số gốc</li>
              <li><span className="kpi-num rounded border-b-2 border-dotted border-amber-300 px-0.5 font-semibold text-amber-800">đạt 79,2% kế hoạch</span> so kế hoạch năm</li>
              <li><span className="kpi-num rounded border-b-2 border-dotted border-cyan-300 px-0.5 font-semibold text-cyan-800">tăng 3,2% so với cùng kỳ</span> so cùng kỳ năm trước</li>
            </ul>
          </Panel>
        </div>
      </div>
      <ProvenanceDrawer open={!!sel} onClose={() => setSel(null)} refData={sel?.ref ?? null} kind={sel?.kind} text={sel?.text} period={run.period} />
    </div>
  );
}
