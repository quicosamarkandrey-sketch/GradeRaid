-- Phase 83 — reliable classroom arrival station. Requires attendance schema,
-- weekly/day-off schedules (54/55), section authorization, and reward triggers (72).
-- Existing attendance_logs remain the source of truth for histories and rewards.
create table if not exists public.attendance_station_days (
 class_id text not null,log_date date not null,finalized boolean not null default false,
 finalized_at timestamptz,finalized_by text,primary key(class_id,log_date)
);
create table if not exists public.attendance_scan_receipts (
 id uuid primary key,class_id text not null,tag_id text not null,captured_at timestamptz not null,
 received_at timestamptz not null default now(),student_id text,
 state text not null check(state in ('confirmed','review','dismissed','resolved')),
 result jsonb not null,resolved_by text,resolved_at timestamptz
);
create index if not exists attendance_scan_receipts_class on public.attendance_scan_receipts(class_id,received_at desc);
create table if not exists public.attendance_station_audit (
 id uuid primary key,class_id text not null,student_id text,log_date date not null,
 action text not null,reason text not null,actor text not null,created_at timestamptz not null default now(),
 before_log jsonb,after_log jsonb
);
create index if not exists attendance_station_audit_class on public.attendance_station_audit(class_id,created_at desc);
alter table public.attendance_station_days enable row level security;
alter table public.attendance_scan_receipts enable row level security;
alter table public.attendance_station_audit enable row level security;
revoke all on public.attendance_station_days,public.attendance_scan_receipts,public.attendance_station_audit from anon,authenticated;

