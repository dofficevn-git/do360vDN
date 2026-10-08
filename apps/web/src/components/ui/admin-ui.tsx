'use client';

import Link from 'next/link';
import { useEffect, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Check, X, Trash2, AlertTriangle, ChevronLeft, ChevronRight, Info, CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { periodLabel } from '@/lib/labels';

/* ============================================================
   Bộ thành phần DO360 cấp xã v3 (06/10/2026)
   - Thẻ phẳng (.card), viền mảnh, không bóng; bóng chỉ cho popover/modal.
   - Chữ nền 14px; nhãn bảng 12.5px sentence case; số .kpi-num.
   - Màu = trạng thái (Tag có chấm màu + chữ → không chỉ dựa vào màu).
   - Nút 40px, focus ring toàn cục (globals.css), cursor-pointer.
   Giữ nguyên tên/chữ ký các thành phần cũ để trang hiện có không phải sửa.
   ============================================================ */

export function BoolCheck({ value }: { value: boolean }) {
  return value ? (
    <Check className="mx-auto h-4 w-4 text-emerald-600" strokeWidth={2.5} aria-label="Có" />
  ) : (
    <X className="mx-auto h-4 w-4 text-slate-300" strokeWidth={2.5} aria-label="Không" />
  );
}

/* ─── Tag: nhãn trạng thái — nền nhạt + chấm màu + chữ đậm ─── */

export type TagPreset = 'green' | 'gold' | 'red' | 'blue' | 'cyan' | 'magenta' | 'geekblue' | 'purple' | 'neutral';

const TAG_PRESETS: Record<TagPreset, { bg: string; border: string; text: string; dot: string }> = {
  green: { bg: '#EAF6EE', border: '#B9DFC5', text: '#166534', dot: '#15803D' },
  gold: { bg: '#FBF3E1', border: '#EAD3A0', text: '#8A5A0B', dot: '#B45309' },
  red: { bg: '#FBEAEA', border: '#EFB8B8', text: '#991B1B', dot: '#B91C1C' },
  blue: { bg: '#EEF3F9', border: '#B6C9E1', text: '#0F3D6E', dot: '#0F3D6E' },
  cyan: { bg: '#E6F4F7', border: '#A9D8E2', text: '#0E5B6E', dot: '#0E7490' },
  magenta: { bg: '#FBEAEA', border: '#EFB8B8', text: '#991B1B', dot: '#B91C1C' },
  geekblue: { bg: '#E8F0FB', border: '#B7CFF0', text: '#1B4F9B', dot: '#1D5FDB' },
  purple: { bg: '#EEF3F9', border: '#B6C9E1', text: '#0F3D6E', dot: '#0F3D6E' },
  neutral: { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569', dot: '#94A3B8' },
};

export function Tag({ preset = 'neutral', children, className, dot = true }: { preset?: TagPreset; children: ReactNode; className?: string; dot?: boolean }) {
  const c = TAG_PRESETS[preset];
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs2 font-semibold leading-5', className)}
      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.dot }} />}
      {children}
    </span>
  );
}

type Tone = 'primary' | 'blue' | 'green' | 'amber' | 'red' | 'slate';
const TONE_TO_PRESET: Record<Tone, TagPreset> = { primary: 'geekblue', blue: 'blue', green: 'green', amber: 'gold', red: 'red', slate: 'neutral' };
export function StatusBadge({ children, tone = 'slate' }: { children: ReactNode; tone?: Tone }) {
  return <Tag preset={TONE_TO_PRESET[tone]}>{children}</Tag>;
}

/* ─── Page header: tiêu đề 22px, dòng ngữ cảnh sentence case, hành động bên phải ─── */

