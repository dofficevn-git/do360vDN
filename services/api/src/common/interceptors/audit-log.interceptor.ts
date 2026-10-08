import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { AUDIT_LOG_KEY, AuditLogOptions } from '../decorators/audit-log.decorator';
import { redactSensitive } from '../mask';

/** Chỉ cho phép tên bảng dạng snake_case — chặn SQL injection từ tham số decorator. */
const SAFE_TABLE = /^[a-z_][a-z0-9_]*$/;

/** Bảng có khoá chính không tên `id` (report_run.run_id) — để interceptor đọc old_value đúng cột. */
const PK_BY_ENTITY: Record<string, string> = { report_run: 'run_id' };

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private auditLogsService: AuditLogsService,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const options = this.reflector.getAllAndOverride<AuditLogOptions>(AUDIT_LOG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const { user, body, ip } = request;

    // Đọc bản ghi cũ TRƯỚC khi handler sửa/xoá, nếu decorator có khai `entity`
    return from(this.loadOldValue(options, request.params?.id)).pipe(
      switchMap((oldValue) =>
        next.handle().pipe(
          tap((responseData) => {
            // Chỉ log khi request thành công (không ném lỗi)
            this.auditLogsService.log({
              admin_user_id: user?.id,
              tenant_id: user?.tenant_id ?? null,
              module: options.module,
              action: options.action,
              target_id: responseData?.id || request.params?.id,
              old_value: oldValue,
              new_value: JSON.stringify(redactSensitive(body)),
              ip_address: ip,
            }).catch(err => console.error('Audit log error:', err));
          }),
        ),
      ),
    );
  }

  /**
   * Lấy bản ghi hiện tại theo id. Lỗi truy vấn không được làm hỏng request —
   * mất một dòng old_value chấp nhận được, chặn thao tác của cán bộ thì không.
   */
  private async loadOldValue(
    options: AuditLogOptions,
    id?: string | number,
  ): Promise<string | undefined> {
    if (!options.entity || id === undefined || id === null || id === '') return undefined;
    if (!SAFE_TABLE.test(options.entity)) {
      console.error(`Audit log: tên bảng không hợp lệ "${options.entity}"`);
      return undefined;
    }
    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM "${options.entity}" WHERE "${PK_BY_ENTITY[options.entity] ?? 'id'}" = $1 LIMIT 1`,
        [id],
      );
      if (!rows?.length) return undefined;
      return JSON.stringify(redactSensitive(rows[0]));
    } catch (err) {
      console.error('Audit log (old_value) error:', err);
      return undefined;
    }
  }
}
