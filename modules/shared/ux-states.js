/* Shared feedback and editor recovery. Presentation never confirms a server write. */
(function () {
  'use strict';
  const adapters = new Map();
  const requests = new WeakMap();
  const ttl = 12 * 60 * 60 * 1000;
  let loggingOut = false, authSubscription = null, authClient = null;
  const user = () => typeof currentUser !== 'undefined' ? currentUser : null;
  const role = () => typeof currentRole !== 'undefined' ? currentRole : null;
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n; };
  const defaults = {
    empty: ['Nothing here yet', 'Start with your first item.'],
    loading: ['Loading', 'Getting the latest information…'],
    slow: ['Taking longer than usual', 'Keep this page open. We are still waiting for the server.'],
    offline: ['You’re offline', 'Already loaded content is available. Live updates and server-confirmed actions need a connection.'],
    error: ['Couldn’t load this information', 'Try again. If this keeps happening, contact your teacher or administrator.'],
    zero: ['No matches found', 'Try a shorter search or clear your filters.'],
    permission: ['This page needs additional access', 'Ask your administrator to check your role and section assignment.'],
    success: ['Completed', 'Your change has been confirmed.']
  };
  function render(container, type, options = {}) {
    if (!container) return null;
    const copy = defaults[type] || defaults.error;
    const node = el('section', 'ux-state ux-state-' + type);
    node.setAttribute('role', ['error', 'permission'].includes(type) ? 'alert' : 'status');
    node.setAttribute('aria-live', 'polite');
    const mark = el('span', 'ux-state-mark'); mark.setAttribute('aria-hidden', 'true');
    mark.textContent = ['loading', 'slow'].includes(type) ? '…' : type === 'success' ? '✓' : type === 'zero' ? '⌕' : type === 'error' ? '!' : '—';
    node.append(mark, el('h3', '', options.title || copy[0]), el('p', '', options.description || copy[1]));
    if (options.actionLabel && typeof options.onAction === 'function') {
      const button = el('button', 'btn btn-ghost', options.actionLabel); button.type = 'button';
      button.addEventListener('click', options.onAction); node.append(button);
    }
    container.replaceChildren(node); return node;
  }
  function stack() {
    let root = document.getElementById('ux-notices');
    if (!root) { root = el('div', 'ux-notices'); root.id = 'ux-notices'; document.body.append(root); }
    return root;
  }
  function notice(type, options = {}) {
    const id = options.id || 'ux-feedback';
    document.getElementById(id)?.remove();
    const box = el('div', 'ux-notice'); box.id = id; stack().append(box);
    render(box, type, options);
    if (options.dismissible !== false) {
      const close = el('button', 'ux-notice-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Dismiss notification'); close.onclick = () => box.remove(); box.append(close);
    }
    if (options.duration) setTimeout(() => box.remove(), options.duration);
    return box;
  }
  function explain(error) {
    const message = String(error?.message || error?.reason || error || '');
    const code = String(error?.code || '');
    if (error?.name === 'NotAllowedError') return { type: 'permission', title: 'Device permission is blocked', description: 'Allow this site to use the requested device in your browser settings, then try again. Your teacher can help with scanner access.' };
    if (navigator.onLine === false || /fetch|network|offline|connection|timeout/i.test(message)) return { type: 'offline', title: 'Connection interrupted', description: 'Your last loaded view is still here. Reconnect, then try again. This request has not been confirmed.' };
    if (code === '42501' || /permission denied|row.level security|not authorized|forbidden/i.test(message)) return { type: 'permission', ...Object.fromEntries([['title', defaults.permission[0]], ['description', defaults.permission[1]]]) };
    if (/jwt.*expired|refresh token|session.*expired/i.test(message)) return { type: 'error', title: 'Please sign in again', description: 'Your session has expired. Sign in with the same account to continue.' };
    return { type: 'error', title: defaults.error[0], description: 'The server could not complete this request. Try again; if it continues, contact your teacher or administrator.' };
  }
  // Only use retry callbacks for reads or operations with their own idempotency contract.
  async function task(target, label, fn, options = {}) {
    const previous = requests.get(target); if (previous && previous.scope === options.scope) return previous.promise;
    if(previous)previous.host.remove();
    const host = el('div', 'ux-request'); target.prepend(host); target.setAttribute('aria-busy', 'true');
    const token = { host, scope: options.scope }; requests.set(target, token);
    const stage = text => { if (host.isConnected) render(host, 'loading', { title: label, description: text }); };
    stage('Getting the latest information…');
    const timer = setTimeout(() => { if (host.isConnected) render(host, 'slow', { title: label, description: 'The server is taking longer to respond. Your existing view stays available; keep this page open.' }); }, 5000);
    token.promise = (async () => {
      try { const value = await fn(stage); host.remove(); return { ok: true, value }; }
      catch (error) { const copy = explain(error); if (host.isConnected) render(host, copy.type, { ...copy, actionLabel: options.retry ? 'Try again' : null, onAction: () => { host.remove(); options.retry(); } }); return { ok: false, error }; }
      finally { clearTimeout(timer); if (requests.get(target) === token) { requests.delete(target); target.removeAttribute('aria-busy'); } }
    })();
    return token.promise;
  }
  function fieldError(input, message, existingId) {
    if (typeof input === 'string') input = document.getElementById(input);
    if (!input) return;
    const id = existingId || input.id + '-ux-error';
    let hint = document.getElementById(id);
    if (!hint) { hint = el('div', 'ux-field-error'); hint.id = id; (input.closest('.form-group') || input.parentElement).append(hint); }
    hint.textContent = message; hint.classList.add('show'); hint.hidden = false; hint.setAttribute('role', 'alert');
    input.classList.add('input-error'); input.setAttribute('aria-invalid', 'true');
    const described = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)); described.add(id);
    input.setAttribute('aria-describedby', [...described].join(' ')); input.dataset.uxError = id;
  }
  function clearField(input) {
    if (typeof input === 'string') input = document.getElementById(input);
    if (!input?.dataset.uxError) return;
    const id = input.dataset.uxError, hint = document.getElementById(id);
    if (hint) { hint.hidden = true; hint.classList.remove('show'); }
    input.classList.remove('input-error'); input.removeAttribute('aria-invalid');
    const described = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(v => v && v !== id);
    if (described.length) input.setAttribute('aria-describedby', described.join(' ')); else input.removeAttribute('aria-describedby');
    delete input.dataset.uxError;
  }
  function focusError(root = document) { root.querySelector('[aria-invalid="true"],.input-error')?.focus(); }
  document.addEventListener('input', e => clearField(e.target));
  document.addEventListener('change', e => clearField(e.target));

  function draftKey() { return user()?.id ? 'eq-editor-recovery-v1:' + user().id : null; }
  function stored() {
    try { const key=draftKey(),value=JSON.parse(sessionStorage.getItem(key)||'null');if(value&&(!Number.isFinite(value.savedAt)||Date.now()-value.savedAt>=ttl)){sessionStorage.removeItem(key);return null;}return value?.version===1&&value.owner===user()?.id&&value.role===role()&&value.items&&typeof value.items==='object'?value:null; } catch { return null; }
  }
  function capture() {
    const key = draftKey(); if (!key || !['teacher', 'admin'].includes(role())) return 0;
    const items = { ...(stored()?.items || {}) };
    for (const [name, adapter] of adapters) { try { const data = adapter.get(); if (data) items[name] = { label: adapter.label, data }; } catch (e) { console.warn('[draft-recovery] Could not capture ' + name, e); } }
    if (!Object.keys(items).length) return 0;
    try {
      const raw = JSON.stringify({ version: 1, owner: user().id, role: role(), savedAt: Date.now(), items });
      if (raw.length > 2 * 1024 * 1024) return 0;
      sessionStorage.setItem(key, raw); return Object.keys(items).length;
    } catch { return 0; }
  }
  function discard(name) {
    const saved = stored(); if (!saved) return;
    delete saved.items[name];
    try { if (Object.keys(saved.items).length) sessionStorage.setItem(draftKey(), JSON.stringify(saved)); else sessionStorage.removeItem(draftKey()); } catch {}
    offerRecovery();
  }
  async function resume(name) {
    const item = stored()?.items[name], adapter = adapters.get(name); if (!item || !adapter) return;
    const owner=user()?.id;
    try { await adapter.restore(JSON.parse(JSON.stringify(item.data)));if(user()?.id===owner)discard(name); }
    catch { if(user()?.id!==owner)return;notice('error', { title: 'This draft could not be reopened', description: 'It is still saved in this tab. Check that you still have access to the original content, then try again.' }); }
  }
  function offerRecovery() {
    document.getElementById('ux-recovery')?.remove();
    const saved = stored(), names = Object.keys(saved?.items || {}).filter(name => adapters.has(name)); if (!names.length) return;
    const box = notice('success', { id: 'ux-recovery', title: 'Unsaved editor draft available', description: 'Recovered in this browser tab. Review it before saving or publishing.', dismissible: true });
    const actions = el('div', 'ux-recovery-actions');
    for (const name of names) {
      const row = el('div', ''); const label = el('button', 'btn btn-ghost', 'Resume ' + saved.items[name].label); label.type = 'button'; label.onclick = () => window.eqWithButtonLoading ? eqWithButtonLoading(label,'Opening…',()=>resume(name)) : resume(name);
      const remove = el('button', 'btn btn-ghost', 'Discard'); remove.type = 'button'; remove.setAttribute('aria-label', 'Discard ' + saved.items[name].label + ' draft'); remove.onclick = () => discard(name); row.append(label, remove); actions.append(row);
    }
    box.append(actions);
  }
  function onLogout(expired = false) {
    loggingOut = true;
    const count = expired ? capture() : 0;
    if (!expired) { try { sessionStorage.removeItem(draftKey()); } catch {} }
    for (const adapter of adapters.values()) { try { adapter.clear?.(); } catch {} }
    document.getElementById('ux-recovery')?.remove();
    if (expired) notice('error', { id: 'ux-session', title: 'Your session has ended', description: count ? 'Sign in with the same account to recover your editor draft in this tab.' : 'Sign in again to continue. Keep this tab open; a recoverable editor draft may not be available.', dismissible: false });
  }
  function sessionBooted() {
    loggingOut = false; document.getElementById('ux-session')?.remove(); offerRecovery();
    const client = window.DBService?.getAuthClient?.();
    if (client?.auth?.onAuthStateChange && client !== authClient) {
      authSubscription?.unsubscribe?.(); authClient = client;
      const result = client.auth.onAuthStateChange(event => {
        if (event !== 'SIGNED_OUT' || loggingOut || !user()) return;
        // Capture synchronously before teardown; leave Supabase's auth callback before cleanup.
        const owner = user().id; capture();
        setTimeout(() => { if (user()?.id === owner && !loggingOut) window.doLogout?.({ expired: true }); }, 0);
      });
      authSubscription = result?.data?.subscription;
    }
  }
  function connectivity() {
    if (navigator.onLine === false) notice('offline', { id: 'ux-connectivity', dismissible: false });
    else { const old = document.getElementById('ux-connectivity'); if (old) { old.remove(); notice('success', { id: 'ux-connectivity', title: 'Connection restored', description: 'Live pages can reconnect. Check any pending actions before continuing.', duration: 6000 }); } }
  }
  window.addEventListener('offline', connectivity); window.addEventListener('online', connectivity);
  window.addEventListener('pagehide', () => { if (!loggingOut) capture(); });
  const boot = () => { connectivity(); window.AppStore?.subscribe('ux-states', (_, event) => { if (event?.type === 'session:booted') sessionBooted(); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
  window.UXStates = { render, notice, explain, task, fieldError, clearField, focusError, capture, discard, resume, offerRecovery, onLogout, registerDraft(name, adapter) { adapters.set(name, adapter); } };
})();
