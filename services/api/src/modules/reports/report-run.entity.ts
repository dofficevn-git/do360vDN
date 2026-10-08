import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * collecting  đang thu số — hệ thống nhắc slot còn thiếu
 * locked      Văn phòng đã chốt kỳ: bộ số đóng băng vào fact_snapshot
 * drafted     đã sinh bản nháp .docx
 * submitted   đã trình ký sang QLVB
 * signed      đã ký — bản chuẩn, không sửa
 * cancelled
 */
export type ReportRunStatus = 'collecting' | 'locked' | 'drafted' | 'submitted' | 'signed' | 'cancelled';

/** Một lần lập báo cáo của một đơn vị cho một kỳ. */
@Entity('report_run')
@Index('IDX_report_run_tenant_period', ['tenant_id', 'period'])
export class ReportRun {
  @PrimaryGeneratedColumn()
  run_id: number;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ type: 'int' })
  spec_id: number;

  @Column({ length: 12 })
  period: string;

  /** Ngày chốt chung của kỳ — mọi chỉ tiêu dùng mốc này, ngoại lệ phải ghi rõ */
  @Column({ type: 'date' })
  cutoff_date: string;

  @Column({ length: 20, default: 'collecting' })
  status: ReportRunStatus;

  /**
   * Bộ số đóng băng khi chốt kỳ: { indicator_id: { fact_id, value, as_of_date, breakdown… } }.
   * Bản nháp và bản ký chỉ đọc từ đây — tái lập được đúng báo cáo khi bị hỏi lại.
   */
  @Column({ type: 'jsonb', nullable: true })
  fact_snapshot: Record<string, unknown> | null;

  /** Kết quả Quality Gate lúc chốt: danh sách cảnh báo/lỗi theo slot */
  @Column({ type: 'jsonb', nullable: true })
  gate_report: Record<string, unknown> | null;

  /** Khoá object bản nháp .docx trên MinIO */
  @Column({ nullable: true })
  output_file: string | null;

  /** Id văn bản trên QLVB khi đã trình ký (adapter trả về) */
  @Column({ length: 120, nullable: true })
  qlvb_doc_id: string | null;

  /** Sau khi ký trên QLVB */
  @Column({ nullable: true })
  signed_number: string | null;

  @Column({ type: 'date', nullable: true })
  signed_date: string | null;

  @Column({ nullable: true })
  signed_file: string | null;

  /** Bản Word Văn phòng biên tập tải lên để đối chiếu với snapshot */
  @Column({ nullable: true })
  edited_file: string | null;

  /** Kết quả đối chiếu bản biên tập: { checked_at, missing[], unknown[], ok } */
  @Column({ type: 'jsonb', nullable: true })
  edited_check: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @Column({ type: 'int', nullable: true })
  locked_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
