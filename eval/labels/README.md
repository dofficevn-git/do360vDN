# Nhãn huấn luyện Tabot (theo thiết kế 03/10, mục "Quy trình huấn luyện Tabot")

Thư mục này chứa nhãn xuất từ vận hành bằng `python tools/export_labels.py <api> <email> <mật khẩu> eval/labels`. Không commit dữ liệu thật vào repo công khai.

| File | Nhãn | Nguồn | Dùng cho |
|---|---|---|---|
| `extraction.jsonl` | câu/ô gốc → giá trị cán bộ đã xác nhận (có cờ `corrected` khi bóc sai phải sửa) | `fact_indicator` phiên bản từ file + trạng thái cuối confirmed/approved/locked | Bước 2 Tabot: LLM bóc tự do với ví dụ gần nhất; tinh chỉnh khi ≥ 2.000–3.000 mẫu mà vẫn dưới ngưỡng |
| `domain.jsonl` | trích yếu văn bản → lĩnh vực | `qlvb_document.domain` (luật + người sửa) | Phân loại sự kiện theo lĩnh vực |
| `narrative.jsonl` | (câu số đã khoá + sự kiện của mục) → đoạn lời dẫn trong **báo cáo đã ký** | `report_run.fact_snapshot.narratives` của kỳ `signed` | Viết lời dẫn (chỉ sau khi có ≥ 1.000 cặp từ nhiều xã) |

Bộ đánh giá cố định (không bao giờ dùng để huấn luyện) đặt riêng ở `eval/private/` (200–300 tài liệu có nhãn chỉ tiêu, 500 trích yếu, 50–100 mục báo cáo đã ký). Ba điều không làm: không huấn luyện khi chưa có bộ đánh giá; không dùng số chưa qua người xác nhận; không để mô hình viết lời tự sinh con số.
