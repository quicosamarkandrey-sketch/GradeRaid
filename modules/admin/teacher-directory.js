// ══════════════════════════════════════════════════════
//  modules/admin/teacher-directory.js
//  Teacher Directory — admin-only screen.
//  (ISOLATION_ROLES_PLAN.md §11 "Teacher directory", §12 step 5, chunk A)
//
//  A1: nav split + admin-only gating + promote/demote RPCs.
//  A2: get_teacher_directory() read list + promote/demote wired up.
//  A3: status column + Deactivate/Reactivate actions, backed by
//     supabase/phase36_deactivate_reactivate.sql.
//  A4: "Send Reset Email" action per row, backed by
//     TeacherDirectoryService.sendPasswordReset() (Supabase Auth's
//     resetPasswordForEmail(), not an RPC — no schema change). The
//     in-app landing screen the reset link opens lives in recovery.js.
//  A5 (this phase): "Invite a New Teacher" panel — generate a generic,
//     7-day invite link (supabase/phase37_teacher_invites.sql), copy it to
//     share manually, see outstanding invites, revoke a pending one. The
//     invited person's own completion screen lives in
//     modules/admin/teacher-invite.js / teacher-invite-service.js — this
//     file only ever handles the admin side (create/list/revoke).
//  Chunk D: "Transfer Ownership" per-row action — full offboarding, moves
//     every section and every piece of content a teacher owns to one
//     destination teacher (supabase/phase42_ownership_lifecycle.sql, via
//     OwnershipService — modules/admin/ownership-service.js). Separate
//     from Deactivate — see that action's button for account lockout.
//
//  REPOSITORY PATTERN: this file never calls DBService.rpc() (or the raw
//  Supabase client) directly — only TeacherDirectoryService / OwnershipService.
//
//  Exports: renderTeacherDirectory, doPromoteTeacher, doDemoteAdmin,
//           doDeactivateAccount, doReactivateAccount, doSendPasswordReset,
//           doGenerateTeacherInvite, doCopyTeacherInviteLink, doRevokeTeacherInvite,
//           _tdOpenTransferModal, _tdSubmitTransfer
// ══════════════════════════════════════════════════════

let _teacherDirLoading = false;
let _teacherDirRows = null;   // last successfully loaded list, or null
let _teacherDirError = null;
let _teacherDirBusyId = null; // id currently mid promote/demote/deactivate, for button spinners

let _teacherInvitesLoading = false;
let _teacherInvites = null;      // last successfully loaded invite list, or null
let _teacherInvitesError = null;
let _teacherInviteBusyToken = null; // token currently mid revoke, for button spinners
let _teacherInviteGenerating = false;

window.renderTeacherDirectory = async function () {
  const el = document.getElementById('a-teachers');
  if (!el) return;

  // Defense in depth: nav.js already hides this tab and bounces direct
  // navTo() calls for a non-admin — this should be unreachable, but never
  // show an oversight screen to a teacher account regardless.
  if (currentRole !== 'admin') {
    el.innerHTML = `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:40px;color:var(--text-muted)">lock</span>
      <h2 style="font-family:var(--fh);font-size:18px;margin:12px 0 4px">Admin only</h2>
      <p style="font-size:13px;color:var(--text-muted)">This screen is only available to oversight admin accounts.</p>
    </div>`;
    return;
  }

  _teacherDirLoading = true;
  _teacherDirError = null;
  _teacherInvitesLoading = true;
  _teacherInvitesError = null;
  _teacherDirRenderShell(el);

  const [dirResult, invitesResult] = await Promise.all([
    TeacherDirectoryService.getDirectory(),
    TeacherDirectoryService.getInvites(),
  ]);

  _teacherDirLoading = false;
  if (!dirResult.ok) {
    _teacherDirError = dirResult.error;
    _teacherDirRows = null;
  } else {
    _teacherDirRows = dirResult.teachers;
  }

  _teacherInvitesLoading = false;
  if (!invitesResult.ok) {
    _teacherInvitesError = invitesResult.error;
    _teacherInvites = null;
  } else {
    _teacherInvites = invitesResult.invites;
  }

  // Only re-render if we're still on this page (admin may have navigated
  // away while the RPCs were in flight).
  if (document.getElementById('a-teachers')) _teacherDirRenderShell(document.getElementById('a-teachers'));
};

