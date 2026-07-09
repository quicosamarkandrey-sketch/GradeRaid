// ═══════════════════════════════════════════════════════════════════════════
// modules/mail/admin-compose.js
// Phase 3 Day 1 extraction — Admin Mail composer / management UI.
// Depends on: mail-engine.js (mailIsRead, mailIsClaimed),
//             shared/dom.js (showModal, closeModalForce, toast),
//             shared/utils.js (uid),
//             modules/titles (DB.titles for title-grant rewards).
// Verbatim move from index.html (Phase 3 EXTRACTION_PLAN.md, Day 1).
// Classic script — shares global scope with the rest of the app.
// ═══════════════════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────────────
// MAIL SYSTEM — ADMIN SIDE
// ─────────────────────────────────────────────────────────────────────────────

const MAIL_TYPES = [
  {value:'announcement',label:'📢 Announcement',desc:'Class-wide notice'},
  {value:'reward',label:'🎁 Reward Grant',desc:'Distribute earned rewards'},
  {value:'gift',label:'🎀 Gift',desc:'Surprise gift for student(s)'},
  {value:'event',label:'🎉 Event Reward',desc:'Special event compensation'},
  {value:'title',label:'🎖️ Title Grant',desc:'Grant a title via mail'},
  {value:'compensation',label:'💎 Compensation',desc:'Make up for an issue'},
  {value:'general',label:'📬 General',desc:'Other messages'},
];

