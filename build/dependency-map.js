// EduQuest Phase 7 — step 5.2: real dependency map.
// (Rewritten session 7 to use build/lib/analyze-unit.js — same analysis
// as before, now shared with build/audit-window-exports.js instead of
// duplicated. Behavior unchanged; verified by re-running against the
// same codebase state and confirming identical counts to session 4's
// last run before this refactor.)

const fs = require('fs');
const path = require('path');
const { AMBIENT_GLOBALS, analyzeAllUnits } = require('./lib/analyze-unit');

const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'dist', 'dependency-map.json');
const OUT_MD = path.join(ROOT, 'PHASE7_DEPENDENCY_MAP.md');

function main() {
  const units = analyzeAllUnits(ROOT);
  const parseFailures = units.filter((u) => u.parseError);

  const declaredBy = new Map(); // name -> [{ label, kind }] — built from
    // astDeclares (real local declarations), not the combined `declares`
    // set. See build/lib/analyze-unit.js's astDeclares comment.
  for (const u of units) {
    for (const name of u.astDeclares) {
      if (!declaredBy.has(name)) declaredBy.set(name, []);
      declaredBy.get(name).push({ label: u.label, kind: u.declareKinds.get(name) || 'reassign' });
    }
  }
  const multiDeclaredAll = [...declaredBy.entries()].filter(([, entries]) => entries.length > 1);
  const multiDeclaredFatal = multiDeclaredAll.filter(([, entries]) => entries.filter((e) => e.kind === 'fatal').length > 1);
  const multiDeclaredReassign = multiDeclaredAll.filter(([name]) => !multiDeclaredFatal.some(([n2]) => n2 === name));

  const edges = new Map();
  const unresolved = new Map();
  for (const u of units) {
    const dep = new Set();
    const unres = new Set();
    for (const name of u.references) {
      if (AMBIENT_GLOBALS.has(name)) continue;
      if (u.astDeclares.has(name)) continue;
      const declarers = declaredBy.get(name);
      if (!declarers) {
        unres.add(name);
        continue;
      }
      for (const d of declarers) {
        if (d.label !== u.label) dep.add(d.label);
      }
    }
    edges.set(u.label, dep);
    if (unres.size) unresolved.set(u.label, unres);
  }

  const fanOut = new Map();
  const fanIn = new Map();
  for (const u of units) fanIn.set(u.label, 0);
  for (const [label, deps] of edges) {
    fanOut.set(label, deps.size);
    for (const d of deps) fanIn.set(d, (fanIn.get(d) || 0) + 1);
  }

  const leafCandidates = units
    .map((u) => ({ label: u.label, fanOut: fanOut.get(u.label) || 0, fanIn: fanIn.get(u.label) || 0, unresolvedCount: (unresolved.get(u.label) || new Set()).size }))
    .filter((u) => u.unresolvedCount === 0)
    .sort((a, b) => a.fanOut - b.fanOut || b.fanIn - a.fanIn);

  const result = {
    generatedAt: new Date().toISOString(),
    unitCount: units.length,
    parseFailures: parseFailures.map((u) => ({ label: u.label, error: u.parseError })),
    multiDeclaredFatal: multiDeclaredFatal.map(([name, entries]) => ({ name, declaredBy: entries })),
    multiDeclaredReassign: multiDeclaredReassign.map(([name, entries]) => ({ name, declaredBy: entries })),
    units: units.map((u) => ({
      label: u.label,
      kind: u.kind,
      declaresCount: u.declares.size,
      fanOut: fanOut.get(u.label) || 0,
      fanIn: fanIn.get(u.label) || 0,
      dependsOn: [...(edges.get(u.label) || [])].sort(),
      unresolvedFreeRefs: [...(unresolved.get(u.label) || [])].sort(),
    })),
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));

  let md = `# Phase 7 — Dependency Map (step 5.2)\n\n`;
  md += `Generated ${result.generatedAt} by \`build/dependency-map.js\`. Regenerate any time source changes; do not hand-edit the data sections below.\n\n`;
  md += `**${units.length} source units analyzed** (133 external files + 3 inline \`<script>\` blocks in \`index.html\`).\n\n`;

  if (parseFailures.length) {
    md += `## ⚠ Parse failures (${parseFailures.length}) — excluded from the graph, need manual attention\n\n`;
    for (const f of parseFailures) md += `- \`${f.label}\`: ${f.error}\n`;
    md += `\n`;
  } else {
    md += `## Parse failures: none — all ${units.length} units parsed cleanly.\n\n`;
  }

  md += `## ⚠ FATAL-risk collisions — top-level \`const\`/\`let\`/\`class\` declared in more than one unit (${multiDeclaredFatal.length})\n\n`;
  md += `Same class of bug as session 1's \`CB_CANVAS_W\` finding. **Every one of these needs a manual look against \`index.html\`'s actual load order** before assuming it's live-broken.\n\n`;
  if (multiDeclaredFatal.length === 0) {
    md += `None found.\n\n`;
  } else {
    for (const [name, entries] of multiDeclaredFatal) {
      md += `- \`${name}\` — declared \`const\`/\`let\`/\`class\` in: ${entries.map((e) => `\`${e.label}\``).join(', ')}\n`;
    }
    md += `\n`;
  }

  md += `## Reassignment chains — \`function\`/\`var\`/\`window.X =\` declared in more than one unit (${multiDeclaredReassign.length})\n\n`;
  md += `NOT a SyntaxError risk under classic-script semantics — frequently an intentional monkey-patch/override chain in this codebase (see refactor log's Phase 4 entry). See \`PHASE7_WINDOW_EXPORT_AUDIT.md\` for whether the *currently effective* (last-loaded) declarer of each of these has an explicit \`window.X =\` — that's the file that would need one before any bundling touches it.\n\n`;
  for (const [name, entries] of multiDeclaredReassign) {
    md += `- \`${name}\` — declared/assigned in: ${entries.map((e) => `\`${e.label}\``).join(', ')}\n`;
  }
  md += `\n`;

  md += `## Leaf candidates (0 unresolved free references, sorted by fan-out then fan-in)\n\n`;
  md += `| unit | fan-out | fan-in |\n|---|---|---|\n`;
  for (const c of leafCandidates.slice(0, 40)) {
    md += `| \`${c.label}\` | ${c.fanOut} | ${c.fanIn} |\n`;
  }
  if (leafCandidates.length > 40) md += `\n...and ${leafCandidates.length - 40} more with 0 unresolved refs (see \`dist/dependency-map.json\` for the full list).\n`;
  md += `\n`;

  const withUnresolved = units
    .map((u) => ({ label: u.label, count: (unresolved.get(u.label) || new Set()).size, names: [...(unresolved.get(u.label) || [])] }))
    .filter((u) => u.count > 0)
    .sort((a, b) => b.count - a.count);

  md += `## Units with unresolved free references (${withUnresolved.length})\n\n`;
  for (const u of withUnresolved.slice(0, 60)) {
    md += `- \`${u.label}\` (${u.count}): ${u.names.slice(0, 15).join(', ')}${u.names.length > 15 ? ', …' : ''}\n`;
  }
  if (withUnresolved.length > 60) md += `\n...and ${withUnresolved.length - 60} more (see JSON for full data).\n`;

  fs.writeFileSync(OUT_MD, md);

  console.log(`Analyzed ${units.length} units.`);
  console.log(`Parse failures: ${parseFailures.length}`);
  console.log(`Multi-declared (FATAL const/let/class): ${multiDeclaredFatal.length}`);
  console.log(`Multi-declared (reassignment chains): ${multiDeclaredReassign.length}`);
  console.log(`Leaf candidates (0 unresolved refs): ${leafCandidates.length}`);
  console.log(`Units with unresolved free refs: ${withUnresolved.length}`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
}

main();
