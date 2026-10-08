import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type NotificationType =
  | 'feedback_update'
  | 'appointment_confirmed'
  | 'appointment_cancelled'
  | 'appointment_reminder'
  | 'survey_broadcast'
  | 'announcement'
  | 'task_assigned'
  | 'task_overdue'
  | 'manual';

export type NotificationStatus = 'sent' | 'failed' | 'skipped';

@Entity('notification_logs')
export class NotificationLog {
  @PrimaryGeneratedColumn() id: number;

  @Column()
  type: NotificationType;

  @Column({ nullable: true })
  recipient_zalo_id: string;

  @Column({ nullable: true })
  recipient_name: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: 'sent' })
  status: NotificationStatus;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @CreateDateColumn()
  created_at: Date;
}
