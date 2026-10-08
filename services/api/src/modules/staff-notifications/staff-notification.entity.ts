import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('staff_notifications')
export class StaffNotification {
  @PrimaryGeneratedColumn() id: number;

  @Column()
  recipient_id: number; // admin_users.id

  @Column()
  type: string; // 'feedback_assigned'

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ nullable: true })
  reference_type: string; // 'feedback'

  @Column({ nullable: true })
  reference_id: number; // feedback.id

  @Column({ default: false })
  is_read: boolean;

  @CreateDateColumn()
  created_at: Date;
}