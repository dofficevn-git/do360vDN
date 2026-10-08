import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Như JwtAuthGuard nhưng KHÔNG chặn request thiếu/sai token —
 * req.user = null trong trường hợp đó. Dùng cho endpoint public
 * cần biết "ai đang gửi" khi có đăng nhập (vd: gán feedbacks.user_id).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    return user || null;
  }
}