function _teacherDirRenderShell(el) {
  el.innerHTML = `
  <div class="page-hero">
    <div class="page-hero-bg"></div>
    <div style="position:relative;z-index:1">
      <div class="page-hero-label">🛠️ Oversight</div>
      <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Teacher Directory</h1>
      <p style="font-size:14px;color:var(--text-muted)">Every admin and teacher account, their sections, content, and access status.</p>
    </div>
  </div>
  ${_teacherInvitePanel()}
  ${_teacherDirBody()}
  `;
}

const _TD_COLS = '1.3fr 90px 90px 1.1fr 80px 80px 1.3fr 100px 170px';

function _teacherDirBody() {
  if (_teacherDirLoading) {
    return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">Loading teacher directory…</div>`;
  }
  if (_teacherDirError) {
    return `
    <div class="glass-card" style="padding:32px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:36px;color:#ffb4ab">error</span>
      <p style="font-size:13px;color:var(--text-muted);margin:10px 0 16px">${_esc(_teacherDirError)}</p>
      <button class="btn btn-primary btn-sm" onclick="renderTeacherDirectory()">Retry</button>
    </div>`;
  }
  const rows = _teacherDirRows || [];
  if (rows.length === 0) {
    return `<div class="glass-card" style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">No teacher or admin accounts found.</div>`;
  }

  const adminCount = rows.filter(r => r.role === 'admin').length;
  const activeAdminCount = rows.filter(r => r.role === 'admin' && r.isActive !== false).length;
  const activeStaffCount = rows.filter(r => r.isActive !== false).length;

  return `
  <div class="glass-card" style="padding:0;overflow:hidden">
    <div style="display:grid;grid-template-columns:${_TD_COLS};gap:10px;align-items:center;padding:10px 16px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border2)">
      <span>Name</span><span>Role</span><span>Status</span><span>Email</span><span>Students</span><span>Content</span><span>Sections</span><span>Last Active</span><span></span>
    </div>
    ${rows.map(r => _teacherDirRow(r, adminCount, activeAdminCount, activeStaffCount)).join('')}
  </div>`;
}

