# -*- coding: utf-8 -*-
"""
تنظيف «رقم العضوية» من أسماء الفروع.
قاعدة الأمان: ينظّف بس لو القيمة كلها = أرقام + أسماء فروع (+ رموز/مسافات).
              أي كلمة تانية (زينهم، جامعة الجلالة، الاهرام الكندية، لايوجد…) ⇒ تتساب زي ما هي.

  python clean_membership.py              # معاينة فقط (لا يكتب أي حاجة)
  python clean_membership.py --apply      # تنفيذ فعلي
"""
import os, re, sys
import psycopg
try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

APPLY = '--apply' in sys.argv

DSN = os.getenv('DATABASE_URL')
if not DSN:
    sys.exit('❌ مفيش DATABASE_URL في .env')

SEP = r'[\s\u060C,\.\-–—_\(\)\[\]\{\}"\'«»/\\|:؛]+'
AR  = r'\u0620-\u064A\u0660-\u0669\u066B-\u066C'
DIG = r'[0-9\u0660-\u0669]'

def build(branches):
    """نمط لكل فرع: «ال» اختيارية + مسافات اختيارية + (ة=ه) + (أإآ=ا) + (ي=ى)."""
    alts = set()
    for b in branches:
        b = (b or '').strip()
        if not b: continue
        pre = '(?:ال)?' if (b.startswith('ال') and len(b) > 4) else ''
        if pre: b = b[2:]
        out = []
        for ch in b:
            if ch in 'اأإآٱ':  out.append('[اأإآٱ]')
            elif ch in 'يىئ':  out.append('[يىئ]')
            elif ch in 'ةه':    out.append('[ةه]')
            elif ch.isspace(): out.append(r'\s*')     # شمال سيناء = شمالسيناء
            else:               out.append(re.escape(ch))
        alts.add(pre + ''.join(out))
    body = '|'.join(sorted(alts, key=len, reverse=True))
    return re.compile(rf'(?<![{AR}])(?:{SEP})?(?:{body})(?![{AR}])(?:{SEP})?')

def finalize(s):
    s = re.sub(r'([\(\[\{«"\'])\s*([\)\]\}»"\'])', ' ', s)   # أقواس/تنصيص فاضية
    s = re.sub(r'\s{2,}', ' ', s).strip()
    s = re.sub(r'^[\s\-–—_\(\)\[\]\{\}"\'«»/\\|:؛,\.]+', '', s)
    s = re.sub(r'[\s\-–—_\(\)\[\]\{\}"\'«»/\\|:؛,\.]+$', '', s)
    return s.strip()

def plan(val, pat):
    """يرجع (new, why). new=None ⇒ اتجاهل."""
    raw  = str(val)
    s0   = raw.strip()
    core = finalize(pat.sub(' ', pat.sub(' ', s0)))
    if core == s0 and s0 == raw:
        return None, None                       # مفيش أي تغيير
    if not re.search(DIG, s0) or not re.search(DIG, core):
        return None, 'مفيش رقم'
    rest = re.sub(DIG, ' ', core)
    rest = re.sub(r'[\s\u060C,\.\-–—_\(\)\[\]\{\}"\'«»/\\|:؛]+', ' ', rest).strip()
    if rest:
        return None, f'فيها كلام تاني: {rest}'   # زينهم / الجامعة / الاهرام…
    return core, None

TARGETS = [
    ('mission_participants',          ['membership_number'],   None),
    ('mission_participants',          ['participation_role'],  "participant_type = 'volunteer'"),
    ('volunteers',                    ['membership_number'],   None),
    ('mission_volunteer_room_notes',  ['membership_number'],   None),
]

with psycopg.connect(DSN) as conn:
    with conn.cursor() as cur:
        cur.execute('SELECT branch_name FROM branches WHERE branch_name IS NOT NULL')
        names = [r[0] for r in cur.fetchall()]
        if not names: sys.exit('❌ جدول branches فاضي')
        pat = build(names)

        do, skip_word, skip_num, leftover = [], [], [], {}
        for tbl, cols, where in TARGETS:
            sql = f"SELECT ctid::text, {', '.join(cols)} FROM {tbl}"
            if where: sql += f" WHERE {where}"
            cur.execute(sql)
            for row in cur.fetchall():
                ctid, vals = row[0], row[1:]
                for col, val in zip(cols, vals):
                    if not val: continue
                    new, why = plan(val, pat)
                    if new:
                        do.append((tbl, ctid, col, str(val), new))
                    elif why:
                        (skip_num if why == 'مفيش رقم' else skip_word).append((tbl, col, str(val), why))
                    elif re.search(r'[\u0621-\u064A]', str(val)):
                        k = (tbl, col, str(val).strip())
                        leftover[k] = leftover.get(k, 0) + 1

        print(f'أسماء الفروع من branches: {len(names)}\n')
        print(f'✅ هيتنظّف: {len(do)}')
        for p in do[:70]:
            print(f'   [{p[0]}.{p[2]}]  "{p[3]}"  →  "{p[4]}"')
        if len(do) > 70: print(f'   … و{len(do)-70} كمان')

        print(f'\n🛑 اتجاهل — فيها كلام غير الفرع: {len(skip_word)}')
        for t, c, v, why in skip_word[:30]:
            print(f'   [{t}.{c}]  "{v}"   ← {why}')
        if len(skip_word) > 30: print(f'   … و{len(skip_word)-30} كمان')

        print(f'\n🛑 اتجاهل — مفيش رقم: {len(skip_num)}')
        for t, c, v, _ in skip_num[:15]:
            print(f'   [{t}.{c}]  "{v}"')
        if len(skip_num) > 15: print(f'   … و{len(skip_num)-15} كمان')

        if leftover:
            print('\n🔍 قيم فيها كلام مش أسماء فروع (اتسابت زي ما هي):')
            for (t, c, v), n in sorted(leftover.items(), key=lambda x: -x[1])[:25]:
                print(f'   "{v}"   ({n})  ← {t}.{c}')

        if not APPLY:
            print('\n🔎 معاينة فقط — مفيش أي حاجة اتكتبت.')
            print('   لو عاجبك:  python clean_membership.py --apply')
        else:
            grouped = {}
            for tbl, ctid, col, old, new in do:
                grouped.setdefault((tbl, ctid), {})[col] = (old, new)
            n = 0
            for (tbl, ctid), ch in grouped.items():
                sets  = ', '.join(f'{c} = %s' for c in ch)
                conds = ' AND '.join(f'{c} = %s' for c in ch)
                params = [ch[c][1] for c in ch] + [ctid] + [ch[c][0] for c in ch]
                cur.execute(f'UPDATE {tbl} SET {sets} WHERE ctid = %s::tid AND {conds}', params)
                n += cur.rowcount
            conn.commit()
            print(f'\n✅ اتحدّث {n} صف.')