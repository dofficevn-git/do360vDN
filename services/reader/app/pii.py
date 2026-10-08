# -*- coding: utf-8 -*-
"""Phát hiện dữ liệu cá nhân trong file nguồn (CCCD, số điện thoại, email).
Kho DO360 chỉ lưu số tổng hợp; file có dữ liệu cá nhân phải được cảnh báo để bộ phận gửi bản tổng hợp thay vì danh sách."""
import re

_CCCD = re.compile(r"(?<!\d)0\d{11}(?!\d)")                       # CCCD 12 số, bắt đầu bằng 0 (mã tỉnh 0xx)
_PHONE = re.compile(r"(?<!\d)(?:\+84|0)(?:3|5|7|8|9)\d{8}(?!\d)")    # di động VN 10 số
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _mask(s: str) -> str:
    return s[:3] + "…" + s[-2:] if len(s) > 6 else "…"


def scan_pii(texts) -> dict:
    """texts: iterable chuỗi (ô bảng, khối chữ). Trả {cccd, phone, email, samples, warning}."""
    found = {"cccd": set(), "phone": set(), "email": set()}
    for t in texts:
        if not t:
            continue
        s = str(t)
        for m in _CCCD.findall(s):
            found["cccd"].add(m)
        for m in _PHONE.findall(s):
            if m not in found["cccd"]:
                found["phone"].add(m)
        for m in _EMAIL.findall(s):
            found["email"].add(m)
    out = {k: len(v) for k, v in found.items()}
    out["samples"] = [_mask(x) for k in ("cccd", "phone", "email") for x in sorted(found[k])[:2]]
    parts = []
    if out["cccd"]:
        parts.append(f"{out['cccd']} số CCCD")
    if out["phone"]:
        parts.append(f"{out['phone']} số điện thoại")
    if out["email"]:
        parts.append(f"{out['email']} email")
    out["warning"] = ("Phát hiện " + ", ".join(parts) + " — file có dữ liệu cá nhân; kho chỉ lưu số tổng hợp, đề nghị gửi bản tổng hợp.") if parts else None
    return out
