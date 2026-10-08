'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { ScrollText, ChevronDown, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/admin-ui';
import { FeatureGate } from '@/components/ui/feature-gate';

type AuditLog = {
  id: number;
  admin_user_id: number;
  module: string;
  action: string;
  target_id: string;
  old_value: any;
  new_value: any;
  ip_address: string;
  created_at: string;
};

/** old_value/new_value lưu dạng chuỗi JSON — in ra cho dễ đọc, hỏng thì trả nguyên văn. */
function formatValue(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(String(value)), null, 2);
  } catch {
    return String(value);
  }
}

function AuditLogsPageInner() {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs'],
    queryFn: () => apiGet('/admin/audit-logs'),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nhật ký hệ thống"
        description="Lịch sử thao tác của cán bộ trên hệ thống quản trị."
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-ink-faint">Đang tải nhật ký...</p>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center text-ink-faint">
            <ScrollText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm">Chưa có nhật ký hoạt động nào.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs2 font-semibold text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Thời gian</th>
                  <th className="px-3 py-2 text-left font-semibold">Admin ID</th>
                  <th className="px-3 py-2 text-left font-semibold">Module</th>
                  <th className="px-3 py-2 text-left font-semibold">Hành động</th>
                  <th className="px-3 py-2 text-left font-semibold">Đối tượng</th>
                  <th className="px-3 py-2 text-left font-semibold">IP</th>
                  <th className="px-3 py-2 text-left font-semibold">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {logs.map((log) => {
                  const oldText = formatValue(log.old_value);
                  const newText = formatValue(log.new_value);
                  const hasDetail = Boolean(oldText || newText);
                  const isOpen = expandedId === log.id;

                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap text-ink-3">
                          {new Date(log.created_at).toLocaleString('vi-VN')}
                        </td>
                        <td className="px-3 py-2 font-medium text-ink">
                          User #{log.admin_user_id}
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                            {log.module}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 bg-slate-100 text-ink-2 rounded text-xs font-medium">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-muted italic">
                          {log.target_id || 'N/A'}
                        </td>
                        <td className="px-3 py-2 text-ink-faint text-xs">
                          {log.ip_address}
                        </td>
                        <td className="px-3 py-2">
                          {hasDetail ? (
                            <button
                              type="button"
                              onClick={() => setExpandedId(isOpen ? null : log.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                              {isOpen ? 'Thu gọn' : 'Xem'}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={7} className="px-3 py-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="mb-1 text-2xs font-bold uppercase tracking-wide text-ink-muted">
                                  Giá trị cũ
                                </p>
                                <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs text-ink-2">
                                  {oldText ?? 'Không có (bản ghi mới tạo).'}
                                </pre>
                              </div>
                              <div>
                                <p className="mb-1 text-2xs font-bold uppercase tracking-wide text-ink-muted">
                                  Giá trị gửi lên
                                </p>
                                <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs text-ink-2">
                                  {newText ?? 'Không có.'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


export default function AuditLogsPage() {
  return (
    <FeatureGate feature="audit-log">
      <AuditLogsPageInner />
    </FeatureGate>
  );
}
