import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Kế hoạch năm (dự toán, chỉ tiêu giao) của từng chỉ tiêu — để câu số viết "đạt x% kế hoạch".
 * Chỉ thêm: sửa kế hoạch = dòng mới version+1 (giữ vết văn bản giao). Hiện hành = version lớn nhất.
 */
@Entity('plan_target')
@Index('UQ_plan_target_key', ['tenant_id', 'indicator_id', 'year', 'version'], { unique: true })
export class PlanTarget {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ length: 80 })
  indicator_id: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'numeric', precision: 24, scale: 6 })
  value: string;

  /** Văn bản giao kế hoạch: { so_ky_hieu, ngay, trich_yeu } hoặc file Bronze */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  source_ref: Record<string, unknown>;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
