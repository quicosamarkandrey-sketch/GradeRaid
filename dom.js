// ─────────────────────────────────────────────────────────────────────────────
// SHARED DOM — DOM manipulation utilities used across all modules
//
// Exports: toast(), showModal(), closeModal(), closeModalForce()
//
// DEPENDENCIES: None
//   Requires DOM elements: #toast, #modal-box, #modal-content, #modal-overlay
//   These elements are defined in the HTML shell (index.html).
// ─────────────────────────────────────────────────────────────────────────────

function toast(msg,color='#4edea3'){
  const el=document.getElementById('toast');
  el.style.display='block';el.style.borderColor=color+'55';el.style.boxShadow=`0 0 20px ${color}33`;
  el.innerHTML=msg;clearTimeout(el._t);el._t=setTimeout(()=>el.style.display='none',2800);
}
function showModal(content,size='md'){
  document.getElementById('modal-box').className='modal-box '+size;
  document.getElementById('modal-content').innerHTML=content;
  document.getElementById('modal-overlay').style.display='flex';
}
function closeModal(e){if(!e||e.target===document.getElementById('modal-overlay'))document.getElementById('modal-overlay').style.display='none';}
function closeModalForce(){document.getElementById('modal-overlay').style.display='none';}

// ── Phase 7 (2026-08-10, session 2): explicit window export ──
// These were previously implicit globals (bare top-level function
// declarations, exposed to window only via classic-script behavior).
// Made explicit ahead of any real module/bundle scoping change —
// see PHASE7_IMPLICIT_GLOBALS.md.
window.toast = toast;
window.closeModal = closeModal;
window.closeModalForce = closeModalForce;

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.showModal = showModal;

// Decorative emoji use a closed registry; button labels remain plain text.
function uiIcon(name) {
  const icons = {
    users:'👥',book:'📚',bag:'🛍️',box:'📦',award:'🏆',calendar:'📅',mic:'🎤',chart:'📊',flame:'🔥',
    check:'✅',food:'🍎',privilege:'⚔️',mystery:'❓',close:'✖️',mail:'✉️',coin:'🪙',lock:'🔒',warning:'⚠️',
    chair:'🪑',door:'🚪',settings:'⚙️',home:'🏠',scan:'📷',search:'🔍',menu:'☰',bell:'🔔',arrow:'➡️',
    back:'⬅️',plus:'➕',minus:'➖',edit:'✏️',delete:'🗑️',save:'💾',eye:'👁️',logout:'🚪',clock:'🕒',link:'🔗',
    upload:'⬆️',chevron:'›','chevron-down':'⌄','chevron-up':'⌃',refresh:'🔄',info:'ℹ️',image:'🖼️',camera:'📷',
    palette:'🎨',flag:'🚩',circle:'☀️',stop:'⏹️',supplies:'📦',unknown:'📦'
  };
  return '<span class="eq-emoji" aria-hidden="true">' + (Object.prototype.hasOwnProperty.call(icons,name) ? icons[name] : '📦') + '</span>';
}
window.uiIcon = uiIcon;
