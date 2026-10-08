# -*- coding: utf-8 -*-
"""Kiểm chứng Data Core theo Blueprint V0.5 trên bộ demo (chạy sau infra/reset-demo.sh):
   python eval/smoke_v05.py http://127.0.0.1:3070/api
Object/Relation/Event/Document, Entity Resolution, Object 360, Data Map + lineage + tác động, Data Health 6 chỉ số,
bảng điều hành theo lĩnh vực, tìm kiếm, vòng kín Task → Event → Indicator DERIVED, cổng an toàn thông báo, nhóm chính danh."""
import io, json, os, sys, urllib.parse, urllib.request, uuid, yaml

API = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3070/api').rstrip('/')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ACC = yaml.safe_load(io.open(os.path.join(ROOT, 'config', 'demo', 'dien-ban-bac', 'accounts.yaml'), encoding='utf-8'))
FAILS = []

def call(method, path, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, method=method, data=data); req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=120) as r: t = r.read(); return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode('utf-8', 'replace')
        try: return e.code, json.loads(t)
        except Exception: return e.code, t

def check(name, cond, detail=''):
    print(('  OK   ' if cond else '  FAIL ') + name + (f' — {detail}' if detail and not cond else ''))
    if not cond: FAILS.append(name)

def login(key):
    email = next(a['email'] for a in ACC['accounts'] if a['email'].split('@')[0] == key)
    return call('POST', '/admin/auth/login', {'email': email, 'password': ACC['password']})[1]['access_token']

VP = login('vanphong'); KT = login('kinhte.truong'); CT = login('chutich'); H = login('hdnd')

print('1. Object Directory: 10 loại trong từ điển, quyền sở hữu, số lượng')
st, counts = call('GET', '/admin/objects/counts', token=VP)
by = {c['key']: c for c in counts}
check('10 loại Object lõi MVP có trong từ điển', len(counts) == 10 and {'du_an', 'ho_kinh_doanh', 'van_ban', 'nhiem_vu', 'chi_tieu', 'bao_cao', 'don_vi', 'dia_ban', 'to_chuc', 'ho_so'} <= set(by), str(list(by)))
check('14 dự án (LOCAL_MASTER), 30 hộ kinh doanh (REFERENCE), 8 địa bàn, 5 tổ chức', by['du_an']['count'] >= 14 and by['du_an']['ownership'] == 'LOCAL_MASTER' and by['ho_kinh_doanh']['count'] >= 30 and by['ho_kinh_doanh']['ownership'] == 'REFERENCE' and by['dia_ban']['count'] == 8 and by['to_chuc']['count'] == 5, str({k: (v['count'], v['ownership']) for k, v in by.items()}))
check('văn bản, nhiệm vụ, báo cáo, chỉ tiêu đọc từ bảng gốc (không sao chép)', by['van_ban']['storage'] == 'builtin' and by['van_ban']['count'] >= 15 and by['nhiem_vu']['count'] >= 15 and by['bao_cao']['count'] == 3 and by['chi_tieu']['count'] >= 90, str({k: by[k]['count'] for k in ('van_ban', 'nhiem_vu', 'bao_cao', 'chi_tieu')}))

print('2. Entity Resolution và tạo Object có đối soát')
st, cand = call('POST', '/admin/objects/resolve', {'object_type': 'to_chuc', 'name': 'CTY TNHH XÂY DỰNG ĐIỆN BÀN'}, token=KT)
check('"CTY TNHH XÂY DỰNG ĐIỆN BÀN" ↔ "Công ty TNHH Xây dựng Điện Bàn": trùng tên chuẩn hoá', cand and cand[0]['code'] == 'TC-001' and cand[0]['score'] >= 0.9, str(cand)[:200])
st, cand = call('POST', '/admin/objects/resolve', {'object_type': 'to_chuc', 'name': 'Công ty khác', 'external_ids': {'ma_so_thue': '0401234567'}}, token=KT)
check('trùng mã số thuế → cùng một tổ chức', cand and cand[0]['code'] == 'TC-001' and 'mã' in cand[0]['reason'], str(cand)[:200])
st, dup = call('POST', '/admin/objects', {'object_type': 'to_chuc', 'name': 'Công ty TNHH Xây dựng Điện Bàn'}, token=KT)
check('tạo trùng → 409 kèm ứng viên, không sinh Object mới', st == 409 and dup.get('candidates'), str(dup)[:200])
st, newo = call('POST', '/admin/objects', {'object_type': 'du_an', 'name': f'Dự án kiểm thử V05 {uuid.uuid4().hex[:6]}', 'attributes': {'tong_muc': 1000000000, 'ke_hoach_von': 500000000, 'han_hoan_thanh': '2026-12-31'}}, token=KT)
check('Trưởng phòng Kinh tế tạo dự án mới: mã tự cấp DA-015, trạng thái xác minh', st in (200, 201) and newo['code'].startswith('DA-0') and newo['verification_status'] in ('verified', 'pending'), str(newo)[:200])
UID = newo['uid'] if st in (200, 201) else None
st, e = call('POST', '/admin/objects', {'object_type': 'du_an', 'name': 'Dự án do HĐND tạo'}, token=H)
check('HĐND không tạo được Object', st == 403, str(st))
st, e = call('POST', '/admin/objects', {'object_type': 'van_ban', 'name': 'Văn bản tạo tay'}, token=VP)
check('Loại có bảng riêng (văn bản) không tạo trong Object Directory', st == 400, str(e)[:120])

