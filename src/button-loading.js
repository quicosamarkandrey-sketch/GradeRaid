/* ═══════════════════════════════════════════════════════════════════════════════
   EduQuest — src/button-loading.js

   PROBLEM THIS SOLVES: any button that triggers an async round-trip (login,
   logout, claiming a reward, submitting a form, etc.) used to just sit there
   doing nothing between click and result. Nothing told the user their click
   registered, so a slow network made it look broken and invited a
   frustrated second/third click — which, for non-idempotent actions like
   "claim reward" or "submit", can double-fire the request.

   Exports:
     eqButtonLoading(btn, isLoading, opts)   — low-level toggle
     eqWithButtonLoading(btn, label, fn)     — wraps an async fn, always
                                                restores the button after
                                                (success OR error)

   USAGE (reusable anywhere a button kicks off an async action):
     async function claimReward(btn){
       await eqWithButtonLoading(btn, 'Claiming…', async () => {
         const result = await LootService.claim(...);
         if (!result.ok) throw new Error(result.error);
         // ...handle success (toast, UI update, etc.)...
       });
     }
     <button onclick="claimReward(this)">Claim</button>

   Or the two-step form if you need more control over the try/catch:
     eqButtonLoading(btn, true, { label: 'Saving…' });
     try { await save(); } finally { eqButtonLoading(btn, false); }

   Phase 7 (2026-08-10, session 12) — step 5.3, fifth real conversion. This
   is the real-ESM twin of the original ../modules/shared/button-loading.js,
   which stays completely untouched. Function bodies copied byte-for-byte.
   The style-injection side effect (previously an IIFE top-level statement)
   is preserved as real module-top-level code below, which ES modules run
   exactly once per module instance, same as the original IIFE ran once per
   page load — same guard (`if (!document.getElementById(...))`) kept
   intentionally, since nothing about that safety check depends on the
   IIFE wrapper itself.
   ═══════════════════════════════════════════════════════════════════════════════ */

// Injected once — reuses the @keyframes spin already defined in base.css
// for every other spinner in the app (registration submit, etc.), so this
// stays visually consistent with existing loading states rather than
// introducing a second spin animation.
if (!document.getElementById('eq-btn-loading-styles')) {
  var style = document.createElement('style');
  style.id = 'eq-btn-loading-styles';
  style.textContent =
    '.eq-btn-spinner{font-size:16px;vertical-align:middle;animation:spin 1s linear infinite;margin-right:6px}' +
    '.eq-btn-loading{opacity:.85;cursor:not-allowed !important;pointer-events:none}';
  document.head.appendChild(style);
}

  const loadingStates = new WeakMap();
  const pendingActions = new WeakMap();
  export function eqButtonLoading(btn, isLoading, opts = {}) {
    if (!btn) return;
    if (isLoading) {
      if (loadingStates.has(btn)) return;
      const previous = { html: btn.innerHTML, disabled: btn.disabled, minWidth: btn.style.minWidth, busy: btn.getAttribute('aria-busy'), live: btn.getAttribute('aria-live') };
      loadingStates.set(btn, previous);
      btn.dataset.eqLoading = '1'; btn.dataset.eqOrigHtml = previous.html;
      btn.style.minWidth = btn.offsetWidth + 'px'; btn.disabled = true;
      btn.classList.add('eq-btn-loading'); btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-live', 'polite');
      const spinner = document.createElement('span'); spinner.className = 'material-symbols-outlined eq-btn-spinner'; spinner.textContent = 'progress_activity'; spinner.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = opts.label || 'Loading…';
      btn.replaceChildren(spinner, label);
      previous.timer = setTimeout(() => { if (btn.isConnected && loadingStates.has(btn)) { label.textContent = 'Still working…'; btn.title = 'Waiting for the server. Keep this page open; do not submit again.'; } }, 5000);
      previous.title = btn.getAttribute('title');
    } else {
      const previous = loadingStates.get(btn); if (!previous) return;
      clearTimeout(previous.timer); btn.innerHTML = previous.html; btn.disabled = previous.disabled; btn.style.minWidth = previous.minWidth;
      for (const [name, value] of [['aria-busy', previous.busy], ['aria-live', previous.live], ['title', previous.title]]) { if (value === null) btn.removeAttribute(name); else btn.setAttribute(name, value); }
      btn.classList.remove('eq-btn-loading'); delete btn.dataset.eqLoading; delete btn.dataset.eqOrigHtml; loadingStates.delete(btn);
    }
  }

  export async function eqWithButtonLoading(btn, label, fn) {
    if (btn && pendingActions.has(btn)) return pendingActions.get(btn);
    eqButtonLoading(btn, true, { label });
    const action = Promise.resolve().then(fn);
    if (btn) pendingActions.set(btn, action);
    try { return await action; }
    finally { if (btn) pendingActions.delete(btn); eqButtonLoading(btn, false); }
  }
