/* ═══════════════════════════════════════════════════════════════════════════════
   EduQuest — button-loading.js
   Load anywhere after base.css (styles come from #eq-btn-loading-styles below,
   injected once at parse time — no separate stylesheet dependency, so this
   module works even on pages/screens that load before base.css finishes).

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
   ═══════════════════════════════════════════════════════════════════════════════ */

(function (window, document) {
  'use strict';

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

  /**
   * eqButtonLoading(btn, isLoading, opts)
   * Toggles a button between its normal state and a disabled spinner+label
   * state. Saves the button's exact original innerHTML the first time it
   * goes into loading state, and restores it byte-for-byte when turned off
   * — so callers never need to know/repeat the button's original markup.
   *
   * @param {HTMLButtonElement} btn
   * @param {boolean} isLoading
   * @param {Object} [opts]
   * @param {string} [opts.label='Loading…'] — text shown next to the spinner
   */
  const loadingStates = new WeakMap();
  const pendingActions = new WeakMap();
  function eqButtonLoading(btn, isLoading, opts = {}) {
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
  window.eqButtonLoading = eqButtonLoading;

  /**
   * eqWithButtonLoading(btn, label, fn) → Promise<any>
   * Puts btn into its loading state, runs fn() (sync or async), and ALWAYS
   * restores the button afterward via finally — whether fn() resolves,
   * rejects, or throws. Re-throws/returns exactly what fn() would have, so
   * callers can keep their existing success/error branching unchanged; this
   * only adds the loading-state bookkeeping around it.
   *
   * @param {HTMLButtonElement} btn
   * @param {string} label
   * @param {Function} fn — () => Promise<any> | any
   */
  async function eqWithButtonLoading(btn, label, fn) {
    if (btn && pendingActions.has(btn)) return pendingActions.get(btn);
    eqButtonLoading(btn, true, { label });
    const action = Promise.resolve().then(fn);
    if (btn) pendingActions.set(btn, action);
    try { return await action; }
    finally { if (btn) pendingActions.delete(btn); eqButtonLoading(btn, false); }
  }
  window.eqWithButtonLoading = eqWithButtonLoading;

})(window, document);
