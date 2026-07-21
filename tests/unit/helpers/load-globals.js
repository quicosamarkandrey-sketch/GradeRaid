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

module.exports = { loadUtilsWindow };
