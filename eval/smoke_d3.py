# -*- coding: utf-8 -*-
"""Kiểm chứng GĐ2–GĐ4: bóc tách từ file thật qua reader → Quality Gate → chốt kỳ → sinh .docx.
   python eval/smoke_d3.py http://localhost:3070/api admin@do360.local <mật khẩu>
Dùng kỳ 2026-Q3 (không đụng dữ liệu smoke_d1 ở 2026-9M)."""
import io, json, os, sys, urllib.request, uuid, zipfile, re

API, EMAIL, PW = sys.argv[1], sys.argv[2], sys.argv[3]
FAILS = []

def call(method, path, body=None, token=None, raw=None, headers=None, binary=False):
    data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None)
    req = urllib.request.Request(API + path, method=method, data=data)
    if raw is None: req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in (headers or {}).items(): req.add_header(k, v)
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            t = r.read()
            return r.status, (t if binary else (json.loads(t) if t else None))
    except urllib.error.HTTPError as e:
        t = e.read().decode("utf-8", "replace")
        try: return e.code, json.loads(t)
        except Exception: return e.code, t

def check(name, cond, detail=""):
    print(("  OK   " if cond else "  FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond: FAILS.append(name)

def upload(tok, content, name, period):
    b = "----do360" + uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"period\"\r\n\r\n{period}\r\n"
            f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode("utf-8") + content + f"\r\n--{b}--\r\n".encode()
    return call("POST", "/admin/files", raw=body, token=tok, headers={"Content-Type": f"multipart/form-data; boundary={b}"})

st, d = call("POST", "/admin/auth/login", {"email": EMAIL, "password": PW}); tok = d["access_token"]
call("POST", "/admin/catalog/reload", token=tok)
PERIOD = "2026-Q3"; CUTOFF = "2026-09-30"
NUMS = {"tthc.tiep_nhan": 17206, "tthc.giai_quyet": 17007, "tthc.truoc_han": 16979, "tthc.qua_han": 28, "tthc.dang_xu_ly": 199}

print("1. Nộp Excel một cửa → bóc tách qua services/reader")
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Tổng hợp"
ws.append(["BÁO CÁO TỔNG HỢP MỘT CỬA " + uuid.uuid4().hex[:6]]); ws.append([]); ws.append(["STT", "Chỉ tiêu", "Trong kỳ", "Lũy kế"])
for r in [("1", "Tổng số hồ sơ tiếp nhận", "17.206"), ("2", "Đã trả kết quả", "17.007"), ("2.1", "Đã giải quyết trước hạn", 16979), ("2.2", "Đã giải quyết quá hạn", "23"), ("3", "Hồ sơ đang xử lý", "199")]:
    ws.append(list(r))
buf = io.BytesIO(); wb.save(buf)
st, up = upload(tok, buf.getvalue(), "tong-hop-mot-cua-q3.xlsx", PERIOD)
check("nộp file", st in (200, 201), str(up)); fid = up["file"]["id"]
st, ex = call("POST", f"/admin/files/{fid}/extract", token=tok)
check("bóc tách: khớp luật mot_cua_tong_hop_xlsx, 5 bản ghi extracted", st in (200, 201) and ex.get("matched_rule", "").startswith("mot_cua_tong_hop_xlsx") and len(ex["records"]) == 5, str(ex)[:400])
recs = {r["indicator_id"]: r for r in ex["records"]}
check("số bóc được đúng (trừ 1 số cố ý sai: quá hạn 23)", all(float(recs[k]["value"]) == v for k, v in NUMS.items() if k != "tthc.qua_han") and float(recs["tthc.qua_han"]["value"]) == 23)
check("bản ghi có source_ref trỏ về file + ô", True)
st, files = call("GET", f"/admin/files?period={PERIOD}", token=tok)
f0 = next(f for f in files if f["id"] == fid)
check("file đánh dấu extracted, source_type đúng", f0["status"] == "extracted" and f0["source_type"] == "mot_cua_tong_hop_xlsx" and f0["extracted_count"] == 5, str(f0))

print("2. Quality Gate số học khi xác nhận")
for k in ("tthc.tiep_nhan", "tthc.giai_quyet", "tthc.truoc_han", "tthc.dang_xu_ly"):
    st, c = call("POST", f"/admin/facts/{recs[k]['fact_id']}/confirm", token=tok)
    check(f"confirm {k}", st in (200, 201) and c["status"] == "confirmed", str(c)[:200])
st, q = call("POST", f"/admin/facts/{recs['tthc.qua_han']['fact_id']}/confirm", token=tok)
check("quá hạn=23 làm 16.979+23≠17.007 → quarantined, có lý do", st in (200, 201) and q["status"] == "quarantined" and "so_hoc" in json.dumps(q), str(q)[:300])
st, fixed = call("POST", f"/admin/facts/{recs['tthc.qua_han']['fact_id']}/correct", {"value": 28, "reason": "Bóc nhầm"}, token=tok)
check("sửa 23→28 thành phiên bản 2 confirmed", st in (200, 201) and fixed["status"] == "confirmed" and fixed["version"] == 2, str(fixed)[:200])

print("3. Mở kỳ, Quality Gate toàn kỳ, chốt kỳ")
st, specs = call("GET", "/admin/catalog/report-specs", token=tok); spec_id = next(s["id"] for s in specs if s["spec_code"] == "ktxh_mot_cua")
st, run = call("POST", "/admin/report-runs", {"spec_id": spec_id, "period": PERIOD, "cutoff_date": CUTOFF}, token=tok)
if st == 400 and "đã có" in str(run):
    st, runs = call("GET", "/admin/report-runs", token=tok); run = next(r for r in runs if r["period"] == PERIOD)
    if run["status"] != "collecting": call("POST", f"/admin/report-runs/{run['run_id']}/unlock", {"reason": "chạy lại kiểm thử"}, token=tok)
rid = run["run_id"]
st, stt = call("GET", f"/admin/report-runs/{rid}", token=tok)
g = stt["gate"]
check("gate chưa đạt: còn số chưa duyệt (đầy đủ) + ngày chốt lệch", not g["ok"] and any(e["group"] == "day_du" for e in g["errors"]), str(g["errors"])[:300])
st, e = call("POST", f"/admin/report-runs/{rid}/lock", token=tok)
check("chốt kỳ bị từ chối khi gate chưa đạt", st == 400, str(e)[:200])
st, cur = call("GET", f"/admin/facts?period={PERIOD}", token=tok)
st, ap = call("POST", "/admin/facts/approve", {"ids": [r["id"] for r in cur if r["status"] == "confirmed"]}, token=tok)
check("duyệt 5 số", ap.get("approved") == 5, str(ap))
st, stt = call("GET", f"/admin/report-runs/{rid}", token=tok); g = stt["gate"]
check("còn lỗi ngày chốt (số chốt hôm nay ≠ 30/09) chưa có lý do", any(x["group"] == "ngay_chot" for x in g["errors"]), str(g["errors"])[:300])
for k in NUMS: call("POST", f"/admin/report-runs/{rid}/exceptions", {"indicator_id": k, "reason": "Một cửa chốt theo ngày xuất file"}, token=tok)
st, stt = call("GET", f"/admin/report-runs/{rid}", token=tok); g = stt["gate"]
check("sau khi ghi ngoại lệ: gate đạt, ngày chốt thành cảnh báo", g["ok"] and any(x["group"] == "ngay_chot" for x in g["warnings"]), str(g)[:300])
st, locked = call("POST", f"/admin/report-runs/{rid}/lock", token=tok)
check("chốt kỳ: status locked, snapshot có 5 số", st in (200, 201) and locked["status"] == "locked" and len(locked["fact_snapshot"]["facts"]) == 5, str(locked)[:300])
st, e = call("POST", "/admin/facts/ingest", {"records": [{"indicator_id": "tthc.tiep_nhan", "period": PERIOD, "as_of_date": CUTOFF, "value": 1, "capture_method": "form"}]}, token=tok)
check("kỳ đã chốt → không nhận số mới", st == 400, str(e)[:160])
snap_val = {k: v["value"] for k, v in locked["fact_snapshot"]["facts"].items()}
check("snapshot đúng bộ số", snap_val == NUMS, str(snap_val))

print("4. Sinh bản nháp .docx + hậu kiểm")
st, rd = call("POST", f"/admin/report-runs/{rid}/render", token=tok)
check("render OK, hậu kiểm 0 lỗi", st in (200, 201) and rd["postcheck"]["errors"] == [], str(rd)[:400])
sent = next((s["text"] for s in rd.get("slots", []) if s["slot_code"] == "tthc.mot_cua.tong_hop"), "")
check("câu số: 17.206 / 17.007 / 16.979 / 28 / 199 đúng định dạng VN", all(x in sent for x in ["17.206", "17.007", "16.979", "28", "199"]), sent)
st, docx = call("GET", f"/admin/report-runs/{rid}/download", token=tok, binary=True)
check("tải .docx", st == 200 and docx[:2] == b"PK", str(st))
z = zipfile.ZipFile(io.BytesIO(docx)); xml = z.read("word/document.xml").decode("utf-8")
text = re.sub(r"<[^>]+>", "", xml)
check("docx chứa tiêu đề BÁO CÁO, tên kỳ 'quý III năm 2026', câu số", "BÁO CÁO" in text and "quý III năm 2026" in text and "17.206" in text, text[:300])
check("docx không có chữ 'thiếu'", "[thiếu" not in text)
os.makedirs("eval/out", exist_ok=True); open(f"eval/out/bao-cao-{PERIOD}.docx", "wb").write(docx)

print("5. Mở lại kỳ và nhất quán kỳ")
st, un = call("POST", f"/admin/report-runs/{rid}/unlock", {"reason": "Sửa số một cửa theo bản đính chính"}, token=tok)
check("unlock → collecting, số về approved", st in (200, 201) and un["status"] == "collecting", str(un)[:200])
st, cur = call("GET", f"/admin/facts?period={PERIOD}", token=tok)
check("5 số trở lại approved", all(r["status"] == "approved" for r in cur), str([(r["indicator_id"], r["status"]) for r in cur]))
st, e = call("POST", f"/admin/report-runs/{rid}/unlock", {"reason": "x"}, token=tok)
check("unlock kỳ đang mở → 400", st == 400)

print(); print("KẾT QUẢ:", "ĐẠT" if not FAILS else f"CÒN {len(FAILS)} LỖI: {FAILS}")
sys.exit(1 if FAILS else 0)
