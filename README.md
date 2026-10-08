# DO360 cấp xã (Tami360)

Lõi dữ liệu + sinh báo cáo định kỳ cho UBND cấp xã: kho chỉ tiêu có nguồn và trạng thái duyệt, Quality Gate, chốt kỳ
đóng băng bộ số, sinh `.docx` theo thể thức NĐ 30/2020. Số do template render từ kho; mô hình ngôn ngữ (bước 2) chỉ viết lời.

```
services/api      NestJS + TypeORM + PostgreSQL — D1 kho, D2 danh mục, D3 Quality Gate, D4 sinh báo cáo, D5 QLVB, D6 KPI, T1/T4 kênh chat, dashboard, D8 nền
services/reader   Python FastAPI — T2 đọc Excel/Word/PDF/ảnh (OCR tuỳ chọn), T3 chạy luật bóc tách
apps/web          Next.js — D7 web Văn phòng: nộp file, xác nhận số, chốt kỳ, bản nháp
config/           indicators/ report-specs/ extract-rules/ kpi/ event-rules/ templates/ — cấu hình YAML có phiên bản (nguồn sự thật)
eval/             bộ đánh giá + kiểm chứng end-to-end; eval/private/ chứa file thật (không commit)
infra/            docker compose (Postgres, MinIO, reader, api, web)
docs/             TIEN-DO.md · GIAO-DIEN.md (5 giao diện) · TAI-LIEU-DAU-VAO.md
```

Chạy: xem `docs/TIEN-DO.md` mục "Chạy". Nguyên tắc bất di bất dịch: `fact_indicator` chỉ thêm không ghi đè (trigger CSDL);
mọi số bóc tự động phải qua người xác nhận + Quality Gate; không gọi dịch vụ AI ngoài nước; mọi bảng có `tenant_id`.

## Bộ demo Phường Điện Bàn Bắc

`bash infra/reset-demo.sh` dựng bộ demo từ CSDL trống (~2 phút, qua API): 3 kỳ (hai kỳ đã ký, một kỳ đang thu số), 4 lỗi thật bị chặn trong lịch sử, 13 tài khoản theo vai (trang đăng nhập liệt kê khi `DEMO_MODE=1`). Kịch bản 15 phút và checklist 10 câu: `docs/DEMO.md`; kiểm chứng: `python eval/smoke_demo.py`.

## Kiến trúc theo Technical Solution Blueprint V0.5

DO360 là lớp dữ liệu và điều hành lấy Object làm trung tâm: Object – Relation – Event – Document – Indicator, 4 trạng thái sở hữu dữ liệu, Data Map, Data Health 6 chỉ số, bảng điều hành theo lĩnh vực, Zalo chỉ là kênh đăng nhập/thông báo qua cổng an toàn (không Mini App). Đối chiếu từng mục: `docs/KIEN-TRUC-V05.md`; chính sách Zalo: `docs/ZALO-CHINH-SACH.md`.
