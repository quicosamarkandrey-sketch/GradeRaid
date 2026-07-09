// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/summon-notify.js
//  World Boss Summon Notification: animated full-screen overlay that pops up
//  on student tabs when a boss is activated by the teacher.
//
//  Cross-tab communication via pendingBossSummon in localStorage.
//  ⚠️ [BLOCKER-SIGNAL] pendingBossSummon key MUST NOT be renamed — it is the
//  cross-tab signal mechanism. See comment in wbsnWriteSignal.
//
//  LOAD AFTER: combat-settings.js, loot-rain.js, skills.js, phases.js, rage.js
// ═══════════════════════════════════════════════════════════════════════════════

/* ─────────────────────────────────────────────────
   CSS — injected at runtime
───────────────────────────────────────────────── */
;(function () {
  const style = document.createElement('style');
  style.textContent = `
/* ══ WORLD BOSS SUMMON NOTIFICATION — CSS ══════════════════ */

#wbsn-overlay {
  position: fixed;
  inset: 0;
  z-index: 10500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  pointer-events: none;
  opacity: 0;
  transition: opacity .35s ease;
}
#wbsn-overlay.wbsn-visible {
  pointer-events: auto;
  opacity: 1;
}
#wbsn-overlay.wbsn-hiding {
  opacity: 0;
  pointer-events: none;
}

.wbsn-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(6, 4, 18, 0.88);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* ── Main card ── */
.wbsn-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 520px;
  border-radius: 28px;
  overflow: hidden;
  background: linear-gradient(160deg, #0f0620 0%, #1a0830 45%, #120220 100%);
  border: 1.5px solid rgba(236, 72, 153, 0.4);
  box-shadow:
    0 0 0 1px rgba(139, 92, 246, 0.15),
    0 0 80px rgba(236, 72, 153, 0.25),
    0 32px 96px rgba(0, 0, 0, 0.7);
  padding: 32px 28px 24px;
  text-align: center;
  transform: translateY(32px) scale(0.95);
  transition: transform .4s cubic-bezier(.34,1.56,.64,1);
}
#wbsn-overlay.wbsn-visible .wbsn-card {
  transform: translateY(0) scale(1);
}
#wbsn-overlay.wbsn-hiding .wbsn-card {
  transform: translateY(-20px) scale(0.97);
  transition: transform .35s ease;
}

/* Decorative layers */
.wbsn-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(236,72,153,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(236,72,153,0.05) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
}
.wbsn-bg-glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(236,72,153,0.22) 0%, transparent 55%),
    radial-gradient(ellipse at 80% 80%, rgba(139,92,246,0.12) 0%, transparent 45%);
  pointer-events: none;
}
.wbsn-scanline {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, #EC4899, rgba(208,188,255,0.8), #EC4899, transparent);
  animation: wbsn-scan 2.4s linear infinite;
}
@keyframes wbsn-scan {
  0%   { transform: translateX(-100%); opacity: 0.9; }
  100% { transform: translateX(100%);  opacity: 0.9; }
}

/* Alert strip */
.wbsn-alert-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 22px;
  position: relative;
  z-index: 2;
}
.wbsn-alert-label {
  font-family: var(--fm);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: .2em;
  color: #EC4899;
  text-shadow: 0 0 14px rgba(236,72,153,0.8);
  animation: wbsn-blink 1.2s ease-in-out infinite;
}
@keyframes wbsn-blink {
  0%,100% { opacity: 1; }
  50%      { opacity: .55; }
}
.wbsn-alert-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #EC4899;
  box-shadow: 0 0 8px rgba(236,72,153,0.9);
  animation: wbsn-dot-pulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes wbsn-dot-pulse {
  0%,100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(.5); opacity: .4; }
}

/* Portrait */
.wbsn-portrait-wrap {
  position: relative;
  width: 120px; height: 120px;
  margin: 0 auto 18px;
  z-index: 2;
}
.wbsn-portrait {
  width: 120px; height: 120px;
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(236,72,153,0.18), rgba(139,92,246,0.12));
  border: 2px solid rgba(236,72,153,0.45);
  display: flex; align-items: center; justify-content: center;
  font-size: 60px;
  box-shadow: 0 0 48px rgba(236,72,153,0.35), 0 12px 40px rgba(0,0,0,0.5);
  animation: wbsn-boss-float 3.5s ease-in-out infinite;
  position: relative; z-index: 1;
}
@keyframes wbsn-boss-float {
  0%,100% { transform: translateY(0) rotate(-2deg);   filter: drop-shadow(0 0 20px rgba(236,72,153,0.4)); }
  50%     { transform: translateY(-8px) rotate(2deg); filter: drop-shadow(0 0 34px rgba(236,72,153,0.65)); }
}
.wbsn-ring {
  position: absolute;
  border-radius: 28px;
  border: 1px solid rgba(236,72,153,0.22);
  animation: wbsn-ring-pulse 2s ease-in-out infinite;
}
.wbsn-ring-1 { inset: -8px;  animation-delay: 0s; }
.wbsn-ring-2 { inset: -18px; animation-delay: .35s; border-color: rgba(139,92,246,0.15); border-radius: 36px; }
.wbsn-ring-3 { inset: -30px; animation-delay: .7s;  border-color: rgba(236,72,153,0.08); border-radius: 44px; }
@keyframes wbsn-ring-pulse {
  0%,100% { opacity: .4; transform: scale(1); }
  50%     { opacity: 1;  transform: scale(1.04); }
}

/* Flavour line */
.wbsn-flavour {
  font-family: var(--fb);
  font-size: 13px;
  font-style: italic;
  color: rgba(240,238,255,0.5);
  margin-bottom: 8px;
  position: relative; z-index: 2;
  line-height: 1.5;
}

/* Boss name */
.wbsn-boss-name {
  font-family: var(--fh);
  font-size: 32px;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: -.5px;
  background: linear-gradient(135deg, #fff 0%, #EC4899 45%, #d0bcff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 10px;
  position: relative; z-index: 2;
}

/* Description */
.wbsn-boss-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.65;
  max-width: 400px;
  margin: 0 auto 20px;
  position: relative; z-index: 2;
}

/* Stats row */
.wbsn-stats-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 22px;
  position: relative; z-index: 2;
}
.wbsn-stat {
  flex: 1;
  text-align: center;
}
.wbsn-stat-v {
  font-family: var(--fh);
  font-size: 17px;
  font-weight: 900;
  color: #EC4899;
  line-height: 1.2;
}
.wbsn-stat-l {
  font-family: var(--fm);
  font-size: 8px;
  color: var(--text-muted);
  letter-spacing: .1em;
  margin-top: 3px;
  text-transform: uppercase;
}
.wbsn-stat-divider {
  width: 1px;
  height: 36px;
  background: rgba(255,255,255,0.08);
  flex-shrink: 0;
  margin: 0 4px;
}

/* Buttons */
.wbsn-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative; z-index: 2;
}
.wbsn-btn-join {
  width: 100%;
  padding: 15px 24px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  font-family: var(--fh);
  font-size: 16px;
  font-weight: 900;
  letter-spacing: .04em;
  color: #fff;
  background: linear-gradient(135deg, #EC4899 0%, #9333ea 100%);
  box-shadow: 0 6px 32px rgba(236,72,153,0.45), 0 2px 8px rgba(0,0,0,0.3);
  transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.wbsn-btn-join:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 40px rgba(236,72,153,0.6), 0 4px 12px rgba(0,0,0,0.35);
  filter: brightness(1.08);
}
.wbsn-btn-join:active {
  transform: translateY(0);
  filter: brightness(0.95);
}
.wbsn-btn-icon {
  font-size: 20px;
  animation: wbsn-sword-bounce .8s ease-in-out infinite;
}
@keyframes wbsn-sword-bounce {
  0%,100% { transform: rotate(-10deg) scale(1); }
  50%     { transform: rotate(10deg) scale(1.15); }
}

.wbsn-btn-dismiss {
  width: 100%;
  padding: 11px 24px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
  color: var(--text-muted);
  font-family: var(--fb);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.wbsn-btn-dismiss:hover {
  background: rgba(255,255,255,0.08);
  color: var(--on-surface);
}

/* Fine print */
.wbsn-footnote {
  margin-top: 14px;
  font-size: 11px;
  color: rgba(240,238,255,0.28);
  line-height: 1.5;
  position: relative; z-index: 2;
}

/* ── Responsive ── */
@media (max-width: 480px) {
  .wbsn-card { padding: 24px 18px 18px; border-radius: 20px; }
  .wbsn-boss-name { font-size: 26px; }
  .wbsn-portrait, .wbsn-portrait-wrap { width: 96px; height: 96px; }
  .wbsn-portrait { font-size: 48px; }
}

/* ══ END WORLD BOSS SUMMON NOTIFICATION CSS ══ */
  `;
  document.head.appendChild(style);
})();

