function mailGetForStudent(sid) {
  // Uses existing DB global, no need to reload here
  return (DB.mail || []).filter(m => 
    m.to === 'all' || (Array.isArray(m.to) && m.to.includes(sid))
  ).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
}

function mailIsRead(mail, sid) { return !!(mail.readBy && mail.readBy[sid]); }
function mailIsClaimed(mail, sid) { return !!(mail.claimedBy && mail.claimedBy[sid]); }

function mailMarkRead(mailId, sid) {
  // Read ONCE
  DB = loadDB();
  const m = (DB.mail || []).find(x => x.id === mailId);
  if (!m) return;
  if (m.readBy && m.readBy[sid]) return; // already read — skip the redundant RPC
  if (!m.readBy) m.readBy = {};
  m.readBy[sid] = true;
  // Write ONCE
  saveDB();
  // Phase 15: DB.mail isn't part of the generic bulk push (see
  // db-service.js's _pushCacheToSupabase — mail_messages is intentionally
  // NOT in it, same reasoning as stock/current_hp: a per-student flag like
  // "read" must never ride a whole-table upsert another tab could clobber).
  // mark_mail_read() is scoped to just this one row, just this student's
  // own recipient_student_id. Fire-and-forget, same posture as
  // syncStudentStatsToServer() — the local optimistic mutation above
  // already gives the user instant feedback.
  //
  // IMPORTANT: `mailId` here is `m.id`, which is the BATCH id (one compose
  // action can fan out to many recipients — see db-service.js's
  // mailByBatch reconstruction), not the actual mail_messages row id.
  // mark_mail_read()'s `where id = p_mail_id` needs that real per-row id,
  // so it's looked up via m.rowIdBySid[sid] (populated on pull from
  // Supabase). If it isn't there yet — e.g. this student's session hasn't
  // done a real Supabase pull since the mail was sent — skip the RPC
  // rather than silently sending the wrong id (which would match zero rows
  // and look like it worked); the next pull reconstructs the correct id and
  // this local readBy flag stays true either way.
  const rowId = m.rowIdBySid && m.rowIdBySid[sid];
  if (rowId && typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    DBService.rpc('mark_mail_read', { p_mail_id: rowId }).then(function (result) {
      if (result && result.error) console.warn('[Mail] mark_mail_read RPC failed for', mailId, result.error);
    }).catch(function (e) { console.warn('[Mail] mark_mail_read RPC threw for', mailId, e); });
  } else if (!rowId) {
    console.warn('[Mail] mark_mail_read: no server row id yet for mail', mailId, '— will sync on next pull.');
  }
}

function mailClaimRewards(mailId, sid) {
  try {
    // Read ONCE
    DB = loadDB();
    const m = (DB.mail || []).find(x => x.id === mailId);
    
    if (!m || !m.hasReward || !Array.isArray(m.rewards) || m.rewards.length === 0 || mailIsClaimed(m, sid)) {
      return false;
    }
    
    const sIdx = DB.students.findIndex(s => s.id === sid);
    if (sIdx < 0) return false;

    // Grant rewards in RAM
    let xpGrant = 0, coinGrant = 0;
    m.rewards.forEach(r => {
      if (r.type === 'xp') {
        const amt = parseInt(r.amount) || 0;
        DB.students[sIdx].xp = (DB.students[sIdx].xp || 0) + amt;
        xpGrant += amt;
      } else if (r.type === 'coins') {
        const amt = parseInt(r.amount) || 0;
        DB.students[sIdx].coins = (DB.students[sIdx].coins || 0) + amt;
        coinGrant += amt;
      } else if (r.type === 'title' && r.titleId && typeof tsUnlockTitleForStudent === 'function') {
        tsUnlockTitleForStudent(sid, r.titleId, false);
      }
    });

    m.claimedBy = m.claimedBy || {};
    m.claimedBy[sid] = true;
    m.readBy = m.readBy || {};
    m.readBy[sid] = true;

    if (xpGrant > 0 || coinGrant > 0) {
      syncStudentStatsToServer(sid, xpGrant, coinGrant);
      if (!DB.pointLog) DB.pointLog = [];
      DB.pointLog.unshift({ 
        id: 'pl_' + uid(),
        studentId: sid, 
        what: `📬 Mail Reward: ${m.subject}`, 
        pts: coinGrant || xpGrant || 0, 
        when: window.getNowLabel() 
      });
    }

    // Phase 15: persist claimed/read the same way mailMarkRead() does — a
    // scoped RPC on just this row/this student, never the generic bulk
    // push (mail_messages isn't in it at all; see db-service.js). The xp/
    // coins delta above already goes through its own RPC
    // (syncStudentStatsToServer → adjust_student_stats); this call only
    // needs to flip the claimed/read flags themselves.
    //
    // Same batch_id-vs-row-id fix as mailMarkRead() above — see that
    // function's comment for why m.rowIdBySid[sid] (not mailId) is the
    // correct value for p_mail_id.
    const rowId = m.rowIdBySid && m.rowIdBySid[sid];
    if (rowId && typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
      DBService.rpc('mark_mail_claimed', { p_mail_id: rowId }).then(function (result) {
        if (result && result.error) console.warn('[Mail] mark_mail_claimed RPC failed for', mailId, result.error);
      }).catch(function (e) { console.warn('[Mail] mark_mail_claimed RPC threw for', mailId, e); });
    } else if (!rowId) {
      console.warn('[Mail] mark_mail_claimed: no server row id yet for mail', mailId, '— will sync on next pull.');
    }

    // Process State Changes
    window.checkLevelUp(DB.students[sIdx]);
    setCurrentUser(DB.students[sIdx]);
    
    // Write ONCE
    saveDB();
    
    mailUpdateSidebarBadge();
    updateTopbar();
    return m.rewards;
  } catch (err) {
    console.error('[Mail] Error:', err);
    return false;
  }
}

function mailUpdateSidebarBadge() {
  if (currentRole !== 'student' || !currentUser) return;
  
  // No need to reload DB here if it's already in memory
  // This function is purely visual, it shouldn't trigger a disk read.
  const unread = mailUnreadCount(currentUser.id);
  const unclaimed = mailUnclaimedRewardCount(currentUser.id);
  const total = unread + unclaimed;
  
  const btn = document.getElementById('nav-s-mail');
  if (!btn) return;
  
  let badge = btn.querySelector('.mail-nav-badge');
  if (total > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'mail-nav-badge'; btn.appendChild(badge); }
    badge.textContent = total > 99 ? '99+' : String(total);
  } else if (badge) {
    badge.remove();
  }
}

function mailUnreadCount(sid) { return mailGetForStudent(sid).filter(m => !mailIsRead(m, sid)).length; }
function mailUnclaimedRewardCount(sid) { return mailGetForStudent(sid).filter(m => m.hasReward && !mailIsClaimed(m, sid)).length; }