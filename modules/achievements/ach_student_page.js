// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/achievements/student-page.js
//  Student Achievements (Badges) page: renderBadges, achClaimReward.
//
//  DEPENDENCY: ACH_RARITY, ACH_RARITIES, ACH_TRIGGER_TYPES, achRarityClass,
//              achGrantRewardsForClaim, achUpdateSidebarBadge (engine.js).
//              eqRewardPresent — typeof guard (reward presenter module).
//              tsUnlockTitleForStudent — typeof guard (titles module, Day 8).
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level filter/search state (mirrors window.* used by onclick handlers)
// Note: these are read/written via window._achTab etc in onclick strings.

/**
 * renderBadges() → void  [window.renderBadges]
 *
 * Renders the student "Achievements" page into #s-badges.
 * Reads filter state from: window._achTab, window._achFilter,
 *                          window._achRarityFilter, window._achSearch
 *
 * Tabs: All Badges | 🎁 Unclaimed | ✅ Claimed | 🔒 Locked
 * Filters: category tabs, rarity tabs, search input
 * Each .ach-badge-card shows: rarity strip, icon, name, rarity tag, desc,
 *   unclaimed → CLAIM button; claimed → stamp + reward chips; locked → greyed rewards
 *
 * Calls achUpdateSidebarBadge() after render.
 */