// ── Runtime state ─────────────────────────────────────────────────────────────

window.WBSN = {
  dismissedBosses: {},
  pollTimer:       null,
};

// ── Show overlay ──────────────────────────────────────────────────────────────

window.wbsnShow = function (bossIdx) {
  if (WBSN.dismissedBosses[bossIdx]) return;
  if (document.getElementById('wbsn-overlay')) return;
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;

  // FIX: stop re-showing the notification once the student has already
  // joined this boss fight. Previously there was no "already joined" check
  // anywhere in this file, so wbsnStartPolling's 5s interval (and the 3s
  // same-tab signal poll below) kept calling wbsnShow() for the same active
  // boss over and over even after the student joined — the only thing that
  // ever silenced it was an explicit "Remind Me Later" dismissal. Setting
  // dismissedBosses here means every other call path (polling, storage
  // event, bootApp) short-circuits on the existing check at the top of this
  // function on its very next call.
  if (typeof wbcMyRecord === 'function' && wbcMyRecord(bossIdx)) {
    WBSN.dismissedBosses[bossIdx] = true;
    return;
  }

  // Pre-load IDB artwork if available
  if (typeof bvePreloadBossArt === 'function') {
    bvePreloadBossArt(boss).then(() => _wbsnShowRender(bossIdx)).catch(() => _wbsnShowRender(bossIdx));
    return;
  }
  _wbsnShowRender(bossIdx);
};

