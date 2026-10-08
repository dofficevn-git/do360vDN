# DO360 cấp xã — Đối chiếu với Technical Solution Blueprint V0.5

Tài liệu này ánh xạ từng mục của *DO360 Technical Solution Blueprint V0.5* vào bản cài hiện tại (repo `do360-commune`), ghi rõ **đã làm**, **làm một phần**, **chưa làm (lý do, cần gì)**. Cập nhật 07/10/2026 sau đợt "nâng cấp theo V0.5".

## 1. Mô hình dữ liệu lõi (mục 1, 4, 5, 8–12)

| Thành phần | Bản cài | Trạng thái |
|---|---|---|
| **Object** | Bảng `dim_object` (uid UUID bất biến, `object_type`, `code`, `master_id`/`master_source`, `external_ids`, `attributes` theo từ điển, `ownership_type`, `data_owner_dept`, `provenance`, `verification_status`, `refreshed_at`). Loại đã có bảng riêng (văn bản `qlvb_document`, nhiệm vụ `tasks`, báo cáo `report_run`, chỉ tiêu `dim_indicator`, đơn vị `dim_tenant`) **không sao chép** — Object 360 đọc thẳng bảng gốc. Từ điển: `config/objects/types.yaml` (10 Object lõi MVP, mục 33). | Đã làm |
| **Relation** | `object_relation` (loại theo `config/objects/relations.yaml`, không nhập tự do), đích là Object khác hoặc tham chiếu bảng gốc. | Đã làm |
| **Event** | `event_log` thêm `object_uid`, `actor_id`; loại theo `config/objects/events.yaml`; sự kiện mang số (giải ngân) cộng dồn vào thuộc tính; giao việc/hoàn thành việc tự sinh Event. | Đã làm |
| **Document** | `source_file` (file gốc, hash, PII) + `qlvb_document` + `report_run`; bảng nối `document_object_link` (bằng chứng/quyết định/kế hoạch/báo cáo ↔ Object). Chunk/bbox/vector: chưa (chưa có RAG). | Một phần |
| **Indicator** | `dim_indicator` (97 chỉ tiêu, 11 lĩnh vực theo Báo cáo 436) + `fact_indicator` chỉ thêm, có `period`, nguồn, phiên bản, trạng thái; kế hoạch năm `plan_target`; snapshot đóng băng khi chốt; LLM không sinh số. | Đã làm |
| **Time / Source / Ownership / Quality** | `event_date`/`as_of_date`/`valid_from-to`/`created_at`; `source_ref` + `provenance`; `ownership_type` 4 trạng thái; `verification_status` + freshness tính theo `freshness_days` của loại. | Đã làm |

## 2. Quyền sở hữu dữ liệu — Source–Ownership Matrix (mục 6, QĐ 2756)

| Object / Dataset | Ownership | Nguồn chủ | DO360 lưu |
|---|---|---|---|
| Đơn vị hành chính | MASTER | Danh mục ĐVHC | tham chiếu `dim_tenant` |
| Văn bản | MASTER | QLVB (LGSP) | bản sao đồng bộ chỉ đọc + sự kiện |
| Hồ sơ TTHC, QH, XD, TNMT | MASTER | Hệ thống TTHC thành phố | **chỉ số tổng hợp theo kỳ** (không hồ sơ cá nhân) |
| Dân cư, đất đai | REFERENCE (chờ) | CSDL quốc gia / Thành phố | số tổng hợp theo địa bàn |
| Địa bàn, tổ chức, hộ kinh doanh | REFERENCE | Danh mục Thành phố / ĐKKD (mã số thuế, mã HKD = Master ID) | ID + trường cần dùng; sự kiện CĐS là LOCAL |
| Dự án, công trình; nhiệm vụ; kế hoạch năm; số liệu phòng nộp | LOCAL_MASTER | UBND phường | DO360 là nơi quản lý chính |
| Chỉ tiêu, báo cáo, KPI, sức khoẻ dữ liệu, nhiệm vụ đếm từ sổ giao việc | DERIVED | DO360 tính | lineage đầy đủ |

Nguyên tắc đầu tư: *Thành phố có gì dùng chung thì kết nối và kế thừa; phường phát sinh gì thì chuẩn hoá; DO360 tạo lớp liên kết và khai thác* — thể hiện ở `config/data-map/sources.yaml` (status `planned` cho nguồn chờ Thành phố cấp khoá).

## 3. Vòng đời dữ liệu (mục 5, 15, 35, 36)

