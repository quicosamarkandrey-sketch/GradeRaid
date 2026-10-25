// EduQuest Phase 7 — step 5.1: parallel build, zero source change.
//
// This is deliberately NOT an esbuild --bundle build. esbuild's --bundle
// (any format: iife/cjs/esm) wraps combined files in a module scope to
// avoid symbol collisions, which breaks this codebase specifically: ~30
// functions are bare top-level `function foo(){}` declarations with no
// explicit `window.foo = foo`, relying on the browser's classic-script
// behavior where a top-level function/var declaration in a <script> tag
// becomes an own property of `window`. Inline HTML event handlers
// (onclick="closeModal()" etc., both static in index.html and generated
// dynamically via innerHTML template strings) call these by bare name,
// so they must remain real globals. See PHASE7_IMPLICIT_GLOBALS.md.
//
// This script instead does what index.html's real <script> elements
// already do: concatenate the same source, IN DOCUMENT ORDER, into one
// script body, with no scope wrapper. That means every <script> element —
// external (src=) AND inline (raw JS between <script> and </script>) — in
// the exact order it appears in the document, not just the external ones.
//
// SESSION 2 CORRECTION: the first version of this script only handled
// external <script src> tags. index.html actually has 3 inline <script>
// blocks with no src attribute, interleaved between the external ones —
// including a 2,702-line block containing real, load-order-relevant code
// (DB/currentUser/currentRole init, the quiz runner, the profile system,
// etc.). Omitting them meant the "zero source change" build from session 1
// was quietly missing ~2,760 lines of the real app. Fixed by treating
// every <script> element as one ordered stream, external or inline alike.
//
// esbuild is still installed as a devDependency — it gets used for real
// bundling starting in step 5.3, once files have actual `export`s and the
// implicit globals tracked in PHASE7_IMPLICIT_GLOBALS.md have been given
// explicit `window.x = x` lines.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'dist', 'app.legacy-concat.js');
const MANIFEST_OUT = path.join(ROOT, 'dist', 'concat-manifest.json');

// Returns every <script> element in document order, tagged as either
// { type: 'external', src } or { type: 'inline', code }.
function getOrderedScriptElements(html) {
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  const elements = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const srcMatch = /\bsrc=["']([^"']+)["']/.exec(attrs);
    if (srcMatch) {
      elements.push({ type: 'external', src: srcMatch[1] });
    } else {
      // an inline block with only whitespace is not real code (e.g. none
      // exist currently, but don't emit an empty banner comment for one)
      if (m[2].trim().length > 0) {
        elements.push({ type: 'inline', code: m[2] });
      }
    }
  }
  return elements;
}

function main() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const elements = getOrderedScriptElements(html);

  const localExternal = elements.filter((e) => e.type === 'external' && e.src.startsWith('./'));
  const cdnExternal = elements.filter((e) => e.type === 'external' && !e.src.startsWith('./'));
  const inline = elements.filter((e) => e.type === 'inline');

  if (cdnExternal.length > 0) {
    console.log(
      `NOTE: ${cdnExternal.length} external CDN script tag(s) found. These stay as real ` +
        '<script src> tags in the shipped page, loaded BEFORE this concatenated bundle, ' +
        'same as today. Not included in the concat output:'
    );
    cdnExternal.forEach((e) => console.log('  ' + e.src));
  }

  const parts = [];
  const manifest = [];
  let offsetLine = 1;
  let inlineIdx = 0;

  for (const el of elements) {
    if (el.type === 'external' && !el.src.startsWith('./')) continue; // CDN, skip (see note above)

    if (el.type === 'external') {
      const rel = el.src;
      const p = path.join(ROOT, rel.replace(/^\.\//, ''));
      if (!fs.existsSync(p)) {
        throw new Error(`Script referenced in index.html but missing on disk: ${rel}`);
      }
      const src = fs.readFileSync(p, 'utf8');
      const lineCount = src.split('\n').length;
      manifest.push({ type: 'external', file: rel, startLine: offsetLine, endLine: offsetLine + lineCount - 1 });
      offsetLine += lineCount + 3;
      parts.push(`/* ---- ${rel} ---- */\n${src}\n`);
    } else {
      const label = `index.html inline <script> block #${inlineIdx}`;
      const lineCount = el.code.split('\n').length;
      manifest.push({ type: 'inline', label, startLine: offsetLine, endLine: offsetLine + lineCount - 1 });
      offsetLine += lineCount + 3;
      parts.push(`/* ---- ${label} ---- */\n${el.code}\n`);
      inlineIdx++;
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, parts.join('\n'));
  fs.writeFileSync(
    MANIFEST_OUT,
    JSON.stringify(
      {
        totalScriptElementsInIndexHtml: elements.length,
        localExternalFileCount: localExternal.length,
        inlineBlockCount: inline.length,
        cdnExternal: cdnExternal.map((e) => e.src),
        manifest,
      },
      null,
      2
    )
  );

  console.log(`Wrote ${OUT}`);
  console.log(`  external local files concatenated: ${localExternal.length}`);
  console.log(`  inline <script> blocks concatenated: ${inline.length}`);
  console.log(`  external (CDN) scripts left as-is: ${cdnExternal.length}`);
  console.log(`  total <script> elements in index.html: ${elements.length}`);
}

main();

