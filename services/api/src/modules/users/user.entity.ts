import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  zalo_user_id: string;

  @Column({ nullable: true, unique: true })
  zalo_follower_id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  address: string;

  // Tổ dân phố mà cư dân thuộc về (để nhận thông báo theo TDP). Trỏ tới tdp.id
  @Column({ nullable: true })
  tdp_id: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
