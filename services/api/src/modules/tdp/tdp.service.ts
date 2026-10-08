import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tdp } from './tdp.entity';
import { User } from '../users/user.entity';

@Injectable()
export class TdpService {
  constructor(
    @InjectRepository(Tdp) private repo: Repository<Tdp>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /** Thông tin tổ của tổ trưởng đang đăng nhập + sĩ số cư dân đã đăng ký app. */
  async getMyTdp(tdpId: number | null) {
    if (!tdpId) throw new ForbiddenException('Tài khoản chưa được gán Tổ dân phố.');
    const tdp = await this.repo.findOne({ where: { id: tdpId } });
    if (!tdp) throw new ForbiddenException('Tổ dân phố không tồn tại.');
    const resident_count = await this.userRepo.count({ where: { tdp_id: tdpId } });
    return { ...tdp, resident_count };
  }

  /** Danh sách cư dân đã đăng ký Mini App thuộc tổ. */
  async getResidents(tdpId: number | null) {
    if (!tdpId) throw new ForbiddenException('Tài khoản chưa được gán Tổ dân phố.');
    const rows = await this.userRepo.find({
      where: { tdp_id: tdpId },
      order: { created_at: 'DESC' },
    });
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      phone: u.phone,
      address: u.address,
      created_at: u.created_at,
    }));
  }

  /** Public: danh sách TDP đang hoạt động (cho cư dân chọn ở Mini App) */
  listActive() {
    return this.repo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  findAll() {
    return this.repo.find({ order: { sort_order: 'ASC', name: 'ASC' } });
  }

  findOne(id: number) {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<Tdp>) {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Tdp>) {
    await this.repo.update(id, data);
    return this.repo.findOne({ where: { id } });
  }

  remove(id: number) {
    return this.repo.delete(id);
  }
}
