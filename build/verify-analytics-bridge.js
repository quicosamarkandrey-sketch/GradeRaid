// Phase 7, Stream B — equivalence check for modules/admin/analytics.js.
// sections-service.js and teacher-directory-service.js are already
// independently equivalence-checked, so the ORIGINAL window evals both
// real, untouched service files (plus analytics.js's own original) while
// the BRIDGE window relies on its bundle's real internal imports of both.
// Both windows share an identical DB.students/DB.quizzes fixture, an
// identical fake AppStore (backing sections-service.js's classSections
// slice + capturing emit() calls), and an identical fake DBService.rpc
// (backing teacher-directory-service.js's get_teacher_directory).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="a-analytics"></div>
</body></html>`;

function makeStudents() {
  const students = [];
  for (let i = 1; i <= 25; i++) {
    students.push({
      id: 's' + i, name: 'Student ' + i, init: 'S' + i, color: '#8b5cf6',
      xp: 1000 - i * 10, coins: 500 - i * 5, level: Math.max(1, 10 - Math.floor(i / 3)),
      attendance: 90 - (i % 10), quizAvg: 80 - (i % 15),
      completedQuizzes: i % 2 === 0 ? ['q1'] : [],
      classId: i % 2 === 0 ? 'sec-a' : 'sec-b',
    });
  }
  return students;
}

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously' });
  const win = dom.window;
  const calls = [];
  win.__calls = calls;

  win.currentRole = 'admin';
  win._esc = s => String(s == null ? '' : s);
  win._cssColor = c => c || '#888';
  win.openAwardPoints = function () { calls.push({ name: 'openAwardPoints' }); };

  win.DB = { students: makeStudents(), quizzes: [{ id: 'q1' }, { id: 'q2' }] };

  let appState = { classSections: [{ id: 'sec-a', gradeLevel: '10', sectionName: 'Rizal', adviserId: 'admin1', archived: false }] };
  win.AppStore = {
    getSlice(fn) { return fn(JSON.parse(JSON.stringify(appState))); },
    getState() { return JSON.parse(JSON.stringify(appState)); },
    emit(evt) { calls.push({ name: 'AppStore.emit', evt }); },
  };
  win.currentUser = { id: 'admin1' };

  win.DBService = {
    async rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'get_teacher_directory') {
        if (win.__dirFail) return { data: null, error: { message: 'boom: directory failed' } };
        return {
          data: [
            { id: 'admin1', display_name: 'Admin One', email: 'admin@x.com', role: 'admin', sections: [{ id: 'sec-a', label: 'Grade 10 - Rizal', archived: false }] },
            { id: 't2', display_name: 'Ms. Beta', email: 'b@x.com', role: 'teacher', sections: [{ id: 'sec-b', label: 'Grade 9 - Bonifacio', archived: false }] },
          ],
          error: null,
        };
      }
      throw new Error('unexpected rpc: ' + name);
    },
  };

  win.HTMLElement.prototype.scrollIntoView = function () {};

  return win;
}

function snapshot(win) {
  return { html: win.document.getElementById('a-analytics').innerHTML, calls: win.__calls };
}

async function runSequence(win) {
  const results = {};

  // Default (teacher) view, standard mode.
  win.currentRole = 'teacher';
  win.renderAnalytics();
  results.teacherStandardView = snapshot(win);
  win.__calls.length = 0;
  win.currentRole = 'admin';

  // Admin, standard mode (mode toggle visible).
  win.renderAnalytics();
  results.adminStandardView = snapshot(win);
  win.__calls.length = 0;

  // Search + pagination.
  win.anlSetSearch('Student 1');
  results.afterSearch = snapshot(win);
  win.__calls.length = 0;

  win.anlSetSearch('');
  win.anlGoToPage(2);
  results.afterGoToPage2 = snapshot(win);
  win.__calls.length = 0;

  win.anlNextPage();
  results.afterNextPage = snapshot(win);
  win.__calls.length = 0;

  win.anlPrevPage();
  win.anlPrevPage();
  results.afterPrevPageClampedAt1 = snapshot(win);
  win.__calls.length = 0;

  // Switch to rollup mode (admin only) — async fetch + render.
  win.anlSetMode('rollup');
  await new Promise(r => setTimeout(r, 20));
  results.rollupMode = snapshot(win);
  win.__calls.length = 0;

  // Switch back to mine — cached teachers, no refetch.
  win.anlSetMode('mine');
  results.backToMine = snapshot(win);
  win.__calls.length = 0;

  // Rollup mode again — should use the cache, not refetch.
  win.anlSetMode('rollup');
  await new Promise(r => setTimeout(r, 20));
  results.rollupModeCached = snapshot(win);
  win.__calls.length = 0;

  // Non-admin trying anlSetMode('rollup') — defense-in-depth no-op.
  win.currentRole = 'teacher';
  win.anlSetMode('rollup');
  results.nonAdminSetModeNoop = snapshot(win);

  return results;
}

async function runRollupFetchFailCase(win) {
  win.__dirFail = true;
  win.anlSetMode('rollup');
  await new Promise(r => setTimeout(r, 20));
  return snapshot(win);
}

async function main() {
  const sectionsServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'sections-service.js'), 'utf8');
  const teacherDirServiceSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'teacher-directory-service.js'), 'utf8');
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'admin', 'analytics.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'analytics.bridge.js'), 'utf8');

  // Main sequence.
  {
    const winO = makeWindow();
    winO.eval(sectionsServiceSrc);
    winO.eval(teacherDirServiceSrc);
    winO.eval(originalSrc);
    assert.strictEqual(typeof winO.renderAnalytics, 'function');
    const rO = await runSequence(winO);

    const winB = makeWindow();
    winB.eval(bridgeSrc);
    assert.strictEqual(typeof winB.renderAnalytics, 'function');
    const rB = await runSequence(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'main sequence mismatch');
  }

  // Rollup fetch failure.
  {
    const winO = makeWindow();
    winO.eval(sectionsServiceSrc);
    winO.eval(teacherDirServiceSrc);
    winO.eval(originalSrc);
    const rO = await runRollupFetchFailCase(winO);

    const winB = makeWindow();
    winB.eval(bridgeSrc);
    const rB = await runRollupFetchFailCase(winB);

    assert.strictEqual(JSON.stringify(rB), JSON.stringify(rO), 'rollup-fetch-fail mismatch');
  }

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('analytics.js: teacher/admin standard views, search + pagination (incl. next/prev + clamp),');
  console.log('rollup mode (fetch + render + emit), the teacher-directory cache (no refetch on re-entry),');
  console.log('the non-admin anlSetMode defense-in-depth no-op, and the rollup fetch-failure path all match.');
}

main().catch(e => { console.error('EQUIVALENCE CHECK FAILED:', e); process.exit(1); });
