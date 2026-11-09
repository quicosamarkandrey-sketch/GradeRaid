-- Phase 81: teacher remote + classroom presentation. Run after phases 30, 71, 72.
-- Additive: awards still use log_recitation_point and its existing reward triggers.
create table if not exists public.recitation_presentations (
 session_id uuid primary key references public.recitation_sessions(id),
 code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
 controller text, controller_user text,
 revision bigint not null default 0,
 state jsonb not null default '{"questions":[],"index":0,"view":"question","scanner":"open","paused":false,"calls":[],"later":[],"filters":{"preset":"everyone","recent":2,"repeat":"question","excluded":[],"selected":[],"scope":"session"},"scoreScope":"session"}'::jsonb
);
create table if not exists public.recitation_scan_receipts (
 id uuid primary key,
 session_id uuid not null references public.recitation_sessions(id),
 student_id text not null references public.profiles(id),
 log_id text not null,
 question_index integer not null,
 created_at timestamptz not null default now(),
 undone boolean not null default false
);
create index if not exists recitation_scan_receipts_session on public.recitation_scan_receipts(session_id,created_at);
alter table public.recitation_presentations enable row level security;
alter table public.recitation_scan_receipts enable row level security;
revoke all on public.recitation_presentations, public.recitation_scan_receipts from anon, authenticated;

-- Authorized staff snapshots only. Pairing codes locate a class; they grant no access.
create or replace function public.recitation_presentation_snapshot(p_session uuid,p_device text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.recitation_sessions; p public.recitation_presentations; roster jsonb; receipts jsonb;
begin
 select * into s from public.recitation_sessions where id=p_session;
 if s.id is null or auth.uid() is null or not public.is_staff_for_section(s.class_id) then raise exception 'Not authorized for this classroom'; end if;
 select * into p from public.recitation_presentations where session_id=s.id;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'name',r.display_name,'photo',r.profile_pic_url,'init',r.init,
  'status',(select a.status from public.attendance_logs a where a.student_id=r.id and a.class_id=s.class_id and a.log_date=(now() at time zone 'Asia/Manila')::date limit 1),
  'session',coalesce((select sum(l.pts) from public.recitation_log l where l.student_id=r.id and l.class_id=s.class_id and l.created_at>=s.started_at and l.created_at<=coalesce(s.ended_at,now())),0),
  'today',coalesce((select sum(l.pts) from public.recitation_log l where l.student_id=r.id and l.class_id=s.class_id and (l.created_at at time zone 'Asia/Manila')::date=(now() at time zone 'Asia/Manila')::date),0),
  'period',coalesce((select sum(l.pts) from public.recitation_log l where l.student_id=r.id and l.class_id=s.class_id and l.created_at>=coalesce(nullif(p.state->>'periodStart','')::timestamptz,s.started_at)),0),
  'seats',coalesce((select jsonb_agg(jsonb_build_object('layout',a.layout_id,'id',a.seat_id,'x',t.x_coord,'y',t.y_coord,'label',t.label)) from public.seat_assignments a join public.seats t on t.id=a.seat_id join public.classroom_layouts c on c.id=a.layout_id where a.student_id=r.id and c.class_id=s.class_id),'[]'::jsonb)
 ) order by r.display_name),'[]'::jsonb) into roster from public.profiles r where r.class_id=s.class_id and r.role='student';
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at),'[]'::jsonb) into receipts from public.recitation_scan_receipts r where session_id=s.id;
 return jsonb_build_object('session',to_jsonb(s),'code',p.code,'revision',p.revision,'state',p.state,'roster',roster,'receipts',receipts,'serverTime',now(),'controllerActive',p.controller is not null,'controllerMine',p.controller=p_device and p.controller_user=auth.uid()::text);
end $$;
revoke all on function public.recitation_presentation_snapshot(uuid,text) from public,anon;
grant execute on function public.recitation_presentation_snapshot(uuid,text) to authenticated;

