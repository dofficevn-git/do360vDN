'use client';

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useFeatures, type FeatureKey } from '@/lib/features';

/**
 * Bọc trang thuộc gói cao hơn: gói hiện tại không có tính năng → hiện thông điệp
 * nâng cấp thay vì nội dung trang (API cũng đã chặn 403 — đây chỉ là lớp UI).
 */
export function FeatureGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { has } = useFeatures();
  if (!has(feature)) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="max-w-md rounded-lg border border-dashed border-slate-200 px-8 py-10 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400">
            <Lock className="h-5 w-5" strokeWidth={2} />
          </div>
          <p className="text-sm font-semibold text-slate-700">Tính năng thuộc gói cao hơn</p>
          <p className="mt-1 text-sm2 leading-relaxed text-slate-500">
            Gói triển khai hiện tại chưa bao gồm phân hệ này. Liên hệ đơn vị triển khai để
            nâng cấp gói — dữ liệu và hệ thống giữ nguyên, chỉ mở thêm tính năng.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