window.renderBadges = function () {
  const st = currentUser;
  if (!st) return;
  DB = loadDB();

  const unlocks     = (DB.achievementUnlocks || {})[st.id] || [];
  const unlockedIds = new Set(unlocks.map(u => u.achId));

  // Phase 16 (closing the deferred gap noted in ach_admin_page.js): a badge
  // with no rows in achievementSectionAssignments is unassigned → visible to
  // everyone, same "opt-in scoping" semantics as everywhere else sections
  // gate content in this app. A badge assigned to one or more sections is
  // only shown to students in one of those sections. Already-unlocked badges
  // stay visible regardless (an assignment change after the fact shouldn't
  // make an earned badge disappear from a student's own collection).
  const sectionAssignments = DB.achievementSectionAssignments || {};
  const myClassId          = st.classId || 'default-class';
  const inMySection = (ach) => {
    const assigned = sectionAssignments[ach.id];
    return !assigned || assigned.length === 0 || assigned.includes(myClassId);
  };

  const allAchs     = (DB.achievements || []).filter(a => a.active && (inMySection(a) || unlockedIds.has(a.id)));
  const visibleAchs = allAchs.filter(a => !a.isHidden || unlockedIds.has(a.id));
  const earned      = allAchs.filter(a => unlockedIds.has(a.id));

  const unclaimedAchs = earned.filter(a => { const u = unlocks.find(x => x.achId === a.id); return u && !u.claimed; });
  const claimedAchs   = earned.filter(a => { const u = unlocks.find(x => x.achId === a.id); return u &&  u.claimed; });
  const completionPct = allAchs.length ? Math.round(earned.length / allAchs.length * 100) : 0;

  const rarityOrder = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
  let rarestBadge = null;
  for (const r of rarityOrder) { const f = earned.find(a => a.rarity === r); if (f) { rarestBadge = f; break; } }

  const activeFilter = window._achFilter       || 'all';
  const activeRarity = window._achRarityFilter || 'all';
  const activeTab    = window._achTab           || 'all';
  const searchQ      = (window._achSearch       || '').toLowerCase();

  let displayed = visibleAchs;
  if (activeFilter !== 'all') displayed = displayed.filter(a => a.category === activeFilter);
  if (activeRarity !== 'all') displayed = displayed.filter(a => a.rarity   === activeRarity);
  if (searchQ)                displayed = displayed.filter(a => a.name.toLowerCase().includes(searchQ) || (a.description || '').toLowerCase().includes(searchQ));
  if (activeTab === 'unclaimed') displayed = displayed.filter(a => unclaimedAchs.some(u => u.id === a.id));
  else if (activeTab === 'claimed') displayed = displayed.filter(a => claimedAchs.some(u => u.id === a.id));
  else if (activeTab === 'locked')  displayed = displayed.filter(a => !unlockedIds.has(a.id));

  const categories = [...new Set(allAchs.map(a => a.category).filter(Boolean))];
  const catTabs    = [{ key: 'all', label: 'All' }, ...categories.map(c => ({ key: c, label: c }))];
  const rarityTabs = [{ key: 'all', label: 'All Rarities' }, ...ACH_RARITIES.map(r => ({ key: r, label: r }))];

  document.getElementById('s-badges').innerHTML = `
  <div class="page-hero"><div class="page-hero-bg"></div><div style="position:relative;z-index:1">
    <div class="page-hero-label">🏅 Achievements</div>
    <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Your Achievements</h1>
    <p style="font-size:14px;color:var(--text-muted)"><span style="color:var(--tertiary);font-weight:700">${earned.length}</span> / ${allAchs.length} badges unlocked</p>
  </div></div>

  ${unclaimedAchs.length > 0 ? `
  <div style="background:linear-gradient(135deg,rgba(208,188,255,0.12),rgba(139,92,246,0.08));border:1px solid rgba(208,188,255,0.3);border-radius:16px;padding:18px 20px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:44px;height:44px;border-radius:12px;background:rgba(208,188,255,0.15);border:1px solid rgba(208,188,255,0.3);display:flex;align-items:center;justify-content:center;font-size:22px;animation:achBadgePulse 2s ease-in-out infinite">🎁</div>
      <div>
        <div style="font-family:var(--fh);font-size:15px;font-weight:900;color:var(--primary)">${unclaimedAchs.length} Reward${unclaimedAchs.length > 1 ? 's' : ''} Ready to Claim</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Claim your achievement rewards before they expire!</div>
      </div>
    </div>
    <button class="btn btn-primary" onclick="window._achTab='unclaimed';renderBadges()" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9)">🎁 View Unclaimed</button>
  </div>` : ''}

  <div class="ach-stats-bar">
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--primary)">${earned.length}</div><div class="ach-stat-lbl">Earned</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:${unclaimedAchs.length > 0 ? '#EC4899' : 'var(--secondary)'}"><span style="animation:${unclaimedAchs.length > 0 ? 'achBadgePulse 2s ease-in-out infinite' : 'none'};display:inline-block">${unclaimedAchs.length}</span></div><div class="ach-stat-lbl">Unclaimed</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--secondary)">${completionPct}%</div><div class="ach-stat-lbl">Completion</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val">${rarestBadge ? `<span style="font-size:18px">${rarestBadge.icon}</span>` : '<span style="color:var(--text-muted)">—</span>'}</div><div class="ach-stat-lbl">Rarest Badge</div></div>
  </div>

  <!-- STATUS TABS -->
  <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:20px;overflow-x:auto">
    ${[
      { key: 'all',      label: 'All Badges',    count: allAchs.length },
      { key: 'unclaimed',label: '🎁 Unclaimed',  count: unclaimedAchs.length, accent: unclaimedAchs.length > 0 },
      { key: 'claimed',  label: '✅ Claimed',     count: claimedAchs.length },
      { key: 'locked',   label: '🔒 Locked',      count: allAchs.length - earned.length },
    ].map(t => `<button class="ach-filter-btn ${activeTab === t.key ? 'active' : ''}" style="padding:10px 16px;border-radius:0;border-bottom:2px solid ${activeTab === t.key ? (t.accent ? '#EC4899' : 'var(--primary-dark)') : 'transparent'};background:none;${activeTab === t.key && t.accent ? 'color:#EC4899' : ''}" onclick="window._achTab='${t.key}';renderBadges()">
      ${t.label}${t.count > 0 ? ` <span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(255,255,255,.08);margin-left:4px">${t.count}</span>` : ''}
    </button>`).join('')}
  </div>

  <div class="section-header"><span class="material-symbols-outlined">workspace_premium</span><h2>Badge Collection</h2></div>
  <div class="ach-filter-bar">
    <input class="ach-search-input" type="text" placeholder="🔍 Search badges..." value="${_esc(window._achSearch || '')}" oninput="window._achSearch=this.value;renderBadges()" style="max-width:200px">
    <div style="display:flex;gap:6px;flex-wrap:wrap">${catTabs.map(t => `<button class="ach-filter-btn${activeFilter === t.key ? ' active' : ''}" onclick="window._achFilter='${t.key}';renderBadges()">${_esc(t.label)}</button>`).join('')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${rarityTabs.map(t => `<button class="ach-filter-btn${activeRarity === t.key ? ' active' : ''}" style="font-size:10px" onclick="window._achRarityFilter='${t.key}';renderBadges()">${_esc(t.label)}</button>`).join('')}</div>
  </div>

  ${displayed.length === 0 ? '<div style="text-align:center;color:var(--text-muted);padding:60px 0;font-size:14px">No badges found for these filters.</div>' : ''}
  <div class="badges-grid">
    ${displayed.map(ach => {
      const isUnlocked  = unlockedIds.has(ach.id);
      const unlockRec   = unlocks.find(u => u.achId === ach.id);
      const isClaimed   = unlockRec && unlockRec.claimed;
      const isUnclaimed = isUnlocked && !isClaimed;
      const rarity      = ACH_RARITY[ach.rarity] || ACH_RARITY.Common;
      const isHiddenLocked = ach.isHidden && !isUnlocked;
      const rewardChips = (
        ((ach.xpReward   || 0) > 0 ? `<span class="ach-reward-chip" style="color:#c4b5fd;border-color:rgba(196,181,253,${isUnlocked ? '0.3' : '0.15'})">+${ach.xpReward} XP</span>` : '') +
        ((ach.coinReward || 0) > 0 ? `<span class="ach-reward-chip" style="color:#ffb95f;border-color:rgba(255,185,95,${isUnlocked ? '0.3' : '0.15'})">+${ach.coinReward} 🪙</span>` : '')
      );
      return `<div class="ach-badge-card ${isUnclaimed ? 'ach-unclaimed ' : isUnlocked ? '' : 'ach-locked ' + (isHiddenLocked ? 'ach-hidden-locked' : '')}" style="${isUnlocked ? `box-shadow:0 0 20px ${rarity.glow}${isUnclaimed ? ',0 0 0 2px ' + rarity.color + '66' : ''};border-color:${rarity.color}${isUnclaimed ? '' : '44'}` : ''}" title="${isHiddenLocked ? '???' : _esc(ach.description)}">
        <div class="ach-rarity-strip" style="background:${rarity.strip}"></div>
        ${isUnclaimed ? `<div class="ach-unclaimed-glow" style="background:radial-gradient(circle at 50% 0%,${rarity.color}22,transparent 70%)"></div>` : ''}
        <div class="ach-badge-icon-wrap">${isHiddenLocked ? '❓' : (ach.icon || '🏅')}</div>
        <div class="ach-badge-title ${achRarityClass(ach.rarity)}">${isHiddenLocked ? 'Hidden Achievement' : _esc(ach.name)}</div>
        <span class="ach-rarity-tag ${achRarityClass(ach.rarity)}">${ach.rarity}</span>
        ${isHiddenLocked
          ? '<div class="ach-badge-desc">Complete certain actions to reveal...</div>'
          : `<div class="ach-badge-desc">${_esc(ach.description || '')}</div>`}
        ${isUnclaimed
          ? `<div class="ach-unclaimed-label">🎁 READY TO CLAIM</div>
             <div class="ach-reward-chips">${rewardChips}</div>
             <button class="ach-claim-btn" onclick="achClaimReward('${ach.id}')" style="background:linear-gradient(135deg,${rarity.strip},${rarity.color})">Claim Reward →</button>`
          : isUnlocked
          ? `<div class="ach-unlocked-stamp">✓ CLAIMED ${new Date(unlockRec.claimedAt || unlockRec.unlockedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
             <div class="ach-reward-chips">${rewardChips}</div>`
          : `<div class="ach-reward-chips">${rewardChips}</div>`}
      </div>`;
    }).join('')}
  </div>`;

  achUpdateSidebarBadge();
};

