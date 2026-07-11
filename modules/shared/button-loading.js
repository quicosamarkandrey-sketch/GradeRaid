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
  function eqButtonLoading(btn, isLoading, opts) {
    if (!btn) return;
    opts = opts || {};

    if (isLoading) {
      if (btn.dataset.eqLoading === '1') return; // already loading — don't clobber saved original
      btn.dataset.eqLoading = '1';
      btn.dataset.eqOrigHtml = btn.innerHTML;
      // Lock the button's current rendered width before swapping content,
      // so "Enter Quest →" → spinner+"Signing in…" doesn't reflow/shrink
      // the button (and, on the login form, doesn't shift the card layout).
      btn.style.minWidth = btn.offsetWidth + 'px';
      btn.disabled = true;
      btn.classList.add('eq-btn-loading');
      var label = opts.label || 'Loading…';
      btn.innerHTML = '<span class="material-symbols-outlined eq-btn-spinner">progress_activity</span>' + label;
    } else {
      if (btn.dataset.eqLoading !== '1') return; // never entered loading state — nothing to restore
      btn.innerHTML = btn.dataset.eqOrigHtml;
      btn.disabled = false;
      btn.classList.remove('eq-btn-loading');
      btn.style.minWidth = '';
      delete btn.dataset.eqLoading;
      delete btn.dataset.eqOrigHtml;
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
    eqButtonLoading(btn, true, { label: label });
    try {
      return await fn();
    } finally {
      eqButtonLoading(btn, false);
    }
  }
  window.eqWithButtonLoading = eqWithButtonLoading;

})(window, document);
