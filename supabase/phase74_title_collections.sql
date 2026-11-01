-- Optional collection families, evolution stages and factual award history.
-- Does not change title earning rules or existing grant/revoke RPCs.
begin;
create table if not exists public.title_collection_meta(
 title_id text primary key references public.titles(id) on delete cascade,
 family text not null default '' check(length(family)<=80),
 stage integer not null default 1 check(stage between 1 and 100),
 season text not null default '' check(length(season)<=80),
 updated_at timestamptz not null default now()
);
create table if not exists public.title_award_events(
 id uuid primary key default gen_random_uuid(),student_id text not null,
 title_id text not null,title_name text not null,description text,
 event text not null check(event in ('earned','revoked')),source text not null,
 actor_id text,actor_name text,created_at timestamptz not null default now()
);
create index if not exists title_award_events_student_idx on public.title_award_events(student_id,created_at desc);
alter table public.title_collection_meta enable row level security;
alter table public.title_award_events enable row level security;
revoke all on public.title_collection_meta,public.title_award_events from anon,authenticated;
create or replace function public._title_record_award()
returns trigger language plpgsql security definer set search_path=public as $$
declare sid text;tid text;t public.titles;actor public.profiles;method text;
begin
 if tg_op='DELETE' then sid=old.student_id;tid=old.title_id;else sid=new.student_id;tid=new.title_id;end if;
 select * into t from titles where id=tid;
 select * into actor from profiles where id=auth.uid()::text;
 method=case when actor.role in ('teacher','admin') then 'teacher' when t.achievement_id is not null and exists(select 1 from user_achievements where student_id=sid and achievement_id=t.achievement_id) then 'achievement' else 'reward' end;
 insert into title_award_events(student_id,title_id,title_name,description,event,source,actor_id,actor_name)
 values(sid,tid,coalesce(t.name,'Retired title'),t.description,case when tg_op='DELETE' then 'revoked' else 'earned' end,method,actor.id,case when actor.role in ('teacher','admin') then coalesce(actor.display_name,'Teacher') end);
 if tg_op='DELETE' then return old;end if;return new;
end; $$;
drop trigger if exists title_record_award on public.title_unlocks;
create trigger title_record_award after insert or delete on public.title_unlocks for each row execute function public._title_record_award();

create or replace function public.title_collection_details()
returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer public.profiles;
begin
 select * into viewer from profiles where id=auth.uid()::text and coalesce(is_active,true);
 if viewer.id is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object('viewerId',viewer.id,'version',1,
 'metadata',coalesce((select jsonb_agg(to_jsonb(m)) from title_collection_meta m join titles t on t.id=m.title_id where
  viewer.role='admin' or (viewer.role='teacher' and t.owner_teacher_id=viewer.id) or (viewer.role='student' and (
    exists(select 1 from title_unlocks u where u.student_id=viewer.id and u.title_id=t.id) or
    (t.active and case when t.achievement_id is not null then
      not exists(select 1 from achievement_sections a where a.achievement_id=t.achievement_id) or exists(select 1 from achievement_sections a where a.achievement_id=t.achievement_id and a.class_id=viewer.class_id)
    else not exists(select 1 from title_sections s where s.title_id=t.id) or exists(select 1 from title_sections s where s.title_id=t.id and s.class_id=viewer.class_id) end)
  ))),'[]'::jsonb),
 'history',case when viewer.role='student' then coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (select * from title_award_events where student_id=viewer.id order by created_at desc limit 500) e),'[]'::jsonb) else '[]'::jsonb end,
 'legacyEarned',case when viewer.role='student' then coalesce((select jsonb_agg(jsonb_build_object('title_id',u.title_id,'unlocked_at',u.unlocked_at)) from title_unlocks u where u.student_id=viewer.id),'[]'::jsonb) else '[]'::jsonb end);
end; $$;
create or replace function public.set_title_collection_details(p_title_id text,p_family text,p_stage integer,p_season text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer public.profiles;t public.titles;family_name text=btrim(coalesce(p_family,''));season_name text=btrim(coalesce(p_season,''));
begin
 select * into viewer from profiles where id=auth.uid()::text and role in ('admin','teacher') and coalesce(is_active,true);
 if viewer.id is null then raise exception 'Staff access required' using errcode='42501';end if;
 select * into t from titles where id=p_title_id for update;
 if not found or (viewer.role<>'admin' and t.owner_teacher_id is distinct from viewer.id) then raise exception 'Not authorized for this title' using errcode='42501';end if;
 lock table public.title_collection_meta in share row exclusive mode;
 if length(family_name)>80 or length(season_name)>80 or p_stage is null or p_stage not between 1 and 100 then raise exception 'Family and season must be at most 80 characters; stage must be 1–100';end if;
 -- Stages distinguish ranks within one teacher's collection, never unlock prerequisites.
 if family_name<>'' and exists(select 1 from title_collection_meta m join titles other on other.id=m.title_id where m.title_id<>t.id and other.owner_teacher_id is not distinct from t.owner_teacher_id and m.family=family_name and m.season=season_name and m.stage=p_stage) then raise exception 'This collection already has that stage number';end if;
 insert into title_collection_meta(title_id,family,stage,season) values(t.id,family_name,p_stage,season_name)
 on conflict(title_id) do update set family=excluded.family,stage=excluded.stage,season=excluded.season,updated_at=now();
 return public.title_collection_details();
end; $$;
revoke all on function public._title_record_award() from public,anon,authenticated;
revoke all on function public.title_collection_details(),public.set_title_collection_details(text,text,integer,text) from public,anon;
grant execute on function public.title_collection_details(),public.set_title_collection_details(text,text,integer,text) to authenticated;
commit;
