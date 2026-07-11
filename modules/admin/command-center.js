// ══════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/command-center.js
//  Admin/Teacher "Command Center" dashboard (a-dashboard) redesign.
//  See EduQuest-Redesign-Proposal.md §6.4 for the full spec this implements:
//    1. Hero band                — class health snapshot
//    2. Attention queue          — PRIMARY focal element, "what needs you today"
//    3. Live classroom pulse     — compact real-time strip
//    4. Trend & analytics preview — lightweight teaser, links out to full Analytics
//    5. Shortcuts row            — fast paths into daily tools
//
//  ROLE SCOPING: no manual filtering happens in this file. DB.students and
//  DB.registrations already arrive pre-scoped per role from Supabase
//  (profiles_select_scoped has no per-teacher filter for role='admin', but
//  DOES filter for role='teacher' — see analytics.js header for the same
//  note). So a teacher's DB.students/DB.registrations already contain only
//  their own section; an admin's contain everyone. This file just presents
//  whatever's in DB, with copy/framing that differs by currentRole.
//
//  DATA GAPS (flagged per user request rather than faked):
//    - No live "students online now" presence system exists yet, so the
//      Live Pulse section shows the Recent Events feed + active World Boss
//      state instead of a presence count. A real presence feature would need
//      its own realtime channel — out of scope here.
//    - No daily/historical snapshot table exists, so "trend" here means
//      "current distribution" (point-category breakdown, top performers),
//      not "change since yesterday". A real trend chart needs a daily
//      rollup RPC (same shape as the sync-audit report's existing
//      sync_student_derived_stats work) — flagging as a future Chunk.
// ══════════════════════════════════════════════════════════════════════════

// ── Category list — must match the <select id="aw-cat"> options in
//    openAwardPoints() (student-manager.js) since that's the only place
//    pointLog.what strings originate from for teacher-awarded points. ──
const _CC_AWARD_CATEGORIES = ['Recitation', 'Attendance', 'Quiz Performance', 'Good Behavior', 'Project', 'Homework', 'Classroom Role', 'Custom'];

function _ccCategoryOf(what) {
  const hit = _CC_AWARD_CATEGORIES.find(c => what.indexOf(c) === 0);
  return hit || 'Other';
}

window.renderAdminDashboard = function () {
  const el = document.getElementById('a-dashboard');
  if (!el) return;

  const isAdmin = currentRole === 'admin';
  const students = DB.students || [];
  const total = students.length;
  const avgAttendance = total ? Math.round(students.reduce((a, s) => a + (s.attendance || 0), 0) / total) : 0;
  const avgQuiz = total ? Math.round(students.reduce((a, s) => a + (s.quizAvg || 0), 0) / total) : 0;
  const avgXP = total ? Math.round(students.reduce((a, s) => a + (s.xp || 0), 0) / total) : 0;

  const scopeLabel = typeof getMySectionsLabel === 'function' ? getMySectionsLabel() : 'All Sections';
  const heroLabel = isAdmin ? '🏫 School-Wide Command Center' : '🛡️ Command Center';
  const heroDesc = isAdmin ? 'Every section, every teacher' : 'Your classroom, live';

  el.innerHTML = `
  ${_ccHeroHTML(heroLabel, heroDesc, scopeLabel, total, avgAttendance, avgQuiz, avgXP)}
  <div class="cc-layout" style="display:grid;grid-template-columns:1.6fr 1fr;gap:22px;align-items:start">
    <div>
      ${_ccAttentionHTML(isAdmin)}
      ${_ccPulseHTML()}
      ${_ccTrendHTML(students)}
    </div>
    ${_ccShortcutsHTML(isAdmin)}
  </div>`;
};

