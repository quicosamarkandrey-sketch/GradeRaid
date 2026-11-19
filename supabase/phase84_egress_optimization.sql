-- Run after the classroom/world-boss migrations through phase83.
-- Additive: original RPCs, permissions, scoring and loot rules remain intact.
-- Old clients keep full responses; new clients opt into conditional packets.
begin;
create or replace function public.egress_pack(p_data jsonb,p_known jsonb default '{}')
returns jsonb language plpgsql immutable set search_path=public as $$
declare
 parts jsonb='{}'; shape jsonb='{}'; changes jsonb='{}'; versions jsonb='{}';
 known jsonb=case when jsonb_typeof(p_known->'hashes')='object' then p_known->'hashes' else '{}' end;
 section record; field record; item jsonb; row_key text; path text; digest text; ordering jsonb;
 removed jsonb; row_keys text[]; keyed boolean;
begin
 if p_known->>'v' is distinct from '1' or jsonb_typeof(p_data)<>'object' then return p_data;end if;
 for section in select * from jsonb_each(p_data) loop
  if jsonb_typeof(section.value)='object' then
   shape=shape||jsonb_build_object(section.key,'object');
   for field in select * from jsonb_each(section.value) loop
    parts=parts||jsonb_build_object(jsonb_build_array(section.key,field.key)::text,field.value);
   end loop;
  elsif jsonb_typeof(section.value)='array' then
   row_keys='{}';keyed=true;
   for item in select value from jsonb_array_elements(section.value) loop
    row_key=coalesce(item->>'id',case when item ? 'student_id' then jsonb_build_array(item->'student_id',item->'boss_id',item->'item_id',item->'achievement_id',item->'title_id',item->'quiz_id')::text end);
    if jsonb_typeof(item)<>'object' or row_key is null or row_key=any(row_keys) then keyed=false;exit;end if;
    row_keys=array_append(row_keys,row_key);
   end loop;
   if keyed then
    shape=shape||jsonb_build_object(section.key,'rows');ordering='[]';
    for item in select value from jsonb_array_elements(section.value) loop
     row_key=coalesce(item->>'id',case when item ? 'student_id' then jsonb_build_array(item->'student_id',item->'boss_id',item->'item_id',item->'achievement_id',item->'title_id',item->'quiz_id')::text end);ordering=ordering||jsonb_build_array(row_key);
     for field in select * from jsonb_each(item) loop
      parts=parts||jsonb_build_object(jsonb_build_array(section.key,row_key,field.key)::text,field.value);
     end loop;
    end loop;
    parts=parts||jsonb_build_object(jsonb_build_array(section.key,'@order')::text,ordering);
   else
    shape=shape||jsonb_build_object(section.key,'value');
    parts=parts||jsonb_build_object(jsonb_build_array(section.key)::text,section.value);
   end if;
  else
   shape=shape||jsonb_build_object(section.key,'value');
   parts=parts||jsonb_build_object(jsonb_build_array(section.key)::text,section.value);
  end if;
 end loop;
 -- Compact canonical paths match JSON.stringify(array) in the browser.
 parts=parts||jsonb_build_object('["$shape"]',shape);
 for field in select * from jsonb_each(parts) loop
  path=(select '['||string_agg(to_jsonb(v)::text,',')||']' from jsonb_array_elements_text(field.key::jsonb) v);
  digest=md5(field.value::text);
  if known->>path is distinct from digest then changes=changes||jsonb_build_object(path,field.value);versions=versions||jsonb_build_object(path,digest);end if;
 end loop;
 select coalesce(jsonb_agg(k),'[]') into removed from jsonb_object_keys(known) k
 where not exists(select 1 from jsonb_object_keys(parts) p where p::jsonb=k::jsonb);
 return jsonb_build_object('__egress',1,'changes',changes,'versions',versions,'removed',removed);
end;$$;
revoke all on function public.egress_pack(jsonb,jsonb) from public,anon,authenticated;

-- Keep the native boss ID type (text or UUID); never introduce an ambiguous overload.
do $install$
declare native_type text; other_type text;
begin
 if to_regclass('public.boss_events') is null then return;end if;
 select format_type(atttypid,null) into native_type from pg_attribute where attrelid='public.boss_events'::regclass and attname='id' and not attisdropped;
 other_type=case when native_type='uuid' then 'text' else 'uuid' end;
 execute format('drop function if exists public.world_boss_delta(%s,text,jsonb)',other_type);
 execute format($fn$
  create or replace function public.world_boss_delta(p_boss_id %s,p_action text,p_payload jsonb default '{}')
  returns jsonb language plpgsql security definer set search_path=public as $body$
  begin
   return public.egress_pack(public.world_boss_action(p_boss_id,p_action,p_payload-'_egress'),p_payload->'_egress');
  end;$body$;
 $fn$,native_type);
 execute format('revoke all on function public.world_boss_delta(%s,text,jsonb) from public,anon',native_type);
 execute format('grant execute on function public.world_boss_delta(%s,text,jsonb) to authenticated',native_type);
