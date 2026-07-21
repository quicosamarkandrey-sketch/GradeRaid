// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/starter-pack-editor.js
//  Admin-only "Starter Pack" screen: maintain the template content
//  seed_new_teacher() copies into every brand-new teacher account, instead of
//  it being frozen in a migration file forever.
//  (ISOLATION_ROLES_PLAN.md §6/§7/§11, §12 step 5, chunk B — see
//   supabase/phase38_starter_pack.sql and starter-pack-service.js.)
//
//  REPOSITORY PATTERN CONTRACT: this file never calls DBService.rpc()
//  directly — it only calls StarterPackService.<method>(...).
//
//  Edit/delete buttons pass an ARRAY INDEX into _spPack[tab], not a
//  serialized object — same convention already used elsewhere in this app
//  (adminEditStage(wi, si), setCorrect(qi, oi)) rather than embedding JSON
//  into onclick attributes.
//
//  Scope note (v1, matches phase38's SQL-side note): title cosmetics here
//  cover the core fields (name/description/icon/rarity/active + 4 basic
//  colors) — full gradients/animations/particles/custom CSS stay editable
//  only on a teacher's OWN copy after seeding, same as today. Quiz questions
//  and campaign stages are edited here too (repeatable list for quiz
//  questions; raw JSON textarea for campaign stages) rather than reusing
//  the full Quest Builder / Stage Map Editor, matching §11's "small screen"
//  framing.
// ═══════════════════════════════════════════════════════════════════════════════

let _spPack = { achievements: [], titles: [], quizzes: [], campaignWorlds: [], shopProducts: [] };
let _spTab = 'achievements';

const _SP_TABS = [
  { id: 'achievements',   label: 'Achievements',    icon: '🏅' },
  { id: 'titles',         label: 'Titles',          icon: '🎖️' },
  { id: 'quizzes',        label: 'Quiz',            icon: '📝' },
  { id: 'campaignWorlds', label: 'Campaign World',  icon: '🗺️' },
  { id: 'shopProducts',   label: 'Shop Items',      icon: '🏪' },
];

// ── Main renderer ─────────────────────────────────────────────────────────────

window.renderStarterPackEditor = async function () {
  const el = document.getElementById('a-starter-pack');
  if (!el) return;
  el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">Loading starter pack…</div>`;

  const res = await StarterPackService.fetch();
  if (!res.ok) {
    el.innerHTML = `<div class="glass-card" style="padding:24px;color:#ff6b6b">⚠️ ${_spEsc(res.error)}</div>`;
    return;
  }
  _spPack = res.pack;
  _spRenderShell();
};

