// src/modules/core/state-manager.js — real-ESM twin of
// ../../../modules/core/state-manager.js. Phase 7 (Stream A), file 8/29.
// Original stays untouched.
//
// Single top-level declare (`window.AppStore = (function(){...}());`),
// matching the AST's real top-level statement count exactly (1) — this
// file's own dependency-map declaresCount reads 4, but a direct acorn
// parse confirms only one top-level ExpressionStatement/
// AssignmentExpression exists; same tool-overcounting pattern already
// seen repeatedly in Stream B and once in this stream, not investigated
// further, doesn't change what needs exporting.
//
// Conversion is a single substitution: `window.AppStore = ` →
// `export const AppStore = `. Everything else — the entire ~820-line
// IIFE body, including the eager `init()` call at the bottom (a real
// load-time side effect: awaits DBService.initRemote(), reads
// DBService.read(), sets window.DB/loadDB/saveDB, registers
// visibilitychange/pagehide/online/offline listeners) — is unchanged.
//
// Checked the one bare `AppStore.syncFromLegacy(window.DB)` reference
// inside this file's own body (line ~528, inside the `window.saveDB =
// function () {...}` closure): it is NOT a load-time self-reference
// hazard, because it only runs when saveDB() is actually CALLED later
// (by db-migrations.js or the inline boot script), well after this
// module's own top-level `const AppStore = ...` binding has finished
// initializing — by then the closure correctly resolves the bare
// `AppStore` identifier to the local module-scoped const (JS scope
// resolution favors the nearest enclosing binding over a global/window
// property of the same name), which holds the identical object the
// bridge also re-attaches to `window.AppStore` — so this behaves
// correctly either way, real import or window fallback, without needing
// a fix. This is a different situation from
// modules/mail/index.js's TDZ hazard (file 7): that one broke because
// the bare reference and the const being declared were evaluated
// SYNCHRONOUSLY, in the same statement, before the binding initializes;
// this one is deferred inside a closure not invoked until long after
// initialization completes.
//
// Following this stream's own established convention (src/dsm-service.js,
// file 2) rather than Stream B's differing one: no extra
// `window.AppStore = AppStore;` self-wiring line is added in src/ itself
// — only the bridge re-attaches it to window, matching how this
// stream's very first IIFE-namespace conversion was already done and
// accepted.
//
// DBService (db-service.js, item 11, not yet converted) and DEFAULT_DB
// (db-schema.js, item 13, not yet converted) are both read as bare
// globals (window fallback) — both are later in this SAME stream's file
// list; no real import possible yet, and no cycle risk (dependency map
// confirms neither depends back on this file).

