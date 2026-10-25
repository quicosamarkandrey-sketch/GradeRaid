// ─────────────────────────────────────────────────────────────────────────────
// src/modules/admin/student-manager.js
// Real-ESM twin of ../../../modules/admin/student-manager.js, which stays
// completely untouched. Phase 7, Stream B — step 5.3.
//
// Both top-level declarations exported (openAwardPoints, doAwardPoints),
// matching declaresCount 2 exactly. DB, _esc, showModal, closeModalForce,
// toast, AppStore, checkLevelUp, uid, syncStudentStatsToServer,
// currentRole, currentUser, and renderAdminDashboard are all read as bare
// globals (window fallback) — renderAdminDashboard specifically lives in
// this stream's own modules/admin/command-center.js, not yet converted at
// the time of this file's conversion, so it stays window-fallback for now
// (no cycle: command-center.js does not depend back on this file).
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════
//  modules/admin/student-manager.js
//  Award Points system
//  Extracted from index.html (Phase 3 Day 18-19)
//
//  NOTE: renderAdminDashboard() used to live in this file. It has moved to
//  modules/admin/command-center.js (Visual Enhancement Guide rollout,
//  Redesign Proposal §6.4) — that file is now the single source of truth
//  for window.renderAdminDashboard and must load AFTER this file so its
//  definition wins. The old implementation below has been removed.
// ══════════════════════════════════════════════════════


// ── AWARD POINTS ───────────────────────────────────────
export function openAwardPoints() {
  const studentOpts = DB.students.map(s => `<option value="${s.id}">${_esc(s.name)}</option>`).join('');
  showModal(`<div class="modal-h2">⚡ Award Points</div>
    <div class="form-group"><label class="form-label">Student</label>
      <select id="aw-student" style="width:100%"><option value="all">🌟 Entire Class</option>${studentOpts}</select></div>
    <div class="form-group"><label class="form-label">Category</label>
      <select id="aw-cat" style="width:100%"><option>Recitation</option><option>Attendance</option><option>Quiz Performance</option><option>Good Behavior</option><option>Project</option><option>Homework</option><option>Classroom Role</option><option>Custom</option></select></div>
    <div class="form-group"><label class="form-label">Points (negative to deduct)</label>
      <input type="number" id="aw-pts" value="10" style="width:100%"></div>
    <div class="form-group"><label class="form-label">Note (optional)</label>
      <input type="text" id="aw-note" placeholder="e.g. answered question correctly" style="width:100%"></div>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="doAwardPoints()">Award ⚡</button>
    </div>`, 'sm');
};

export function doAwardPoints() {
  const sid = document.getElementById('aw-student').value;
  const cat = document.getElementById('aw-cat').value;
  const pts = parseInt(document.getElementById('aw-pts').value) || 0;
  const note = document.getElementById('aw-note').value.trim();
  if (pts === 0) { toast('❌ Enter a point value', '#ffb4ab'); return; }
  const allStudents = AppStore.getSlice(s => s.students) || [];
  const targets = sid === 'all' ? allStudents.map(s => s.id) : [sid];
  let awardedName = null;
  AppStore.updateState(draft => {
    targets.forEach(id => {
      const s = (draft.students || []).find(x => x.id === id);
      if (s) {
        // Critical Fix #4: Apply both positive and negative XP, floor at 0
        s.xp = Math.max(0, s.xp + pts);
        // Critical Fix #2: Recalculate level/tier after XP change — must run
        // here, inside the draft, not on an already-committed object.
        window.checkLevelUp(s);
        // Minor fix: real timestamp instead of always 'Just now'
        // Phase 67: createdAt added — see notification-service.js header comment.
        if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
        draft.pointLog.unshift({ id: 'pl_' + uid(), studentId: id, what: cat + (note ? ': ' + note : ''), pts, when: new Date().toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}), createdAt: new Date().toISOString() });
        if (id === sid) awardedName = s.name;
      }
    });
  }, { type: 'admin:award-points', payload: { sid, pts } });
  // syncStudentStatsToServer makes a network RPC call per target — fire
  // after the local commit above, same "optimistic local update, then
  // best-effort server reconciliation" pattern the function itself documents.
  targets.forEach(id => syncStudentStatsToServer(id, pts, 0));
  // Sync currentUser if it was updated
  if (currentRole === 'student') {
    const updated = AppStore.getStudent(currentUser.id);
    if (updated) currentUser = updated;
  }
  closeModalForce();
  toast(`✅ ${pts > 0 ? '+' : ''}${pts} pts → ${sid === 'all' ? 'Entire Class' : awardedName}`);
  renderAdminDashboard();
};

console.log('[EduQuest] Admin Student Manager loaded.');
