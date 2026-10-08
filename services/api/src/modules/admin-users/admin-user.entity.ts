import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type AdminRole =
  | 'super_admin'
  | 'commune_admin'
  | 'department_staff'
  | 'leader'
  | 'tdp_head'
  | 'council';

@Entity('admin_users')
export class AdminUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  full_name: string;

  @Column({ unique: true, nullable: true })
  email: string | null;

  @Column({ nullable: true })
  password_hash: string | null;

  @Column({ unique: true, nullable: true })
  zalo_follower_id: string | null;

  @Column({ nullable: true })
  zalo_name: string | null;

  @Column({ default: 'department_staff' })
  role: AdminRole;

  @Column({ nullable: true })
  department: string;

  // Tổ dân phố phụ trách (chỉ dùng cho role 'tdp_head'). Trỏ tới tdp.id
  @Column({ nullable: true })
  tdp_id: number | null;

  /** Đơn vị (mã ĐVHC cấp xã) mà tài khoản thuộc về — mọi truy vấn dữ liệu DO360 lọc theo mã này */
  @Column({ length: 10, nullable: true })
  tenant_id: string | null;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
