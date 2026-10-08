import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Bản sao sổ văn bản (đi/đến) của đơn vị lấy từ QLVB qua adapter, cộng với văn bản DO360 trình ký.
 * Là nguồn để ghi event_log (DOC) và giao việc xử lý; không sửa tay. source = lgsp | sim | do360.
 */
@Entity('qlvb_document')
@Index('UQ_qlvb_doc_external', ['tenant_id', 'source', 'direction', 'external_id'], { unique: true, where: '"external_id" IS NOT NULL' })
@Index('IDX_qlvb_doc_tenant_ngay', ['tenant_id', 'ngay'])
export class QlvbDocument {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  /** den | di */
  @Column({ length: 3 })
  direction: 'den' | 'di';

  /** Id trên QLVB (hoặc id giả lập) */
  @Column({ length: 120, nullable: true })
  external_id: string | null;

  @Column({ length: 100, nullable: true })
  so_ky_hieu: string | null;

  /** Ngày ban hành (đi) / ngày đến (đến) */
  @Column({ type: 'date', nullable: true })
  ngay: string | null;

  @Column({ length: 100, nullable: true })
  loai: string | null;

  @Column({ type: 'text', nullable: true })
  trich_yeu: string | null;

  @Column({ length: 120, nullable: true })
  nguoi_ky: string | null;

  /** Email công vụ người được phân công xử lý (khớp admin_users.email / dim_employee.employee_code) */
  @Column({ length: 120, nullable: true })
  nguoi_xu_ly_email: string | null;

  @Column({ type: 'date', nullable: true })
  han_xu_ly: string | null;

  @Column({ type: 'date', nullable: true })
  ngay_hoan_thanh: string | null;

  /** Lĩnh vực phân loại bằng luật (config/event-rules/qlvb_domain.yaml) */
  @Column({ length: 40, nullable: true })
  domain: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  payload: Record<string, unknown>;

  /** lgsp | sim | do360 */
  @Column({ length: 10, default: 'lgsp' })
  source: string;

  /** Văn bản do DO360 trình ký: kỳ báo cáo tương ứng */
  @Column({ type: 'int', nullable: true })
  run_id: number | null;

  /** pending | signed | rejected — chỉ với văn bản DO360 trình ký */
  @Column({ length: 10, nullable: true })
  sign_status: string | null;

  /** Khoá object bản đã ký trên MinIO */
  @Column({ nullable: true })
  signed_file: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
