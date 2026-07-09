// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/loot-rain.js
//  World Boss Loot Rush: reward definitions, claim tracking, student loot page,
//  rain-token animations, admin settings, finalize, summary overlay.
//  LOAD AFTER: combat-settings.js
// ═══════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────

window.WBLR_RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
window.WBLR_RARITY_META = {
  common:    { color: '#cbd5e1', icon: 'redeem'             },
  rare:      { color: '#38bdf8', icon: 'diamond'            },
  epic:      { color: '#c084fc', icon: 'auto_awesome'       },
  legendary: { color: '#ffb95f', icon: 'workspace_premium'  },
  mythic:    { color: '#fb7185', icon: 'stars'              },
};

// ── Rarity helpers ────────────────────────────────────────────────────────────

function wblrEsc(v) { return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch]); }

window.wblrRarityKey   = function (r) { const k = String(r||'Common').toLowerCase(); return WBLR_RARITIES.map(x=>x.toLowerCase()).includes(k) ? k : 'common'; };
window.wblrRarityLabel = function (r) { const k = wblrRarityKey(r); return k.charAt(0).toUpperCase() + k.slice(1); };
window.wblrRarityMeta  = function (r) { return WBLR_RARITY_META[wblrRarityKey(r)] || WBLR_RARITY_META.common; };

// ── Default & normalize rewards ───────────────────────────────────────────────

window.wblrDefaultRewards = function () {
  return [
    { id: uid(), itemName: 'Golden Voucher',  quantity: 5,  rarity: 'Rare',      claimLimit: 1 },
    { id: uid(), itemName: 'XP Booster',      quantity: 10, rarity: 'Epic',      claimLimit: 2 },
    { id: uid(), itemName: 'Coins',            quantity: 20, rarity: 'Common',    claimLimit: 3 },
    { id: uid(), itemName: 'Legendary Badge', quantity: 1,  rarity: 'Legendary', claimLimit: 1 },
  ];
};

window.wblrNormalizeRewards = function (rewards) {
  return (rewards || []).map((r, i) => ({
    id:         r.id    || uid(),
    itemName:   String(r.itemName || r.name || `Reward ${i + 1}`).trim(),
    quantity:   Math.max(0, parseInt(r.quantity ?? r.quantityAvailable ?? r.qty) || 0),
    rarity:     wblrRarityLabel(r.rarity || 'Common'),
    claimLimit: Math.max(1, parseInt(r.claimLimit) || 1),
  })).filter(r => r.itemName && r.quantity > 0);
};

window.wblrRewards = function (boss) {
  if (!boss.lootRewards || !boss.lootRewards.length) boss.lootRewards = wblrDefaultRewards();
  boss.lootRewards = wblrNormalizeRewards(boss.lootRewards);
  return boss.lootRewards;
};

window.wblrClaims          = function (boss)               { if (!boss.lootClaims) boss.lootClaims = []; return boss.lootClaims; };
window.wblrClaimCount      = function (boss, rewardId)     { return wblrClaims(boss).filter(c => c.rewardId === rewardId).length; };
window.wblrRemaining       = function (boss, reward)       { return Math.max(0, (parseInt(reward.quantity) || 0) - wblrClaimCount(boss, reward.id)); };
window.wblrRemainingTotal  = function (boss)               { return wblrRewards(boss).reduce((a, r) => a + wblrRemaining(boss, r), 0); };
window.wblrClaimedByStudent = function (boss, rewardId, studentId) { return wblrClaims(boss).filter(c => c.rewardId === rewardId && c.studentId === studentId).length; };
window.wblrLootSummary     = function (boss) {
  const rewards = wblrRewards(boss);
  const total   = rewards.reduce((a, r) => a + (parseInt(r.quantity) || 0), 0);
  const claimed = wblrClaims(boss).length;
  return { total, claimed, remaining: Math.max(0, total - claimed), items: rewards.length };
};

// ── Boss activation / loot-rush prep ─────────────────────────────────────────

window.wblrPrepareLootRush = async function (boss, bossIdx) {
  if (!boss) return;
  const result = LootService.prepareLootRush(bossIdx);
  if (result.ok && !result.alreadyActive) {
    if (typeof wblrStartRealtime === 'function') wblrStartRealtime(bossIdx);
  }
  // Phase 25: start_loot_rush() is the authoritative atomic guard against
  // multiple students triggering the loot rush at once (each observes
  // currentHp <= 0 and calls this near-simultaneously) — the local
  // `alreadyActive` check above only sees this tab's own snapshot, not
  // the server's real state. Same "local optimistic update + explicit
  // RPC call" shape as start_boss_event()/end_boss_event() (Phase 24).
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function' && boss._id) {
    try {
      const { data, error } = await DBService.rpc('start_loot_rush', {
        p_boss_id: boss._id, p_class_id: boss.classId || 'default-class',
      });
      if (error) {
        console.warn('[EduQuest] start_loot_rush RPC failed, keeping local optimistic state:', error);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.loot_started_at) {
          const serverTs = new Date(row.loot_started_at).getTime();
          AppStore.updateState(function (draft) {
            const b = draft.bossEvents[bossIdx];
            if (b) b.lootStartedAt = serverTs;
          }, { type: 'loot:rush-started-synced', payload: { bossIdx: bossIdx } });
        }
      }
    } catch (e) {
      console.warn('[EduQuest] start_loot_rush RPC threw, keeping local optimistic state:', e);
    }
  }
};

// Phase 25: shared finalize sync — called from every place that actually
// performs a finalize transition (wblrFinalizeLoot, wblrAdminFinalizeLoot,
// and the maybeAutoFinalize call sites in wblrClaimReward/
// wblrMaybeAutoFinalize/perceived-speed.js's optimistic claim path), since
// finalizeLoot() has no single choke point the way apply_boss_damage()
// does for damage. Only fires the RPC when a transition actually happened
// this call (not on every poll/claim), to avoid spamming Supabase.
window.wblrSyncFinalizeLootRpc = async function (bossIdx) {
  const boss = AppStore.getBossEvent(bossIdx);
  if (!boss || !boss._id) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;
  try {
    const { error } = await DBService.rpc('finalize_loot_rush', {
      p_boss_id: boss._id, p_class_id: boss.classId || 'default-class',
    });
    if (error) console.warn('[EduQuest] finalize_loot_rush RPC failed:', error);
  } catch (e) {
    console.warn('[EduQuest] finalize_loot_rush RPC threw:', e);
  }
};

