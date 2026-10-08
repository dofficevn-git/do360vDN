# -*- coding: utf-8 -*-
"""services/reader — T2 (đọc tài liệu) + phần chạy luật của T3. Không lưu gì; API NestJS gọi vào.

POST /extract  multipart: file, rules (JSON: danh sách luật hiệu lực), indicators (JSON: {id: value_type})
  → { file_kind, pages, ocr, matched_rule, records[], misses[], tried[], warnings[] }
POST /parse    multipart: file → cấu trúc đã đọc (gỡ lỗi luật)
GET  /health
"""
from __future__ import annotations
import json
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from .readers import read_any, ocr_available
from .rules import apply_rule
from .pii import scan_pii

app = FastAPI(title="DO360 reader", version="0.1")


@app.get("/health")
def health():
    return {"status": "ok", "ocr": ocr_available()}


@app.post("/parse")
async def parse(file: UploadFile = File(...)):
    data = await file.read()
    try:
        doc = read_any(file.filename, data, allow_ocr=True)
    except RuntimeError as err:
        raise HTTPException(status_code=422, detail=str(err))
    return {
        "file_kind": doc.file_kind, "pages": doc.pages, "ocr": doc.ocr, "warnings": doc.warnings,
        "pii": scan_pii([c.text for t in doc.tables for c in t.cells] + [b.text for b in doc.blocks]),
        "tables": [{"name": t.name, "page": t.page, "cells": [{"ref": c.ref, "row": c.row, "col": c.col, "text": c.text} for c in t.cells[:2000]]} for t in doc.tables],
        "blocks": [{"page": b.page, "bbox": b.bbox, "text": b.text, "confidence": b.confidence} for b in doc.blocks[:2000]],
    }


@app.post("/extract")
async def extract(file: UploadFile = File(...), rules: str = Form("[]"), indicators: str = Form("{}"), domain: str = Form("")):
    data = await file.read()
    try:
        rule_list = json.loads(rules)
        expect_types = json.loads(indicators)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=400, detail=f"rules/indicators không phải JSON: {err}")
    try:
        doc = read_any(file.filename, data, allow_ocr=True)
    except RuntimeError as err:
        raise HTTPException(status_code=422, detail=str(err))

    tried = []
    best = None
    for r in rule_list:
        rule = r.get("rule") if isinstance(r.get("rule"), dict) else r
        if domain and rule.get("domain") and rule.get("domain") != domain:
            continue
        res = apply_rule(doc, rule, expect_types)
        tried.append({"source_type": res.source_type, "version": res.version, "matched": res.matched, "records": len(res.records), "why_not": res.why_not})
        if res.matched and (best is None or len(res.records) > len(best.records)):
            best = res

    out = {"file_kind": doc.file_kind, "pages": doc.pages, "ocr": doc.ocr, "warnings": doc.warnings, "tried": tried,
           "pii": scan_pii([c.text for t in doc.tables for c in t.cells] + [b.text for b in doc.blocks]),
           "matched_rule": None, "records": [], "misses": []}
    if best:
        out["matched_rule"] = f"{best.source_type}@{best.version}"
        out["misses"] = best.misses
        out["records"] = [{"indicator_id": e.indicator_id, "value": e.value, "confidence": round(e.confidence, 3), "source_ref": e.source_ref, "note": e.note} for e in best.records]
    return out