```
Nguồn (API/file/văn bản/scan/nhập tay) → Bronze (file gốc) → reader (luật bóc tách, OCR tuỳ chọn, PII) → fact_indicator (extracted)
→ người xác nhận → Data Owner duyệt → Quality Gate 6 nhóm → chốt kỳ (snapshot) → Word → trình ký (QLVB) → ký
→ Nhiệm vụ kỳ tới → tasks (mục tiêu = chỉ tiêu + giá trị) → Event giao/hoàn thành → chỉ tiêu DERIVED kỳ sau (POST /admin/data/derive-tasks)
```
Quality Gate chặn chốt khi thiếu/chưa duyệt/sai số học/lệch ngày chốt; cảnh báo xu hướng (quy về cùng số tháng), số mơ hồ, nhất quán kỳ. Tương ứng mục 36 ("Không thể chốt báo cáo. Thiếu: … Xung đột: …").

## 4. Report Template / Report Instance (mục 13, 14)

Report Spec `ktxh_dinh_ky@3` (`config/report-specs/ktxh_dinh_ky.yaml`) dựng theo cấu trúc Báo cáo 436: I Chỉ đạo (văn bản đến/đi, cơ cấu 8 loại, nhiệm vụ, 1022) · II.1 Kinh tế (HKD/CĐS HKD, nông nghiệp, QH–ĐT–XD–GPMB, TNMT, tài chính) · II.2 VH-XH (y tế BHYT/YHCT/tiêm chủng, an sinh, văn hoá) · II.3 KHCN–CĐS · II.4 Nội vụ–CCHC (một cửa, trực tuyến) · II.5 QPAN–Nội chính · III Nhiệm vụ. 25 slot, 19 phép kiểm có nhãn, khuôn câu `{plan%}`/`{yoy}`. Report instance = `report_run` (trạng thái, phiên bản, snapshot). Pipeline mục 13.3 đã đủ trừ bước "GenAI Draft" (lời dẫn bước 1 = khuôn câu + Văn phòng biên tập; `LocalLlmWriter` tắt, chỉ host nội bộ).

## 5. Ingestion 5 cửa (mục 16, 17)

| Cửa | Bản cài |
|---|---|
| API/System | QLVB (LGSP adapter + giả lập), KPI module, sổ giao việc nội bộ (DERIVED), 1022/IOC: chờ |
| Excel/CSV | biểu mẫu chuẩn 7 phòng (`tools/make_forms.py`) + file xuất hệ thống (luật map ô/cột) |
| Word/PDF có chữ | luật mẫu câu (`sentences`), đơn vị tiền đi kèm số, số mơ hồ hạ tin cậy |
| Scan/ảnh | PaddleOCR tuỳ chọn (`WITH_OCR=1`), luật vùng (`regions`) |
| Nhập tay | form web/Mini App (đóng băng)/lệnh chat `NHAP`; cùng từ điển, cùng Object ID |

Document AI pipeline 16 bước: có 1–3, 5 (theo luật), 6, 10–14, 16; **chưa**: nhận diện Object tự động từ văn bản (7–9), phân loại bằng mô hình (5), index RAG (15).

## 6. Entity Resolution (mục 18)

`POST /admin/objects/resolve`: Master ID → mã định danh (`external_ids`) → tên chuẩn hoá (bỏ dấu, bỏ "Công ty/TNHH/CP…") → gần đúng trigram ≥ 0,6 (cần người xác nhận). Tạo Object trùng ≥ 90% → 409 kèm ứng viên; `force` khi người có thẩm quyền khẳng định. Chưa có: khớp theo địa chỉ chuẩn hoá, AI-assisted.

## 7. Data Quality Engine (mục 19, 56) và Data Map (mục 20, 30, 55)

`GET /admin/data/health?period=`: **Đúng** (số đã duyệt/chốt + Object đã xác minh) · **Đủ** (chỉ tiêu bắt buộc có số) · **Sạch** (không cách ly/loại sai, Object không trùng) · **Sống** (ngày chốt ≤ 30 ngày quanh cuối kỳ; Object trong chu kỳ) · **Thống nhất** (Object tham chiếu có Master ID; số có nguồn) · **Dùng chung** (chỉ tiêu ≥ 2 nơi dùng). Mỗi chỉ số có danh sách bản ghi + theo phòng + nút nhắc; điểm tổng có thể đẩy vào kho (`cds.data_health`, DERIVED).
`GET /admin/data/map`: cấu hình `config/data-map/sources.yaml` (Data Contract rút gọn) + số đo thật (bản ghi, lần nạp, độ mới, chất lượng, nơi dùng); `lineage?indicator_id` (ngược) và `impact?dataset` (xuôi).

## 8. Giao diện (mục 37, 49–62)