// Phase 44: claim_loot_reward() RPC sync — fired right after
// LootService.claimReward() commits the local optimistic claim. Same "local
// optimistic update + explicit RPC call" shape as wblrPrepareLootRush()/
// wblrSyncFinalizeLootRpc() above. Unlike those, a definitive rejection here
// (the local remaining/limit check raced and lost — the reward really was
// gone or the limit really was hit by the time the RPC's row lock resolved
// it) rolls the local claim back instead of just logging a warning, since
// leaving a phantom claim in local state would show the student loot they
// don't actually have. A network/RPC-layer failure (no definitive answer)
// is left alone, same as every other fire-and-forget sync call in this
// file — worst case it's retried on next claim/finalize, same tradeoff
// start_loot_rush()/finalize_loot_rush() already accept.
window.wblrSyncClaimRewardRpc = async function (bossIdx, rewardId, claim) {
  const boss = AppStore.getBossEvent(bossIdx);
  if (!boss || !boss._id) return;
  if (typeof DBService === 'undefined' || typeof DBService.rpc !== 'function') return;
  try {
    const { data, error } = await DBService.rpc('claim_loot_reward', {
      p_boss_id: boss._id, p_class_id: boss.classId || 'default-class',
      p_reward_id: rewardId, p_student_id: claim.studentId,
      p_student_name: claim.studentName, p_student_init: claim.studentInit,
      p_student_color: claim.studentColor, p_claim_id: claim.id,
    });
    if (error) {
      console.warn('[EduQuest] claim_loot_reward RPC failed, keeping local optimistic state:', error);
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (result && !result.ok) {
      LootService.rollbackClaim(bossIdx, claim.id, claim.studentId);
      const freshBoss = AppStore.getBossEvent(bossIdx);
      if (typeof wblrRefreshLootHud === 'function') wblrRefreshLootHud(bossIdx, freshBoss);
      if (typeof wblrSyncRainTokens === 'function') wblrSyncRainTokens(bossIdx, freshBoss);
      if (typeof updateTopbar === 'function') updateTopbar();
      if (typeof toast === 'function') {
        toast('⚠️ ' + (result.reason || 'That claim didn\'t go through — someone else got it first.'), '#ffb4ab');
      }
    }
  } catch (e) {
    console.warn('[EduQuest] claim_loot_reward RPC threw, keeping local optimistic state:', e);
  }
};

window.wblrGetCurrentLootBoss = function () {
  return LootService.getCurrentLootBoss();
};

window.wblrGetLatestSummaryBoss = function () {
  return LootService.getLatestSummaryBoss();
};

// ── Rain tokens ───────────────────────────────────────────────────────────────

window.wblrCreateLootToken = function (bossIdx, reward) {
  const token     = document.createElement('div');
  const meta      = wblrRarityMeta(reward.rarity);
  token.className = 'wblr-token wblr-rarity-' + wblrRarityKey(reward.rarity);
  token.style.cssText = `--rarity-color:${meta.color};left:${5 + Math.random() * 80}%;animation-duration:${2.2 + Math.random() * 1.8}s;animation-delay:${Math.random() * 0.8}s`;
  token.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;color:${meta.color}">${meta.icon}</span><span class="wblr-token-name">${wblrEsc(reward.itemName)}</span>`;
  token.setAttribute('data-reward-id', reward.id);
  token.setAttribute('data-boss-idx', bossIdx);
  token.addEventListener('click', function () { window.wblrClaimReward(bossIdx, reward.id, this); });
  return token;
};

window.wblrSyncRainTokens = function (bossIdx, boss) {
  // We no longer call loadDB() here. We rely on the 'boss' object passed as an argument.
  const container = document.getElementById('wblr-rain-container'); 
  if (!container || !boss) return;

  const rewards = wblrRewards(boss).filter(r => wblrRemaining(boss, r) > 0);
  const current = container.querySelectorAll('.wblr-token:not(.claimed)');
  
  if (current.length < 8 && rewards.length > 0) {
    const reward = rewards[Math.floor(Math.random() * rewards.length)];
    container.appendChild(wblrCreateLootToken(bossIdx, reward));
  }
  
  container.querySelectorAll('.wblr-token').forEach(t => {
    const rect = t.getBoundingClientRect();
    if (rect.top > window.innerHeight + 20) t.remove();
  });
};

window.wblrRefreshLootHud = function (bossIdx, boss) {
  // We no longer call loadDB(). We use the 'boss' passed from the parent.
  const hud = document.getElementById('wblr-hud'); 
  if (!hud || !boss) return;

  const loot = wblrLootSummary(boss);
  const timerEl = document.getElementById('wblr-timer-display');
  
  if (timerEl && boss.lootStartedAt) {
    const elapsed  = Math.floor((Date.now() - boss.lootStartedAt) / 1000);
    const remaining = Math.max(0, (boss.lootDuration || 120) - elapsed);
    const m = Math.floor(remaining / 60), s = remaining % 60;
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    timerEl.style.color = remaining < 30 ? '#f87171' : '#4edea3';
  }
  
  const rem = document.getElementById('wblr-remaining');
  if (rem) rem.textContent = loot.remaining + ' items left';
};

// ── Claim flow ────────────────────────────────────────────────────────────────

window.wblrClaimReward = function (bossIdx, rewardId, tokenEl) {
  if (currentRole !== 'student' || !currentUser) return;

  const result = LootService.claimReward(bossIdx, rewardId, currentUser);

  if (!result.ok) {
    if (result.reason && result.reason.includes('already gone')) {
      tokenEl?.classList.add('claimed');
      setTimeout(() => tokenEl?.remove(), 220);
    }
    toast(result.reason || 'Cannot claim reward.', '#ffb4ab');
    return;
  }

  const meta = wblrRarityMeta(result.reward.rarity);
  tokenEl?.classList.add('claimed');
  setTimeout(() => tokenEl?.remove(), 220);
  toast('Claimed ' + result.reward.itemName + '!', meta.color);

  // [OPT-2] Read only the one boss event for the HUD refresh
  const boss = AppStore.getBossEvent(bossIdx);
  wblrRefreshLootHud(bossIdx, boss);
  if (typeof wblrSyncRainTokens === 'function') wblrSyncRainTokens(bossIdx, boss);
  if (typeof updateTopbar === 'function') updateTopbar();

  // Phase 44: persist the claim server-side (local commit above was
  // optimistic-only until now — see wblrSyncClaimRewardRpc for the
  // rollback-on-definitive-rejection handling).
  if (typeof wblrSyncClaimRewardRpc === 'function') wblrSyncClaimRewardRpc(bossIdx, rewardId, result.claim);

  const autoFinalizeResult = LootService.maybeAutoFinalize(bossIdx);
  if (autoFinalizeResult.finalized) wblrSyncFinalizeLootRpc(bossIdx);
};

window.wblrStartRealtime = function (bossIdx) {
  if (currentRole !== 'student') return;
  wblrStopLootTimers();

  let _interval = setInterval(() => {
    // [OPT-2] Clone only the one boss event — ~2 KB, not ~200 KB
    const boss = AppStore.getBossEvent(bossIdx);
    if (!boss || boss.status !== 'loot') return;

    // Now we pass the 'boss' object into our helpers
    wblrSyncRainTokens(bossIdx, boss);
    wblrRefreshLootHud(bossIdx, boss);
    wblrMaybeAutoFinalize(bossIdx, boss); 
  }, 1000);

  window._wblrStopTimers = () => { clearInterval(_interval); window._wblrStopTimers = null; };
};

window.wblrStopLootTimers = function () { if (typeof window._wblrStopTimers === 'function') window._wblrStopTimers(); };

window.wblrMaybeAutoFinalize = function (bossIdx) {
  const result = LootService.maybeAutoFinalize(bossIdx);
  if (result.finalized) {
    wblrStopLootTimers();
    wblrSyncFinalizeLootRpc(bossIdx);
    if (currentRole === 'student') {
      setTimeout(() => wblrRenderFinalSummaryPage(bossIdx), 800);
    }
  }
};

window.wblrFinalizeLoot = function (bossIdx, source) {
  const result = LootService.finalizeLoot(bossIdx, source);
  if (result.ok && !result.alreadyFinalized) {
    wblrStopLootTimers();
    wblrSyncFinalizeLootRpc(bossIdx);
    if (currentRole === 'student') {
      setTimeout(() => wblrRenderFinalSummaryPage(bossIdx), 800);
    }
  }
};

window.wblrAdminFinalizeLoot = function (bossIdx) {
  const result = LootService.finalizeLoot(bossIdx, 'manual');
  closeModalForce();
  toast('✅ Loot rush finalized!', '#4edea3');
  renderAdminBossEvents();
  if (result.ok && !result.alreadyFinalized) wblrSyncFinalizeLootRpc(bossIdx);
};

// ── Loot rain overlay (student page) ─────────────────────────────────────────

window.wblrShowLootRain = function (bossIdx) {
  if (currentRole !== 'student') return;

  // [OPT-2] Read only the one boss event
  const boss = AppStore.getBossEvent(bossIdx);
  if (!boss || boss._lootRainShown) return;

  LootService.markLootRainShown(bossIdx);

  const overlay = document.getElementById('campaign-overlay');
  if (overlay && overlay.classList.contains('open')) {
    if (typeof wblrShowInOverlayLoot === 'function') {
      wblrShowInOverlayLoot(bossIdx, () => renderStudentWorldBoss());
    }
    return;
  }
  const wbPage = document.getElementById('s-world-boss');
  if (wbPage && !wbPage.classList.contains('active')) {
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.remove('active');
      b.style.background = 'none';
      b.style.color = 'var(--text-muted)';
    });
    const btn = document.getElementById('nav-s-world-boss');
    if (btn) {
      btn.classList.add('active');
      btn.style.background = 'rgba(208,188,255,0.12)';
      btn.style.color = 'var(--primary)';
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    if (wbPage) { wbPage.classList.add('active'); wbPage.scrollTop = 0; }
  }
  wblrRenderStudentLootPage(bossIdx);
};

