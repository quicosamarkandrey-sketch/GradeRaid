/**
 * EduQuest — LootService (loot-service.js) v2
 * ══════════════════════════════════════════════════════════════════════════════
 * Domain service layer for World Boss Loot Rush.
 *
 * Contract:
 *  • All public methods return a plain result object { ok, reason?, … }.
 *  • State mutations go exclusively through AppStore.updateState().
 *  • No direct localStorage / saveDB() / loadDB() calls.
 *  • No DOM access.
 *  • Pure computation helpers (_loot*) are testable in isolation.
 *
 * Requires: AppStore (state-manager.js), uid() (utils.js)
 * Must load BEFORE: loot-rain.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

window.LootService = (function () {
  'use strict';

  // ─── Pure Computation Helpers ─────────────────────────────────────────────
  // These receive plain data objects and return values.
  // They never touch AppStore, localStorage, or the DOM.

  function _lootNormalizeRewards(rewards) {
    return (rewards || []).map(function (r, i) {
      return {
        id:         r.id || uid(),
        itemName:   String(r.itemName || r.name || ('Reward ' + (i + 1))).trim(),
        quantity:   Math.max(0, parseInt(r.quantity ?? r.quantityAvailable ?? r.qty) || 0),
        rarity:     (typeof wblrRarityLabel === 'function') ? wblrRarityLabel(r.rarity || 'Common') : (r.rarity || 'Common'),
        claimLimit: Math.max(1, parseInt(r.claimLimit) || 1),
      };
    }).filter(function (r) { return r.itemName && r.quantity > 0; });
  }

  function _lootClaims(boss) {
    return Array.isArray(boss.lootClaims) ? boss.lootClaims : [];
  }

  function _lootClaimCount(boss, rewardId) {
    return _lootClaims(boss).filter(function (c) { return c.rewardId === rewardId; }).length;
  }

  /**
   * How many of this reward are still claimable?
   * Used in unit tests directly: LootService.remaining(boss, reward)
   */
  function remaining(boss, reward) {
    return Math.max(0, (parseInt(reward.quantity) || 0) - _lootClaimCount(boss, reward.id));
  }

  function _lootRemainingTotal(boss) {
    var rewards = boss.lootRewards || [];
    return rewards.reduce(function (acc, r) { return acc + remaining(boss, r); }, 0);
  }

  function _lootClaimedByStudent(boss, rewardId, studentId) {
    return _lootClaims(boss).filter(function (c) {
      return c.rewardId === rewardId && c.studentId === studentId;
    }).length;
  }

  /**
   * Validate whether a student can claim a specific reward.
   * Returns { ok: true } or { ok: false, reason: string, alreadyGone?: true }
   * Used in unit tests directly: LootService.validateClaim(boss, rewardId, studentId)
   */
  function validateClaim(boss, rewardId, studentId) {
    if (!boss || boss.status !== 'loot') {
      return { ok: false, reason: 'Loot Rush has ended.' };
    }
    if (boss.lootFinalizedAt) {
      return { ok: false, reason: 'Loot Rush has been finalized.' };
    }
    var rewards = boss.lootRewards || [];
    var reward  = rewards.find(function (r) { return r.id === rewardId; });
    if (!reward) {
      return { ok: false, reason: 'Reward not found.' };
    }
    if (remaining(boss, reward) <= 0) {
      return { ok: false, reason: 'That reward is already gone.', alreadyGone: true };
    }
    var mine  = _lootClaimedByStudent(boss, rewardId, studentId);
    var limit = parseInt(reward.claimLimit) || 1;
    if (mine >= limit) {
      return { ok: false, reason: 'Claim limit reached for ' + reward.itemName + '.' };
    }
    return { ok: true, reward: reward };
  }

  // ─── Public Service Methods ───────────────────────────────────────────────

  /**
   * Claim a loot reward for a student.
   * @param {number} bossIdx
   * @param {string} rewardId
   * @param {object} student  — { id, name, init, color }
   * @returns {{ ok, reason?, reward?, alreadyGone? }}
   */
  function claimReward(bossIdx, rewardId, student) {
    // Read current state for validation (targeted slice)
    var boss = AppStore.getBossEvent(bossIdx);
    if (!boss) return { ok: false, reason: 'Boss event not found.' };

    var validation = validateClaim(boss, rewardId, student.id);
    if (!validation.ok) return validation;

    var reward = validation.reward;
    var claim  = {
      id:           uid(),
      rewardId:     reward.id,
      itemName:     reward.itemName,
      rarity:       reward.rarity,
      studentId:    student.id,
      studentName:  student.name,
      studentInit:  student.init,
      studentColor: student.color,
      claimedAt:    Date.now(),
    };

    AppStore.updateState(function (draft) {
      var b = draft.bossEvents[bossIdx];
      if (!b) return;
      if (!Array.isArray(b.lootClaims)) b.lootClaims = [];
      b.lootClaims.push(claim);

      // Phase 48: claimed loot now upserts into draft.inventory[studentId] —
      // the exact same shape/upsert-by-itemId logic shop_store.js's
      // cartCheckout() already uses for shop purchases — instead of the old
      // student.bossLoot array, which nothing else in the codebase ever
      // read (confirmed dead end; see phase48_shop_orders_inventory_sync.sql
      // header note). This is what makes claimed boss loot actually show up
      // on the student-facing "My Inventory" page (shop_inventory.js reads
      // exclusively from DB.inventory[studentId]) and what lets it ride the
      // same inventory table/RLS/sync path shop purchases already use —
      // no separate boss-loot column or sync path needed.
      if (!draft.inventory) draft.inventory = {};
      if (!Array.isArray(draft.inventory[student.id])) draft.inventory[student.id] = [];
      var invList = draft.inventory[student.id];
      // Stable per-reward-definition id (not per-claim) so claiming the same
      // reward more than once (claimLimit > 1) stacks quantity instead of
      // creating duplicate rows, same as a repeat shop purchase of one item.
      var lootItemId = 'loot_' + reward.id;
      var existingItem = invList.find(function (i) { return i.itemId === lootItemId; });
      if (existingItem) {
        existingItem.quantity = (existingItem.quantity || 1) + 1;
        existingItem.lastPurchased = todayStr() + ' ' + nowStr();
      } else {
        invList.unshift({
          itemId: lootItemId, itemName: reward.itemName, emoji: '🎁', category: 'unknown',
          quantity: 1, datePurchased: todayStr() + ' at ' + nowStr(),
          source: 'Boss Loot', status: 'active',
        });
      }
    }, { type: 'loot:claimed', payload: { bossIdx: bossIdx, rewardId: rewardId, studentId: student.id } });

    return { ok: true, reward: reward, claim: claim };
  }

  /**
   * Roll back a local claim that the server (claim_loot_reward RPC)
   * definitively rejected after the local optimistic commit — e.g. the
   * claim actually lost a race against another student's near-simultaneous
   * claim and the reward was really gone by the time the RPC's row lock
   * resolved it. Removes both the boss's lootClaims entry and decrements
   * (or removes, if it hits zero) the matching DB.inventory[studentId] item,
   * mirroring exactly what claimReward() added.
   * @param {number} bossIdx
   * @param {string} claimId
   * @param {string} studentId
   */
  function rollbackClaim(bossIdx, claimId, studentId) {
    AppStore.updateState(function (draft) {
      var b = draft.bossEvents[bossIdx];
      if (!b) return;
      var claim = (b.lootClaims || []).find(function (c) { return c.id === claimId; });
      if (!Array.isArray(b.lootClaims)) b.lootClaims = [];
      b.lootClaims = b.lootClaims.filter(function (c) { return c.id !== claimId; });

      if (claim && draft.inventory && Array.isArray(draft.inventory[studentId])) {
        var invList     = draft.inventory[studentId];
        var lootItemId  = 'loot_' + claim.rewardId;
        var idx         = invList.findIndex(function (i) { return i.itemId === lootItemId; });
        if (idx >= 0) {
          invList[idx].quantity = (invList[idx].quantity || 1) - 1;
          if (invList[idx].quantity <= 0) invList.splice(idx, 1);
        }
      }
    }, { type: 'loot:claim-rolled-back', payload: { bossIdx: bossIdx, claimId: claimId, studentId: studentId } });
  }

  /**
   * Transition a boss event to 'loot' status and initialise loot state.
   * Idempotent — safe to call if loot is already active.
   * @param {number} bossIdx
   * @returns {{ ok, alreadyActive? }}
   */
  function prepareLootRush(bossIdx) {
    var boss = AppStore.getBossEvent(bossIdx);
    if (!boss) return { ok: false, reason: 'Boss event not found.' };

    if (boss.status === 'loot') {
      return { ok: true, alreadyActive: true };
    }

    AppStore.updateState(function (draft) {
      var b = draft.bossEvents[bossIdx];
      if (!b) return;
      b.status          = 'loot';
      b.defeatedAt      = Date.now();
      b.lootStartedAt   = Date.now();
      b.lootFinalizedAt = null;
      b.lootClaims      = [];
      if (!b.lootRewards || !b.lootRewards.length) {
        b.lootRewards = (typeof wblrDefaultRewards === 'function') ? wblrDefaultRewards() : [];
      }
      b.lootRewards = _lootNormalizeRewards(b.lootRewards);
    }, { type: 'loot:rush-started', payload: { bossIdx: bossIdx } });

    return { ok: true, alreadyActive: false };
  }

  /**
   * Auto-finalize the loot rush if all rewards are claimed or time has expired.
   * @param {number} bossIdx
   * @returns {{ finalized: boolean }}
   */
  function maybeAutoFinalize(bossIdx) {
    var boss = AppStore.getBossEvent(bossIdx);
    if (!boss || boss.status !== 'loot' || boss.lootFinalizedAt) {
      return { finalized: false };
    }
    var totalRemaining = _lootRemainingTotal(boss);
    var elapsed        = Date.now() - (boss.lootStartedAt || Date.now());
    var duration       = (boss.lootDuration || 120) * 1000;

    if (totalRemaining <= 0 || elapsed >= duration) {
      return finalizeLoot(bossIdx, 'auto');
    }
    return { finalized: false };
  }

  /**
   * Finalize the loot rush for a boss event.
   * @param {number} bossIdx
   * @param {string} source  — 'auto' | 'manual' | 'student_exit' | ...
   * @returns {{ ok, alreadyFinalized? }}
   */
  function finalizeLoot(bossIdx, source) {
    var boss = AppStore.getBossEvent(bossIdx);
    if (!boss) return { ok: false, reason: 'Boss event not found.' };
    if (boss.lootFinalizedAt) return { ok: true, alreadyFinalized: true, finalized: false };

    AppStore.updateState(function (draft) {
      var b = draft.bossEvents[bossIdx];
      if (!b || b.lootFinalizedAt) return;
      b.lootFinalizedAt = Date.now();
      // BUGFIX (boss never properly ends): finalizing the loot rush used to
      // only set lootFinalizedAt, leaving `status` stuck at 'loot' forever.
      // There is no UI button to end a 'loot'-status boss directly (End
      // Event only shows for 'active') — the ONLY way out was activating a
      // *different* boss in the same section, which force-ends this one as
      // a side effect but never syncs that to Supabase. Finalizing the loot
      // rush IS the natural end of the encounter, so it should actually end
      // it — same status/endedAt this boss would get from a manual
      // bossEnd(), just reached automatically instead of requiring a
      // teacher to notice and intervene.
      b.status  = 'ended';
      b.endedAt = Date.now();
    }, { type: 'loot:finalized', payload: { bossIdx: bossIdx, source: source } });

    return { ok: true, alreadyFinalized: false, finalized: true };
  }

  /**
   * Persist admin-configured loot settings for a boss event.
   * @param {number} bossIdx
   * @param {{ lootDuration: number, rewards: Array }} settings
   * @returns {{ ok, reason? }}
   */
  function saveLootSettings(bossIdx, settings) {
    if (!settings || !Array.isArray(settings.rewards)) {
      return { ok: false, reason: 'Invalid settings.' };
    }

    var normalized = _lootNormalizeRewards(settings.rewards);
    if (!normalized.length) {
      return { ok: false, reason: 'Add at least one loot reward.' };
    }

    var boss = AppStore.getBossEvent(bossIdx);
    if (!boss) return { ok: false, reason: 'Boss event not found.' };

    // Preserve existing claim counts
    var claims = _lootClaims(boss);
    normalized = normalized.map(function (r) {
      var already = claims.filter(function (c) { return c.rewardId === r.id; }).length;
      return Object.assign({}, r, { quantity: Math.max(r.quantity, already) });
    });

    AppStore.updateState(function (draft) {
      var b = draft.bossEvents[bossIdx];
      if (!b) return;
      b.lootDuration = parseInt(settings.lootDuration) || 120;
      b.lootRewards  = normalized;
    }, { type: 'loot:settings-saved', payload: { bossIdx: bossIdx } });

    return { ok: true };
  }

  /**
   * Mark _lootRainShown on the boss so it only fires once per student session.
   * @param {number} bossIdx
   */
  function markLootRainShown(bossIdx) {
    AppStore.updateState(function (draft) {
      var b = draft.bossEvents[bossIdx];
      if (b) b._lootRainShown = true;
    }, { type: 'loot:rain-shown', payload: { bossIdx: bossIdx } });
  }

  /**
   * Find the currently active (non-finalized) loot boss.
   * @returns {{ boss, idx } | null}
   */
  function getCurrentLootBoss() {
    var events = AppStore.getSlice(function (s) { return s.bossEvents; }) || [];
    var idx    = events.findIndex(function (b) {
      return b.status === 'loot' && !b.lootFinalizedAt;
    });
    return idx >= 0 ? { boss: events[idx], idx: idx } : null;
  }

  /**
   * Find the most recently finalized loot boss.
   * @returns {{ boss, idx } | null}
   */
  function getLatestSummaryBoss() {
    var events    = AppStore.getSlice(function (s) { return s.bossEvents; }) || [];
    var finalized = events
      .map(function (b, i) { return { b: b, i: i }; })
      // BUGFIX: this used to also require status === 'loot', which was true
      // back when finalizeLoot() never advanced status past 'loot'. Now
      // that finalizing correctly moves a boss to 'ended' (see
      // finalizeLoot() above), lootFinalizedAt alone is the right signal —
      // it's only ever set by a completed loot rush, on any boss whose
      // status has since moved on to 'ended' (or been reset by a fresh
      // Activate, which already clears lootFinalizedAt).
      .filter(function (x) { return !!x.b.lootFinalizedAt; });
    if (!finalized.length) return null;
    finalized.sort(function (a, b) {
      return (b.b.lootFinalizedAt || 0) - (a.b.lootFinalizedAt || 0);
    });
    return { boss: finalized[0].b, idx: finalized[0].i };
  }

  // ─── Expose Public Interface ──────────────────────────────────────────────
  return {
    // Service methods
    claimReward:       claimReward,
    rollbackClaim:     rollbackClaim,
    prepareLootRush:   prepareLootRush,
    maybeAutoFinalize: maybeAutoFinalize,
    finalizeLoot:      finalizeLoot,
    saveLootSettings:  saveLootSettings,
    markLootRainShown: markLootRainShown,
    getCurrentLootBoss:    getCurrentLootBoss,
    getLatestSummaryBoss:  getLatestSummaryBoss,
    // Pure computation helpers (unit-testable)
    remaining:     remaining,
    validateClaim: validateClaim,
  };

}());
