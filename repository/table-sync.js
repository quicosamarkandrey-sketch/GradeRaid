// ─────────────────────────────────────────────────────────────────────────────
// REPOSITORY — declarative table-sync configs + push engine (Phase 5A/5B)
//
// Phase 6 (Decompose God Files) extraction from db-service.js. Owns the
// entire "push local cache to Supabase" side of the data layer:
// _TABLE_SYNC_CONFIGS (one declarative entry per synced table — guard,
// optional staff gate, row-building, delta/patch-sync opt-in) and the
// generic engine that walks it (_pushTable/_runTableSync/_pushCacheToSupabase).
// This was the single largest chunk of the original 2,725-line db-service.js
// (~950 of its lines) and, per the Phase 5A/5B refactor history documented
// inline below, is also its most heavily unit-tested — every table's
// no-clobber/delta-sync test in tests/unit/*.test.js drives this file's code
// through DBService's `_test.pushCacheToSupabase` seam, which now delegates
// here. No behavior change — every line of logic below is moved verbatim
// from db-service.js; only the two names it's reached through from outside
// this module (pushCacheToSupabase, tableSyncConfigs) are new.
//
// WHY THIS WAS SAFE TO EXTRACT (checked before moving anything, not assumed):
// grepped this entire block for every reference to db-service.js's OTHER
// internals — _cache, _derive*() (the pull-side mapping functions), _meta,
// _localStorageProvider, _getClient() — and found none. The only things this
// code touches are its own parameters (client, cache) and two globals every
// other module already depends on directly: `currentUser` (session-role
// gating) and `AppStore` (delta-sync dirty-id tracking). That made this a
// clean seam; the pull side (_derive* + _pullCacheFromSupabase, ~450 lines)
// and the realtime layer (~350 lines, not unit-tested) were deliberately
// NOT attempted this session — see the Refactoring Report entry for why.
//
// DEPENDENCIES: currentUser, AppStore (both globals, loaded before this
// file runs, exactly as they were available to db-service.js). Must load
// BEFORE db-service.js (see index.html) — db-service.js's own
// _pushCacheToSupabase() is now a one-line delegate to this file's
// pushCacheToSupabase(), called from _flushUpload() exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