// ── REWARD EXPLOSION SYSTEM (CBL — Combat Boss Loot) ──────────────────────────
// RESTORED: the previous wblrShowInOverlayLoot wiped out the ENTIRE campaign
// overlay (`overlay.innerHTML = ''`) and replaced it with a plain card list —
// destroying the static #camp-boss-loot / #cbl-battlefield / #cbl-boss-core /
// .cbl-shockwave markup that's already sitting in index.html waiting to be
// used. None of the original explosion helpers (_cblRewardEmoji,
// _cblBurstSlots, _cblCreateToken, _cblSpawnSparks, _cblRefreshHud,
// _cblFlashFeed) existed anywhere in the extracted codebase. Ported the whole
// system verbatim: boss portrait sits at the battlefield center, shockwave
// rings pulse outward, 40 spark particles burst from the core, and every
// reward token explodes outward along its own randomized ellipse trajectory
// before settling into a gentle float — exactly like the original.

/* Rarity → emoji icon map for overlay tokens */
const _CBL_RARITY_EMOJI = {
  common:    '🎁',
  rare:      '💎',
  epic:      '✨',
  legendary: '👑',
  mythic:    '🌟',
};
function _cblRewardEmoji(rarity) {
  return _CBL_RARITY_EMOJI[String(rarity || 'common').toLowerCase()] || '🎁';
}

/* Burst positions: tokens distributed around an ellipse centered in the viewport */
function _cblBurstSlots(count, cxFrac, cyFrac) {
  const slots = [];
  const containerW = window.innerWidth  || 800;
  const containerH = window.innerHeight || 600;
  // Ellipse radii — fill most of battlefield but clear the bottom HUD
  const rx = containerW * 0.38;
  const ry = containerH * 0.28;
  // Randomise rotation so no two boss defeats look the same
  const baseAngle = Math.random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (Math.PI * 2 * i / count);
    // Add some variance to avoid a perfectly uniform ring
    const rVariance = 0.62 + Math.random() * 0.52;
    const tx = Math.cos(angle) * rx * rVariance;
    const ty = Math.sin(angle) * ry * rVariance;
    // Final position is offset from boss center; token is positioned absolute from top-left
    const finalX = containerW * cxFrac + tx - 37; // 37 = half token width
    const finalY = containerH * cyFrac + ty - 32; // 32 = half token height
    // Clamp so tokens don't escape the panel
    slots.push({
      tx, ty,
      left: Math.max(4, Math.min(containerW - 82, finalX)),
      top:  Math.max(56, Math.min(containerH - 130, finalY)),
    });
  }
  return slots;
}

