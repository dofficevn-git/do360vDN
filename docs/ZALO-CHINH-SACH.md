# Zalo trong DO360 — chính sách và điều kiện vận hành (theo Blueprint V0.5 mục 46–48, 63, 65–70)

## Ba nguyên tắc
1. **Zalo không quản lý dữ liệu của xã — DO360 quản lý dữ liệu.** Zalo chỉ nhận payload thông báo tối thiểu; CSDL, file gốc, hồ sơ, dữ liệu cá nhân không bao giờ đi qua Zalo.
2. **Zalo không thay thế DO360 — Zalo đưa cán bộ đến đúng việc cần xử lý trên DO360.** Mọi thẻ đều có deep link về web; mở link vẫn đăng nhập và kiểm quyền. Phê duyệt số liệu, sửa dữ liệu, ký/phát hành văn bản chỉ làm trên DO360/hệ thống chính thức.
3. **Không quản lý Zalo cá nhân — chỉ dùng nhóm công vụ chính danh do OA của đơn vị sở hữu.** DO360 không đọc, lưu hay giám sát hội thoại cá nhân.

## Cách bản cài thực thi
- Đăng nhập: Zalo ID là *định danh ngoài* liên kết với tài khoản DO360 do Văn phòng cấp (`admin_users.zalo_follower_id`); vai, phòng, quyền do DO360 quyết định; khoá tài khoản DO360 thì Zalo ID không còn vào được.
- Cổng an toàn (`services/api/src/modules/chat/notification-gateway.ts`, cấu hình `config/notifications/rules.yaml`): chặn CCCD, số điện thoại, email, dấu mật, hồ sơ sức khoẻ, số tài khoản; cắt tin dài; tin bị chặn thay bằng "Có việc cần xử lý, đăng nhập DO360". Nhật ký giữ lý do chặn (`chat_message.gateway`). Thử trên trang *Quản trị → Zalo, kênh tương tác*.
- Tầng thông báo: critical (Zalo cá nhân + nhóm), action (Zalo cá nhân), important (nhóm), info (chỉ trong app), digest (tổng hợp 07:00) — chống "spam điều hành".
- Nhóm chính danh: bảng `interaction_channel` (khoá, phạm vi, thành viên theo vai/phòng, mức nội dung, người phê duyệt). OA cơ quan hành chính hiện **chưa có API nhóm** → tin nhóm ghi nhật ký `skipped` chờ VNG xác nhận.
- Không Mini App trong kiến trúc đích: khu DO360 trên Mini App ZSC đóng băng (không deploy); thẻ chat chỉ trỏ web.

## Điều kiện cần trước Go-Live (mục 67.3) — checklist
- [ ] UBND ban hành Quy chế sử dụng Zalo OA và nhóm điều hành chính danh (mẫu nội dung: mục 68).
- [ ] OA thuộc sở hữu cơ quan (không phải tài khoản cá nhân); admin OA chính thức, bàn giao nhiều lớp.
- [ ] Xác nhận với Zalo/VNG: loại OA cho UBND phường, điều kiện xác thực, GMF/OpenAPI áp dụng, hạn mức, chi phí, điều khoản xử lý dữ liệu, SLA, lưu log.
- [ ] Thỏa thuận dịch vụ + điều khoản xử lý dữ liệu cá nhân (Luật BVDLCN 91/2025/QH15).
- [ ] Hồ sơ cấp độ ATTT cho DO360 bao gồm Zalo Integration Gateway (luồng, API, secret, webhook, log, rate limit, sự cố, phụ thuộc).
- [ ] Ban hành Data Classification & Notification Policy; danh mục dữ liệu tuyệt đối không gửi qua Zalo.
- [ ] Quy định lifecycle thành viên nhóm khi bổ nhiệm, điều chuyển, nghỉ việc.
- [ ] Phương án khi Zalo/API gián đoạn: DO360 Web vận hành độc lập; thông báo giữ pending/retry.
- [ ] Không dùng Zalo làm kênh duy nhất cho thông báo pháp lý bắt buộc.
- [ ] Kiểm tra định kỳ thay đổi điều khoản/API của Zalo.

## Căn cứ cần rà soát khi lập hồ sơ (mục 67.2)
Luật Dữ liệu 60/2024/QH15 · Luật BVDLCN 91/2025/QH15 (hiệu lực 01/01/2026) · Luật An ninh mạng 116/2025/QH15 (01/07/2026) · Luật ATTT mạng 86/2015/QH13 + NĐ 85/2016 · Luật Bảo vệ bí mật nhà nước 117/2025/QH15 (01/03/2026) · Luật Giao dịch điện tử 20/2023/QH15 · quy định văn thư, lưu trữ (tin nhắn không là hồ sơ công việc).
