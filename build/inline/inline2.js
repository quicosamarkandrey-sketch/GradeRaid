
// ── STUDENT DASHBOARD ──
function renderStudentDashboard(){
  const st = currentUser;
  st.level = window.getLevel(st.xp); 
  
  // 2. Base the next level threshold and percentages on 1000 XP increments
  const xpCurrentLevelBase = st.level * window.XP_PER_LEVEL;
  const xpInCurrentLevel = st.xp - xpCurrentLevelBase;
  const xpPct = Math.min(100, Math.round((xpInCurrentLevel / window.XP_PER_LEVEL) * 100));
  const xpNext = (st.level + 1) * window.XP_PER_LEVEL;
  // Phase 67 — "Point Activity" reworked into "Overall Activity": merges
  // DB.pointLog (recitation, attendance, quiz/campaign/boss rewards,
  // achievement + mail reward claims, admin point adjustments — everything
  // that already funnels into pointLog) with DB.orders (store purchases,
  // the one activity type that never wrote a pointLog row). Sorted by the
  // real createdAt timestamp — not the frozen 'when' string the old widget
  // used to display — and rendered with window.eqTimeAgo() so "5m ago"
  // keeps updating on every re-render instead of freezing forever.
  //
  // Text here is deliberately terse/ledger-style (raw entry.what, e.g.
  // "Quest: Algebra Basics (86%)") — the notification bell shows a
  // reworded, friendlier sentence for the same event ("Quest Completed!
  // You scored 86%..."), see notification-service.js's _classifyPointLog().
  // Only the icon is shared between the two surfaces.
  const activityFeed = [
    ...DB.pointLog.filter(l => l.studentId === st.id).map(l => {
      const c = (typeof eqClassifyActivity === 'function') ? eqClassifyActivity(l) : { icon: '⭐' };
      return { icon: c.icon, label: l.what, pts: l.pts, createdAt: l.createdAt };
    }),
    ...(DB.orders || []).filter(o => o.studentId === st.id).map(o => ({
      icon: o.emoji || '🛍️', label: `Purchased ${o.itemName}`, pts: -(o.cost || 0), createdAt: o.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 8);
  // Phase 27: same section-scoping gate as renderStudentQuizzes() below —
  // this dashboard widget reads DB.quizzes independently and has its own
  // clickable "Begin Quest" cards, so it needs the same filter or a
  // section-restricted quiz would still be startable from here.
  const dashSectionAssignments = DB.quizSectionAssignments || {};
  const dashMyClassId          = st.classId || 'default-class';
  const dashInMySection = (q) => {
    const assigned = dashSectionAssignments[q.id];
    return !assigned || assigned.length === 0 || assigned.includes(dashMyClassId);
  };
  const pending=DB.quizzes.filter(q=>!st.completedQuizzes.includes(q.id) && dashInMySection(q));
  const sorted=[...DB.students].sort((a,b)=>b.xp-a.xp);
  const myRank=sorted.findIndex(s=>s.id===st.id)+1;
  const r=44,circ=2*Math.PI*r,dashOff=circ-(circ*(xpPct/100));
  const qrIdx=DB.students.indexOf(st);

  document.getElementById('s-dashboard').innerHTML=`
  <!-- HERO CARD (primary focal element — XP/level progress + academic snapshot combined, per Design Discovery) -->
  <div class="dash-hero" id="dash-hero">
    <canvas class="dash-hero-canvas" id="dash-hero-canvas"></canvas>
    <div class="dash-hero-inner">
      <div class="dash-xp-ring" style="position:relative;flex-shrink:0">
        <svg viewBox="0 0 110 110" width="110" height="110" style="transform:rotate(-90deg)">
          <circle cx="55" cy="55" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="7"/>
          <circle cx="55" cy="55" r="${r}" fill="none" stroke="url(#xpG)" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${dashOff}" style="transition:stroke-dashoffset .8s"/>
          <defs><linearGradient id="xpG" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#4edea3"/>
          </linearGradient></defs>
        </svg>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
          <div style="width:54px;height:54px;border-radius:50%;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:17px;background:${st.color+'33'};color:${st.color};border:2px solid ${st.color+'55'}">${
            st.profilePic
              ? `<img src="${st.profilePic}" alt="${st.init}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" onerror="this.remove()">`
              : st.init
          }</div>
        </div>
        <div class="level-badge">LVL ${st.level}</div>
      </div>
      <div class="dash-hero-info">
        <div class="dash-hero-name">${st.name}</div>
        <div class="dash-hero-sub" style="margin-bottom:14px">${st.tier} &nbsp;·&nbsp; <span style="color:var(--primary)">Rank #${myRank}</span> &nbsp;·&nbsp; Level ${st.level} → ${st.level+1}</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div class="stat-bar" id="dash-xp-bar" style="flex:1">
            <div class="stat-bar-fill"></div>
          </div>
          <span style="font-size:12px;color:var(--primary);font-weight:700;white-space:nowrap">${xpPct}%</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">${(xpNext-st.xp).toLocaleString()} XP to next level</div>
      </div>
      <div class="dash-hero-right">
        <div class="coin-display">
          <div class="val float">🪙 ${st.coins.toLocaleString()}</div>
          <div class="lbl">Coins Available</div>
        </div>
        <button class="btn btn-orange btn-block" onclick="navTo('s-store')">🛍️ Visit Armory</button>
      </div>
    </div>
    <!-- Combined academic snapshot — same focal card as the XP ring above, not a separate stat-grid -->
    <div class="dash-hero-stats">
      <div class="dash-hero-stat-chip"><div class="val" style="color:#d0bcff">${st.xp.toLocaleString()}</div><div class="lbl">Total XP</div></div>
      <div class="dash-hero-stat-chip"><div class="val" style="color:#4edea3">${st.attendance}%</div><div class="lbl">Attendance</div></div>
      <div class="dash-hero-stat-chip"><div class="val" style="color:#fb923c">${st.quizAvg}%</div><div class="lbl">Quiz Avg</div></div>
      <div class="dash-hero-stat-chip"><div class="val" style="color:#ffb95f">#${myRank}</div><div class="lbl">Class Rank</div></div>
    </div>
  </div>

  <!-- ATTENTION PANEL: unclaimed achievements + unread mail -->
  ${(()=>{
    const unlocks=(DB.achievementUnlocks||{})[st.id]||[];
    const unclaimed=unlocks.filter(u=>!u.claimed).length;
    const mails=(DB.mail||[]).filter(m=>m.to==='all'||(Array.isArray(m.to)&&m.to.includes(st.id)));
    const unread=mails.filter(m=>!((m.readBy||{})[st.id])).length;
    const unclaimedMailRewards=mails.filter(m=>m.hasReward&&!((m.claimedBy||{})[st.id])).length;
    const notifs=[];
    if(unclaimed>0) notifs.push({icon:'🎁',color:'#d0bcff',bg:'rgba(208,188,255,.07)',border:'rgba(208,188,255,.25)',title:unclaimed+' Achievement Reward'+(unclaimed>1?'s':'')+' Ready to Claim',sub:'Go to Achievements to collect your rewards.',action:'navTo(\'s-badges\')',btnLabel:'Claim Now',btnColor:'#8b5cf6'});
    if(unclaimedMailRewards>0) notifs.push({icon:'📬',color:'#ffb95f',bg:'rgba(255,185,95,.07)',border:'rgba(255,185,95,.25)',title:unclaimedMailRewards+' Mail Reward'+(unclaimedMailRewards>1?'s':'')+' Unclaimed',sub:'Your teacher sent you rewards. Open your mail to claim them.',action:'navTo(\'s-mail\')',btnLabel:'Open Mail',btnColor:'#f59e0b'});
    else if(unread>0) notifs.push({icon:'📨',color:'rgba(255,185,95,.7)',bg:'rgba(255,185,95,.04)',border:'rgba(255,185,95,.18)',title:unread+' Unread Message'+(unread>1?'s':'')+'',sub:'Your teacher sent you a message.',action:'navTo(\'s-mail\')',btnLabel:'Read Mail',btnColor:'#ca8a04'});
    if(!notifs.length) return '';
    return `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">`+
      notifs.map(n=>`<div style="background:${n.bg};border:1px solid ${n.border};border-radius:14px;padding:13px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:24px;flex-shrink:0;animation:achBadgePulse 2s ease-in-out infinite">${n.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:${n.color}">${n.title}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${n.sub}</div>
        </div>
        <button class="btn btn-sm" style="background:${n.btnColor}22;border:1px solid ${n.btnColor}55;color:${n.btnColor};font-weight:800;flex-shrink:0;white-space:nowrap" onclick="${n.action}">${n.btnLabel} →</button>
      </div>`).join('')+`</div>`;
  })()}

  <div class="dash-lower-grid">
    <div>
      <!-- ACTIVE QUESTS -->
      ${pending.length ? `
      <div class="section-header">
        <span class="material-symbols-outlined">swords</span>
        <h2>Active Quests</h2>
        <span class="badge-pill bp-green">${pending.length} available</span>
      </div>
      <div class="quest-grid" style="margin-bottom:24px">
        ${pending.slice(0,2).map((q,qi)=>`
        <div class="quest-card" onclick="startQuiz('${q.id}')">
          <div class="quest-img-wrap">
            <div class="quest-img-placeholder">${['🧬','🔢','🌍','⚗️','💻'][qi%5]}</div>
            ${qi===0?'<div class="quest-badge hot">🔥 Active</div>':'<div class="quest-badge new">✨ New</div>'}
          </div>
          <div class="quest-body">
            <div class="quest-title">${q.title}</div>
            <div class="quest-desc">${q.desc}</div>
            <div class="quest-meta">
              <div class="quest-rewards">
                <div class="reward-pill xp"><span class="material-symbols-outlined" style="font-size:13px">bolt</span>+${q.xpReward} XP</div>
                <div class="reward-pill coin"><span class="material-symbols-outlined" style="font-size:13px;font-variation-settings:'FILL' 1">monetization_on</span>${q.coinReward}</div>
              </div>
              <div class="quest-time"><span class="material-symbols-outlined">schedule</span>${q.timeLimit} MIN</div>
            </div>
            <button class="quest-btn primary">⚔ Begin Quest</button>
          </div>
        </div>`).join('')}
      </div>` : `
      <div class="section-header"><span class="material-symbols-outlined">swords</span><h2>Active Quests</h2></div>
      <div style="text-align:center;padding:48px;background:rgba(35,31,56,0.7);border:1px solid var(--border);border-radius:16px;margin-bottom:24px;backdrop-filter:blur(12px)">
        <div style="font-size:48px;margin-bottom:12px">🏆</div>
        <div style="font-family:var(--fh);font-size:16px;font-weight:800;margin-bottom:6px">All Quests Complete!</div>
        <div style="color:var(--text-muted);font-size:13px">Check back when new quests are posted.</div>
      </div>`}

      <!-- OVERALL ACTIVITY (Phase 67 — was "Point Activity"; now merges every
           reward/purchase source, not just DB.pointLog, and shows a live
           relative time via window.eqTimeAgo() instead of a frozen string) -->
      <div class="section-header"><span class="material-symbols-outlined">receipt_long</span><h2>Overall Activity</h2></div>
      <div class="glass-card" style="padding:16px">
        <div class="pt-events">
          ${activityFeed.length ? activityFeed.map(e=>`
          <div class="pt-event">
            <div class="pt-icon" style="font-size:18px">${e.icon || '⭐'}</div>
            <div class="pt-delta" style="color:${e.pts>0?'#4edea3':e.pts<0?'#ffb4ab':'var(--text-muted)'}">${e.pts>0?'+':''}${e.pts||0}</div>
            <div class="pt-info"><div class="pt-what">${e.label}</div><div class="pt-when">${window.eqTimeAgo(e.createdAt)}</div></div>
          </div>`).join('') : '<div style="color:var(--text-muted);text-align:center;padding:16px;font-size:13px">No activity yet</div>'}
        </div>
      </div>
    </div>

    <!-- SIDEBAR COL -->
    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- LEADERBOARD MINI -->
      <div class="section-header"><span class="material-symbols-outlined">military_tech</span><h2>Rankings</h2></div>
      <div class="glass-card" style="padding:16px">
        ${sorted.slice(0,5).map((s,i)=>{
          const medals=['🥇','🥈','🥉','4.','5.'];const isMe=s.id===st.id;
          return `<div class="lb-row" style="padding:8px 10px;background:${isMe?'rgba(208,188,255,0.08)':'transparent'};border:${isMe?'1px solid rgba(208,188,255,0.2)':'1px solid transparent'};margin-bottom:6px">
            <div class="lb-rank">${i<3?medals[i]:`<span style="font-size:12px;font-weight:700;color:var(--text-muted)">${medals[i]}</span>`}</div>
            <div class="lb-av" style="background:${s.color+'22'};color:${s.color};border-color:${s.color+'44'}">${s.init}</div>
            <div class="lb-name">${s.name.split(' ')[0]}${isMe?` <span class="badge-pill bp-primary" style="font-size:9px;padding:1px 6px">You</span>`:''}</div>
            <div class="lb-xp">${s.xp.toLocaleString()}</div>
          </div>`;}).join('')}
        <button class="btn btn-ghost btn-block btn-sm" style="margin-top:8px" onclick="navTo('s-leaderboard')">Full Rankings →</button>
      </div>

      <!-- QR CODE -->
      <div class="glass-card dash-qr-card">
        <h3>🔲 Your QR Code</h3>
        <div class="qr-card">
          <div class="qr-svg-wrap">
            <svg width="82" height="82" viewBox="0 0 80 80">
              <rect x="4" y="4" width="26" height="26" rx="3" fill="none" stroke="#d0bcff" stroke-width="2.5"/>
              <rect x="10" y="10" width="14" height="14" fill="#d0bcff"/>
              <rect x="50" y="4" width="26" height="26" rx="3" fill="none" stroke="#d0bcff" stroke-width="2.5"/>
              <rect x="56" y="10" width="14" height="14" fill="#d0bcff"/>
              <rect x="4" y="50" width="26" height="26" rx="3" fill="none" stroke="#d0bcff" stroke-width="2.5"/>
              <rect x="10" y="56" width="14" height="14" fill="#d0bcff"/>
              <rect x="38" y="38" width="6" height="6" fill="#4edea3"/>
              <rect x="50" y="38" width="6" height="6" fill="#4edea3"/>
              <rect x="62" y="38" width="6" height="6" fill="#4edea3"/>
              <rect x="38" y="50" width="6" height="6" fill="#4edea3"/>
              <rect x="50" y="62" width="6" height="6" fill="#4edea3"/>
              <rect x="62" y="50" width="6" height="6" fill="#4edea3"/>
            </svg>
          </div>
          <div style="font-size:11px;color:var(--text-muted)">ID: #SQ-2024-0${qrIdx+81}</div>
          <div style="font-size:10px;color:rgba(208,188,255,.8);margin-top:4px;font-weight:700;letter-spacing:.08em">SCAN TO REGISTER</div>
        </div>
      </div>

      <!-- GOALS -->
      <div class="glass-card">
        <h3>🎯 Active Goals</h3>
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:12px">Perfect Attendance</span><span class="badge-pill bp-green">${st.attendance}%</span></div>
          <div style="background:rgba(255,255,255,.06);border-radius:20px;height:6px;overflow:hidden;margin-bottom:14px"><div style="height:100%;border-radius:20px;width:${st.attendance}%;background:linear-gradient(90deg,#4edea3,#06b6d4);box-shadow:0 0 8px rgba(78,222,163,.5)"></div></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:12px">Reach Level ${st.level+1}</span><span class="badge-pill bp-primary">${xpPct}%</span></div>
          <div style="background:rgba(255,255,255,.06);border-radius:20px;height:6px;overflow:hidden"><div style="height:100%;border-radius:20px;width:${xpPct}%;background:linear-gradient(90deg,#8b5cf6,#d0bcff);box-shadow:0 0 8px rgba(139,92,246,.5)"></div></div>
        </div>
      </div>
    </div>
  </div>`;
  updateTopbar();

  // ── Motion foundation wiring (modules/shared/*) ──────────────────────────
  // Session-only level-up detection: no DB/localStorage write, resets on
  // reload. Only celebrates a level increase seen *within this session* —
  // never on first load — so returning to the dashboard after logging back
  // in doesn't re-trigger a stale celebration.
  window._eqLastSeenLevel = window._eqLastSeenLevel || {};
  const _prevLevel = window._eqLastSeenLevel[st.id];
  const justLeveledUp = (typeof _prevLevel === 'number') && st.level > _prevLevel;
  window._eqLastSeenLevel[st.id] = st.level;

  const xpBarEl = document.getElementById('dash-xp-bar');
  if (xpBarEl && typeof renderStatBar === 'function') {
    renderStatBar(xpBarEl, { percent: xpPct, tier: 'normal', justChanged: justLeveledUp });
  }

  // Ambient hero backdrop — stop any previous loop first (this function can
  // re-render many times per session) so we never stack multiple rAF loops.
  if (typeof window._eqDashHeroBackdropStop === 'function') {
    window._eqDashHeroBackdropStop();
    window._eqDashHeroBackdropStop = null;
  }
  const heroCanvas = document.getElementById('dash-hero-canvas');
  if (heroCanvas && typeof startAmbientBackdrop === 'function') {
    window._eqDashHeroBackdropStop = startAmbientBackdrop(heroCanvas, { count: 55, color: '#d0bcff', alpha: 0.4, dotSize: 2.2 });
  }

  // Level Up Wow Moment (Event tier — rare, earned, skippable per redesign
  // proposal §12.1). Dims the screen briefly, pops the level badge, shows a
  // centered flash, and fires a particle burst from the level badge.
  // Extracted so it can be triggered on a real level-up AND manually
  // previewed from the console (window.eqPreviewLevelUp()) without needing
  // to actually grind XP — useful for judging/tuning the effect.
  window.eqPlayLevelUpMoment = function (displayLevel) {
    if (typeof runSequence !== 'function') return;
    const heroEl = document.getElementById('dash-hero');
    runSequence([
      { delay: 0,    run: () => document.body.classList.add('screen-dim') },
      { delay: 150,  run: () => { if (heroEl) heroEl.classList.add('leveling-up'); } },
      { delay: 250,  run: () => {
          const flash = document.createElement('div');
          flash.className = 'dash-level-up-flash';
          flash.textContent = 'LEVEL UP! → ' + displayLevel;
          document.body.appendChild(flash);
          requestAnimationFrame(() => flash.classList.add('show'));
          setTimeout(() => flash.remove(), 1600);
        } },
      { delay: 100,  run: () => {
          const badge = heroEl ? heroEl.querySelector('.level-badge') : null;
          if (badge && typeof burstParticles === 'function') burstParticles(badge, 60);
        } },
      { delay: 1200, run: () => {
          document.body.classList.remove('screen-dim');
          if (heroEl) heroEl.classList.remove('leveling-up');
        } },
    ]);
  };

  // DEV PREVIEW: run window.eqPreviewLevelUp() in the console from the
  // Dashboard page any time to see the full moment without leveling up.
  // Safe to leave in — it's a no-op unless someone calls it manually.
  window.eqPreviewLevelUp = function () { window.eqPlayLevelUpMoment(st.level + 1); };

  if (justLeveledUp) window.eqPlayLevelUpMoment(st.level);

  // Event-Driven Communication phase (roadmap Phase 4 continuation) —
  // replaces titles/titles_sidebar_refresh.js's window.renderStudentDashboard
  // monkey-patch, which was confirmed dead: that script tag loads (line
  // ~817) before this inline <script> block defines the base function
  // (line ~900), so the patch's `_orig = window.renderStudentDashboard`
  // captured `undefined`, and the plain function declaration below silently
  // overwrote the patch's wrapper the moment this block ran — the same
  // load-order-discards-earlier-patch bug already found in wbcApplyDamage
  // and renderStudentWorldBoss. Net effect: the #ts-dash-title badge this
  // function's innerHTML replacement wipes out on every render was only
  // ever restored via navTo's own separate (live) patch and the
  // session:booted subscriber — direct calls from
  // modules/perceived-speed.js (mail reward claim) and
  // modules/achievements/ach_student_page.js (achievement claim) never got
  // it back. No state mutation happens in this function itself, so emit()
  // rather than updateState() — same reasoning as bootApp().
  AppStore.emit({ type: 'dashboard:student-rendered', payload: {} });
}

// ── STUDENT QUIZZES (Quest Board) ──
// Phase 3 — rarity badge styling shared by every quest card. Falls back to
// Common's colors if ach_engine.js's ACH_RARITY palette hasn't loaded for
// some reason, same defensive `typeof` guard style already used around
// getClassLabel/getActiveClassIds elsewhere in this file.
function _questRarityStyle(q){
  const palette = (typeof ACH_RARITY !== 'undefined' && ACH_RARITY) || {};
  const r = eqQuizRarity(q);
  return { rarity: r, ...( palette[r] || { color:'#9ca3af', glow:'rgba(156,163,175,0.2)' } ) };
}

// Phase 3 — single quest-card renderer shared by the Daily/Weekly/Standing
// sections below. `cadenceTag` replaces the old decorative, index-based
// "Hot Quest"/"New" badge (qi===0 ? ... : ...) with something actually
// meaningful: the quest's real rarity, plus a cadence tag when it's a
// rotating daily/weekly pick.
// Visual-polish pass — `isNext` marks the single most relevant open quest
// (computed once in renderStudentQuizzes) so it gets a pulsing outline and
// a "START HERE" flag instead of making the student scan the whole board.
const QUEST_TIER_ORDER = ['Common','Uncommon','Rare','Epic','Legendary','Mythic'];
function renderQuestCard(q, qi, cadenceTag, isNext){
  const rs = _questRarityStyle(q);
  // Phase 5 — "ending soon" nudge (quest_board_report.md §18): only shown
  // once a scheduled quiz is within 3 days of its endDate, real urgency
  // instead of noise on every quest that merely has a far-off end date.
  const daysLeft = (q.endDate && typeof eqDaysUntil === 'function') ? eqDaysUntil(q.endDate) : null;
  const endingSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
  // Difficulty read — sword-tier row derived from the quest's own rarity,
  // an at-a-glance "power level" cue (1 sword = Common ... 5 = Mythic).
  const tierIdx = Math.max(0, QUEST_TIER_ORDER.indexOf(rs.rarity));
  const swordRow = QUEST_TIER_ORDER.slice(0,5).map((_,i)=>
    `<span class="material-symbols-outlined${i<=tierIdx?' lit':''}">swords</span>`).join('');
  return `
    <div class="quest-card state-available${isNext ? ' quest-next' : ''}" style="--rc:${rs.color};--rg:${rs.glow}" onclick="startQuiz('${q.id}')">
      ${isNext ? `<div class="quest-next-flag"><span class="material-symbols-outlined" style="font-size:11px">bolt</span>Start Here</div>` : ''}
      <div class="quest-img-wrap">
        <div class="quest-img-placeholder">${['🧬','🔢','🌍','⚗️','💻','🔭','📐','🦠'][qi%8]}</div>
        <div class="quest-badge">${cadenceTag ? cadenceTag+' · ' : ''}${rs.rarity}</div>
        ${endingSoon ? `<div class="quest-badge ending-soon">⏳ Ends in ${daysLeft===0?'<1':daysLeft}d</div>` : ''}
      </div>
      <div class="quest-body">
        <div class="quest-title">${q.title}</div>
        <div class="quest-desc">${q.desc}</div>
        <div class="quest-difficulty">${swordRow}<span class="tier-label">${rs.rarity}</span></div>
        <div class="quest-meta">
          <div class="quest-rewards">
            <div class="reward-pill xp"><span class="material-symbols-outlined" style="font-size:13px">bolt</span>+${q.xpReward} XP</div>
            <div class="reward-pill coin"><span class="material-symbols-outlined" style="font-size:13px;font-variation-settings:'FILL' 1">monetization_on</span>${q.coinReward}</div>
          </div>
          <div class="quest-time"><span class="material-symbols-outlined">schedule</span>${q.timeLimit} MIN</div>
        </div>
        <button class="quest-btn primary">⚔ Begin Quest</button>
      </div>
    </div>`;
}

// Phase 4 — quest chain step card (quest_board_report.md §3.8). Three
// visual states: 'done' (cleared, shows score), 'unlocked' (the one
// startable step — identical click behavior to a normal quest card), and
// 'locked' (greyed out, no click handler, shows what it's waiting on).
function renderChainStepCard(q, status, stepIndex){
  const rs = _questRarityStyle(q);
  const st = currentUser;
  const history = (DB.quizHistory||{})[st.id]||[];
  const entry = status==='done' ? history.filter(h=>h.quizId===q.id).pop() : null;
  const clickAttr = status==='unlocked' ? `onclick="startQuiz('${q.id}')"` : '';
  const stateIcon = status==='done' ? '✅' : status==='unlocked' ? '⚔' : '🔒';
  return `
    <div class="quest-card chain-step chain-${status}" style="--rc:${rs.color};--rg:${rs.glow}" ${clickAttr}>
      <div class="quest-img-wrap">
        <div class="quest-img-placeholder">${stateIcon}</div>
        <div class="quest-badge">Part ${stepIndex+1} · ${rs.rarity}</div>
      </div>
      <div class="quest-body">
        <div class="quest-title">${q.title}</div>
        <div class="quest-desc">${status==='locked' ? 'Locked — finish the previous part first.' : q.desc}</div>
        <div class="quest-meta">
          <div class="quest-rewards">
            <div class="reward-pill xp"><span class="material-symbols-outlined" style="font-size:13px">bolt</span>+${q.xpReward} XP</div>
            <div class="reward-pill coin"><span class="material-symbols-outlined" style="font-size:13px;font-variation-settings:'FILL' 1">monetization_on</span>${q.coinReward}</div>
          </div>
          ${status==='done' ? `<div class="quest-time">${entry?entry.score+'%':'✓'} CLEARED</div>` : `<div class="quest-time"><span class="material-symbols-outlined">schedule</span>${q.timeLimit} MIN</div>`}
        </div>
        ${status==='unlocked' ? `<button class="quest-btn primary">⚔ Begin Quest</button>`
          : status==='done' ? `<button class="quest-btn" disabled>✅ Cleared</button>`
          : `<button class="quest-btn" disabled>🔒 Locked</button>`}
      </div>
    </div>`;
}

// Phase 4 — one row per chain: title + progress dots + the step cards.
// Phase 61 (Improvement Plan §8) — steps now render in a dedicated
// .chain-row (flex, not the general auto-fill .quest-grid) with a
// .chain-trail connector between each pair, so the chain reads as a lit
// path from "cleared" through the current step and on to what's still
// locked — the closest fit for the plan's "path/trail animation" bullet
// given this board is card-based rather than a literal node map (see the
// campaign module's stage-map for that literal version elsewhere in the
// app). A trail segment is 'lit' once the step BEFORE it is cleared, and
// gets the traveling shimmer ('next') on the segment leading into the
// first not-yet-cleared step — everything past that stays dim/locked.
function renderChainSection(chain){
  const st = currentUser;
  const completedIds = st.completedQuizzes || [];
  const doneCount = chain.quizzes.filter(q=>completedIds.includes(q.id)).length;
  const statuses = chain.quizzes.map(q => eqChainStatus(chain.quizzes, q.id, completedIds));
  let firstUnlockedIdx = statuses.indexOf('unlocked');
  return `
  <div class="section-header" style="margin-top:12px">
    <span class="material-symbols-outlined" style="color:var(--tertiary)">link</span>
    <h2>${_esc(chain.chainLabel)}</h2>
    <span class="badge-pill bp-primary">${doneCount}/${chain.quizzes.length} parts cleared</span>
  </div>
  <div class="chain-row">
    ${chain.quizzes.map((q,i)=>{
      const card = renderChainStepCard(q, statuses[i], i);
      if (i === 0) return card;
      const prevDone = statuses[i-1] === 'done';
      const trailClass = prevDone ? 'chain-trail lit' : 'chain-trail';
      const isNextSegment = firstUnlockedIdx !== -1 && i === firstUnlockedIdx;
      return `<div class="${trailClass}${isNextSegment ? ' next' : ''}"></div>${card}`;
    }).join('')}
  </div>`;
}

// Phase 4 — "Top Questers This Week" panel (quest_board_report.md §3.12).
// Reuses the existing leaderboard engine (eqlComputeAcademic) scoped to the
// student's own section, rolling Monday boundary — see eqGetTopQuestersThisWeek()
// in utils.js. Purely social proof; no click behavior, no new leaderboard system.
function renderTopQuestersPanel(){
  const st = currentUser;
  const myClassId = st.classId || 'default-class';
  const top = (typeof eqGetTopQuestersThisWeek === 'function') ? eqGetTopQuestersThisWeek(myClassId, 5) : [];
  if (!top.length) return '';
  const medals = ['🥇','🥈','🥉'];
  return `
  <div class="section-header">
    <span class="material-symbols-outlined">social_leaderboard</span>
    <h2>Top Questers This Week</h2>
  </div>
  <div class="lb-list" style="margin-bottom:24px">
    ${top.map(e=>{
      const isMe = e.student.id===st.id;
      const init = (e.student.name||'?').trim().charAt(0).toUpperCase();
      return `<div class="lb-row ${isMe?'me':''}">
        <div class="lb-rank">${e.rank<=3?medals[e.rank-1]:`<span>${e.rank}</span>`}</div>
        <div class="lb-av" style="background:rgba(208,188,255,.15);color:var(--primary);border-color:rgba(208,188,255,.3)">${_esc(init)}</div>
        <div style="flex:1">
          <div class="lb-name">${_esc(e.student.name)}${isMe?`<span class="lb-badge-me">You</span>`:''}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${e.quizCount} quest${e.quizCount===1?'':'s'} this week</div>
        </div>
        <div style="text-align:right">
          <div class="lb-xp">${e.academicXP.toLocaleString()} XP</div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderStudentQuizzes(){
  const st=currentUser;
  // Phase 27 (closes the gap flagged in quiz-builder.js's Phase 15 comment
  // and SYNC_AUDIT_REPORT.md): same "opt-in scoping" semantics as
  // achievements' renderBadges() — a quiz with no rows in
  // quizSectionAssignments is unassigned → visible to everyone; a quiz
  // assigned to one or more sections is only shown to students in one of
  // those sections. Already-completed quizzes stay visible regardless, so
  // a student can't lose access to their own quest history because of a
  // later reassignment.
  const sectionAssignments = DB.quizSectionAssignments || {};
  const myClassId          = st.classId || 'default-class';
  const inMySection = (q) => {
    const assigned = sectionAssignments[q.id];
    return !assigned || assigned.length === 0 || assigned.includes(myClassId);
  };
  const visibleQuizzes = DB.quizzes.filter(q => inMySection(q) || st.completedQuizzes.includes(q.id));
  const done=visibleQuizzes.filter(q=>st.completedQuizzes.includes(q.id));
  const pending=visibleQuizzes.filter(q=>!st.completedQuizzes.includes(q.id));

  // Phase 3 — cadence split (quest_board_report.md §3.2/§3.4). 'standing'
  // quizzes (the pre-Phase-3 default, and still the vast majority of
  // existing content) behave exactly as before — always on the board.
  // 'daily'/'weekly' quizzes sit in a pool and eqGetDailyQuizIds()/
  // eqGetWeeklyQuizId() deterministically pick today's/this week's subset
  // from it (same seed for every student, refreshes automatically at the
  // date/week boundary) — a pooled quiz NOT in today's pick simply doesn't
  // show, which is the entire point of a rotating pool instead of every
  // pooled quiz being open at once.
  const dailyIds  = (typeof eqGetDailyQuizIds === 'function') ? eqGetDailyQuizIds() : [];
  const weeklyId  = (typeof eqGetWeeklyQuizId === 'function') ? eqGetWeeklyQuizId() : null;
  // Phase 4 — chained quizzes (§3.8) never sit in the standard cadence
  // grids; they're rendered as their own step sequence below via
  // renderChainSection(), so filter them out here regardless of cadence.
  const isChained = (q) => !!eqQuizChain(q).chainId;
  // Phase 5 — scheduling (quest_board_report.md §18): a quiz outside its
  // [startDate, endDate] window simply doesn't show as available — same
  // "opt-in" posture as section scoping. A student's own completed history
  // for it is untouched (the `done` list below is built from
  // completedQuizzes, not this filter), so an expired quest a student
  // already finished stays visible in "Completed Quests".
  const isScheduledOut = (q) => {
    const status = (typeof eqQuizScheduleStatus === 'function') ? eqQuizScheduleStatus(q) : null;
    return status === 'upcoming' || status === 'expired';
  };
  const pendingStanding = pending.filter(q => eqQuizCadence(q) === 'standing' && !isChained(q) && !isScheduledOut(q));
  const pendingDaily    = pending.filter(q => eqQuizCadence(q) === 'daily'  && dailyIds.includes(q.id) && !isChained(q) && !isScheduledOut(q));
  const pendingWeekly   = pending.filter(q => eqQuizCadence(q) === 'weekly' && q.id === weeklyId && !isChained(q) && !isScheduledOut(q));
  const availableToday  = pendingStanding.length + pendingDaily.length + pendingWeekly.length;

  // Visual-polish pass — pick exactly one "next up" quest (daily first,
  // then weekly, then the first standing quest) so the board has a clear
  // starting point instead of every open card competing for attention.
  const nextUpId = (pendingDaily[0] || pendingWeekly[0] || pendingStanding[0] || {}).id || null;

  // Phase 4 — chains visible to this student, built from the same
  // section-scoped quiz set as everything else on the board (a chain step
  // hidden from this section never shows up as a locked placeholder).
  const chains = (typeof eqGetQuestChains === 'function')
    ? eqGetQuestChains().map(c => ({ ...c, quizzes: c.quizzes.filter(q => visibleQuizzes.includes(q) && (st.completedQuizzes.includes(q.id) || !isScheduledOut(q))) })).filter(c => c.quizzes.length)
    : [];

  // Phase 2 — real, breakable, day-based streak (replaces the old fake
  // Math.floor(completedQuizzes.length/2) count — see quest_board_report.md §1).
  const questStreak = computeQuestStreak(st.id);

  document.getElementById('s-quizzes').innerHTML=`
  <!-- HERO BANNER -->
  <div class="page-hero" style="background-image:linear-gradient(135deg,rgba(26,20,56,0.98),rgba(35,25,72,0.95));margin-bottom:32px">
    <div class="page-hero-bg"></div><div class="page-hero-bg2"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">⚔️ Mission Board</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;letter-spacing:-.5px;color:var(--on-surface);margin-bottom:8px">The Quest Board</h1>
      <p style="font-size:14px;color:var(--text-muted);max-width:480px;line-height:1.6">Sharpen your skills and earn legendary loot. Each completed quest brings you closer to the Master's Tier.</p>
      <div class="page-hero-stats">
        <div class="hero-stat-pill">
          <div class="val" style="color:var(--primary)">${availableToday}</div>
          <div class="lbl">Available</div>
        </div>
        <div class="hero-stat-pill">
          <div class="val" style="color:var(--secondary)">${done.length}</div>
          <div class="lbl">Completed</div>
        </div>
        <div class="hero-stat-pill" data-streak-tier="${eqStreakFireTier(questStreak.current)}">
          <div class="val" style="color:var(--tertiary)"><span class="streak-flame">🔥</span> ${questStreak.current}</div>
          <div class="lbl">Day Streak</div>
        </div>
      </div>
    </div>
  </div>

  ${renderTopQuestersPanel()}

  ${pendingDaily.length ? `
  <div class="section-header">
    <span class="material-symbols-outlined">wb_sunny</span>
    <h2>Daily Quests</h2>
    <span class="badge-pill bp-primary">${pendingDaily.length} today</span>
  </div>
  <div class="quest-grid">
    ${pendingDaily.map((q,qi)=>renderQuestCard(q,qi,'☀️ Daily',q.id===nextUpId)).join('')}
  </div>` : ''}

  ${pendingWeekly.length ? `
  <div class="section-header">
    <span class="material-symbols-outlined">calendar_month</span>
    <h2>Weekly Quest</h2>
    <span class="badge-pill bp-primary">${pendingWeekly.length} this week</span>
  </div>
  <div class="quest-grid">
    ${pendingWeekly.map((q,qi)=>renderQuestCard(q,qi,'🗓️ Weekly',q.id===nextUpId)).join('')}
  </div>` : ''}

  ${pendingStanding.length ? `
  <div class="section-header">
    <span class="material-symbols-outlined">explore</span>
    <h2>Active Quests</h2>
    <span class="badge-pill bp-primary">${pendingStanding.length} available</span>
  </div>
  <div class="quest-grid">
    ${pendingStanding.map((q,qi)=>renderQuestCard(q,qi,null,q.id===nextUpId)).join('')}
  </div>` : ''}

  ${chains.map(chain=>renderChainSection(chain)).join('')}

  ${!availableToday && !chains.length ? `
  <div style="text-align:center;padding:64px;background:rgba(35,31,56,0.7);border:1px solid var(--border);border-radius:16px;margin-bottom:24px;backdrop-filter:blur(12px)">
    <div style="font-size:56px;margin-bottom:16px">🏆</div>
    <div style="font-family:var(--fh);font-size:20px;font-weight:900;margin-bottom:8px">All Quests Complete!</div>
    <div style="color:var(--text-muted);font-size:14px">Awaiting new missions from your instructor.</div>
  </div>` : ''}

  ${done.length ? (() => {
    // Phase 2 (Quest Board state clarity) — precompute state counts so the
    // section header itself doesn't imply every "done" item was a win.
    const historyAll = (DB.quizHistory||{})[st.id]||[];
    let passedCount = 0, retryCount = 0;
    done.forEach(q => {
      const scored = historyAll.filter(h=>h.quizId===q.id && !h.aborted);
      const everPassed = scored.some(h => (typeof h.passed==='boolean') ? h.passed : eqQuizPassed(h.score));
      if (everPassed) passedCount++; else retryCount++;
    });
    return `
  <div class="section-header" style="margin-top:12px">
    <span class="material-symbols-outlined" style="color:var(--secondary)">verified</span>
    <h2 style="color:var(--secondary)">Completed Quests</h2>
    <span class="badge-pill bp-green">${passedCount} cleared</span>
    ${retryCount ? `<span class="badge-pill" style="background:rgba(255,185,95,.12);color:#ffb95f;border:1px solid rgba(255,185,95,.3)">${retryCount} need a retry</span>` : ''}
  </div>
  <div class="completed-list">
    ${done.map(q=>{
      const history=(DB.quizHistory||{})[st.id]||[];
      const attemptsForQuiz=history.filter(h=>h.quizId===q.id);
      // Phase 60 (exploit fix) — an aborted attempt logs a row too (so it
      // counts toward the cap) but shouldn't overwrite the displayed score
      // with a 0% from walking away; show the most recent SCORED (non-abort)
      // attempt instead.
      const scoredAttempts=attemptsForQuiz.filter(h=>!h.aborted);
      const entry=scoredAttempts[scoredAttempts.length-1];
      const scoreDisplay=entry?entry.score+'%':'✓';
      // Phase 60 — hard cap of 4 scored attempts + 24h cooldown / teacher
      // override gate (Improvement Plan §7), replacing the old unlimited-
      // retry footer. The reward % shown is what the NEXT attempt would
      // actually earn, so the tradeoff is visible before committing to it.
      const gate = (typeof eqQuizAttemptStatus==='function') ? eqQuizAttemptStatus(q.id, st.id) : {allowed:true, attemptNumber:attemptsForQuiz.length+1};
      const nextMult = (typeof eqRetryMultiplier==='function') ? eqRetryMultiplier(gate.attemptNumber) : 1;

      // Phase 2 (Quest Board state clarity) — a quiz reaches "done" the
      // moment ANY attempt finishes, pass or fail (see finishQuiz()), so
      // "completed" alone was conflating two very different outcomes under
      // one identical green checkmark. Four distinct node states now:
      //   perfected       — Phase 63: cleared with a 100% score at least
      //                     once. Permanently done — no retry, ever (closes
      //                     the infinite XP/coin farming exploit; see
      //                     eqQuizAttemptStatus() in utils.js).
      //   passed          — cleared it at least once, never a perfect score;
      //                     stamped/sealed, but still retryable to chase 100%.
      //   retry-available — attempted, never yet passed; still open, not a win.
      //   locked          — hit the hard attempt cap; cooling down (or needs
      //                     a teacher/parent override) before trying again.
      const hasEverPerfected = scoredAttempts.some(h => h.score === 100);
      const hasEverPassed = scoredAttempts.some(h => (typeof h.passed === 'boolean') ? h.passed : eqQuizPassed(h.score));
      const state = hasEverPerfected ? 'perfected' : hasEverPassed ? 'passed' : (gate.allowed ? 'retry' : 'locked');

      const stateMeta = {
        perfected: { rowClass:'state-perfected', icon:'workspace_premium', badge:'★ PERFECTED · QUEST COMPLETE' },
        passed: { rowClass:'state-passed', icon:'military_tech', badge:'✓ QUEST CLEARED' },
        retry:  { rowClass:'state-retry',  icon:'flag',          badge:'⚠ RETRY AVAILABLE' },
        locked: { rowClass:'state-locked', icon:'lock_clock',    badge:`🔒 LOCKED · back in ${eqFormatCooldown(gate.cooldownEndsAt-Date.now())}` },
      }[state];

      const retryControl = state === 'perfected'
        ? `<button class="btn btn-ghost btn-sm" style="flex-shrink:0;opacity:.6;cursor:not-allowed" disabled title="Perfect score achieved — nothing left to earn here">★ Completed</button>`
        : state === 'passed'
        ? `<button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="event.stopPropagation();startQuiz('${q.id}')" title="Retry for ${Math.round(nextMult*100)}% reward">↻ Retry (${Math.round(nextMult*100)}%)</button>`
        : state === 'retry'
        ? `<button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="event.stopPropagation();startQuiz('${q.id}')" title="Retry for ${Math.round(nextMult*100)}% reward">↻ Retry (${Math.round(nextMult*100)}%)</button>`
        : `<button class="btn btn-ghost btn-sm" style="flex-shrink:0;opacity:.6;cursor:not-allowed" disabled title="Locked — back in ${eqFormatCooldown(gate.cooldownEndsAt-Date.now())}, or ask your teacher to unlock it early">🔒 Locked</button>`;
      // Phase 61 (Improvement Plan §8) — star rating uses the student's own
      // BEST scored attempt, not the latest one, so a worse retry never
      // takes a star away from a genuinely earned run.
      const bestScore = scoredAttempts.length ? Math.max(...scoredAttempts.map(h => h.score)) : 0;
      const starCount = (state === 'passed' || state === 'perfected') ? eqQuestStars(bestScore) : 0;
      const starsHtml = (state === 'passed' || state === 'perfected')
        ? `<div class="quest-stars">${Array.from({length:3}, (_,i)=>`<span class="quest-star${i<starCount?' filled':''}">★</span>`).join('')}</div>`
        : '';
      return `
    <div class="completed-row ${stateMeta.rowClass}">
      <div class="completed-icon"><span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">${stateMeta.icon}</span></div>
      <div class="completed-info">
        <div class="completed-title">${q.title}</div>
        <div class="completed-sub">${q.desc}</div>
        <div class="completed-state-badge">${stateMeta.badge}</div>
        ${starsHtml}
      </div>
      <div class="completed-score">
        <div class="lbl">SCORE</div>
        <div class="val">${scoreDisplay}</div>
      </div>
      ${retryControl}
    </div>`;}).join('')}
  </div>`; })() : ''}`;
}


// ── ACTIVE QUIZ ──
let activeQuiz=null,quizAnswers=[],quizCurrent=0,quizTimer=null,quizTimeLeft=0;
// Phase 3 (Improvement Plan §2/§4) — 3-stage escalation state. quizTimer/
// quizTimeLeft above are now driven PER QUESTION (reset every item) instead
// of once for the whole quiz — see startQuestionTimer(). quizLastAnnouncedStage
// tracks the last stage a transition toast fired for, so re-entering the
// same stage (e.g. Prev then Next again) never re-announces it; reset to
// -1 in startQuiz() so the very first question never "transitions" either.
let quizLastAnnouncedStage=-1;
// Phase 2 — functional hint system state (was a decorative hardcoded "2" —
// see quest_board_report.md §1/§3.5). quizHintsRemaining counts down from
// HINT_COST-gated uses; quizEliminated[qi] holds eliminated wrong-option
// indices per MC/TF question; quizHintRevealed[qi] caps hints to one per
// question so a student can't strip every wrong option for free info.
const HINT_COST = 15;
const MAX_HINTS_PER_QUEST = 2;
let quizHintsRemaining=0, quizEliminated=[], quizHintRevealed=[], quizStreakSnapshot=0;
// Phase 5 — shuffled right-column display order per Matching-type question
// (index-aligned with activeQuiz.questions), lazily filled in by
// renderQuizQuestion()/_eqShuffledMatchOptions() and reset in startQuiz().
let quizMatchShuffle=[];
// Phase 4 — combo meter state (quest_board_report.md §3.3): quizCombo is
// the LIVE consecutive-correct count, quizComboMax is the peak reached
// this attempt (what the final reward multiplier is based on — see
// finishQuiz()). quizLocked[qi] marks a question as graded/locked once the
// student has moved past it with Next, so Prev can't be used to go back,
// see the correctness feedback, and silently fix the answer — see quizNext().
let quizCombo=0, quizComboMax=0, quizLocked=[];
// Phase 6 (Improvement Plan §5/§10) — combo redesign: what the LAST grading
// pass just did to the combo, purely for one-shot mount animations on the
// fresh combo-band element renderQuizQuestion() creates next (innerHTML
// fully replaces the band every render, so there's no persistent element to
// CSS-transition between old/new values — instead the new element is born
// already carrying the right one-shot animation class). Consumed (read then
// reset to null) the moment renderQuizQuestion() uses it, so an unrelated
// re-render of the SAME question — e.g. useHint() — never replays it, and
// quizPrev() reviewing an old question never replays it either.
// quizComboMilestoneHit flags whether THIS grow just crossed a milestone
// (x3/x5/x10, then every +5) — see _eqIsComboMilestone() below — so the
// particle burst only fires on the exact question that earned it.
let quizComboLastEvent = null; // 'grow' | 'break' | null
let quizComboMilestoneHit = false;
// Phase 9 — Answer Reveal (environmental correct/wrong feedback): when a
// question is graded, quizAnswerRevealEvent is set to 'correct' | 'partial'
// | 'wrong' for the ONE render that just locked it — same one-shot
// "consumed at the top of renderQuizQuestion()" pattern quizComboLastEvent
// already uses — so it drives a single flash burst rather than replaying on
// every unrelated re-render (useHint(), Prev review, etc). The persistent
// (non one-shot) correct/wrong marking on the options themselves is instead
// derived straight from eqGradeAnswer() + isLocked every render — see
// renderQuizQuestion() — so reviewing an old question via Prev always shows
// its outcome, not just the instant it was answered.
let quizAnswerRevealEvent = null; // 'correct' | 'partial' | 'wrong' | null
// quizAdvanceTimer holds the pending "show the reveal, then move on"
// timeout kicked off by quizNext()/quizTimeout() — cleared defensively by
// quizPrev()/confirmAbortQuiz()/finishQuiz() so a stale timer can never fire
// against a question the student has already navigated away from.
let quizAdvanceTimer = null;
// Phase 4 — retry state (quest_board_report.md §7): attempt number for
// THIS run, derived from existing quizHistory rows for this quiz + 1.
// quizFinishing guards against a single tab double-firing finishQuiz()
// (e.g. a double Enter/click) now that completedQuizzes membership can no
// longer be used as that guard — retries intentionally keep it populated.
let quizAttemptNumber=1, quizFinishing=false;

// ─────────────────────────────────────────────────────────────────────────
// Phase 7 — Mascot / Narrator (Improvement Plan §6, §12 item 7)
//
// _mascotAmbientEmotion is the figure's current RESTING pose — what it's
// silently acting out between lines (idle bounce, nervous fidget, hiding,
// etc). renderQuizQuestion() fully replaces #s-quiz-active's innerHTML on
// every question, so the figure element itself is recreated each time;
// this variable is what lets the new element pick up the same pose instead
// of always resetting to 'idle'. fireMascotEvent() updates it whenever an
// event implies a new resting pose (see eqMascotEmotionFor() in utils.js);
// updateMascotAmbientMood() also nudges it directly for continuous,
// non-event-driven state (low time ticking down with nothing else going on).
//
// _mascotCloudTimer holds the pending "pop the cloud back out" timeout so a
// rapid-fire second event (e.g. a quick correct answer right after a low-
// time warning) cancels the old hide and starts fresh rather than the two
// racing.
//
// _mascotLowTimeWarnedFor tracks which question index already fired its one
// lowTime event this attempt, so the per-second timer tick doesn't refire
// it every second once time is already low.
let _mascotAmbientEmotion = 'idle';
let _mascotCloudTimer = null;
let _mascotLowTimeWarnedFor = null;

// eqHydrateMascotLines() — loads admin-authored custom lines once per
// session into window._eqMascotCustomLines (read by eqMascotLinePool() in
// utils.js). Guarded by _mascotLinesHydrated so switching quizzes/retrying
// doesn't refetch on every startQuiz() call; a failed fetch leaves the
// default-{} fallback in place (MascotLinesService.get() already resolves
// {ok:false} rather than throwing) so the mascot still has plenty to say.
let _mascotLinesHydrated = false;
async function eqHydrateMascotLines(){
  if (_mascotLinesHydrated) return;
  _mascotLinesHydrated = true;
  if (typeof MascotLinesService === 'undefined') return;
  const res = await MascotLinesService.get();
  window._eqMascotCustomLines = res.ok ? (res.customLines || {}) : {};
}

// fireMascotEvent(event, stageIdx) — the one entry point every quiz-runner
// call site uses to make the mascot react (§6's per-answer flow, step 3).
// Picks the emotion + a random line for this event/stage, pops the cloud in
// with the line, applies a one-shot "react" pop on top of whatever ambient
// pose is showing, then settles into the NEW ambient pose the event implies
// and pops the cloud back out after a short hold.
function fireMascotEvent(event, stageIdx){
  const figure = document.getElementById('quiz-mascot-figure');
  const cloud = document.getElementById('quiz-mascot-cloud');
  const cloudText = document.getElementById('quiz-mascot-cloud-text');
  const emojiEl = document.getElementById('quiz-mascot-emoji');
  if (!figure) return; // dock isn't mounted right now (e.g. results screen already swapped it out)

  const emotion = (typeof eqMascotEmotionFor === 'function') ? eqMascotEmotionFor(event, {stageIdx}) : 'idle';
  const stageKey = (event==='correct'||event==='wrong'||event==='lowTime') ? stageIdx
    : (event==='stageTransition') ? stageIdx
    : null;
  const line = (typeof eqMascotLine === 'function') ? eqMascotLine(event, stageKey) : '';

  _mascotAmbientEmotion = emotion;
  MASCOT_EMOTIONS.forEach(e => figure.classList.remove('mascot-emotion-'+e));
  figure.classList.add('mascot-emotion-'+emotion);
  if (emojiEl && window.MASCOT_EMOJI) emojiEl.textContent = MASCOT_EMOJI[emotion] || '🐲';

  // One-shot reaction pop — re-trigger even if the class is already present
  // by removing/re-adding on the next frame, same "force a fresh animation
  // replay" trick used elsewhere in this file (e.g. combo band classes).
  figure.classList.remove('mascot-react');
  void figure.offsetWidth;
  figure.classList.add('mascot-react');
  setTimeout(() => figure.classList.remove('mascot-react'), 400);

  if (cloud && cloudText && line) {
    clearTimeout(_mascotCloudTimer);
    cloudText.textContent = line;
    cloud.classList.add('show');
    _mascotCloudTimer = setTimeout(() => { cloud.classList.remove('show'); }, 2200);
  }
}
window.fireMascotEvent = fireMascotEvent;

// updateMascotAmbientMood(stageIdx, timeLeft, stageSeconds) — continuous,
// non-event-driven ambient pose (§6: "between lines the mascot keeps acting
// out its current emotional state silently... nervous/fidgety... timer
// running low"). Called every timer tick from renderQuizTimerDisplay() so
// the resting pose reacts to the clock even when no acute event just fired.
// Deliberately light-touch: it only steps the mood towards nervous/scared
// as time runs low, and only steps it back to the stage's calm idle once a
// fresh question starts (renderQuizQuestion() resets it directly) — it
// never overrides a pose an acute event just set, since the next timer
// tick is always at least ~1s after any fireMascotEvent() call.
function updateMascotAmbientMood(stageIdx, timeLeft, stageSeconds){
  const figure = document.getElementById('quiz-mascot-figure');
  if (!figure) return;
  const pct = stageSeconds > 0 ? (timeLeft / stageSeconds) : 1;
  let emotion;
  if (pct <= 0.2) emotion = (stageIdx >= 2) ? 'scared' : 'nervous';
  else emotion = (stageIdx >= 1) ? 'confident' : 'idle';
  if (emotion === _mascotAmbientEmotion) return;
  _mascotAmbientEmotion = emotion;
  MASCOT_EMOTIONS.forEach(e => figure.classList.remove('mascot-emotion-'+e));
  figure.classList.add('mascot-emotion-'+emotion);
  const emojiEl = document.getElementById('quiz-mascot-emoji');
  if (emojiEl && window.MASCOT_EMOJI) emojiEl.textContent = MASCOT_EMOJI[emotion] || '🐲';
  // Low-time warning line — fires once per question, the first tick it
  // crosses into the "low time" band, not every subsequent second.
  if (pct <= 0.2 && _mascotLowTimeWarnedFor !== quizCurrent) {
    _mascotLowTimeWarnedFor = quizCurrent;
    fireMascotEvent('lowTime', stageIdx);
  }
}
window.updateMascotAmbientMood = updateMascotAmbientMood;

function startQuiz(qid){
  const quiz=DB.quizzes.find(q=>q.id===qid);if(!quiz)return;
  // Critical Fix #5 (fresh-load) still applies. Retries are no longer
  // unlimited — Phase 60 (Improvement Plan §7) caps scored attempts at 4,
  // gated by eqQuizAttemptStatus() below; the old "no hard lock, just a
  // shrinking reward forever" behavior is gone.
  const freshStudent=DB.students.find(s=>s.id===currentUser.id);
  const completedIds=(freshStudent&&freshStudent.completedQuizzes)||[];
  // Phase 4 — chain lock guard (quest_board_report.md §3.8): even if a
  // locked step's card somehow gets clicked (stale render, console call),
  // block starting anything but the next unlocked part of its chain.
  const chainInfo = (typeof eqQuizChain==='function') ? eqQuizChain(quiz) : {chainId:null};
  if(chainInfo.chainId && typeof eqGetQuestChains==='function'){
    const chain = eqGetQuestChains().find(c=>c.chainId===chainInfo.chainId);
    const status = chain ? eqChainStatus(chain.quizzes, qid, completedIds) : 'locked';
    if(status==='locked'){ toast('🔒 Finish the earlier part of this chain first.','#ffb4ab'); return; }
  }
  activeQuiz=quiz;
  // Phase 60 (exploit fix) — hard attempt cap + cooldown gate (Improvement
  // Plan §7). Every closed attempt (finished OR aborted) already lives in
  // DB.quizHistory, so eqQuizAttemptStatus() counting that list IS the
  // authoritative attempt number — nothing here can be bypassed by
  // re-entering the screen, since there's no route to 's-quiz-active'
  // other than through this function.
  const gate = eqQuizAttemptStatus(qid, currentUser.id);
  if (!gate.allowed) {
    // Phase 63 — a perfected quest is a permanent stop (no cooldown to wait
    // out), distinct from the cap+cooldown lock below; see
    // eqQuizAttemptStatus() in utils.js.
    if (gate.perfected) {
      toast('★ Quest already perfected — nothing left to earn here. Ask your teacher if you just want extra practice.', '#ffb95f');
    } else {
      toast(`🔒 Quest locked — you've used all ${QUIZ_MAX_SCORED_ATTEMPTS} scored attempts. Try again in ${eqFormatCooldown(gate.cooldownEndsAt - Date.now())}, or ask your teacher to unlock it early.`, '#ffb4ab');
    }
    activeQuiz = null;
    return;
  }
  quizAttemptNumber = gate.attemptNumber;
  // A one-time override is consumed the instant it's actually used to start
  // a new attempt, not just when granted — see eqGrantQuizAttemptOverride().
  if (gate.viaOverride) {
    AppStore.updateState(draft => {
      if (draft.quizAttemptOverrides && draft.quizAttemptOverrides[currentUser.id]) {
        delete draft.quizAttemptOverrides[currentUser.id][qid];
      }
    }, { type: 'quiz:attempt-override-consumed', payload: { studentId: currentUser.id, quizId: qid } });
  }
  quizFinishing=false;
  quizAnswers=new Array(activeQuiz.questions.length).fill(null);quizCurrent=0;
  // Phase 3 — no more whole-quiz countdown (quizTimeLeft is now set fresh
  // per question by startQuestionTimer(), called from renderQuizQuestion()
  // below). quizLastAnnouncedStage=-1 means "no stage entered yet", so the
  // first question's stage never fires a transition toast.
  quizLastAnnouncedStage=-1;
  // Phase 2 — reset hint budget + eliminated-options tracking for this attempt
  quizHintsRemaining=MAX_HINTS_PER_QUEST;
  quizEliminated=new Array(activeQuiz.questions.length).fill(null).map(()=>[]);
  quizHintRevealed=new Array(activeQuiz.questions.length).fill(false);
  quizStreakSnapshot=computeQuestStreak(currentUser.id).current;
  // Phase 4 — reset combo/lock state for this attempt
  quizCombo=0; quizComboMax=0; quizLocked=new Array(activeQuiz.questions.length).fill(false);
  // Phase 6 — reset combo animation/milestone state for this attempt too
  quizComboLastEvent=null; quizComboMilestoneHit=false;
  // Phase 5 — per-question shuffled right-column order for Matching-type
  // questions (quest_board_report.md §2.4), generated lazily the first time
  // each question renders so it stays stable across Prev/Next within one
  // attempt, then reset fresh on the next startQuiz() call.
  quizMatchShuffle=new Array(activeQuiz.questions.length).fill(null);
  // Phase 7 — Mascot / Narrator (Improvement Plan §6, §12 item 7).
  // Kick off the admin-authored-lines fetch in the background (never blocks
  // quiz start — see eqHydrateMascotLines()'s comment) and reset the
  // ambient pose tracker fresh for this attempt so a leftover 'sad'/'scared'
  // pose from a previous attempt's results screen never leaks into this
  // one's first render. renderQuizQuestion() below picks this up via
  // _mascotAmbientEmotion instead of hardcoding 'idle'.
  eqHydrateMascotLines();
  _mascotAmbientEmotion = 'idle';
  _mascotLowTimeWarnedFor = null;
  showPage('s-quiz-active');renderQuizQuestion();
  // §6: "retry begins" gets its own determined line/pose instead of the
  // plain 'start' one, same event split the admin editor (MASCOT_LINES_EVENTS)
  // already exposes.
  fireMascotEvent(quizAttemptNumber > 1 ? 'retry' : 'start', 0);
}
// Phase 3 — per-question timer (replaces the old whole-quiz countdown).
// Called fresh from renderQuizQuestion() every time the LIVE (unlocked)
// question changes, so it always resets to that question's stage duration
// rather than counting down across the whole attempt.
function startQuestionTimer(){
  clearInterval(quizTimer);
  const stageIdx=eqQuestionStage(activeQuiz.questions.length, quizCurrent);
  const stageSeconds=eqQuizStageSeconds(activeQuiz)[stageIdx];
  quizTimeLeft=stageSeconds;
  renderQuizTimerDisplay(stageIdx);
  // Phase 7 — §6: ambient body-pose reacts continuously to the live clock,
  // not just to acute events (correct/wrong/etc). One immediate call so the
  // pose is right the instant the question mounts, then again every tick.
  updateMascotAmbientMood(stageIdx, quizTimeLeft, stageSeconds);
  quizTimer=setInterval(()=>{
    quizTimeLeft--;
    renderQuizTimerDisplay(stageIdx);
    updateMascotAmbientMood(stageIdx, quizTimeLeft, stageSeconds);
    if(quizTimeLeft<=0){clearInterval(quizTimer);quizTimeout();}
  },1000);
}
function renderQuizTimerDisplay(stageIdx){
  const el=document.getElementById('quiz-timer');
  if(!el)return;
  const t=Math.max(0,quizTimeLeft);
  el.textContent=t+'s';
  el.className='quiz-timer stage-'+stageIdx+(t<=5?' urgent':'');
}
// A question whose timer hits 0 is graded exactly like a genuinely wrong
// submission (Improvement Plan §4: "time-out = counts as wrong, same
// 'wrong' feedback beat as an incorrect tap, then auto-advances") — it
// locks the question with an empty answer (grades to 0 for every question
// type, see eqGradeAnswer), breaks the combo the same way a miss does, and
// advances/finishes exactly like quizNext() does for a real answer.
function quizTimeout(){
  if(!activeQuiz || quizLocked[quizCurrent])return;
  quizLocked[quizCurrent]=true;
  if(quizAnswers[quizCurrent]===null || quizAnswers[quizCurrent]===undefined) quizAnswers[quizCurrent]='';
  // Phase 6 — timeout breaks the combo the same way a wrong tap does (per
  // §10's animation map: "Wrong answer or timeout" both trigger the combo
  // band's shatter), so it gets the same one-shot animation flag.
  if(quizCombo>=2){ toast('💥 Combo broken — time\'s up!','#ffb4ab'); quizComboLastEvent='break'; }
  else { quizComboLastEvent=null; }
  quizCombo=0;
  toast("⏱ Time's up on that one!",'#ffb4ab');
  // Phase 7 — §4: "time-out = counts as wrong, same 'wrong' feedback beat
  // as an incorrect tap." Same mascot reaction quizNext() fires for a miss.
  fireMascotEvent('wrong', eqQuestionStage(activeQuiz.questions.length, quizCurrent));
  // Phase 9 — Answer Reveal: a timeout is always graded wrong (empty answer
  // never matches anything), so it gets the same red flash + reveal beat as
  // a genuinely wrong tap before advancing — see _quizAdvanceAfterReveal().
  quizAnswerRevealEvent = 'wrong';
  _quizShowRevealThenAdvance(1500);
}
function renderQuizQuestion(){
  const q=activeQuiz.questions[quizCurrent];const total=activeQuiz.questions.length;
  const fillPct=Math.round((quizCurrent+1)/total*100);
  // Phase 6 — consume the one-shot combo animation event (see quizNext()/
  // quizTimeout()) right at the top, before anything else can early-return
  // or re-render: whatever happens below, this event has now been "used",
  // so a later unrelated re-render of the same question (useHint()) won't
  // replay it.
  const comboEvent = quizComboLastEvent; quizComboLastEvent = null;
  const comboMilestone = quizComboMilestoneHit; quizComboMilestoneHit = false;
  // Phase 9 — Answer Reveal: the one-shot flash event (consumed the same
  // way comboEvent is, immediately above) drives the brief environmental
  // burst on THIS render only. The persistent green/red marking on the
  // options/inputs themselves is recomputed below from isLocked + the
  // saved answer every render, so it survives Prev/Next review too.
  const revealEvent = quizAnswerRevealEvent; quizAnswerRevealEvent = null;
  // Phase 3 — 3-stage escalation: which stage this question falls in, purely
  // by position (see eqQuestionStage in utils.js). Used for the HUD badge,
  // the timer's stage-tinted color, and the per-question countdown length.
  const stageIdx=eqQuestionStage(total, quizCurrent);
  const stageName=eqStageName(stageIdx);
  const letters=['A','B','C','D','E'];
  const qType=eqQType(q); // Phase 1/3 — 'mc' (default), 'tf', 'id', or 'enum'
  const savedAns=quizAnswers[quizCurrent];
  // Phase 4 — once a question has been passed via Next, it's locked: Prev
  // can still be used to review it, but answers can no longer be changed.
  // This is what makes the live combo meter meaningful (see quizNext()) —
  // without it, seeing "combo broken" would just be a free hint to go back
  // and fix the answer before final submission.
  const isLocked = !!quizLocked[quizCurrent];
  // Phase 9 — Answer Reveal: once a question is locked, grade it fresh from
  // the saved answer (cheap — eqGradeAnswer is pure) so BOTH the instant it
  // was just answered AND every later Prev-review render show the same
  // correct/wrong/partial state. Nothing is persisted separately — this is
  // deliberately re-derived every time instead of cached, so it can never
  // drift from what eqGradeAnswer() would say at finishQuiz() time.
  const revealFrac = isLocked ? eqGradeAnswer(q, savedAns) : null;
  const revealState = !isLocked ? null : revealFrac>=1 ? 'correct' : revealFrac>0 ? 'partial' : 'wrong';
  // Phase 4 (Improvement Plan §9) — answer layout: "2×2 grid for short
  // answers... fall back to a stacked list if answer text is typically
  // long sentences." Resolved automatically per-question rather than as a
  // manual per-quiz setting: mc/tf qualifies for the grid when every
  // option is short and there are at most 4 of them (5-option MC always
  // stays a list — a 2x2+1 grid reads worse than a clean 5-row list).
  const mcGridEligible = (qType==='mc' || qType==='tf') && q.opts && q.opts.length<=4
    && q.opts.every(o => String(o).length<=18);
  // Phase 2 — hint eligibility for the CURRENT question: mc (>2 opts) can
  // eliminate a wrong option; id reveals first letter + length. tf/enum
  // have no hint (tf would just hand over the answer; enum's own partial
  // credit already softens the all-or-nothing stakes hints exist to ease).
  const eliminatedForQ = quizEliminated[quizCurrent] || [];
  const hintUsedForQ = !!quizHintRevealed[quizCurrent];
  const canHint = !isLocked && quizHintsRemaining>0 && !hintUsedForQ && (qType==='id' || (qType==='mc' && q.opts && q.opts.length>2));
  const hintReason = isLocked ? 'Question already locked in'
    : quizHintsRemaining<=0 ? 'No hints left this quest'
    : hintUsedForQ ? 'Hint already used on this question'
    : (qType==='tf' || qType==='enum' || qType==='match') ? 'Not available for this question type'
    : `Reveal a hint for ${HINT_COST} coins`;
  const idHintText = (qType==='id' && hintUsedForQ) ? _eqQuestHintText(q) : '';
  const enumBlanks = qType==='enum' ? (Array.isArray(q.answers) ? q.answers.length : 0) : 0;
  const enumSaved = qType==='enum' ? (Array.isArray(savedAns) ? savedAns : new Array(enumBlanks).fill('')) : [];
  // Phase 5 — Matching type (quest_board_report.md §2.4): left column stays
  // in authored order, right column is shuffled once per attempt (cached in
  // quizMatchShuffle so Prev/Next doesn't reshuffle mid-attempt) and shown
  // as a dropdown per left-hand row. quizAnswers[quizCurrent] is an array
  // aligned to q.pairs order (NOT the shuffled display order) — the select's
  // chosen text is what gets stored, same convention eqGradeAnswer expects.
  const matchPairs = qType==='match' ? (Array.isArray(q.pairs) ? q.pairs : []) : [];
  const matchSaved = qType==='match' ? (Array.isArray(savedAns) ? savedAns : new Array(matchPairs.length).fill('')) : [];
  if (qType==='match' && !quizMatchShuffle[quizCurrent]) {
    const rights = matchPairs.map(p=>p.right);
    for (let i=rights.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [rights[i],rights[j]]=[rights[j],rights[i]]; }
    quizMatchShuffle[quizCurrent] = rights;
  }
  const matchOptions = qType==='match' ? (quizMatchShuffle[quizCurrent] || []) : [];
  // Phase 9 — Answer Reveal: per-blank/per-row correctness for enum & match,
  // mirroring eqGradeAnswer()'s own matching so the visual marks never
  // disagree with the score. Only computed when locked (nothing to reveal
  // on a live, still-answerable question).
  const enumMatchFlags = (qType==='enum' && isLocked) ? (() => {
    const pool = (Array.isArray(q.answers) ? q.answers.filter(a=>a && String(a).trim()) : []).map(eqNormalizeAnswer);
    return enumSaved.map(g => {
      const ng = eqNormalizeAnswer(g);
      if (!ng) return false;
      const idx = pool.indexOf(ng);
      if (idx !== -1) { pool.splice(idx, 1); return true; }
      return false;
    });
  })() : [];
  const enumCorrectCount = enumMatchFlags.filter(Boolean).length;
  const matchRowFlags = (qType==='match' && isLocked)
    ? matchPairs.map((p,pi) => eqNormalizeAnswer(matchSaved[pi]) === eqNormalizeAnswer(p.right) && !!matchSaved[pi])
    : [];
  const optionsHTML = qType==='id'
    ? `<div class="quiz-options${revealEvent?' just-revealed':''}" id="quiz-opts">
        <input type="text" id="quiz-id-input" class="quiz-id-input${isLocked?' reveal-'+revealState:''}" placeholder="Type your answer…" autocomplete="off" spellcheck="false"
          value="${_esc(typeof savedAns==='string'?savedAns:'')}" ${isLocked?'readonly':''} oninput="submitIdAnswer(this.value)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('btn-next')?.click();}">
        ${idHintText?`<div class="quiz-hint-reveal">${idHintText}</div>`:''}
        ${isLocked?`<div class="quiz-reveal-banner ${revealState}">${revealState==='correct'?'✅ Correct!':`❌ Correct answer: <strong>${_esc(q.answer||'')}</strong>`}</div>`:''}
      </div>`
    : qType==='enum'
    ? `<div class="quiz-options${revealEvent?' just-revealed':''}" id="quiz-opts">
        <div class="quiz-enum-hint">Fill in all ${enumBlanks} — partial credit for each one you get right.</div>
        ${Array.from({length:enumBlanks}).map((_,bi)=>`
        <input type="text" class="quiz-id-input quiz-enum-input${isLocked?' reveal-'+(enumMatchFlags[bi]?'correct':'wrong'):''}" placeholder="Answer ${bi+1} of ${enumBlanks}" autocomplete="off" spellcheck="false"
          value="${_esc(enumSaved[bi]||'')}" ${isLocked?'readonly':''} oninput="submitEnumAnswer(${bi},this.value)">`).join('')}
        ${isLocked?`<div class="quiz-reveal-banner ${revealState}">${enumCorrectCount}/${enumBlanks} correct${revealState!=='correct'?` — full answer: <strong>${_esc((q.answers||[]).join(', '))}</strong>`:''}</div>`:''}
      </div>`
    : qType==='match'
    ? `<div class="quiz-options${revealEvent?' just-revealed':''}" id="quiz-opts">
        <div class="quiz-enum-hint">Match each item on the left with its correct pair — partial credit per correct match.</div>
        ${matchPairs.map((p,pi)=>`
        <div class="qb-opt-row" style="align-items:center">
          <span style="flex:1;font-size:13px;color:var(--on-surface)">${_esc(p.left)}</span>
          <span style="color:var(--text-muted);flex-shrink:0">→</span>
          <select class="quiz-id-input${isLocked?' reveal-'+(matchRowFlags[pi]?'correct':'wrong'):''}" style="flex:1" ${isLocked?'disabled':''} onchange="submitMatchAnswer(${pi},this.value)">
            <option value="">Select…</option>
            ${matchOptions.map(opt=>`<option value="${_esc(opt)}" ${matchSaved[pi]===opt?'selected':''}>${_esc(opt)}</option>`).join('')}
          </select>
          ${isLocked && !matchRowFlags[pi] ? `<span style="flex-shrink:0;font-size:12px;color:var(--secondary);white-space:nowrap">→ ${_esc(p.right)}</span>` : ''}
        </div>`).join('')}
        ${isLocked?`<div class="quiz-reveal-banner ${revealState}">${matchRowFlags.filter(Boolean).length}/${matchPairs.length} matched correctly</div>`:''}
      </div>`
    : `<div class="quiz-options${mcGridEligible?' grid-mode':''}${revealEvent?' just-revealed':''}" id="quiz-opts">
        ${q.opts.map((opt,i)=>{
          const isElim = eliminatedForQ.includes(i);
          const isDisabled = isElim || isLocked;
          const isCorrectOpt = isLocked && i===q.answer;
          const isWrongPick = isLocked && i===savedAns && i!==q.answer;
          const revealCls = isCorrectOpt?' correct':isWrongPick?' wrong':'';
          return `
        <button class="quiz-opt${isElim?' eliminated':''}${revealCls}" id="opt-${i}" ${isDisabled?'disabled':''} onclick="${isDisabled?'':'selectOpt('+i+')'}">
          <div class="quiz-opt-letter">${letters[i]}</div>
          <span class="quiz-opt-text">${opt}</span>
          ${isElim?'<span class="quiz-opt-elim-tag">Eliminated</span>':''}
          ${isCorrectOpt?'<span class="quiz-opt-reveal-tag correct">✓ Correct</span>':''}
          ${isWrongPick?'<span class="quiz-opt-reveal-tag wrong">✕ Your pick</span>':''}
        </button>`;}).join('')}
      </div>`;
  // Phase 4 (Improvement Plan §9) — combo band escalation level, purely for
  // size/color scaling (0 = no streak yet, 1 = building, 2 = hot, 3 = max —
  // same x3/x5 thresholds quizNext() already toasts at). Milestone burst
  // animations and the mascot's own reaction are later phases (§12 items
  // 6-7); this phase just gives the band its big, always-visible home.
  const comboLevel = quizCombo>=5?3:quizCombo>=3?2:quizCombo>=1?1:0;
  // Phase 5 (Improvement Plan §3) — Environmental Intensity System ("Pressure"
  // layer) config per stage: background-drift color/count/speed for the
  // ambient canvas (reuses modules/shared/ambient-backdrop.js — the same
  // engine already driving the Dashboard hero band — rather than standing
  // up a second particle system) and the vignette ring's stage class.
  // Deliberately scoped to the quiz-arena's own bounding box, not the raw
  // browser viewport: the arena is already the natural focal frame of this
  // screen, and framing it there avoids fighting the fixed topbar/sidebar
  // for stacking order. Colors are cool/calm in stage 0 and shift warm/
  // urgent by stage 2, matching the timer's own stage tint.
  const QI_STAGE_CFG = [
    { color: '#4edea3', count: 16, alpha: 0.12, dotSize: 1.5, speed: 1   },
    { color: '#ffb95f', count: 24, alpha: 0.16, dotSize: 1.8, speed: 1.8 },
    { color: '#ffb4ab', count: 32, alpha: 0.20, dotSize: 2.2, speed: 3   },
  ][stageIdx];
  document.getElementById('s-quiz-active').innerHTML=`
  <div class="quiz-arena qi-stage-${stageIdx}${revealEvent==='wrong'?' qi-shake-wrong':''}">
    <!-- Phase 5 — intensity chrome (§3): ambient drift canvas + vignette
         ring, both position:absolute/z-index:0 so they sit strictly BEHIND
         .quiz-arena-content (z-index:1) — same layering trick as the
         Dashboard hero band. Pointer-events:none throughout; purely
         decorative, never intercepts a tap. -->
    <canvas class="quiz-intensity-canvas" id="quiz-intensity-canvas"></canvas>
    <div class="quiz-vignette-ring qi-stage-${stageIdx}"></div>
    <!-- Phase 9 — Answer Reveal flash: a one-shot full-arena color burst
         (green/amber/red) the instant a question is graded — see
         revealEvent above. Sits ABOVE everything (z-index higher than the
         content layer) but pointer-events:none, so it's purely a momentary
         wash of color, never something a student can accidentally tap
         through or that blocks the next interaction. -->
    <div class="quiz-reveal-flash${revealEvent?' flash-'+revealEvent:''}"></div>
    <div class="quiz-arena-content">
    <div class="quiz-title-label">[ ${activeQuiz.title.toUpperCase().replace(/\s+/g,'_')} ]</div>
    <!-- Phase 9 — Widescreen Arena: on landscape/desktop this splits into a
         persistent HUD rail (progress, timer, stage, streak, hints, mascot
         companion) plus a generous main column for the question + options,
         instead of stacking everything into one narrow centered strip.
         Below 1024px .quiz-hud flattens into a horizontal bar (see CSS). -->
    <div class="quiz-layout">
      <aside class="quiz-hud">
        <!-- Phase 4 — top strip (§9): progress + timer, always visible. -->
        <div class="quiz-top-strip">
          <div class="quiz-progress-block">
            <div class="quiz-progress-bar"><div class="quiz-progress-fill" style="width:${fillPct}%"></div></div>
            <div class="quiz-progress-labels">
              <span style="color:var(--text-muted)">Q.${String(quizCurrent+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}</span>
              <span style="color:var(--primary)">${fillPct}% COMPLETE</span>
            </div>
          </div>
          <div class="quiz-timer stage-${stageIdx}" id="quiz-timer">--</div>
        </div>
        <div class="quiz-hud-divider"></div>
        <!-- Phase 4 — meta row: secondary/ambient stats (stage, streak, hints). -->
        <div class="quiz-meta-row">
          <div class="quiz-stage-badge stage-${stageIdx}">${stageIdx===0?'🌱':stageIdx===1?'⚡':'🔥'} ${stageName}</div>
          <div class="quiz-meta-chip">🔥 ${quizStreakSnapshot} Day Streak</div>
          <div class="quiz-meta-chip${canHint?' quiz-hint-btn':' quiz-hint-btn disabled'}" ${canHint?'onclick="useHint()"':''} title="${hintReason}">✨ ${quizHintsRemaining} Hint${quizHintsRemaining===1?'':'s'} (${HINT_COST}🪙)</div>
        </div>
        <div class="quiz-hud-divider"></div>
        <!-- Phase 7 — mascot companion now docks in the HUD rail (was the
             footer row). The cloud only shows while fireMascotEvent() has
             an active line (§6); between lines the figure keeps acting out
             updateMascotAmbientMood()'s current pose silently. -->
        <div class="quiz-mascot-dock" id="quiz-mascot-dock" title="Quest companion">
          <div class="quiz-mascot-cloud" id="quiz-mascot-cloud"><span id="quiz-mascot-cloud-text"></span></div>
          <div class="quiz-mascot-figure mascot-emotion-${_mascotAmbientEmotion}" id="quiz-mascot-figure">
            <span id="quiz-mascot-emoji">${(window.MASCOT_EMOJI && window.MASCOT_EMOJI[_mascotAmbientEmotion]) || '🐲'}</span>
          </div>
        </div>
      </aside>
      <div class="quiz-main">
        <!-- Question card: centered, generous padding — the calmest, most
             stable zone even at max stage intensity (§9). Hard rule from §3:
             intensity effects live in the chrome around this card — its own
             background/border/text stay stable, only a faint stage-tinted
             border accent (chrome, not text) is allowed to shift. -->
        <div class="quiz-question-card${revealEvent?' card-flash-'+revealEvent:''}">
          <div class="quiz-q-label">QUESTION_${String(quizCurrent+1).padStart(2,'0')} // ${qType==='id'?'TYPE THE CORRECT ANSWER':qType==='enum'?'FILL IN ALL ANSWERS':qType==='match'?'MATCH EACH ITEM':'SELECT CORRECT RESPONSE'}${isLocked?' · 🔒 LOCKED IN':''}</div>
          <div class="quiz-q-text">${q.q}</div>
        </div>
        ${optionsHTML}
        <div class="quiz-nav">
          ${quizCurrent>0?`<button class="quiz-nav-prev" onclick="quizPrev()">← Prev</button>`:''}
          <button class="quiz-nav-next" id="btn-next" disabled onclick="quizNext()">
            ${quizCurrent===total-1?'▶ Submit Quest':'Next →'}
          </button>
        </div>
        <!-- Abort stays deliberately far from the mascot/companion (now
             clear across the layout in the HUD rail), same intent as
             before: leaving should never be near the "fun" elements. -->
        <div class="quiz-footer-row">
          <button class="quiz-abort" onclick="confirmAbortQuiz()">✕ Abort</button>
        </div>
      </div>
    </div>
    <!-- Phase 4 — combo band (§9): a floating toast, fixed-position, so it
         overlaps whatever's beneath it regardless of the HUD/main split. -->
    <div class="quiz-combo-band combo-level-${comboLevel}${comboEvent==='grow'?' combo-pop':comboEvent==='break'?' combo-shatter':''}" id="quiz-combo-band">
      <span class="quiz-combo-label">COMBO</span>
      <span class="quiz-combo-value">${quizCombo>0?'x'+quizCombo:'—'}</span>
      <span class="quiz-combo-mult">${eqComboMultiplier(quizCombo)}× reward</span>
    </div>
    </div>
  </div>`;
  // Phase 5 — (re)start the ambient drift canvas for the CURRENT stage.
  // Stopping any previous loop first mirrors the exact convention already
  // used for the Dashboard hero backdrop (see renderStudentDashboard()) —
  // renderQuizQuestion() re-renders (and thus recreates the canvas element)
  // on every question, so without this a new rAF loop would stack up on
  // top of the old one pointing at a now-detached canvas.
  if (typeof window._eqQuizIntensityBackdropStop === 'function') {
    window._eqQuizIntensityBackdropStop();
    window._eqQuizIntensityBackdropStop = null;
  }
  const qiCanvas = document.getElementById('quiz-intensity-canvas');
  if (qiCanvas && typeof startAmbientBackdrop === 'function') {
    window._eqQuizIntensityBackdropStop = startAmbientBackdrop(qiCanvas, QI_STAGE_CFG);
  }
  // Phase 6 (Improvement Plan §5) — milestone particle burst: fires ON TOP
  // of the combo band's own "pop" mount animation the exact question a
  // streak crosses x3/x5/x10(+5...). burstParticles() (modules/shared/
  // particles.js) already no-ops under prefers-reduced-motion on its own,
  // so no extra guard is needed here.
  const comboBandEl = document.getElementById('quiz-combo-band');
  // Combo band now behaves like a floating toast/notification rather than
  // a permanent static panel (per DREY feedback) — see .quiz-combo-band's
  // fixed positioning + .combo-toast-show transition in base.css. It's
  // fully recreated every renderQuizQuestion() call (innerHTML replace),
  // so "showing" it just means adding the class a beat after mount (so the
  // opacity/transform transition actually has something to animate FROM),
  // and "hiding" it again after a short dwell time. Only shown at all while
  // there's an active combo (quizCombo>0) — an idle "—" combo has nothing
  // worth interrupting the student's screen for.
  if (window._eqComboToastHideTimer) clearTimeout(window._eqComboToastHideTimer);
  if (comboBandEl && quizCombo > 0) {
    requestAnimationFrame(() => comboBandEl.classList.add('combo-toast-show'));
    window._eqComboToastHideTimer = setTimeout(() => {
      const el = document.getElementById('quiz-combo-band');
      if (el) el.classList.remove('combo-toast-show');
    }, 2200);
  }
  if (comboEvent === 'grow' && comboMilestone && typeof burstParticles === 'function') {
    if (comboBandEl) burstParticles(comboBandEl, 50);
  }
  // Phase 3 — the timer only ever runs for the LIVE question (the one the
  // student can still answer). Prev-ing back to review an already-locked
  // question shows no running countdown — same "read-only, no live timer"
  // rule the Improvement Plan (§7) already applies to fully-completed quizzes,
  // just scoped to a single question here.
  if(isLocked){
    clearInterval(quizTimer);
    const el=document.getElementById('quiz-timer');
    if(el){ el.textContent='—'; el.className='quiz-timer stage-'+stageIdx; }
  } else {
    if(stageIdx!==quizLastAnnouncedStage){
      if(quizLastAnnouncedStage!==-1){
        const stageMsg=stageIdx===1?'⚡ Stage 2: Surge!':stageIdx===2?'🔥 Stage 3: Overdrive!':'🌱 Stage 1: Warm-Up!';
        const stageColor=stageIdx===1?'#ffb95f':stageIdx===2?'#ffb4ab':'#4EDEA3';
        toast(stageMsg, stageColor);
        // Phase 7 — §6: "hiding" reaction on the gear-change into a harder
        // stage. Only stages 1/2 exist as a "transition INTO" per
        // MASCOT_DEFAULT_LINES.stageTransition's keys (no entering stage 0).
        if(stageIdx>=1) fireMascotEvent('stageTransition', stageIdx);
      }
      quizLastAnnouncedStage=stageIdx;
    }
    startQuestionTimer();
  }
  if(qType==='id'){
    const btn=document.getElementById('btn-next');
    if(btn) btn.disabled = !(typeof savedAns==='string' && savedAns.trim().length);
    if(!isLocked) document.getElementById('quiz-id-input')?.focus();
  } else if(qType==='enum'){
    const btn=document.getElementById('btn-next');
    if(btn) btn.disabled = !enumSaved.some(v=>v && String(v).trim().length);
  } else if(qType==='match'){
    const btn=document.getElementById('btn-next');
    if(btn) btn.disabled = !matchSaved.some(v=>v && String(v).trim().length);
  } else if(savedAns!==null && savedAns!==undefined){
    selectOpt(savedAns,true);
  }
}
function selectOpt(i,restore=false){
  // Phase 4 — a locked (already-passed) question can't have its answer
  // changed, even via a stray click (options are rendered disabled, but
  // selectOpt(i,true) also gets called from renderQuizQuestion() itself to
  // restore the visual '.selected' state, which must still work while locked).
  if(quizLocked[quizCurrent] && !restore) return;
  // Phase 2 fix: only clear the 'selected' class, not the whole className —
  // a full reset here used to also strip the 'eliminated' class (and its
  // disabled attribute) off any hint-eliminated option every time a student
  // picked an answer, silently un-eliminating it.
  document.querySelectorAll('.quiz-opt').forEach(o=>{o.classList.remove('selected');});
  document.getElementById('opt-'+i)?.classList.add('selected');
  quizAnswers[quizCurrent]=i;
  const btn=document.getElementById('btn-next');
  if(btn){btn.disabled=false;}
}
// Phase 2 — Identification hint text: first letter + letter count of the
// primary accepted answer. Deliberately doesn't touch altAnswers (the
// question's canonical answer is q.answer; showing "N letters" against an
// alt spelling could mislead more than help).
function _eqQuestHintText(q){
  const ans=String(q.answer||'').trim();
  if(!ans) return '';
  const letterCount=ans.replace(/\s+/g,'').length;
  return `💡 Starts with "${ans.charAt(0).toUpperCase()}" — ${letterCount} letter${letterCount===1?'':'s'}`;
}
// Phase 2 — functional hint system (was decorative — quest_board_report.md
// §1/§3.5). Costs HINT_COST coins per use, capped at MAX_HINTS_PER_QUEST
// per quest attempt and one hint per question. MC eliminates a random wrong
// option; Identification reveals first letter + length; True/False has no
// hint (only 2 options — eliminating one would just hand over the answer).
function useHint(){
  if(!activeQuiz) return;
  const q=activeQuiz.questions[quizCurrent];
  const qType=eqQType(q);
  if(quizHintsRemaining<=0){ toast('⚠️ No hints left this quest!','#ffb4ab'); return; }
  if(quizHintRevealed[quizCurrent]){ toast('You already used a hint on this question.','#ffb4ab'); return; }
  if(qType==='tf'){ toast('No hints available for True/False questions.','#ffb4ab'); return; }
  if(qType==='enum' || qType==='match'){ toast('No hints available for this question type.','#ffb4ab'); return; }
  if(qType==='mc' && (!q.opts || q.opts.length<=2)){ toast('No hint available for this question.','#ffb4ab'); return; }

  const stIdx = AppStore.getSlice(s => s.students || []).findIndex(s=>s.id===currentUser.id);
  if(stIdx<0) return;
  const _currentCoins = AppStore.getSlice(s => (s.students||[])[stIdx]?.coins) || 0;
  if(_currentCoins < HINT_COST){
    toast(`❌ Need ${HINT_COST} coins for a hint — you have ${_currentCoins}.`,'#ffb4ab');
    return;
  }

  if(qType==='id'){
    if(!q.answer){ toast('No hint available for this question.','#ffb4ab'); return; }
    toast(_eqQuestHintText(q),'#d0bcff');
  } else {
    // mc — eliminate one random wrong, not-already-eliminated option
    const already = quizEliminated[quizCurrent] || [];
    const wrongIdx = q.opts.map((_,i)=>i).filter(i=>i!==q.answer && !already.includes(i));
    if(!wrongIdx.length){ toast('No more wrong options to eliminate.','#ffb4ab'); return; }
    const pick = wrongIdx[Math.floor(Math.random()*wrongIdx.length)];
    if(!quizEliminated[quizCurrent]) quizEliminated[quizCurrent]=[];
    quizEliminated[quizCurrent].push(pick);
    toast('💡 Eliminated one wrong option!','#d0bcff');
  }

  // Spend the coins — same local-mutation + server-sync pattern every other
  // spend site in this app uses (shop, mail claim, achievement claim, etc).
  AppStore.updateState(draft => {
    const s = (draft.students || []).find(x => x.id === currentUser.id);
    if (s) s.coins -= HINT_COST;
  }, { type: 'quiz:hint-purchased', payload: { studentId: currentUser.id } });
  syncStudentStatsToServer(currentUser.id, 0, -HINT_COST);
  currentUser.coins = _currentCoins - HINT_COST;

  quizHintsRemaining--;
  quizHintRevealed[quizCurrent]=true;
  updateTopbar();
  renderQuizQuestion();
}
// Phase 1 — Identification-type answer capture (text input, not opt buttons)
function submitIdAnswer(val){
  if(quizLocked[quizCurrent]) return; // Phase 4 — locked questions are read-only
  quizAnswers[quizCurrent]=val;
  const btn=document.getElementById('btn-next');
  if(btn) btn.disabled = !(val && val.trim().length);
}
// Phase 3 — Enumeration answer capture: quizAnswers[quizCurrent] is an
// array of per-blank strings instead of a single value. At least one
// filled blank is enough to unlock Next/Submit — a partially-answered
// enumeration still earns partial credit rather than being blocked outright.
function submitEnumAnswer(bi,val){
  if(quizLocked[quizCurrent]) return; // Phase 4 — locked questions are read-only
  if(!Array.isArray(quizAnswers[quizCurrent])){
    const blanks=(Array.isArray(activeQuiz.questions[quizCurrent].answers) ? activeQuiz.questions[quizCurrent].answers.length : 0);
    quizAnswers[quizCurrent]=new Array(blanks).fill('');
  }
  quizAnswers[quizCurrent][bi]=val;
  const btn=document.getElementById('btn-next');
  if(btn) btn.disabled = !quizAnswers[quizCurrent].some(v=>v && String(v).trim().length);
}
// Phase 5 — Matching-type answer capture (quest_board_report.md §2.4):
// quizAnswers[quizCurrent] is an array aligned to q.pairs order, mirroring
// submitEnumAnswer()'s per-blank shape. `pi` is the pair index (left-hand
// row), `val` is the chosen right-hand string from that row's dropdown —
// already de-shuffled by the time it gets here since the <option> values
// ARE the plain right-hand strings, not shuffle-array indices.
function submitMatchAnswer(pi,val){
  if(quizLocked[quizCurrent]) return; // Phase 4 — locked questions are read-only
  if(!Array.isArray(quizAnswers[quizCurrent])){
    const pairCount=(Array.isArray(activeQuiz.questions[quizCurrent].pairs) ? activeQuiz.questions[quizCurrent].pairs.length : 0);
    quizAnswers[quizCurrent]=new Array(pairCount).fill('');
  }
  quizAnswers[quizCurrent][pi]=val;
  const btn=document.getElementById('btn-next');
  if(btn) btn.disabled = !quizAnswers[quizCurrent].some(v=>v && String(v).trim().length);
}
// Phase 4 — combo meter (quest_board_report.md §3.3): grades the question
// being LEFT (not the one being entered) the first time it's passed, and
// locks it so Prev-ing back to review can't be used to quietly fix it.
// Consecutive full-credit (eqGradeAnswer===1) answers build quizCombo;
// anything else (a miss, or an enum's partial credit) resets it to 0.
// quizComboMax (the run's peak) is what finishQuiz() actually rewards —
// see eqComboMultiplier() in utils.js.
// Phase 9 — Answer Reveal: grading no longer advances immediately. It now
// re-renders the SAME question locked (showing the green/red marks, the
// flash burst, and the mascot's reaction) and only moves on after a short
// beat — see _quizShowRevealThenAdvance() below — so a student actually
// gets to see whether they were right instead of the screen jumping
// straight to the next question.
function quizNext(){
  const ans=quizAnswers[quizCurrent];
  const unanswered = ans===null || ans===undefined
    || (typeof ans==='string' && !ans.trim().length)
    || (Array.isArray(ans) && !ans.some(v=>v && String(v).trim().length));
  if(unanswered)return;
  if(quizLocked[quizCurrent]){
    // Already graded earlier (student Prev'd back to review it, then hit
    // Next/Submit again) — nothing new to reveal, so advance right away.
    _quizAdvanceNow();
    return;
  }
  quizLocked[quizCurrent]=true;
  const frac=eqGradeAnswer(activeQuiz.questions[quizCurrent], ans);
  quizAnswerRevealEvent = frac>=1 ? 'correct' : frac>0 ? 'partial' : 'wrong';
  // Phase 7 — §6's per-answer flow step 3: mascot reacts right alongside
  // the combo update. Stage is the one the question being GRADED belongs
  // to (same "question being left" convention the combo logic above uses).
  const mascotStageIdx=eqQuestionStage(activeQuiz.questions.length, quizCurrent);
  if(frac>=1){
    quizCombo++;
    if(quizCombo>quizComboMax) quizComboMax=quizCombo;
    // Phase 6 — one-shot "pop" mount animation on the combo band that's
    // about to render for the next question, plus a particle burst on
    // top of it if this exact streak count is a milestone.
    quizComboLastEvent = 'grow';
    quizComboMilestoneHit = eqIsComboMilestone(quizCombo);
    if(quizCombo>=5) toast(`🔥 COMBO x${quizCombo}! Max multiplier reached!`,'#ffb95f');
    else if(quizCombo>=3) toast(`⚡ Combo x${quizCombo}!`,'#d0bcff');
    // A milestone streak gets its own hyped line instead of the plain
    // per-stage "correct" one — matches the admin editor's separate
    // 🔥 Combo Milestone pool.
    fireMascotEvent(quizComboMilestoneHit ? 'milestone' : 'correct', mascotStageIdx);
  } else if(quizCombo>=2){
    toast('💥 Combo broken!','#ffb4ab');
    quizCombo=0;
    // Phase 6 — "shatter" mount animation, not a silent reset, per §5.
    quizComboLastEvent = 'break';
    fireMascotEvent('wrong', mascotStageIdx);
  } else {
    quizCombo=0;
    quizComboLastEvent = null;
    fireMascotEvent('wrong', mascotStageIdx);
  }
  // Correct answers get a shorter, snappier beat; wrong/partial ones linger
  // slightly longer so there's actually time to read the correct-answer
  // callout before the screen moves on.
  _quizShowRevealThenAdvance(frac>=1 ? 1000 : 1500);
}
// Phase 9 — shared "show the just-graded question, then move on" step used
// by both quizNext() (real answers) and quizTimeout() (auto-graded misses).
// Re-renders now (so the reveal marks/flash/mascot line are visible right
// away), freezes Prev/Next so a fast double-tap can't race the timer, and
// schedules the actual advance. quizPrev()/abortQuiz() both defensively
// clear quizAdvanceTimer so a stale one can never fire against a question
// the student has since navigated away from.
function _quizShowRevealThenAdvance(delayMs){
  clearInterval(quizTimer);
  renderQuizQuestion();
  const nextBtn=document.getElementById('btn-next'); if(nextBtn) nextBtn.disabled=true;
  const prevBtn=document.querySelector('.quiz-nav-prev'); if(prevBtn) prevBtn.disabled=true;
  clearTimeout(quizAdvanceTimer);
  quizAdvanceTimer=setTimeout(_quizAdvanceNow, delayMs);
}
function _quizAdvanceNow(){
  if(quizCurrent===activeQuiz.questions.length-1){clearInterval(quizTimer);finishQuiz();}else{quizCurrent++;renderQuizQuestion();}
}
// Phase 6 — Prev is a review action, not a grading event; defensively clear
// any pending one-shot combo animation flag so reviewing an old question
// never replays a pop/shatter that belonged to a different question. (In
// practice this is already consumed by the very next render after
// quizNext()/quizTimeout(), but this keeps that invariant explicit here too.)
// Phase 9 — also clears any pending reveal→advance timer, so navigating
// away mid-reveal can never trigger an advance from a question the student
// isn't looking at anymore.
function quizPrev(){if(quizCurrent>0){clearTimeout(quizAdvanceTimer);quizComboLastEvent=null;quizComboMilestoneHit=false;quizCurrent--;renderQuizQuestion();}}
// Phase 60 (exploit fix) — Abort & Retry Rules. Abort is no longer a free,
// consequence-free exit: a confirmation step is mandatory, "Stay & Finish"
// is the highlighted/easy tap, and "Abort Anyway" is de-emphasized on
// purpose so leaving is never the path of least resistance.
function confirmAbortQuiz(){
  if(!activeQuiz) return;
  showModal(`
    <div style="text-align:center;padding:4px">
      <div style="font-size:34px;margin-bottom:10px">⚠️</div>
      <div class="modal-h2" style="text-align:center">Leave this quest?</div>
      <div style="color:var(--text-muted);margin-bottom:22px;font-size:13px;line-height:1.6">
        Leaving now counts as a loss. Your score won't count, and rewards will be reduced if you retry.
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary" style="width:100%" onclick="closeModalForce()">Stay &amp; Finish</button>
        <button style="width:100%;background:none;border:none;color:var(--text-muted);font-size:12px;padding:6px;cursor:pointer;text-decoration:underline;text-underline-offset:3px" onclick="closeModalForce();abortQuiz()">Abort Anyway</button>
      </div>
    </div>`, 'sm');
}
// Abort = loss (Improvement Plan §7): same penalty bucket as a timeout or a
// failing score — no clean/consequence-free exit. Credits only whatever was
// already locked in (answered + advanced past with Next) before the abort;
// the in-progress/unanswered current question earns nothing. Pushes the
// SAME quizHistory row shape finishQuiz() does (tagged aborted:true) so it
// counts toward the shared attempt/lock counter (eqQuizAttemptStatus()) —
// switching between "answer badly on purpose" and "abort" can't dodge the
// cap either way. Completion is authoritative the instant this runs:
// activeQuiz is cleared and there is no route back into this same attempt,
// only a brand-new (further-penalized, or locked) one via startQuiz().
function abortQuiz(){
  clearInterval(quizTimer);
  // Phase 5 — stop the ambient intensity backdrop the instant this attempt
  // ends; #s-quiz-active's innerHTML is about to be replaced with the
  // results screen (or navTo() will replace it again), which detaches
  // #quiz-intensity-canvas but doesn't stop its rAF loop on its own.
  if (typeof window._eqQuizIntensityBackdropStop === 'function') {
    window._eqQuizIntensityBackdropStop();
    window._eqQuizIntensityBackdropStop = null;
  }
  if (quizFinishing || !activeQuiz) { activeQuiz=null; navTo('s-quizzes'); return; }
  quizFinishing = true;

  const total = activeQuiz.questions.length;

  let correct = 0; const results = [];
  activeQuiz.questions.forEach((q,i) => {
    const frac = quizLocked[i] ? eqGradeAnswer(q, quizAnswers[i]) : 0;
    correct += frac; results.push(frac);
  });
  const score = Math.round((correct/total)*100);

  // Same synchronous-persist requirement the comment below explains: this
  // must land before a tab-close/hard-refresh can cut it off, so flushNow()
  // forces AppStore's normally-debounced persist immediately, right after
  // committing through the proper draft-based mutation gate.
  AppStore.updateState(draft => {
    if (!draft.quizHistory) draft.quizHistory = {};
    if (!draft.quizHistory[currentUser.id]) draft.quizHistory[currentUser.id] = [];
    // Phase 2 (Quest Board state clarity) — passed is hard-coded false here,
    // never derived from `score`: Abort & Retry Rules (Phase 1/60, §7) say
    // "Abort always counts as a loss," full stop, even if a student had
    // already locked in a passing number of correct answers before bailing.
    draft.quizHistory[currentUser.id].push({
      id:'qh_'+uid(), quizId:activeQuiz.id, score, passed:false, completedAt:new Date().toISOString(),
      date:isoDate(), attempt:quizAttemptNumber, results, aborted:true
    });

    // No completedQuizzes credit, no XP/coins, no streak, no level check — an
    // abort earns nothing, it only logs the attempt against the cap.
    const hist = draft.quizHistory[currentUser.id];
    if (hist.length) {
      const s = (draft.students || []).find(x => x.id === currentUser.id);
      if (s) {
        const totalScore = hist.reduce((sum,e)=>sum+e.score,0);
        s.quizAvg = Math.round(totalScore/hist.length);
      }
    }
  }, { type: 'quiz:aborted', payload: { studentId: currentUser.id, quizId: activeQuiz.id } });
  AppStore.flushNow();
  currentUser = AppStore.getStudent(currentUser.id);
  updateTopbar();

  toast('🚩 Quest aborted — counted as a loss.', '#ffb4ab');
  activeQuiz = null;
  navTo('s-quizzes');
}
// Phase 60 (exploit fix) — best-effort coverage for the tab-close/hard-
// refresh case: navTo() already catches "walked away via the sidebar", but
// that never runs if the page itself goes away. The local DB write inside
// abortQuiz() is synchronous (DBService mirrors to localStorage before ever
// touching the network), so the history row lands even if the outbound
// Supabase push gets cut off mid-flight.
window.addEventListener('beforeunload', function(){
  if (activeQuiz && !quizFinishing) { try { abortQuiz(); } catch(e) {} }
});
function finishQuiz() {
  clearInterval(quizTimer);
  // Phase 5 — same backdrop-loop cleanup as abortQuiz(); see comment there.
  if (typeof window._eqQuizIntensityBackdropStop === 'function') {
    window._eqQuizIntensityBackdropStop();
    window._eqQuizIntensityBackdropStop = null;
  }

  // Phase 4 — same-tab re-entrancy guard (quest_board_report.md §7). The
  // old guard checked `completedQuizzes.includes(activeQuiz.id)`, which
  // worked as a duplicate-submit block back when a quiz could only ever be
  // finished once — now that unlimited retries are allowed, that check
  // would incorrectly block every retry after the first. quizFinishing
  // instead guards against a single tab firing finishQuiz() twice for the
  // SAME attempt (e.g. a double Enter/click racing the timer's own call).
  if (quizFinishing || !activeQuiz) { return; }
  quizFinishing = true;

  let correct = 0;
  // Phase 1/3 — eqGradeAnswer() dispatches by question type and returns a
  // fraction (mc/tf/id = 1 or 0, enum/match = partial-credit ratio), so a
  // 2-of-3 Enumeration answer contributes 0.67 toward `correct` instead of
  // an all-or-nothing 0 or 1.
  // Phase 5 — `results` mirrors the same per-question fractions into their
  // own array (quest_board_report.md §19), stored alongside the attempt so
  // eqComputeQuizAnalytics() can compute a per-question miss-rate without
  // re-grading anything — the grading already happens right here, once.
  const results = [];
  activeQuiz.questions.forEach((q, i) => { const frac = eqGradeAnswer(q, quizAnswers[i]); correct += frac; results.push(frac); });
  const total = activeQuiz.questions.length;
  const score = Math.round((correct / total) * 100);
  const baseXpGain   = Math.round((activeQuiz.xpReward * score) / 100);
  const baseCoinGain = Math.round((activeQuiz.coinReward * score) / 100);
  const correctDisplay = Math.round(correct * 10) / 10; // e.g. 2.7 — partial credit stays readable

  // Phase 4 — combo + retry multipliers (quest_board_report.md §3.3/§7).
  // Combo rewards a sustained correct streak within THIS attempt; retry
  // reduces reward on 2nd+ attempts of the SAME quest so there's still
  // real incentive to nail it the first time, but nobody's ever locked out.
  const comboMult = eqComboMultiplier(quizComboMax);
  const retryMult = eqRetryMultiplier(quizAttemptNumber);
  const totalMult = comboMult * retryMult;
  const xpGain   = Math.round(baseXpGain   * totalMult);
  const coinGain = Math.round(baseCoinGain * totalMult);
  const isRetry  = quizAttemptNumber > 1;

  // Grant rewards + log the attempt — all in one AppStore draft so this
  // commits atomically through the proper mutation gate instead of directly
  // poking DB.students[]/DB.quizHistory/DB.pointLog and calling saveDB().
  AppStore.updateState(draft => {
    const s = (draft.students || []).find(x => x.id === currentUser.id);
    if (!s) return;
    s.xp += xpGain;
    s.coins += coinGain;
    // Phase 4 — only the FIRST completion should join completedQuizzes (it's
    // read as a de-duped "done" set everywhere: the quest board's done/
    // pending split, achievements' quests_completed trigger, chain-unlock
    // status). Retries still log a new quizHistory row and grant reward
    // below; they just don't push a duplicate id here.
    if (!s.completedQuizzes.includes(activeQuiz.id)) {
      s.completedQuizzes.push(activeQuiz.id);
    }

    // Store per-quiz score for history
    if (!draft.quizHistory) draft.quizHistory = {};
    if (!draft.quizHistory[currentUser.id]) draft.quizHistory[currentUser.id] = [];
    // Phase 2 — `date` (Asia/Manila calendar day via isoDate()) is what
    // computeQuestStreak() reads; completedAt stays as the raw ISO timestamp
    // for display/sorting purposes, unchanged.
    // Phase 57 — `id` is new: quiz_history now syncs to Supabase via
    // upsert-by-id (db-service.js), same convention as DB.pointLog's id.
    // Without it, every save would look like a fresh insert and duplicate
    // rows server-side; this stamps one once, here, at creation time.
    // Phase 2 (Quest Board state clarity) — `passed` makes the pass/fail
    // outcome an explicit, stored fact instead of something re-derived from
    // `score` ad hoc at render time; renderStudentQuizzes() reads this to
    // tell a genuinely "completed (passed)" node apart from a "completed
    // (failed, retry available)" one.
    draft.quizHistory[currentUser.id].push({ id: 'qh_'+uid(), quizId: activeQuiz.id, score, passed: eqQuizPassed(score), completedAt: new Date().toISOString(), date: isoDate(), attempt: quizAttemptNumber, results });

    // ── Safe Quiz Average Calculation (Prevents NaN%) ──
    const history = draft.quizHistory[currentUser.id];
    if (history && history.length > 0) {
      const totalScore = history.reduce((sum, entry) => sum + entry.score, 0);
      s.quizAvg = Math.round(totalScore / history.length);
    } else {
      s.quizAvg = 0; // Fallback for brand new students
    }

    // ── Centralized Level Trigger — must run here, inside the draft ──
    window.checkLevelUp(s);

    // ── Real Timestamp & Point Accuracy (Logging XP instead of Coins) ──
    if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
    draft.pointLog.unshift({
      studentId: currentUser.id,
      what: `Quest: ${activeQuiz.title} (${score}%)`,
      pts: xpGain,
      when: window.getNowLabel(),
      id: 'pl_' + uid(),
      createdAt: new Date().toISOString()
    });
  }, { type: 'quiz:finished', payload: { studentId: currentUser.id, quizId: activeQuiz.id, score } });

  currentUser = AppStore.getStudent(currentUser.id);
  // Phase 2 — server-authoritative XP/coins sync. Every other grant site in
  // this app (mail, achievements, campaign, recitation, world boss, shop)
  // already calls this right after its local mutation; Quest Board never
  // had it — see syncStudentStatsToServer()'s note in utils.js for why that
  // matters (a stale tab's bulk profile upsert can otherwise clobber it).
  syncStudentStatsToServer(currentUser.id, xpGain, coinGain);

  const pass = eqQuizPassed(score);
  // Visual-polish pass — S/A/B/C/D rank badge alongside the existing raw
  // score, purely a cosmetic read of the same `score` value already
  // computed above (no change to how passing/XP/coins are determined).
  const rankLetter = score>=95?'S':score>=90?'A':score>=80?'B':score>=70?'C':score>=60?'D':'F';
  const _rc = pass ? 'var(--secondary)' : 'var(--error)';
  // Phase 4 — small combo/retry summary line under the score, only shown
  // when it actually changed the reward (multiplier !== 1) so a normal
  // first-attempt, no-combo run looks exactly like it always has.
  const bonusBits = [];
  if (comboMult > 1) bonusBits.push(`🔥 Combo x${quizComboMax} bonus (${comboMult}x)`);
  if (isRetry) bonusBits.push(`↻ Attempt #${quizAttemptNumber} (${Math.round(retryMult*100)}% reward)`);
  // Phase 7 — §6/§10: "relieved/celebrating" on a pass, "sad-but-supportive"
  // on a fail. This reuses the same emoji + line pool as the in-quiz dock
  // (.results-mascot-line, base.css) rather than calling fireMascotEvent()
  // itself — the quiz dock DOM is about to be replaced by this very innerHTML
  // write, so animating it first would be invisible.
  const _resultsMascotEmotion = pass ? 'relieved' : 'sad';
  const _resultsMascotLine = (typeof eqMascotLine === 'function') ? eqMascotLine(pass ? 'pass' : 'fail') : '';
  const _resultsMascotEmoji = (window.MASCOT_EMOJI && window.MASCOT_EMOJI[_resultsMascotEmotion]) || (pass ? '😌' : '🥺');
  const _eqEsc = s => { const d = document.createElement('div'); d.textContent = (s===null||s===undefined) ? '' : String(s); return d.innerHTML; };
  document.getElementById('s-quiz-active').innerHTML = `
  <div class="results-wrap fade-in">
    <div class="results-emoji">${pass ? '🏆' : '💀'}</div>
    <div class="results-title" style="color:${pass ? '#4edea3' : '#ffb4ab'}">${pass ? 'Quest Complete!' : 'Quest Failed'}</div>
    <div class="results-sub">${activeQuiz.title.toUpperCase().replace(/\s+/g, '_')}</div>
    <div class="results-score-card" style="--rc:${_rc}">
      <div class="results-rank-badge">${rankLetter}</div>
      <div class="results-big-score" style="color:${score >= 80 ? '#4edea3' : score >= 60 ? '#ffb95f' : '#ffb4ab'}">${score}<span style="font-size:28px">%</span></div>
      <div class="results-sub-score">${correctDisplay} / ${total} CORRECT</div>
      ${bonusBits.length ? `<div class="results-bonus-row">${bonusBits.map(b=>`<span class="results-bonus-chip">${b}</span>`).join('')}</div>` : ''}
      ${_resultsMascotLine ? `<div class="results-mascot-line"><span class="results-mascot-emoji">${_resultsMascotEmoji}</span><span>${_eqEsc(_resultsMascotLine)}</span></div>` : ''}
    </div>
    <div style="display:flex;gap:12px;margin-top:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="navTo('s-quizzes')">← Quest Board</button>
      <button class="btn btn-primary" style="flex:1" onclick="navTo('s-dashboard')">🏠 Dashboard</button>
    </div>
  </div>`;
  updateTopbar();

  // Phase 2 — wire completion into the same Universal Reward Presentation
  // (confetti/rarity/claim treatment) Mail and Achievements already use,
  // instead of the old static reward numbers baked into the results card
  // (quest_board_report.md §1 "Completion screen", §3.11). The results
  // card above still shows score/correct-count and stays visible behind
  // this overlay once it's dismissed.
  //
  // Phase 3 — the popup's rarity is now the QUEST's own rarity tier
  // (teacher-set, reusing the Achievements rarity palette — §3.4), not a
  // score-derived guess, so an Epic quest always feels like an Epic drop
  // regardless of how well the student did on it.
  const rewards = [];
  if (xpGain   > 0) rewards.push({ type: 'xp',    amount: xpGain,   icon: '⚡', label: 'XP',    color: 'var(--primary)'  });
  if (coinGain > 0) rewards.push({ type: 'coins', amount: coinGain, icon: '🪙', label: 'Coins', color: 'var(--tertiary)' });
  const rarity = eqQuizRarity(activeQuiz);
  const _present = typeof eqRewardPresent === 'function' ? eqRewardPresent
                 : typeof window.eqRewardPresent === 'function' ? window.eqRewardPresent
                 : null;
  const _finishedTitle = activeQuiz.title;
  const _finishedSubtitle = `${_finishedTitle} — ${correctDisplay}/${total} correct (${score}%)${bonusBits.length ? ' · ' + bonusBits.join(' · ') : ''}`;
  if (_present) {
    _present({
      title:    pass ? 'Quest Complete!' : 'Quest Failed',
      subtitle: _finishedSubtitle,
      icon:     pass ? '🏆' : '💀',
      rarity:   rarity,
      source:   'quest',
      rewards:  rewards
    });
  }
  // Phase 4 — clear activeQuiz only after everything above that reads it
  // has run, so a re-entrant call this tick still sees quizFinishing=true
  // and bails before ever reaching a null activeQuiz.questions access.
  activeQuiz = null;
}
function profEnsureFields(user) {
  // Ensure all profile fields exist on a user record
  if (!user) return;
  if (!user.firstName) {
    const parts = (user.name || '').split(' ');
    user.firstName = parts[0] || '';
    user.lastName = parts.slice(1).join(' ') || '';
  }
  if (!user.displayName) user.displayName = user.name || user.id;
  if (!user.email) user.email = '';
  if (!user.joinDate) user.joinDate = todayStr();
  if (!user.profilePic) user.profilePic = '';
}

function profGetCurrent() {
  // Returns freshest copy merged with DB
  if (!currentUser) return null;
  if (currentRole === 'admin') {
    profEnsureFields(DB.admin);
    return DB.admin;
  }
  if (currentRole === 'teacher') {
    // Role split fix: teachers are never in DB.students, and DB.admin is a
    // single shared legacy record that may belong to a DIFFERENT staff
    // member — writing a teacher's own profile into it would corrupt that
    // other account. currentUser is already correctly shaped from auth.js's
    // profiles-row bridge, so just ensure fields on it directly.
    profEnsureFields(currentUser);
    return currentUser;
  }
  const st = DB.students.find(s => s.id === currentUser.id);
  if (st) {
    profEnsureFields(st);
    currentUser = st;
  }
  return currentUser;
}

function profInitAll() {
  // Ensure all users have profile fields (run on boot)
  profEnsureFields(DB.admin);
  DB.students.forEach(s => profEnsureFields(s));
}

/* ── Avatar rendering helpers (used everywhere) ── */

function getAvatarHTML(user, size, radius='50%') {
  // Returns inner HTML for an avatar element
  if (!user) return '';
  if (user.profilePic) {
    return `<img class="av-img" src="${user.profilePic}" alt="${user.init||''}" onerror="this.style.display='none'">`;
  }
  return `<span class="av-init">${user.init || (user.name||'?').charAt(0)}</span>`;
}

function renderAvatarEl(el, user, isSquare) {
  // Updates a DOM element to show avatar or initials correctly
  if (!el || !user) return;
  if (user.profilePic) {
    el.innerHTML = `<img class="${isSquare ? 'av-img' : 'av-img'}" src="${user.profilePic}" alt="${user.init||''}"
      style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:${isSquare?'10px':'50%'};z-index:2"
      onerror="this.remove()">`;
    el.style.position = 'relative';
  } else {
    // Remove any stale image
    const img = el.querySelector('img.av-img');
    if (img) img.remove();
    el.textContent = user.init || (user.name||'?').charAt(0);
  }
}

/* ── Topbar / sidebar / global avatar refresh ── */

function refreshAllAvatars() {
  if (!currentUser) return;
  const user = profGetCurrent();

  // 1. Topbar avatar
  const topAv = document.getElementById('topbar-av');
  if (topAv) {
    const init = currentRole === 'student' ? user.init : 'MS';
    const color = currentRole === 'student' ? user.color : '#ffb4ab';
    topAv.style.background = `linear-gradient(135deg,${color}44,${color}22)`;
    topAv.style.color = color;
    if (user.profilePic) {
      topAv.innerHTML = `<img class="av-img" src="${user.profilePic}" alt="${init}"
        style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:50%;z-index:2"
        onerror="this.remove()">`;
      topAv.style.position = 'relative';
      topAv.style.overflow = 'hidden';
    } else {
      const img = topAv.querySelector('img.av-img');
      if (img) img.remove();
      topAv.textContent = init;
    }
  }

  // 2. Sidebar avatar
  const sbAv = document.getElementById('sb-avatar');
  if (sbAv && currentRole === 'student') {
    sbAv.style.cssText = `width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:14px;flex-shrink:0;border:2px solid ${user.color}55;background:${user.color}22;color:${user.color};position:relative;overflow:hidden`;
    if (user.profilePic) {
      sbAv.innerHTML = `<img class="av-img" src="${user.profilePic}" alt="${user.init}"
        style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:10px;z-index:2"
        onerror="this.remove()">`;
    } else {
      const img = sbAv.querySelector('img.av-img');
      if (img) img.remove();
      sbAv.textContent = user.init;
    }
  }

  // 3. Sidebar name / tier
  const sbName = document.getElementById('sb-name');
  const sbTier = document.getElementById('sb-tier');
  if (sbName && currentRole === 'student') {
    sbName.textContent = user.displayName || (user.firstName + ' ' + user.lastName).trim() || user.name;
  }

  // 4. Topbar coin display (name may have changed)
  const coinVal = document.getElementById('topbar-coin-val');
  if (coinVal && currentRole === 'student') {
    coinVal.textContent = (user.coins || 0).toLocaleString();
  }
}

/* ── Profile modal open / close ── */

function openProfile() {
  _profPendingPic = null; // always start clean
  profInitAll();
  const user = profGetCurrent();
  if (!user) return;

  // Populate hero
  _profRenderHero(user);
  _profRenderStats(user);
  switchProfileTab('overview');

  document.getElementById('profile-overlay').classList.add('open');
}

function closeProfile() {
  _profPendingPic = null; // discard any unsaved photo change
  document.getElementById('profile-overlay').classList.remove('open');
}

function profileOverlayClick(e) {
  if (e.target === document.getElementById('profile-overlay')) closeProfile();
}

function profileAvatarClick() {
  // Opens the edit-profile tab and focuses the pic section
  switchProfileTab('edit');
  setTimeout(() => {
    const el = document.getElementById('prof-pic-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 120);
}

/* ── Hero section ── */

function _profRenderHero(user) {
  const av = document.getElementById('prof-avatar');
  const avInit = document.getElementById('prof-av-init');
  const color = user.color || '#8b5cf6';

  av.style.background = `linear-gradient(135deg,${color}44,${color}22)`;
  av.style.borderColor = color + '88';
  av.style.color = color;

  if (user.profilePic) {
    // Remove old init, inject image
    let img = av.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:50%;z-index:2';
      img.onerror = function() { this.remove(); avInit.style.display = ''; };
      av.appendChild(img);
    }
    img.src = user.profilePic;
    avInit.style.display = 'none';
  } else {
    const img = av.querySelector('img');
    if (img) img.remove();
    avInit.style.display = '';
    avInit.textContent = user.init || (user.name||'?').charAt(0);
  }

  const displayName = user.displayName || user.name || user.id;
  document.getElementById('prof-display-name').textContent = displayName;
  document.getElementById('prof-username').textContent = '@' + (user.id || user.username || '');
  // Role split fix: this used to only distinguish 'admin' vs "everything
  // else" (which meant a teacher account saw "Student" here). Show the
  // actual role.
  document.getElementById('prof-role-chip').innerHTML =
    currentRole === 'admin'    ? '<span class="material-symbols-outlined" style="font-size:13px">shield</span> Administrator'
    : currentRole === 'teacher' ? '<span class="material-symbols-outlined" style="font-size:13px">shield</span> Teacher'
    : '<span class="material-symbols-outlined" style="font-size:13px">school</span> Student';
  document.getElementById('prof-join-text').textContent = 'Joined ' + (user.joinDate || todayStr());
}

/* ── Stats strip ── */

function _profRenderStats(user) {
  const strip = document.getElementById('prof-stats-strip');
  if (!strip) return;
  // Role split fix: this used to only check 'admin', so a teacher fell
  // through to the student-stats branch below and crashed on
  // user.completedQuizzes.length (teachers have no such field) — which is
  // why the profile page appeared to silently fail for teacher accounts.
  // Students/quizzes/etc. here are already scoped to the teacher's own
  // class(es) server-side by RLS, so this staff view is accurate for both.
  if (currentRole === 'admin' || currentRole === 'teacher') {
    strip.innerHTML = `
      <div class="profile-stat"><div class="val" style="color:#d0bcff">${DB.students.length}</div><div class="lbl">Students</div></div>
      <div class="profile-stat"><div class="val" style="color:#ffb95f">${DB.quizzes.length}</div><div class="lbl">Quests</div></div>
      <div class="profile-stat"><div class="val" style="color:#4edea3">${(DB.bossEvents||[]).length}</div><div class="lbl">Bosses</div></div>
      <div class="profile-stat"><div class="val" style="color:#EC4899">${(DB.redemptions||[]).length}</div><div class="lbl">Redemptions</div></div>`;
    return;
  }
  const xpNext = (user.level + 1) * 1200;
  const xpPct = Math.min(100, Math.round(user.xp / xpNext * 100));
  strip.innerHTML = `
    <div class="profile-stat"><div class="val" style="color:var(--primary)">${user.level}</div><div class="lbl">Level</div></div>
    <div class="profile-stat"><div class="val" style="color:#d0bcff">${user.xp.toLocaleString()}</div><div class="lbl">XP</div></div>
    <div class="profile-stat"><div class="val" style="color:#ffb95f">${user.coins.toLocaleString()}</div><div class="lbl">Coins</div></div>
    <div class="profile-stat"><div class="val" style="color:#4edea3">${user.completedQuizzes.length}</div><div class="lbl">Quests Done</div></div>`;
}

/* ── Tab switching ── */

function switchProfileTab(tab) {
  // If navigating away from edit without saving, discard pending photo
  if (tab !== 'edit' && _profPendingPic !== null) {
    _profPendingPic = null;
  }

  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  const btn = document.getElementById('ptab-' + tab);
  if (btn) btn.classList.add('active');

  const user = profGetCurrent();
  const body = document.getElementById('prof-tab-body');
  if (!body) return;

  if (tab === 'overview') body.innerHTML = _profOverviewHTML(user);
  else if (tab === 'edit')  body.innerHTML = _profEditHTML(user);
  else if (tab === 'account') body.innerHTML = _profAccountHTML(user);
}

/* ── Overview tab ── */

function _profOverviewHTML(user) {
  // Role split fix: this used to only check 'admin', so a teacher fell
  // through to the "Student overview" branch below and tried to render a
  // teacher account as if it were a student's own quest/achievement profile.
  if (currentRole === 'admin' || currentRole === 'teacher') {
    const isAdmin = currentRole === 'admin';
    return `
    <div class="profile-section-title"><span class="material-symbols-outlined">admin_panel_settings</span>${isAdmin ? 'Administrator Account' : 'Teacher Account'}</div>
    <div style="background:rgba(255,180,171,0.07);border:1px solid rgba(255,180,171,0.2);border-radius:14px;padding:18px;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:36px">🛡️</div>
        <div>
          <div style="font-family:var(--fh);font-size:15px;font-weight:800;color:var(--on-surface);margin-bottom:3px">${user.name}</div>
          <div style="font-size:12px;color:var(--text-muted)">${isAdmin ? 'Full administrative access · Teacher account' : 'Teacher account'}</div>
        </div>
      </div>
    </div>
    <div class="profile-section-title"><span class="material-symbols-outlined">groups</span>Class Overview</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      <div class="profile-boss-chip" style="background:rgba(208,188,255,0.08);border-color:rgba(208,188,255,0.2)">
        <div class="v" style="color:var(--primary)">${DB.students.length}</div>
        <div class="l">Total Students</div>
      </div>
      <div class="profile-boss-chip" style="background:rgba(78,222,163,0.06);border-color:rgba(78,222,163,0.18)">
        <div class="v" style="color:#4edea3">${DB.quizzes.length}</div>
        <div class="l">Active Quests</div>
      </div>
      <div class="profile-boss-chip" style="background:rgba(255,185,95,0.07);border-color:rgba(255,185,95,0.22)">
        <div class="v" style="color:var(--tertiary)">${(DB.store||[]).length}</div>
        <div class="l">Store Items</div>
      </div>
      <div class="profile-boss-chip" style="background:rgba(236,72,153,0.06);border-color:rgba(236,72,153,0.2)">
        <div class="v" style="color:#EC4899">${(DB.bossEvents||[]).length}</div>
        <div class="l">Boss Events</div>
      </div>
    </div>`;
  }

  // Student overview
  const allBossParticipants = DB.bossParticipants || {};
  let totalDmg = 0, totalCorrect = 0, totalCrits = 0, bossCount = 0;
  Object.values(allBossParticipants).forEach(bossRoster => {
    const rec = bossRoster[user.id];
    if (rec) { totalDmg += rec.totalDamage || 0; totalCorrect += rec.correctAnswers || 0; totalCrits += rec.critHits || 0; bossCount++; }
  });

  // Achievements (dynamic — read from achievement engine)
  const earnedUnlocks=(DB.achievementUnlocks||{})[user.id]||[];
  const achs=earnedUnlocks.map(u=>{
    const a=(DB.achievements||[]).find(x=>x.id===u.achId);
    return a?{icon:a.icon||'🏅',label:a.name}:null;
  }).filter(Boolean).slice(0,8);
  if(achs.length===0)achs.push({icon:'🌱',label:'Rising Scholar'});

  const xpNext = (user.level + 1) * 1200;
  const xpPct = Math.min(100, Math.round(user.xp / xpNext * 100));
  const ownProfile = currentRole === 'student' && currentUser && currentUser.id === user.id;
  const unlockedTitles = ownProfile ? tsGetUnlockedTitles(user.id) : [];

  // Build equipped title HTML for profile overlay (uses window.tsBuildBadgeHTML if available)
  const _profEquippedTitle = (function(){
    try{
      const tid = (DB.equippedTitles || {})[user.id];
      if(!tid) return '';
      const t = (DB.titles || []).find(x => x.id === tid && x.active);
      if(!t) return '';
      const badgeHTML = typeof tsBuildBadgeHTML === 'function' ? tsBuildBadgeHTML(t) : '';
      if(!badgeHTML) return '';
      return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06)">
        <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px">Equipped Title</div>
        ${badgeHTML}
      </div>`;
    }catch(e){ return ''; }
  })();

  const _profTitlePanel = ownProfile ? `<div style="margin-top:14px;padding:16px;background:rgba(208,188,255,0.08);border:1px solid rgba(208,188,255,0.2);border-radius:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">Titles & Achievements</div>
          <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${unlockedTitles.length} unlocked title${unlockedTitles.length === 1 ? '' : 's'}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="tsOpenTitlesFromProfile()">Manage Titles</button>
      </div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
        ${unlockedTitles.length ? 'Equip a title from your Achievements page to show it on your profile and leaderboard.' : 'Unlock a title by earning achievements, then equip it from the Achievements page.'}
      </div>
    </div>` : '';

  return `
  <div class="profile-section-title"><span class="material-symbols-outlined">person</span>About</div>
  <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:20px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px">Full Name</div><div style="font-size:13px;font-weight:700;color:var(--on-surface)">${user.firstName||''} ${user.lastName||''}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px">Username</div><div style="font-size:13px;font-weight:700;color:var(--primary)">@${user.id}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px">Tier</div><div style="font-size:13px;font-weight:700;color:var(--secondary)">${user.tier || 'Scholar'}</div></div>
      <div><div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px">Rank</div><div style="font-size:13px;font-weight:700;color:var(--tertiary)">#${user.rank || '?'}</div></div>
    </div>
    ${_profEquippedTitle}
    ${_profTitlePanel}
    <div style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:11px;color:var(--text-muted)">XP Progress to Level ${user.level + 1}</span>
        <span style="font-size:11px;color:var(--primary);font-weight:700">${xpPct}%</span>
      </div>
      <div style="background:rgba(255,255,255,0.06);border-radius:20px;height:7px;overflow:hidden">
        <div style="height:100%;border-radius:20px;background:linear-gradient(90deg,#8b5cf6,#d0bcff);width:${xpPct}%;box-shadow:0 0 8px rgba(139,92,246,0.5)"></div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">${(xpNext - user.xp).toLocaleString()} XP to next level</div>
    </div>
  </div>

  <div class="profile-section-title"><span class="material-symbols-outlined">workspace_premium</span>Achievements <span style="color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">(${achs.length})</span></div>
  <div class="profile-achievements">
    ${achs.map(a => `<div class="profile-ach-chip">${a.icon} ${a.label}</div>`).join('')}
  </div>

  <div class="profile-section-title"><span class="material-symbols-outlined">swords</span>Quest Statistics</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
    <div style="background:rgba(208,188,255,0.07);border:1px solid rgba(208,188,255,0.2);border-radius:12px;padding:12px;text-align:center">
      <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--primary);margin-bottom:3px">${user.completedQuizzes.length}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase">Quests Done</div>
    </div>
    <div style="background:rgba(255,185,95,0.07);border:1px solid rgba(255,185,95,0.2);border-radius:12px;padding:12px;text-align:center">
      <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--tertiary);margin-bottom:3px">${user.quizAvg}%</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase">Quiz Avg</div>
    </div>
    <div style="background:rgba(78,222,163,0.06);border:1px solid rgba(78,222,163,0.18);border-radius:12px;padding:12px;text-align:center">
      <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:#4edea3;margin-bottom:3px">${user.attendance}%</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.05em;text-transform:uppercase">Attendance</div>
    </div>
  </div>

  <div class="profile-section-title"><span class="material-symbols-outlined">local_fire_department</span>Boss Raid Stats</div>
  <div class="profile-boss-grid">
    <div class="profile-boss-chip">
      <div class="v">${bossCount}</div>
      <div class="l">Raids Joined</div>
    </div>
    <div class="profile-boss-chip">
      <div class="v">${totalDmg.toLocaleString()}</div>
      <div class="l">Total Damage</div>
    </div>
    <div class="profile-boss-chip">
      <div class="v">${totalCorrect}</div>
      <div class="l">Correct Hits</div>
    </div>
    <div class="profile-boss-chip">
      <div class="v">${totalCrits}</div>
      <div class="l">Critical Hits</div>
    </div>
    <div class="profile-boss-chip">
      <div class="v">${user.coins.toLocaleString()}</div>
      <div class="l">Coins Held</div>
    </div>
    <div class="profile-boss-chip">
      <div class="v">${user.level}</div>
      <div class="l">Current Level</div>
    </div>
  </div>`;
}

/* ── Edit Profile tab ── */

function _profEditHTML(user) {
  const picHtml = user.profilePic
    ? `<img src="${user.profilePic}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:50%;" onerror="this.remove()">`
    : `<span style="font-family:var(--fh);font-weight:900;font-size:18px;color:${user.color||'var(--primary)'}">${user.init||'?'}</span>`;

  return `
  <div id="prof-pic-section" class="profile-pic-section">
    <div class="profile-pic-preview" style="background:${(user.color||'#8b5cf6')+'22'};border-color:${(user.color||'#8b5cf6')+'55'};position:relative;overflow:hidden">
      ${picHtml}
    </div>
    <div>
      <div style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--on-surface);margin-bottom:8px">Profile Picture</div>
      <div class="profile-pic-actions">
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('profile-pic-input').click()">
          <span class="material-symbols-outlined" style="font-size:14px">upload</span> Upload Photo
        </button>
        ${user.profilePic ? `<button class="btn btn-ghost btn-sm" onclick="removeProfilePic()">
          <span class="material-symbols-outlined" style="font-size:14px">delete</span> Remove Photo
        </button>` : ''}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px">JPG, PNG, or GIF · Stored locally</div>
    </div>
  </div>

  <div class="profile-section-title"><span class="material-symbols-outlined">badge</span>Display Name</div>
  <div class="profile-form-group">
    <label class="form-label">Display Name <span style="color:var(--text-muted);font-size:11px">(shown throughout the app)</span></label>
    <input type="text" id="prof-displayname" value="${_esc(user.displayName || user.name)}" placeholder="How you appear in the app" style="width:100%">
  </div>

  <div class="profile-section-title" style="margin-top:18px"><span class="material-symbols-outlined">person</span>Personal Info</div>
  <div class="profile-form-row">
    <div class="profile-form-group">
      <label class="form-label">First Name</label>
      <input type="text" id="prof-firstname" value="${_esc(user.firstName || '')}" placeholder="First name" style="width:100%">
    </div>
    <div class="profile-form-group">
      <label class="form-label">Last Name</label>
      <input type="text" id="prof-lastname" value="${_esc(user.lastName || '')}" placeholder="Last name" style="width:100%">
    </div>
  </div>
  <div class="profile-form-group">
    <label class="form-label">Username <span style="color:var(--text-muted);font-size:11px">(login ID — must be unique)</span></label>
    <input type="text" id="prof-newid" value="${_esc(user.id)}" placeholder="username" style="width:100%" ${currentRole==='admin'?'':'readonly style="width:100%;opacity:0.6;cursor:not-allowed"'}>
    ${currentRole!=='admin'?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Only admins can change login username</div>`:''}
  </div>
  <div id="prof-edit-err" style="color:#ffb4ab;font-size:13px;display:none;margin-bottom:8px"></div>
  <div class="profile-save-row">
    <button class="btn btn-ghost" onclick="closeProfile()">Cancel</button>
    <button class="btn btn-primary" id="prof-save-btn" onclick="saveProfileEdit()">
      <span class="material-symbols-outlined" style="font-size:15px">save</span> Save Changes
    </button>
  </div>`;
}

/* ── Account Settings tab ── */

function _profAccountHTML(user) {
  const isStudent = currentRole === 'student';
  return `
  ${isStudent ? `
  <div class="profile-section-title"><span class="material-symbols-outlined">mail</span>Email Address</div>
  <div class="profile-form-group">
    <label class="form-label">Email</label>
    <input type="email" id="prof-email" value="${_esc(user.email || '')}" placeholder="your@email.com" style="width:100%">
  </div>
  <div id="prof-email-err" style="color:#ffb4ab;font-size:12px;display:none;margin-top:-10px;margin-bottom:10px"></div>
  <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
    <button class="btn btn-primary btn-sm" onclick="saveEmail()">
      <span class="material-symbols-outlined" style="font-size:14px">save</span> Save Email
    </button>
  </div>
  <div style="height:1px;background:var(--border);margin-bottom:20px"></div>` : ''}

  <div class="profile-section-title"><span class="material-symbols-outlined">lock</span>Change Password</div>
  <div class="profile-form-group">
    <label class="form-label">Current Password <span style="color:#EC4899">*</span></label>
    <div style="position:relative">
      <input type="password" id="prof-cur-pass" placeholder="Enter current password" style="width:100%;padding-right:40px">
      <button type="button" class="reg-pw-toggle-btn" tabindex="-1" aria-label="Show password" onclick="regTogglePasswordVisibility('prof-cur-pass', this)">
        <span class="material-symbols-outlined" style="font-size:18px">visibility</span>
      </button>
    </div>
  </div>
  <div class="profile-form-row">
    <div class="profile-form-group">
      <label class="form-label">New Password</label>
      <div style="position:relative">
        <input type="password" id="prof-new-pass" placeholder="New password" style="width:100%;padding-right:40px">
        <button type="button" class="reg-pw-toggle-btn" tabindex="-1" aria-label="Show password" onclick="regTogglePasswordVisibility('prof-new-pass', this)">
          <span class="material-symbols-outlined" style="font-size:18px">visibility</span>
        </button>
      </div>
    </div>
    <div class="profile-form-group">
      <label class="form-label">Confirm Password</label>
      <div style="position:relative">
        <input type="password" id="prof-conf-pass" placeholder="Confirm new password" style="width:100%;padding-right:40px">
        <button type="button" class="reg-pw-toggle-btn" tabindex="-1" aria-label="Show password" onclick="regTogglePasswordVisibility('prof-conf-pass', this)">
          <span class="material-symbols-outlined" style="font-size:18px">visibility</span>
        </button>
      </div>
    </div>
  </div>
  <div id="prof-pass-err" style="color:#ffb4ab;font-size:12px;display:none;margin-top:-10px;margin-bottom:10px"></div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn btn-primary" onclick="savePassword()">
      <span class="material-symbols-outlined" style="font-size:15px">lock_reset</span> Change Password
    </button>
  </div>`;
}

/* ── Save: Profile Edit ── */

async function saveProfileEdit() {
  const errEl = document.getElementById('prof-edit-err');
  if (errEl) errEl.style.display = 'none';

  const displayName = (document.getElementById('prof-displayname')?.value || '').trim();
  const firstName   = (document.getElementById('prof-firstname')?.value   || '').trim();
  const lastName    = (document.getElementById('prof-lastname')?.value    || '').trim();

  if (!displayName) {
    if (errEl) { errEl.textContent = 'Display name cannot be empty.'; errEl.style.display = 'block'; }
    return;
  }

  // Lock the save button + show a saving state while the RPC round-trips,
  // so a slow/offline connection doesn't look like a silent no-op.
  const saveBtn = document.getElementById('prof-save-btn');
  const saveBtnOriginalHTML = saveBtn ? saveBtn.innerHTML : null;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;animation:skShimmerSlide 1s linear infinite">autorenew</span> Saving…';
  }

  profInitAll();

  // Fix (Phase 49): cosmetic edits — including the profile picture — used
  // to be written only to the local DB via saveDB(), which for a
  // student/teacher session never actually reaches Supabase (see
  // syncOwnProfileCosmeticToServer()'s comment in utils.js for the full
  // root cause). Every branch below now ALSO calls that RPC and only
  // confirms success to the person once the server round-trip actually
  // succeeds — a failure rolls the button back and surfaces an error
  // instead of silently reverting on the next refresh.
  let syncResult = { success: true }; // admin username-only edits have no RPC gap (see branch below)

  if (currentRole === 'admin') {
    const newId = (document.getElementById('prof-newid')?.value || '').trim().toLowerCase();
    if (!newId) {
      if (errEl) { errEl.textContent = 'Username is required.'; errEl.style.display = 'block'; }
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = saveBtnOriginalHTML; }
      return;
    }
    AppStore.updateState(draft => {
      draft.admin.firstName = firstName;
      draft.admin.lastName = lastName;
      draft.admin.displayName = displayName;
      draft.admin.name = firstName && lastName ? firstName + ' ' + lastName : displayName;
      // Critical Fix #6: Actually persist the new username so future logins work
      draft.admin.id = newId;
      // Commit any staged picture change
      if (_profPendingPic !== null) draft.admin.profilePic = _profPendingPic;
    }, { type: 'profile:admin-cosmetic-saved', payload: { newId } });
    currentUser = AppStore.getSlice(s => s.admin);

    syncResult = await syncOwnProfileCosmeticToServer({
      displayName: displayName,
      firstName:   firstName,
      lastName:    lastName,
      init:        _makeInit(firstName, lastName, displayName),
      profilePic:  _profPendingPic, // null = unchanged, '' = cleared, string = new pic
    });
  } else if (currentRole === 'teacher') {
    // Role split fix: this branch used to be missing entirely, so a teacher
    // fell into the student branch below, DB.students.findIndex() always
    // returned -1 for a teacher id, and `if (stIdx < 0) return;` silently
    // discarded the edit with no error shown.
    //
    // Teachers aren't in DB.students, and writing into DB.admin isn't safe
    // either — DB.admin is a single shared legacy record that may represent
    // a DIFFERENT staff member's profile, so overwriting it here would
    // corrupt that other account. Updating currentUser directly is the
    // correct in-session fix.
    currentUser.firstName = firstName;
    currentUser.lastName = lastName;
    currentUser.displayName = displayName;
    currentUser.name = firstName && lastName ? firstName + ' ' + lastName : displayName;
    if (_profPendingPic !== null) currentUser.profilePic = _profPendingPic;

    // FIX (Phase 49 — closes the gap this branch used to flag as a known
    // TODO): teacher cosmetic edits now persist via the same self-service
    // RPC as students, scoped server-side to auth.uid(), so they survive a
    // refresh or a login from another device.
    syncResult = await syncOwnProfileCosmeticToServer({
      displayName: displayName,
      firstName:   firstName,
      lastName:    lastName,
      init:        _makeInit(firstName, lastName, displayName),
      profilePic:  _profPendingPic,
    });
  } else {
    const stIdx = AppStore.getSlice(s => s.students || []).findIndex(s => s.id === currentUser.id);
    if (stIdx < 0) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = saveBtnOriginalHTML; }
      return;
    }
    const _newInit = _makeInit(firstName, lastName, displayName);
    AppStore.updateState(draft => {
      const s = (draft.students || [])[stIdx];
      if (!s) return;
      s.firstName = firstName;
      s.lastName = lastName;
      s.displayName = displayName;
      s.name = firstName && lastName ? firstName + ' ' + lastName : displayName;
      s.init = _newInit;
      // Commit any staged picture change
      if (_profPendingPic !== null) s.profilePic = _profPendingPic;
    }, { type: 'profile:student-cosmetic-saved', payload: { studentId: currentUser.id } });
    currentUser = AppStore.getStudent(currentUser.id);

    // FIX (Phase 49): this is the actual fix for "profile picture doesn't
    // stay permanently" — previously saveDB() below was the only call
    // here, and its bulk profiles upsert skips student sessions entirely
    // (see db-service.js), so this local mutation had nowhere to go and
    // reverted on the next loadDB() pull.
    syncResult = await syncOwnProfileCosmeticToServer({
      displayName: displayName,
      firstName:   firstName,
      lastName:    lastName,
      init:        _newInit,
      profilePic:  _profPendingPic,
    });
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = saveBtnOriginalHTML; }

  if (!syncResult.success) {
    // Local cache still has the edit (instant visual feedback), but be
    // honest that it did NOT reach the server, since that's exactly the
    // silent-failure this fix exists to close.
    toast('⚠️ Saved locally, but failed to sync to the server. Try again or check your connection.', '#ffb95f');
    console.warn('[Profile] syncOwnProfileCosmeticToServer failed:', syncResult.error);
  } else {
    toast('✅ Profile updated!', '#4edea3');
  }

  _profPendingPic = null; // clear staging
  // Refresh hero + all avatars
  profInitAll();
  _profRenderHero(currentUser);
  _profRenderStats(currentUser);
  refreshAllAvatars();
  if (typeof updateTopbar === 'function') updateTopbar();
  // Re-render edit tab to reflect saved state (removes unsaved note, updates remove button visibility)
  switchProfileTab('edit');
}

