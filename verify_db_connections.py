#!/usr/bin/env python3
"""
🔎 خريطة دورة حياة اتصالات قاعدة البيانات (تحليل ساكن بـ AST) — قراءة فقط، بلا تنفيذ.

ما يفعله:
  1) يجد كل دالة تستدعي `get_connection()` أو `psycopg.connect()` في كل ملفات المشروع.
  2) لكل دالة: عدد مرات الحجز (acquire) وعدد مرات `.close()`/`__exit__`، وهل يوجد
     `finally` يقفل، وهل الدالة تُرجِع الاتصال نفسه (تسريب بالتصميم).
  3) يحسب «معامل الاتصالات» لكل نقطة نهاية: اتصالات مباشرة + اتصالات الدوال المساعدة
     المعروفة (get_user_role / get_effective_permissions / is_* / require_* …).
  4) يطبع أسوأ نقاط النهاية من حيث عدد الاتصالات المتزامنة لكل طلب.
  5) يراجع إعدادات الاتصال في db.py (حجز/إعادة محاولة/ميزانية) لتحليل عواصف الإعادة.

التشغيل:  PYTHONIOENCODING=utf-8 python verify_db_connections.py
"""
import ast
import io
import os
import sys
from collections import defaultdict

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

FILES = [
    "main.py", "auth.py", "db.py", "dependencies.py", "realtime.py", "audit.py",
    "routers/missions.py", "routers/users.py", "routers/volunteers.py", "routers/branches.py",
]

# دوال مساعدة تفتح اتصالاتها بنفسها (اتصال واحد لكل استدعاء) — لتحليل معامل الاتصالات
HELPER_CONN_COST = {
    "get_user_role": 1,
    "get_effective_permissions": 1,
    "get_user_branches": 1,
    "authenticate_user": 1,
    "check_permission": 2,     # role + permissions
    "authorize": 3,            # permission + branch (worst case)
    "get_user_roles": 1,
}

ACQUIRE_NAMES = {"get_connection", "connect"}
CLOSE_ATTRS = {"close"}


def parse(path):
    with open(path, "rb") as fh:
        return ast.parse(fh.read().decode("utf-8", "replace"), filename=path)


def calls_in(node):
    """أسماء كل الاستدعاءات داخل الدالة (بلا نزول لدوال متداخلة)."""
    names = []

    class V(ast.NodeVisitor):
        def visit_Call(self, n):
            f = n.func
            if isinstance(f, ast.Name):
                names.append(f.id)
            elif isinstance(f, ast.Attribute):
                names.append(f.attr)
            self.generic_visit(n)

        def visit_FunctionDef(self, n):
            return

        def visit_AsyncFunctionDef(self, n):
            return

        def visit_Lambda(self, n):
            return

    for stmt in node.body:
        V().visit(stmt)
    return names


def acquires(node):
    """عدد مرات حجز اتصال في هذه الدالة تحديداً."""
    count = 0
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            f = child.func
            name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")
            if name in ACQUIRE_NAMES:
                count += 1
    return count


def closes(node):
    """هل توجد .close() أو استخدام `with get_connection()` (سياق يقفل تلقائياً)؟"""
    close_calls = 0
    context_managers = 0
    finally_close = False
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute) and child.func.attr in CLOSE_ATTRS:
            close_calls += 1
        if isinstance(child, (ast.With, ast.AsyncWith)):
            for item in child.items:
                expr = item.context_expr
                if isinstance(expr, ast.Call):
                    f = expr.func
                    name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")
                    if name in ACQUIRE_NAMES:
                        context_managers += 1
        if isinstance(child, ast.Try):
            for handler in child.finalbody:
                for sub in ast.walk(handler):
                    if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) and sub.func.attr in CLOSE_ATTRS:
                        finally_close = True
    return close_calls, context_managers, finally_close


def returns_connection(node):
    for child in ast.walk(node):
        if isinstance(child, ast.Return) and isinstance(child.value, ast.Name):
            if child.value.id in ("connection", "conn", "c"):
                return True
    return False


all_functions = {}
for path in FILES:
    if not os.path.exists(path):
        continue
    tree = parse(path)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            key = f"{path}::{node.name}"
            acquired = acquires(node)
            close_calls, ctx_managers, finally_close = closes(node)
            all_functions[key] = {
                "file": path, "name": node.name, "line": node.lineno,
                "acquired": acquired, "close_calls": close_calls,
                "ctx_managers": ctx_managers, "finally_close": finally_close,
                "calls": calls_in(node), "returns_conn": returns_connection(node),
            }

