-- Shared Cataclysm ultimate. Run AFTER phase75 (and phase79 if installed).
-- Native text/UUID boss IDs are preserved. Safe to apply repeatedly.
begin;
alter table public.boss_events add column if not exists raid_ultimate jsonb not null default '{}';
alter table public.boss_participants add column if not exists raid_seen_at timestamptz;

create or replace function public.world_boss_ultimate_tick(p_id public.boss_events.id%TYPE,p_stage text,p_data jsonb default '{}')
returns void language plpgsql security definer set search_path=public as $$
declare
 b public.boss_events;u jsonb;cfg jsonb;phase text;ts bigint=(extract(epoch from clock_timestamp())*1000)::bigint;
 cast_ms integer;duration_ms integer;cool_ms integer;hurt integer;target integer;raiders integer;remaining integer;progress integer;deadline bigint;
begin
 select * into b from boss_events where id=p_id for update;
 if not found then return;end if;
 u=coalesce(b.raid_ultimate,'{}');cfg=coalesce(b.skills->'cataclysm','{}');phase=u->>'phase';
 if b.status<>'active' or b.current_hp<=0 then
   if phase in ('casting','eruption') then update boss_events set raid_ultimate=u||jsonb_build_object('phase','cancelled','endsAt',ts) where id=b.id;end if;
   return;
 end if;
 cast_ms=greatest(10,least(40,coalesce((cfg->>'castSec')::integer,18)))*1000;
 duration_ms=greatest(10,least(35,coalesce((cfg->>'durationSec')::integer,22)))*1000;
 cool_ms=greatest(60,least(300,coalesce((cfg->>'cooldownSec')::integer,120)))*1000;
 hurt=greatest(1,least(2,coalesce((cfg->>'damage')::integer,1)));
 if u->>'runId' is distinct from b.raid_run_id::text then u='{}';phase=null;end if;
 -- Resolve deadlines BEFORE recording this request's presence or answer.
 if phase='casting' and ts>=(u->>'deadline')::bigint then
   deadline=(u->>'deadline')::bigint;
   update boss_participants set hp=greatest(0,hp-hurt),is_ko=(hp-hurt<=0),
     ko_time=case when hp-hurt<=0 then clock_timestamp() else ko_time end,
     revive_at=case when hp-hurt<=0 then clock_timestamp()+make_interval(secs=>greatest(10,least(300,coalesce((b.minion_settings->>'reviveTimeSec')::integer,60)))) else revive_at end
   where boss_id=b.id and not is_ko and raid_seen_at>clock_timestamp()-interval '20 seconds';
   u=u||jsonb_build_object('phase','eruption','resolvedAt',deadline,'endsAt',deadline+duration_ms,'nextAt',deadline+duration_ms+cool_ms,'damage',hurt);
   phase='eruption';
 end if;
 if phase='eruption' and ts>=(u->>'endsAt')::bigint then u=u||jsonb_build_object('phase','recovered');phase='recovered';end if;
 if p_stage='before' and coalesce((p_data->>'inBattle')::boolean,false) then
   update boss_participants set raid_seen_at=clock_timestamp() where boss_id=b.id and student_id=auth.uid()::text;
 elsif p_stage='leave' then
   update boss_participants set raid_seen_at=null where boss_id=b.id and student_id=auth.uid()::text;
 end if;
 if p_stage='hit' and phase='casting' then
   progress=coalesce((u->>'progress')::integer,0)+1;
   u=u||jsonb_build_object('progress',progress,'contributors',coalesce(u->'contributors','{}')||jsonb_build_object(auth.uid()::text,coalesce((u->'contributors'->>auth.uid()::text)::integer,0)+1));
   if progress>=(u->>'target')::integer then
     u=u||jsonb_build_object('phase','interrupted','resolvedAt',ts,'endsAt',ts+5000,'nextAt',ts+cool_ms);
     phase='interrupted';
   end if;
 end if;
 if not coalesce((cfg->>'enabled')::boolean,true) and p_stage='start' then raise exception 'Enable Cataclysm first';end if;
 if p_stage='start' and phase in ('casting','eruption') then raise exception 'The ultimate is already active';end if;
 if not(u ? 'nextAt') and phase is null then u=u||jsonb_build_object('runId',b.raid_run_id,'phase','idle','nextAt',ts+45000);end if;
 if p_stage='start' or (p_stage='before' and phase is distinct from 'casting' and phase is distinct from 'eruption' and ts>=coalesce((u->>'nextAt')::bigint,ts+45000) and coalesce((cfg->>'enabled')::boolean,true) and coalesce((cfg->>'automatic')::boolean,true)) then
   select count(*),coalesce(sum(greatest(0,jsonb_array_length(coalesce(b.boss_questions,'[]'))-last_question_idx)),0)
   into raiders,remaining from boss_participants where boss_id=b.id and not is_ko and raid_seen_at>clock_timestamp()-interval '20 seconds' and last_question_idx<jsonb_array_length(coalesce(b.boss_questions,'[]'))
     and (last_answer_at is null or last_answer_at+make_interval(secs=>greatest(0,coalesce((b.combat_settings->>'questionCooldown')::integer,0)))<clock_timestamp()+make_interval(secs=>cast_ms/1000));
   if raiders>0 and remaining>0 then
     target=least(remaining,greatest(1,(raiders*floor(cast_ms/1000.0/greatest(1.1,coalesce((b.combat_settings->>'questionCooldown')::numeric,0)+1.1)))::integer),greatest(2,ceil(raiders*0.75)::integer));
     u=jsonb_build_object('id',gen_random_uuid(),'runId',b.raid_run_id,'phase','casting','startedAt',ts,'deadline',ts+cast_ms,'target',target,'progress',0,'raiders',raiders,'contributors','{}'::jsonb);
   elsif p_stage='start' then raise exception 'Wait for raiders with unanswered questions to enter the battlefield';end if;
 end if;
 if u is distinct from b.raid_ultimate then update boss_events set raid_ultimate=u where id=b.id;end if;