function _teacherDirRow(r, adminCount, activeAdminCount, activeStaffCount) {
  const isAdmin = r.role === 'admin';
  const isActive = r.isActive !== false;
  const isSelf = currentUser && currentUser.id === r.id;
  const busy = _teacherDirBusyId === r.id;
  const label = _esc(r.displayName || r.email || '');

  const contentTotal = (r.achievementCount || 0) + (r.titleCount || 0) + (r.quizCount || 0)
    + (r.campaignWorldCount || 0) + (r.shopProductCount || 0);
  const sectionsLabel = (r.sections || []).length
    ? r.sections.map(s => _esc(s.label) + (s.archived ? ' (archived)' : '')).join(', ')
    : '—';
  const lastActive = r.lastActiveAt ? _teacherDirFormatDate(r.lastActiveAt) : 'Never';
  const created = r.createdAt ? _teacherDirFormatDate(r.createdAt) : '—';

  // Demoting/deactivating the last active admin is refused server-side
  // anyway, but disable the buttons client-side too so it's not a
  // dead-end click followed by a toast.
  const demoteDisabled = isAdmin && adminCount <= 1;
  const deactivateDisabled = isSelf || (isAdmin && isActive && activeAdminCount <= 1);
  const deactivateTitle = isSelf
    ? 'You cannot deactivate your own account'
    : (isAdmin && isActive && activeAdminCount <= 1 ? 'Cannot deactivate the last remaining active admin' : '');

  const roleBtn = isAdmin
    ? `<button class="btn btn-xs ${demoteDisabled ? 'btn-ghost' : 'btn-danger'}" ${demoteDisabled ? 'disabled title="Cannot demote the last remaining admin"' : ''} onclick="doDemoteAdmin('${r.id}','${label}')" style="width:100%">Demote to Teacher</button>`
    : `<button class="btn btn-xs btn-primary" onclick="doPromoteTeacher('${r.id}','${label}')" style="width:100%">Promote to Admin</button>`;

  const statusBtn = isActive
    ? `<button class="btn btn-xs ${deactivateDisabled ? 'btn-ghost' : 'btn-danger'}" ${deactivateDisabled ? `disabled title="${deactivateTitle}"` : ''} onclick="doDeactivateAccount('${r.id}','${label}')" style="width:100%">Deactivate</button>`
    : `<button class="btn btn-xs btn-success" onclick="doReactivateAccount('${r.id}','${label}')" style="width:100%">Reactivate</button>`;

  // A4: reset email needs somewhere to send TO. A deactivated account can
  // still receive and act on a reset link (recovery.js's screen only calls
  // updateUser() against whatever session the link resolves to — it never
  // checks is_active), so this is available regardless of status, same as
  // it would be if the teacher had used a "Forgot password?" link herself.
  const resetEmail = r.email || '';
  const resetDisabled = !resetEmail;
  const resetBtn = `<button class="btn btn-xs btn-ghost" ${resetDisabled ? 'disabled title="No email on file"' : ''} onclick="doSendPasswordReset('${r.id}','${_esc(resetEmail)}','${label}')" style="width:100%">Send Reset Email</button>`;

  // Chunk C: jump straight into that teacher's Content Oversight drill-in
  // (read-only by default — "Edit as" is a separate opt-in inside that screen).
  const contentBtn = `<button class="btn btn-xs btn-ghost" onclick="openContentOversightFor('${r.id}','${label}')" style="width:100%">View Content</button>`;

  // Chunk D: full offboarding — moves every section AND every piece of
  // content this account owns to a destination teacher in one call. Kept
  // separate from Deactivate (an admin may want to transfer without
  // locking the account, or vice versa — see ownership-service.js header).
  // Disabled when there's no OTHER active account to receive it.
  const otherActiveCount = activeStaffCount - (isActive ? 1 : 0);
  const transferDisabled = otherActiveCount < 1;
  const transferBtn = `<button class="btn btn-xs btn-ghost" ${transferDisabled ? 'disabled title="No other active account to transfer to"' : ''} onclick="_tdOpenTransferModal('${r.id}')" style="width:100%">Transfer Ownership</button>`;

  return `
  <div style="display:grid;grid-template-columns:${_TD_COLS};gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border2);${busy ? 'opacity:.5' : ''}${isActive ? '' : ';background:rgba(255,180,171,.05)'}">
    <div style="min-width:0">
      <div style="font-size:13px;font-weight:700;color:var(--on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(r.displayName || '(no name)')}${isSelf ? ' <span style="font-size:10px;color:var(--text-muted);font-weight:600">(you)</span>' : ''}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Joined ${created}</div>
    </div>
    <span class="btn btn-xs ${isAdmin ? 'btn-primary' : 'btn-ghost'}" style="width:fit-content;pointer-events:none">${isAdmin ? 'Admin' : 'Teacher'}</span>
    <span class="btn btn-xs ${isActive ? 'btn-success' : 'btn-danger'}" style="width:fit-content;pointer-events:none">${isActive ? 'Active' : 'Deactivated'}</span>
    <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(r.email || '—')}</div>
    <div style="font-size:13px;font-weight:700;text-align:center">${r.studentCount ?? 0}</div>
    <div style="font-size:13px;font-weight:700;text-align:center"><a href="javascript:void(0)" onclick="openContentOversightFor('${r.id}','${label}')" style="color:inherit;text-decoration:underline;text-decoration-style:dotted" title="${r.achievementCount||0} achievements · ${r.titleCount||0} titles · ${r.quizCount||0} quizzes · ${r.campaignWorldCount||0} worlds · ${r.shopProductCount||0} shop items">${contentTotal}</a></div>
    <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_esc(sectionsLabel)}">${sectionsLabel}</div>
    <div style="font-size:11px;color:var(--text-muted)">${lastActive}</div>
    <div style="display:flex;flex-direction:column;gap:4px">${roleBtn}${statusBtn}${resetBtn}${contentBtn}${transferBtn}</div>
  </div>`;
}

function _teacherDirFormatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) { return '—'; }
}

// ── INVITE A NEW TEACHER (chunk A5) ─────────────────────
//
// Generic links only (no per-invite pre-filled name/email — the invited
// person fills in everything themselves, see teacher-invite.js). The link
// is built client-side; the token itself is the only thing that ever needs
// to round-trip through Supabase.

function _teacherInviteLink(token) {
  return window.location.origin + window.location.pathname + '?teacher_invite=' + encodeURIComponent(token);
}

function _teacherInvitePanel() {
  const generating = _teacherInviteGenerating;
  const genBtn = `<button class="btn btn-sm btn-primary" ${generating ? 'disabled' : ''} onclick="doGenerateTeacherInvite()">
    ${generating ? 'Generating…' : '+ Generate Invite Link'}
  </button>`;

  return `
  <div class="glass-card" style="padding:20px 16px;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div>
        <h3 style="font-family:var(--fh);font-size:16px;font-weight:800;margin:0">Invite a New Teacher</h3>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">
          Generate a link, then share it yourself (Slack, email, etc.) — the teacher fills in their own name, email, and password. Links expire after 7 days.
        </p>
      </div>
      ${genBtn}
    </div>
    ${_teacherInviteBody()}
  </div>`;
}