/* Create one clickable token DOM element */
function _cblCreateToken(bossIdx, reward, slotIdx, totalSlots, cxFrac, cyFrac, onClaimCallback) {
  const meta  = wblrRarityMeta(reward.rarity);
  const emoji = _cblRewardEmoji(reward.rarity);
  const slot  = _cblBurstSlots(totalSlots, cxFrac, cyFrac)[slotIdx];
  const delay = 0.25 + slotIdx * 0.055 + Math.random() * 0.1;
  const dur   = 0.55 + Math.random() * 0.25;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cbl-token wblr-rarity-' + wblrRarityKey(reward.rarity);
  btn.dataset.rewardId  = reward.id;
  btn.dataset.slotIndex = slotIdx;
  btn.style.cssText = [
    'left:50%', 'top:44%',
    '--rarity-color:' + meta.color,
    '--tx:' + (slot.left - window.innerWidth / 2 + 37) + 'px',
    '--ty:' + (slot.top  - window.innerHeight * 0.44 + 32) + 'px',
    '--burst-dur:' + dur + 's',
    '--burst-delay:' + delay + 's',
    '--spin-start:' + (Math.random() * 40 - 20) + 'deg',
    '--spin-end:'   + (Math.random() * 16 - 8)  + 'deg',
    '--float-delay:' + (Math.random() * 1.5) + 's',
  ].join(';');

  btn.innerHTML = `
    <span class="cbl-token-icon">${emoji}</span>
    <span class="cbl-token-name">${wblrEsc(reward.itemName)}</span>
    <span class="cbl-token-rarity">${wblrEsc(reward.rarity)}</span>`;

  // After burst animation: switch to gentle float
  btn.addEventListener('animationend', () => {
    if (!btn.classList.contains('claimed') && !btn.classList.contains('settled')) {
      btn.classList.add('settled');
      // Reposition to final slot coordinates so float CSS picks up correctly
      btn.style.left = slot.left + 'px';
      btn.style.top  = slot.top  + 'px';
      btn.style.setProperty('--tx', '0px');
      btn.style.setProperty('--ty', '0px');
    }
  }, { once: true });

  btn.addEventListener('click', function () {
    if (btn.classList.contains('claimed')) return;
    // Delegate to existing claim logic
    wblrClaimReward(bossIdx, reward.id, btn);
    if (onClaimCallback) onClaimCallback();
  });

  return btn;
}

/* Spawn spark particles from boss core */
function _cblSpawnSparks(battlefield) {
  const sparkColors = ['#ffb95f', '#EC4899', '#d0bcff', '#4edea3', '#f97316', '#ef4444', '#22d3ee'];
  const cx = window.innerWidth  * 0.5;
  const cy = window.innerHeight * 0.44;
  for (let i = 0; i < 40; i++) {
    const sp = document.createElement('div');
    sp.className = 'cbl-spark';
    const angle = Math.random() * Math.PI * 2;
    const dist  = 60 + Math.random() * 200;
    sp.style.cssText = [
      'left:' + cx + 'px',
      'top:'  + cy + 'px',
      '--spark-color:' + sparkColors[i % sparkColors.length],
      '--sx:' + (Math.cos(angle) * dist) + 'px',
      '--sy:' + (Math.sin(angle) * dist) + 'px',
      '--spark-dur:'   + (0.7 + Math.random() * 0.8) + 's',
      '--spark-delay:' + (Math.random() * 0.3) + 's',
    ].join(';');
    battlefield.appendChild(sp);
    setTimeout(() => sp.remove(), 1600);
  }
}

/* Refresh the HUD counters inside the overlay loot panel */
function _cblRefreshHud(bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss) return;
  const summary = wblrLootSummary(boss);
  const remEl = document.getElementById('cbl-remaining');
  const clmEl = document.getElementById('cbl-claimed-count');
  if (remEl) remEl.textContent = summary.remaining;
  if (clmEl) clmEl.textContent = summary.claimed;

  // Re-sync tokens: remove claimed ones that haven't been removed yet
  const field = document.getElementById('cbl-battlefield');
  if (field) {
    wblrRewards(boss).forEach(r => {
      if (wblrRemaining(boss, r) <= 0) {
        [...field.querySelectorAll(`[data-reward-id="${CSS.escape(r.id)}"]`)].forEach(el => {
          if (!el.classList.contains('claimed')) {
            el.classList.add('claimed');
            setTimeout(() => el.remove(), 220);
          }
        });
      }
    });
  }
}

/* Flash a claim message in the HUD feed */
function _cblFlashFeed(msg) {
  const feed = document.getElementById('cbl-feed');
  if (!feed) return;
  feed.textContent = msg;
  feed.style.animation = 'none';
  void feed.offsetWidth; // reflow
  feed.style.animation = '';
}

/* Main entry point — called from wbrShowBossVictory's continue button */
window.wblrShowInOverlayLoot = function (bossIdx, onDone) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss) { _wbvCloseOverlay(); if (onDone) onDone(); return; }
  // Pre-load idb: art before rendering so boss core shows Boss Studio image
  if (typeof bvePreloadBossArt === 'function') {
    bvePreloadBossArt(boss).then(() => _wblrShowInOverlayLootRender(bossIdx, onDone)).catch(() => _wblrShowInOverlayLootRender(bossIdx, onDone));
    return;
  }
  _wblrShowInOverlayLootRender(bossIdx, onDone);
};

