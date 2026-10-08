# Kịch bản demo 15 phút — Phường Điện Bàn Bắc (bộ dữ liệu demo)

Khán giả: lãnh đạo xã và Văn phòng. Mục tiêu: người của Văn phòng tự đi hết luồng **bộ phận nộp file → số đặt cạnh nguồn → kiểm tra bắt lỗi thật → chốt kỳ → đọc báo cáo trên web (bấm số nào cũng ra nguồn) → Word → trình ký → ký**, không cần ai giải thích mã.

## Chuẩn bị (1 lần, < 5 phút)

```bash
bash infra/reset-demo.sh                 # CSDL trống → stack → seed qua API (~2 phút)
python eval/smoke_demo.py                # khẳng định bộ demo đúng (ĐẠT)
```
Web: https://khodulieu.vn/login (máy dev: http://localhost:3071/login). Trang đăng nhập liệt kê **tài khoản demo**, mật khẩu chung `Demo@2026` (API đặt `DEMO_MODE=1`; tắt trước khi dùng thật). Theo Blueprint V0.5, **không dùng Mini App**: Zalo chỉ đăng nhập và nhận thông báo qua OA (cổng an toàn), mọi thao tác trên web.

| Vai | Tài khoản | Trang chủ khi đăng nhập |
|---|---|---|
| Văn phòng (Chánh VP) | vanphong@dienbanbac.demo | Tổng quan: kỳ đang làm, **bảng tiến độ theo bộ phận**, lỗi cần sửa, nút Nhắc |
| Chủ tịch | chutich@dienbanbac.demo | Bàn ký: chờ ký, đọc báo cáo, ký / trả lại |
| HĐND | hdnd@dienbanbac.demo | Đọc báo cáo (chỉ kỳ đã chốt/ký) |
| Giám đốc TT HCC (Data Owner) | motcua.truong@dienbanbac.demo | Duyệt số của phòng |
| Chuyên viên Một cửa | motcua@dienbanbac.demo | Việc của tôi |
| Công an: cán bộ / Trưởng | congan@ · congan.truong@ | Việc của tôi / Duyệt số |
| Kinh tế: kế toán / Trưởng phòng | kinhte@ · kinhte.truong@ | (Kinh tế **chưa nộp** số tháng — để demo nhắc) |
| Trạm Y tế: Trạm trưởng / nhân viên | yte@ · yte.nv@ | Duyệt số (có 1 số cách ly) / Việc của tôi |

Trạng thái sau seed: **6 tháng 2026** đã ký 301/BC-UBND (15/7); **9 tháng 2026** đã ký **436/BC-UBND** (18/9, chốt 15/9) với 4 lỗi thật trong lịch sử; **tháng liền trước** đang thu số: Một cửa đã nộp (chờ duyệt), Y tế có 1 số cách ly, Công an chờ xác nhận, VH-XH chờ duyệt, Kinh tế chưa nộp (Văn phòng đã nhắc một lượt); 15 việc (5 đã xong, 2 quá hạn, 3 giao từ Nhiệm vụ kỳ tới); KPI 9 tháng đã tính, Chủ tịch duyệt.

## Sáu bước (15 phút)

**1. Chủ tịch mở app (2′)** — đăng nhập `chutich@`. Bàn ký: chờ ký 0, hai báo cáo đã ký, việc quá hạn. Bấm **Bảng điều hành** → chọn kỳ tháng đang mở: độ phủ theo lĩnh vực, Kinh tế chưa có số. *Câu chốt: lãnh đạo nhìn thấy ai nợ số trước khi hỏi Văn phòng.*

**2. Văn phòng nhìn tiến độ (2′)** — `vanphong@`. Tổng quan: dải kỳ 5 bước, **Tiến độ theo bộ phận**: Kinh tế "Chưa nộp" (đã nhắc 1), Một cửa 5 chờ duyệt, Công an 7 chờ xác nhận, Y tế 1 cách ly. Bấm **Nhắc các bộ phận còn thiếu** → thẻ nhắc ghi nhật ký (tới máy khi có Zalo). Kiểm tra chất lượng nói bằng câu: "Chưa có số: Tổng thu ngân sách… — Phòng Kinh tế nộp file".