function _teacherInviteBody() {
  if (_teacherInvitesLoading) {
    return `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">Loading invites…</div>`;
  }
  if (_teacherInvitesError) {
    return `<div style="padding:16px;text-align:center;color:#ffb4ab;font-size:13px">${_esc(_teacherInvitesError)}</div>`;
  }
  const invites = _teacherInvites || [];
  if (invites.length === 0) {
    return `<div style="padding:12px 2px;color:var(--text-muted);font-size:12px">No invites yet — generate one above.</div>`;
  }
  const cols = '1.6fr 90px 110px 110px 1fr 140px';
  return `
  <div style="border:1px solid var(--border2);border-radius:12px;overflow:hidden">
    <div style="display:grid;grid-template-columns:${cols};gap:10px;align-items:center;padding:8px 14px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border2)">
      <span>Link</span><span>Status</span><span>Created</span><span>Expires</span><span>Used By</span><span></span>
    </div>
    ${invites.map(_teacherInviteRow).join('')}
  </div>`;
}

function _teacherInviteRow(inv) {
  const busy = _teacherInviteBusyToken === inv.token;
  const isPending = inv.status === 'pending';
  const isExpired = isPending && inv.expiresAt && new Date(inv.expiresAt).getTime() <= Date.now();
  const effectiveStatus = isExpired ? 'expired' : inv.status;
  const statusColors = { pending: 'btn-success', used: 'btn-primary', revoked: 'btn-danger', expired: 'btn-ghost' };
  const statusLabels = { pending: 'Pending', used: 'Used', revoked: 'Revoked', expired: 'Expired' };
  const canCopy = isPending && !isExpired;
  const canRevoke = isPending && !isExpired;

  const cols = '1.6fr 90px 110px 110px 1fr 140px';
  return `
  <div style="display:grid;grid-template-columns:${cols};gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border2);${busy ? 'opacity:.5' : ''}">
    <div style="font-size:11px;font-family:monospace;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_esc(_teacherInviteLink(inv.token))}">${_esc(inv.token.slice(0, 12))}…</div>
    <span class="btn btn-xs ${statusColors[effectiveStatus] || 'btn-ghost'}" style="width:fit-content;pointer-events:none">${statusLabels[effectiveStatus] || effectiveStatus}</span>
    <div style="font-size:11px;color:var(--text-muted)">${_teacherDirFormatDate(inv.createdAt)}</div>
    <div style="font-size:11px;color:var(--text-muted)">${_teacherDirFormatDate(inv.expiresAt)}</div>
    <div style="font-size:12px;color:var(--text-muted)">${inv.usedByName ? _esc(inv.usedByName) : '—'}</div>
    <div style="display:flex;gap:6px;justify-content:flex-end">
      ${canCopy ? `<button class="btn btn-xs btn-ghost" onclick="doCopyTeacherInviteLink('${inv.token}')">Copy Link</button>` : ''}
      ${canRevoke ? `<button class="btn btn-xs btn-danger" onclick="doRevokeTeacherInvite('${inv.token}')">Revoke</button>` : ''}
    </div>
  </div>`;
}

window.doGenerateTeacherInvite = async function () {
  if (_teacherInviteGenerating) return;
  _teacherInviteGenerating = true;
  const el = document.getElementById('a-teachers');
  if (el) _teacherDirRenderShell(el);

  const result = await TeacherDirectoryService.createInvite();
  _teacherInviteGenerating = false;

  if (!result.ok) {
    toast('❌ ' + (result.error || 'Could not create an invite link.'), '#ffb4ab');
    if (document.getElementById('a-teachers')) window.renderTeacherDirectory();
    return;
  }

  // Copy immediately — generating a link is almost always followed by
  // pasting it somewhere, so save the extra click.
  await _teacherInviteCopyToClipboard(_teacherInviteLink(result.invite.token));
  toast('✅ Invite link created and copied to clipboard.');
  if (document.getElementById('a-teachers')) window.renderTeacherDirectory();
};

window.doCopyTeacherInviteLink = async function (token) {
  await _teacherInviteCopyToClipboard(_teacherInviteLink(token));
};

