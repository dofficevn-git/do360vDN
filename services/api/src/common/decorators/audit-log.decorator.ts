import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'audit_log';

export interface AuditLogOptions {
  module: string;
  action: string;
  /**
   * Tên bảng để đọc bản ghi TRƯỚC khi handler chạy → ghi vào `old_value`.
   * Chỉ khai cho hành động sửa/xoá (cần `:id` trên route); bỏ trống với hành động tạo mới.
   */
  entity?: string;
}

export const AuditLog = (options: AuditLogOptions) => SetMetadata(AUDIT_LOG_KEY, options);