**3. Bộ phận nộp file, lỗi thật bị chặn (4′)** — `congan@`. **Việc của tôi**: 7 số sổ tiếp dân chờ xác nhận, mỗi số cạnh nguồn (sheet!ô). Xác nhận lần lượt → đủ. Rồi mở **Số liệu kỳ** → Nhập tay `Đơn thư đã giải quyết` = 84 (cố tình sai) → hệ thống **CÁCH LY**: "Đã giải quyết 84 nhưng khiếu nại + tố cáo + kiến nghị = 9". Đổi sang `congan.truong@` → **Duyệt số của phòng**: thấy số cách ly, bấm **Loại** (lý do), chọn 7 số → **Duyệt**. *Câu chốt: số sai không vào được báo cáo; sửa là thêm phiên bản, bản cũ còn trong lịch sử.*

Lịch sử thật của 9 tháng (mở `Số liệu kỳ` → 9 tháng 2026 → bấm số **88** đơn → ngăn Nguồn → "Các phiên bản"): bản Word ghi **84** bị cách ly vì cả hai phép kiểm sai (84 + 11 đang xử lý = 95 ≠ 99; 41 + 4 = 45 ≠ 84), bản Excel sổ tiếp dân 88 thay thế. Nếu hai nguồn **cùng bậc** mâu thuẫn, số mới cũng vào cách ly và người đại diện phòng phải **quyết trong 2 ngày làm việc** (nút *Chấp nhận số này* / *Loại*, lý do ghi nhật ký). Ngày chốt: sáu mốc khác nhau từ 16/8 (Quân sự) đến 18/9 (Văn phòng), mỗi mốc một lý do ngoại lệ thành chú thích cuối trang. Tương tự **352,732 tỷ** thu NSNN: bản PDF "352.732 tỷ" (dấu chấm) bị đánh dấu mơ hồ (tin cậy 60%), bản sổ kế toán Excel thay thế — đúng ví dụ "352.732 tỷ bên cạnh 304,252 tỷ" của tài liệu thiết kế.

**4. Văn phòng chốt kỳ, biên tập lời dẫn, bị bắt "6 tháng" (3′)** — `vanphong@`, mở kỳ tháng → **Đọc báo cáo**: văn bản dựng từ số hiện hành ("Kỳ chưa chốt"). Mục I lời dẫn → **Biên tập lời dẫn** → **Dùng lời kỳ trước** (đã đổi tên kỳ tự động) → sửa tay thêm "…trong 6 tháng đầu năm…" → Lưu: cảnh báo *Nhất quán kỳ*; gõ thêm một con số lạ (vd 1.234) → **bị chặn**: "số không có trong bộ số của kỳ". Gate còn lỗi Kinh tế → nút **Chốt kỳ** mờ, lý do hiện ngay. (Nếu muốn chốt: đăng nhập `kinhte@` nộp `config/templates/forms/bieu-mau-kinh-te.xlsx` đã điền, `kinhte.truong@` duyệt.)

**5. Trình ký → Chủ tịch ký → kỳ khoá (2′)** — dùng kỳ 9 tháng để xem kết quả: Đọc báo cáo 436/BC-UBND, 3 phần, 19 mục; bấm **17.206** → nguồn: file xuất Hệ thống TTHC, sheet Tổng hợp!C5, chốt 12/9, ngoại lệ ngày chốt có lý do (chú thích cuối trang); bấm **đạt 115,9% kế hoạch** (thu NSNN 352,732 / dự toán 304,252 tỷ) → kế hoạch theo NQ 15/NQ-HĐND; thẻ **Thu nội địa 72,491 / 100,4 tỷ** báo *Cần theo dõi*; **Tải Word** (chú thích cuối trang, bảng tổng hợp). Thử `Số liệu kỳ` → 9 tháng → nhập tay bất kỳ số nào → **từ chối: kỳ đã ký**. *Câu chốt: cái thấy trên web = cái ký; đã ký thì không ai sửa được.*

**6. HĐND đọc, giao việc, KPI (2′)** — `hdnd@`: chỉ thấy 2 báo cáo đã ký, mở 436, bấm số ra nguồn; vào kỳ đang thu → bị từ chối. `chutich@` → **Giao việc** → **Giao từ nhiệm vụ kỳ tới** (mục III báo cáo 9 tháng → chọn dòng → người → hạn). **KPI cán bộ** 9 tháng: điểm theo việc đúng hạn, văn bản đúng hạn, chất lượng số liệu; bằng chứng là mã việc/văn bản/số.

## Bước mở rộng theo Blueprint V0.5 (thêm 5′ nếu khán giả là đội kỹ thuật/Sở)

