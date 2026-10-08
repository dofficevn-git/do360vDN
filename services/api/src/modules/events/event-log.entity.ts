import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Nhật ký sự kiện (Object–Event): văn bản ban hành, nhiệm vụ giao, vốn giải ngân…
 * Nguồn của "sự kiện chỉ đạo" và chú thích cuối trang trong báo cáo. Chỉ thêm.
 */
@Entity('event_log')
@Index('IDX_event_tenant_date', ['tenant_id', 'event_date'])
@Index('IDX_event_tenant_domain', ['tenant_id', 'domain'])
@Index('UQ_event_external', ['tenant_id', 'source_system', 'external_id'], { unique: true, where: '"external_id" IS NOT NULL' })
export class EventLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  event_id: string;

  @Column({ length: 10 })
  tenant_id: string;

  /** DOC | TSK | PRJ | ORG | IND | KNOW */
  @Column({ length: 10 })
  object_type: string;

  /** Định danh đối tượng, vd số ký hiệu văn bản "253/KH-UBND" */
  @Column({ length: 200 })
  object_id: string;

  /** ban_hanh | tiep_nhan | giao | hoan_thanh | giai_ngan … */
  @Column({ length: 40 })
  event_type: string;

  @Column({ type: 'date' })
  event_date: string;

  /** Lĩnh vực (khớp dim_indicator.domain) — phân loại bằng luật theo loại văn bản + từ khoá */
  @Column({ length: 40, nullable: true })
  domain: string | null;

  /** { so_ky_hieu, loai, trich_yeu, nguoi_ky, … } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  payload: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  source_ref: Record<string, unknown>;

  /** qlvb | form | file — cùng external_id để đồng bộ không nhân đôi */
  @Column({ length: 20, default: 'form' })
  source_system: string;

  @Column({ length: 100, nullable: true })
  external_id: string | null;

  /** Object trong dim_object mà sự kiện xảy ra với (Data Core) — null với sự kiện văn bản/nhiệm vụ của bảng gốc */
  @Column({ type: 'uuid', nullable: true })
  object_uid: string | null;

  @Column({ type: 'int', nullable: true })
  actor_id: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
