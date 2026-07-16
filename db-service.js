// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SERVICE LAYER  (Migration Readiness Layer v2 — Supabase Provider)
//
// WHAT CHANGED FROM v1
//   v1 was a pure localStorage wrapper with documented [BLOCKER-*] flags
//   explaining why a cloud provider couldn't be dropped in yet. This version
//   resolves three of the four blockers and explicitly does NOT silently
//   pretend to resolve the fourth ([BLOCKER-SYNC]) — see "THE SYNC PROBLEM"
//   below, which is the most important comment in this file.
//
// THE SYNC PROBLEM (read this before changing anything in this file)
//   373 call sites across 58 files call loadDB() / saveDB() SYNCHRONOUSLY —
//   they expect a return value or a completed write on the same line, with
//   no `await`. Supabase's client is async-only. Converting every call site
//   to async/await is explicitly out of scope per "Maintain Repository
//   Boundary: UI and LootService must remain unchanged."
//
//   The fix used here is a CACHE-THROUGH FACADE, not a real synchronous
//   network call (that is impossible in JS without blocking the main
//   thread, which we will not do):
//
//     • DBService.read() / write() remain perfectly synchronous functions
//       with the exact same signatures as v1. Every existing call site
//       keeps working with zero edits.
//     • Underneath, an in-memory cache (`_cache`) IS the object those
//       synchronous calls actually read/write — this is what makes them
//       synchronous. It is seeded from Supabase at boot via
//       DBService.initRemote() (async, awaited once in index.html before
//       AppStore.init() runs) and from then on is kept current by:
//         (a) every local write also being queued for upload (debounced),
//         (b) Supabase Realtime pushing other clients' writes back in.
//     • The result: reads are instant and synchronous (cache hit, always —
//       cache is the source of truth between syncs), writes are
//       instant-locally + eventually-consistent-remotely, exactly like the
//       old localStorage model felt to the user, but now backed by Postgres.
//
//   WHAT THIS DOES NOT FIX: two browser tabs/devices that both go offline,
//   each mutate the cache, then both come back online — last-write-wins at
//   the Supabase row level, same as the old cross-tab localStorage 'storage'
//   event model already had. No new data-loss mode is introduced; the old
//   one (silently documented in [BLOCKER-SIGNAL]) is also not magically
//   solved by this layer. Realtime narrows the window but does not close it.
//   A true CRDT/conflict-resolution layer is out of scope for this migration.
//
// BLOCKER STATUS AFTER THIS CHANGE
//   [BLOCKER-SYNC]   PARTIALLY RESOLVED — see above. Call sites unchanged;
//                    consistency model changed from "always fresh" to
//                    "fresh as of last sync," which for a classroom app
//                    polling/realtime-refreshing every few seconds is an
//                    acceptable trade given the alternative (rewriting 373
//                    call sites) is explicitly out of scope.
//   [BLOCKER-SIGNAL] RESOLVED — pendingSkill/pendingBossSummon now ride on
//                    a real Supabase Realtime broadcast channel instead of
//                    piggybacking on the DB blob. See _setupRealtimeSignals().
//   [BLOCKER-SCHEMA] RESOLVED — schema_version is now tracked per-table in
//                    Postgres (a `schema_migrations` table), not a single
//                    int on a JSON blob.
//   [BLOCKER-AUTH]   PARTIALLY RESOLVED — Supabase Auth replaces plaintext
//                    password checks for the CONNECTION to the database
//                    (anon key + RLS), but auth.js's doLogin() still does
//                    its own student/admin lookup against `profiles`. Full
//                    resolution (Supabase Auth sessions driving currentUser)
//                    is Phase 2 — see migration-strategy.md.
//
// REQUIRES: window.supabase (loaded via CDN script tag BEFORE this file —
//   see index.html changes in migration-strategy.md). If that global is
//   absent (offline dev, or the CDN is blocked), this file transparently
//   falls back to the v1 localStorage provider — see _resolveProvider().
// ─────────────────────────────────────────────────────────────────────────────