/* ── Save: Password ── */

function savePassword() {
  const errEl = document.getElementById('prof-pass-err');
  if (errEl) errEl.style.display = 'none';

  const curPass  = document.getElementById('prof-cur-pass')?.value  || '';
  const newPass  = document.getElementById('prof-new-pass')?.value  || '';
  const confPass = document.getElementById('prof-conf-pass')?.value || '';

  const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };

  if (!curPass) { showErr('Current password is required.'); return; }
  if (!newPass) { showErr('New password cannot be empty.'); return; }
  if (newPass.length < 4) { showErr('New password must be at least 4 characters.'); return; }
  if (newPass !== confPass) { showErr('Passwords do not match.'); return; }

  // BIGGER GAP FOUND WHILE FIXING THE ROLE SPLIT (not fixed here, flagging
  // clearly rather than silently patching over it): this whole function
  // predates the real Supabase Auth login migration. Login now goes through
  // client.auth.signInWithPassword() (see auth.js doLogin()) — it never
  // reads DB.admin.pass or DB.students[i].pass. That means changing this
  // local `.pass` field, for ANY role including admin and student, does NOT
  // change the password someone actually logs in with. This panel currently
  // just edits a local cache field nobody checks anymore. A real fix needs
  // to call client.auth.updateUser({ password: newPass }) (after
  // re-authenticating with curPass, since Supabase requires an active
  // session to change a password) instead of touching DB.* at all — that's
  // a real auth-flow change, out of scope for this pass, so left as-is
  // below except for the teacher-specific silent-failure fix.
  if (currentRole === 'admin') {
    const _adminPass = AppStore.getSlice(s => s.admin?.pass);
    if (_adminPass !== curPass) { showErr('Current password is incorrect.'); return; }
    AppStore.updateState(draft => {
      draft.admin.pass = newPass;
    }, { type: 'profile:admin-password-changed', payload: {} });
    currentUser = AppStore.getSlice(s => s.admin);
  } else if (currentRole === 'teacher') {
    // Role split fix: this branch used to be missing, so a teacher fell into
    // the student branch, DB.students.findIndex() returned -1, and
    // `if (stIdx < 0) return;` silently discarded the change with no error
    // shown. DB.admin isn't safe to write into here either (shared record,
    // possibly a different staff member) — update currentUser directly.
    if (currentUser.pass && currentUser.pass !== curPass) { showErr('Current password is incorrect.'); return; }
    currentUser.pass = newPass;
  } else {
    const stIdx = AppStore.getSlice(s => s.students || []).findIndex(s => s.id === currentUser.id);
    if (stIdx < 0) return;
    const _existing = AppStore.getSlice(s => (s.students||[])[stIdx]?.pass);
    if (_existing !== curPass) { showErr('Current password is incorrect.'); return; }
    AppStore.updateState(draft => {
      const s = (draft.students || [])[stIdx];
      if (s) s.pass = newPass;
    }, { type: 'profile:password-changed', payload: { studentId: currentUser.id } });
    currentUser = AppStore.getStudent(currentUser.id);
  }


  // Clear the fields
  ['prof-cur-pass','prof-new-pass','prof-conf-pass'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  toast('🔒 Password changed successfully!', '#4edea3');
}

