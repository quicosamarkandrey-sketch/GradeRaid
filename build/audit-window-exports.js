// EduQuest Phase 7 — window-export audit (session 7).
//
// Answers the question session 6 flagged but didn't solve: for every
// symbol that has real cross-file consumers (per the dependency graph),
// does an explicit `window.X = X` already exist for it? If not, the
// declaring file cannot safely be side-effect-imported into a real
// esbuild bundle — its declaration would get scope-wrapped, stop
// auto-attaching to `window`, and silently break every consumer.
//
// This generalizes session 2's implicit-globals fix (which only covered
// symbols reachable from inline onclick="..." markup, 30 of them) to
// EVERY real cross-file reference the dependency graph knows about —
// ordinary bare JS-to-JS calls included, which session 6 showed is a
// materially bigger set (showModal alone had 34 such consumers and
// wasn't in session 2's list at all).
//
// HANDLING REASSIGNMENT/PATCH CHAINS CORRECTLY (revised session 8): a name
// can be declared by more than one unit — see PHASE7_DEPENDENCY_MAP.md's
// "reassignment chains" list, mostly monkey-patch/override pairs. The
// FIRST version of this audit required only "any declarer has an
// explicit export," which missed a real case: a monkey-patch file (e.g.
// phases.js patching `_wbcStartLiveRefresh`) can have its OWN explicit
// export for its patched version while its own patch code still reads
// the ORIGINAL, earlier declaration first (`const _orig =
// _wbcStartLiveRefresh;`) — a bare read that depends on the ORIGINAL
// declarer (student-page.js) having already exported it. Every real
// monkey-patch chain found in this codebase follows that shape: original
// declared first, later files read-then-rewrap it. So the fix must be
// verified against the FIRST-LOADED (earliest document-order) real
// declarer specifically, not "any" declarer — confirmed via index.html's
// actual document order, not assumed.
//
// KNOWN LIMITATION, found via real execution testing (still session 8,
// but not by this static audit itself): a `window.X = ...` assignment
// inside a conditional guard (e.g. `if (typeof X === 'function') { ...
// window.X = function(){...}; }`) is indistinguishable, to this AST-level
// audit, from an unconditional one — it can't know whether the guard
// actually evaluates true given real load order. This caused one real
// miss: modules/world-boss/phases.js has such a guard for
// `_wbcStartLiveRefresh`, loads BEFORE modules/world-boss/student-page.js
// (the real, unconditional declarer), so the guard is false at the point
// phases.js runs and the "first declarer" this audit saw was actually a
// dead branch. Only build/verify-full-bundle.js — which actually EXECUTES
// the bundle against real DOM and diffs the resulting global surface
// against the legacy build — caught this. Treat this audit as a strong
// first pass, not a substitute for real execution verification.

const fs = require('fs');
const path = require('path');
const { AMBIENT_GLOBALS, getOrderedScriptElements, analyzeUnit } = require('./lib/analyze-unit');

const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'dist', 'window-export-audit.json');
const OUT_MD = path.join(ROOT, 'PHASE7_WINDOW_EXPORT_AUDIT.md');

