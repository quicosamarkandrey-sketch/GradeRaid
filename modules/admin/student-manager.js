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
window.openAwardPoints = function() {
  const studentOpts = DB.students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
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

window.doAwardPoints = function() {
  const sid = document.getElementById('aw-student').value;
  const cat = document.getElementById('aw-cat').value;
  const pts = parseInt(document.getElementById('aw-pts').value) || 0;
  const note = document.getElementById('aw-note').value.trim();
  if (pts === 0) { toast('❌ Enter a point value', '#ffb4ab'); return; }
  const targets = sid === 'all' ? DB.students.map(s => s.id) : [sid];
  targets.forEach(id => {
    const idx = DB.students.findIndex(s => s.id === id);
    if (idx >= 0) {
      // Critical Fix #4: Apply both positive and negative XP, floor at 0
      DB.students[idx].xp = Math.max(0, DB.students[idx].xp + pts);
      syncStudentStatsToServer(id, pts, 0);
      // Critical Fix #2: Recalculate level/tier after XP change
      window.checkLevelUp(DB.students[idx]);
      // Minor fix: real timestamp instead of always 'Just now'
      // Phase 67: createdAt added — see notification-service.js header comment.
      DB.pointLog.unshift({ id: 'pl_' + uid(), studentId: id, what: cat + (note ? ': ' + note : ''), pts, when: new Date().toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}), createdAt: new Date().toISOString() });
    }
  });
  // Sync currentUser if it was updated
  if (currentRole === 'student') {
    const updated = DB.students.find(s => s.id === currentUser.id);
    if (updated) currentUser = updated;
  }
  saveDB();
  closeModalForce();
  toast(`✅ ${pts > 0 ? '+' : ''}${pts} pts → ${sid === 'all' ? 'Entire Class' : DB.students.find(s => s.id === sid)?.name}`);
  renderAdminDashboard();
};

console.log('[EduQuest] Admin Student Manager loaded.');
