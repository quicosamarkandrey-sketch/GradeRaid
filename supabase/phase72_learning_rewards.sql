-- Phase 72: balanced learning coins. Run after phases 1–71.
-- Existing balances/rewards are retained. New quest clients opt in explicitly;
-- older clients keep their existing quest payout path without double-awarding.
begin;

create table if not exists public.learning_reward_policy (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default true,
  activated_at timestamptz not null default now(),
  attendance_coins integer not null default 10 check(attendance_coins between 0 and 100),
  attendance_xp integer not null default 10 check(attendance_xp between 0 and 100),
  recitation_coins_per_point integer not null default 2 check(recitation_coins_per_point between 0 and 10),
  recitation_daily_cap integer not null default 20 check(recitation_daily_cap between 0 and 200),
  streak_days integer not null default 5 check(streak_days between 2 and 30),
  streak_coins integer not null default 15 check(streak_coins between 0 and 200),
  streak_xp integer not null default 25 check(streak_xp between 0 and 200),
  quest_default_coins integer not null default 20 check(quest_default_coins between 0 and 40),
  quest_max_coins integer not null default 40 check(quest_max_coins between 0 and 100)
);
insert into public.learning_reward_policy(singleton) values(true) on conflict do nothing;
create table if not exists public.learning_reward_accounts (
  student_id text primary key references public.profiles(id) on delete cascade,
  coin_debt integer not null default 0 check(coin_debt>=0)
);
create table if not exists public.learning_reward_ledger (
  student_id text not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('attendance','recitation','streak','quest')),
  source_key text not null,
  coins integer not null check(coins>=0),
  xp integer not null default 0 check(xp>=0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(student_id,kind,source_key)
);
create table if not exists public.learning_reward_purchases (
  request_id text primary key,
  student_id text not null references public.profiles(id),
  items jsonb not null,
  total integer not null,
  order_ids text[] not null,
  created_at timestamptz not null default now()
);
alter table public.quiz_history add column if not exists learning_reward_version integer not null default 0;

alter table public.learning_reward_policy enable row level security;
alter table public.learning_reward_accounts enable row level security;
alter table public.learning_reward_ledger enable row level security;
alter table public.learning_reward_purchases enable row level security;
revoke all on public.learning_reward_policy,public.learning_reward_accounts,public.learning_reward_ledger,public.learning_reward_purchases from anon,authenticated;
-- Access is exclusively through authenticated, scoped RPCs below.

create or replace function public._learning_check_student(p_student_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='student' and coalesce(is_active,true)) then raise exception 'Student not found'; end if;
  if auth.uid()::text<>p_student_id and not (
    public.is_staff_for_section((select class_id from public.profiles where id=p_student_id))
    and exists(select 1 from public.profiles where id=auth.uid()::text and role in ('admin','teacher') and coalesce(is_active,true))
  ) then raise exception 'Not authorized for this student' using errcode='42501'; end if;
end; $$;

create or replace function public.learning_reward_status()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return (select to_jsonb(p)||jsonb_build_object('version',1) from public.learning_reward_policy p where singleton);
end; $$;

create or replace function public._learning_reconcile(p_student_id text)
returns void language plpgsql security definer set search_path=public as $$
declare
  p public.learning_reward_policy; v_desired jsonb; v_old_coins integer; v_new_coins integer;
  v_old_xp integer; v_new_xp integer; v_delta integer; v_balance integer; v_debt integer; v_paid integer;