create or replace function public.attendance_station(p_class_id text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 stamp timestamptz:=clock_timestamp();today date:=(clock_timestamp() at time zone 'Asia/Manila')::date;
 day date;captured timestamptz;local_time time;server_time time;
 schedule public.attendance_schedules;sid text;status text;captured_status text;
 receipt public.attendance_scan_receipts;audit public.attendance_station_audit;
 old_log public.attendance_logs;new_log public.attendance_logs;
 result jsonb;reason text;err text;rid uuid;amount integer:=0;finalized boolean:=false;was_existing boolean:=false;
begin
 if auth.uid() is null or not coalesce(public.is_staff_for_section(p_class_id),false) then raise exception 'Not authorized for this classroom';end if;
 day:=coalesce(nullif(p_payload->>'date','')::date,today);
 if day>today or day<today-366 then raise exception 'Choose a school day within the last year';end if;
 if p_action='snapshot' then
  select * into schedule from public.get_effective_attendance_schedule(p_class_id,day);
  return jsonb_build_object('classId',p_class_id,'date',day,'serverTime',stamp,'schedule',to_jsonb(schedule),
   'finalized',coalesce((select d.finalized from public.attendance_station_days d where class_id=p_class_id and log_date=day),false),
   'roster',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.display_name,'init',r.init,'photo',r.profile_pic_url) order by r.display_name) from public.profiles r where r.class_id=p_class_id and r.role='student'),'[]'),
   'logs',coalesce((select jsonb_agg(to_jsonb(l) order by scanned_at desc) from public.attendance_logs l where l.class_id=p_class_id and l.log_date=day),'[]'),
   'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by received_at) from public.attendance_scan_receipts r where class_id=p_class_id and state='review'),'[]'),
   'audit',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actorName',(select p.display_name from public.profiles p where p.id=a.actor)) order by created_at desc) from (select * from public.attendance_station_audit where class_id=p_class_id order by created_at desc limit 50) a),'[]'));
 end if;
 -- Serialize competing stations and finalization; receipt retries never double-award.
 perform pg_advisory_xact_lock(hashtext('attendance-station:'||p_class_id));
 rid:=(p_payload->>'id')::uuid;
 if rid is null then raise exception 'An operation ID is required';end if;
 if p_action='scan' then
  select * into receipt from public.attendance_scan_receipts where id=rid;
  if found then
   if receipt.class_id<>p_class_id then raise exception 'Receipt belongs to another class';end if;
   return receipt.result||jsonb_build_object('duplicate',true,'receiptId',receipt.id,'reviewState',receipt.state);
  end if;
  captured:=(p_payload->>'capturedAt')::timestamptz;
  if captured is null then raise exception 'Capture time is required';end if;
  select c.student_id into sid from public.rfid_cards c join public.profiles r on r.id=c.student_id where c.tag_id=trim(p_payload->>'tag') and c.is_active and r.role='student';
  if sid is null then err:='unknown_card';
  elsif not exists(select 1 from public.profiles where id=sid and class_id=p_class_id) then err:='wrong_section';
  end if;
  select * into schedule from public.get_effective_attendance_schedule(p_class_id,today);
  select * into old_log from public.attendance_logs where student_id=sid and class_id=p_class_id and log_date=today;
  if err is null and old_log.id is not null and old_log.status in ('Early','On Time','Late') then
   result:=jsonb_build_object('ok',true,'alreadyRecorded',true,'studentId',sid,'status',old_log.status,'log',to_jsonb(old_log));
  else
   if err is null then
    if schedule.id is null then err:='no_schedule';
    elsif schedule.day_off then err:='no_class_today';
    elsif old_log.id is not null then err:='existing_exception';
    elsif exists(select 1 from public.attendance_station_days where class_id=p_class_id and log_date=today and attendance_station_days.finalized) then err:='finalized';
    end if;
   end if;
   if err is null then
    local_time:=(captured at time zone 'Asia/Manila')::time;server_time:=(stamp at time zone 'Asia/Manila')::time;
    captured_status:=case when local_time<schedule.open_time then 'not_open' when local_time>schedule.close_time then 'closed' when local_time<schedule.start_time then 'Early' when local_time<schedule.late_cutoff then 'On Time' else 'Late' end;
    status:=case when server_time<schedule.open_time then 'not_open' when server_time>schedule.close_time then 'closed' when server_time<schedule.start_time then 'Early' when server_time<schedule.late_cutoff then 'On Time' else 'Late' end;
    if abs(extract(epoch from stamp-captured))>20 or (captured at time zone 'Asia/Manila')::date<>today or captured_status<>status then err:='review_time';
    elsif status in ('not_open','closed') then err:=status;
    end if;
   end if;
   if err is null then
    insert into public.attendance_logs(student_id,class_id,log_date,status,scanned_at,entry_method,rfid_tag)
     values(sid,p_class_id,today,status,captured,'RFID',trim(p_payload->>'tag'))
     on conflict(student_id,class_id,log_date) do nothing returning * into new_log;
    if new_log.id is null then
     select * into new_log from public.attendance_logs where student_id=sid and class_id=p_class_id and log_date=today;
     was_existing:=true;
    end if;
    if new_log.status not in ('Early','On Time','Late') then err:='existing_exception';
    else result:=jsonb_build_object('ok',true,'alreadyRecorded',was_existing,'studentId',sid,'status',new_log.status,'log',to_jsonb(new_log));end if;
   end if;
   if err is not null then result:=jsonb_build_object('ok',false,'needsReview',true,'error',err,'studentId',sid);end if;
  end if;
  insert into public.attendance_scan_receipts(id,class_id,tag_id,captured_at,student_id,state,result)
   values(rid,p_class_id,trim(p_payload->>'tag'),captured,sid,case when result->>'ok'='true' then 'confirmed' else 'review' end,result);
  return result||jsonb_build_object('receiptId',rid);
 end if;
 select * into audit from public.attendance_station_audit where id=rid;
 if found then
  if audit.class_id<>p_class_id then raise exception 'Operation belongs to another class';end if;
  return jsonb_build_object('ok',true,'duplicate',true,'log',audit.after_log);
 end if;
 reason:=left(trim(p_payload->>'reason'),500);
 if coalesce(length(reason),0)<3 then raise exception 'Add a short reason for this change';end if;
 if p_action='dismiss' then
  select * into receipt from public.attendance_scan_receipts where id=(p_payload->>'receipt')::uuid and class_id=p_class_id for update;
  if receipt.id is null then raise exception 'Scan issue not found';end if;
  update public.attendance_scan_receipts set state='dismissed',resolved_by=auth.uid()::text,resolved_at=stamp where id=receipt.id and state='review';
  insert into public.attendance_station_audit(id,class_id,student_id,log_date,action,reason,actor) values(rid,p_class_id,receipt.student_id,day,'dismiss',reason,auth.uid()::text);
  return jsonb_build_object('ok',true);
 elsif p_action in ('finalize','reopen') then
  select * into schedule from public.get_effective_attendance_schedule(p_class_id,day);
  if schedule.id is null or schedule.day_off then raise exception 'No class is scheduled on this day';end if;
  if p_action='finalize' then
   if exists(select 1 from public.attendance_scan_receipts where class_id=p_class_id and state='review' and (captured_at at time zone 'Asia/Manila')::date=day) then raise exception 'Resolve scan issues for this day before finalizing';end if;
   for sid in select r.id from public.profiles r where r.class_id=p_class_id and r.role='student' loop
    insert into public.attendance_logs(student_id,class_id,log_date,status,entry_method,recorded_by,notes) values(sid,p_class_id,day,'Absent','Manual',auth.uid()::text,reason) on conflict(student_id,class_id,log_date) do nothing;
    if found then amount:=amount+1;end if;
   end loop;
  end if;
  insert into public.attendance_station_days(class_id,log_date,finalized,finalized_by,finalized_at) values(p_class_id,day,p_action='finalize',auth.uid()::text,stamp)
   on conflict(class_id,log_date) do update set finalized=excluded.finalized,finalized_by=excluded.finalized_by,finalized_at=excluded.finalized_at;
  insert into public.attendance_station_audit(id,class_id,log_date,action,reason,actor) values(rid,p_class_id,day,p_action,reason,auth.uid()::text);
  return jsonb_build_object('ok',true,'absencesRecorded',amount);
 elsif p_action='manual' then
  sid:=p_payload->>'student';
  if not exists(select 1 from public.profiles where id=sid and class_id=p_class_id and role='student') then raise exception 'Student is not in this classroom';end if;
  status:=p_payload->>'status';
  select * into old_log from public.attendance_logs where student_id=sid and class_id=p_class_id and log_date=day for update;
  if status in ('Auto','Early','On Time','Late') then
   captured:=(p_payload->>'arrivedAt')::timestamptz;
   if captured is null or captured>stamp+interval '30 seconds' or (captured at time zone 'Asia/Manila')::date<>day then raise exception 'Choose a valid arrival time on this school day';end if;
   if status='Auto' then
    select * into schedule from public.get_effective_attendance_schedule(p_class_id,day);
    local_time:=(captured at time zone 'Asia/Manila')::time;
    if schedule.id is null or schedule.day_off or local_time<schedule.open_time or local_time>schedule.close_time then raise exception 'Outside the scheduled window. Choose an explicit status and explain the exception';end if;
    status:=case when local_time<schedule.start_time then 'Early' when local_time<schedule.late_cutoff then 'On Time' else 'Late' end;
   end if;
  elsif status not in ('Absent','Excused','Remove') or status is null then raise exception 'Invalid attendance status';
  end if;
  if status='Remove' then delete from public.attendance_logs where id=old_log.id;
  else
   insert into public.attendance_logs(student_id,class_id,log_date,status,scanned_at,entry_method,recorded_by,notes)
    values(sid,p_class_id,day,status,coalesce(captured,stamp),'Manual',auth.uid()::text,reason)
    on conflict(student_id,class_id,log_date) do update set status=excluded.status,scanned_at=excluded.scanned_at,entry_method='Manual',recorded_by=excluded.recorded_by,notes=excluded.notes,updated_at=stamp returning * into new_log;
  end if;
  if p_payload ? 'receipt' then
   update public.attendance_scan_receipts set state='resolved',resolved_by=auth.uid()::text,resolved_at=stamp where id=(p_payload->>'receipt')::uuid and class_id=p_class_id and state='review';
   if not found then raise exception 'Scan issue already resolved or not in this class';end if;
  end if;
  insert into public.attendance_station_audit(id,class_id,student_id,log_date,action,reason,actor,before_log,after_log)
   values(rid,p_class_id,sid,day,'manual',reason,auth.uid()::text,case when old_log.id is not null then to_jsonb(old_log) end,case when new_log.id is not null then to_jsonb(new_log) end);
  return jsonb_build_object('ok',true,'studentId',sid,'log',case when new_log.id is not null then to_jsonb(new_log) end,'removed',status='Remove');
 end if;
 raise exception 'Unknown attendance station action';
end $$;
revoke all on function public.attendance_station(text,text,jsonb) from public,anon;
grant execute on function public.attendance_station(text,text,jsonb) to authenticated;
