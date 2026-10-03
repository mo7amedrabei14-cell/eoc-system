"""🧪 اختبار منع ضياع أرقام الطقس — منطق العميل فقط، بلا أي كتابة على قاعدة بيانات.

المشكلة المُبلَّغة: الشباب بيكتبوا بسرعة، فazen committing وأرقامهم بتتحفظش أو بتتغير.

الأسباب الثلاثة المغطّاة هنا:
  ① سباق الحفظ: المستخدم يكتب أثناء رحلة الطلب ⇒ الكود القديم كان يمسح الرقم الجديد مع القديم.
  ② التحديث السليلي: loadGrid كان يستبدل formValues كاملاً فيمسح أرقام جارية.
  ③ رقم غير رقمي: Number('abc') = NaN ⇒ JSON null ⇒ عند السيرفر تعني «امسح الخلية».
"""
import io
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

FAILS = []
SRC = open("frontend/src/Dashboard.jsx", encoding="utf-8").read()


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"   [{detail}]" if detail else ""))
    if not cond:
        FAILS.append(name)


def region(fn_name, span=9000):
    """نص الدالة كاملةً ابتداءً من اسمها."""
    i = SRC.index(fn_name)
    return SRC[i:i + span]


print("=" * 78)
print("🧪 اختبار منع ضياع أرقام الطقس — EOC System")
print("=" * 78)

# ── ① سباق الحفظ ─────────────────────────────────────────────────────────
print("\n[1] سباق الحفظ — الرقم المكتوب أثناء رحلة الطلب لا يُمسح")
r = region("const flushWeatherSave = async")
check("المسح مؤكَّد على مستوى الخلية (dropPendingCells)", "dropPendingCells(group.date, group.shift, sentByBranch)" in r)
check("المسح القديم بالفروع لم يعد يُستخدم بعد نجاح الحفظ",
      "dropPending(group.date, group.shift, savedIds)" not in r,
      "المسح بالفروع = ضياع الأرقام الجديدة")
check("تسجيل ما خرج فعلاً لكل خلية (sentByBranch)",
      "sentByBranch[String(r.branch_id)] = r.__sent" in r)
check("__sent لا يخرج على الشبكة", ".map(({ __sent, ...r }) => r)" in r)
check("الحارس عددي موجود", "if (!bodyRows.length) { dropPending(group.date, group.shift, clearedIds); continue; }" in r)
check("القيمة غير الرقمية لا تُترجم إلى null",
      "if (!Number.isFinite(n)) return;" in r,
      "JSON.stringify(NaN)=null ⇒ مسح خلية محفوظة")
check("المسح الحقيقي (نص فارغ) ما زال ممكناً", "o[f] = null; sent[f] = v; return;" in r)

# ── الدالة نفسها بسلوكها الحقيقي ─────────────────────────────────────────
print("\n[2] سلوك dropPendingCells — محاكاة سريعة للسباق")
drop_src = region("const dropPendingCells = (date, shiftKey, sentByBranch)")
check("المقارنة بسلسلة النص (1 === '1')", "String(cur[f]) === String(sentVal)" in drop_src)
check("لا مسح لو لم تتغير القيمة", "if (!changed) return;" in drop_src)


def simulate_drop(pending, sent_by_branch):
    """نفس منطق الدالة بالبايثون — للتحقق العددي.
    ملاحظة: مفاتيح كائنات JS دائماً نصوص، فنحولها هنا لنصوص أيضاً."""
    next_group = {str(b): dict(cells) for b, cells in pending.items()}
    changed = False
    for bid, sent in sent_by_branch.items():
        cur = next_group.get(str(bid))
        if cur is None:
            continue
        nxt = dict(cur)
        for f, sent_val in sent.items():
            if str(cur.get(f)) == str(sent_val):
                del nxt[f]
                changed = True
        if nxt:
            next_group[str(bid)] = nxt
        else:
            next_group.pop(str(bid), None)
            changed = True
    return (next_group if changed else {str(b): dict(c) for b, c in pending.items()}), changed


# المستخدم كتب 15 (خرجت في الطلب) ثم أثناء رحلة الطلب كتب 22 على نفس الخلية
p = {3: {"temp_min": "22"}}
sent = {3: {"temp_min": "15"}}
after, _ = simulate_drop(p, sent)
check("القيمة الجديدة 22 نجت من المسح", after.get("3", {}).get("temp_min") == "22", str(after))

# نفس الرقم ما اتغيّرش ⇒ المسح صحيح (القيمة أكّدت على السيرفر)
p2 = {3: {"temp_min": "15"}}
after2, ch2 = simulate_drop(p2, sent)
check("القيمة المؤكدة تُمسح فعلاً", "3" not in after2 and ch2, str(after2))