function _wblrShowInOverlayLootRender(bossIdx, onDone) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss) { _wbvCloseOverlay(); if (onDone) onDone(); return; }

  // Prepare the boss for loot phase (status, timestamps, etc.)
  wblrPrepareLootRush(boss, bossIdx);
  saveDB();

  // Show the panel — uses the existing static markup in index.html, does NOT
  // destroy or rebuild the campaign overlay's innerHTML.
  if (typeof _wbvHideAllPanels === 'function') _wbvHideAllPanels();
  const panel = document.getElementById('camp-boss-loot');
  if (!panel) { _wbvCloseOverlay(); if (onDone) onDone(); return; }
  panel.style.display = 'flex';
  if (typeof wbrSetBg === 'function') wbrSetBg('#08051a');

  // ── Populate header
  const bossName = boss.name || 'World Boss';
  const bossImg  = boss.image || '💀';
  const titleEl  = document.getElementById('cbl-title');
  const subEl    = document.getElementById('cbl-sub');
  if (titleEl) titleEl.textContent = 'LOOT EXPLOSION!';
  if (subEl)   subEl.textContent   = bossName + ' has fallen — claim the spoils!';

  // ── Set boss core glyph — use BVE so Boss Studio art renders correctly
  const coreEl = document.getElementById('cbl-boss-core');
  if (coreEl) {
    if (typeof bveRenderBossArt === 'function') {
      const artHtml = bveRenderBossArt(boss, { stateClass: 'state-idle' });
      coreEl.innerHTML = `<div style="width:88px;height:88px;display:flex;align-items:center;justify-content:center;overflow:hidden;">${artHtml}</div>`;
    } else if (bossImg.startsWith('http') || bossImg.startsWith('data:')) {
      coreEl.innerHTML = `<img src="${bossImg}" style="width:88px;height:88px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,185,95,.5);" onerror="this.outerHTML='💀'">`;
    } else {
      coreEl.textContent = bossImg;
    }
  }

  // ── Battlefield setup
  const battlefield = document.getElementById('cbl-battlefield');
  if (!battlefield) return;

  // Remove old tokens/sparks from any prior run
  [...battlefield.querySelectorAll('.cbl-token,.cbl-spark')].forEach(el => el.remove());
  // Reset shockwaves by cloning the parent (restarts animations)
  [...battlefield.querySelectorAll('.cbl-shockwave')].forEach(s => {
    const clone = s.cloneNode(true);
    s.parentNode.replaceChild(clone, s);
  });

  // ── Spawn sparks on explosion
  setTimeout(() => _cblSpawnSparks(battlefield), 80);

  // ── Build token list: one token per reward quantity slot, burst onto field
  const rewards = wblrRewards(boss);
  // Flatten: each remaining unit gets its own token
  const tokenDefs = [];
  rewards.forEach(r => {
    const qty = Math.min(parseInt(r.quantity) || 0, 18); // Cap visual tokens at 18/reward
    for (let i = 0; i < qty; i++) tokenDefs.push(r);
  });

  const total = tokenDefs.length;
  const cxFrac = 0.5, cyFrac = 0.44; // boss core fraction of viewport

  tokenDefs.forEach((r, i) => {
    const token = _cblCreateToken(bossIdx, r, i, total, cxFrac, cyFrac, () => {
      // After any claim, refresh HUD and show feed message
      DB = loadDB();
      const updBoss = DB.bossEvents[bossIdx];
      if (updBoss) {
        const summary = wblrLootSummary(updBoss);
        _cblFlashFeed(`✨ ${r.itemName} claimed! (${summary.remaining} left)`);
        _cblRefreshHud(bossIdx);
        // If all gone, auto-reveal lobby button
        if (summary.remaining <= 0) _cblRevealLobbyBtn();
      }
    });
    battlefield.appendChild(token);
  });

  // ── Initial HUD numbers
  const summary = wblrLootSummary(boss);
  const remEl = document.getElementById('cbl-remaining');
  const clmEl = document.getElementById('cbl-claimed-count');
  if (remEl) remEl.textContent = summary.remaining;
  if (clmEl) clmEl.textContent = summary.claimed;

  // ── Reveal lobby button after explosion animation settles
  const lobbyBtn = document.getElementById('cbl-lobby-btn');
  if (lobbyBtn) {
    // Clone to clear old listeners
    const freshBtn = lobbyBtn.cloneNode(true);
    lobbyBtn.parentNode.replaceChild(freshBtn, lobbyBtn);
    freshBtn.style.display = 'none';
    freshBtn.addEventListener('click', function () {
      // Finalize if still in loot phase
      DB = loadDB();
      const b = DB.bossEvents[bossIdx];
      if (b && b.status === 'loot') wblrFinalizeLoot(bossIdx, 'student_exit');
      panel.style.display = 'none';
      _wbvCloseOverlay();
      if (onDone) onDone();
    });
    // Show lobby button after explosion settles (~1.8 s)
    setTimeout(() => { freshBtn.style.display = ''; }, 1800);
  }

  function _cblRevealLobbyBtn() {
    const btn = document.getElementById('cbl-lobby-btn');
    if (btn) {
      btn.style.display = '';
      const msg = document.querySelector('#cbl-hud .cbl-all-claimed-msg');
      if (!msg) {
        const m = document.createElement('div');
        m.className = 'cbl-all-claimed-msg';
        m.textContent = '🎉 ALL LOOT CLAIMED!';
        const hudStats = document.getElementById('cbl-hud-stats');
        if (hudStats) hudStats.insertAdjacentElement('afterend', m);
      }
    }
  }

  // ── Realtime refresh: sync claims from other tabs (same local DB)
  if (window._cblSyncTimer) clearInterval(window._cblSyncTimer);
  window._cblSyncTimer = setInterval(() => {
    if (!document.getElementById('cbl-battlefield')) {
      clearInterval(window._cblSyncTimer);
      return;
    }
    _cblRefreshHud(bossIdx);
    // Check if loot phase ended by admin
    DB = loadDB();
    const b = DB.bossEvents[bossIdx];
    if (!b || b.status === 'ended') {
      clearInterval(window._cblSyncTimer);
    }
  }, 1200);
}

// ── Student loot page ─────────────────────────────────────────────────────────

