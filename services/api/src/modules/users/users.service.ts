import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

export interface UpdateMyProfileDto {
  name?: string;
  phone?: string;
  address?: string;
  tdp_id?: number | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getById(id: number) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return this.toPublic(user);
  }

  async updateMine(id: number, dto: UpdateMyProfileDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    if (dto.name !== undefined) user.name = dto.name.trim() || user.name;
    if (dto.phone !== undefined) user.phone = dto.phone.trim() || null;
    if (dto.address !== undefined) user.address = dto.address.trim() || null;
    if (dto.tdp_id !== undefined) user.tdp_id = dto.tdp_id ?? null;

    await this.userRepo.save(user);
    return this.toPublic(user);
  }

  private toPublic(u: User) {
    return {
      id: u.id,
      zalo_user_id: u.zalo_user_id,
      name: u.name,
      avatar: u.avatar,
      phone: u.phone,
      address: u.address,
      tdp_id: u.tdp_id ?? null,
      is_follower: !!u.zalo_follower_id,
      created_at: u.created_at,
    };
  }
}
