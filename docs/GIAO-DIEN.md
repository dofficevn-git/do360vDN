# Năm giao diện cần chốt trước khi chia việc (bản đề xuất v0.1 — chờ anh duyệt)

Tài liệu thiết kế Tami360 (03/10/2026) yêu cầu chốt 5 giao diện giữa các module. Dưới đây là đề xuất cụ thể;
giao diện 1, 2 (phần Excel), 3 đã có code chạy và test (`eval/smoke_d1.py`), 4 và 5 mới là đặc tả.

---

## 1. T3 → D1: bản ghi `extracted`

Mọi nguồn (bóc từ file, form, API) đều nộp số qua **một** cửa: `POST /api/admin/facts/ingest`.

```jsonc
{
  "channel": "web",                 // web | zalo | tammi | api
  "records": [{
    "indicator_id": "tthc.tiep_nhan",   // phải có trong dim_indicator
    "period": "2026-9M",                // 2026-M09 | 2026-Q3 | 2026-6M | 2026-9M | 2026-Y
    "as_of_date": "2026-09-15",         // ngày chốt số
    "value": 17206,                     // đã chuẩn hoá về đơn vị gốc (đồng, hồ sơ, %)
    "breakdown": {},                    // phân tổ, vd {"to_dan_pho":"TDP01"}; rỗng = tổng
    "capture_method": "export",         // api | export | pdf_text | ocr | form
    "confidence": 0.98,                 // 0..1; form = 1
    "source_ref": {                     // truy vết tới đúng chỗ trong nguồn
      "file_id": 12, "sheet": "Tổng hợp", "cell": "C5",   // Excel
      "page": 3, "bbox": [102, 340, 188, 362],            // PDF/ảnh
      "snippet": "tiếp nhận 17.206 hồ sơ",
      "rule": "mot_cua_tong_hop_xlsx@1"
    }
  }]
}
```

Quy tắc phía D1 (đã cài, `services/api/src/modules/facts/facts.service.ts`):
- Luôn vào trạng thái `extracted`. Tabot/người nhập **không** ghi thẳng số đã duyệt.
- Kỳ đã chốt (`locked`) → từ chối.
- Nộp lại y hệt (cùng giá trị + ngày chốt) → không thêm dòng.
- Nguồn bậc thấp (vd `ocr`) lệch số đã xác nhận của nguồn bậc cao (vd `export`) → vào `quarantined`, không đè.
- Sửa số = thêm `version + 1` (dòng cũ giữ nguyên, chuyển `rejected` kèm lý do). CSDL có trigger cấm UPDATE giá trị/nguồn và cấm DELETE.
- Luồng: `extracted → confirmed` (chuyên viên) `→ approved` (Data Owner của phòng) `→ locked` (Văn phòng chốt kỳ).
- Phân quyền: cán bộ phòng chỉ nộp/xác nhận/duyệt chỉ tiêu có `owner_dept` = phòng mình.

## 2. D2 → T3: định dạng bộ luật bóc tách

File `config/extract-rules/<source_type>.yaml`, bất biến theo `(source_type, version)`; T3 lấy luật hiệu lực qua
`GET /api/admin/catalog/extract-rules`. Một file luật = một loại nguồn.