begin
  select * into p from public.learning_reward_policy where singleton;
  if not p.enabled then return; end if;
  -- Serialize all calculations, reversals and purchases for this wallet.
  select coins into v_balance from public.profiles where id=p_student_id and role='student' for update;
  if not found then return; end if;
  insert into public.learning_reward_accounts(student_id) values(p_student_id) on conflict do nothing;
  select coin_debt into v_debt from public.learning_reward_accounts where student_id=p_student_id;
  with attendance_days as (
    select log_date as day,bool_or(status in ('Early','On Time','Late','Present')) as attended
    from public.attendance_logs
    where student_id=p_student_id and log_date>=(p.activated_at at time zone 'Asia/Manila')::date
      and log_date<=(now() at time zone 'Asia/Manila')::date and status<>'Excused'
    group by log_date
  ), runs as (
    select day,attended,sum(case when attended then 0 else 1 end) over(order by day) as run_id from attendance_days
  ), streaks as (
    select day,row_number() over(partition by run_id order by day) as n from runs where attended
  ), recitation_days as (
    select (created_at at time zone 'Asia/Manila')::date as day,
      least(p.recitation_daily_cap,greatest(0,sum(pts)::bigint)*p.recitation_coins_per_point)::integer as coins
    from public.recitation_log where student_id=p_student_id and created_at>=p.activated_at and created_at<=now()
    group by (created_at at time zone 'Asia/Manila')::date
  ), quests as (
    select h.quiz_id,greatest(0,least(100,max(h.score))) as best,
      coalesce((l.metadata->>'budget')::integer,least(p.quest_max_coins,greatest(0,coalesce(q.coin_reward,p.quest_default_coins)))) as budget
    from public.quiz_history h
    left join public.quizzes q on q.id=h.quiz_id
    left join public.learning_reward_ledger l on l.student_id=h.student_id and l.kind='quest' and l.source_key=h.quiz_id
    where h.student_id=p_student_id and h.learning_reward_version=1 and not h.aborted and h.completed_at>=p.activated_at and h.completed_at<=now()
    group by h.quiz_id,l.metadata,q.coin_reward
  ), desired as (
    select 'attendance'::text as kind,day::text as source_key,p.attendance_coins as coins,p.attendance_xp as xp,'{}'::jsonb as metadata from attendance_days where attended
    union all select 'streak',day::text,p.streak_coins,p.streak_xp,jsonb_build_object('days',p.streak_days) from streaks where mod(n,p.streak_days)=0
    union all select 'recitation',day::text,coins,0,'{}'::jsonb from recitation_days
    union all select 'quest',quiz_id,round(budget*best/100.0)::integer,0,jsonb_build_object('budget',budget,'best',best) from quests
  ) select coalesce(jsonb_agg(to_jsonb(desired)),'[]'::jsonb) into v_desired from desired;
  select coalesce(sum(coins),0),coalesce(sum(xp),0) into v_old_coins,v_old_xp from public.learning_reward_ledger where student_id=p_student_id;
  select coalesce(sum(x.coins),0),coalesce(sum(x.xp),0) into v_new_coins,v_new_xp from jsonb_to_recordset(v_desired) as x(coins integer,xp integer);
  v_delta=v_new_coins-v_old_coins;
  if v_delta<0 then
    v_debt=v_debt+greatest(0,-(coalesce(v_balance,0)+v_delta));
    v_balance=greatest(0,coalesce(v_balance,0)+v_delta);
  else
    v_paid=least(v_debt,v_delta);v_debt=v_debt-v_paid;v_balance=coalesce(v_balance,0)+v_delta-v_paid;
  end if;
  update public.profiles set coins=v_balance,xp=greatest(0,coalesce(xp,0)+v_new_xp-v_old_xp) where id=p_student_id and (v_delta<>0 or v_new_xp<>v_old_xp);
  update public.profiles set level=greatest(coalesce(level,0),floor(coalesce(xp,0)/1000)::integer) where id=p_student_id;
  update public.profiles set tier=case when level>=20 then 'Legend' when level>=15 then 'Master' when level>=10 then 'Scholar' when level>=5 then 'Achiever' else 'Novice' end where id=p_student_id;
  update public.learning_reward_accounts set coin_debt=v_debt where student_id=p_student_id;
  delete from public.learning_reward_ledger l where student_id=p_student_id and not exists(
    select 1 from jsonb_to_recordset(v_desired) as x(kind text,source_key text) where x.kind=l.kind and x.source_key=l.source_key
  );
  insert into public.learning_reward_ledger(student_id,kind,source_key,coins,xp,metadata)
    select p_student_id,x.kind,x.source_key,x.coins,x.xp,x.metadata from jsonb_to_recordset(v_desired) as x(kind text,source_key text,coins integer,xp integer,metadata jsonb)
    on conflict(student_id,kind,source_key) do update set coins=excluded.coins,xp=excluded.xp,metadata=excluded.metadata,updated_at=now()
    where (learning_reward_ledger.coins,learning_reward_ledger.xp,learning_reward_ledger.metadata) is distinct from (excluded.coins,excluded.xp,excluded.metadata);
end; $$;

create or replace function public._learning_log_changed()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op<>'DELETE' then perform public._learning_reconcile(new.student_id); end if;
  if tg_op='DELETE' or (tg_op='UPDATE' and old.student_id is distinct from new.student_id) then perform public._learning_reconcile(old.student_id); end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
drop trigger if exists learning_attendance_rewards on public.attendance_logs;
create trigger learning_attendance_rewards after insert or update or delete on public.attendance_logs for each row execute function public._learning_log_changed();
drop trigger if exists learning_recitation_rewards on public.recitation_log;
create trigger learning_recitation_rewards after insert or update or delete on public.recitation_log for each row execute function public._learning_log_changed();
drop trigger if exists learning_quest_rewards on public.quiz_history;
create trigger learning_quest_rewards after insert or update or delete on public.quiz_history for each row execute function public._learning_log_changed();

