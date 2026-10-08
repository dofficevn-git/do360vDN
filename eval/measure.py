# -*- coding: utf-8 -*-
"""Đo 5 KPI dự án (mục tiêu trong tài liệu thiết kế) từ dữ liệu thật trong kho — gọi GET /admin/dashboard/project-kpis.
   python eval/measure.py http://localhost:3070/api admin@do360.local <mật khẩu> [2026-Q3 2026-M08 ...]
Không có kỳ → đo trên toàn bộ dữ liệu của đơn vị. Kết quả in bảng + ghi eval/out/project-kpis.json để so giữa các đợt."""
import json, os, sys, urllib.request

API, EMAIL, PW = sys.argv[1], sys.argv[2], sys.argv[3]
PERIODS = sys.argv[4:] or [""]

def call(method, path, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + path, method=method, data=data)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token: req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b"null")

tok = call("POST", "/admin/auth/login", {"email": EMAIL, "password": PW})["access_token"]
TARGET = {"ty_le_bac_1_3": (">=", 60), "slot_tu_dien": (">=", 80), "so_boc_khong_can_sua": (">=", 95), "loi_doi_soat_lot_ban_ky": ("==", 0), "thoi_gian_tong_hop_gio": ("<=", None)}
LABEL = {"ty_le_bac_1_3": "Chỉ tiêu ở bậc 1–3 (API/export/PDF chữ) %", "slot_tu_dien": "Slot số tự điền (không nhập tay) %", "so_boc_khong_can_sua": "Số bóc tự động không cần sửa %",
         "loi_doi_soat_lot_ban_ky": "Lỗi đối soát lọt bản ký (số)", "thoi_gian_tong_hop_gio": "Thời gian tổng hợp: file đầu → chốt kỳ (giờ)"}
out = {}
for p in PERIODS:
    k = call("GET", f"/admin/dashboard/project-kpis?period={p}", token=tok)
    out[p or "all"] = k
    print(f"\n== Kỳ {p or 'toàn bộ'} ==")
    for key, label in LABEL.items():
        v = k["kpis"].get(key); op, tgt = TARGET[key]
        ok = "" if v is None or tgt is None else ("  ✓" if (v >= tgt if op == ">=" else v == tgt) else "  ✗ (mục tiêu %s %s)" % (op, tgt))
        print(f"  {label:<52} {('—' if v is None else v):>8}{ok}")
    print("  cỡ mẫu:", json.dumps(k["samples"], ensure_ascii=False))
os.makedirs(os.path.join(os.path.dirname(__file__), "out"), exist_ok=True)
json.dump(out, io_ := open(os.path.join(os.path.dirname(__file__), "out", "project-kpis.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1); io_.close()
