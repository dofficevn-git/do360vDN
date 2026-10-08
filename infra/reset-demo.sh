#!/usr/bin/env bash
# Dựng lại bộ demo "Phường Điện Bàn Bắc" từ CSDL trống (< 5 phút): xoá volume → dựng stack → chờ API → seed qua API.
#   bash infra/reset-demo.sh                 # dùng tài khoản bootstrap trong services/api/.env.production
#   SEED_ARGS="--open-period 2026-M09" bash infra/reset-demo.sh
# Yêu cầu: python 3 + openpyxl, python-docx, pymupdf, pyyaml (pip install -r services/reader/requirements.txt đủ).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${API_URL:-http://127.0.0.1:3070/api}"   # 127.0.0.1 thay localhost: Windows tra IPv6 trước, mỗi lệnh chậm ~1 giây
ENV="$ROOT/services/api/.env.production"
EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-$(grep -E '^BOOTSTRAP_ADMIN_EMAIL=' "$ENV" | cut -d= -f2-)}"
PW="${BOOTSTRAP_ADMIN_PASSWORD:-$(grep -E '^BOOTSTRAP_ADMIN_PASSWORD=' "$ENV" | cut -d= -f2-)}"
export PYTHONIOENCODING=utf-8
t0=$(date +%s)
cd "$ROOT/infra"
echo "[1/4] Xoá dữ liệu cũ và dựng lại stack…"
docker compose down -v --remove-orphans >/dev/null
docker compose up -d >/dev/null
echo "[2/4] Chờ API sẵn sàng…"
for i in $(seq 1 90); do
  if curl -fsS -m 5 "${API%/api}/health" >/dev/null 2>&1; then break; fi
  sleep 2
  if [ "$i" = 90 ]; then echo "API không lên sau 3 phút — xem: docker compose logs api"; exit 1; fi
done
echo "[3/4] Seed bộ demo qua API…"
python "$ROOT/tools/seed_demo.py" "$API" "$EMAIL" "$PW" ${SEED_ARGS:-}
echo "[4/4] Xong sau $(( $(date +%s) - t0 )) giây. Mở ${WEB_URL:-http://localhost:3071}/login"
