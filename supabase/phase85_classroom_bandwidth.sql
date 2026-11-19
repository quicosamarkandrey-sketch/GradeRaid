-- Requires phase84. Additive upgrade: change-driven classroom updates and
-- bounded peer battle history. Original game/scoring RPCs remain authoritative.
begin;
create or replace function public.egress_pack(p_data jsonb,p_known jsonb default '{}')
returns jsonb language plpgsql immutable set search_path=public as $$
declare result jsonb;known jsonb=case when jsonb_typeof(p_known->'hashes')='object' then p_known->'hashes' else '{}' end;
begin
 if coalesce(p_known->>'v','') not in ('1','2') or p_data is null or jsonb_typeof(p_data)<>'object' then return p_data;end if;
 -- Build/hash atoms once using set operations. Do not repeatedly concatenate
 -- large JSON documents or rescan every existing key for every deletion.
 with sections as materialized (
  select key,value,jsonb_typeof(value) kind from jsonb_each(p_data)
 ), members as materialized (
  select s.key,e.value,e.ordinality ord,
   coalesce(e.value->>'id',case when e.value ? 'student_id' then md5(jsonb_build_array(e.value->'student_id',e.value->'boss_id',e.value->'item_id',e.value->'achievement_id',e.value->'title_id',e.value->'quiz_id')::text) end) row_key
  from sections s cross join lateral jsonb_array_elements(case when s.kind='array' then s.value else '[]'::jsonb end) with ordinality e
 ), arrays as (
  select s.key,count(m.ord)=count(m.row_key) and count(m.row_key)=count(distinct m.row_key) and coalesce(bool_and(jsonb_typeof(m.value)='object') filter(where m.ord is not null),true) keyed
  from sections s left join members m on m.key=s.key where s.kind='array' group by s.key
 ), shapes as (
  select s.key,case when s.kind='object' then 'object' when s.kind='array' and a.keyed then 'rows' else 'value' end kind
  from sections s left join arrays a on a.key=s.key
 ), atoms as (
  select jsonb_build_array(s.key) path,s.value content from sections s join shapes t on s.key=t.key where t.kind='value'
  union all
  select jsonb_build_array(s.key,f.key),f.value from sections s cross join lateral jsonb_each(case when s.kind='object' then s.value else '{}'::jsonb end) f
  union all
  select jsonb_build_array(m.key,m.row_key,f.key),f.value from members m join arrays a on a.key=m.key and a.keyed
   cross join lateral jsonb_each(case when jsonb_typeof(m.value)='object' then m.value else '{}'::jsonb end) f
  union all
  select jsonb_build_array(a.key,'@order'),coalesce(jsonb_agg(m.row_key order by m.ord) filter(where m.ord is not null),'[]'::jsonb)
   from arrays a left join members m on m.key=a.key where a.keyed group by a.key
  union all
  select '["$shape"]'::jsonb,coalesce(jsonb_object_agg(key,kind),'{}'::jsonb) from shapes
 ), hashed as materialized (
  select path,content,
   (select '['||string_agg(to_jsonb(v)::text,',')||']' from jsonb_array_elements_text(path) v) path_key,
   rtrim(encode(decode(md5(content::text),'hex'),'base64'),'=') digest from atoms
 ), changed as materialized (
  select * from hashed where known->>path_key is distinct from digest
 ), removed as (
  select coalesce(jsonb_agg(k),'[]'::jsonb) keys from jsonb_object_keys(known) k where not exists(select 1 from hashed h where h.path_key=k)
 )
 select case when p_known->>'v'='2' then jsonb_build_object('__egress',2,'changed',coalesce((select jsonb_agg(jsonb_build_array(path,digest,content)) from changed),'[]'::jsonb),'removed',r.keys)
 else jsonb_build_object('__egress',1,'changes',coalesce((select jsonb_object_agg(path_key,content) from changed),'{}'::jsonb),'versions',coalesce((select jsonb_object_agg(path_key,digest) from changed),'{}'::jsonb),'removed',r.keys,'packetVersion',2) end
 into result from removed r;
 return result;
end;$$;
revoke all on function public.egress_pack(jsonb,jsonb) from public,anon;
grant execute on function public.egress_pack(jsonb,jsonb) to authenticated;

create or replace function public.egress_peer_roster(p_rows jsonb,p_viewer text)
returns jsonb language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg((r.value-'raid_seen_at') || case when r.value->>'student_id'=p_viewer then jsonb_build_object('answer_history_offset',0) else
  jsonb_build_object('answer_history_offset',greatest(0,jsonb_array_length(coalesce(r.value->'answer_history','[]'))-8),
   'answer_history',coalesce((select jsonb_agg(jsonb_build_object('questionIdx',h.value->'questionIdx','damage',h.value->'damage','isCrit',h.value->'isCrit','correct',h.value->'correct') order by h.ordinality) from jsonb_array_elements(coalesce(r.value->'answer_history','[]')) with ordinality h where h.ordinality>jsonb_array_length(coalesce(r.value->'answer_history','[]'))-8),'[]'::jsonb)) end order by r.ordinality),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_rows,'[]')) with ordinality r;
