# -*- coding: utf-8 -*-
"""Chuẩn hoá số kiểu Việt Nam (luật (e) trong docs/GIAO-DIEN.md).

Quy ước văn bản hành chính VN: dấu chấm phân nghìn, dấu phẩy thập phân. Nhưng số liệu thực tế lẫn lộn
("352.732 tỷ đồng" bên cạnh "304,252 tỷ đồng"). Nguyên tắc: KHÔNG ĐOÁN khi mơ hồ — trả `ambiguous=True`
để hạ độ tin cậy và bắt người xác nhận.
"""
import re
from dataclasses import dataclass
from typing import Optional

UNIT_MULTIPLIER = {
    "tỷ đồng": 1_000_000_000, "tỷ": 1_000_000_000, "ty dong": 1_000_000_000,
    "triệu đồng": 1_000_000, "triệu": 1_000_000, "trieu dong": 1_000_000,
    "nghìn đồng": 1_000, "ngàn đồng": 1_000, "nghìn": 1_000, "ngàn": 1_000,
    "đồng": 1, "đ": 1, "vnđ": 1, "vnd": 1,
}
PERCENT_RE = re.compile(r"^\s*([+-]?[\d.,]+)\s*%\s*$")
NUM_RE = re.compile(r"[+-]?\d[\d.,]*\d|[+-]?\d")


@dataclass
class ParsedNumber:
    value: float
    ambiguous: bool = False
    note: Optional[str] = None
    is_percent: bool = False
    multiplier: int = 1


def _split_groups(core: str):
    """Tách phần nghìn/thập phân theo quy ước VN. Trả (value, ambiguous, note)."""
    s = core.replace(" ", "")
    neg = s.startswith("-")
    s = s.lstrip("+-")
    if not s:
        raise ValueError("rỗng")
    has_dot, has_comma = "." in s, "," in s
    ambiguous, note = False, None
    if has_dot and has_comma:
        # 1.234.567,89 (VN) hoặc 1,234,567.89 (Anh): dấu nào đứng sau cùng là thập phân
        if s.rfind(",") > s.rfind("."):
            intp, frac = s.rsplit(",", 1); intp = intp.replace(".", "")
        else:
            intp, frac = s.rsplit(".", 1); intp = intp.replace(",", "")
            ambiguous, note = True, "dùng dấu chấm thập phân kiểu Anh"
        val = float(f"{intp}.{frac}")
    elif has_dot:
        parts = s.split(".")
        if all(len(p) == 3 for p in parts[1:]) and len(parts[0]) <= 3:
            val = float("".join(parts))                      # 17.206 → 17206
            if len(parts) == 2 and len(parts[1]) == 3:
                # "352.732 tỷ" có thể là 352,732 tỷ viết sai dấu — mơ hồ khi đi kèm đơn vị tiền lớn
                note = "dấu chấm có thể là thập phân viết sai"
        else:
            val = float(s); ambiguous, note = True, "dấu chấm không phải phân nghìn chuẩn"
    elif has_comma:
        parts = s.split(",")
        if len(parts) == 2:
            val = float(f"{parts[0]}.{parts[1]}")             # 253,515 → 253.515
        else:
            val = float("".join(parts)); ambiguous, note = True, "nhiều dấu phẩy"
    else:
        val = float(s)
    return (-val if neg else val), ambiguous, note


def parse_vn_number(text: str, expect_type: str = "integer") -> ParsedNumber:
    """
    "17.206" → 17206; "253,515 tỷ đồng" → 253515000000; "96,3%" → 96.3 (is_percent);
    "352.732 tỷ đồng" → 352732000000000 kèm ambiguous=True.
    """
    t = (text or "").strip().lower()
    if not t:
        raise ValueError("chuỗi rỗng")
    m = PERCENT_RE.match(t)
    if m:
        v, amb, note = _split_groups(m.group(1))
        return ParsedNumber(v, amb, note, is_percent=True)
    m = NUM_RE.search(t)
    if not m:
        raise ValueError(f"không thấy số trong '{text}'")
    core = m.group(0)
    v, amb, note = _split_groups(core)
    rest = t[m.end():].strip(" .;:")
    mult = 1
    for unit in sorted(UNIT_MULTIPLIER, key=len, reverse=True):
        if rest.startswith(unit):
            mult = UNIT_MULTIPLIER[unit]
            break
    if mult >= 1_000_000 and "." in core and "," not in core and note:
        amb = True  # "352.732 tỷ": 352 nghìn tỷ là vô lý ở cấp xã → chắc chắn phải người nhìn lại
    value = v * mult
    if expect_type == "integer" and mult == 1 and abs(value - round(value)) > 1e-9:
        amb, note = True, (note or "") + "; mong số nguyên nhưng có phần thập phân"
    if mult > 1:
        value = round(value)  # tiền quy về đồng
    return ParsedNumber(value, amb, note.strip("; ") if note else None, multiplier=mult)


def normalize_label(s: str) -> str:
    """So khớp nhãn dòng/cột: bỏ dấu câu thừa, gộp khoảng trắng, không phân biệt hoa thường."""
    s = (s or "").strip().lower()
    s = re.sub(r"[\s ]+", " ", s)
    s = re.sub(r"^[\d\.\-–)\s]+(?=[a-zà-ỹ])", "", s)  # bỏ số thứ tự đầu dòng "1. ", "- "
    return s.strip(" .:;")
