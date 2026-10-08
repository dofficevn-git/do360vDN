import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
/** 'overdue' KHÔNG lưu — suy ra từ due_at < now() khi status còn new/in_progress. */
export type TaskStatus = 'new' | 'in_progress' | 'done' | 'cancelled';

export const TASK_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
export const TASK_STATUSES: TaskStatus[] = ['new', 'in_progress', 'done', 'cancelled'];

/**
 * Giao việc nhanh — một dòng = một việc giao cho một cán bộ (cán bộ xã hoặc tổ trưởng TDP).
 * Tiến độ giữ đơn giản theo yêu cầu: trạng thái + ghi chú kết quả + 1 ảnh.
 */
@Entity('tasks')
@Index(['assignee_id', 'status'])
@Index(['assigner_id'])
@Index(['due_at'])
export class Task {
  @PrimaryGeneratedColumn()
  id: number;

  /** Đơn vị (mã ĐVHC) — việc chỉ hiện trong đơn vị của người giao/nhận */
  @Column({ length: 10, nullable: true })
  tenant_id: string | null;

  /** Mã hiển thị 'CV-xxxxxx' — theo mẫu mã phản ánh/lịch hẹn */
  @Column({ length: 20, unique: true })
  code: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** admin_users.id người giao */
  @Column()
  assigner_id: number;

  /** admin_users.id người nhận */
  @Column()
  assignee_id: number;

  @Column({ length: 10, default: 'normal' })
  priority: TaskPriority;

  @Column({ length: 20, default: 'new' })
  status: TaskStatus;

  @Column({ type: 'timestamptz', nullable: true })
  due_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'text', nullable: true })
  result_note: string | null;

  @Column({ nullable: true })
  result_image_url: string | null;

  /** Việc phát sinh từ đâu — 'feedback' | 'appointment' — để chi tiết có link ngược */
  @Column({ length: 20, nullable: true })
  source_type: string | null;

  @Column({ nullable: true })
  source_id: number | null;

  /** Object liên quan (dự án, hộ kinh doanh…) — Object 360 hiện việc của đối tượng */
  @Column({ type: 'uuid', nullable: true })
  object_uid: string | null;

  /** Mục tiêu đo được: chỉ tiêu + giá trị cần đạt (Report → Task → Event → Indicator) */
  @Column({ length: 80, nullable: true })
  target_indicator_id: string | null;

  @Column({ type: 'numeric', precision: 20, scale: 4, nullable: true })
  target_value: string | null;

  /** Lần gần nhất cron đã nhắc quá hạn cho việc này — chống gửi trùng trong 24h */
  @Column({ type: 'timestamptz', nullable: true })
  reminded_overdue_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
