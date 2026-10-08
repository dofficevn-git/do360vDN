#!/usr/bin/env bash
# Sao lưu DO360: Postgres (pg_dump định dạng custom) + MinIO (tar volume) vào <repo>/backups/, giữ 14 bản gần nhất.
# Chạy tay:  bash infra/backup.sh
# Lịch:      Windows Task Scheduler → "C:\Program Files\Git\bin\bash.exe" -lc "cd /d/MiniApp/do360-commune && bash infra/backup.sh"
#            Linux cron → 30 1 * * * cd /opt/do360-commune && bash infra/backup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/backups"; KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
PROJECT="${COMPOSE_PROJECT_NAME:-do360}"
mkdir -p "$OUT"
export MSYS_NO_PATHCONV=1

echo "[backup] Postgres → do360-$STAMP.dump"
docker exec "${PROJECT}_postgres" pg_dump -U postgres -d do360 -Fc > "$OUT/do360-$STAMP.dump"

echo "[backup] MinIO (bronze + báo cáo) → minio-$STAMP.tgz"
docker run --rm -v "${PROJECT}_minio_data:/data:ro" -v "$OUT:/backup" alpine sh -c "tar czf /backup/minio-$STAMP.tgz -C / data"

echo "[backup] Cấu hình (config/, .env) → config-$STAMP.tgz"
tar czf "$OUT/config-$STAMP.tgz" -C "$ROOT" config infra/.env services/api/.env.production apps/web/.env.production 2>/dev/null || true

# giữ KEEP bản mỗi loại
for prefix in do360- minio- config-; do
  ls -1t "$OUT"/${prefix}* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done
du -sh "$OUT" | sed 's/^/[backup] tổng dung lượng: /'
echo "[backup] xong $(date '+%d/%m/%Y %H:%M')"