const TableSyncRepository = (function () {
  'use strict';

  // ─── Repository layer: declarative table-sync configs (Phase 5A) ─────────
  // BEFORE this phase, _pushCacheToSupabase() below was ~700 lines containing
  // 13 near-identical hand-written blocks: guard → (optional staff-role gate)
  // → filter → map camelCase-to-snake_case → upsert whole table →
  // catch-and-warn. Every one of them was a copy of the nearest existing
  // block with new field names, because there was no abstraction that made
  // adding a synced table *require* the safe pattern rather than merely
  // *allow* a copy-paste of it. This is the root cause flagged in the
  // Phase 5 write-up: the same "whole-roster last-write-wins" risk that
  // corrupted xp/coins/level/tier (fixed via the scoped adjust_student_stats
  // RPC, Phase 9) was still structurally possible in all 12 other tables,
  // simply because nothing stopped a new block from being copy-pasted
  // without the safe columns-owned-elsewhere exclusions the older blocks had
  // painstakingly accumulated.
  //
  // AFTER: one generic engine (_runTableSync, defined below the configs) that
  // walks this array. Adding a table that fits the common shape is now a
  // config entry, not 40-50 new lines. Sub-phase A is STRUCTURAL ONLY — every
  // config entry below reproduces its old block's row-building logic
  // verbatim (same field names, same coalesces, same skip-if-unstamped
  // filters, same phase-provenance comments), so the upsert payloads this
  // produces are byte-identical to what the old hand-written blocks sent.
  // No behavior changes here; delta/patch sync (only pushing dirty rows
  // instead of whole tables) is Phase 5B, done one table at a time — see
  // the `deltaTracked`/`idField` config fields and _runTableSync()'s
  // delta-tracking block below, plus modules/core/state-manager.js's
  // _DELTA_TRACKED_SLICES. `point_log` is the first (and, as of this
  // session, only) table converted; every other table still pushes its
  // whole local slice every cycle exactly as sub-phase A left it.
  //
  // `profiles` (the students table) WAS deliberately excluded from this list
  // through Phase 5A and the earlier Phase 5B sessions — it had its own
  // bespoke per-class-id chunking and session-role branch that predated this
  // repository layer. This session folds it in (see the `profiles` config
  // entry below) — SAME logic, byte-identical payloads/chunking/gating,
  // just moved into the generic engine instead of living as a standalone
  // block in _pushCacheToSupabase. It does NOT yet set `deltaTracked` — see
  // that config entry's own comment for exactly why that's a deliberate,
  // separately-scoped follow-up rather than a shortcut taken here.
  //
  // Config shape:
  //   table          — Postgres table name; also used as the _pushTable()
  //                    isolation label (so one bad table's error/warning
  //                    still only ever blocks that table, same as before).
  //   getSource      — (cache) => the raw cache slice this table reads from.
  //   hasRows        — (source, cache) => boolean. Same guard the old inline
  //                    `if (Array.isArray(cache.x) && cache.x.length)` (or
  //                    object-shaped equivalent) had — decides whether this
  //                    table's block runs at all this cycle.
  //   requiresStaffGate — true for the "catalog" tables (boss_events,
  //                    shop_products, achievements, titles, quizzes,
  //                    campaign_worlds) that used to be gated on
  //                    isCatalogStaffSession so a student session's read-only
  //                    catalog load never triggers a doomed re-push rejected
  //                    by RLS.
  //   buildRows      — (source, cache) => array of row objects to upsert.
  //                    This is where the old filter+map (or nested-object
  //                    flatten) logic lives, verbatim. Omitted when a table
  //                    supplies its own upsertRows instead (see below).
  //   conflictKey    — string passed as { onConflict } on the default
  //                    single-upsert write. Omitted when upsertRows is used.
  //   upsertRows     — OPTIONAL override of "how rows get written," for the
  //                    one table whose write shape genuinely isn't a single
  //                    upsert call: boss_events needs per-row isolation (one
  //                    malformed boss can't take down every other boss this
  //                    cycle) AND a retry-on-23502 path (a stale local _id
  //                    pointing at a boss deleted out-of-band). Every other
  //                    table gets the default single-upsert write.
  //   deltaTracked   — [Phase 5B] OPTIONAL, boolean. When true, the engine
  //                    asks AppStore.getDirtyIds(table) for this cycle's
  //                    dirtied row ids and, if it gets back an array, pushes
  //                    ONLY the rows matching those ids (buildRows still
  //                    runs, just over a pre-filtered source) instead of the
  //                    whole local slice — then clears exactly the ids that
  //                    made it to the server on success. Falls back to a
  //                    full-slice push whenever dirty info isn't available
  //                    (AppStore.getDirtyIds missing, or this table isn't in
  //                    AppStore's own _DELTA_TRACKED_SLICES and so always
  //                    returns []... note that actually SKIPS the push, see
  //                    below — "not tracked" and "tracked but nothing
  //                    dirty" are indistinguishable on purpose, both mean
  //                    "nothing to push"). Requires EITHER `idField` (source
  //                    is a flat array — the common case) OR
  //                    `deltaFilterSource` (source isn't a flat array, e.g.
  //                    boss_participants' nested bossIdx->studentId shape).
  //   idField        — [Phase 5B] REQUIRED when deltaTracked is true AND the
  //                    table's source is a flat array. The property name on
  //                    each RAW source row (before buildRows' camelCase-to-
  //                    snake_case mapping) that identifies it — matches the
  //                    `idField` AppStore's _DELTA_TRACKED_SLICES config
  //                    used to track this same table's dirty ids.
  //   deltaFilterSource — [Phase 5B] OPTIONAL, `(source, dirtySet, cache) =>
  //                    { source, ids }`. Escape hatch for a delta-tracked
  //                    table whose source isn't a flat array (idField alone
  //                    can't express "which rows are dirty" for it) — filter
  //                    to the dirty subset yourself and return BOTH the
  //                    filtered source AND the exact composite ids you
  //                    included, so the engine knows exactly what to
  //                    AppStore.clearDirty() once the push succeeds.
  //                    boss_participants and inventory need this — both are
  //                    'nested'/'nestedArray'-shaped on the AppStore side
  //                    (see modules/core/state-manager.js's
  //                    _DELTA_TRACKED_SLICES), so a single idField can't
  //                    express dirtiness for either.
  //   upsertRows return value — [Phase 5B] OPTIONAL. When a `deltaTracked`
  //                    table uses `upsertRows` (chunked/per-row writes,
  //                    e.g. profiles' per-class_id upsert) instead of the
  //                    default single-batch buildRows+upsert, the engine
  //                    can't safely assume "didn't throw" means "everything
  //                    landed" — a chunked upsertRows may warn-and-continue
  //                    past one failed chunk on purpose. Have `upsertRows`
  //                    return an array of exactly the ids that landed in a
  //                    chunk that DID succeed; the engine clears only
  //                    those. Returning nothing (the original contract,
  //                    still how boss_events' upsertRows behaves) means no
  //                    ids ever get cleared via this path — always SAFE
  //                    (a harmless redundant re-push next cycle at worst),
  //                    just not yet wired up to confirm success.
  const _TABLE_SYNC_CONFIGS = [
    {
      // Profiles (students table) — folded into the generic engine in an
      // earlier session; every line of logic below is preserved VERBATIM
      // from the standalone block this replaced (same staff-session
      // double-check, same per-class-id chunking, same warn-not-throw per
      // chunk, same six-column RPC-ownership exclusion). See db-service.js's
      // own Refactoring Report entry for the full history of WHY each of
      // these exists — xp/coins/level/tier (adjust_student_stats RPC) and
      // attendance_pct/quiz_avg (sync_student_derived_stats RPC) are
      // deliberately never in `rows` below; this upsert only ever touches
      // identity/cosmetic columns.
      //
      // [Phase 5B] Now `deltaTracked` — this table's own log entry
      // originally flagged why it couldn't be, safely, with the engine as
      // it stood then: this upsert is chunked per class_id, and an
      // out-of-scope or RLS-rejected chunk WARNS AND CONTINUES rather than
      // throwing, specifically so one bad chunk can't abort every other
      // table's push this cycle — a blanket "the call didn't throw, so
      // clear everything" rule (right for a single-batch upsert) would have
      // cleared dirty ids for students in a chunk that just failed,
      // permanently losing their retry. That's what `_runTableSync()`'s
      // upsertRows-return-value contract (see its own comment) exists to
      // fix: `upsertRows` below now collects and returns exactly the ids
      // that landed in a chunk that DIDN'T error, so only those get
      // cleared. Tracked in AppStore via `watchFields` — see
      // _DELTA_TRACKED_SLICES' `profiles` entry — so an xp/coin/level
      // change (constant, via gameplay, and none of the RPC-owned columns
      // ever touch this upsert anyway) never dirties this table; only the
      // identity/cosmetic columns actually sent here do.
      table: 'profiles',
      requiresStaffGate: true,
      getSource: (cache) => cache.students,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      deltaTracked: true,
      idField: 'id',
      async upsertRows(client, source) {
        // Live session double-check (defense-in-depth alongside the outer
        // requiresStaffGate pre-filter, which only trusts currentUser.role
        // — this additionally confirms a real backing JWT exists before
        // ever evaluating is_staff() server-side). See below for the
        // specific RLS failure modes this guards against.
        //
        //   1. RLS type mismatch (42883 "operator does not exist: text =
        //      uuid"): The is_staff() helper used by the
        //      profiles_staff_full_write and profiles_self_update_cosmetic_
        //      only policies compares auth.uid() (uuid type) against
        //      profiles.id (text type). That comparison only runs when the
        //      session has a real JWT (i.e. after a successful doLogin()),
        //      which is why this was invisible before the auth migration.
        //      The SQL fix is in supabase/fix_is_staff_uuid_cast.sql —
        //      is_staff() must cast: where id = auth.uid()::text
        //      This JS guard is a second layer of defence: we skip the
        //      bulk-push entirely for non-admin sessions so a student login
        //      can never accidentally trigger the write path that
        //      evaluates is_staff().
        //
        //   2. Partial RLS rejection for student sessions: even after
        //      fixing is_staff(), a student session's RLS policy
        //      (profiles_self_update_cosmetic_only) only permits updating
        //      the student's OWN row. Sending all students' rows in a
        //      single upsert would silently drop the others on newer
        //      PostgREST versions, or throw a 403/42501 on older ones.
        //      Admin sessions get profiles_staff_full_write (all rows) —
        //      so admin-only is both safe and correct for this bulk-sync
        //      path.
        //
        //   Student-initiated grants (loot, achievements, cosmetic updates)
        //   still go through DBService.rpc() → SECURITY DEFINER functions,
        //   exactly as documented in migration-strategy.md "Write paths
        //   that MUST use RPCs". This guard does NOT affect that path.
        let isStaffSession = false;
        try {
          const { data: sessionData } = await client.auth.getSession();
          if (sessionData && sessionData.session) {
            isStaffSession = (typeof currentUser !== 'undefined' && currentUser &&
              (currentUser.role === 'admin' || currentUser.role === 'teacher'));
          }
        } catch (e) {
          console.warn('[DBService] profiles upsert: could not check session, skipping.', e);
          return; // nothing pushed — nothing to report as succeeded
        }
        if (!isStaffSession) return; // nothing pushed

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
          if (mySections.length) {
            writableClassIds = new Set(
              mySections
                .filter(function (s) { return s.adviserId === currentUser.id; })
                .map(function (s) { return s.id; })
            );
          }
        }

        const allRows = source.map(s => ({
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

        // [Phase 5B] Collect exactly the ids that landed in a chunk that
        // did NOT error — this is the return value _runTableSync() uses to
        // clearDirty() only those, leaving a failed chunk's students dirty
        // for retry next cycle. Students skipped above (out-of-scope
        // section) were never in `rows` at all, so they're correctly never
        // in this list either — still dirty, same as a failed chunk.
        const succeededIds = [];
        if (rows.length) {
          const byClass = {};
          rows.forEach(function (r) { (byClass[r.class_id] = byClass[r.class_id] || []).push(r); });
          for (const classId of Object.keys(byClass)) {
            const { error } = await client.from('profiles').upsert(byClass[classId], { onConflict: 'id' });
            if (error) {
              console.warn('[DBService] profiles upsert rejected for class_id "' + classId + '" (' + byClass[classId].length + ' student(s) — not staff for this section server-side, or it has no adviser yet):', error);
            } else {
              byClass[classId].forEach(function (r) { succeededIds.push(r.id); });
            }
          }
        }
        return succeededIds;
      },
    },
    {
      // Boss events: upsert by internal _id (created server-side; a brand
      // new boss drafted offline has no _id yet, so it inserts and the
      // server assigns one on the next pull). See the per-row logic below
      // for the isNewRow-conditional field seeding (max_hp/current_hp,
      // lifecycle timestamps) and the retry-on-23502 stale-_id recovery —
      // both preserved verbatim from the original block.
      table: 'boss_events',
      requiresStaffGate: true,
      getSource: (cache) => cache.bossEvents,
      hasRows: (src) => Array.isArray(src),
      async upsertRows(client, source) {
        for (const b of source) {
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
              // Phase 46: pure admin-config JSON blobs with no RPC of their
              // own, so this bulk upsert is their only write path.
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
            // max_hp/current_hp are NOT NULL with no server-side default.
            // New row: fall back to a hard default (10000, matching
            // openBossForm()'s own default). Existing row: omit max_hp
            // entirely when locally missing, so this upsert can't null out a
            // previously-synced real value (same "don't touch what you
            // don't have" reasoning as `stock` on shop_products).
            if (isNewRow) {
              row.max_hp = b.maxHp || 10000;
              row.current_hp = (b.currentHp !== undefined && b.currentHp !== null) ? b.currentHp : row.max_hp;
            } else if (b.maxHp !== undefined && b.maxHp !== null) {
              row.max_hp = b.maxHp;
            }
            // Phase 26: current_hp/status/defeated_at/ended_at/
            // loot_started_at/loot_finalized_at are fully owned by RPCs once
            // a boss row exists server-side. Only seed them on the FIRST
            // insert (no _id yet) — nothing else can be racing on a row that
            // doesn't exist.
            if (isNewRow) {
              row.status = b.status;
              row.defeated_at = b.defeatedAt ? new Date(b.defeatedAt).toISOString() : null;
              row.ended_at = b.endedAt ? new Date(b.endedAt).toISOString() : null;
              row.loot_started_at = b.lootStartedAt ? new Date(b.lootStartedAt).toISOString() : null;
              row.loot_finalized_at = b.lootFinalizedAt ? new Date(b.lootFinalizedAt).toISOString() : null;
            }
            if (!row.id) delete row.id; // let Postgres gen_random_uuid() assign one
            let { error } = await client.from('boss_events').upsert(row, { onConflict: 'id' });
            // BUGFIX (stale local _id after an out-of-band delete): the
            // server sees no existing row with that id, so the upsert is
            // really an INSERT and trips the NOT-NULL constraint on
            // current_hp (23502) — a reliable signal the local _id no
            // longer refers to anything real. Retry once, seeding the full
            // new-row lifecycle fields, so a locally-orphaned draft can't
            // get permanently stuck retrying the same failure forever.
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
            // NOTE: lootClaims are NOT pushed from here — written via
            // claim_loot_reward() RPC at claim time only.
          } catch (e) {
            // Per-row isolation: one broken boss shouldn't stop every OTHER
            // boss in this same array from syncing this cycle.
            console.warn('[DBService] boss_events: skipping "' + (b.name || b._id || 'unnamed') + '" this cycle —', e);
          }
        }
      },
    },
    {
      // Boss participants: upsert the roster. Same defense-in-depth note as
      // profiles — RLS still restricts student-initiated writes to their own
      // row while the boss is active.
      // [Phase 5B] Fourth table converted to delta sync, and the first one
      // with a genuine second-actor-same-row clobber risk: combat damage is
      // ALREADY written through a scoped RPC (apply_boss_damage — see
      // combat-settings.js's wbcApplyDamage), atomically, per student, in
      // real time. But this whole-slice push ran on every save cycle
      // regardless — including every OTHER student's cached roster entries
      // for that boss, not just the caller's own. Two students fighting the
      // same boss concurrently: student B lands a hit (RPC updates B's row
      // on the server instantly), then student A's client — which hasn't
      // pulled B's update yet — saves for an unrelated reason and bulk-
      // pushed its whole local bossParticipants[bossIdx], including A's
      // STALE cached copy of B's row, silently reverting B's just-recorded
      // damage. Delta-scoping this closes that gap: A only ever re-pushes
      // rows IT dirtied, which under normal play is only A's own studentId
      // key (see minions.js/raid-flow.js/student-page.js — every
      // combat-side write path indexes bossParticipants[bossIdx] by
      // currentUser.id, never another student's).
      table: 'boss_participants',
      getSource: (cache) => cache.bossParticipants,
      hasRows: (src, cache) => !!(src && cache._bossIdById),
      buildRows(source, cache) {
        const idToUuid = {};
        Object.keys(cache._bossIdById).forEach(uuid => { idToUuid[cache._bossIdById[uuid]] = uuid; });
        const rows = [];
        Object.keys(source).forEach(idx => {
          const bossUuid = idToUuid[idx];
          if (!bossUuid) return;
          const roster = source[idx];
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
        return rows;
      },
      conflictKey: 'boss_id,student_id',
      deltaTracked: true,
      // Composite bossIdx->studentId source needs its own filter — plain
      // idField can't express "dirty" for a two-level keyed object. Also
      // pre-checks boss-uuid resolvability (same check buildRows makes) so
      // every id returned here is guaranteed to produce a row — an
      // unresolved boss's dirty ids are simply left out (and so stay dirty
      // for a later cycle, once that boss has synced and gained a uuid)
      // rather than risk clearDirty() on an id buildRows silently dropped.
      deltaFilterSource(source, dirtySet, cache) {
        const idToUuid = {};
        Object.keys(cache._bossIdById || {}).forEach(uuid => { idToUuid[cache._bossIdById[uuid]] = uuid; });
        const filtered = {};
        const ids = [];
        Object.keys(source).forEach(idx => {
          if (!idToUuid[idx]) return; // boss not resolved yet — leave dirty
          const roster = source[idx] || {};
          Object.keys(roster).forEach(studentId => {
            const id = idx + ':' + studentId;
            if (dirtySet.has(id)) {
              if (!filtered[idx]) filtered[idx] = {};
              filtered[idx][studentId] = roster[studentId];
              ids.push(id);
            }
          });
        });
        return { source: filtered, ids };
      },
    },
    {
      // Shop products: per-teacher catalog (Phase 14). `stock` is
      // deliberately excluded — owned exclusively by purchase_shop_product()
      // / restock_shop_product() RPCs, so a plain overwrite here can't
      // clobber a purchase/restock that happened between pull and push.
      // [Phase 5B] Twelfth table converted to delta sync. Flat array,
      // client-generated id (uid(), assigned in shop_admin_store.js's
      // doAddProduct() at the same line as ownerTeacherId — verified
      // before converting). `stock` deliberately isn't in buildRows' output
      // at all ("local/display value only — see RPC call below" in the
      // original comment), so no watchFields scoping is needed here the
      // way profiles needed it — nothing this table's diff would react to
      // is excluded from its own payload.
      table: 'shop_products',
      requiresStaffGate: true,
      getSource: (cache) => cache.store,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(p => p.id && p.ownerTeacherId) // tightened to match every other catalog table's filter (titles/quizzes/achievements all check .id explicitly) — harmless in practice, since doAddProduct() always sets both together, but consistent defensive shape
        .map(p => ({
          id: p.id, owner_teacher_id: p.ownerTeacherId,
          name: p.name, emoji: p.emoji, description: p.desc, category: p.cat,
          cost: p.cost, active: p.active !== false,
        })),
      conflictKey: 'id',
      deltaTracked: true,
      idField: 'id',
    },
    {
      // Achievements (the catalog — Phase 17). isHidden isn't a real column
      // today, stays local-only. user_achievements (per-student unlock/
      // claim rows) are NOT pushed from here — RPC-only, same reasoning as
      // loot_claims/registrations. Phase 32: owner_teacher_id required.
      //
      // [Phase 5B] Thirteenth table converted to delta sync. Same
      // reasoning as shop_products — client-generated id verified at
      // creation, and every field in buildRows' output is a catalog
      // definition column; per-student unlock/claim state is explicitly
      // out of scope for this push path (see comment above), so no
      // watchFields scoping is needed.
      table: 'achievements',
      requiresStaffGate: true,
      getSource: (cache) => cache.achievements,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(a => a.id && a.ownerTeacherId)
        .map(a => ({
          id: a.id, owner_teacher_id: a.ownerTeacherId,
          name: a.name, description: a.description, icon: a.icon,
          category: a.category, rarity: a.rarity, xp_reward: a.xpReward,
          coin_reward: a.coinReward, trigger_type: a.triggerType,
          trigger_value: a.triggerValue, active: a.active !== false,
        })),
      conflictKey: 'id',
      deltaTracked: true,
      idField: 'id',
    },
    {
      // Titles (the catalog — Phase 18). title_unlocks / equipped_title_id
      // are NOT pushed from here — RPC-only. Phase 32: owner required.
      // Phase 52: Designer v3 frame/style/accent/effect columns.
      // [Phase 5B] Seventh table converted to delta sync. Same reasoning as
      // redemptions/point_log: whole-row-replacement is fine here (a title
      // editor saves the full row at once), it just needs to be scoped to
      // the row this session actually touched — the practical risk isn't
      // necessarily two different teachers, it's the SAME teacher's own
      // second open tab autosaving stale catalog data over an edit just
      // made in the first.
      table: 'titles',
      requiresStaffGate: true,
      getSource: (cache) => cache.titles,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(t => t.id && t.ownerTeacherId)
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
        })),
      conflictKey: 'id',
      deltaTracked: true,
      idField: 'id',
    },
    {
      // Quizzes (the content catalog — Phase 20). Per-student
      // completedQuizzes/history and quiz_sections are out of scope here.
      // Phase 32: owner required. Phases 54/56/58/3: coalesces mirror the
      // pull-side coalesces so an older quiz saved before a field existed
      // pushes the same default the pull side already backfills, instead of
      // clobbering it with a raw undefined/null.
      // [Phase 5B] Ninth table converted to delta sync. Flat array,
      // client-generated id (uid(), assigned at draft-creation time in
      // quiz-builder.js's openQuizBuilder() — verified before converting,
      // same check that ruled out boss_events last session), same
      // whole-row-replacement-is-fine reasoning as titles.
      table: 'quizzes',
      requiresStaffGate: true,
      getSource: (cache) => cache.quizzes,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(q => q.id && q.ownerTeacherId)
        .map(q => ({
          id: q.id, owner_teacher_id: q.ownerTeacherId,
          title: q.title, description: q.desc,
          xp_reward: q.xpReward, coin_reward: q.coinReward, time_limit: q.timeLimit,
          rarity: q.rarity || 'Common', cadence: q.cadence || 'standing',
          chain_id: q.chainId || null, chain_order: q.chainOrder || 1, chain_label: q.chainLabel || null,
          start_date: q.startDate || null, end_date: q.endDate || null,
          stage_timers: Array.isArray(q.stageTimers) ? q.stageTimers : [null, null, null],
          questions: q.questions || [], active: q.active !== false,
        })),
      conflictKey: 'id',
      deltaTracked: true,
      idField: 'id',
    },
    {
      // Campaign worlds (the content catalog — Phase 22). stageProgress
      // (per-student) is out of scope. sort_order is stamped from each
      // world's position in cache.stageMap (no reorder-world feature — array
      // position IS the order). Phase 32: owner required.
      //
      // [Phase 5B] Tenth table converted to delta sync — but NOT a plain
      // config addition like titles/quizzes. buildRows used to compute
      // sort_order from `.map((w, idx) => ...)`'s own idx — i.e. the row's
      // position WITHIN THE ARRAY BEING MAPPED. That's correct for a
      // full-slice push (src IS cache.stageMap), but silently WRONG for a
      // delta-filtered push: the engine filters `src` down to only the
      // dirty world(s) before buildRows ever runs, so `idx` would become
      // the row's position within that small filtered subset — e.g. the
      // one dirty world sitting at position 5 in the real array would get
      // pushed with sort_order: 0, corrupting the map order server-side —
      // instead of just skipping the still-clean worlds around it. Fixed by
      // computing each world's true position from `cache.stageMap` (the
      // full, unfiltered array — buildRows always receives `cache` as its
      // second argument) rather than the `src` argument's own index, which
      // may or may not be the full array depending on what's dirty this
      // cycle. `fullOrder` below replicates the ORIGINAL two-step
      // filter-then-index logic exactly (not raw array position) so a
      // full-slice push (src === cache.stageMap, nothing filtered) computes
      // byte-identical sort_order values to the pre-Phase-5B code.
      table: 'campaign_worlds',
      requiresStaffGate: true,
      getSource: (cache) => cache.stageMap,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows(src, cache) {
        const fullOrder = {};
        (cache.stageMap || [])
          .filter(w => w.id && w.ownerTeacherId)
          .forEach((w, idx) => { fullOrder[w.id] = idx; });
        return src
          .filter(w => w.id && w.ownerTeacherId)
          .map(w => ({
            id: w.id, owner_teacher_id: w.ownerTeacherId,
            label: w.label, icon: w.icon, color: w.color,
            description: w.desc, stages: w.stages || [], sort_order: fullOrder[w.id],
          }));
      },
      conflictKey: 'id',
      deltaTracked: true,
      idField: 'id',
    },
    {
      // Point log: append-only history. Upsert by the client-generated id so
      // re-pushing a row doesn't insert duplicates.
      //
      // [Phase 5B] First table converted to delta/patch sync — see
      // _runTableSync()'s delta-tracking block below and
      // modules/core/state-manager.js's _DELTA_TRACKED_SLICES. Picked
      // deliberately as the doc's "lowest-traffic/lowest-consequence"
      // starting point: a point_log row's fields are fixed forever once
      // created (append-only — nothing ever edits an existing entry), so
      // there's no concurrent-same-row-edit scenario to get wrong while
      // this plumbing is new, unlike e.g. notifications' read flag or
      // orders' status. `idField` tells the engine which raw-cache-row
      // property to match against AppStore's dirty-id set.
      table: 'point_log',
      getSource: (cache) => cache.pointLog,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(p => p.id) // skip any stray pre-migration entries with no id
        .map(p => ({ id: p.id, student_id: p.studentId, what: p.what, pts: p.pts, when_label: p.when })),
      conflictKey: 'id',
      deltaTracked: true,
      idField: 'id',
    },
    {
      // Notifications: same upsert-by-id shape as point_log. Unlike
      // point_log (append-only), these DO get updated in place (mark
      // read/mark-all-read).
      // [Phase 5B] Second table converted to delta sync — see
      // modules/core/state-manager.js's _DELTA_TRACKED_SLICES comment for
      // why: this is the first delta-tracked table with a field (`read`)
      // that actually gets mutated after the row is created, so it's the
      // first real exercise of the clobber this whole phase exists to
      // prevent (a session with a stale cached copy of a row it never
      // touched re-pushing that stale value over another session's write).
      table: 'notifications',
      getSource: (cache) => cache.notifications,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(n => n.id && n.studentId) // skip anything malformed
        .map(n => ({
          id: n.id, student_id: n.studentId, type: n.type, icon: n.icon,
          title: n.title, body: n.body, action: n.action, pts: n.pts,
          source_id: n.sourceId, read: !!n.read,
        })),
      conflictKey: 'id',
      deltaTracked: true,
      idField: 'id',
    },
    {
      // Redemptions: orderId is already a unique client-generated key from
      // checkout time, reused directly as the upsert conflict target.
      // [Phase 5B] Sixth table converted to delta sync — append-only, same
      // low-blast-radius shape as point_log (the very first table
      // converted): a redemption's fields are fixed forever once created,
      // so no new mechanism was needed here, just the config addition.
      table: 'redemptions',
      getSource: (cache) => cache.redemptions,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(r => r.orderId)
        .map(r => ({
          order_id: r.orderId, student_id: r.studentId, item_id: r.itemId,
          item_name: r.itemName, emoji: r.emoji, item_label: r.item, pts: r.pts,
          date_label: r.date, time_label: r.time, claim_code: r.claimCode,
        })),
      conflictKey: 'order_id',
      deltaTracked: true,
      idField: 'orderId',
    },
    {
      // Phase 48 — orders: mirrors redemptions' pattern exactly, same
      // client-generated orderId conflict target. Covers cartCheckout() (new
      // pending orders), posExecuteClaim()/posExecuteCancel() (staff status
      // transitions), and ordExecuteCancel() (student self-cancel).
      //
      // [Phase 5B] Third table converted to delta sync — see
      // modules/core/state-manager.js's _DELTA_TRACKED_SLICES comment: this
      // is the first delta-tracked table where several columns
      // (status/claimed_at/claimed_by, or cancelled_at/cancel_reason/
      // cancelled_by) change together as one transition, rather than a
      // single boolean, so a stale whole-slice push here could revert
      // multiple related fields on a row at once.
      table: 'orders',
      getSource: (cache) => cache.orders,
      hasRows: (src) => Array.isArray(src) && src.length > 0,
      buildRows: (src) => src
        .filter(o => o.orderId)
        .map(o => ({
          order_id: o.orderId, student_id: o.studentId,
          student_name: o.studentName, student_init: o.studentInit, student_color: o.studentColor,
          item_id: o.itemId, item_name: o.itemName, emoji: o.emoji,
          cost: o.cost, category: o.category, claim_code: o.claimCode,
          status: o.status || 'pending',
          created_at: o.createdAt, created_date_str: o.createdDateStr,
          // claimedAt/cancelledAt are epoch-ms numbers locally — convert to
          // timestamptz on the way out, mirror of the pull-side Date.parse().
          claimed_at: o.claimedAt ? new Date(o.claimedAt).toISOString() : null,
          claimed_by: o.claimedBy,
          cancelled_at: o.cancelledAt ? new Date(o.cancelledAt).toISOString() : null,
          cancel_reason: o.cancelReason, cancelled_by: o.cancelledBy,
        })),
      conflictKey: 'order_id',
      deltaTracked: true,
      idField: 'orderId',
    },
    {
      // Phase 48 — inventory: keyed by (student_id, item_id) rather than a
      // single id, since DB.inventory is {studentId: [...]}. Flatten that
      // shape into rows here; the composite PK does the per-item upsert.
      // [Phase 5B] Fifth table converted to delta sync — first with a
      // genuinely different HUMAN ROLE (not just a different student) able
      // to dirty the same list: shop_pos_terminal.js writes into
      // draft.inventory[studentId] on a student's behalf when a TEACHER
      // runs the POS terminal, while that student's own device can
      // independently purchase something at the same time via
      // shop_store.js. Both append to the same student's item array from
      // two different sessions — the old whole-slice push meant either
      // side's stale cached copy of the other's most recent addition could
      // silently drop it the next time either side saved for an unrelated
      // reason.
      table: 'inventory',
      getSource: (cache) => cache.inventory,
      hasRows: (src) => !!(src && typeof src === 'object'),
      buildRows(src) {
        const rows = [];
        Object.keys(src).forEach(sid => {
          (src[sid] || []).forEach(item => {
            if (!item.itemId) return;
            rows.push({
              student_id: sid, item_id: item.itemId, item_name: item.itemName, emoji: item.emoji,
              category: item.category, quantity: item.quantity || 1,
              date_purchased: item.datePurchased, last_purchased: item.lastPurchased,
              source: item.source || 'Store', status: item.status || 'active', used_at: item.usedAt,
            });
          });
        });
        return rows;
      },
      conflictKey: 'student_id,item_id',
      deltaTracked: true,
      // Composite studentId->[items] source needs its own filter, same
      // reason as boss_participants: no single idField can express dirtiness
      // across a nested object-of-arrays shape. No uuid-resolution step
      // needed here (unlike boss_participants) — inventory rows don't
      // reference another table's server-generated id.
      deltaFilterSource(source, dirtySet) {
        const filtered = {};
        const ids = [];
        Object.keys(source).forEach(sid => {
          const matched = (source[sid] || []).filter(item => item.itemId && dirtySet.has(sid + ':' + item.itemId));
          if (matched.length) {
            filtered[sid] = matched;
            matched.forEach(item => ids.push(sid + ':' + item.itemId));
          }
        });
        return { source: filtered, ids };
      },
    },
    {
      // Phase 57: quiz_history, append-only per-student attempt log. Upsert
      // by the client-generated id, same convention as point_log. Entries
      // from before this phase have no id and are skipped (stay visible
      // locally; never sync retroactively).
      // [Phase 5B] Eighth table converted to delta sync. quizHistory
      // [studentId] = [attempts...] — same 'nestedArray' shape as
      // inventory. Append-only (finishQuiz()/abortQuiz() in index.html
      // never edit an existing entry), client-generated id ('qh_' + uid())
      // at creation, same low-blast-radius shape as point_log/redemptions.
      table: 'quiz_history',
      getSource: (cache) => cache.quizHistory,
      hasRows: (src) => !!(src && typeof src === 'object'),
      buildRows(src) {
        const rows = [];
        Object.keys(src).forEach(sid => {
          (src[sid] || []).forEach(h => {
            if (!h.id || !h.quizId) return;
            rows.push({
              id: h.id, student_id: sid, quiz_id: h.quizId,
              score: h.score || 0, attempt: h.attempt || 1,
              completed_at: h.completedAt, date_label: h.date,
              // Phase 59: an entry logged before per-question tracking
              // existed has no `results` array — push null, not [], so it
              // isn't misread as "0 questions."
              question_results: Array.isArray(h.results) ? h.results : null,
              // Phase 63: without this, abortQuiz()'s aborted:true never
              // left the browser, so a walked-away attempt looked complete.
              aborted: !!h.aborted,
            });
          });
        });
        return rows;
      },
      conflictKey: 'id',
      deltaTracked: true,
      // Same shape/reasoning as inventory's deltaFilterSource — no
      // uuid-resolution step needed, quiz_history rows don't reference
      // another table's server-generated id.
      deltaFilterSource(source, dirtySet) {
        const filtered = {};
        const ids = [];
        Object.keys(source).forEach(sid => {
          const matched = (source[sid] || []).filter(h => h.id && dirtySet.has(sid + ':' + h.id));
          if (matched.length) {
            filtered[sid] = matched;
            matched.forEach(h => ids.push(sid + ':' + h.id));
          }
        });
        return { source: filtered, ids };
      },
    },
  ];

  // BUGFIX (table isolation): every block used to just `throw error`
  // straight out of _pushCacheToSupabase, so the FIRST table to fail in a
  // cycle silently prevented every table listed after it from even being
  // attempted. Wrapping each table's push in this helper means one bad
  // table only ever blocks itself.
  async function _pushTable(label, fn) {
    try {
      await fn();
    } catch (e) {
      console.warn('[DBService] remote sync failed for ' + label + ', staying on local cache:', e);
    }
  }

  // The generic engine: walks _TABLE_SYNC_CONFIGS, applying each config's
  // guard/gate, then either its custom upsertRows or the default
  // single-upsert write. This is the one place that replaces what used to be
  // 13 copy-pasted blocks.
  async function _runTableSync(client, cache, isCatalogStaffSession) {
    for (const cfg of _TABLE_SYNC_CONFIGS) {
      let source = cfg.getSource(cache);
      if (!cfg.hasRows(source, cache)) continue;
      if (cfg.requiresStaffGate && !isCatalogStaffSession) continue;

      // [Phase 5B] Delta/patch sync — opt-in per table via cfg.deltaTracked
      // (point_log, notifications, orders, boss_participants, inventory,
      // redemptions, titles as of this session — see each table's own
      // comment for why it was picked and in what order). `dirtyIds` stays
      // null (not an empty array) whenever we can't get a real answer from
      // AppStore, which is the signal below to fall back to the old Phase
      // 5A full-slice push — that covers an AppStore that predates
      // getDirtyIds, a table that isn't in AppStore's own
      // _DELTA_TRACKED_SLICES yet, AND the
      // `_test.pushCacheToSupabase(client, cache)` seam other tests use,
      // which calls this engine directly and never goes through
      // AppStore.updateState() at all. A real empty array (tracked, but
      // nothing dirty this cycle) skips the push entirely instead.
      let dirtyIds = null;
      if (cfg.deltaTracked && typeof AppStore !== 'undefined' && typeof AppStore.getDirtyIds === 'function') {
        const d = AppStore.getDirtyIds(cfg.table);
        if (Array.isArray(d)) dirtyIds = d;
      }
      let matchedIdsForClear = null;
      if (dirtyIds !== null) {
        if (dirtyIds.length === 0) continue; // tracked, nothing dirty — nothing to push
        const dirtySet = new Set(dirtyIds);
        if (cfg.deltaFilterSource) {
          const filtered = cfg.deltaFilterSource(source, dirtySet, cache);
          source = filtered.source;
          matchedIdsForClear = filtered.ids;
        } else {
          source = Array.isArray(source) ? source.filter(row => dirtySet.has(row[cfg.idField])) : source;
        }
      }

      await _pushTable(cfg.table, async () => {
        if (cfg.upsertRows) {
          // [Phase 5B] upsertRows MAY return an array of ids that were
          // CONFIRMED written (only meaningful for a deltaTracked table).
          // This is opt-in and additive: a table whose upsertRows doesn't
          // return anything (the pre-existing contract) behaves exactly as
          // before — dirty ids just never get cleared via this path, which
          // is always safe (worst case: a harmless redundant re-push next
          // cycle), never incorrect. Exists specifically for tables like
          // profiles whose upsert is chunked (per class_id) and where a
          // rejected chunk warns-and-continues rather than throwing — a
          // blanket "the call didn't throw, so clear everything" (the
          // single-upsert path's rule, above) would be WRONG here, since it
          // would clear ids for students in a chunk that just failed,
          // permanently losing their retry. Reporting back exactly which
          // ids landed is what makes delta-tracking safe for a
          // partial-failure-tolerant upsertRows implementation.
          const succeededIds = await cfg.upsertRows(client, source, cache);
          if (dirtyIds !== null && typeof AppStore.clearDirty === 'function' && Array.isArray(succeededIds) && succeededIds.length) {
            AppStore.clearDirty(cfg.table, succeededIds);
          }
          return;
        }
        const rows = cfg.buildRows(source, cache);
        if (rows.length) {
          const { error } = await client.from(cfg.table).upsert(rows, { onConflict: cfg.conflictKey });
          if (error) throw error;
        }
        // Only reached when the upsert above didn't throw — a failed push
        // deliberately leaves these ids dirty so next cycle retries them,
        // same resiliency contract _pushTable's catch already provides for
        // the whole-table path.
        if (dirtyIds !== null && typeof AppStore.clearDirty === 'function' && rows.length) {
          const idsToClear = matchedIdsForClear !== null ? matchedIdsForClear : rows.map(r => r[cfg.conflictKey]);
          AppStore.clearDirty(cfg.table, idsToClear);
        }
      });
    }
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

    // profiles' write logic (staff-session double-check, per-class-id
    // chunking, RPC-owned-column exclusion) now lives in _TABLE_SYNC_CONFIGS'
    // 'profiles' entry, run via _runTableSync() below — folded in this
    // session; see that entry's own comment for the full history.

    // Repository layer (Phase 5A + this session's profiles fold-in): every
    // table's write logic, including profiles, now lives in
    // _TABLE_SYNC_CONFIGS + _runTableSync, defined above.
    await _runTableSync(client, cache, isCatalogStaffSession);


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

  return {
    pushCacheToSupabase: _pushCacheToSupabase,
    tableSyncConfigs: _TABLE_SYNC_CONFIGS,
  };
})();

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.TableSyncRepository = TableSyncRepository;