// ── HERO ILLUSTRATION — small original line-art moment reserved for this
//    hero surface only (proposal §4.6). A floating grad-cap + constellation
//    of orbiting dots/sparkles, built from plain SVG shapes (no copyrighted
//    art/characters), colored from the existing token palette so it reads
//    as "part of EduQuest" rather than a bolted-on stock graphic. ──
function _ccHeroIllustrationSVG() {
  return `
  <svg class="cc-hero-illust" viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <circle class="cc-hi-orb cc-hi-o1" cx="46" cy="34" r="3.4"/>
    <circle class="cc-hi-orb cc-hi-o2" cx="230" cy="26" r="2.6"/>
    <circle class="cc-hi-orb cc-hi-o3" cx="264" cy="118" r="2.2"/>
    <circle class="cc-hi-orb cc-hi-o4" cx="26" cy="150" r="2.6"/>
    <circle class="cc-hi-orb cc-hi-o5" cx="150" cy="18" r="2"/>
    <path class="cc-hi-link" d="M46 34 L150 18 L230 26"/>
    <path class="cc-hi-link" d="M26 150 L46 34"/>
    <g class="cc-hi-cap" transform="translate(110,60)">
      <path d="M50 0 L100 22 L50 44 L0 22 Z"/>
      <path d="M50 44 L50 66"/>
      <path d="M26 32 L26 54 C26 62 74 62 74 54 L74 32"/>
      <circle class="cc-hi-tassel-tip" cx="96" cy="22" r="3.2"/>
      <path d="M96 22 L96 60"/>
    </g>
    <g class="cc-hi-sparkle cc-hi-s1"><path d="M0 -9 L0 9 M-9 0 L9 0"/></g>
    <g class="cc-hi-sparkle cc-hi-s2" transform="translate(205,150)"><path d="M0 -7 L0 7 M-7 0 L7 0"/></g>
    <g class="cc-hi-sparkle cc-hi-s3" transform="translate(55,95)"><path d="M0 -6 L0 6 M-6 0 L6 0"/></g>
  </svg>`;
}

// ── 1. HERO BAND ────────────────────────────────────────────────────────────
function _ccHeroHTML(label, desc, scopeLabel, total, avgAttendance, avgQuiz, avgXP) {
  const attColor = avgAttendance >= 90 ? '#4edea3' : avgAttendance >= 75 ? '#ffb95f' : '#ff6b81';
  const quizColor = avgQuiz >= 85 ? '#4edea3' : avgQuiz >= 70 ? '#ffb95f' : '#ff6b81';
  return `
  <div class="page-hero cc-hero">
    <div class="page-hero-bg"></div>
    <div class="page-hero-bg2"></div>
    <div class="page-hero-bg3"></div>
    ${_ccHeroIllustrationSVG()}
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">${label}</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Welcome, ${_esc(currentUser.name)}</h1>
      <p style="font-size:14px;color:var(--text-muted)">${_esc(scopeLabel)} &nbsp;·&nbsp; ${desc}</p>
      <div class="cc-hero-health">
        <div class="cc-health-metric">
          <div class="cc-hm-icon" style="background:rgba(208,188,255,.14);color:#d0bcff"><span class="material-symbols-outlined">groups</span></div>
          <div class="cc-hm-val" style="color:#d0bcff">${total}</div>
          <div class="cc-hm-lbl">Students</div>
        </div>
        <div class="cc-health-metric">
          <div class="cc-hm-icon" style="background:${attColor}22;color:${attColor}"><span class="material-symbols-outlined">event_available</span></div>
          <div class="cc-hm-val" style="color:${attColor}">${avgAttendance}%</div>
          <div class="cc-hm-lbl">Avg Attendance</div>
          <div class="cc-health-bar"><div style="width:${avgAttendance}%;background:${attColor}"></div></div>
        </div>
        <div class="cc-health-metric">
          <div class="cc-hm-icon" style="background:${quizColor}22;color:${quizColor}"><span class="material-symbols-outlined">quiz</span></div>
          <div class="cc-hm-val" style="color:${quizColor}">${avgQuiz}%</div>
          <div class="cc-hm-lbl">Avg Quiz Score</div>
          <div class="cc-health-bar"><div style="width:${avgQuiz}%;background:${quizColor}"></div></div>
        </div>
        <div class="cc-health-metric">
          <div class="cc-hm-icon" style="background:rgba(255,185,95,.14);color:#ffb95f"><span class="material-symbols-outlined">bolt</span></div>
          <div class="cc-hm-val" style="color:#ffb95f">${avgXP.toLocaleString()}</div>
          <div class="cc-hm-lbl">Avg XP</div>
        </div>
      </div>
    </div>
  </div>`;
}

