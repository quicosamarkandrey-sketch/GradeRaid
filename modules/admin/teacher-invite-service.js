// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/teacher-invite-service.js
//  Service layer for the INVITED PERSON's side of chunk A5 (account creation
//  via invite link). Mirrors RegistrationService's role exactly, just for a
//  different table/RPC set — see registrations-service.js's header for why
//  this two-step "signUp() yourself, then a token-gated RPC" shape exists at
//  all (no service-role key in this static app).
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module:
//  teacher-invite.js (the render layer) NEVER calls DBService.rpc() or
//  DBService.getAuthClient() directly. It calls
//  TeacherInviteService.<method>(...).
//
//  Admin-side invite management (create/list/revoke) lives in
//  teacher-directory-service.js instead — this file is only ever used by
//  someone who is NOT yet logged in and has no profile/role yet.
// ═══════════════════════════════════════════════════════════════════════════════

window.TeacherInviteService = (function () {
  'use strict';

  /**
   * checkInvite(token) → Promise<{ok, error?, valid, reason?}>
   * Anon-callable — the visitor has no session at this point. Called
   * before the signup form renders at all, so an expired/used/unknown
   * token shows a clear message instead of a broken form.
   */
  async function checkInvite(token) {
    const { data, error } = await DBService.rpc('check_teacher_invite', { p_token: token });
    if (error) return { ok: false, error: error.message || 'Could not check this invite link.' };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: 'Could not check this invite link.' };
    return { ok: true, valid: row.valid, reason: row.reason };
  }

  /**
   * completeSignup(fields) → Promise<{ok, error?, profile?}>
   * fields: { token, firstName, lastName, email, password, color, init }
   *
   * Two-step write, in order (identical shape to
   * RegistrationService.registerStudent(), see its comment for the
   * "Confirm email" project-setting fallback this also needs):
   *   1. supabase.auth.signUp({ email, password }) — creates the real Auth
   *      account for the invited person, right now, for themselves. Normal
   *      unprivileged, client-safe call.
   *   2. redeem_teacher_invite() RPC — the only thing gated by the invite
   *      token; turns the brand-new, role-less account into role='teacher'
   *      and marks the invite used. If this fails, the Auth account still
   *      exists but has no profile — same recoverable gap
   *      registerStudent()'s comment already documents for students (an
   *      admin can generate a fresh invite and the person tries again;
   *      there's no "resume" flow for either case yet).
   */
  async function completeSignup(fields) {
    const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
    if (!client) return { ok: false, error: 'Still connecting, please try again in a moment.' };

    const { data: signUpData, error: signUpError } = await client.auth.signUp({
      email: fields.email,
      password: fields.password,
    });

    if (signUpError) {
      return { ok: false, error: signUpError.message || 'Could not create your account.' };
    }
    if (!signUpData || !signUpData.user) {
      return { ok: false, error: 'Could not create your account. Please try again.' };
    }

    let session = signUpData.session;
    if (!session) {
      const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
        email: fields.email, password: fields.password,
      });
      if (signInError || !signInData || !signInData.session) {
        return {
          ok: false,
          error: 'Your account was created, but "Confirm email" is turned on for this project, which blocks this flow. Turn it off in Supabase → Authentication → Sign In / Providers → Email, then try again.',
        };
      }
      session = signInData.session;
    }

    const { data, error } = await DBService.rpc('redeem_teacher_invite', {
      p_token: fields.token,
      p_first_name: fields.firstName,
      p_last_name: fields.lastName,
      p_color: fields.color || null,
      p_init: fields.init || null,
    });

    if (error) {
      console.error('[TeacherInviteService] redeem_teacher_invite failed (Auth account was still created):', error);
      // Sign back out — the Auth account exists but has no profile, so
      // leaving them "logged in" with no role would just hit auth.js's own
      // "no profile found" branch on next boot anyway. Cleaner to bail here.
      try { await client.auth.signOut(); } catch (e) {}
      return { ok: false, error: error.message || 'Your account was created, but the invite could not be completed. Contact your admin.' };
    }

    // Done with this session either way — the completion screen sends the
    // person back to the normal login form rather than auto-booting them
    // in, same posture as the student registration flow (see
    // registrations.js's success card).
    try { await client.auth.signOut(); } catch (e) {}

    return {
      ok: true,
      profile: {
        id: data.id, displayName: data.display_name,
        firstName: data.first_name, lastName: data.last_name,
      },
    };
  }

  return { checkInvite: checkInvite, completeSignup: completeSignup };
})();

console.log('[EduQuest] admin/teacher-invite-service.js loaded — TeacherInviteService registered.');