window.renderAdminMail = function(){
  DB = loadDB();
  const mails = [...(DB.mail||[])].sort((a,b)=>new Date(b.sentAt)-new Date(a.sentAt));
  const totalSent = mails.length;
  const withRewards = mails.filter(m=>m.hasReward).length;
  const totalRecipients = mails.reduce((s,m)=>s+(m.to==='all'?DB.students.length:(m.to||[]).length),0);

  document.getElementById('a-mail').innerHTML = `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-family:var(--fm);font-size:10px;color:var(--primary);letter-spacing:.16em;margin-bottom:6px">ADMIN // MAIL_SYSTEM</div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">📬 Mail System</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">Send announcements, rewards, and gifts to students</div>
    </div>
    <button class="btn btn-primary" onclick="mailAdminOpenCompose()">
      <span class="material-symbols-outlined" style="font-size:16px">edit</span>
      Compose Mail
    </button>
  </div>

  <div class="ach-stats-bar" style="margin-bottom:24px">
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--primary)">${totalSent}</div><div class="ach-stat-lbl">Sent</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--tertiary)">${withRewards}</div><div class="ach-stat-lbl">With Rewards</div></div>
    <div class="ach-stat-card"><div class="ach-stat-val" style="color:var(--secondary)">${totalRecipients}</div><div class="ach-stat-lbl">Total Recipients</div></div>
  </div>

  ${mails.length===0?`
  <div class="mail-empty">
    <div class="mail-empty-icon">📮</div>
    <div class="mail-empty-title">No mail sent yet</div>
    <div class="mail-empty-sub">Compose your first message to get started.</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="mailAdminOpenCompose()">Compose Mail</button>
  </div>`:
  mails.map(m=>{
    const recipientLabel = m.to==='all'?`All Students (${DB.students.length})`
      :Array.isArray(m.to)?m.to.map(sid=>{const s=DB.students.find(x=>x.id===sid);return s?s.name:sid;}).join(', ')
      :m.to;
    const timeStr = new Date(m.sentAt).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const claimsCount = Array.isArray(m.to)?m.to.filter(sid=>mailIsClaimed(m,sid)).length
      :m.to==='all'?DB.students.filter(s=>mailIsClaimed(m,s.id)).length:0;
    const readCount = Array.isArray(m.to)?m.to.filter(sid=>mailIsRead(m,sid)).length
      :m.to==='all'?DB.students.filter(s=>mailIsRead(m,s.id)).length:0;
    const totalTo = m.to==='all'?DB.students.length:Array.isArray(m.to)?m.to.length:1;
    const mailTypeIcons={announcement:'📢',reward:'🎁',gift:'🎀',event:'🎉',title:'🎖️',compensation:'💎',general:'📬'};
    return `<div class="admin-mail-row">
      <div class="admin-mail-row-icon">${mailTypeIcons[m.type]||'📬'}</div>
      <div class="admin-mail-row-body">
        <div class="admin-mail-row-subject">${_esc(m.subject)}</div>
        <div class="admin-mail-row-meta">
          To: ${_esc(recipientLabel)} · ${timeStr}
          · 👁 ${readCount}/${totalTo} read
          ${m.hasReward?` · 🎁 ${claimsCount}/${totalTo} claimed`:''}
          ${m.hasReward?` <span class="badge-pill bp-gold" style="font-size:9px;margin-left:4px">Reward</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${_esc((m.body||'').slice(0,100))}${(m.body||'').length>100?'…':''}</div>
      </div>
      <div class="admin-mail-row-actions">
        <button class="btn btn-ghost btn-xs" onclick="mailAdminOpenCompose('${m.id}')">✏️</button>
        <button class="btn btn-danger btn-xs" onclick="mailAdminDelete('${m.id}')">🗑</button>
      </div>
    </div>`;
  }).join('')}`;
};

// ── Compose / Edit ──
window.mailAdminOpenCompose = function(editId){
  DB = loadDB();
  const existing = editId ? (DB.mail||[]).find(m=>m.id===editId) : null;
  const studentOpts = DB.students.map(s=>`<option value="${s.id}" ${existing&&Array.isArray(existing.to)&&existing.to.includes(s.id)?'selected':''}>${_esc(s.name)}</option>`).join('');
  const typeOpts = MAIL_TYPES.map(t=>`<option value="${t.value}" ${(existing?.type||'general')===t.value?'selected':''}>${t.label}</option>`).join('');
  const titles = (DB.titles||[]).filter(t=>t.active);
  const titleOpts = titles.length ? titles.map(t=>`<option value="${t.id}">${_esc(t.name)} (${t.rarity})</option>`).join('') : '<option value="">No titles created</option>';
  
  // Validate existing mail data before editing
  if(existing && !existing.hasReward) {
    existing.hasReward = false;
  }
  if(existing && !existing.rewards) {
    existing.rewards = [];
  }

  // Phase 15: recipients can't be changed on edit — update_mail_batch()
  // only ever updates content fields (subject/body/type/rewards) on the
  // existing per-recipient rows for this batch_id; it deliberately never
  // adds/removes rows (see phase15_mail_and_quiz_sections_sync.sql's
  // comment: "Edit: content only, NEVER read/claimed"). Changing WHO a
  // batch was sent to would need a real add/remove-recipient RPC that
  // doesn't exist yet, so the recipient picker is shown read-only when
  // editing — to change recipients, delete this mail and compose a new one.
  const recipientLabel = existing
    ? (existing.to === 'all' ? `All Students (${DB.students.length})`
        : (existing.to || []).map(sid => { const s = DB.students.find(x => x.id === sid); return s ? s.name : sid; }).join(', '))
    : '';

  showModal(`
  <div class="modal-h2">${existing?'✏️ Edit Mail':'📬 Compose Mail'}</div>
  <div class="form-group">
    <label class="form-label">Recipients</label>
    ${existing ? `
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--text-muted)">
      ${_esc(recipientLabel)}
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Recipients can't be changed after sending — delete and compose a new mail instead.</div>
    ` : `
    <select id="ml-to" style="width:100%" onchange="mailAdminToChange()">
      <option value="all" selected>🌟 All Students</option>
      <option value="multi">👥 Specific Students</option>
    </select>
    <div id="ml-multi-wrap" style="display:none;margin-top:8px">
      <select id="ml-students" multiple style="width:100%;height:100px">${studentOpts}</select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Hold Ctrl/Cmd to select multiple</div>
    </div>
    `}
  </div>
  <div class="form-group">
    <label class="form-label">Mail Type</label>
    <select id="ml-type" style="width:100%">${typeOpts}</select>
  </div>
  <div class="form-group">
    <label class="form-label">Subject *</label>
    <input type="text" id="ml-subject" value="${_esc(existing?.subject||'')}" placeholder="Message subject..." style="width:100%">
  </div>
  <div class="form-group">
    <label class="form-label">Message Body *</label>
    <textarea id="ml-body" rows="5" placeholder="Write your message..." style="width:100%">${_esc(existing?.body||'')}</textarea>
  </div>

  <div class="form-group">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="ml-has-reward" ${existing?.hasReward?'checked':''} style="width:auto;accent-color:var(--primary-dark)"
        onchange="mailAdminToggleRewards()">
      <span style="font-size:13px;font-weight:600;color:var(--on-surface)">Attach Rewards</span>
    </label>
  </div>

  <div id="ml-rewards-section" style="display:${existing?.hasReward?'block':'none'}">
    <div style="background:rgba(255,185,95,.05);border:1px solid rgba(255,185,95,.2);border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-family:var(--fm);font-size:9px;color:rgba(255,185,95,.7);letter-spacing:.12em;margin-bottom:12px">REWARD CONFIGURATION</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label">XP Reward</label>
          <input type="number" id="ml-xp" value="${existing?.rewards?.find(r=>r.type==='xp')?.amount||0}" min="0" style="width:100%">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Coin Reward</label>
          <input type="number" id="ml-coins" value="${existing?.rewards?.find(r=>r.type==='coins')?.amount||0}" min="0" style="width:100%">
        </div>
      </div>
      <div class="form-group" style="margin-top:10px;margin-bottom:0">
        <label class="form-label">Title Grant (optional)</label>
        <select id="ml-title" style="width:100%">
          <option value="">— No title —</option>
          ${titleOpts}
        </select>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:10px;margin-top:16px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
    <button class="btn btn-primary" style="flex:1" onclick="mailAdminSend('${editId||''}')">
      <span class="material-symbols-outlined" style="font-size:16px">send</span>
      ${existing?'Update & Resend':'Send Mail'}
    </button>
  </div>
  <script>
    setTimeout(()=>{
      var sel=document.getElementById('ml-to');
      if(sel)mailAdminToChange();
    },50);
  <\/script>
  `, 'md');
  // (Guard above already no-ops safely in edit mode — #ml-to doesn't exist
  // there once recipients are read-only.)
};

window.mailAdminToChange = function(){
  const v = document.getElementById('ml-to')?.value;
  const wrap = document.getElementById('ml-multi-wrap');
  if(wrap) wrap.style.display = v==='multi'?'block':'none';
};
window.mailAdminToggleRewards = function(){
  const cb = document.getElementById('ml-has-reward');
  const sec = document.getElementById('ml-rewards-section');
  if(sec) sec.style.display = cb?.checked?'block':'none';
};

// Phase 15: wired to the real Supabase RPCs (send_mail / update_mail_batch —
// see phase15_mail_and_quiz_sections_sync.sql). Previously this function only
// ever mutated the in-memory DB.mail array and called saveDB() — but
// mail_messages is deliberately NOT part of the generic bulk push (same
// reasoning as shop stock: a per-student read/claimed flag must never ride a
// whole-table upsert another tab could clobber), so none of that ever
// actually reached the server. Composing mail on one device silently never
// appeared on a student's other device. This now calls the scoped RPCs
// directly, same posture as shop_admin_store.js's product CRUD.
window.mailAdminSend = async function(editId){
  DB = loadDB();
  const subject = (document.getElementById('ml-subject')?.value||'').trim();
  const body = (document.getElementById('ml-body')?.value||'').trim();
  const type = document.getElementById('ml-type')?.value||'general';
  const hasReward = document.getElementById('ml-has-reward')?.checked||false;

  if(!subject){toast('❌ Subject is required','#ffb4ab');return;}
  if(!body){toast('❌ Message body is required','#ffb4ab');return;}

  let to;
  if(!editId){
    const toSel = document.getElementById('ml-to')?.value;
    if(toSel==='all'){
      to = DB.students.map(s=>s.id); // send_mail() needs explicit recipient ids — there's no server-side "all" concept, just one row per recipient
    } else {
      const multiSel = document.getElementById('ml-students');
      to = multiSel ? [...multiSel.selectedOptions].map(o=>o.value) : [];
      if(!to.length){toast('❌ Select at least one recipient','#ffb4ab');return;}
    }
  }

  let rewards = [];
  let xp = 0, coins = 0, titleId = '';
  if(hasReward){
    xp = parseInt(document.getElementById('ml-xp')?.value||0);
    coins = parseInt(document.getElementById('ml-coins')?.value||0);
    titleId = document.getElementById('ml-title')?.value||'';
    if(xp>0) rewards.push({type:'xp',amount:xp,icon:'⚡',label:'XP',color:'var(--primary)'});
    if(coins>0) rewards.push({type:'coins',amount:coins,icon:'🪙',label:'Coins',color:'var(--tertiary)'});
    if(titleId){
      const t = (DB.titles||[]).find(x=>x.id===titleId);
      if(t) rewards.push({type:'title',amount:1,icon:t.icon||'🎖️',label:t.name,color:'#EC4899',titleId:t.id});
    }
    if(!rewards.length){toast('❌ Add at least one reward (XP ≥1, Coins ≥1, or Title) or uncheck "Attach Rewards"','#ffb4ab');return;}
  }

  const mailTypeIcons={announcement:'📢',reward:'🎁',gift:'🎀',event:'🎉',title:'🎖️',compensation:'💎',general:'📬'};

  if(editId){
    // Content-only update — recipients are fixed once sent (see the
    // read-only recipient block in mailAdminOpenCompose above).
    const { error } = await DBService.rpc('update_mail_batch', {
      p_batch_id: editId, p_subject: subject, p_body: body, p_mail_type: type,
      p_xp_reward: xp, p_coin_reward: coins, p_title_reward_id: titleId || null,
    });
    if(error){ toast('❌ Could not update mail: ' + error.message, '#ffb4ab'); return; }

    const idx = (DB.mail||[]).findIndex(m=>m.id===editId);
    if(idx>=0){
      const existing = DB.mail[idx]||{};
      DB.mail[idx] = {...existing, subject, body, type, hasReward, rewards, icon: mailTypeIcons[type]||'📬'};
    }
    closeModalForce();renderAdminMail();
    toast('✅ Mail updated!');
  } else {
    const { data, error } = await DBService.rpc('send_mail', {
      p_recipient_ids: to, p_subject: subject, p_body: body, p_mail_type: type,
      p_xp_reward: xp, p_coin_reward: coins, p_title_reward_id: titleId || null,
    });
    if(error){ toast('❌ Could not send mail: ' + error.message, '#ffb4ab'); return; }

    if(!DB.mail) DB.mail=[];
    const readBy = {}, claimedBy = {};
    to.forEach(sid => { readBy[sid]=false; claimedBy[sid]=false; });
    const newMail = {
      id: data, // batch_id returned by send_mail()
      subject,
      body,
      type,
      to,
      hasReward,
      rewards,
      sender: currentUser.name||'Teacher',
      icon: mailTypeIcons[type]||'📬',
      sentAt: new Date().toISOString(),
      readBy,
      claimedBy,
      // rowIdBySid isn't known yet (send_mail only returns the batch id,
      // not each per-recipient row's own id) — mailMarkRead/mailClaimRewards
      // already handle a missing entry gracefully and the next real pull
      // (triggered automatically by the realtime mail_messages listener in
      // db-service.js) fills this in for real.
      rowIdBySid: {},
    };
    console.log('[Mail] Created new mail (batch):', newMail);
    DB.mail.push(newMail);
    saveDB();
    closeModalForce();
    renderAdminMail();
    toast(`📬 Mail sent to ${to.length} student${to.length!==1?'s':''}!`);
  }
};

window.mailAdminDelete = function(mailId){
  DB = loadDB();
  const m = (DB.mail||[]).find(x=>x.id===mailId);
  if(!m) return;
  showModal(`
    <div style="text-align:center;padding:10px">
      <div style="font-size:40px;margin-bottom:12px">🗑️</div>
      <div class="modal-h2" style="text-align:center">Delete Mail?</div>
      <div style="color:var(--text-muted);margin-bottom:20px;font-size:13px">Delete "${_esc(m.subject)}"? This cannot be undone.</div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
        <button class="btn btn-danger" style="flex:1" onclick="mailAdminConfirmDelete('${mailId}')">Delete</button>
      </div>
    </div>`, 'sm');
};

window.mailAdminConfirmDelete = async function(mailId){
  DB = loadDB();
  DB.mail = (DB.mail||[]).filter(m=>m.id!==mailId);
  saveDB();
  closeModalForce();
  toast('🗑 Mail deleted.','#ff8080');
  renderAdminMail();
  // Phase 15: the bulk push never touches mail_messages at all (see
  // db-service.js), so without this the batch would silently reappear for
  // every recipient on the next pull/realtime refresh. delete_mail_batch()
  // is staff-scoped the same way as the shop's delete_shop_product().
  const { error } = await DBService.rpc('delete_mail_batch', { p_batch_id: mailId });
  if(error) toast('⚠️ Removed locally, but may not have synced: ' + error.message, '#ffb95f');
};

