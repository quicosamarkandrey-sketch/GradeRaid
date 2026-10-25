// Phase 7 (2026-08-10, session 7) — applies the fixes identified by
// build/audit-window-exports.js to every EXTERNAL file (not index.html's
// inline blocks, which need hand-placed insertion — see session 7's log
// entry). Appends a single well-commented block of `window.X = X;` lines
// at the absolute end of each affected file.
//
// Why file-end append is safe: every flagged symbol was confirmed by the
// audit to already be reachable as a global TODAY (that's the whole
// premise of "at risk" — real consumers already read it as a bare
// global), which is only possible if it's genuinely declared in that
// file's true top-level scope (not privately closed over inside an
// IIFE — such a symbol wouldn't be reachable to other files at all, and
// wouldn't appear in this audit). Function/var/const/let declarations
// all hoist within their enclosing scope, so a reference appended after
// even a trailing IIFE (`})();`) still correctly resolves — same
// reasoning verified manually in session 2, now applied at scale.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'window-export-audit.json'), 'utf8'));

const byFile = new Map();
for (const item of audit.atRisk) {
  if (item.effectiveDeclarer.startsWith('index.html')) continue; // handled separately, by hand
  if (!byFile.has(item.effectiveDeclarer)) byFile.set(item.effectiveDeclarer, []);
  byFile.get(item.effectiveDeclarer).push(item.name);
}

let filesChanged = 0;
let symbolsExported = 0;
for (const [rel, names] of byFile) {
  const filePath = path.join(ROOT, rel);
  const before = fs.readFileSync(filePath, 'utf8');
  const block =
    '\n' +
    '// ── Phase 7 (2026-08-10, session 7): explicit window exports ──\n' +
    '// These were previously implicit globals (bare top-level declarations,\n' +
    '// reachable to other files only via classic-script auto-attach-to-window\n' +
    '// behavior). Made explicit ahead of any real bundle/module scoping change\n' +
    '// — found by build/audit-window-exports.js, which checks every symbol with\n' +
    '// a real cross-file consumer, not just ones reachable from onclick markup.\n' +
    '// See PHASE7_WINDOW_EXPORT_AUDIT.md.\n' +
    names.map((n) => `window.${n} = ${n};`).join('\n') +
    '\n';
  fs.writeFileSync(filePath, before + block);
  filesChanged++;
  symbolsExported += names.length;
  console.log(`${rel}: +${names.length} (${names.join(', ')})`);
}

console.log(`\n${filesChanged} files changed, ${symbolsExported} symbols exported.`);
console.log(`index.html's 2 inline blocks (14 symbols) NOT included — handled separately.`);