```yaml
source_type: mot_cua_tong_hop_xlsx
version: 1
file_kind: xlsx            # xlsx | docx | pdf_text | image
domain: tthc               # tài khoản gửi thuộc lĩnh vực nào thì chỉ thử luật của lĩnh vực đó
match:                     # nhận loại tài liệu — phải khớp hết mới áp luật
  sheet: "Tổng hợp"
  header_contains: "Trong kỳ"
map:                       # (a) ánh xạ ô/cột — Excel theo biểu mẫu
  - {row: "Tổng số hồ sơ tiếp nhận", column: "Trong kỳ", indicator: tthc.tiep_nhan}
sentences:                 # (b) mẫu câu — Word, PDF có lớp chữ
  - pattern: "tiếp nhận {tiep_nhan:number} hồ sơ"
    groups: {tiep_nhan: tthc.tiep_nhan}
regions:                   # (c) mẫu vùng — ảnh màn hình, biểu mẫu scan (toạ độ tương đối 0..1)
  - {anchor: "Hồ sơ quá hạn", offset: right, indicator: tthc.qua_han}
labels:                    # (d) từ điển nhãn — các cách ghi khác nhau của cùng một dòng
  "Đã giải quyết": ["Đã trả kết quả", "Đã giải quyết xong"]
period:                    # lấy kỳ + ngày chốt từ đâu (mặc định: kỳ người nộp chọn, ngày chốt = ngày nộp)
  as_of_from: {cell: "B2", format: "dd/MM/yyyy"}
```

(e) Chuẩn hoá số kiểu Việt Nam là hàm dùng chung, không khai trong luật: `17.206` → 17206; `253,515 tỷ đồng` → 253515000000;
`96,3%` → 96.3. Gặp chuỗi mơ hồ (`352.732 tỷ` — dấu chấm là phân nghìn hay thập phân?) thì **không đoán**: hạ `confidence` và bắt người xác nhận.

Luật không khớp → **không đoán**: file ghi `no_rule`, cán bộ nhận thẻ form để điền tay.

## 3. D2 → D4: Report Spec và khuôn câu

File `config/report-specs/<spec_code>.yaml`, bất biến theo `(spec_code, version)`.

```yaml
spec_code: ktxh_dinh_ky
version: 1
report_type: ktxh
title: Báo cáo tình hình kinh tế - xã hội, quốc phòng - an ninh
period_types: [month, quarter, half, nine_months, year]
template_file: ktxh_dinh_ky.docx        # khung văn bản NĐ 30/2020 trong config/templates/
slots:
  - slot_id: tthc.mot_cua.tong_hop
    section: "II.3.4"
    slot_type: metric_sentence          # metric_sentence | metric_table | event_list | narrative | next_tasks | static
    indicators: [tthc.tiep_nhan, tthc.giai_quyet, tthc.truoc_han, tthc.qua_han, tthc.dang_xu_ly]
    template: >
      đã tiếp nhận {tthc.tiep_nhan} hồ sơ; giải quyết {tthc.giai_quyet} hồ sơ, …
    checks:                             # phép kiểm số học → Quality Gate nhóm "Số học"
      - tthc.truoc_han + tthc.qua_han == tthc.giai_quyet
    owner_dept: hanh_chinh_cong
    required: true                      # thiếu số đã duyệt thì không chốt kỳ được (nhóm "Đầy đủ")
```

Khuôn câu: biến `{indicator_id}` render theo `value_type` + `unit` của chỉ tiêu (số nguyên có dấu chấm phân nghìn; tiền đổi
tỷ/triệu đồng với dấu phẩy thập phân; tỷ lệ `{a/b:%}` tính bằng code). Biến đặc biệt: `{ky}` = "9 tháng đầu năm 2026",
`{ngay_chot}`. Slot `narrative` (lời dẫn) ở bước 1 lấy đoạn văn bộ phận gửi + khuôn câu; bước 2 mới dùng mô hình ngôn ngữ
và **mọi con số trong lời dẫn phải khớp snapshot** (hậu kiểm).

## 4. D1 → D4: snapshot bộ số đã khoá của một kỳ

Khi Văn phòng chốt kỳ, `report_run.fact_snapshot` đóng băng:

