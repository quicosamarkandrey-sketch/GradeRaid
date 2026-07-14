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

  async function _pullCacheFromSupabase(client) {
    const [profiles, bossEvents, bossParticipants, lootClaims, achievements, userAchievements,
           registrations, pointLog, redemptions, recitationLog,
           rfidCards, attendanceSchedules, attendanceLogs, shopProducts, mailMessages, quizSections,
           achievementSections, titles, titleUnlocks, quizzes, titleSections, campaignWorlds,
           orders, inventoryRows, campaignStageSections, quizHistoryRows] =
      await Promise.all([
        client.from('profiles').select('*'),
        client.from('boss_events').select('*'),
        client.from('boss_participants').select('*'),
        client.from('loot_claims').select('*'),
        client.from('achievements').select('*'),
        client.from('user_achievements').select('*'),
        client.from('registrations').select('*'),
        client.from('point_log').select('*').order('created_at', { ascending: false }),
        client.from('redemptions').select('*').order('created_at', { ascending: false }),
        client.from('recitation_log').select('*').order('created_at', { ascending: false }),
        client.from('rfid_cards').select('*'),
        client.from('attendance_schedules').select('*'),
        client.from('attendance_logs').select('*').order('log_date', { ascending: false }),
        client.from('shop_products').select('*'), // Phase 14
        client.from('mail_messages').select('*').order('created_at', { ascending: false }), // Phase 15
        client.from('quiz_sections').select('*'), // Phase 15
        client.from('achievement_sections').select('*'), // Phase 16
        client.from('titles').select('*'), // Phase 18
        client.from('title_unlocks').select('*'), // Phase 18
        client.from('quizzes').select('*'), // Phase 20 — quiz content (was local-only; see phase20_quiz_content_sync.sql)
        client.from('title_sections').select('*'), // Phase 21 — read side of title section-scoping
        client.from('campaign_worlds').select('*').order('sort_order', { ascending: true }), // Phase 22 — campaign content (was local-only; see phase22_campaign_content_sync.sql)
        client.from('orders').select('*').order('created_at', { ascending: false }), // Phase 48
        client.from('inventory').select('*'), // Phase 48
        client.from('campaign_stage_sections').select('*'), // Phase 53 — read side of campaign per-section visibility (table existed since Phase 14, never wired up until now)
        client.from('quiz_history').select('*').order('completed_at', { ascending: false }), // Phase 57 — was local-only; see phase57_quiz_history_sync.sql
      ]);

    for (const r of [profiles, bossEvents, bossParticipants, lootClaims, achievements, userAchievements,
                      registrations, pointLog, redemptions, recitationLog,
                      rfidCards, attendanceSchedules, attendanceLogs, shopProducts, mailMessages, quizSections,
                      achievementSections, titles, titleUnlocks, quizzes, titleSections, campaignWorlds,
                      orders, inventoryRows, campaignStageSections, quizHistoryRows]) {
      if (r.error) throw r.error;
    }

    // Phase 63 (bugfix — closes the "quiz reappears / chain resets to step 1"
    // gap): completedQuizzes used to hardcode to [] here on every pull, on
    // the theory that "quiz history stays in its own table" — but nothing
    // ever actually derived it back from that table, so every pull (which
    // fires automatically right after a quiz is finished, since quiz_history
    // is in the realtime subscription list) wiped every student's completion
    // state seconds after they earned it. Built once, up front, from the
    // already-fetched quiz_history rows, same "reshape by student_id" pattern
    // as quizHistoryByStudent/inventoryByStudent below. Aborted attempts
    // (Phase 63's other new column) never count as a completion, matching
    // finishQuiz()'s local-session behavior (only a real finish pushes an id
    // onto completedQuizzes — see index.html).
    const completedQuizzesByStudent = {};
    (quizHistoryRows.data || []).forEach(row => {
      if (row.aborted) return;
      if (!completedQuizzesByStudent[row.student_id]) completedQuizzesByStudent[row.student_id] = new Set();
      completedQuizzesByStudent[row.student_id].add(row.quiz_id);
    });

    const students = (profiles.data || [])
      .filter(p => p.role === 'student')
      .map(p => ({
        id: p.id, pass: p.pass, name: p.display_name, init: p.init, color: p.color,
        xp: p.xp, coins: p.coins, level: p.level, tier: p.tier,
        attendance: Number(p.attendance_pct) || 0, quizAvg: Number(p.quiz_avg) || 0,
        firstName: p.first_name, lastName: p.last_name,
        displayName: p.display_name, profilePic: p.profile_pic_url,
        joinDate: p.join_date, classId: p.class_id || 'default-class',
        completedQuizzes: Array.from(completedQuizzesByStudent[p.id] || []),
      }));

    // Phase 18: equipped title is a scalar column on profiles (see
    // set_equipped_title() RPC), read here alongside the rest of the
    // profile row rather than a separate fetch.
    const equippedTitles = {};
    (profiles.data || []).forEach(p => {
      if (p.role === 'student' && p.equipped_title_id) equippedTitles[p.id] = p.equipped_title_id;
    });

    const adminRow = (profiles.data || []).find(p => p.role === 'admin' || p.role === 'teacher');

    const bossIdById = {};
    const bossEventsArr = (bossEvents.data || [])
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
          lootClaims: (lootClaims.data || [])
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

    const bossParticipantsObj = {};
    (bossParticipants.data || []).forEach(row => {
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

    const achievementUnlocks = {};
    (userAchievements.data || []).forEach(u => {
      if (!achievementUnlocks[u.student_id]) achievementUnlocks[u.student_id] = [];
      achievementUnlocks[u.student_id].push({
        achId: u.achievement_id, unlockedAt: u.unlocked_at,
        xpGranted: u.xp_granted, coinsGranted: u.coins_granted,
        claimed: u.claimed, claimedAt: u.claimed_at,
        classId: u.class_id || 'default-class', // Phase 14: section ownership
      });
    });

    // Phase 18: titles (catalog) + title_unlocks (per-student), same shape
    // as achievements/achievementUnlocks above. equippedTitles is built
    // earlier alongside `students`, from profiles.equipped_title_id.
    // Phase 38: is_starter_template rows are the admin-only starter-pack
    // templates (seeded via seed_new_teacher()) — RLS lets an admin session
    // see them (admin bypasses the owner check), but they must never show up
    // mixed into a regular catalog screen. Filtered here, not in RLS, so the
    // new Starter Pack Editor screen (which fetches them via the dedicated
    // get_starter_pack() RPC instead) is the only place they're visible.
    const titlesArr = (titles.data || []).filter(t => !t.is_starter_template).map(t => ({
      id: t.id, ownerTeacherId: t.owner_teacher_id, // Phase 32: catalog owner scoping
      name: t.name, description: t.description, icon: t.icon,
      rarity: t.rarity, active: t.active !== false, achievementId: t.achievement_id,
      textColor: t.text_color, borderColor: t.border_color, glowColor: t.glow_color,
      bgColor: t.bg_color, primaryColor: t.primary_color, secondaryColor: t.secondary_color,
      gradientFrom: t.gradient_from, gradientTo: t.gradient_to, borderStyle: t.border_style,
      animation: t.animation, particles: t.particles, bgEffect: t.bg_effect,
      customBorderCSS: t.custom_border_css, customAnimationCSS: t.custom_animation_css,
      customBgCSS: t.custom_bg_css, createdAt: t.created_at,
      // Phase 52: Designer v3 fields — see phase52_titles_designer_v3_columns.sql.
      // Fall back to tsDefaultTitle()'s own defaults so a pre-Phase-52 row
      // (column exists now, but this particular title was saved before the
      // backfill/re-save) renders identically to a brand-new draft instead
      // of some other stale fallback.
      frameShape: t.frame_shape || 'classic', frameStyle: t.frame_style || 'none',
      accentColor: t.accent_color, effect: t.effect || 'none',
      frameTemplate: t.frame_template || 'solid',
    }));

    const titleUnlocksObj = {};
    (titleUnlocks.data || []).forEach(u => {
      if (!titleUnlocksObj[u.student_id]) titleUnlocksObj[u.student_id] = [];
      titleUnlocksObj[u.student_id].push(u.title_id);
    });

    // Phase 20: quiz content catalog — same shape/pattern as
    // achievements/titles above. quiz_sections (who can see a quiz) is
    // unchanged and still read separately below into
    // quizSectionAssignments; this is the quiz CONTENT itself.
    // Phase 38: same starter-template filter as titlesArr above.
    const quizzesArr = (quizzes.data || []).filter(q => !q.is_starter_template).map(q => ({
      id: q.id, ownerTeacherId: q.owner_teacher_id, // Phase 32: catalog owner scoping
      title: q.title, desc: q.description,
      xpReward: q.xp_reward, coinReward: q.coin_reward, timeLimit: q.time_limit,
      // Phase 54: rarity/cadence — coalesce here too (not just in the SQL
      // backfill) so a row pulled from a REST cache or replica that
      // predates the migration's backfill still lands on the same
      // defaults eqQuizRarity()/eqQuizCadence() already use.
      rarity: q.rarity || 'Common', cadence: q.cadence || 'standing',
      // Phase 56: quest chains — chainId stays null (unchained) unless a
      // row actually has one; chainOrder coalesces to 1, same fallback
      // eqQuizChain() already uses in utils.js for a row from before this
      // migration's backfill.
      chainId: q.chain_id || null, chainOrder: q.chain_order || 1, chainLabel: q.chain_label || '',
      // Phase 58: scheduling — startDate/endDate stay null (no schedule =
      // always available) unless a row actually has one, same fallback
      // eqQuizScheduleStatus() already treats a pre-Phase-5 row as.
      startDate: q.start_date || null, endDate: q.end_date || null,
      // Phase 3 (Improvement Plan §2) — per-stage per-question timer
      // overrides. A row from before this migration (column NULL) or a
      // row whose json isn't a proper 3-slot array both coalesce to
      // [null,null,null] — "use shipped defaults everywhere" — same
      // fallback eqQuizStageSeconds() already applies in utils.js.
      stageTimers: Array.isArray(q.stage_timers) ? q.stage_timers : [null, null, null],
      questions: q.questions || [], active: q.active !== false,
      createdAt: q.created_at,
    }));

    // Phase 22: campaign content catalog. One row per world; stages
    // (with their nested scenes/enemies/questions/outro) ride along as a
    // single jsonb column — see phase22_campaign_content_sync.sql for why
    // this isn't split into a relational stage table. Already
    // sort_order-ordered by the query above.
    // Phase 38: same starter-template filter as titlesArr/quizzesArr above.
    const campaignWorldsArr = (campaignWorlds.data || []).filter(w => !w.is_starter_template).map(w => ({
      id: w.id, ownerTeacherId: w.owner_teacher_id, // Phase 32: catalog owner scoping
      label: w.label, icon: w.icon, color: w.color, desc: w.description,
      stages: w.stages || [],
    }));

    // Phase 53: campaign_stage_sections exists since Phase 14 (see
    // phase14_section_isolation.sql) but was never read from here — every
    // campaign world rendered visible to every section of its owning
    // teacher, with no way to scope a world (or one topic's worth of
    // stages) to just one section. set_campaign_world_sections() (Phase 53)
    // writes one row per (stage, class) pair for every stage in a world, so
    // reading it back is a two-step fold: build a stageId -> worldId
    // lookup from the catalog we just mapped above, then group the raw
    // rows by worldId into the same {catalogId: [classId, ...]} shape
    // quizSectionAssignments/achievementSectionAssignments already use —
    // renderWorldTabs()/renderStageMap() (campaign_stage_map.js) and
    // getMapProgress()/getStageProgress() (campaign_engine.js) key off this
    // by worldId, not by individual stage.
    const worldIdByStageId = {};
    campaignWorldsArr.forEach(w => (w.stages || []).forEach(s => { worldIdByStageId[s.id] = w.id; }));
    const campaignSectionAssignments = {};
    (campaignStageSections.data || []).forEach(row => {
      const worldId = worldIdByStageId[row.stage_id];
      if (!worldId) return; // stale row for a since-deleted stage — ignore
      if (!campaignSectionAssignments[worldId]) campaignSectionAssignments[worldId] = [];
      if (!campaignSectionAssignments[worldId].includes(row.class_id)) campaignSectionAssignments[worldId].push(row.class_id);
    });

    // Phase 15: mail_messages is one row per single recipient (see
    // phase14_section_isolation.sql's comment on why); the local app's mail
    // object is one compose action shared across many recipients with
    // per-recipient read/claimed tracking. Reconstruct that shape here by
    // grouping rows back up by batch_id (stamped by the send_mail() RPC —
    // see phase15_mail_and_quiz_sections_sync.sql), so every other module
    // (mail-engine.js, admin-compose.js, student-inbox.js) keeps working
    // against the exact same {id, to:[], readBy:{}, claimedBy:{}, rewards:[]}
    // shape it already expects, with zero call-site changes needed there.
    const mailByBatch = {};
    (mailMessages.data || []).forEach(row => {
      const batchId = row.batch_id || row.id; // defensive: a row with no
      // batch_id can't happen via send_mail(), but don't drop it silently
      // if one ever shows up (e.g. a manual DB edit) — treat it as its own
      // single-recipient batch instead.
      if (!mailByBatch[batchId]) {
        const senderProfile = (profiles.data || []).find(p => p.id === row.sender_teacher_id);
        const rewards = [];
        if (row.xp_reward)   rewards.push({ type: 'xp', amount: row.xp_reward, icon: '⚡', label: 'XP', color: 'var(--primary)' });
        if (row.coin_reward) rewards.push({ type: 'coins', amount: row.coin_reward, icon: '🪙', label: 'Coins', color: 'var(--tertiary)' });
        if (row.title_reward_id) {
          // Phase 18: titles is now synced — look it up against the real
          // pulled data instead of the old "whatever's in this tab's local
          // cache" workaround.
          const t = titlesArr.find(x => x.id === row.title_reward_id);
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
          // Phase 15 fix: mark_mail_read()/mark_mail_claimed() are scoped to
          // ONE mail_messages row (`where id = p_mail_id and
          // recipient_student_id = auth.uid()`), but that row's real primary
          // key is per-recipient, NOT the batch_id this reconstructed object
          // uses as its own `id`. Without this map, mailMarkRead/
          // mailClaimRewards (mail-engine.js) had no way to know the actual
          // row id and were silently sending the batch_id as p_mail_id —
          // matching zero rows server-side, so read/claimed state never
          // actually persisted past a refresh even though the RPC call
          // "succeeded" (0 rows updated is not an error). Keyed by
          // recipient_student_id so mail-engine.js can look up the right row
          // id for the current student.
          rowIdBySid: {},
        };
      }
      mailByBatch[batchId].to.push(row.recipient_student_id);
      mailByBatch[batchId].readBy[row.recipient_student_id] = !!row.read;
      mailByBatch[batchId].claimedBy[row.recipient_student_id] = !!row.claimed;
      mailByBatch[batchId].rowIdBySid[row.recipient_student_id] = row.id;
    });

    // Phase 15: quiz_sections is read-only from this bulk-pull path — writes
    // go exclusively through set_quiz_sections() (see quiz-builder.js and
    // phase15_mail_and_quiz_sections_sync.sql) so a stale tab's cached
    // assignment list can never bulk-clobber another teacher's. Exposed here
    // as a simple {quizId: [classId, ...]} map for the section-picker UI to
    // read back what's currently assigned.
    const quizSectionAssignments = {};
    (quizSections.data || []).forEach(row => {
      if (!quizSectionAssignments[row.quiz_id]) quizSectionAssignments[row.quiz_id] = [];
      quizSectionAssignments[row.quiz_id].push(row.class_id);
    });

    // Phase 16: same shape as quizSectionAssignments above, but for
    // achievement_sections — read-only from this bulk-pull path, writes go
    // exclusively through set_achievement_sections() (see
    // ach_admin_page.js and phase16_achievement_sections_rpc.sql) so a
    // stale tab's cached assignment list can never bulk-clobber another
    // teacher's. Exposed as a simple {achievementId: [classId, ...]} map
    // for the section-picker UI to read back what's currently assigned.
    const achievementSectionAssignments = {};
    (achievementSections.data || []).forEach(row => {
      if (!achievementSectionAssignments[row.achievement_id]) achievementSectionAssignments[row.achievement_id] = [];
      achievementSectionAssignments[row.achievement_id].push(row.class_id);
    });

    // Phase 21: same shape as achievementSectionAssignments above, but for
    // title_sections — read-only from this bulk-pull path, writes go
    // exclusively through set_title_sections() (see titles_designer.js and
    // phase21_title_sections_rpc.sql). Only meaningful for standalone
    // (non-achievement-linked) titles — a title unlocked through a linked
    // achievement already inherits that achievement's section scoping.
    const titleSectionAssignments = {};
    (titleSections.data || []).forEach(row => {
      if (!titleSectionAssignments[row.title_id]) titleSectionAssignments[row.title_id] = [];
      titleSectionAssignments[row.title_id].push(row.class_id);
    });

    // Phase 48: inventory is per-student, one row per (student_id, item_id) —
    // reshape into DB.inventory[studentId] = [...] exactly as cartCheckout()
    // and (after the loot-service.js patch shipped alongside this)
    // LootService.claimReward() already expect it.
    const inventoryByStudent = {};
    (inventoryRows.data || []).forEach(row => {
      if (!inventoryByStudent[row.student_id]) inventoryByStudent[row.student_id] = [];
      inventoryByStudent[row.student_id].push({
        itemId: row.item_id, itemName: row.item_name, emoji: row.emoji, category: row.category,
        quantity: row.quantity, datePurchased: row.date_purchased, lastPurchased: row.last_purchased,
        source: row.source, status: row.status, usedAt: row.used_at,
      });
    });

    // Phase 57: quiz_history is per-student, one row per attempt — reshape
    // into DB.quizHistory[studentId] = [...] exactly as computeQuestStreak()/
    // getStudentQuestRecords() (utils.js) and finishQuiz() (index.html)
    // already expect, same reasoning as inventoryByStudent above.
    const quizHistoryByStudent = {};
    (quizHistoryRows.data || []).forEach(row => {
      if (!quizHistoryByStudent[row.student_id]) quizHistoryByStudent[row.student_id] = [];
      quizHistoryByStudent[row.student_id].push({
        id: row.id, quizId: row.quiz_id, score: row.score, attempt: row.attempt,
        completedAt: row.completed_at, date: row.date_label,
        // Phase 59 — per-question fractions (quest_board_report.md §19).
        // Rows logged before this phase have no column value (NULL), which
        // reads back as undefined here — eqComputeQuizAnalytics() (utils.js)
        // already treats a missing `results` as "this attempt doesn't
        // contribute to per-question stats" rather than throwing.
        results: Array.isArray(row.question_results) ? row.question_results : undefined,
        // Phase 63 — an aborted attempt (abortQuiz(), index.html) must stay
        // distinguishable after a round-trip through Supabase: it counts
        // toward the attempt cap but never toward completedQuizzes, the
        // "cleared" quest-board state, or the new perfect-score lock (see
        // completedQuizzesByStudent above and eqQuizAttemptStatus() in
        // utils.js). Rows from before this phase have no column value and
        // default to false server-side, which is correct (they were all
        // real finishQuiz() completions).
        aborted: !!row.aborted,
      });
    });

    return {
      schemaVersion: _SCHEMA_VER,
      students,
      // Fall back to the locally-cached admin record (or DEFAULT_DB.admin) when
      // no admin/teacher profile row exists in Supabase yet (e.g. fresh deployment,
      // RLS preventing the anon key from reading that row, or Phase-2 auth not yet
      // set up). Without this, DB.admin is null and doLogin() throws on DB.admin.id.
      admin: adminRow ? {
        id: adminRow.id, name: adminRow.display_name, role: 'Teacher',
        pass: _cache?.admin?.pass ?? (typeof DEFAULT_DB !== 'undefined' ? DEFAULT_DB.admin?.pass : 'admin123'),
      } : (_cache?.admin ?? (typeof DEFAULT_DB !== 'undefined' ? DEFAULT_DB.admin : null)),
      bossEvents: bossEventsArr,
      bossParticipants: bossParticipantsObj,
      // Phase 38: same starter-template filter as titlesArr/quizzesArr/
      // campaignWorldsArr above.
      achievements: (achievements.data || []).filter(a => !a.is_starter_template).map(a => ({
        id: a.id, ownerTeacherId: a.owner_teacher_id, // Phase 32: catalog owner scoping
        name: a.name, description: a.description, icon: a.icon,
        category: a.category, rarity: a.rarity, xpReward: a.xp_reward,
        coinReward: a.coin_reward, triggerType: a.trigger_type,
        triggerValue: a.trigger_value, active: a.active,
      })),
      achievementUnlocks,
      titles: titlesArr, titleUnlocks: titleUnlocksObj, equippedTitles, // Phase 18
      titleSectionAssignments, // Phase 21
      // Phase 14: shop is per-teacher — RLS on shop_products already scopes
      // this to (a) products this session's own teacher owns, or (b)
      // products owned by the adviser of this session's own section, so no
      // extra client-side filter is needed here, same as every other table.
      // Phase 38: same starter-template filter as the other four catalog
      // tables above (achievements/titles/quizzes/campaignWorlds).
      store: (shopProducts.data || []).filter(p => !p.is_starter_template).map(p => ({
        id: p.id, ownerTeacherId: p.owner_teacher_id,
        name: p.name, emoji: p.emoji, desc: p.description, cat: p.category,
        cost: p.cost, stock: p.stock, active: p.active,
        addedAt: p.created_at,
      })),
      // Phase 15 — see the mailByBatch/quizSectionAssignments comments above.
      mail: Object.values(mailByBatch),
      quizSectionAssignments,
      achievementSectionAssignments, // Phase 16
      registrations: (registrations.data || [])
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
        .map(r => ({
          id: r.id, firstName: r.first_name, lastName: r.last_name,
          username: r.username, email: r.email, studentId: r.student_id_text,
          gradeLevel: r.grade_level, section: r.section, classId: r.class_id, // Phase 33
          status: r.status, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
          reviewedBy: r.reviewed_by, rejectionReason: r.rejection_reason,
          approvedStudentId: r.approved_student_id,
        })),
      pointLog: (pointLog.data || []).map(p => ({
        id: p.id, studentId: p.student_id, what: p.what, pts: p.pts, when: p.when_label,
      })),
      redemptions: (redemptions.data || []).map(r => ({
        orderId: r.order_id, studentId: r.student_id, itemId: r.item_id,
        itemName: r.item_name, emoji: r.emoji, item: r.item_label, pts: r.pts,
        date: r.date_label, time: r.time_label, claimCode: r.claim_code,
      })),
      // Phase 48 — mirrors DB.orders[] exactly. See cartCheckout() (creates),
      // shop_pos_terminal.js (staff claim/cancel), shop_orders.js (student
      // self-cancel) — all pre-existing client logic, previously local-only.
      orders: (orders.data || []).map(o => ({
        orderId: o.order_id, claimCode: o.claim_code,
        studentId: o.student_id, studentName: o.student_name,
        studentInit: o.student_init, studentColor: o.student_color,
        itemId: o.item_id, itemName: o.item_name, emoji: o.emoji,
        cost: o.cost, category: o.category,
        status: o.status,
        createdAt: o.created_at, createdDateStr: o.created_date_str,
        // claimedAt/cancelledAt are epoch-ms numbers in the local shape
        // (posExecuteClaim/posExecuteCancel/ordExecuteCancel all use
        // Date.now()), so convert the stored timestamptz back to that shape
        // on the way in, same convention as bossEvents.defeatedAt/endedAt above.
        claimedAt: o.claimed_at ? Date.parse(o.claimed_at) : null, claimedBy: o.claimed_by,
        cancelledAt: o.cancelled_at ? Date.parse(o.cancelled_at) : null,
        cancelReason: o.cancel_reason, cancelledBy: o.cancelled_by,
      })),
      // Phase 48 — mirrors DB.inventory{} exactly. See the inventoryByStudent
      // reshape above.
      inventory: inventoryByStudent,
      // Phase 57 — mirrors DB.quizHistory{} exactly. See the
      // quizHistoryByStudent reshape above.
      quizHistory: quizHistoryByStudent,
      recitationLog: (recitationLog.data || []).map(r => ({
        id: r.id, studentId: r.student_id, pts: r.pts, note: r.note, when: r.when_label,
        // Phase 3 additions — additive only, every pre-Phase-3 row simply has
        // classId: null. See phase3_recitation_command_center.sql for why
        // this reuses the existing table instead of a new one.
        classId: r.class_id || null, createdAt: r.created_at || null,
      })),
      // ── Phase 1 RFID/Attendance — READ-ONLY slices ──────────────────────
      // Every write to these three comes from AttendanceService via
      // DBService.rpc(), never from this bulk-pull/push path — see
      // attendance-service.js and the RPC functions in
      // supabase/phase1_rfid_attendance.sql. Pulling them here just keeps
      // AppStore's slices fresh for read paths (dashboards, analytics).
      rfidCards: (rfidCards.data || []).map(c => ({
        id: c.id, tagId: c.tag_id, studentId: c.student_id,
        isActive: c.is_active, assignedAt: c.assigned_at, revokedAt: c.revoked_at,
      })),
      attendanceSchedules: (attendanceSchedules.data || []).map(s => ({
        id: s.id, classId: s.class_id, openTime: s.open_time, startTime: s.start_time,
        lateCutoff: s.late_cutoff, closeTime: s.close_time, active: s.active,
      })),
      attendanceLogs: (attendanceLogs.data || []).map(a => ({
        id: a.id, studentId: a.student_id, classId: a.class_id, logDate: a.log_date,
        status: a.status, scannedAt: a.scanned_at, entryMethod: a.entry_method,
        rfidTag: a.rfid_tag, recordedBy: a.recorded_by, notes: a.notes,
      })),
      // Fields not yet migrated to relational tables (Phase 2/3 scope — see
      // migration-strategy.md "What stays on localStorage for now"):
      //
      // BUGFIX (found while wiring Phase 15): `store` used to be listed here
      // too, which — since this is a single object literal — silently won
      // over the real `store: (shopProducts.data || []).map(...)` mapping
      // above (later duplicate keys win in JS). That meant every fresh pull
      // threw away the just-synced shop data and fell back to whatever this
      // tab's in-memory cache happened to have (empty, on first load), i.e.
      // the Phase 14 shop migration's cross-device sync was silently
      // inert. `store` is fully migrated now (see above) — removed from
      // this fallback list, which is exactly what should have happened when
      // it was migrated. `mail` was never listed here (it had no local
      // fallback before Phase 15), so no equivalent bug existed for it.
      //
      // BUGFIX #2 (found during the shop/mail/quiz/achievement/titles
      // audit, right after Phase 18): `titles`, `titleUnlocks`, and
      // `equippedTitles` were ALSO still listed here as
      // `_cache?.titles || []` etc., the exact same duplicate-key mistake
      // as the `store` bug above — silently winning over the real
      // `titles: titlesArr, titleUnlocks: titleUnlocksObj, equippedTitles`
      // mapping added earlier in this same object for Phase 18. Every
      // fresh pull was throwing away the just-synced title data and
      // falling back to local cache, making the entire Phase 18 sync
      // silently inert, identically to how the shop bug played out.
      // Removed from this fallback list for the same reason `store` was.
      //
      // Phase 20: `quizzes` was the last remaining member of this fallback
      // list that actually had real backing data to sync (see
      // SYNC_AUDIT_REPORT.md, "Quiz — bigger gap than 'done' implies").
      // Unlike the `store`/`titles` cases above, this wasn't a duplicate-key
      // bug — there was simply no `quizzes` table and no push block at all,
      // so quiz content never left the device that authored it. Now synced
      // via quizzesArr above; see phase20_quiz_content_sync.sql.
      quizzes: quizzesArr,
      attendanceSessions: _cache?.attendanceSessions || [],
      // Phase 22: `stageMap` was the other remaining fallback list member
      // with real backing data to sync (see SYNC_AUDIT_REPORT.md,
      // "Campaign — confirmed fully local"). Same as `quizzes` above,
      // this wasn't a duplicate-key bug — there was simply no
      // `campaign_worlds` table and no push block at all, so campaign
      // content never left the device that authored it. Now synced via
      // campaignWorldsArr above; see phase22_campaign_content_sync.sql.
      // stageProgress (per-student progress) stays local-cache-only —
      // out of scope for now. quiz history is NO LONGER in this bucket —
      // see quizHistory: quizHistoryByStudent above (Phase 57).
      stageMap: campaignWorldsArr, stageProgress: _cache?.stageProgress || {},
      campaignSectionAssignments, // Phase 53
      _bossIdById: bossIdById, // internal map, see _pushCacheToSupabase
    };
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boss_events' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loot_claims' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_achievements' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_logs' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfid_cards' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recitation_log' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages' }, () => _schedulePullRefresh()) // Phase 15
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_sections' }, () => _schedulePullRefresh()) // Phase 15
      .on('postgres_changes', { event: '*', schema: 'public', table: 'achievement_sections' }, () => _schedulePullRefresh()) // Phase 16
      // Phase 19: achievements/titles catalogs and title_unlocks were pulled
      // and pushed correctly since Phase 17/18, but never added to this
      // subscription list — a badge or title created on one device only
      // reached another device on that device's next full reload, not
      // live. user_achievements was already here; title_unlocks gets the
      // same treatment for parity (equipped_title_id rides on `profiles`,
      // already covered by the profiles subscription above).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'achievements' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'titles' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'title_unlocks' }, () => _schedulePullRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quizzes' }, () => _schedulePullRefresh()) // Phase 20
      .on('postgres_changes', { event: '*', schema: 'public', table: 'title_sections' }, () => _schedulePullRefresh()) // Phase 21
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_worlds' }, () => _schedulePullRefresh()) // Phase 22
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_stage_sections' }, () => _schedulePullRefresh()) // Phase 53
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => _schedulePullRefresh()) // Phase 48
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => _schedulePullRefresh()) // Phase 48
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_history' }, () => _schedulePullRefresh()) // Phase 57
      .subscribe();
  }

  let _pullRefreshTimer = null;
  function _schedulePullRefresh() {
    // Debounce incoming realtime bursts (e.g. a raid with 30 students
    // hitting at once) into a single re-pull, same 400ms rhythm as uploads.
    if (_pullRefreshTimer) clearTimeout(_pullRefreshTimer);
    _pullRefreshTimer = setTimeout(async () => {
      const client = _getClient();
      if (!client) return;
      try {
        const fresh = await _pullCacheFromSupabase(client);
        _cache = fresh;
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

    _meta: _meta,
  };
})();
