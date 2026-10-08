# -*- coding: utf-8 -*-
"""T3 — Bộ máy luật bóc tách (docs/GIAO-DIEN.md mục 2). Luật là chỉ dẫn cố định do người viết:
(a) ánh xạ ô/cột, (b) mẫu câu, (c) mẫu vùng, (d) từ điển nhãn, (e) chuẩn hoá số.
Không có mô hình nào phải đoán: luật không khớp → trả 'no_match', không bịa số."""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Optional
from .numbers import parse_vn_number, normalize_label
from .readers import Doc, Table


@dataclass
class Extracted:
    indicator_id: str
    value: float
    confidence: float
    source_ref: dict
    note: Optional[str] = None


@dataclass
class RuleResult:
    source_type: str
    version: int
    matched: bool
    records: list[Extracted] = field(default_factory=list)
    misses: list[str] = field(default_factory=list)   # nhãn trong luật không tìm thấy trong file
    why_not: Optional[str] = None


def _labels_index(rule: dict) -> dict[str, str]:
    """từ điển nhãn: biến thể → nhãn chuẩn (đều đã normalize)."""
    idx = {}
    for canon, variants in (rule.get("labels") or {}).items():
        idx[normalize_label(canon)] = normalize_label(canon)
        for v in variants or []:
            idx[normalize_label(v)] = normalize_label(canon)
    return idx


def _canon(label: str, idx: dict[str, str]) -> str:
    n = normalize_label(label)
    return idx.get(n, n)


# ───────────────────────── (a) ánh xạ ô/cột — Excel / bảng ─────────────────────────

def _find_table(doc: Doc, match: dict) -> Optional[Table]:
    want_sheet = normalize_label(match.get("sheet", "")) if match.get("sheet") else None
    header = normalize_label(match.get("header_contains", "")) if match.get("header_contains") else None
    for t in doc.tables:
        if want_sheet and normalize_label(t.name) != want_sheet and want_sheet not in normalize_label(t.name):
            continue
        if header and not any(header in normalize_label(c.text) for c in t.cells):
            continue
        return t
    return None


def apply_map(doc: Doc, rule: dict, expect_types: dict[str, str]) -> RuleResult:
    res = RuleResult(rule["source_type"], int(rule.get("version", 1)), matched=False)
    t = _find_table(doc, rule.get("match") or {})
    if t is None:
        res.why_not = "không thấy sheet/bảng khớp `match`"
        return res
    res.matched = True
    grid = t.grid()
    idx = _labels_index(rule)
    # cột: ô đầu tiên có chữ khớp tên cột (theo nhãn chuẩn) → chỉ số cột + hàng tiêu đề
    col_of: dict[str, tuple[int, int]] = {}
    for c in t.cells:
        key = _canon(c.text, idx)
        col_of.setdefault(key, (c.col, c.row))
    # hàng: ô có nhãn hàng (thường ở cột A/B) → chỉ số hàng
    row_of: dict[str, int] = {}
    for c in t.cells:
        row_of.setdefault(_canon(c.text, idx), c.row)
    for m in rule.get("map") or []:
        rlabel, clabel, ind = _canon(m["row"], idx), _canon(m["column"], idx), m["indicator"]
        r = row_of.get(rlabel)
        col = col_of.get(clabel)
        if r is None or col is None:
            # thử khớp một phần (nhãn luật nằm trong nhãn file)
            if r is None:
                r = next((row for lab, row in row_of.items() if rlabel in lab), None)
            if col is None:
                col = next((v for lab, v in col_of.items() if clabel in lab), None)
        if r is None or col is None:
            res.misses.append(f"{m['row']} / {m['column']}")
            continue
        cell = grid.get((r, col[0]))
        if cell is None:
            res.misses.append(f"{m['row']} / {m['column']} (ô trống)")
            continue
        try:
            p = parse_vn_number(cell.text, expect_types.get(ind, "integer"))
        except ValueError as err:
            res.misses.append(f"{m['row']} / {m['column']}: {err}")
            continue
        conf = 0.98 if not doc.ocr else 0.85
        if p.ambiguous:
            conf = min(conf, 0.6)
        res.records.append(Extracted(ind, p.value, conf, {"sheet": t.name, "cell": cell.ref, "page": t.page, "snippet": cell.text, "rule": f"{res.source_type}@{res.version}"}, p.note))
    return res


# ───────────────────────── (b) mẫu câu — Word / PDF có lớp chữ ─────────────────────────

_NUM_PATTERN = r"[+-]?\d[\d.,]*(?:\s*%)?"


def _compile(pattern: str) -> re.Pattern:
    """'tiếp nhận {tiep_nhan:number} hồ sơ' → regex có nhóm đặt tên; chữ ngoài {} khớp mềm theo khoảng trắng."""
    tokens: list[str] = []
    pos = 0
    for m in re.finditer(r"\{(\w+)(?::(\w+))?\}", pattern):
        tokens += [re.escape(w) for w in pattern[pos:m.start()].split()]
        tokens.append(rf"(?P<{m.group(1)}>{_NUM_PATTERN})")
        pos = m.end()
    tokens += [re.escape(w) for w in pattern[pos:].split()]
    # mọi từ/nhóm cách nhau bởi khoảng trắng tuỳ ý (kể cả 0) → chịu được xuống dòng, khoảng trắng kép
    return re.compile(r"\s*".join(tokens), re.IGNORECASE)


