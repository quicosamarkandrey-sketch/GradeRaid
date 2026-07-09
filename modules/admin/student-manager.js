// ══════════════════════════════════════════════════════
//  modules/admin/student-manager.js
//  Admin Dashboard + Award Points system
//  Extracted from index.html (Phase 3 Day 18-19)
// ══════════════════════════════════════════════════════

// ── RENDER ADMIN DASHBOARD ─────────────────────────────
window.renderAdminDashboard = function() {
  const totalStudents = DB.students.length;
  const totalPoints = DB.pointLog.reduce((a, e) => a + Math.max(0, e.pts), 0);
  const totalRedeemed = DB.redemptions.length;
  const avgXP = Math.round(DB.students.reduce((a, s) => a + s.xp, 0) / totalStudents);

  document.getElementById('a-dashboard').innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🛡️ Command Center</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Welcome, ${currentUser.name}</h1>
      <p style="font-size:14px;color:var(--text-muted)">${typeof getMySectionsLabel === 'function' ? getMySectionsLabel() : 'All Sections'} &nbsp;·&nbsp; Class Intelligence Dashboard</p>
    </div>
  </div>

  <div class="stat-grid">
    <div class="stat-card"><div class="val" style="color:#d0bcff">${totalStudents}</div><div class="lbl">Students</div></div>
    <div class="stat-card"><div class="val" style="color:#ffb95f">${totalPoints.toLocaleString()}</div><div class="lbl">Points Awarded</div></div>
    <div class="stat-card"><div class="val" style="color:#4edea3">${totalRedeemed}</div><div class="lbl">Redeemed</div></div>
    <div class="stat-card"><div class="val" style="color:#fb923c">${avgXP.toLocaleString()}</div><div class="lbl">Avg XP</div></div>
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
    <div>
      <!-- STUDENT ROSTER -->
      <div class="section-header"><span class="material-symbols-outlined">groups</span><h2>Student Roster</h2>
        <button class="btn btn-primary btn-sm" onclick="openAwardPoints()" style="margin-left:auto">⚡ Award Points</button>
      </div>
      <div class="glass-card" style="padding:0;overflow:hidden">
        <table class="admin-table">
          <thead><tr><th>Student</th><th>Level</th><th>XP</th><th>Coins</th><th>Attendance</th><th>Quiz Avg</th></tr></thead>
          <tbody>
            ${[...DB.students].sort((a, b) => b.xp - a.xp).map((s, i) => {
              const pct = Math.min(100, Math.round(s.xp / ((s.level + 1) * window.XP_PER_LEVEL) * 100));
              return `<tr>
                <td><div style="display:flex;align-items:center;gap:10px">
                  <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:11px;background:${s.color + '22'};color:${s.color};border:1.5px solid ${s.color + '44'};flex-shrink:0">${s.init}</div>
                  <div><div style="font-weight:700;font-size:13px">${s.name}</div>
                    <div style="background:rgba(255,255,255,.05);border-radius:20px;height:3px;width:80px;overflow:hidden;margin-top:4px"><div style="height:100%;border-radius:20px;width:${pct}%;background:linear-gradient(90deg,#8b5cf6,#d0bcff)"></div></div>
                  </div>
                </div></td>
                <td><span class="badge-pill bp-primary" style="font-size:10px">LV ${s.level}</span></td>
                <td style="color:#d0bcff;font-weight:700;font-family:var(--fh)">${s.xp.toLocaleString()}</td>
                <td><span class="coin-tag">🪙 ${s.coins.toLocaleString()}</span></td>
                <td style="color:#4edea3;font-weight:700">${s.attendance}%</td>
                <td style="color:#ffb95f;font-weight:700">${s.quizAvg}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- RECENT EVENTS -->
      <div class="section-header" style="margin-top:24px"><span class="material-symbols-outlined">history</span><h2>Recent Events</h2></div>
      <div class="glass-card" style="padding:16px">
        <div class="pt-events">
          ${DB.pointLog.slice(0, 8).map(e => `
          <div class="pt-event">
            <div class="pt-delta" style="color:${e.pts > 0 ? '#4edea3' : '#ffb4ab'}">${e.pts > 0 ? '+' : ''}${e.pts}</div>
            <div class="pt-info">
              <div class="pt-what">${e.what}</div>
              <div class="pt-when">${DB.students.find(s => s.id === e.studentId)?.name || e.studentId} · ${e.when}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- SIDEBAR -->
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="section-header"><span class="material-symbols-outlined">bolt</span><h2>Quick Actions</h2></div>
      <div class="glass-card">
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-primary btn-block" onclick="openAwardPoints()">⚡ Award Points</button>
          <button class="btn btn-ghost btn-block" onclick="navTo('a-scanner')">📡 Scanner & Records</button>
          <button class="btn btn-ghost btn-block" onclick="navTo('a-store')">🏪 Manage Armory</button>
          <button class="btn btn-ghost btn-block" onclick="navTo('a-quizzes')">📝 Quest Builder</button>
          <button class="btn btn-ghost btn-block" onclick="navTo('a-analytics')">📊 Analytics</button>
        </div>
      </div>
      <div class="glass-card">
        <h3>Armory Status</h3>
        ${[
          { l: 'Total Items', v: DB.store.length, c: 'var(--text)' },
          { l: 'Low Stock ≤3', v: DB.store.filter(i => i.stock <= 3).length, c: '#ffb95f' },
          { l: 'Out of Stock', v: DB.store.filter(i => i.stock === 0).length, c: '#ffb4ab' }
        ].map(r => `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px">
          <span style="color:var(--text-muted)">${r.l}</span><span style="font-weight:700;color:${r.c}">${r.v}</span>
        </div>`).join('')}
      </div>
      <div class="glass-card">
        <h3>Quest System</h3>
        ${[
          { l: 'Total Quests', v: DB.quizzes.length },
          { l: 'Total Questions', v: DB.quizzes.reduce((a, q) => a + q.questions.length, 0) }
        ].map(r => `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px">
          <span style="color:var(--text-muted)">${r.l}</span><span style="font-weight:700;color:#d0bcff">${r.v}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
};

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
      DB.pointLog.unshift({ id: 'pl_' + uid(), studentId: id, what: cat + (note ? ': ' + note : ''), pts, when: new Date().toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) });
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
