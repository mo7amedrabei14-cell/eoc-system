#!/usr/bin/env python3
"""
🔎 تشخيص قراءة فقط: يسرد كل مسار في main.py مع بوابات المصادقة/الصلاحيات التي يستخدمها.

الغرض: بناء جرد (inventory) دقيق للتدقيق الأمني — لا يعدّل أي شيء ولا يتصل بالقاعدة.
التشغيل:  python diag_route_authz.py
"""
import ast
import io
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

AUTH_HINTS = (
    "get_current_user_id", "authorize", "check_permission", "check_branch_access",
    "get_user_role", "is_youth_role", "is_owner_role", "can_edit_mission_role",
    "require_owner_for_clear", "require_handover_privileged", "require_handover_owner",
    "require_weather_eligible", "require_weather_owner", "is_weather_eligible",
    "is_weather_global", "is_weather_owner", "require_owner_role",
    "RequirePermission", "get_current_user", "get_weather_intel_auth",
    "get_me", "security_optional", "security",
)
# بوابات مخصّصة أخرى (تُطابق بالبادئة)
AUTH_PREFIXES = ("require_", "is_", "check_", "authorize")


def get_source(path):
    with open(path, "rb") as fh:
        return fh.read().decode("utf-8", errors="replace")


def collect_calls(node):
    """يرجع أسماء كل الاستدعاءات والمراجع داخل عقدة (بدون نزول لدوال متداخلة)."""
    names = set()

    class V(ast.NodeVisitor):
        def visit_Call(self, n):
            f = n.func
            if isinstance(f, ast.Name):
                names.add(f.id)
            elif isinstance(f, ast.Attribute):
                names.add(f.attr)
            self.generic_visit(n)

        def visit_Name(self, n):
            names.add(n.id)
            self.generic_visit(n)

        def visit_Attribute(self, n):
            names.add(n.attr)
            self.generic_visit(n)

        def visit_FunctionDef(self, n):  # لا ندخل الدوال المتداخلة
            return

        def visit_AsyncFunctionDef(self, n):
            return

    for stmt in node.body:  # نبدأ من جسم الدالة (لا من الدالة نفسها) حتى لا يوقفنا حارس التداخل
        V().visit(stmt)
    return names


def defaults_names(fn):
    out = set()
    for d in list(fn.args.defaults) + [d for d in fn.args.kw_defaults if d]:
        if isinstance(d, ast.Call):
            f = d.func
            nm = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")
            if nm == "Depends":
                for a in d.args:
                    if isinstance(a, ast.Call):
                        inner = a.func
                        out.add(inner.id if isinstance(inner, ast.Name) else getattr(inner, "attr", "?"))
                    elif isinstance(a, ast.Attribute):
                        out.add("." + a.attr)
                    elif isinstance(a, ast.Name):
                        out.add(a.id)
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "main.py"
    tree = ast.parse(get_source(path))
    rows = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            f = dec.func
            if not isinstance(f, ast.Attribute):
                continue
            if not isinstance(f.value, ast.Name) or f.value.id not in ("app", "router"):
                continue
            method = f.attr.upper()
            path_arg = dec.args[0].value if dec.args and isinstance(dec.args[0], ast.Constant) else "?"
            deps = defaults_names(node)
            calls = collect_calls(node)
            guards = sorted(
                g for g in calls
                if g in AUTH_HINTS or (g.startswith(AUTH_PREFIXES) and g.islower())
            )
            authed = ("get_current_user_id" in calls) or any(
                "security" in d or "get_current_user" in d for d in deps
            )
            rows.append((node.lineno, method, path_arg, authed, sorted(deps), guards))

    rows.sort()
    print(f"{'LINE':>6}  {'METHOD':<6} {'PATH':<52} AUTH?  GUARDS")
    print("─" * 150)
    for line, method, path, authed, deps, guards in rows:
        flag = "YES" if authed else "🔴 NO "
        print(f"{line:>6}  {method:<6} {path:<52} {flag}   {', '.join(guards) or '—'}")
    void = [r for r in rows if not r[3]]
    print("─" * 150)
    print(f"إجمالي المسارات: {len(rows)} | بلا مصادقة ظاهرة: {len(void)}")
    for line, method, path, _, deps, _ in void:
        print(f"   🔴 {method} {path}  (line {line}) deps={deps}")


if __name__ == "__main__":
    main()
