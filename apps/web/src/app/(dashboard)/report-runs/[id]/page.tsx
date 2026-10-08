'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiGet } from '@/lib/api';
import { Callout, GateIssueList, LoadingState, PageHeader, Panel, PeriodBand, Tag, TechDetails, ToolbarButton } from '@/components/ui/admin-ui';
import { currentAdmin, errMsg, fmtDate } from '@/lib/do360';
import { useLabels } from '@/lib/labels';

/** Màn Văn phòng: tiến độ theo mục báo cáo, Quality Gate nói bằng câu, ngoại lệ ngày chốt, chốt/mở kỳ, sinh và tải bản nháp, trình ký. */
export default function ReportRunDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const me = currentAdmin();
  const lb = useLabels();
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const [rendered, setRendered] = useState<any>(null);
  const { data, isLoading } = useQuery<any>({ queryKey: ['report-run', Number(id)], queryFn: () => apiGet(`/admin/report-runs/${id}`), refetchInterval: 30_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['report-run', Number(id)] }); qc.invalidateQueries({ queryKey: ['report-runs'] }); qc.invalidateQueries({ queryKey: ['facts'] }); };
  const fail = (e: any) => setNotice({ tone: 'danger', text: e?.response?.data?.message?.message ?? errMsg(e) });
  const lock = useMutation({ mutationFn: () => api.post(`/admin/report-runs/${id}/lock`).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã chốt kỳ. Bộ số đã đóng băng, không nhận số mới.' }); refresh(); }, onError: fail });
  const unlock = useMutation({ mutationFn: (reason: string) => api.post(`/admin/report-runs/${id}/unlock`, { reason }).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'warning', text: 'Đã mở lại kỳ. Số trở về trạng thái đã duyệt.' }); setRendered(null); refresh(); }, onError: fail });
  const render = useMutation({ mutationFn: () => api.post(`/admin/report-runs/${id}/render`).then((r) => r.data), onSuccess: (r) => { setRendered(r); setNotice({ tone: 'success', text: `Đã sinh bản nháp Word. Hậu kiểm: ${r.postcheck.errors.length} lỗi, ${r.postcheck.warnings.length} cảnh báo.` }); refresh(); }, onError: fail });
  const submit = useMutation({ mutationFn: () => api.post(`/admin/qlvb/report-runs/${id}/submit`, {}).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'success', text: 'Đã trình ký. Bấm "Kiểm tra ký" khi lãnh đạo đã ký trên QLVB.' }); refresh(); }, onError: fail });
  const checkSign = useMutation({ mutationFn: () => api.post(`/admin/qlvb/report-runs/${id}/check-sign`).then((r) => r.data), onSuccess: (r) => { setNotice({ tone: r.status === 'signed' ? 'success' : 'warning', text: r.status === 'signed' ? `Đã ký: số ${r.run.signed_number} ngày ${fmtDate(r.run.signed_date)}. Kỳ khoá vĩnh viễn.` : r.status === 'rejected' ? `QLVB trả lại: ${r.note ?? ''}` : 'QLVB chưa ký.' }); refresh(); }, onError: fail });
  const cancel = useMutation({ mutationFn: (reason: string) => api.post(`/admin/report-runs/${id}/cancel`, { reason }).then((r) => r.data), onSuccess: () => { setNotice({ tone: 'warning', text: 'Đã huỷ lần lập báo cáo này.' }); refresh(); }, onError: fail });
  const edited = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); return api.post(`/admin/report-runs/${id}/edited`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data); },
    onSuccess: (r) => { setNotice({ tone: r.ok ? 'success' : 'danger', text: r.ok ? `Bản Word đã sửa khớp bộ số đã chốt (${r.draft_numbers} số). ${r.unknown.length ? 'Số lạ cần soát: ' + r.unknown.join(', ') : 'Không có số lạ.'}` : `Bản Word đã sửa THIẾU hoặc ĐỔI số so với bản nháp: ${r.missing.join(', ')}${r.unknown.length ? '. Số lạ: ' + r.unknown.join(', ') : ''}` }); refresh(); }, onError: fail });
  const exception = useMutation({ mutationFn: ({ indicator_ids, reason }: { indicator_ids: string[]; reason: string }) => api.post(`/admin/report-runs/${id}/exceptions`, { indicator_ids, reason }).then((r) => r.data), onSuccess: refresh, onError: fail });

  if (isLoading || !data) return <LoadingState />;
  const { run, spec, gate } = data;
  const canManage = ['super_admin', 'commune_admin'].includes(me.role ?? '');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const slotsDone = gate.slots.filter((s: any) => s.complete).length;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Kỳ báo cáo" title={`${spec?.title ?? 'Báo cáo'} ${lb.period(run.period)}`} description="Thu số từ các bộ phận, kiểm tra chất lượng, chốt kỳ, sinh bản nháp Word rồi trình ký."
        actions={<div className="flex flex-wrap items-center gap-2">
          <Link href={`/report-runs/${id}/read`} className="inline-flex h-10 items-center rounded-lg bg-primary-50 px-4 text-sm2 font-semibold text-primary-700 transition-colors hover:bg-primary-100">Đọc báo cáo</Link>
          {canManage && run.status === 'collecting' && <ToolbarButton variant="primary" disabled={!gate.ok || lock.isPending} title={gate.ok ? '' : 'Còn lỗi kiểm tra, chưa chốt được'} onClick={() => lock.mutate()}>Chốt kỳ</ToolbarButton>}
          {canManage && ['locked', 'drafted'].includes(run.status) && <ToolbarButton variant="primary" disabled={render.isPending} onClick={() => render.mutate()}>{render.isPending ? 'Đang sinh…' : run.output_file ? 'Sinh lại bản nháp Word' : 'Sinh bản nháp Word'}</ToolbarButton>}
          {run.output_file && <a className="inline-flex h-10 items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 transition-colors hover:bg-slate-50" href={`${apiUrl}/admin/report-runs/${run.run_id}/download`}>Tải Word</a>}
          {canManage && ['locked', 'drafted'].includes(run.status) && <ToolbarButton variant="ghost" onClick={() => { const r = window.prompt('Lý do mở lại kỳ (bắt buộc):'); if (r) unlock.mutate(r); }}>Mở lại kỳ</ToolbarButton>}
          {canManage && run.status === 'drafted' && <ToolbarButton variant="primary" disabled={submit.isPending} onClick={() => submit.mutate()}>Trình ký</ToolbarButton>}
          {canManage && run.status === 'submitted' && <ToolbarButton variant="primary" disabled={checkSign.isPending} onClick={() => checkSign.mutate()}>Kiểm tra ký</ToolbarButton>}
          {canManage && run.fact_snapshot && <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-rule bg-white px-4 text-sm2 font-semibold text-ink-2 transition-colors hover:bg-slate-50">{edited.isPending ? 'Đang đối chiếu…' : 'Đối chiếu bản Word đã sửa'}<input type="file" accept=".docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) edited.mutate(f); e.target.value = ''; }} /></label>}
          {me.role === 'super_admin' && run.status !== 'cancelled' && <ToolbarButton variant="ghost" onClick={() => { const r = window.prompt('Lý do HUỶ lần lập báo cáo này (bắt buộc):'); if (r) cancel.mutate(r); }}>Huỷ</ToolbarButton>}
        </div>} />
      <PeriodBand period={run.period} label={spec?.title} status={run.status} cutoff={fmtDate(run.cutoff_date)} meta={<>{run.locked_at ? <> · đã chốt {fmtDate(run.locked_at)}</> : null}{run.signed_number ? <> · số {run.signed_number} ký ngày {fmtDate(run.signed_date)}</> : null}</>} />
      {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={<>Tiến độ theo mục báo cáo <span className="kpi-num ml-1 text-xs2 font-normal text-ink-muted">{slotsDone}/{gate.slots.length} mục đủ số đã duyệt</span></>}
          actions={<Link href={`/facts?period=${run.period}`} className="text-xs2 font-medium text-primary-600 hover:underline">Mở bảng số liệu</Link>}>
          <ul className="divide-y divide-rule">
            {gate.slots.map((s: any) => (
              <li key={s.slot_code} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm2 font-semibold text-ink"><span className="kpi-num mr-1.5 text-ink-faint">{s.section}</span>{s.title ?? lb.slotTitle(run.spec_id, s.slot_code)}</p>
                    {s.owner_dept && <p className="text-xs2 text-ink-muted">Phòng chủ số liệu: {s.owner_dept_name ?? lb.dept(s.owner_dept)}</p>}
                  </div>
                  <Tag preset={s.complete ? 'green' : 'gold'}>{s.complete ? 'Đủ số đã duyệt' : 'Chưa đủ'}</Tag>
                </div>
                {s.indicators.length > 0 && (
                  <div className="mt-1.5 grid gap-x-4 gap-y-0.5 text-xs2 text-ink-3 sm:grid-cols-2">
                    {s.indicators.map((i: any) => <span key={i.id}>{i.name ?? lb.ind(i.id)}: {i.fact ? <b className="kpi-num text-ink">{Number(i.fact.value).toLocaleString('vi-VN')}</b> : <span className="text-amber-700">chưa có số</span>}{i.fact && <span className="text-ink-faint"> ({lb.factStatus(i.fact.status)})</span>}</span>)}
                  </div>
                )}
                {s.checks?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs2">
                    {s.checks.map((c: any) => <span key={c.check} className={c.ok ? 'text-emerald-700' : c.missing?.length ? 'text-ink-faint' : 'text-red-700'} title={c.check}>{c.ok ? '✓' : c.missing?.length ? '…' : '✗'} {c.label ?? c.check.replace(/==/g, '=').replace(/[\w.]+/g, (t: string) => (/^\d/.test(t) ? t : lb.ind(t)))}</span>)}
                  </div>
                )}
                <TechDetails>{s.slot_code} · {s.slot_type} · {s.indicators.map((i: any) => i.id).join(', ')}{s.checks?.length ? ` · ${s.checks.map((c: any) => c.check).join(' | ')}` : ''}</TechDetails>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel title={<>Kiểm tra chất lượng {gate.ok ? <Tag preset="green">Đạt</Tag> : <Tag preset="red">{gate.errors.length} lỗi</Tag>}{gate.warnings.length > 0 && <Tag preset="gold" className="ml-1">{gate.warnings.length} cảnh báo</Tag>}</>}>
            <GateIssueList issues={[...gate.errors, ...gate.warnings]} groupLabel={lb.gateGroup}
              action={(e) => e.kind === 'cutoff_mismatch' && e.level === 'error' && canManage && run.status === 'collecting' && e.indicator
                ? <button className="text-xs2 font-medium text-primary-600 hover:underline" onClick={() => { const ids = e.indicator_ids?.length ? e.indicator_ids : [e.indicator!]; const r = window.prompt(`Lý do ngoại lệ ngày chốt cho ${ids.length > 1 ? `${ids.length} chỉ tiêu của mục "${e.slot_title ?? ''}"` : `"${e.indicator_name ?? lb.ind(e.indicator)}"`}:`); if (r) exception.mutate({ indicator_ids: ids, reason: r }); }}>Ghi lý do ngoại lệ</button>
                : null} />
          </Panel>
          {run.fact_snapshot && (
            <Panel title="Bộ số đã đóng băng" padded>
              <p className="text-sm2 text-ink-3"><span className="kpi-num">{Object.keys(run.fact_snapshot.facts ?? {}).length}</span> chỉ tiêu · <span className="kpi-num">{run.fact_snapshot.events?.length ?? 0}</span> sự kiện chỉ đạo · chốt lúc {fmtDate(run.fact_snapshot.locked_at)}</p>
              <p className="mt-1 text-xs2 text-ink-muted">Bản nháp và bản ký chỉ đọc từ bộ số này, nên tái lập được đúng báo cáo khi bị hỏi lại.</p>
            </Panel>
          )}
          {run.edited_check && (
            <Callout tone={run.edited_check.ok ? 'success' : 'danger'} title={run.edited_check.ok ? 'Bản Word đã sửa khớp bộ số đã chốt' : 'Bản Word đã sửa lệch bộ số đã chốt'}>
              {run.edited_check.file} · {fmtDate(run.edited_check.checked_at)}{run.edited_check.missing?.length ? `. Thiếu hoặc đổi: ${run.edited_check.missing.join(', ')}` : ''}{run.edited_check.unknown?.length ? `. Số lạ cần soát: ${run.edited_check.unknown.join(', ')}` : ''} · <a className="underline" href={`${apiUrl}/admin/report-runs/${run.run_id}/download?which=edited`}>tải bản đã sửa</a>
            </Callout>
          )}
          <TechDetails>mẫu {spec?.spec_code}@{spec?.version} · kỳ {run.period} · lần lập #{run.run_id}</TechDetails>
        </div>
      </div>

      {rendered && (
        <Panel title="Bản nháp vừa sinh — nội dung từng mục">
          <ul className="divide-y divide-rule">
            {rendered.slots.map((s: any) => <li key={s.slot_code} className="px-5 py-3 text-sm2"><span className="kpi-num mr-1.5 text-ink-faint">{s.section}</span>{s.text || <i className="text-ink-faint">(trống — {s.missing.map((m: string) => lb.ind(m)).join(', ')})</i>}</li>)}
          </ul>
          {(rendered.postcheck.errors.length > 0 || rendered.postcheck.warnings.length > 0) && <div className="border-t border-rule px-5 py-3 text-xs2">{rendered.postcheck.errors.map((e: string) => <p key={e} className="text-red-700">✗ {e}</p>)}{rendered.postcheck.warnings.map((w: string) => <p key={w} className="text-amber-700">! {w}</p>)}</div>}
        </Panel>
      )}
    </div>
  );
}
