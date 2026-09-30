#!/usr/bin/env python3
"""
🔎 تشخيص قراءة فقط لمشكلة «فشل تحليل أخبار الرادار»:
   1) يسرد النماذج المتاحة فعلاً على مفتاح GEMINI_API_KEY (بدون طباعة المفتاح).
   2) يجرّب كل نموذج مرشّح بطلب صغير جداً (JSON) ويطبع الحالة + سبب الفشل.
لا يكتب في القاعدة ولا يرسل أي خبر للتطبيق.
التشغيل:  PYTHONIOENCODING=utf-8 python diag_ai_models.py
"""
import json
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

KEY = (os.environ.get("GEMINI_API_KEY") or "").strip()
BASE = "https://generativelanguage.googleapis.com/v1beta"
CANDIDATES = [
    os.environ.get("GEMINI_MODEL", "").strip(),
    "gemini-3.6-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
]

if not KEY:
    print("GEMINI_API_KEY missing")
    sys.exit(2)

print(f"key length={len(KEY)} prefix={KEY[:4]}… (value not printed)\n")

print("=== available models (generateContent) ===")
try:
    r = requests.get(f"{BASE}/models", params={"key": KEY}, timeout=30)
    print("list status:", r.status_code)
    if r.ok:
        names = [
            m.get("name", "").replace("models/", "")
            for m in r.json().get("models", [])
            if "generateContent" in (m.get("supportedGenerationMethods") or [])
        ]
        for n in sorted(names):
            print("  -", n)
    else:
        print("  body:", r.text[:300])
except Exception as e:
    print("  list failed:", e)

print("\n=== candidate probe (tiny JSON request) ===")
prompt = 'أعد JSON فقط بالشكل: {"ok": true}'
for model in [c for c in CANDIDATES if c]:
    url = f"{BASE}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 64,
            "responseMimeType": "application/json",
        },
    }
    try:
        resp = requests.post(url, params={"key": KEY}, json=payload, timeout=45)
        ok = resp.status_code == 200
        detail = ""
        if ok:
            try:
                data = resp.json()
                cand = (data.get("candidates") or [{}])[0]
                detail = f"finishReason={cand.get('finishReason')} text={(cand.get('content') or {}).get('parts', [{}])[0].get('text', '')[:40]!r}"
            except Exception as e:  # noqa: BLE001
                detail = f"parse error: {e}"
        else:
            detail = resp.text[:220].replace("\n", " ")
        print(f"[{resp.status_code}] {model:<26} {'✅' if ok else '❌'} {detail}")
    except Exception as e:  # noqa: BLE001
        print(f"[ERR] {model:<26} ❌ {e}")


print("\n=== thinkingConfig variants on the newest free flash ===")
for model in ("gemini-3.8-flash", "gemini-3.5-flash-lite"):
    for label, gen_cfg in (
        ("thinkingBudget=0", {"thinkingBudget": 0}),
        ("thinkingLevel=low", {"thinkingLevel": "low"}),
        ("none", {}),
    ):
        body = {
            "contents": [{"parts": [{"text": 'أعد JSON فقط: [{"title":"x","severity_score":3}]'}]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 256,
                "responseMimeType": "application/json",
                **({"thinkingConfig": gen_cfg} if gen_cfg else {}),
            },
        }
        try:
            resp = requests.post(f"{BASE}/models/{model}:generateContent", params={"key": KEY}, json=body, timeout=60)
            if resp.status_code == 200:
                cand = (resp.json().get("candidates") or [{}])[0]
                txt = (cand.get("content") or {}).get("parts", [{}])[0].get("text", "")
                print(f"[{model:<22}] {label:<20} ✅ finish={cand.get('finishReason')} len={len(txt)} {txt[:60]!r}")
            else:
                print(f"[{model:<22}] {label:<20} ❌ {resp.status_code} {resp.text[:160]}")
        except Exception as e:  # noqa: BLE001
            print(f"[{model:<22}] {label:<20} ❌ {e}")