/* ── Save: Email ── */

function saveEmail() {
  const errEl = document.getElementById('prof-email-err');
  if (errEl) errEl.style.display = 'none';
  const email = (document.getElementById('prof-email')?.value || '').trim();

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errEl) { errEl.textContent = 'Please enter a valid email address.'; errEl.style.display = 'block'; }
    return;
  }

  // Check duplicate email (among students)
  if (email) {
    const duplicate = AppStore.getSlice(s => s.students || []).find(s => s.id !== currentUser.id && s.email === email);
    if (duplicate) {
      if (errEl) { errEl.textContent = 'That email is already in use by another account.'; errEl.style.display = 'block'; }
      return;
    }
  }

  const stIdx = AppStore.getSlice(s => s.students || []).findIndex(s => s.id === currentUser.id);
  if (stIdx < 0) return;
  AppStore.updateState(draft => {
    const s = (draft.students || [])[stIdx];
    if (s) s.email = email;
  }, { type: 'profile:email-saved', payload: { studentId: currentUser.id } });
  currentUser = AppStore.getStudent(currentUser.id);
  toast('✉️ Email saved!', '#4edea3');
}

/* ── Profile picture upload ── */

// Staged picture change — null means "no pending change", '' means "pending removal", dataUrl means "pending new pic"
let _profPendingPic = null;

function handleProfilePicUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('⚠️ Please select an image file.', '#ffb4ab'); event.target.value = ''; return; }
  if (file.size > 2 * 1024 * 1024) { toast('⚠️ Image must be under 2 MB.', '#ffb4ab'); event.target.value = ''; return; }

  const reader = new FileReader();
  reader.onload = function(e) {
    _profPendingPic = e.target.result; // stage — do NOT save to DB yet

    // Update the preview inside the edit tab only
    const preview = document.querySelector('#prof-pic-section .profile-pic-preview');
    if (preview) {
      preview.innerHTML = `<img src="${_profPendingPic}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:50%;" onerror="this.remove()">`;
    }

    // Show the Remove button if it wasn't there
    const actions = document.querySelector('#prof-pic-section .profile-pic-actions');
    if (actions && !actions.querySelector('.prof-remove-btn')) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-sm prof-remove-btn';
      removeBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">delete</span> Remove Photo';
      removeBtn.onclick = removeProfilePic;
      actions.appendChild(removeBtn);
    }

    // Show unsaved indicator
    _profShowPicUnsaved(true);
    event.target.value = '';
  };
  reader.readAsDataURL(file);
}

function removeProfilePic() {
  _profPendingPic = ''; // stage removal — '' means clear it on save

  // Update preview to show initials
  const user = profGetCurrent();
  const preview = document.querySelector('#prof-pic-section .profile-pic-preview');
  if (preview) {
    preview.innerHTML = `<span style="font-family:var(--fh);font-weight:900;font-size:18px;color:${user.color||'var(--primary)'}">${user.init||'?'}</span>`;
  }

  // Hide remove button
  const removeBtn = document.querySelector('#prof-pic-section .prof-remove-btn');
  if (removeBtn) removeBtn.remove();

  // Show unsaved indicator
  _profShowPicUnsaved(true);
}