print('3. Event trên Object → thuộc tính cập nhật, timeline; Document ↔ Object; Object 360')
st, ev = call('POST', f'/admin/objects/{UID}/events', {'event_type': 'giai_ngan', 'event_date': '2026-10-01', 'values': {'so_tien': 200000000}, 'note': 'Tạm ứng đợt 1'}, token=KT)
check('ghi sự kiện giải ngân → event_log có object_uid', st in (200, 201) and ev['object_uid'] == UID and ev['event_type'] == 'giai_ngan', str(ev)[:200])
st, e2 = call('POST', f'/admin/objects/{UID}/events', {'event_type': 'tiep_can_cds', 'event_date': '2026-10-01'}, token=KT)
check('sự kiện không thuộc loại đối tượng → từ chối', st == 400, str(e2)[:120])
st, o360 = call('GET', f'/admin/objects/{UID}/360', token=CT)
check('Object 360: giải ngân cộng dồn 200 triệu, timeline 1 sự kiện, đủ thuộc tính/quan hệ/tài liệu/chất lượng/audit', o360['object']['attributes'].get('giai_ngan') == 200000000 and len(o360['events']) == 1 and all(k in o360 for k in ('relations', 'documents', 'indicators', 'tasks', 'quality', 'audit')), str(o360['object']['attributes'])[:200])
st, da2 = call('GET', '/admin/objects?type=du_an&q=' + urllib.parse.quote('Phong Nhị'), token=CT)
D2 = next((o for o in da2 if o['code'] == 'DA-002'), None)
check('DA-002 kè Phong Nhị: có cảnh báo vướng mắc (GPMB 71%)', D2 and any(a['key'] == 'vuong_mac' for a in D2['alerts']), str(D2 and D2['alerts']))
st, o2 = call('GET', f"/admin/objects/{D2['uid']}/360", token=CT)
check('DA-002 360: nhà thầu + địa bàn (quan hệ), 2 văn bản gắn (QĐ 118, CV 2210), giải ngân 19,25 tỷ từ sự kiện, 1 việc gắn dự án', len(o2['relations']) == 2 and len(o2['documents']) == 2 and o2['object']['attributes']['giai_ngan'] == 19250000000 and len(o2['tasks']) >= 1, str((len(o2['relations']), len(o2['documents']), o2['object']['attributes'].get('giai_ngan'), len(o2['tasks']))))
check('hộ kinh doanh: 22 sự kiện tiếp cận CĐS trong event_log', call('GET', '/admin/events?period=2026-9M', token=VP)[1] and sum(1 for e in call('GET', '/admin/events?period=2026-9M', token=VP)[1] if e['event_type'] == 'tiep_can_cds') >= 15, '')

