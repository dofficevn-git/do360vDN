#!/usr/bin/env bash
# Giám sát DO360: kiểm 5 container + 3 điểm cuối; hỏng thì `docker compose up -d` dựng lại; ghi infra/logs/health.log.
# Máy dev này từng rớt Docker (Postgres rời mạng, trùng cổng) → chạy mỗi 5 phút:
#   Windows Task Scheduler: "C:\Program Files\Git\bin\bash.exe" -lc "cd /d/MiniApp/do360-commune && bash infra/healthcheck.sh"
#   cron: */5 * * * * cd /opt/do360-commune && bash infra/healthcheck.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/infra/logs/health.log"; mkdir -p "$ROOT/infra/logs"
PROJECT="${COMPOSE_PROJECT_NAME:-do360}"
API="${API_URL:-http://localhost:3070}"; READER="${READER_URL_HOST:-http://localhost:3072}"; WEB="${WEB_URL:-http://localhost:3071}"
cd "$ROOT/infra"
bad=()
for c in postgres minio reader api web; do
  st="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "${PROJECT}_$c" 2>/dev/null || echo missing)"
  case "$st" in running*healthy*|"running ") ;; running*starting*) ;; *) bad+=("$c:$st") ;; esac
done
curl -fsS -m 10 "$API/health" >/dev/null 2>&1 || bad+=("api-http")
curl -fsS -m 10 "$READER/health" >/dev/null 2>&1 || bad+=("reader-http")
curl -fsS -m 15 -o /dev/null "$WEB/login" 2>/dev/null || bad+=("web-http")
now="$(date '+%Y-%m-%d %H:%M:%S')"
if [ ${#bad[@]} -eq 0 ]; then
  echo "$now OK" >> "$LOG"; exit 0
fi
echo "$now LỖI: ${bad[*]} → docker compose up -d" >> "$LOG"
docker compose up -d >> "$LOG" 2>&1
sleep 20
curl -fsS -m 10 "$API/health" >/dev/null 2>&1 && echo "$now đã dựng lại, API OK" >> "$LOG" || echo "$now API vẫn lỗi sau khi dựng lại — kiểm tra: docker compose logs api" >> "$LOG"
# log giữ 2000 dòng cuối
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 1
