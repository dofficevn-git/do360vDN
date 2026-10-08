import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { In } from 'typeorm';
import { AdminUser } from './admin-user.entity';
import { ALLOWED_ROLES, MAX_ADMIN_ACCOUNTS, getTier } from '../../common/features';
import { ALL_ADMIN_ROLES, WARD_ROLES } from '../../common/roles';

@Injectable()
export class AdminUsersService {
  constructor(@InjectRepository(AdminUser) private repo: Repository<AdminUser>) {}

  findAll(tenantId: string) {
    return this.repo.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' } });
  }

  private async assertSameTenant(tenantId: string, id: number) {
    const u = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!u) throw new NotFoundException('Không tìm thấy tài khoản trong đơn vị của bạn.');
    return u;
  }

  findOne(id: number) {
    return this.repo.findOne({ where: { id } });
  }

  /** Cán bộ xã đang hoạt động — chỉ trả trường tối thiểu cho picker phân công. */
  /** Danh sách người có thể nhận việc; tổ trưởng kèm tên tổ để form giao việc hiện "Tổ trưởng · Xóm Đu". */
  async findAssignable(opts: { tenantId: string; includeTdpHead?: boolean; department?: string }) {
    const roles = opts.includeTdpHead ? [...ALL_ADMIN_ROLES] : [...WARD_ROLES];
    const qb = this.repo
      .createQueryBuilder('u')
      .leftJoin('tdp', 't', 't.id = u.tdp_id')
      .select(['u.id AS id', 'u.full_name AS full_name', 'u.department AS department', 'u.role AS role', 'u.tdp_id AS tdp_id', 't.name AS tdp_name'])
      .where('u.is_active = true')
      .andWhere('u.tenant_id = :tenantId', { tenantId: opts.tenantId })
      .andWhere('u.role IN (:...roles)', { roles })
      .orderBy('u.full_name', 'ASC');
    if (opts.department) qb.andWhere('u.department = :department', { department: opts.department });
    return qb.getRawMany();
  }

  /** Kiểm tra giới hạn gói: role hợp lệ + số tài khoản tối đa (basic = 1). */
  async assertTierLimits(role?: string, { creating = false } = {}) {
    const tier = getTier();
    if (role && !ALLOWED_ROLES[tier].includes(role)) {
      throw new BadRequestException(
        `Vai trò "${role}" không thuộc gói triển khai hiện tại. Vai trò khả dụng: ${ALLOWED_ROLES[tier].join(', ')}.`,
      );
    }
    if (creating) {
      const activeCount = await this.repo.count({ where: { is_active: true } });
      if (activeCount >= MAX_ADMIN_ACCOUNTS[tier]) {
        throw new BadRequestException(
          'Gói tối thiểu chỉ hỗ trợ 1 tài khoản quản trị. Vui lòng nâng cấp gói để thêm cán bộ.',
        );
      }
    }
  }

  async create(data: Partial<AdminUser> & { password: string }) {
    await this.assertTierLimits(data.role, { creating: true });
    const { password, ...rest } = data;
    const password_hash = await bcrypt.hash(password, 10);
    return this.repo.save(this.repo.create({ ...rest, password_hash }));
  }

  async update(tenantId: string, id: number, data: Partial<AdminUser> & { password?: string }) {
    await this.assertSameTenant(tenantId, id);
    await this.assertTierLimits((data as any).role);
    // tenant_id và id không đổi được qua API
    const { password, tenant_id: _t, id: _i, ...rest } = data as any;
    const updateData: any = { ...rest };
    if (password) updateData.password_hash = await bcrypt.hash(password, 10);
    return this.repo.update(id, updateData);
  }

  async remove(tenantId: string, id: number) {
    await this.assertSameTenant(tenantId, id);
    return this.repo.delete(id);
  }
}
