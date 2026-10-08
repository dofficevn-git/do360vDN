# -*- coding: utf-8 -*-
"""Dựng bộ dữ liệu demo "Phường Điện Bàn Bắc" QUA API (không INSERT thẳng) — kể câu chuyện của Văn phòng xã:
   3 kỳ (6 tháng đã ký 301/BC-UBND, 9 tháng đã ký 436/BC-UBND với 4 lỗi thật bị chặn rồi sửa, tháng đang thu số),
   7 bộ phận, 13 tài khoản theo vai, kế hoạch năm, số cùng kỳ 2025, sổ văn bản QLVB giả lập, lịch họp, việc giao, KPI.

   python tools/seed_demo.py http://localhost:3070/api admin@do360.local <mật khẩu> [--open-period 2026-M09] [--set dien-ban-bac]

Chạy trên CSDL MỚI (kho chỉ thêm): infra/reset-demo.sh làm trọn (down -v → up → seed). Dữ liệu nguồn: config/demo/<set>/*.yaml.
Mọi số đi qua đúng đường của cán bộ: nộp file → bóc tách → xác nhận → Data Owner duyệt → Văn phòng ngoại lệ/chốt → Word → trình ký → ký."""
import argparse, datetime as dt, io, json, os, sys, time, urllib.request, uuid
import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ap = argparse.ArgumentParser()
ap.add_argument('api'); ap.add_argument('email'); ap.add_argument('password')
ap.add_argument('--open-period', default=None, help='kỳ tháng đang thu số (mặc định: tháng liền trước hôm nay)')
ap.add_argument('--set', default='dien-ban-bac')
ap.add_argument('--skip-sign', action='store_true', help='không ký giả lập (để demo trình ký tay)')
A = ap.parse_args()
API = A.api.rstrip('/')
CFG = os.path.join(ROOT, 'config', 'demo', A.set)
ACC = yaml.safe_load(io.open(os.path.join(CFG, 'accounts.yaml'), encoding='utf-8'))
NUM = yaml.safe_load(io.open(os.path.join(CFG, 'numbers.yaml'), encoding='utf-8'))
DOC = yaml.safe_load(io.open(os.path.join(CFG, 'documents.yaml'), encoding='utf-8'))
OBJ = yaml.safe_load(io.open(os.path.join(CFG, 'objects.yaml'), encoding='utf-8')) if os.path.exists(os.path.join(CFG, 'objects.yaml')) else {}
PW = ACC['password']
TODAY = dt.date.today()
if A.open_period:
    OPEN = A.open_period
else:
    first = TODAY.replace(day=1); prev = first - dt.timedelta(days=1)
    OPEN = f"{prev.year}-M{prev.month:02d}"
OPEN_END = (lambda y, m: dt.date(y + (m == 12), (m % 12) + 1, 1) - dt.timedelta(days=1))(int(OPEN[:4]), int(OPEN[6:]))
T0 = time.time()

def log(msg): print(f"[{time.time() - T0:5.1f}s] {msg}", flush=True)

class Fail(Exception): pass

# ───────── HTTP ─────────
def call(method, path, body=None, token=None, ok=(200, 201), quiet=False):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, method=method, data=data)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            t = r.read(); return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode('utf-8', 'replace')
        try: body = json.loads(t)
        except Exception: body = t
        if ok and e.code not in ok and not quiet:
            raise Fail(f"{method} {path} → {e.code}: {str(body)[:400]}")
        return e.code, body

