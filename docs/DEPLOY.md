# Triển khai DO360 cấp xã qua Cloudflare Tunnel (06/10/2026)

Máy chạy: máy dev hiện tại (Windows), stack Docker `do360` (xem `infra/docker-compose.yml`). Đưa ra Internet bằng
Cloudflare Tunnel đã có của tên miền `khodulieu.vn` (dịch vụ Windows `cloudflared`, tunnel `3eda566d-…`).

## Tên miền

| Tên miền | Trỏ tới | Dùng cho |
|---|---|---|
| `https://khodulieu.vn` (+ `www`) | `http://localhost:3071` | Web Văn phòng DO360 — đăng nhập tại `/login` |
| `https://api.khodulieu.vn` | `http://localhost:3070` | API DO360 (`/api/...`, `/health`), webhook OA, Mini App, LGSP callback |
| `do360-api/do360-admin.khodulieu.vn` | `localhost:8080` | **ZSC v2 (Xã Thành Công)** — tên cũ, giữ nguyên, không phải DO360 cấp xã |
| `vuthu-*.khodulieu.vn` | chưa có trên tunnel | Vũ Thư |

Không đưa ra ngoài: Postgres 5462, MinIO 9110/9111, reader 3072 (chỉ bind 127.0.0.1).

## Cloudflare

- DNS: `cloudflared tunnel route dns 3eda566d-6b35-43bc-bc81-ac9fc1d10f9b <hostname>` (đã chạy cho `khodulieu.vn`,
  `www`, `api` — tạo CNAME proxied tới tunnel). Bản ghi `api.khodulieu.vn` đã có sẵn từ trước và cùng tunnel.
- Ingress: sửa `C:\Users\HieuPC\.cloudflared\config.yml` rồi **chép sang** cấu hình của dịch vụ
  `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` (cần quyền admin — UAC) và `Restart-Service cloudflared`.
  Hai file phải giống nhau; dịch vụ chỉ đọc file trong `systemprofile`. Bản sao lưu: `config.yml.bak-20261006` cùng thư mục.
- Cloudflare chấm dứt TLS; origin là HTTP nội bộ. Không cần chứng chỉ trên máy.

## Cấu hình ứng dụng đã đổi theo tên miền

| File | Khoá | Giá trị |
|---|---|---|
| `services/api/.env.production` | `CORS_ORIGINS` | `https://khodulieu.vn,https://www.khodulieu.vn,https://h5.zdn.vn,https://zalo.me,http://localhost:3071` |
| | `WEB_PUBLIC_URL` | `https://khodulieu.vn` (liên kết trong thẻ chat) |
| | `MINIAPP_ID` | để trống cho tới khi `zmp deploy` bản Mini App có khu DO360; khi đó điền App ID của Mini App ZSC |
| `apps/web/.env.production` | `NEXT_PUBLIC_API_URL` | `https://api.khodulieu.vn/api` (**nướng lúc build** → đổi là phải `docker compose build web`) |
| `infra/.env` | `NEXT_PUBLIC_API_URL` | như trên (chỉ để nhất quán) |
| `zalo-smart-commune-v2/apps/miniapp/.env.production` | `VITE_DO360_API_URL` | `https://api.khodulieu.vn/api` (áp dụng khi build Mini App) |

Sau khi đổi env: `cd infra && docker compose up -d --force-recreate api web` (env_file chỉ đọc lúc tạo container).

## Tự triển khai từ GitHub

Repo: https://github.com/dofficevn-git/do360vDN (nhánh `main`). Máy chạy kiểm tra GitHub mỗi 5 phút bằng `infra/auto-deploy.sh`
(Task Scheduler "DO360 auto-deploy", đăng ký một lần: `powershell -ExecutionPolicy Bypass -File infraegister-auto-deploy.ps1`):

1. `git fetch`; có commit mới → `git pull --ff-only` (cây làm việc có sửa đổi chưa commit thì bỏ qua, ghi nhật ký — máy dev không bị ghi đè).
2. Build đúng dịch vụ có file đổi (`services/api` → api, `apps/web` → web, `services/reader` → reader; `config/` chỉ nạp lại danh mục qua API, không build).
3. `docker compose up -d`, chờ `/health`; OK thì ghi commit đã triển khai vào `infra/logs/deployed.sha`. Build lỗi → giữ bản đang chạy.
4. Nhật ký `infra/logs/deploy.log`. Ép build lại toàn bộ: `bash infra/auto-deploy.sh --force`.

Quy trình làm việc: sửa code → commit → `git push` (từ máy này hoặc máy khác) → tối đa 5 phút sau bản mới chạy tại https://khodulieu.vn.
Migration CSDL chạy tự động khi API khởi động. Muốn triển khai ngay: `bash infra/auto-deploy.sh`.

## Việc còn lại trước khi dùng thật

1. **Đổi mật khẩu** tài khoản khởi tạo `admin@do360.local` ngay (web → Tài khoản). Mật khẩu demo nằm trong `.env.production`.
2. Zalo cho DO360 (đăng nhập cán bộ trên Mini App, thẻ chat): DO360 và ZSC dùng **cùng một OA** nhưng Zalo xoay vòng
   refresh token — hai dịch vụ cùng refresh sẽ làm nhau mất token. Chưa cấu hình `ZALO_*` trên DO360 vì lý do này;
   cần quyết định: (a) tạo OA/app riêng cho DO360, hoặc (b) DO360 lấy access token từ ZSC qua một điểm nội bộ, hoặc
   (c) chỉ một bên giữ refresh token và bên kia được dán access token tay mỗi ngày.
3. Webhook OA của DO360 (nếu tách OA): `https://api.khodulieu.vn/api/public/zalo/webhook`.
4. Sao lưu và giám sát: đăng ký `infra/backup.sh`, `infra/healthcheck.sh` vào Task Scheduler (xem đầu file).
5. Máy dev không phải hạ tầng cơ quan nhà nước — bước GĐ7 vẫn phải chuyển stack (compose + volume) sang máy chủ chính thức.
