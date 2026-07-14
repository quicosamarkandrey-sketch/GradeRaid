// ══════════════════════════════════════════════════════
//  modules/admin/mascot-lines.js
//  Mascot Lines — admin-only screen (Improvement Plan §6, §12 item 7).
//
//  Lets an admin add/remove custom reaction lines per event (and per stage,
//  for the events whose personality escalates with the quiz's 3-stage
//  system — see utils.js's MASCOT_DEFAULT_LINES for the exact shape).
//  Everything shown here is ADDED ON TOP of the shipped default pool —
//  there's no way to delete a default line from this screen, only to add
//  to or remove from the school's own custom set — so the mascot always
//  has plenty to say even before any admin ever visits this page.
//
//  REPOSITORY PATTERN: this file never calls DBService.rpc() directly —
//  only MascotLinesService.
//
//  Exports: renderMascotLines, mlAddLine, mlDeleteLine, saveMascotLines
// ══════════════════════════════════════════════════════

// Event catalog for this screen — id, label, and stage-key scheme.
// stageKeys: null = flat pool; ['0','1','2'] = per-quiz-stage; ['1','2'] =
// per stage BEING ENTERED (stageTransition has no "entering stage 0").
const MASCOT_LINES_EVENTS = [
  { id: 'start',           label: '🚀 Quiz Start',        stageKeys: null,           stageLabels: null },
  { id: 'retry',           label: '💪 Retry Begins',      stageKeys: null,           stageLabels: null },
  { id: 'correct',         label: '✅ Correct Answer',    stageKeys: ['0','1','2'],  stageLabels: ['Warm-Up','Surge','Overdrive'] },
  { id: 'wrong',           label: '❌ Wrong Answer',      stageKeys: ['0','1','2'],  stageLabels: ['Warm-Up','Surge','Overdrive'] },
  { id: 'milestone',       label: '🔥 Combo Milestone',   stageKeys: null,           stageLabels: null },
  { id: 'stageTransition', label: '⚡ Stage Transition',  stageKeys: ['1','2'],      stageLabels: ['Entering Surge','Entering Overdrive'] },
  { id: 'lowTime',         label: '⏱ Low Time Warning',   stageKeys: ['0','1','2'],  stageLabels: ['Warm-Up','Surge','Overdrive'] },
  { id: 'pass',            label: '🏆 Quest Passed',      stageKeys: null,           stageLabels: null },
  { id: 'fail',            label: '💀 Quest Failed',      stageKeys: null,           stageLabels: null },
];

let _mascotLinesCustom = {};
let _mascotLinesLoading = false;
let _mascotLinesError = null;
let _mascotLinesSaving = false;
let _mascotLinesUpdatedAt = null;

window.renderMascotLines = async function () {
  const el = document.getElementById('a-mascot-lines');
  if (!el) return;

  // Defense in depth — same guard as every other ADMIN_ONLY_NAV_IDS screen.
  if (currentRole !== 'admin') {
    el.innerHTML = `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:40px;color:var(--text-muted)">lock</span>
      <h2 style="font-family:var(--fh);font-size:18px;margin:12px 0 4px">Admin only</h2>
      <p style="font-size:13px;color:var(--text-muted)">This screen is only available to oversight admin accounts.</p>
    </div>`;
    return;
  }

  _mascotLinesLoading = true;
  _mascotLinesError = null;
  _mlRenderShell(el);

  const res = await MascotLinesService.get();
  _mascotLinesLoading = false;
  if (!res.ok) {
    _mascotLinesError = res.error;
  } else {
    _mascotLinesCustom = res.customLines || {};
    _mascotLinesUpdatedAt = res.updatedAt || null;
  }

  if (document.getElementById('a-mascot-lines')) _mlRenderShell(document.getElementById('a-mascot-lines'));
};

function _mlGetPool(eventId, stageKey) {
  const root = _mascotLinesCustom[eventId];
  if (stageKey === null || stageKey === undefined) {
    return Array.isArray(root) ? root : [];
  }
  return (root && Array.isArray(root[stageKey])) ? root[stageKey] : [];
}

function _mlSetPool(eventId, stageKey, pool) {
  if (stageKey === null || stageKey === undefined) {
    _mascotLinesCustom[eventId] = pool;
  } else {
    if (!_mascotLinesCustom[eventId] || Array.isArray(_mascotLinesCustom[eventId])) {
      _mascotLinesCustom[eventId] = {};
    }
    _mascotLinesCustom[eventId][stageKey] = pool;
  }
}

