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

window.AppStore = (function () {
  'use strict';

  // ─── Private State ────────────────────────────────────────────────────────
  let _state = null;                // The single source of truth
  let _subscribers = {};            // { key: fn(state, event) }
  let _persistTimer = null;         // [OPT-1] debounce handle
  let _persistDirty = false;        // true when an unpersisted mutation exists
  let _readyResolve = null;         // resolves AppStore.ready once init() completes

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

    _state = _deepClone(db);
    // Also mirror into window.DB so that window.DB-reading code stays consistent.
    window.DB = _deepClone(_state);
    _persist();
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

  // ─── Auto-init at parse time ──────────────────────────────────────────────
  // [CHANGED v2→v3] init() is now async (it awaits DBService.initRemote()).
  // We still call it eagerly at parse time — nothing about WHEN it starts
  // changes — but callers that need state to be ready (i.e. the inline boot
  // script in index.html) must await AppStore.ready instead of assuming
  // synchronous availability the instant this IIFE finishes running.
  const _readyPromise = new Promise(function (resolve) { _readyResolve = resolve; });
  init();

  // ─── Expose Public Interface ──────────────────────────────────────────────
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
  };

}());
