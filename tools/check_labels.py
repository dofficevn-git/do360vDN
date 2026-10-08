# -*- coding: utf-8 -*-
"""Quét giao diện web + Mini App tìm mã kỹ thuật lộ ra ngoài khối <TechDetails> (nguyên tắc "nói tiếng cán bộ, giấu mã").
   python tools/check_labels.py        → exit 1 nếu còn vi phạm
Luật: trong JSX, các biểu thức sau không được in trực tiếp cho người dùng trừ khi nằm trong dòng có TechDetails/title=/key=/href=/value=:
  {x.indicator_id}  {x.slot_code}  {x.spec_code}  {x.criterion_id}  {x.period}  {x.status}  {x.kind}  {x.source_type}  {x.channel}  {x.key}  JSON.stringify(...)
Dòng có ghi chú `// tech-ok` được bỏ qua (cố ý, ví dụ ô mã trên trang Danh mục cấu hình)."""
import io, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), '..')
TARGETS = [
    os.path.join(ROOT, 'apps', 'web', 'src', 'app'),
    os.path.join(ROOT, '..', 'zalo-smart-commune-v2', 'apps', 'miniapp', 'src', 'pages'),
]
ALLOW_FILES = {'catalog/page.tsx', 'audit-logs/page.tsx', 'accounts/invitations/page.tsx'}  # trang cấu hình / nhật ký kỹ thuật
# (?<![=]) : bỏ qua khi là prop JSX (period={x.period}, status={f.status})
PATTERNS = [
    r"(?<![=])\{[\w.]+\.indicator_id\}", r"(?<![=])\{[\w.]+\.slot_code\}", r"(?<![=])\{[\w.]+\.spec_code\}", r"(?<![=])\{[\w.]+\.criterion_id\}",
    r"(?<![=])\{[\w.]+\.period\}", r"(?<![=])\{[\w.]+\.status\}", r"(?<![=])\{[\w.]+\.kind\}", r"(?<![=])\{[\w.]+\.source_type\}", r"(?<![=])\{[\w.]+\.channel\}", r"(?<![=])\{[\w.]+\.key\}",
    r"\(\{[\w.]+\.status\}\)", r"JSON\.stringify\(",
    r"\$\{[\w.]+\.period\}", r"\$\{[\w.]+\.indicator_id\}", r"\$\{[\w.]+\.status\}",
]
SAFE = re.compile(r"TechDetails|title=|key=|href=|value=|queryKey|queryFn|apiGet|api\.(get|post|patch)|tech-ok|navigate\(|params\.get|mutate\(|onChange|\.includes\(|===|!==|\? |filter\(|find\(|map\(\(")

def scan(path, rel):
    bad = []
    for n, line in enumerate(io.open(path, encoding='utf-8'), 1):
        if 'tech-ok' in line or 'TechDetails' in line: continue
        hits = [p for p in PATTERNS if re.search(p, line)]
        if not hits: continue
        # chỉ bắt dòng có vẻ là JSX hiển thị (có '<' hoặc '>' và không phải logic thuần)
        if '<' not in line and '`' not in line: continue
        if SAFE.search(line) and not re.search(r">\s*\{[\w.]+\.(indicator_id|slot_code|spec_code|criterion_id|period|status|kind|source_type|channel|key)\}", line):
            continue
        bad.append((n, line.strip()[:140], hits))
    return bad

total = 0
for base in TARGETS:
    base = os.path.abspath(base)
    if not os.path.isdir(base): continue
    for dp, _, fns in os.walk(base):
        for fn in fns:
            if not fn.endswith('.tsx'): continue
            p = os.path.join(dp, fn); rel = os.path.relpath(p, base).replace('\\', '/')
            if any(rel.endswith(a) for a in ALLOW_FILES): continue
            for n, line, hits in scan(p, rel):
                total += 1; print(f"{rel}:{n}: {line}")
print(f"\n{'OK — không còn mã kỹ thuật lộ' if total == 0 else f'CÒN {total} chỗ lộ mã kỹ thuật'}")
sys.exit(1 if total else 0)
