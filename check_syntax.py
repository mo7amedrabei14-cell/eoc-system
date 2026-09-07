"""Quick syntax check for main.py (writes compiled artifact but doesn't execute it)."""
import py_compile, sys
try:
    py_compile.compile("main.py", doraise=True)
    print("main.py: syntax OK")
except py_compile.PyCompileError as e:
    print("SYNTAX ERROR:", e)
    sys.exit(1)