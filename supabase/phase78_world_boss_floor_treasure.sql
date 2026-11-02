-- One server-owned identity per scattered treasure piece. Run after phase75.
-- Repeatable. Existing ownership, inventory, balances and function grants stay intact.
begin;
do $require_battle$
declare key_type text;
begin
 select format_type(atttypid,null) into key_type from pg_attribute where attrelid='public.boss_events'::regclass and attname='id';
 if to_regprocedure(format('public.world_boss_action(%s,text,jsonb)',key_type)) is null then raise exception 'Apply the updated phase75 script first';end if;
end;
$require_battle$;
alter table public.loot_claims add column if not exists drop_index integer check(drop_index>=0);
-- Label existing receipts without changing their owner, item or inventory.
do $slots$
declare group_row record;receipt record;free_slot integer;
begin
 for group_row in select distinct boss_id,reward_id from public.loot_claims where drop_index is null loop
   for receipt in select id from public.loot_claims where boss_id=group_row.boss_id and reward_id=group_row.reward_id and drop_index is null order by claimed_at nulls last,id loop
     select min(slot) into free_slot from generate_series(0,(select count(*)::integer from public.loot_claims where boss_id=group_row.boss_id and reward_id=group_row.reward_id)) slot
     where not exists(select 1 from public.loot_claims c where c.boss_id=group_row.boss_id and c.reward_id=group_row.reward_id and c.drop_index=slot);
     update public.loot_claims set drop_index=free_slot where id=receipt.id;
   end loop;
 end loop;
end;
$slots$;
create unique index if not exists loot_claims_unique_floor_drop on public.loot_claims(boss_id,reward_id,drop_index) where drop_index is not null;

