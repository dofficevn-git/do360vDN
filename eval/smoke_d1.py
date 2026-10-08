# -*- coding: utf-8 -*-
"""Kiểm chứng GĐ1 (D1 + D2): chạy với API đang bật.
   python eval/smoke_d1.py http://localhost:3097/api admin@do360.local <mật khẩu>
Kiểm: nạp cấu hình, nộp bộ số một cửa của Báo cáo 436 (9 tháng 2026), luồng extracted → confirmed → approved,
sửa số = thêm phiên bản, nguồn bậc thấp không đè nguồn bậc cao, nộp trùng file, phân quyền theo phòng."""
import json, sys, urllib.request, uuid

API, EMAIL, PW = sys.argv[1], sys.argv[2], sys.argv[3]
FAILS = []

def call(method, path, body=None, token=None, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None)
    req = urllib.request.Request(API + path, method=method, data=data)
    if raw is None: req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in (headers or {}).items(): req.add_header(k, v)
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read()
            return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode("utf-8", "replace")
        try: return e.code, json.loads(t)
        except Exception: return e.code, t

def check(name, cond, detail=""):
    print(("  OK   " if cond else "  FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond: FAILS.append(name)

def login(email, pw):
    st, d = call("POST", "/admin/auth/login", {"email": email, "password": pw})
    assert st in (200, 201), (st, d)
    return d["access_token"]

tok = login(EMAIL, PW)

print("1. Nạp cấu hình")
st, r = call("POST", "/admin/catalog/reload", token=tok)
check("reload không lỗi", st in (200, 201) and not r["errors"], str(r))
st, inds = call("GET", "/admin/catalog/indicators?domain=tthc", token=tok)
check("có 6 chỉ tiêu tthc (5 một cửa + tỷ lệ trực tuyến)", len(inds) == 6, str(len(inds)))
st, r2 = call("POST", "/admin/catalog/reload", token=tok)
check("nạp lại: spec/luật bất biến theo version (bỏ qua)", r2["specs"]["created"] == [] and r2["rules"]["created"] == [], str(r2))

PERIOD = "2026-9M"
NUMS = {"tthc.tiep_nhan": 17206, "tthc.giai_quyet": 17007, "tthc.truoc_han": 16979, "tthc.qua_han": 28, "tthc.dang_xu_ly": 199}

print("2. Nộp số (export) — luôn vào extracted")
recs = [{"indicator_id": k, "period": PERIOD, "as_of_date": "2026-09-15", "value": v, "capture_method": "export",
         "source_ref": {"sheet": "Tổng hợp", "cell": "C%d" % (i + 5)}} for i, (k, v) in enumerate(NUMS.items())]
# cố ý bóc sai 1 số: quá hạn 23 thay vì 28 (lỗi một chữ số kiểu OCR)
recs[3]["value"] = 23
st, out = call("POST", "/admin/facts/ingest", {"records": recs}, token=tok)
check("ingest 5 bản ghi", st in (200, 201) and len(out) == 5 and all(o["status"] == "extracted" for o in out), str(out))
ids = {o["indicator_id"]: o["fact_id"] for o in out}
st, again = call("POST", "/admin/facts/ingest", {"records": recs}, token=tok)
check("nộp lại y hệt: không thêm dòng", all(o["fact_id"] == ids[o["indicator_id"]] for o in again), str(again))

print("3. Sửa số = thêm phiên bản")
st, fixed = call("POST", f"/admin/facts/{ids['tthc.qua_han']}/correct", {"value": 28, "reason": "Bóc nhầm 28 thành 23"}, token=tok)
check("correct tạo version 2, confirmed", st in (200, 201) and fixed["version"] == 2 and fixed["status"] == "confirmed", str(fixed))
st, h = call("GET", f"/admin/facts/history?indicator_id=tthc.qua_han&period={PERIOD}", token=tok)
vs = h["versions"]
check("lịch sử giữ cả 2 phiên bản, bản cũ rejected còn nguyên giá trị 23",
      len(vs) == 2 and float(vs[0]["value"]) == 23 and vs[0]["status"] == "rejected" and float(vs[1]["value"]) == 28, str(vs))
st, e = call("POST", f"/admin/facts/{ids['tthc.qua_han']}/confirm", token=tok)
check("không xác nhận được phiên bản cũ", st == 400, str(e))

print("4. Xác nhận → duyệt")
for k, fid in ids.items():
    if k == "tthc.qua_han": continue
    st, c = call("POST", f"/admin/facts/{fid}/confirm", token=tok)
    check(f"confirm {k}", st in (200, 201) and c["status"] == "confirmed", str(c))
st, cur = call("GET", f"/admin/facts?period={PERIOD}", token=tok)
check("bộ số hiện hành đúng 5 số của Báo cáo 436", {r["indicator_id"]: int(r["value"]) for r in cur} == NUMS, str(cur))
check("phép kiểm slot: 16.979 + 28 = 17.007 và 17.007 + 199 = 17.206",
      NUMS["tthc.truoc_han"] + NUMS["tthc.qua_han"] == NUMS["tthc.giai_quyet"] and NUMS["tthc.giai_quyet"] + NUMS["tthc.dang_xu_ly"] == NUMS["tthc.tiep_nhan"])
st, e = call("POST", "/admin/facts/approve", {"ids": [ids["tthc.qua_han"]]}, token=tok)
check("không duyệt được bản đã bị thay", st == 400, str(e))
cur_ids = [r["id"] for r in cur]
st, ap = call("POST", "/admin/facts/approve", {"ids": cur_ids}, token=tok)
check("approve 5 số", st in (200, 201) and ap["approved"] == 5, str(ap))

print("5. Nguồn bậc thấp không đè nguồn bậc cao")
st, q = call("POST", "/admin/facts/ingest", {"records": [{"indicator_id": "tthc.tiep_nhan", "period": PERIOD, "as_of_date": "2026-09-15",
             "value": 17260, "capture_method": "ocr", "confidence": 0.81}]}, token=tok)
check("số OCR lệch số export đã duyệt → quarantined", q[0]["status"] == "quarantined", str(q))
st, cur = call("GET", f"/admin/facts?period={PERIOD}", token=tok)
check("số hiện hành vẫn là 17.206", {r["indicator_id"]: int(r["value"]) for r in cur}["tthc.tiep_nhan"] == 17206)
st, qz = call("GET", "/admin/facts/quarantine", token=tok)
check("vùng Quarantine có bản ghi", any(float(x["value"]) == 17260 for x in qz), str(len(qz)))

print("6. Kiểm tra đầu vào")
st, e = call("POST", "/admin/facts/ingest", {"records": [{"indicator_id": "khong.co", "period": PERIOD, "as_of_date": "2026-09-15", "value": 1, "capture_method": "form"}]}, token=tok)
check("chỉ tiêu ngoài danh mục → 400", st == 400, str(e))
st, e = call("POST", "/admin/facts/ingest", {"records": [{"indicator_id": "tthc.tiep_nhan", "period": "9 tháng", "as_of_date": "2026-09-15", "value": 1, "capture_method": "form"}]}, token=tok)
check("mã kỳ sai → 400", st == 400, str(e))
st, e = call("POST", "/admin/facts/ingest", {"records": [{"indicator_id": "tthc.tiep_nhan", "period": "2026-M10", "as_of_date": "2026-10-31", "value": 12.5, "capture_method": "form"}]}, token=tok)
check("số hồ sơ không nguyên → 400", st == 400, str(e))

print("7. Bronze: nộp file, chặn trùng")
def upload(content, name):
    b = "----do360" + uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"period\"\r\n\r\n{PERIOD}\r\n"
            f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode("utf-8") + content + f"\r\n--{b}--\r\n".encode()
    return call("POST", "/admin/files", raw=body, token=tok, headers={"Content-Type": f"multipart/form-data; boundary={b}"})
blob = ("thử nghiệm " + uuid.uuid4().hex).encode("utf-8")
st, f1 = upload(blob, "tong-hop-mot-cua.xlsx")
check("nộp file lần 1", st in (200, 201) and f1["duplicate"] is False, str(f1))
st, f2 = upload(blob, "ten-khac.xlsx")
check("nộp lại cùng nội dung → duplicate, cùng id", st in (200, 201) and f2["duplicate"] is True and f2["file"]["id"] == f1["file"]["id"], str(f2))
st, e = upload(b"x", "virus.exe")
check("đuôi file lạ → 400", st == 400, str(e))

print("8. Phân quyền theo phòng")
st, u = call("POST", "/admin/users", {"email": f"vhxh-{uuid.uuid4().hex[:6]}@do360.local", "password": "Thu@Nghiem2026", "full_name": "Cán bộ VHXH thử",
             "role": "department_staff", "department": "van_hoa_xa_hoi", "is_active": True}, token=tok)
if st in (200, 201):
    st2, me = call("GET", "/admin/users", token=tok)
    tok2 = None
    try: tok2 = login(u["email"], "Thu@Nghiem2026")
    except AssertionError as ex: check("đăng nhập cán bộ phòng khác", False, str(ex))
    if tok2:
        st, mine = call("GET", f"/admin/facts?period={PERIOD}", token=tok2)
        check("cán bộ phòng VHXH không thấy số một cửa", st == 200 and mine == [], str(mine)[:200])
        st, e = call("POST", "/admin/facts/ingest", {"records": [{"indicator_id": "tthc.tiep_nhan", "period": "2026-M10", "as_of_date": "2026-10-31", "value": 5, "capture_method": "form"}]}, token=tok2)
        check("cán bộ phòng khác nộp số một cửa → 403", st == 403, str(e))
else:
    check("tạo tài khoản phòng khác", False, str(u))

print()
print("KẾT QUẢ:", "ĐẠT" if not FAILS else f"CÒN {len(FAILS)} LỖI: {FAILS}")
sys.exit(1 if FAILS else 0)
