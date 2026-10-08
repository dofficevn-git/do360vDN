'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NAV_SECTIONS, visibleFor } from './nav-config';
import { useWork } from '@/lib/work';
import { adminRole as roleLabel } from '@/lib/status-maps';
import { useFeatures } from '@/lib/features';

/* Sidebar v3: nền trắng tách khỏi canvas bằng hairline; mục 40px; active = vạch xanh trái + nền tint;
   nhãn nhóm sentence case; thu gọn thành rail 64px (nhớ localStorage). */

const COLLAPSE_KEY = 'do360-sidebar-collapsed';
const GROUPS_KEY = 'do360-sidebar-groups';

type AdminUser = { id: number; full_name: string; role: string };

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    try { setClosedGroups(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}')); } catch { setClosedGroups({}); }
    try { const raw = Cookies.get('admin_user'); if (raw) setAdminUser(JSON.parse(raw)); } catch { /* cookie hỏng */ }
  }, []);

  useEffect(() => {
    const active = NAV_SECTIONS.find((s) => s.items.some((item) => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))));
    if (active?.label && closedGroups[active.label]) {
      setClosedGroups((prev) => { const next = { ...prev, [active.label as string]: false }; localStorage.setItem(GROUPS_KEY, JSON.stringify(next)); return next; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggleCollapsed() { setCollapsed((v) => { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); return !v; }); }
  function toggleGroup(label: string) { setClosedGroups((prev) => { const next = { ...prev, [label]: !prev[label] }; localStorage.setItem(GROUPS_KEY, JSON.stringify(next)); return next; }); }

  const adminRoleKey: string | null = adminUser?.role ?? null;
  const { has: hasFeature } = useFeatures();
  const { data: work } = useWork(!!adminUser);
  const isDataOwner = !!work?.me?.is_data_owner;
  const { data: quarantine } = useQuery<any[]>({ queryKey: ['quarantine'], queryFn: () => apiGet('/admin/facts/quarantine'), refetchInterval: 60_000, staleTime: 30_000 });
  const badges: Record<string, number> = { facts_pending: quarantine?.length ?? 0 };

  function handleLogout() { Cookies.remove('access_token'); Cookies.remove('admin_user'); router.push('/login'); }

  const initials = (adminUser?.full_name ?? 'QT').split(' ').map((w: string) => w[0]).slice(-2).join('').toUpperCase();
  const badgeCls = 'kpi-num rounded-full bg-amber-100 px-1.5 py-px text-center text-2xs font-bold leading-4 text-amber-800';

  return (
    <aside className="flex h-full shrink-0 flex-col border-r border-rule bg-white text-ink-2 transition-[width] duration-200 ease-out" style={{ width: collapsed ? 64 : 252 }} aria-label="Điều hướng chính">
      <div className={clsx('flex items-center', collapsed ? 'flex-col gap-2 px-0 pb-2 pt-4' : 'gap-2.5 px-4 pb-3 pt-4')}>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-logo bg-primary-500 text-xs font-extrabold tracking-[0.3px] text-white" aria-hidden>DO</div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm2 font-bold leading-tight text-ink">DO360 cấp xã</p>
            <p className="truncate text-2xs text-ink-faint">Tổng hợp số liệu và báo cáo</p>
          </div>
        )}
        <button onClick={toggleCollapsed} aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'} title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink">
          {collapsed ? <PanelLeftOpen className="h-4 w-4" strokeWidth={2} /> : <PanelLeftClose className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>

      <nav className={clsx('sidebar-scroll-light flex-1 pb-2', collapsed ? 'px-2' : 'px-3')}>
        {NAV_SECTIONS.map((section, si) => {
          const isOpen = !section.label || !closedGroups[section.label];
          const visibleItems = section.items.filter((item) => visibleFor(item, adminRoleKey, isDataOwner) && (!item.feature || hasFeature(item.feature as never)));
          if (visibleItems.length === 0) return null;
          const groupBadge = visibleItems.reduce((sum, item) => sum + (item.badge ? badges[item.badge] ?? 0 : 0), 0);
          const groupLabel = section.label ? section.label.charAt(0) + section.label.slice(1).toLowerCase() : null;
          return (
            <div key={si}>
              {groupLabel && (collapsed ? (
                <div className="mx-2 mb-2 mt-3 h-px bg-rule" />
              ) : (
                <button onClick={() => toggleGroup(section.label!)} aria-expanded={isOpen} className="group flex h-8 w-full items-center gap-1.5 rounded-md px-2 pt-2 text-left">
                  <span className="text-xs2 font-semibold text-ink-faint transition-colors group-hover:text-ink-muted">{groupLabel}</span>
                  {!isOpen && groupBadge > 0 && <span className={badgeCls}>{groupBadge}</span>}
                  <ChevronDown className={clsx('ml-auto h-3.5 w-3.5 text-slate-300 transition-transform duration-200 group-hover:text-ink-faint', isOpen ? 'rotate-0' : '-rotate-90')} strokeWidth={2.5} aria-hidden />
                </button>
              ))}
              <div className={clsx('overflow-hidden transition-[max-height,opacity] duration-200 ease-out', collapsed || isOpen ? 'max-h-[40rem] opacity-100' : 'max-h-0 opacity-0')}>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
                  const badgeCount = item.badge ? badges[item.badge] : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={clsx(
                        'relative my-0.5 flex items-center rounded-menu transition-colors duration-150',
                        collapsed ? 'mx-auto h-10 w-10 justify-center' : 'h-10 gap-3 pl-3 pr-2',
                        isActive ? 'bg-primary-50 font-semibold text-primary-600' : 'text-ink-2 hover:bg-slate-100 hover:text-ink',
                      )}
                    >
                      {isActive && !collapsed && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-primary-500" />}
                      <Icon className={clsx('h-[18px] w-[18px] shrink-0', isActive ? 'text-primary-600' : 'text-ink-faint')} strokeWidth={isActive ? 2.3 : 2} aria-hidden />
                      {!collapsed && <span className="flex-1 truncate text-sm2">{item.label}</span>}
                      {badgeCount > 0 && (collapsed
                        ? <span className={clsx(badgeCls, 'absolute -right-1 -top-1 min-w-[16px] px-1 text-[10px] leading-[14px]')}>{badgeCount > 99 ? '99+' : badgeCount}</span>
                        : <span className={badgeCls}>{badgeCount}</span>)}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={clsx('border-t border-rule', collapsed ? 'flex flex-col items-center gap-1.5 px-0 py-3' : 'flex items-center gap-2.5 px-3.5 py-3')}>
        <div title={adminUser?.full_name ?? 'Quản trị viên'} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-500 text-2xs font-bold text-white" aria-hidden>{initials}</div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm2 font-semibold leading-tight text-ink">{adminUser?.full_name ?? 'Quản trị viên'}</p>
            <p className="truncate text-2xs text-ink-faint">{work?.me?.is_data_owner ? `Người đại diện phòng${work.me.department_name ? ` · ${work.me.department_name}` : ''}` : adminRoleKey ? roleLabel(adminRoleKey).label : 'Đang đăng nhập'}</p>
          </div>
        )}
        <button onClick={handleLogout} aria-label="Đăng xuất" title="Đăng xuất" className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-slate-100 hover:text-ink">
          <LogOut className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}