function _wbsnShowRender(bossIdx) {
  if (WBSN.dismissedBosses[bossIdx]) return;
  if (document.getElementById('wbsn-overlay')) return;
  DB = loadDB();
  const boss = DB.bossEvents[bossIdx];
  if (!boss || boss.status !== 'active') return;

  const artHTML = typeof bveRenderBossArt === 'function'
    ? bveRenderBossArt(boss, { sizePx: 110 })
    : `<span style="font-size:72px">${boss.emoji || '💀'}</span>`;
  const totalReward = (boss.xpReward || 0) + (boss.participationReward || 0);
  const totalCoins  = (boss.coinReward || 0) + (boss.victoryReward || 0);

  const overlay = document.createElement('div');
  overlay.id = 'wbsn-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="wbsn-backdrop"></div>
    <div class="wbsn-card" id="wbsn-card">
      <div class="wbsn-bg-grid"></div>
      <div class="wbsn-bg-glow"></div>
      <div class="wbsn-scanline"></div>
      <div class="wbsn-alert-strip">
        <span class="wbsn-alert-dot"></span>
        <span class="wbsn-alert-label">⚠ WORLD BOSS APPEARED ⚠</span>
        <span class="wbsn-alert-dot"></span>
      </div>
      <div class="wbsn-portrait-wrap">
        <div class="wbsn-ring wbsn-ring-1"></div>
        <div class="wbsn-ring wbsn-ring-2"></div>
        <div class="wbsn-ring wbsn-ring-3"></div>
        <div class="wbsn-portrait" id="wbsn-portrait">${artHTML}</div>
      </div>
      <div class="wbsn-flavour">"${_esc(boss.name || 'A powerful entity')} has awakened!"</div>
      <div class="wbsn-boss-name">${_esc(boss.name || 'World Boss')}</div>
      <div class="wbsn-boss-desc">${_esc(boss.description || 'A powerful boss has appeared. Join the class raid before it is too late!')}</div>
      <div class="wbsn-stats-row">
        <div class="wbsn-stat"><div class="wbsn-stat-v">${(boss.maxHp || 0).toLocaleString()}</div><div class="wbsn-stat-l">BOSS HP</div></div>
        <div class="wbsn-stat-divider"></div>
        <div class="wbsn-stat"><div class="wbsn-stat-v" style="color:var(--tertiary)">${totalReward > 0 ? totalReward + ' XP' : '—'}</div><div class="wbsn-stat-l">RAID REWARD</div></div>
        <div class="wbsn-stat-divider"></div>
        <div class="wbsn-stat"><div class="wbsn-stat-v" style="color:var(--secondary)">${totalCoins > 0 ? totalCoins + ' 🪙' : '—'}</div><div class="wbsn-stat-l">COINS</div></div>
      </div>
      <div class="wbsn-actions">
        <button class="wbsn-btn-join" id="wbsn-join-btn" onclick="wbsnJoin(${bossIdx})">
          <span class="wbsn-btn-icon">⚔️</span> JOIN BATTLE
        </button>
        <button class="wbsn-btn-dismiss" onclick="wbsnDismiss(${bossIdx})">Remind Me Later</button>
      </div>
      <div class="wbsn-footnote">You can join from the World Boss page at any time while the event is active.</div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('wbsn-visible')));
}

// ── Join / dismiss / remove ────────────────────────────────────────────────────

window.wbsnJoin = function (bossIdx) {
  // Belt-and-suspenders: mark dismissed immediately so polling can't sneak
  // a re-show in during the brief window before wbcJoinBoss's DB write
  // (inside the setTimeout below) actually lands.
  WBSN.dismissedBosses[bossIdx] = true;
  wbsnRemove();
  if (typeof navTo === 'function') navTo('s-world-boss');
  setTimeout(() => {
    DB = loadDB();
    const boss = DB.bossEvents[bossIdx];
    if (boss && boss.status === 'active') wbcJoinBoss(bossIdx);
  }, 200);
};

