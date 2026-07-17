// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/sections-service.js
//  Service Layer for Phase 4 Section Maker.
//
//  REPOSITORY PATTERN CONTRACT — same rule as AttendanceService
//  (see modules/attendance/attendance-service.js header):
//    UI modules (sections.js, registrations.js, the kiosk/Live Monitor/
//    seating-builder class selectors) NEVER call Supabase and NEVER mutate
//    AppStore state directly for anything in this file's domain. They call
//    SectionService.<method>(...). SectionService is the ONLY thing that:
//      a) calls DBService.rpc() for class_sections writes, and
//      b) calls AppStore.updateState() to reflect those writes into the
//         single source of truth.
//
//  STATE SHAPE (slice populated by sections_index.js → AppStore):
//    draft.classSections  [{ id, gradeLevel, sectionName, adviserId, archived,
//                             createdAt, updatedAt }]
//
//  See Section_Maker_Feature_Spec.md §2–§5 for the design this implements.
// ═══════════════════════════════════════════════════════════════════════════════

window.SectionService = (function () {
  'use strict';

  function _rowFromRpcResult(data) {
    return {
      id: data.id,
      gradeLevel: data.grade_level,
      sectionName: data.section_name,
      adviserId: data.adviser_id || null,
      archived: !!data.archived,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  function _upsertIntoDraft(draft, row) {
    if (!Array.isArray(draft.classSections)) draft.classSections = [];
    const idx = draft.classSections.findIndex(s => s.id === row.id);
    if (idx >= 0) draft.classSections[idx] = row;
    else draft.classSections.push(row);
  }

  /**
   * createSection(gradeLevel, sectionName, opts) → Promise<{ok, error?, section?}>
   * opts: { adviserId?, schedule?, dayOverrides? }
   * opts.schedule (optional; BUGFIX report §3): { openTime, startTime,
   * lateCutoff, closeTime } — 'HH:MM' or 'HH:MM:SS' strings. When provided,
   * create_class_section() creates the DEFAULT (dayOfWeek 0) attendance_schedules
   * row in the same transaction, so the section can take attendance the
   * moment it's created instead of needing a second trip to the kiosk's
   * settings screen. Omit it to create a schedule-less section exactly as
   * before (still editable later via AttendanceService.upsertSchedule()).
   * opts.dayOverrides (Phase 54, optional): [{ dayOfWeek, openTime,
   * startTime, lateCutoff, closeTime, dayOff? }, ...] — per-weekday
   * exceptions to the default above (e.g. a shorter Friday). dayOff: true
   * (Phase 55) marks that weekday as having no class at all instead of
   * custom times — openTime/startTime/lateCutoff/closeTime are still
   * required (sent as '00:00' placeholders) but are ignored server-side
   * once dayOff is set. Only meaningful alongside opts.schedule, since a
   * section needs a section id before any override row can reference it:
   * each is applied as its own upsert_attendance_schedule call right after
   * create_class_section() returns, sequentially so a failure partway
   * through still leaves earlier days saved.
   */
  async function createSection(gradeLevel, sectionName, opts) {
    opts = opts || {};
    const grade = String(gradeLevel || '').trim();
    const name = String(sectionName || '').trim();
    if (!grade) return { ok: false, error: 'Grade level is required.' };
    if (!name) return { ok: false, error: 'Section name is required.' };

    const sched = opts.schedule || {};
    const hasSchedule = !!(sched.openTime && sched.startTime && sched.lateCutoff && sched.closeTime);
    const dayOverrides = hasSchedule ? (opts.dayOverrides || []) : []; // no default = no overrides to hang off it

    const rpcParams = {
      p_grade_level: grade, p_section_name: name, p_adviser_id: opts.adviserId || null,
    };
    if (hasSchedule) {
      rpcParams.p_open_time = sched.openTime;
      rpcParams.p_start_time = sched.startTime;
      rpcParams.p_late_cutoff = sched.lateCutoff;
      rpcParams.p_close_time = sched.closeTime;
    }

    const { data, error } = await DBService.rpc('create_class_section', rpcParams);
    if (error) {
      console.error('[SectionService] createSection failed:', error);
      return { ok: false, error: error.message || 'Could not create section.' };
    }

    const row = _rowFromRpcResult(data);

    // Day overrides need the section id create_class_section() just
    // returned, so they're applied as follow-up calls to the same RPC
    // Section Maker's edit modal uses (upsert_attendance_schedule) —
    // sequential, not parallel, so a mid-week failure doesn't race with
    // its neighbors and is easy to reason about in the returned errors list.
    const dayOverrideErrors = [];
    for (const ov of dayOverrides) {
      const { error: ovError } = await DBService.rpc('upsert_attendance_schedule', {
        p_class_id: row.id, p_open_time: ov.openTime, p_start_time: ov.startTime,
        p_late_cutoff: ov.lateCutoff, p_close_time: ov.closeTime, p_day_of_week: ov.dayOfWeek,
        p_day_off: !!ov.dayOff,
      });
      if (ovError) {
        console.error('[SectionService] createSection day-override failed:', ov.dayOfWeek, ovError);
        dayOverrideErrors.push(ov.dayOfWeek);
      }
    }

    AppStore.updateState(draft => {
      _upsertIntoDraft(draft, row);
      // The RPC also wrote the default attendance_schedules row server-side
      // when a schedule was supplied — mirror it into the draft so the
      // kiosk/Live Monitor don't need a realtime round-trip to see the new
      // section is usable.
      if (!Array.isArray(draft.attendanceSchedules)) draft.attendanceSchedules = [];
      if (hasSchedule) {
        const idx = draft.attendanceSchedules.findIndex(s => s.classId === row.id && (s.dayOfWeek || 0) === 0);
        const schedRow = {
          id: null, classId: row.id, dayOfWeek: 0, openTime: sched.openTime, startTime: sched.startTime,
          lateCutoff: sched.lateCutoff, closeTime: sched.closeTime, active: true,
        };
        if (idx >= 0) draft.attendanceSchedules[idx] = schedRow;
        else draft.attendanceSchedules.push(schedRow);
      }
      // Mirror whichever day overrides actually succeeded above.
      dayOverrides
        .filter(ov => !dayOverrideErrors.includes(ov.dayOfWeek))
        .forEach(ov => {
          const idx = draft.attendanceSchedules.findIndex(s => s.classId === row.id && (s.dayOfWeek || 0) === ov.dayOfWeek);
          const schedRow = {
            id: null, classId: row.id, dayOfWeek: ov.dayOfWeek, dayOff: !!ov.dayOff, openTime: ov.openTime, startTime: ov.startTime,
            lateCutoff: ov.lateCutoff, closeTime: ov.closeTime, active: true,
          };
          if (idx >= 0) draft.attendanceSchedules[idx] = schedRow;
          else draft.attendanceSchedules.push(schedRow);
        });
    }, { type: 'sections:created', payload: { sectionId: row.id, scheduled: hasSchedule, dayOverrideCount: dayOverrides.length - dayOverrideErrors.length } });

    if (dayOverrideErrors.length) {
      return {
        ok: true, section: row,
        error: `Section created, but ${dayOverrideErrors.length} day override${dayOverrideErrors.length === 1 ? '' : 's'} failed to save — edit the section to retry.`,
      };
    }
    return { ok: true, section: row };
  }

  /**
   * updateSection(sectionId, patch) → Promise<{ok, error?, section?}>
   * patch: { gradeLevel?, sectionName?, adviserId?, clearAdviser? }
   * Renaming/re-grading relabels the existing row — id never changes (§5).
   */
  async function updateSection(sectionId, patch) {
    patch = patch || {};
    if (!sectionId) return { ok: false, error: 'sectionId is required.' };

    const { data, error } = await DBService.rpc('update_class_section', {
      p_section_id: sectionId,
      p_grade_level: patch.gradeLevel || null,
      p_section_name: patch.sectionName || null,
      p_adviser_id: patch.adviserId || null,
      p_clear_adviser: !!patch.clearAdviser,
    });
    if (error) {
      console.error('[SectionService] updateSection failed:', error);
      return { ok: false, error: error.message || 'Could not update section.' };
    }

    const row = _rowFromRpcResult(data);
    AppStore.updateState(draft => {
      _upsertIntoDraft(draft, row);
    }, { type: 'sections:updated', payload: { sectionId: row.id } });

    return { ok: true, section: row };
  }

  /**
   * archiveSection(sectionId) → Promise<{ok, error?, section?}>
   * Soft-delete only — a section with students/schedule/seating/attendance
   * history attached is never hard-deleted (§5).
   */
  async function archiveSection(sectionId) {
    if (!sectionId) return { ok: false, error: 'sectionId is required.' };

    const { data, error } = await DBService.rpc('archive_class_section', { p_section_id: sectionId });
    if (error) {
      console.error('[SectionService] archiveSection failed:', error);
      return { ok: false, error: error.message || 'Could not archive section.' };
    }

    const row = _rowFromRpcResult(data);
    AppStore.updateState(draft => {
      _upsertIntoDraft(draft, row);
    }, { type: 'sections:archived', payload: { sectionId: row.id } });

    return { ok: true, section: row };
  }

  /**
   * unarchiveSection(sectionId) → Promise<{ok, error?, section?}>
   */
  async function unarchiveSection(sectionId) {
    if (!sectionId) return { ok: false, error: 'sectionId is required.' };

    const { data, error } = await DBService.rpc('unarchive_class_section', { p_section_id: sectionId });
    if (error) {
      console.error('[SectionService] unarchiveSection failed:', error);
      return { ok: false, error: error.message || 'Could not restore section.' };
    }

    const row = _rowFromRpcResult(data);
    AppStore.updateState(draft => {
      _upsertIntoDraft(draft, row);
    }, { type: 'sections:unarchived', payload: { sectionId: row.id } });

    return { ok: true, section: row };
  }

  /**
   * reassignAdviser(sectionId, newAdviserId, opts) → Promise<{ok, error?, section?}>
   * opts: { clearAdviser? } — mid-year coverage change for ONE section,
   * independent of full offboarding (see ownership-service.js for that).
   * Backed by reassign_section_adviser() (Phase 42) rather than
   * updateSection() above — same authorization, but scoped to just the
   * adviser column and its own audit_log entry, since "who covers this
   * section" is a distinct action from "edit this section's name/grade".
   */
  async function reassignAdviser(sectionId, newAdviserId, opts) {
    opts = opts || {};
    if (!sectionId) return { ok: false, error: 'sectionId is required.' };
    if (!opts.clearAdviser && !newAdviserId) return { ok: false, error: 'Choose a new adviser, or clear the current one.' };

    const { data, error } = await DBService.rpc('reassign_section_adviser', {
      p_section_id: sectionId,
      p_new_adviser_id: opts.clearAdviser ? null : newAdviserId,
      p_clear_adviser: !!opts.clearAdviser,
    });
    if (error) {
      console.error('[SectionService] reassignAdviser failed:', error);
      return { ok: false, error: error.message || 'Could not reassign this section.' };
    }

    const row = _rowFromRpcResult(data);
    AppStore.updateState(draft => {
      _upsertIntoDraft(draft, row);
    }, { type: 'sections:adviser-reassigned', payload: { sectionId: row.id } });

    return { ok: true, section: row };
  }

  /**
   * listSections({ includeArchived }) → Array
   * Synchronous read straight off AppStore — classSections is kept current
   * by sections_index.js's bootstrap + realtime subscription, same pattern
   * as classroomLayouts.
   */
  function listSections(opts) {
    opts = opts || {};
    const all = AppStore.getSlice(s => s.classSections) || [];
    return opts.includeArchived ? all : all.filter(s => !s.archived);
  }

  /**
   * getSection(sectionId) → Object|null
   */
  function getSection(sectionId) {
    const all = AppStore.getSlice(s => s.classSections) || [];
    return all.find(s => s.id === sectionId) || null;
  }

  return {
    createSection,
    updateSection,
    archiveSection,
    unarchiveSection,
    reassignAdviser,
    listSections,
    getSection,
  };
}());

// ═══════════════════════════════════════════════════════════════════════════════
//  Shared class-list helpers — used by every screen that used to derive its
//  class dropdown from `Array.from(new Set(students.map(s => s.classId)))`:
//  the kiosk (att_scanner_rfid.js), Live Monitor (live_monitor.js), and the
//  seating layout builder (classroom_builder.js). See §6 of the spec.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getActiveClassIds(state) → string[]
 * Returns every non-archived class_sections id, sorted by grade then name.
 * Falls back to the old "derive from whichever students happen to exist"
 * behavior ONLY when no sections have been created yet, so a fresh
 * deployment (or one that hasn't run Section Maker yet) never shows an
 * empty dropdown.
 */
window.getActiveClassIds = function (state) {
  state = state || (window.AppStore ? AppStore.getState() : {});
  const sections = (state.classSections || []).filter(s => !s.archived);

  if (sections.length) {
    return sections
      .slice()
      .sort((a, b) => {
        const g = String(a.gradeLevel).localeCompare(String(b.gradeLevel), undefined, { numeric: true });
        if (g !== 0) return g;
        return String(a.sectionName).localeCompare(String(b.sectionName));
      })
      .map(s => s.id);
  }

  // No sections created yet — same derive-from-students fallback every
  // selector used before Section Maker existed.
  return Array.from(new Set((state.students || []).map(s => s.classId || 'default-class'))).sort();
};

/**
 * getClassLabel(classId, state) → string
 * Human-readable label for a classId in dropdowns — "Grade 10 – Rizal" when
 * it resolves to a real section, otherwise the raw classId string (covers
 * pre-Section-Maker ad-hoc classIds and the backfill's unreviewed rows).
 */
window.getClassLabel = function (classId, state) {
  state = state || (window.AppStore ? AppStore.getState() : {});
  const section = (state.classSections || []).find(s => s.id === classId);
  if (section) return 'Grade ' + section.gradeLevel + ' – ' + section.sectionName;
  return classId;
};

/**
 * getMySectionsLabel(state) → string
 * Phase 33 (ISOLATION_ROLES_PLAN.md §12 step 4) — Command Center and
 * Analytics both used to hardcode "Grade 8-A" in their header regardless of
 * which account was logged in. This replaces that with the caller's ACTUAL
 * owned section(s): every non-archived class_sections row whose adviserId
 * is the current user. A section with no adviser yet, or an account that
 * owns none (today's single `role='admin'` account, or the future real
 * `admin` oversight role once the relabel lands), falls back to
 * "All Sections" rather than a misleading single hardcoded grade.
 */
window.getMySectionsLabel = function (state) {
  state = state || (window.AppStore ? AppStore.getState() : {});
  const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  const mine = (state.classSections || [])
    .filter(s => !s.archived && uid && s.adviserId === uid)
    .sort((a, b) => String(a.gradeLevel).localeCompare(String(b.gradeLevel), undefined, { numeric: true })
      || String(a.sectionName).localeCompare(String(b.sectionName)));
  if (!mine.length) return 'All Sections';
  return mine.map(s => 'Grade ' + s.gradeLevel + ' – ' + s.sectionName).join(', ');
};

console.log('[EduQuest] admin/sections-service.js loaded — SectionService registered.');
