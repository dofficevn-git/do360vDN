import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { CaptureMethod } from '../catalog/indicator.entity';

/**
 * extracted   hệ thống bóc được / chuyên viên nhập — CHƯA được dùng cho báo cáo
 * confirmed   chuyên viên lĩnh vực xác nhận, đã qua kiểm tra số học
 * approved    lãnh đạo bộ phận (Data Owner) duyệt
 * locked      Văn phòng chốt kỳ — số đi vào snapshot của báo cáo
 * quarantined không qua Quality Gate hoặc thua nguồn bậc cao hơn — chờ Data Owner xử lý
 * rejected    bị loại (kèm lý do)
 */
export type FactStatus = 'extracted' | 'confirmed' | 'approved' | 'locked' | 'quarantined' | 'rejected';

/** Vị trí con số trong nguồn: file Bronze + trang/sheet + ô hoặc vùng ảnh */
export interface SourceRef {
  file_id?: number;
  sheet?: string;
  cell?: string;
  page?: number;
  /** [x0, y0, x1, y1] theo điểm ảnh/pt của trang */
  bbox?: [number, number, number, number];
  /** Đoạn chữ gốc quanh con số */
  snippet?: string;
  /** Luật đã bóc ra số này: source_type@version */
  rule?: string;
  /** Nguồn không phải file: 'qlvb', 'form', 'api:<tên>' */
  system?: string;
}

/**
 * Kho chỉ tiêu. CHỈ THÊM, KHÔNG GHI ĐÈ: giá trị, kỳ, ngày chốt, nguồn của một dòng là bất biến
 * (trigger `trg_fact_indicator_immutable` chặn UPDATE các cột đó và chặn DELETE).
 * Sửa số = thêm dòng mới `version + 1`, `supersedes_id` trỏ dòng cũ. Chỉ các cột luồng duyệt
 * (status, *_by, *_at, note) được cập nhật, và mỗi lần đổi ghi một dòng vào fact_status_log.
 */
@Entity('fact_indicator')
@Index('UQ_fact_key_version', ['tenant_id', 'indicator_id', 'period', 'breakdown_key', 'version'], { unique: true })
@Index('IDX_fact_tenant_period', ['tenant_id', 'period'])
@Index('IDX_fact_status', ['tenant_id', 'status'])
export class FactIndicator {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ length: 80 })
  indicator_id: string;

  /** Mã kỳ: 2026-M09 | 2026-Q3 | 2026-6M | 2026-9M | 2026-Y (common/period.ts) */
  @Column({ length: 12 })
  period: string;

  /** Ngày chốt số liệu */
  @Column({ type: 'date' })
  as_of_date: string;

  /** Giá trị đã chuẩn hoá về đơn vị gốc (đồng, hồ sơ, %…) */
  @Column({ type: 'numeric', precision: 24, scale: 6 })
  value: string;

  /** Phân tổ, vd { "to_dan_pho": "TDP01" }; rỗng = tổng */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  breakdown: Record<string, string>;

  /** md5(breakdown đã sắp khoá) — để lập khoá duy nhất; '' khi không phân tổ */
  @Column({ length: 32, default: '' })
  breakdown_key: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  source_ref: SourceRef;

  @Column({ type: 'int', nullable: true })
  source_file_id: number | null;

  @Column({ length: 20 })
  capture_method: CaptureMethod;

  /** 0..1 — độ tin cậy của khâu bóc tách; số nhập tay = 1 */
  @Column({ type: 'numeric', precision: 4, scale: 3, default: 1 })
  confidence: string;

  @Column({ length: 20, default: 'extracted' })
  status: FactStatus;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'bigint', nullable: true })
  supersedes_id: string | null;

  /** Kênh tạo bản ghi: web | zalo | tammi | api */
  @Column({ length: 20, default: 'web' })
  channel: string;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @Column({ type: 'int', nullable: true })
  confirmed_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmed_at: Date | null;

  @Column({ type: 'int', nullable: true })
  approved_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  approved_at: Date | null;

  @Column({ type: 'int', nullable: true })
  locked_by: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

  /** Lý do cách ly/loại/sửa */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

/** Nhật ký luồng duyệt của từng con số — ai, lúc nào, từ trạng thái nào sang trạng thái nào, vì sao. */
@Entity('fact_status_log')
@Index('IDX_fact_status_log_fact', ['fact_id'])
export class FactStatusLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 10 })
  tenant_id: string;

  @Column({ type: 'bigint' })
  fact_id: string;

  @Column({ length: 20, nullable: true })
  from_status: string | null;

  @Column({ length: 20 })
  to_status: string;

  @Column({ type: 'int', nullable: true })
  actor_id: number | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
