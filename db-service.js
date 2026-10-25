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
// REQUIRES: supabase-client.js loaded BEFORE this file (which itself
//   requires window.supabase, loaded via CDN script tag — see index.html
//   changes in migration-strategy.md). If that global is absent (offline
//   dev, or the CDN is blocked), this file transparently falls back to the
//   v1 localStorage provider — see supabase-client.js's resolveProvider().
// ─────────────────────────────────────────────────────────────────────────────

const DBService = (function () {
  'use strict';

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

  // [Phase 5B bugfix] Companion key for AppStore's delta-sync dirty-id
  // tracking (modules/core/state-manager.js's _DELTA_TRACKED_SLICES). Found
  // during a post-implementation review: _dirty lived ONLY in a module-level
  // JS variable, never persisted anywhere, while _state itself IS persisted
  // to localStorage on every commit (see write() below). On a normal tab
  // close, crash, or offline session — i.e. any time the debounced Supabase
  // push (_queueUpload(), 400ms) doesn't get to run before the page goes
  // away — the edit survives correctly in the local mirror, but the fact
  // that it was still unsynced did not: a fresh reload's _dirty starts
  // empty, so a delta-tracked table's un-pushed row would never be
  // reconsidered for push again unless that exact row happened to be
  // edited a second time. For append-only tables (point_log, redemptions)
  // that second edit never happens — the row is stuck in this browser's
  // local mirror forever, invisible to Supabase and every other device.
  // This key is what closes that gap — see writeDirty()/readDirty() below.
  //
  // Deliberately NOT stamped/gated by _LAST_SYNCED_UID_KEY the way
  // _STORAGE_KEY is: this key only ever holds small arrays of ROW ID
  // STRINGS (e.g. "pl1", "0:s2"), never the underlying row data itself, so
  // there's no privacy/correctness risk in a shared-device scenario the way
  // there is for _STORAGE_KEY's actual data blob. Worst case if a stale or
  // cross-account id gets restored: it references a row that no longer
  // exists in the freshly-loaded _state (harmless — AppStore's own restore
  // logic already prunes exactly that case) or, at worst, causes one extra
  // idempotent re-push of a row that's already correct server-side. Erring
  // toward "occasionally re-send something already synced" over "silently
  // lose something that was never synced" is the correct failure mode here.
  const _DIRTY_TRACKING_KEY = 'eduquest_dirty_v1';

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

  // ── Supabase client — owned by supabase-client.js (Phase 6 extraction) ───
  // The connection singleton and provider resolution used to live here
  // (constructing window.supabase.createClient(), etc.) — moved out to their
  // own file so this file no longer owns raw connection setup, only what it
  // does with a client once it has one (cache/sync/realtime). Kept as thin
  // wrappers, not a mechanical find-replace of every call site below, so
  // every one of this file's ~14 internal `_getClient()` call sites (and the
  // public API methods built on them) needed zero changes beyond this.
  function _getClient() { return SupabaseClient.getClient(); }
  function _resolveProvider() { return SupabaseClient.resolveProvider(); }

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


  // ── Cache <-> relational mapping (pull side) — owned by
  // repository/pull-mappers.js (Phase 6) ────────────────────────────────────
  // _legacyRoleFromDbRole/_HISTORY_LIMITS/all 30 _deriveX() per-table
  // mappers used to live here (~450 lines) — moved to their own file since
  // none of them touch this file's other internals (see that file's
  // header). _pullCacheFromSupabase() below still calls every one of them
  // by name, unchanged — it stayed here instead of moving too, because
  // unlike the mappers it reads `_cache` directly for a couple of
  // locally-cache-only fallback fields, making it genuinely coupled to this
  // file's state in a way the pure mappers are not.

  async function _pullCacheFromSupabase(client) {
    const [profiles, bossEvents, bossParticipants, lootClaims, achievements, userAchievements,
           registrations, pointLog, redemptions, recitationLog,
           rfidCards, attendanceSchedules, attendanceLogs, shopProducts, mailMessages, quizSections,
           achievementSections, titles, titleUnlocks, quizzes, titleSections, campaignWorlds,
           orders, inventoryRows, campaignStageSections, quizHistoryRows, notifications, studentSkillRows,
           recitationSessions] =
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
        client.from('recitation_sessions').select('*'), // Phase 71 — cross-device "Start Recitation Session" sync; see phase71_recitation_session_sync.sql
      ]);

    for (const r of [profiles, bossEvents, bossParticipants, lootClaims, achievements, userAchievements,
                      registrations, pointLog, redemptions, recitationLog,
                      rfidCards, attendanceSchedules, attendanceLogs, shopProducts, mailMessages, quizSections,
                      achievementSections, titles, titleUnlocks, quizzes, titleSections, campaignWorlds,
                      orders, inventoryRows, campaignStageSections, quizHistoryRows, notifications, studentSkillRows,
                      recitationSessions]) {
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
      // Phase 71 — cross-device "Start Recitation Session" sync. Read-only
      // passthrough; writes go exclusively through start_recitation_session()/
      // stop_recitation_session() (recitation-service.js).
      recitationSessions: _deriveRecitationSessions(recitationSessions.data),
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

  // ── Scoped realtime refresh groups — owned by repository/realtime-groups.js
  // (Phase 6) ────────────────────────────────────────────────────────────────
  // _REALTIME_TABLE_GROUPS + _REFRESH_GROUPS used to live here (~210 lines) —
  // moved to their own file since neither touches this file's other
  // internals (see that file's header for an important caveat: unlike most
  // of this phase's other extractions, this one has no direct unit-test
  // coverage). _applyScopedRefresh() below still reads both by name,
  // unchanged.


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

  // ── Repository layer — owned by repository/table-sync.js (Phase 6) ───────
  // _TABLE_SYNC_CONFIGS + the generic push engine (_pushTable/_runTableSync)
  // used to live here (~950 lines) — moved to their own file so this file no
  // longer owns per-table sync-payload logic, only what wraps it (the
  // debounced upload queue below, calling this on a timer). Kept as a
  // one-line delegate, not touched at either of its two call sites
  // (_flushUpload() above, and the `_test` seam at the bottom of this file)
  // — those needed zero changes beyond this.
  function _pushCacheToSupabase(client, cache) {
    return TableSyncRepository.pushCacheToSupabase(client, cache);
  }

  // ── Realtime signal channel ───────────────────────────────────────────────
  // [BLOCKER-SIGNAL] fix: pendingSkill / pendingBossSummon used to be fields
  // written into the DB blob so other tabs would pick them up on their next
  // loadDB() poll. That is replaced here with a proper broadcast channel.
  // Modules that used to read DB.pendingBossSummon should instead call
  // DBService.onSignal('boss-summon', cb) — see migration-strategy.md for
  // the two call sites (summon-notify.js) that need this one-line swap.
  let _signalChannel = null;
  // BUGFIX (orders/inventory/quiz_history RLS errors on logout): this used
  // to be entirely un-tracked — client.channel('eduquest-table-sync') was
  // built and .subscribe()'d inline below with its return value discarded,
  // so there was no reference anywhere to ever unsubscribe it. It stayed
  // live for the whole tab lifetime, including through and after logout.
  // See teardownRealtime() below for why that matters.
  let _tableSyncChannel = null;
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
    _tableSyncChannel = client
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
      // Phase 71 — cross-device "Start Recitation Session" sync. This is the
      // whole point of the feature: a start/stop on one device now reaches
      // every other device's Live Monitor via the same pull-refresh path
      // everything else here already uses, instead of staying stuck in that
      // one tab's local _lmSessionStartAt variable.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recitation_sessions' }, () => _schedulePullRefresh('recitation_sessions'))
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
     * mirrorLocalOnly(db) → void
     * BUGFIX (inventory/quiz_history 42501 storm once realtime actually
     * delivers events): write(db) always queues a push back to Supabase.
     * That's correct for a genuine LOCAL mutation, but state-manager.js's
     * syncFromLegacy() also calls into the write path for data that just
     * arrived FROM Supabase (state:remote-sync / state:auth-change-sync —
     * see db-service.js's own syncFromLegacy call sites). Pushing that
     * straight back is a pure echo: it re-upserts every table in the full
     * cache, including inventory/quiz_history rows for every student in
     * the system, not just this session's own section (those two tables
     * never got the per-class_id filtering the profiles upsert above has).
     * Most of that gets rejected by RLS (42501), and any row that DOES
     * belong to this session fires its own postgres_changes event,
     * re-triggering the same pull -> sync -> push cycle indefinitely.
     * This existed as long as the write path did, but stayed silent until
     * realtime was actually delivering events (it wasn't, until the
     * supabase_realtime publication got repaired). Use this instead of
     * write() for any sync whose data source IS Supabase — update the
     * local cache/mirror so the UI stays current, but never re-push
     * something that already reflects the server.
     */
    mirrorLocalOnly: function (db) {
      _meta.saveCount++;
      _meta.lastSaveAt = new Date().toISOString();
      _cache = db;
      try {
        _localStorageProvider.write(JSON.stringify(db));
      } catch (e) {
        console.warn('[DBService] localStorage mirror write failed (quota?):', e);
      }
      // Deliberately no _queueUpload() call — see header comment above.
    },

    /**
     * writeDirty(dirtySnapshot) → void
     * [Phase 5B bugfix] Persists AppStore's delta-sync dirty-id tracking —
     * see _DIRTY_TRACKING_KEY's own comment for the bug this closes.
     * `dirtySnapshot` is a plain `{ [table]: string[] }` object (AppStore
     * serializes its internal Sets before calling this). Synchronous,
     * localStorage-only — this is small bookkeeping metadata, not app
     * data, so it deliberately never touches _cache or queues a Supabase
     * push of its own.
     */
    writeDirty: function (dirtySnapshot) {
      try {
        localStorage.setItem(_DIRTY_TRACKING_KEY, JSON.stringify(dirtySnapshot));
      } catch (e) {
        console.warn('[DBService] dirty-tracking localStorage write failed (quota?):', e);
      }
    },

    /**
     * readDirty() → { [table]: string[] } | null
     * [Phase 5B bugfix] Companion to writeDirty() — called once during
     * AppStore.init() to restore dirty-id tracking across a reload. Returns
     * null (not throw) on anything unexpected — a missing/corrupt entry
     * here should degrade to "nothing was pending," never crash boot.
     */
    readDirty: function () {
      try {
        const raw = localStorage.getItem(_DIRTY_TRACKING_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('[DBService] dirty-tracking localStorage read failed (corrupt entry?):', e);
        return null;
      }
    },

    /**
     * teardownRealtime() → void
     * BUGFIX (orders/inventory/quiz_history 42501 on logout, surviving even
     * flushPendingUpload()): _setupRealtimeSignals() opens two channels —
     * 'eduquest-signals' (_signalChannel) and 'eduquest-table-sync'
     * (_tableSyncChannel) — that live for the whole tab session and were
     * NEVER unsubscribed anywhere, including on logout. A postgres_changes
     * event on any watched table (orders/inventory/quiz_history included)
     * calls _schedulePullRefresh(), which — once its 400ms debounce fires —
     * calls syncFromLegacy(), which ends in _persist() -> DBService.write()
     * -> _queueUpload(), queuing a NEW push. If that happens after
     * doLogout()'s one-time flushPendingUpload() already ran, the new push
     * is invisible to it and fires later, post-signOut(), 42501-ing exactly
     * like the original race. Call this — BEFORE flushing/signing out — so
     * nothing can re-dirty state through this path during that window.
     * Safe to call even if no channel was ever set up (e.g. offline mode).
     */
    teardownRealtime: function () {
      const client = _getClient();
      if (client) {
        try { if (_signalChannel) client.removeChannel(_signalChannel); } catch (e) { console.warn('[DBService] teardownRealtime: removeChannel(_signalChannel) failed:', e); }
        try { if (_tableSyncChannel) client.removeChannel(_tableSyncChannel); } catch (e) { console.warn('[DBService] teardownRealtime: removeChannel(_tableSyncChannel) failed:', e); }
      }
      _signalChannel = null;
      _tableSyncChannel = null;
      _meta.signalChannelReady = false;
      if (_pullRefreshTimer) { clearTimeout(_pullRefreshTimer); _pullRefreshTimer = null; }
      _pendingRefreshTables = new Set();
    },

    /**
     * flushPendingUpload() → Promise<void>
     * BUGFIX (42501 RLS errors on logout, e.g. orders/quizzes/campaign_worlds/
     * inventory/point_log/quiz_history/redemptions): _queueUpload()'s 400ms
     * debounce means a state change made in the moments right before logout
     * can still be sitting in the timer queue when doLogout() calls
     * client.auth.signOut(). The timer keeps running during that await; if
     * it fires (or a push is already mid-flight) around the same moment the
     * session gets revoked, the upsert calls land with no valid auth.uid()
     * and every ownership-scoped RLS policy correctly rejects them.
     *
     * Call this — and await it — BEFORE signOut(), so any pending push
     * either completes (or fails loudly) while the session is still valid,
     * instead of racing teardown. No-op if nothing is queued.
     */
    flushPendingUpload: async function () {
      if (_uploadTimer) {
        clearTimeout(_uploadTimer);
        _uploadTimer = null;
        await _flushUpload(_sessionEpoch);
      }
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

    // Test-only seam (Phase 5A). Not used by any runtime call site — every
    // real push still goes through _flushUpload()/_getClient() exactly as
    // before. Exists so unit tests can drive _pushCacheToSupabase() and the
    // repository layer directly against a fake Supabase client, to assert
    // the refactor's upsert payloads are byte-identical to the pre-refactor
    // hand-written blocks, and (going forward, Phase 5B) to assert the
    // no-clobber property table-by-table before each is converted to delta
    // sync.
    _test: {
      pushCacheToSupabase: _pushCacheToSupabase,
      tableSyncConfigs: TableSyncRepository.tableSyncConfigs,
    },
  };
})();

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.DBService = DBService;
