import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Khai báo role được phép gọi endpoint. Dùng cùng RolesGuard, đặt SAU AdminGuard:
 *   @UseGuards(AdminGuard, RolesGuard)
 *   @Roles(...WARD_ROLES)
 * Không khai báo @Roles → RolesGuard mặc định yêu cầu WARD_ROLES (chặn tdp_head).
 */
export const Roles = (...roles: readonly string[]) => SetMetadata(ROLES_KEY, roles);
