// ─────────────────────────────────────────────────────────────────────────────
// SHARED DOM — DOM manipulation utilities used across all modules
//
// Exports: toast(), showModal(), closeModal(), closeModalForce()
//
// DEPENDENCIES: None
//   Requires DOM elements: #toast, #modal-box, #modal-content, #modal-overlay
//   These elements are defined in the HTML shell (index.html).
//
// Phase 7 (2026-08-10, session 5) — step 5.3, first real conversion.
// This is the real-ESM twin of the original ../dom.js, which stays
// completely untouched (still a classic <script src> in index.html, still
// what production and the legacy concat build actually load). This file
// exists only in the parallel build universe until enough of src/ exists
// for the single cutover event described in the Phase 7 session memory
// doc, principle 8 — see PHASE7_SRC_CONVERSION_TRACKER.md for what's
// converted so far and PHASE7_DEPENDENCY_MAP.md for why dom.js was picked
// first (fan-out 0, highest fan-in of any true leaf: 59).
//
// No `window.X = X` shim needed here — nothing consumes THIS file via
// `import` yet (it's not wired into any entry point that ships), so there
// are no "unconverted consumers of this specific copy" to shim for. The
// original ../dom.js's own window.toast/closeModal/closeModalForce
// exports (added in session 2) remain exactly as they were, still serving
// all 59 real consumers via the unconverted, still-live file.
// ─────────────────────────────────────────────────────────────────────────────

// Shared dialog focus handling; page-specific submit and cancel actions stay intact.
const _eqDialogFocus = (() => {
  let returnTo=null;
  const focusables=box=>[...box.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(el=>!el.matches(':disabled') && el.getClientRects().length && !el.closest('[hidden],[inert]'));
  function opened() {
    const box=document.getElementById('modal-box');
    if(!returnTo)returnTo=document.activeElement;
    box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.tabIndex=-1;
    const title=box.querySelector('h1,h2,h3,.modal-h2');
    if(title){if(!title.id)title.id='eq-dialog-title';box.setAttribute('aria-labelledby',title.id);box.removeAttribute('aria-label');}
    else{box.removeAttribute('aria-labelledby');box.setAttribute('aria-label','Dialog');}
    requestAnimationFrame(()=>{
      if(document.getElementById('modal-overlay').style.display==='none')return;
      if(!box.contains(document.activeElement) || document.activeElement===box) {
        const items=focusables(box);
        (items.find(el=>el.hasAttribute('autofocus'))||items[0]||box).focus({preventScroll:true});
      }
    });
  }
  function closed() {const target=returnTo;returnTo=null;if(target?.isConnected && target.getClientRects().length)target.focus({preventScroll:true});}
  document.addEventListener('keydown',e=>{
    const overlay=document.getElementById('modal-overlay'),box=document.getElementById('modal-box');
    if(!overlay||!box||overlay.style.display==='none'||!overlay.getClientRects().length)return;
    if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();window.closeModalForce();return;}
    if(e.key!=='Tab')return;
    const items=focusables(box),first=items[0],last=items[items.length-1];
    if(!first){e.preventDefault();box.focus();return;}
    if(!box.contains(document.activeElement)||document.activeElement===box){e.preventDefault();(e.shiftKey?last:first).focus();}
    else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  return {opened,closed};
})();

export function toast(msg, color = '#4edea3') {
  const el = document.getElementById('toast');
  el.style.display = 'block'; el.style.borderColor = color + '55'; el.style.boxShadow = `0 0 20px ${color}33`;
  el.innerHTML = msg; clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 2800);
}

export function showModal(content, size = 'md') {
  document.getElementById('modal-box').className = 'modal-box ' + size;
  document.getElementById('modal-content').innerHTML = content;
  document.getElementById('modal-overlay').style.display = 'flex';
  _eqDialogFocus.opened();
}

export function closeModal(e) { if (!e || e.target === document.getElementById('modal-overlay')) closeModalForce(); }
export function closeModalForce() { document.getElementById('modal-overlay').style.display = 'none'; _eqDialogFocus.closed(); }

// Decorative emoji use a closed registry; button labels remain plain text.
export function uiIcon(name) {
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