create or replace function public._learning_quest_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_class text;
begin
  if tg_op='UPDATE' and old.learning_reward_version=1 and new.learning_reward_version<>1 then raise exception 'Reward attempt identity cannot change'; end if;
  if new.learning_reward_version<>1 then return new; end if;
  if tg_op='UPDATE' and (old.student_id,old.quiz_id,old.learning_reward_version) is distinct from (new.student_id,new.quiz_id,new.learning_reward_version) then raise exception 'Reward attempt identity cannot change'; end if;
  if tg_op='INSERT' then
    select class_id into v_class from public.profiles where id=new.student_id and role='student';
    if not exists(select 1 from public.quizzes q where q.id=new.quiz_id and q.active and
      (not exists(select 1 from public.quiz_sections s where s.quiz_id=q.id) or exists(select 1 from public.quiz_sections s where s.quiz_id=q.id and s.class_id=v_class))) then
      raise exception 'Quest is unavailable for this student';
    end if;
    -- New rewards use server receipt time, not a caller-selected reward day.
    new.completed_at=now();
  end if;
  if new.score not between 0 and 100 then raise exception 'Score must be between 0 and 100'; end if;
  return new;
end; $$;
drop trigger if exists learning_quest_guard on public.quiz_history;
create trigger learning_quest_guard before insert or update on public.quiz_history for each row execute function public._learning_quest_guard();

