// ═══════════════════════════════════════════════════════════════════════════
// modules/mail/student-inbox.js
// Phase 3 Day 1 extraction — Student-facing Mail UI.
// Depends on: mail-engine.js (mailGetForStudent, mailIsRead, mailIsClaimed,
//             mailMarkRead, mailClaimRewards, mailUpdateSidebarBadge),
//             shared/dom.js (showModal, closeModalForce),
//             modules/achievements (eqRewardPresent — Universal Reward
//             Presentation System, loaded later in the same script chain).
// Verbatim move from index.html (Phase 3 EXTRACTION_PLAN.md, Day 1).
// Classic script — shares global scope with the rest of the app.
// ═══════════════════════════════════════════════════════════════════════════
// ── Student Mail Page ──
window.renderStudentMail = function(){
  DB = loadDB();
  const sid = currentUser.id;
  const msgs = mailGetForStudent(sid);
  const unread = msgs.filter(m=>!mailIsRead(m,sid)).length;
  const unclaimedRewards = msgs.filter(m=>m.hasReward&&!mailIsClaimed(m,sid)).length;
  const mailTypeIcons = {announcement:'📢',reward:'🎁',gift:'🎀',event:'🎉',title:'🎖️',compensation:'💎',general:'📬'};
  
  console.log('[Mail] Rendering student mail. Total:', msgs.length, 'Unread:', unread, 'Unclaimed:', unclaimedRewards);
  msgs.forEach((m,idx) => {
    console.log(`[Mail] ${idx}: ${m.id} - Claimed: ${mailIsClaimed(m,sid)} - HasReward: ${m.hasReward}`);
  });

  document.getElementById('s-mail').innerHTML = `
  <div class="page-hero" style="background:linear-gradient(135deg,#0d1525,#1a0a2e)">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">📬 INBOX // MESSAGES</div>
      <h1 style="font-size:30px;font-family:var(--fh);font-weight:900">Mail</h1>
      <p>Messages from your teacher, including announcements and special rewards.</p>
      <div class="page-hero-stats">
        <div class="hero-stat-pill"><div class="val" style="color:var(--primary)">${msgs.length}</div><div class="lbl">Messages</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:${unread>0?'#EC4899':'var(--secondary)'}">${unread}</div><div class="lbl">Unread</div></div>
        <div class="hero-stat-pill"><div class="val" style="color:var(--tertiary)">${unclaimedRewards}</div><div class="lbl">Rewards</div></div>
      </div>
    </div>
  </div>

  ${unclaimedRewards>0?`
  <div style="background:linear-gradient(135deg,rgba(255,185,95,.1),rgba(236,72,153,.07));border:1px solid rgba(255,185,95,.3);border-radius:14px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="font-size:24px">🎁</div>
    <div style="flex:1">
      <div style="font-family:var(--fh);font-size:14px;font-weight:900;color:var(--tertiary)">${unclaimedRewards} Unclaimed Mail Reward${unclaimedRewards>1?'s':''}</div>
      <div style="font-size:12px;color:var(--text-muted)">Open the mail items below to claim your rewards.</div>
    </div>
  </div>`:''}

  ${msgs.length===0?`
  <div class="mail-empty">
    <div class="mail-empty-icon">📭</div>
    <div class="mail-empty-title">Your inbox is empty</div>
    <div class="mail-empty-sub">Messages from your teacher will appear here.</div>
  </div>`:`
  <div class="mail-list" id="mail-list">
    ${msgs.map(m=>{
      const isRead=mailIsRead(m,sid);
      const isClaimed=mailIsClaimed(m,sid);
      const icon=mailTypeIcons[m.type]||'📬';
      const timeStr=new Date(m.sentAt).toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      return `<div class="mail-item${isRead?'':' unread'}" onclick="mailOpenDetail('${m.id}')">
        <div class="mail-item-icon">${icon}</div>
        <div class="mail-item-body">
          <div class="mail-item-from">
            <span class="material-symbols-outlined" style="font-size:12px">school</span>
            ${_esc(m.sender||'Teacher')}
          </div>
          <div class="mail-item-subject">${_esc(m.subject)}</div>
          <div class="mail-item-preview">${_esc((m.body||'').slice(0,80))}${(m.body||'').length>80?'…':''}</div>
        </div>
        <div class="mail-item-meta">
          <span class="mail-item-time">${timeStr}</span>
          ${m.hasReward&&!isClaimed?'<span class="mail-has-reward">🎁 REWARD</span>':''}
          ${!isRead?'<div class="mail-unread-dot"></div>':''}
        </div>
      </div>`;
    }).join('')}
  </div>`}`;
  mailUpdateSidebarBadge();
};

