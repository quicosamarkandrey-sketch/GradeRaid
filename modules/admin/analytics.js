// ══════════════════════════════════════════════════════
//  modules/admin/analytics.js
//  Class Analytics dashboard renderer
//  Extracted from index.html (Phase 3 Day 18-19)
//
//  NOTE: This is the BASE renderAnalytics. Two monkey-patches
//  from other modules (shop/promotions → orders block, and
//  registrations → registration block) extend this via IIFE
//  patterns; those patches live in their respective modules and
//  will be merged in Phase 5. For now they remain in index.html.
//
//  CHUNK F (ISOLATION_ROLES_PLAN.md §11 "Aggregate analytics rollup", §12
//  step 5) — two changes on top of the base screen above:
//    1. BUGFIX: the header label was hardcoded to "Grade 8-A" regardless of
//       who was logged in — see phase33_registrations_and_bossstudio_scoping.sql's
//       closing note, which flagged this file (and student-manager.js,
//       already fixed) as the follow-up. A duplicate, unused top-level copy
//       of this file (root analytics.js — never <script>-loaded by
//       index.html, confirmed) had already picked up the getMySectionsLabel()
//       fix; that fix never made it into THIS file, the one actually
//       wired in. Same "two copies drift apart" bug class this project's
//       SYNC_AUDIT_REPORT.md already documented for `titles`/`store`.
//    2. NEW — an admin-only "School-Wide Rollup" mode. DB.students already
//       contains every student in the school for an admin session (Phase
//       14's profiles_select_scoped has no per-teacher filter for
//       role='admin') — so the DEFAULT view here was already a blended
//       school-wide average with no way to see it broken down by section/
//       teacher. This adds that breakdown as its own explicit, opt-in mode
//       (§11: "admin needs the cross-teacher aggregate view restored as its
//       own explicit mode") rather than changing the default screen anyone
//       (teacher or admin) sees. No new RPC — built entirely from data an
//       admin session already has in full: DB.students (Phase 14) ×
//       TeacherDirectoryService.getDirectory() (Phase 35, already returns
//       each teacher's owned sections + student counts).
// ══════════════════════════════════════════════════════

let _anlMode = 'mine';           // 'mine' | 'rollup' — rollup only ever reachable by currentRole === 'admin'
let _anlRollupTeachers = null;   // cached TeacherDirectoryService.getDirectory() rows
let _anlRollupLoading = false;
let _anlRollupError = null;

// Student Performance Matrix — search + pagination (same house pattern as
// registrations.js / quiz-builder.js: page size 20, filter-then-slice,
// re-render just the table container rather than the whole screen).
let _anlSearch = '';
let _anlPage = 1;
const ANL_PAGE_SIZE = 20;

window.anlSetSearch = function (value) {
  _anlSearch = String(value || '');
  _anlPage = 1;
  _anlRenderStudentTable();
};

