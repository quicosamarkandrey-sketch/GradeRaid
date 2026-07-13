// ══════════════════════════════════════════════════════
//  modules/admin/quiz-builder.js
//  Quest Builder — Admin CRUD for quizzes
//  Extracted from index.html (Phase 3 Day 18-19)
// ══════════════════════════════════════════════════════

let draftQuiz = null;
let draftQuizSections = []; // Phase 15 — selected class_ids for the "assign to section(s)" picker; kept separate from draftQuiz since it isn't a DB.quizzes field, it's persisted via set_quiz_sections() into quiz_sections

// ══════════════════════════════════════════════════════
//  Phase 5 — Quest Templates (quest_board_report.md §17)
//  Each template just returns a fresh array of blank questions of a given
//  shape/mix — "starter templates per question type" so building a new
//  reviewer takes minutes instead of adding every question from scratch.
//  Purely a convenience prefill for openQuizBuilder(); nothing here is
//  persisted on its own — the teacher still edits/fills in text and saves
//  normally through the existing quiz builder flow.
// ══════════════════════════════════════════════════════
const QUEST_TEMPLATES = [
  {
    id: 'tf-5', icon: '✅', label: '5-Item True/False Set',
    desc: 'Five quick T/F questions — good for a rapid-round daily quest.',
    build: () => Array.from({ length: 5 }, () => ({ type: 'tf', q: '', opts: ['True', 'False'], answer: 0 })),
  },
  {
    id: 'id-10', icon: '✏️', label: '10-Item Identification Reviewer',
    desc: 'Ten free-response identification questions — the classic Filipino-classroom reviewer format.',
    build: () => Array.from({ length: 10 }, () => ({ type: 'id', q: '', answer: '', altAnswers: [] })),
  },
  {
    id: 'mixed-10', icon: '🎯', label: 'Mixed Reviewer (5 MC + 3 ID + 2 T/F)',
    desc: 'Varies pacing between question types — how real reviewers are built.',
    build: () => ([
      ...Array.from({ length: 5 }, () => ({ type: 'mc', q: '', opts: ['', '', '', ''], answer: 0 })),
      ...Array.from({ length: 3 }, () => ({ type: 'id', q: '', answer: '', altAnswers: [] })),
      ...Array.from({ length: 2 }, () => ({ type: 'tf', q: '', opts: ['True', 'False'], answer: 0 })),
    ]),
  },
  {
    id: 'match-1', icon: '🔗', label: 'Matching Set (5 pairs)',
    desc: 'One matching-type question with 5 term/definition pairs.',
    build: () => ([{ type: 'match', q: '', pairs: Array.from({ length: 5 }, () => ({ left: '', right: '' })) }]),
  },
  {
    id: 'enum-1', icon: '📋', label: 'Enumeration (1 item, 5 blanks)',
    desc: 'A single "name N things" question worth partial credit per blank.',
    build: () => ([{ type: 'enum', q: '', answers: ['', '', '', '', ''] }]),
  },
];
window.QUEST_TEMPLATES = QUEST_TEMPLATES;

