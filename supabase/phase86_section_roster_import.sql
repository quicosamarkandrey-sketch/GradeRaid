-- The Edge Function verifies the teacher's JWT and is the only caller of
-- these provisioning RPCs. Supabase Auth account writes use its Admin API.
begin;

create table if not exists public.section_roster_imports (
  id uuid primary key default gen_random_uuid(),
  section_id text not null references public.class_sections(id),
  name_key text not null,
  student_name text not null,
  actor uuid not null,
  attempt uuid not null,
  credential_hash text not null,
  created_at timestamptz not null default now(),
  student_id uuid,
  unique (section_id, name_key)
);
create index if not exists section_roster_imports_actor_date
  on public.section_roster_imports(actor, created_at);
alter table public.section_roster_imports enable row level security;
revoke all on public.section_roster_imports from public, anon, authenticated;

create or replace function public.section_roster_import_row(
  p_actor uuid, p_section text, p_name text, p_attempt uuid,
  p_hash text, p_finish boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g'));
  v_key text := lower(v_name);
  reservation public.section_roster_imports;
  account_id uuid;
  login_email text;
  first_name text;
  last_name text;
begin
  if p_attempt is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
     or v_name is null or length(v_name) not between 2 and 120
     or v_name !~ '[[:alpha:]]' or v_name ~ '[[:cntrl:]]'
     or translate(v_name, $unsafe$<>"`=&;{}()/\$unsafe$, '') <> v_name then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('roster-actor:' || p_actor::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('roster-section:' || p_section, 0));

  -- Hold the section row through the profile write to serialize against
  -- archive or adviser reassignment. Check the actor on every call.
  perform 1 from public.class_sections s
    join public.profiles p on p.id = p_actor::text
   where s.id = p_section and s.id <> 'default-class' and not s.archived
     and p.is_active and (p.role = 'admin' or (p.role = 'teacher' and s.adviser_id::text = p.id))
   for share of s, p;
  if not found then return jsonb_build_object('status', 'forbidden'); end if;

  select * into reservation from public.section_roster_imports r
    where r.section_id = p_section and r.name_key = v_key;

  if reservation.id is null then
    if p_finish then return jsonb_build_object('status', 'invalid'); end if;
    if exists (
      select 1 from public.profiles p where p.class_id = p_section and p.role = 'student'
        and lower(btrim(regexp_replace(p.display_name, '[[:space:]]+', ' ', 'g'))) = v_key
    ) then return jsonb_build_object('status', 'existing'); end if;
    if (select count(*) from public.section_roster_imports r
         where r.actor = p_actor and r.created_at > now() - interval '24 hours') >= 200 then
      return jsonb_build_object('status', 'limit');
    end if;
    insert into public.section_roster_imports(section_id, name_key, student_name, actor, attempt, credential_hash)
      values(p_section, v_key, v_name, p_actor, p_attempt, p_hash)
      returning * into reservation;
  elsif reservation.actor <> p_actor or reservation.attempt <> p_attempt or reservation.credential_hash <> p_hash then
    return jsonb_build_object('status', case when reservation.student_id is null then 'pending' else 'existing' end);
  end if;

  login_email := 'gr-' || left(replace(reservation.id::text, '-', ''), 20) || '@students.graderaid.example';
  select u.id into account_id from auth.users u
    where u.email = login_email and u.raw_app_meta_data->>'graderaid_roster_id' = reservation.id::text;

  if reservation.student_id is not null then
    if account_id = reservation.student_id and exists (
      select 1 from public.profiles p where p.id = account_id::text and p.class_id = p_section
    ) then return jsonb_build_object('status', 'created', 'login', login_email); end if;
    return jsonb_build_object('status', 'existing');
  end if;

  if not p_finish then
    return jsonb_build_object('status', 'reserved', 'login', login_email,
      'reservation', reservation.id, 'hasAccount', account_id is not null);
  end if;
  if account_id is null then return jsonb_build_object('status', 'retry'); end if;

  if position(',' in v_name) > 0 then
    last_name := btrim(split_part(v_name, ',', 1));
    first_name := btrim(substr(v_name, position(',' in v_name) + 1));
  else
    first_name := split_part(v_name, ' ', 1);
    last_name := substr(v_name, length(first_name) + 2);
  end if;
  insert into public.profiles (
    id, role, display_name, first_name, last_name, init, color, class_id,
    xp, coins, level, tier, attendance_pct, quiz_avg, join_date
  ) values (
    account_id::text, 'student', v_name, first_name, last_name,
    upper(left(first_name, 1) || left(last_name, 1)), '#64748b', p_section,
    0, 0, 1, 'Novice', 0, 0, current_date
  ) on conflict (id) do nothing;
  if not exists (
    select 1 from public.profiles p where p.id = account_id::text
      and p.class_id = p_section and p.role = 'student'
  ) then return jsonb_build_object('status', 'conflict'); end if;
  update public.section_roster_imports set student_id = account_id where id = reservation.id;
  return jsonb_build_object('status', 'created', 'login', login_email);
end;
$$;
revoke all on function public.section_roster_import_row(uuid,text,text,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.section_roster_import_row(uuid,text,text,uuid,text,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
