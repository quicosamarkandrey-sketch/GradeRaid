// Phase 7, Stream B — equivalence check for modules/admin/sections.js.
// SectionService and TeacherDirectoryService are already independently
// equivalence-checked, so the ORIGINAL window evals both real, untouched
// service files first, driven by a shared fake AppStore (backing
// SectionService's classSections/attendanceSchedules operations) and fake
// DBService.rpc (backing TeacherDirectoryService.getDirectory()). A fake
// AttendanceService covers the schedule-sync follow-up calls that
// _secSubmitForm makes directly (outside SectionService, on edit only).
//
// Per the jsdom inline-handler limitation documented in MEMORY.md, the
// main list's search/grade-filter/archived-toggle and the roster modal's
// search box (all raw oninput="<bareIdentifier>=this.value" with no
// wrapper function) are NOT driven via simulated DOM events here — only
// their default-state rendering is verified. Every create/edit/reassign
// form field IS safely settable via plain `.value =` since
// _secSubmitForm/_secSubmitReassign read the DOM directly at submit time.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-sections"></div>
  <div id="modal-root"></div>
</body></html>`;

function makeWindow(opts) {
  opts = opts || {};
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = opts.role || 'admin';
  win._esc = s => String(s == null ? '' : s);
  win._cssColor = c => c || '#888';
  win.toast = function (msg, color) { calls.push({ name: 'toast', msg, color }); };
  win.showModal = function (html, size) {
    calls.push({ name: 'showModal', size });
    win.document.getElementById('modal-root').innerHTML = html;
  };
  win.closeModalForce = function () { calls.push({ name: 'closeModalForce' }); win.document.getElementById('modal-root').innerHTML = ''; };

  let state = {
    classSections: [
      { id: 'sec-a', gradeLevel: '10', sectionName: 'Rizal', adviserId: 'admin1', archived: false, createdAt: 'c1', updatedAt: 'u1' },
      { id: 'sec-b', gradeLevel: '9', sectionName: 'Bonifacio', adviserId: 't2', archived: false, createdAt: 'c2', updatedAt: 'u2' },
      { id: 'sec-c', gradeLevel: '8', sectionName: 'Old Section', adviserId: null, archived: true, createdAt: 'c3', updatedAt: 'u3' },
    ],
    attendanceSchedules: [
      { classId: 'sec-a', dayOfWeek: 0, openTime: '07:00', startTime: '07:30', lateCutoff: '07:45', closeTime: '15:00' },
      { classId: 'sec-a', dayOfWeek: 5, openTime: '07:00', startTime: '07:30', lateCutoff: '07:45', closeTime: '13:00' },
    ],
    students: [
      { id: 's1', name: 'Alice', classId: 'sec-a', level: 5, tier: 'Gold', attendance: 95, color: '#8b5cf6' },
      { id: 's2', name: 'Bob', classId: 'sec-a', level: 3, tier: 'Silver', attendance: 88, color: '#4edea3' },
      { id: 's3', name: 'Carol', classId: 'sec-b', level: 7, tier: 'Platinum', attendance: 99, color: '#ff6b6b' },
    ],
    admin: { id: 'admin1', name: 'Admin One' },
  };
  win.AppStore = {
    subscribe(key, fn) { calls.push({ name: 'AppStore.subscribe', key }); win.__subscribed = fn; },
    unsubscribe(key) { calls.push({ name: 'AppStore.unsubscribe', key }); win.__subscribed = null; },
    getState() { return JSON.parse(JSON.stringify(state)); },
    getSlice(fn) { return fn(JSON.parse(JSON.stringify(state))); },
    updateState(fn, event) {
      const draft = JSON.parse(JSON.stringify(state));
      fn(draft);
      state = draft;
      calls.push({ name: 'AppStore.updateState', event });
    },
  };
  win.__getFakeState = () => JSON.parse(JSON.stringify(state));

  win.refreshSectionData = opts.noRefresh ? undefined : async function () {
    calls.push({ name: 'refreshSectionData' });
    if (opts.refreshFails) throw new Error('refresh boom');
  };

  win.AttendanceService = {
    async upsertSchedule(sectionId, sched, dayOfWeek, dayOff) {
      calls.push({ name: 'AttendanceService.upsertSchedule', sectionId, sched, dayOfWeek, dayOff });
      if (dayOfWeek === 3 && win.__scheduleDayFail) return { ok: false, error: 'boom: Wednesday sync failed' };
      return { ok: true };
    },
    async clearScheduleOverride(sectionId, dayOfWeek) {
      calls.push({ name: 'AttendanceService.clearScheduleOverride', sectionId, dayOfWeek });
      return { ok: true };
    },
  };

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_teacher_directory') {
        return { data: [
          { id: 'admin1', display_name: 'Admin One', email: 'admin@x.com', role: 'admin' },
          { id: 't2', display_name: 'Ms. Beta', email: 'beta@x.com', role: 'teacher' },
          { id: 't3', display_name: 'Mr. Gamma', email: 'gamma@x.com', role: 'teacher' },
        ], error: null };
      }
      if (name === 'create_class_section') {
        if (params.p_section_name === 'FAIL') return { data: null, error: { message: 'boom: create failed' } };
        return { data: { id: 'sec-new', grade_level: params.p_grade_level, section_name: params.p_section_name, adviser_id: params.p_adviser_id, archived: false, created_at: 'c', updated_at: 'u' }, error: null };
      }
      if (name === 'upsert_attendance_schedule') return { data: { ok: true }, error: null };
      if (name === 'update_class_section') {
        if (params.p_section_id === 'missing') return { data: null, error: { message: 'boom: update failed' } };
        return { data: { id: params.p_section_id, grade_level: params.p_grade_level, section_name: params.p_section_name, adviser_id: params.p_clear_adviser ? null : params.p_adviser_id, archived: false, created_at: 'c', updated_at: 'u2' }, error: null };
      }
      if (name === 'archive_class_section') {
        if (params.p_section_id === 'FAIL-ARCHIVE') return { data: null, error: { message: 'boom: archive failed' } };
        return { data: { id: params.p_section_id, grade_level: '10', section_name: 'X', adviser_id: null, archived: true, created_at: 'c', updated_at: 'u' }, error: null };
      }
      if (name === 'unarchive_class_section') return { data: { id: params.p_section_id, grade_level: '8', section_name: 'Old Section', adviser_id: null, archived: false, created_at: 'c', updated_at: 'u' }, error: null };
      if (name === 'reassign_section_adviser') {
        if (params.p_section_id === 'FAIL-REASSIGN') return { data: null, error: { message: 'boom: reassign failed' } };
        return { data: { id: params.p_section_id, grade_level: '10', section_name: 'Rizal', adviser_id: params.p_new_adviser_id, archived: false, created_at: 'c', updated_at: 'u' }, error: null };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };

  return win;
}

function snapshot(win) {
  return { mainHtml: win.document.getElementById('a-sections').innerHTML, modalHtml: win.document.getElementById('modal-root').innerHTML, calls: win.__calls };
}

async function runSequence(win) {
  const results = {};

  win.renderSectionMaker();
  await new Promise(r => setTimeout(r, 20)); // let mount-time refreshSectionData() settle
  results.afterMount = snapshot(win);
  win.__calls.length = 0;

  // Admin create modal (real adviser picker).
  await win._secOpenCreateModal();
  results.adminCreateModal = snapshot(win);
  win.__calls.length = 0;

  // Teacher create modal (read-only note instead of a picker).
  win.currentRole = 'teacher';
  await win._secOpenCreateModal();
  results.teacherCreateModal = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Create: validation errors.
  win.document.getElementById('sec-form-grade').value = '';
  win.document.getElementById('sec-form-name').value = '';
  await win._secSubmitForm(null);
  results.createNoGradeError = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('sec-form-grade').value = '11';
  win.document.getElementById('sec-form-name').value = '';
  await win._secSubmitForm(null);
  results.createNoNameError = snapshot(win);
  win.__calls.length = 0;

  // Create: enable schedule, leave a time blank.
  win.document.getElementById('sec-form-name').value = 'New Section';
  win.document.getElementById('sec-form-sched-toggle').checked = true;
  win._secToggleScheduleFields(true);
  win.document.getElementById('sec-form-sched-open').value = '';
  await win._secSubmitForm(null);
  results.createScheduleMissingTimeError = snapshot(win);
  win.__calls.length = 0;

  // Create: schedule out of order.
  win.document.getElementById('sec-form-sched-open').value = '08:00';
  win.document.getElementById('sec-form-sched-start').value = '07:00'; // before open — invalid order
  win.document.getElementById('sec-form-sched-late').value = '07:45';
  win.document.getElementById('sec-form-sched-close').value = '15:00';
  await win._secSubmitForm(null);
  results.createScheduleOrderError = snapshot(win);
  win.__calls.length = 0;

  // Create: successful, with a day override (Friday) and a day-off (Saturday).
  win.document.getElementById('sec-form-sched-open').value = '07:00';
  win.document.getElementById('sec-form-sched-start').value = '07:30';
  win.document.getElementById('sec-form-sched-late').value = '07:45';
  win.document.getElementById('sec-form-sched-close').value = '15:00';
  win._secToggleDayOverride(5, true);
  win.document.getElementById('sec-form-sched-day-5-open').value = '07:00';
  win.document.getElementById('sec-form-sched-day-5-start').value = '07:30';
  win.document.getElementById('sec-form-sched-day-5-late').value = '07:45';
  win.document.getElementById('sec-form-sched-day-5-close').value = '13:00';
  win._secToggleDayOff(6, true);
  await win._secSubmitForm(null);
  results.createSuccessWithScheduleAndOverrides = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Edit: open, change name + adviser, add a Wednesday override that fails to sync.
  await win._secOpenEditModal('sec-a');
  results.editModalOpen = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('sec-form-name').value = 'Rizal Renamed';
  const adviserSel = win.document.getElementById('sec-form-adviser');
  adviserSel.value = 't3';
  win._secToggleDayOverride(3, true);
  win.document.getElementById('sec-form-sched-day-3-open').value = '07:00';
  win.document.getElementById('sec-form-sched-day-3-start').value = '07:30';
  win.document.getElementById('sec-form-sched-day-3-late').value = '07:45';
  win.document.getElementById('sec-form-sched-day-3-close').value = '15:00';
  win.__scheduleDayFail = true;
  await win._secSubmitForm('sec-a');
  results.editSuccessScheduleSyncPartialFail = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;
  win.__scheduleDayFail = false;

  // Edit as teacher — no adviser picker, adviserTouched stays false.
  win.currentRole = 'teacher';
  await win._secOpenEditModal('sec-b');
  win.document.getElementById('sec-form-name').value = 'Bonifacio Renamed';
  await win._secSubmitForm('sec-b');
  results.teacherEditSuccess = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Archive: confirm modal, then archive success and archive failure.
  win._secConfirmArchive('sec-a', 2);
  results.archiveConfirmModal = snapshot(win);
  win.__calls.length = 0;

  await win._secArchive('sec-a');
  results.archiveSuccess = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  await win._secArchive('FAIL-ARCHIVE');
  results.archiveFail = snapshot(win);
  win.__calls.length = 0;

  // Unarchive.
  await win._secUnarchive('sec-c');
  results.unarchiveSuccess = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  // Reassign: modal open, submit success, submit failure.
  await win._secOpenReassignModal('sec-b');
  results.reassignModalOpen = snapshot(win);
  win.__calls.length = 0;

  win.document.getElementById('sec-reassign-select').value = 't3';
  await win._secSubmitReassign('sec-b');
  results.reassignSuccess = { state: win.__getFakeState(), snapshot: snapshot(win) };
  win.__calls.length = 0;

  await win._secSubmitReassign('FAIL-REASSIGN');
  results.reassignFail = snapshot(win);
  win.__calls.length = 0;

  // Roster: open, rerender (via the real function, not simulated typing).
  win._secOpenRosterModal('sec-a');
  results.rosterModalOpen = snapshot(win);
  win.__calls.length = 0;

  win._secRerenderRoster('sec-a');
  results.rosterRerender = snapshot(win);
  win.__calls.length = 0;

  win._secOpenRosterModal('nonexistent');
  results.rosterModalNotFound = snapshot(win);
  win.__calls.length = 0;

  // Unmount: further subscribe events are now no-ops.
  win.unmountSectionMaker();
  win.document.getElementById('a-sections').innerHTML = '<div id="marker">unchanged</div>';
  const cb = win.__subscribed;
  if (cb) cb({}, { type: 'sections:test' });
  results.eventAfterUnmountNoop = snapshot(win);

  return results;
}

async function main() {
  const sectionsServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections-service.js'), 'utf8');
  const teacherDirServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'sections.bridge.js'), 'utf8');

  const winOriginal = makeWindow();
  winOriginal.eval(sectionsServiceSrc);
  winOriginal.eval(teacherDirServiceSrc);
  winOriginal.eval(originalSrc);
  assert.strictEqual(typeof winOriginal.renderSectionMaker, 'function');
  const resultOriginal = await runSequence(winOriginal);

  const winBridge = makeWindow();
  winBridge.eval(bridgeSrc);
  assert.strictEqual(typeof winBridge.renderSectionMaker, 'function');
  const resultBridge = await runSequence(winBridge);

  assert.strictEqual(JSON.stringify(resultBridge), JSON.stringify(resultOriginal), 'bridge output must exactly match original output at every step');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('sections.js: mount (incl. mount-time refreshSectionData), admin vs teacher create modal,');
  console.log('create validation (grade/name/schedule-missing-time/schedule-order), create success with a');
  console.log('day override + a day-off, edit success (incl. adviser change + a failing schedule-day sync),');
  console.log('teacher edit (no adviser picker), archive (confirm modal + success + RPC-fail), unarchive,');
  console.log('reassign (modal + success + RPC-fail), roster (open/rerender/not-found), and unmount gating');
  console.log('further AppStore events all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
