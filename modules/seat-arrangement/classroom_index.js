// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/seat-arrangement/classroom_index.js
//  Phase 2: Load-order guard + AppStore bootstrap for classroom/seating data.
//
//  RESPONSIBILITY:
//    1. Verify that ClassroomService and renderClassroomBuilder/renderStudentSeating
//       were registered successfully by the preceding <script> tags.
//    2. Expose the top-level page-render entry points that nav.js/navTo() calls:
//         window.renderClassroomBuilder() — admin layout builder
//         window.renderStudentSeating()   — student read-only seat map
//         window.unmountClassroomBuilder()— teardown on page leave
//    3. Bootstrap AppStore with classroom_layouts / seats / seat_assignments
//       from Supabase as soon as AppStore.ready resolves — so the first
//       navTo('a-classroom') / navTo('s-classroom') finds data already in state.
//
//  LOAD ORDER (enforced by <script src> sequence in index.html):
//    1. modules/core/state-manager.js       (AppStore)
//    2. db-service.js                       (DBService, Supabase client)
//    3. modules/seat-arrangement/classroom-service.js   (ClassroomService)
//    4. modules/seat-arrangement/classroom_builder.js   (renderClassroomBuilder, etc.)
//    5. THIS FILE                           (bootstrap + guard)
//
//  REALTIME:
//    classroom_layouts, seats, and seat_assignments are wired into
//    DBService's Supabase Realtime channel below (_setupClassroomRealtime).
//    Any INSERT/UPDATE/DELETE on those three tables from another device/tab
//    will call AppStore.updateState() within ~400ms, re-rendering the canvas
//    without a page reload.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  'use strict';

  // ── 1. Load-order verification ────────────────────────────────────────────

  const REQUIRED_FUNCTIONS = [
    ['ClassroomService',           typeof window.ClassroomService === 'object'],
    ['renderClassroomBuilder',     typeof window.renderClassroomBuilder === 'function'],
    ['renderStudentSeating',       typeof window.renderStudentSeating === 'function'],
    ['unmountClassroomBuilder',    typeof window.unmountClassroomBuilder === 'function'],
  ];

  const failed = REQUIRED_FUNCTIONS.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    console.error('[EduQuest] classroom_index.js — MISSING exports:', failed,
      '— Check that classroom-service.js and classroom_builder.js loaded first.');
  } else {
    console.log('[EduQuest] classroom_index.js — All exports verified ✅');
  }

  window.__CLASSROOM_MODULE_VERSION__ = '2.0.0';

  // ── 2. Supabase data bootstrap ────────────────────────────────────────────
  //
  // Called once after AppStore.ready resolves (bottom of index.html). Fetches
  // the three classroom tables and merges them into AppStore so every page
  // render that follows finds pre-populated state.
  //
  // We do NOT add these tables to DBService._pullCacheFromSupabase() because:
  //   a) That function populates the legacy DB blob, and classroom data has no
  //      legacy shape — it lives exclusively in the new AppStore slices.
  //   b) The three tables are small (one layout per class, O(30) seats, O(30)
  //      assignments) — parallel fetching outside the big pull is fine.

  // ── STALE-RESPONSE GUARD ───────────────────────────────────────────────────
  // _bootstrapClassroomData() is called from multiple, uncoordinated places:
  // once pre-login (AppStore.ready), again on every Builder/Monitor mount,
  // again on every Realtime event. These calls are NOT sequenced relative to
  // each other — they're independent network round-trips that can resolve in
  // any order. Without a guard, whichever HTTP response lands LAST wins,
  // regardless of which request was actually more recent/authoritative.
  //
  // Concretely, this is what was causing "my layout disappeared": the
  // pre-login call (no session yet, RLS correctly returns zero rows) and a
  // later, post-login mount-time call (real session, returns real rows) were
  // both in flight together. When the OLD pre-login response happened to
  // land AFTER the new authenticated one, it overwrote AppStore's
  // classroomLayouts/seats/seatAssignments back to [] — and the Builder's
  // _cbLoadState() then read "my selected layout isn't in this array" as
  // "it was deleted" and wiped the canvas. The data was never actually lost
  // server-side; a stale empty response just clobbered a fresh correct one
  // client-side. (Live Monitor was never actually immune to this same race —
  // it just wasn't usually the first classroom page opened after login, so
  // by the time it was visited the stale pre-login request had already
  // resolved and couldn't interfere anymore.)
  //
  // Fix: tag every call with a monotonically increasing sequence number at
  // the moment it STARTS (synchronous, so call order == sequence order).
  // After the network round-trip, only apply the result to AppStore if no
  // newer call has started in the meantime. A stale response is discarded
  // instead of applied — it can never again clobber fresher data.
  let _bootstrapSeq = 0;

  async function _bootstrapClassroomData() {
    const mySeq = ++_bootstrapSeq;

    const client = (typeof DBService !== 'undefined' && typeof DBService.getAuthClient === 'function')
      ? DBService.getAuthClient()
      : (window.supabase || null);

    if (!client) {
      // Offline / localStorage-only mode: no classroom data to load.
      console.info('[ClassroomIndex] No Supabase client — classroom data not fetched (offline mode).');
      return;
    }

    try {
      const [layoutsRes, seatsRes, assignmentsRes] = await Promise.all([
        client.from('classroom_layouts').select('*').order('created_at', { ascending: true }),
        client.from('seats').select('*'),
        client.from('seat_assignments').select('*'),
      ]);

      if (layoutsRes.error)     throw layoutsRes.error;
      if (seatsRes.error)       throw seatsRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      // A newer call started while we were waiting on the network — our
      // result is stale (possibly a pre-login, zero-row response landing
      // late). Discard it rather than clobber whatever the newer call
      // already wrote (or is about to write) into AppStore.
      if (mySeq !== _bootstrapSeq) {
        console.info('[ClassroomIndex] Discarding stale classroom fetch (superseded by a newer request).');
        return;
      }

      const layouts = (layoutsRes.data || []).map(row => ({
        id:            row.id,
        classId:       row.class_id,
        name:          row.name,
        roomData:      row.room_data || [],
        shape:         row.shape || 'custom',
        walkwayPreset: row.walkway_preset || 'traditional',
        createdAt:     row.created_at,
        updatedAt:     row.updated_at,
      }));

      const seats = (seatsRes.data || []).map(row => ({
        id:        row.id,
        layoutId:  row.layout_id,
        xCoord:    row.x_coord,
        yCoord:    row.y_coord,
        rotation:  row.rotation || 0,
        label:     row.label || null,
        isLocked:  !!row.is_locked,
      }));

      const seatAssignments = (assignmentsRes.data || []).map(row => ({
        id:          row.id,
        seatId:      row.seat_id,
        layoutId:    row.layout_id,
        studentId:   row.student_id,
        assignedAt:  row.assigned_at,
        assignedBy:  row.assigned_by || null,
      }));

      AppStore.updateState(draft => {
        draft.classroomLayouts  = layouts;
        draft.seats             = seats;
        draft.seatAssignments   = seatAssignments;
      }, { type: 'classroom:bootstrapped', payload: { layouts: layouts.length, seats: seats.length } });

      console.log(`[ClassroomIndex] Bootstrapped — ${layouts.length} layouts, ${seats.length} seats, ${seatAssignments.length} assignments.`);

    } catch (err) {
      console.warn('[ClassroomIndex] Bootstrap fetch failed (non-fatal):', err.message || err);
    }
  }

  // Exposed publicly so page-mount code (renderClassroomBuilder,
  // renderStudentSeating, renderClassroomMonitor) can trigger a fresh fetch
  // on every visit — see the "PRE-LOGIN BOOTSTRAP RACE" note above
  // _bootstrapClassroomData for why this matters.
  window.refreshClassroomData = _bootstrapClassroomData;

  // ── 3. Realtime subscriptions for classroom tables ─────────────────────────
  //
  // Mirrors the pattern in db-service.js: any change to a classroom table on
  // ANY device triggers a lightweight re-fetch of just the three classroom
  // tables (not a full DB pull), then updates AppStore. The builder's
  // AppStore subscriber fires instantly, repainting seats/assignments.

  let _classroomRealtimeChannel = null;
  let _realtimeRefreshTimer     = null;

  function _scheduleClassroomRefresh() {
    if (_realtimeRefreshTimer) clearTimeout(_realtimeRefreshTimer);
    _realtimeRefreshTimer = setTimeout(_bootstrapClassroomData, 400);
  }

  function _setupClassroomRealtime() {
    const client = (typeof DBService !== 'undefined' && typeof DBService.getAuthClient === 'function')
      ? DBService.getAuthClient()
      : null;
    // getAuthClient() returns null when Supabase is not configured (offline mode).
    if (!client || typeof client.channel !== 'function') {
      console.info('[ClassroomIndex] Realtime not available — skipping channel setup.');
      return;
    }

    _classroomRealtimeChannel = client
      .channel('eduquest-classroom-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_layouts' }, _scheduleClassroomRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seats' },             _scheduleClassroomRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_assignments' },  _scheduleClassroomRefresh)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          console.log('[ClassroomIndex] Realtime channel subscribed ✅');
        }
      });
  }

  // ── 4. Wire into AppStore.ready ───────────────────────────────────────────
  //
  // AppStore.ready is the Promise resolved by state-manager.js after
  // DBService.initRemote() completes. We chain off it so classroom data is
  // fetched and in-state before any nav item renders the builder.

  if (window.AppStore && typeof AppStore.ready !== 'undefined') {
    AppStore.ready.then(function () {
      _bootstrapClassroomData()
        .then(_setupClassroomRealtime)
        .catch(function (err) {
          console.warn('[ClassroomIndex] Startup error (non-fatal):', err && err.message || err);
        });
    });
  } else {
    // Fallback: AppStore not yet available — try after DOMContentLoaded.
    document.addEventListener('DOMContentLoaded', function () {
      if (window.AppStore && AppStore.ready) {
        AppStore.ready.then(function () {
          _bootstrapClassroomData()
            .then(_setupClassroomRealtime)
            .catch(function (err) {
              console.warn('[ClassroomIndex] Startup error (non-fatal):', err && err.message || err);
            });
        });
      }
    });
  }

  // ── 5. Expose teardown for the realtime channel ───────────────────────────
  //
  // Called if the classroom module ever needs to be hot-unloaded (future use).

  window._classroomIndexTeardown = function () {
    if (_classroomRealtimeChannel) {
      _classroomRealtimeChannel.unsubscribe();
      _classroomRealtimeChannel = null;
    }
    if (_realtimeRefreshTimer) {
      clearTimeout(_realtimeRefreshTimer);
      _realtimeRefreshTimer = null;
    }
  };

}());

console.log('[EduQuest] classroom_index.js loaded — Phase 2 classroom bootstrap registered.');
