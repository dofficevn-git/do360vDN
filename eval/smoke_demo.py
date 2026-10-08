# -*- coding: utf-8 -*-
"""Kiểm chứng bộ demo "Phường Điện Bàn Bắc" sau khi chạy infra/reset-demo.sh (GĐ B):
   python eval/smoke_demo.py http://127.0.0.1:3070/api
Khẳng định: 2 kỳ đã ký đúng số; 4 lỗi thật nằm trong lịch sử và bị bắt đúng nhóm; kỳ đang thu số có đúng việc cho 5 vai;
5 vai đăng nhập → 5 trang chủ khác nhau; báo cáo đọc được, mọi số có nguồn; HĐND không thấy số đang thu."""
import io, json, os, sys, urllib.request, yaml

API = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3070/api').rstrip('/')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ACC = yaml.safe_load(io.open(os.path.join(ROOT, 'config', 'demo', 'dien-ban-bac', 'accounts.yaml'), encoding='utf-8'))
PW = ACC['password']
FAILS = []

def call(method, path, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, method=method, data=data)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            t = r.read(); return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode('utf-8', 'replace')
        try: return e.code, json.loads(t)
        except Exception: return e.code, t

def check(name, cond, detail=''):
    print(('  OK   ' if cond else '  FAIL ') + name + (f' — {detail}' if detail and not cond else ''))
    if not cond: FAILS.append(name)

def login(key):
    email = next(a['email'] for a in ACC['accounts'] if a['email'].split('@')[0] == key)
    st, d = call('POST', '/admin/auth/login', {'email': email, 'password': PW}); return d['access_token']

VP = login('vanphong')
st, runs = call('GET', '/admin/report-runs', token=VP)
by_period = {r['period']: r for r in runs if r['status'] != 'cancelled'}

print('1. Ba kỳ: 6 tháng đã ký, 9 tháng đã ký số 436/BC-UBND, một kỳ tháng đang thu số')
r6 = by_period.get('2026-6M'); r9 = by_period.get('2026-9M')
check('6 tháng 2026 đã ký số 301/BC-UBND ngày 15/07/2026', r6 and r6['status'] == 'signed' and r6['signed_number'] == '301/BC-UBND' and str(r6['signed_date']).startswith('2026-07-15'), str(r6)[:200])
check('9 tháng 2026 đã ký số 436/BC-UBND ngày 18/09/2026, chốt 15/9', r9 and r9['status'] == 'signed' and r9['signed_number'] == '436/BC-UBND' and str(r9['signed_date']).startswith('2026-09-18') and str(r9['cutoff_date']).startswith('2026-09-15'), str(r9)[:200])
open_runs = [r for r in runs if r['status'] == 'collecting']
check('đúng một kỳ tháng đang thu số', len(open_runs) == 1 and open_runs[0]['period'][5] == 'M', str([r['period'] for r in open_runs]))
RO = open_runs[0] if open_runs else None

