import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationLog, NotificationType, NotificationStatus } from './notification-log.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationLog)
    private repo: Repository<NotificationLog>,
  ) {}

  async log(data: {
    type: NotificationType;
    recipient_zalo_id?: string;
    recipient_name?: string;
    content: string;
    status: NotificationStatus;
    error_message?: string;
  }): Promise<void> {
    await this.repo.save(this.repo.create(data));
  }

  async findAll(page = 1, limit = 20, type?: string) {
    const qb = this.repo.createQueryBuilder('n').orderBy('n.created_at', 'DESC');

    if (type) qb.where('n.type = :type', { type });

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
