// src/modules/mail/mail-engine.js — real-ESM twin of
// ../../../modules/mail/mail-engine.js.
// Phase 7 (Stream A), file 26/29. Original stays untouched.
//
// All 8 top-level declared symbols exported (mailGetForStudent,
// mailIsRead, mailIsClaimed, mailMarkRead, mailClaimRewards,
// mailUpdateSidebarBadge, mailUnreadCount, mailUnclaimedRewardCount),
// matching declaresCount 8 exactly (dist/dependency-map.json). All 8
// already had pre-existing trailing `window.X = X;` lines — kept
// verbatim, not new self-wiring.
//
// FIVE real imports, all formal exports of files already converted by
// this stream, all checked against the "confirm no runtime
// reassignment anywhere in the repo" rule (MEMORY.md) before finalizing
// — only self-wiring assignments found for each, no production runtime
// reassignment:
//   - AppStore (modules/core/state-manager.js) — .getSlice()/
//     .updateState().
//   - DBService (db-service.js) — .rpc() only. The original's own
//     `typeof DBService !== 'undefined' && typeof DBService.rpc ===
//     'function'` guard is kept 100% verbatim; a real import guarantees
//     DBService exists (an import failure would throw far earlier), so
//     the guard is trivially satisfied and unchanged in spirit.
//   - setCurrentUser (app-state.js, this stream's own file 22).
//   - updateTopbar (topbar.js, this stream's own file 14).
//   - syncStudentStatsToServer (student-stats.js).
// Checked state-manager.js, db-service.js, app-state.js, topbar.js, and
// student-stats.js for a reverse dependency back onto this file — none
// found, no cycle.
//
// NOT real-imported, deliberately: `window.getNowLabel()` and
// `window.checkLevelUp(s)` (both index.html's inline1 / app-state.js)
// are called via EXPLICIT `window.` prefix in the original, not bare
// identifiers — there's nothing to "convert" here; these lines are left
// completely untouched and continue to resolve via window exactly as
// before. `currentRole`/`currentUser` (inline1.js) stay bare-identifier
// window fallback per that file's own standing rule (never a real-
// import target — see MEMORY.md). `uid()` (utils.js, converted but NOT
// by this stream) and `tsUnlockTitleForStudent` (a different stream's
// titles module, already typeof-guarded in the original) also stay
// window fallback.

import { AppStore } from '../core/state-manager.js';
import { DBService } from '../../db-service.js';
import { setCurrentUser } from '../../app-state.js';
import { updateTopbar } from '../../topbar.js';
import { syncStudentStatsToServer } from '../../student-stats.js';

export function mailGetForStudent(sid) {
  return (AppStore.getSlice(s => s.mail) || []).filter(m => 
    m.to === 'all' || (Array.isArray(m.to) && m.to.includes(sid))
  ).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
}

export function mailIsRead(mail, sid) { return !!(mail.readBy && mail.readBy[sid]); }
export function mailIsClaimed(mail, sid) { return !!(mail.claimedBy && mail.claimedBy[sid]); }

export function mailMarkRead(mailId, sid) {
  // Pre-check (read-only) so we only pay for updateState (persist + notify)
  // when there's an actual change to make — same "already read, skip the
  // redundant RPC" guard as before.
  const existing = (AppStore.getSlice(s => s.mail) || []).find(x => x.id === mailId);
  if (!existing) return;
  if (existing.readBy && existing.readBy[sid]) return; // already read — skip the redundant RPC

  AppStore.updateState(draft => {
    const m = (draft.mail || []).find(x => x.id === mailId);
    if (!m) return;
    if (!m.readBy) m.readBy = {};
    m.readBy[sid] = true;
  }, { type: 'mail:read', payload: { mailId, sid } });

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
  //
  // `existing` (the pre-update read above) still has the correct
  // rowIdBySid — that field isn't touched by the update, so reading it from
  // the pre-check snapshot instead of re-reading post-update is fine.
  const rowId = existing.rowIdBySid && existing.rowIdBySid[sid];
  if (rowId && typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
    DBService.rpc('mark_mail_read', { p_mail_id: rowId }).then(function (result) {
      if (result && result.error) console.warn('[Mail] mark_mail_read RPC failed for', mailId, result.error);
    }).catch(function (e) { console.warn('[Mail] mark_mail_read RPC threw for', mailId, e); });
  } else if (!rowId) {
    console.warn('[Mail] mark_mail_read: no server row id yet for mail', mailId, '— will sync on next pull.');
  }
}