function _spRenderShell() {
  const el = document.getElementById('a-starter-pack');
  if (!el) return;
  el.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">🎁 Starter Pack Editor</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">The content every brand-new teacher account is seeded with, one time, at account creation.</div>
    </div>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
    ${_SP_TABS.map(t => `
      <button class="btn ${_spTab === t.id ? 'btn-primary' : 'btn-ghost'}" onclick="_spSwitchTab('${t.id}')">
        ${t.icon} ${t.label} <span style="opacity:.6;font-size:11px">(${(_spPack[t.id] || []).length})</span>
      </button>
    `).join('')}
  </div>
  <div id="sp-tab-body"></div>`;
  _spRenderTabBody();
}

window._spSwitchTab = function (id) {
  _spTab = id;
  _spRenderTabBody();
};

function _spRenderTabBody() {
  const body = document.getElementById('sp-tab-body');
  if (!body) return;
  if (_spTab === 'achievements') return _spRenderAchievements(body);
  if (_spTab === 'titles') return _spRenderTitles(body);
  if (_spTab === 'quizzes') return _spRenderQuizzes(body);
  if (_spTab === 'campaignWorlds') return _spRenderCampaignWorlds(body);
  if (_spTab === 'shopProducts') return _spRenderShopProducts(body);
}

async function _spRefreshAndRender() {
  const res = await StarterPackService.fetch();
  if (res.ok) _spPack = res.pack;
  _spRenderShell();
}

// ── Achievements ───────────────────────────────────────────────────────────────

function _spRenderAchievements(body) {
  const rows = _spPack.achievements || [];
  body.innerHTML = `
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn btn-primary" onclick="_spOpenAchievementForm(-1)">＋ Add Achievement</button>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Name</th><th>Category</th><th>Rarity</th><th>Trigger</th><th style="text-align:right">Reward</th><th style="width:120px"></th></tr></thead>
      <tbody>
        ${rows.map((a, i) => `
          <tr>
            <td style="font-size:20px">${a.icon || '🏅'}</td>
            <td><strong>${_spEsc(a.name)}</strong><div style="font-size:11px;color:var(--text-muted)">${_spEsc(a.description || '')}</div></td>
            <td>${_spEsc(a.category || '—')}</td>
            <td>${_spEsc(a.rarity)}</td>
            <td style="font-size:12px;color:var(--text-muted)">${_spEsc(a.triggerType)} ≥ ${a.triggerValue}</td>
            <td style="text-align:right;font-size:12px">${a.xpReward} XP / ${a.coinReward} 🪙</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="_spOpenAchievementForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_spDeleteAchievement(${i})">🗑️</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No starter achievements yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._spOpenAchievementForm = function (idx) {
  const d = idx >= 0 ? _spPack.achievements[idx] : { id: 'starter-ach-' + uid(), name: '', description: '', icon: '🏅', category: 'General', rarity: 'Common', xpReward: 30, coinReward: 15, triggerType: 'manual', triggerValue: 1, active: true };
  window._spEditBaseId = d.id;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Achievement</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Name</label><input id="sp-a-name" class="form-control" value="${_spEscAttr(d.name)}"></div>
      <div><label class="form-label">Icon (emoji)</label><input id="sp-a-icon" class="form-control" value="${_spEscAttr(d.icon)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="sp-a-desc" class="form-control" value="${_spEscAttr(d.description)}"></div>
      <div><label class="form-label">Category</label><input id="sp-a-cat" class="form-control" value="${_spEscAttr(d.category)}"></div>
      <div><label class="form-label">Rarity</label>
        <select id="sp-a-rarity" class="form-control">${(window.ACH_RARITIES || ['Common','Uncommon','Rare','Epic','Legendary','Mythic']).map(r => `<option value="${r}"${d.rarity === r ? ' selected' : ''}>${r}</option>`).join('')}</select>
      </div>
      <div><label class="form-label">Trigger Type</label>
        <select id="sp-a-trigger">${(window.ACH_TRIGGER_TYPES || [{value:'manual',label:'Manual'}]).map(t => `<option value="${t.value}"${d.triggerType === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}</select>
      </div>
      <div><label class="form-label">Trigger Value</label><input id="sp-a-tval" class="form-control" type="number" min="0" value="${d.triggerValue || 1}"></div>
      <div><label class="form-label">XP Reward</label><input id="sp-a-xp" class="form-control" type="number" min="0" value="${d.xpReward || 0}"></div>
      <div><label class="form-label">Coin Reward</label><input id="sp-a-coin" class="form-control" type="number" min="0" value="${d.coinReward || 0}"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_spSaveAchievement()">Save</button>
    </div>
  `, 'md');
};

window._spSaveAchievement = async function () {
  const row = {
    id: window._spEditBaseId,
    name: document.getElementById('sp-a-name').value.trim(),
    description: document.getElementById('sp-a-desc').value.trim(),
    icon: document.getElementById('sp-a-icon').value.trim() || '🏅',
    category: document.getElementById('sp-a-cat').value.trim() || 'General',
    rarity: document.getElementById('sp-a-rarity').value,
    triggerType: document.getElementById('sp-a-trigger').value,
    triggerValue: parseInt(document.getElementById('sp-a-tval').value) || 0,
    xpReward: parseInt(document.getElementById('sp-a-xp').value) || 0,
    coinReward: parseInt(document.getElementById('sp-a-coin').value) || 0,
    active: true,
  };
  if (!row.name) { toast('⚠️ Name is required', '#ff6b6b'); return; }
  const res = await StarterPackService.saveAchievement(row);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _spRefreshAndRender();
};

window._spDeleteAchievement = async function (idx) {
  const row = _spPack.achievements[idx];
  if (!row) return;
  if (!confirm(`Remove "${row.name}" from the starter pack?`)) return;
  const res = await StarterPackService.deleteAchievement(row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Removed');
  _spRefreshAndRender();
};

// ── Titles ───────────────────────────────────────────────────────────────────

function _spRenderTitles(body) {
  const rows = _spPack.titles || [];
  body.innerHTML = `
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn btn-primary" onclick="_spOpenTitleForm(-1)">＋ Add Title</button>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Name</th><th>Description</th><th>Rarity</th><th style="width:120px"></th></tr></thead>
      <tbody>
        ${rows.map((t, i) => `
          <tr>
            <td style="font-size:20px">${t.icon || '🎖️'}</td>
            <td><strong style="color:${t.textColor || 'inherit'}">${_spEsc(t.name)}</strong></td>
            <td style="font-size:12px;color:var(--text-muted)">${_spEsc(t.description || '')}</td>
            <td>${_spEsc(t.rarity)}</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="_spOpenTitleForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_spDeleteTitle(${i})">🗑️</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No starter titles yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._spOpenTitleForm = function (idx) {
  const d = idx >= 0 ? _spPack.titles[idx] : { id: 'starter-title-' + uid(), name: '', description: '', icon: '🎖️', rarity: 'Common', textColor: '#d0bcff', borderColor: '#8b5cf6', glowColor: 'rgba(139,92,246,0.3)', bgColor: 'rgba(139,92,246,0.08)', active: true };
  window._spEditBaseId = d.id;
  window._spEditBaseGlow = d.glowColor || null;
  window._spEditBaseBg = d.bgColor || null;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Title</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Name</label><input id="sp-t-name" class="form-control" value="${_spEscAttr(d.name)}"></div>
      <div><label class="form-label">Icon (emoji)</label><input id="sp-t-icon" class="form-control" value="${_spEscAttr(d.icon)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="sp-t-desc" class="form-control" value="${_spEscAttr(d.description)}"></div>
      <div><label class="form-label">Rarity</label>
        <select id="sp-t-rarity" class="form-control">${(window.ACH_RARITIES || ['Common','Uncommon','Rare','Epic','Legendary','Mythic']).map(r => `<option value="${r}"${d.rarity === r ? ' selected' : ''}>${r}</option>`).join('')}</select>
      </div>
      <div><label class="form-label">Text Color</label><input id="sp-t-text" class="form-control" type="color" value="${_spToHex(d.textColor)}"></div>
      <div><label class="form-label">Border Color</label><input id="sp-t-border" class="form-control" type="color" value="${_spToHex(d.borderColor)}"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Manual-grant only — like every other starter title, this is awarded by a teacher, not triggered by a stat. Glow/background colors and other cosmetic styling can be fine-tuned by each teacher after this is copied into their own account.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_spSaveTitle()">Save</button>
    </div>
  `, 'md');
};

window._spSaveTitle = async function () {
  const row = {
    id: window._spEditBaseId,
    name: document.getElementById('sp-t-name').value.trim(),
    description: document.getElementById('sp-t-desc').value.trim(),
    icon: document.getElementById('sp-t-icon').value.trim() || '🎖️',
    rarity: document.getElementById('sp-t-rarity').value,
    textColor: document.getElementById('sp-t-text').value,
    borderColor: document.getElementById('sp-t-border').value,
    glowColor: window._spEditBaseGlow,
    bgColor: window._spEditBaseBg,
    active: true,
  };
  if (!row.name) { toast('⚠️ Name is required', '#ff6b6b'); return; }
  const res = await StarterPackService.saveTitle(row);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _spRefreshAndRender();
};

window._spDeleteTitle = async function (idx) {
  const row = _spPack.titles[idx];
  if (!row) return;
  if (!confirm(`Remove "${row.name}" from the starter pack?`)) return;
  const res = await StarterPackService.deleteTitle(row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Removed');
  _spRefreshAndRender();
};

// ── Quiz ───────────────────────────────────────────────────────────────────────
// v1 scope: one lightweight form. Questions are edited as a small repeatable
// list here rather than reusing the full Quest Builder UI, matching §11's
// "small screen" framing — a teacher gets the full Quest Builder for their
// own copy after it's seeded.

function _spRenderQuizzes(body) {
  const rows = _spPack.quizzes || [];
  body.innerHTML = `
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn btn-primary" onclick="_spOpenQuizForm(-1)">＋ Add Quiz</button>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th>Title</th><th>Questions</th><th>Chain / Schedule</th><th style="text-align:right">Reward</th><th style="width:120px"></th></tr></thead>
      <tbody>
        ${rows.map((q, i) => `
          <tr>
            <td><strong>${_spEsc(q.title)}</strong><div style="font-size:11px;color:var(--text-muted)">${_spEsc(q.description || '')}</div></td>
            <td>${(q.questions || []).length}</td>
            <td>${_spQuizChainScheduleBadges(q)}</td>
            <td style="text-align:right;font-size:12px">${q.xpReward} XP / ${q.coinReward} 🪙</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="_spOpenQuizForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_spDeleteQuiz(${i})">🗑️</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No starter quiz yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

// Chain/schedule are edited exclusively in Quest Builder (no form fields for
// them on this screen — see saveQuiz's Phase 60 pass-through note in
// starter-pack-service.js), so this is read-only visibility: lets an admin
// see, before they Edit or 🗑️ a row, that it's part of a chain or has an
// active window, using the same badge styling/helpers quiz-builder.js uses.
function _spQuizChainScheduleBadges(q) {
  const parts = [];
  if (q.chainId) {
    parts.push(`<span class="badge-pill" style="background:rgba(244,114,182,0.15);color:#f472b6">🔗 ${_spEsc(q.chainLabel || q.chainId)} · Part ${q.chainOrder || 1}</span>`);
  }
  const status = (typeof eqQuizScheduleStatus === 'function') ? eqQuizScheduleStatus(q) : null;
  if (status === 'upcoming') parts.push(`<span class="badge-pill bp-gray">📅 Starts ${_spEsc(q.startDate)}</span>`);
  else if (status === 'expired') parts.push(`<span class="badge-pill" style="background:rgba(255,180,171,.15);color:#ffb4ab">⌛ Expired ${_spEsc(q.endDate)}</span>`);
  else if (status === 'active' && q.endDate) parts.push(`<span class="badge-pill" style="background:rgba(255,185,95,.15);color:#ffb95f">⏳ Ends ${_spEsc(q.endDate)}</span>`);
  return parts.join(' ') || `<span style="color:var(--text-muted);font-size:11px">—</span>`;
}

window._spOpenQuizForm = function (idx) {
  const d = idx >= 0 ? _spPack.quizzes[idx] : { id: 'starter-quiz-' + uid(), title: '', description: '', xpReward: 20, coinReward: 10, timeLimit: 5, rarity: 'Common', cadence: 'standing', questions: [], active: true };
  window._spQuizDraft = JSON.parse(JSON.stringify(d));
  _spRenderQuizModal();
};

function _spRenderQuizModal() {
  const d = window._spQuizDraft;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${d.title ? 'Edit' : 'Add'} Quiz</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div style="grid-column:1/-1"><label class="form-label">Title</label><input id="sp-q-title" class="form-control" value="${_spEscAttr(d.title)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="sp-q-desc" class="form-control" value="${_spEscAttr(d.description)}"></div>
      <div><label class="form-label">XP Reward</label><input id="sp-q-xp" class="form-control" type="number" min="0" value="${d.xpReward || 0}"></div>
      <div><label class="form-label">Coin Reward</label><input id="sp-q-coin" class="form-control" type="number" min="0" value="${d.coinReward || 0}"></div>
      <div><label class="form-label">Time Limit (min)</label><input id="sp-q-time" class="form-control" type="number" min="0" value="${d.timeLimit || 0}"></div>
      <div><label class="form-label">Rarity</label><select id="sp-q-rarity" class="form-control">${ACH_RARITIES.map(r => `<option value="${r}"${(d.rarity||'Common') === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label class="form-label">Cadence</label><select id="sp-q-cadence" class="form-control">
        <option value="standing"${(d.cadence||'standing') === 'standing' ? ' selected' : ''}>Standing</option>
        <option value="daily"${d.cadence === 'daily' ? ' selected' : ''}>Daily pool</option>
        <option value="weekly"${d.cadence === 'weekly' ? ' selected' : ''}>Weekly pool</option>
      </select></div>
    </div>
    <div class="form-label" style="margin-bottom:6px">Questions</div>
    <div id="sp-q-questions">${_spQuizQuestionsHTML(d.questions)}</div>
    <button class="btn btn-ghost btn-sm" onclick="_spAddQuizQuestion()" style="margin-top:6px">＋ Question</button>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_spSaveQuiz()">Save</button>
    </div>
  `, 'lg');
}

function _spQuizQuestionsHTML(questions) {
  return (questions || []).map((qq, qi) => `
    <div style="border:1px solid var(--border2);border-radius:8px;padding:10px;margin-bottom:8px">
      <input class="form-control" placeholder="Question text..." value="${_spEscAttr(qq.q)}" oninput="_spQuizDraft.questions[${qi}].q=this.value" style="margin-bottom:8px">
      ${(qq.opts || ['', '', '', '']).map((opt, oi) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <div onclick="_spQuizDraft.questions[${qi}].answer=${oi};_spRenderQuizModal()" style="width:20px;height:20px;border-radius:50%;border:2px solid ${qq.answer === oi ? '#4edea3' : 'var(--border2)'};background:${qq.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px">${qq.answer === oi ? '✓' : ''}</div>
          <input class="form-control" placeholder="Option ${String.fromCharCode(65 + oi)}" value="${_spEscAttr(opt)}" oninput="_spQuizDraft.questions[${qi}].opts[${oi}]=this.value" style="flex:1">
        </div>`).join('')}
      <button class="btn btn-ghost btn-sm" onclick="_spQuizDraft.questions.splice(${qi},1);_spRenderQuizModal()" style="margin-top:4px">Remove question</button>
    </div>`).join('') || `<div style="color:var(--text-muted);font-size:12px">No questions yet.</div>`;
}

window._spAddQuizQuestion = function () {
  window._spQuizDraft.questions.push({ q: '', opts: ['', '', '', ''], answer: 0 });
  _spRenderQuizModal();
};

window._spSaveQuiz = async function () {
  const d = window._spQuizDraft;
  d.title = document.getElementById('sp-q-title').value.trim();
  d.description = document.getElementById('sp-q-desc').value.trim();
  d.xpReward = parseInt(document.getElementById('sp-q-xp').value) || 0;
  d.coinReward = parseInt(document.getElementById('sp-q-coin').value) || 0;
  d.timeLimit = parseInt(document.getElementById('sp-q-time').value) || null;
  d.rarity = document.getElementById('sp-q-rarity').value;
  d.cadence = document.getElementById('sp-q-cadence').value;
  if (!d.title) { toast('⚠️ Title is required', '#ff6b6b'); return; }
  const res = await StarterPackService.saveQuiz(d);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _spRefreshAndRender();
};

window._spDeleteQuiz = async function (idx) {
  const row = _spPack.quizzes[idx];
  if (!row) return;
  const chainNote = row.chainId ? ` This is Part ${row.chainOrder || 1} of the "${row.chainLabel || row.chainId}" chain — the other steps aren't deleted, but this step's slot will disappear from that chain.` : '';
  if (!confirm(`Remove "${row.title}" from the starter pack?${chainNote}`)) return;
  const res = await StarterPackService.deleteQuiz(row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Removed');
  _spRefreshAndRender();
};

// ── Campaign World ─────────────────────────────────────────────────────────────
// v1 scope: label/icon/color/description are editable here; `stages` (the
// nested scenes/enemies/questions) is a raw JSON textarea — same "small
// screen" reasoning as quiz above, since a full Stage Map Editor rebuild for
// template content is out of scope for this pass.

function _spRenderCampaignWorlds(body) {
  const rows = _spPack.campaignWorlds || [];
  body.innerHTML = `
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn btn-primary" onclick="_spOpenWorldForm(-1)">＋ Add World</button>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Label</th><th>Stages</th><th style="width:120px"></th></tr></thead>
      <tbody>
        ${rows.map((w, i) => `
          <tr>
            <td style="font-size:20px">${w.icon || '🗺️'}</td>
            <td><strong>${_spEsc(w.label)}</strong><div style="font-size:11px;color:var(--text-muted)">${_spEsc(w.description || '')}</div></td>
            <td>${(w.stages || []).length}</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="_spOpenWorldForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_spDeleteWorld(${i})">🗑️</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No starter campaign world yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._spOpenWorldForm = function (idx) {
  const d = idx >= 0 ? _spPack.campaignWorlds[idx] : { id: 'starter-world-' + uid(), label: '', icon: '🗺️', color: '#8b5cf6', description: '', stages: [], active: true };
  window._spEditBaseId = d.id;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Campaign World</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Label</label><input id="sp-w-label" class="form-control" value="${_spEscAttr(d.label)}"></div>
      <div><label class="form-label">Icon (emoji)</label><input id="sp-w-icon" class="form-control" value="${_spEscAttr(d.icon)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="sp-w-desc" class="form-control" value="${_spEscAttr(d.description)}"></div>
      <div><label class="form-label">Color</label><input id="sp-w-color" class="form-control" type="color" value="${_spToHex(d.color)}"></div>
    </div>
    <div style="margin-top:12px">
      <label class="form-label">Stages (raw JSON — scenes/enemies/questions/outro)</label>
      <textarea id="sp-w-stages" class="form-control" rows="10" style="font-family:monospace;font-size:11px">${_spEsc(JSON.stringify(d.stages || [], null, 2))}</textarea>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_spSaveWorld()">Save</button>
    </div>
  `, 'lg');
};

window._spSaveWorld = async function () {
  let stages;
  try {
    stages = JSON.parse(document.getElementById('sp-w-stages').value || '[]');
  } catch (e) {
    toast('⚠️ Stages must be valid JSON: ' + e.message, '#ff6b6b');
    return;
  }
  const row = {
    id: window._spEditBaseId,
    label: document.getElementById('sp-w-label').value.trim(),
    icon: document.getElementById('sp-w-icon').value.trim() || '🗺️',
    color: document.getElementById('sp-w-color').value,
    description: document.getElementById('sp-w-desc').value.trim(),
    stages,
    active: true,
  };
  if (!row.label) { toast('⚠️ Label is required', '#ff6b6b'); return; }
  const res = await StarterPackService.saveCampaignWorld(row);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _spRefreshAndRender();
};

window._spDeleteWorld = async function (idx) {
  const row = _spPack.campaignWorlds[idx];
  if (!row) return;
  if (!confirm(`Remove "${row.label}" from the starter pack?`)) return;
  const res = await StarterPackService.deleteCampaignWorld(row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Removed');
  _spRefreshAndRender();
};

// ── Shop Items ─────────────────────────────────────────────────────────────────

function _spRenderShopProducts(body) {
  const rows = _spPack.shopProducts || [];
  body.innerHTML = `
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn btn-primary" onclick="_spOpenShopForm(-1)">＋ Add Shop Item</button>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead><tr><th></th><th>Name</th><th>Category</th><th style="text-align:right">Cost</th><th style="width:120px"></th></tr></thead>
      <tbody>
        ${rows.map((p, i) => `
          <tr>
            <td style="font-size:20px">${p.emoji || '🎁'}</td>
            <td><strong>${_spEsc(p.name)}</strong><div style="font-size:11px;color:var(--text-muted)">${_spEsc(p.description || '')}</div></td>
            <td>${_spEsc(p.category || '—')}</td>
            <td style="text-align:right">${p.cost} 🪙</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="_spOpenShopForm(${i})">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="_spDeleteShopItem(${i})">🗑️</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No starter shop items yet.</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

window._spOpenShopForm = function (idx) {
  const d = idx >= 0 ? _spPack.shopProducts[idx] : { id: 'starter-shop-' + uid(), name: '', emoji: '🎁', description: '', category: 'General', cost: 50, active: true };
  window._spEditBaseId = d.id;
  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:16px">${idx >= 0 ? 'Edit' : 'Add'} Shop Item</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="form-label">Name</label><input id="sp-p-name" class="form-control" value="${_spEscAttr(d.name)}"></div>
      <div><label class="form-label">Emoji</label><input id="sp-p-emoji" class="form-control" value="${_spEscAttr(d.emoji)}"></div>
      <div style="grid-column:1/-1"><label class="form-label">Description</label><input id="sp-p-desc" class="form-control" value="${_spEscAttr(d.description)}"></div>
      <div><label class="form-label">Category</label><input id="sp-p-cat" class="form-control" value="${_spEscAttr(d.category)}"></div>
      <div><label class="form-label">Cost (coins)</label><input id="sp-p-cost" class="form-control" type="number" min="0" value="${d.cost || 0}"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:10px">Stock isn't set here — every teacher's copy starts unlimited (null stock) and they restock/limit it themselves after seeding.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" onclick="_spSaveShopItem()">Save</button>
    </div>
  `, 'md');
};

window._spSaveShopItem = async function () {
  const row = {
    id: window._spEditBaseId,
    name: document.getElementById('sp-p-name').value.trim(),
    emoji: document.getElementById('sp-p-emoji').value.trim() || '🎁',
    description: document.getElementById('sp-p-desc').value.trim(),
    category: document.getElementById('sp-p-cat').value.trim() || 'General',
    cost: parseInt(document.getElementById('sp-p-cost').value) || 0,
    active: true,
  };
  if (!row.name) { toast('⚠️ Name is required', '#ff6b6b'); return; }
  const res = await StarterPackService.saveShopItem(row);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  closeModalForce();
  toast('✅ Saved');
  _spRefreshAndRender();
};

window._spDeleteShopItem = async function (idx) {
  const row = _spPack.shopProducts[idx];
  if (!row) return;
  if (!confirm(`Remove "${row.name}" from the starter pack?`)) return;
  const res = await StarterPackService.deleteShopItem(row.id);
  if (!res.ok) { toast('⚠️ ' + res.error, '#ff6b6b'); return; }
  toast('🗑️ Removed');
  _spRefreshAndRender();
};

// ── Small local helpers (prefixed _sp to avoid colliding with similarly-
//    named helpers in other admin pages) ────────────────────────────────────

function _spEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _spEscAttr(s) { return _spEsc(s); }
function _spToHex(c) {
  // Best-effort: <input type=color> requires #rrggbb. rgba(...)/named colors
  // fall back to a neutral default rather than breaking the color picker.
  if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#8b5cf6';
}
