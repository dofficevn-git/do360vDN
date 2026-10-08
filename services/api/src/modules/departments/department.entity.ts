import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Phòng, bộ phận của UBND cấp xã (NĐ 150/2025/NĐ-CP). Trong DO360 mỗi phòng là chủ dữ liệu (Data Owner)
 * của các chỉ tiêu thuộc lĩnh vực mình: `head_admin_id` là người duyệt số (`approved`) của phòng.
 * `key` được tham chiếu ở dim_indicator.owner_dept, report_slot.owner_dept, admin_users.department — KHÔNG đổi.
 */
@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  /** Vị trí/phòng làm việc — hiện trên Mini App để dân biết đến đâu. */
  @Column({ nullable: true })
  location: string;

  @Column({ nullable: true })
  phone: string;

  /** Người đại diện phòng — nhận thông báo phản ánh/lịch hẹn mới và phân việc cho cán bộ trong phòng. */
  @Column({ type: 'int', nullable: true })
  head_admin_id: number | null;

  /** Phòng phụ trách những gì (hiện cho dân khi đặt lịch). */
  @Column({ nullable: true })
  description: string | null;

  @Column({ default: 0 })
  sort_order: number;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