end;$$;

-- Patch the installed authoritative RPC without duplicating its reward/loot logic.
do $install$
declare key_type text;rpc regprocedure;body text;patched text;needle text;
begin
 select format_type(atttypid,null) into key_type from pg_attribute where attrelid='public.boss_events'::regclass and attname='id' and not attisdropped;
 rpc:=to_regprocedure(format('public.world_boss_action(%s,text,jsonb)',key_type));
 if rpc is null then raise exception 'Install phase75_world_boss_reliability.sql first';end if;
 body:=pg_get_functiondef(rpc);patched:=body;
 if position('-- Shared ultimate v1' in body)=0 then
   needle:=$n$ if p_action='activate' then
$n$;
   if position(needle in patched)=0 then raise exception 'Unsupported raid API. Apply the current phase75 SQL, then phase80.';end if;
   patched:=replace(patched,needle,$hook$ -- Shared ultimate v1: auth, run guard and boss lock above remain authoritative.
 if p_action='ultimate' then
   if not staff then raise exception 'Teacher access required' using errcode='42501';end if;
   if b.status<>'active' then raise exception 'The battle has ended';end if;
   perform world_boss_ultimate_tick(b.id,'start',p_payload);p_action='snapshot';
 end if;
 if p_action='snapshot' and p_payload->>'inBattle'='false' then perform world_boss_ultimate_tick(b.id,'leave',p_payload);end if;
 if p_action in ('snapshot','answer') then perform world_boss_ultimate_tick(b.id,'before',p_payload);select * into b from boss_events where id=p_boss_id;end if;
 if p_action='activate' then
$hook$);
   needle:='     insert into boss_answer_receipts values(b.id,b.raid_run_id,sid,qi,outcome);';
   if position(needle in patched)=0 then raise exception 'Unsupported answer receipt API. Apply the current phase75 SQL, then phase80.';end if;
   patched:=replace(patched,needle,needle||E'\n     if correct then perform world_boss_ultimate_tick(b.id,''hit'',''{}'');end if;');
   patched:=replace(patched,$old$raid_signals='[]',raid_run_id=$old$,$new$raid_signals='[]',raid_ultimate='{}',raid_run_id=$new$);
   execute patched;
 end if;
 execute format('revoke all on function public.world_boss_ultimate_tick(%s,text,jsonb) from public,anon,authenticated',key_type);
end;$install$;
notify pgrst, 'reload schema';
commit;