export function mailClaimRewards(mailId, sid) {
  try {
    // Pre-check (read-only) against a fresh snapshot — same eligibility
    // gate as before (already claimed / no reward / mail missing).
    const mailBefore = (AppStore.getSlice(s => s.mail) || []).find(x => x.id === mailId);
    if (!mailBefore || !mailBefore.hasReward || !Array.isArray(mailBefore.rewards) || mailBefore.rewards.length === 0 || mailIsClaimed(mailBefore, sid)) {
      return false;
    }

    let xpGrant = 0, coinGrant = 0;
    let updatedStudent = null;
    let claimedRewards = null;

    // Reward grant, mail flag flip, pointLog entry, and the level-up check
    // all happen inside this one draft callback — one atomic commit instead
    // of the five separate DB.* mutations the pre-migration version made.
    AppStore.updateState(draft => {
      const m = (draft.mail || []).find(x => x.id === mailId);
      if (!m) return;
      const s = (draft.students || []).find(x => x.id === sid);
      if (!s) return;

      m.rewards.forEach(r => {
        if (r.type === 'xp') {
          const amt = parseInt(r.amount) || 0;
          s.xp = (s.xp || 0) + amt;
          xpGrant += amt;
        } else if (r.type === 'coins') {
          const amt = parseInt(r.amount) || 0;
          s.coins = (s.coins || 0) + amt;
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
        if (!Array.isArray(draft.pointLog)) draft.pointLog = [];
        draft.pointLog.unshift({
          id: 'pl_' + uid(),
          studentId: sid,
          what: `📬 Mail Reward: ${m.subject}`,
          pts: coinGrant || xpGrant || 0,
          when: window.getNowLabel(),
          createdAt: new Date().toISOString()
        });
      }

      // checkLevelUp() mutates its argument's .level in place — it has to
      // run on the draft here, before commit. Running it afterward (on the
      // committed student object) would mutate AppStore's internal state
      // directly, outside the mutation gate, the same bypass this whole
      // migration exists to close.
      window.checkLevelUp(s);

      updatedStudent = s;
      claimedRewards = m.rewards;
    }, { type: 'mail:claimed', payload: { mailId, sid } });

    if (!updatedStudent) return false; // mail or student vanished between the pre-check and the update

    // Phase 15: persist claimed/read the same way mailMarkRead() does — a
    // scoped RPC on just this row/this student, never the generic bulk
    // push (mail_messages isn't in it at all; see db-service.js). The xp/
    // coins delta above already goes through its own RPC
    // (syncStudentStatsToServer → adjust_student_stats); this call only
    // needs to flip the claimed/read flags themselves.
    if (xpGrant > 0 || coinGrant > 0) {
      syncStudentStatsToServer(sid, xpGrant, coinGrant);
    }

    // Same batch_id-vs-row-id fix as mailMarkRead() above — see that
    // function's comment for why rowIdBySid[sid] (not mailId) is the
    // correct value for p_mail_id. Read from the pre-update snapshot since
    // rowIdBySid isn't touched by the update above.
    const rowId = mailBefore.rowIdBySid && mailBefore.rowIdBySid[sid];
    if (rowId && typeof DBService !== 'undefined' && typeof DBService.rpc === 'function') {
      DBService.rpc('mark_mail_claimed', { p_mail_id: rowId }).then(function (result) {
        if (result && result.error) console.warn('[Mail] mark_mail_claimed RPC failed for', mailId, result.error);
      }).catch(function (e) { console.warn('[Mail] mark_mail_claimed RPC threw for', mailId, e); });
    } else if (!rowId) {
      console.warn('[Mail] mark_mail_claimed: no server row id yet for mail', mailId, '— will sync on next pull.');
    }

    setCurrentUser(updatedStudent);

    mailUpdateSidebarBadge();
    updateTopbar();
    return claimedRewards;
  } catch (err) {
    console.error('[Mail] Error:', err);
    return false;
  }
}

export function mailUpdateSidebarBadge() {
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

export function mailUnreadCount(sid) { return mailGetForStudent(sid).filter(m => !mailIsRead(m, sid)).length; }
export function mailUnclaimedRewardCount(sid) { return mailGetForStudent(sid).filter(m => m.hasReward && !mailIsClaimed(m, sid)).length; }
// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window.mailUpdateSidebarBadge = mailUpdateSidebarBadge;
window.mailIsRead = mailIsRead;
window.mailIsClaimed = mailIsClaimed;
window.mailClaimRewards = mailClaimRewards;
window.mailGetForStudent = mailGetForStudent;
window.mailMarkRead = mailMarkRead;
window.mailUnreadCount = mailUnreadCount;
window.mailUnclaimedRewardCount = mailUnclaimedRewardCount;