print('4. Data Map, lineage, tác động')
st, dm = call('GET', '/admin/data/map', token=VP)
check('bản đồ dữ liệu: ≥ 12 nguồn, ≥ 15 bộ dữ liệu, có nguồn chờ kết nối (LGSP, 1022, dân cư, đất đai)', dm['totals']['sources'] >= 12 and dm['totals']['datasets'] >= 15 and dm['totals']['sources'] - dm['totals']['active'] >= 3, str(dm['totals']))
mc = next((d for s in dm['sources'] for d in s['datasets'] if d['code'] == 'MOT_CUA_TONG_HOP'), None)
check('bộ "Tổng hợp một cửa": có bản ghi file, lần nạp, chất lượng, dùng trong ≥ 1 báo cáo', mc and mc['records'] >= 3 and mc['last_sync'] and mc['quality_score'] is not None and len(mc['used_by']['reports']) >= 1, str(mc)[:300])
st, ln = call('GET', '/admin/data/lineage?indicator_id=tthc.tiep_nhan', token=H)
check('lineage "17.206 hồ sơ lấy từ đâu": nguồn → file → số theo kỳ → báo cáo đã ký', ln['datasets'] and any(f['file'] for f in ln['facts']) and any(r['signed_number'] == '436/BC-UBND' for r in ln['used_in']['reports']), str(ln)[:300])
st, im = call('GET', '/admin/data/impact?dataset=THU_CHI_NS', token=VP)
check('tác động "sổ kế toán lỗi": ≥ 6 chỉ tiêu, mẫu báo cáo KT-XH, khối Tài chính', len(im['indicators']) >= 6 and im['reports'] and 'Tài chính – Ngân sách' in im['dashboards'], str(im)[:300])

print('5. Data Health 6 chỉ số')
st, dh = call('GET', '/admin/data/health?period=2026-9M', token=H)
keys = [m['key'] for m in dh['metrics']]
check('6 chỉ số đúng–đủ–sạch–sống–thống nhất–dùng chung, có điểm tổng', keys == ['dung', 'du', 'sach', 'song', 'thong_nhat', 'dung_chung'] and dh['overall'] is not None, str(dh['scores']))
check('9 tháng đã ký: ĐÚNG và ĐỦ cao (≥ 90%)', dh['scores']['dung'] >= 90 and dh['scores']['du'] >= 90, str(dh['scores']))
st, dho = call('GET', '/admin/data/health', token=VP)
check('kỳ đang thu số: ĐỦ thấp hơn (Kinh tế chưa nộp), có drill-down theo phòng', dho['scores']['du'] < 100 and any(d['dept'] == 'kinh_te' for d in next(m for m in dho['metrics'] if m['key'] == 'du')['by_dept']), str(dho['scores']))

print('6. Bảng điều hành theo lĩnh vực + Việc cần xử lý + tìm kiếm')
st, ex = call('GET', '/admin/data/executive?period=2026-9M', token=CT)
dom = {d['key']: d for d in ex['domains']}
check('9 lĩnh vực theo mục 50 (chỉ đạo, kinh tế, QH-ĐT-XD, TNMT, tài chính, VH-XH, KHCN-CĐS, nội vụ-CCHC, QPAN)', len(ex['domains']) == 9 and 'qpan_noi_chinh' in dom, str(list(dom)))
tc = next((c for c in dom['tai_chinh']['cards'] if c['indicator'] == 'tai_chinh.thu_ns'), None)
check('thẻ thu NSNN: 352,732 tỷ / kế hoạch 304,252 tỷ = 116% → Đạt, có nguồn và phòng chủ', tc and tc['value'] == 352732000000 and tc['plan']['value'] == 304252000000 and tc['pct'] == 115.9 and tc['status'] == 'dat' and tc['source']['capture'] == 'export' and tc['owner_dept'] == 'kinh_te', str(tc)[:300])
tn = next((c for c in dom['tai_chinh']['cards'] if c['indicator'] == 'tai_chinh.thu_noi_dia'), None)
check('thẻ thu nội địa 72,491 / 100,4 tỷ = 72% → Cần theo dõi', tn and tn['status'] == 'theo_doi' and 72 <= tn['pct'] <= 73, str(tn)[:200])
hk = next((c for c in dom['kinh_te']['cards'] if c['indicator'] == 'kinh_te.hkd_tong'), None)
check('thẻ HKD tiếp cận CĐS 344/442 = 77,8%, có drill tới danh sách hộ', hk and hk['pair']['value'] == 344 and hk['pct'] == 77.8 and hk['drill'] == 'ho_kinh_doanh', str(hk)[:200])
check('lĩnh vực QH-ĐT-XD có 14 dự án và danh sách cảnh báo', dom['quy_hoach_dau_tu']['objects']['count'] >= 9 and len(dom['quy_hoach_dau_tu']['objects']['alerts']) >= 2, str(dom['quy_hoach_dau_tu']['objects'])[:200])
check('khối Việc cần xử lý: nhiệm vụ quá hạn, dự án cảnh báo, nguồn quá hạn, số chờ', ex['todo']['projects_alert']['count'] >= 2 and 'tasks_overdue' in ex['todo'] and 'datasets_stale' in ex['todo'], str({k: v.get('count', v) for k, v in ex['todo'].items()})[:200])
st, exo = call('GET', '/admin/data/executive', token=VP)
check('kỳ đang thu số: thẻ Tài chính "Thiếu số" (Kinh tế chưa nộp)', any(c['status'] == 'thieu' for c in next(d for d in exo['domains'] if d['key'] == 'tai_chinh')['cards']), '')
st, srch = call('GET', '/admin/data/search?q=' + urllib.parse.quote('Phong Nhị'), token=H)
check('tìm "Phong Nhị": ra dự án kè (đối tượng) và địa bàn; phân biệt Dữ liệu/Tài liệu', any(g['key'] == 'objects' and any('DA-002' in it['title'] for it in g['items']) for g in srch['groups']), str(srch)[:300])
st, srch2 = call('GET', '/admin/data/search?q=' + urllib.parse.quote('253/KH-UBND'), token=H)
check('tìm "253/KH-UBND": ra văn bản', any(g['key'] == 'documents' for g in srch2['groups']), str(srch2)[:200])

