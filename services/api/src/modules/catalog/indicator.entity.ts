import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type Aggregation = 'cumulative' | 'flow' | 'point_in_time';
export type CaptureMethod = 'api' | 'export' | 'pdf_text' | 'ocr' | 'form';
export type ValueType = 'integer' | 'decimal' | 'percent' | 'money';

/** Thang thu thập: bậc nhỏ hơn = tin cậy hơn. Hai nguồn cho cùng chỉ tiêu thì bậc cao hơn (số nhỏ) thắng. */
export const CAPTURE_RANK: Record<CaptureMethod, number> = { api: 1, export: 2, pdf_text: 3, ocr: 4, form: 5 };

/**
 * Danh mục chỉ tiêu — tài sản dùng chung cho mọi đơn vị (không có tenant_id).
 * Nạp từ `config/indicators/*.yaml`; không sửa tay trong CSDL.
 */
@Entity('dim_indicator')
export class Indicator {
  /** Mã nội bộ dạng `linh_vuc.ten`, vd `tthc.tiep_nhan` */
  @PrimaryColumn({ length: 80 })
  indicator_id: string;

  @Column()
  name: string;

  /** Đơn vị tính hiển thị: "hồ sơ", "tỷ đồng", "%" */
  @Column({ length: 40 })
  unit: string;

  @Column({ length: 20, default: 'integer' })
  value_type: ValueType;

  /** Lĩnh vực: tthc, tai_chinh, tu_phap, y_te… */
  @Column({ length: 40 })
  domain: string;

  /** Phòng chủ dữ liệu (departments.key) — duyệt số của chỉ tiêu này */
  @Column({ length: 50, nullable: true })
  owner_dept: string | null;

  /** Tần suất gốc: month | quarter | year */
  @Column({ length: 20, default: 'month' })
  period_type: string;

  /** cumulative = lũy kế từ đầu năm; flow = phát sinh trong kỳ; point_in_time = tại thời điểm */
  @Column({ length: 20, default: 'cumulative' })
  aggregation: Aggregation;

  /** Phương thức thu thập mong đợi hiện tại của chỉ tiêu (để theo dõi lộ trình nâng bậc) */
  @Column({ length: 20, default: 'form' })
  capture_method: CaptureMethod;

  @Column({ length: 80, nullable: true })
  parent_id: string | null;

  @Column({ type: 'text', nullable: true })
  definition: string | null;

  /** Mã chỉ số theo văn bản của ngành/địa phương (vd QĐ 264 Đà Nẵng: "KT-01") — để cộng dồn lên cấp trên */
  @Column({ length: 40, nullable: true })
  official_code: string | null;

  /** Văn bản quy định chỉ tiêu */
  @Column({ nullable: true })
  regulation_ref: string | null;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
