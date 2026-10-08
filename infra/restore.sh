#!/usr/bin/env bash
# Khôi phục DO360 từ bản sao lưu của infra/backup.sh.
#   bash infra/restore.sh backups/do360-20261006-0130.dump [backups/minio-20261006-0130.tgz]
# CẢNH BÁO: ghi đè CSDL do360 hiện tại (kho chỉ thêm — chỉ khôi phục khi CSDL hỏng, không dùng để "xoá bớt" dữ liệu).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="${1:?Thiếu file .dump}"; MINIO="${2:-}"
PROJECT="${COMPOSE_PROJECT_NAME:-do360}"
export MSYS_NO_PATHCONV=1
read -r -p "Ghi đè CSDL do360 từ $DUMP ? (gõ YES) " ok; [ "$ok" = "YES" ] || exit 1

cd "$ROOT/infra"
docker compose stop api web
docker exec -i "${PROJECT}_postgres" psql -U postgres -c "DROP DATABASE IF EXISTS do360_restore" -c "CREATE DATABASE do360_restore"
docker exec -i "${PROJECT}_postgres" pg_restore -U postgres -d do360_restore --no-owner < "$DUMP"
docker exec -i "${PROJECT}_postgres" psql -U postgres -c "DROP DATABASE do360" -c "ALTER DATABASE do360_restore RENAME TO do360"
if [ -n "$MINIO" ]; then
  docker compose stop minio
  docker run --rm -v "${PROJECT}_minio_data:/data" -v "$(cd "$(dirname "$MINIO")" && pwd):/backup:ro" alpine sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$MINIO") -C /"
fi
docker compose up -d
echo "[restore] xong — API tự chạy migration còn thiếu khi khởi động."
