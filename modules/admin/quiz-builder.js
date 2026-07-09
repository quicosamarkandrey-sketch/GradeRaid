// ══════════════════════════════════════════════════════
//  modules/admin/quiz-builder.js
//  Quest Builder — Admin CRUD for quizzes
//  Extracted from index.html (Phase 3 Day 18-19)
// ══════════════════════════════════════════════════════

let draftQuiz = null;
let draftQuizSections = []; // Phase 15 — selected class_ids for the "assign to section(s)" picker; kept separate from draftQuiz since it isn't a DB.quizzes field, it's persisted via set_quiz_sections() into quiz_sections

// ── RENDER ADMIN QUIZZES LIST ──────────────────────────
window.renderAdminQuizzes = function() {
  document.getElementById('a-quizzes').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
    <div><div style="font-family:var(--fh);font-size:26px;font-weight:900">📝 Quest Builder</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">${DB.quizzes.length} quests published</div></div>
    <button class="btn btn-primary" onclick="openQuizBuilder()">＋ Create Quest</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:14px">
    ${DB.quizzes.length ? DB.quizzes.map(q => {
      const completions = DB.students.filter(s => s.completedQuizzes.includes(q.id)).length;
      const assignedIds = (DB.quizSectionAssignments && DB.quizSectionAssignments[q.id]) || [];
      const sectionsLabel = assignedIds.length
        ? assignedIds.map(cid => (typeof getClassLabel === 'function' ? getClassLabel(cid) : cid)).join(', ')
        : 'Unassigned';
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
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="btn btn-ghost btn-sm" onclick="openEditQuiz('${q.id}')">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteQuiz('${q.id}')">🗑</button>
          </div>
        </div>
        <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
          ${q.questions.map((qq, i) => `<div style="font-size:12px;color:var(--text-muted);padding:3px 0">${i + 1}. ${qq.q} <span style="color:#d0bcff">→ ${qq.opts[qq.answer]}</span></div>`).join('')}
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
window.openQuizBuilder = function(editId = null) {
  const existing = editId ? DB.quizzes.find(q => q.id === editId) : null;
  // Phase 32: new quizzes get ownerTeacherId stamped at draft-creation
  // time; editing an existing quiz carries its owner forward automatically
  // via the JSON.parse(JSON.stringify(existing)) clone (existing already
  // has it from the Supabase pull mapping in db-service.js).
  draftQuiz = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), ownerTeacherId: currentUser.id, title: '', desc: '', xpReward: 100, coinReward: 50, timeLimit: 10, questions: [] };
  draftQuizSections = ((DB.quizSectionAssignments && DB.quizSectionAssignments[draftQuiz.id]) || []).slice();
  renderQuizBuilderModal();
};

window.openEditQuiz = function(id) { openQuizBuilder(id); };

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
  return `<div class="qb-block" id="qblock-${qi}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:#d0bcff">Question ${qi + 1}</div>
      <button class="btn btn-danger btn-xs" onclick="removeQuestion(${qi})">Remove</button>
    </div>
    <input type="text" value="${q.q}" placeholder="Type your question..." style="width:100%;margin-bottom:10px" oninput="draftQuiz.questions[${qi}].q=this.value">
    <div class="form-label" style="margin-bottom:6px">Answer choices (click ● to mark correct)</div>
    ${q.opts.map((opt, oi) => `<div class="qb-opt-row">
      <div onclick="setCorrect(${qi},${oi})" style="width:22px;height:22px;border-radius:50%;border:2px solid ${q.answer === oi ? '#4edea3' : 'var(--border2)'};background:${q.answer === oi ? 'rgba(78,222,163,.2)' : ''};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px">${q.answer === oi ? '✓' : ''}</div>
      <input type="text" value="${opt}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" oninput="draftQuiz.questions[${qi}].opts[${oi}]=this.value">
      ${q.opts.length > 2 ? `<button class="btn btn-ghost btn-xs" onclick="removeOption(${qi},${oi})">×</button>` : ''}
    </div>`).join('')}
    ${q.opts.length < 5 ? `<button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="addOption(${qi})">＋ Add option</button>` : ''}
  </div>`;
}

window.updateDraftQuizSections = function(selectEl) {
  draftQuizSections = [...selectEl.selectedOptions].map(o => o.value);
};

window.addQuestion = function() {
  draftQuiz.questions.push({ q: '', opts: ['', '', '', ''], answer: 0 });
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
  if (draftQuiz.questions.some(q => !q.q.trim() || q.opts.some(o => !o.trim()))) {
    toast('❌ Fill in all question fields', '#ffb4ab'); return;
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

console.log('[EduQuest] Admin Quiz Builder loaded.');