window.wblrRenderStudentLootPage = function (bossIdx) {
  const page = document.getElementById('s-world-boss'); if (!page) return;
  DB = loadDB();
  const boss    = DB.bossEvents[bossIdx]; if (!boss) return;
  const rewards = wblrRewards(boss);
  const loot    = wblrLootSummary(boss);
  const meta    = wblrRarityMeta;
  page.innerHTML = `
  <div style="padding:24px;max-width:800px;margin:0 auto">
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:64px;margin-bottom:10px;animation:achBadgePulse 1.5s infinite">🎁</div>
      <div style="font-family:var(--fm);font-size:9px;color:#EC4899;letter-spacing:.2em;margin-bottom:8px">LOOT RUSH</div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900;color:var(--on-surface);margin-bottom:6px">${wblrEsc(boss.name)} Defeated!</div>
      <div id="wblr-hud" style="display:flex;align-items:center;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:10px">
        <div class="wblr-hud-chip"><span class="material-symbols-outlined" style="font-size:14px">timer</span><span id="wblr-timer-display">--:--</span></div>
        <div class="wblr-hud-chip"><span class="material-symbols-outlined" style="font-size:14px">inventory_2</span><span id="wblr-remaining">${loot.remaining} items left</span></div>
        <div class="wblr-hud-chip"><span class="material-symbols-outlined" style="font-size:14px">people</span>${loot.claimed} claimed</div>
      </div>
    </div>
    <div id="wblr-rain-container" style="position:relative;height:160px;width:100%;border:1px solid rgba(255,255,255,.07);border-radius:16px;background:rgba(0,0,0,.2);overflow:hidden;margin-bottom:24px">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;pointer-events:none">Tap falling tokens to claim!</div>
    </div>
    <div class="wblr-rewards-grid">
      ${rewards.map(r => { const m = meta(r.rarity); const remaining = wblrRemaining(boss, r); const myCount = wblrClaimedByStudent(boss, r.id, currentUser.id); const canClaim = remaining > 0 && myCount < (r.claimLimit || 1);
        return `<div class="wblr-reward-card wblr-rarity-${wblrRarityKey(r.rarity)}" style="--rarity-color:${m.color};opacity:${remaining<=0?'.5':'1'}">
          <span class="material-symbols-outlined" style="font-size:28px;color:${m.color};margin-bottom:6px">${m.icon}</span>
          <div class="wblr-reward-name">${wblrEsc(r.itemName)}</div>
          <div class="wblr-reward-rarity">${wblrEsc(r.rarity)}</div>
          <div class="wblr-reward-stock">${remaining}/${parseInt(r.quantity)||0} left</div>
          ${myCount > 0 ? `<div style="font-size:9px;color:${m.color};font-weight:700">✓ You claimed ${myCount}</div>` : ''}
          <button class="wblr-claim-btn" ${!canClaim ? 'disabled' : ''} onclick="wblrClaimReward(${bossIdx},'${r.id}',this)" style="--rarity-color:${m.color};${!canClaim?'opacity:.45':''}">
            ${remaining <= 0 ? 'Sold Out' : myCount >= (r.claimLimit || 1) ? 'Limit Reached' : '🎁 Claim'}
          </button>
        </div>`; }).join('')}
    </div>
    <div style="text-align:center;margin-top:20px">
      <div class="wblr-feed" style="max-height:180px;margin-bottom:16px">${wblrClaimFeedHTML(bossIdx, 20)}</div>
    </div>
  </div>`;
  if (typeof wblrStartRealtime === 'function') wblrStartRealtime(bossIdx);
};

// ── Claim feed ────────────────────────────────────────────────────────────────

window.wblrClaimFeedHTML = function (bossIdx, limit = 12) {
  const boss  = DB.bossEvents[bossIdx]; if (!boss) return '';
  const claims = [...(boss.lootClaims || [])].reverse().slice(0, limit);
  if (!claims.length) return '<div class="wblr-empty">No claims yet — be the first!</div>';
  return claims.map(c => {
    const r    = wblrRewards(boss).find(r => r.id === c.rewardId);
    const meta = r ? wblrRarityMeta(r.rarity) : WBLR_RARITY_META.common;
    const name = r ? r.itemName : 'Reward';
    return `<div class="wblr-feed-row"><div class="wblr-feed-avatar" style="background:${c.studentColor||'#8b5cf6'}22;border:1px solid ${c.studentColor||'#8b5cf6'}44;color:${c.studentColor||'#8b5cf6'}">${wblrEsc(c.studentInit||'?')}</div><div style="flex:1;min-width:0"><span style="font-weight:700;color:var(--on-surface)">${wblrEsc(c.studentName||'Student')}</span> claimed <span style="color:${meta.color};font-weight:700">${wblrEsc(name)}</span></div><span class="material-symbols-outlined" style="font-size:14px;color:${meta.color}">${meta.icon}</span></div>`;
  }).join('');
};

// ── Admin loot settings modal ─────────────────────────────────────────────────

// ── Admin: Loot Rush settings modal ────────────────────────────────────────────
// RESTORED: the previous version had no draft object — it re-rendered reward
// rows straight from the already-saved boss.lootRewards on every Add/Remove
// click, and called saveDB() immediately on each click. That meant any
// unsaved edits typed into existing reward name/qty/rarity/limit fields were
// silently discarded the moment you clicked "Add Reward" or removed a row,
// since the re-render pulled from saved DB state, not from the form's
// current values. Ported the original's window._wblrDraft pattern verbatim:
// add/remove now first read the live DOM rows into the draft, mutate the
// draft, then re-render from the draft — nothing is saved to DB until
// "Save Loot" is clicked.

