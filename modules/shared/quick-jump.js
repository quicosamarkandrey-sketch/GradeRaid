// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shared/quick-jump.js
//  Fast-Jump Overlay: window.initQuickJump(items)
//
//  A small fuzzy-filter command overlay (Cmd/Ctrl+K) for jumping straight to a
//  page. This file provides ONLY the behavior — it intentionally does not
//  create or inject the overlay markup, because per the redesign proposal
//  (§9.6, Sidebar Master Plan) the overlay's items must be sourced from
//  nav.js's existing NAV_STUDENT / NAV_ADMIN registries, not a hand-kept
//  duplicate list, and nav.js already owns page-routing concerns. Wiring
//  #quick-jump-overlay into index.html + calling initQuickJump(navItems) is
//  Sidebar-phase work (redesign proposal roadmap page #18), not foundation.
//
//  Expected markup contract when that phase wires it up:
//    <div id="quick-jump-overlay">
//      <input type="text">
//      <ul class="quick-jump-results"></ul>
//    </div>
//
//  Calling initQuickJump() before that markup exists is a safe no-op (logs a
//  console warning) rather than throwing, so loading this file early doesn't
//  require any other module to be ready yet.
//
//  LOAD: after modules/shared/ambient-backdrop.js. No dependencies.
// ═══════════════════════════════════════════════════════════════════════════════

(function (window, document) {
  'use strict';

  /**
   * Wire up the fast-jump overlay.
   * @param {Array<{label:string, action:Function}>} items — sourced from nav.js's page registry
   */
  function initQuickJump(items) {
    items = items || [];
    var overlay = document.getElementById('quick-jump-overlay');
    if (!overlay) {
      console.warn('[initQuickJump] #quick-jump-overlay not found in the DOM yet — this is expected until the Sidebar Master Plan phase wires it in. No-op.');
      return;
    }
    var input = overlay.querySelector('input');
    var list = overlay.querySelector('.quick-jump-results');
    if (!input || !list) return;

    function open() {
      overlay.classList.add('open');
      input.value = '';
      render(items);
      input.focus();
    }
    function close() {
      overlay.classList.remove('open');
    }
    function render(matches) {
      list.innerHTML = matches.slice(0, 8)
        .map(function (m, i) { return '<li data-index="' + i + '">' + m.label + '</li>'; })
        .join('');
    }

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
      if (e.key === 'Escape') close();
    });
    input.addEventListener('input', function () {
      var q = input.value.toLowerCase();
      render(items.filter(function (i) { return i.label.toLowerCase().indexOf(q) !== -1; }));
    });
    list.addEventListener('click', function (e) {
      var li = e.target.closest('li');
      if (!li) return;
      var item = items[li.dataset.index];
      if (item && item.action) item.action();
      close();
    });
  }

  window.initQuickJump = initQuickJump;
})(window, document);
