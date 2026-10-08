'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { apiGet } from '@/lib/api';
import { AlertCircle, AlertTriangle } from 'lucide-react';

type HealthIssue = { type: string; message: string; severity: 'warning' | 'error' };

function SystemHealthBanner() {
  const { data } = useQuery<{ ok: boolean; issues: HealthIssue[] }>({
    queryKey: ['system-health'],
    queryFn: () => apiGet('/admin/system-health'),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  if (!data || data.ok || data.issues.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {data.issues.map((issue, i) => (
        <div
          key={i}
          role="alert" className={`flex items-center gap-2 px-4 py-2 text-xs2 font-medium ${
            issue.severity === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-amber-500 text-white'
          }`}
        >
          {issue.severity === 'error'
            ? <AlertCircle className="h-4 w-4 shrink-0" />
            : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token = Cookies.get('access_token');
    if (!token) router.push('/login');
  }, [router]);

  // Một mặt phẳng: sidebar và nội dung cùng nền, ngăn nhau bằng một đường kẻ —
  // không sheet nổi, không bo góc, không bóng (docs/NHAN-DIEN-XA-THANH-CONG.md).
  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
        <SystemHealthBanner />
        <Header />
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-7 md:py-6">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