// ── 2. ATTENTION QUEUE (primary focal element) ──────────────────────────────
function _ccBuildAttentionItems(isAdmin) {
  const items = [];
  const students = DB.students || [];

  const pending = (DB.registrations || []).filter(r => r.status === 'pending');
  if (pending.length) {
    items.push({
      severity: 'danger', icon: '📋',
      title: `${pending.length} registration${pending.length > 1 ? 's' : ''} awaiting review`,
      sub: pending.slice(0, 3).map(r => `${r.firstName} ${r.lastName}`).join(', ') + (pending.length > 3 ? `, +${pending.length - 3} more` : ''),
      count: pending.length, action: () => navTo('a-registrations'),
    });
  }

  const lowAttendance = students.filter(s => (s.attendance || 0) < 75).sort((a, b) => a.attendance - b.attendance);
  if (lowAttendance.length) {
    items.push({
      severity: 'warn', icon: '📉',
      title: `${lowAttendance.length} student${lowAttendance.length > 1 ? 's' : ''} with low attendance (<75%)`,
      sub: lowAttendance.slice(0, 3).map(s => `${s.name} (${s.attendance}%)`).join(', ') + (lowAttendance.length > 3 ? `, +${lowAttendance.length - 3} more` : ''),
      count: lowAttendance.length, action: () => navTo('a-analytics'),
    });
  }

  const strugglingQuiz = students.filter(s => (s.quizAvg || 0) < 60 && (s.completedQuizzes || []).length > 0);
  if (strugglingQuiz.length) {
    items.push({
      severity: 'warn', icon: '🧠',
      title: `${strugglingQuiz.length} student${strugglingQuiz.length > 1 ? 's' : ''} averaging below 60% on quizzes`,
      sub: strugglingQuiz.slice(0, 3).map(s => s.name).join(', ') + (strugglingQuiz.length > 3 ? `, +${strugglingQuiz.length - 3} more` : ''),
      count: strugglingQuiz.length, action: () => navTo('a-analytics'),
    });
  }

  const outOfStock = (DB.store || []).filter(i => i.stock === 0);
  const lowStock = (DB.store || []).filter(i => i.stock > 0 && i.stock <= 3);
  if (outOfStock.length) {
    items.push({
      severity: 'danger', icon: '📦',
      title: `${outOfStock.length} Armory item${outOfStock.length > 1 ? 's' : ''} out of stock`,
      sub: outOfStock.slice(0, 3).map(i => i.name).join(', ') + (outOfStock.length > 3 ? `, +${outOfStock.length - 3} more` : ''),
      count: outOfStock.length, action: () => navTo('a-store'),
    });
  }
  if (lowStock.length) {
    items.push({
      severity: 'info', icon: '📦',
      title: `${lowStock.length} Armory item${lowStock.length > 1 ? 's' : ''} running low (≤3 left)`,
      sub: lowStock.slice(0, 3).map(i => `${i.name} (${i.stock})`).join(', ') + (lowStock.length > 3 ? `, +${lowStock.length - 3} more` : ''),
      count: lowStock.length, action: () => navTo('a-store'),
    });
  }

  return items;
}

function _ccAttentionHTML(isAdmin) {
  const items = _ccBuildAttentionItems(isAdmin);
  const body = !items.length
    ? `<div class="cc-attention-empty">
        <svg class="cc-empty-illust" viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="60" cy="46" r="34" fill="rgba(78,222,163,.1)"/>
          <path d="M40 48 L54 62 L82 32" fill="none" stroke="var(--secondary)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div style="font-family:var(--fh);font-weight:800;color:var(--on-surface);margin-bottom:4px;font-size:15px">All caught up!</div>
        <div>Nothing needs your attention right now.</div>
      </div>`
    : `<div class="cc-attention-list">${items.map((it, i) => `
      <div class="cc-attention-item cc-in" style="animation-delay:${i * 0.05}s" onclick="_ccAttentionClick(${i})">
        <div class="cc-attention-bar ${it.severity}"></div>
        <div class="cc-attention-icon ${it.severity}">${it.icon}</div>
        <div class="cc-attention-body">
          <div class="cc-attention-title">${_esc(it.title)}</div>
          <div class="cc-attention-sub">${_esc(it.sub)}</div>
        </div>
        <div class="cc-attention-count ${it.severity}">${it.count}</div>
      </div>`).join('')}</div>`;

  window._ccAttentionItems = items;

  return `
  <div class="section-header"><span class="material-symbols-outlined">notifications_active</span><h2>Needs Your Attention</h2>
    ${items.length ? `<span class="badge-pill cc-pulse-badge" style="margin-left:auto;background:rgba(255,107,129,.15);color:#ff6b81">${items.reduce((a, i) => a + i.count, 0)} total</span>` : ''}
  </div>
  <div class="cc-attention-card" style="margin-bottom:26px">${body}</div>`;
}

window._ccAttentionClick = function (i) {
  const it = (window._ccAttentionItems || [])[i];
  if (it && typeof it.action === 'function') it.action();
};