window.anlGoToPage = function (page) {
  _anlPage = Math.max(1, page | 0);
  _anlRenderStudentTable();
  const table = document.getElementById('anl-student-table');
  if (table) table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
window.anlPrevPage = function () { window.anlGoToPage(_anlPage - 1); };
window.anlNextPage = function () { window.anlGoToPage(_anlPage + 1); };

function _anlPagination(page, totalPages, totalCount, rangeStart, rangeEnd) {
  if (totalPages <= 1) {
    return `<div style="text-align:center;margin-top:10px;font-size:11px;color:var(--text-muted)">Showing all ${totalCount}</div>`;
  }
  const nums = new Set([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  const pages = Array.from(nums).filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  let btns = '';
  let prevN = 0;
  pages.forEach(n => {
    if (n - prevN > 1) btns += `<span style="padding:0 6px;color:var(--text-muted);font-size:11px">…</span>`;
    btns += `<button class="btn btn-ghost btn-sm" style="${n === page ? 'background:var(--primary);color:#fff;font-weight:800' : ''}" onclick="anlGoToPage(${n})">${n}</button>`;
    prevN = n;
  });
  return `
  <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:14px">
    <button class="btn btn-ghost btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="anlPrevPage()">← Prev</button>
    ${btns}
    <button class="btn btn-ghost btn-sm" ${page >= totalPages ? 'disabled' : ''} onclick="anlNextPage()">Next →</button>
  </div>
  <div style="text-align:center;margin-top:8px;font-size:11px;color:var(--text-muted)">Showing ${rangeStart}–${rangeEnd} of ${totalCount}</div>`;
}

/** Re-renders just the Student Performance Matrix (search/page changes skip the full dashboard repaint). */
function _anlRenderStudentTable() {
  const el = document.getElementById('anl-student-table');
  if (!el) return;
  const q = _anlSearch.trim().toLowerCase();
  const sorted = [...DB.students].sort((a, b) => b.xp - a.xp);
  const filtered = q
    ? sorted.filter(s => (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q))
    : sorted;

  if (!filtered.length) {
    el.innerHTML = `<div class="glass-card" style="text-align:center;padding:48px">
      <div style="font-size:36px;margin-bottom:10px">🔍</div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:800;margin-bottom:4px">${q ? 'No students match your search' : 'No students yet'}</div>
      <div style="color:var(--text-muted);font-size:13px">${q ? 'Try a different name or ID.' : ''}</div>
    </div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / ANL_PAGE_SIZE));
  if (_anlPage > totalPages) _anlPage = totalPages;
  const start = (_anlPage - 1) * ANL_PAGE_SIZE;
  const shown = filtered.slice(start, start + ANL_PAGE_SIZE);

  el.innerHTML = `
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th>#</th><th>Student</th><th>Level</th><th>XP</th><th>Coins</th><th>Attendance</th><th>Quiz Avg</th><th>Quests</th></tr></thead>
      <tbody>
        ${shown.map((s, i) => `<tr>
          <td style="font-family:var(--fm);font-size:10px;color:var(--text-muted)">${String(start + i + 1).padStart(2, '0')}</td>
          <td><div style="display:flex;align-items:center;gap:10px">
            <div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:10px;background:${s.color + '22'};color:${s.color};border:1.5px solid ${s.color + '44'};flex-shrink:0">${s.init}</div>
            <div><div style="font-weight:600;font-size:13px">${s.name}</div><div style="font-size:9px;color:var(--text-muted);letter-spacing:.04em">ID:${s.id.toUpperCase()}</div></div>
          </div></td>
          <td><span class="badge-pill bp-primary" style="font-size:10px">LV ${s.level}</span></td>
          <td style="color:#d0bcff;font-weight:700;font-family:var(--fh)">${s.xp.toLocaleString()}</td>
          <td><span class="coin-tag">🪙 ${s.coins.toLocaleString()}</span></td>
          <td style="color:#4edea3;font-weight:700">${s.attendance}%</td>
          <td style="color:#ffb95f;font-weight:700">${s.quizAvg}%</td>
          <td style="font-family:var(--fm);font-size:12px">${s.completedQuizzes.length}<span style="color:var(--text-muted)">/${DB.quizzes.length}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ${_anlPagination(_anlPage, totalPages, filtered.length, start + 1, start + shown.length)}`;
}

window.anlSetMode = function(mode) {
  if (currentRole !== 'admin') return; // defense in depth — button itself is admin-only, see below
  _anlMode = (mode === 'rollup') ? 'rollup' : 'mine';
  renderAnalytics();
};

window.renderAnalytics = function() {
  const el = document.getElementById('a-analytics');
  if (!el) return;

  const modeToggle = currentRole === 'admin' ? `
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-sm ${_anlMode === 'mine' ? 'btn-primary' : 'btn-ghost'}" onclick="anlSetMode('mine')">📊 Standard View</button>
      <button class="btn btn-sm ${_anlMode === 'rollup' ? 'btn-primary' : 'btn-ghost'}" onclick="anlSetMode('rollup')">🏫 School-Wide Rollup</button>
    </div>` : '';

  if (_anlMode === 'rollup' && currentRole === 'admin') {
    _anlRenderRollupShell(el, modeToggle);
    return;
  }

  const total = DB.students.length;
  const avgXP = total ? Math.round(DB.students.reduce((a, s) => a + s.xp, 0) / total) : 0;
  const totalCoins = DB.students.reduce((a, s) => a + s.coins, 0);
  const avgQuiz = total ? Math.round(DB.students.reduce((a, s) => a + s.quizAvg, 0) / total) : 0;
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const dayVals = [420, 680, 520, 760, 890, 340, 430];
  const maxV = Math.max(...dayVals);

  el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">📊 Intelligence Dashboard</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Class Analytics</h1>
      <p style="font-size:14px;color:var(--text-muted)">${typeof getMySectionsLabel === 'function' ? getMySectionsLabel() : 'All Sections'} · Real-time class intelligence</p>
      ${modeToggle}
    </div>
  </div>
  <div class="stat-grid" style="margin-bottom:24px">
    <div class="stat-card"><div class="val" style="color:#d0bcff">${total}</div><div class="lbl">Students</div></div>
    <div class="stat-card"><div class="val" style="color:#ffb95f">${avgXP.toLocaleString()}</div><div class="lbl">Avg XP</div></div>
    <div class="stat-card"><div class="val" style="color:#4edea3">${totalCoins.toLocaleString()}</div><div class="lbl">Total Coins</div></div>
    <div class="stat-card"><div class="val" style="color:#fb923c">${avgQuiz}%</div><div class="lbl">Avg Quiz Score</div></div>
  </div>
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:24px">
    <div class="glass-card">
      <h3>📈 Weekly Activity</h3>
      <div style="display:flex;align-items:flex-end;gap:10px;height:100px">
        ${days.map((d, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
          <div style="flex:1;width:100%;display:flex;align-items:flex-end">
            <div style="width:100%;background:linear-gradient(180deg,#8b5cf6,rgba(139,92,246,.3));border-radius:4px 4px 0 0;height:${Math.round(dayVals[i] / maxV * 80)}px;transition:height .6s;box-shadow:0 0 8px rgba(139,92,246,.3)"></div>
          </div>
          <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.04em">${d}</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="glass-card">
      <h3>📊 Point Sources</h3>
      ${[{l:'Quizzes',p:35,c:'#ffb95f'},{l:'Participation',p:25,c:'#8b5cf6'},{l:'Attendance',p:20,c:'#4edea3'},{l:'Projects',p:12,c:'#f97316'},{l:'Behavior',p:8,c:'#d0bcff'}].map(s => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:var(--text-muted)">${s.l}</span><span style="font-size:11px;color:${s.c};font-weight:700">${s.p}%</span></div>
        <div style="background:rgba(255,255,255,.05);border-radius:20px;height:5px;overflow:hidden"><div style="height:100%;border-radius:20px;width:${s.p}%;background:${s.c};box-shadow:0 0 6px ${s.c}66;transition:width .6s"></div></div>
      </div>`).join('')}
    </div>
  </div>
  <div class="section-header"><span class="material-symbols-outlined">table_chart</span><h2>Student Performance Matrix</h2>
    <button class="btn btn-primary btn-sm" onclick="openAwardPoints()" style="margin-left:auto">⚡ Award Points</button>
  </div>
  <div style="margin-bottom:14px;max-width:280px">
    <input type="text" placeholder="Search student name or ID…" value="${_esc(_anlSearch)}" oninput="anlSetSearch(this.value)">
  </div>
  <div id="anl-student-table"></div>`;

  _anlRenderStudentTable();
};

// ── ADMIN-ONLY: SCHOOL-WIDE ROLLUP MODE ────────────────────────────────
// (Chunk F.) Fetches the teacher directory once per session (cached in
// _anlRollupTeachers, same lazy-load-once pattern content-oversight.js's
// picker and audit-log.js's teacher filter already use), then joins it
// against DB.students (already unfiltered for an admin session) purely in
// JS. No RPC of this file's own — see the file header.
async function _anlRenderRollupShell(el, modeToggle) {
  el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🏫 School-Wide Rollup</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Class Analytics</h1>
      <p style="font-size:14px;color:var(--text-muted)">Every section, every teacher · Cross-school aggregate</p>
      ${modeToggle}
    </div>
  </div>
  <div id="anl-rollup-body">${_anlRollupLoading ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading school-wide data…</div>` : ''}</div>`;

  if (_anlRollupTeachers === null || _anlRollupLoading) {
    _anlRollupLoading = true;
    const res = await TeacherDirectoryService.getDirectory();
    _anlRollupLoading = false;
    if (!res.ok) { _anlRollupError = res.error; _anlRollupTeachers = null; }
    else { _anlRollupTeachers = res.teachers; _anlRollupError = null; }
  }

  const body = document.getElementById('anl-rollup-body');
  // Guard against a stale async fetch landing after the person switched
  // back to 'mine' (or navigated away) mid-fetch — same pattern
  // content-oversight.js uses around its own await boundary.
  if (!body || _anlMode !== 'rollup' || currentRole !== 'admin') return;

  if (_anlRollupError) {
    body.innerHTML = `<div class="glass-card" style="padding:16px;color:#ff6b6b">⚠️ ${_esc(_anlRollupError)}</div>`;
    return;
  }

  body.innerHTML = _anlRollupBodyHTML(_anlRollupTeachers || []);
}

function _anlRollupBodyHTML(teachers) {
  const students = DB.students || [];
  const totalStudents = students.length;
  const avgXP = totalStudents ? Math.round(students.reduce((a, s) => a + s.xp, 0) / totalStudents) : 0;
  const avgQuiz = totalStudents ? Math.round(students.reduce((a, s) => a + s.quizAvg, 0) / totalStudents) : 0;
  const avgAttendance = totalStudents ? Math.round(students.reduce((a, s) => a + (s.attendance || 0), 0) / totalStudents) : 0;

  // One row per (teacher, section) — a teacher advising 3 sections gets 3
  // rows, matching how the plan frames this ("across every section, not
  // just one teacher's"), not collapsed to one row per teacher.
  const sectionRows = [];
  teachers.forEach(t => {
    (t.sections || []).filter(s => !s.archived).forEach(s => {
      const inSection = students.filter(st => st.classId === s.id);
      const n = inSection.length;
      sectionRows.push({
        teacherName: t.displayName || t.email || t.id,
        sectionLabel: s.label,
        studentCount: n,
        avgXP: n ? Math.round(inSection.reduce((a, st) => a + st.xp, 0) / n) : 0,
        avgQuiz: n ? Math.round(inSection.reduce((a, st) => a + st.quizAvg, 0) / n) : 0,
        avgAttendance: n ? Math.round(inSection.reduce((a, st) => a + (st.attendance || 0), 0) / n) : 0,
      });
    });
  });
  sectionRows.sort((a, b) => b.studentCount - a.studentCount);

  const teacherCount = teachers.length;
  const sectionCount = sectionRows.length;
  const topPerformers = [...students].sort((a, b) => b.xp - a.xp).slice(0, 10);

  return `
  <div class="stat-grid" style="margin-bottom:24px">
    <div class="stat-card"><div class="val" style="color:#d0bcff">${totalStudents}</div><div class="lbl">Students, School-Wide</div></div>
    <div class="stat-card"><div class="val" style="color:#60a5fa">${sectionCount}</div><div class="lbl">Sections</div></div>
    <div class="stat-card"><div class="val" style="color:#a78bfa">${teacherCount}</div><div class="lbl">Teacher Accounts</div></div>
    <div class="stat-card"><div class="val" style="color:#ffb95f">${avgXP.toLocaleString()}</div><div class="lbl">Avg XP</div></div>
    <div class="stat-card"><div class="val" style="color:#4edea3">${avgAttendance}%</div><div class="lbl">Avg Attendance</div></div>
    <div class="stat-card"><div class="val" style="color:#fb923c">${avgQuiz}%</div><div class="lbl">Avg Quiz Score</div></div>
  </div>

  <div class="section-header"><span class="material-symbols-outlined">groups</span><h2>Enrollment &amp; Engagement by Section</h2></div>
  <div class="glass-card" style="padding:0;overflow:hidden;margin-bottom:24px">
    <table class="admin-table">
      <thead><tr><th>Teacher</th><th>Section</th><th style="text-align:center">Students</th><th>Avg XP</th><th>Avg Attendance</th><th>Avg Quiz</th></tr></thead>
      <tbody>
        ${sectionRows.map(r => `<tr>
          <td>${_esc(r.teacherName)}</td>
          <td>${_esc(r.sectionLabel)}</td>
          <td style="text-align:center">${r.studentCount}</td>
          <td style="color:#d0bcff;font-weight:700">${r.avgXP.toLocaleString()}</td>
          <td style="color:#4edea3;font-weight:700">${r.avgAttendance}%</td>
          <td style="color:#ffb95f;font-weight:700">${r.avgQuiz}%</td>
        </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No sections created yet.</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="section-header"><span class="material-symbols-outlined">military_tech</span><h2>Top Performers, School-Wide</h2></div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th>#</th><th>Student</th><th>Section</th><th>Level</th><th>XP</th></tr></thead>
      <tbody>
        ${topPerformers.map((s, i) => `<tr>
          <td style="font-family:var(--fm);font-size:10px;color:var(--text-muted)">${String(i + 1).padStart(2, '0')}</td>
          <td><div style="display:flex;align-items:center;gap:10px">
            <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:10px;background:${s.color + '22'};color:${s.color};border:1.5px solid ${s.color + '44'};flex-shrink:0">${s.init}</div>
            <div style="font-weight:600;font-size:13px">${_esc(s.name)}</div>
          </div></td>
          <td style="font-size:12px;color:var(--text-muted)">${_esc(typeof getClassLabel === 'function' ? getClassLabel(s.classId) : (s.classId || '—'))}</td>
          <td><span class="badge-pill bp-primary" style="font-size:10px">LV ${s.level}</span></td>
          <td style="color:#d0bcff;font-weight:700;font-family:var(--fh)">${s.xp.toLocaleString()}</td>
        </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No students yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

console.log('[EduQuest] Admin Analytics loaded.');
