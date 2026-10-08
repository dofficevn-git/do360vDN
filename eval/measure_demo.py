# -*- coding: utf-8 -*-
"""Đo bộ demo (cổng GĐ B): mã kỹ thuật lộ trên giao diện = 0; thời gian Văn phòng từ mở kỳ → trình ký (theo nhật ký);
4/4 lỗi thật bị chặn; 5 KPI dự án trên kỳ 9 tháng và kỳ đang mở. Ghi eval/out/demo-measure.json.
   python eval/measure_demo.py http://127.0.0.1:3070/api"""
import datetime as dt, io, json, os, subprocess, sys, urllib.request, yaml

API = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3070/api').rstrip('/')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ACC = yaml.safe_load(io.open(os.path.join(ROOT, 'config', 'demo', 'dien-ban-bac', 'accounts.yaml'), encoding='utf-8'))

def call(method, path, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, method=method, data=data); req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read() or b'null')

tok = call('POST', '/admin/auth/login', {'email': ACC['accounts'][0]['email'], 'password': ACC['password']})['access_token']
out = {'measured_at': dt.datetime.now().isoformat(timespec='seconds')}

# 1. mã kỹ thuật lộ
r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'check_labels.py')], capture_output=True, text=True, encoding='utf-8')
out['ma_ky_thuat_lo'] = 0 if r.returncode == 0 else int(''.join(ch for ch in r.stdout.splitlines()[-1] if ch.isdigit()) or 1)

# 2. thời gian Văn phòng: mở kỳ → trình ký (audit log) cho các kỳ đã ký
logs = call('GET', '/admin/audit-logs?limit=500', token=tok)
rows = logs if isinstance(logs, list) else logs.get('data', [])
runs = call('GET', '/admin/report-runs', token=tok)
times = {}
for run in runs:
    if run['status'] != 'signed': continue
    created = run.get('created_at'); sub = next((l['created_at'] for l in rows if l.get('module') == 'qlvb' and l.get('action') == 'submit' and str(l.get('entity_id') or l.get('target_id') or '') == str(run['run_id'])), None)
    if created and sub:
        t0 = dt.datetime.fromisoformat(created.replace('Z', '+00:00')); t1 = dt.datetime.fromisoformat(sub.replace('Z', '+00:00'))
        times[run['period']] = round((t1 - t0).total_seconds() / 60, 1)
out['phut_mo_ky_den_trinh_ky'] = times

# 3. 4 lỗi thật bị chặn (dựa trên lịch sử số 9 tháng)
r9 = next((r for r in runs if r['period'] == '2026-9M'), None)
caught = {}
if r9:
    h = call('GET', '/admin/facts/history?indicator_id=tiep_dan.don_da_giai_quyet&period=2026-9M', token=tok)
    caught['1_sai_tong_don_thu'] = any(float(v['value']) == 84 and v['status'] == 'quarantined' for v in h['versions'])
    h = call('GET', '/admin/facts/history?indicator_id=tai_chinh.thu_ns&period=2026-9M', token=tok)
    caught['2_so_mo_ho_pdf'] = any(v['capture_method'] == 'pdf_text' and float(v['confidence']) <= 0.6 for v in h['versions'])
    nl = call('GET', f"/admin/report-runs/{r9['run_id']}/narratives", token=tok)
    kt = next((s for s in nl['slots'] if s['slot_code'] == 'kinh_te.loi_dan'), None)
    caught['3_loi_dan_sai_ky'] = bool(kt and kt['latest'] and kt['latest']['version'] >= 3)
    gr = r9.get('gate_report') or {}
    caught['4_ngay_chot_lech'] = any(w.get('kind') == 'cutoff_mismatch' for w in gr.get('warnings', []))
out['loi_that_bi_chan'] = f"{sum(1 for v in caught.values() if v)}/4"; out['chi_tiet_loi'] = caught

# 4. 5 KPI dự án
out['kpi_du_an'] = {}
for p in ['2026-9M'] + [r['period'] for r in runs if r['status'] == 'collecting']:
    out['kpi_du_an'][p] = call('GET', f'/admin/dashboard/project-kpis?period={p}', token=tok).get('kpis')

os.makedirs(os.path.join(ROOT, 'eval', 'out'), exist_ok=True)
json.dump(out, io.open(os.path.join(ROOT, 'eval', 'out', 'demo-measure.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(json.dumps(out, ensure_ascii=False, indent=2))
