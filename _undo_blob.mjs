// Reverses the damage: each of N damaged lines was replaced by the entire HEAD blob.
// Split on the blob to get the surviving lines back, then refill each emptied slot
// with the correct HEAD line, identified by its unchanged neighbours. ASCII-only.
import fs from 'fs';

const FFFD = String.fromCharCode(0xFFFD);
const targets = [
  ['frontend/src/Dashboard.jsx', '_head_dash.jsx'],
  ['frontend/src/index.css', '_head_index.css'],
];
const write = process.argv.includes('--write');

for (const [curPath, headPath] of targets) {
  const blob = fs.readFileSync(headPath, 'utf8');
  const corrupted = fs.readFileSync(curPath, 'utf8');
  const pieces = corrupted.split(blob);
  console.log(curPath + ': blob occurrences ' + (pieces.length - 1) + ' | corrupted bytes ' + corrupted.length);
  if (pieces.length < 2) { console.log('  nothing to undo'); continue; }

  // Join with a slot marker so emptied positions are explicit.
  const MARK = String.fromCharCode(0x1F) + 'SLOT' + String.fromCharCode(0x1F);
  const rebuilt = pieces.join(MARK);
  const lines = rebuilt.split('\r\n');
  const headLines = blob.split(/\r?\n/);
  const slots = lines.map((l, i) => (l.includes(MARK) ? i : -1)).filter((i) => i >= 0);
  console.log('  slots found: ' + slots.length);

  let filled = 0, failed = 0;
  for (const i of slots) {
    let prev = null, next = null;
    for (let k = i - 1; k >= 0; k--) { if (lines[k].trim()) { prev = lines[k]; break; } }
    for (let k = i + 1; k < lines.length; k++) { if (lines[k].trim()) { next = lines[k]; break; } }
    let fixed = null;
    const findByPrev = headLines.map((h, j) => (h === prev ? j : -1)).filter((j) => j >= 0);
    if (findByPrev.length === 1 && headLines[findByPrev[0] + 1] && headLines[findByPrev[0] + 2] === next) fixed = headLines[findByPrev[0] + 1];
    if (!fixed) {
      const findByNext = headLines.map((h, j) => (h === next ? j : -1)).filter((j) => j >= 0);
      if (findByNext.length === 1 && headLines[findByNext[0] - 1] && headLines[findByNext[0] - 2] === prev) fixed = headLines[findByNext[0] - 1];
    }
    if (!fixed) {
      // Widest window: match up to 3 non-empty neighbours before and after.
      const prevs = [];
      for (let k = i - 1; k >= 0 && prevs.length < 3; k--) if (lines[k].trim()) prevs.unshift(lines[k]);
      const nexts = [];
      for (let k = i + 1; k < lines.length && nexts.length < 3; k++) if (lines[k].trim()) nexts.push(lines[k]);
      const startsAll = headLines.map((h, j) => (h === prevs[0] ? j : -1)).filter((j) => j >= 0);
      const wide = [];
      for (const j0 of startsAll) {
        const beforeOk = prevs.every((p, n) => headLines[j0 - (prevs.length - 1 - n)] === p);
        if (!beforeOk) continue;
        const start = j0 + 1;
        for (let k = start; k <= start + 8 && k + nexts.length <= headLines.length; k++) {
          if (nexts.every((nx, n) => headLines[k + n] === nx)) { wide.push(headLines.slice(start, k)); break; }
        }
      }
      if (wide.length === 1 && wide[0].length >= 1) {
        fixed = wide[0].join('\r\n');
        console.log('  L' + (i + 1) + ' wide-filled (' + wide[0].length + '): "' + wide[0][0].trim().slice(0, 60) + '"');
      }
    }
    if (!fixed) {
      // Wider window: find P in HEAD, then scan forward up to 6 lines for N.
      const starts = headLines.map((h, j) => (h === prev ? j : -1)).filter((j) => j >= 0);
      const sols = [];
      for (const j of starts) {
        for (let k = j + 1; k <= j + 6 && k < headLines.length; k++) {
          if (headLines[k] === next) { sols.push(headLines.slice(j + 1, k)); break; }
        }
      }
      if (sols.length === 1 && sols[0].length >= 1) {
        fixed = sols[0].join('\r\n');
        console.log('  L' + (i + 1) + ' window-filled (' + sols[0].length + ' line[s]): "' + sols[0][0].trim().slice(0, 56) + '"');
      }
    }
    if (fixed) { lines[i] = fixed; filled++; }
    else {
      // Unique, greppable marker so each slot can be patched precisely afterwards.
      lines[i] = '/* __SLOT__<' + i + '> */';
      failed++;
      console.log('  L' + (i + 1) + ' MARKED | prev="' + (prev || '').slice(0, 44) + '" next="' + (next || '').slice(0, 44) + '"');
    }
  }
  const out = lines.join('\r\n');
  let fffd = 0; for (const ch of out) if (ch.codePointAt(0) === FFFD) fffd++;
  console.log('  filled ' + filled + ' | failed ' + failed + ' | FFFD ' + fffd + ' | bytes ' + out.length + ' | lines ' + out.split('\r\n').length);
  if (write) { fs.writeFileSync(curPath, out, 'utf8'); console.log('  WRITTEN (' + failed + ' marker[s] to patch)'); }
  else console.log('  (dry run)');
}
