# Giao diện web DO360 cấp xã — hệ thống thiết kế (06/10/2026)

Nâng cấp theo skill `ui-ux-pro-max` (kiểu "Accessible & Ethical" cho sản phẩm khu vực công: tương phản cao, chữ dễ đọc,
focus rõ, ít chuyển động) kết hợp nguyên tắc `frontend-design` (chọn có chủ đích, một điểm nhấn, không trang trí).

## Chủ thể và việc chính
Công cụ của Văn phòng UBND xã. Người dùng cần nhìn ra **kỳ báo cáo đang ở bước nào** và **còn vướng gì** rồi thao tác
(xác nhận số, chốt kỳ, sinh bản nháp, trình ký). Mọi màn hình phục vụ câu hỏi đó; màu chỉ dành cho trạng thái.

## Token (`apps/web/tailwind.config.ts`, `src/app/globals.css`)
| Nhóm | Giá trị |
|---|---|
| Màu nhận diện | xanh lam công vụ `primary-500 #0F3D6E` (nền dải kỳ, nút chính, mục đang chọn) |
| Nền / bề mặt | canvas `#F4F6F8`, thẻ trắng viền `rule #E2E8F0`, bo 12px, **không bóng** (bóng chỉ cho popover/modal) |
| Chữ | `ink #0F172A` chính, `ink-muted #475569` tối thiểu cho chữ phụ (đạt 4,5:1), `ink-faint #64748B` chỉ cho ghi chú rất nhỏ |
| Trạng thái | xanh lá `#15803D` đạt/duyệt, vàng `#B45309` chờ/cảnh báo, đỏ `#B91C1C` lỗi/cách ly, vàng quốc huy `#C9962B` chỉ cho bước hiện tại trên dải kỳ |
| Cỡ chữ | nền 14px/1.5 (Be Vietnam Pro — bộ chữ Việt); `sm2` 13,5 · `xs2` 12,5 · `2xs` 12 (tối thiểu); tiêu đề trang 22px/700; số lớn 26px dạng bảng (`.kpi-num`) |
| Kích thước | nút và ô nhập cao 40px; mục menu 40px; sidebar 252px (rail 64px); header 56px; nội dung tối đa 1400px |
| Chuyển động | chỉ `fade-in-up` 160ms cho popover/modal và đổi màu 150ms khi hover; tôn trọng `prefers-reduced-motion` |
| Lớp | `z-dropdown 30`, `z-sticky 20`, `z-modal 50` |

## Điểm nhấn duy nhất: dải kỳ báo cáo (`PeriodBand` + `RunStepper`)
Khối xanh đậm ở đầu Tổng quan, Bảng điều hành và trang kỳ: mã kỳ cỡ lớn, ngày chốt, và tiến trình 5 bước
**Thu số → Chốt kỳ → Bản nháp → Trình ký → Đã ký** (bước hiện tại màu vàng, bước xong có dấu tick). Đây là thứ duy nhất
được phép "nặng" về màu; mọi thứ khác phẳng và yên.

## Thành phần (`src/components/ui/admin-ui.tsx`)
`PageHeader` (tiêu đề + dòng ngữ cảnh sentence case), `Panel` (thẻ có tiêu đề, thay div viết tay), `StatTile` (số lớn +
vạch màu trạng thái bên trái, bấm được bằng bàn phím), `Tag` (chấm màu + chữ: không chỉ dựa vào màu), `ToolbarButton`
(40px, `loading`), `FilterTabs` (gạch chân, `role=tab`), `DataTable` (đầu bảng dính, hàng hover), `Callout` (viền trái,
`role=alert/status`), `EmptyState` (có hành động), `LoadingState/Skeleton` (giữ chỗ, không nhảy bố cục), `FormField`
(label bao input), `Modal` (Esc đóng, `aria-modal`), `KeyValue`, `PeriodBand`, `RunStepper`.

Lớp CSS dùng trong trang: `.card`, `.card-head`, `.card-title`, `.row-hover`, `.kpi-num`, `.skeleton`.

