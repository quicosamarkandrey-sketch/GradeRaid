// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — src/quick-jump.js
//  Fast-Jump Overlay: initQuickJump(items)
//
//  A small fuzzy-filter command overlay (Cmd/Ctrl+K) for jumping straight to a
//  page. Provides ONLY the behavior — the overlay markup is wired up
//  elsewhere (Sidebar-phase work), sourced from nav.js's page registries.
//
//  Expected markup contract:
//    <div id="quick-jump-overlay">
//      <input type="text">
//      <ul class="quick-jump-results"></ul>
//    </div>
//
//  Calling initQuickJump() before that markup exists is a safe no-op (logs
//  a console warning) rather than throwing.
//
// Phase 7 (2026-08-10, session 14) — step 5.3, tenth real conversion. This
// is the real-ESM twin of the original ../modules/shared/quick-jump.js,
// which stays completely untouched. Function body copied byte-for-byte.
// ═══════════════════════════════════════════════════════════════════════════════

export function initQuickJump(items) {
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
