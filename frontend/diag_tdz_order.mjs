// 🔎 فحص «الاستخدام قبل التعريف» على مستوى الوحدة (Temporal Dead Zone).
//
// الجذر: مرجع لمتغيّر معرَّف بـ const/let/class في نص أعلى الوحدة *قبل* سطر تعريفه
// يضرب ReferenceError وقت تحميل الوحدة ⇒ الوحدة كلها تفشل في التحميل والصفحة تطلع
// بيضاء تماماً (زي W_REGION_NAME_MAP في Dashboard.jsx). البناء (vite build) لا يكتشفه
// لأن الانهيار وقت التشغيل لا وقت التحويل، والاختبارات لا تستورده غالباً.
//
// الاستخدام:  node diag_tdz_order.mjs [ملف ...]
// الإخراج: سطر لكل احتمال، وكود الخروج 1 لو فيه نتيجة (مناسب للـ CI).
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
const targets = files.length ? files : ['src/Dashboard.jsx', 'src/Login.jsx', 'src/SegInputs.jsx', 'src/App.jsx', 'src/main.jsx'];

// تعريفات على مستوى الوحدة فقط (عمود 0) — ما بداخل الدوال لا يهمنا هنا.
const DECL_RE = /^(?:export\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;

// كلمات مفتاحية/أنواع لا نعتبرها مراجع لمتغيّرات الوحدة.
const SKIP_WORDS = new Set([
  'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'new', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'throw', 'try', 'catch',
  'finally', 'await', 'async', 'yield', 'this', 'super', 'null', 'true', 'false', 'undefined', 'import',
  'export', 'default', 'from', 'as', 'extends', 'static', 'get', 'set', 'not', 'and', 'or',
]);

/** يحذف التعليقات والنصوص حتى لا نقرأ مستعرِضات وهمية من داخل نص. */
function stripCode(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          // تعبير داخل قالب نصي: نُبقيه (كود فعلي يُنفَّذ)
          let depth = 1; i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth === 0) break;
            out += src[i]; i++;
          }
          i++;
          continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

let findings = 0;

for (const file of targets) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) continue;
  const clean = stripCode(fs.readFileSync(abs, 'utf8'));
  const lines = clean.split('\n');

  /** @type {Map<string, {kind: string, line: number}>} */
  const decls = new Map();
  lines.forEach((line, idx) => {
    const m = line.match(DECL_RE);
    if (m && !decls.has(m[2])) decls.set(m[2], { kind: m[1], line: idx + 1 });
  });

  for (const [name, decl] of decls) {
    if (decl.kind === 'function') continue; // الدوال مرفوعة (hoisted) ⇒ لا خطر ترتيب
    // نبحث عن مراجع للاسم في كل سطر أعلى الوحدة (عمود صفر) قبل سطر تعريفه.
    for (let idx = 0; idx < decl.line - 1; idx++) {
      const line = lines[idx];
      if (!line || /^\s/.test(line) === true) continue; // سطر مُزاح = داخل دالة/كتلة ⇒ يُنفَّذ لاحقاً
      if (!new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(line)) continue;
      // تعريف الاسم في نفس السطر (مثل `const x = …`) لا يُحتسب مرجعاً مبكراً.
      const own = line.match(DECL_RE);
      if (own && own[2] === name) continue;
      findings++;
      console.log(`${file}:${idx + 1}  يستخدم «${name}» (${decl.kind} في السطر ${decl.line}) قبل تعريفه ⇒ TDZ عند تحميل الوحدة`);
    }
  }
}

console.log(findings ? `\n❌ ${findings} احتمال ترتيب غير آمن.` : '\n✅ لا توجد مراجع قبل التعريف على مستوى الوحدة.');
process.exit(findings ? 1 : 0);