function _profShowPicUnsaved(show) {
  // Adds/removes a small "unsaved" note near the picture section
  let note = document.getElementById('prof-pic-unsaved-note');
  if (show) {
    if (!note) {
      note = document.createElement('div');
      note.id = 'prof-pic-unsaved-note';
      note.style.cssText = 'font-size:11px;color:#ffb95f;margin-top:6px;display:flex;align-items:center;gap:4px;';
      note.innerHTML = '<span class="material-symbols-outlined" style="font-size:13px">info</span> Photo change not saved yet — click Save Changes below.';
      const picSection = document.getElementById('prof-pic-section');
      if (picSection) picSection.after(note);
    }
  } else {
    if (note) note.remove();
    _profPendingPic = null;
  }
}

/* ── Small utilities ── */
// _esc() is defined in utils.js (loaded as <script src> before this inline block).

function _makeInit(firstName, lastName, displayName) {
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  if (displayName) return displayName.slice(0, 2).toUpperCase();
  return '??';
}

/* ── Wire topbar avatar click to open profile ── */

document.getElementById('topbar-av').addEventListener('click', openProfile);

/* END PROFILE SYSTEM */
// ─────────────────────────────────────────────────────────────────────────────
// EXPOSE GLOBALS
// ─────────────────────────────────────────────────────────────────────────────
window.achUpdateSidebarBadge = achUpdateSidebarBadge;
window.achGrantRewardsForClaim = achGrantRewardsForClaim;
// NOTE (Phase 3 Day 1): the 8 window.mailX = mailX aliases formerly listed
// here are now provided by modules/mail/index.js, loaded earlier in the
// script chain (see <script src> block near the top of this file).

