#!/usr/bin/env bash
# Tự triển khai: có commit mới trên GitHub (origin/main) → kéo về → build đúng phần đổi → dựng lại → kiểm tra sức khoẻ.
# Chạy định kỳ 5 phút bằng Task Scheduler (đăng ký: powershell -File infra/register-auto-deploy.ps1) hoặc cron:
#   */5 * * * * cd /opt/do360-commune && bash infra/auto-deploy.sh
# Tuỳ chọn: bash infra/auto-deploy.sh --force   (build + dựng lại dù không có commit mới)
# Nhật ký: infra/logs/deploy.log; commit đã triển khai: infra/logs/deployed.sha. Không chạy khi cây làm việc có sửa đổi
# chưa commit (máy dev) — tránh ghi đè việc đang làm; khi đó ghi nhật ký và thoát.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/infra/logs/deploy.log"; SHA_FILE="$ROOT/infra/logs/deployed.sha"; LOCK="$ROOT/infra/logs/deploy.lock"
mkdir -p "$ROOT/infra/logs"
BRANCH="${DEPLOY_BRANCH:-main}"
API="${API_URL:-http://127.0.0.1:3070}"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# khoá chống chạy chồng (build có thể > 5 phút)
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT

cd "$ROOT"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  log "BỎ QUA: cây làm việc có sửa đổi chưa commit — không tự kéo code (commit hoặc stash trước)."; exit 0
fi
if ! git fetch origin "$BRANCH" --quiet 2>>"$LOG"; then log "LỖI: không fetch được origin/$BRANCH"; exit 1; fi
LOCAL="$(git rev-parse HEAD)"; REMOTE="$(git rev-parse "origin/$BRANCH")"; DEPLOYED="$(cat "$SHA_FILE" 2>/dev/null || echo none)"
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1

if [ "$LOCAL" != "$REMOTE" ]; then
  if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then log "BỎ QUA: nhánh máy và origin đã rẽ (local $LOCAL, origin $REMOTE) — cần người xử lý."; exit 1; fi
  if ! git pull --ff-only --quiet origin "$BRANCH" 2>>"$LOG"; then log "LỖI: pull --ff-only thất bại"; exit 1; fi
  log "Kéo về $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
fi
HEAD_NOW="$(git rev-parse HEAD)"
if [ "$HEAD_NOW" = "$DEPLOYED" ] && [ "$FORCE" = 0 ]; then exit 0; fi

# build đúng phần có file đổi so với lần triển khai trước (lần đầu hoặc --force: build tất cả)
SERVICES=""
if [ "$DEPLOYED" = none ] || [ "$FORCE" = 1 ] || ! git cat-file -e "$DEPLOYED" 2>/dev/null; then
  SERVICES="api web reader"
else
  CHANGED="$(git diff --name-only "$DEPLOYED" "$HEAD_NOW")"
  echo "$CHANGED" | grep -q '^services/api/' && SERVICES="$SERVICES api"
  echo "$CHANGED" | grep -q '^apps/web/' && SERVICES="$SERVICES web"
  echo "$CHANGED" | grep -q '^services/reader/' && SERVICES="$SERVICES reader"
  echo "$CHANGED" | grep -q '^infra/docker-compose.yml' && SERVICES="api web reader"
  # config/ được mount vào API: chỉ cần nạp lại danh mục, không build
fi
cd "$ROOT/infra"
if [ -n "$SERVICES" ]; then
  log "Build: $SERVICES"
  if ! docker compose build $SERVICES >> "$LOG" 2>&1; then log "LỖI build ($SERVICES) — giữ nguyên bản đang chạy"; exit 1; fi
fi
if ! docker compose up -d >> "$LOG" 2>&1; then log "LỖI: docker compose up"; exit 1; fi
for i in $(seq 1 60); do curl -fsS -m 5 "$API/health" >/dev/null 2>&1 && break; sleep 3; done
if curl -fsS -m 10 "$API/health" >/dev/null 2>&1; then
  echo "$HEAD_NOW" > "$SHA_FILE"
  log "ĐÃ TRIỂN KHAI $(git rev-parse --short HEAD) (${SERVICES:-không build, chỉ dựng lại}); API OK"
  # danh mục/mẫu báo cáo trong config/ đổi → nạp lại qua API (cần tài khoản bootstrap trong .env.production)
  if git diff --name-only "${DEPLOYED/none/$HEAD_NOW}" "$HEAD_NOW" 2>/dev/null | grep -q '^config/'; then
    ENV="$ROOT/services/api/.env.production"
    EMAIL="$(grep -E '^BOOTSTRAP_ADMIN_EMAIL=' "$ENV" | cut -d= -f2-)"; PW="$(grep -E '^BOOTSTRAP_ADMIN_PASSWORD=' "$ENV" | cut -d= -f2-)"
    TOK="$(curl -s -X POST "$API/api/admin/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
    [ -n "$TOK" ] && curl -s -X POST "$API/api/admin/catalog/reload" -H "Authorization: Bearer $TOK" >/dev/null && log "Đã nạp lại config/ (danh mục, mẫu báo cáo, luật)"
  fi
else
  log "LỖI: API không lên sau triển khai — xem: docker compose logs api"; exit 1
fi
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