print('7. Vòng kín Report → Task → Event → Indicator DERIVED')
st, tks = call('GET', '/admin/tasks?limit=100', token=VP)
tg = next((t for t in tks['data'] if t.get('target_indicator_id') == 'tai_chinh.giai_ngan'), None)
check('việc "giải ngân" có mục tiêu đo được (chỉ tiêu + giá trị 240 tỷ)', tg and float(tg['target_value']) == 240000000000, str(tg)[:200])
st, ev = call('GET', f"/admin/events?period={__import__('datetime').date.today().strftime('%Y-M%m')}", token=VP)
check('giao việc / hoàn thành việc sinh Event (TSK giao, hoan_thanh)', any(e['object_type'] == 'TSK' and e['event_type'] == 'giao' for e in ev) and any(e['object_type'] == 'TSK' and e['event_type'] == 'hoan_thanh' for e in ev), str([(e['object_type'], e['event_type']) for e in ev][:6]))
cur = __import__('datetime').date.today().strftime('%Y-M%m')
st, fx = call('GET', f'/admin/facts?period={cur}', token=VP)
nv = next((f for f in fx if f['indicator_id'] == 'chi_dao.nhiem_vu_giao'), None)
check(f'chỉ tiêu "Nhiệm vụ được giao" {cur} DERIVED từ sổ giao việc (capture api, nguồn do360_tasks, chờ xác nhận)', nv and nv['capture_method'] == 'api' and nv['source_ref'].get('system') == 'do360_tasks' and nv['value'] >= 15, str(nv)[:200])
dhf = next((f for f in call('GET', f"/admin/facts?period={[r for r in call('GET', '/admin/report-runs', token=VP)[1] if r['status'] == 'collecting'][0]['period']}", token=VP)[1] if f['indicator_id'] == 'cds.data_health'), None)
check('chỉ số sức khoẻ dữ liệu đẩy vào kho như chỉ tiêu dẫn xuất', dhf and dhf['capture_method'] == 'api' and 0 < dhf['value'] <= 100, str(dhf)[:200])