```jsonc
{
  "tenant_id": "…", "period": "2026-9M", "cutoff_date": "2026-09-15", "spec": "ktxh_dinh_ky@1",
  "locked_at": "2026-09-18T08:00:00+07:00", "locked_by": 3,
  "facts": {
    "tthc.tiep_nhan": { "fact_id": "101", "value": 17206, "unit": "hồ sơ", "as_of_date": "2026-09-15",
                        "capture_method": "export", "source_ref": {…}, "approved_by": 7 }
  },
  "events": [ { "event_id": "55", "object_id": "253/KH-UBND", "event_date": "2026-09-08", "domain": "…", "payload": {…} } ],
  "exceptions": [ { "indicator_id": "y_te.luot_kham", "as_of_date": "2026-08-31", "reason": "Trạm Y tế chốt theo tháng" } ]
}
```

Bộ sinh báo cáo (D4) **chỉ đọc snapshot**, không truy vấn kho sống → tái lập được đúng bản đã ký. Chỉ tiêu có ngày chốt
khác `cutoff_date` phải nằm trong `exceptions` kèm lý do (nhóm kiểm tra "Ngày chốt").

## 5. T1 ↔ V1: kênh chat (`ChatChannel`)

Một interface, hai bản cài: Zalo OA (dùng ngay, qua OA + Mini App của ZSC) và Tammi (khi Viettel mở API).
Nghiệp vụ (T4) chỉ gọi interface.

```ts
interface ChatChannel {
  /** Gửi thẻ có nút bấm (xác nhận số, điền form, nhắc hạn). Trả về id tin để cập nhật sau. */
  sendCard(to: StaffRef, card: Card): Promise<{ messageId: string }>;
  sendText(to: StaffRef, text: string): Promise<void>;
  /** Tải file cán bộ gửi vào chat về để lưu Bronze. */
  downloadAttachment(ref: AttachmentRef): Promise<{ buffer: Buffer; name: string; mime: string }>;
  /** Đổi tài khoản chat ↔ cán bộ + bộ phận (ánh xạ lưu ở admin_users). */
  resolveStaff(channelUserId: string): Promise<StaffRef | null>;
}
type InboundEvent =
  | { type: 'file';   from: StaffRef; attachment: AttachmentRef; text?: string }
  | { type: 'action'; from: StaffRef; cardId: string; action: 'confirm' | 'edit' | 'reject'; payload?: unknown }
  | { type: 'text';   from: StaffRef; text: string };
interface Card { title: string; lines: string[]; actions: { id: string; label: string }[]; deepLink?: string }
```

Cần Viettel xác nhận API Tammi có: nhận file/ảnh từ người dùng OA, gửi thẻ có nút bấm (callback), gửi tin chủ động (nhắc hạn),
ánh xạ tài khoản. Zalo OA không có thẻ nút bấm tuỳ biến cho tin chủ động → bản Zalo dùng tin văn bản + liên kết mở màn
xác nhận trên web/Mini App (`deepLink`).

**Đã cài (06/10/2026):** `services/api/src/modules/chat/` — `chat-channel.ts` (interface trên), `zalo-channel.ts` (Zalo OA), `chat.service.ts` (Tabot: nhận file, lệnh, nhắc, thẻ cách ly). Trên Zalo thẻ được gửi dưới dạng tin văn bản `[DO360] <title>` + các dòng + liên kết `WEB_PUBLIC_URL`; nút bấm thay bằng lệnh trả lời:

| Lệnh cán bộ gõ | Tác dụng |
|---|---|
| gửi file (kèm mã kỳ, vd `2026-Q3`) | lưu Bronze → bóc tách → thẻ xác nhận; không ghi kỳ thì lấy kỳ duy nhất đang thu số |
| `XN <mã>` | xác nhận số (qua Quality Gate số học; sai → cách ly) |
| `SUA <mã> = <số> [lý do]` | sửa số = thêm phiên bản mới đã xác nhận |
| `LOAI <mã> <lý do>` | loại số |
| `NHAP <mã chỉ tiêu> = <số> [kỳ] [dd/mm/yyyy]` | thẻ form: nhập số không có file (vào kho ở `extracted`, nguồn form, bậc 5) |
| `TIEN DO` | chỉ tiêu phòng mình còn thiếu trong các kỳ đang mở |
| `HELP` | hướng dẫn |

