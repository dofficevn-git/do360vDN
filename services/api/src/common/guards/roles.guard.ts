import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { WARD_ROLES } from '../roles';

/**
 * Guard phân quyền theo role, đặt SAU AdminGuard trong cùng @UseGuards
 * (guard chạy theo thứ tự khai báo → req.user đã có khi tới đây).
 *
 * DEFAULT-DENY tổ trưởng: endpoint KHÔNG khai báo @Roles thì mặc định yêu cầu
 * role thuộc WARD_ROLES — quên annotate một controller mới thì tdp_head vẫn bị chặn,
 * cán bộ xã vẫn dùng bình thường.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<readonly string[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? WARD_ROLES;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException('Tài khoản của bạn không có quyền thực hiện thao tác này.');
    }
    return true;
  }
}