async function _teacherInviteCopyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('✅ Link copied to clipboard.');
  } catch (e) {
    // Clipboard API can fail (no permission, insecure context, etc.) — fall
    // back to just showing the link so the admin can select/copy it by hand.
    toast('⚠️ Could not auto-copy. Link: ' + text, '#ffb95f');
  }
}

window.doRevokeTeacherInvite = async function (token) {
  if (_teacherInviteBusyToken) return;
  if (!confirm('Revoke this invite link? Anyone who still has it will no longer be able to use it.')) return;

  _teacherInviteBusyToken = token;
  const el = document.getElementById('a-teachers');
  if (el) _teacherDirRenderShell(el);

  const result = await TeacherDirectoryService.revokeInvite(token);
  _teacherInviteBusyToken = null;

  if (!result.ok) toast('❌ ' + (result.error || 'Could not revoke this invite.'), '#ffb4ab');
  else toast('✅ Invite revoked.');

  if (document.getElementById('a-teachers')) window.renderTeacherDirectory();
};

// ── ROLE ACTIONS ────────────────────────────────────────

window.doPromoteTeacher = async function (teacherId, label) {
  if (_teacherDirBusyId) return;
  if (!confirm(`Promote "${label}" to admin? They'll gain school-wide oversight access.`)) return;
  await _teacherDirRunAction(teacherId, () => TeacherDirectoryService.promoteToAdmin(teacherId),
    `✅ ${label} promoted to admin.`, 'Could not promote this account.');
};

window.doDemoteAdmin = async function (adminId, label) {
  if (_teacherDirBusyId) return;
  if (!confirm(`Demote "${label}" to teacher? They'll lose school-wide oversight access and keep only their own content.`)) return;
  await _teacherDirRunAction(adminId, () => TeacherDirectoryService.demoteToTeacher(adminId),
    `✅ ${label} demoted to teacher.`, 'Could not demote this account.');
};

// ── ACCOUNT STATUS ACTIONS ──────────────────────────────

window.doDeactivateAccount = async function (targetId, label) {
  if (_teacherDirBusyId) return;
  if (!confirm(`Deactivate "${label}"? They'll immediately lose access to log in or use any teacher/admin features until reactivated.`)) return;
  await _teacherDirRunAction(targetId, () => TeacherDirectoryService.deactivateAccount(targetId),
    `✅ ${label} deactivated.`, 'Could not deactivate this account.');
};

window.doReactivateAccount = async function (targetId, label) {
  if (_teacherDirBusyId) return;
  if (!confirm(`Reactivate "${label}"? They'll regain access immediately.`)) return;
  await _teacherDirRunAction(targetId, () => TeacherDirectoryService.reactivateAccount(targetId),
    `✅ ${label} reactivated.`, 'Could not reactivate this account.');
};

// ── PASSWORD RESET ──────────────────────────────────────

window.doSendPasswordReset = async function (targetId, email, label) {
  if (_teacherDirBusyId) return;
  if (!email) { toast('❌ No email on file for this account.', '#ffb4ab'); return; }
  if (!confirm(`Send a password reset email to "${label}" (${email})? Their current password keeps working until they open the link and set a new one.`)) return;
  await _teacherDirRunAction(targetId, () => TeacherDirectoryService.sendPasswordReset(email),
    `✅ Reset email sent to ${email}.`, 'Could not send the reset email.');
};

// Shared helper: mark busy, run the service call, toast the result, refetch.
async function _teacherDirRunAction(id, runFn, successMsg, defaultErrorMsg) {
  _teacherDirBusyId = id;
  const el = document.getElementById('a-teachers');
  if (el) _teacherDirRenderShell(el);

  const result = await runFn();
  _teacherDirBusyId = null;

  if (!result.ok) toast('❌ ' + (result.error || defaultErrorMsg), '#ffb4ab');
  else toast(successMsg);

  if (document.getElementById('a-teachers')) window.renderTeacherDirectory();
}

// ── TRANSFER OWNERSHIP (Chunk D — full offboarding) ─────
//
// Moves EVERY section this teacher advises and EVERY piece of content they
// own to one destination teacher, in a single transaction
// (transfer_teacher_ownership(), Phase 42). Each active section gets a
// per-row choice: reassign to the destination (default), or archive
// instead. Content always bulk-moves — no per-item picker (see phase42's
// header for why). This is intentionally a DIFFERENT action from Section
// Maker's "🔁 Reassign" quick action (sections.js) — that one moves a
// single section and never touches content.