create or replace function public.learning_reward_wallet(p_student_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._learning_check_student(p_student_id);
  perform public._learning_reconcile(p_student_id);
  return jsonb_build_object(
    'profile',(select jsonb_build_object('id',id,'coins',coins,'xp',xp,'level',level,'tier',tier) from public.profiles where id=p_student_id),
    'debt',coalesce((select coin_debt from public.learning_reward_accounts where student_id=p_student_id),0),
    'earnings',coalesce((select jsonb_object_agg(kind,total) from(select kind,sum(coins) total from public.learning_reward_ledger where student_id=p_student_id group by kind) t),'{}'::jsonb),
    'questBudgets',coalesce((select jsonb_object_agg(source_key,metadata->'budget') from public.learning_reward_ledger where student_id=p_student_id and kind='quest'),'{}'::jsonb),
    'todayRecitationCoins',coalesce((select coins from public.learning_reward_ledger where student_id=p_student_id and kind='recitation' and source_key=(now() at time zone 'Asia/Manila')::date::text),0)
  );
end; $$;

create or replace function public.record_learning_quest(p_attempt_id text,p_quiz_id text,p_score integer,p_attempt integer,p_results jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sid text=auth.uid()::text; v_before integer; v_after integer;
begin
  perform public._learning_check_student(sid);
  if p_attempt_id is null or length(p_attempt_id)>150 or p_attempt_id='' or p_attempt<1 then raise exception 'Invalid attempt'; end if;
  perform public._learning_reconcile(sid);
  select coalesce(sum(coins),0) into v_before from public.learning_reward_ledger where student_id=sid and kind='quest' and source_key=p_quiz_id;
  if exists(select 1 from public.quiz_history where id=p_attempt_id) then
    if exists(select 1 from public.quiz_history where id=p_attempt_id and (student_id<>sid or quiz_id<>p_quiz_id or score<>p_score)) then raise exception 'Attempt ID already used'; end if;
    return jsonb_build_object('coinsEarned',0,'wallet',public.learning_reward_wallet(sid));
  end if;
  insert into public.quiz_history(id,student_id,quiz_id,score,attempt,completed_at,date_label,question_results,aborted,learning_reward_version)
    values(p_attempt_id,sid,p_quiz_id,p_score,p_attempt,now(),(now() at time zone 'Asia/Manila')::date::text,p_results,false,1) on conflict(id) do nothing;
  select coalesce(sum(coins),0) into v_after from public.learning_reward_ledger where student_id=sid and kind='quest' and source_key=p_quiz_id;
  return jsonb_build_object('coinsEarned',greatest(0,v_after-v_before),'wallet',public.learning_reward_wallet(sid));
end; $$;

-- Purchases are atomic: cost, wallet, stock, claim codes, orders and inventory.
create or replace function public.checkout_learning_rewards(p_request_id text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sid text=auth.uid()::text; buyer public.profiles; product public.shop_products; item record;
  receipt public.learning_reward_purchases; total_cost bigint=0; ids text[]='{}'; oid text; code text; i integer; qty integer;
begin
  perform public._learning_check_student(sid);
  perform public._learning_reconcile(sid);
  select * into buyer from public.profiles where id=sid for update;
  if p_request_id is null or length(p_request_id)>150 or p_request_id='' then raise exception 'Invalid purchase request'; end if;
  select * into receipt from public.learning_reward_purchases where request_id=p_request_id;
  if found then
    if receipt.student_id<>sid then raise exception 'Not authorized' using errcode='42501'; end if;
    if receipt.items<>p_items then raise exception 'Request already used for a different cart'; end if;
    ids=receipt.order_ids;total_cost=receipt.total;
  else
    if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'Invalid cart'; end if;
    if (select sum(x.qty) from jsonb_to_recordset(p_items) as x(id text,qty integer))>100 then raise exception 'Cart is too large'; end if;
    if exists(select 1 from jsonb_to_recordset(p_items) as x(id text,qty integer) group by id having count(*)>1) then raise exception 'Duplicate cart product'; end if;
    -- Fixed product lock order avoids deadlocks between multi-item checkouts.
    for item in select * from jsonb_to_recordset(p_items) as x(id text,qty integer,price integer) order by id loop
      if item.qty is null or item.qty not between 1 and 20 then raise exception 'Invalid quantity'; end if;
      select * into product from public.shop_products where id=item.id for update;
      if not found or not product.active or not public.is_my_advisers_content(product.owner_teacher_id) then raise exception 'Product unavailable'; end if;
      if item.price is null or item.price<>product.cost then raise exception 'Price changed. Refresh the Armory and review your cart.'; end if;
      if product.cost<0 or product.cost>100000 then raise exception 'Invalid price'; end if;
      if product.stock is not null and product.stock<item.qty then raise exception 'Not enough stock'; end if;
      total_cost=total_cost+product.cost*item.qty;
    end loop;
    if total_cost>coalesce(buyer.coins,0) then raise exception 'Not enough coins'; end if;
    update public.profiles set coins=coins-total_cost::integer where id=sid;
    for item in select * from jsonb_to_recordset(p_items) as x(id text,qty integer,price integer) order by id loop
      select * into product from public.shop_products where id=item.id;
      if product.stock is not null then update public.shop_products set stock=stock-item.qty where id=product.id; end if;
      for i in 1..item.qty loop
        oid='LR-'||replace(gen_random_uuid()::text,'-','');code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));ids=array_append(ids,oid);
        insert into public.orders(order_id,student_id,student_name,student_init,student_color,item_id,item_name,emoji,cost,category,claim_code,status,created_date_str)
          values(oid,sid,buyer.display_name,buyer.init,buyer.color,product.id,product.name,product.emoji,product.cost,product.category,code,'pending',(now() at time zone 'Asia/Manila')::text);
        insert into public.redemptions(order_id,student_id,item_id,item_name,emoji,item_label,pts,date_label,time_label,claim_code)
          values(oid,sid,product.id,product.name,product.emoji,coalesce(product.emoji,'')||' '||product.name,product.cost,(now() at time zone 'Asia/Manila')::date::text,to_char(now() at time zone 'Asia/Manila','HH24:MI'),code);
      end loop;
      insert into public.inventory(student_id,item_id,item_name,emoji,category,quantity,date_purchased,last_purchased,source,status)
        values(sid,product.id,product.name,product.emoji,product.category,item.qty,(now() at time zone 'Asia/Manila')::date::text,(now() at time zone 'Asia/Manila')::date::text,'Store','active')
        on conflict(student_id,item_id) do update set quantity=coalesce(inventory.quantity,0)+excluded.quantity,last_purchased=excluded.last_purchased,status='active',used_at=null;
    end loop;
    insert into public.learning_reward_purchases(request_id,student_id,items,total,order_ids) values(p_request_id,sid,p_items,total_cost::integer,ids);
  end if;
  return jsonb_build_object('total',total_cost,'wallet',public.learning_reward_wallet(sid),
    'orders',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.orders o where order_id=any(ids)),
    'redemptions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.redemptions r where order_id=any(ids)),
    'inventory',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.inventory v where student_id=sid),
    'stock',(select coalesce(jsonb_object_agg(id,coalesce(stock,99999)),'{}') from public.shop_products where id in(select x.id from jsonb_to_recordset(p_items) as x(id text,qty integer))));
end; $$;

revoke all on function public._learning_check_student(text),public._learning_reconcile(text),public._learning_log_changed(),public._learning_quest_guard() from public,anon,authenticated;
revoke all on function public.learning_reward_status(),public.learning_reward_wallet(text),public.record_learning_quest(text,text,integer,integer,jsonb),public.checkout_learning_rewards(text,jsonb) from public,anon;
grant execute on function public.learning_reward_status(),public.learning_reward_wallet(text),public.record_learning_quest(text,text,integer,integer,jsonb),public.checkout_learning_rewards(text,jsonb) to authenticated;
commit;