print('2. Bộ số 9 tháng đúng tài liệu thiết kế, có so kế hoạch và cùng kỳ')
snap = r9['fact_snapshot'] if r9 else {}
facts = snap.get('facts', {})
def val(k): return float(facts[k]['value']) if k in facts else None
check('một cửa 17.206 / 17.007 / 16.979 / 28 / 199', [val('tthc.tiep_nhan'), val('tthc.giai_quyet'), val('tthc.truoc_han'), val('tthc.qua_han'), val('tthc.dang_xu_ly')] == [17206, 17007, 16979, 28, 199], str([val(k) for k in ('tthc.tiep_nhan', 'tthc.giai_quyet', 'tthc.truoc_han', 'tthc.qua_han', 'tthc.dang_xu_ly')]))
check('thu NSNN 352,732 tỷ (từ sổ kế toán Excel, bậc file xuất), đơn thư 99/88/11, văn bản 17.939/6.012', val('tai_chinh.thu_ns') == 352_732_000_000 and facts['tai_chinh.thu_ns']['capture_method'] == 'export' and [val('tiep_dan.don_tiep_nhan'), val('tiep_dan.don_da_giai_quyet'), val('tiep_dan.don_dang_xu_ly')] == [99, 88, 11] and val('chi_dao.vb_den') == 17939 and val('chi_dao.vb_di') == 6012, str((val('tai_chinh.thu_ns'), facts.get('tai_chinh.thu_ns', {}).get('capture_method'), val('chi_dao.vb_den'))))
check('HKD 344/442 tiếp cận CĐS, y tế 11.904 lượt khám, 371/371 cán bộ kỹ năng số', [val('kinh_te.hkd_cds_tiep_can'), val('kinh_te.hkd_tong'), val('y_te.luot_kham'), val('cds.can_bo_ky_nang_so')] == [344, 442, 11904, 371], str([val('kinh_te.hkd_cds_tiep_can'), val('kinh_te.hkd_tong'), val('y_te.luot_kham'), val('cds.can_bo_ky_nang_so')]))
cmp = snap.get('comparisons', {})
check('so kế hoạch: thu NSNN dự toán 304,252 tỷ (→ 116%), chi 320 tỷ', cmp.get('tai_chinh.thu_ns', {}).get('plan', {}).get('value') == 304_252_000_000 and cmp.get('tai_chinh.chi_ns', {}).get('plan', {}).get('value') == 320_000_000_000, str(cmp.get('tai_chinh.thu_ns'))[:200])
check('so cùng kỳ 2025 và kỳ trước (6 tháng) đóng băng trong snapshot', cmp.get('tthc.tiep_nhan', {}).get('same_period_last_year', {}).get('period') == '2025-9M' and cmp.get('tthc.tiep_nhan', {}).get('previous', {}).get('period') == '2026-6M', str(cmp.get('tthc.tiep_nhan'))[:200])
check('ngoại lệ ngày chốt ghi trong snapshot: 5 bộ phận chốt lệch, sáu mốc từ 16/8 đến 18/9', len({e['indicator_id'].split('.')[0] for e in snap.get('exceptions', [])}) >= 5 and len({facts[k]['as_of_date'] for k in facts}) == 6 and min(facts[k]['as_of_date'] for k in facts) == '2026-08-16' and max(facts[k]['as_of_date'] for k in facts) == '2026-09-18', str(sorted({facts[k]['as_of_date'] for k in facts})))
check('lời dẫn đóng băng vào snapshot (≥ 4 đoạn)', len(snap.get('narratives', {})) >= 4, str(list(snap.get('narratives', {}).keys())))

print('3. Bốn lỗi thật nằm trong lịch sử')
st, h = call('GET', '/admin/facts/history?indicator_id=tiep_dan.don_da_giai_quyet&period=2026-9M', token=VP)
vs = h['versions']
q84 = next((v for v in vs if float(v['value']) == 84 and v['status'] == 'quarantined'), None)
check('lỗi 1: bản Word 84 bị CÁCH LY vì cả hai phép kiểm sai (84 + 11 ≠ 99; 4 + 0 + 41 ≠ 84), bản Excel 88 là phiên bản sau và đã chốt', q84 and str(q84.get('note', '')).count('không khớp') >= 2 and vs[-1]['status'] == 'locked' and float(vs[-1]['value']) == 88, str([(v['value'], v['status'], v['capture_method'], (v.get('note') or '')[:60]) for v in vs]))
st, h = call('GET', '/admin/facts/history?indicator_id=tai_chinh.thu_ns&period=2026-9M', token=VP)
vs = h['versions']
pdfv = next((v for v in vs if v['capture_method'] == 'pdf_text'), None)
check('lỗi 2: bản PDF "352.732 tỷ" bóc thành số mơ hồ (tin cậy ≤ 0,6), bản sổ kế toán thay thế', pdfv and float(pdfv['confidence']) <= 0.6 and float(pdfv['value']) != 352_732_000_000 and vs[-1]['capture_method'] == 'export' and vs[-1]['status'] == 'locked', str([(v['value'], v['status'], v['capture_method'], v['confidence']) for v in vs]))
st, nl = call('GET', f"/admin/report-runs/{r9['run_id']}/narratives", token=VP)
kt = next((s for s in nl['slots'] if s['slot_code'] == 'kinh_te.loi_dan'), None)
check('lỗi 3: lời dẫn kinh tế có bản chấp nhận cuối không còn "6 tháng đầu năm"', kt and kt['accepted'] and '6 tháng đầu năm' not in kt['accepted']['text'], str(kt and kt['accepted'])[:200])
gr = r9.get('gate_report') or {}
check('lỗi 4: gate lúc chốt ghi cảnh báo ngày chốt (đã có lý do) và không còn lỗi', gr.get('ok') is True and any(w.get('kind') == 'cutoff_mismatch' for w in gr.get('warnings', [])), str({k: (len(v) if isinstance(v, list) else v) for k, v in gr.items() if k in ('ok', 'errors', 'warnings')}))