**7. Bảng điều hành theo lĩnh vực** — `chutich@` → **Bảng điều hành**: khối *Việc cần xử lý* (nhiệm vụ quá hạn, chỉ tiêu thiếu, dự án cảnh báo, nguồn quá hạn, số chờ/cách ly) rồi 9 lĩnh vực; thẻ **Thu NSNN 352,732 / 304,252 tỷ · 116% · Đạt**, thẻ **Thu nội địa 72% · Cần theo dõi**, thẻ **HKD tiếp cận CĐS 344/442 = 77,8%** → bấm *Danh sách đối tượng*.

**8. Dự án 360** — *Điều hành → Dự án, công trình 360*: 14 dự án, DA-002 *Kè Phong Nhị* cảnh báo *Có vướng mắc* (3 hộ GPMB) → mở **360**: thuộc tính (tổng mức, kế hoạch vốn, giải ngân cộng dồn từ sự kiện, GPMB 71%), quan hệ (nhà thầu, địa bàn), timeline (phê duyệt → khởi công → GPMB → giải ngân), 2 văn bản gắn (QĐ 118, CV 2210), việc gắn dự án. Thử **Thêm dự án** tên "Cty TNHH Xây dựng Điện Bàn" ở loại Tổ chức → hệ thống báo trùng (đối soát định danh).

**9. Bản đồ dữ liệu và Sức khoẻ dữ liệu** — *Dữ liệu → Bản đồ dữ liệu*: nguồn nào Thành phố đã có (QLVB, TTHC, dân cư — tham chiếu), nguồn nào phường tạo; bấm "17.206" ở *Tổng hợp một cửa* → lineage; bấm *tác động* của "Thu chi ngân sách" → 7 chỉ tiêu, mẫu báo cáo, khối điều hành bị ảnh hưởng. *Sức khoẻ dữ liệu*: 6 chỉ số đúng–đủ–sạch–sống–thống nhất–dùng chung của kỳ đang mở; bấm **Đủ** → thấy Kinh tế chưa nộp → **Nhắc cập nhật**.

**10. Zalo đúng vai** — *Quản trị → Zalo, kênh tương tác*: dán "CCCD 048090001234" vào ô thử → cổng chặn, Zalo chỉ nhận "có việc cần xử lý"; bấm **Tạo tổng hợp đầu ngày**; 4 nhóm chính danh đã đăng ký (chờ VNG cấp API nhóm cho OA cơ quan).

## Checklist 10 câu (người ngoài đội tự trả lời sau demo, mục tiêu ≥ 8/10)

1. Kỳ tháng đang ở bước nào trong 5 bước? *(dải kỳ)*
2. Bộ phận nào đang nợ số, nợ gì? *(bảng tiến độ theo bộ phận)*
3. Con số 17.206 lấy từ đâu, ô nào, chốt ngày nào? *(bấm số → ngăn Nguồn)*
4. Vì sao số 84 bị chặn? *(câu kiểm tra số học: 41 + 4 ≠ 84)*
5. Sửa số có mất bản cũ không? *(các phiên bản trong ngăn Nguồn)*
6. Chữ "6 tháng" trong báo cáo 9 tháng bị bắt ở đâu? *(cảnh báo Nhất quán kỳ cạnh đoạn)*
7. Các bộ phận chốt ngày khác nhau thì xử lý sao? *(Văn phòng ghi lý do → chú thích cuối trang)*
8. Máy có bịa số vào lời dẫn được không? *(số lạ bị chặn khi lưu lời dẫn)*
9. Ai duyệt, ai chốt, ai ký? *(người đại diện phòng → Văn phòng → Chủ tịch; nhật ký)*
10. Báo cáo đã ký có sửa được không? *(nộp số vào kỳ đã ký bị từ chối)*

## Đo sau demo

```bash
python eval/measure_demo.py        # mã kỹ thuật lộ, phút mở kỳ → trình ký, 4/4 lỗi bị chặn, 5 KPI dự án → eval/out/demo-measure.json
```
Mốc làm tay tháng 10 (Văn phòng tự tổng hợp như cũ, ghi số giờ) dùng để tính −70% thời gian tổng hợp.

## Đổi bộ demo

Số liệu: `config/demo/dien-ban-bac/numbers.yaml`; tài khoản: `accounts.yaml`; văn bản/lịch/việc/lời dẫn: `documents.yaml`. Đổi xong chạy lại `infra/reset-demo.sh`. Mã ĐVHC tạm `DBB01` đặt ở `services/api/.env.production` (`DEFAULT_TENANT_ID`), đổi khi có mã thật.
