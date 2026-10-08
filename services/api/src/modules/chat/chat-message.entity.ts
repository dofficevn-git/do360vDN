import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Nhật ký tin qua kênh chat (hai chiều) — để truy vết "đã nhắc ai, lúc nào, kết quả" và để kiểm thử khi chưa nối OA/Tammi.
 * Không lưu nội dung file (file vào Bronze).
 */
@Entity('chat_message')
@Index('IDX_chat_tenant_created', ['tenant_id', 'created_at'])
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  /** out = hệ thống gửi; in = cán bộ gửi */
  @Column({ length: 5 })
  direction: 'out' | 'in';

  /** card | text | file | action */
  @Column({ length: 10 })
  kind: string;

  /** zalo | tammi | sim */
  @Column({ length: 10 })
  channel: string;

  @Column({ type: 'int', nullable: true })
  admin_id: number | null;

  @Column({ length: 80, nullable: true })
  channel_user_id: string | null;

  @Column({ nullable: true })
  title: string | null;

  /** Thẻ/tin đã gửi hoặc sự kiện nhận được (không chứa nội dung file) */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  body: Record<string, unknown>;

  /** out: sent | failed | skipped · in: handled | ignored | error */
  @Column({ length: 10 })
  status: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** fact | source_file | report_run … */
  @Column({ length: 20, nullable: true })
  reference_type: string | null;

  @Column({ length: 40, nullable: true })
  reference_id: string | null;

  /** Kết quả cổng an toàn: { allowed, reasons[], truncated, original_title } */
  @Column({ type: 'jsonb', nullable: true })
  gateway: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