window.wblrOpenLootSettings = function (bossIdx) {
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx]; if (!boss) return;
  window._wblrDraft = { bossIdx, rewards: wblrNormalizeRewards((boss.lootRewards && boss.lootRewards.length) ? boss.lootRewards : wblrDefaultRewards()) };
  showModal(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,rgba(255,185,95,.22),rgba(236,72,153,.16));border:1px solid rgba(255,185,95,.38);display:flex;align-items:center;justify-content:center;color:#ffb95f">
      <span class="material-symbols-outlined">redeem</span>
    </div>
    <div>
      <div class="modal-h2" style="margin-bottom:2px">Loot Drop Rush — ${wblrEsc(boss.name)}</div>
      <div style="font-size:12px;color:var(--text-muted)">Configure first-come rewards for the HP-zero loot phase.</div>
    </div>
  </div>
  <div class="form-group" style="margin-bottom:14px">
    <label class="form-label">Loot Duration (seconds)</label>
    <input type="number" id="wblr-duration" value="${boss.lootDuration||120}" min="10" style="width:100%">
  </div>
  <div class="boss-form-section">
    <div class="boss-form-section-title">Reward Items</div>
    <div id="wblr-admin-list">${wblrAdminRowsHTML()}</div>
    <button class="btn btn-ghost btn-sm" onclick="wblrAdminAddReward()">
      <span class="material-symbols-outlined" style="font-size:15px">add</span> Add Reward
    </button>
  </div>
  <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px">
    <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
    <button class="btn btn-primary" onclick="wblrSaveLootSettings(${bossIdx})" style="background:linear-gradient(135deg,#ffb95f,#EC4899);box-shadow:0 4px 16px rgba(255,185,95,.25)">
      <span class="material-symbols-outlined" style="font-size:16px">save</span> Save Loot
    </button>
  </div>`, 'lg');
};

window.wblrAdminRowsHTML = function () {
  const draft = window._wblrDraft;
  if (!draft || !draft.rewards.length) return `<div class="wblr-empty">No loot rewards yet.</div>`;
  return draft.rewards.map((r, i) => {
    const rarity = wblrRarityLabel(r.rarity);
    return `<div class="wblr-admin-row" data-loot-row="${i}" data-reward-id="${wblrEsc(r.id)}">
      <div class="wblr-admin-wide">
        <label class="form-label">Reward Item</label>
        <input type="text" id="wblr-name-${i}" value="${wblrEsc(r.itemName)}" placeholder="Golden Voucher">
      </div>
      <div>
        <label class="form-label">Qty</label>
        <input type="number" id="wblr-qty-${i}" value="${parseInt(r.quantity)||1}" min="1">
      </div>
      <div>
        <label class="form-label">Rarity</label>
        <select id="wblr-rarity-${i}">
          ${WBLR_RARITIES.map(x => `<option value="${x}" ${x===rarity?'selected':''}>${x}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">Limit</label>
        <input type="number" id="wblr-limit-${i}" value="${parseInt(r.claimLimit)||1}" min="1">
      </div>
      <button class="btn btn-danger btn-xs" style="margin-top:22px;width:34px;height:32px;padding:0" onclick="wblrAdminRemoveReward(${i})" title="Remove reward">
        <span class="material-symbols-outlined" style="font-size:16px">close</span>
      </button>
    </div>`;
  }).join('');
};

window.wblrReadAdminRows = function () {
  const draft = window._wblrDraft;
  if (!draft) return [];
  const rows = [...document.querySelectorAll('[data-loot-row]')];
  return rows.map(row => {
    const i = parseInt(row.dataset.lootRow);
    return {
      id: row.dataset.rewardId || uid(),
      itemName: (document.getElementById('wblr-name-'+i)?.value || '').trim(),
      quantity: Math.max(1, parseInt(document.getElementById('wblr-qty-'+i)?.value) || 1),
      rarity: wblrRarityLabel(document.getElementById('wblr-rarity-'+i)?.value || 'Common'),
      claimLimit: Math.max(1, parseInt(document.getElementById('wblr-limit-'+i)?.value) || 1),
    };
  });
};

window.wblrAdminRefreshRows = function () {
  const list = document.getElementById('wblr-admin-list');
  if (list) list.innerHTML = wblrAdminRowsHTML();
};

window.wblrAdminAddReward = function () {
  if (!window._wblrDraft) return;
  window._wblrDraft.rewards = wblrReadAdminRows();
  window._wblrDraft.rewards.push({ id: uid(), itemName: 'New Reward', quantity: 1, rarity: 'Common', claimLimit: 1 });
  wblrAdminRefreshRows();
};

window.wblrAdminRemoveReward = function (i) {
  if (!window._wblrDraft) return;
  window._wblrDraft.rewards = wblrReadAdminRows();
  window._wblrDraft.rewards.splice(i, 1);
  wblrAdminRefreshRows();
};

window.wblrSaveLootSettings = function (bossIdx) {
  const duration = parseInt(document.getElementById('wblr-duration')?.value) || 120;
  const rewards  = wblrReadAdminRows();

  const result = LootService.saveLootSettings(bossIdx, {
    lootDuration: duration,
    rewards: rewards,
  });

  if (!result.ok) {
    toast(result.reason || 'Failed to save loot settings.', '#ffb4ab');
    return;
  }

  closeModalForce();
  toast('Loot Drop Rush rewards saved.', '#ffb95f');
  renderAdminBossEvents();
};

// ── Reward cards HTML ─────────────────────────────────────────────────────────

window.wblrRewardCardsHTML = function (bossIdx) {
  DB = loadDB();
  const boss    = DB.bossEvents[bossIdx]; if (!boss) return '';
  const rewards = wblrRewards(boss);
  if (!rewards.length) return '<div class="wblr-empty">No rewards configured.</div>';
  return rewards.map(r => {
    const meta = wblrRarityMeta(r.rarity);
    const remaining = wblrRemaining(boss, r);
    const mine = (typeof currentUser !== 'undefined' && currentUser) ? wblrClaimedByStudent(boss, r.id, currentUser.id) : 0;
    return `<div class="wblr-reward-card wblr-rarity-${wblrRarityKey(r.rarity)}" style="--rarity-color:${meta.color}">
      <div class="wblr-reward-top">
        <div class="wblr-reward-name">${wblrEsc(r.itemName)}</div>
        <div class="wblr-rarity-pill">${wblrEsc(r.rarity)}</div>
      </div>
      <div class="wblr-remaining">${remaining}<span style="font-size:12px;color:var(--text-muted);font-weight:700"> / ${parseInt(r.quantity)||0}</span></div>
      <div class="wblr-card-meta">Remaining quantity</div>
      <div class="wblr-card-meta">Claim limit: ${parseInt(r.claimLimit)||1} each${(typeof currentRole !== 'undefined' && currentRole === 'student') ? ' — You: ' + mine : ''}</div>
    </div>`;
  }).join('');
};

