// Phase 7, Stream B — equivalence check for modules/admin/sections-service.js.
// Loads the ORIGINAL classic file into one jsdom window, and the BUNDLED
// BRIDGE (dist/bridges/sections-service.bridge.js, built from
// src/modules/admin/sections-service.js) into a separate jsdom window.
// Both windows get an identical fake DBService (an in-memory RPC stub
// with a call log) and an identical fake AppStore (in-memory state +
// updateState/getSlice/getState), then are driven through the same real
// call sequence — happy paths, validation errors, RPC errors, and the
// sequential day-override loop — and every observable result (return
// values, resulting AppStore state, and the DBService call log) is
// diffed. Async: real await, no fake timers.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

// ── Fake DBService.rpc — scripted per-rpc-name responses + a call log ──────
function makeFakeDBService(win) {
  const calls = [];
  win.__dbCalls = calls;
  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params)) });
      // create_class_section: succeeds unless section name is 'FAIL'
      if (name === 'create_class_section') {
        if (params.p_section_name === 'FAIL') return { data: null, error: { message: 'boom: create failed' } };
        return {
          data: {
            id: 'sec-' + (calls.filter(c => c.name === 'create_class_section').length),
            grade_level: params.p_grade_level,
            section_name: params.p_section_name,
            adviser_id: params.p_adviser_id,
            archived: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          error: null,
        };
      }
      if (name === 'upsert_attendance_schedule') {
        // Day 3 always fails, to exercise the partial-failure path.
        if (params.p_day_of_week === 3) return { data: null, error: { message: 'boom: day override failed' } };
        return { data: { ok: true }, error: null };
      }
      if (name === 'update_class_section') {
        if (params.p_section_id === 'missing') return { data: null, error: { message: 'boom: update failed' } };
        return {
          data: {
            id: params.p_section_id,
            grade_level: params.p_grade_level || '10',
            section_name: params.p_section_name || 'Renamed',
            adviser_id: params.p_clear_adviser ? null : (params.p_adviser_id || 'adv-1'),
            archived: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          },
          error: null,
        };
      }
      if (name === 'archive_class_section') {
        return { data: { id: params.p_section_id, grade_level: '10', section_name: 'X', adviser_id: null, archived: true, created_at: 'c', updated_at: 'u' }, error: null };
      }
      if (name === 'unarchive_class_section') {
        return { data: { id: params.p_section_id, grade_level: '10', section_name: 'X', adviser_id: null, archived: false, created_at: 'c', updated_at: 'u' }, error: null };
      }
      if (name === 'reassign_section_adviser') {
        return { data: { id: params.p_section_id, grade_level: '10', section_name: 'X', adviser_id: params.p_new_adviser_id, archived: false, created_at: 'c', updated_at: 'u' }, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };
}

// ── Fake AppStore — in-memory state + updateState/getSlice/getState ────────
function makeFakeAppStore(win, initialState) {
  let state = JSON.parse(JSON.stringify(initialState));
  win.__lastEvent = null;
  win.AppStore = {
    updateState(mutationFn, event) {
      const draft = JSON.parse(JSON.stringify(state));
      mutationFn(draft);
      state = draft;
      win.__lastEvent = event || null;
    },
    getSlice(selectorFn) {
      return selectorFn(JSON.parse(JSON.stringify(state)));
    },
    getState() {
      return JSON.parse(JSON.stringify(state));
    },
  };
  win.__getFakeState = () => JSON.parse(JSON.stringify(state));
}

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  makeFakeDBService(win);
  makeFakeAppStore(win, { classSections: [], attendanceSchedules: [], students: ['stu-a'].map((id, i) => ({ id, classId: i === 0 ? 'legacy-class' : 'default-class' })) });
  return win;
}