window._tdOpenTransferModal = function (fromTeacherId) {
  const rows = _teacherDirRows || [];
  const from = rows.find(r => r.id === fromTeacherId);
  if (!from) { toast('❌ Account not found.', '#ffb4ab'); return; }

  const fromLabel = _esc(from.displayName || from.email || from.id);
  const destinations = rows.filter(r => r.id !== fromTeacherId && r.isActive !== false);
  if (!destinations.length) { toast('❌ No other active account to transfer to.', '#ffb4ab'); return; }

  const destOptions = destinations
    .map(r => `<option value="${_esc(r.id)}">${_esc(r.displayName || r.email || r.id)}${r.role === 'admin' ? ' (Admin)' : ''}</option>`)
    .join('');

  const activeSections = (from.sections || []).filter(s => !s.archived);
  const sectionRows = activeSections.length
    ? activeSections.map(s => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;cursor:pointer">
        <input type="checkbox" class="td-transfer-archive-cb" value="${_esc(s.id)}">
        <span style="flex:1">${_esc(s.label)}</span>
        <span style="font-size:11px;color:var(--text-muted)">check to archive instead of reassign</span>
      </label>`).join('')
    : `<div style="font-size:12px;color:var(--text-muted)">No active sections to reassign.</div>`;

  const contentTotal = (from.achievementCount || 0) + (from.titleCount || 0) + (from.quizCount || 0)
    + (from.campaignWorldCount || 0) + (from.shopProductCount || 0);

  showModal(`
    <div style="font-family:var(--fh);font-size:18px;font-weight:900;margin-bottom:6px">📤 Transfer Ownership</div>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
      Moves everything <strong>${fromLabel}</strong> owns — ${contentTotal} content item${contentTotal === 1 ? '' : 's'}
      and ${activeSections.length} active section${activeSections.length === 1 ? '' : 's'} — to one destination account.
      This does not deactivate ${fromLabel}'s account; do that separately if they're actually leaving.
    </div>

    <div class="form-group">
      <label class="form-label">Transfer everything to</label>
      <select id="td-transfer-dest" style="width:100%">
        <option value="">— Select a teacher —</option>
        ${destOptions}
      </select>
    </div>

    ${activeSections.length ? `
    <div class="form-group">
      <label class="form-label">Sections</label>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">
        Every section below is reassigned to the destination teacher by default. Check any you'd
        rather archive instead (e.g. a section being dissolved, not handed off).
      </div>
      <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border2);border-radius:8px;padding:4px 10px">
        ${sectionRows}
      </div>
    </div>` : ''}

    <div id="td-transfer-err" style="color:#ffb4ab;font-size:13px;margin:10px 0;display:none"></div>

    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="_tdSubmitTransfer('${_esc(fromTeacherId)}','${fromLabel}')">Transfer Ownership</button>
    </div>`, 'md');
};

window._tdSubmitTransfer = async function (fromTeacherId, fromLabel) {
  const destEl = document.getElementById('td-transfer-dest');
  const toTeacherId = destEl ? destEl.value : '';
  const errEl = document.getElementById('td-transfer-err');

  if (!toTeacherId) {
    if (errEl) { errEl.textContent = '❌ Choose a destination teacher.'; errEl.style.display = 'block'; }
    return;
  }

  const archiveSectionIds = Array.from(document.querySelectorAll('.td-transfer-archive-cb:checked')).map(cb => cb.value);
  const destLabel = destEl.options[destEl.selectedIndex]?.text || 'the destination teacher';

  if (!confirm(`Transfer all of ${fromLabel}'s sections and content to ${destLabel}? This cannot be undone automatically.`)) return;

  closeModalForce();
  toast('⏳ Transferring ownership…');

  const result = await OwnershipService.transferOwnership({ fromTeacherId, toTeacherId, archiveSectionIds });
  if (!result.ok) {
    toast('❌ ' + (result.error || 'Could not transfer ownership.'), '#ffb4ab');
    return;
  }

  const s = result.summary;
  const contentMoved = s.achievements + s.titles + s.quizzes + s.campaignWorlds + s.shopProducts + s.bossLibrary;
  toast(`✅ Transferred to ${destLabel}: ${s.sectionsReassigned} section${s.sectionsReassigned === 1 ? '' : 's'} reassigned, ${s.sectionsArchived} archived, ${contentMoved} content item${contentMoved === 1 ? '' : 's'} moved.`);

  if (document.getElementById('a-teachers')) window.renderTeacherDirectory();
};
