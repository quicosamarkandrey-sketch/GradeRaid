'use strict';
// Phase 0 safety net — minimal Node+jsdom harness for pure-logic functions.
//
// This app has no module system yet (that's Phase 7): utils.js just declares
// top-level functions and assigns them onto `window`. To unit test them
// without a browser, we load the real file's source into a real jsdom
// `window` (so `window.foo = foo` behaves exactly as it does in the app),
// then hand tests that window object to read functions off of and to seed
// `DB` on before calling anything that reads global state.
//
// This is intentionally still "the real file" — no reimplementation, no
// copy-pasted logic — so these tests catch a real regression the moment
// utils.js changes, not just a regression in a parallel copy of it.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function loadUtilsWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'utils.js'), 'utf8');
  const scriptEl = dom.window.document.createElement('script');
  scriptEl.textContent = src;
  dom.window.document.body.appendChild(scriptEl);
  return dom.window;
}

module.exports = { loadUtilsWindow, loadLoggerWindow, loadAchEngineWindow };

/**
 * loadAchEngineWindow() — loads the real modules/achievements/ach_engine.js
 * source into a jsdom window, against a fake AppStore whose subscribe()
 * just records handlers by key (so tests can invoke them directly with a
 * synthetic event, the same way AppStore._notify() would). Real AppStore
 * is intentionally not used here — see loadLoggerWindow()'s comment.
 */
function loadAchEngineWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.subscribers = {};
  win.AppStore = {
    getSlice: () => [],
    subscribe: (key, fn) => { win.subscribers[key] = fn; },
  };
  win.currentUser = null;
  win.currentRole = null;

  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'achievements', 'ach_engine.js'), 'utf8');
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = src;
  win.document.body.appendChild(scriptEl);
  return win;
}

/**
 * loadLoggerWindow() — loads the real modules/recitation/logger.js source
 * into a jsdom window, against a lightweight fake AppStore (real AppStore
 * requires DBService.initRemote()/network access to init, which this Phase
 * 0-style harness intentionally avoids — see this file's header). The fake
 * only implements what logger.js actually calls: updateState() and
 * getStudent(). Everything updateState() is given gets recorded so tests
 * can assert on the event shape and draft-mutation behavior without
 * reimplementing logger.js's own logic.
 */
function loadLoggerWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost/',
  });
  const win = dom.window;

  win.updateStateCalls = [];
  win.AppStore = {
    getStudent: (id) => win._fakeStudent && win._fakeStudent.id === id ? win._fakeStudent : null,
    updateState: (mutationFn, event) => {
      win.updateStateCalls.push({ mutationFn, event });
    },
  };
  // Stubs for logger.js's other ambient dependencies (DOM read, uid/nowStr
  // come from the real utils.js elsewhere in the app — stubbed here since
  // this harness only loads logger.js itself).
  win.uid = () => 'test-uid';
  win.nowStr = () => '2026-07-30T00:00:00.000Z';
  win._esc = (s) => s;
  win.syncStudentStatsToServer = () => {};
  win.toastCalls = [];
  win.toast = (msg) => win.toastCalls.push(msg);
  win.renderScannerCalls = 0;
  win.renderScanner = () => { win.renderScannerCalls++; };

  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'modules', 'recitation', 'logger.js'), 'utf8');
  const scriptEl = win.document.createElement('script');
  scriptEl.textContent = src;
  win.document.body.appendChild(scriptEl);
  return win;
}
