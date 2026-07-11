/* ═══════════════════════════════════════════════════════════════════════════════
   EduQuest — perceived-speed.js
   Load AFTER loot-rain.js, ach_student_page.js, student-inbox.js, mail-engine.js.
   Self-contained: patches existing window.* functions, no module bundler needed.

   Delivers:
     1. Optimistic UI Updates  — wblrClaimReward, achClaimReward, mailDoClaimRewards
     2. Physics spring helpers — eqSpringPop(), eqFireClaimBurst()
     3. Skeleton wrappers      — eqShowBossStatusSkeleton(), eqShowBadgeGridSkeleton(),
                                 eqShowLootGridSkeleton(), eqShowMailListSkeleton()

   Architecture rules honoured:
     • No direct localStorage / loadDB() / saveDB() in any new code.
     • All state writes still go through LootService / AppStore / existing engines.
     • DOM-only changes are kept in the UI layer (this file).
   ═══════════════════════════════════════════════════════════════════════════════ */

(function (window) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
     §0  Internal helpers
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * Apply a spring-animation class for one cycle, then remove it.
   * @param {Element} el
   * @param {string}  cls  — one of: spring-pop | spring-bounce | spring-slide-up | spring-drop-in
   */
  function eqSpringPop(el, cls) {
    if (!el) return;
    cls = cls || 'spring-pop';
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow to restart animation
    el.classList.add(cls);
    el.addEventListener('animationend', function handler() {
      el.classList.remove(cls);
      el.removeEventListener('animationend', handler);
    });
  }
  window.eqSpringPop = eqSpringPop;

  /**
   * Fire the "claim burst ring" particle at the claimed element's center.
   * @param {Element} el         — the token / button that was clicked
   * @param {string}  color      — CSS color for the ring
   */
  function eqFireClaimBurst(el, color) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;

    const ring = document.createElement('div');
    ring.className = 'claim-burst-ring';
    ring.style.cssText = [
      'left:'        + cx       + 'px',
      'top:'         + cy       + 'px',
      '--ring-color:' + (color || '#d0bcff'),
    ].join(';');
    document.body.appendChild(ring);
    setTimeout(function () { ring.remove(); }, 700);
  }
  window.eqFireClaimBurst = eqFireClaimBurst;

  /**
   * Smoothly swap skeleton HTML for real content in a container.
   * @param {Element|string} container   — element or selector
   * @param {string}         realHTML    — the real innerHTML to inject
   * @param {Function}       [afterFn]  — optional callback after swap
   */
  function eqReplaceSkeleton(container, realHTML, afterFn) {
    var el = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    if (!el) { if (afterFn) afterFn(); return; }

    el.classList.add('sk-fading');
    setTimeout(function () {
      el.innerHTML = realHTML;
      el.classList.remove('sk-fading');
      el.classList.add('sk-content-in');
      el.addEventListener('animationend', function handler() {
        el.classList.remove('sk-content-in');
        el.removeEventListener('animationend', handler);
      });
      if (afterFn) afterFn();
    }, 220);
  }
  window.eqReplaceSkeleton = eqReplaceSkeleton;


  /* ─────────────────────────────────────────────────────────────────────────
     §1  SKELETON RENDERING HELPERS
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * Inject a world-boss-status skeleton into the given container element.
   * Matches the layout of wblrRenderStudentLootPage() exactly.
   * @param {Element|string} container
   * @param {number}         [cardCount=4]  how many loot-card skeletons to show
   */
  window.eqShowBossStatusSkeleton = function (container, cardCount) {
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    var n = cardCount || 4;

    var lootCards = '';
    for (var i = 0; i < n; i++) {
      lootCards += '<div class="skeleton-shimmer sk-loot-card" style="animation-delay:' + (i * 0.10) + 's"></div>';
    }

    el.innerHTML = [
      '<div style="padding:24px;max-width:800px;margin:0 auto">',
      '  <div class="sk-boss-panel">',
      '    <div class="sk-hero-row">',
      '      <div class="skeleton-shimmer sk-boss-avatar"></div>',
      '      <div class="sk-boss-meta">',
      '        <div class="skeleton-shimmer sk-line-lg"></div>',
      '        <div class="skeleton-shimmer sk-line-md"></div>',
      '        <div class="skeleton-shimmer sk-hp-bar" style="margin-top:4px"></div>',
      '        <div class="skeleton-shimmer sk-line-sm"></div>',
      '      </div>',
      '    </div>',
      '    <div class="sk-stat-row">',
      '      <div class="skeleton-shimmer sk-stat-cell"></div>',
      '      <div class="skeleton-shimmer sk-stat-cell" style="animation-delay:.12s"></div>',
      '      <div class="skeleton-shimmer sk-stat-cell" style="animation-delay:.24s"></div>',
      '      <div class="skeleton-shimmer sk-stat-cell" style="animation-delay:.36s"></div>',
      '    </div>',
      '    <div class="skeleton-shimmer sk-hp-bar"></div>',
      '  </div>',
      '  <div style="margin-top:20px">',
      '    <div class="skeleton-shimmer sk-line-xs" style="width:100px;margin-bottom:12px"></div>',
      '    <div class="sk-loot-grid">' + lootCards + '</div>',
      '  </div>',
      '</div>',
    ].join('');
  };

  /**
   * Inject a badge-grid skeleton into #s-badges (or given container).
   * @param {Element|string} [container='#s-badges']
   * @param {number}         [cardCount=9]
   */
  window.eqShowBadgeGridSkeleton = function (container, cardCount) {
    var el = typeof container === 'string'
      ? document.querySelector(container)
      : (container || document.getElementById('s-badges'));
    if (!el) return;
    var n = cardCount || 9;

    var cards = '';
    for (var i = 0; i < n; i++) {
      cards += '<div class="skeleton-shimmer sk-badge-card spring-delay-' + Math.min(i + 1, 6) + '"></div>';
    }

    el.innerHTML = [
      '<div style="padding:0 4px">',
      '  <!-- header hero placeholder -->',
      '  <div class="skeleton-shimmer sk-badge-card" style="height:120px;border-radius:20px;margin-bottom:20px"></div>',
      '  <!-- stat bar -->',
      '  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">',
      '    <div class="skeleton-shimmer" style="height:64px;border-radius:12px"></div>',
      '    <div class="skeleton-shimmer" style="height:64px;border-radius:12px;animation-delay:.10s"></div>',
      '    <div class="skeleton-shimmer" style="height:64px;border-radius:12px;animation-delay:.20s"></div>',
      '    <div class="skeleton-shimmer" style="height:64px;border-radius:12px;animation-delay:.30s"></div>',
      '  </div>',
      '  <!-- tab bar placeholder -->',
      '  <div class="skeleton-shimmer" style="height:40px;border-radius:8px;margin-bottom:20px;width:70%"></div>',
      '  <!-- badge grid -->',
      '  <div class="sk-badge-grid">' + cards + '</div>',
      '</div>',
    ].join('');
  };

  /**
   * Inject a loot-reward-card grid skeleton.
   * @param {Element|string} container
   * @param {number}         [cardCount=4]
   */
  window.eqShowLootGridSkeleton = function (container, cardCount) {
    var el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    var n = cardCount || 4;

    var cards = '';
    for (var i = 0; i < n; i++) {
      cards += '<div class="skeleton-shimmer sk-loot-card" style="animation-delay:' + (i * 0.08) + 's"></div>';
    }
    el.innerHTML = '<div class="sk-loot-grid">' + cards + '</div>';
  };

  /**
   * Inject a mail-list skeleton into #s-mail (or given container).
   * @param {Element|string} [container='#s-mail']
   * @param {number}         [rowCount=5]
   */
  window.eqShowMailListSkeleton = function (container, rowCount) {
    var el = typeof container === 'string'
      ? document.querySelector(container)
      : (container || document.getElementById('s-mail'));
    if (!el) return;
    var n = rowCount || 5;

    var rows = '';
    for (var i = 0; i < n; i++) {
      rows += '<div class="skeleton-shimmer sk-mail-item" style="animation-delay:' + (i * 0.09) + 's"></div>';
    }
    el.innerHTML = [
      '<div style="padding:20px">',
      '  <div class="skeleton-shimmer" style="height:130px;border-radius:20px;margin-bottom:20px"></div>',
      '  <div class="sk-mail-list">' + rows + '</div>',
      '</div>',
    ].join('');
  };


  /* ─────────────────────────────────────────────────────────────────────────
     §2  OPTIMISTIC wblrClaimReward  (replaces loot-rain.js version)
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * Patched wblrClaimReward with full optimistic flow:
   *   1. Immediately mark the token as .claiming (visual lock + spring exit).
   *   2. Fire the burst ring at the token's position.
   *   3. Delegate to LootService.claimReward() (the real data layer).
   *   4a. Success → add .claimed-ok, update HUD, fire spring pop on HUD chip.
   *   4b. Failure → roll back token state with .btn-claimed-err, shake, re-enable.
   */
  window.wblrClaimReward = function (bossIdx, rewardId, tokenEl) {
    if (typeof currentRole === 'undefined' || currentRole !== 'student' || !currentUser) return;
    if (!tokenEl) return;

    // ── Optimistic: lock the token immediately ────────────────────────────
    if (tokenEl.classList.contains('claiming-in-flight')) return; // prevent double-tap
    tokenEl.classList.add('claiming-in-flight', 'btn-claiming');
    tokenEl.style.pointerEvents = 'none';

    // Fire burst ring at click position
    var meta = (typeof wblrRarityMeta === 'function')
      ? wblrRarityMeta(tokenEl.dataset.rarity || 'common')
      : { color: '#d0bcff' };
    eqFireClaimBurst(tokenEl, meta.color);

    // ── Service call ──────────────────────────────────────────────────────
    var result;
    try {
      result = LootService.claimReward(bossIdx, rewardId, currentUser);
    } catch (err) {
      console.error('[wblrClaimReward] LootService threw:', err);
      result = { ok: false, reason: 'An unexpected error occurred. Please try again.' };
    }

    // ── Branch: failure rollback ──────────────────────────────────────────
    if (!result.ok) {
      // Already-gone tokens should disappear silently
      if (result.reason && result.reason.includes('already gone')) {
        tokenEl.classList.add('claimed');
        setTimeout(function () { if (tokenEl.parentNode) tokenEl.remove(); }, 260);
      } else {
        // Rollback: shake the token, then re-enable it
        tokenEl.classList.remove('claiming-in-flight', 'btn-claiming');
        tokenEl.classList.add('btn-claimed-err');
        tokenEl.style.pointerEvents = '';
        setTimeout(function () {
          tokenEl.classList.remove('btn-claimed-err');
        }, 500);
        if (typeof toast === 'function') {
          toast(result.reason || 'Cannot claim reward.', '#ffb4ab');
        }
      }
      return;
    }

    // ── Branch: optimistic success ────────────────────────────────────────
    // Spring-exit the token visually
    tokenEl.classList.add('claimed');
    setTimeout(function () {
      if (tokenEl.parentNode) tokenEl.remove();
    }, 260);

    // Flash the success toast
    var rewardMeta = (typeof wblrRarityMeta === 'function')
      ? wblrRarityMeta(result.reward.rarity)
      : { color: '#4edea3' };
    if (typeof toast === 'function') {
      toast('✨ Claimed ' + result.reward.itemName + '!', rewardMeta.color);
    }

    // Refresh HUD with spring micro-interaction
    var boss = AppStore.getBossEvent(bossIdx);
    wblrRefreshLootHud(bossIdx, boss);

    // Spring-pop the "items left" chip so the number change is noticed
    var remEl = document.getElementById('wblr-remaining');
    if (remEl) eqSpringPop(remEl.closest('.wblr-hud-chip') || remEl, 'spring-pop');

    if (typeof wblrSyncRainTokens === 'function') wblrSyncRainTokens(bossIdx, boss);
    if (typeof updateTopbar === 'function') updateTopbar();
    // Phase 44: persist the claim server-side (the optimistic commit above
    // was local-only until now). wblrSyncClaimRewardRpc rolls the local
    // claim back if the server definitively rejects it (race actually lost).
    if (typeof wblrSyncClaimRewardRpc === 'function') wblrSyncClaimRewardRpc(bossIdx, rewardId, result.claim);
    // Phase 25: fire finalize_loot_rush() only when this call actually
    // finalized the rush, mirroring the same guard added at the other
    // maybeAutoFinalize call sites in loot-rain.js.
    var autoFinalizeResult = LootService.maybeAutoFinalize(bossIdx);
    if (autoFinalizeResult.finalized && typeof wblrSyncFinalizeLootRpc === 'function') {
      wblrSyncFinalizeLootRpc(bossIdx);
    }
  };


  /* ─────────────────────────────────────────────────────────────────────────
     §3  OPTIMISTIC achClaimReward  (replaces ach_student_page.js version)
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * Patched achClaimReward with optimistic badge-card state changes:
   *   1. Immediately swap the CLAIM button → "Claiming…" visual.
   *   2. Fire burst ring on the badge card.
   *   3. Delegate to achGrantRewardsForClaim() (the engine).
   *   4a. Success → keep claimed state, open eqRewardPresent overlay.
   *   4b. Failure → rollback card state, notify user.
   */
  window.achClaimReward = function (achId) {
    // FIX: this used to check window.currentUser/window.currentRole, but
    // currentUser/currentRole are declared with `let` at the top of
    // index.html's inline script — that does NOT create window properties,
    // only a shared lexical binding across classic <script> tags. So
    // window.currentUser was always undefined and this guard silently
    // blocked every claim, even while genuinely logged in as a student.
    // Use the bare identifiers, same as the rest of the app.
    if (!currentUser || currentRole !== 'student') return;

    // Locate the claim button for this achievement card
    var claimBtn = document.querySelector('.ach-badge-card [onclick*="achClaimReward(\'' + achId + '\')"]');
    var card     = claimBtn ? claimBtn.closest('.ach-badge-card') : null;

    // Guard: already in-flight?
    if (claimBtn && claimBtn.classList.contains('claiming-in-flight')) return;

    // ── Validate locally before touching the DOM ──────────────────────────
    var DB_local = (typeof loadDB === 'function') ? loadDB() : window.DB;
    if (!DB_local) return;
    var ach = (DB_local.achievements || []).find(function (a) { return a.id === achId; });
    if (!ach) return;
    var unlocks = (DB_local.achievementUnlocks || {})[currentUser.id] || [];
    var rec     = unlocks.find(function (u) { return u.achId === achId; });
    if (!rec || rec.claimed) {
      if (typeof toast === 'function') toast('Already claimed.', '#ffb4ab');
      return;
    }

    // ── Optimistic DOM update ─────────────────────────────────────────────
    if (claimBtn) {
      claimBtn.classList.add('claiming-in-flight', 'btn-claiming');
      var originalLabel = claimBtn.innerHTML;
      claimBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;animation:skShimmerSlide 1s linear infinite">autorenew</span> Claiming…';
    }
    if (card) {
      eqFireClaimBurst(card, '#d0bcff');
      eqSpringPop(card, 'spring-bounce');
    }

    // ── Build reward list ─────────────────────────────────────────────────
    var rewards = [];
    if ((rec.xpGranted    || 0) > 0) rewards.push({ type: 'xp',    amount: rec.xpGranted,    icon: '⚡', label: 'XP',    color: 'var(--primary)'  });
    if ((rec.coinsGranted || 0) > 0) rewards.push({ type: 'coins', amount: rec.coinsGranted,  icon: '🪙', label: 'Coins', color: 'var(--tertiary)' });

    var linkedTitle = (DB_local.titles || []).find(function (t) { return t.achievementId === achId && t.active; });
    if (linkedTitle) rewards.push({ type: 'title', amount: 1, icon: linkedTitle.icon || '🎖️', label: linkedTitle.name, color: '#EC4899', titleId: linkedTitle.id });

    // ── Grant via engine ──────────────────────────────────────────────────
    var granted;
    try {
      granted = (typeof achGrantRewardsForClaim === 'function')
        ? achGrantRewardsForClaim(currentUser.id, achId)
        : false;
    } catch (err) {
      console.error('[achClaimReward] engine threw:', err);
      granted = false;
    }

    if (granted === false) {
      // Rollback
      if (claimBtn) {
        claimBtn.classList.remove('claiming-in-flight', 'btn-claiming');
        claimBtn.classList.add('btn-claimed-err');
        claimBtn.innerHTML = originalLabel || 'Claim Reward →';
        claimBtn.style.pointerEvents = '';
        setTimeout(function () { claimBtn.classList.remove('btn-claimed-err'); }, 600);
      }
      if (typeof toast === 'function') toast('This achievement has already been claimed.', '#ffb4ab');
      return;
    }

    // ── Success: mark button as claimed-ok ────────────────────────────────
    if (claimBtn) {
      claimBtn.classList.remove('claiming-in-flight', 'btn-claiming');
      claimBtn.classList.add('btn-claimed-ok');
      claimBtn.innerHTML = '✓ Claimed!';
    }

    // Grant linked title (typeof guard)
    if (linkedTitle && typeof tsUnlockTitleForStudent === 'function') {
      tsUnlockTitleForStudent(currentUser.id, linkedTitle.id, false);
    }

    // Present via universal reward presenter (or toast fallback)
    var _present = (typeof eqRewardPresent === 'function') ? eqRewardPresent
                 : (typeof window.eqRewardPresent === 'function') ? window.eqRewardPresent
                 : null;

    if (!_present) {
      if (typeof toast === 'function') toast('🏅 ' + ach.name + ' claimed!', '#d0bcff');
      if (typeof renderBadges === 'function') renderBadges();
      return;
    }

    _present({
      title:    'Achievement Claimed!',
      subtitle: ach.name,
      icon:     ach.icon || '🏅',
      rarity:   ach.rarity || 'Common',
      source:   'achievement',
      rewards:  rewards,
      onClose: function () {
        if (typeof renderBadges === 'function') renderBadges();
        if (typeof renderStudentDashboard === 'function') renderStudentDashboard();
      },
    });
  };


  /* ─────────────────────────────────────────────────────────────────────────
     §4  OPTIMISTIC mailDoClaimRewards  (replaces student-inbox.js version)
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * Patched mailDoClaimRewards with optimistic button state:
   *   1. Immediately lock the button and show a processing shimmer.
   *   2. Call mailClaimRewards() (synchronous engine).
   *   3a. Success → close modal, open reward presenter.
   *   3b. Failure → rollback button, notify user without locking the UI.
   */
  window.mailDoClaimRewards = function (mailId) {
    // FIX: same window.currentUser/window.currentRole bug as achClaimReward
    // above — those were never populated (currentUser/currentRole are
    // lexical `let` bindings, not window properties), so this guard fired
    // every time regardless of actual login state. Use the bare identifiers.
    if (!currentUser || currentRole !== 'student') {
      if (typeof toast === 'function') toast('❌ You must be logged in as a student', '#ffb4ab');
      return;
    }

    // Locate claim button inside the open modal
    var claimBtn = document.querySelector('.mail-claim-btn[onclick*="mailDoClaimRewards(\'' + mailId + '\')"]');
    if (!claimBtn) {
      // Fallback: find any visible mail-claim-btn
      claimBtn = document.querySelector('.mail-claim-btn');
    }

    // Guard: prevent double-tap
    if (claimBtn && claimBtn.classList.contains('claiming-in-flight')) return;

    // ── Optimistic: lock button ───────────────────────────────────────────
    var originalHTML;
    if (claimBtn) {
      originalHTML = claimBtn.innerHTML;
      claimBtn.classList.add('claiming-in-flight', 'btn-claiming');
      claimBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">sync</span> Claiming…';
      claimBtn.disabled  = true;
      eqFireClaimBurst(claimBtn, '#ffb95f');
    }

    // ── Service call ──────────────────────────────────────────────────────
    var rewards;
    try {
      rewards = (typeof mailClaimRewards === 'function')
        ? mailClaimRewards(mailId, currentUser.id)
        : false;
    } catch (err) {
      console.error('[mailDoClaimRewards] engine threw:', err);
      rewards = false;
    }

    // ── Branch: failure rollback ──────────────────────────────────────────
    if (!rewards || (Array.isArray(rewards) && rewards.length === 0)) {
      if (claimBtn) {
        claimBtn.classList.remove('claiming-in-flight', 'btn-claiming');
        claimBtn.classList.add('btn-claimed-err');
        claimBtn.innerHTML = originalHTML || 'Claim Rewards';
        claimBtn.disabled  = false;
        claimBtn.style.pointerEvents = '';
        setTimeout(function () { claimBtn.classList.remove('btn-claimed-err'); }, 600);
      }
      if (typeof toast === 'function') toast('❌ Rewards already claimed or mail not found.', '#ffb4ab');
      return;
    }

    // ── Branch: success ───────────────────────────────────────────────────
    if (claimBtn) {
      claimBtn.classList.remove('claiming-in-flight', 'btn-claiming');
      claimBtn.classList.add('btn-claimed-ok');
      claimBtn.innerHTML = '✓ Rewards Claimed!';
    }

    // Determine rarity for presenter
    var rarity = 'Common';
    var hasTitle = rewards.some(function (r) { return r.type === 'title'; });
    var hasBigCoin = rewards.some(function (r) { return r.type === 'coins' && parseInt(r.amount || 0) > 100; });
    var hasBigXP   = rewards.some(function (r) { return r.type === 'xp'    && parseInt(r.amount || 0) > 200; });
    if (hasTitle)              rarity = 'Legendary';
    else if (hasBigCoin || hasBigXP) rarity = 'Rare';

    var MAIL_ICONS = { announcement: '📢', reward: '🎁', gift: '🎀', event: '🎉', title: '🎖️', compensation: '💎', general: '📬' };
    var mailIcon = MAIL_ICONS.reward;

    // Brief delay so the button's claimed-ok state is visible before modal closes
    setTimeout(function () {
      if (typeof closeModalForce === 'function') closeModalForce();

      if (typeof eqRewardPresent !== 'function') {
        // Fallback: no presenter
        if (typeof toast === 'function') toast('📬 Mail rewards claimed!', '#ffb95f');
        if (typeof renderStudentMail === 'function') renderStudentMail();
        return;
      }

      eqRewardPresent({
        title:    'Mail Rewards Claimed!',
        subtitle: 'Excellent rewards!',
        icon:     mailIcon,
        rarity:   rarity,
        source:   'mail',
        rewards:  rewards,
        onClose: function () {
          if (typeof renderStudentMail === 'function') {
            // Show skeleton for perceived-speed while mail re-renders
            eqShowMailListSkeleton('#s-mail', 5);
            // renderStudentMail() is synchronous so it replaces the skeleton immediately
            renderStudentMail();
          }
        },
      });
    }, 180);
  };


  /* ─────────────────────────────────────────────────────────────────────────
     §5  SKELETON-GUARDED renderBadges  (wraps existing renderBadges)
     ──────────────────────────────────────────────────────────────────────── */

  /**
   * Wraps the original renderBadges() so that if the page element is empty
   * (first load / tab switch) a skeleton grid appears instantly while the
   * real render runs.
   */
  (function patchRenderBadges() {
    var _orig = window.renderBadges;
    if (typeof _orig !== 'function') return; // loaded before ach_student_page.js; no-op

    window.renderBadges = function () {
      var page = document.getElementById('s-badges');
      // Show skeleton only when the page is blank (first open or cleared)
      if (page && page.innerHTML.trim() === '') {
        eqShowBadgeGridSkeleton(page, 9);
        // rAF so the skeleton paints before the real render blocks the thread
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            _orig.apply(this, arguments);
          }.bind(this));
        }.bind(this));
      } else {
        _orig.apply(this, arguments);
      }
    };
  }());


  /* ─────────────────────────────────────────────────────────────────────────
     §6  SKELETON-GUARDED renderStudentMail  (wraps existing)
     ──────────────────────────────────────────────────────────────────────── */

  (function patchRenderStudentMail() {
    var _orig = window.renderStudentMail;
    if (typeof _orig !== 'function') return;

    window.renderStudentMail = function () {
      var page = document.getElementById('s-mail');
      if (page && page.innerHTML.trim() === '') {
        eqShowMailListSkeleton(page, 5);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            _orig.apply(this, arguments);
          }.bind(this));
        }.bind(this));
      } else {
        _orig.apply(this, arguments);
      }
    };
  }());


  /* ─────────────────────────────────────────────────────────────────────────
     §7  SKELETON-GUARDED wblrRenderStudentLootPage  (wraps existing)
     ──────────────────────────────────────────────────────────────────────── */

  (function patchRenderStudentLootPage() {
    var _orig = window.wblrRenderStudentLootPage;
    if (typeof _orig !== 'function') return;

    window.wblrRenderStudentLootPage = function (bossIdx) {
      var page = document.getElementById('s-world-boss');
      if (page && page.innerHTML.trim() === '') {
        eqShowBossStatusSkeleton(page, 4);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            _orig.call(window, bossIdx);
          });
        });
      } else {
        _orig.call(window, bossIdx);
      }
    };
  }());


  /* ─────────────────────────────────────────────────────────────────────────
     §8  SPRING ENTRANCE: CBL reward tokens
     Adds spring-pop to each .cbl-token as it is appended to the battlefield.
     We hook into the MutationObserver on the battlefield container.
     ──────────────────────────────────────────────────────────────────────── */

  (function observeCblBattlefield() {
    function watchField(field) {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mut) {
          mut.addedNodes.forEach(function (node) {
            if (node.nodeType === 1 && node.classList.contains('cbl-token')) {
              // The token already has cbl-burst animation — add spring class
              // after the burst settles so they compound, not conflict.
              var delay = parseFloat(node.style.getPropertyValue('--burst-delay') || '0') * 1000
                        + parseFloat(node.style.getPropertyValue('--burst-dur')   || '0.7') * 1000
                        + 60;
              setTimeout(function () {
                if (node.parentNode && !node.classList.contains('claimed')) {
                  node.classList.add('spring-hover');
                }
              }, delay);
            }
          });
        });
      });
      observer.observe(field, { childList: true });
    }

    // The battlefield may not exist at script load time; poll until it appears
    var attempts = 0;
    var poll = setInterval(function () {
      var field = document.getElementById('cbl-battlefield');
      if (field) { clearInterval(poll); watchField(field); }
      if (++attempts > 60) clearInterval(poll); // give up after ~30 s
    }, 500);
  }());


  /* ─────────────────────────────────────────────────────────────────────────
     §9  SPRING ENTRANCE: wblr rain tokens (wblr-rain-container)
     ──────────────────────────────────────────────────────────────────────── */

  (function observeRainContainer() {
    function watchContainer(container) {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mut) {
          mut.addedNodes.forEach(function (node) {
            if (node.nodeType === 1 && node.classList.contains('wblr-token')) {
              node.classList.add('spring-hover');
            }
          });
        });
      });
      observer.observe(container, { childList: true });
    }

    var attempts = 0;
    var poll = setInterval(function () {
      var container = document.getElementById('wblr-rain-container');
      if (container) { clearInterval(poll); watchContainer(container); }
      if (++attempts > 60) clearInterval(poll);
    }, 500);
  }());


  /* ─────────────────────────────────────────────────────────────────────────
     §10  SPRING ENTRANCE: Achievement badge cards on render
     ──────────────────────────────────────────────────────────────────────── */

  (function observeBadgesPage() {
    var page = null;
    function watchPage(el) {
      var observer = new MutationObserver(function () {
        // When badges-grid is repopulated, stagger spring-bounce on each card
        var cards = el.querySelectorAll('.ach-badge-card:not(.spring-inited)');
        cards.forEach(function (card, idx) {
          card.classList.add('spring-inited');
          card.style.animationDelay = (idx * 0.04) + 's';
          card.classList.add('spring-bounce');
          card.addEventListener('animationend', function handler() {
            card.classList.remove('spring-bounce');
            card.style.animationDelay = '';
            card.removeEventListener('animationend', handler);
          });
        });
      });
      observer.observe(el, { childList: true, subtree: true });
    }

    var attempts = 0;
    var poll = setInterval(function () {
      page = document.getElementById('s-badges');
      if (page) { clearInterval(poll); watchPage(page); }
      if (++attempts > 60) clearInterval(poll);
    }, 500);
  }());

  console.log('[EduQuest] perceived-speed.js loaded — Optimistic claims, Spring animations, Skeleton loaders active.');

}(window));