function _mlRenderShell(el) {
  const updatedLine = _mascotLinesUpdatedAt
    ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Last saved ${_mlEsc(new Date(_mascotLinesUpdatedAt).toLocaleString())}</div>`
    : '';

  el.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">🐲 Mascot Lines</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:2px">Custom reaction lines the quest companion can say — layered on top of the built-in defaults, never replacing them.</div>
      ${updatedLine}
    </div>
    <button class="btn-primary" onclick="saveMascotLines()" ${_mascotLinesSaving ? 'disabled' : ''} style="padding:10px 20px;border-radius:10px;font-weight:700;white-space:nowrap">
      ${_mascotLinesSaving ? 'Saving…' : '💾 Save All'}
    </button>
  </div>

  ${_mascotLinesLoading ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading…</div>` : ''}
  ${_mascotLinesError ? `<div class="glass-card" style="padding:16px;color:#ff6b6b;margin-bottom:16px">⚠️ ${_mlEsc(_mascotLinesError)}</div>` : ''}

  ${!_mascotLinesLoading ? `
  <div style="display:flex;flex-direction:column;gap:16px">
    ${MASCOT_LINES_EVENTS.map(ev => _mlRenderEventCard(ev)).join('')}
  </div>` : ''}
  `;
}

function _mlRenderEventCard(ev) {
  if (!ev.stageKeys) {
    return `
    <div class="glass-card" style="padding:20px">
      <div style="font-weight:800;font-size:15px;margin-bottom:10px">${ev.label}</div>
      ${_mlRenderPoolEditor(ev.id, null)}
    </div>`;
  }
  return `
  <div class="glass-card" style="padding:20px">
    <div style="font-weight:800;font-size:15px;margin-bottom:14px">${ev.label}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
      ${ev.stageKeys.map((sk, i) => `
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${ev.stageLabels[i]}</div>
        ${_mlRenderPoolEditor(ev.id, sk)}
      </div>`).join('')}
    </div>
  </div>`;
}

function _mlRenderPoolEditor(eventId, stageKey) {
  const pool = _mlGetPool(eventId, stageKey);
  const skAttr = (stageKey === null || stageKey === undefined) ? '' : stageKey;
  return `
  <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
    ${pool.length ? pool.map((line, i) => `
    <div style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.04);border:1px solid var(--border2);border-radius:8px;padding:6px 10px">
      <span style="flex:1;font-size:12px">${_mlEsc(line)}</span>
      <button onclick="mlDeleteLine('${eventId}','${skAttr}',${i})" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:14px;line-height:1;padding:2px" title="Remove">✕</button>
    </div>`).join('') : `<div style="font-size:11px;color:var(--text-muted);font-style:italic">No custom lines yet — defaults still apply.</div>`}
  </div>
  <div style="display:flex;gap:6px">
    <input id="ml-new-${eventId}-${skAttr}" class="form-control" placeholder="Add a line…" style="flex:1;font-size:12px;padding:8px 10px"
      onkeydown="if(event.key==='Enter'){event.preventDefault();mlAddLine('${eventId}','${skAttr}');}">
    <button onclick="mlAddLine('${eventId}','${skAttr}')" style="padding:8px 12px;border-radius:8px;background:rgba(208,188,255,0.12);border:1px solid rgba(208,188,255,0.3);color:var(--primary);font-weight:700;cursor:pointer;font-size:12px">Add</button>
  </div>`;
}

window.mlAddLine = function (eventId, stageKeyAttr) {
  const stageKey = stageKeyAttr === '' ? null : stageKeyAttr;
  const inputId = `ml-new-${eventId}-${stageKeyAttr}`;
  const inputEl = document.getElementById(inputId);
  const val = inputEl ? inputEl.value.trim() : '';
  if (!val) return;
  const pool = _mlGetPool(eventId, stageKey).slice();
  pool.push(val);
  _mlSetPool(eventId, stageKey, pool);
  _mlRenderShell(document.getElementById('a-mascot-lines'));
};

window.mlDeleteLine = function (eventId, stageKeyAttr, index) {
  const stageKey = stageKeyAttr === '' ? null : stageKeyAttr;
  const pool = _mlGetPool(eventId, stageKey).slice();
  pool.splice(index, 1);
  _mlSetPool(eventId, stageKey, pool);
  _mlRenderShell(document.getElementById('a-mascot-lines'));
};

window.saveMascotLines = async function () {
  _mascotLinesSaving = true;
  _mlRenderShell(document.getElementById('a-mascot-lines'));

  const res = await MascotLinesService.save(_mascotLinesCustom);

  _mascotLinesSaving = false;
  if (!res.ok) {
    toast('⚠️ ' + res.error, '#ff6b6b');
    _mlRenderShell(document.getElementById('a-mascot-lines'));
    return;
  }
  _mascotLinesCustom = res.customLines || {};
  _mascotLinesUpdatedAt = res.updatedAt || null;
  // Refresh the live in-memory pool the quiz screen reads from, so a
  // teacher/admin testing a quiz right after saving sees the new lines
  // without needing a full page reload.
  window._eqMascotCustomLines = _mascotLinesCustom;
  toast('✅ Saved');
  _mlRenderShell(document.getElementById('a-mascot-lines'));
};

function _mlEsc(s) {
  const d = document.createElement('div');
  d.textContent = (s === null || s === undefined) ? '' : String(s);
  return d.innerHTML;
}