export function PageHeader({ title, description, eyebrow, actions }: { title: string; description?: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pb-2 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs2 font-medium text-ink-faint">{eyebrow}</p>}
        <h1 className="m-0 text-[22px] font-bold leading-tight tracking-[-0.2px] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm2 leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ─── Panel: khối nội dung có tiêu đề (thay các div card viết tay) ─── */

export function Panel({ title, actions, children, className, padded = false }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card overflow-hidden', className)}>
      {(title || actions) && (
        <div className="card-head">
          <h2 className="card-title">{title}</h2>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'px-5 py-4' : undefined}>{children}</div>
    </section>
  );
}

/* ─── StatTile: số lớn dạng bảng + nhãn + thanh màu trạng thái bên trái ─── */

export function StatTile({ label, value, sub, color = '#0F3D6E', href, onClick, icon }: {
  label: string; value: number | string; sub?: string; color?: string; href?: string; onClick?: () => void; icon?: ReactNode;
}) {
  const interactive = !!(href || onClick);
  const inner = (
    <div
      className={clsx('card relative flex h-full flex-col justify-between overflow-hidden px-4 py-3.5 pl-5', interactive && 'cursor-pointer transition-colors duration-150 hover:border-rule-strong hover:bg-slate-50')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r" style={{ backgroundColor: color }} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm2 font-medium text-ink-muted">{label}</span>
        {icon && <span className="text-ink-faint [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      </div>
      <div className="kpi-num mt-2 text-[26px] font-bold leading-none tracking-[-0.5px] text-ink">{value}</div>
      {sub && <div className="mt-1.5 text-xs2 text-ink-faint">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-card">{inner}</Link> : inner;
}

/* ─── Buttons ─── */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700',
  secondary: 'border border-rule bg-white text-ink-2 hover:bg-slate-50 hover:border-rule-strong',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-ink-muted hover:bg-slate-100 hover:text-ink',
};

export function ToolbarButton({ children, onClick, variant = 'secondary', size, type = 'button', disabled, className, title, loading }: {
  children: ReactNode; onClick?: () => void; variant?: ButtonVariant; size?: 'icon' | 'sm'; type?: 'button' | 'submit'; disabled?: boolean; className?: string; title?: string; loading?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={size === 'icon' ? title : undefined}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'icon' ? 'h-10 w-10' : size === 'sm' ? 'h-8 px-3 text-xs2' : 'h-10 px-4 text-sm2',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ToolbarLink({ children, href, variant = 'secondary', className }: { children: ReactNode; href: string; variant?: ButtonVariant; className?: string }) {
  return (
    <Link href={href} className={clsx('inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm2 font-semibold transition-colors duration-150', BUTTON_VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

/* ─── Empty / loading / skeleton ─── */

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-rule-strong bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 w-fit text-slate-300 [&>svg]:h-8 [&>svg]:w-8">{icon}</div>}
      <p className="text-base2 font-semibold text-ink-2">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm2 text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('skeleton', className)} />;
}

/** Trạng thái đang tải: khung xương giữ chỗ (không nhảy bố cục). */
export function LoadingState({ text = 'Đang tải…', rows = 4 }: { text?: string; rows?: number }) {
  return (
    <div className="card px-5 py-4" role="status" aria-live="polite" aria-label={text}>
      <div className="flex items-center gap-2 text-sm2 text-ink-faint"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{text}</div>
      <div className="mt-4 space-y-2.5">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div>
    </div>
  );
}

/* ─── Tabs: thanh phân đoạn gạch chân ─── */

export function FilterTabs<T extends string>({ value, items, onChange }: { value: T; items: { value: T; label: string; count?: number }[]; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-rule">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(item.value)}
            className={clsx(
              '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm2 font-semibold transition-colors duration-150',
              active ? 'border-primary-500 text-primary-600' : 'border-transparent text-ink-muted hover:border-rule-strong hover:text-ink',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span className={clsx('kpi-num rounded-md px-1.5 py-px text-2xs font-semibold', active ? 'bg-primary-50 text-primary-600' : 'bg-slate-100 text-ink-muted')}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Pagination ─── */

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-1 px-4 py-3">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Trang trước" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-slate-100 disabled:opacity-40">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="kpi-num px-2 text-sm2 text-ink-muted">Trang {page}/{totalPages}</span>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages} aria-label="Trang sau" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-slate-100 disabled:opacity-40">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ─── DataTable: khung bảng + toolbar + pagination ─── */

export function DataTable({ children, empty, isLoading, loadingText = 'Đang tải…', toolbar, pagination, className }: {
  children: ReactNode; empty?: ReactNode; isLoading?: boolean; loadingText?: string; toolbar?: ReactNode; pagination?: { page: number; totalPages: number; onChange: (page: number) => void }; className?: string;
}) {
  if (isLoading) return <LoadingState text={loadingText} />;
  if (empty) return <>{empty}</>;
  return (
    <div className={clsx('card overflow-hidden', className)}>
      {toolbar && <div className="border-b border-rule px-4 py-3">{toolbar}</div>}
      <div className="tbl-wrap overflow-x-auto">{children}</div>
      {pagination && <div className="border-t border-rule"><Pagination {...pagination} /></div>}
    </div>
  );
}

/** Class cho bảng viết tay: thead TABLE_HEAD_CLS, th TABLE_TH_CLS, tr body row-hover, td TABLE_TD_CLS */
export const TABLE_HEAD_CLS = 'bg-slate-50 text-xs2 font-semibold text-ink-muted';
export const TABLE_TH_CLS = 'px-3 py-2.5 text-left font-semibold';
export const TABLE_TD_CLS = 'px-3 py-2.5 text-sm2';

/* ─── Callout: thông điệp ngữ cảnh — viền trái đậm, nền nhạt ─── */

export function Callout({ children, tone = 'info', className, title }: { children: ReactNode; tone?: 'info' | 'danger' | 'warning' | 'success'; className?: string; title?: string }) {
  const map = {
    info: { bg: 'var(--info-soft)', border: 'var(--info)', color: 'var(--info-text)', Icon: Info },
    danger: { bg: 'var(--danger-soft)', border: 'var(--danger)', color: 'var(--danger-text)', Icon: CircleAlert },
    warning: { bg: 'var(--warning-soft)', border: 'var(--warning)', color: 'var(--warning-text)', Icon: AlertTriangle },
    success: { bg: 'var(--success-soft)', border: 'var(--success)', color: 'var(--success-text)', Icon: CircleCheck },
  }[tone];
  const Icon = map.Icon;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex items-start gap-2.5 rounded-lg border-l-4 px-3.5 py-2.5 text-sm2', className)} style={{ background: map.bg, borderLeftColor: map.border, color: map.color }}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 leading-relaxed">{title && <p className="font-semibold">{title}</p>}{children}</div>
    </div>
  );
}

/* ─── ProgressBar ─── */

export function ProgressBar({ percent, color = '#0F3D6E', className, label }: { percent: number; color?: string; className?: string; label?: string }) {
  const p = Math.min(100, Math.max(0, percent));
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded bg-slate-100', className)} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded transition-[width] duration-300" style={{ width: `${p}%`, backgroundColor: color }} />
    </div>
  );
}

/* ─── Form ─── */

export function FormField({ label, hint, error, children, required }: { label: string; hint?: string; error?: string | null; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="block text-sm2 font-semibold text-ink-2">{label}{required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}</span>
      {hint && <span className="mt-0.5 block text-xs2 text-ink-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs2 font-medium text-red-700" role="alert">{error}</span>}
    </label>
  );
}

const INPUT_CLS = 'w-full rounded-lg border border-rule-strong bg-white px-3 text-base2 text-ink outline-none transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25 disabled:bg-slate-50 disabled:text-ink-faint';

export function TextInput(props: ComponentPropsWithoutRef<'input'>) {
  return <input {...props} className={clsx(INPUT_CLS, 'h-10', props.className)} />;
}
export function SelectInput(props: ComponentPropsWithoutRef<'select'>) {
  return <select {...props} className={clsx(INPUT_CLS, 'h-10 pr-8', props.className)} />;
}
export function TextareaInput(props: ComponentPropsWithoutRef<'textarea'>) {
  return <textarea {...props} className={clsx(INPUT_CLS, 'py-2', props.className)} />;
}

export function FormSection({ title, description, children, columns = 1, className }: { title?: string; description?: string; children: ReactNode; columns?: 1 | 2; className?: string }) {
  return (
    <section className={clsx('card p-5', className)}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="text-base2 font-semibold text-ink">{title}</h3>}
          {description && <p className="mt-0.5 text-xs2 text-ink-muted">{description}</p>}
        </div>
      )}
      <div className={clsx('grid gap-4', columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1')}>{children}</div>
    </section>
  );
}

export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex flex-wrap items-center justify-end gap-2 border-t border-rule pt-4', className)}>{children}</div>;
}

/* ─── KeyValue: cặp nhãn/giá trị gọn ─── */

export function KeyValue({ items, className }: { items: { k: string; v: ReactNode }[]; className?: string }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-2 text-sm2 sm:grid-cols-2', className)}>
      {items.map((it) => (
        <div key={it.k} className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule pb-1.5">
          <dt className="text-ink-muted">{it.k}</dt>
          <dd className="kpi-num text-right font-medium text-ink">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ─── PeriodBand: dải kỳ báo cáo + tiến trình 5 bước (điểm nhấn duy nhất mang màu đậm) ─── */

export const RUN_STEPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'collecting', label: 'Thu số', statuses: ['collecting'] },
  { key: 'locked', label: 'Chốt kỳ', statuses: ['locked'] },
  { key: 'drafted', label: 'Bản nháp', statuses: ['drafted'] },
  { key: 'submitted', label: 'Trình ký', statuses: ['submitted'] },
  { key: 'signed', label: 'Đã ký', statuses: ['signed'] },
];

export function RunStepper({ status, className, light }: { status: string; className?: string; light?: boolean }) {
  const idx = RUN_STEPS.findIndex((s) => s.statuses.includes(status));
  const cancelled = status === 'cancelled';
  return (
    <ol className={clsx('flex flex-wrap items-center gap-x-1 gap-y-1', className)} aria-label="Tiến trình kỳ báo cáo">
      {RUN_STEPS.map((s, i) => {
        const state = cancelled ? 'off' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={clsx('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs2 font-semibold', light
                ? state === 'current' ? 'bg-accent-soft text-[#8A5A0B] ring-1 ring-accent-light' : state === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-faint'
                : state === 'current' ? 'bg-white/15 text-[#FFD66B] ring-1 ring-[#FFD66B]/60' : state === 'done' ? 'bg-white/10 text-white' : 'text-white/50')}
            >
              <span className="kpi-num">{i + 1}</span>{s.label}{state === 'done' && <Check className="h-3 w-3" aria-hidden />}
            </span>
            {i < RUN_STEPS.length - 1 && <span aria-hidden className={clsx('h-px w-3', light ? 'bg-rule-strong' : 'bg-white/25')} />}
          </li>
        );
      })}
      {cancelled && <li className="ml-2 text-xs2 font-semibold text-red-200">Đã huỷ</li>}
    </ol>
  );
}

export function PeriodBand({ period, label, status, cutoff, meta, actions, className }: {
  period: string; label?: string; status: string; cutoff?: string | null; meta?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <section className={clsx('period-band px-5 py-4 md:px-6', className)} aria-label={`Kỳ báo cáo ${period}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs2 font-medium text-white/70">Kỳ báo cáo</p>
          <p className="mt-0.5 text-[26px] font-bold leading-none tracking-[-0.3px]">{periodLabel(period, true)}{label && <span className="ml-2 text-base2 font-medium text-white/80">{label}</span>}</p>
          {(cutoff || meta) && <p className="mt-2 text-sm2 text-white/80">{cutoff && <>Ngày chốt số liệu <b className="kpi-num text-white">{cutoff}</b></>}{meta}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <RunStepper status={status} className="mt-4" />
    </section>
  );
}

/* ─── Modal / Confirm ─── */

export function Modal({ open, onClose, title, children, footer, maxWidth = 'max-w-md' }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode; maxWidth?: string }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-900/45 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} className={clsx('fade-in-up w-full overflow-hidden rounded-panel bg-white shadow-panel', maxWidth)} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
            <h3 id={id} className="text-md2 font-semibold text-ink">{title}</h3>
            <button onClick={onClose} aria-label="Đóng" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink"><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-rule px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onCancel, onConfirm, title, description, confirmText = 'Xoá', loading, danger = true }: {
  open: boolean; onCancel: () => void; onConfirm: () => void; title: string; description?: string; confirmText?: string; loading?: boolean; danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-900/45 p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" className="fade-in-up w-full max-w-sm rounded-panel bg-white p-6 text-center shadow-panel" onClick={(e) => e.stopPropagation()}>
        <div className={clsx('mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full', danger ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}>
          {danger ? <Trash2 className="h-6 w-6" aria-hidden /> : <AlertTriangle className="h-6 w-6" aria-hidden />}
        </div>
        <p className="text-base font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 text-sm2 text-ink-muted">{description}</p>}
        <div className="mt-5 flex gap-3">
          <button onClick={onCancel} className="h-10 flex-1 rounded-lg border border-rule text-sm2 font-semibold text-ink-2 transition-colors hover:bg-slate-50">Huỷ</button>
          <button onClick={onConfirm} disabled={loading} className={clsx('h-10 flex-1 rounded-lg text-sm2 font-semibold text-white transition-colors disabled:opacity-60', danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-500 hover:bg-primary-600')}>
            {loading ? 'Đang xử lý…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── TechDetails: mã kỹ thuật gập lại — nguyên tắc "nói tiếng cán bộ, giấu mã, không xoá mã" ─── */

export function TechDetails({ children, label = 'Chi tiết kỹ thuật', className, inline }: { children: ReactNode; label?: string; className?: string; inline?: boolean }) {
  return (
    <details className={clsx('tech-details group', inline ? 'inline-block' : 'mt-1', className)}>
      <summary className="cursor-pointer select-none text-2xs text-ink-faint hover:text-ink-muted">{label}</summary>
      <div className="mt-1 rounded-md bg-slate-50 px-2 py-1.5 font-mono text-2xs text-ink-muted">{children}</div>
    </details>
  );
}

/* ─── GateIssueList: vấn đề của Quality Gate nói bằng câu + gợi ý sửa + mã gập ─── */

export type GateIssueView = { group: string; kind?: string; level: 'error' | 'warning'; title?: string; detail?: string; fix_hint?: string; fix_link?: string; message: string; tech?: string; indicator?: string; indicator_ids?: string[]; indicator_name?: string; slot?: string; slot_title?: string; owner_dept_name?: string | null };

export function GateIssueList({ issues, groupLabel, action, empty = 'Không có cảnh báo.' }: {
  issues: GateIssueView[]; groupLabel?: (g: string) => string; action?: (issue: GateIssueView) => ReactNode; empty?: string;
}) {
  if (!issues.length) return <p className="px-5 py-3 text-sm2 text-ink-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-rule">
      {issues.map((e, i) => (
        <li key={i} className={clsx('px-5 py-2.5 text-sm2', e.level === 'error' ? 'text-red-800' : 'text-amber-800')}>
          <div className="flex items-start gap-2">
            {e.level === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p><span className="mr-1.5 rounded bg-white/70 px-1.5 py-px text-2xs font-semibold uppercase tracking-normal text-ink-muted" style={{ textTransform: 'none' }}>{groupLabel ? groupLabel(e.group) : e.group}</span>{e.title ?? e.message}</p>
              {e.detail && <p className="mt-0.5 text-xs2 opacity-90">{e.detail}</p>}
              {e.fix_hint && <p className="mt-0.5 text-xs2 text-ink-muted">{e.fix_hint}{e.fix_link && <> <Link href={e.fix_link} className="font-medium text-primary-600 hover:underline">Mở chỗ sửa</Link></>}</p>}
              {action && <div className="mt-1">{action(e)}</div>}
              {e.tech && <TechDetails>{e.tech}</TechDetails>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