## Quy ước viết
- Sentence case, không viết hoa toàn bộ nhãn, không giãn chữ; không thêm "→" sau liên kết.
- Nút ghi đúng hành động ("Chốt kỳ", "Sinh bản nháp .docx", "Trình ký (QLVB)"); thông báo lặp lại đúng động từ.
- Trạng thái trống là lời mời hành động; lỗi nói rõ việc gì hỏng và làm gì tiếp.

## Kiểm trước khi giao (từ checklist của skill)
- [x] Không dùng emoji làm icon (Lucide); hover không làm dịch bố cục; `cursor-pointer` cho phần tử bấm được
- [x] Focus ring 3px toàn cục; nút icon có `aria-label`; modal có `role=dialog`
- [x] Chữ phụ ≥ `#475569`; viền `#E2E8F0` thấy rõ trên nền sáng
- [x] `prefers-reduced-motion` tắt mọi animation
- [x] Trang đăng nhập 1 cột dưới 1024px; bảng cuộn ngang trong thẻ; nội dung không nằm dưới header cố định
- [ ] Chế độ tối: chưa làm (không yêu cầu)

## Trang chủ theo vai (GĐ B)

Đăng nhập xong web gọi `GET /admin/me/work` và mở đúng trang của vai (`me.home`); `/` cũng chuyển hướng như vậy. Menu trái lọc theo `roles` của từng mục (`components/layout/nav-config.ts`, hàm `visibleFor`) và theo `is_data_owner` (người đại diện phòng = `departments.head_admin_id`).

| Vai | Trang chủ | Nội dung |
|---|---|---|
| Văn phòng (`commune_admin`, `super_admin`) | `/dashboard` | Dải kỳ 5 bước, **bảng tiến độ theo bộ phận** (`DeptProgressTable`: số đủ/tổng, còn thiếu/chờ, cách ly, file, lần nhắc, nút Nhắc), tiến độ theo mục, lỗi gate |
| Chủ tịch (`leader`) | `/sign` | Chờ ký → Đọc báo cáo → Ký / Trả lại (QLVB giả lập), kỳ đang chuẩn bị, đã ký, việc tôi giao |
| HĐND (`council`) | `/read` | Chỉ báo cáo đã chốt/ký; đọc trên web, tải bản ký |
| Người đại diện phòng | `/approve` | Chờ tôi duyệt (duyệt hàng loạt), số cách ly (Loại / nộp lại), tiến độ phòng, việc |
| Chuyên viên | `/my` | Chỉ tiêu phòng còn thiếu/chờ theo kỳ mở, lỗi kiểm tra thuộc phòng, cách ly, việc được giao |

Trang dùng chung: `/tasks` (giao việc; "Giao từ nhiệm vụ kỳ tới" tách dòng mục III của báo cáo thành việc có người, có hạn, `source_type=report_run`), `/plans` (kế hoạch năm, nhập Excel), `/files` có ô **Ngày chốt số liệu trong file** (số bóc mang ngày này). Nguyên tắc UX giữ nguyên: nói tiếng cán bộ, mã trong `<TechDetails>`, mỗi số bấm ra nguồn; `tools/check_labels.py` quét các trang mới.

## Điều hướng theo Blueprint V0.5 (mục 60–62)

`nav-config.ts`: Tổng quan/trang chủ theo vai · **Điều hành** (Nhiệm vụ, Văn bản QLVB, Dự án 360) · **Lĩnh vực** (9 trang `/domain/<key>` từ `config/dashboard/domains.yaml`) · **Báo cáo** (kỳ, nộp file, số liệu, kế hoạch năm, KPI) · **Dữ liệu** (Bản đồ dữ liệu, Danh bạ đối tượng, Sức khoẻ dữ liệu, Danh mục chỉ tiêu, Tìm kiếm) · **Quản trị** (người dùng, Zalo/kênh, phòng, nhật ký). Thẻ chỉ tiêu dùng chung `components/work/IndicatorCard.tsx` (Mục tiêu – Thực hiện – Rủi ro – Hành động; bấm số → ngăn Nguồn). Object 360 `/objects/[uid]`: tab Tổng quan, Timeline, Chỉ tiêu, Nhiệm vụ, Tài liệu, Chất lượng & audit; ghi sự kiện và cập nhật thuộc tính tại chỗ. Mini App không còn trong kiến trúc đích.
