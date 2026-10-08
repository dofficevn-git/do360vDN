import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OwnershipType = 'MASTER' | 'REFERENCE' | 'LOCAL_MASTER' | 'DERIVED';

/**
 * DO360 Data Core (Blueprint V0.5 mục 8): Object lấy làm trung tâm. Một dòng = một đối tượng chính quyền đang quản lý
 * (dự án, hộ kinh doanh, địa bàn, tổ chức…). Các loại có bảng riêng sẵn (văn bản, nhiệm vụ, báo cáo, chỉ tiêu, đơn vị)
 * không sao chép vào đây — Object 360 đọc thẳng bảng gốc. Thuộc tính theo từ điển config/objects/types.yaml.
 */
@Entity('dim_object')
@Index('IDX_object_tenant_type', ['tenant_id', 'object_type'])
@Index('UQ_object_tenant_type_code', ['tenant_id', 'object_type', 'code'], { unique: true })
export class DimObject {
  /** DO360_ID — UUID nội bộ bất biến; master_id/external_ids giữ ID của nguồn chuẩn */
  @PrimaryGeneratedColumn('uuid')
  uid: string;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ length: 40 })
  object_type: string;

  /** Mã hiển thị trong đơn vị (DA-001, HKD-0012…) — không dùng tên làm khoá */
  @Column({ length: 40 })
  code: string;

  @Column()
  name: string;

  /** Tên chuẩn hoá để đối soát trùng (không dấu, thường, bỏ ký tự thừa) */
  @Column({ length: 300 })
  name_norm: string;

  @Column({ length: 30, default: 'active' })
  status: string;

  @Column({ length: 80, nullable: true })
  master_id: string | null;

  @Column({ length: 120, nullable: true })
  master_source: string | null;

  /** { ma_so_thue: '040…', ma_so_hkd: '…' } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  external_ids: Record<string, string>;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  attributes: Record<string, unknown>;

  @Column({ length: 20, default: 'LOCAL_MASTER' })
  ownership_type: OwnershipType;

  @Column({ length: 50, nullable: true })
  data_owner_dept: string | null;

  @Column({ type: 'int', nullable: true })
  data_steward_id: number | null;

  /** { source_type: FILE|API|DOCUMENT|HUMAN, source_id, file_id, page, extracted_by } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  provenance: Record<string, unknown>;

  /** pending | verified | rejected */
  @Column({ length: 20, default: 'pending' })
  verification_status: string;

  @Column({ type: 'date', nullable: true })
  valid_from: string | null;

  @Column({ type: 'date', nullable: true })
  valid_to: string | null;

  /** Lần cập nhật nội dung gần nhất (để tính SỐNG) */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  refreshed_at: Date;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}

/** Quan hệ giữa hai Object — first-class (Blueprint mục 9), loại quan hệ theo config/objects/relations.yaml. */
@Entity('object_relation')
@Index('IDX_relation_source', ['source_uid'])
@Index('IDX_relation_target', ['target_uid'])
export class ObjectRelation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ length: 40 })
  relation_type: string;

  @Column({ type: 'uuid' })
  source_uid: string;

  /** Object đích: uid trong dim_object, hoặc tham chiếu bảng gốc dạng "tasks:12", "qlvb_document:5", "departments:kinh_te" */
  @Column({ length: 80 })
  target_uid: string;

  @Column({ nullable: true })
  target_name: string | null;

  @Column({ type: 'date', nullable: true })
  valid_from: string | null;

  @Column({ type: 'date', nullable: true })
  valid_to: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  source_ref: Record<string, unknown>;

  @Column({ length: 20, default: 'active' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

/** Tài liệu ↔ Object (Blueprint mục 11): file nguồn, văn bản QLVB, báo cáo gắn với đối tượng. */
@Entity('document_object_link')
@Index('IDX_doclink_object', ['object_uid'])
export class DocumentObjectLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  /** source_file | qlvb_document | report_run */
  @Column({ length: 20 })
  document_kind: string;

  @Column({ type: 'int' })
  document_id: number;

  @Column({ type: 'uuid' })
  object_uid: string;

  /** evidence | decision | plan | report */
  @Column({ length: 20, default: 'evidence' })
  link_type: string;

  @Column({ nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

/** Kênh tương tác chính danh (Blueprint mục 47.3, 68): nhóm Zalo do OA đơn vị sở hữu, mapping với phạm vi nghiệp vụ. */
@Entity('interaction_channel')
export class InteractionChannel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  tenant_id: string;

  /** ZALO_GMF | ZALO_OA | IN_APP */
  @Column({ length: 20, default: 'ZALO_GMF' })
  channel_type: string;

  /** Khoá nghiệp vụ: lanh_dao | van_phong | bao_cao | du_an | <dept key> */
  @Column({ length: 40 })
  key: string;

  @Column()
  name: string;

  @Column({ length: 80, nullable: true })
  external_group_id: string | null;

  /** EXECUTIVE | DEPARTMENT | REPORTING | PROJECT | TOPIC */
  @Column({ length: 20, default: 'TOPIC' })
  scope_type: string;

  @Column({ length: 40, nullable: true })
  scope_id: string | null;

  /** PUBLIC | INTERNAL — nội dung tối đa được gửi vào nhóm */
  @Column({ length: 20, default: 'INTERNAL' })
  classification_allowed: string;

  /** Thành viên theo vai/phòng: ['role:leader', 'dept:kinh_te', 'user:12'] */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  member_rules: string[];

  @Column({ type: 'int', nullable: true })
  approved_by: number | null;

  @Column({ length: 20, default: 'active' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
