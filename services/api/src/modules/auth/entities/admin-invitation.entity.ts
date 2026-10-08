import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AdminRole, AdminUser } from '../../admin-users/admin-user.entity';

@Entity('admin_invitations')
export class AdminInvitation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', unique: true })
  token: string;

  @Column()
  role: AdminRole;

  @Column({ nullable: true })
  department: string | null;

  // Tổ dân phố sẽ gán cho tài khoản (bắt buộc khi mời role tdp_head)
  @Column({ nullable: true })
  tdp_id: number | null;

  // Gợi ý của người mời — người nhận vẫn có thể giữ tên Zalo của họ
  @Column({ nullable: true })
  suggested_name: string | null;

  @Column({ nullable: true })
  suggested_phone: string | null;

  @Column({ nullable: true })
  created_by: number | null;

  @ManyToOne(() => AdminUser, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  created_by_user: AdminUser | null;

  @Column({ nullable: true })
  used_by: number | null;

  @ManyToOne(() => AdminUser, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'used_by' })
  used_by_user: AdminUser | null;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  used_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
