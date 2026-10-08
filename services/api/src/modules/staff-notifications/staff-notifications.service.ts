import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffNotification } from './staff-notification.entity';

@Injectable()
export class StaffNotificationsService {
  constructor(
    @InjectRepository(StaffNotification)
    private repo: Repository<StaffNotification>,
  ) {}

  async create(data: {
    recipient_id: number;
    type: string;
    title: string;
    body: string;
    reference_type?: string;
    reference_id?: number;
  }): Promise<void> {
    await this.repo.save(this.repo.create(data));
  }

  async findForUser(userId: number, page = 1, limit = 15) {
    const [items, total] = await this.repo.findAndCount({
      where: { recipient_id: userId },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async countUnread(userId: number): Promise<number> {
    return this.repo.count({ where: { recipient_id: userId, is_read: false } });
  }

  async markRead(id: number, userId: number): Promise<void> {
    await this.repo.update({ id, recipient_id: userId }, { is_read: true });
  }

  async markAllRead(userId: number): Promise<void> {
    await this.repo.update({ recipient_id: userId, is_read: false }, { is_read: true });
  }
}