// ── 3. LIVE CLASSROOM PULSE ──────────────────────────────────────────────────
function _ccPulseHTML() {
  const cards = [];

  const found = (typeof wbcGetActiveBoss === 'function') && wbcGetActiveBoss();
  if (found) {
    const boss = found.boss;
    const maxHp = boss.maxHp || 1;
    const curHp = boss.currentHp !== undefined ? boss.currentHp : maxHp;
    const pct = Math.max(0, Math.min(100, Math.round(curHp / maxHp * 100)));
    const parts = (typeof wbcGetParticipants === 'function') ? Object.keys(wbcGetParticipants(found.idx)).length : 0;
    cards.push(`
    <div class="cc-pulse-card cc-pulse-boss" onclick="navTo('a-bossevents')" style="cursor:pointer">
      <div class="cc-pulse-head"><span class="cc-live-dot danger"></span><span class="cc-pulse-head-label">Boss Event Live</span></div>
      <div class="cc-pulse-title">${boss.image || '💀'} ${_esc(boss.name)}</div>
      <div class="cc-pulse-hpbar"><div style="width:${pct}%"></div></div>
      <div class="cc-pulse-meta"><span>${curHp.toLocaleString()} / ${maxHp.toLocaleString()} HP</span><span>${parts} joined</span></div>
    </div>`);
  } else {
    cards.push(`
    <div class="cc-pulse-card cc-pulse-dim" onclick="navTo('a-boss-studio')" style="cursor:pointer">
      <div class="cc-pulse-head"><span class="cc-live-dot" style="background:var(--text-muted);box-shadow:none;animation:none"></span><span class="cc-pulse-head-label">World Boss</span></div>
      <div class="cc-pulse-title" style="color:var(--text-muted)">No active event</div>
      <div class="cc-pulse-meta"><span>Start one from Boss Studio</span></div>
    </div>`);
  }

  const recent = (DB.pointLog || []).slice(0, 6);
  recent.forEach(e => {
    const studentName = (DB.students || []).find(s => s.id === e.studentId)?.name || e.studentId;
    const good = e.pts > 0;
    cards.push(`
    <div class="cc-pulse-card ${good ? 'cc-pulse-good' : 'cc-pulse-bad'}">
      <div class="cc-pulse-head"><span class="cc-live-dot ${good ? '' : 'warn'}"></span><span class="cc-pulse-head-label">${_esc(e.when)}</span></div>
      <div class="cc-pulse-event">
        <div class="cc-pulse-event-delta" style="color:${good ? '#4edea3' : '#ff6b81'}">${good ? '+' : ''}${e.pts} pts</div>
        <div class="cc-pulse-event-what">${_esc(studentName)} · ${_esc(e.what)}</div>
      </div>
    </div>`);
  });

  const VISIBLE = 5;
  const firstCards = cards.slice(0, VISIBLE);
  const restCards  = cards.slice(VISIBLE);

  const restHTML = restCards.length
    ? `<div class="cc-pulse-extra-wrap cc-hidden" id="cc-pulse-extra">${restCards.join('')}</div>`
    : '';

  const toggleHTML = restCards.length
    ? `<button class="cc-pulse-more-btn" id="cc-pulse-more-btn" data-more-count="${restCards.length}" onclick="_ccTogglePulseMore()">
        <span class="material-symbols-outlined" id="cc-pulse-more-icon">expand_more</span>
        <span id="cc-pulse-more-label">See ${restCards.length} more</span>
      </button>`
    : '';

  return `
  <div class="section-header"><span class="material-symbols-outlined">bolt</span><h2>Live Classroom Pulse</h2></div>
  <div class="cc-pulse-strip" id="cc-pulse-strip">${firstCards.join('')}${restHTML}</div>
  ${toggleHTML}
  <div style="margin-bottom:${restCards.length ? 0 : 26}px"></div>`;
}

window._ccTogglePulseMore = function () {
  const extra = document.getElementById('cc-pulse-extra');
  const btn   = document.getElementById('cc-pulse-more-btn');
  const label = document.getElementById('cc-pulse-more-label');
  const icon  = document.getElementById('cc-pulse-more-icon');
  if (!extra || !btn) return;
  const nowHidden = extra.classList.toggle('cc-hidden');
  if (label) label.textContent = nowHidden ? `See ${btn.dataset.moreCount} more` : 'Show less';
  if (icon)  icon.textContent  = nowHidden ? 'expand_more' : 'expand_less';
};