// ── RENDER ADMIN QUIZZES LIST ──────────────────────────
window.renderAdminQuizzes = function() {
  document.getElementById('a-quizzes').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
    <div><div style="font-family:var(--fh);font-size:26px;font-weight:900">📝 Quest Builder</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">${DB.quizzes.length} quests published</div></div>
    <button class="btn btn-primary" onclick="openQuestTemplateChooser()">＋ Create Quest</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:14px">
    ${DB.quizzes.length ? DB.quizzes.map(q => {
      const completions = DB.students.filter(s => s.completedQuizzes.includes(q.id)).length;
      const assignedIds = (DB.quizSectionAssignments && DB.quizSectionAssignments[q.id]) || [];
      const sectionsLabel = assignedIds.length
        ? assignedIds.map(cid => (typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)).join(', ')
        : 'Unassigned';
      // Phase 5 — scheduling badge (quest_board_report.md §18): shows the
      // teacher at a glance whether a quest is waiting to start, actively
      // running with a countdown, or already expired. eqQuizScheduleStatus()
      // returns null for the pre-Phase-5 default (no schedule set), which
      // renders nothing here — same "purely additive" posture as rarity/cadence.
      const schedStatus = (typeof eqQuizScheduleStatus === 'function') ? eqQuizScheduleStatus(q) : null;
      const schedBadge = schedStatus === 'upcoming' ? `<span class="badge-pill bp-gray">📅 Starts ${_esc(q.startDate)}</span>`
        : schedStatus === 'expired' ? `<span class="badge-pill" style="background:rgba(255,180,171,.15);color:#ffb4ab">⌛ Expired ${_esc(q.endDate)}</span>`
        : schedStatus === 'active' && q.endDate ? `<span class="badge-pill" style="background:rgba(255,185,95,.15);color:#ffb95f">⏳ Ends in ${eqDaysUntil(q.endDate)}d</span>`
        : '';
      return `<div class="glass-card">
        <div style="display:flex;align-items:center;gap:16px">
          <div style="font-size:36px;width:52px;text-align:center">📝</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700;color:var(--on-surface)">${q.title}</div>
            <div style="color:var(--text-muted);font-size:12px;margin-top:3px">${q.desc}</div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
              <span class="badge-pill bp-primary">+${q.xpReward} XP</span>
              <span class="badge-pill bp-gold">+${q.coinReward} 🪙</span>
              <span class="badge-pill bp-gray">${q.questions.length} questions</span>
              <span class="badge-pill bp-gray">⏱ ${q.timeLimit} min</span>
              <span class="badge-pill bp-green">${completions}/${DB.students.length} completed</span>
              <span class="badge-pill ${assignedIds.length ? 'bp-primary' : 'bp-gray'}" title="${_esc(sectionsLabel)}">🏫 ${assignedIds.length ? sectionsLabel : 'Unassigned'}</span>
              <span class="badge-pill" style="background:${(ACH_RARITY[eqQuizRarity(q)] || ACH_RARITY.Common).glow};color:${(ACH_RARITY[eqQuizRarity(q)] || ACH_RARITY.Common).color}">${eqQuizRarity(q)}</span>
              ${eqQuizCadence(q) !== 'standing' ? `<span class="badge-pill bp-gray">${eqQuizCadence(q) === 'daily' ? '☀️ Daily pool' : '🗓️ Weekly pool'}</span>` : ''}
              ${q.chainId ? `<span class="badge-pill" style="background:rgba(244,114,182,0.15);color:#f472b6">🔗 ${_esc(q.chainLabel || q.chainId)} · Part ${q.chainOrder || 1}</span>` : ''}
              ${schedBadge}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="btn btn-ghost btn-sm" onclick="openQuizAnalytics('${q.id}')" title="Analytics">📊</button>
            <button class="btn btn-ghost btn-sm" onclick="cloneQuiz('${q.id}')" title="Clone this quest">📋 Clone</button>
            <button class="btn btn-ghost btn-sm" onclick="openEditQuiz('${q.id}')">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteQuiz('${q.id}')">🗑</button>
          </div>
        </div>
        <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
          ${q.questions.map((qq, i) => {
            const qqType = eqQType(qq);
            const typeTag = qqType === 'id' ? 'ID' : qqType === 'tf' ? 'T/F' : qqType === 'enum' ? 'ENUM' : qqType === 'match' ? 'MATCH' : 'MC';
            const answerLabel = qqType === 'id' ? _esc(qq.answer || '')
              : qqType === 'enum' ? (Array.isArray(qq.answers) ? qq.answers.map(_esc).join(', ') : '')
              : qqType === 'match' ? (Array.isArray(qq.pairs) ? qq.pairs.map(p => `${_esc(p.left)}→${_esc(p.right)}`).join(', ') : '')
              : (qq.opts && qq.opts[qq.answer] !== undefined ? qq.opts[qq.answer] : '');
            return `<div style="font-size:12px;color:var(--text-muted);padding:3px 0"><span style="opacity:.55">[${typeTag}]</span> ${i + 1}. ${qq.q} <span style="color:#d0bcff">→ ${answerLabel}</span></div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('') : `<div style="text-align:center;padding:64px;background:rgba(35,31,56,0.7);border:1px solid var(--border);border-radius:16px;backdrop-filter:blur(12px)">
        <div style="font-size:48px;margin-bottom:12px">📝</div>
        <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:6px">No quests yet</div>
        <div style="color:var(--text-muted);font-size:13px">Create your first quest to get students earning XP!</div>
      </div>`}
  </div>`;
};

// ── OPEN QUIZ BUILDER MODAL ────────────────────────────
// Phase 5 — `templateQuestions` (optional) prefills a brand-new draft's
// question list from a QUEST_TEMPLATES entry (see openQuestTemplateChooser
// below). Ignored when editing an existing quiz (editId set) since that
// already has its own questions.
window.openQuizBuilder = function(editId = null, templateQuestions = null) {
  const existing = editId ? DB.quizzes.find(q => q.id === editId) : null;
  // Phase 32: new quizzes get ownerTeacherId stamped at draft-creation
  // time; editing an existing quiz carries its owner forward automatically
  // via the JSON.parse(JSON.stringify(existing)) clone (existing already
  // has it from the Supabase pull mapping in db-service.js).
  // Phase 3 — rarity/cadence default to the same values eqQuizRarity()/
  // eqQuizCadence() fall back to for pre-Phase-3 quizzes ('Common' /
  // 'standing'), so a quiz saved here round-trips through those helpers
  // unchanged even before this teacher ever touches the new pickers.
  // Phase 5 — startDate/endDate default to null (no schedule = always
  // available), same fallback eqQuizScheduleStatus() already treats a
  // pre-Phase-5 quiz as.
  draftQuiz = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        id: uid(), ownerTeacherId: currentUser.id, title: '', desc: '', xpReward: 100, coinReward: 50, timeLimit: 10,
        rarity: 'Common', cadence: 'standing', chainId: null, chainOrder: 1, chainLabel: '',
        startDate: null, endDate: null,
        questions: (templateQuestions && Array.isArray(templateQuestions)) ? JSON.parse(JSON.stringify(templateQuestions)) : [],
      };
  draftQuizSections = ((DB.quizSectionAssignments && DB.quizSectionAssignments[draftQuiz.id]) || []).slice();
  renderQuizBuilderModal();
};

window.openEditQuiz = function(id) { openQuizBuilder(id); };

// ── TEMPLATE CHOOSER (Phase 5, quest_board_report.md §17) ─────────────
// Shown when a teacher clicks "+ Create Quest": pick a starter template
// (prefills question shells of a given type/mix) or start from a blank
// quest. Purely a convenience step in front of the existing builder —
// nothing here is saved until the teacher actually fills in and publishes
// through openQuizBuilder()'s normal flow.
window.openQuestTemplateChooser = function() {
  showModal(`<div class="modal-h2">＋ Create Quest</div>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">Start from a template or build from scratch.</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
      <div class="glass-card" style="cursor:pointer;padding:14px 16px" onclick="closeModalForce();openQuizBuilder();">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:26px">📄</div>
          <div><div style="font-weight:700;font-size:14px">Blank Quest</div>
          <div style="color:var(--text-muted);font-size:12px">Start with zero questions and build it your way.</div></div>
        </div>
      </div>
      ${QUEST_TEMPLATES.map(t => `
      <div class="glass-card" style="cursor:pointer;padding:14px 16px" onclick="closeModalForce();openQuizBuilder(null, QUEST_TEMPLATES.find(x=>x.id==='${t.id}').build());">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:26px">${t.icon}</div>
          <div><div style="font-weight:700;font-size:14px">${_esc(t.label)}</div>
          <div style="color:var(--text-muted);font-size:12px">${_esc(t.desc)}</div></div>
        </div>
      </div>`).join('')}
    </div>
    <button class="btn btn-ghost" style="width:100%" onclick="closeModalForce()">Cancel</button>`, 'md');
};

// ── CLONE QUEST (Phase 5, quest_board_report.md §17) ───────────────────
// One-click duplication of an existing quest: new id, "(Copy)" suffix on
// the title, questions/rewards/rarity carried over as-is. Section
// assignment intentionally resets to unassigned (a clone shouldn't
// silently show up on a live section's board before the teacher reviews
// it) and chain membership resets to null (two quizzes sharing a chainId
// with the same chainOrder would just collide — safer to make the teacher
// re-chain the clone deliberately if that's what they want).
window.cloneQuiz = function(id) {
  const src = DB.quizzes.find(q => q.id === id);
  if (!src) return;
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = uid();
  clone.title = (src.title || 'Untitled Quest') + ' (Copy)';
  clone.ownerTeacherId = currentUser.id;
  clone.chainId = null; clone.chainOrder = 1; clone.chainLabel = '';
  DB.quizzes.push(clone);
  saveDB();
  renderAdminQuizzes();
  toast(`📋 Cloned "${src.title}" — edit and publish when ready.`);
  openQuizBuilder(clone.id);
};

function renderQuizBuilderModal() {
  // Phase 15: "assign to section(s)" picker — set_quiz_sections() RPC and the
  // quiz_sections junction table have existed since Phase 15's SQL shipped,
  // but nothing in the admin UI called it yet (flagged in
  // Phase14_Implementation_Summary.md). Sections come from the same
  // AppStore slice/helpers every other section dropdown in the app already
  // uses (getActiveClassIds/getClassLabel — see sections-service.js), NOT
  // from DB, since class_sections was never folded into the legacy DB blob.
  //
  // NOTE on visibility: this wires the WRITE side (persisting which
  // section(s) a quiz is assigned to, synced cross-device via Supabase).
  // Phase 27 wired the READ side too — the student-facing quest board
  // (renderStudentQuizzes() in index.html) and the dashboard's "Active
  // Quests" widget (renderStudentDashboard(), same file) now both filter
  // by quizSectionAssignments, same "opt-in scoping" pattern as
  // achievements' renderBadges(). Already-completed quizzes stay visible
  // to a student regardless of a later reassignment.
  const activeClassIds = (typeof getActiveClassIds === 'function') ? getActiveClassIds() : [];
  const sectionOpts = activeClassIds.map(cid =>
    `<option value="${cid}" ${draftQuizSections.includes(cid) ? 'selected' : ''}>${_esc(typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)}</option>`
  ).join('');

  showModal(`<div class="modal-h2">${DB.quizzes.find(q => q.id === draftQuiz.id) ? '✏️ Edit Quest' : '📝 Create Quest'}</div>
    <div class="form-group"><label class="form-label">Quest Title</label><input type="text" id="qb-title" value="${draftQuiz.title}" placeholder="e.g. Science Chapter 5 Quiz" style="width:100%" oninput="draftQuiz.title=this.value"></div>
    <div class="form-group"><label class="form-label">Description</label><input type="text" id="qb-desc" value="${draftQuiz.desc}" placeholder="Brief description..." style="width:100%" oninput="draftQuiz.desc=this.value"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">XP Reward</label><input type="number" id="qb-xp" value="${draftQuiz.xpReward}" min="0" style="width:100%" oninput="draftQuiz.xpReward=parseInt(this.value)||0"></div>
      <div class="form-group"><label class="form-label">Coin Reward</label><input type="number" id="qb-coins" value="${draftQuiz.coinReward}" min="0" style="width:100%" oninput="draftQuiz.coinReward=parseInt(this.value)||0"></div>
      <div class="form-group"><label class="form-label">Time (min)</label><input type="number" id="qb-time" value="${draftQuiz.timeLimit}" min="1" style="width:100%" oninput="draftQuiz.timeLimit=parseInt(this.value)||5"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Rarity</label>
        <select id="qb-rarity" style="width:100%" onchange="draftQuiz.rarity=this.value">${ACH_RARITIES.map(r => `<option value="${r}"${draftQuiz.rarity === r ? ' selected' : ''}>${r}</option>`).join('')}</select>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Sets the completion popup's drop tier — same palette as Achievements.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Cadence</label>
        <select id="qb-cadence" style="width:100%" onchange="draftQuiz.cadence=this.value">
          <option value="standing"${draftQuiz.cadence === 'standing' ? ' selected' : ''}>Standing (always available)</option>
          <option value="daily"${draftQuiz.cadence === 'daily' ? ' selected' : ''}>Daily quest pool</option>
          <option value="weekly"${draftQuiz.cadence === 'weekly' ? ' selected' : ''}>Weekly quest pool</option>
        </select>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Daily/weekly quests rotate — only some of the pool shows on the board at a time.</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Quest Chain (optional)</label>
        <input type="text" id="qb-chain-id" value="${draftQuiz.chainId || ''}" placeholder="e.g. chapter-5-reviewer" style="width:100%"
          onchange="draftQuiz.chainId=this.value.trim()||null;renderQuizBuilderModal();">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Quizzes sharing the same chain ID unlock in order — leave blank for a standalone quest. Same ID = same chain, across teachers.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Part #</label>
        <input type="number" id="qb-chain-order" value="${draftQuiz.chainOrder || 1}" min="1" style="width:100%" oninput="draftQuiz.chainOrder=parseInt(this.value)||1">
      </div>
    </div>
    ${draftQuiz.chainId ? `
    <div class="form-group">
      <label class="form-label">Chain Display Name</label>
      <input type="text" id="qb-chain-label" value="${draftQuiz.chainLabel || ''}" placeholder="e.g. Chapter 5 Reviewer" style="width:100%" oninput="draftQuiz.chainLabel=this.value">
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Shown as the section header on the student's Quest Board. Only needs to be set on one part of the chain.</div>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Available From (optional)</label>
        <input type="date" id="qb-start-date" value="${draftQuiz.startDate || ''}" style="width:100%" onchange="draftQuiz.startDate=this.value||null">
      </div>
      <div class="form-group">
        <label class="form-label">Available Until (optional)</label>
        <input type="date" id="qb-end-date" value="${draftQuiz.endDate || ''}" style="width:100%" onchange="draftQuiz.endDate=this.value||null">
      </div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:-6px 0 14px">Leave both blank for always-available. A quest auto-publishes on its start date and auto-expires the day after its end date — students won't see it outside this window (already-completed attempts stay in their history either way).</div>
    <div class="form-group">
      <label class="form-label">Assign to Section(s)</label>
      ${activeClassIds.length ? `
      <select id="qb-sections" multiple style="width:100%;height:96px" onchange="updateDraftQuizSections(this)">${sectionOpts}</select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Hold Ctrl/Cmd to select multiple. Leave empty to leave unassigned.</div>
      ` : `
      <div style="font-size:12px;color:var(--text-muted);background:rgba(35,31,56,.5);border-radius:8px;padding:10px 12px">No sections created yet — create one in Section Maker first.</div>
      `}
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin:4px 0 14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-weight:700;font-size:14px">Questions (${draftQuiz.questions.length})</div>
        <button class="btn btn-success btn-sm" onclick="addQuestion()">＋ Add Question</button>
      </div>
      <div id="qb-questions">
        ${draftQuiz.questions.map((q, qi) => renderQuestionBlock(q, qi)).join('')}
        ${draftQuiz.questions.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;background:rgba(35,31,56,0.5);border-radius:10px">No questions yet. Click "+ Add Question".</div>' : ''}
      </div>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="saveQuiz()" ${draftQuiz.questions.length === 0 ? 'disabled' : ''}>
        ${DB.quizzes.find(q => q.id === draftQuiz.id) ? 'Save Changes' : 'Publish Quest 🚀'}
      </button>
    </div>`, 'lg');
}

function renderQuestionBlock(q, qi) {
  const qType = eqQType(q); // Phase 1/3 — 'mc' (default), 'tf', 'id', or 'enum'
  return `<div class="qb-block" id="qblock-${qi}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:#d0bcff">Question ${qi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="removeQuestion(${qi})">Remove</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-xs ${qType === 'mc' ? 'btn-primary' : 'btn-ghost'}" onclick="setQuestionType(${qi},'mc')">🔘 Multiple Choice</button>
      <button class="btn btn-xs ${qType === 'tf' ? 'btn-primary' : 'btn-ghost'}" onclick="setQuestionType(${qi},'tf')">✅ True / False</button>
      <button class="btn btn-xs ${qType === 'id' ? 'btn-primary' : 'btn-ghost'}" onclick="setQuestionType(${qi},'id')">✏️ Identification</button>
      <button class="btn btn-xs ${qType === 'enum' ? 'btn-primary' : 'btn-ghost'}" onclick="setQuestionType(${qi},'enum')">📋 Enumeration</button>
      <button class="btn btn-xs ${qType === 'match' ? 'btn-primary' : 'btn-ghost'}" onclick="setQuestionType(${qi},'match')">🔗 Matching</button>
    </div>
    <input type="text" value="${_esc(q.q)}" placeholder="Type your question..." style="width:100%;margin-bottom:10px" oninput="draftQuiz.questions[${qi}].q=this.value">
    ${renderQuestionBody(q, qi, qType)}
  </div>`;
}

// Phase 1 — per-type editor body. mc/tf share the same radio-row markup
// (tf is just a locked 2-option mc under the hood); id gets a free-text
// answer field plus an optional "also accept" list for fuzzy matching.
function renderQuestionBody(q, qi, qType) {
  if (qType === 'tf') {
    return `<div class="form-label" style="margin-bottom:6px">Correct answer</div>
    ${['True', 'False'].map((opt, oi) => `<div class="qb-opt-row">
      <div onclick="setCorrect(${qi},${oi})" style="width:22px;height:22px;border-radius:50%;border:2px solid ${q.answer === oi ? '#4edea3' : 'var(--border2)'};background:${q.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px">${q.answer === oi ? '✓' : ''}</div>
      <span style="flex:1;padding:8px 0;font-size:13px;color:var(--on-surface)">${opt}</span>
    </div>`).join('')}`;
  }
  if (qType === 'id') {
    const altStr = Array.isArray(q.altAnswers) ? q.altAnswers.join(', ') : '';
    return `<div class="form-label" style="margin-bottom:6px">Correct answer</div>
    <input type="text" value="${_esc(q.answer || '')}" placeholder="e.g. Chlorophyll" style="width:100%;margin-bottom:8px" oninput="draftQuiz.questions[${qi}].answer=this.value">
    <div class="form-label" style="margin-bottom:6px">Also accept (optional — comma-separated)</div>
    <input type="text" value="${_esc(altStr)}" placeholder="e.g. chlorophyl, chlorophylle" style="width:100%" oninput="setAltAnswers(${qi},this.value)">
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Grading ignores capitalization, punctuation, and extra spaces automatically — students don't need to match exactly.</div>`;
  }
  if (qType === 'enum') {
    // Phase 3 — Enumeration: a flat list of correct answers, each rendered
    // as its own blank on the student side. Order doesn't matter for
    // grading (eqGradeAnswer matches each student answer against the
    // remaining pool, one-time-use), so this editor doesn't need drag
    // reordering — just add/edit/remove blanks.
    const answers = Array.isArray(q.answers) ? q.answers : [];
    return `<div class="form-label" style="margin-bottom:6px">Correct answers (one per blank)</div>
    ${answers.map((a, ai) => `<div class="qb-opt-row">
      <input type="text" value="${_esc(a)}" placeholder="Answer ${ai + 1}" style="flex:1" oninput="setEnumAnswer(${qi},${ai},this.value)">
      ${answers.length > 2 ? `<button class="btn btn-ghost btn-xs" onclick="removeEnumAnswer(${qi},${ai})">×</button>` : ''}
    </div>`).join('')}
    ${answers.length < 10 ? `<button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="addEnumAnswer(${qi})">＋ Add blank</button>` : ''}
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Students get partial credit for each blank they fill correctly — they don't need to get all of them to earn some credit. Grading ignores capitalization, punctuation, and extra spaces, same as Identification.</div>`;
  }
  if (qType === 'match') {
    // Phase 5 — Matching type editor (quest_board_report.md §2.4): each row
    // is one left/right pair. Order doesn't matter for grading (eqGradeAnswer
    // matches by pair index, not display position — the student sees the
    // right-hand column shuffled), so no reordering UI is needed, just
    // add/edit/remove rows, same shape as Enumeration's blank editor.
    const pairs = Array.isArray(q.pairs) ? q.pairs : [];
    return `<div class="form-label" style="margin-bottom:6px">Pairs (left = prompt, right = correct match)</div>
    ${pairs.map((p, pi) => `<div class="qb-opt-row">
      <input type="text" value="${_esc(p.left || '')}" placeholder="Term ${pi + 1}" style="flex:1" oninput="setMatchPair(${qi},${pi},'left',this.value)">
      <span style="color:var(--text-muted);flex-shrink:0">→</span>
      <input type="text" value="${_esc(p.right || '')}" placeholder="Match ${pi + 1}" style="flex:1" oninput="setMatchPair(${qi},${pi},'right',this.value)">
      ${pairs.length > 2 ? `<button class="btn btn-ghost btn-xs" onclick="removeMatchPair(${qi},${pi})">×</button>` : ''}
    </div>`).join('')}
    ${pairs.length < 8 ? `<button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="addMatchPair(${qi})">＋ Add pair</button>` : ''}
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Students see the right-hand column shuffled and pick a match for each left-hand term. Partial credit per correct pair, same as Enumeration.</div>`;
  }
  // mc (default)
  return `<div class="form-label" style="margin-bottom:6px">Answer choices (click ● to mark correct)</div>
  ${q.opts.map((opt, oi) => `<div class="qb-opt-row">
    <div onclick="setCorrect(${qi},${oi})" style="width:22px;height:22px;border-radius:50%;border:2px solid ${q.answer === oi ? '#4edea3' : 'var(--border2)'};background:${q.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px">${q.answer === oi ? '✓' : ''}</div>
    <input type="text" value="${_esc(opt)}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" oninput="draftQuiz.questions[${qi}].opts[${oi}]=this.value">
    ${q.opts.length > 2 ? `<button class="btn btn-ghost btn-xs" onclick="removeOption(${qi},${oi})">×</button>` : ''}
  </div>`).join('')}
  ${q.opts.length < 5 ? `<button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="addOption(${qi})">＋ Add option</button>` : ''}`;
}

// Phase 1 — switching a question's type reshapes it into that type's data
// format. Question text is preserved; answer/options reset since the
// underlying shape genuinely differs (index-based vs free-text).
window.setQuestionType = function(qi, type) {
  const preservedText = draftQuiz.questions[qi].q;
  if (type === 'tf') {
    draftQuiz.questions[qi] = { type: 'tf', q: preservedText, opts: ['True', 'False'], answer: 0 };
  } else if (type === 'id') {
    draftQuiz.questions[qi] = { type: 'id', q: preservedText, answer: '', altAnswers: [] };
  } else if (type === 'enum') {
    draftQuiz.questions[qi] = { type: 'enum', q: preservedText, answers: ['', ''] };
  } else if (type === 'match') {
    draftQuiz.questions[qi] = { type: 'match', q: preservedText, pairs: [{ left: '', right: '' }, { left: '', right: '' }] };
  } else {
    draftQuiz.questions[qi] = { type: 'mc', q: preservedText, opts: ['', '', '', ''], answer: 0 };
  }
  renderQuizBuilderModal();
};

// Phase 1 — comma-separated "also accept" list for Identification questions
window.setAltAnswers = function(qi, value) {
  draftQuiz.questions[qi].altAnswers = value.split(',').map(s => s.trim()).filter(Boolean);
};

// Phase 3 — Enumeration blank editing. Mirrors addOption/removeOption's
// shape (mc's answer-choices editor) since both are "list of strings tied
// to a question index," but these are correct-answer blanks, not
// distractor options — no setCorrect() marking needed, every blank here
// is already correct by definition.
window.setEnumAnswer = function(qi, ai, value) {
  draftQuiz.questions[qi].answers[ai] = value;
};

window.addEnumAnswer = function(qi) {
  draftQuiz.questions[qi].answers.push('');
  renderQuizBuilderModal();
};

window.removeEnumAnswer = function(qi, ai) {
  draftQuiz.questions[qi].answers.splice(ai, 1);
  renderQuizBuilderModal();
};

// Phase 5 — Matching pair editing. Mirrors setEnumAnswer's shape (list of
// items tied to a question index), but each item is a {left, right} pair.
window.setMatchPair = function(qi, pi, side, value) {
  draftQuiz.questions[qi].pairs[pi][side] = value;
};

window.addMatchPair = function(qi) {
  draftQuiz.questions[qi].pairs.push({ left: '', right: '' });
  renderQuizBuilderModal();
};

window.removeMatchPair = function(qi, pi) {
  draftQuiz.questions[qi].pairs.splice(pi, 1);
  renderQuizBuilderModal();
};

window.updateDraftQuizSections = function(selectEl) {
  draftQuizSections = [...selectEl.selectedOptions].map(o => o.value);
};

window.addQuestion = function() {
  draftQuiz.questions.push({ type: 'mc', q: '', opts: ['', '', '', ''], answer: 0 });
  renderQuizBuilderModal();
};

window.removeQuestion = function(qi) {
  draftQuiz.questions.splice(qi, 1);
  renderQuizBuilderModal();
};

window.setCorrect = function(qi, oi) {
  draftQuiz.questions[qi].answer = oi;
  renderQuizBuilderModal();
};

window.addOption = function(qi) {
  draftQuiz.questions[qi].opts.push('');
  renderQuizBuilderModal();
};

window.removeOption = function(qi, oi) {
  draftQuiz.questions[qi].opts.splice(oi, 1);
  if (draftQuiz.questions[qi].answer >= draftQuiz.questions[qi].opts.length)
    draftQuiz.questions[qi].answer = 0;
  renderQuizBuilderModal();
};

window.saveQuiz = async function() {
  if (!draftQuiz.title.trim()) { toast('❌ Title required', '#ffb4ab'); return; }
  if (draftQuiz.questions.length === 0) { toast('❌ Add at least 1 question', '#ffb4ab'); return; }
  // Phase 4 — chain fields sanitize: an empty/whitespace chainId is treated
  // as "not chained" (chainOrder/chainLabel become meaningless without it),
  // same defensive-default spirit as eqQuizChain()'s fallback in utils.js.
  draftQuiz.chainId = (draftQuiz.chainId && String(draftQuiz.chainId).trim()) || null;
  if (!draftQuiz.chainId) { draftQuiz.chainOrder = 1; draftQuiz.chainLabel = ''; }
  else if (!draftQuiz.chainOrder || draftQuiz.chainOrder < 1) draftQuiz.chainOrder = 1;
  // Phase 1/3 — validation now branches by question type: mc/tf need every
  // option filled in, id needs a non-empty correct answer, enum needs
  // every blank filled (a blank the teacher never intended to be gradeable
  // would otherwise silently count against every student's partial-credit
  // denominator — see eqGradeAnswer's correctList.length divisor).
  const invalidQuestion = draftQuiz.questions.find(q => {
    if (!q.q || !q.q.trim()) return true;
    const qType = eqQType(q);
    if (qType === 'id') return !q.answer || !String(q.answer).trim();
    if (qType === 'enum') return !Array.isArray(q.answers) || q.answers.length < 2 || q.answers.some(a => !a || !a.trim());
    if (qType === 'match') return !Array.isArray(q.pairs) || q.pairs.length < 2 || q.pairs.some(p => !p.left || !p.left.trim() || !p.right || !p.right.trim());
    return !Array.isArray(q.opts) || q.opts.some(o => !o || !o.trim());
  });
  if (invalidQuestion) {
    toast('❌ Fill in all question fields', '#ffb4ab'); return;
  }
  // Phase 5 — scheduling sanity: an end date before its start date would
  // make eqQuizScheduleStatus() report 'expired' forever (today can never
  // be both < start and > end at once unless the dates are backwards), so
  // catch it here rather than silently publishing a quest nobody can ever see.
  if (draftQuiz.startDate && draftQuiz.endDate && draftQuiz.endDate < draftQuiz.startDate) {
    toast('❌ "Available Until" must be on or after "Available From"', '#ffb4ab'); return;
  }
  const existIdx = DB.quizzes.findIndex(q => q.id === draftQuiz.id);
  if (existIdx >= 0) {
    DB.quizzes[existIdx] = draftQuiz;
    DB.students.forEach(s => { s.completedQuizzes = s.completedQuizzes.filter(id => id !== draftQuiz.id); });
  } else {
    DB.quizzes.push(draftQuiz);
  }
  saveDB();
  closeModalForce();
  const quizId = draftQuiz.id;
  const sectionIds = draftQuizSections.slice();
  draftQuiz = null;
  renderAdminQuizzes();
  toast('🚀 Quest published!');

  // Phase 15: persist the section assignment — set_quiz_sections() only
  // ever touches quiz_sections rows for THIS quiz_id, and only ones the
  // caller could have created themselves, so two teachers assigning the
  // same shared quiz to their own different sections can never stomp on
  // each other (see phase15_mail_and_quiz_sections_sync.sql). Fire-and-forget
  // like the shop/mail RPC calls — the quiz itself already saved locally,
  // this just syncs who can see it.
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    const { error } = await DBService.rpc('set_quiz_sections', { p_quiz_id: quizId, p_class_ids: sectionIds });
    if (error) {
      toast('⚠️ Quest saved, but section assignment may not have synced: ' + error.message, '#ffb95f');
    } else {
      if (!DB.quizSectionAssignments) DB.quizSectionAssignments = {};
      DB.quizSectionAssignments[quizId] = sectionIds; // optimistic — next realtime pull confirms it
    }
  }
};

window.deleteQuiz = function(id) {
  const q = DB.quizzes.find(q => q.id === id);
  showModal(`<div style="text-align:center;padding:10px"><div style="font-size:40px;margin-bottom:12px">🗑️</div><div class="modal-h2" style="text-align:center">Delete Quest?</div><div style="color:var(--text-muted);margin-bottom:20px">Remove "${q?.title}" permanently?</div><div style="display:flex;gap:10px"><button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button><button class="btn btn-danger" style="flex:1" onclick="confirmDeleteQuiz('${id}')">Delete</button></div></div>`, 'sm');
};

window.confirmDeleteQuiz = async function(id) {
  const q = DB.quizzes.find(q => q.id === id);
  DB.quizzes = DB.quizzes.filter(q => q.id !== id);
  DB.students.forEach(s => { s.completedQuizzes = s.completedQuizzes.filter(qid => qid !== id); });
  if (DB.quizSectionAssignments) delete DB.quizSectionAssignments[id];
  saveDB();
  closeModalForce();
  renderAdminQuizzes();
  toast(`🗑️ "${q?.title}" deleted`);
  // Phase 29: delete_quiz() closes the gap this comment used to flag — the
  // bulk push is upsert-only and never deletes server rows, so without
  // this the quiz would silently reappear for everyone on the next pull.
  // Same shape as delete_achievement()/delete_campaign_world(): staff-
  // checked, idempotent, cascades quiz_sections first — replacing the old
  // set_quiz_sections([]) cleanup call below it used to be, which only
  // ever cleared rows this caller owned and left the quizzes row itself
  // orphaned (same reasoning delete_title() used to replace the old
  // per-student syncTitleRevokeToServer() loop).
  if (typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    const { error } = await DBService.rpc('delete_quiz', { p_quiz_id: id });
    if (error) toast('⚠️ Removed locally, but may not have synced: ' + error.message, '#ffb95f');
  }
};

// ── QUEST ANALYTICS (Phase 5, quest_board_report.md §19) ──────────────
// Completion rate, average score, and per-question miss-rate — reads
// eqComputeQuizAnalytics() (utils.js), which itself reads DB.quizHistory.
// Per-question stats only reflect attempts logged since Phase 5 (the
// `results` array on each history entry is new this phase); older
// attempts still count toward completion rate / average score, they just
// can't contribute a per-question breakdown — see that helper's comment.
window.openQuizAnalytics = function(id) {
  const q = DB.quizzes.find(qz => qz.id === id);
  if (!q || typeof eqComputeQuizAnalytics !== 'function') return;
  const a = eqComputeQuizAnalytics(id);
  const barRow = (pq) => {
    const known = pq.pctCorrect !== null;
    const pct = known ? pq.pctCorrect : 0;
    const color = !known ? 'var(--border2)' : pct >= 70 ? '#4edea3' : pct >= 40 ? '#ffb95f' : '#ffb4ab';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="color:var(--on-surface)">Q${pq.index + 1}. ${_esc(pq.text || '(untitled)')}</span>
        <span style="color:${color};font-weight:700;flex-shrink:0;margin-left:8px">${known ? pct + '%' : 'no data'}</span>
      </div>
      <div style="height:8px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden">
        <div style="height:100%;width:${known ? pct : 0}%;background:${color};border-radius:4px"></div>
      </div>
    </div>`;
  };
  const sorted = a.perQuestion.slice().filter(pq => pq.pctCorrect !== null).sort((x, y) => x.pctCorrect - y.pctCorrect);
  const hardest = sorted.slice(0, 3);
  showModal(`<div class="modal-h2">📊 ${_esc(q.title)} — Analytics</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px">
      <div class="glass-card" style="text-align:center;padding:14px">
        <div style="font-size:22px;font-weight:900;color:var(--primary)">${a.completionRate}%</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${a.completedCount}/${a.totalStudents} completed</div>
      </div>
      <div class="glass-card" style="text-align:center;padding:14px">
        <div style="font-size:22px;font-weight:900;color:var(--secondary)">${a.avgScore !== null ? a.avgScore + '%' : '—'}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Average score</div>
      </div>
      <div class="glass-card" style="text-align:center;padding:14px">
        <div style="font-size:22px;font-weight:900;color:var(--tertiary)">${a.attemptCount}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Total attempts</div>
      </div>
    </div>
    ${hardest.length ? `<div style="font-size:12px;font-weight:700;color:#ffb4ab;margin-bottom:10px">⚠️ Most-missed questions</div>
    <div style="margin-bottom:18px">${hardest.map(barRow).join('')}</div>` : ''}
    <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:10px">All questions</div>
    <div style="max-height:280px;overflow-y:auto;padding-right:4px">${a.perQuestion.map(barRow).join('') || '<div style="color:var(--text-muted);font-size:13px">No questions in this quest yet.</div>'}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:10px">"No data" means every logged attempt for that question predates per-question tracking, or the quest hasn't been attempted yet.</div>
    <button class="btn btn-ghost" style="width:100%;margin-top:14px" onclick="closeModalForce()">Close</button>`, 'lg');
};

console.log('[EduQuest] Admin Quiz Builder loaded.');