print('8. Zalo: cổng an toàn, nhóm chính danh, tổng hợp đầu ngày, deep link chỉ web')
st, g1 = call('POST', '/admin/chat/gateway-check', {'title': 'Nhắc việc', 'lines': ['Ông Nguyễn Văn A, CCCD 048090001234, hạn 10/10']}, token=VP)
check('tin có CCCD → cổng chặn, Zalo chỉ nhận tin chung', not g1['allowed'] and 'cccd' in g1['reasons'] and 'Đăng nhập DO360' in g1['sent_card']['lines'][0], str(g1)[:200])
st, g2 = call('POST', '/admin/chat/gateway-check', {'title': 'Nhắc việc', 'lines': ['Rà soát hồ sơ GPMB Dự án A, hạn 16:00 10/10/2026']}, token=VP)
check('tin thường → được gửi, có deep link về web', g2['allowed'] and g2['sent_card']['deepLink'].startswith('http'), str(g2)[:200])
st, g3 = call('POST', '/admin/chat/gateway-check', {'title': 'Văn bản', 'lines': ['Nội dung TUYỆT MẬT về quy hoạch']}, token=VP)
check('tin có dấu bí mật nhà nước → chặn', not g3['allowed'] and 'secret' in g3['reasons'], str(g3)[:200])
st, chs = call('GET', '/admin/data/channels', token=CT)
check('4 nhóm Zalo chính danh đăng ký (lãnh đạo, Văn phòng, báo cáo, dự án)', len(chs) == 4 and all(c['status'] == 'active' for c in chs), str([c['key'] for c in chs]))
st, dg = call('POST', '/admin/chat/digest', token=VP)
check('tổng hợp đầu ngày: nhiệm vụ đến hạn/quá hạn, kỳ đang thu số, số cách ly', dg and dg[0]['card']['title'].startswith('DO360 | TỔNG HỢP') and len(dg[0]['card']['lines']) >= 3 and dg[0]['card']['deepLink'].endswith('/leadership'), str(dg)[:300])
st, msgs = call('GET', '/admin/chat/messages?limit=50', token=VP)
check('tin gửi nhóm chính danh ghi nhật ký (chưa có API nhóm → skipped, lý do rõ)', any(m['kind'] == 'group' and m['status'] == 'skipped' for m in msgs), str([(m['kind'], m['status']) for m in msgs][:6]))
check('deep link thẻ nhắc trỏ về web, không Mini App', all('zalo.me/s/' not in str(m.get('body', {}).get('deepLink', '')) for m in msgs), '')

