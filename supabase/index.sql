-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 49 — SELF-SERVICE COSMETIC PROFILE UPDATES (profile picture / name fix)
--
-- Run once in the Supabase SQL editor, after Phase 1–48.
--
-- THE BUG THIS CLOSES
--   db-service.js's bulk `profiles` upsert (_pushCacheToSupabase) is the
--   ONLY code path that has ever written display_name/first_name/
--   last_name/init/profile_pic_url to Supabase. It is deliberately gated to
--   isStaffSession only (see that function's own comment — a student
--   session must never trigger the is_staff()-evaluating write path). That
--   guard is correct for the bulk roster-editing upsert, but as a side
--   effect it left NO write path at all for a student — or a teacher,
--   same gap — editing their OWN cosmetic fields. A profile picture change
--   would apply to the local in-memory/localStorage copy, look saved for
--   the rest of that session, and then silently revert on the next
--   loadDB() pull (e.g. a page refresh) once the server's unchanged copy
--   came back down.
--
--   A `profiles_self_update_cosmetic_only` policy is referenced in
--   phase14_section_isolation.sql's comments as already existing
--   ("...is untouched — still id = auth.uid()::text..."), but it was never
--   actually created anywhere in this supabase/ folder — searching every
--   migration for it turns up only that one comment. So even a direct
--   client-side `.update('profiles')` call for a student's own row would
--   have been rejected by RLS as things stand today.
--
-- THE FIX
--   update_own_profile_cosmetic() is a SECURITY DEFINER RPC — same pattern
--   as adjust_student_stats() (phase9) and sync_student_derived_stats()
--   (phase11) — scoped to `id = auth.uid()::text` server-side. The caller
--   can only ever touch their own row, regardless of any id-like value
--   floating around client-side, and the function signature only exposes
--   five cosmetic columns: display_name, first_name, last_name, init,
--   profile_pic_url. There is no p_student_id/p_role/p_class_id/p_xp/etc.
--   parameter, so no caller input can reach any column this RPC doesn't
--   explicitly name — xp/coins/level/tier/attendance_pct/quiz_avg/role/
--   class_id/id stay exactly as owned by their existing dedicated RPCs (or,
--   for role/class_id/id, by the staff-only bulk upsert alone).
--
--   Works for students, teachers, and admins alike — it's scoped by real
--   Supabase Auth identity (auth.uid()), not by which local array/branch
--   of the client called it, so it also closes the same gap for teacher
--   self-edits flagged (but left as a known gap) in a comment inside
--   index.html's saveProfileEdit().
--
--   Each parameter follows a null-means-unchanged convention matching the
--   client's existing `_profPendingPic !== null` staging pattern: pass
--   null to leave a column untouched, pass '' to explicitly clear it
--   (e.g. "Remove Photo"), or pass the new value to set it. See the
--   matching JS change: utils.js's syncOwnProfileCosmeticToServer(), called
--   from index.html's saveProfileEdit().
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.update_own_profile_cosmetic(
  p_display_name    text default null,
  p_first_name      text default null,
  p_last_name       text default null,
  p_init            text default null,
  p_profile_pic_url text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  -- coalesce(param, column): a null param leaves that column untouched; an
  -- empty string ('') is a real, distinct value from null and DOES apply
  -- (clears the column) — this is what lets "Remove Photo" clear
  -- profile_pic_url while an unrelated name-only edit leaves the picture
  -- alone, without needing a separate sentinel value.
  update public.profiles
     set display_name    = coalesce(p_display_name, display_name),
         first_name      = coalesce(p_first_name, first_name),
         last_name       = coalesce(p_last_name, last_name),
         init            = coalesce(p_init, init),
         profile_pic_url = coalesce(p_profile_pic_url, profile_pic_url)
   where id = auth.uid()::text
   returning * into v_row;

  if v_row.id is null then
    raise exception 'No profile row found for the current session (%).', auth.uid();
  end if;

  return v_row;
end;
$$;

-- authenticated only — matches every other self-service RPC in this app
-- (anon must never be able to call this; it would have no row to touch
-- anyway since auth.uid() is null for anon, but keep the grant explicit).
grant execute on function
  public.update_own_profile_cosmetic(text, text, text, text, text)
to authenticated;