def upload(path, token, content, name, fields):
    b = '----do360' + uuid.uuid4().hex
    parts = b''
    for k, v in fields.items():
        parts += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode('utf-8')
    parts += (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode('utf-8') + content + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(API + path, method='POST', data=parts)
    req.add_header('Content-Type', f'multipart/form-data; boundary={b}'); req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise Fail(f"upload {name} → {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")

TOKENS = {}
def tok(who):
    """who = 'admin' | khoá tài khoản (phần trước @)"""
    if who in TOKENS: return TOKENS[who]
    email, pw = (A.email, A.password) if who == 'admin' else (next(a['email'] for a in ACC['accounts'] if a['email'].split('@')[0] == who), PW)
    st, d = call('POST', '/admin/auth/login', {'email': email, 'password': pw})
    TOKENS[who] = d['access_token']; return TOKENS[who]

def head_of(dept): return next(a['email'].split('@')[0] for a in ACC['accounts'] if a.get('head_of') == dept)
def staff_of(dept):
    s = [a['email'].split('@')[0] for a in ACC['accounts'] if a.get('department') == dept and not a.get('head_of')]
    return s[0] if s else head_of(dept)

# ───────── sinh file nguồn ─────────
import openpyxl
from openpyxl import Workbook

def vn_date(iso): return '/'.join(reversed(iso.split('-')))

def bieu_mau(dept, period, as_of, values):
    """Điền BIỂU MẪU EXCEL CHUẨN của bộ phận (config/templates/forms) — luật bieu_mau_<dept>_xlsx bóc 100%."""
    p = os.path.join(ROOT, 'config', 'templates', 'forms', f"bieu-mau-{dept.replace('_', '-')}.xlsx")
    wb = openpyxl.load_workbook(p); ws = wb.active
    ws['A1'] = f"UBND {ACC['unit'].upper()}"; ws['D3'] = period; ws['D4'] = vn_date(as_of)
    hdr = next(r for r in range(1, 15) if ws.cell(row=r, column=2).value == 'Mã chỉ tiêu')
    n = 0
    for r in range(hdr + 1, ws.max_row + 1):
        code = ws.cell(row=r, column=2).value
        if code in values: ws.cell(row=r, column=5).value = values[code]; n += 1
    buf = io.BytesIO(); wb.save(buf)
    return buf.getvalue(), n

def mot_cua_export(period, values, title_suffix):
    """File tổng hợp xuất từ Hệ thống thông tin giải quyết TTHC (luật mot_cua_tong_hop_xlsx)."""
    wb = Workbook(); ws = wb.active; ws.title = 'Tổng hợp'
    ws.append([f"BÁO CÁO TỔNG HỢP TÌNH HÌNH GIẢI QUYẾT TTHC — {title_suffix}"]); ws.append([f"Đơn vị: UBND {ACC['unit']}"]); ws.append([])
    ws.append(['STT', 'Chỉ tiêu', 'Trong kỳ', 'Lũy kế', 'Ghi chú'])
    rows = [('1', 'Tổng số hồ sơ tiếp nhận', values['tthc.tiep_nhan']), ('2', 'Đã trả kết quả', values['tthc.giai_quyet']), ('2.1', 'Đã giải quyết trước hạn', values['tthc.truoc_han']),
            ('2.2', 'Đã giải quyết quá hạn', values['tthc.qua_han']), ('3', 'Hồ sơ đang xử lý', values['tthc.dang_xu_ly'])]
    for r in rows: ws.append([r[0], r[1], r[2], r[2], ''])
    if 'tthc.ty_le_truc_tuyen' in values: ws.append(['4', 'Tỷ lệ hồ sơ trực tuyến', f"{values['tthc.ty_le_truc_tuyen']}%", f"{values['tthc.ty_le_truc_tuyen']}%", ''])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

def so_tiep_dan(values, title_suffix):
    wb = Workbook(); ws = wb.active; ws.title = 'Tổng hợp'
    ws.append([f"SỔ TIẾP CÔNG DÂN, XỬ LÝ ĐƠN THƯ — {title_suffix}"]); ws.append([f"Công an {ACC['unit']} — xuất từ phần mềm quản lý đơn thư"]); ws.append([])
    ws.append(['STT', 'Nội dung', 'Trong kỳ', 'Lũy kế'])
    rows = [('Lượt tiếp công dân', 'tiep_dan.luot_tiep'), ('Đơn thư tiếp nhận', 'tiep_dan.don_tiep_nhan'), ('Đơn thư đã giải quyết', 'tiep_dan.don_da_giai_quyet'),
            ('Khiếu nại đã giải quyết', 'tiep_dan.gq_khieu_nai'), ('Tố cáo đã giải quyết', 'tiep_dan.gq_to_cao'), ('Kiến nghị, phản ánh đã giải quyết', 'tiep_dan.gq_kien_nghi'), ('Đơn thư đang xử lý', 'tiep_dan.don_dang_xu_ly')]
    for i, (lab, k) in enumerate(rows, 1): ws.append([i, lab, values[k], values[k]])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

def cong_an_word(values, period_label):
    from docx import Document
    d = Document()
    d.add_paragraph(f"CÔNG AN {ACC['unit'].upper()}")
    d.add_paragraph(f"BÁO CÁO công tác tiếp công dân, giải quyết đơn thư {period_label}")
    d.add_paragraph(f"Trong kỳ, Công an phường đã tiếp {values['tiep_dan.luot_tiep']} lượt công dân; tiếp nhận {values['tiep_dan.don_tiep_nhan']} đơn thư, "
                    f"đã giải quyết {values['tiep_dan.don_da_giai_quyet']} đơn (gồm {values['tiep_dan.gq_khieu_nai']} khiếu nại, {values['tiep_dan.gq_to_cao']} tố cáo, "
                    f"{values['tiep_dan.gq_kien_nghi']} kiến nghị, phản ánh), đang xử lý {values['tiep_dan.don_dang_xu_ly']} đơn.")
    d.add_paragraph("Tình hình an ninh trật tự trên địa bàn cơ bản ổn định.")
    buf = io.BytesIO(); d.save(buf); return buf.getvalue()

def fmt_ty(v, sep=','):
    s = f"{v / 1e9:.3f}".rstrip('0').rstrip('.')
    return s.replace('.', sep)

def tai_chinh_pdf(values, period_label):
    """Báo cáo PDF của Phòng Kinh tế: 'Tổng chi ngân sách 253.515 tỷ đồng' viết DẤU CHẤM → bộ đọc đánh dấu mơ hồ (lỗi thật số 2)."""
    lines = [f"UBND {ACC['unit'].upper()} — PHÒNG KINH TẾ, HẠ TẦNG VÀ ĐÔ THỊ",
             f"BÁO CÁO tình hình thu, chi ngân sách {period_label}",
             f"1. Tổng thu ngân sách trên địa bàn {fmt_ty(values['tai_chinh.thu_ns'], '.')} tỷ đồng, trong đó thu nội địa {fmt_ty(values['tai_chinh.thu_noi_dia'])} tỷ đồng; ngân sách phường được hưởng {fmt_ty(values['tai_chinh.thu_ns_xa_huong'])} tỷ đồng.",
             f"2. Tổng chi ngân sách {fmt_ty(values['tai_chinh.chi_ns'])} tỷ đồng, gồm chi thường xuyên {fmt_ty(values['tai_chinh.chi_thuong_xuyen'])} tỷ đồng và chi đầu tư phát triển {fmt_ty(values['tai_chinh.chi_dau_tu'])} tỷ đồng.",
             "3. Các khoản chi bảo đảm đúng chế độ, tiêu chuẩn, định mức."]
    try:
        import pymupdf
        font = next((f for f in [r'C:\Windows\Fonts\times.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'] if os.path.exists(f)), None)
        if not font: raise RuntimeError('no unicode font')
        pdf = pymupdf.open(); page = pdf.new_page(); page.insert_font(fontname='vn', fontfile=font)
        y = 70
        for ln in lines:
            page.insert_text((50, y), ln, fontsize=10, fontname='vn'); y += 22
        return pdf.tobytes(), 'bao-cao-ngan-sach.pdf'
    except Exception as err:
        from docx import Document
        d = Document()
        for ln in lines: d.add_paragraph(ln)
        buf = io.BytesIO(); d.save(buf); return buf.getvalue(), 'bao-cao-ngan-sach.docx'

def so_ke_toan(values, title_suffix):
    wb = Workbook(); ws = wb.active; ws.title = 'Thu chi'
    ws.append([f"TỔNG HỢP THU CHI NGÂN SÁCH — {title_suffix}"]); ws.append([f"UBND {ACC['unit']} — xuất từ phần mềm kế toán (đơn vị: đồng)"]); ws.append([])
    ws.append(['STT', 'Nội dung', 'Dự toán', 'Thực hiện', 'Tỷ lệ'])
    rows = [('Tổng thu ngân sách trên địa bàn', 'tai_chinh.thu_ns'), ('Thu nội địa', 'tai_chinh.thu_noi_dia'), ('Thu ngân sách phường được hưởng', 'tai_chinh.thu_ns_xa_huong'), ('Tổng chi ngân sách', 'tai_chinh.chi_ns'),
            ('Chi thường xuyên', 'tai_chinh.chi_thuong_xuyen'), ('Chi đầu tư phát triển', 'tai_chinh.chi_dau_tu'), ('Giải ngân vốn đầu tư công', 'tai_chinh.giai_ngan')]
    for i, (lab, k) in enumerate(rows, 1): ws.append([i, lab, None, values[k], None])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

# ───────── các bước nghiệp vụ ─────────
def period_label(code):
    y = code[:4]; t = code[5:]
    if t.startswith('M'): return f"tháng {int(t[1:])} năm {y}"
    if t == '6M': return f"6 tháng đầu năm {y}"
    if t == '9M': return f"9 tháng đầu năm {y}"
    if t == 'Y': return f"năm {y}"
    return code

def submit_file(who, content, name, period, as_of, expect=None):
    """Nộp file + bóc tách bằng tài khoản `who`. Trả về danh sách bản ghi (fact_id, indicator_id, status, value)."""
    t = tok(who)
    r = upload('/admin/files', t, content, name, {'period': period, 'as_of_date': as_of})
    fid = r['file']['id']
    st, ex = call('POST', f'/admin/files/{fid}/extract', token=t)
    if ex.get('status') != 'extracted': raise Fail(f"{name}: không bóc được — {ex.get('message')} {ex.get('tried')}")
    if expect is not None and len(ex['records']) != expect: raise Fail(f"{name}: bóc {len(ex['records'])} số, mong {expect}; thiếu {ex.get('misses')}")
    return ex['records']

def confirm_all(who, records, order=None):
    """Xác nhận từng số; trả về {indicator: outcome}. order: danh sách chỉ tiêu xác nhận trước (để phép kiểm chạy đúng thứ tự)."""
    t = tok(who); out = {}
    recs = sorted(records, key=lambda r: (order.index(r['indicator_id']) if order and r['indicator_id'] in order else 999))
    for r in recs:
        if r['status'] != 'extracted': out[r['indicator_id']] = r; continue
        st, c = call('POST', f"/admin/facts/{r['fact_id']}/confirm", token=t)
        out[r['indicator_id']] = c
    return out

def approve_dept(dept, period, who=None):
    """Data Owner của phòng duyệt mọi số confirmed của phòng trong kỳ."""
    who = who or head_of(dept); t = tok(who)
    st, cur = call('GET', f'/admin/facts?period={period}', token=t)
    ids = [f['id'] for f in cur if f['status'] == 'confirmed' and (f.get('owner_dept') == dept or who in ('vanphong', 'admin'))]
    if ids: call('POST', '/admin/facts/approve', {'ids': ids}, token=t)
    return len(ids)

def ingest(who, records, channel='web'):
    st, r = call('POST', '/admin/facts/ingest', {'records': records, 'channel': channel}, token=tok(who)); return r

def dept_values(values, dept, inds):
    return {k: v for k, v in values.items() if inds.get(k, {}).get('owner_dept') == dept}

# ───────── 0. đăng nhập, danh mục, tài khoản, phòng ─────────
log(f"Bắt đầu seed bộ '{A.set}' → {API}; kỳ đang thu số: {OPEN}")
adm = tok('admin')
call('POST', '/admin/catalog/reload', token=adm)
st, inds_list = call('GET', '/admin/catalog/indicators', token=adm)
INDS = {i['indicator_id']: i for i in inds_list}
st, specs = call('GET', '/admin/catalog/report-specs', token=adm)
SPEC = next(s['id'] for s in specs if s['spec_code'] == 'ktxh_dinh_ky')
st, users = call('GET', '/admin/users', token=adm)
by_email = {u['email']: u for u in users}
for a in ACC['accounts']:
    if a['email'] in by_email: continue
    st, u = call('POST', '/admin/users', {'email': a['email'], 'password': PW, 'full_name': a['full_name'], 'role': a['role'], 'department': a.get('department'), 'is_active': True}, token=adm)
    by_email[a['email']] = u
st, depts = call('GET', '/admin/departments', token=adm)
for d in depts:
    h = next((a for a in ACC['accounts'] if a.get('head_of') == d['key']), None)
    if h and d.get('head_admin_id') != by_email[h['email']]['id']:
        call('PATCH', f"/admin/departments/{d['id']}", {'head_admin_id': by_email[h['email']]['id']}, token=adm)
log(f"Tài khoản: {len(ACC['accounts'])} (+admin); Data Owner đã gán cho {sum(1 for a in ACC['accounts'] if a.get('head_of'))} phòng")
VP = tok('vanphong'); CT = tok('chutich')

# ───────── 1. kế hoạch năm + số cùng kỳ 2025 ─────────
pl = NUM['plans']
call('POST', '/admin/plan-targets', {'year': pl['year'], 'rows': [{'indicator_id': k, 'value': v, 'source_ref': pl['source']} for k, v in pl['values'].items()]}, token=VP)
ly = NUM['same_period_last_year']
recs = [{'indicator_id': k, 'period': ly['period'], 'as_of_date': ly['as_of'], 'value': v, 'capture_method': 'pdf_text', 'source_ref': {**ly['source'], 'system': 'bao_cao_da_ky'}} for k, v in ly['values'].items()]
out = ingest('vanphong', recs)
for o in out: call('POST', f"/admin/facts/{o['fact_id']}/confirm", token=VP)
call('POST', '/admin/facts/approve', {'ids': [o['fact_id'] for o in out]}, token=VP)
log(f"Kế hoạch năm {pl['year']}: {len(pl['values'])} chỉ tiêu; cùng kỳ {ly['period']}: {len(out)} số đã duyệt")

# ───────── 2. sổ văn bản QLVB (giả lập), lịch họp ─────────
docs = []
for d in DOC['documents']:
    row = {k: v for k, v in d.items() if k != 'nguoi_xu_ly'}
    if d.get('nguoi_xu_ly'): row['nguoi_xu_ly_email'] = next(a['email'] for a in ACC['accounts'] if a['email'].split('@')[0] == d['nguoi_xu_ly'])
    docs.append(row)
call('POST', '/admin/qlvb/sim/documents', {'documents': docs}, token=VP)
call('POST', '/admin/qlvb/sim/schedule', {'items': DOC['schedule']}, token=VP)
log(f"QLVB giả lập: {len(docs)} văn bản, {len(DOC['schedule'])} lịch họp")

# ───────── 2b. Data Core: địa bàn, tổ chức, dự án (quan hệ, sự kiện, văn bản), hộ kinh doanh, nhóm Zalo chính danh ─────────
KT = tok('kinhte.truong')
def seed_objects():
    if not OBJ: return
    st, docs_all = call('GET', '/admin/qlvb/documents?limit=200', token=VP)
    doc_id = {d['so_ky_hieu']: d['id'] for d in docs_all if d.get('so_ky_hieu')}
    items = [{'object_type': 'dia_ban', 'code': d['code'], 'name': d['name'], 'master_id': d['code'], 'attributes': {k: v for k, v in d.items() if k not in ('code', 'name')}, 'verification_status': 'verified'} for d in OBJ.get('dia_ban', [])]
    items += [{'object_type': 'to_chuc', 'code': d['code'], 'name': d['name'], 'master_id': d.get('master_id'), 'external_ids': {'ma_so_thue': d.get('ma_so_thue')}, 'attributes': {k: v for k, v in d.items() if k not in ('code', 'name', 'master_id')}, 'verification_status': 'verified'} for d in OBJ.get('to_chuc', [])]
    st, r = call('POST', '/admin/objects/bulk', {'items': items}, token=VP)
    da_items = []
    for d in OBJ.get('du_an', []):
        attrs = {k: v for k, v in d.items() if k in ('tong_muc', 'ke_hoach_von', 'tien_do', 'gpmb', 'han_hoan_thanh', 'vuong_mac')}
        attrs['giai_ngan'] = 0  # cộng dồn qua sự kiện giải ngân
        rels = [{'relation_type': 'HAS_CONTRACTOR', 'target_code': d['contractor']}, {'relation_type': 'LOCATED_AT', 'target_code': d['dia_ban']}]
        evs = [{'event_type': e['type'], 'event_date': e['date'], 'values': {k: v for k, v in e.items() if k in ('so_tien', 'ty_le', 'tien_do')}, 'external_id': f"demo:{d['code']}:{e['type']}:{e['date']}"} for e in d.get('events', [])]
        da_items.append({'object_type': 'du_an', 'code': d['code'], 'name': d['name'], 'attributes': attrs, 'data_owner_dept': 'kinh_te', 'verification_status': 'verified', 'status': d.get('status', 'active'),
                         'provenance': {'source_type': 'HUMAN', 'note': 'Sổ theo dõi dự án Phòng Kinh tế'}, 'relations': rels, 'events': evs, '_docs': d.get('docs', [])})
    st, r2 = call('POST', '/admin/objects/bulk', {'items': [{k: v for k, v in it.items() if k != '_docs'} for it in da_items]}, token=KT)
    st, das = call('GET', '/admin/objects?type=du_an&limit=100', token=VP)
    uid_of = {o['code']: o['uid'] for o in das}
    nlink = 0
    for it in da_items:
        for skh in it['_docs']:
            if skh in doc_id: call('POST', f"/admin/objects/{uid_of[it['code']]}/documents", {'document_kind': 'qlvb_document', 'document_id': doc_id[skh], 'link_type': 'decision'}, token=VP); nlink += 1
    # hộ kinh doanh
    tpl = OBJ.get('ho_kinh_doanh_template', {}); names = tpl.get('names', [])[:tpl.get('count', 0)]
    kdc = [d['code'] for d in OBJ.get('dia_ban', [])]
    hk = []
    for i, n in enumerate(names):
        code = f"HKD-{i + 1:03d}"; msh = f"37G8{i + 1:06d}"
        evs = [{'event_type': 'dang_ky_moi', 'event_date': f"2026-0{1 + i % 6}-{10 + i % 15:02d}", 'external_id': f"demo:{code}:dk"}]
        if i < tpl.get('cds_tiep_can', 0): evs.append({'event_type': 'tiep_can_cds', 'event_date': f"2026-0{4 + i % 5}-{5 + i % 20:02d}", 'external_id': f"demo:{code}:cds"})
        if i < tpl.get('cai_ung_dung', 0): evs.append({'event_type': 'cai_ung_dung', 'event_date': f"2026-0{6 + i % 3}-{8 + i % 18:02d}", 'external_id': f"demo:{code}:app"})
        hk.append({'object_type': 'ho_kinh_doanh', 'code': code, 'name': n, 'master_id': msh, 'external_ids': {'ma_so_hkd': msh}, 'attributes': {'ma_so_hkd': msh, 'chu_ho': n.split()[-1] + ' ' + n.split()[-2] if len(n.split()) > 1 else n, 'dia_chi': kdc[i % len(kdc)] if kdc else ''},
                   'data_owner_dept': 'kinh_te', 'verification_status': 'verified' if i % 4 else 'pending', 'relations': [{'relation_type': 'LOCATED_IN', 'target_code': kdc[i % len(kdc)]}] if kdc else [], 'events': evs})
    st, r3 = call('POST', '/admin/objects/bulk', {'items': hk}, token=KT)
    for c in OBJ.get('channels', []): call('POST', '/admin/data/channels', c, token=VP)
    log(f"Data Core: {r['created']} địa bàn/tổ chức, {r2['created']} dự án ({nlink} văn bản gắn dự án), {r3['created']} hộ kinh doanh, {len(OBJ.get('channels', []))} nhóm Zalo chính danh")
    return uid_of
DA_UID = seed_objects() or {}

# ───────── 3. một kỳ lũy kế: thu số → duyệt → ngoại lệ → lời dẫn → chốt → Word → trình ký → ký ─────────
def run_period(code, cfg, story=False):
    values = cfg['values']; cutoff = cfg['cutoff']; as_of = cfg.get('as_of', {}); label = period_label(code)
    st, run = call('POST', '/admin/report-runs', {'spec_id': SPEC, 'period': code, 'cutoff_date': cutoff}, token=VP)
    rid = run['run_id']
    st, sy = call('POST', '/admin/qlvb/sync', {'period': code}, token=VP)
    log(f"[{code}] mở kỳ #{rid}, chốt {cutoff}; QLVB: {sy['fetched']} văn bản, +{sy['events_inserted']} sự kiện, +{sy['tasks_created'] + sy['tasks_completed']} việc ({sy['tasks_completed']} đã xong)")
    aof = lambda dept: as_of.get(dept, cutoff)

    # 3a. Văn phòng: chỉ đạo điều hành đếm từ QLVB (kết nối API) + biểu mẫu tư pháp
    chi_dao = {k: v for k, v in values.items() if k.startswith('chi_dao.')}
    out = ingest('vanphong', [{'indicator_id': k, 'period': code, 'as_of_date': aof('van_phong'), 'value': v, 'capture_method': 'api', 'source_ref': {'system': 'qlvb', 'note': 'Đếm từ sổ văn bản đi/đến và sổ giao việc trên QLVB'}} for k, v in chi_dao.items()], channel='api')
    for o in out: call('POST', f"/admin/facts/{o['fact_id']}/confirm", token=VP)
    tp = dept_values(values, 'van_phong', INDS); tp = {k: v for k, v in tp.items() if not k.startswith('chi_dao.')}
    content, n = bieu_mau('van_phong', code, aof('van_phong'), tp)
    confirm_all('vanphong', submit_file('vanphong', content, f'bieu-mau-van-phong-{code}.xlsx', code, aof('van_phong'), expect=n))
    approve_dept('van_phong', code, 'vanphong')

    # 3b. Một cửa: file xuất từ Hệ thống TTHC
    mc = submit_file('motcua', mot_cua_export(code, values, label.upper()), f'tong-hop-mot-cua-{code}.xlsx', code, aof('hanh_chinh_cong'), expect=6)
    confirm_all('motcua', mc); approve_dept('hanh_chinh_cong', code)

    # 3c. Kinh tế: ngân sách (PDF mơ hồ → sổ kế toán) + biểu mẫu phần còn lại
    kt_all = dept_values(values, 'kinh_te', INDS)
    tc_keys = ['tai_chinh.thu_ns', 'tai_chinh.thu_noi_dia', 'tai_chinh.thu_ns_xa_huong', 'tai_chinh.chi_ns', 'tai_chinh.chi_thuong_xuyen', 'tai_chinh.chi_dau_tu', 'tai_chinh.giai_ngan']
    if story:
        pdf, pdf_name = tai_chinh_pdf(values, label)
        pr = submit_file('kinhte', pdf, pdf_name, code, '2026-09-10', expect=6)
        amb = [r for r in pr if r['indicator_id'] == 'tai_chinh.thu_ns']
        if not amb or float(amb[0]['value']) == values['tai_chinh.thu_ns']: raise Fail(f"PDF ngân sách: mong số mơ hồ ở thu_ns, nhận {amb}")
        confirm_all('kinhte', pr)   # chuyên viên xác nhận cả số mơ hồ → gate cảnh báo "có thể lẫn dấu thập phân"
        st, g = call('GET', f'/admin/report-runs/{rid}', token=VP)
        if not any(w['kind'] == 'ambiguous_number' for w in g['gate']['warnings']): raise Fail('gate không cảnh báo số mơ hồ')
        log(f"[{code}] lỗi 2: PDF ghi 'Tổng thu ngân sách {fmt_ty(values['tai_chinh.thu_ns'], '.')} tỷ' → bóc thành {float(amb[0]['value']):,.0f} đ, tin cậy {amb[0]['confidence']} → gate cảnh báo")
    sk = submit_file('kinhte', so_ke_toan({k: values[k] for k in tc_keys}, label.upper()), f'tong-hop-thu-chi-{code}.xlsx', code, aof('kinh_te') if not story else '2026-09-12', expect=7)
    confirm_all('kinhte', sk)
    rest = {k: v for k, v in kt_all.items() if k not in tc_keys}
    content, n = bieu_mau('kinh_te', code, aof('kinh_te'), rest)
    confirm_all('kinhte', submit_file('kinhte', content, f'bieu-mau-kinh-te-{code}.xlsx', code, aof('kinh_te'), expect=n))
    approve_dept('kinh_te', code)

    # 3d. Công an: đơn thư (Word sai tổng → cách ly → sổ tiếp dân Excel) + an ninh qua biểu mẫu
    ca_all = dept_values(values, 'cong_an', INDS)
    td_keys = [k for k in ca_all if k.startswith('tiep_dan.')]
    if story:
        wrong = cfg['cong_an_word_wrong']
        wr = submit_file('congan', cong_an_word(wrong, label), f'bao-cao-tiep-dan-{code}.docx', code, '2026-09-14', expect=7)
        res = confirm_all('congan', wr, order=['tiep_dan.luot_tiep', 'tiep_dan.don_tiep_nhan', 'tiep_dan.don_dang_xu_ly', 'tiep_dan.gq_khieu_nai', 'tiep_dan.gq_to_cao', 'tiep_dan.gq_kien_nghi', 'tiep_dan.don_da_giai_quyet'])
        q = res['tiep_dan.don_da_giai_quyet']
        if q.get('status') != 'quarantined': raise Fail(f"lỗi 1: mong 84 bị cách ly, nhận {q}")
        log(f"[{code}] lỗi 1: Word ghi đã giải quyết 84 nhưng 84 + 11 đang xử lý ≠ 99 và 4 + 0 + 41 = 45 ≠ 84 → CÁCH LY: {q.get('note', '')[:90]}")
    sd = submit_file('congan', so_tiep_dan({k: values[k] for k in td_keys}, label.upper()), f'so-tiep-dan-{code}.xlsx', code, aof('cong_an'), expect=7)
    confirm_all('congan', sd)
    an = {k: v for k, v in ca_all.items() if not k.startswith('tiep_dan.')}
    content, n = bieu_mau('cong_an', code, aof('cong_an'), an)
    confirm_all('congan', submit_file('congan', content, f'bieu-mau-cong-an-{code}.xlsx', code, aof('cong_an'), expect=n))
    approve_dept('cong_an', code)

    # 3e. Y tế, Văn hoá - Xã hội, Quân sự: biểu mẫu chuẩn
    for dept in ('y_te', 'van_hoa_xa_hoi', 'quan_su'):
        vals = dept_values(values, dept, INDS)
        content, n = bieu_mau(dept, code, aof(dept), vals)
        confirm_all(staff_of(dept), submit_file(staff_of(dept), content, f"bieu-mau-{dept.replace('_', '-')}-{code}.xlsx", code, aof(dept), expect=n))
        approve_dept(dept, code)

    # 3f. Văn phòng: ngoại lệ ngày chốt (lỗi 4), KPI, lời dẫn (lỗi 3)
    st, g = call('GET', f'/admin/report-runs/{rid}', token=VP)
    cut = [e for e in g['gate']['errors'] if e['kind'] == 'cutoff_mismatch']
    if cut:
        for e in cut:
            dept = e.get('owner_dept'); reason = cfg.get('exceptions', {}).get(dept) or f"Bộ phận chốt theo ngày xuất số liệu từ hệ thống nguồn."
            for ind in (e.get('indicator_ids') or [e['indicator']]):
                call('POST', f'/admin/report-runs/{rid}/exceptions', {'indicator_id': ind, 'reason': reason}, token=VP)
        log(f"[{code}] lỗi 4: {len({e['tech'].split('as_of=')[1].split(' ')[0] for e in cut if 'as_of=' in str(e.get('tech'))})} mốc chốt khác nhau (16/8 → 18/9), {len(cut)} mục lệch ngày chốt kỳ → Văn phòng ghi lý do ngoại lệ → chú thích cuối trang")
    if story:
        call('POST', '/admin/kpi/employees/sync-from-accounts', token=VP)
        call('POST', '/admin/kpi/compute', {'period': code}, token=VP)
        st, sc = call('GET', f'/admin/kpi/scores?period={code}', token=CT)
        call('POST', '/admin/kpi/scores/import', {'rows': [{'employee_code': a['email'], 'period': code, 'criterion_id': 'kpi.danh_gia_lanh_dao', 'value': 85 + (i * 7) % 15, 'evidence_ref': {'note': 'Chủ tịch đánh giá'}} for i, a in enumerate(ACC['accounts']) if a['role'] == 'department_staff']}, token=CT)
        call('POST', '/admin/kpi/scores/approve', {'ids': [s['id'] for s in sc if s['status'] != 'approved']}, token=CT)
        st, pb = call('POST', '/admin/kpi/publish', {'period': code}, token=VP)
        for o in pb: call('POST', f"/admin/facts/{o['fact_id']}/confirm", token=VP)
        call('POST', '/admin/facts/approve', {'ids': [o['fact_id'] for o in pb]}, token=VP)
        log(f"[{code}] KPI: {len(sc)} điểm đề xuất, Chủ tịch duyệt, {len(pb)} số KPI vào kho")
    nar = DOC['narratives'].get(code, {})
    if story and nar.get('kinh_te.loi_dan_wrong'):
        st, w = call('POST', f'/admin/report-runs/{rid}/narratives/kinh_te.loi_dan', {'text': nar['kinh_te.loi_dan_wrong'].strip(), 'source': 'prev_period'}, token=VP)
        call('POST', f'/admin/report-runs/{rid}/narratives/kinh_te.loi_dan/accept', token=VP)
        st, g = call('GET', f'/admin/report-runs/{rid}', token=VP)
        if not any(x['kind'] == 'period_word' for x in g['gate']['warnings']): raise Fail('lỗi 3: gate không cảnh báo "6 tháng đầu năm"')
        log(f"[{code}] lỗi 3: lời dẫn dán từ kỳ 6 tháng còn '6 tháng đầu năm' → gate Nhất quán kỳ cảnh báo tại đoạn → Văn phòng sửa")
    for slot, text in nar.items():
        if slot.endswith('_wrong'): continue
        st, r = call('POST', f'/admin/report-runs/{rid}/narratives/{slot}', {'text': text.strip()}, token=VP)
        call('POST', f'/admin/report-runs/{rid}/narratives/{slot}/accept', token=VP)
    st, g = call('GET', f'/admin/report-runs/{rid}', token=VP)
    if not g['gate']['ok']: raise Fail(f"[{code}] gate còn lỗi trước khi chốt: {[e['title'] for e in g['gate']['errors']][:6]}")
    st, lk = call('POST', f'/admin/report-runs/{rid}/lock', token=VP)
    st, rd = call('POST', f'/admin/report-runs/{rid}/render', token=VP)
    if rd['postcheck']['errors']: raise Fail(f"[{code}] hậu kiểm Word lỗi: {rd['postcheck']['errors'][:3]}")
    log(f"[{code}] chốt kỳ: {len(lk['fact_snapshot']['facts'])} số đóng băng, {len(lk['fact_snapshot']['events'])} sự kiện; Word {len(rd['slots'])} mục, {len(rd['postcheck']['warnings'])} cảnh báo")
    sg = cfg.get('signed')
    if sg and not A.skip_sign:
        st, sub = call('POST', f'/admin/qlvb/report-runs/{rid}/submit', {'signer': 'Chủ tịch UBND phường'}, token=VP)
        st, dl = call('GET', '/admin/qlvb/documents?direction=di', token=VP)
        pend = next(d for d in dl if d['sign_status'] == 'pending' and d['run_id'] == rid)
        call('POST', f"/admin/qlvb/sim/sign/{pend['id']}", {'so_ky_hieu': sg['so_ky_hieu'], 'ngay_ky': sg['ngay_ky'], 'nguoi_ky': 'Trần Văn Minh — Chủ tịch UBND phường'}, token=VP)
        st, chk = call('POST', f'/admin/qlvb/report-runs/{rid}/check-sign', token=VP)
        if chk['status'] != 'signed': raise Fail(f"[{code}] chưa ký: {chk}")
        log(f"[{code}] trình ký → ký số {sg['so_ky_hieu']} ngày {vn_date(sg['ngay_ky'])} → kỳ khoá vĩnh viễn")
    return rid

RID6 = run_period('2026-6M', NUM['periods']['2026-6M'])
RID9 = run_period('2026-9M', NUM['periods']['2026-9M'], story=True)

# ───────── 4. kỳ tháng đang thu số: mỗi vai đều có việc ─────────
oc = NUM['periods']['open']; ov = oc['values']; cutoff = OPEN_END.isoformat()
st, run = call('POST', '/admin/report-runs', {'spec_id': SPEC, 'period': OPEN, 'cutoff_date': cutoff}, token=VP); RIDO = run['run_id']
call('POST', '/admin/qlvb/sync', {'period': OPEN}, token=VP)
# Văn phòng: chỉ đạo (API) + tư pháp đã duyệt
out = ingest('vanphong', [{'indicator_id': k, 'period': OPEN, 'as_of_date': cutoff, 'value': v, 'capture_method': 'api', 'source_ref': {'system': 'qlvb', 'note': 'Đếm từ sổ văn bản QLVB'}} for k, v in ov.items() if k.startswith('chi_dao.')], channel='api')
for o in out: call('POST', f"/admin/facts/{o['fact_id']}/confirm", token=VP)
tp = {k: v for k, v in dept_values(ov, 'van_phong', INDS).items() if not k.startswith('chi_dao.')}
content, n = bieu_mau('van_phong', OPEN, cutoff, tp)
confirm_all('vanphong', submit_file('vanphong', content, f'bieu-mau-van-phong-{OPEN}.xlsx', OPEN, cutoff, expect=n)); approve_dept('van_phong', OPEN, 'vanphong')
# Một cửa: đã nộp + xác nhận, CHỜ Giám đốc duyệt
confirm_all('motcua', submit_file('motcua', mot_cua_export(OPEN, ov, period_label(OPEN).upper()), f'tong-hop-mot-cua-{OPEN}.xlsx', OPEN, cutoff, expect=6))
# Y tế: biểu mẫu đã duyệt; nhân viên nhập tay lệch → CÁCH LY (Trạm trưởng quyết)
yt = {k: v for k, v in ov.items() if k.startswith('y_te.')}
content, n = bieu_mau('y_te', OPEN, cutoff, yt)
confirm_all('yte', submit_file('yte', content, f'bieu-mau-y-te-{OPEN}.xlsx', OPEN, cutoff, expect=n)); approve_dept('y_te', OPEN)
qr = ingest('yte.nv', [{'indicator_id': k, 'period': OPEN, 'as_of_date': cutoff, 'value': v, 'capture_method': 'form', 'source_ref': {'system': 'form', 'note': 'Nhập từ sổ khám bệnh'}} for k, v in oc['y_te_manual_wrong'].items()])
if qr[0]['status'] != 'quarantined': raise Fail(f"Y tế: mong số nhập tay bị cách ly, nhận {qr}")
# Công an: sổ tiếp dân đã nộp, CHƯA xác nhận; VH-XH: đã xác nhận, chờ duyệt; Kinh tế: CHƯA nộp → nhắc
td = {k: v for k, v in ov.items() if k.startswith('tiep_dan.')}
submit_file('congan', so_tiep_dan(td, period_label(OPEN).upper()), f'so-tiep-dan-{OPEN}.xlsx', OPEN, cutoff, expect=7)
vh = {k: v for k, v in ov.items() if INDS.get(k, {}).get('owner_dept') == 'van_hoa_xa_hoi'}
content, n = bieu_mau('van_hoa_xa_hoi', OPEN, cutoff, vh)
confirm_all('vhxh', submit_file('vhxh', content, f'bieu-mau-van-hoa-xa-hoi-{OPEN}.xlsx', OPEN, cutoff, expect=n))
st, rm = call('POST', f'/admin/chat/remind/{RIDO}', token=VP)
log(f"[{OPEN}] kỳ đang thu số #{RIDO}: Một cửa chờ duyệt, Y tế 1 số cách ly, Công an chờ xác nhận, VH-XH chờ duyệt, Kinh tế chưa nộp → đã nhắc {len(rm['depts'])} phòng")

# ───────── 5. việc giao (có việc từ Nhiệm vụ kỳ tới của báo cáo 9 tháng) ─────────
ids = {a['email'].split('@')[0]: by_email[a['email']]['id'] for a in ACC['accounts']}
n_done = 0
for t in DOC['tasks']:
    due = (dt.datetime.now() + dt.timedelta(days=t['due'])).replace(hour=17, minute=0, second=0, microsecond=0)
    body = {'title': t['title'], 'assignee_id': ids[t['to']], 'due_at': due.isoformat(), 'priority': t.get('priority', 'normal')}
    if t.get('from_report'): body.update({'source_type': 'report_run', 'source_id': RID9, 'description': 'Giao từ mục III Nhiệm vụ trọng tâm kỳ tới — Báo cáo 436/BC-UBND.'})
    if t.get('object'): body['object_uid'] = DA_UID.get(t['object'])
    if t.get('target'): body.update({'target_indicator_id': t['target'], 'target_value': t.get('target_value')})
    st, tk = call('POST', '/admin/tasks', body, token=tok(t['by']))
    if t.get('done'):
        call('PATCH', f"/admin/tasks/{tk['id']}/status", {'status': 'done', 'result_note': 'Đã hoàn thành.'}, token=tok(t['to'])); n_done += 1
log(f"Việc giao: {len(DOC['tasks'])} việc ({n_done} đã xong, {sum(1 for t in DOC['tasks'] if t['due'] < 0 and not t.get('done'))} quá hạn, {sum(1 for t in DOC['tasks'] if t.get('from_report'))} từ nhiệm vụ kỳ tới)")

# ───────── 6. vòng kín: sổ giao việc → chỉ tiêu DERIVED (tháng hiện tại); sức khoẻ dữ liệu → kho ─────────
CUR = f"{TODAY.year}-M{TODAY.month:02d}"
st, dv = call('POST', '/admin/data/derive-tasks', {'period': CUR}, token=VP)
st, dh = call('POST', '/admin/data/health/publish', {'period': OPEN}, token=VP)
log(f"DERIVED: nhiệm vụ {CUR} giao {dv['inputs']['giao']} / xong {dv['inputs']['hoan_thanh']} / quá hạn {dv['inputs']['qua_han']} → kho; sức khoẻ dữ liệu {OPEN} = {dh.get('overall')}% → kho")

# ───────── tóm tắt ─────────
st, runs = call('GET', '/admin/report-runs', token=VP)
print()
print('=== BỘ DEMO ĐÃ DỰNG ===')
for r in sorted(runs, key=lambda r: r['run_id']):
    print(f"  #{r['run_id']} {r['period']:<8} {r['status']:<10} chốt {r['cutoff_date']}" + (f"  ký {r['signed_number']} ngày {r['signed_date']}" if r.get('signed_number') else ''))
print(f"  Đăng nhập: {ACC['accounts'][0]['email']} … / {PW}  (danh sách đầy đủ trên trang đăng nhập khi DEMO_MODE=1)")
print(f"  Thời gian: {time.time() - T0:.0f} giây")