def apply_sentences(doc: Doc, rule: dict, expect_types: dict[str, str]) -> RuleResult:
    res = RuleResult(rule["source_type"], int(rule.get("version", 1)), matched=False)
    text_blocks = doc.blocks or []
    if not text_blocks:
        res.why_not = "file không có chữ"
        return res
    must = rule.get("match") or {}
    if must.get("text_contains"):
        full = normalize_label(doc.full_text())
        if normalize_label(must["text_contains"]) not in full:
            res.why_not = "không thấy chuỗi nhận dạng trong `match.text_contains`"
            return res
    res.matched = True
    for s in rule.get("sentences") or []:
        rx = _compile(s["pattern"])
        hit = None
        for b in text_blocks:
            m = rx.search(b.text)
            if m:
                hit = (m, b)
                break
        if not hit:
            res.misses.append(s["pattern"])
            continue
        m, b = hit
        for grp, ind in (s.get("groups") or {}).items():
            # mang theo ~16 ký tự sau số để parse_vn_number bắt đơn vị ("41,8 tỷ đồng" → ×1e9; "253.515 tỷ" → mơ hồ)
            raw = m.string[m.start(grp):min(len(m.string), m.end(grp) + 16)]
            try:
                p = parse_vn_number(raw, expect_types.get(ind, "integer"))
            except ValueError as err:
                res.misses.append(f"{s['pattern']} › {grp}: {err}")
                continue
            conf = 0.9 if not doc.ocr else min(0.85, b.confidence)
            if p.ambiguous:
                conf = min(conf, 0.6)
            res.records.append(Extracted(ind, p.value, conf, {"page": b.page, "bbox": list(b.bbox) if b.bbox else None, "snippet": m.group(0)[:160], "rule": f"{res.source_type}@{res.version}"}, p.note))
    return res


# ───────────────────────── (c) mẫu vùng — ảnh màn hình / biểu mẫu scan ─────────────────────────

def apply_regions(doc: Doc, rule: dict, expect_types: dict[str, str]) -> RuleResult:
    """Neo = khối chữ chứa `anchor`; giá trị = khối chữ gần nhất theo hướng `offset` (right|below) có số."""
    res = RuleResult(rule["source_type"], int(rule.get("version", 1)), matched=False)
    blocks = [b for b in doc.blocks if b.bbox]
    if not blocks:
        res.why_not = "không có khối chữ có toạ độ (cần OCR hoặc PDF có lớp chữ)"
        return res
    res.matched = True
    for rg in rule.get("regions") or []:
        anchor = normalize_label(rg["anchor"])
        a = next((b for b in blocks if anchor in normalize_label(b.text)), None)
        if a is None:
            res.misses.append(rg["anchor"])
            continue
        ax0, ay0, ax1, ay1 = a.bbox
        ay = (ay0 + ay1) / 2
        cands = []
        for b in blocks:
            if b is a or b.page != a.page:
                continue
            bx0, by0, bx1, by1 = b.bbox
            by = (by0 + by1) / 2
            if rg.get("offset", "right") == "right" and bx0 >= ax1 - 2 and abs(by - ay) < (ay1 - ay0):
                cands.append((bx0 - ax1, b))
            elif rg.get("offset") == "below" and by0 >= ay1 - 2 and abs((bx0 + bx1) / 2 - (ax0 + ax1) / 2) < (ax1 - ax0):
                cands.append((by0 - ay1, b))
        cands.sort(key=lambda x: x[0])
        picked = None
        for _, b in cands:
            m = re.search(_NUM_PATTERN, b.text)
            if m:
                picked = (b, m.group(0)); break
        if not picked:
            res.misses.append(f"{rg['anchor']}: không thấy số cạnh neo")
            continue
        b, raw = picked
        try:
            p = parse_vn_number(raw, expect_types.get(rg["indicator"], "integer"))
        except ValueError as err:
            res.misses.append(f"{rg['anchor']}: {err}")
            continue
        conf = min(0.85, b.confidence) if doc.ocr else 0.9
        if p.ambiguous:
            conf = min(conf, 0.6)
        res.records.append(Extracted(rg["indicator"], p.value, conf, {"page": b.page, "bbox": list(b.bbox), "snippet": f"{a.text} → {b.text}"[:160], "rule": f"{res.source_type}@{res.version}"}, p.note))
    return res


def apply_rule(doc: Doc, rule: dict, expect_types: dict[str, str]) -> RuleResult:
    kind = rule.get("file_kind")
    if kind == "xlsx" and doc.file_kind != "xlsx":
        return RuleResult(rule["source_type"], int(rule.get("version", 1)), False, why_not=f"luật cho xlsx, file là {doc.file_kind}")
    if kind in ("docx", "pdf_text") and doc.file_kind not in ("docx", "pdf_text", "pdf_scan"):
        return RuleResult(rule["source_type"], int(rule.get("version", 1)), False, why_not=f"luật cho {kind}, file là {doc.file_kind}")
    if kind == "image" and doc.file_kind not in ("image", "pdf_scan", "pdf_text"):
        return RuleResult(rule["source_type"], int(rule.get("version", 1)), False, why_not=f"luật cho ảnh, file là {doc.file_kind}")
    parts = []
    if rule.get("map"):
        parts.append(apply_map(doc, rule, expect_types))
    if rule.get("sentences"):
        parts.append(apply_sentences(doc, rule, expect_types))
    if rule.get("regions"):
        parts.append(apply_regions(doc, rule, expect_types))
    if not parts:
        return RuleResult(rule["source_type"], int(rule.get("version", 1)), False, why_not="luật không có map/sentences/regions")
    merged = RuleResult(rule["source_type"], int(rule.get("version", 1)), matched=any(p.matched for p in parts))
    for p in parts:
        merged.records += p.records
        merged.misses += p.misses
    if not merged.matched:
        merged.why_not = "; ".join(p.why_not for p in parts if p.why_not)
    return merged