print("=" * 100)
print("1) الدوال التي تحجز اتصالات مباشِرة — وهل تقفلها؟")
print("=" * 100)
print(f"{'FILE::FUNCTION':<58} {'ACQ':>3} {'CLOSE':>5} {'CTX':>3} {'FIN?':>5}  VERDICT")
suspects = []
for key, info in sorted(all_functions.items()):
    if info["acquired"] == 0:
        continue
    covered = info["close_calls"] >= info["acquired"] or info["ctx_managers"] >= info["acquired"]
    if info["returns_conn"]:
        verdict = "🔴 يُرجِع الاتصال (تسريب محتمل)"
        suspects.append(key)
    elif covered or info["finally_close"]:
        verdict = "🟢 OK"
    elif info["name"].startswith(("get_", "set_", "ensure_", "apply_", "check_")):
        verdict = "🟡 أداة/سكربت (مراجعة يدوية)"
    else:
        verdict = "🔴 بلا إغلاق ظاهر"
        suspects.append(key)
    print(f"{key:<58} {info['acquired']:>3} {info['close_calls']:>5} {info['ctx_managers']:>3} "
          f"{'YES' if info['finally_close'] else 'no':>5}  {verdict}")

print(f"\n   عدد الدوال الحاجزة للاتصالات: {sum(1 for i in all_functions.values() if i['acquired'])}")
print(f"   🔴 مشتبه فيها: {len(suspects)}")
for key in suspects:
    print(f"      - {key}  (line {all_functions[key]['line']})")

print("\n" + "=" * 100)
print("2) معامل الاتصالات لكل نقطة نهاية (اتصالات متزامنة محتملة لكل طلب واحد)")
print("=" * 100)
main_tree = parse("main.py")
rows = []
for node in ast.walk(main_tree):
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
    decorators = []
    for dec in node.decorator_list:
        if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and isinstance(dec.func.value, ast.Name) and dec.func.value.id in ("app", "router"):
            decorators.append(f"{dec.func.attr.upper()} " + (dec.args[0].value if dec.args and isinstance(dec.args[0], ast.Constant) else "?"))
    if not decorators:
        continue
    own = all_functions.get(f"main.py::{node.name}", {})
    names = own.get("calls", [])
    helper_cost = sum(cost for name, cost in HELPER_CONN_COST.items() if name in names)
    total = own.get("acquired", 0) + helper_cost
    rows.append((total, decorators[0], node.name, own.get("acquired", 0), helper_cost, node.lineno))

rows.sort(reverse=True)
print(f"{'CONNS':>5}  {'ROUTE':<45} {'DIRECT':>6} {'HELPERS':>7}  FUNCTION")
for total, route, name, direct, helper, line in rows[:18]:
    print(f"{total:>5}  {route:<45} {direct:>6} {helper:>7}  {name}() line {line}")

dist = defaultdict(int)
for total, *_ in rows:
    dist[total] += 1
print(f"\n   توزيع نقاط النهاية على معامل الاتصالات: {dict(sorted(dist.items()))}")
print(f"   أعلى معامل: {rows[0][0] if rows else 0} اتصالات لطلب واحد | عدد نقاط النهاية: {len(rows)}")

print("\n" + "=" * 100)
print("3) إعدادات الاتصال/الإعادة في db.py")
print("=" * 100)
src = open("db.py", encoding="utf-8", errors="replace").read()
for token in ("CONNECT_TIMEOUT", "MAX_ATTEMPTS", "RETRY_BUDGET_S", "BASE_DELAY_S", "POOLER_PORT"):
    for line in src.splitlines():
        if line.strip().startswith(token):
            print("   " + line.strip())

from urllib.parse import urlparse  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
load_dotenv()
url = os.getenv("DATABASE_URL") or ""
parsed = urlparse(url)
pooler_port = (os.getenv("DB_POOLER_PORT") or "21581").strip()
print(f"\n   DATABASE_URL: host={'set' if parsed.hostname else 'MISSING'} port={parsed.port} "
      f"db={(parsed.path or '').lstrip('/') or '-'} user={'set' if parsed.username else 'MISSING'} "
      f"sslmode={'yes' if 'sslmode' in (parsed.query or '') else 'no'}")
print(f"   الاتصال الحالي على منفذ الـpooler ({pooler_port})؟ "
      f"{'نعم' if parsed.port and str(parsed.port) == pooler_port else 'لا — اتصال مباشر (يستهلك سقف الاتصالات)'}")
print(f"   DB_VIA_POOLER={os.getenv('DB_VIA_POOLER') or '(غير مُعد)'}")