async function runSequence(win) {
  const results = {};

  // 1. Validation errors — no RPC call should happen for either.
  results.createMissingGrade = await win.SectionService.createSection('', 'A');
  results.createMissingName = await win.SectionService.createSection('10', '');

  // 2. Plain create, no schedule.
  results.createPlain = await win.SectionService.createSection('10', 'Rizal', { adviserId: 'adv-1' });

  // 3. Create with schedule + day overrides, one of which fails (day 3).
  results.createScheduled = await win.SectionService.createSection('9', 'Bonifacio', {
    schedule: { openTime: '07:00', startTime: '07:30', lateCutoff: '07:45', closeTime: '16:00' },
    dayOverrides: [
      { dayOfWeek: 1, openTime: '07:00', startTime: '07:30', lateCutoff: '07:45', closeTime: '15:00' },
      { dayOfWeek: 3, openTime: '07:00', startTime: '07:30', lateCutoff: '07:45', closeTime: '15:00' },
    ],
  });

  // 4. Create failure (RPC error) — AppStore must be untouched by this call.
  results.createFail = await win.SectionService.createSection('8', 'FAIL');

  // 5. updateSection — happy path and RPC-error path.
  const firstId = results.createPlain.section.id;
  results.updateOk = await win.SectionService.updateSection(firstId, { sectionName: 'Rizal Renamed' });
  results.updateMissingId = await win.SectionService.updateSection(null, {});
  results.updateRpcFail = await win.SectionService.updateSection('missing', {});

  // 6. archive / unarchive.
  results.archiveOk = await win.SectionService.archiveSection(firstId);
  results.archiveMissingId = await win.SectionService.archiveSection(null);
  results.unarchiveOk = await win.SectionService.unarchiveSection(firstId);

  // 7. reassignAdviser — happy, clearAdviser, and validation error.
  results.reassignOk = await win.SectionService.reassignAdviser(firstId, 'adv-2');
  results.reassignClear = await win.SectionService.reassignAdviser(firstId, null, { clearAdviser: true });
  results.reassignMissingTarget = await win.SectionService.reassignAdviser(firstId, null, {});

  // 8. listSections / getSection.
  results.listActive = win.SectionService.listSections();
  results.listAll = win.SectionService.listSections({ includeArchived: true });
  results.getSectionFound = win.SectionService.getSection(firstId);
  results.getSectionMissing = win.SectionService.getSection('nope');

  // 9. getActiveClassIds — with real sections present.
  results.activeClassIdsWithSections = win.getActiveClassIds();

  // 10. getClassLabel — found and not found.
  results.classLabelFound = win.getClassLabel(firstId);
  results.classLabelMissing = win.getClassLabel('nope');

  // 11. getMySectionsLabel — no currentUser defined at all (typeof guard).
  results.mySectionsNoCurrentUser = win.getMySectionsLabel();

  // 12. getMySectionsLabel — currentUser set, matches the adviser on one section.
  win.currentUser = { id: 'adv-2' };
  results.mySectionsWithMatch = win.getMySectionsLabel();

  // 13. getMySectionsLabel — currentUser set, no matching sections.
  win.currentUser = { id: 'nobody' };
  results.mySectionsNoMatch = win.getMySectionsLabel();

  // 14. getActiveClassIds fallback — fresh state with zero sections at all.
  const freshWin = makeWindow();
  freshWin.eval(win.__ORIGINAL_OR_BRIDGE_SRC);
  results.activeClassIdsFallback = freshWin.getActiveClassIds();

  results.finalState = win.__getFakeState();
  results.dbCalls = win.__dbCalls;

  return results;
}

async function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections-service.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'sections-service.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.__ORIGINAL_OR_BRIDGE_SRC = originalSrc;
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.SectionService, 'object', 'original: window.SectionService should exist');
  assert.strictEqual(typeof winOriginal.getActiveClassIds, 'function', 'original: window.getActiveClassIds should exist');
  assert.strictEqual(typeof winOriginal.getClassLabel, 'function', 'original: window.getClassLabel should exist');
  assert.strictEqual(typeof winOriginal.getMySectionsLabel, 'function', 'original: window.getMySectionsLabel should exist');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.__ORIGINAL_OR_BRIDGE_SRC = bridgeSrc;
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.SectionService, 'object', 'bridge: window.SectionService should exist');
  assert.strictEqual(typeof winBridge.getActiveClassIds, 'function', 'bridge: window.getActiveClassIds should exist');
  assert.strictEqual(typeof winBridge.getClassLabel, 'function', 'bridge: window.getClassLabel should exist');
  assert.strictEqual(typeof winBridge.getMySectionsLabel, 'function', 'bridge: window.getMySectionsLabel should exist');
  const resultBridge = await runSequence(winBridge);

  // Compare via JSON.stringify: results cross jsdom vm realms, and
  // deepStrictEqual can spuriously fail on realm-mismatched plain objects.
  assert.strictEqual(
    JSON.stringify(resultBridge),
    JSON.stringify(resultOriginal),
    'bridge output must exactly match original output at every step'
  );

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Both original sections-service.js and the bundled src/modules/admin/sections-service.js');
  console.log('bridge produce identical results across createSection/updateSection/archiveSection/');
  console.log('unarchiveSection/reassignAdviser/listSections/getSection/getActiveClassIds/getClassLabel/');
  console.log('getMySectionsLabel, including validation errors, RPC errors, and the day-override loop.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
