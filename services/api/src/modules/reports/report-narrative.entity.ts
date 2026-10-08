import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Lời dẫn (narrative, next_tasks) của một kỳ báo cáo — bước 1: khuôn câu + lời kỳ trước + đoạn bộ phận gửi, Văn phòng biên tập.
 * CHỈ THÊM phiên bản; bản `accepted` mới nhất được dùng khi sinh báo cáo; khi trình ký thì đóng băng vào fact_snapshot.narratives.
 * Mỗi bản lưu kèm kết quả hậu kiểm (số lạ, tên kỳ lệch) để truy vết LLM/người sửa gì.
 */
@Entity('report_narrative')
@Index('IDX_report_narrative_run_slot', ['run_id', 'slot_code', 'version'])
export class ReportNarrative {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  run_id: number;

  @Column({ length: 120 })
  slot_code: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'text' })
  text: string;

  /** template | prev_period | dept | edited | llm */
  @Column({ length: 20, default: 'edited' })
  source: string;

  /** draft | accepted */
  @Column({ length: 12, default: 'draft' })
  status: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  postcheck: Record<string, unknown>;

  @Column({ type: 'int', nullable: true })
  author_id: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
