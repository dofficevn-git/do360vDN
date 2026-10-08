import { ForbiddenException } from '@nestjs/common';

/**
 * Đa đơn vị: mọi bảng dữ liệu của DO360 có `tenant_id` = mã đơn vị hành chính cấp xã
 * (5 số, QĐ 19/2025/QĐ-TTg). Tài khoản thuộc đúng một đơn vị; mã lấy từ admin_users.tenant_id
 * (JwtStrategy đọc tươi từ CSDL), KHÔNG nhận từ client.
 */
export function tenantOf(req: { user?: { tenant_id?: string | null } }): string {
  const t = req?.user?.tenant_id;
  if (!t) throw new ForbiddenException('Tài khoản chưa được gán đơn vị (tenant).');
  return t;
}

export function defaultTenantId(): string {
  return (process.env.DEFAULT_TENANT_ID || '00000').trim();
}