function main() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const elements = getOrderedScriptElements(html).filter((e) => e.type === 'inline' || e.src.startsWith('./'));

  // units, in real document order (order IS the data here — determines
  // which declarer is "last loaded" for reassignment chains)
  const units = [];
  let inlineIdx = 0;
  for (const el of elements) {
    if (el.type === 'external') {
      const rel = el.src.replace(/^\.\//, '');
      const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      units.push({ label: rel, order: units.length, ...analyzeUnit(code) });
    } else {
      const label = `index.html#inline${inlineIdx}`;
      units.push({ label, order: units.length, ...analyzeUnit(el.code) });
      inlineIdx++;
    }
  }

  const declaredBy = new Map(); // name -> [unit, in document order] — built
    // from astDeclares (REAL local declarations only), not the combined
    // `declares` set, so a file that merely re-exports a sibling file's
    // symbol via `window.X = X;` doesn't get mistaken for the symbol's
    // true source. See build/lib/analyze-unit.js's astDeclares comment —
    // this exact confusion (mail/index.js re-exporting mail-engine.js's
    // mailGetForStudent) was session 8's root-cause finding.
  for (const u of units) {
    for (const name of u.astDeclares) {
      if (!declaredBy.has(name)) declaredBy.set(name, []);
      declaredBy.get(name).push(u);
    }
  }

  // Which names have real cross-file consumers at all?
  const consumedNames = new Set();
  const consumersOf = new Map(); // name -> Set(consumer unit labels)
  for (const u of units) {
    for (const name of u.references) {
      if (AMBIENT_GLOBALS.has(name)) continue;
      if (u.astDeclares.has(name)) continue;
      if (!declaredBy.has(name)) continue; // unresolved — not this audit's concern (dependency-map.js already flags these)
      consumedNames.add(name);
      if (!consumersOf.has(name)) consumersOf.set(name, new Set());
      consumersOf.get(name).add(u.label);
    }
  }

  const atRisk = []; // { name, effectiveDeclarer, allDeclarers, consumers, consumerCount }
  const alreadySafe = [];
  for (const name of consumedNames) {
    const declarers = declaredBy.get(name);
    // Require the FIRST-LOADED (earliest document-order) real declarer to
    // have an explicit export — not just "any declarer." Session 8 found
    // this the hard way with a monkey-patch chain: student-page.js
    // originally declares `_wbcStartLiveRefresh`; phases.js later patches
    // it with `window._wbcStartLiveRefresh = function(){...}` (a
    // self-contained export of ITS OWN patched version) — but phases.js's
    // own patch code first reads the ORIGINAL via a bare
    // `const _orig = _wbcStartLiveRefresh;`, which depends on
    // student-page.js's declaration having already reached `window`.
    // Checking "any declarer has an export" found phases.js's and called
    // it safe, missing that phases.js's OWN code has an unresolved
    // dependency on the earlier, unexported original. Every real
    // monkey-patch chain found in this codebase follows this shape
    // (original declared first, later files read-then-rewrap it) — so
    // the first declarer is the one that actually needs the fix.
    const firstDeclarer = declarers.reduce((a, b) => (b.order < a.order ? b : a));
    const firstHasExplicit = firstDeclarer.explicitWindowExports.has(name);
    if (firstHasExplicit) {
      alreadySafe.push(name);
      continue;
    }
    // none of the declarers export it explicitly — flag the LAST-LOADED
    // one, since that's whose declaration is actually live today
    // Fix belongs on the FIRST declarer too — same reasoning as above.
    const effective = firstDeclarer;
    atRisk.push({
      name,
      effectiveDeclarer: effective.label,
      allDeclarers: declarers.map((d) => d.label),
      consumers: [...consumersOf.get(name)].sort(),
      consumerCount: consumersOf.get(name).size,
    });
  }
  atRisk.sort((a, b) => b.consumerCount - a.consumerCount);

  // group at-risk by effective declarer, for a per-file fix view
  const byDeclarer = new Map();
  for (const item of atRisk) {
    if (!byDeclarer.has(item.effectiveDeclarer)) byDeclarer.set(item.effectiveDeclarer, []);
    byDeclarer.get(item.effectiveDeclarer).push(item);
  }
  const declarerRanking = [...byDeclarer.entries()].sort((a, b) => b[1].length - a[1].length);

  const result = {
    generatedAt: new Date().toISOString(),
    totalConsumedNames: consumedNames.size,
    alreadySafeCount: alreadySafe.length,
    atRiskCount: atRisk.length,
    atRisk,
    declarerRanking: declarerRanking.map(([label, items]) => ({ label, missingCount: items.length, names: items.map((i) => i.name) })),
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));

  let md = `# Phase 7 — Window-Export Audit (session 7)\n\n`;
  md += `Generated ${result.generatedAt} by \`build/audit-window-exports.js\`. Regenerate any time source changes.\n\n`;
  md += `**${consumedNames.size} names have real cross-file consumers** (at least one other unit references them as a free global, and something in the codebase actually declares them). Of those:\n`;
  md += `- **${alreadySafe.length}** already have an explicit \`window.X =\` on at least one declarer — safe today, safe under real bundling.\n`;
  md += `- **${atRisk.length}** do not — these only work today because their declaring file is an unwrapped classic script. Any of these files being side-effect-imported into a real esbuild bundle would silently break every listed consumer.\n\n`;

  md += `## Fix priority — declaring files ranked by how many at-risk symbols they'd need to export (${declarerRanking.length} files affected)\n\n`;
  md += `| file | symbols needing \`window.X =\` |\n|---|---|\n`;
  for (const [label, items] of declarerRanking.slice(0, 50)) {
    md += `| \`${label}\` | ${items.length}: ${items.map((i) => '`' + i.name + '`').join(', ')} |\n`;
  }
  if (declarerRanking.length > 50) md += `\n...and ${declarerRanking.length - 50} more files (see JSON for full data).\n`;
  md += `\n`;

  md += `## Full at-risk list (${atRisk.length}), sorted by consumer count\n\n`;
  md += `| symbol | effective declarer | consumers | all declarers |\n|---|---|---|---|\n`;
  for (const item of atRisk.slice(0, 100)) {
    const declarerNote = item.allDeclarers.length > 1 ? item.allDeclarers.map((d) => '`' + d + '`').join(', ') : '(only one)';
    md += `| \`${item.name}\` | \`${item.effectiveDeclarer}\` | ${item.consumerCount} | ${declarerNote} |\n`;
  }
  if (atRisk.length > 100) md += `\n...and ${atRisk.length - 100} more (see JSON for full data).\n`;

  fs.writeFileSync(OUT_MD, md);

  console.log(`Consumed names with real cross-file consumers: ${consumedNames.size}`);
  console.log(`Already safe (explicit window export exists): ${alreadySafe.length}`);
  console.log(`At risk (no explicit window export anywhere): ${atRisk.length}`);
  console.log(`Files that would need a fix: ${declarerRanking.length}`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
}

main();