Tin khác (không phải lệnh) được trả về luồng cũ của ZSC (đăng nhập QR, INVITE). Mọi tin ra/vào ghi bảng `chat_message`; giả lập tin đến: `POST /admin/chat/inbound`.


**Mini App (06/10/2026):** thẻ chat có `deepLink` mở thẳng khu Số liệu báo cáo trên Mini App ZSC khi API có `MINIAPP_ID` (`https://zalo.me/s/<id>/do360-facts?period=…`); không có thì mở web. Màn trên Mini App: `/do360` (hub + chỉ tiêu thiếu), `/do360-facts` (xác nhận/sửa/loại/duyệt/nhập tay), `/do360-upload` (openMediaPicker → `POST /public/do360/upload?token=&period=`).

## 6. D5: `QlvbAdapter`

```ts
interface QlvbAdapter {
  fetchDocuments(direction: 'den' | 'di', start: string, end: string): Promise<QlvbDoc[]>;   // sổ văn bản
  fetchSchedule(start: string, end: string): Promise<ScheduleItem[]>;                           // lịch công tác → sự kiện họp MTG
  submitForSignature(input: { tenant_id; run_id; title; docx: Buffer; file_name; signer?; recipients? }): Promise<{ external_id }>;
  getSignStatus(tenantId, externalId): Promise<{ status: 'pending' | 'signed' | 'rejected'; so_ky_hieu?; ngay_ky?; signed_file?: Buffer | null }>;
}
```
Bản cài: `lgsp-qlvb.adapter.ts` (trục LGSP Đà Nẵng, chỉ đọc) và `sim-qlvb.adapter.ts` (`QLVB_MODE=sim`). Phân loại lĩnh vực văn bản: `config/event-rules/qlvb_domain.yaml`.

## 7. D6: giao diện dữ liệu KPI

| Chiều | Điểm cuối | Dữ liệu |
|---|---|---|
| DO360 → module KPI | `GET /admin/kpi/employees`, `GET /admin/kpi/export/tasks?period` | `dim_employee`; việc theo cán bộ: task_id, source, source_ref, assignee (email), assigned_by, due_date, done_date, status |
| module KPI → DO360 | `POST /admin/kpi/scores/import` `{rows:[{employee_code, period, criterion_id, value, score?, evidence_ref?, status?}]}` | điểm đã duyệt (mặc định `approved`) |
| DO360 tự tính | `POST /admin/kpi/compute {period}` | điểm **đề xuất** theo `config/kpi/criteria.yaml` |
| Báo cáo KPI | `POST /admin/kpi/publish {period}` | 3 chỉ tiêu `kpi.*` vào kho → Report Spec `kpi_dinh_ky` |

## 8. Kênh Tammi và quyết số cách ly (bản thiết kế 03/10 đã sửa)

- Tabot chạy trong Tammi OA: `modules/chat/tammi-channel.ts` cài sẵn giao diện `ChatChannel` (sendCard, sendText, downloadAttachment, resolveStaff); chọn bằng `CHAT_CHANNEL=tammi`, cấu hình `TAMMI_API_URL`, `TAMMI_API_TOKEN` khi Viettel mở API V1. Kênh Zalo giữ làm bản tạm.
- Hai nguồn cùng bậc mâu thuẫn → bản ghi mới vào `quarantined` kèm hạn 2 ngày làm việc; Data Owner gọi `POST /admin/facts/:id/resolve {decision: accept|reject, reason}`; accept chạy lại phép kiểm số học, thay số hiện hành, số cũ `rejected`, mọi bước có `fact_status_log` + audit.
- Nạp Object từ bảng danh sách: `POST /admin/objects/import` (multipart `file`, `object_type`); gói lĩnh vực: `GET /admin/catalog/package/:domain`.