Điều hướng theo mục 60; trang chủ theo vai (mục 61): Văn phòng `/dashboard`, Chủ tịch `/sign`, HĐND `/read`, Data Owner `/approve`, chuyên viên `/my`. **Bảng điều hành** `/leadership`: khối "Việc cần xử lý" (nhiệm vụ quá hạn, chỉ tiêu thiếu, dự án cảnh báo, nguồn quá hạn, số chờ/cách ly) rồi 9 lĩnh vực với thẻ **Mục tiêu – Thực hiện – Rủi ro – Hành động** (`config/dashboard/domains.yaml`); `/domain/<key>`; **Object 360** `/objects/<uid>` (tổng quan, thuộc tính, quan hệ, timeline, chỉ tiêu, nhiệm vụ, tài liệu, chất lượng, audit); Danh bạ đối tượng; Bản đồ dữ liệu; Sức khoẻ dữ liệu; Tìm kiếm toàn hệ thống (Dữ liệu / Tài liệu). GIS (mục 58): chưa (chờ nguồn nền địa lý của Thành phố).

## 9. Zalo (mục 46–48, 63, 65–70)

- Đăng nhập Zalo: có (QR + liên kết `zalo_follower_id`), Zalo ID chỉ là định danh ngoài; quyền do DO360 (RBAC) quản.
- OA = mặt tiền thông báo: mọi tin qua **Notification Security Gateway** (`config/notifications/rules.yaml`: tầng critical/action/important/info/digest; mẫu cấm CCCD, SĐT, email, bí mật nhà nước, hồ sơ sức khoẻ, số tài khoản; cắt độ dài; deep link **chỉ về web**, kiểm quyền lại khi mở). Nhật ký `chat_message.gateway`.
- Nhóm chính danh: đăng ký `interaction_channel` (phạm vi, thành viên theo vai, mức nội dung); gửi nhóm ghi nhật ký `skipped` tới khi Zalo xác nhận API nhóm (GMF) cho OA cơ quan hành chính.
- Tổng hợp đầu ngày 07:00 (`POST /admin/chat/digest` để thử).
- **Không Mini App** (mục 65.6): khu "Số liệu báo cáo" trên Mini App ZSC giữ mã nhưng **đóng băng**, không deploy, không nằm trong kiến trúc đích; thẻ chat không trỏ Mini App.
- Hai chiều (47.6–47.7): lệnh `XN/SUA/LOAI/NHAP/TIEN DO` qua OA đã có; chuyển chat → Task Draft bằng AI: chưa (bước 2, cần intent detection + whitelist nhóm).

## 10. Bảo mật, audit, lưu trữ (mục 23–25, 38–39)

RBAC + Data Owner theo phòng + HĐND chỉ đọc; audit log mọi thao tác ghi; `fact_indicator` có trigger cấm UPDATE/DELETE; snapshot báo cáo bất biến; lưu trữ tách: Postgres (Object/giao dịch + chỉ tiêu), MinIO (file gốc), chưa có search/vector index (chưa cần cho bước 1). AI Gateway/abstraction: `NarrativeWriter` (template | LLM cục bộ, allowlist host). Chưa: ABAC theo trường, phân loại dữ liệu theo từng trường, RTO/RPO.

## 11. Acceptance Criteria prototype (mục 40) — trạng thái

| # | Tiêu chí | Trạng thái |
|---|---|---|
| 1–3 | Upload, parse/OCR, nhận diện loại tài liệu (theo luật) | ✓ |
| 4–5 | Nhận diện Object, link Object hiện có / đề xuất tạo | ◐ gắn tài liệu ↔ Object thủ công + đối soát trùng; chưa tự động từ văn bản |
| 6 | Extract ≥ 1 Event | ◐ sự kiện từ QLVB, từ giao việc, nhập trên Object 360; chưa bóc từ nội dung văn bản |
| 7–8 | Extract/tính Indicator, giữ nguồn + trang/ô | ✓ |
| 9 | Hiển thị Object 360 | ✓ |
| 10–11 | Sinh đoạn báo cáo từ Indicator, click về nguồn | ✓ |
| 12–14 | Task từ nhiệm vụ kỳ tới → Event → Indicator kỳ sau | ✓ (`derive-tasks`) |
| 15 | Audit đầy đủ | ✓ |

Zalo (mục 63): 1–4 ✓ · 5–7, 9–10, 12, 14–15 ✓ · 8 ✓ (deep link web) · 11 ◐ (đăng ký nhóm, chưa gửi được) · 13 ◐ (acknowledgement/XN; Task Draft từ chat chưa).

## 12. Còn lại theo Blueprint (đưa vào GĐ C/D)

1. Kết nối thật: QLVB LGSP (khoá), 1022/IOC, CSDL dân cư/đất đai (REFERENCE), Hệ thống TTHC (API thay file).
2. Document AI bước 2: nhận diện Object/Event từ văn bản, phân loại tài liệu, chunk + citation, RAG có kiểm quyền.
3. AI Assistant theo ngữ cảnh Object (mục 21, 57) khi có LLM cục bộ; Agent (mục 22) sau.
4. GIS/Map View; Zalo Task Draft từ nhóm chính danh; ABAC theo trường.
5. Pilot: chốt T0, Data Inventory thực tế, baseline KPI (mục 7) trước/sau 3–6 tháng.
