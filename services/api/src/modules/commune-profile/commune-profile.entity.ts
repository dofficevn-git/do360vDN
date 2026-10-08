import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('commune_profiles')
export class CommuneProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  logo_url: string;

  @Column({ default: '#0F3D6E' })
  primary_color: string;

  @Column({ default: '#ffffff' })
  text_color: string;

  @Column({ nullable: true })
  banner_url: string;

  @Column({ nullable: true })
  ubnd_address: string;

  @Column({ nullable: true })
  party_address: string;

  @Column({ nullable: true })
  mttq_address: string;

  @Column({ nullable: true })
  police_address: string;

  @Column({ nullable: true })
  population: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  area: number;

  @Column({ nullable: true })
  public_service_count: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  satisfaction_rate: number;

  @Column({ nullable: true })
  weather_location: string;

  // Đường dẫn tour VR360 của xã/xã (nhúng iframe ở mục Bản đồ → VR360)
  @Column({ nullable: true })
  vr360_url: string;

  // Lịch tiếp công dân (hiển thị ở trang Danh bạ cán bộ trên Mini App)
  @Column({ type: 'text', nullable: true })
  reception_schedule: string;

  // Link kênh truyền hình (YouTube live / HLS) nhúng ở mục Truyền hình
  @Column({ nullable: true })
  tv_url: string;


  // ── Truyền thanh số: mã đơn vị hành chính (QĐ 19/2025/QĐ-TTg) — admin điền ở Cài đặt ──
  /** Mã tỉnh/thành 2 số (Hà Nội = 01) */
  @Column({ length: 2, nullable: true })
  admin_unit_city_id: string | null;

  /** Mã xã/phường 5 số theo bảng mã mới (API bên đó gọi là DistrictId) */
  @Column({ length: 5, nullable: true })
  admin_unit_district_id: string | null;

  /** Bật thì cron mới gọi API ngoài; tắt = chỉ dùng bản tin xã tự đăng */
  @Column({ default: false })
  broadcast_external_enabled: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