/**
 * EduQuest — AppStore (state-manager.js) v3 — Supabase-ready
 * ══════════════════════════════════════════════════════════════════════════════
 * Unidirectional, immutable state management layer.
 *
 * Architecture:
 *   UI / Service Layer → AppStore.updateState(draft => { … })
 *                      → deep-clone → mutate draft → commit → debounced persist → notify
 *
 * Read paths (targeted clones, not full DB copies):
 *   AppStore.getState()         — full DB clone  (legacy bridge; avoid in hot paths)
 *   AppStore.getSlice(fn)       — clone of selected sub-tree only
 *   AppStore.getStudent(id)     — clone of one student record
 *   AppStore.getBossEvent(idx)  — clone of one boss event
 *
 * Write path (sole mutation gate, UNCHANGED signature from v2):
 *   AppStore.updateState(draft => { draft.students[0].xp += 10; })
 *
 * [OPT-1] Debounced persistence (300 ms trailing-edge) collapses burst writes.
 * [OPT-2] Targeted slice selectors eliminate full-DB serialisation in hot paths.
 *
 * WHAT CHANGED IN v3 (Supabase migration)
 *   updateState() / getState() / getSlice() / getStudent() / getBossEvent()
 *   are 100% UNCHANGED — this is the "Maintain Repository Boundary"
 *   requirement. LootService and every UI module call these exactly as
 *   before and need ZERO edits.
 *
 *   What's new is the BOOT SEQUENCE: init() used to read localStorage
 *   synchronously at parse time. DBService.read() must now be preceded by
 *   an async DBService.initRemote() call (it hydrates the in-memory cache
 *   that DBService.read()/write() then operate on synchronously — see the
 *   "THE SYNC PROBLEM" comment in db-service.js for why that split exists).
 *
 *   AppStore therefore exposes a new `AppStore.ready` promise. index.html's
 *   boot sequence now looks like:
 *
 *     <script>
 *       AppStore.ready.then(() => {
 *         DB = loadDB();        // unchanged — same as before
 *         runMigrations();      // unchanged
 *         // ... existing inline boot script continues exactly as-is ...
 *       });
 *     </script>
 *
 *   This is the ONLY call-site change required outside of db-service.js
 *   itself — see migration-strategy.md "Boot sequence change" for the
 *   full index.html diff. db-migrations.js, auth.js, and every domain
 *   module are untouched.
 *
 * Requires: DBService (db-service.js), DEFAULT_DB (db-schema.js)
 * Must load BEFORE: db-migrations.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

export const AppStore = (function () {
  'use strict';

  // ─── Private State ────────────────────────────────────────────────────────
  let _state = null;                // The single source of truth
  let _subscribers = {};            // { key: fn(state, event) }
  let _persistTimer = null;         // [OPT-1] debounce handle
  let _persistDirty = false;        // true when an unpersisted mutation exists
  let _readyResolve = null;         // resolves AppStore.ready once init() completes

  // ─── Delta-sync dirty tracking (Phase 5B) ──────────────────────────────────
  // db-service.js's repository layer (Phase 5A) still pushes each synced
  // table's ENTIRE local slice on every flush cycle — that's the remaining
  // root-cause risk the Phase 5 doc calls out: two sessions each pushing a
  // full stale snapshot of the same table can clobber each other's writes.
  // This is the other half of the fix: updateState() (the sole mutation
  // gate) now tracks which specific rows were actually dirtied by a given
  // commit, per table, so the repository layer can push ONLY those rows
  // instead of the whole slice.
  //
  // Rolled out one table at a time, per the doc's own risk-ordering —
  // `point_log` first (append-only, lowest consequence: a row's fields are
  // fixed forever once created, so there's no concurrent-same-row-edit
  // scenario to get wrong while this plumbing is still new). `notifications`
  // is the second table, added once point_log's mechanism was proven — it's
  // the first delta-tracked table with a genuinely mutable field (`read`,
  // toggled by mark-read/mark-all-read), so it's the first real test of the
  // actual bug shape this whole phase exists to prevent: a session with a
  // stale local copy of a row it never touched re-pushing that stale value
  // and clobbering a change some OTHER session already wrote. `orders` is
  // the third — several mutable fields that change together as one
  // status-transition bundle (`status`/`claimed_at`/`claimed_by` via
  // posExecuteClaim/posExecuteCancel, or `cancelled_at`/`cancel_reason`/
  // `cancelled_by` via a student's own ordExecuteCancel), rather than one
  // boolean, so it's the first table where a whole-slice push from a stale
  // session could revert MULTIPLE related columns of a row at once. Adding
  // another table to delta sync later is a `_DELTA_TRACKED_SLICES` entry
  // here PLUS that table's `deltaTracked`/`idField` config in
  // db-service.js's `_TABLE_SYNC_CONFIGS` — not a new mechanism.
  //
  // Keyed by the table's POSTGRES name (matching what db-service.js's
  // `_TABLE_SYNC_CONFIGS[].table` already uses as its isolation label) so
  // the repository layer never has to know AppStore's local camelCase
  // slice names — `statePath`/`idField` below are the only place that
  // mapping lives.
  //
  // `shape` (default 'array') controls which diff algorithm applies:
  //   'array'      — statePath holds an array of rows; `idField` names the
  //                  property that identifies each row (e.g. pointLog's
  //                  `id`).
  //   'nested'     — statePath holds a two-level keyed object, not an array
  //                  (e.g. bossParticipants[bossIdx][studentId] — there's no
  //                  flat row list to index by idField). Dirty ids are the
  //                  composite string `${outerKey}:${innerKey}`. Added for
  //                  boss_participants — see that entry's own comment for
  //                  why it's the first delta-tracked table where a
  //                  genuinely different SESSION (a second student
  //                  mid-raid) can dirty a row this session never touched.
  //   'nestedArray'— statePath holds an object keyed by outer key, whose
  //                  VALUE is an array of rows (e.g. inventory[studentId] =
  //                  [items...]) — a hybrid of the two shapes above.
  //                  `innerIdField` names the property on each inner row
  //                  that identifies it. Dirty ids are the composite string
  //                  `${outerKey}:${row[innerIdField]}`. Added for
  //                  inventory — see that entry's own comment for the
  //                  teacher-POS-terminal-vs-student's-own-device scenario
  //                  this closes.
  const _DELTA_TRACKED_SLICES = {
    point_log: { statePath: 'pointLog', idField: 'id' },
    notifications: { statePath: 'notifications', idField: 'id' },
    orders: { statePath: 'orders', idField: 'orderId' },
    // boss_participants: keyed bossParticipants[bossIdx][studentId], not an
    // array — see 'nested' shape above. Composite dirty id is
    // "<bossIdx>:<studentId>". This is the first delta-tracked table where
    // the row a session dirties is genuinely reachable by ANOTHER student's
    // combat session concurrently (each student answering boss questions
    // only ever touches their OWN studentId key), unlike point_log/
    // notifications/orders where every no-clobber test so far modeled "two
    // different rows," never true concurrent access to one.
    boss_participants: { statePath: 'bossParticipants', shape: 'nested' },
    // inventory: keyed inventory[studentId] = [items...] — see
    // 'nestedArray' shape above. Composite dirty id is
    // "<studentId>:<itemId>". The genuinely-different-actor case here is a
    // teacher running the shop POS terminal (shop_pos_terminal.js writes
    // into draft.inventory[studentId] on the STUDENT's behalf) at the same
    // time that student's own device independently purchases something —
    // two different sessions appending to the same student's item list.
    inventory: { statePath: 'inventory', shape: 'nestedArray', innerIdField: 'itemId' },
    // redemptions: flat array, append-only history log (client-generated
    // orderId per redemption, never edited after creation) — same
    // low-blast-radius shape as point_log, the very first table converted.
    // Sixth table, no new mechanism needed.
    redemptions: { statePath: 'redemptions', idField: 'orderId' },
    // titles: flat array, teacher-owned catalog rows (title editor). Same
    // "whole-row-replacement is fine, just needs to be scoped to the row
    // this session actually edited" reasoning as every array-shaped table
    // so far — the risk here isn't a second human so much as the same
    // teacher's own second open tab autosaving stale data over an edit
    // made in the first.
    titles: { statePath: 'titles', idField: 'id' },
    // quiz_history: keyed quizHistory[studentId] = [attempts...] — same
    // 'nestedArray' shape as inventory. Eighth table, and — like
    // point_log/redemptions — append-only (an attempt's fields are fixed
    // forever once logged; see finishQuiz()/abortQuiz() in index.html,
    // neither ever edits an existing entry). Client-generates its own id
    // ('qh_' + uid()) at creation time, same as every table converted so
    // far — this is the property boss_events lacks (its id is assigned by
    // Postgres, not the client, so a brand-new row has nothing to track
    // dirty by until AFTER its first successful sync — ruled it out as a
    // delta-sync candidate for that reason, not attempted this session).
    quiz_history: { statePath: 'quizHistory', shape: 'nestedArray', innerIdField: 'id' },
    // quizzes: flat array, teacher-owned catalog rows — same pattern as
    // titles. Ninth table, client-generated id verified at
    // openQuizBuilder()'s draft-creation time before converting.
    quizzes: { statePath: 'quizzes', idField: 'id' },
    // campaign_worlds: flat array, client-generated id. Tenth table — see
    // db-service.js's config comment for why THIS one needed an actual code
    // fix (not just a config addition): sort_order used to be computed from
    // array position within whatever subset buildRows received, which
    // delta-filtering would have silently corrupted.
    campaign_worlds: { statePath: 'stageMap', idField: 'id' },
    // profiles: flat array (DB.students), but scoped with `watchFields` —
    // see _projectWatchFields()'s own comment for why: a student row's
    // xp/coins/level/tier/etc change constantly via gameplay and are
    // RPC-owned, never part of this table's own upsert payload, so
    // diffing the whole row would dirty this table almost every save.
    // Eleventh table converted, and the one that needed the
    // upsertRows-return-value contract (db-service.js's _runTableSync)
    // before it could be delta-tracked safely at all — see that table's
    // own config comment.
    profiles: {
      statePath: 'students', idField: 'id',
      watchFields: ['name', 'init', 'color', 'firstName', 'lastName', 'profilePic', 'classId'],
    },
    // shop_products / achievements: flat array, teacher-owned catalog rows
    // — same pattern as titles/quizzes. Twelfth and thirteenth tables,
    // client-generated ids verified at creation before converting. Every
    // field either table's buildRows sends is a catalog-definition column
    // (no per-student unlock/stock state, which stays RPC-only) — no
    // watchFields scoping needed, unlike profiles.
    shop_products: { statePath: 'store', idField: 'id' },
    achievements: { statePath: 'achievements', idField: 'id' },
  };
  let _dirty = {}; // { <postgres table name>: Set<localRowId> }

  // For every tracked slice, diff `oldState[statePath]` (pre-commit) against
  // `newState[statePath]` (the draft about to become _state) and add any
  // row that's new OR whose content changed to that table's dirty set. Rows
  // with no id yet (a brand-new local entry pre-migration/pre-save) are
  // skipped — same "nothing to sync yet" reasoning db-service.js's own
  // buildRows() filters already apply, so a row only ever enters the dirty
  // set once it's actually syncable.
  //
  // Runs on every updateState() commit, but only over the (currently small)
  // tracked-slice list — cheap by construction, not something to worry
  // about scaling until that list grows much further.
  function _trackDirty(oldState, newState) {
    Object.keys(_DELTA_TRACKED_SLICES).forEach(function (table) {
      const cfg = _DELTA_TRACKED_SLICES[table];
      if (cfg.shape === 'nested') {
        _trackDirtyNested(table, cfg, oldState, newState);
        return;
      }
      if (cfg.shape === 'nestedArray') {
        _trackDirtyNestedArray(table, cfg, oldState, newState);
        return;
      }
      const oldArr = (oldState && Array.isArray(oldState[cfg.statePath])) ? oldState[cfg.statePath] : [];
      const newArr = (newState && Array.isArray(newState[cfg.statePath])) ? newState[cfg.statePath] : [];
      if (!newArr.length) return;

      const oldById = {};
      oldArr.forEach(function (row) {
        const id = row && row[cfg.idField];
        if (id !== undefined && id !== null) oldById[id] = JSON.stringify(_projectWatchFields(row, cfg.watchFields));
      });

      newArr.forEach(function (row) {
        const id = row && row[cfg.idField];
        if (id === undefined || id === null) return; // not syncable yet
        const prevJSON = oldById[id];
        const newJSON = JSON.stringify(_projectWatchFields(row, cfg.watchFields));
        if (prevJSON === undefined || prevJSON !== newJSON) {
          if (!_dirty[table]) _dirty[table] = new Set();
          _dirty[table].add(id);
        }
      });
    });
  }

  // [Phase 5B] OPTIONAL narrowing for the 'array' shape diff above: when a
  // _DELTA_TRACKED_SLICES entry sets `watchFields` (an array of property
  // names), only THOSE fields are compared — everything else on the row is
  // ignored for dirty-tracking purposes. Returns the row unchanged when
  // `watchFields` is absent (every other 'array'-shaped table today), so
  // this is purely additive.
  //
  // profiles is why this exists: DB.students rows carry xp/coins/level/
  // tier/etc — fields that change constantly via ordinary gameplay and are
  // never part of this table's own upsert payload anyway (they're
  // RPC-owned — see db-service.js's `profiles` config comment). Diffing the
  // whole row would dirty this table on nearly every save, defeating the
  // point of delta-tracking it at all. `watchFields` scopes the diff to
  // just the identity/cosmetic columns this table's upsertRows actually
  // sends.
  function _projectWatchFields(row, fields) {
    if (!fields) return row;
    const out = {};
    fields.forEach(function (f) { out[f] = row[f]; });
    return out;
  }

  // 'nested' shape diff — see _DELTA_TRACKED_SLICES's own comment.
  // `oldState[statePath]`/`newState[statePath]` are two-level keyed objects
  // (outerKey -> innerKey -> row), not arrays. Composite dirty id is
  // "<outerKey>:<innerKey>". Currently only boss_participants uses this.
  function _trackDirtyNested(table, cfg, oldState, newState) {
    const oldRoot = (oldState && oldState[cfg.statePath]) || {};
    const newRoot = (newState && newState[cfg.statePath]) || {};
    Object.keys(newRoot).forEach(function (outerKey) {
      const oldInner = oldRoot[outerKey] || {};
      const newInner = newRoot[outerKey] || {};
      Object.keys(newInner).forEach(function (innerKey) {
        const id = outerKey + ':' + innerKey;
        const hadBefore = Object.prototype.hasOwnProperty.call(oldInner, innerKey);
        const newJSON = JSON.stringify(newInner[innerKey]);
        if (!hadBefore || JSON.stringify(oldInner[innerKey]) !== newJSON) {
          if (!_dirty[table]) _dirty[table] = new Set();
          _dirty[table].add(id);
        }
      });
    });
  }

  // 'nestedArray' shape diff — see _DELTA_TRACKED_SLICES's own comment.
  // `oldState[statePath]`/`newState[statePath]` are objects keyed by outer
  // key, whose VALUE is an array of rows (e.g. inventory[studentId] =
  // [items...]). Composite dirty id is "<outerKey>:<row[innerIdField]>".
  // Currently only inventory uses this.
  function _trackDirtyNestedArray(table, cfg, oldState, newState) {
    const oldRoot = (oldState && oldState[cfg.statePath]) || {};
    const newRoot = (newState && newState[cfg.statePath]) || {};
    Object.keys(newRoot).forEach(function (outerKey) {
      const oldArr = Array.isArray(oldRoot[outerKey]) ? oldRoot[outerKey] : [];
      const newArr = Array.isArray(newRoot[outerKey]) ? newRoot[outerKey] : [];
      if (!newArr.length) return;

      const oldById = {};
      oldArr.forEach(function (row) {
        const innerId = row && row[cfg.innerIdField];
        if (innerId !== undefined && innerId !== null) oldById[innerId] = JSON.stringify(row);
      });

      newArr.forEach(function (row) {
        const innerId = row && row[cfg.innerIdField];
        if (innerId === undefined || innerId === null) return; // not syncable yet
        const id = outerKey + ':' + innerId;
        const prevJSON = oldById[innerId];
        if (prevJSON === undefined || prevJSON !== JSON.stringify(row)) {
          if (!_dirty[table]) _dirty[table] = new Set();
          _dirty[table].add(id);
        }
      });
    });
  }

  // [Phase 5B bugfix] Persist/restore _dirty across a reload — closes the
  // gap found in post-implementation review: _dirty previously lived ONLY
  // in this module-level variable, never surviving a tab close/crash/
  // offline session that ended before the debounced Supabase push ran. See
  // db-service.js's _DIRTY_TRACKING_KEY comment for the full mechanism.
  //
  // Guarded by `typeof DBService.writeDirty/readDirty === 'function'`
  // throughout (same convention this file already uses for every other
  // optional-newer-DBService-method check) so this degrades silently — not
  // a crash — against an older db-service.js that predates this fix.

  // Serializes _dirty's Sets into a plain {table: string[]} object and
  // hands it to DBService.writeDirty(). Called both from _flushNow() (new
  // dirty ids just got added) and from clearDirty() (ids just got removed
  // by a confirmed push) — NOT only on the debounced _state flush, because
  // clearDirty() happens outside updateState() entirely (called by
  // db-service.js's repository layer after a push succeeds) and would
  // otherwise not get persisted until some unrelated later edit happened to
  // trigger a flush, leaving a stale (already-synced) id sitting in
  // storage in the meantime — harmless (an idempotent re-push at worst) but
  // worth tightening since the write itself is cheap.
  function _persistDirtySnapshot() {
    if (typeof DBService.writeDirty !== 'function') return;
    const snapshot = {};
    Object.keys(_dirty).forEach(function (table) {
      snapshot[table] = Array.from(_dirty[table]);
    });
    try {
      DBService.writeDirty(snapshot);
    } catch (e) {
      console.warn('[AppStore] failed to persist dirty-tracking snapshot:', e);
    }
  }

  // True if `id` (a plain idField value, or a "outer:inner" composite for
  // 'nested'/'nestedArray' shapes) still refers to something actually
  // present in the just-loaded _state — restored ids that don't are
  // dropped rather than kept, so a stale/cross-account id can only ever
  // cause an extra idempotent no-op, never an incorrect push of real data.
  function _dirtyIdStillExists(cfg, id) {
    const root = _state && _state[cfg.statePath];
    if (!root) return false;
    const shape = cfg.shape || 'array';
    if (shape === 'array') {
      return Array.isArray(root) && root.some(function (row) { return row && String(row[cfg.idField]) === String(id); });
    }
    const sep = String(id).indexOf(':');
    if (sep < 0) return false;
    const outerKey = String(id).slice(0, sep);
    const innerKey = String(id).slice(sep + 1);
    const inner = root[outerKey];
    if (!inner) return false;
    if (shape === 'nested') {
      return Object.prototype.hasOwnProperty.call(inner, innerKey);
    }
    if (shape === 'nestedArray') {
      return Array.isArray(inner) && inner.some(function (row) { return row && String(row[cfg.innerIdField]) === innerKey; });
    }
    return false;
  }

  // Called once from init(), after _state is finalized. Reads back
  // whatever _persistDirtySnapshot() last wrote and repopulates _dirty,
  // pruned against the _state that actually just loaded.
  function _restoreDirtyFromStorage() {
    if (typeof DBService.readDirty !== 'function') return;
    let snapshot = null;
    try {
      snapshot = DBService.readDirty();
    } catch (e) {
      console.warn('[AppStore] failed to read dirty-tracking snapshot; continuing with none pending.', e);
      snapshot = null;
    }
    if (!snapshot || typeof snapshot !== 'object') return;
    Object.keys(_DELTA_TRACKED_SLICES).forEach(function (table) {
      const ids = snapshot[table];
      if (!Array.isArray(ids) || !ids.length) return;
      const cfg = _DELTA_TRACKED_SLICES[table];
      const validIds = ids.filter(function (id) { return _dirtyIdStillExists(cfg, id); });
      if (validIds.length) _dirty[table] = new Set(validIds);
    });
  }

  // ─── Deep Clone Utility ───────────────────────────────────────────────────
  function _deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  // ─── Persistence (Debounced) ──────────────────────────────────────────────
  /**
   * [OPT-1] Schedule a trailing-edge write.
   * Multiple calls within 300 ms collapse to ONE localStorage.setItem().
   */
  function _persist() {
    _persistDirty = true;
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(_flushNow, 300);
  }

  function _flushNow() {
    if (!_persistDirty || _state === null) return;
    try {
      DBService.write(_state);
      _persistDirty = false;
      // [Phase 5B bugfix] Keep the dirty-tracking snapshot in lockstep with
      // every _state persist — see _persistDirtySnapshot()'s own comment.
      _persistDirtySnapshot();
    } catch (e) {
      console.error('[AppStore] _flushNow() failed:', e);
    }
    _persistTimer = null;
  }

  // ─── Subscriber Notification ──────────────────────────────────────────────
  function _notify(event) {
    const keys = Object.keys(_subscribers);
    for (let i = 0; i < keys.length; i++) {
      try {
        _subscribers[keys[i]](_state, event || { type: 'state:updated', payload: null });
      } catch (e) {
        console.error('[AppStore] subscriber "' + keys[i] + '" threw:', e);
      }
    }
  }

  // ─── Initialisation ───────────────────────────────────────────────────────
  /**
   * Called once at parse time. Awaits DBService.initRemote() (the ONLY new
   * async step in the whole boot chain — see file header), THEN reads the
   * now-hydrated cache synchronously exactly as v2 did, and sets up the
   * legacy window.DB bridge and safety-flush handlers.
   *
   * Resolves `_readyResolve` (→ AppStore.ready) when done, so index.html's
   * boot script can do `AppStore.ready.then(() => { DB = loadDB(); ... })`
   * instead of assuming AppStore is ready the instant this file parses.
   */
  async function init() {
    // [NEW] Hydrate DBService's in-memory cache from Supabase (or fall back
    // to localStorage if offline / unconfigured — see db-service.js).
    // If DBService.initRemote doesn't exist (old db-service.js still
    // loaded), this is a no-op and behavior is identical to v2.
    if (typeof DBService.initRemote === 'function') {
      try {
        await DBService.initRemote();
      } catch (e) {
        console.error('[AppStore] DBService.initRemote() failed; continuing with whatever local cache is available.', e);
      }
    }

    try {
      _state = DBService.read();
      if (!_state || typeof _state !== 'object') {
        console.warn('[AppStore] init: DBService.read() returned empty; using DEFAULT_DB.');
        _state = _deepClone(DEFAULT_DB);
      }
    } catch (e) {
      console.error('[AppStore] init: failed to read DB, falling back to DEFAULT_DB.', e);
      _state = _deepClone(DEFAULT_DB);
    }

    // [Phase 5B bugfix] Restore delta-sync dirty-id tracking now that
    // _state is finalized (validation needs it). Guarded separately from
    // the big try block below — a failure here should never cascade into
    // skipping the legacy-bridge setup that follows.
    try {
      _restoreDirtyFromStorage();
    } catch (e) {
      console.warn('[AppStore] init: failed to restore dirty-tracking snapshot; continuing with none pending.', e);
    }

    // BUGFIX: everything below used to run unguarded. init() is async, and
    // nothing awaits/catches the promise it returns (it's fired at parse
    // time — see the bottom of this file) — so ANY exception thrown past
    // this point used to reject that promise silently and permanently
    // strand AppStore.ready in a pending state forever, with no console
    // error explaining why. Wrapping it means a failure here degrades
    // (AppStore still resolves `ready`, just without these side effects)
    // instead of hanging the entire app boot with no diagnostic.
    try {
      // ── Legacy Bridge ────────────────────────────────────────────────────
      // Keep window.DB pointing at a fresh clone after every updateState commit.
      // Legacy code that reads `DB` will always get a consistent snapshot.
      // Legacy code that writes directly to window.DB is NOT picked up automatically;
      // it must call AppStore.syncFromLegacy() to push changes in.
      window.DB = _deepClone(_state);

      // ── Shim loadDB / saveDB so db-migrations.js works unchanged ────────
      window.loadDB = function () {
        // Return a fresh clone of _state.  Also mirror into window.DB so that
        // code reading window.DB directly (rather than via loadDB()) stays consistent.
        var snapshot = _deepClone(_state);
        window.DB = snapshot;   // keep window.DB == lexical DB after every loadDB() call
        return snapshot;
      };
      window.saveDB = function () {
        // CRITICAL: legacy code mutates the *lexical* `DB` global (declared with
        // `let DB` in the inline script).  That variable lives in the browser's
        // global lexical environment and is NOT the same storage slot as window.DB.
        //
        // We cannot read the lexical DB from inside state-manager.js.  Instead we
        // rely on callers passing it explicitly:
        //   saveDB()      ← old call-site — we read window.DB as a best-effort fallback.
        //   AppStore.syncFromLegacy(DB) ← preferred; call-sites that know the current DB.
        //
        // The inline-script boot block immediately calls `AppStore.syncFromLegacy(DB)`
        // after any migration that calls saveDB(), so _state stays correct.
        AppStore.syncFromLegacy(window.DB);
      };

      // ── Safety flush before tab close ───────────────────────────────────
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') _flushNow();
      });
      window.addEventListener('pagehide', _flushNow);

      // ── Online/offline status surfaced for the "No Downtime" banner ─────
      // See migration-strategy.md "No Downtime" — a small UI indicator can
      // subscribe to these via AppStore.subscribe and read DBService.diagnostics().
      window.addEventListener('online',  function () { _notify({ type: 'connectivity:online',  payload: null }); });
      window.addEventListener('offline', function () { _notify({ type: 'connectivity:offline', payload: null }); });

      console.log('[AppStore] Initialised. State keys:', Object.keys(_state).join(', '));
    } catch (e) {
      // THIS is the line that used to fail invisibly. If you see this in
      // your console, the message + stack below is the real root cause —
      // not the generic "Cannot read properties of undefined (reading
      // 'then')" you'd see downstream in index.html without this guard.
      console.error('[AppStore] init: a setup step after DBService.read() threw. AppStore.ready will still resolve, but bridge/shims may be incomplete:', e);
    }

    if (_readyResolve) _readyResolve();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * THE sole mutation gate. Pass a function that receives a draft clone;
   * mutate the draft freely. If it throws, _state is never touched.
   *
   * @param {function} mutationFn  (draft) => void
   * @param {object}  [event]      Optional pub/sub event { type, payload }
   */
  function updateState(mutationFn, event) {
    if (typeof mutationFn !== 'function') {
      console.error('[AppStore] updateState: mutationFn must be a function.');
      return;
    }
    // 1. Deep-clone into a sandbox draft
    const draft = _deepClone(_state);
    // 2. Let the caller mutate the draft (abort-on-error atomicity)
    mutationFn(draft);
    // 2b. [Phase 5B] Diff tracked slices BEFORE committing, while _state is
    // still "old" — see _trackDirty()'s own comment above.
    _trackDirty(_state, draft);
    // 3. Commit
    _state = draft;
    // 4. Refresh legacy window.DB bridge
    window.DB = _deepClone(_state);
    // 5. Schedule debounced persist [OPT-1]
    _persist();
    // 6. Notify subscribers synchronously (UI is always current)
    _notify(event || { type: 'state:updated', payload: null });
  }

  /**
   * Sync a db object into _state (legacy bridge).
   *
   * IMPORTANT: pass the actual `DB` variable explicitly.
   * In browsers, `let DB` (declared in the inline script) lives in the global
   * lexical environment — it is NOT the same storage location as `window.DB`.
   * syncFromLegacy(DB) therefore accepts the db object as a parameter so
   * callers can hand us the lexical DB directly instead of window.DB.
   *
   * Falls back to window.DB if no argument supplied (kept for backward compat).
   *
   * @param {object|string} [dbOrEventType]  The current DB object, OR (legacy) an event-type string.
   * @param {string}        [eventType]      Optional pub/sub event type string.
   */
  function syncFromLegacy(dbOrEventType, eventType) {
    var db, evtType;

    if (dbOrEventType && typeof dbOrEventType === 'object') {
      // Called as syncFromLegacy(DB) or syncFromLegacy(DB, 'event:type')
      db      = dbOrEventType;
      evtType = eventType;
    } else {
      // Called as syncFromLegacy('event:type') or syncFromLegacy() — legacy form
      evtType = dbOrEventType;
      db = window.DB;   // last-resort fallback
    }

    if (!db || typeof db !== 'object') return;

    // BUGFIX (classSections wipe on refresh): this used to be a wholesale
    // `_state = _deepClone(db)` replacement. `db` here is always the ~27-
    // table LEGACY blob (students, quizzes, bossEvents, etc.) coming from
    // db-service.js. Some slices of _state — currently just `classSections`
    // (see sections_index.js, "class_sections has no legacy shape") — are
    // AppStore-only and deliberately never written into that legacy blob.
    // A full replacement therefore silently deleted those slices every time
    // ANY legacy sync ran (state:remote-sync, state:auth-change-sync,
    // saveDB(), realtime refreshes, "load more" pulls — every call site
    // that hands us a legacy blob), not just once at boot.
    //
    // Fix: start from a clone of the incoming legacy blob (so every legacy
    // key is still fully replaced/refreshed, which is correct — legacy data
    // SHOULD reflect exactly what the server just sent), then carry forward
    // any key that currently exists on _state but has no counterpart in
    // `db` at all. This is intentionally generic (keyed off "not present in
    // db", not a hardcoded "classSections" check) so any future AppStore-
    // only slice is protected the same way without another bug hunt.
    //
    // Note on account switching (state:auth-change-sync, fired from
    // DBService.refreshAfterAuthChange()): this path also goes through
    // here, so in principle a previous account's classSections could be
    // carried forward for a moment. In practice this is harmless — doLogin()
    // (auth.js) calls refreshAfterAuthChange() and then immediately, still
    // awaited before bootApp() ever renders, calls window.refreshSectionData()
    // again, which fully overwrites classSections with the new account's
    // real data. Nothing user-visible ever sees the stale value. Logout
    // (doLogout()) doesn't go through syncFromLegacy at all — it uses
    // DBService.remove() — so it's unaffected either way. Please don't
    // "fix" this back to a wipe without re-reading this comment.
    var merged = _deepClone(db);
    if (_state && typeof _state === 'object') {
      Object.keys(_state).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(db, key)) {
          merged[key] = _deepClone(_state[key]);
        }
      });
    }

    // Dev-time regression guard: if we ever had a non-empty classSections
    // and it's about to go missing from the merged result, something above
    // regressed (e.g. someone reintroduced a full-replacement path). Loud
    // in the console, no perf cost, no behavior change.
    if (_state && Array.isArray(_state.classSections) && _state.classSections.length &&
        !Object.prototype.hasOwnProperty.call(merged, 'classSections')) {
      console.error('[AppStore] syncFromLegacy: classSections would be wiped by this sync — regression in the AppStore-only-slice preservation logic. Investigate before this ships.');
    }

    // [Phase 5B] Deliberately NOT calling _trackDirty() here. Every call
    // site of syncFromLegacy() is data arriving FROM Supabase (a pull) or a
    // migration replaying already-persisted data — never a local edit that
    // needs pushing back out. Marking rows dirty on a pull would make the
    // repository layer re-push data the server just sent, which is exactly
    // the echo-loop failure mode this file's own 'inventory/quiz_history
    // 42501 storm' bugfix comment (below) already had to solve once for the
    // whole-table push path — don't reintroduce a version of it here.
    _state = merged;
    // Also mirror into window.DB so that window.DB-reading code stays consistent.
    window.DB = _deepClone(_state);

    // BUGFIX (inventory/quiz_history 42501 storm): 'state:remote-sync' and
    // 'state:auth-change-sync' both mean this DB blob just came FROM
    // Supabase (see db-service.js's own syncFromLegacy call sites — every
    // one of them is a post-pull hydration, never a local mutation).
    // _persist() -> DBService.write() would immediately re-push that same
    // data straight back, which is a pure echo — and once a realtime
    // postgres_changes event lands for ANY watched table, that echo can
    // restart the exact same pull -> sync -> push cycle indefinitely (see
    // mirrorLocalOnly()'s header comment in db-service.js for the full
    // trace). Any other evtType (e.g. the boot-time post-migration sync in
    // index.html, which may have genuinely mutated the DB shape) still
    // needs the real push, so this only special-cases the two remote-
    // sourced event types.
    if (evtType === 'state:remote-sync' || evtType === 'state:auth-change-sync') {
      if (typeof DBService !== 'undefined' && typeof DBService.mirrorLocalOnly === 'function') {
        DBService.mirrorLocalOnly(_state);
      }
    } else {
      _persist();
    }
    _notify({ type: evtType || 'state:legacy-sync', payload: null });
  }

  /**
   * Full state clone. Prefer getSlice() in hot paths.
   * Also refreshes window.DB so direct `DB` references stay consistent.
   * @returns {object} Deep clone of entire state.
   */
  function getState() {
    var snapshot = _deepClone(_state);
    window.DB = snapshot;  // keep window.DB == DB after every getState() call
    return snapshot;
  }

  /**
   * [OPT-2] Targeted read: clone only the sub-tree you need.
   * The selectorFn receives the LIVE _state reference for navigation
   * efficiency; only the returned sub-tree is cloned.
   *
   * @param {function} selectorFn  (state) => subTree
   * @returns {*} Deep clone of the selected sub-tree.
   *
   * @example
   *   const boss = AppStore.getSlice(s => s.bossEvents[2]);
   */
  function getSlice(selectorFn) {
    if (typeof selectorFn !== 'function') return _deepClone(_state);
    const subTree = selectorFn(_state);
    return _deepClone(subTree);
  }

  /**
   * [OPT-2] Clone of a single student record.
   * @param {string} studentId
   * @returns {object|null}
   */
  function getStudent(studentId) {
    if (!_state || !Array.isArray(_state.students)) return null;
    const s = _state.students.find(function (st) { return st.id === studentId; });
    return s ? _deepClone(s) : null;
  }

  /**
   * [OPT-2] Clone of a single boss event — ~2 KB vs ~200 KB for full DB.
   * @param {number} idx
   * @returns {object|null}
   */
  function getBossEvent(idx) {
    if (!_state || !Array.isArray(_state.bossEvents)) return null;
    const b = _state.bossEvents[idx];
    return b !== undefined ? _deepClone(b) : null;
  }

  /**
   * Register a Pub/Sub subscriber.
   * @param {string}   key  Unique subscriber key (used to deregister).
   * @param {function} fn   (state, event) => void
   */
  function subscribe(key, fn) {
    if (typeof fn !== 'function') {
      console.error('[AppStore] subscribe: fn must be a function for key "' + key + '".');
      return;
    }
    _subscribers[key] = fn;
  }

  /**
   * Remove a subscriber by key.
   * @param {string} key
   */
  function unsubscribe(key) {
    delete _subscribers[key];
  }

  /**
   * Force an immediate persist (bypasses debounce timer).
   * Called by safety-flush handlers on tab close.
   */
  function flushNow() {
    _flushNow();
  }

  /**
   * [Phase 5B] Ids (using that table's configured idField) dirtied by
   * updateState() since the last clearDirty() for this table, for a table
   * listed in _DELTA_TRACKED_SLICES. Returns a plain array copy (never the
   * live Set) so a caller can't mutate tracking state directly. Returns []
   * for an untracked table name — same "nothing dirty" shape as a tracked
   * table with no pending changes, so db-service.js's repository layer
   * doesn't need a separate "is this table even tracked" branch.
   *
   * @param {string} table  Postgres table name (matches
   *   _TABLE_SYNC_CONFIGS[].table in db-service.js).
   * @returns {Array}
   */
  function getDirtyIds(table) {
    if (!_dirty[table]) return [];
    return Array.from(_dirty[table]);
  }

  /**
   * [Phase 5B] Called by db-service.js's repository layer after a table's
   * rows have been confirmed written to Supabase (no error) — removes
   * exactly those ids from the dirty set. Deliberately NOT called on a
   * failed push: leaving the ids dirty is what makes a failed sync retry
   * automatically next cycle, the same resiliency contract _pushTable()
   * already provides for the whole-table push path.
   *
   * @param {string} table
   * @param {Array}  ids
   */
  function clearDirty(table, ids) {
    if (!_dirty[table] || !Array.isArray(ids)) return;
    ids.forEach(function (id) { _dirty[table].delete(id); });
    // [Phase 5B bugfix] Persist immediately rather than waiting for the next
    // unrelated _flushNow() — see _persistDirtySnapshot()'s own comment for
    // why this matters even though clearDirty() runs outside updateState().
    _persistDirtySnapshot();
  }

  // ─── Auto-init at parse time ──────────────────────────────────────────────
  // [CHANGED v2→v3] init() is now async (it awaits DBService.initRemote()).
  // We still call it eagerly at parse time — nothing about WHEN it starts
  // changes — but callers that need state to be ready (i.e. the inline boot
  // script in index.html) must await AppStore.ready instead of assuming
  // synchronous availability the instant this IIFE finishes running.
  const _readyPromise = new Promise(function (resolve) { _readyResolve = resolve; });
  init();

  // ─── Expose Public Interface ──────────────────────────────────────────────
  /**
   * Broadcast a pub/sub event with NO state change — skips the clone/
   * mutate/commit/window.DB-refresh/debounced-persist steps updateState()
   * always runs (see that function's own comment: those happen
   * unconditionally, even for a no-op draft, at real cost — a full state
   * clone is ~200KB per [OPT-2]'s comment above). For events that
   * genuinely don't correspond to any data mutation — bootApp() is the
   * motivating case: a UI/navigation orchestration function, called on
   * every single login and page refresh, that never touches DB.* itself —
   * use this instead of updateState(() => {}, event), which would silently
   * turn "nothing changed" into a real clone + a real debounced write to
   * localStorage/Supabase, on the single highest-frequency call in the app.
   *
   * @param {object} event  { type, payload } — required (unlike
   *   updateState()'s event param, there's no state-mutation reason to call
   *   this without one).
   */
  function emit(event) {
    if (!event || typeof event.type !== 'string') {
      console.error('[AppStore] emit: event must be an object with a string .type.');
      return;
    }
    _notify(event);
  }

  return {
    ready:          _readyPromise,   // [NEW] await this before first loadDB()/saveDB() call
    updateState:    updateState,
    syncFromLegacy: syncFromLegacy,
    getState:       getState,
    getSlice:       getSlice,
    getStudent:     getStudent,
    getBossEvent:   getBossEvent,
    subscribe:      subscribe,
    unsubscribe:    unsubscribe,
    flushNow:       flushNow,
    emit:           emit,
    getDirtyIds:    getDirtyIds,   // [Phase 5B] delta sync — see _DELTA_TRACKED_SLICES above
    clearDirty:     clearDirty,    // [Phase 5B]

    // Test-only seam (Phase 5B, mirrors db-service.js's own `_test.
    // tableSyncConfigs` seam). Not used by any runtime call site. Exists so
    // a CI test can assert AppStore's _DELTA_TRACKED_SLICES and
    // db-service.js's _TABLE_SYNC_CONFIGS' `deltaTracked` entries never
    // drift out of sync with each other — closes the "nothing enforces
    // this" gap every Phase 5B log entry has flagged since point_log.
    _test: {
      deltaTrackedSlices: _DELTA_TRACKED_SLICES,
    },
  };

}());
