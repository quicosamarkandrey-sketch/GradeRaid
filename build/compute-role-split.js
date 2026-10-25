// EduQuest Phase 7 — step 5.4: per-role file closures.
//
// Uses nav.js's REAL routing table (every `id==='s-...'`/`id==='a-...'`
// branch, hand-transcribed from nav.js lines 209-256 — not guessed from
// directory names, per the Phase 7 session memory doc's §8.2 decision:
// "verify each file's actual role-gating before assigning it"). For each
// role's set of top-level render-function entry points, walks the real
// dependency graph (dist/dependency-map.json) to compute the full
// transitive closure of files actually needed — the render function's
// own declaring file, plus everything IT depends on, recursively.
//
// Files needed by BOTH roles are shared. Files needed only by one are
// role-exclusive. This is the real, evidence-based split — not an
// assumption from `modules/admin/` vs `modules/shared/` naming.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'dist', 'role-split.json');
const OUT_MD = path.join(ROOT, 'PHASE7_ROLE_SPLIT.md');

// Transcribed directly from nav.js's real if/else-if routing chain.
const STUDENT_ENTRY_FNS = [
  'renderStudentDashboard', 'renderMySection', 'renderStudentQuizzes',
  'renderStudentWorldBoss', 'renderStudentStore', 'renderInventory',
  'renderStudentOrders', 'renderLeaderboard', 'renderBadges',
  'renderStudentMail', 'renderStudentProgress',
];
const ADMIN_ENTRY_FNS = [
  'renderAdminDashboard', 'renderRfidScanner', 'renderAdminStore', 'renderPOS',
  'renderAdminQuizzes', 'renderAnalytics', 'renderRecitationAttendanceLog',
  'renderAdminStageMap', 'renderAdminBossEvents', 'renderAdminAchievements',
  'renderAdminTitles', 'renderAdminPromotions', 'renderSectionMaker',
  'renderEnrollmentHub', 'renderAdminRegistrations', 'renderAdminMail',
  'renderNavManager', 'renderBossStudio', 'renderClassroomBuilder',
  'renderClassroomMonitor', 'renderAdminLeaderboards', 'renderTeacherDirectory',
  'renderStarterPackEditor', 'renderSchoolSettings', 'renderContentOversight',
  'renderMascotLines', 'renderAuditLog', 'renderSystemHealth',
  // renderLeaderboard also appears for a-hall-of-fame — already in STUDENT list, shared correctly by set union below, not duplicated
];