// ── Final summary ─────────────────────────────────────────────────────────────

window.wblrFinalSummaryInner = function (bossIdx) {
  const boss  = DB.bossEvents[bossIdx];
  if (!boss) return '<div class="wblr-empty">No boss summary found.</div>';
  const parts        = Object.values(wbcGetParticipants(bossIdx));
  const totalDmg     = parts.reduce((a, p) => a + (p.totalDamage     || 0), 0);
  const totalCorrect = parts.reduce((a, p) => a + (p.correctAnswers  || 0), 0);
  const totalCrits   = parts.reduce((a, p) => a + (p.critHits        || 0), 0);
  const totalMinions = parts.reduce((a, p) => a + (p.minionsDefeated || 0), 0);
  const loot         = wblrLootSummary(boss);
  const lootCards    = wblrRewards(boss).map(r => {
    const meta   = wblrRarityMeta(r.rarity);
    const claims = wblrClaims(boss).filter(c => c.rewardId === r.id);
    const names  = claims.slice(0, 4).map(c => wblrEsc(c.studentName)).join(', ');
    return `<div class="wblr-summary-item wblr-rarity-${wblrRarityKey(r.rarity)}" style="--rarity-color:${meta.color}">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><div style="font-family:var(--fh);font-size:13px;font-weight:900;color:var(--on-surface)">${wblrEsc(r.itemName)}</div><div class="wblr-rarity-pill">${wblrEsc(r.rarity)}</div></div>
      <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:${meta.color}">${claims.length} / ${parseInt(r.quantity) || 0}</div>
      <div style="font-size:10px;color:var(--text-muted);line-height:1.5">${names || 'No claims'}${claims.length > 4 ? ` +${claims.length - 4} more` : ''}</div>
    </div>`;
  }).join('');
  const artHTML = typeof bveRenderCompactArt === 'function' ? bveRenderCompactArt(boss, 32) : '';
  return `
  <div class="wbl-victory-header">
    <div style="font-size:56px;margin-bottom:12px">🏆</div>
    <div class="wbl-victory-title">FINAL BOSS SUMMARY</div>
    <div class="wbl-victory-sub">Raid complete for ${wblrEsc(boss.name)}</div>
    <div style="display:flex;align-items:center;gap:10px;justify-content:center;margin-top:8px">${artHTML}<span style="font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface)">${wblrEsc(boss.name)}</span></div>
  </div>
  <div style="background:rgba(35,31,56,.9);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:20px">
    <div style="font-family:var(--fm);font-size:9px;color:#EC4899;letter-spacing:.16em;margin-bottom:14px">RAID SUMMARY</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
      <div class="wbl-summary-pill"><div class="v" style="color:#EC4899">${totalDmg.toLocaleString()}</div><div class="l">Total Damage</div></div>
      <div class="wbl-summary-pill"><div class="v" style="color:#4edea3">${totalCorrect}</div><div class="l">Correct Answers</div></div>
      <div class="wbl-summary-pill"><div class="v" style="color:#ffb95f">${totalCrits}</div><div class="l">Critical Hits</div></div>
      <div class="wbl-summary-pill"><div class="v" style="color:#f97316">${totalMinions}</div><div class="l">Minions Slain</div></div>
      <div class="wbl-summary-pill"><div class="v" style="color:#d0bcff">${loot.claimed}/${loot.total}</div><div class="l">Loot Claimed</div></div>
    </div>
  </div>
  <div style="background:rgba(35,31,56,.9);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:20px">
    <div style="font-family:var(--fm);font-size:9px;color:#ffb95f;letter-spacing:.16em;margin-bottom:14px">LOOT DISTRIBUTION</div>
    <div class="wblr-summary-loot">${lootCards || '<div class="wblr-empty">No loot rewards configured.</div>'}</div>
    <div class="wblr-feed" style="max-height:220px;margin-top:14px">${wblrClaimFeedHTML(bossIdx, 50)}</div>
  </div>
  <div style="background:rgba(35,31,56,.9);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:24px">
    <div style="font-family:var(--fm);font-size:9px;color:#ffb95f;letter-spacing:.16em;margin-bottom:16px">FINAL RANKINGS</div>
    <div id="wbl-lb-container-${bossIdx}">${typeof wblRenderPanel === 'function' ? wblRenderPanel(bossIdx, 'event') : ''}</div>
  </div>`;
};

window.wblrRenderFinalSummaryPage = function (bossIdx) {
  const page = document.getElementById('s-world-boss'); if (!page) return;
  DB = loadDB();
  page.innerHTML = `<div style="padding:32px;max-width:960px;margin:0 auto">${wblrFinalSummaryInner(bossIdx)}</div>`;
};

window.wblrOpenFinalSummary = function (bossIdx) {
  const currentDB = getDB();
  showModal(`<div style="max-height:78vh;overflow:auto;padding-right:4px">${wblrFinalSummaryInner(bossIdx)}</div>
    <div style="display:flex;justify-content:center;padding-top:4px">
      <button class="btn btn-primary" onclick="closeModalForce()" style="background:linear-gradient(135deg,#EC4899,#9333ea)">Close</button>
    </div>`, 'lg');
};

// ── Pub/Sub: Reactive UI subscriptions ────────────────────────────────────────
AppStore.subscribe('wblr-topbar-sync', function (state, event) {
  if (event.type === 'loot:claimed' || event.type === 'state:updated') {
    if (typeof updateTopbar === 'function') updateTopbar();
  }
});

AppStore.subscribe('wblr-admin-page-sync', function (state, event) {
  const lootEvents = ['loot:rush-started', 'loot:finalized', 'loot:settings-saved'];
  if (lootEvents.includes(event.type)) {
    if ((currentRole === 'admin' || currentRole === 'teacher') && typeof renderAdminBossEvents === 'function') {
      renderAdminBossEvents();
    }
  }
});

AppStore.subscribe('wblr-sidebar-badge-sync', function (state, event) {
  if (event.type === 'loot:claimed') {
    if (typeof achUpdateSidebarBadge === 'function') achUpdateSidebarBadge();
  }
});

console.log('[loot-rain.js] Pub/Sub subscribers registered with AppStore.');
