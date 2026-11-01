-- Account-scoped study state. Independent of grades, attempts, XP and coins.
begin;
create table if not exists public.student_study_sets (
 student_id text not null references public.profiles(id) on delete cascade,
 quiz_id text not null references public.quizzes(id) on delete cascade,
 saved boolean not null default false,
 last_opened_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(student_id,quiz_id)
);
create table if not exists public.student_study_versions (
 student_id text not null, quiz_id text not null, signature text not null,
 known jsonb not null default '{}', starred jsonb not null default '{}',
 position integer not null default 0 check(position between 0 and 9999),
 updated_at timestamptz not null default now(),
 primary key(student_id,quiz_id,signature),
 foreign key(student_id,quiz_id) references public.student_study_sets(student_id,quiz_id) on delete cascade
);
create table if not exists public.student_study_operations (
 student_id text not null references public.profiles(id) on delete cascade,
 operation_id text not null, request jsonb not null, created_at timestamptz not null default now(),
 primary key(student_id,operation_id)
);
alter table public.student_study_sets enable row level security;
alter table public.student_study_versions enable row level security;
alter table public.student_study_operations enable row level security;
revoke all on public.student_study_sets,public.student_study_versions,public.student_study_operations from anon,authenticated;

create or replace function public._study_student()
returns text language plpgsql security definer set search_path=public as $$
declare sid text=auth.uid()::text;
begin
 if sid is null or not exists(select 1 from profiles where id=sid and role='student' and coalesce(is_active,true)) then
  raise exception 'An active student account is required' using errcode='42501';
 end if;
 return sid;
end; $$;
create or replace function public._study_snapshot(sid text)
returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('studentId',sid,'sets',coalesce((select jsonb_agg(jsonb_build_object(
  'quizId',s.quiz_id,'saved',s.saved,'lastOpenedAt',s.last_opened_at,
  'versions',coalesce((select jsonb_agg(jsonb_build_object('signature',v.signature,'known',v.known,'starred',v.starred,'position',v.position)) from student_study_versions v where v.student_id=sid and v.quiz_id=s.quiz_id),'[]'::jsonb)
 )) from student_study_sets s where s.student_id=sid),'[]'::jsonb));
$$;
create or replace function public.study_progress_pull()
returns jsonb language plpgsql security definer set search_path=public as $$
begin return public._study_snapshot(public._study_student()); end; $$;
create or replace function public.study_progress_apply(p_operation_id text,p_quiz_id text,p_signature text,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sid text=public._study_student(); prior jsonb; request jsonb; field text;
begin
 if p_operation_id is null or length(p_operation_id) not between 1 and 150 then raise exception 'Invalid operation'; end if;
 if p_signature is null or p_signature !~ '^[a-zA-Z0-9_-]{1,64}$' then raise exception 'Invalid content version'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>1000000 then raise exception 'Invalid patch'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('known','starred','position','saved','opened')) then raise exception 'Unsupported study field'; end if;
 foreach field in array array['known','starred'] loop
  if p_patch ? field then
   if jsonb_typeof(p_patch->field)<>'object' then raise exception 'Invalid card state'; end if;
   if exists(select 1 from jsonb_each(p_patch->field) e where e.key !~ '^[0-9]{1,4}$' or jsonb_typeof(e.value)<>'boolean') then raise exception 'Invalid card state'; end if;
  end if;
 end loop;
 if p_patch ? 'position' and (jsonb_typeof(p_patch->'position')<>'number' or (p_patch->>'position') !~ '^[0-9]{1,4}$') then raise exception 'Invalid card position'; end if;
 foreach field in array array['saved','opened'] loop
  if p_patch ? field and jsonb_typeof(p_patch->field)<>'boolean' then raise exception 'Invalid flag'; end if;
 end loop;
 -- Serialize writes for this account; patches on different cards are merged.
 perform 1 from profiles where id=sid for update;
 request=jsonb_build_object('quizId',p_quiz_id,'signature',p_signature,'patch',p_patch);
 select o.request into prior from student_study_operations o where o.student_id=sid and o.operation_id=p_operation_id;
 if found then
  if prior<>request then raise exception 'Operation already used for different changes'; end if;
  return public._study_snapshot(sid);
 end if;
 if not exists(select 1 from quizzes q where q.id=p_quiz_id and (
  not exists(select 1 from quiz_sections a where a.quiz_id=q.id) or
  exists(select 1 from quiz_sections a join profiles p on p.class_id=a.class_id where a.quiz_id=q.id and p.id=sid) or
  exists(select 1 from quiz_history h where h.quiz_id=q.id and h.student_id=sid)
 )) then raise exception 'Study set unavailable' using errcode='42501'; end if;
 insert into student_study_sets(student_id,quiz_id) values(sid,p_quiz_id) on conflict do nothing;
 update student_study_sets set saved=case when p_patch?'saved' then (p_patch->>'saved')::boolean else saved end,
  last_opened_at=case when p_patch->'opened'='true'::jsonb then now() else last_opened_at end,updated_at=now()
  where student_id=sid and quiz_id=p_quiz_id;
 insert into student_study_versions(student_id,quiz_id,signature) values(sid,p_quiz_id,p_signature) on conflict do nothing;
 update student_study_versions set known=known||coalesce(p_patch->'known','{}'),starred=starred||coalesce(p_patch->'starred','{}'),
  position=case when p_patch?'position' then (p_patch->>'position')::integer else position end,updated_at=now()
  where student_id=sid and quiz_id=p_quiz_id and signature=p_signature;
 insert into student_study_operations(student_id,operation_id,request) values(sid,p_operation_id,request);
 return public._study_snapshot(sid);
end; $$;
revoke all on function public._study_student(),public._study_snapshot(text) from public,anon,authenticated;
revoke all on function public.study_progress_pull(),public.study_progress_apply(text,text,text,jsonb) from public,anon;
grant execute on function public.study_progress_pull(),public.study_progress_apply(text,text,text,jsonb) to authenticated;
commit;
