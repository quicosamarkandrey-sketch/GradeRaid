// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/teacher-directory-service.js
//  Service layer for admin-only account/role management.
//  (ISOLATION_ROLES_PLAN.md §11 "Account & access management", §12 step 5,
//   chunk A1 — see supabase/phase34_admin_role_management.sql.)
//
//  REPOSITORY PATTERN CONTRACT — same rule as RegistrationService/
//  SectionService: teacher-directory.js (the render layer, chunk A2) NEVER
//  calls DBService.rpc() directly for a role change. It calls
//  TeacherDirectoryService.<method>(...).
//
//  WHAT'S HERE NOW (A1 + A2 + A3 + A4 + A5)
//    getDirectory() — read-only list backing the Teacher Directory screen.
//    promoteToAdmin() / demoteToTeacher() — the two role-change RPCs.
//    deactivateAccount() / reactivateAccount() — account lockout RPCs.
//    sendPasswordReset() — chunk A4. NOT an RPC (no server-side admin gate
//    exists or is needed for it — see its own comment) — routed through
//    DBService.sendPasswordResetEmail() instead of DBService.rpc().
//    createInvite() / getInvites() / revokeInvite() — chunk A5, teacher
//    account creation via invite link. See supabase/phase37_teacher_invites.sql
//    and modules/admin/teacher-invite.js (the invited person's completion
//    screen — a separate, mostly-anonymous flow, not part of this service).
//    The role/status/invite actions above are all admin-gated server-side
//    (see phase34/35/36/37's is_admin() checks); the JS side does no
//    authorization of its own, same posture as every other *Service module
//    in this app.
// ═══════════════════════════════════════════════════════════════════════════════

window.TeacherDirectoryService = (function () {
  'use strict';

  /**
   * getDirectory() → Promise<{ok, teachers?, error?}>
   * Read-only list of every admin/teacher account (chunk A2). Shape per
   * row mirrors get_teacher_directory()'s jsonb_build_object keys exactly —
   * no renaming here, so the SQL comment stays the single source of truth
   * for the shape.
   */
  async function getDirectory() {
    const { data, error } = await DBService.rpc('get_teacher_directory', {});
    if (error) return { ok: false, error: error.message || 'Could not load the teacher directory.' };
    return { ok: true, teachers: data || [] };
  }

  /**
   * promoteToAdmin(teacherId) → Promise<{ok, error?}>
   * Promotes an existing role='teacher' profile to role='admin'.
   */
  async function promoteToAdmin(teacherId) {
    if (!teacherId) return { ok: false, error: 'Missing teacher id.' };
    const { error } = await DBService.rpc('promote_to_admin', { p_teacher_id: teacherId });
    if (error) return { ok: false, error: error.message || 'Could not promote this account.' };
    return { ok: true };
  }

  /**
   * demoteToTeacher(adminId) → Promise<{ok, error?}>
   * Demotes an existing role='admin' profile back to role='teacher'.
   * The RPC itself refuses to demote the last remaining admin — surface
   * that message as-is rather than re-deriving the same rule here.
   */
  async function demoteToTeacher(adminId) {
    if (!adminId) return { ok: false, error: 'Missing admin id.' };
    const { error } = await DBService.rpc('demote_to_teacher', { p_admin_id: adminId });
    if (error) return { ok: false, error: error.message || 'Could not demote this account.' };
    return { ok: true };
  }

  /**
   * deactivateAccount(targetId) → Promise<{ok, error?}>
   * Refuses (server-side) to deactivate the caller's own account or the
   * last remaining active admin — see deactivate_teacher_account()'s guards.
   */
  async function deactivateAccount(targetId) {
    if (!targetId) return { ok: false, error: 'Missing account id.' };
    const { error } = await DBService.rpc('deactivate_teacher_account', { p_target_id: targetId });
    if (error) return { ok: false, error: error.message || 'Could not deactivate this account.' };
    return { ok: true };
  }

  /**
   * reactivateAccount(targetId) → Promise<{ok, error?}>
   */
  async function reactivateAccount(targetId) {
    if (!targetId) return { ok: false, error: 'Missing account id.' };
    const { error } = await DBService.rpc('reactivate_teacher_account', { p_target_id: targetId });
    if (error) return { ok: false, error: error.message || 'Could not reactivate this account.' };
    return { ok: true };
  }

  /**
   * sendPasswordReset(email) → Promise<{ok, error?}>
   * (Chunk A4 — Teacher Directory "Send Reset Email" action.)
   *
   * Triggers Supabase's standard recovery email for the given account via
   * DBService.sendPasswordResetEmail() — NOT a Postgres RPC, so unlike
   * every other method in this file it has no server-side is_admin() gate
   * to lean on. That's fine here specifically: resetPasswordForEmail() is
   * intentionally a public, unauthenticated GoTrue endpoint (it's the same
   * call an unauthenticated "Forgot password?" link would use) that never
   * reveals whether the email exists and never touches another account's
   * data — it only ever results in an email being sent to whatever address
   * is given. The Teacher Directory just gives an admin a one-click way to
   * fire it at a specific teacher's known address instead of that teacher
   * needing a "forgot password" link of their own (which this app doesn't
   * have yet — see recovery.js's header for why that's a fine gap for now).
   *
   * redirectTo points back at this app's own origin+path (see recovery.js)
   * so the link lands on the in-app "Set new password" screen rather than
   * Supabase's bare default page.
   */
  async function sendPasswordReset(email) {
    if (!email) return { ok: false, error: 'This account has no email on file.' };
    const redirectTo = window.location.origin + window.location.pathname;
    return DBService.sendPasswordResetEmail(email, redirectTo);
  }

  /**
   * createInvite() → Promise<{ok, error?, invite?}>
   * (Chunk A5.) Generates a new pending, 7-day invite. The token comes back
   * so the caller can build the shareable link — see teacher-directory.js's
   * _teacherInviteLink() for the exact URL shape.
   */
  async function createInvite() {
    const { data, error } = await DBService.rpc('create_teacher_invite', {});
    if (error) return { ok: false, error: error.message || 'Could not create an invite link.' };
    return {
      ok: true,
      invite: {
        token: data.token, createdAt: data.created_at,
        expiresAt: data.expires_at, status: data.status,
      },
    };
  }

  /**
   * getInvites() → Promise<{ok, error?, invites?}>
   * Every invite ever created (pending/used/revoked), for the directory's
   * "Outstanding invites" panel.
   */
  async function getInvites() {
    const { data, error } = await DBService.rpc('get_teacher_invites', {});
    if (error) return { ok: false, error: error.message || 'Could not load invite links.' };
    return { ok: true, invites: data || [] };
  }

  /**
   * revokeInvite(token) → Promise<{ok, error?}>
   */
  async function revokeInvite(token) {
    if (!token) return { ok: false, error: 'Missing invite token.' };
    const { error } = await DBService.rpc('revoke_teacher_invite', { p_token: token });
    if (error) return { ok: false, error: error.message || 'Could not revoke this invite.' };
    return { ok: true };
  }

  return {
    getDirectory: getDirectory,
    promoteToAdmin: promoteToAdmin,
    demoteToTeacher: demoteToTeacher,
    deactivateAccount: deactivateAccount,
    reactivateAccount: reactivateAccount,
    sendPasswordReset: sendPasswordReset,
    createInvite: createInvite,
    getInvites: getInvites,
    revokeInvite: revokeInvite,
  };
})();
