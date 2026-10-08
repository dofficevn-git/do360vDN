# Tài liệu đầu vào — đã nhận và còn thiếu (05/10/2026)

Thư mục anh cung cấp: `D:\MiniApp\docs` (8 file). Tất cả là tài liệu của **thành phố Đà Nẵng** → địa bàn thí điểm thuộc Đà Nẵng (khớp báo cáo mẫu của phường Điện Bàn Bắc).

## Đã nhận

| File | Là gì | Dùng cho module | Ghi chú khi đọc |
|---|---|---|---|
| `Qd 264 về bộ chỉ số chỉ đạo điều hành.pdf` (22 tr.) | QĐ của UBND TP Đà Nẵng ban hành **Bộ chỉ số phục vụ chỉ đạo, điều hành**; phụ lục là bảng: mã chỉ số (KT-01…), tên, lĩnh vực, đơn vị tính, phạm vi/phân tổ, tần suất, đơn vị cung cấp, nguồn/hệ thống, **mã bảng dữ liệu** (`FACT_KT_TONGHOP`…), chế độ cập nhật, mức độ mở | **D2 — danh mục chỉ tiêu** (`official_code`, định nghĩa, tần suất) | Đây chính là "biểu mẫu ngành" để không tự đặt mã. **Bản scan, lớp chữ hỏng** (OCR cũ sai dấu) → phải bóc lại bảng 17 trang bằng OCR + soát tay. Chỉ số ở cấp thành phố; cần lọc những chỉ số xã phải cung cấp (cột "Đơn vị cung cấp"). |
| `TaiLieu_LGSPv2_API_QLVBDH_LienThongTichHop (1).docx` | Tài liệu API **QLVB điều hành qua trục LGSP Đà Nẵng** (`apiv2.danang.gov.vn/LGSP/QLVBDH/1.0`): lấy token (client credentials), `getVanBanDen`, `getVanBanDi`, `LichCongTac`; gọi bất đồng bộ (jobId → `/api/jobs`, `/api/jobs/artifact`, `/api/status`), có callback | **D5 — tích hợp QLVB** | Chỉ có **chiều đọc** (sổ văn bản đi/đến, lịch công tác). **Chưa có API trình ký / nhận bản đã ký / phân công xử lý** như thiết kế nêu → cần hỏi lại đơn vị chủ quản. Chưa có ConsumerKey/Secret, `organId`/`organKey` của xã thí điểm, và mô tả cấu trúc dữ liệu trả về. |
| `Khung kiến trúc dữ liệu Đà Nẵng.pdf` (134 tr., QĐ 2754/QĐ-UBND 24/6/2026) | Khung kiến trúc dữ liệu, khung quản trị/quản lý dữ liệu TP | D1, D8 — đặt tên, phân loại, vai trò chủ quản dữ liệu, siêu dữ liệu | Có mục riêng trách nhiệm "các đơn vị cấp xã". Đọc kỹ ở GĐ1 để mô hình DO360 khớp danh mục dữ liệu dùng chung. |
| `KhungKTSDaNang.pdf` (396 tr., QĐ 3291/QĐ-UBND 30/12/2025) | Khung kiến trúc số TP | D8, tích hợp | Tham chiếu LGSP/NDXP, mô hình triển khai tập trung. |
| `QD 3292 về Đề án chuyển đổi số TPĐN.pdf` (266 tr.) | Đề án CĐS 2026–2030 | Bối cảnh, hồ sơ dự án | Lớp chữ hỏng (scan). |
| `KH 102 TP.pdf`, `KH TP.pdf` | KH triển khai chiến lược dữ liệu; KH thực hiện NQ 214/NQ-CP về tạo lập dữ liệu | Bối cảnh, căn cứ pháp lý | Lớp chữ hỏng (scan). |
| `Phường Bàn Thạch.pdf` (4 tr.) | Công văn dự thảo của UBND phường Bàn Thạch đề xuất danh mục đề án KT-XH 2026 | Mẫu văn bản cấp phường (thể thức, bóc metadata văn bản) | Không phải báo cáo định kỳ. |

## Còn thiếu (xếp theo độ chặn tiến độ)

| # | Thứ cần | Chặn việc gì |
|---|---|---|
| 1 | **Báo cáo 436/BC-UBND ngày 18/9/2026 của phường Điện Bàn Bắc** (Word hoặc PDF có lớp chữ) | Report Spec đầy đủ, khuôn câu, template .docx, test Quality Gate với 4 lỗi thật, cổng GĐ1 "nhập bộ số 9 tháng" (hiện mới có 5 số một cửa lấy từ tài liệu thiết kế) |
| 2 | **"Đặc tả demo (cho đội code)"** được nhắc trong tài liệu thiết kế | Tôi đã tự viết `docs/GIAO-DIEN.md`; cần đối chiếu để không lệch |
| 3 | **File nguồn thật** các bộ phận gửi Văn phòng (Excel một cửa, kế toán ngân sách, hộ tịch; báo cáo Trạm Y tế/Công an; ảnh màn hình thống kê) | Luật bóc tách thật + bộ đánh giá `eval/`. Luật hiện có (`mot_cua_tong_hop_xlsx`) dựng theo ví dụ, chưa khớp file thật |
| 4 | 3–4 báo cáo kỳ trước (tháng, quý, 6 tháng) | Kiểm độ lặp khuôn mẫu; nhóm kiểm tra "xu hướng" |
| 5 | Bản **QĐ 264 có lớp chữ chuẩn** (Word/Excel phụ lục) nếu xin được | Đỡ phải OCR + soát tay 17 trang bảng |
| 6 | Mã ĐVHC + `organId` LGSP của xã thí điểm; ConsumerKey/Secret LGSP; mẫu JSON trả về của `getVanBanDi/Den` | `DEFAULT_TENANT_ID` (đang để `00000`), adapter QLVB |
| 7 | Module KPI (mã nguồn / API / CSDL) | D6 |
| 8 | Tài liệu API Tammi | T1 bản Tammi |