// ── 4. TREND & ANALYTICS PREVIEW ─────────────────────────────────────────────
function _ccTrendHTML(students) {
  const catTotals = {};
  (DB.pointLog || []).forEach(e => {
    if (e.pts <= 0) return;
    const cat = _ccCategoryOf(e.what);
    catTotals[cat] = (catTotals[cat] || 0) + e.pts;
  });
  const catColors = { Recitation: '#8b5cf6', Attendance: '#4edea3', 'Quiz Performance': '#ffb95f', 'Good Behavior': '#60a5fa', Project: '#f97316', Homework: '#d0bcff', 'Classroom Role': '#f472b6', Custom: '#a78bfa', Other: '#94a3b8' };
  const catEntries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const catMax = catEntries.length ? catEntries[0][1] : 1;

  const top5 = [...students].sort((a, b) => b.xp - a.xp).slice(0, 5);
  const podiumColors = ['#ffb95f', '#cbc3d7', '#cd7f32'];

  return `
  <div class="section-header"><span class="material-symbols-outlined">insights</span><h2>Trends</h2>
    <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="navTo('a-analytics')">Full Analytics →</button>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:8px">
    <div class="glass-card cc-in" style="animation-delay:.05s">
      <h3>Points by Category</h3>
      ${catEntries.length ? catEntries.map(([cat, pts]) => `
      <div class="cc-trend-row"><span class="cc-trend-label">${_esc(cat)}</span><span class="cc-trend-val" style="color:${catColors[cat] || '#94a3b8'}">${pts.toLocaleString()}</span></div>
      <div class="cc-trend-track"><div style="width:${Math.round(pts / catMax * 100)}%;background:${catColors[cat] || '#94a3b8'}"></div></div>`).join('')
        : `<div class="cc-trend-empty">
             <span class="material-symbols-outlined" style="font-size:26px;color:var(--primary)">auto_awesome</span>
             <div>No points awarded yet.</div>
             <button class="btn btn-primary btn-sm" onclick="openAwardPoints()">⚡ Award your first points</button>
           </div>`}
    </div>
    <div class="glass-card cc-in" style="animation-delay:.1s">
      <h3>Top Performers</h3>
      ${top5.length ? top5.map((s, i) => `
      <div class="cc-mini-lb-row">
        <div class="cc-mini-lb-rank" style="${i < 3 ? `color:${podiumColors[i]};font-weight:900` : ''}">${i < 3 ? ['🥇','🥈','🥉'][i] : i + 1}</div>
        <div class="cc-mini-lb-av" style="background:${s.color}22;color:${s.color};border-color:${s.color}55">${s.init}</div>
        <div class="cc-mini-lb-name">${_esc(s.name)}</div>
        <div class="cc-mini-lb-xp">${s.xp.toLocaleString()} XP</div>
      </div>`).join('') : `<div style="color:var(--text-muted);font-size:13px;padding:12px 0">No students yet.</div>`}
    </div>
  </div>`;
}

// ── 5. SHORTCUTS ROW ─────────────────────────────────────────────────────────
function _ccShortcutsHTML(isAdmin) {
  const shortcuts = [
    { icon: '⚡', label: 'Award Points', action: `openAwardPoints()`, c: '#ffb95f' },
    { icon: '📡', label: 'Scanner', action: `navTo('a-scanner')`, c: '#4edea3' },
    { icon: '🏪', label: 'Armory', action: `navTo('a-store')`, c: '#f97316' },
    { icon: '📝', label: 'Quest Builder', action: `navTo('a-quizzes')`, c: '#8b5cf6' },
    { icon: '📊', label: 'Analytics', action: `navTo('a-analytics')`, c: '#60a5fa' },
    { icon: '📋', label: 'Registrations', action: `navTo('a-registrations')`, c: '#f472b6' },
  ];
  if (isAdmin) {
    shortcuts.push(
      { icon: '🧑‍🏫', label: 'Teachers', action: `navTo('a-teachers')`, c: '#4ade80' },
      { icon: '🏫', label: 'Sections', action: `navTo('a-sections')`, c: '#22d3ee' },
    );
  }

  return `
  <div>
    <div class="section-header"><span class="material-symbols-outlined">rocket_launch</span><h2>Quick Actions</h2></div>
    <div class="cc-shortcut-grid">
      ${shortcuts.map((s, i) => `<div class="cc-shortcut-card cc-in" style="animation-delay:${i * 0.04}s" onclick="${s.action}">
        <div class="cc-shortcut-icon" style="background:${s.c}1f;color:${s.c};box-shadow:0 0 0 1px ${s.c}33">${s.icon}</div>
        <div class="cc-shortcut-label">${s.label}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

console.log('[EduQuest] Admin Command Center loaded.');