// ── Claim reward ──────────────────────────────────────────────────────────────

/**
 * achClaimReward(achId) → void  [window.achClaimReward]
 *
 * Student-facing claim action. Guards: must be student + achievement must be unclaimed.
 * If eqRewardPresent is available, shows the Universal Reward Presentation.
 * Otherwise falls back to toast + renderBadges().
 * Calls tsUnlockTitleForStudent for any linked title (typeof guard).
 * Calls renderStudentDashboard after close (typeof guard).
 */
window.achClaimReward = function (achId) {
  if (!currentUser || currentRole !== 'student') return;
  DB = loadDB();
  const ach      = (DB.achievements || []).find(a => a.id === achId);
  if (!ach) return;
  const unlocks  = (DB.achievementUnlocks || {})[currentUser.id] || [];
  const rec      = unlocks.find(u => u.achId === achId);
  if (!rec || rec.claimed) { toast('This achievement has already been claimed.', '#ffb4ab'); return; }

  // Fallback: no reward presenter yet
  const _present = typeof eqRewardPresent === 'function' ? eqRewardPresent
                 : typeof window.eqRewardPresent === 'function' ? window.eqRewardPresent
                 : null;
  if (!_present) {
    achGrantRewardsForClaim(currentUser.id, achId);
    toast('🏅 ' + ach.name + ' claimed!', '#d0bcff');
    renderBadges();
    return;
  }

  // Build reward list
  const rewards = [];
  if ((rec.xpGranted   || 0) > 0) rewards.push({ type: 'xp',    amount: rec.xpGranted,   icon: '⚡',          label: 'XP',    color: 'var(--primary)'  });
  if ((rec.coinsGranted|| 0) > 0) rewards.push({ type: 'coins', amount: rec.coinsGranted, icon: '🪙',          label: 'Coins', color: 'var(--tertiary)' });

  // Check for linked title
  const linkedTitle = (DB.titles || []).find(t => t.achievementId === achId && t.active);
  if (linkedTitle) rewards.push({ type: 'title', amount: 1, icon: linkedTitle.icon || '🎖️', label: linkedTitle.name, color: '#EC4899', titleId: linkedTitle.id });

  // Grant rewards
  const granted = achGrantRewardsForClaim(currentUser.id, achId);
  if (granted === false) return;

  // Grant linked title — typeof guard (titles module, Day 8)
  if (linkedTitle && typeof tsUnlockTitleForStudent === 'function') {
    tsUnlockTitleForStudent(currentUser.id, linkedTitle.id, false);
  }

  _present({
    title:    'Achievement Claimed!',
    subtitle: ach.name,
    icon:     ach.icon || '🏅',
    rarity:   ach.rarity || 'Common',
    source:   'achievement',
    rewards,
    onClose: () => {
      renderBadges();
      if (typeof renderStudentDashboard === 'function') renderStudentDashboard();
    },
  });
};

console.log('[EduQuest] achievements/student-page.js loaded — renderBadges, achClaimReward registered.');
