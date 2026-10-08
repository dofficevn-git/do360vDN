import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Cán bộ, công chức của đơn vị (giao diện dữ liệu tối thiểu với module KPI).
 * Khác admin_users: đây là danh sách nhân sự để gắn nhiệm vụ/KPI; `admin_user_id` nối với
 * tài khoản đăng nhập nếu người đó có dùng hệ thống.
 */
@Entity('dim_employee')
@Index('UQ_employee_tenant_code', ['tenant_id', 'employee_code'], { unique: true })
export class Employee {
  @PrimaryGeneratedColumn()
  employee_id: number;

  @Column({ length: 10 })
  tenant_id: string;

  /** Mã cán bộ / email công vụ — khoá ghép với QLVB (nguoiXuLyEmail) và module KPI */
  @Column({ length: 120 })
  employee_code: string;

  @Column()
  name: string;

  @Column({ length: 50, nullable: true })
  dept: string | null;

  @Column({ nullable: true })
  position: string | null;

  /** active | inactive */
  @Column({ length: 20, default: 'active' })
  status: string;

  @Column({ type: 'int', nullable: true })
  admin_user_id: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
