// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/sections_index.js
//  Phase 4: Load-order guard + AppStore bootstrap for class_sections.
//
//  RESPONSIBILITY (mirrors modules/seat-arrangement/classroom_index.js):
//    1. Verify that SectionService and renderSectionMaker were registered
//       successfully by the preceding <script> tags.
//    2. Expose window.renderSectionMaker() / window.unmountSectionMaker()
//       that nav.js/navTo() calls.
//    3. Bootstrap AppStore with class_sections from Supabase as soon as
//       AppStore.ready resolves — so the first navTo('a-sections'), and
//       every screen that reads getActiveClassIds()/getClassLabel(), finds
//       data already in state.
//
//  LOAD ORDER (enforced by <script src> sequence in index.html):
//    1. modules/core/state-manager.js       (AppStore)
//    2. db-service.js                       (DBService, Supabase client)
//    3. modules/admin/sections-service.js   (SectionService, getActiveClassIds)
//    4. modules/admin/sections.js           (renderSectionMaker, etc.)
//    5. THIS FILE                           (bootstrap + guard)
//
//  WHY NOT IN DBService._pullCacheFromSupabase()
//    Same reasoning as classroom_layouts: that function populates the
//    legacy DB blob's pre-existing shape, and class_sections has no legacy
//    shape — it lives exclusively in the new AppStore slice. The table is
//    small (dozens of rows for a whole school), so a parallel fetch outside
//    the big pull is fine.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  'use strict';

  // ── 1. Load-order verification ────────────────────────────────────────────

  const REQUIRED_FUNCTIONS = [
    ['SectionService',        typeof window.SectionService === 'object'],
    ['getActiveClassIds',     typeof window.getActiveClassIds === 'function'],
    ['getClassLabel',         typeof window.getClassLabel === 'function'],
    ['renderSectionMaker',    typeof window.renderSectionMaker === 'function'],
    ['unmountSectionMaker',   typeof window.unmountSectionMaker === 'function'],
  ];

  const failed = REQUIRED_FUNCTIONS.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    console.error('[EduQuest] sections_index.js — MISSING exports:', failed,
      '— Check that sections-service.js and sections.js loaded first.');
  } else {
    console.log('[EduQuest] sections_index.js — All exports verified ✅');
  }

  window.__SECTIONS_MODULE_VERSION__ = '1.0.0';

  // ── 2. Supabase data bootstrap ────────────────────────────────────────────
  //
  // Same STALE-RESPONSE GUARD as classroom_index.js's _bootstrapClassroomData
  // — _bootstrapSectionData() is called from multiple uncoordinated places
  // (pre-login AppStore.ready, every Section Maker mount, every realtime
  // event), so a sequence number discards any response that's been
  // superseded by a newer request before it can apply stale data.
  let _bootstrapSeq = 0;

  async function _bootstrapSectionData() {
    const mySeq = ++_bootstrapSeq;

    const client = (typeof DBService !== 'undefined' && typeof DBService.getAuthClient === 'function')
      ? DBService.getAuthClient()
      : (window.supabase || null);

    if (!client) {
      console.info('[SectionsIndex] No Supabase client — class_sections not fetched (offline mode).');
      return;
    }

    try {
      const res = await client.from('class_sections').select('*').order('grade_level', { ascending: true });
      if (res.error) throw res.error;

      if (mySeq !== _bootstrapSeq) {
        console.info('[SectionsIndex] Discarding stale class_sections fetch (superseded by a newer request).');
        return;
      }

      const sections = (res.data || []).map(row => ({
        id:          row.id,
        gradeLevel:  row.grade_level,
        sectionName: row.section_name,
        adviserId:   row.adviser_id || null,
        archived:    !!row.archived,
        createdAt:   row.created_at,
        updatedAt:   row.updated_at,
      }));

      AppStore.updateState(draft => {
        draft.classSections = sections;
      }, { type: 'sections:bootstrapped', payload: { count: sections.length } });

      console.log(`[SectionsIndex] Bootstrapped — ${sections.length} sections.`);
    } catch (err) {
      console.warn('[SectionsIndex] Bootstrap fetch failed (non-fatal):', err.message || err);
    }
  }

  // Exposed publicly so page-mount code (renderSectionMaker, plus the
  // registration form and every class-selector screen) can trigger a fresh
  // fetch on every visit — same "PRE-LOGIN BOOTSTRAP RACE" reasoning as
  // classroom_index.js's window.refreshClassroomData.
  window.refreshSectionData = _bootstrapSectionData;

  // ── 3. Realtime subscription for class_sections ───────────────────────────

  let _sectionsRealtimeChannel = null;
  let _realtimeRefreshTimer    = null;

  function _scheduleSectionsRefresh() {
    if (_realtimeRefreshTimer) clearTimeout(_realtimeRefreshTimer);
    _realtimeRefreshTimer = setTimeout(_bootstrapSectionData, 400);
  }

  function _setupSectionsRealtime() {
    const client = (typeof DBService !== 'undefined' && typeof DBService.getAuthClient === 'function')
      ? DBService.getAuthClient()
      : null;
    if (!client || typeof client.channel !== 'function') {
      console.info('[SectionsIndex] Realtime not available — skipping channel setup.');
      return;
    }

    _sectionsRealtimeChannel = client
      .channel('eduquest-sections-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'class_sections' }, _scheduleSectionsRefresh)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          console.log('[SectionsIndex] Realtime channel subscribed ✅');
        }
      });
  }

  // ── 4. Wire into AppStore.ready ───────────────────────────────────────────

  if (window.AppStore && typeof AppStore.ready !== 'undefined') {
    AppStore.ready.then(function () {
      _bootstrapSectionData()
        .then(_setupSectionsRealtime)
        .catch(function (err) {
          console.warn('[SectionsIndex] Startup error (non-fatal):', err && err.message || err);
        });
    });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.AppStore && AppStore.ready) {
        AppStore.ready.then(function () {
          _bootstrapSectionData()
            .then(_setupSectionsRealtime)
            .catch(function (err) {
              console.warn('[SectionsIndex] Startup error (non-fatal):', err && err.message || err);
            });
        });
      }
    });
  }

  // ── 5. Expose teardown for the realtime channel ───────────────────────────

  window._sectionsIndexTeardown = function () {
    if (_sectionsRealtimeChannel) {
      _sectionsRealtimeChannel.unsubscribe();
      _sectionsRealtimeChannel = null;
    }
    if (_realtimeRefreshTimer) {
      clearTimeout(_realtimeRefreshTimer);
      _realtimeRefreshTimer = null;
    }
  };

}());

console.log('[EduQuest] sections_index.js loaded — Phase 4 sections bootstrap registered.');