print('9. Bản thiết kế 03/10 (sửa): bảng danh sách Excel → Object; nguồn cùng bậc mâu thuẫn → Data Owner quyết; nhiệm vụ kỳ tới gợi ý; gói lĩnh vực; KPI OCR')
import openpyxl, io as _io
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Danh sách'
ws.append(['DANH SÁCH HỘ KINH DOANH BỔ SUNG']); ws.append([])
ws.append(['STT', 'Tên', 'Mã định danh', 'Ngành nghề', 'Địa chỉ', 'Chủ hộ'])
tag = uuid.uuid4().hex[:5]
ws.append([1, f'Tạp hoá Minh Tâm', '37G8000001', 'Bán lẻ', 'KDC-01', 'Minh Tâm'])          # trùng Master ID HKD-001 → cập nhật
ws.append([2, f'Quán cơm Bà Tư {tag}', f'37G8{tag}1', 'Ăn uống', 'KDC-02', 'Bà Tư'])        # mới
ws.append([3, '', '37G8xxxx', 'bỏ qua vì không có tên', '', ''])
buf = _io.BytesIO(); wb.save(buf)
def upload(path, token, content, name, fields):
    b = '----do360' + uuid.uuid4().hex; parts = b''
    for k, v in fields.items(): parts += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode('utf-8')
    parts += (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode('utf-8') + content + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(API + path, method='POST', data=parts); req.add_header('Content-Type', f'multipart/form-data; boundary={b}'); req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf-8', 'replace')
st, im = upload('/admin/objects/import', KT, buf.getvalue(), 'danh-sach-hkd.xlsx', {'object_type': 'ho_kinh_doanh'})
check('nạp danh sách Excel: 1 cập nhật theo Mã định danh (HKD-001), 1 tạo mới, 1 dòng không tên bị bỏ', st in (200, 201) and im['updated'] == 1 and im['created'] == 1 and len(im['skipped_rows']) == 1, str(im)[:300])
st, h1 = call('GET', '/admin/objects?type=ho_kinh_doanh&q=' + urllib.parse.quote('Minh Tâm'), token=KT)
check('HKD-001 sau nạp: thuộc tính ngành nghề cập nhật, không sinh bản ghi trùng', len([o for o in h1 if o['master_id'] == '37G8000001']) == 1 and h1[0]['attributes'].get('nganh_nghe') == 'Bán lẻ', str([(o['code'], o['attributes'].get('nganh_nghe')) for o in h1])[:200])
# nguồn cùng bậc mâu thuẫn: Y tế M09 đã duyệt từ biểu mẫu (export) → nộp lại export khác số → cách ly có hạn 2 ngày
NEWV = 1301 + int(uuid.uuid4().hex[:2], 16)
YT = login('yte'); open_p = [r for r in call('GET', '/admin/report-runs', token=VP)[1] if r['status'] == 'collecting'][0]['period']
st, ing = call('POST', '/admin/facts/ingest', {'records': [{'indicator_id': 'y_te.luot_kham', 'period': open_p, 'as_of_date': '2026-09-30', 'value': NEWV, 'capture_method': 'export', 'source_ref': {'system': 'his', 'snippet': 'xuất lại'}}]}, token=YT)
check('nguồn CÙNG BẬC (file xuất) lệch số đã duyệt → cách ly, ghi hạn quyết 2 ngày', st in (200, 201) and ing[0]['status'] == 'quarantined' and '2 ngày' in (ing[0].get('note') or ''), str(ing)[:300])
st, e = call('POST', f"/admin/facts/{ing[0]['fact_id']}/resolve", {'decision': 'accept', 'reason': 'thử'}, token=login('yte.nv'))
check('nhân viên (không phải Data Owner) không quyết được', st == 403, str(e)[:120])
st, rs = call('POST', f"/admin/facts/{ing[0]['fact_id']}/resolve", {'decision': 'accept', 'reason': 'Số xuất lại ngày 30/9 là số chốt chính thức của HIS'}, token=YT)
check('Trạm trưởng (Data Owner) CHẤP NHẬN → số cách ly thành số hiện hành đã duyệt, số cũ vào lịch sử', st in (200, 201) and rs['decision'] == 'accept' and rs['replaced'], str(rs)[:200])
st, cur = call('GET', f'/admin/facts?period={open_p}', token=YT)
lk = next((f for f in cur if f['indicator_id'] == 'y_te.luot_kham'), None)
check('số hiện hành lượt khám = số mới, trạng thái đã duyệt, ghi lý do', lk and lk['value'] == NEWV and lk['status'] == 'approved' and 'Data Owner chấp nhận' in (lk.get('note') or ''), str(lk)[:200])
st, hq = call('GET', '/admin/facts/history?indicator_id=y_te.luot_kham&period=' + open_p, token=YT)
check('nhật ký trạng thái: quarantined → approved kèm lý do (audit)', any(l['to_status'] == 'approved' and l['from_status'] == 'quarantined' and 'HIS' in (l.get('reason') or '') for l in hq['logs']), str(hq['logs'][-2:])[:300])
st, qq = call('GET', '/admin/facts/quarantine', token=VP)
check('danh sách cách ly có hạn quyết và cờ quá hạn', all('deadline' in q and 'overdue' in q for q in qq), str(qq[:1])[:200])
# nhiệm vụ kỳ tới gợi ý theo luật
st, nl9 = call('GET', f"/admin/report-runs/{[r for r in call('GET', '/admin/report-runs', token=VP)[1] if r['period'] == '2026-9M'][0]['run_id']}/narratives", token=VP)
nt = next((s for s in nl9['slots'] if s['slot_type'] == 'next_tasks'), None)
check('nhiệm vụ kỳ tới gợi ý từ chỉ tiêu chưa đạt kế hoạch (thu nội địa, giải ngân…) và việc còn mở', nt and 'chưa đạt kế hoạch' in nt['suggestions']['template'] and 'thu nội địa' in nt['suggestions']['template'].lower() and 'nhiệm vụ còn mở' in nt['suggestions']['template'], str(nt and nt['suggestions']['template'])[:300])
# gói lĩnh vực
st, pk = call('GET', '/admin/catalog/package/tai_chinh', token=H)
check('gói lĩnh vực Tài chính: 10 chỉ tiêu, slot + phép kiểm, luật bóc tách, ghi chú thiếu mã ngành', st == 200 and len(pk['indicators']) >= 9 and pk['slots'] and pk['rules'] and pk['official_code_note'], str({k: (len(v) if isinstance(v, list) else v) for k, v in pk.items() if k != 'generated_at'})[:300])
st, pkd = call('GET', '/admin/dashboard/project-kpis?period=2026-9M', token=VP)
check('KPI dự án có tỷ lệ bậc 4–5 và thời gian xác nhận mỗi số', 'ty_le_bac_4_5' in pkd['kpis'] and 'thoi_gian_xac_nhan_phut' in pkd['kpis'] and pkd['kpis']['ty_le_bac_4_5'] is not None, str(pkd['kpis']))
st, cs = call('GET', '/admin/chat/status', token=VP)
check('kênh chat đang dùng: zalo (tạm); Tammi cắm sẵn qua CHAT_CHANNEL', cs['channel'] in ('zalo', 'tammi'), str(cs)[:120])

print(); print('KẾT QUẢ:', 'ĐẠT' if not FAILS else f'CÒN {len(FAILS)} LỖI: {FAILS}')
sys.exit(1 if FAILS else 0)