print('4. Kỳ đang thu số: mỗi vai có việc')
st, det = call('GET', f"/admin/report-runs/{RO['run_id']}", token=VP)
g = det['gate']
check('gate kỳ đang mở còn lỗi (Kinh tế chưa nộp) → chưa chốt được', not g['ok'] and any(e['kind'] == 'missing' and e.get('owner_dept') == 'kinh_te' for e in g['errors']), str([(e['kind'], e.get('owner_dept')) for e in g['errors']][:8]))
st, pr = call('GET', f"/admin/report-runs/{RO['run_id']}/progress-by-dept", token=VP)
state = {d['key']: d for d in pr['departments']}
check('tiến độ theo bộ phận: Kinh tế chưa nộp, Văn phòng đủ, Một cửa chờ duyệt, Công an chờ xác nhận', state.get('kinh_te', {}).get('state') == 'not_started' and state.get('van_phong', {}).get('state') == 'done' and state.get('hanh_chinh_cong', {}).get('indicators', {}).get('confirmed') == 6 and state.get('cong_an', {}).get('indicators', {}).get('extracted', 0) >= 7, str({k: (v['state'], v['indicators']) for k, v in state.items()})[:400])
check('đã nhắc Kinh tế ít nhất 1 lần (ghi nhật ký kênh chat)', state.get('kinh_te', {}).get('reminds', 0) >= 1, str(state.get('kinh_te'))[:200])
st, q = call('GET', '/admin/facts/quarantine', token=VP)
check('Y tế có 1 số nhập tay bị cách ly (lệch số file xuất đã duyệt)', any(x['indicator_id'] == 'y_te.luot_kham' and x['period'] == RO['period'] for x in q), str([(x['indicator_id'], x['period']) for x in q]))

print('5. Năm vai → năm trang chủ; HĐND không thấy số đang thu')
homes = {}
for key, exp in (('vanphong', '/dashboard'), ('chutich', '/sign'), ('hdnd', '/read'), ('motcua', '/my'), ('motcua.truong', '/approve')):
    t = login(key); st, w = call('GET', '/admin/me/work', token=t); homes[key] = w['me']['home']
    check(f'{key} → trang chủ {exp}', w['me']['home'] == exp, str(w['me']))