// Phase 7 (2026-08-10, session 2): the 17 lines below were previously
// implicit globals — bare top-level function declarations in this same
// inline <script> block, reachable from onclick="..." handlers (both
// static markup elsewhere in this file and dynamically-generated markup
// in other modules) purely via classic-script behavior. Made explicit
// ahead of any real module/bundle scoping change — see
// PHASE7_IMPLICIT_GLOBALS.md.
window.startQuiz = startQuiz;
window.useHint = useHint;
window.submitIdAnswer = submitIdAnswer;
window.submitEnumAnswer = submitEnumAnswer;
window.submitMatchAnswer = submitMatchAnswer;
window.quizNext = quizNext;
window.quizPrev = quizPrev;
window.confirmAbortQuiz = confirmAbortQuiz;
window.closeProfile = closeProfile;
window.profileOverlayClick = profileOverlayClick;
window.profileAvatarClick = profileAvatarClick;
window.switchProfileTab = switchProfileTab;
window.saveProfileEdit = saveProfileEdit;
window.savePassword = savePassword;
window.saveEmail = saveEmail;
window.handleProfilePicUpload = handleProfilePicUpload;
window.removeProfilePic = removeProfilePic;

// Phase 7 (2026-08-10, session 7): explicit window exports — previously
// implicit globals in this inline block, found by
// build/audit-window-exports.js (which checks every symbol with a real
// cross-file consumer, not just onclick-markup-reachable ones like the
// session 2 pass above). See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.renderStudentDashboard = renderStudentDashboard;
window.refreshAllAvatars = refreshAllAvatars;
window.activeQuiz = activeQuiz;
window.quizFinishing = quizFinishing;
window.abortQuiz = abortQuiz;
window.renderStudentQuizzes = renderStudentQuizzes;
window.quizTimer = quizTimer;
window.profInitAll = profInitAll;
window.profGetCurrent = profGetCurrent;
window._profRenderHero = _profRenderHero;
window._profRenderStats = _profRenderStats;

console.log('[EduQuest] Reward Presentation System, Achievement Claim System, and Mail System loaded.');
