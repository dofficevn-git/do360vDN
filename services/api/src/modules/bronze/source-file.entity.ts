import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Bronze — file gốc cán bộ nộp, lưu nguyên trạng trên MinIO kèm ngữ cảnh (ai gửi, bộ phận, kỳ).
 * Băm nội dung (sha256) để chặn nộp trùng trong cùng một đơn vị.
 */
@Entity('source_file')
@Index('UQ_source_file_tenant_hash', ['tenant_id', 'sha256'], { unique: true })
@Index('IDX_source_file_tenant_period', ['tenant_id', 'period'])
export class SourceFile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ length: 64 })
  sha256: string;

  /** Khoá object trên MinIO: {tenant}/{yyyy}/{mm}/{sha256}{ext} */
  @Column()
  object_key: string;

  @Column()
  original_name: string;

  @Column({ length: 120, nullable: true })
  mime: string | null;

  @Column({ type: 'int' })
  size: number;

  /** xlsx | docx | pdf_text | pdf_scan | image | other — do services/reader nhận diện */
  @Column({ length: 20, nullable: true })
  file_kind: string | null;

  /** Loại tài liệu khớp bộ luật (extract_rule.source_type); null = chưa nhận ra */
  @Column({ length: 80, nullable: true })
  source_type: string | null;

  @Column({ length: 50, nullable: true })
  department: string | null;

  @Column({ length: 12, nullable: true })
  period: string | null;

  /** Ngày chốt số liệu của file (bộ phận khai khi nộp); số bóc từ file lấy ngày này. Null = ngày nộp. */
  @Column({ type: 'date', nullable: true })
  as_of_date: string | null;

  @Column({ type: 'int', nullable: true })
  uploaded_by: number | null;

  /** web | zalo | tammi */
  @Column({ length: 20, default: 'web' })
  channel: string;

  /** received | parsed | extracted | no_rule | failed */
  @Column({ length: 20, default: 'received' })
  status: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Cảnh báo dữ liệu cá nhân (CCCD/SĐT/email) do reader phát hiện — kho chỉ lưu số tổng hợp */
  @Column({ type: 'text', nullable: true })
  pii_warning: string | null;

  /** Số bản ghi extracted sinh ra từ file */
  @Column({ type: 'int', default: 0 })
  extracted_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
