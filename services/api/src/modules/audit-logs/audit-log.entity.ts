import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10, nullable: true })
  tenant_id: string | null;

  @Column({ nullable: true })
  admin_user_id: number;

  @Column()
  action: string;

  @Column()
  module: string;

  @Column({ nullable: true })
  target_id: number;

  @Column({ type: 'text', nullable: true })
  old_value: string;

  @Column({ type: 'text', nullable: true })
  new_value: string;

  @Column({ nullable: true })
  ip_address: string;

  @CreateDateColumn()
  created_at: Date;
}