create or replace function public.recitation_presentation(p_class_id text,p_action text,p_device text default '',p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 s public.recitation_sessions; p public.recitation_presentations; st jsonb; snap jsonb;
 sid text; tag text; receipt public.recitation_scan_receipts; logged public.recitation_log;
 filters jsonb; pool jsonb; winner jsonb; call jsonb; calls jsonb; ids jsonb;
 idx integer; secs integer; n integer; result jsonb := '{}'::jsonb; stamp timestamptz:=clock_timestamp();
begin
 if p_action='join' then
  select rs.* into s from public.recitation_sessions rs join public.recitation_presentations rp on rp.session_id=rs.id where rp.code=upper(trim(p_payload->>'code')) and rs.is_active;
 else
  select * into s from public.recitation_sessions where class_id=p_class_id and id=coalesce(nullif(p_payload->>'session','')::uuid,id) order by is_active desc,started_at desc limit 1;
 end if;
 if auth.uid() is null or (p_action='join' and s.id is null) or not public.is_staff_for_section(coalesce(s.class_id,p_class_id)) then raise exception 'Not authorized or pairing code unavailable'; end if;
 if p_action='start' then
  -- Serializes simultaneous starts, including calls from this interface on two devices.
  perform pg_advisory_xact_lock(hashtext('recitation:'||p_class_id));
  s:=public.start_recitation_session(p_class_id);
 end if;
 if s.id is null then raise exception 'Start a recitation session first'; end if;
 if p_action='start' then insert into public.recitation_presentations(session_id) values(s.id) on conflict do nothing; end if;
 select * into p from public.recitation_presentations where session_id=s.id for update;
 if p.session_id is null then raise exception 'Open the Recitation Studio on the controlling device first'; end if;
 st:=p.state;
 if p_action in ('start','snapshot','join') then return public.recitation_presentation_snapshot(s.id,p_device); end if;
 if p_action='claim' then
  if not s.is_active then raise exception 'Session has ended'; end if;
  if length(p_device)<24 then raise exception 'Invalid device identity'; end if;
  if p.controller is not null and p.controller<>p_device and coalesce((p_payload->>'takeover')::boolean,false)=false then raise exception 'Another phone controls this session. Use Take control to switch devices'; end if;
  update public.recitation_presentations set controller=p_device,controller_user=auth.uid()::text,revision=revision+1 where session_id=s.id;
  return public.recitation_presentation_snapshot(s.id,p_device);
 end if;
 if p.controller is distinct from p_device or p.controller_user is distinct from auth.uid()::text then raise exception 'This device is a display. Take control before making changes'; end if;
 -- Retrying an already committed scan returns the original receipt, even after finish.
 if p_action='scan' then
  select * into receipt from public.recitation_scan_receipts where id=(p_payload->>'id')::uuid;
  if found then
   if receipt.session_id<>s.id then raise exception 'Receipt belongs to another session'; end if;
   return public.recitation_presentation_snapshot(s.id,p_device)||jsonb_build_object('duplicate',true,'receipt',to_jsonb(receipt));
  end if;
 end if;
 if not s.is_active and p_action<>'undo' then raise exception 'Session has ended. Pending cards were not awarded'; end if;
 idx:=coalesce((st->>'index')::integer,0);
 if p_action='update' then
  if p_payload ? 'revision' and (p_payload->>'revision')::bigint<>p.revision then raise exception 'Session changed. Try again'; end if;
  -- Whitelist teacher-editable fields; calls and awards are server-owned.
  st:=st||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_payload->'patch') where key in ('questions','index','view','scanner','paused','filters','scoreScope','layout','periodStart'));
  if jsonb_array_length(st->'questions')>100 or octet_length(st::text)>250000 then raise exception 'Use up to 100 short questions'; end if;
  if st->>'view' not in ('question','seats','spotlight') or st->>'scanner' not in ('open','selected') or st->>'scoreScope' not in ('session','today','period') then raise exception 'Invalid presentation setting'; end if;
  if coalesce((st->>'index')::int,0)<0 or coalesce((st->>'index')::int,0)>greatest(0,jsonb_array_length(st->'questions')-1) then raise exception 'Question does not exist'; end if;
  if (st->>'scoreScope'='period' or st#>>'{filters,scope}'='period') and nullif(st->>'periodStart','') is null then raise exception 'Choose a reporting period start date first'; end if;
  if st ? 'periodStart' then perform (st->>'periodStart')::timestamptz; end if;
  if st->>'index' is distinct from p.state->>'index' then st:=st-'selected'-'timer'; end if;
 elsif p_action='timer' then
  secs:=greatest(0,least(600,coalesce((p_payload->>'seconds')::integer,20)));
  if p_payload->>'mode'='pause' then
   secs:=greatest(0,ceil(extract(epoch from (nullif(st#>>'{timer,endsAt}','')::timestamptz-stamp)))::int);
   st:=jsonb_set(st,'{timer}',jsonb_build_object('remaining',secs,'paused',true));
  else
   if p_payload->>'mode'='resume' then secs:=coalesce((st#>>'{timer,remaining}')::int,20); end if;
   if p_payload->>'mode'='extend' then secs:=10+greatest(0,ceil(extract(epoch from (coalesce(nullif(st#>>'{timer,endsAt}','')::timestamptz,stamp)-stamp)))::int); end if;
   st:=jsonb_set(st,'{timer}',jsonb_build_object('endsAt',stamp+make_interval(secs=>secs),'paused',false));
  end if;
 elsif p_action in ('pick','select') then
  snap:=public.recitation_presentation_snapshot(s.id,p_device); filters:=st->'filters'; calls:=st->'calls';
  n:=greatest(0,least(5,coalesce((filters->>'recent')::int,2)));
  select coalesce(jsonb_agg(c->>'student'),'[]') into ids from (select value c from jsonb_array_elements(calls) with ordinality t(value,i) order by i desc limit n) recent;
  select coalesce(jsonb_agg(r),'[]') into pool from jsonb_array_elements(snap->'roster') r where
   r->>'status' in ('Early','On Time','Late')
   and not coalesce(filters->'excluded','[]') ? (r->>'id')
   and not ids ? (r->>'id')
   and (coalesce(filters->>'repeat','question')='off' or not exists(select 1 from jsonb_array_elements(calls) c where c->>'student'=r->>'id' and (filters->>'repeat'='session' or (c->>'question')::int=idx)))
   and (coalesce(jsonb_array_length(filters->'selected'),0)=0 or filters->'selected' ? (r->>'id'))
   and (coalesce(filters->>'preset','everyone')<>'fresh' or not exists(select 1 from jsonb_array_elements(calls) c where c->>'student'=r->>'id'))
   and (filters->>'preset'<>'later' or coalesce(st->'later','[]') ? (r->>'id'));
  if filters->>'preset'='low' then
   select coalesce(jsonb_agg(r),'[]') into pool from jsonb_array_elements(pool) r where (r->>coalesce(filters->>'scope','session'))::numeric=(select min((v->>coalesce(filters->>'scope','session'))::numeric) from jsonb_array_elements(pool) v);
  elsif filters->>'preset'='opportunities' then
   select coalesce(jsonb_agg(r),'[]') into pool from jsonb_array_elements(pool) r where (select count(*) from jsonb_array_elements(calls) c where c->>'student'=r->>'id')=(select min(cnt) from (select (select count(*) from jsonb_array_elements(calls) c where c->>'student'=v->>'id') cnt from jsonb_array_elements(pool) v) counts);
  end if;
  if p_action='select' then
   select value into winner from jsonb_array_elements(snap->'roster') where value->>'id'=p_payload->>'student' and value->>'status' in ('Early','On Time','Late');
   if winner is null then raise exception 'Volunteer must be present in this class'; end if;
  else
   if jsonb_array_length(pool)=0 then return snap||jsonb_build_object('emptyPool',true); end if;
   select value into winner from jsonb_array_elements(pool) order by random() limit 1;
  end if;
  call:=jsonb_build_object('student',winner->>'id','question',idx,'at',stamp);
  st:=st||jsonb_build_object('selected',winner->>'id','view','spotlight','calls',calls||jsonb_build_array(call));
  st:=jsonb_set(st,'{later}',coalesce(st->'later','[]')-(winner->>'id'));
  result:=jsonb_build_object('eligible',jsonb_array_length(pool));
 elsif p_action='later' then
  if st->>'selected' is not null then st:=jsonb_set(st,'{later}',(coalesce(st->'later','[]')-(st->>'selected'))||jsonb_build_array(st->>'selected'))-'selected'; end if;
 elsif p_action='scan' then
  if (st->>'paused')::boolean then raise exception 'Scanner paused. Card was not awarded'; end if;
  if (p_payload->>'question')::int is distinct from idx or (p_payload ? 'questionText' and coalesce(p_payload->>'questionText','') is distinct from coalesce(st->'questions'->idx->>'text','')) then raise exception 'Question changed while card was pending. Discard and scan again after checking the award'; end if;
  tag:=lower(regexp_replace(p_payload->>'tag','[^a-zA-Z0-9]','','g'));
  select c.student_id into sid from public.rfid_cards c join public.profiles r on r.id=c.student_id where c.is_active and lower(regexp_replace(c.tag_id,'[^a-zA-Z0-9]','','g'))=tag and r.class_id=s.class_id and r.role='student';
  if sid is null then raise exception 'Card is unregistered or belongs to another class'; end if;
  if not exists(select 1 from public.attendance_logs a where a.student_id=sid and a.class_id=s.class_id and a.log_date=(stamp at time zone 'Asia/Manila')::date and a.status in ('Early','On Time','Late')) then raise exception 'Student must be marked present before awarding'; end if;
  if st->>'scanner'='selected' and sid is distinct from st->>'selected' and not coalesce((p_payload->>'override')::boolean,false) then
   return public.recitation_presentation_snapshot(s.id,p_device)||jsonb_build_object('mismatch',true,'scannedStudent',sid);
  end if;
  if exists(select 1 from public.recitation_scan_receipts r where r.session_id=s.id and r.student_id=sid and r.created_at>stamp-interval '5 seconds') then raise exception 'Card just scanned. Wait five seconds'; end if;
  logged:=public.log_recitation_point(sid,s.class_id,1,'Recitation · question '||(idx+1)::text,'scan');
  insert into public.recitation_scan_receipts(id,session_id,student_id,log_id,question_index) values((p_payload->>'id')::uuid,s.id,sid,logged.id,idx) returning * into receipt;
  result:=jsonb_build_object('receipt',to_jsonb(receipt));
 elsif p_action='undo' then
  select * into receipt from public.recitation_scan_receipts where session_id=s.id and id=(p_payload->>'id')::uuid for update;
  if receipt.id is null then raise exception 'Award not found in this session'; end if;
  if not receipt.undone then
   perform public.undo_recitation_log(receipt.log_id);
   update public.recitation_scan_receipts set undone=true where id=receipt.id;
  end if;
 elsif p_action='finish' then
  update public.recitation_sessions set is_active=false,ended_at=stamp where id=s.id;
  st:=st||'{"view":"summary","paused":true}'::jsonb;
 else raise exception 'Unknown recitation action';
 end if;
 update public.recitation_presentations set state=st,revision=revision+1 where session_id=s.id;
 return public.recitation_presentation_snapshot(s.id,p_device)||result;
end $$;
revoke all on function public.recitation_presentation(text,text,text,jsonb) from public,anon;
grant execute on function public.recitation_presentation(text,text,text,jsonb) to authenticated;