end;$install$;
create or replace function public.recitation_presentation_delta(p_class_id text,p_action text,p_device text default '',p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 return public.egress_pack(public.recitation_presentation(p_class_id,p_action,p_device,p_payload-'_egress'),p_payload->'_egress');
end;$$;
revoke all on function public.recitation_presentation_delta(text,text,text,jsonb) from public,anon;
grant execute on function public.recitation_presentation_delta(text,text,text,jsonb) to authenticated;
create or replace function public.attendance_station_delta(p_class_id text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 return public.egress_pack(public.attendance_station(p_class_id,p_action,p_payload-'_egress'),p_payload->'_egress');
end;$$;
revoke all on function public.attendance_station_delta(text,text,jsonb) from public,anon;
grant execute on function public.attendance_station_delta(text,text,jsonb) to authenticated;

-- Shared table refreshes still run as the authenticated caller: existing table
-- GRANTs and RLS determine every returned row. No SECURITY DEFINER table reader.
-- Invoker reader needs the pure packer, which cannot query any table itself.
grant execute on function public.egress_pack(jsonb,jsonb) to authenticated;
create or replace function public.egress_table_snapshot(p_table text,p_order text default null,p_ascending boolean default false,p_limit integer default null,p_known jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare rows jsonb;query text;allowed_order text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_table<>all(array['profiles','boss_events','boss_participants','loot_claims','achievements','user_achievements','registrations','point_log','redemptions','recitation_log','rfid_cards','attendance_schedules','attendance_logs','shop_products','mail_messages','quiz_sections','achievement_sections','titles','title_unlocks','quizzes','title_sections','campaign_worlds','orders','inventory','campaign_stage_sections','quiz_history','notifications','student_skills','recitation_sessions']) or p_table is null then raise exception 'Table unavailable' using errcode='42501';end if;
 allowed_order=case p_table when 'attendance_logs' then 'log_date' when 'quiz_history' then 'completed_at' when 'campaign_worlds' then 'sort_order' else 'created_at' end;
 if p_order is not null and p_order<>allowed_order then raise exception 'Invalid sort column';end if;
 if p_limit is not null and (p_limit<1 or p_limit>5000) then raise exception 'Invalid page size';end if;
 query=format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select * from public.%I',p_table);
 if p_order is not null then query=query||format(' order by %I %s',p_order,case when p_ascending then 'asc' else 'desc' end);end if;
 query=query||format(' limit %s) r',coalesce(p_limit,1000));
 execute query into rows;
 return public.egress_pack(jsonb_build_object('rows',rows),p_known);
end;$$;
revoke all on function public.egress_table_snapshot(text,text,boolean,integer,jsonb) from public,anon;
grant execute on function public.egress_table_snapshot(text,text,boolean,integer,jsonb) to authenticated;

-- Small, scoped change notices replace shipping full Postgres row images to
-- every open tab. This table contains no names, questions, scores or artwork.
create table if not exists public.sync_invalidations (
 table_name text not null,scope_key text not null,class_id text,student_id text,
 revision uuid not null default gen_random_uuid(),primary key(table_name,scope_key)
);
alter table public.sync_invalidations enable row level security;
revoke all on public.sync_invalidations from public,anon,authenticated;
grant select on public.sync_invalidations to authenticated;
create or replace function public.egress_can_read_notice(p_class text,p_student text)
returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and (
  (p_class is null and p_student is null) or p_student=auth.uid()::text
  or public.is_staff_for_section(coalesce(p_class,(select class_id from public.profiles where id=p_student)))
  or p_class=(select class_id from public.profiles where id=auth.uid()::text)
 );
$$;
revoke all on function public.egress_can_read_notice(text,text) from public,anon;
grant execute on function public.egress_can_read_notice(text,text) to authenticated;
drop policy if exists sync_notice_read on public.sync_invalidations;
create policy sync_notice_read on public.sync_invalidations for select to authenticated
 using (public.egress_can_read_notice(class_id,student_id));
create or replace function public.egress_notice_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare prev jsonb;curr jsonb;r jsonb;cid text;sid text;k text;done text[]='{}';
begin
 if TG_OP<>'INSERT' then prev=to_jsonb(OLD);end if;
 if TG_OP<>'DELETE' then curr=to_jsonb(NEW);end if;
 if TG_OP='UPDATE' and (prev-'raid_seen_at')=(curr-'raid_seen_at') then return null;end if;
 for r in select value from jsonb_array_elements(jsonb_build_array(prev,curr)) where value<>'null'::jsonb loop
  cid=nullif(r->>'class_id','');sid=null;
  if cid is null then sid=coalesce(r->>'student_id',case when TG_TABLE_NAME='profiles' then r->>'id' end);end if;
  k=case when cid is not null then 'class:'||cid when sid is not null then 'student:'||sid else 'catalog' end;
  if k=any(done) then continue;end if;done=array_append(done,k);
  insert into public.sync_invalidations(table_name,scope_key,class_id,student_id) values(TG_TABLE_NAME,k,cid,sid)
   on conflict(table_name,scope_key) do update set revision=gen_random_uuid();
 end loop;
 return null;
end;$$;
revoke all on function public.egress_notice_trigger() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['profiles','boss_events','boss_participants','loot_claims','achievements','user_achievements','point_log','recitation_log','rfid_cards','attendance_logs','mail_messages','quiz_sections','achievement_sections','titles','title_unlocks','title_sections','quizzes','campaign_worlds','campaign_stage_sections','orders','inventory','quiz_history','notifications','student_skills','recitation_sessions'] loop
  if to_regclass('public.'||t) is not null then
   execute format('drop trigger if exists egress_notice on public.%I',t);
   execute format('create trigger egress_notice after insert or update or delete on public.%I for each row execute function public.egress_notice_trigger()',t);
  end if;
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sync_invalidations') then
  alter publication supabase_realtime add table public.sync_invalidations;
 end if;
end $$;
create or replace function public.egress_sync_status()
returns jsonb language sql security invoker set search_path=public as $$select jsonb_build_object('v',1)$$;
revoke all on function public.egress_sync_status() from public,anon;
grant execute on function public.egress_sync_status() to authenticated;

notify pgrst,'reload schema';
commit;
