import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tổ dân phố / Thôn — cấp trung gian (cấp 2) trong luồng truyền thông 3 cấp
 * Chính quyền (CQ) → Tổ dân phố (TDP) → Người dân.
 * Mỗi TDP có 1 trưởng TDP (admin_user role 'tdp_head').
 */
@Entity('tdp')
export class Tdp {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  code: string;

  // Trưởng Tổ dân phố — trỏ tới admin_users.id (role = 'tdp_head')
  @Column({ nullable: true })
  leader_admin_id: number | null;

  // GRID — ID nhóm trong Cộng đồng Zalo của xã (OA xã là trưởng nhóm).
  // Dùng để OA gửi thông báo trực tiếp vào nhóm của tổ (Group Message Feature).
  @Column({ nullable: true })
  group_id: string | null;

  @Column({ default: 0 })
  sort_order: number;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
