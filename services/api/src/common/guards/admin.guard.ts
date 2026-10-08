import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard cho MỌI endpoint /admin/*: yêu cầu JWT hợp lệ VÀ token phải là type 'admin'.
 * Ngăn token cư dân (type 'user' — silent login Mini App) gọi endpoint quản trị.
 * Token admin gồm cả cán bộ xã lẫn tổ trưởng TDP (đều là admin_users).
 */
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    const req = context.switchToHttp().getRequest();
    if (req.user?.type !== 'admin') {
      throw new ForbiddenException('Yêu cầu quyền quản trị.');
    }
    return true;
  }
}