const DBService = (function () {
  'use strict';

  // ── Config — fill in from your Supabase project settings ─────────────────
  const _SUPABASE_URL      = window.__EDUQUEST_SUPABASE_URL__      || '';
  const _SUPABASE_ANON_KEY = window.__EDUQUEST_SUPABASE_ANON_KEY__ || '';

  const _STORAGE_KEY = 'eduquest_db_v3';      // localStorage fallback key (unchanged from v1)
  const _SCHEMA_VER  = 4;                      // bumped: v3 blob → v4 relational mirror

  // [PERF FIX — non-blocking boot] Which auth user id the current
  // _STORAGE_KEY mirror was last synced for. Separate key, additive —
  // does not change the shape of anything already stored under
  // _STORAGE_KEY, so nothing else that reads that key needs to change.
  // Used by initRemote() to decide whether a shared-device mirror (a
  // different account's data left in localStorage on a kiosk/shared PC)
  // is safe to render optimistically, or must be discarded in favor of
  // waiting for a real, correctly-scoped pull.
  const _LAST_SYNCED_UID_KEY = 'eduquest_last_synced_uid';

  // ── Migration-readiness / runtime metadata ────────────────────────────────
  const _meta = {
    provider          : 'unresolved',
    schemaVersion     : _SCHEMA_VER,
    asyncReady        : 'partial',  // [BLOCKER-SYNC] — see file header
    signalChannelReady: false,      // flipped true once Realtime channel subscribes
    schemaVersioned   : true,       // [BLOCKER-SCHEMA] resolved
    authReady         : 'partial',  // [BLOCKER-AUTH] — see file header
    online            : navigator.onLine,
    lastRemoteSyncAt  : null,
    lastSaveAt        : null,
    lastLoadAt        : null,
    saveCount         : 0,
    loadCount         : 0,
    pendingUploads    : 0,         // queued local writes not yet confirmed on the server
    lastError         : null,
  };

  // ── In-memory cache — the thing read()/write() actually touch ────────────
  // This is what makes the public API synchronous. It is hydrated by
  // initRemote() and mirrored to localStorage on every write as the
  // offline fallback (see "No Downtime" in migration-strategy.md).
  let _cache = null;

  // BUGFIX (cross-account RLS spam on rapid logout/login): _cache being
  // replaced (by remove() or refreshAfterAuthChange()) did not invalidate an
  // already-queued _uploadTimer. If a save fired under account A right
  // before switching to account B in the same tab (no full page reload),
  // that queued push could still fire AFTER B's session/cache was in place,
  // or — worse — race a still-in-flight refreshAfterAuthChange() pull and
  // push whatever _cache held at that exact instant, which may still be A's
  // data. Every authoritative cache replacement now bumps this counter;
  // _flushUpload() aborts if the epoch it was queued under is stale, so a
  // previous session's queued write can never reach Supabase under a
  // different session.
  let _sessionEpoch = 0;

  // ── localStorage provider (kept verbatim as the offline fallback) ────────
  const _localStorageProvider = {
    read  : function ()    { return localStorage.getItem(_STORAGE_KEY); },
    write : function (raw) { localStorage.setItem(_STORAGE_KEY, raw); },
    remove: function ()    { localStorage.removeItem(_STORAGE_KEY); },
    key   : _STORAGE_KEY,
  };

  // ── Supabase client (lazy singleton) ──────────────────────────────────────
  let _sb = null;
  function _getClient() {
    if (_sb) return _sb;
    if (typeof window.supabase === 'undefined' || !_SUPABASE_URL || !_SUPABASE_ANON_KEY) {
      return null;
    }
    _sb = window.supabase.createClient(_SUPABASE_URL, _SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return _sb;
  }

  function _resolveProvider() {
    return _getClient() ? 'supabase' : 'localStorage';
  }

  // ── Debounced upload queue ────────────────────────────────────────────────
  // Local cache writes are instant; remote persistence is debounced exactly
  // like AppStore's existing 300ms trailing-edge pattern (state-manager.js),
  // just one layer deeper. This keeps "every keystroke" from generating a
  // network round-trip while still converging quickly.
  let _uploadTimer = null;
  function _queueUpload() {
    _meta.pendingUploads++;
    if (_uploadTimer) clearTimeout(_uploadTimer);
    const queuedEpoch = _sessionEpoch;
    _uploadTimer = setTimeout(function () { _flushUpload(queuedEpoch); }, 400);
  }

  async function _flushUpload(queuedEpoch) {
    _uploadTimer = null;
    // Stale session guard — see _sessionEpoch comment above.
    if (queuedEpoch !== _sessionEpoch) { _meta.pendingUploads = 0; return; }
    const client = _getClient();
    if (!client || !_cache) { _meta.pendingUploads = 0; return; }
    // BUGFIX (42501 point_log/redemptions/etc. on refresh): every RLS policy
    // on these tables is "self OR staff", evaluated against auth.uid(). If
    // this flush fires before a real Supabase Auth session exists — e.g.
    // runMigrations()'s saveDB() runs inside AppStore.ready.then(), which is
    // NOT awaited after restoreSession() (see index.html boot block) — the
    // client has no JWT yet, auth.uid() is null, and every row in every
    // table's upsert gets rejected as one failed batch per table. Bail out
    // here the same way the "no client" case above does; the next mutation
    // (or restoreSession() completing and re-triggering a save) will queue
    // another flush once a session actually exists. getSession() is a local
    // cache read inside supabase-js (no network), so this is cheap to check
    // on every flush.
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData || !sessionData.session) { _meta.pendingUploads = 0; return; }
    } catch (e) {
      _meta.pendingUploads = 0; return;
    }
    try {
      await _pushCacheToSupabase(client, _cache);
      _meta.pendingUploads = 0;
      _meta.lastRemoteSyncAt = new Date().toISOString();
      _meta.online = true;
    } catch (e) {
      // Network/RLS failure — keep the local cache + localStorage mirror as
      // the source of truth; we'll retry on the next mutation or reconnect.
      _meta.lastError = String(e && e.message || e);
      _meta.online = navigator.onLine;
      console.warn('[DBService] remote sync failed, staying on local cache:', e);
    }
  }

  // ── Cache <-> relational mapping ──────────────────────────────────────────
  // Translates the LEGACY shape (DB.students[], DB.bossEvents[], etc. — the
  // shape every existing module already reads/writes) to/from the relational
  // tables defined in 01_schema.sql / 02_policies.sql. This is the seam that
  // lets db-schema.js, state-manager.js, and every domain module stay
  // unchanged while the storage underneath becomes relational.

  function _legacyRoleFromDbRole(role) {
    return role === 'admin' ? 'admin' : (role === 'teacher' ? 'teacher' : 'student');
  }

  // ── Priority 2 Fix 2: bounded history windows ─────────────────────────────
  // These 8 append-only tables previously came back with COMPLETE, unbounded
  // history on every single pull — including the first-login blocking pull.
  // See EduQuest_Priority2_Plan.md "Fix 2". Limits below are a first pass
  // (200-500 rows), not exact science — point_log/quiz_history/
  // attendance_logs get a larger window since older rows still feed streak/
  // analytics math; notifications only needs enough to fill the bell
  // dropdown. loadMoreHistory() (public API, near the bottom of this file)
  // is the escape hatch for anything that needs to page further back.
  const _HISTORY_LIMITS = {
    point_log: 500,
    redemptions: 300,
    recitation_log: 300,
    attendance_logs: 500,
    mail_messages: 300,
    orders: 300,
    quiz_history: 500,
    notifications: 100,
  };

  // ── Priority 2 Fix 1: per-table derive helpers ────────────────────────────
  // Every one of these mirrors a transform that used to be written inline,
  // once, inside _pullCacheFromSupabase()'s giant return statement. Pulled
  // out into standalone functions so BOTH the full 27-table pull below AND
  // the scoped realtime refresh (_REFRESH_GROUPS, further down) share the
  // exact same transform logic — one source of truth, no risk of the two
  // paths silently drifting apart. See EduQuest_Priority2_Plan.md "Fix 1".

  function _deriveStudents(profilesData, quizHistoryByStudent) {
    const qh = quizHistoryByStudent || {};
    return (profilesData || [])
      .filter(p => p.role === 'student')
      .map(p => ({
        id: p.id, pass: p.pass, name: p.display_name, init: p.init, color: p.color,
        xp: p.xp, coins: p.coins, level: p.level, tier: p.tier,
        attendance: Number(p.attendance_pct) || 0, quizAvg: Number(p.quiz_avg) || 0,
        firstName: p.first_name, lastName: p.last_name,
        displayName: p.display_name, profilePic: p.profile_pic_url,
        joinDate: p.join_date, classId: p.class_id || 'default-class',
        // Phase 63 completedQuizzes — built from the already-shaped
        // quizHistoryByStudent map (id: [{quizId, aborted, ...}]) rather
        // than raw quiz_history rows, so this same function works whether
        // the caller just did a fresh quiz_history pull (full pull) or is
        // reusing the existing cached quizHistory slice unchanged (scoped
        // 'profiles' group refresh, where quiz_history itself didn't change).
        completedQuizzes: Array.from(new Set(
          (qh[p.id] || []).filter(h => !h.aborted).map(h => h.quizId)
        )),
      }));
  }

  function _deriveAdmin(profilesData, previousAdmin) {
    const adminRow = (profilesData || []).find(p => p.role === 'admin' || p.role === 'teacher');
    return adminRow ? {
      id: adminRow.id, name: adminRow.display_name, role: 'Teacher',
      pass: previousAdmin?.pass ?? (typeof DEFAULT_DB !== 'undefined' ? DEFAULT_DB.admin?.pass : 'admin123'),
    } : (previousAdmin ?? (typeof DEFAULT_DB !== 'undefined' ? DEFAULT_DB.admin : null));
  }

  function _deriveEquippedTitles(profilesData) {
    const equippedTitles = {};
    (profilesData || []).forEach(p => {
      if (p.role === 'student' && p.equipped_title_id) equippedTitles[p.id] = p.equipped_title_id;
    });
    return equippedTitles;
  }

  function _deriveBossEvents(bossEventsData, lootClaimsData) {
    const bossIdById = {};
    const bossEventsArr = (bossEventsData || [])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((b, idx) => {
        bossIdById[b.id] = idx;
        return {
          _id: b.id, // kept so writes can map back; never read by legacy code
          classId: b.class_id || 'default-class', // Phase 14: section ownership
          name: b.name, description: b.description, image: b.image,
          maxHp: b.max_hp, currentHp: b.current_hp, status: b.status,
          startDate: b.start_date, endDate: b.end_date,
          defeatedAt: b.defeated_at ? Date.parse(b.defeated_at) : null, // Phase 26: was raw string, unlike its sibling timestamps
          endedAt: b.ended_at ? Date.parse(b.ended_at) : null, // Phase 24: was local-only before
          xpReward: b.xp_reward, coinReward: b.coin_reward,
          participationReward: b.participation_reward, victoryReward: b.victory_reward,
          defeatNarrTitle: b.defeat_narr_title, defeatNarrText: b.defeat_narr_text,
          victoryTitle: b.victory_title, victoryMessage: b.victory_message,
          lootRewards: b.loot_rewards || [], lootDuration: b.loot_duration_sec,
          lootStartedAt: b.loot_started_at ? Date.parse(b.loot_started_at) : null,
          lootFinalizedAt: b.loot_finalized_at ? Date.parse(b.loot_finalized_at) : null,
          // Phase 46: advanced admin-config fields — previously never left
          // the browser tab that set them (see phase46_boss_advanced_settings_sync.sql
          // for the full story). Plain passthrough, same shape the modules
          // already read/write locally.
          bossQuestions: b.boss_questions || [],
          minionSettings: b.minion_settings || {},
          combatSettings: b.combat_settings || {},
          skills: b.skills || {},
          skillFireMode: b.skill_fire_mode || undefined,
          skillIntervalMin: b.skill_interval_min || undefined,
          skillIntervalMax: b.skill_interval_max || undefined,
          rageSettings: b.rage_settings || {},
          phases: b.phases || [],
          lootClaims: (lootClaimsData || [])
            .filter(c => c.boss_id === b.id)
            .map(c => ({
              id: c.id, rewardId: c.reward_id, itemName: c.item_name, rarity: c.rarity,
              studentId: c.student_id, claimedAt: Date.parse(c.claimed_at),
              classId: c.class_id || 'default-class', // Phase 14: section ownership
              // Phase 44: claim_loot_reward() RPC now actually persists these —
              // restore them so the claim feed shows real names/colors after a
              // refresh instead of falling back to "Student" placeholders.
              studentName: c.student_name, studentInit: c.student_init, studentColor: c.student_color,
            })),
          createdAt: b.created_at ? Date.parse(b.created_at) : null,
        };
      });
    return { bossEventsArr, bossIdById };
  }

  function _deriveBossParticipants(bossParticipantsData, bossIdById) {
    const bossParticipantsObj = {};
    (bossParticipantsData || []).forEach(row => {
      const idx = bossIdById[row.boss_id];
      if (idx === undefined) return;
      if (!bossParticipantsObj[idx]) bossParticipantsObj[idx] = {};
      bossParticipantsObj[idx][row.student_id] = {
        studentId: row.student_id,
        classId: row.class_id || 'default-class', // Phase 14: section ownership
        totalDamage: row.total_damage, correctAnswers: row.correct_answers,
        wrongAnswers: row.wrong_answers, critHits: row.crit_hits,
        minionsDefeated: row.minions_defeated,
        joinTime: row.joined_at ? Date.parse(row.joined_at) : null,
        lastQIdx: row.last_question_idx,
      };
    });
    return bossParticipantsObj;
  }

  function _deriveAchievements(achievementsData) {
    // Phase 38: same starter-template filter as titlesArr/quizzesArr/campaignWorldsArr.
    return (achievementsData || []).filter(a => !a.is_starter_template).map(a => ({
      id: a.id, ownerTeacherId: a.owner_teacher_id, // Phase 32: catalog owner scoping
      name: a.name, description: a.description, icon: a.icon,
      category: a.category, rarity: a.rarity, xpReward: a.xp_reward,
      coinReward: a.coin_reward, triggerType: a.trigger_type,
      triggerValue: a.trigger_value, active: a.active,
    }));
  }

  function _deriveAchievementUnlocks(userAchievementsData) {
    const achievementUnlocks = {};
    (userAchievementsData || []).forEach(u => {
      if (!achievementUnlocks[u.student_id]) achievementUnlocks[u.student_id] = [];
      achievementUnlocks[u.student_id].push({
        achId: u.achievement_id, unlockedAt: u.unlocked_at,
        xpGranted: u.xp_granted, coinsGranted: u.coins_granted,
        claimed: u.claimed, claimedAt: u.claimed_at,
        classId: u.class_id || 'default-class', // Phase 14: section ownership
      });
    });
    return achievementUnlocks;
  }

  function _deriveTitles(titlesData) {
    // Phase 38: is_starter_template rows are admin-only starter-pack
    // templates — filtered here, not RLS, same reasoning as the original
    // inline version of this transform.
    return (titlesData || []).filter(t => !t.is_starter_template).map(t => ({
      id: t.id, ownerTeacherId: t.owner_teacher_id, // Phase 32: catalog owner scoping
      name: t.name, description: t.description, icon: t.icon,
      rarity: t.rarity, active: t.active !== false, achievementId: t.achievement_id,
      textColor: t.text_color, borderColor: t.border_color, glowColor: t.glow_color,
      bgColor: t.bg_color, primaryColor: t.primary_color, secondaryColor: t.secondary_color,
      gradientFrom: t.gradient_from, gradientTo: t.gradient_to, borderStyle: t.border_style,
      animation: t.animation, particles: t.particles, bgEffect: t.bg_effect,
      customBorderCSS: t.custom_border_css, customAnimationCSS: t.custom_animation_css,
      customBgCSS: t.custom_bg_css, createdAt: t.created_at,
      frameShape: t.frame_shape || 'classic', frameStyle: t.frame_style || 'none',
      accentColor: t.accent_color, effect: t.effect || 'none',
      frameTemplate: t.frame_template || 'solid',
    }));
  }

  function _deriveTitleUnlocks(titleUnlocksData) {
    const titleUnlocksObj = {};
    (titleUnlocksData || []).forEach(u => {
      if (!titleUnlocksObj[u.student_id]) titleUnlocksObj[u.student_id] = [];
      titleUnlocksObj[u.student_id].push(u.title_id);
    });
    return titleUnlocksObj;
  }

  function _deriveTitleSectionAssignments(titleSectionsData) {
    const titleSectionAssignments = {};
    (titleSectionsData || []).forEach(row => {
      if (!titleSectionAssignments[row.title_id]) titleSectionAssignments[row.title_id] = [];
      titleSectionAssignments[row.title_id].push(row.class_id);
    });
    return titleSectionAssignments;
  }

  function _deriveQuizzes(quizzesData) {
    // Phase 38: same starter-template filter as titlesArr above.
    return (quizzesData || []).filter(q => !q.is_starter_template).map(q => ({
      id: q.id, ownerTeacherId: q.owner_teacher_id, // Phase 32: catalog owner scoping
      title: q.title, desc: q.description,
      xpReward: q.xp_reward, coinReward: q.coin_reward, timeLimit: q.time_limit,
      rarity: q.rarity || 'Common', cadence: q.cadence || 'standing',
      chainId: q.chain_id || null, chainOrder: q.chain_order || 1, chainLabel: q.chain_label || '',
      startDate: q.start_date || null, endDate: q.end_date || null,
      stageTimers: Array.isArray(q.stage_timers) ? q.stage_timers : [null, null, null],
      questions: q.questions || [], active: q.active !== false,
      createdAt: q.created_at,
    }));
  }

  function _deriveCampaignWorlds(campaignWorldsData) {
    // Phase 38: same starter-template filter as titlesArr/quizzesArr above.
    return (campaignWorldsData || []).filter(w => !w.is_starter_template).map(w => ({
      id: w.id, ownerTeacherId: w.owner_teacher_id, // Phase 32: catalog owner scoping
      label: w.label, icon: w.icon, color: w.color, desc: w.description,
      stages: w.stages || [],
    }));
  }

  function _deriveCampaignSectionAssignments(campaignStageSectionsData, campaignWorldsArr) {
    const worldIdByStageId = {};
    (campaignWorldsArr || []).forEach(w => (w.stages || []).forEach(s => { worldIdByStageId[s.id] = w.id; }));
    const campaignSectionAssignments = {};
    (campaignStageSectionsData || []).forEach(row => {
      const worldId = worldIdByStageId[row.stage_id];
      if (!worldId) return; // stale row for a since-deleted stage — ignore
      if (!campaignSectionAssignments[worldId]) campaignSectionAssignments[worldId] = [];
      if (!campaignSectionAssignments[worldId].includes(row.class_id)) campaignSectionAssignments[worldId].push(row.class_id);
    });
    return campaignSectionAssignments;
  }

  function _deriveMail(mailMessagesData, profilesData, titlesArr) {
    const mailByBatch = {};
    (mailMessagesData || []).forEach(row => {
      const batchId = row.batch_id || row.id;
      if (!mailByBatch[batchId]) {
        const senderProfile = (profilesData || []).find(p => p.id === row.sender_teacher_id);
        const rewards = [];
        if (row.xp_reward)   rewards.push({ type: 'xp', amount: row.xp_reward, icon: '⚡', label: 'XP', color: 'var(--primary)' });
        if (row.coin_reward) rewards.push({ type: 'coins', amount: row.coin_reward, icon: '🪙', label: 'Coins', color: 'var(--tertiary)' });
        if (row.title_reward_id) {
          const t = (titlesArr || []).find(x => x.id === row.title_reward_id);
          rewards.push({ type: 'title', amount: 1, icon: (t && t.icon) || '🎖️', label: (t && t.name) || 'Title', color: '#EC4899', titleId: row.title_reward_id });
        }
        mailByBatch[batchId] = {
          id: batchId,
          subject: row.subject, body: row.body, type: row.mail_type || 'general',
          sender: senderProfile ? senderProfile.display_name : 'Teacher',
          hasReward: !!(row.xp_reward || row.coin_reward || row.title_reward_id),
          rewards,
          to: [],
          sentAt: row.created_at,
          readBy: {}, claimedBy: {},
          rowIdBySid: {},
        };
      }
      mailByBatch[batchId].to.push(row.recipient_student_id);
      mailByBatch[batchId].readBy[row.recipient_student_id] = !!row.read;
      mailByBatch[batchId].claimedBy[row.recipient_student_id] = !!row.claimed;
      mailByBatch[batchId].rowIdBySid[row.recipient_student_id] = row.id;
    });
    return Object.values(mailByBatch);
  }

  function _deriveQuizSectionAssignments(quizSectionsData) {
    const quizSectionAssignments = {};
    (quizSectionsData || []).forEach(row => {
      if (!quizSectionAssignments[row.quiz_id]) quizSectionAssignments[row.quiz_id] = [];
      quizSectionAssignments[row.quiz_id].push(row.class_id);
    });
    return quizSectionAssignments;
  }

  function _deriveAchievementSectionAssignments(achievementSectionsData) {
    const achievementSectionAssignments = {};
    (achievementSectionsData || []).forEach(row => {
      if (!achievementSectionAssignments[row.achievement_id]) achievementSectionAssignments[row.achievement_id] = [];
      achievementSectionAssignments[row.achievement_id].push(row.class_id);
    });
    return achievementSectionAssignments;
  }

  function _deriveInventory(inventoryRowsData) {
    const inventoryByStudent = {};
    (inventoryRowsData || []).forEach(row => {
      if (!inventoryByStudent[row.student_id]) inventoryByStudent[row.student_id] = [];
      inventoryByStudent[row.student_id].push({
        itemId: row.item_id, itemName: row.item_name, emoji: row.emoji, category: row.category,
        quantity: row.quantity, datePurchased: row.date_purchased, lastPurchased: row.last_purchased,
        source: row.source, status: row.status, usedAt: row.used_at,
      });
    });
    return inventoryByStudent;
  }

  function _deriveQuizHistory(quizHistoryRowsData) {
    const quizHistoryByStudent = {};
    const completedQuizzesByStudent = {};
    (quizHistoryRowsData || []).forEach(row => {
      if (!quizHistoryByStudent[row.student_id]) quizHistoryByStudent[row.student_id] = [];
      quizHistoryByStudent[row.student_id].push({
        id: row.id, quizId: row.quiz_id, score: row.score, attempt: row.attempt,
        completedAt: row.completed_at, date: row.date_label,
        results: Array.isArray(row.question_results) ? row.question_results : undefined,
        aborted: !!row.aborted,
      });
      if (!row.aborted) {
        if (!completedQuizzesByStudent[row.student_id]) completedQuizzesByStudent[row.student_id] = new Set();
        completedQuizzesByStudent[row.student_id].add(row.quiz_id);
      }
    });
    return { quizHistoryByStudent, completedQuizzesByStudent };
  }

  function _deriveStudentSkills(studentSkillRowsData) {
    const studentSkillsObj = {};
    (studentSkillRowsData || []).forEach(row => {
      studentSkillsObj[row.student_id] = {
        hint: row.hint_count || 0, heal: row.heal_count || 0, shield: row.shield_count || 0,
      };
    });
    return studentSkillsObj;
  }

  function _derivePointLog(pointLogData) {
    return (pointLogData || []).map(p => ({
      id: p.id, studentId: p.student_id, what: p.what, pts: p.pts, when: p.when_label,
      createdAt: p.created_at,
    }));
  }

  function _deriveRedemptions(redemptionsData) {
    return (redemptionsData || []).map(r => ({
      orderId: r.order_id, studentId: r.student_id, itemId: r.item_id,
      itemName: r.item_name, emoji: r.emoji, item: r.item_label, pts: r.pts,
      date: r.date_label, time: r.time_label, claimCode: r.claim_code,
      createdAt: r.created_at,
    }));
  }

  function _deriveOrders(ordersData) {
    return (ordersData || []).map(o => ({
      orderId: o.order_id, claimCode: o.claim_code,
      studentId: o.student_id, studentName: o.student_name,
      studentInit: o.student_init, studentColor: o.student_color,
      itemId: o.item_id, itemName: o.item_name, emoji: o.emoji,
      cost: o.cost, category: o.category,
      status: o.status,
      createdAt: o.created_at, createdDateStr: o.created_date_str,
      claimedAt: o.claimed_at ? Date.parse(o.claimed_at) : null, claimedBy: o.claimed_by,
      cancelledAt: o.cancelled_at ? Date.parse(o.cancelled_at) : null,
      cancelReason: o.cancel_reason, cancelledBy: o.cancelled_by,
    }));
  }

  function _deriveNotifications(notificationsData) {
    return (notificationsData || []).map(n => ({
      id: n.id, studentId: n.student_id, type: n.type, icon: n.icon,
      title: n.title, body: n.body, action: n.action, pts: n.pts,
      sourceId: n.source_id, read: n.read, createdAt: n.created_at,
    }));
  }

  function _deriveRecitationLog(recitationLogData) {
    return (recitationLogData || []).map(r => ({
      id: r.id, studentId: r.student_id, pts: r.pts, note: r.note, when: r.when_label,
      classId: r.class_id || null, createdAt: r.created_at || null,
    }));
  }

  function _deriveRfidCards(rfidCardsData) {
    return (rfidCardsData || []).map(c => ({
      id: c.id, tagId: c.tag_id, studentId: c.student_id,
      isActive: c.is_active, assignedAt: c.assigned_at, revokedAt: c.revoked_at,
    }));
  }

  function _deriveAttendanceSchedules(attendanceSchedulesData) {
    return (attendanceSchedulesData || []).map(s => ({
      id: s.id, classId: s.class_id, openTime: s.open_time, startTime: s.start_time,
      lateCutoff: s.late_cutoff, closeTime: s.close_time, active: s.active,
    }));
  }

  function _deriveAttendanceLogs(attendanceLogsData) {
    return (attendanceLogsData || []).map(a => ({
      id: a.id, studentId: a.student_id, classId: a.class_id, logDate: a.log_date,
      status: a.status, scannedAt: a.scanned_at, entryMethod: a.entry_method,
      rfidTag: a.rfid_tag, recordedBy: a.recorded_by, notes: a.notes,
    }));
  }

  function _deriveStore(shopProductsData) {
    // Phase 38: same starter-template filter as the other catalog tables.
    return (shopProductsData || []).filter(p => !p.is_starter_template).map(p => ({
      id: p.id, ownerTeacherId: p.owner_teacher_id,
      name: p.name, emoji: p.emoji, desc: p.description, cat: p.category,
      cost: p.cost, stock: p.stock, active: p.active,
      addedAt: p.created_at,
    }));
  }

  function _deriveRegistrations(registrationsData) {
    return (registrationsData || [])
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
      .map(r => ({
        id: r.id, firstName: r.first_name, lastName: r.last_name,
        username: r.username, email: r.email, studentId: r.student_id_text,
        gradeLevel: r.grade_level, section: r.section, classId: r.class_id, // Phase 33
        status: r.status, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
        reviewedBy: r.reviewed_by, rejectionReason: r.rejection_reason,
        approvedStudentId: r.approved_student_id,
      }));
  }

  async function _pullCacheFromSupabase(client) {
    const [profiles, bossEvents, bossParticipants, lootClaims, achievements, userAchievements,
           registrations, pointLog, redemptions, recitationLog,
           rfidCards, attendanceSchedules, attendanceLogs, shopProducts, mailMessages, quizSections,
           achievementSections, titles, titleUnlocks, quizzes, titleSections, campaignWorlds,
           orders, inventoryRows, campaignStageSections, quizHistoryRows, notifications, studentSkillRows] =
      await Promise.all([
        client.from('profiles').select('*'),
        client.from('boss_events').select('*'),
        client.from('boss_participants').select('*'),
        client.from('loot_claims').select('*'),
        client.from('achievements').select('*'),
        client.from('user_achievements').select('*'),
        client.from('registrations').select('*'),
        // Priority 2 Fix 2 — bounded history windows on the 8 append-only
        // tables (see _HISTORY_LIMITS above). "load more" beyond this
        // default window goes through loadMoreHistory() (public API).
        client.from('point_log').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.point_log),
        client.from('redemptions').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.redemptions),
        client.from('recitation_log').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.recitation_log),
        client.from('rfid_cards').select('*'),
        client.from('attendance_schedules').select('*'),
        client.from('attendance_logs').select('*').order('log_date', { ascending: false }).limit(_HISTORY_LIMITS.attendance_logs),
        client.from('shop_products').select('*'), // Phase 14
        client.from('mail_messages').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.mail_messages), // Phase 15
        client.from('quiz_sections').select('*'), // Phase 15
        client.from('achievement_sections').select('*'), // Phase 16
        client.from('titles').select('*'), // Phase 18
        client.from('title_unlocks').select('*'), // Phase 18
        client.from('quizzes').select('*'), // Phase 20 — quiz content (was local-only; see phase20_quiz_content_sync.sql)
        client.from('title_sections').select('*'), // Phase 21 — read side of title section-scoping
        client.from('campaign_worlds').select('*').order('sort_order', { ascending: true }), // Phase 22 — campaign content (was local-only; see phase22_campaign_content_sync.sql)
        client.from('orders').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.orders), // Phase 48
        client.from('inventory').select('*'), // Phase 48
        client.from('campaign_stage_sections').select('*'), // Phase 53 — read side of campaign per-section visibility (table existed since Phase 14, never wired up until now)
        client.from('quiz_history').select('*').order('completed_at', { ascending: false }).limit(_HISTORY_LIMITS.quiz_history), // Phase 57 — was local-only; see phase57_quiz_history_sync.sql
        client.from('notifications').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.notifications), // Phase 67 — student notification bell; see phase67_notifications.sql
        client.from('student_skills').select('*'), // Phase 7 (Campaign Redesign) — see phase68_campaign_student_skills.sql
      ]);

    for (const r of [profiles, bossEvents, bossParticipants, lootClaims, achievements, userAchievements,
                      registrations, pointLog, redemptions, recitationLog,
                      rfidCards, attendanceSchedules, attendanceLogs, shopProducts, mailMessages, quizSections,
                      achievementSections, titles, titleUnlocks, quizzes, titleSections, campaignWorlds,
                      orders, inventoryRows, campaignStageSections, quizHistoryRows, notifications, studentSkillRows]) {
      if (r.error) throw r.error;
    }

    // Priority 2 Fix 1 — every transform below now lives in a standalone
    // _deriveX() helper (defined above _pullCacheFromSupabase) shared with
    // the scoped realtime refresh path (_REFRESH_GROUPS, further down).
    // This function's only job now is: fetch all 27 tables, then call the
    // same derive helpers a scoped refresh would call for a subset.
    const { quizHistoryByStudent } = _deriveQuizHistory(quizHistoryRows.data);
    const students = _deriveStudents(profiles.data, quizHistoryByStudent);
    const admin = _deriveAdmin(profiles.data, _cache?.admin);
    const equippedTitles = _deriveEquippedTitles(profiles.data);
    const { bossEventsArr, bossIdById } = _deriveBossEvents(bossEvents.data, lootClaims.data);
    const bossParticipantsObj = _deriveBossParticipants(bossParticipants.data, bossIdById);
    const titlesArr = _deriveTitles(titles.data);
    const campaignWorldsArr = _deriveCampaignWorlds(campaignWorlds.data);

    return {
      schemaVersion: _SCHEMA_VER,
      students,
      // Fall back to the locally-cached admin record (or DEFAULT_DB.admin) when
      // no admin/teacher profile row exists in Supabase yet (e.g. fresh deployment,
      // RLS preventing the anon key from reading that row, or Phase-2 auth not yet
      // set up). Without this, DB.admin is null and doLogin() throws on DB.admin.id.
      admin,
      bossEvents: bossEventsArr,
      bossParticipants: bossParticipantsObj,
      achievements: _deriveAchievements(achievements.data),
      achievementUnlocks: _deriveAchievementUnlocks(userAchievements.data),
      titles: titlesArr, titleUnlocks: _deriveTitleUnlocks(titleUnlocks.data), equippedTitles, // Phase 18
      titleSectionAssignments: _deriveTitleSectionAssignments(titleSections.data), // Phase 21
      // Phase 14: shop is per-teacher — RLS on shop_products already scopes
      // this to (a) products this session's own teacher owns, or (b)
      // products owned by the adviser of this session's own section, so no
      // extra client-side filter is needed here, same as every other table.
      store: _deriveStore(shopProducts.data),
      // Phase 15 — see _deriveMail's comments.
      mail: _deriveMail(mailMessages.data, profiles.data, titlesArr),
      quizSectionAssignments: _deriveQuizSectionAssignments(quizSections.data),
      achievementSectionAssignments: _deriveAchievementSectionAssignments(achievementSections.data), // Phase 16
      registrations: _deriveRegistrations(registrations.data),
      pointLog: _derivePointLog(pointLog.data),
      redemptions: _deriveRedemptions(redemptions.data),
      // Phase 48 — mirrors DB.orders[] exactly. See cartCheckout() (creates),
      // shop_pos_terminal.js (staff claim/cancel), shop_orders.js (student
      // self-cancel) — all pre-existing client logic, previously local-only.
      orders: _deriveOrders(orders.data),
      // Phase 48 — mirrors DB.inventory{} exactly.
      inventory: _deriveInventory(inventoryRows.data),
      // Phase 57 — mirrors DB.quizHistory{} exactly.
      quizHistory: quizHistoryByStudent,
      // Phase 7 (Campaign Redesign) — mirrors DB.studentSkills{} exactly.
      studentSkills: _deriveStudentSkills(studentSkillRows.data),
      // Phase 67 — student notification bell. Rows are written by
      // notification-service.js (client-side synthesis from pointLog/orders,
      // never inserted directly at the source — see that file's header
      // comment), so this pull is a straight passthrough, same shape as
      // pointLog above.
      notifications: _deriveNotifications(notifications.data),
      recitationLog: _deriveRecitationLog(recitationLog.data),
      // ── Phase 1 RFID/Attendance — READ-ONLY slices ──────────────────────
      // Every write to these three comes from AttendanceService via
      // DBService.rpc(), never from this bulk-pull/push path — see
      // attendance-service.js and the RPC functions in
      // supabase/phase1_rfid_attendance.sql. Pulling them here just keeps
      // AppStore's slices fresh for read paths (dashboards, analytics).
      rfidCards: _deriveRfidCards(rfidCards.data),
      attendanceSchedules: _deriveAttendanceSchedules(attendanceSchedules.data),
      attendanceLogs: _deriveAttendanceLogs(attendanceLogs.data),
      // Fields not yet migrated to relational tables (Phase 2/3 scope — see
      // migration-strategy.md "What stays on localStorage for now"):
      quizzes: _deriveQuizzes(quizzes.data),
      attendanceSessions: _cache?.attendanceSessions || [],
      // Phase 22: campaign content catalog — see _deriveCampaignWorlds/
      // _deriveCampaignSectionAssignments. stageProgress (per-student
      // progress) stays local-cache-only — out of scope for now. quiz
      // history is NO LONGER in this bucket — see quizHistory above (Phase 57).
      stageMap: campaignWorldsArr, stageProgress: _cache?.stageProgress || {},
      campaignSectionAssignments: _deriveCampaignSectionAssignments(campaignStageSections.data, campaignWorldsArr), // Phase 53
      _bossIdById: bossIdById, // internal map, see _pushCacheToSupabase
    };
  }

  // ── Priority 2 Fix 1: scoped realtime refresh ─────────────────────────────
  // Maps each realtime-subscribed table to a small "refresh group" — the
  // minimal set of Supabase tables that must be re-fetched together to
  // correctly rebuild the cache slice(s) that table feeds into — and gives
  // each group a fetch()+apply() pair built entirely from the _deriveX()
  // helpers above. _schedulePullRefresh()/_applyScopedRefresh() (below) use
  // this to re-fetch only the 1-4 tables a realtime burst actually touched
  // instead of unconditionally re-running all 27 queries in
  // _pullCacheFromSupabase() on every single event. See
  // EduQuest_Priority2_Plan.md "Fix 1" for the full writeup, including why
  // boss_events/boss_participants/loot_claims are grouped as one "raid" unit.
  const _REALTIME_TABLE_GROUPS = {
    profiles: 'profiles',
    boss_events: 'raid',
    boss_participants: 'raid',
    loot_claims: 'raid',
    achievements: 'achievements',
    user_achievements: 'achievements',
    point_log: 'pointLog',
    recitation_log: 'recitationLog',
    rfid_cards: 'rfidCards',
    attendance_logs: 'attendanceLogs',
    mail_messages: 'mail',
    quiz_sections: 'quizSectionAssignments',
    achievement_sections: 'achievementSectionAssignments',
    titles: 'titles',
    title_unlocks: 'titles',
    title_sections: 'titles',
    quizzes: 'quizzes',
    campaign_worlds: 'campaign',
    campaign_stage_sections: 'campaign',
    orders: 'orders',
    inventory: 'inventory',
    quiz_history: 'quizHistory',
    notifications: 'notifications',
    student_skills: 'studentSkills',
  };

  const _REFRESH_GROUPS = {
    profiles: {
      fetch: async (client) => ({ profiles: await client.from('profiles').select('*') }),
      apply: (raw, cache) => ({
        students: _deriveStudents(raw.profiles.data, cache.quizHistory),
        admin: _deriveAdmin(raw.profiles.data, cache.admin),
        equippedTitles: _deriveEquippedTitles(raw.profiles.data),
      }),
    },
    raid: {
      // The plan's documented stress case: a boss-event raid where up to 30
      // students trigger boss_participants/loot_claims changes in a tight
      // window. All three tables feed the same two cache keys, so they're
      // always fetched together — refreshing them separately would just
      // mean re-deriving bossEvents/bossParticipants 2-3x in a row for no
      // benefit.
      fetch: async (client) => {
        const [bossEvents, bossParticipants, lootClaims] = await Promise.all([
          client.from('boss_events').select('*'),
          client.from('boss_participants').select('*'),
          client.from('loot_claims').select('*'),
        ]);
        return { bossEvents, bossParticipants, lootClaims };
      },
      apply: (raw) => {
        const { bossEventsArr, bossIdById } = _deriveBossEvents(raw.bossEvents.data, raw.lootClaims.data);
        return {
          bossEvents: bossEventsArr,
          bossParticipants: _deriveBossParticipants(raw.bossParticipants.data, bossIdById),
          _bossIdById: bossIdById,
        };
      },
    },
    achievements: {
      fetch: async (client) => {
        const [achievements, userAchievements] = await Promise.all([
          client.from('achievements').select('*'),
          client.from('user_achievements').select('*'),
        ]);
        return { achievements, userAchievements };
      },
      apply: (raw) => ({
        achievements: _deriveAchievements(raw.achievements.data),
        achievementUnlocks: _deriveAchievementUnlocks(raw.userAchievements.data),
      }),
    },
    pointLog: {
      fetch: async (client) => ({
        pointLog: await client.from('point_log').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.point_log),
      }),
      apply: (raw) => ({ pointLog: _derivePointLog(raw.pointLog.data) }),
    },
    recitationLog: {
      fetch: async (client) => ({
        recitationLog: await client.from('recitation_log').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.recitation_log),
      }),
      apply: (raw) => ({ recitationLog: _deriveRecitationLog(raw.recitationLog.data) }),
    },
    rfidCards: {
      fetch: async (client) => ({ rfidCards: await client.from('rfid_cards').select('*') }),
      apply: (raw) => ({ rfidCards: _deriveRfidCards(raw.rfidCards.data) }),
    },
    attendanceLogs: {
      fetch: async (client) => ({
        attendanceLogs: await client.from('attendance_logs').select('*').order('log_date', { ascending: false }).limit(_HISTORY_LIMITS.attendance_logs),
      }),
      apply: (raw) => ({ attendanceLogs: _deriveAttendanceLogs(raw.attendanceLogs.data) }),
    },
    mail: {
      // Needs profiles alongside mail_messages purely to resolve sender
      // display names (see _deriveMail) — still just 2 tables instead of 27.
      // Title-reward lookups reuse the already-cached titles slice instead
      // of re-fetching titles too.
      fetch: async (client) => {
        const [mailMessages, profiles] = await Promise.all([
          client.from('mail_messages').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.mail_messages),
          client.from('profiles').select('*'),
        ]);
        return { mailMessages, profiles };
      },
      apply: (raw, cache) => ({ mail: _deriveMail(raw.mailMessages.data, raw.profiles.data, cache.titles) }),
    },
    quizSectionAssignments: {
      fetch: async (client) => ({ quizSections: await client.from('quiz_sections').select('*') }),
      apply: (raw) => ({ quizSectionAssignments: _deriveQuizSectionAssignments(raw.quizSections.data) }),
    },
    achievementSectionAssignments: {
      fetch: async (client) => ({ achievementSections: await client.from('achievement_sections').select('*') }),
      apply: (raw) => ({ achievementSectionAssignments: _deriveAchievementSectionAssignments(raw.achievementSections.data) }),
    },
    titles: {
      // titles + title_unlocks + title_sections grouped together: unlocking
      // or re-scoping a title routinely touches more than one of these at
      // once, and all three only ever feed the "titles domain" of the cache.
      fetch: async (client) => {
        const [titles, titleUnlocks, titleSections] = await Promise.all([
          client.from('titles').select('*'),
          client.from('title_unlocks').select('*'),
          client.from('title_sections').select('*'),
        ]);
        return { titles, titleUnlocks, titleSections };
      },
      apply: (raw) => ({
        titles: _deriveTitles(raw.titles.data),
        titleUnlocks: _deriveTitleUnlocks(raw.titleUnlocks.data),
        titleSectionAssignments: _deriveTitleSectionAssignments(raw.titleSections.data),
      }),
    },
    quizzes: {
      fetch: async (client) => ({ quizzes: await client.from('quizzes').select('*') }),
      apply: (raw) => ({ quizzes: _deriveQuizzes(raw.quizzes.data) }),
    },
    campaign: {
      fetch: async (client) => {
        const [campaignWorlds, campaignStageSections] = await Promise.all([
          client.from('campaign_worlds').select('*').order('sort_order', { ascending: true }),
          client.from('campaign_stage_sections').select('*'),
        ]);
        return { campaignWorlds, campaignStageSections };
      },
      apply: (raw) => {
        const campaignWorldsArr = _deriveCampaignWorlds(raw.campaignWorlds.data);
        return {
          stageMap: campaignWorldsArr,
          campaignSectionAssignments: _deriveCampaignSectionAssignments(raw.campaignStageSections.data, campaignWorldsArr),
        };
      },
    },
    orders: {
      fetch: async (client) => ({
        orders: await client.from('orders').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.orders),
      }),
      apply: (raw) => ({ orders: _deriveOrders(raw.orders.data) }),
    },
    inventory: {
      fetch: async (client) => ({ inventory: await client.from('inventory').select('*') }),
      apply: (raw) => ({ inventory: _deriveInventory(raw.inventory.data) }),
    },
    quizHistory: {
      fetch: async (client) => ({
        quizHistory: await client.from('quiz_history').select('*').order('completed_at', { ascending: false }).limit(_HISTORY_LIMITS.quiz_history),
      }),
      apply: (raw, cache) => {
        const { quizHistoryByStudent, completedQuizzesByStudent } = _deriveQuizHistory(raw.quizHistory.data);
        // quiz_history also feeds students[].completedQuizzes (Phase 63) —
        // patch the already-cached student list in place instead of
        // re-fetching profiles just for this; this group already has
        // everything it needs to keep the two in sync (see the "quiz
        // reappears / chain resets to step 1" bug this originally fixed).
        const students = (cache.students || []).map(s => ({
          ...s,
          completedQuizzes: Array.from(completedQuizzesByStudent[s.id] || []),
        }));
        return { quizHistory: quizHistoryByStudent, students };
      },
    },
    notifications: {
      fetch: async (client) => ({
        notifications: await client.from('notifications').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.notifications),
      }),
      apply: (raw) => ({ notifications: _deriveNotifications(raw.notifications.data) }),
    },
    studentSkills: {
      fetch: async (client) => ({ studentSkills: await client.from('student_skills').select('*') }),
      apply: (raw) => ({ studentSkills: _deriveStudentSkills(raw.studentSkills.data) }),
    },
  };

  const _FULL_PULL_SENTINEL = '__full__';

  async function _applyScopedRefresh(client, changedTables) {
    // No cache yet, or an explicit/unmapped full-refresh request: fall back
    // to the original full 27-table pull. This is the safe default —
    // realtime only ever subscribes after the first full pull has already
    // seeded _cache, and any table not (yet) listed in
    // _REALTIME_TABLE_GROUPS falls back here too, rather than silently
    // no-op'ing on a table this file doesn't know how to scope yet.
    if (!_cache || changedTables.includes(_FULL_PULL_SENTINEL)) {
      _cache = await _pullCacheFromSupabase(client);
      return;
    }

    const groups = new Set();
    for (const t of changedTables) {
      const g = _REALTIME_TABLE_GROUPS[t];
      if (!g) { groups.add(_FULL_PULL_SENTINEL); break; }
      groups.add(g);
    }
    if (groups.has(_FULL_PULL_SENTINEL)) {
      _cache = await _pullCacheFromSupabase(client);
      return;
    }

    // Fetch + transform every affected group in parallel (a raid burst
    // touching both 'raid' and 'pointLog' groups still fires one Promise.all,
    // not two sequential round-trips), then merge into a shallow copy of
    // _cache. Keys nothing here touches keep their exact previous object
    // reference — cheaper for anything downstream that diffs by reference.
    const groupList = Array.from(groups);
    const results = await Promise.all(groupList.map(async (g) => {
      const def = _REFRESH_GROUPS[g];
      const raw = await def.fetch(client);
      for (const key in raw) { if (raw[key].error) throw raw[key].error; }
      return def.apply(raw, _cache);
    }));

    const merged = { ..._cache };
    results.forEach(partial => Object.assign(merged, partial));
    _cache = merged;
  }


  async function _pushCacheToSupabase(client, cache) {
    // Shared staff-session flag — reused below to skip catalog-table pushes
    // entirely for student sessions (BUGFIX: a student login was triggering
    // a full unchanged re-push of shop_products/boss_events on every saveDB()
    // — e.g. simply logging in as a student writes SOMETHING to the cache,
    // which queues this whole function, which then tried to upsert every
    // table including ones a student never touched. Those two tables had no
    // role check at all (unlike the profiles upsert below, which already
    // guards on this same flag), so they hit RLS on every single student
    // session and printed a scary-looking "remote sync failed" for
    // shop_products/boss_events even though nothing about the shop or a boss
    // had changed. Skipping them outright for non-staff sessions is both
    // correct (students can't write either table) and quiets the noise.
    const isCatalogStaffSession = (typeof currentUser !== 'undefined' && currentUser &&
      (currentUser.role === 'admin' || currentUser.role === 'teacher'));

    // BUGFIX (table isolation): every block below used to just `throw error`
    // straight out of _pushCacheToSupabase, which meant the FIRST table to
    // fail in a given save cycle silently prevented every table listed AFTER
    // it from even being attempted — e.g. an achievements RLS error would
    // stop titles/quizzes/campaign_worlds from syncing that cycle too, with
    // no warning that they'd been skipped. Wrapping each table's push in
    // this helper means one bad table only ever blocks itself; everything
    // else still gets its chance to sync in the same cycle.
    async function _pushTable(label, fn) {
      try {
        await fn();
      } catch (e) {
        console.warn('[DBService] remote sync failed for ' + label + ', staying on local cache:', e);
      }
    }

    // Students: upsert profile game-stat columns, but ONLY when an admin/
    // teacher session is active. This avoids two distinct failure modes that
    // appear after the Supabase Auth migration:
    //
    //   1. RLS type mismatch (42883 "operator does not exist: text = uuid"):
    //      The is_staff() helper used by the profiles_staff_full_write and
    //      profiles_self_update_cosmetic_only policies compares auth.uid()
    //      (uuid type) against profiles.id (text type). That comparison only
    //      runs when the session has a real JWT (i.e. after a successful
    //      doLogin()), which is why this was invisible before the auth
    //      migration. The SQL fix is in
    //      supabase/fix_is_staff_uuid_cast.sql — is_staff() must cast:
    //        where id = auth.uid()::text
    //      This JS guard is a second layer of defence: we skip the bulk-push
    //      entirely for non-admin sessions so a student login can never
    //      accidentally trigger the write path that evaluates is_staff().
    //
    //   2. Partial RLS rejection for student sessions: even after fixing
    //      is_staff(), a student session's RLS policy
    //      (profiles_self_update_cosmetic_only) only permits updating the
    //      student's OWN row. Sending all students' rows in a single upsert
    //      would silently drop the others on newer PostgREST versions, or
    //      throw a 403/42501 on older ones. Admin sessions get
    //      profiles_staff_full_write (all rows) — so admin-only is both safe
    //      and correct for this bulk-sync path.
    //
    //   Student-initiated grants (loot, achievements, cosmetic updates) still
    //   go through DBService.rpc() → SECURITY DEFINER functions, exactly as
    //   documented in migration-strategy.md "Write paths that MUST use RPCs".
    //   This guard does NOT affect that path.
    //
    //   FIX (Investigation Report §6.1 — "whole-roster last-save-wins"):
    //   xp, coins, level, and tier are DELIBERATELY EXCLUDED from the `rows`
    //   payload below. Those four columns used to ride along in this bulk
    //   upsert, which meant ANY saveDB() call from ANY browser tab —
    //   including one with a stale in-memory roster — re-overwrote every
    //   student's xp/coins/level/tier with whatever that tab happened to
    //   have cached, silently clobbering fresher values another device had
    //   just written seconds earlier. All seven features that mutate those
    //   columns (recitation award, campaign stage rewards, admin manual
    //   XP/coin adjust, world boss rewards, mail rewards, achievement
    //   grant/revoke/claim) now call the new `adjust_student_stats` RPC
    //   (supabase/phase9_student_stat_rpc.sql) via utils.js's
    //   syncStudentStatsToServer() the instant they apply a delta — an
    //   atomic, column-scoped Postgres update that can't be clobbered by a
    //   stale snapshot, because no absolute value is ever sent, only a
    //   delta. That RPC is now the sole write path for these four columns;
    //   this bulk upsert no longer needs to (and must not) touch them.
    //   FIX (Pending Fixes Report §3): attendance_pct and quiz_avg are now
    //   ALSO excluded from the `rows` payload below, for the exact same
    //   reason. They used to be the "still open" half of this bug — left
    //   riding this bulk upsert because neither had an RPC path yet. Every
    //   recalcStudentStats() call site (modules/attendance/
    //   attendance-service.js) now calls utils.js's
    //   syncStudentDerivedStatsToServer() right after recomputing, which
    //   calls the new `sync_student_derived_stats` RPC
    //   (supabase/phase11_derived_stats_rpc.sql) to write just those two
    //   columns on just that one student's row. That RPC is now the sole
    //   write path for attendance_pct/quiz_avg; this bulk upsert no longer
    //   needs to (and must not) touch them either. Identity/cosmetic fields
    //   (display_name, init, color,
    //   profile_pic_url, class_id, first_name/last_name) are unaffected —
    //   they have no other write path and legitimately still belong here.
    if (Array.isArray(cache.students) && cache.students.length) {
      // Check whether the current Supabase session belongs to a staff user.
      // getSession() is a local cache read inside supabase-js (no network) so
      // it's safe to call in the debounced upload path.
      let isStaffSession = false;
      try {
        const { data: sessionData } = await client.auth.getSession();
        if (sessionData && sessionData.session) {
          // currentUser is the global set by auth.js doLogin(). We check its
          // role rather than re-fetching from the network — it's already been
          // validated against the profiles row at login time.
          isStaffSession = (typeof currentUser !== 'undefined' && currentUser &&
            (currentUser.role === 'admin' || currentUser.role === 'teacher'));
        }
      } catch (e) {
        // If we can't determine session state, skip the upsert conservatively.
        console.warn('[DBService] _pushCacheToSupabase: could not check session for profiles upsert, skipping.', e);
      }

      if (isStaffSession) {
        // xp/coins/level/tier/attendance_pct/quiz_avg intentionally omitted
        // — see the comment above this block. This upsert is UPDATE-only in
        // practice (every student in this cache was itself pulled from an
        // existing profiles row; new profiles are created via
        // approve_student_registration()'s own RPC, never through this
        // path), so omitting these six columns simply leaves them untouched
        // by this write, which is exactly the point: xp/coins/level/tier
        // are owned exclusively by adjust_student_stats(), and
        // attendance_pct/quiz_avg are owned exclusively by
        // sync_student_derived_stats().
        //
        // Phase 45: filter to only sections THIS session is actually staff
        // for before sending anything, and push per-class_id instead of one
        // giant batch. profiles_staff_full_write's RLS check
        // (is_staff_for_section) runs PER ROW server-side — a bulk upsert
        // that includes even one student outside a section this account
        // advises (a stale local cache from a previous account/session on
        // this browser, a section this teacher was just reassigned away
        // from, or a student still sitting on the 'default-class' backfill
        // — which is admin-only until it has a real adviser, see
        // is_staff_for_section's own comment) rejects the WHOLE statement
        // with one opaque 42501, and — since this used to `throw` straight
        // out of a single upsert call — silently aborted every OTHER push
        // in this sync cycle too (boss events, achievements, mail...), not
        // just profiles. Chunking means an out-of-scope class_id only
        // blocks that class_id's rows, logs exactly which one, and lets
        // everything else in this function keep going.
        const isAdmin = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
        let writableClassIds = null; // null = no client-side restriction (admin, or classSections not loaded yet)
        if (!isAdmin) {
          const mySections = (typeof AppStore !== 'undefined' ? (AppStore.getSlice(s => s.classSections) || []) : []);
          // classSections is bootstrapped by a SEPARATE, unawaited fetch
          // (sections_index.js's _bootstrapSectionData(), fired off
          // AppStore.ready) — it isn't guaranteed to have completed by the
          // time this debounced push fires, e.g. right after login. An
          // empty array here is ambiguous: "this teacher genuinely advises
          // zero sections" and "sections haven't loaded yet" look
          // identical. Only apply the restriction once we have real
          // section data to restrict against — otherwise every student
          // gets wrongly skipped on a race, not because of anything wrong
          // with the account. When classSections is genuinely empty, fall
          // through to sending everything and let server-side RLS (plus
          // the per-class_id chunking below) be the actual source of truth.
          if (mySections.length) {
            writableClassIds = new Set(
              mySections
                .filter(function (s) { return s.adviserId === currentUser.id; })
                .map(function (s) { return s.id; })
            );
          }
        }

        const allRows = cache.students.map(s => ({
          id: s.id, role: 'student', display_name: s.name, init: s.init,
          color: s.color,
          first_name: s.firstName, last_name: s.lastName, profile_pic_url: s.profilePic,
          class_id: s.classId || 'default-class',
        }));
        const rows = writableClassIds
          ? allRows.filter(function (r) { return writableClassIds.has(r.class_id); })
          : allRows;

        const skipped = allRows.length - rows.length;
        if (skipped > 0) {
          console.warn('[DBService] profiles upsert: skipping ' + skipped + ' student(s) outside this session\'s advised section(s) — stale local cache, or a section/adviser reassignment since the last pull.');
        }

        if (rows.length) {
          const byClass = {};
          rows.forEach(function (r) { (byClass[r.class_id] = byClass[r.class_id] || []).push(r); });
          for (const classId of Object.keys(byClass)) {
            const { error } = await client.from('profiles').upsert(byClass[classId], { onConflict: 'id' });
            if (error) {
              console.warn('[DBService] profiles upsert rejected for class_id "' + classId + '" (' + byClass[classId].length + ' student(s) — not staff for this section server-side, or it has no adviser yet):', error);
            }
          }
        }
      }
    }

    // Boss events: upsert by internal _id (created server-side; a brand new
    // boss drafted offline has no _id yet, so it inserts and the server
    // assigns one on the next pull).
    if (isCatalogStaffSession && Array.isArray(cache.bossEvents)) {
      await _pushTable('boss_events', async () => {
      for (const b of cache.bossEvents) {
        try {
        const isNewRow = !b._id;
        const row = {
          id: b._id, class_id: b.classId || 'default-class', // Phase 14
          name: b.name, description: b.description, image: b.image,
          start_date: b.startDate || null, end_date: b.endDate || null,
          xp_reward: b.xpReward, coin_reward: b.coinReward,
          participation_reward: b.participationReward, victory_reward: b.victoryReward,
          defeat_narr_title: b.defeatNarrTitle, defeat_narr_text: b.defeatNarrText,
          victory_title: b.victoryTitle, victory_message: b.victoryMessage,
          loot_rewards: b.lootRewards || [], loot_duration_sec: b.lootDuration || 120,
          // Phase 46: same "always push, plain passthrough" treatment as
          // loot_rewards above — these are pure admin-config JSON blobs with
          // no RPC of their own, so the bulk upsert is their only write
          // path. See phase46_boss_advanced_settings_sync.sql.
          boss_questions: b.bossQuestions || [],
          minion_settings: b.minionSettings || {},
          combat_settings: b.combatSettings || {},
          skills: b.skills || {},
          skill_fire_mode: b.skillFireMode || null,
          skill_interval_min: b.skillIntervalMin || null,
          skill_interval_max: b.skillIntervalMax || null,
          rage_settings: b.rageSettings || {},
          phases: b.phases || [],
        };
        // max_hp/current_hp: both columns are NOT NULL with no server-side
        // default. saveBossForm() should always set maxHp (and derive
        // currentHp from it) before a boss reaches this array, but this has
        // repeatedly turned out not to hold for old/corrupt local drafts —
        // rows left over from before validation existed, or from manual
        // testing. Rather than let one such row's undefined maxHp throw a
        // NOT-NULL error and (before the per-row try/catch added here) take
        // every OTHER boss in the same push cycle down with it:
        //   - new row: fall back all the way to a hard default (10000,
        //     matching openBossForm()'s own default) so the insert always
        //     succeeds with something sane instead of erroring forever.
        //   - existing row: omit max_hp entirely when locally missing, so
        //     this upsert can't null out a previously-synced real value —
        //     same "don't touch what you don't have" reasoning as `stock`
        //     being excluded from shop_products below.
        if (isNewRow) {
          row.max_hp = b.maxHp || 10000;
          row.current_hp = (b.currentHp !== undefined && b.currentHp !== null) ? b.currentHp : row.max_hp;
        } else if (b.maxHp !== undefined && b.maxHp !== null) {
          row.max_hp = b.maxHp;
        }
        // Phase 26: current_hp/status/defeated_at/ended_at/loot_started_at/
        // loot_finalized_at are now fully owned by RPCs once a boss row
        // exists server-side — apply_boss_damage() (damage),
        // start_boss_event()/end_boss_event() (Phase 24 — activate/end),
        // start_loot_rush()/finalize_loot_rush() (Phase 25 — loot
        // transitions). Omitting them here means an upsert on an EXISTING
        // row leaves those columns untouched, exactly like `stock` is
        // already excluded from shop_products' bulk upsert below. The one
        // case that still needs them in this push is a boss that has
        // never reached Supabase at all (no _id yet) — there's no
        // create_boss_event() RPC, and nothing else can be racing on a
        // row that doesn't exist yet, so it's safe to seed the full
        // lifecycle state on that first insert only.
        if (isNewRow) {
          row.status = b.status;
          row.defeated_at = b.defeatedAt ? new Date(b.defeatedAt).toISOString() : null;
          row.ended_at = b.endedAt ? new Date(b.endedAt).toISOString() : null;
          row.loot_started_at = b.lootStartedAt ? new Date(b.lootStartedAt).toISOString() : null;
          row.loot_finalized_at = b.lootFinalizedAt ? new Date(b.lootFinalizedAt).toISOString() : null;
        }
        if (!row.id) delete row.id; // let Postgres gen_random_uuid() assign one
        let { error } = await client.from('boss_events').upsert(row, { onConflict: 'id' });
        // BUGFIX (stale local _id after an out-of-band delete): if a boss row
        // was deleted directly in Supabase (SQL editor, another admin, etc.)
        // while this browser's local cache still remembers its old _id, the
        // client wrongly treats this as an update-only row (isNewRow was
        // false) and omits current_hp/max_hp/status — but the server sees no
        // existing row with that id, so the upsert is really an INSERT and
        // trips the NOT-NULL constraint on current_hp (23502). That's a
        // reliable signal the local _id no longer refers to anything real;
        // retry once, this time seeding the full new-row lifecycle fields
        // (same values isNewRow would have used), so a locally-orphaned draft
        // can't get permanently stuck retrying the same failure forever.
        if (error && error.code === '23502') {
          row.max_hp = row.max_hp || b.maxHp || 10000;
          row.current_hp = (b.currentHp !== undefined && b.currentHp !== null && b.currentHp > 0) ? b.currentHp : row.max_hp;
          row.status = row.status || b.status || 'draft';
          row.defeated_at = row.defeated_at || (b.defeatedAt ? new Date(b.defeatedAt).toISOString() : null);
          row.ended_at = row.ended_at || (b.endedAt ? new Date(b.endedAt).toISOString() : null);
          row.loot_started_at = row.loot_started_at || (b.lootStartedAt ? new Date(b.lootStartedAt).toISOString() : null);
          row.loot_finalized_at = row.loot_finalized_at || (b.lootFinalizedAt ? new Date(b.lootFinalizedAt).toISOString() : null);
          ({ error } = await client.from('boss_events').upsert(row, { onConflict: 'id' }));
        }
        if (error) throw error;
        // NOTE: lootClaims are NOT pushed from here — they are written via
        // claim_loot_reward() RPC at claim time, never via bulk upsert, so
        // a stale local array can't overwrite server-confirmed claims.
        } catch (e) {
          // Per-row isolation: one broken boss (bad data, RLS mismatch on
          // just that row) shouldn't stop every OTHER boss in this same
          // array from syncing this cycle.
          console.warn('[DBService] boss_events: skipping "' + (b.name || b._id || 'unnamed') + '" this cycle —', e);
        }
      }
      });
    }

    // Boss participants: upsert the roster. Same defense-in-depth note as
    // profiles above — RLS still restricts student-initiated writes to
    // their own row while the boss is active.
    if (cache.bossParticipants && cache._bossIdById) {
      await _pushTable('boss_participants', async () => {
      const idToUuid = {};
      Object.keys(cache._bossIdById).forEach(uuid => { idToUuid[cache._bossIdById[uuid]] = uuid; });
      const rows = [];
      Object.keys(cache.bossParticipants).forEach(idx => {
        const bossUuid = idToUuid[idx];
        if (!bossUuid) return;
        const roster = cache.bossParticipants[idx];
        Object.keys(roster).forEach(studentId => {
          const r = roster[studentId];
          rows.push({
            boss_id: bossUuid, student_id: studentId,
            class_id: r.classId || 'default-class', // Phase 14
            total_damage: r.totalDamage || 0, correct_answers: r.correctAnswers || 0,
            wrong_answers: r.wrongAnswers || 0, crit_hits: r.critHits || 0,
            minions_defeated: r.minionsDefeated || 0, last_question_idx: r.lastQIdx || 0,
          });
        });
      });
      if (rows.length) {
        const { error } = await client.from('boss_participants').upsert(rows, { onConflict: 'boss_id,student_id' });
        if (error) throw error;
      }
      });
    }

    // Shop products: per-teacher catalog (Phase 14). `stock` is deliberately
    // excluded from this bulk upsert — it's owned exclusively by the
    // purchase_shop_product() / restock_shop_product() RPCs, same reasoning
    // as xp/coins/current_hp elsewhere in this file: a plain overwrite here
    // could clobber a purchase or restock that happened between this tab's
    // last pull and this push. New products get their initial stock set via
    // a direct restock_shop_product() call at creation time instead (see
    // shop_admin_store.js doAddProduct()) — this upsert alone would leave a
    // brand new row's stock at the column default.
    if (isCatalogStaffSession && Array.isArray(cache.store) && cache.store.length) {
      await _pushTable('shop_products', async () => {
      const rows = cache.store
        .filter(p => p.ownerTeacherId) // skip anything not yet stamped with an owner
        .map(p => ({
          id: p.id, owner_teacher_id: p.ownerTeacherId,
          name: p.name, emoji: p.emoji, description: p.desc, category: p.cat,
          cost: p.cost, active: p.active !== false,
        }));
      if (rows.length) {
        const { error } = await client.from('shop_products').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Achievements (the catalog — Phase 17): same pattern as boss_events/
    // shop_products above. isHidden is deliberately NOT included — it isn't
    // a real column in this table today (admin-side-only local filter), so
    // it stays local-only for now; flagged in FIXES_APPLIED, not silently
    // dropped. user_achievements (the per-student unlock/claim rows) are
    // NOT pushed from here — those go exclusively through
    // award_achievement_to_student() / claim_achievement_reward() /
    // revoke_achievement_from_student() (Phase 17), same "RPC only, never
    // bulk upsert" reasoning as loot_claims/registrations.
    // Phase 32: owner_teacher_id is now required (per-teacher catalog, same
    // as shop_products) — rows without an ownerTeacherId stamped yet are
    // skipped, same "skip anything not yet stamped with an owner" rule the
    // store block above already uses.
    //
    // BUGFIX: this had no staff-session gate at all — unlike shop_products/
    // boss_events (see isCatalogStaffSession above), which had the same gap
    // fixed earlier. Every student session loads the achievements catalog
    // (to show what's available to earn), so ANY save while logged in as a
    // student queued a full re-push of achievements too — always rejected by
    // RLS since a student never owns any of those rows, printing the same
    // scary "remote sync failed" warning for a table nothing had actually
    // changed on.
    if (isCatalogStaffSession && Array.isArray(cache.achievements) && cache.achievements.length) {
      await _pushTable('achievements', async () => {
      const rows = cache.achievements
        .filter(a => a.id && a.ownerTeacherId) // Phase 32: skip anything not yet stamped with an owner
        .map(a => ({
          id: a.id, owner_teacher_id: a.ownerTeacherId,
          name: a.name, description: a.description, icon: a.icon,
          category: a.category, rarity: a.rarity, xp_reward: a.xpReward,
          coin_reward: a.coinReward, trigger_type: a.triggerType,
          trigger_value: a.triggerValue, active: a.active !== false,
        }));
      if (rows.length) {
        const { error } = await client.from('achievements').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Titles (the catalog — Phase 18): same pattern as achievements just
    // above. title_unlocks (per-student) and equipped_title_id (on
    // profiles) are NOT pushed from here — those go exclusively through
    // unlock_title_for_student() / revoke_title_from_student() /
    // set_equipped_title(), same "RPC only, never bulk upsert" reasoning.
    // Phase 32: owner_teacher_id now required — same skip-if-unstamped rule.
    // Same isCatalogStaffSession gate as achievements above — same bug,
    // same fix (a student session loading their available titles was
    // triggering a doomed re-push of this whole catalog).
    // Phase 52: frame_shape/frame_style/accent_color/effect/frame_template
    // added — Designer v3 (titles_designer.js) has written these onto every
    // draft since it shipped, but they were never in this row list, so a
    // chosen frame silently vanished the moment this push ran and the next
    // full load pulled titles back from Supabase without them (see
    // phase52_titles_designer_v3_columns.sql for the full story).
    if (isCatalogStaffSession && Array.isArray(cache.titles) && cache.titles.length) {
      await _pushTable('titles', async () => {
      const rows = cache.titles
        .filter(t => t.id && t.ownerTeacherId) // Phase 32: skip anything not yet stamped with an owner
        .map(t => ({
          id: t.id, owner_teacher_id: t.ownerTeacherId,
          name: t.name, description: t.description, icon: t.icon,
          rarity: t.rarity, active: t.active !== false, achievement_id: t.achievementId,
          text_color: t.textColor, border_color: t.borderColor, glow_color: t.glowColor,
          bg_color: t.bgColor, primary_color: t.primaryColor, secondary_color: t.secondaryColor,
          gradient_from: t.gradientFrom, gradient_to: t.gradientTo, border_style: t.borderStyle,
          animation: t.animation, particles: t.particles, bg_effect: t.bgEffect,
          custom_border_css: t.customBorderCSS, custom_animation_css: t.customAnimationCSS,
          custom_bg_css: t.customBgCSS,
          frame_shape: t.frameShape, frame_style: t.frameStyle, accent_color: t.accentColor,
          effect: t.effect, frame_template: t.frameTemplate,
        }));
      if (rows.length) {
        const { error } = await client.from('titles').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Quizzes (the content catalog — Phase 20): same pattern as
    // achievements/titles above. This closes the gap documented in
    // SYNC_AUDIT_REPORT.md — quiz content (title/description/rewards/
    // questions) had no push path at all before this. Per-student
    // completedQuizzes / quiz history is NOT part of this block (out of
    // scope, unchanged). quiz_sections (who can see a quiz) is also
    // unchanged — it still goes exclusively through set_quiz_sections(),
    // never this bulk upsert.
    // Phase 32: owner_teacher_id now required — same skip-if-unstamped rule.
    // Same isCatalogStaffSession gate as achievements/titles above.
    if (isCatalogStaffSession && Array.isArray(cache.quizzes) && cache.quizzes.length) {
      await _pushTable('quizzes', async () => {
      const rows = cache.quizzes
        .filter(q => q.id && q.ownerTeacherId) // Phase 32: skip anything not yet stamped with an owner
        .map(q => ({
          id: q.id, owner_teacher_id: q.ownerTeacherId,
          title: q.title, description: q.desc,
          xp_reward: q.xpReward, coin_reward: q.coinReward, time_limit: q.timeLimit,
          // Phase 54: mirror of the pull-side coalesce above, so a quiz
          // saved before rarity/cadence pickers existed doesn't push NULL
          // and overwrite a value the Phase 54 SQL backfill already set.
          rarity: q.rarity || 'Common', cadence: q.cadence || 'standing',
          // Phase 56: mirror of the pull-side coalesce above for quest
          // chains — an unchained quiz pushes chain_id as null (correct;
          // there's nothing to preserve), chain_order still coalesces to 1.
          chain_id: q.chainId || null, chain_order: q.chainOrder || 1, chain_label: q.chainLabel || null,
          // Phase 58: mirror of the pull-side coalesce above for scheduling —
          // an unscheduled quiz pushes both as null (correct; always
          // available, nothing to preserve).
          start_date: q.startDate || null, end_date: q.endDate || null,
          // Phase 3 — mirror of the pull-side coalesce above; a quiz saved
          // before the stage-timer fields existed pushes [null,null,null]
          // (correct — nothing to preserve, defaults apply).
          stage_timers: Array.isArray(q.stageTimers) ? q.stageTimers : [null, null, null],
          questions: q.questions || [], active: q.active !== false,
        }));
      if (rows.length) {
        const { error } = await client.from('quizzes').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Campaign worlds (the content catalog — Phase 22): same pattern as
    // quizzes above. This closes the gap documented in
    // SYNC_AUDIT_REPORT.md — campaign content (worlds/stages/scenes/
    // enemies/questions) had no push path at all before this. sort_order
    // is stamped from each world's position in cache.stageMap, since
    // there's no reorder-world feature (array position IS the order).
    // stageProgress (per-student progress) is NOT part of this block —
    // out of scope, unchanged.
    // Phase 32: owner_teacher_id now required — same skip-if-unstamped rule.
    // Same isCatalogStaffSession gate as achievements/titles/quizzes above.
    if (isCatalogStaffSession && Array.isArray(cache.stageMap) && cache.stageMap.length) {
      await _pushTable('campaign_worlds', async () => {
      const rows = cache.stageMap
        .filter(w => w.id && w.ownerTeacherId) // Phase 32: skip anything not yet stamped with an owner
        .map((w, idx) => ({
          id: w.id, owner_teacher_id: w.ownerTeacherId,
          label: w.label, icon: w.icon, color: w.color,
          description: w.desc, stages: w.stages || [], sort_order: idx,
        }));
      if (rows.length) {
        const { error } = await client.from('campaign_worlds').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Registrations: NO LONGER pushed here. Wave 2 security fix
    // (supabase/wave2_registration_security_fixes.sql) revoked direct
    // insert/update on this table entirely — every write now goes through
    // submit_registration() / approve_registration() / reject_registration()
    // RPCs (see modules/admin/registrations-service.js), which is also how
    // this table stopped needing to hold a plaintext password column at
    // all. DB.registrations is still pulled (read-only) above for display.

    // Point log: append-only history. Upsert by the client-generated id
    // (added at every DB.pointLog.unshift(...) call site) so re-pushing the
    // whole array on every save doesn't insert duplicate rows for entries
    // that were already synced.
    if (Array.isArray(cache.pointLog) && cache.pointLog.length) {
      await _pushTable('point_log', async () => {
      const rows = cache.pointLog
        .filter(p => p.id) // skip any stray pre-migration entries with no id
        .map(p => ({ id: p.id, student_id: p.studentId, what: p.what, pts: p.pts, when_label: p.when }));
      if (rows.length) {
        const { error } = await client.from('point_log').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Notifications: same upsert-by-id shape as point_log above. Unlike
    // point_log (append-only), these rows DO get updated in place — marking
    // one read, or "mark all read" — so this table needed the UPDATE policy
    // from day one (see phase67_notifications.sql's header comment; this is
    // the exact bug class Phase 47/61 had to fix after the fact elsewhere).
    if (Array.isArray(cache.notifications) && cache.notifications.length) {
      await _pushTable('notifications', async () => {
      const rows = cache.notifications
        .filter(n => n.id && n.studentId) // skip anything malformed
        .map(n => ({
          id: n.id, student_id: n.studentId, type: n.type, icon: n.icon,
          title: n.title, body: n.body, action: n.action, pts: n.pts,
          source_id: n.sourceId, read: !!n.read,
        }));
      if (rows.length) {
        const { error } = await client.from('notifications').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Redemptions: orderId is already a unique client-generated key from
    // checkout time, so it's reused directly as the upsert conflict target.
    if (Array.isArray(cache.redemptions) && cache.redemptions.length) {
      await _pushTable('redemptions', async () => {
      const rows = cache.redemptions
        .filter(r => r.orderId)
        .map(r => ({
          order_id: r.orderId, student_id: r.studentId, item_id: r.itemId,
          item_name: r.itemName, emoji: r.emoji, item_label: r.item, pts: r.pts,
          date_label: r.date, time_label: r.time, claim_code: r.claimCode,
        }));
      if (rows.length) {
        const { error } = await client.from('redemptions').upsert(rows, { onConflict: 'order_id' });
        if (error) throw error;
      }
      });
    }

    // Phase 48 — orders: mirrors redemptions' pattern exactly, same
    // client-generated unique key (orderId) reused as the upsert conflict
    // target. Covers all three writers of DB.orders: cartCheckout() (new
    // pending orders), shop_pos_terminal.js's posExecuteClaim()/
    // posExecuteCancel() (staff status transitions), and shop_orders.js's
    // ordExecuteCancel() (student self-cancel) — every one of them already
    // ends in saveDB(), which is all this bulk-upsert path needs to pick up
    // the change on the next debounced push.
    if (Array.isArray(cache.orders) && cache.orders.length) {
      await _pushTable('orders', async () => {
      const rows = cache.orders
        .filter(o => o.orderId)
        .map(o => ({
          order_id: o.orderId, student_id: o.studentId,
          student_name: o.studentName, student_init: o.studentInit, student_color: o.studentColor,
          item_id: o.itemId, item_name: o.itemName, emoji: o.emoji,
          cost: o.cost, category: o.category, claim_code: o.claimCode,
          status: o.status || 'pending',
          created_at: o.createdAt, created_date_str: o.createdDateStr,
          // claimedAt/cancelledAt are epoch-ms numbers locally (Date.now()) —
          // convert to timestamptz on the way out, mirror of the pull-side
          // Date.parse() above.
          claimed_at: o.claimedAt ? new Date(o.claimedAt).toISOString() : null,
          claimed_by: o.claimedBy,
          cancelled_at: o.cancelledAt ? new Date(o.cancelledAt).toISOString() : null,
          cancel_reason: o.cancelReason, cancelled_by: o.cancelledBy,
        }));
      if (rows.length) {
        const { error } = await client.from('orders').upsert(rows, { onConflict: 'order_id' });
        if (error) throw error;
      }
      });
    }

    // Phase 48 — inventory: keyed by (student_id, item_id) rather than a
    // single id, since DB.inventory is {studentId: [...]} with cartCheckout()
    // (and, after the loot-service.js patch shipped alongside this,
    // LootService.claimReward()) already upserting-by-itemId within each
    // student's own array. Flatten that shape out into rows here; the
    // composite PK on the table does the actual per-item upsert.
    if (cache.inventory && typeof cache.inventory === 'object') {
      await _pushTable('inventory', async () => {
      const rows = [];
      Object.keys(cache.inventory).forEach(sid => {
        (cache.inventory[sid] || []).forEach(item => {
          if (!item.itemId) return;
          rows.push({
            student_id: sid, item_id: item.itemId, item_name: item.itemName, emoji: item.emoji,
            category: item.category, quantity: item.quantity || 1,
            date_purchased: item.datePurchased, last_purchased: item.lastPurchased,
            source: item.source || 'Store', status: item.status || 'active', used_at: item.usedAt,
          });
        });
      });
      if (rows.length) {
        const { error } = await client.from('inventory').upsert(rows, { onConflict: 'student_id,item_id' });
        if (error) throw error;
      }
      });
    }

    // Phase 57: quiz_history, append-only per-student attempt log. Upsert by
    // the client-generated id (see finishQuiz() in index.html, which now
    // stamps `id: 'qh_' + uid()` on every new entry) so re-pushing the whole
    // per-student array on every save doesn't insert duplicate rows for
    // attempts that were already synced — same upsert-by-id convention as
    // point_log above. Entries from before this phase have no id and are
    // skipped here (they stay visible locally; they just never sync — same
    // "pre-migration entries simply don't sync retroactively" posture as
    // point_log's own BUGFIX comment above).
    if (cache.quizHistory && typeof cache.quizHistory === 'object') {
      await _pushTable('quiz_history', async () => {
      const rows = [];
      Object.keys(cache.quizHistory).forEach(sid => {
        (cache.quizHistory[sid] || []).forEach(h => {
          if (!h.id || !h.quizId) return;
          rows.push({
            id: h.id, student_id: sid, quiz_id: h.quizId,
            score: h.score || 0, attempt: h.attempt || 1,
            completed_at: h.completedAt, date_label: h.date,
            // Phase 59: mirror of the pull-side mapping above — an entry
            // logged before per-question tracking existed simply has no
            // `results` array, and pushes null rather than an empty array
            // (an empty array would misleadingly imply "0 questions").
            question_results: Array.isArray(h.results) ? h.results : null,
            // Phase 63: mirror of the pull-side mapping above — without this,
            // abortQuiz()'s `aborted:true` never left the browser, so a
            // walked-away attempt looked like a genuine completion (and a
            // potential perfect score) the moment it synced anywhere else.
            aborted: !!h.aborted,
          });
        });
      });
      if (rows.length) {
        const { error } = await client.from('quiz_history').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      });
    }

    // Phase 30 removed recitation_log's INSERT policy on purpose — writes go
    // exclusively through log_recitation_point()/undo_recitation_log()
    // (SECURITY DEFINER RPCs, see recitation-service.js), which already
    // persist server-side and mirror the result into draft.recitationLog
    // locally. This direct bulk upsert was leftover from before that RPC
    // path existed (logger.js's local-only logRecitation() it used to back
    // isn't wired to any UI anymore) and now 42501s on every sync for every
    // account, since the table has no INSERT grant at all outside the RPCs.
    // NOTE: recitationLog is NOT pushed from here, same reasoning as
    // lootClaims above.
  }

  // ── Realtime signal channel ───────────────────────────────────────────────
  // [BLOCKER-SIGNAL] fix: pendingSkill / pendingBossSummon used to be fields
  // written into the DB blob so other tabs would pick them up on their next
  // loadDB() poll. That is replaced here with a proper broadcast channel.
  // Modules that used to read DB.pendingBossSummon should instead call
  // DBService.onSignal('boss-summon', cb) — see migration-strategy.md for
  // the two call sites (summon-notify.js) that need this one-line swap.
  let _signalChannel = null;
  const _signalSubscribers = {};

  function _setupRealtimeSignals(client) {
    _signalChannel = client.channel('eduquest-signals');
    _signalChannel.on('broadcast', { event: '*' }, (msg) => {
      const handlers = _signalSubscribers[msg.event] || [];
      handlers.forEach(fn => { try { fn(msg.payload); } catch (e) { console.error(e); } });
    });
    _signalChannel.subscribe((status) => {
      _meta.signalChannelReady = (status === 'SUBSCRIBED');
    });

    // Also subscribe to table changes so other tabs' writes refresh _cache
    // without a full re-poll — this is what keeps the synchronous read()
    // "fresh enough" between explicit syncs (see THE SYNC PROBLEM above).
    //
    // Phase 14 note: this channel has no per-table `filter`, so on the
    // surface it looks like every tab hears every section's changes. Once
    // phase14_section_isolation.sql's RLS ships, that's no longer true —
    // Supabase Realtime evaluates each table's RLS policy per subscriber, so
    // a session only ever receives postgres_changes events for rows that
    // session's policy (is_staff_for_section(), student's own class_id,
    // etc.) actually permits it to read. A teacher's tab re-pulling on any
    // event still only pulls what RLS returns — i.e. that teacher's own
    // section(s), never another teacher's. Adding explicit per-section
    // `filter:` clauses here would still be worth doing later purely as a
    // bandwidth/perf optimization (fewer events to evaluate client-side when
    // a teacher runs several sections), but it is NOT required for
    // correctness anymore — RLS is the actual boundary. Left as a follow-up
    // rather than rewritten in this pass, since it touches _cache merge
    // logic other modules depend on.
    client
      .channel('eduquest-table-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => _schedulePullRefresh('profiles'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boss_events' }, () => _schedulePullRefresh('boss_events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loot_claims' }, () => _schedulePullRefresh('loot_claims'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_achievements' }, () => _schedulePullRefresh('user_achievements'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_logs' }, () => _schedulePullRefresh('attendance_logs'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfid_cards' }, () => _schedulePullRefresh('rfid_cards'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recitation_log' }, () => _schedulePullRefresh('recitation_log'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages' }, () => _schedulePullRefresh('mail_messages')) // Phase 15
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_sections' }, () => _schedulePullRefresh('quiz_sections')) // Phase 15
      .on('postgres_changes', { event: '*', schema: 'public', table: 'achievement_sections' }, () => _schedulePullRefresh('achievement_sections')) // Phase 16
      // Phase 19: achievements/titles catalogs and title_unlocks were pulled
      // and pushed correctly since Phase 17/18, but never added to this
      // subscription list — a badge or title created on one device only
      // reached another device on that device's next full reload, not
      // live. user_achievements was already here; title_unlocks gets the
      // same treatment for parity (equipped_title_id rides on `profiles`,
      // already covered by the profiles subscription above).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'achievements' }, () => _schedulePullRefresh('achievements'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'titles' }, () => _schedulePullRefresh('titles'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'title_unlocks' }, () => _schedulePullRefresh('title_unlocks'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quizzes' }, () => _schedulePullRefresh('quizzes')) // Phase 20
      .on('postgres_changes', { event: '*', schema: 'public', table: 'title_sections' }, () => _schedulePullRefresh('title_sections')) // Phase 21
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_worlds' }, () => _schedulePullRefresh('campaign_worlds')) // Phase 22
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_stage_sections' }, () => _schedulePullRefresh('campaign_stage_sections')) // Phase 53
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => _schedulePullRefresh('orders')) // Phase 48
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => _schedulePullRefresh('inventory')) // Phase 48
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_history' }, () => _schedulePullRefresh('quiz_history')) // Phase 57
      // Phase 67: point_log was pulled/pushed correctly since Wave 1 but,
      // like achievements/titles before Phase 19, was never added to this
      // subscription list — a recitation grant, boss victory, or admin point
      // adjustment on one tab/device never live-reached another tab's
      // notification bell until its next full reload. notifications gets
      // the same treatment so the badge/toast update live too.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'point_log' }, () => _schedulePullRefresh('point_log'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => _schedulePullRefresh('notifications'))
      // Phase 7 (Campaign Redesign) — a skill grant/spend on one device
      // (campaign_engine.js's adjust_student_skill_count() calls) now live-
      // reaches the same student's other open tabs/devices too.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_skills' }, () => _schedulePullRefresh('student_skills'))
      .subscribe();
  }

  let _pullRefreshTimer = null;
  let _pendingRefreshTables = new Set();
  function _schedulePullRefresh(table) {
    // Debounce incoming realtime bursts (e.g. a raid with 30 students
    // hitting at once) into a single re-pull, same 400ms rhythm as uploads.
    //
    // Priority 2 Fix 1: track WHICH table(s) changed during this debounce
    // window (every .on('postgres_changes', ...) handler above now passes
    // its own table name) so the eventual refresh only re-fetches the
    // groups those tables actually belong to — see _applyScopedRefresh() /
    // _REFRESH_GROUPS above — instead of unconditionally re-running all 27
    // queries in _pullCacheFromSupabase() on every single event. Calling
    // this with no argument (or a table _applyScopedRefresh doesn't
    // recognize) still falls back to a full pull, so this stays safe by
    // default for anything not yet mapped.
    _pendingRefreshTables.add(table || _FULL_PULL_SENTINEL);

    if (_pullRefreshTimer) clearTimeout(_pullRefreshTimer);
    _pullRefreshTimer = setTimeout(async () => {
      const changedTables = Array.from(_pendingRefreshTables);
      _pendingRefreshTables = new Set();
      const client = _getClient();
      if (!client) return;
      try {
        await _applyScopedRefresh(client, changedTables);
        _localStorageProvider.write(JSON.stringify(_cache)); // keep offline mirror current
        _meta.lastRemoteSyncAt = new Date().toISOString();
        // Notify AppStore so subscribed UI re-renders with the synced data.
        if (window.AppStore && typeof window.AppStore.syncFromLegacy === 'function') {
          window.AppStore.syncFromLegacy(_cache, 'state:remote-sync');
        }
      } catch (e) {
        console.warn('[DBService] realtime refresh pull failed:', e);
      }
    }, 400);
  }

  // ── Priority 2 Fix 2 follow-up: "load more" beyond the default window ────
  // _HISTORY_LIMITS keeps every pull fast by default. This is the escape
  // hatch for any screen that wants to page further back than that default
  // window (e.g. a "load older redemptions" button) — see
  // EduQuest_Priority2_Plan.md "Fix 2".
  //
  // Deliberately covers only the 6 tables whose cache shape is a flat
  // array keyed purely by insertion order. mail_messages and quiz_history
  // are NOT here: mail is reshaped from many per-recipient rows into fewer
  // grouped batches (_deriveMail), and quiz_history feeds both a
  // per-student map AND students[].completedQuizzes (see the 'quizHistory'
  // refresh group above) — naive offset pagination on either risks
  // duplicate/incomplete batches or silently un-completing a quest. Left as
  // a follow-up if "load more" is ever actually needed for either screen.
  const _HISTORY_TABLE_CONFIG = {
    pointLog:       { table: 'point_log',       orderCol: 'created_at', derive: _derivePointLog },
    redemptions:    { table: 'redemptions',     orderCol: 'created_at', derive: _deriveRedemptions },
    recitationLog:  { table: 'recitation_log',  orderCol: 'created_at', derive: _deriveRecitationLog },
    attendanceLogs: { table: 'attendance_logs', orderCol: 'log_date',   derive: _deriveAttendanceLogs },
    orders:         { table: 'orders',          orderCol: 'created_at', derive: _deriveOrders },
    notifications:  { table: 'notifications',   orderCol: 'created_at', derive: _deriveNotifications },
  };

  async function _loadMoreHistory(cacheKey, pageSize) {
    const cfg = _HISTORY_TABLE_CONFIG[cacheKey];
    if (!cfg) {
      throw new Error(`[DBService] loadMoreHistory: unsupported key "${cacheKey}" (expected one of: ${Object.keys(_HISTORY_TABLE_CONFIG).join(', ')})`);
    }
    const client = _getClient();
    if (!client || !_cache) return { added: 0, exhausted: true };

    const already = (_cache[cacheKey] || []).length;
    const limit = pageSize || _HISTORY_LIMITS[cfg.table] || 200;
    const res = await client.from(cfg.table).select('*')
      .order(cfg.orderCol, { ascending: false })
      .range(already, already + limit - 1);
    if (res.error) throw res.error;

    const newRows = cfg.derive(res.data);
    _cache = { ..._cache, [cacheKey]: [...(_cache[cacheKey] || []), ...newRows] };
    _localStorageProvider.write(JSON.stringify(_cache));
    if (window.AppStore && typeof window.AppStore.syncFromLegacy === 'function') {
      window.AppStore.syncFromLegacy(_cache, 'state:remote-sync');
    }
    return { added: newRows.length, exhausted: newRows.length < limit };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {

    /**
     * initRemote() → Promise<void>
     * MUST be awaited once, before AppStore.init() runs (i.e. before
     * state-manager.js's auto-init IIFE — see migration-strategy.md for the
     * exact index.html change: state-manager.js's auto-init is wrapped so
     * it waits on a resolved promise instead of running at parse time).
     * Hydrates _cache from Supabase, or from localStorage if offline/no
     * Supabase config is present — this is the "No Downtime" fallback.
     */
    initRemote: async function () {
      _meta.provider = _resolveProvider();
      const client = _getClient();

      if (!client) {
        console.warn('[DBService] No Supabase client configured — running on localStorage only.');
        _cache = null; // forces read() to fall back to DEFAULT_DB / local cache below
        return;
      }

      try {
        // BUGFIX (see REPORT_empty_data_until_admin_login.md): this pull
        // used to run unconditionally, the instant the page loaded — before
        // the login screen was even usable. On a browser with no saved
        // session, that meant it ran as `anon`. RLS doesn't error for anon,
        // it just returns zero rows for every table (every policy here is
        // shaped around auth.uid(), which is null for anon) — so the pull
        // "succeeded" with an empty dataset, and that empty snapshot then
        // silently overwrote a perfectly good localStorage mirror from a
        // previous session. Now: if there's no saved session yet, skip the
        // network pull entirely and load straight from whatever's already
        // in the local mirror. The real, correctly-scoped pull now happens
        // right after login instead — see refreshAfterAuthChange() below,
        // called from auth.js's doLogin().
        const { data: sessionData } = await client.auth.getSession();
        if (!sessionData || !sessionData.session) {
          console.warn('[DBService] No saved session yet — loading local cache only; will pull fresh right after login.');
          _meta.online = false;
          try {
            const raw = _localStorageProvider.read();
            _cache = raw ? JSON.parse(raw) : null;
          } catch (e2) { _cache = null; }
          _setupRealtimeSignals(client);
          return;
        }

        // [PERF FIX — non-blocking boot] This is the returning-user case:
        // a saved session exists, meaning this browser already completed a
        // full, correctly-scoped pull at some earlier point (this exact
        // login, or a previous one). Previously, EVERY page load — not
        // just the first ever — awaited a fresh, unfiltered pull of all
        // ~24 tables before AppStore.init() would resolve and the app
        // would render anything. On a slow connection, a returning user
        // stared at the boot spinner for however long that full sync took,
        // every single time, even though a perfectly good (just possibly a
        // few seconds/minutes stale) snapshot of their own data was
        // already sitting in localStorage from last time.
        //
        // Fix: if a local mirror exists AND it was last synced for THIS
        // same auth user id, use it immediately (synchronous, ~0ms) so
        // AppStore.init() can resolve and the app can render right away —
        // then run the real pull in the background and push the fresh
        // result in via AppStore.syncFromLegacy('state:remote-sync'), the
        // exact same mechanism _schedulePullRefresh() already uses for
        // live realtime updates elsewhere in this file. No new UI-update
        // code path is introduced; this reuses one already proven to work.
        //
        // The uid check matters specifically because this is a kiosk /
        // shared-device app (see the RFID kiosk screen) — without it, a
        // different account's leftover localStorage mirror from an
        // earlier session on the same PC could flash on screen before the
        // real pull lands. If the stamped uid doesn't match (or nothing is
        // stamped yet — first login ever on this browser), fall straight
        // through to the original blocking behavior below, which is always
        // correct, just not fast.
        const _uid = sessionData.session.user && sessionData.session.user.id;
        let _localMirror = null;
        try {
          const rawMirror = _localStorageProvider.read();
          const stampedUid = window.localStorage.getItem(_LAST_SYNCED_UID_KEY);
          if (rawMirror && stampedUid && _uid && stampedUid === _uid) {
            _localMirror = JSON.parse(rawMirror);
          }
        } catch (e3) { _localMirror = null; }

        if (_localMirror) {
          _cache = _localMirror;
          _meta.online = true; // best-effort — a real pull is about to confirm/correct this
          _setupRealtimeSignals(client);

          // Background pull — NOT awaited, so initRemote() (and therefore
          // AppStore.init()) resolves immediately above with the cached
          // snapshot already showing.
          _pullCacheFromSupabase(client).then(function (fresh) {
            _cache = fresh;
            _localStorageProvider.write(JSON.stringify(_cache));
            if (_uid) window.localStorage.setItem(_LAST_SYNCED_UID_KEY, _uid);
            _meta.lastRemoteSyncAt = new Date().toISOString();
            _meta.online = true;
            if (window.AppStore && typeof window.AppStore.syncFromLegacy === 'function') {
              window.AppStore.syncFromLegacy(_cache, 'state:remote-sync');
            }
          }).catch(function (e4) {
            // Cached snapshot stays on screen; nothing torn down. Same
            // "stay on local cache" posture as every other sync failure
            // path in this file.
            console.warn('[DBService] background initial-boot pull failed, staying on cached snapshot:', e4);
            _meta.lastError = String(e4 && e4.message || e4);
          });

          return;
        }

        // No usable same-account local mirror (first login ever on this
        // browser, or a different account's mirror is what's cached) —
        // original, correct, blocking behavior: nothing renders until this
        // completes.
        _cache = await _pullCacheFromSupabase(client);
        _localStorageProvider.write(JSON.stringify(_cache)); // seed offline mirror
        if (_uid) window.localStorage.setItem(_LAST_SYNCED_UID_KEY, _uid);
        _meta.lastRemoteSyncAt = new Date().toISOString();
        _meta.online = true;
        _setupRealtimeSignals(client);
      } catch (e) {
        console.error('[DBService] initial Supabase pull failed, falling back to local cache:', e);
        _meta.lastError = String(e && e.message || e);
        _meta.online = false;
        try {
          const raw = _localStorageProvider.read();
          _cache = raw ? JSON.parse(raw) : null;
        } catch (e2) { _cache = null; }
      }
    },

    /**
     * refreshAfterAuthChange() → Promise<void>
     * Re-pulls the full dataset under whichever Supabase Auth session is
     * CURRENTLY active, overwrites the in-memory cache + localStorage
     * mirror, and pushes the fresh data to AppStore so already-rendered UI
     * updates immediately.
     *
     * MUST be called right after every successful doLogin() (see auth.js),
     * before bootApp() renders the dashboard. Without this, whatever was
     * pulled during the LAST initRemote() call (e.g. under a previous
     * account's session, or no session at all) just keeps sitting in
     * memory — signInWithPassword() only changes which account can WRITE
     * and which RLS rows are visible on the NEXT query; it does not
     * retroactively re-scope data that's already sitting in the client-side
     * cache.
     *
     * This is what caused a teacher account to see a *different* teacher's
     * (or admin's) full roster after switching accounts in the same browser
     * without an intervening full page reload — see
     * REPORT_cross_account_data_and_template_row.md, Part 5. RLS itself was
     * never broken; the cache was just stale.
     */
    refreshAfterAuthChange: async function () {
      const client = _getClient();
      if (!client) return;
      // Invalidate any push still queued from BEFORE this refresh (e.g. a
      // save that fired right before switching accounts) immediately, so it
      // can't fire mid-pull and race this function's own cache replacement.
      _sessionEpoch++;
      if (_uploadTimer) { clearTimeout(_uploadTimer); _uploadTimer = null; }
      try {
        _cache = await _pullCacheFromSupabase(client);
        _localStorageProvider.write(JSON.stringify(_cache));
        // [PERF FIX — non-blocking boot] Stamp which account this mirror is
        // now correctly scoped for, so the NEXT page load (a returning
        // session, handled by initRemote() above) is eligible for the
        // instant-render fast path instead of the original blocking pull.
        try {
          const { data: sd } = await client.auth.getSession();
          const uid = sd && sd.session && sd.session.user && sd.session.user.id;
          if (uid) window.localStorage.setItem(_LAST_SYNCED_UID_KEY, uid);
        } catch (eStamp) { /* non-critical — worst case, next load just isn't fast-pathed */ }
        _meta.lastRemoteSyncAt = new Date().toISOString();
        _meta.online = true;
        _meta.lastError = null;
        if (window.AppStore && typeof window.AppStore.syncFromLegacy === 'function') {
          window.AppStore.syncFromLegacy(_cache, 'state:auth-change-sync');
        }
      } catch (e) {
        // BUGFIX: this used to leave _cache exactly as it was on failure —
        // which, right after switching accounts, means the PREVIOUS
        // account's data. Any later save would then queue a push of that
        // stale, wrong-owner cache under the new session, hitting RLS
        // forever. Clearing it forces a clean re-pull attempt on the next
        // read rather than silently mixing sessions.
        _cache = null;
        try { _localStorageProvider.remove(); } catch (e2) {}
        _meta.lastError = String(e && e.message || e);
        _meta.online = false;
        console.warn('[DBService] refreshAfterAuthChange pull failed, dashboard may show stale data:', e);
      }
    },

    /**
     * read(defaultValue) → Object   [SYNCHRONOUS — see THE SYNC PROBLEM]
     * Returns a deep clone of the in-memory cache. If the cache was never
     * hydrated (initRemote() not called, or both Supabase and localStorage
     * are empty), returns a deep clone of defaultValue, exactly like v1.
     *
     * BUGFIX: defaultValue is optional — every existing call site in the
     * app calls loadDB() / DBService.read() with NO argument and relies on
     * DEFAULT_DB already being baked in elsewhere. JSON.stringify(undefined)
     * returns the bare string "undefined", and JSON.parse("undefined")
     * throws — so this must check for undefined explicitly rather than
     * blindly round-tripping whatever was passed in.
     */
    read: function (defaultValue) {
      _meta.loadCount++;
      _meta.lastLoadAt = new Date().toISOString();
      if (_cache) return JSON.parse(JSON.stringify(_cache));
      try {
        var raw = _localStorageProvider.read();
        if (raw) { _cache = JSON.parse(raw); return JSON.parse(JSON.stringify(_cache)); }
      } catch (e) { /* corrupt or absent — fall through */ }
      if (defaultValue === undefined || defaultValue === null) return null;
      return JSON.parse(JSON.stringify(defaultValue));
    },

    /**
     * write(db) → void   [SYNCHRONOUS locally, ASYNC remotely]
     * Updates the in-memory cache and the localStorage mirror IMMEDIATELY
     * (so a refresh or network loss never loses the last write), then
     * queues a debounced push to Supabase.
     */
    write: function (db) {
      _meta.saveCount++;
      _meta.lastSaveAt = new Date().toISOString();
      _cache = db;
      try {
        _localStorageProvider.write(JSON.stringify(db));
      } catch (e) {
        console.warn('[DBService] localStorage mirror write failed (quota?):', e);
      }
      if (_getClient()) _queueUpload();
    },

    /**
     * remove() → void
     * Hard-reset: clears local cache + mirror. Does NOT delete remote rows
     * (that is a destructive admin action, intentionally not exposed here —
     * use the Supabase dashboard or a dedicated admin RPC).
     */
    remove: function () {
      _cache = null;
      _sessionEpoch++; // invalidate any queued push from the ending session
      if (_uploadTimer) { clearTimeout(_uploadTimer); _uploadTimer = null; }
      try { _localStorageProvider.remove(); } catch (e) {}
    },

    get storageKey() { return _localStorageProvider.key; },

    diagnostics: function () {
      return Object.assign({}, _meta);
    },

    /**
     * rpc(name, params) → Promise<{data, error}>
     * Thin pass-through to supabase.rpc(), for the trust-sensitive write
     * paths that must NOT go through the bulk write() upsert — loot claims
     * and achievement claims. See migration-strategy.md "Write paths that
     * MUST use RPCs" for the exact call-site edits in loot-service.js and
     * ach_engine.js (the only two files that need to change beyond this one
     * and state-manager.js).
     */
    rpc: async function (name, params) {
      const client = _getClient();
      if (!client) return { data: null, error: new Error('Supabase client not available (offline).') };
      return client.rpc(name, params);
    },

    /**
     * uploadPublicFile(bucket, path, blob, contentType) → Promise<{data, error}>
     * (Pending Fixes Report §2b — Boss Studio artwork storage)
     *
     * Narrow, documented crack in the "DBService is the only thing that
     * touches the Supabase client" rule — same posture as rpc() and
     * getAuthClient() above, just for Storage instead of Postgres/Auth.
     * Callers (bs_storage.js) never touch `.storage` directly; they only
     * ever call this method, so the client stays fully encapsulated here.
     *
     * Uploads with upsert:true (re-uploading the same ref is a no-op/replace,
     * never a duplicate-key error), then resolves the public URL. Returns
     * { data: { path, publicUrl }, error: null } on success, or
     * { data: null, error } — callers treat a failure as best-effort and
     * fall back to whatever local-only behavior existed before this file
     * existed (see bs_storage.js's _bsUploadArtworkToStorage()).
     */
    uploadPublicFile: async function (bucket, path, blob, contentType) {
      const client = _getClient();
      if (!client) return { data: null, error: new Error('Supabase client not available (offline).') };
      try {
        const { data, error } = await client.storage.from(bucket).upload(path, blob, {
          contentType: contentType || (blob && blob.type) || 'application/octet-stream',
          upsert: true,
        });
        if (error) return { data: null, error };
        const { data: pub } = client.storage.from(bucket).getPublicUrl(data.path);
        return { data: { path: data.path, publicUrl: pub.publicUrl }, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },

    /**
     * getAuthClient() → SupabaseClient | null
     * AUTH MIGRATION: exposes the underlying Supabase client SOLELY for
     * calling its `.auth` namespace (signInWithPassword, signOut, getSession,
     * onAuthStateChange, etc.) from auth.js and — as of chunk A4, see
     * recovery.js — from the password-recovery listener/screen, which is
     * the same category of session-flow code as auth.js, just split into
     * its own file. This is the one intentional crack in the "DBService is
     * the only thing that touches the Supabase client" rule — auth state
     * doesn't belong to the cache/sync model (read/write/rpc) this file
     * otherwise owns, so it gets its own narrow accessor instead of being
     * bolted onto rpc(). Callers must still never call .from(...) directly
     * on this client — that stays exclusively DBService's job. Anything
     * that is NOT a login/session/recovery flow (e.g. an admin triggering a
     * reset email for someone else, see sendPasswordResetEmail() below)
     * goes through a dedicated DBService method instead of this accessor.
     */
    getAuthClient: function () {
      return _getClient();
    },

    /**
     * sendPasswordResetEmail(email, redirectTo) → Promise<{ok, error?}>
     * (Chunk A4 — Teacher Directory "Send Reset Email" action.)
     * Narrow, documented crack in the "DBService is the only thing that
     * touches the Supabase client" rule, same posture as uploadPublicFile()
     * above — this is the one non-session-flow caller allowed to reach
     * .auth, because unlike getAuthClient()'s callers (auth.js, recovery.js)
     * this isn't managing the CALLER's own session; it's an admin asking
     * Supabase to email a DIFFERENT account a recovery link. Kept out of
     * TeacherDirectoryService's direct reach of the raw client for that
     * reason. No RPC involved — resetPasswordForEmail() is a Supabase Auth
     * (GoTrue) call, not a Postgres one, so this can't be rpc().
     */
    sendPasswordResetEmail: async function (email, redirectTo) {
      const client = _getClient();
      if (!client) return { ok: false, error: 'Supabase client not available (offline).' };
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
      if (error) return { ok: false, error: error.message || 'Could not send the reset email.' };
      return { ok: true };
    },

    /**
     * onSignal(eventName, fn) → void
     * Subscribe to a realtime broadcast signal (replaces the old
     * DB.pendingSkill / DB.pendingBossSummon polling fields).
     */
    onSignal: function (eventName, fn) {
      if (!_signalSubscribers[eventName]) _signalSubscribers[eventName] = [];
      _signalSubscribers[eventName].push(fn);
    },

    /**
     * sendSignal(eventName, payload) → void
     * Broadcast a one-off signal to all other connected tabs/devices.
     */
    sendSignal: function (eventName, payload) {
      if (_signalChannel) {
        _signalChannel.send({ type: 'broadcast', event: eventName, payload: payload });
      }
    },

    /**
     * loadMoreHistory(cacheKey, pageSize?) → Promise<{added, exhausted}>
     * Priority 2 Fix 2 follow-up — pages a bounded-history table (see
     * _HISTORY_LIMITS) further back than its default window. cacheKey is
     * one of: pointLog, redemptions, recitationLog, attendanceLogs, orders,
     * notifications. Not wired into any screen yet; exposed here so a
     * future "load older…" button is a small UI addition, not a
     * DBService change. Appends into _cache[cacheKey] and re-syncs
     * AppStore, same as a realtime refresh would.
     */
    loadMoreHistory: async function (cacheKey, pageSize) {
      return _loadMoreHistory(cacheKey, pageSize);
    },

    _meta: _meta,
  };
})();
