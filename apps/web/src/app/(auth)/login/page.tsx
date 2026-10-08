'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Cookies from 'js-cookie';
import dynamic from 'next/dynamic';
import { Database, FileCheck2, Lock, ShieldCheck } from 'lucide-react';
import { Callout } from '@/components/ui/admin-ui';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { homeForRole } from '@/lib/work';
import { adminRole } from '@/lib/status-maps';

const QrLoginPanel = dynamic(() => import('./QrLoginPanel'), { ssr: false });

const ERROR_KEY = 'login_error';
const ZALO_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ZALO_LOGIN === 'true';

type Tab = 'email' | 'zalo';

/** Bốn nguyên tắc của hệ thống — nội dung thật của sản phẩm, đặt ở panel trái thay cho hình trang trí. */
const PRINCIPLES = [
  { icon: Database, title: 'Mọi con số có nguồn', text: 'Số bóc từ file xuất, PDF hay ảnh đều ghi rõ file, ô hoặc trang và ngày chốt.' },
  { icon: FileCheck2, title: 'Qua kiểm tra mới vào báo cáo', text: 'Sáu nhóm kiểm tra chất lượng; số sai bị cách ly, Data Owner duyệt rồi Văn phòng mới chốt kỳ.' },
  { icon: Lock, title: 'Không ghi đè, chỉ thêm', text: 'Sửa số là thêm phiên bản mới; bộ số đã chốt đóng băng để tái lập đúng báo cáo khi bị hỏi lại.' },
  { icon: ShieldCheck, title: 'Chạy trong nước', text: 'Không gọi dịch vụ AI nước ngoài; mô hình ngôn ngữ chỉ viết lời dẫn, không bao giờ sinh số.' },
];

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { data: demo } = useQuery<{ enabled: boolean; unit?: string | null; password?: string | null; accounts: { email: string; full_name: string; title: string | null; role: string; department: string | null; home: string }[] }>({ queryKey: ['demo-accounts'], queryFn: () => apiGet('/public/demo/accounts'), staleTime: 10 * 60_000, retry: 0 });

  useEffect(() => {
    const saved = sessionStorage.getItem(ERROR_KEY);
    if (saved) { setError(saved); sessionStorage.removeItem(ERROR_KEY); }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); sessionStorage.removeItem(ERROR_KEY);
    try {
      const { data } = await api.post('/admin/auth/login', { email, password });
      Cookies.set('access_token', data.access_token, { expires: 7 });
      Cookies.set('admin_user', JSON.stringify(data.user), { expires: 7 });
      let home = homeForRole(data.user?.role);
      try { const w = await apiGet('/admin/me/work'); if (w?.me?.home) home = w.me.home; } catch { /* dùng mặc định theo vai */ }
      router.push(home);
    } catch (err: any) {
      const msg = err?.response?.status === 401 ? 'Email hoặc mật khẩu không đúng.' : err?.response?.data?.message ?? 'Không đăng nhập được. Thử lại sau ít phút.';
      setError(msg); sessionStorage.setItem(ERROR_KEY, msg);
    } finally { setLoading(false); }
  }

  const inputCls = 'h-11 w-full rounded-lg border border-rule-strong bg-white px-3.5 text-base2 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-500/25';

  return (
    <div className="grid min-h-screen overflow-y-auto bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      {/* Panel trái: tên sản phẩm + 4 nguyên tắc */}
      <section className="period-band hidden flex-col justify-between rounded-none px-10 py-10 lg:flex xl:px-16">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-logo bg-white/15 text-sm font-extrabold tracking-[0.3px] text-white ring-1 ring-white/25" aria-hidden>DO</div>
          <div>
            <p className="text-base2 font-bold leading-tight">DO360 cấp xã</p>
            <p className="text-xs2 text-white/70">Nền tảng tổng hợp số liệu và sinh báo cáo</p>
          </div>
        </div>
        <div className="my-10 max-w-xl">
          <h1 className="text-[34px] font-bold leading-[1.15] tracking-[-0.4px]">Báo cáo của xã là một góc nhìn trên kho số liệu, không phải văn bản viết tay.</h1>
          <p className="mt-4 text-base2 leading-relaxed text-white/80">Bộ phận nộp file hoặc gửi qua chat, hệ thống bóc số và đặt cạnh nguồn, Văn phòng xác nhận, chốt kỳ và sinh bản nháp đúng thể thức.</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {PRINCIPLES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-card bg-white/[0.07] p-4 ring-1 ring-white/10">
                <Icon className="h-5 w-5 text-[#FFD66B]" aria-hidden />
                <p className="mt-2 text-sm2 font-semibold">{title}</p>
                <p className="mt-1 text-xs2 leading-relaxed text-white/75">{text}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs2 text-white/55">UBND cấp xã · Kế hoạch 12 tuần từ 05/10/2026</p>
      </section>

      {/* Panel phải: đăng nhập */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-logo bg-primary-500 text-sm font-extrabold text-white" aria-hidden>DO</div>
            <div><p className="text-base2 font-bold leading-tight text-ink">DO360 cấp xã</p><p className="text-xs2 text-ink-faint">Tổng hợp số liệu và sinh báo cáo</p></div>
          </div>
          <h2 className="text-[24px] font-bold tracking-[-0.2px] text-ink">Đăng nhập</h2>
          <p className="mt-1 text-sm2 text-ink-muted">Dùng tài khoản công vụ do Văn phòng cấp.</p>

          {ZALO_LOGIN_ENABLED && (
            <div role="tablist" className="mt-6 flex border-b border-rule">
              {(['email', 'zalo'] as Tab[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px h-10 flex-1 border-b-2 text-sm2 font-semibold transition-colors ${tab === t ? 'border-primary-500 text-primary-600' : 'border-transparent text-ink-muted hover:text-ink'}`}>
                  {t === 'email' ? 'Email' : 'Zalo QR'}
                </button>
              ))}
            </div>
          )}

          {tab === 'email' && (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              {error && <Callout tone="danger">{error}</Callout>}
              <div>
                <label htmlFor="login-email" className="mb-1.5 block text-sm2 font-semibold text-ink-2">Email công vụ</label>
                <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="ten@xa.gov.vn" required autoComplete="email" autoFocus />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm2 font-semibold text-ink-2">Mật khẩu</label>
                <input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" required autoComplete="current-password" />
              </div>
              <button type="submit" disabled={loading} className="h-11 w-full rounded-lg bg-primary-500 text-base2 font-semibold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60">
                {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </button>
              <p className="text-xs2 text-ink-faint">Quên mật khẩu: liên hệ Văn phòng HĐND và UBND để cấp lại.</p>
            </form>
          )}

          {demo?.enabled && demo.accounts.length > 0 && (
            <section className="mt-8 rounded-card border border-rule bg-white" aria-label="Tài khoản demo">
              <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
                <p className="text-sm2 font-semibold text-ink">Tài khoản demo{demo.unit ? ` · ${demo.unit}` : ''}</p>
                {demo.password && <p className="text-xs2 text-ink-muted">Mật khẩu chung: <code className="kpi-num rounded bg-slate-100 px-1.5 py-px text-ink">{demo.password}</code></p>}
              </div>
              <ul className="max-h-72 divide-y divide-rule overflow-y-auto">
                {demo.accounts.map((a) => (
                  <li key={a.email}>
                    <button type="button" onClick={() => { setTab('email'); setEmail(a.email); if (demo.password) setPassword(demo.password); setError(''); }} className="row-hover flex w-full items-center justify-between gap-3 px-4 py-2 text-left">
                      <span className="min-w-0"><span className="block truncate text-sm2 font-medium text-ink">{a.full_name}</span><span className="block truncate text-xs2 text-ink-muted">{a.title ?? adminRole(a.role).label}</span></span>
                      <span className="shrink-0 text-xs2 text-primary-600">Chọn</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-4 py-2 text-2xs text-ink-faint">Bấm một người để điền sẵn rồi Đăng nhập. Mỗi vai mở một trang chủ khác nhau.</p>
            </section>
          )}

          {tab === 'zalo' && ZALO_LOGIN_ENABLED && <div className="mt-6"><QrLoginPanel /></div>}
        </div>
      </section>
    </div>
  );
}