check('5 trang chủ khác nhau', len(set(homes.values())) == 5, str(homes))
t = login('motcua.truong'); st, w = call('GET', '/admin/me/work', token=t)
check('Giám đốc Một cửa (Data Owner) thấy 6 số chờ duyệt của phòng mình', w['me']['is_data_owner'] and len([x for x in w.get('awaiting_approval', []) if x['owner_dept'] == 'hanh_chinh_cong']) == 6 and all(x['owner_dept'] == 'hanh_chinh_cong' for x in w.get('awaiting_approval', [])), str([(x['indicator_id'], x['owner_dept']) for x in w.get('awaiting_approval', [])])[:300])
t = login('congan'); st, w = call('GET', '/admin/me/work', token=t)
check('cán bộ Công an thấy 7 số chờ xác nhận, không phải Data Owner', not w['me']['is_data_owner'] and w['periods'] and w['periods'][0]['counts']['extracted'] >= 7, str(w['periods'] and w['periods'][0]['counts']))
t = login('chutich'); st, w = call('GET', '/admin/me/work', token=t)
check('Chủ tịch thấy hàng chờ ký (0 vì đã ký hết) và 2 báo cáo đã ký', isinstance(w.get('to_sign'), list) and len(w['signed']) == 2, str((w.get('to_sign'), [r['signed_number'] for r in w['signed']])))
H = login('hdnd'); st, lr = call('GET', '/admin/report-runs', token=H)
check('HĐND chỉ thấy 2 kỳ đã chốt/ký, không thấy kỳ đang thu', len(lr) == 2 and all(r['status'] == 'signed' for r in lr), str([(r['period'], r['status']) for r in lr]))
st, e = call('GET', f"/admin/report-runs/{RO['run_id']}", token=H)
check('HĐND mở kỳ đang thu → bị từ chối', st == 403, str(st))
st, e = call('POST', '/admin/facts/approve', {'ids': ['1']}, token=login('motcua'))
check('chuyên viên Một cửa tự duyệt → bị từ chối (Data Owner mới được duyệt)', st in (403, 400), str(e)[:160])

print('6. Đọc báo cáo: mọi con số có nguồn; tài khoản demo trên trang đăng nhập')
st, pv = call('GET', f"/admin/report-runs/{r9['run_id']}/preview", token=H)
segs = [g for s in pv['document']['sections'] for sl in s['slots'] for g in sl.get('segments', []) if g['kind'] in ('number', 'ratio', 'plan', 'yoy', 'prev')]
check(f'báo cáo 9 tháng: {len(segs)} mảnh số, 100% có nguồn (fact_id hoặc công thức)', len(segs) >= 40 and all(g.get('ref') and (g['ref'].get('fact_id') or g['ref'].get('indicator_ids') or g['ref'].get('plan') or g['ref'].get('compare')) for g in segs), str([g for g in segs if not g.get('ref')][:3]))
check('có "đạt … kế hoạch" và "so với cùng kỳ" trong văn bản', any(g['kind'] == 'plan' for g in segs) and any(g['kind'] == 'yoy' for g in segs), str({g['kind'] for g in segs}))
check('chú thích cuối trang có ngoại lệ ngày chốt', any('ngày chốt' in f for f in pv['document']['footnotes']), str(pv['document']['footnotes'])[:200])
st, da = call('GET', '/public/demo/accounts')
check('trang đăng nhập có danh sách tài khoản demo (DEMO_MODE=1)', st == 200 and da.get('enabled') and len(da['accounts']) >= 10, str(da)[:200])
st, tk = call('GET', '/admin/tasks?limit=100', token=VP)
check('≥ 12 việc, có việc giao từ nhiệm vụ kỳ tới', tk['total'] >= 12 and any(t.get('source_type') == 'report_run' for t in tk['data']), str(tk['total']))
st, ks = call('GET', '/admin/kpi/summary?period=2026-9M', token=VP)
check('KPI 9 tháng: có cán bộ được đánh giá, điểm trung bình', ks['totals']['so_can_bo_danh_gia'] >= 5 and ks['totals']['diem_trung_binh'] is not None, str(ks['totals']))

print(); print('KẾT QUẢ:', 'ĐẠT' if not FAILS else f'CÒN {len(FAILS)} LỖI: {FAILS}')
sys.exit(1 if FAILS else 0)
