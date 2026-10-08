import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Đơn vị dùng hệ thống. `tenant_id` là mã ĐVHC cấp xã chuẩn (QĐ 19/2025/QĐ-TTg);
 * `parent_id` là cấp cha (tỉnh/thành phố) để cộng dồn lên CSDL cấp Sở ở bậc 3 của lộ trình.
 */
@Entity('dim_tenant')
export class Tenant {
  @PrimaryColumn({ length: 10 })
  tenant_id: string;

  @Column()
  name: string;

  /** 'xa' | 'phuong' | 'dac_khu' | 'tinh' */
  @Column({ length: 20, default: 'xa' })
  unit_type: string;

  /** Mã tỉnh/thành 2 số */
  @Column({ length: 10, nullable: true })
  parent_id: string | null;

  @Column({ nullable: true })
  parent_name: string | null;

  /** Mã định danh cơ quan trên trục LGSP/QLVB (vd H17.102) */
  @Column({ length: 30, nullable: true })
  organ_id: string | null;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