create or replace function public.world_boss_action(p_boss_id public.boss_events.id%TYPE,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 b public.boss_events;viewer public.profiles;rec public.boss_participants;winner record;
 staff boolean;sid text;qs jsonb;q jsonb;settings jsonb;receipt jsonb;outcome jsonb='{}';
 qi integer;choice integer;damage integer=0;critical boolean=false;correct boolean=false;
 low_dmg integer;high_dmg integer;cooldown integer;reward jsonb;stock integer;mine integer;claim_key text;
 drop_slot integer;xp_amount integer;coin_amount integer;written integer;expired boolean;claim_row public.loot_claims;
begin
 select * into viewer from profiles where id=auth.uid()::text and coalesce(is_active,true);
 if viewer.id is null then raise exception 'Sign in required' using errcode='42501';end if;
 sid=viewer.id;
 select * into b from boss_events where id=p_boss_id;
 if not found then raise exception 'Boss event not found';end if;
 staff=coalesce(viewer.role in ('teacher','admin') and public.is_staff_for_section(b.class_id),false);
 if not staff and not coalesce(viewer.role='student' and viewer.class_id=b.class_id,false) then raise exception 'This raid belongs to another section' using errcode='42501';end if;
 -- Serialize launches in one section before taking the boss lock, avoiding sibling launch deadlocks.
 if p_action='activate' then perform pg_advisory_xact_lock(hashtext(b.class_id));end if;
 select * into b from boss_events where id=p_boss_id for update;
 if p_action not in ('snapshot','activate') and p_payload->>'runId' is distinct from b.raid_run_id::text then raise exception 'This raid has restarted. Refresh before continuing.';end if;
 if p_action in ('activate','end','delete','signal') and not staff then raise exception 'Teacher access required' using errcode='42501';end if;
 if p_action='activate' then
   if b.status in ('active','loot') then raise exception 'This raid is already running';end if;
   if jsonb_array_length(coalesce(b.boss_questions,'[]'))=0 then raise exception 'Add battle questions before launching';end if;
   if exists(select 1 from jsonb_array_elements(b.boss_questions) as candidate(value) where nullif(btrim(candidate.value->>'q'),'') is null or case when jsonb_typeof(candidate.value->'opts')='array' and (candidate.value->>'answer')~'^[0-9]+$' then jsonb_array_length(candidate.value->'opts')<2 or (candidate.value->>'answer')::integer>=jsonb_array_length(candidate.value->'opts') else true end) then raise exception 'Review every battle question and its correct answer before launching';end if;
   if b.end_date is not null and b.end_date<(now() at time zone 'Asia/Manila')::date then raise exception 'Update the event end date before launching';end if;
   update boss_events set status='ended',ended_at=now() where class_id=b.class_id and id<>b.id and status::text in ('active','loot','defeated');
   update boss_events set status='active',current_hp=max_hp,raid_signals='[]',raid_run_id=gen_random_uuid(),defeated_at=null,ended_at=null,loot_started_at=null,loot_finalized_at=null where id=b.id;
   delete from boss_participants where boss_id=b.id;
   delete from loot_claims where boss_id=b.id;
 elsif p_action='end' then
   update boss_events set status='ended',ended_at=now(),loot_finalized_at=case when status='loot' then now() else loot_finalized_at end where id=b.id;
 elsif p_action='delete' then
   delete from loot_claims where boss_id=b.id;delete from boss_participants where boss_id=b.id;delete from boss_events where id=b.id;
   return jsonb_build_object('ok',true,'deleted',true,'bossId',b.id,'viewerId',sid);
 elsif p_action='signal' then
   if b.status<>'active' then raise exception 'The battle has ended';end if;
   if p_payload->>'kind' not in ('skill','minion') or p_payload->>'kind' is null then raise exception 'Unknown battle signal';end if;
   if p_payload->>'kind'='skill' and (p_payload->>'skillId' is null or p_payload->>'skillId' not in ('earthquake','chaos_wind','darkness','mirror_trick','berserk_roar','meteor_shower') or not coalesce((b.skills->(p_payload->>'skillId')->>'enabled')::boolean,true)) then raise exception 'Enable this skill first';end if;
   if p_payload->>'kind'='minion' and not coalesce((b.minion_settings->>'enabled')::boolean,false) then raise exception 'Enable minions first';end if;
   update boss_events set raid_signals=(select jsonb_agg(value) from(select value from jsonb_array_elements(coalesce(b.raid_signals,'[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'kind',p_payload->>'kind','skillId',p_payload->>'skillId','at',extract(epoch from now())*1000))) with ordinality order by ordinality desc limit 20) recent) where id=b.id;
 elsif p_action='revive' then
   if b.status<>'active' then raise exception 'The battle has ended';end if;
   select * into rec from boss_participants where boss_id=b.id and student_id=coalesce(p_payload->>'studentId',sid) for update;
   if not found then raise exception 'Raider not found';end if;
   if not staff and (rec.student_id<>sid or rec.revive_at is null or rec.revive_at>now()) then raise exception 'Wait for the revive timer or ask your teacher' using errcode='42501';end if;
   update boss_participants set hp=case when staff then max_hp else 1 end,is_ko=false,revive_at=null,ko_time=null where boss_id=b.id and student_id=rec.student_id;
 elsif p_action='join' then
   if viewer.role<>'student' or b.status<>'active' or b.current_hp<=0 then raise exception 'This battle is not open';end if;
   if b.end_date is not null and b.end_date<(now() at time zone 'Asia/Manila')::date then raise exception 'This event has expired';end if;
   insert into boss_participants(boss_id,class_id,student_id,total_damage,correct_answers,wrong_answers,crit_hits,minions_defeated,last_question_idx,joined_at)
   values(b.id,b.class_id,sid,0,0,0,0,0,0,now()) on conflict(boss_id,student_id) do nothing;
 elsif p_action='answer' then
   if viewer.role<>'student' then raise exception 'Student access required';end if;
   qi=(p_payload->>'questionIdx')::integer;choice=(p_payload->>'choice')::integer;
   select response into receipt from boss_answer_receipts where boss_id=b.id and run_id=b.raid_run_id and student_id=sid and question_idx=qi;
   if found then outcome=receipt||jsonb_build_object('replayed',true);
   else
     if b.status<>'active' or b.current_hp<=0 then raise exception 'The battle has ended';end if;
     if b.end_date is not null and b.end_date<(now() at time zone 'Asia/Manila')::date then raise exception 'This event has expired';end if;
     select * into rec from boss_participants where boss_id=b.id and student_id=sid for update;
     if not found or rec.is_ko or rec.hp<=0 then raise exception 'Join the raid or wait to be revived before answering';end if;
     if qi is null or qi<>coalesce(rec.last_question_idx,0) then raise exception 'Question progress changed. Refresh the battle.';end if;
     qs=coalesce(b.boss_questions,'[]');q=qs->qi;
     if q is null or jsonb_typeof(q->'opts')<>'array' then raise exception 'Question unavailable';end if;
     if choice is null or choice<0 or choice>=jsonb_array_length(q->'opts') then raise exception 'Choose a valid answer';end if;
     settings=coalesce(b.combat_settings,'{}');cooldown=greatest(0,least(300,coalesce((settings->>'questionCooldown')::integer,0)));
     if rec.last_answer_at is not null and now()<rec.last_answer_at+make_interval(secs=>cooldown) then raise exception 'Wait for the answer cooldown';end if;
     correct=choice=(q->>'answer')::integer;
     if correct then
       if coalesce((settings->>'useRandomDamage')::boolean,false) then
         low_dmg=greatest(1,least(1000000,coalesce((settings->>'damageMinRandom')::integer,80)));
         high_dmg=greatest(low_dmg,least(1000000,coalesce((settings->>'damageMaxRandom')::integer,200)));
         damage=low_dmg+floor(random()*(high_dmg-low_dmg+1))::integer;
       else damage=greatest(1,least(1000000,coalesce((settings->>'damagePerAnswer')::integer,150)));end if;
       critical=random()*100<greatest(0,least(100,coalesce((settings->>'critChance')::numeric,20)));
       if critical then damage=round(damage*greatest(1,least(20,coalesce((settings->>'critMultiplier')::numeric,2.5))))::integer;end if;
       damage=least(damage,b.current_hp);
       update boss_events set current_hp=current_hp-damage where id=b.id;
     end if;
     outcome=jsonb_build_object('correct',correct,'damage',damage,'isCrit',critical,'correctAnswer',(q->>'answer')::integer,'choice',choice,'questionIdx',qi,'cooldown',cooldown);
     update boss_participants set total_damage=coalesce(total_damage,0)+damage,
       correct_answers=coalesce(correct_answers,0)+case when correct then 1 else 0 end,
       wrong_answers=coalesce(wrong_answers,0)+case when correct then 0 else 1 end,
       crit_hits=coalesce(crit_hits,0)+case when critical then 1 else 0 end,
       last_question_idx=qi+1,last_answer_at=now(),answer_history=coalesce(answer_history,'[]')||jsonb_build_array(outcome)
       where boss_id=b.id and student_id=sid;
     insert into boss_answer_receipts values(b.id,b.raid_run_id,sid,qi,outcome);
     if correct and damage>=b.current_hp then
       update boss_events set status='loot',current_hp=0,defeated_at=now(),loot_started_at=now(),loot_finalized_at=null where id=b.id;
       xp_amount=greatest(0,coalesce(b.xp_reward,500))+greatest(0,coalesce(b.participation_reward,100));
       coin_amount=greatest(0,coalesce(b.coin_reward,250))+greatest(0,coalesce(b.victory_reward,300));
       for winner in select student_id from boss_participants where boss_id=b.id and total_damage>0 order by student_id loop
         insert into boss_victory_rewards(boss_id,run_id,student_id,xp,coins) values(b.id,b.raid_run_id,winner.student_id,xp_amount,coin_amount) on conflict do nothing;
         get diagnostics written=row_count;
         if written=1 then
           update profiles set xp=coalesce(xp,0)+xp_amount,coins=coalesce(coins,0)+coin_amount where id=winner.student_id;
           update profiles set level=greatest(coalesce(level,0),floor(coalesce(xp,0)/1000)::integer) where id=winner.student_id;
           update profiles set tier=case when level>=20 then 'Legend' when level>=15 then 'Master' when level>=10 then 'Scholar' when level>=5 then 'Achiever' else 'Novice' end where id=winner.student_id;
         end if;
       end loop;
     end if;
   end if;
 elsif p_action='claim' then
   if viewer.role<>'student' then raise exception 'Student access required';end if;
   if p_payload ? 'dropIndex' then
     if coalesce(p_payload->>'dropIndex','')!~'^[0-9]{1,9}$' then raise exception 'Choose a valid treasure';end if;
     drop_slot=(p_payload->>'dropIndex')::integer;
   end if;
   claim_key=p_payload->>'claimId';if claim_key is null or length(claim_key)>180 then raise exception 'A claim reference is required';end if;
   select * into claim_row from loot_claims where id=claim_key;
   if found then
     if claim_row.student_id<>sid or claim_row.boss_id<>b.id or claim_row.reward_id is distinct from p_payload->>'rewardId' then raise exception 'Claim reference belongs to another reward';end if;
     if drop_slot is not null and claim_row.drop_index is distinct from drop_slot then raise exception 'Claim reference belongs to another treasure';end if;
     outcome=jsonb_build_object('claimId',claim_key,'dropIndex',claim_row.drop_index,'replayed',true);
   else
     if b.status<>'loot' or b.loot_finalized_at is not null or now()>=b.loot_started_at+make_interval(secs=>coalesce(b.loot_duration_sec,120)) then raise exception 'The loot window has closed';end if;
     if now()<b.loot_started_at+make_interval(secs=>least(4.0,greatest(0.0,coalesce(b.loot_duration_sec,120)/4.0))::double precision) then raise exception 'Loot is scattering. Wait for the shared countdown.';end if;
     if not exists(select 1 from boss_participants where boss_id=b.id and student_id=sid and total_damage>0) then raise exception 'Contribute damage in this raid to claim loot';end if;
     select r into reward from jsonb_array_elements(coalesce(b.loot_rewards,'[]')) r where r->>'id'=p_payload->>'rewardId';
     if reward is null then raise exception 'Reward not found';end if;
     select count(*) into stock from loot_claims where boss_id=b.id and reward_id=reward->>'id';
     select count(*) into mine from loot_claims where boss_id=b.id and reward_id=reward->>'id' and student_id=sid;
     if stock>=coalesce((reward->>'quantity')::integer,0) then raise exception 'This reward is sold out';end if;
     if mine>=greatest(1,coalesce((reward->>'claimLimit')::integer,1)) then raise exception 'You have reached this reward limit';end if;
     if drop_slot is null then
       select min(slot) into drop_slot from generate_series(0,(reward->>'quantity')::integer-1) slot
       where not exists(select 1 from loot_claims c where c.boss_id=b.id and c.reward_id=reward->>'id' and c.drop_index=slot);
     end if;
     if drop_slot is null or drop_slot<0 or drop_slot>=(reward->>'quantity')::integer then raise exception 'Choose a valid treasure';end if;
     if exists(select 1 from loot_claims where boss_id=b.id and reward_id=reward->>'id' and drop_index=drop_slot) then raise exception 'A classmate already picked up that treasure';end if;
     insert into loot_claims(id,boss_id,class_id,reward_id,item_name,rarity,student_id,student_name,student_init,student_color,claimed_at,drop_index)
     values(claim_key,b.id,b.class_id,reward->>'id',reward->>'itemName',reward->>'rarity',sid,viewer.display_name,left(viewer.display_name,2),null,now(),drop_slot);
     insert into inventory(student_id,item_id,item_name,emoji,category,quantity,date_purchased,last_purchased,source,status)
     values(sid,'loot_'||(reward->>'id'),reward->>'itemName','', 'Boss Loot',1,(now() at time zone 'Asia/Manila')::date::text,now()::text,'Boss Loot','active')
     on conflict(student_id,item_id) do update set quantity=inventory.quantity+1,last_purchased=excluded.last_purchased,status='active';
     outcome=jsonb_build_object('claimId',claim_key,'dropIndex',drop_slot,'itemName',reward->>'itemName');
   end if;
 elsif p_action='finalize' then
   expired=b.loot_started_at is not null and now()>=b.loot_started_at+make_interval(secs=>coalesce(b.loot_duration_sec,120));
   if not staff and not expired and exists(select 1 from jsonb_array_elements(coalesce(b.loot_rewards,'[]')) r where (r->>'quantity')::integer>(select count(*) from loot_claims where boss_id=b.id and reward_id=r->>'id')) then raise exception 'Rewards are still available';end if;
   if b.status='loot' then update boss_events set status='ended',ended_at=now(),loot_finalized_at=now() where id=b.id;end if;
 elsif p_action<>'snapshot' then raise exception 'Unknown raid action';end if;
 select * into b from boss_events where id=p_boss_id;
 -- Expiration is an event state, not a fake victory. Snapshot advances it for every device.
 if b.status='active' and b.end_date is not null and b.end_date<(now() at time zone 'Asia/Manila')::date then
   update boss_events set status='ended',ended_at=now() where id=b.id returning * into b;
 end if;
 if b.status='loot' and b.loot_started_at is not null and (now()>=b.loot_started_at+make_interval(secs=>coalesce(b.loot_duration_sec,120)) or not exists(select 1 from jsonb_array_elements(coalesce(b.loot_rewards,'[]')) r where (r->>'quantity')::integer>(select count(*) from loot_claims where boss_id=b.id and reward_id=r->>'id'))) then
   update boss_events set status='ended',ended_at=now(),loot_finalized_at=now() where id=b.id returning * into b;
 end if;
 return jsonb_build_object('ok',true,'lootVersion',2,'serverNow',extract(epoch from clock_timestamp())*1000,'viewerId',sid,'boss',to_jsonb(b),'outcome',outcome,
 'participants',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('student_name',pr.display_name,'student_init',left(pr.display_name,2))) from boss_participants p join profiles pr on pr.id=p.student_id where p.boss_id=b.id),'[]'),
 'claims',coalesce((select jsonb_agg(to_jsonb(c)) from loot_claims c where c.boss_id=b.id),'[]'),
 'wallet',(select jsonb_build_object('id',id,'xp',xp,'coins',coins,'level',level,'tier',tier) from profiles where id=sid),
 'inventory',coalesce((select jsonb_agg(to_jsonb(i)) from inventory i where i.student_id=sid),'[]'),
 'reward',(select to_jsonb(r) from boss_victory_rewards r where r.boss_id=b.id and r.run_id=b.raid_run_id and r.student_id=sid));
end; $$;
notify pgrst, 'reload schema';
commit;