window.mailOpenDetail = function(mailId){
  DB = loadDB();
  const sid = currentUser.id;
  const m = (DB.mail||[]).find(x=>x.id===mailId);
  if(!m) {
    console.error('[Mail] Mail not found:', mailId);
    return;
  }
  
  console.log('[Mail] Opening detail for mail:', mailId);
  
  // Mark as read
  mailMarkRead(mailId, sid);
  mailUpdateSidebarBadge();

  // Reload mail object to get fresh state
  const freshM = (loadDB().mail||[]).find(x=>x.id===mailId);
  const isRead = mailIsRead(freshM||m, sid);
  const isClaimed = mailIsClaimed(freshM||m, sid);
  const timeStr = new Date((freshM||m).sentAt).toLocaleString('en-PH',{month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const mailTypeIcons = {announcement:'📢',reward:'🎁',gift:'🎀',event:'🎉',title:'🎖️',compensation:'💎',general:'📬'};
  const icon = mailTypeIcons[(freshM||m).type]||'📬';

  let rewardHTML = '';
  if((freshM||m).hasReward){
    const chips = ((freshM||m).rewards||[]).map(r=>`
      <div class="mail-reward-chip" style="color:${r.color||'var(--primary)'};border-color:${r.color||'rgba(208,188,255,.3)'}33;background:${r.color||'rgba(208,188,255,.08)'}11">
        <span>${r.icon||'🎁'}</span>
        <span>${typeof r.amount==='number'?'+'+r.amount.toLocaleString():r.amount} ${r.label||''}</span>
      </div>`).join('');

    const claimBtn = isClaimed
      ? `<div class="mail-claimed-badge"><span class="material-symbols-outlined" style="font-size:18px">check_circle</span> Rewards Claimed</div>`
      : `<button class="mail-claim-btn" onclick="mailDoClaimRewards('${mailId}')">
           <span class="material-symbols-outlined">redeem</span>
           Claim Rewards
         </button>`;
    rewardHTML = `
      <div class="mail-reward-box">
        <div class="mail-reward-box-title">ATTACHED REWARDS</div>
        <div class="mail-reward-chips-row">${chips}</div>
      </div>
      ${claimBtn}`;
  }

  showModal(`
    <div class="mail-detail">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div style="font-family:var(--fm);font-size:9px;color:var(--text-muted);letter-spacing:.14em">MAIL // MESSAGE_DETAIL</div>
        <button class="btn btn-ghost btn-xs" onclick="closeModalForce();renderStudentMail()">← Back</button>
      </div>
      <div class="mail-detail-header">
        <div class="mail-detail-subject">${_esc((freshM||m).subject)}</div>
        <div class="mail-detail-from">
          <div class="mail-detail-avatar">MS</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${_esc((freshM||m).sender||'Teacher')}</div>
            <div class="mail-detail-meta-text">${timeStr}</div>
          </div>
          <div style="margin-left:auto">
            ${icon}
            <span class="badge-pill bp-gray" style="font-size:10px;margin-left:6px">${(freshM||m).type||'general'}</span>
          </div>
        </div>
      </div>
      <div class="mail-detail-body">${_esc((freshM||m).body||'')}</div>
      ${rewardHTML}
    </div>
  `, 'md');
};

window.mailDoClaimRewards = function(mailId){
  if(!currentUser||currentRole!=='student') {
    toast('❌ You must be logged in as a student','#ffb4ab');
    return;
  }
  
  console.log('[Mail] Starting claim for mail:', mailId, 'Student:', currentUser.id);
  
  const rewards = mailClaimRewards(mailId, currentUser.id);
  
  if(!rewards || (Array.isArray(rewards) && rewards.length === 0)) {
    console.warn('[Mail] Claim returned no rewards or false');
    toast('❌ Rewards already claimed or mail not found.','#ffb4ab');
    return;
  }

  // Close modal first, then present rewards
  closeModalForce();

  // Determine rarity dynamically based on reward types
  let rarity = 'Common';
  if(rewards&&rewards.length>0){
    const hasTitle = rewards.some(r=>r.type==='title');
    const hasCoin = rewards.some(r=>r.type==='coins'&&parseInt(r.amount||0)>100);
    const hasXP = rewards.some(r=>r.type==='xp'&&parseInt(r.amount||0)>200);
    if(hasTitle) rarity = 'Legendary';
    else if(hasCoin||hasXP) rarity = 'Rare';
  }

  const MAIL_ICONS={announcement:'📢',reward:'🎁',gift:'🎀',event:'🎉',title:'🎖️',compensation:'💎',general:'📬'};
  const mailIcon = MAIL_ICONS[rewards&&rewards.length>0?'reward':'general']||'📬';

  eqRewardPresent({
    title: 'Mail Rewards Claimed!',
    subtitle: rewards&&rewards.length>0?'Excellent rewards!':'Message received',
    icon: mailIcon,
    rarity: rarity,
    source: 'mail',
    rewards: rewards||[],
    onClose: ()=>{ 
      console.log('[Mail] Reward presentation closed, refreshing mail view');
      // Force reload the DB and refresh mail list
      DB = loadDB();
      renderStudentMail();
    }
  });
};
