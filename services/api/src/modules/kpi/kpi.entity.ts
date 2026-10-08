import { Entity, PrimaryGeneratedColumn, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Tiêu chí KPI — cấu hình (config/kpi/*.yaml), dùng chung mọi đơn vị, đổi theo quy chế địa phương mà không sửa code.
 * formula: biểu thức an toàn trên các biến nguồn (task_total, task_on_time, vb_total, so_nop, so_bi_tra…) → giá trị (%, số).
 * score = clamp(value, 0, max_score) / max_score × weight.
 */
@Entity('kpi_criterion')
export class KpiCriterion {
  @PrimaryColumn({ length: 60 })
  criterion_id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  formula: string;

  @Column({ type: 'numeric', precision: 8, scale: 3, default: 1 })
  weight: string;

  /** task | qlvb | do360 | indicator | manual (manual: lãnh đạo nhập, không tính tự động) */
  @Column({ length: 20, default: 'task' })
  source: string;

  @Column({ length: 20, default: '%' })
  unit: string;

  @Column({ type: 'numeric', precision: 8, scale: 2, default: 100 })
  max_score: string;

  @Column({ nullable: true })
  regulation_ref: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

/**
 * Điểm KPI theo cán bộ × kỳ × tiêu chí. Hệ thống chỉ tính điểm ĐỀ XUẤT (proposed); cán bộ giải trình (explained);
 * lãnh đạo duyệt (approved) mới chốt. Mỗi điểm truy được về bằng chứng (evidence_ref: việc, văn bản, số liệu).
 * Dữ liệu cá nhân: cán bộ xem của mình, lãnh đạo xem đơn vị; mọi lượt xem ghi audit_logs.
 */
@Entity('kpi_score')
@Index('UQ_kpi_score_key', ['tenant_id', 'employee_id', 'period', 'criterion_id'], { unique: true })
@Index('IDX_kpi_score_tenant_period', ['tenant_id', 'period'])
export class KpiScore {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ type: 'int' })
  employee_id: number;

  @Column({ length: 12 })
  period: string;

  @Column({ length: 60 })
  criterion_id: string;

  /** Giá trị đo (vd 87.5 %) — null khi không đủ dữ liệu */
  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  value: string | null;

  /** Điểm sau quy đổi trọng số */
  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true })
  score: string | null;

  /** { task_ids, doc_ids, fact_ids, inputs } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  evidence_ref: Record<string, unknown>;

  /** proposed | explained | approved */
  @Column({ length: 12, default: 'proposed' })
  status: string;

  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  /** do360 (tự tính) | kpi_module (nhận từ module KPI) | manual */
  @Column({ length: 20, default: 'do360' })
  source: string;

  @Column({ type: 'int', nullable: true })
  approved_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  approved_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  computed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
