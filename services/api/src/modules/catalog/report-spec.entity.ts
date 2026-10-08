import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Mẫu báo cáo khai báo như dữ liệu. Một (spec_code, version) là bất biến sau khi có report_run dùng nó;
 * đổi mẫu = nạp version mới từ `config/report-specs/`.
 */
@Entity('report_spec')
@Index('UQ_report_spec_code_version', ['spec_code', 'version'], { unique: true })
export class ReportSpec {
  @PrimaryGeneratedColumn()
  id: number;

  /** vd `ktxh_dinh_ky` */
  @Column({ length: 80 })
  spec_code: string;

  /** Loại báo cáo: ktxh | kpi | … */
  @Column({ length: 40 })
  report_type: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column()
  title: string;

  /** Các loại kỳ áp dụng: ["month","quarter","half","nine_months","year"] */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  period_types: string[];

  /** Template .docx trong config/templates/ */
  @Column({ nullable: true })
  template_file: string | null;

  /** Tên mục theo mã mục: { "I": "Công tác chỉ đạo, điều hành", "II.3.4": "Thủ tục hành chính" } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  sections: Record<string, string>;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;
}

export type SlotType = 'metric_sentence' | 'metric_table' | 'event_list' | 'narrative' | 'next_tasks' | 'static';

/** Một ô nội dung của báo cáo: câu số, bảng số, danh sách sự kiện, lời dẫn… */
@Entity('report_slot')
@Index('UQ_report_slot_spec_slot', ['spec_id', 'slot_code'], { unique: true })
export class ReportSlot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  spec_id: number;

  /** vd `tthc.mot_cua.tong_hop` */
  @Column({ length: 120 })
  slot_code: string;

  /** Tên hiển thị cho cán bộ: "Giải quyết TTHC tại Bộ phận Một cửa" */
  @Column({ nullable: true })
  title: string | null;

  /** Mục trong báo cáo: "II.3.4" */
  @Column({ length: 40 })
  section: string;

  @Column({ type: 'int', default: 0 })
  ord: number;

  @Column({ length: 30 })
  slot_type: SlotType;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  indicator_ids: string[];

  /** Truy vấn sự kiện cho slot event_list: { domain, event_types, object_types } */
  @Column({ type: 'jsonb', nullable: true })
  event_query: Record<string, unknown> | null;

  /** Khuôn câu, biến dạng {indicator_id} */
  @Column({ type: 'text', nullable: true })
  template: string | null;

  /** Phép kiểm số học của slot: ["a + b == c", …] */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  checks: string[];

  /** Nhãn tiếng Việt của từng phép kiểm: { "a + b == c": "Trước hạn + quá hạn = đã giải quyết" } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  check_labels: Record<string, string>;

  /** Khuôn câu gợi ý cho slot lời dẫn (narrative): biến {ky}, {events}, {chỉ tiêu} */
  @Column({ type: 'text', nullable: true })
  narrative_template: string | null;

  @Column({ length: 50, nullable: true })
  owner_dept: string | null;

  /** Slot bắt buộc: thiếu số đã duyệt thì không chốt kỳ được (nhóm kiểm tra "đầy đủ") */
  @Column({ default: true })
  required: boolean;
}

/** Bộ luật bóc tách theo loại nguồn (D2 → T3). Nội dung là YAML đã parse, có phiên bản. */
@Entity('extract_rule')
@Index('UQ_extract_rule_type_version', ['source_type', 'version'], { unique: true })
export class ExtractRule {
  @PrimaryGeneratedColumn()
  id: number;

  /** vd `mot_cua_tong_hop_xlsx` */
  @Column({ length: 80 })
  source_type: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  /** xlsx | docx | pdf_text | image */
  @Column({ length: 20 })
  file_kind: string;

  @Column({ length: 40, nullable: true })
  domain: string | null;

  /** Toàn bộ luật: { match, map, sentences, labels, … } */
  @Column({ type: 'jsonb' })
  rule: Record<string, unknown>;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;
}
