import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AdminUser } from '../../admin-users/admin-user.entity';

@Entity('admin_qr_sessions')
export class AdminQrSession {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ default: 'pending' })
  status: 'pending' | 'authenticated' | 'expired';

  @Column({ default: 'login' })
  session_type: 'login' | 'link';

  @Column({ nullable: true })
  admin_user_id: number | null;

  @ManyToOne(() => AdminUser, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'admin_user_id' })
  admin_user: AdminUser | null;

  @Column({ type: 'text', nullable: true })
  jwt_token: string | null;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @CreateDateColumn()
  created_at: Date;
}
