// Nguồn duy nhất cho điều hướng + tiêu đề trang (Sidebar & Header cùng đọc). Cấu trúc theo Blueprint V0.5 mục 60:
// Tổng quan · Điều hành · các lĩnh vực · Báo cáo · Dữ liệu (Data Map, Object Directory, Data Health, Danh mục chỉ tiêu) · Quản trị.
// Mục có `roles` chỉ hiện với vai đó; `dataOwner: true` chỉ hiện khi tài khoản là người đại diện phòng (GET /admin/me/work).
import {
  LayoutDashboard, FileUp, Table2, FileCheck2, ListChecks, Building2, ScrollText, UserCog, BarChart3, Users, MessageSquareShare, ClipboardList, CheckSquare, PenLine, BookOpen, Target, ListTodo,
  Map as MapIcon, Boxes, HeartPulse, Search, Landmark, Coins, Leaf, Stethoscope, Cpu, ShieldCheck, Briefcase, Building, type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  role?: string;
  roles?: string[];
  dataOwner?: boolean;
  feature?: string;
};

export type NavSection = { label: string | null; items: NavItem[] };

const MANAGERS = ['super_admin', 'commune_admin'];
const WARD = ['super_admin', 'commune_admin', 'department_staff', 'leader'];
const READERS = [...WARD, 'council'];

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard, roles: MANAGERS },
      { href: '/my', label: 'Việc của tôi', icon: ClipboardList, roles: ['department_staff'] },
      { href: '/approve', label: 'Duyệt số của phòng', icon: CheckSquare, roles: ['department_staff'], dataOwner: true },
      { href: '/sign', label: 'Bàn ký', icon: PenLine, roles: ['leader'] },
      { href: '/read', label: 'Đọc báo cáo', icon: BookOpen, roles: ['council'] },
      { href: '/leadership', label: 'Bảng điều hành', icon: BarChart3, roles: READERS },
    ],
  },
  {
    label: 'ĐIỀU HÀNH',
    items: [
      { href: '/tasks', label: 'Nhiệm vụ', icon: ListTodo, roles: WARD },
      { href: '/integrations', label: 'Văn bản · QLVB', icon: MessageSquareShare, roles: [...MANAGERS, 'leader'] },
      { href: '/objects?type=du_an', label: 'Dự án, công trình 360', icon: Building, roles: READERS },
    ],
  },
  {
    label: 'LĨNH VỰC',
    items: [
      { href: '/domain/chi_dao', label: 'Chỉ đạo – Điều hành', icon: Landmark, roles: READERS },
      { href: '/domain/kinh_te', label: 'Kinh tế', icon: Briefcase, roles: READERS },
      { href: '/domain/quy_hoach_dau_tu', label: 'Quy hoạch – Đầu tư – XD', icon: Building, roles: READERS },
      { href: '/domain/tai_nguyen_mt', label: 'Tài nguyên – Môi trường', icon: Leaf, roles: READERS },
      { href: '/domain/tai_chinh', label: 'Tài chính – Ngân sách', icon: Coins, roles: READERS },
      { href: '/domain/van_hoa_xa_hoi', label: 'Văn hoá – Xã hội', icon: Stethoscope, roles: READERS },
      { href: '/domain/khcn_cds', label: 'KHCN – Chuyển đổi số', icon: Cpu, roles: READERS },
      { href: '/domain/noi_vu_cchc', label: 'Nội vụ – CCHC', icon: Users, roles: READERS },
      { href: '/domain/qpan_noi_chinh', label: 'QPAN – Nội chính', icon: ShieldCheck, roles: READERS },
    ],
  },
  {
    label: 'BÁO CÁO',
    items: [
      { href: '/report-runs', label: 'Kỳ báo cáo', icon: FileCheck2, roles: READERS },
      { href: '/files', label: 'Nộp file', icon: FileUp, roles: WARD },
      { href: '/facts', label: 'Số liệu kỳ', icon: Table2, badge: 'facts_pending', roles: WARD },
      { href: '/plans', label: 'Kế hoạch năm', icon: Target, roles: READERS },
      { href: '/kpi', label: 'KPI cán bộ', icon: Users, roles: [...MANAGERS, 'leader'] },
    ],
  },
  {
    label: 'DỮ LIỆU',
    items: [
      { href: '/data-map', label: 'Bản đồ dữ liệu', icon: MapIcon, roles: READERS },
      { href: '/objects', label: 'Danh bạ đối tượng', icon: Boxes, roles: READERS },
      { href: '/data-health', label: 'Sức khoẻ dữ liệu', icon: HeartPulse, roles: READERS },
      { href: '/catalog', label: 'Danh mục chỉ tiêu', icon: ListChecks, roles: READERS },
      { href: '/search', label: 'Tìm kiếm', icon: Search, roles: READERS },
    ],
  },
  {
    label: 'QUẢN TRỊ',
    items: [
      { href: '/accounts', label: 'Người dùng, phân quyền', icon: UserCog, roles: MANAGERS },
      { href: '/channels', label: 'Zalo, kênh tương tác', icon: MessageSquareShare, roles: MANAGERS },
      { href: '/departments', label: 'Phòng, bộ phận', icon: Building2, roles: MANAGERS },
      { href: '/audit-logs', label: 'Nhật ký', icon: ScrollText, roles: MANAGERS },
    ],
  },
];

const DETAIL_TITLES: { pattern: RegExp; title: string }[] = [
  { pattern: /^\/report-runs\/[^/]+\/read$/, title: 'Đọc báo cáo' },
  { pattern: /^\/report-runs\/.+/, title: 'Chi tiết kỳ báo cáo' },
  { pattern: /^\/accounts\/invitations$/, title: 'Lời mời tài khoản' },
  { pattern: /^\/objects\/[0-9a-f-]{36}$/, title: 'Đối tượng 360' },
  { pattern: /^\/domain\/.+/, title: 'Lĩnh vực' },
];

export function getPageTitle(pathname: string): string {
  for (const d of DETAIL_TITLES) if (d.pattern.test(pathname)) return d.title;
  let best: { href: string; label: string } | null = null;
  for (const section of NAV_SECTIONS) for (const item of section.items) {
    const base = item.href.split('?')[0];
    if (pathname === base || pathname.startsWith(base + '/')) if (!best || base.length > best.href.length) best = { href: base, label: item.label };
  }
  return best?.label ?? 'DO360';
}

export function getPageGroup(pathname: string): string {
  for (const section of NAV_SECTIONS) for (const item of section.items) {
    const base = item.href.split('?')[0];
    if (pathname === base || pathname.startsWith(base + '/')) return section.label ?? 'Tổng quan';
  }
  return 'DO360';
}

/** Mục nào hiện với vai này (và có phải Data Owner không). */
export function visibleFor(item: NavItem, role: string | null, isDataOwner: boolean): boolean {
  if (item.role && item.role !== role) return false;
  if (item.roles && (!role || !item.roles.includes(role))) return false;
  if (item.dataOwner && !isDataOwner) return false;
  return true;
}
