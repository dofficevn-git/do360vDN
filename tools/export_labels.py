# -*- coding: utf-8 -*-
"""Xuất NHÃN HUẤN LUYỆN Tabot từ vận hành (thiết kế 03/10 "Quy trình huấn luyện Tabot" bước 3–4), chỉ từ dữ liệu đã được người duyệt:
  - extraction.jsonl : cặp (câu/ô gốc trong file nguồn, giá trị cán bộ đã xác nhận/sửa) — nhãn bóc tách; có cả cặp "bóc sai → sửa thành".
  - domain.jsonl     : trích yếu văn bản QLVB + lĩnh vực đã gán — nhãn phân loại sự kiện.
  - narrative.jsonl  : (câu số + sự kiện của mục, đoạn lời dẫn trong BÁO CÁO ĐÃ KÝ) — nhãn viết lời dẫn.
  python tools/export_labels.py http://127.0.0.1:3070/api <email> <mật khẩu> [eval/labels]
Ba điều không làm (theo thiết kế): không lấy số chưa qua người xác nhận; không lấy lời dẫn của kỳ chưa ký; không đưa dữ liệu cá nhân (file nguồn có pii_warning bị bỏ)."""
import json, os, sys, urllib.request, urllib.parse

API, EMAIL, PW = sys.argv[1], sys.argv[2], sys.argv[3]
OUT = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(__file__), '..', 'eval', 'labels')
os.makedirs(OUT, exist_ok=True)

def call(method, path, body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, method=method, data=data); req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read() or b'null')

tok = call('POST', '/admin/auth/login', {'email': EMAIL, 'password': PW})['access_token']
runs = call('GET', '/admin/report-runs', token=tok)
labels = call('GET', '/admin/catalog/labels', token=tok)
pii_files = set()
for r in runs:
    for f in call('GET', f"/admin/files?period={r['period']}", token=tok):
        if f.get('pii_warning'): pii_files.add(f['id'])

# 1. nhãn bóc tách: mọi chỉ tiêu × kỳ có phiên bản từ file (export/pdf_text/ocr) và trạng thái cuối đã xác nhận/duyệt/chốt
n_ext = 0
with open(os.path.join(OUT, 'extraction.jsonl'), 'w', encoding='utf-8') as fo:
    seen = set()
    for r in runs:
        for f in call('GET', f"/admin/facts?period={r['period']}", token=tok):
            key = (f['indicator_id'], f['period'])
            if key in seen: continue
            seen.add(key)
            h = call('GET', f"/admin/facts/history?indicator_id={urllib.parse.quote(f['indicator_id'])}&period={f['period']}", token=tok)
            vs = h['versions']
            final = next((v for v in reversed(vs) if v['status'] in ('confirmed', 'approved', 'locked')), None)
            if not final: continue
            for v in vs:
                if v['capture_method'] not in ('export', 'pdf_text', 'ocr'): continue
                sr = v.get('source_ref') or {}
                if sr.get('file_id') in pii_files or not sr.get('snippet'): continue
                fo.write(json.dumps({'indicator_id': v['indicator_id'], 'indicator_name': labels['indicators'].get(v['indicator_id'], {}).get('name'), 'period': v['period'], 'capture_method': v['capture_method'],
                    'snippet': sr.get('snippet'), 'cell': sr.get('cell'), 'sheet': sr.get('sheet'), 'page': sr.get('page'), 'rule': sr.get('rule'),
                    'extracted_value': float(v['value']), 'confirmed_value': float(final['value']), 'corrected': float(v['value']) != float(final['value']), 'confidence': float(v.get('confidence') or 1),
                    'final_status': final['status']}, ensure_ascii=False) + '\n'); n_ext += 1

# 2. nhãn lĩnh vực văn bản
n_dom = 0
with open(os.path.join(OUT, 'domain.jsonl'), 'w', encoding='utf-8') as fo:
    for d in call('GET', '/admin/qlvb/documents?limit=500', token=tok):
        if not d.get('trich_yeu') or not d.get('domain'): continue
        fo.write(json.dumps({'so_ky_hieu': d.get('so_ky_hieu'), 'loai': d.get('loai'), 'trich_yeu': d['trich_yeu'], 'domain': d['domain'], 'direction': d.get('direction')}, ensure_ascii=False) + '\n'); n_dom += 1

# 3. nhãn lời dẫn: chỉ từ báo cáo đã ký
n_nar = 0
with open(os.path.join(OUT, 'narrative.jsonl'), 'w', encoding='utf-8') as fo:
    for r in runs:
        if r['status'] != 'signed': continue
        pv = call('GET', f"/admin/report-runs/{r['run_id']}/preview", token=tok)
        snap = r.get('fact_snapshot') or {}
        nars = snap.get('narratives') or {}
        for sec in pv['document']['sections']:
            metric = [s['text'] for s in sec['slots'] if s['slot_type'] == 'metric_sentence' and s['text']]
            for s in sec['slots']:
                if s['slot_type'] not in ('narrative', 'next_tasks'): continue
                text = nars.get(s['slot_code']) or s.get('text')
                if not text: continue
                events = [e for e in snap.get('events', []) if not e.get('domain') or any(e['domain'] in (m or '') for m in [''])]
                fo.write(json.dumps({'run_id': r['run_id'], 'period': r['period'], 'signed_number': r.get('signed_number'), 'section': sec['code'], 'section_title': sec['title'], 'slot_code': s['slot_code'],
                    'metric_sentences': metric, 'events': [f"{e.get('payload', {}).get('loai', 'Văn bản')} {e['object_id']} {e['event_date']}" for e in snap.get('events', [])][:20], 'narrative': text}, ensure_ascii=False) + '\n'); n_nar += 1

print(json.dumps({'out': os.path.abspath(OUT), 'extraction': n_ext, 'domain': n_dom, 'narrative': n_nar, 'pii_files_skipped': len(pii_files)}, ensure_ascii=False))
