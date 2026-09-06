import os
import psycopg
from dotenv import load_dotenv
load_dotenv(r"C:\Users\mo7am\OneDrive\Work\EOC System\.env")

src = open(r"C:\Users\mo7am\OneDrive\Work\EOC System\main.py", encoding="utf-8").read()

# Locate the HR query: it starts right before 'WITH ident AS ('
idx = src.index("WITH ident AS (")
open_tri = src.rfind('cursor.execute("""', 0, idx)
start = open_tri + len('cursor.execute("""')
# closing triple-quote: the next '\n            """)' (Python close) after start
end_marker = '\n            """)' if '\n            """)' in src[start:] else '""")'
end = src.index('"")', start) + 2 if '"")' in src[start:] else start
# find the closing triple quote more robustly: search for the pattern """ on its own line then )
import re
m = re.search(r'\n\s+"""\)', src[start:])
if not m:
    raise SystemExit("closing not found")
end = start + m.start() + 1  # include just before the triple quote
sql = src[start:end]

# keep only the executed SQL body: it begins with '\n                WITH'
s2 = sql[sql.index('WITH ident AS'):]

conn = psycopg.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()
cur.execute(s2)
rows = cur.fetchall()
cols = [d[0] for d in cur.description]
print("COLUMNS:", cols)
print("="*70)
for r in rows:
    print(r)
conn.close()
