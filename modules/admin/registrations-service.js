// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/registrations-service.js
//  Service layer for the registration system, added by the Wave 2 security
//  fixes (see supabase/wave2_registration_security_fixes.sql and
//  Registration_Fix_List.md).
//
//  REPOSITORY PATTERN CONTRACT — same rule as SectionService/AttendanceService:
//  registrations.js NEVER calls Supabase directly for account creation or
//  approval/rejection. It calls RegistrationService.<method>(...). This is
//  the ONLY thing that:
//    a) calls supabase.auth.signUp() to create the real Auth account, and
//    b) calls DBService.rpc() for every registrations table write.
//
//  WHY THIS EXISTS (Critical Fix #1 / #2)
//    Approved students previously could never log in — no Auth account was
//    ever created for them, and even if one had been, profiles.id was being
//    set to the plaintext username instead of the Auth UUID every other
//    table in this project already expects. Both are fixed by creating the
//    Auth account up front, at registration time (registerStudent() below),
//    instead of trying to create one later from admin code (which would
//    need a service-role key / Edge Function this static app doesn't have).
// ═══════════════════════════════════════════════════════════════════════════════

window.RegistrationService = (function () {
  'use strict';

  /**
   * registerStudent(fields) → Promise<{ok, error?, registration?}>
   * fields: { firstName, lastName, username, email, studentId, gradeLevel, section, password }
   *
   * Two-step write, in order:
   *   1. supabase.auth.signUp({ email, password }) — creates the real Auth
   *      account right now. This is a normal, unprivileged, client-safe
   *      call (any anon visitor can call it for themselves; that's the
   *      whole point of self-serve signup). The password is handed
   *      straight to GoTrue and never touches our own tables.
   *   2. submit_registration() RPC — inserts the pending review row, tied
   *      to the UUID signUp() just returned. If this fails, the Auth
   *      account still exists but has no registration row — recoverable
   *      (student can be told to contact an admin, or a future "resume
   *      registration" flow could detect uid-exists-but-no-row and retry
   *      step 2 only), and strictly better than the old failure mode
   *      (approved students with literally no way to authenticate at all).
   */
  async function registerStudent(fields) {
    const client = (typeof DBService !== 'undefined') ? DBService.getAuthClient() : null;
    if (!client) return { ok: false, error: 'Still connecting, please try again in a moment.' };

    const { data: signUpData, error: signUpError } = await client.auth.signUp({
      email: fields.email,
      password: fields.password,
    });

    if (signUpError) {
      // Supabase's own message for "email already has an account" is
      // reasonably student-friendly already; pass it through.
      return { ok: false, error: signUpError.message || 'Could not create your account.' };
    }
    if (!signUpData || !signUpData.user) {
      return { ok: false, error: 'Could not create your account. Please try again.' };
    }

    // If "Confirm email" is turned on in the Supabase project's Auth
    // settings, signUp() creates the account but does NOT return an active
    // session — the student would need to click an email link first. Since
    // this app's approval flow doesn't use email confirmation (an admin
    // approving the request IS the confirmation step), immediately sign in
    // with the same credentials so submit_registration() below has a real
    // session to authenticate with. This also makes the whole flow work
    // correctly even if "Confirm email" is left on in the dashboard.
    let session = signUpData.session;
    if (!session) {
      const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
        email: fields.email, password: fields.password,
      });
      if (signInError || !signInData || !signInData.session) {
        return {
          ok: false,
          error: 'Your account was created, but "Confirm email" is turned on for this project, which blocks self-serve registration. Turn it off in Supabase → Authentication → Sign In / Providers → Email, then try again.',
        };
      }
      session = signInData.session;
    }

    const uid = signUpData.user.id;

    const { data, error } = await DBService.rpc('submit_registration', {
      p_id: uid,
      p_first_name: fields.firstName,
      p_last_name: fields.lastName,
      p_username: fields.username,
      p_email: fields.email,
      p_student_id_text: fields.studentId,
      p_grade_level: fields.gradeLevel,
      p_section: fields.section,
    });

    if (error) {
      console.error('[RegistrationService] submit_registration failed (Auth account was still created):', error);
      return { ok: false, error: error.message || 'Could not submit your registration. Contact your teacher — your login was created, but your registration was not recorded.' };
    }

    return {
      ok: true,
      registration: {
        id: data.id, firstName: data.first_name, lastName: data.last_name,
        username: data.username, email: data.email, studentId: data.student_id_text,
        gradeLevel: data.grade_level, section: data.section, status: data.status,
        submittedAt: data.submitted_at,
      },
    };
  }

  /**
   * checkStatus(email) → Promise<{ok, error?, found, status?, rejectionReason?, submittedAt?}>
   * Fix list item #9 — "check my registration status" screen.
   */
  async function checkStatus(email) {
    const { data, error } = await DBService.rpc('check_registration_status', { p_email: email });
    if (error) {
      console.error('[RegistrationService] checkStatus failed:', error);
      return { ok: false, error: error.message || 'Could not check status.' };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: true, found: false };
    return {
      ok: true, found: true, status: row.status,
      rejectionReason: row.rejection_reason, submittedAt: row.submitted_at,
    };
  }

  /**
   * approve(regId, opts) → Promise<{ok, error?, profile?}>
   * opts: { color, init } — cosmetic-only, computed client-side (same
   * regPickColor/regMakeInitials helpers as before) since they're display
   * values, not security-sensitive.
   */
  async function approve(regId, opts) {
    opts = opts || {};
    const { data, error } = await DBService.rpc('approve_registration', {
      p_reg_id: regId, p_color: opts.color || null, p_init: opts.init || null,
    });
    if (error) {
      console.error('[RegistrationService] approve failed:', error);
      return { ok: false, error: error.message || 'Could not approve registration.' };
    }
    return {
      ok: true,
      profile: {
        id: data.id, name: data.display_name, init: data.init, color: data.color,
        xp: data.xp, coins: data.coins, level: data.level, tier: data.tier,
        attendance: Number(data.attendance_pct) || 0, quizAvg: Number(data.quiz_avg) || 0,
        firstName: data.first_name, lastName: data.last_name, displayName: data.display_name,
        classId: data.class_id, joinDate: data.join_date,
      },
    };
  }

  /**
   * reject(regId, reason) → Promise<{ok, error?, registration?}>
   */
  async function reject(regId, reason) {
    const { data, error } = await DBService.rpc('reject_registration', {
      p_reg_id: regId, p_reason: reason || null,
    });
    if (error) {
      console.error('[RegistrationService] reject failed:', error);
      return { ok: false, error: error.message || 'Could not reject registration.' };
    }
    return { ok: true, registration: { id: data.id, status: data.status, rejectionReason: data.rejection_reason } };
  }

  /**
   * reassign(regId, newClassId) → Promise<{ok, error?, registration?}>
   * (ISOLATION_ROLES_PLAN.md §11 "Cross-teacher registrations queue" — Chunk
   * F.) Admin-only server-side (reassign_registration(), phase43) — moves a
   * still-PENDING registration to a different section/teacher before it's
   * approved, for the case where a student picked the wrong section at
   * signup. newClassId is a real class_sections.id (from the same
   * AppStore.classSections list every other section picker in this app
   * already uses), not a grade/section string pair — the RPC re-derives
   * grade_level/section from that row itself, so there's no risk of the
   * two drifting apart.
   */
  async function reassign(regId, newClassId) {
    const { data, error } = await DBService.rpc('reassign_registration', {
      p_reg_id: regId, p_new_class_id: newClassId,
    });
    if (error) {
      console.error('[RegistrationService] reassign failed:', error);
      return { ok: false, error: error.message || 'Could not reassign this registration.' };
    }
    return {
      ok: true,
      registration: {
        id: data.id, gradeLevel: data.grade_level, section: data.section, classId: data.class_id,
      },
    };
  }

  return { registerStudent, checkStatus, approve, reject, reassign };
}());

console.log('[EduQuest] admin/registrations-service.js loaded — RegistrationService registered.');