$$;
revoke all on function public.egress_peer_roster(jsonb,text) from public,anon;
grant execute on function public.egress_peer_roster(jsonb,text) to authenticated;
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
  declare snapshot jsonb;
  begin
   snapshot=public.world_boss_action(p_boss_id,p_action,p_payload-'_egress');
   if snapshot ? 'participants' then snapshot=jsonb_set(snapshot,'{participants}',public.egress_peer_roster(snapshot->'participants',auth.uid()::text));end if;
   return public.egress_pack(snapshot,p_payload->'_egress');
  end;$body$;
 $fn$,native_type);
 execute format('revoke all on function public.world_boss_delta(%s,text,jsonb) from public,anon',native_type);
 execute format('grant execute on function public.world_boss_delta(%s,text,jsonb) to authenticated',native_type);
end;$install$;
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
 if p_table='boss_participants' then rows=public.egress_peer_roster(rows,auth.uid()::text);end if;
 return public.egress_pack(jsonb_build_object('rows',rows),p_known);
end;$$;
revoke all on function public.egress_table_snapshot(text,text,boolean,integer,jsonb) from public,anon;
grant execute on function public.egress_table_snapshot(text,text,boolean,integer,jsonb) to authenticated;

create or replace function public.egress_notice_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare prev jsonb;curr jsonb;r jsonb;cid text;sid text;k text;done text[]='{}';notice_table text;notice_key text;tx text;
begin
 if TG_OP<>'INSERT' then prev=to_jsonb(OLD);end if;
 if TG_OP<>'DELETE' then curr=to_jsonb(NEW);end if;
 if TG_OP='UPDATE' and (prev-'raid_seen_at'-'last_seen_at'-'updated_at')=(curr-'raid_seen_at'-'last_seen_at'-'updated_at') then return null;end if;
 for r in select value from jsonb_array_elements(jsonb_build_array(prev,curr)) where value<>'null'::jsonb loop
  cid=nullif(r->>'class_id','');sid=null;
  if cid is null and TG_TABLE_NAME in ('recitation_presentations','recitation_scan_receipts') then
   select class_id into cid from public.recitation_sessions where id::text=r->>'session_id';
  elsif cid is null and TG_TABLE_NAME in ('seats','seat_assignments') then
   select class_id into cid from public.classroom_layouts where id::text=r->>'layout_id';
  end if;
  if cid is null then sid=coalesce(r->>'student_id',case when TG_TABLE_NAME='profiles' then r->>'id' end);end if;
  k=case when cid is not null then 'class:'||cid when sid is not null then 'student:'||sid else 'catalog' end;
  if k=any(done) then continue;end if;done=array_append(done,k);
  notice_table=case when TG_TABLE_NAME in ('boss_events','boss_participants','loot_claims') then 'boss_events'
   when TG_TABLE_NAME in ('recitation_presentations','recitation_scan_receipts') then 'recitation_presentations' else TG_TABLE_NAME end;
  -- One notice per group/class/transaction, even when an answer updates several
  -- rows. Recovery reads remain available if a device misses a notice.
  notice_key='eduquest.notice_'||md5(notice_table||':'||k);tx=pg_current_xact_id()::text;
  if current_setting(notice_key,true)=tx then continue;end if;
  perform set_config(notice_key,tx,true);
  insert into public.sync_invalidations(table_name,scope_key,class_id,student_id) values(notice_table,k,cid,sid)
   on conflict(table_name,scope_key) do update set revision=gen_random_uuid();
 end loop;
 return null;
end;$$;
revoke all on function public.egress_notice_trigger() from public,anon,authenticated;

do $$ declare t text;begin
 foreach t in array array['recitation_presentations','recitation_scan_receipts','classroom_layouts','seats','seat_assignments'] loop
  if to_regclass('public.'||t) is not null then
   execute format('drop trigger if exists egress_notice on public.%I',t);
   execute format('create trigger egress_notice after insert or update or delete on public.%I for each row execute function public.egress_notice_trigger()',t);
  end if;
 end loop;
end $$;
drop policy if exists sync_notice_read on public.sync_invalidations;
create policy sync_notice_read on public.sync_invalidations for select to authenticated using (
 public.egress_can_read_notice(class_id,student_id)
 and (table_name not in ('recitation_presentations','recitation_scan_receipts') or public.is_staff_for_section(class_id))
);
create or replace function public.egress_sync_status()
returns jsonb language sql security invoker set search_path=public as $$select jsonb_build_object('v',2)$$;
revoke all on function public.egress_sync_status() from public,anon;
grant execute on function public.egress_sync_status() to authenticated;
notify pgrst,'reload schema';
commit;