function main() {
  const dm = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'dependency-map.json'), 'utf8'));
  const unitByLabel = new Map(dm.units.map((u) => [u.label, u]));

  // Directory-grouping fix (session 10): the pure call graph, however
  // correctly built, structurally can't see "sink" files like this
  // codebase's *_index.js aggregator convention (they depend on their
  // siblings but nothing calls INTO them). Session 9 confirmed this with
  // bs_editor.js — needed by boss-studio, but unreachable from any
  // render-function-seeded traversal.
  //
  // FIRST ATTEMPT this session: pull in every sibling in a directory once
  // any file from it is in the closure. Too coarse — confirmed by
  // checking boss-studio specifically: `bs_bve_engine.js` (the shared
  // boss-battle rendering engine) is a REAL, legitimate shared dependency
  // between student battle-viewing code and admin battle-editing code
  // (checked: 10 world-boss files have a genuine call-graph edge into it)
  // — but blanket directory grouping used that one real shared file as an
  // excuse to also pull `bs_editor.js`/`bs_index.js` (the actual
  // admin-only design UI) into the student closure too.
  //
  // FIX: only apply directory-grouping to genuine SINKS — units with ZERO
  // real fan-in across the ENTIRE dependency graph (nothing, anywhere,
  // calls into them). `bs_bve_engine.js` has real fan-in (10 callers) and
  // is left to the ordinary call graph, which already places it correctly
  // in both closures on its own merits. `bs_editor.js`/`bs_index.js` have
  // zero fan-in anywhere — true sinks — and get pulled in as "ships with
  // its feature, since nothing can call into it to prove that otherwise."
  const globalFanIn = new Map(dm.units.map((u) => [u.label, u.fanIn]));
  function isSink(label) {
    return (globalFanIn.get(label) || 0) === 0;
  }

  function dirGroupOf(label) {
    const m = /^modules\/([^/]+)\//.exec(label);
    return m ? `modules/${m[1]}` : null;
  }
  const byDirGroup = new Map(); // dirGroup -> [labels]
  for (const u of dm.units) {
    const g = dirGroupOf(u.label);
    if (!g) continue;
    if (!byDirGroup.has(g)) byDirGroup.set(g, []);
    byDirGroup.get(g).push(u.label);
  }

  // Which unit declares each entry function? Need declaredBy — rebuild
  // from astDeclares via the raw source (dependency-map.json doesn't
  // store per-symbol declarer, only per-unit dependsOn edges) — reuse
  // analyze-unit for this specific lookup.
  const { analyzeAllUnits } = require('./lib/analyze-unit');
  const units = analyzeAllUnits(ROOT);
  const declaredBy = new Map(); // name -> unit label (first real declarer)
  for (const u of units) {
    for (const name of u.astDeclares) {
      if (!declaredBy.has(name)) declaredBy.set(name, u.label);
    }
  }

  // nav.js is a real, legitimate hub, not a splitting bug: it's the
  // single shared router, and its routing table references EVERY role's
  // render functions by bare name in one if/else chain (checked: 43
  // direct dependency edges, ~4x any other file). A student session
  // never takes the `else if(id==='a-boss-studio')` branch, so nav.js
  // referencing `renderBossStudio` there is completely safe at runtime —
  // it's a static-analysis artifact of one shared file legitimately
  // handling both roles' dispatch, not a real per-role dependency. Naive
  // transitive closure through nav.js pulls in its FULL 43-edge fan-out
  // for both roles, collapsing the split to 100% overlap (confirmed by
  // checking directly before assuming this fix). Treated here as a
  // required-shared boundary node: included directly in both closures,
  // but its own outgoing edges are NOT followed for splitting purposes.
  const BOUNDARY_NODES = new Set(['nav.js']);

  function closureFor(entryFns) {
    const closure = new Set();
    const missing = [];
    const queue = [];
    for (const fn of entryFns) {
      const declarer = declaredBy.get(fn);
      if (!declarer) {
        missing.push(fn);
        continue;
      }
      queue.push(declarer);
    }
    while (queue.length) {
      const label = queue.pop();
      if (closure.has(label)) continue;
      closure.add(label);
      if (BOUNDARY_NODES.has(label)) continue; // don't follow this node's own edges
      const unit = unitByLabel.get(label);
      if (unit) {
        for (const dep of unit.dependsOn) queue.push(dep);
      }
    }
    for (const b of BOUNDARY_NODES) closure.add(b); // always present, both roles need navigation
    return { closure, missing };
  }

  const student = closureFor(STUDENT_ENTRY_FNS);
  const admin = closureFor(ADMIN_ENTRY_FNS);

  // Apply directory-grouping expansion to each closure — sinks only, and
  // only into a closure that already holds a MAJORITY of that directory's
  // non-sink files. Plain presence isn't enough: checked directly, boss-
  // studio's shared `bs_bve_engine.js` alone was enough to trigger sink
  // expansion for the student closure too, pulling in `bs_editor.js` (the
  // admin-only design UI) on the strength of one borrowed utility. A
  // majority threshold correctly distinguishes "this role's closure
  // touches ONE shared file that happens to live here" from "this role
  // genuinely needs this feature" (admin's closure has bs_library.js,
  // bs_storage.js, bs_animation_library.js, AND bs_bve_engine.js — a
  // clear majority; student's has only bs_bve_engine.js).
  function expandByDirGroup(closure) {
    const expanded = new Set(closure);
    for (const [dirGroup, allInDir] of byDirGroup) {
      const nonSinks = allInDir.filter((l) => !isSink(l));
      if (nonSinks.length === 0) continue;
      const touchedNonSinks = nonSinks.filter((l) => closure.has(l));
      if (touchedNonSinks.length > nonSinks.length / 2) {
        for (const sibling of allInDir) {
          if (isSink(sibling)) expanded.add(sibling);
        }
      }
    }
    return { expanded };
  }
  const studentExpansion = expandByDirGroup(student.closure);
  const adminExpansion = expandByDirGroup(admin.closure);
  student.closure = studentExpansion.expanded;
  admin.closure = adminExpansion.expanded;

  const shared = [...student.closure].filter((l) => admin.closure.has(l)).sort();
  const studentOnly = [...student.closure].filter((l) => !admin.closure.has(l)).sort();
  const adminOnly = [...admin.closure].filter((l) => !student.closure.has(l)).sort();
  const allUnits = dm.units.map((u) => u.label);
  const neitherRole = allUnits.filter((l) => !student.closure.has(l) && !admin.closure.has(l)).sort();

  const result = {
    generatedAt: new Date().toISOString(),
    studentEntryFnsMissingDeclarer: student.missing,
    adminEntryFnsMissingDeclarer: admin.missing,
    totalUnits: allUnits.length,
    studentClosureSize: student.closure.size,
    adminClosureSize: admin.closure.size,
    sharedCount: shared.length,
    studentOnlyCount: studentOnly.length,
    adminOnlyCount: adminOnly.length,
    neitherRoleCount: neitherRole.length,
    shared,
    studentOnly,
    adminOnly,
    neitherRole,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));

  let md = `# Phase 7 — Role Split Analysis (step 5.4)\n\n`;
  md += `Generated ${result.generatedAt} by \`build/compute-role-split.js\`, from nav.js's real routing table (hand-transcribed, not guessed from directory names) walked through the real dependency graph.\n\n`;
  md += `**${allUnits.length} total units.** Student closure: ${student.closure.size}. Admin closure: ${admin.closure.size}. Shared: ${shared.length}. Student-only: ${studentOnly.length}. Admin-only: ${adminOnly.length}. In neither closure: ${neitherRole.length}.\n\n`;

  if (student.missing.length || admin.missing.length) {
    md += `## ⚠ Entry functions with no found declarer (needs manual check)\n\n`;
    if (student.missing.length) md += `Student: ${student.missing.join(', ')}\n\n`;
    if (admin.missing.length) md += `Admin: ${admin.missing.join(', ')}\n\n`;
  }

  md += `## Units in NEITHER closure (${neitherRole.length}) — needs a look\n\n`;
  md += `Not reachable from any known role entry point via the dependency graph. Could be: boot-sequence/core infrastructure that every page needs regardless of role (most likely, for early-loading files like \`db-service.js\`, \`auth.js\`, \`app-state.js\`), truly dead code, or something reached only via a path this graph doesn't capture (e.g. purely event-driven code with no direct call edge). Needs a human decision, not an automatic assignment — same caution as the two dead files found in session 1.\n\n`;
  for (const l of neitherRole) md += `- \`${l}\`\n`;
  md += `\n`;

  md += `## Shared (${shared.length}) — goes in both bundles\n\n`;
  for (const l of shared.slice(0, 60)) md += `- \`${l}\`\n`;
  if (shared.length > 60) md += `\n...and ${shared.length - 60} more.\n`;
  md += `\n`;

  md += `## Student-only (${studentOnly.length})\n\n`;
  for (const l of studentOnly) md += `- \`${l}\`\n`;
  md += `\n`;

  md += `## Admin-only (${adminOnly.length})\n\n`;
  for (const l of adminOnly.slice(0, 80)) md += `- \`${l}\`\n`;
  if (adminOnly.length > 80) md += `\n...and ${adminOnly.length - 80} more.\n`;

  fs.writeFileSync(OUT_MD, md);

  console.log(`Total units: ${allUnits.length}`);
  console.log(`Student closure: ${student.closure.size} | Admin closure: ${admin.closure.size}`);
  console.log(`Shared: ${shared.length} | Student-only: ${studentOnly.length} | Admin-only: ${adminOnly.length}`);
  console.log(`Neither role (needs a look): ${neitherRole.length}`);
  if (student.missing.length) console.log(`Student entry fns with no declarer:`, student.missing);
  if (admin.missing.length) console.log(`Admin entry fns with no declarer:`, admin.missing);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
}

main();
