// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/ownership-service.js
//  Service layer for Chunk D: Ownership & Lifecycle.
//  (ISOLATION_ROLES_PLAN.md Chunk D — see supabase/phase42_ownership_lifecycle.sql.)
//
//  TWO SEPARATE ACTIONS, TWO SEPARATE ENTRY POINTS
//    - Standalone, single-section reassignment ("who covers this section
//      now") lives in SectionService.reassignAdviser() — it's a sections
//      concern, triggered from Section Maker, and doesn't touch content.
//    - Full offboarding — transferOwnership() below — is the bulk,
//      cross-cutting action: every section AND every piece of content a
//      departing teacher owns, moved to one destination teacher in a
//      single call. Triggered from the Teacher Directory (teacher-directory.js),
//      NOT from Section Maker.
//  Don't merge these — see phase42's header for why they're kept apart.
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module:
//  the render layer (teacher-directory.js) never calls DBService.rpc()
//  directly for this. It calls OwnershipService.transferOwnership(...).
//
//  Deliberately does NOT touch AppStore's classSections slice directly —
//  it calls window.refreshSectionData() (sections_index.js) after a
//  successful transfer instead, the same "just re-fetch" approach every
//  other cross-cutting admin action in this app uses, rather than trying
//  to hand-patch a potentially-large, server-computed set of section
//  changes into the draft here.
// ═══════════════════════════════════════════════════════════════════════════════

window.OwnershipService = (function () {
  'use strict';

  /**
   * transferOwnership({ fromTeacherId, toTeacherId, archiveSectionIds? })
   *   → Promise<{ok, summary?, error?}>
   * summary (on success) mirrors transfer_teacher_ownership()'s returned
   * jsonb exactly: { fromTeacherId, toTeacherId, sectionsReassigned,
   * sectionsArchived, achievements, titles, quizzes, campaignWorlds,
   * shopProducts, bossLibrary }.
   */
  async function transferOwnership({ fromTeacherId, toTeacherId, archiveSectionIds = [] }) {
    if (!fromTeacherId) return { ok: false, error: 'Missing departing teacher id.' };
    if (!toTeacherId) return { ok: false, error: 'Choose a destination teacher.' };
    if (fromTeacherId === toTeacherId) return { ok: false, error: 'Destination must be a different teacher.' };

    const { data, error } = await DBService.rpc('transfer_teacher_ownership', {
      p_from_teacher_id: fromTeacherId,
      p_to_teacher_id: toTeacherId,
      p_archive_section_ids: archiveSectionIds || [],
    });
    if (error) return { ok: false, error: error.message || 'Could not transfer ownership.' };

    const summary = {
      fromTeacherId: data.fromTeacherId,
      toTeacherId: data.toTeacherId,
      sectionsReassigned: data.sectionsReassigned || 0,
      sectionsArchived: data.sectionsArchived || 0,
      achievements: data.achievements || 0,
      titles: data.titles || 0,
      quizzes: data.quizzes || 0,
      campaignWorlds: data.campaignWorlds || 0,
      shopProducts: data.shopProducts || 0,
      bossLibrary: data.bossLibrary || 0,
    };

    // Sections changed server-side (adviser reassigned or archived) — pull
    // the fresh set so Section Maker and every getActiveClassIds()/
    // getClassLabel() consumer reflect it without waiting on realtime.
    if (typeof window.refreshSectionData === 'function') {
      window.refreshSectionData().catch(function (e) {
        console.warn('[OwnershipService] post-transfer section refresh failed:', e);
      });
    }

    return { ok: true, summary };
  }

  return { transferOwnership };
})();
