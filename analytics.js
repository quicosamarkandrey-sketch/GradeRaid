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
// ══════════════════════════════════════════════════════

window.renderAnalytics = function() {
  const total = DB.students.length;
  const avgXP = Math.round(DB.students.reduce((a, s) => a + s.xp, 0) / total);
  const totalCoins = DB.students.reduce((a, s) => a + s.coins, 0);
  const avgQuiz = Math.round(DB.students.reduce((a, s) => a + s.quizAvg, 0) / total);
  const sorted = [...DB.students].sort((a, b) => b.xp - a.xp);
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const dayVals = [420, 680, 520, 760, 890, 340, 430];
  const maxV = Math.max(...dayVals);

  document.getElementById('a-analytics').innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">📊 Intelligence Dashboard</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Class Analytics</h1>
      <p style="font-size:14px;color:var(--text-muted)">${typeof getMySectionsLabel === 'function' ? getMySectionsLabel() : 'All Sections'} · Real-time class intelligence</p>
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
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th>#</th><th>Student</th><th>Level</th><th>XP</th><th>Coins</th><th>Attendance</th><th>Quiz Avg</th><th>Quests</th></tr></thead>
      <tbody>
        ${sorted.map((s, i) => `<tr>
          <td style="font-family:var(--fm);font-size:10px;color:var(--text-muted)">${String(i + 1).padStart(2, '0')}</td>
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
  </div>`;
};

console.log('[EduQuest] Admin Analytics loaded.');