# 🔤 رقم مقابل نص: الكود يسلّم strings والحقول قد تصل أرقاماً من التحميل،
#    فالمقارنة بالنص هي ما يمنع المسح الخاطئ لرقم لم يتغيّر فعلياً.
p2b = {3: {"temp_min": 15}}
after2b, ch2b = simulate_drop(p2b, sent)
check("المقارنة بين نص ورقم: 15 و'15' تُعتبران نفس القيمة", "3" not in after2b and ch2b, str(after2b))

# حقلان في نفس الصف: واحد اتأكد وواحد لسه جديد
p3 = {3: {"temp_min": "22", "temp_max": "30"}}
sent3 = {3: {"temp_min": "15", "temp_max": "30"}}
after3, _ = simulate_drop(p3, sent3)
check("الحقل المؤكَّد وحده يُمسح والقديم يبقى",
      after3.get("3", {}).get("temp_min") == "22" and "temp_max" not in after3.get("3", {}), str(after3))

# مسح مقصود: المستخدم صفّر الخلية أثناء الرحلة ⇒ يبقى null ولا يُرسل رقماً
p4 = {3: {"temp_min": ""}}
sent4 = {3: {"temp_min": "15"}}
after4, _ = simulate_drop(p4, sent4)
check("المسح المقصود ينجو ولا يتحوّل لحفظ",
      after4.get("3", {}).get("temp_min") == "", str(after4))

# ── ② التحديث السليلي ────────────────────────────────────────────────────
print("\n[3] التحديث السليلي — بيانات السيرفر تُدمج تحت ما كتبه المستخدم")
lg = region("const loadGrid = async")
check("لم يعد setFormValues(m) wholesale",
      "setFormValues(m);" not in lg,
      "المسح الكامل هو سبب «الأرقام بتتغير» كل 60 ثانية")
check("المعلّق يُدمج فوق بيانات السيرفر", "Object.entries(p).forEach(([f, v]) => { m[bid][f] = v; })" in lg)
check("الملموس في الجلسة يُحفظ أيضاً", "if (wasTouched)" in lg and "if (f in prev[bid]) m[bid][f] = prev[bid][f]" in lg)
check("الفشل لا يمسح المعروض", lg.count("setFormValues(prev => (Object.keys(prev).length ? prev : {}))") == 2,
      "catch كان بيمسح كل ما كتبه المستخدم")
cv = region("const cellVal = (bid, field)")
check("المعروض يقرأ من المعلّق فوق formValues", "const pend = ((pendingRowsRef.current || {})" in cv)

# ── ③ كل مسارات التحديث محمية ───────────────────────────────────────────
print("\n[4] كل مسارات التحديث تمرّ بالدمج لا بالمسح")
check("الاستطلاع الدوري 60 ثانية", "useSmartPoll(() => { loadGrid(true); loadDaily(true); }, 60000);" in SRC)
check("حدث التحديث اللحظي", "useEffect(() => { if (liveUpdateVersion > 0) { loadGrid(true); loadDaily(true); } }, [liveUpdateVersion]);" in SRC)
check("لا يوجد استبدال كامل للمعروض خارج loadGrid",
      "setFormValues(m);" not in region("const loadDaily = async", 200000),
      "أي setFormValues كامل غير المدمج = مسح لكل ما كتبه المستخدم")

# ── ④ نفس السباق في شبكة تواصل المحافظات ───────────────────────────────
print("\n[5] شبكة تواصل المحافظات — نفس السباق لا بدّ أن يُعالج أيضاً")
g = region("const putPendingMany = (date, bid, values)", 14000)
check("dropPendingCells معرّف في هذا المكوّن أيضاً",
      "const dropPendingCells = (date, sentByBranch)" in g)
check("تسجيل المُرسل لكل خلية", "sentByBranch[String(r.branch_id)] = r.__sent" in g)
check("المسح بعد النجاح مؤكَّد بالخلية", "dropPendingCells(date, sentByBranch);" in g)
check("الحذف بالفرع لم يعد يُستخدم بعد النجاح", "dropPending(date, ids);" not in g,
      "الحذف بالفرع = ضياع كل ما كُتب أثناء الطلب")
check("loadRows يدمج المعلّق فوق السيرفر (موجود مسبقاً)",
      "Object.keys(pend).forEach(bid => { map[bid] = { ...(map[bid] || emptyGovRow()), ...pend[bid] }; });" in g)

# ── ⑤ سلامة الملف ───────────────────────────────────────────────────────
print("\n[6] سلامة الملف")
check("لا محارف تالفة", not re.search(r"[一-鿿぀-ヿ�]", SRC))
check("الخلايا بقت type=text (لا رفض لحالات الكتابة الوسطى)",
      'type="number" step="any" min="0" inputMode="decimal" value={cellVal' not in SRC)
check("لا إعادة إدخال debounce جديدة", SRC.count("setTimeout(() => flushRef.current(), 1000)") == 1)

print("\n" + "=" * 78)
if FAILS:
    print(f"❌ فشل {len(FAILS)} تحقق: {FAILS}")
    sys.exit(1)
print("✅ كل الفحوص نجحت — الأرقام المكتوبة لا تُستبدل ولا تُمسح")