window.wbsnDismiss = function (bossIdx) {
  WBSN.dismissedBosses[bossIdx] = true;
  wbsnRemove();
  toast('⚔️ World Boss is active — visit the World Boss page to join!', '#EC4899');
};

window.wbsnRemove = function () {
  const overlay = document.getElementById('wbsn-overlay'); if (!overlay) return;
  overlay.classList.remove('wbsn-visible');
  overlay.classList.add('wbsn-hiding');
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 420);
};

// ── Signal write ──────────────────────────────────────────────────────────────

/**
 * wbsnWriteSignal(bossIdx) → void
 * ⚠️ [BLOCKER-SIGNAL] Writes pendingBossSummon to the DB blob in localStorage.
 * Student tabs pick this up via the storage event listener below.
 * DO NOT rename the pendingBossSummon key — it is the cross-tab signal mechanism.
 */
window.wbsnWriteSignal = function (bossIdx) {
  DB = loadDB();
  // ⚠️ [BLOCKER-SIGNAL] — key pendingBossSummon must not be renamed
  DB.pendingBossSummon = { bossIdx, firedAt: Date.now() };
  try { saveDB(); } catch (ex) { console.warn('[WBSN] Signal write failed:', ex); }
};

// ── Cross-tab storage event (student-side) ────────────────────────────────────

;(function () {
  if (window._wbsnStorageHandlerAttached) return;
  window._wbsnStorageHandlerAttached = true;

  const _listener = function (e) {
    if (currentRole !== 'student') return;
    const freshDB = loadDB();
    // ⚠️ [BLOCKER-SIGNAL] — reads pendingBossSummon signal
    const signal = freshDB.pendingBossSummon;
    if (!signal) return;
    if (Date.now() - (signal.firedAt || 0) > 12000) return;
    const boss = freshDB.bossEvents[signal.bossIdx];
    if (!boss || boss.status !== 'active') return;
    wbsnShow(signal.bossIdx);
  };
  window.addEventListener('storage', _listener);

  // Also poll for same-tab cross-component signals every 3s
  setInterval(() => {
    if (currentRole !== 'student') return;
    DB = loadDB();
    // ⚠️ [BLOCKER-SIGNAL]
    const signal = DB.pendingBossSummon;
    if (!signal || Date.now() - (signal.firedAt || 0) > 12000) return;
    const boss = DB.bossEvents[signal.bossIdx];
    if (!boss || boss.status !== 'active') return;
    wbsnShow(signal.bossIdx);
  }, 3000);
})();

// ── bossActivate patch ────────────────────────────────────────────────────────

;(function () {
  const _orig = window.bossActivate;
  window.bossActivate = function (bi) {
    if (typeof _orig === 'function') _orig(bi);
    DB = loadDB();
    const boss = DB.bossEvents[bi];
    if (boss && boss.status === 'active') {
      delete WBSN.dismissedBosses[bi];
      wbsnWriteSignal(bi);
    }
  };
})();

// ── bootApp patch — auto-show notification on login if a boss is already active ──
// RESTORED: this patch was missing entirely. The storage-event listener above
// only catches the case where a student's tab is ALREADY OPEN at the exact
// moment the teacher clicks Activate. The far more common case — a student
// logging in (or refreshing) after the boss was already activated — was never
// handled, which is why the notification appeared to be "missing" even though
// the overlay system itself works correctly. Same monkey-patch pattern already
// used elsewhere in this codebase for bootApp (see modules/achievements,
// modules/shop, modules/titles) — auth.js's own header comment documents that
// bootApp is patched by multiple modules and that all such patches should be
// preserved as-is for now.
;(function () {
  const _origBoot = window.bootApp;
  window.bootApp = function () {
    if (typeof _origBoot === 'function') _origBoot();
    if (currentRole !== 'student') return;
    DB = loadDB();
    const found = (typeof wbcGetActiveBoss === 'function') ? wbcGetActiveBoss() : null;
    if (!found) return;
    const { idx } = found;
    if (WBSN.dismissedBosses[idx]) return;
    // Slight delay so the UI is fully rendered before the overlay appears
    setTimeout(() => wbsnShow(idx), 800);
  };
})();

// ── Polling helpers (optional for environments without storage events) ─────────

window.wbsnStartPolling = function () {
  if (WBSN.pollTimer) return;
  WBSN.pollTimer = setInterval(() => {
    if (currentRole !== 'student') return;
    const found = typeof wbcGetActiveBoss === 'function' ? wbcGetActiveBoss() : null;
    if (found) wbsnShow(found.idx);
  }, 5000);
};

window.wbsnStopPolling = function () {
  if (WBSN.pollTimer) { clearInterval(WBSN.pollTimer); WBSN.pollTimer = null; }
};

console.log('[EduQuest] world-boss/summon-notify.js loaded — WBSN, wbsnShow, wbsnJoin/Dismiss, signal write/read, bossActivate patched, storage event attached.');
