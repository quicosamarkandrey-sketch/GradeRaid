-- Run after phase81. Square photo rendering is client-side; this adds manual
-- award receipts and synchronized 2.4-second random-call reveals.
-- Both card and manual awards retain existing scoring/reward triggers.
alter table public.recitation_scan_receipts add column if not exists points integer not null default 1;
alter table public.recitation_scan_receipts add column if not exists source text not null default 'scan';
create or replace function public.recitation_presentation(p_class_id text,p_action text,p_device text default '',p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 s public.recitation_sessions; p public.recitation_presentations; st jsonb; snap jsonb;
 sid text; tag text; receipt public.recitation_scan_receipts; logged public.recitation_log;
 filters jsonb; pool jsonb; winner jsonb; call jsonb; calls jsonb; ids jsonb;
 idx integer; secs integer; n integer; award_points integer:=1; result jsonb := '{}'::jsonb; stamp timestamptz:=clock_timestamp();
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
 if p_action in ('scan','manual') then
  select * into receipt from public.recitation_scan_receipts where id=(p_payload->>'id')::uuid;
  if found then
   if receipt.session_id<>s.id then raise exception 'Receipt belongs to another session'; end if;
   return public.recitation_presentation_snapshot(s.id,p_device)||jsonb_build_object('duplicate',true,'receipt',to_jsonb(receipt));
  end if;
 end if;
 if not s.is_active and p_action<>'undo' then raise exception 'Session has ended. Pending cards were not awarded'; end if;
 idx:=coalesce((st->>'index')::integer,0);
 if p_action in ('pick','select','later','update') and nullif(st#>>'{draw,revealAt}','')::timestamptz>stamp then raise exception 'Please wait for the student reveal'; end if;
 if p_action='update' then
  if p_payload ? 'revision' and (p_payload->>'revision')::bigint<>p.revision then raise exception 'Session changed. Try again'; end if;
  -- Whitelist teacher-editable fields; calls and awards are server-owned.
  st:=st||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_payload->'patch') where key in ('questions','index','view','scanner','paused','filters','scoreScope','layout','periodStart'));
  if jsonb_array_length(st->'questions')>100 or octet_length(st::text)>250000 then raise exception 'Use up to 100 short questions'; end if;
  if st->>'view' not in ('question','seats','spotlight') or st->>'scanner' not in ('open','selected') or st->>'scoreScope' not in ('session','today','period') then raise exception 'Invalid presentation setting'; end if;
  if coalesce((st->>'index')::int,0)<0 or coalesce((st->>'index')::int,0)>greatest(0,jsonb_array_length(st->'questions')-1) then raise exception 'Question does not exist'; end if;
  if (st->>'scoreScope'='period' or st#>>'{filters,scope}'='period') and nullif(st->>'periodStart','') is null then raise exception 'Choose a reporting period start date first'; end if;
  if st ? 'periodStart' then perform (st->>'periodStart')::timestamptz; end if;
  if st->>'index' is distinct from p.state->>'index' then st:=st-'selected'-'timer'-'draw'; end if;
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
  if p_action='pick' then
   st:=st||jsonb_build_object('draw',jsonb_build_object('id',gen_random_uuid(),'startedAt',stamp,'revealAt',stamp+interval '2.4 seconds','candidates',(select jsonb_agg(value->>'id') from jsonb_array_elements(pool))));
  else st:=st-'draw'; end if;
  result:=jsonb_build_object('eligible',jsonb_array_length(pool));
 elsif p_action='later' then
  if st->>'selected' is not null then st:=jsonb_set(st,'{later}',(coalesce(st->'later','[]')-(st->>'selected'))||jsonb_build_array(st->>'selected'))-'selected'; end if;
 elsif p_action in ('scan','manual') then
  if p_action='scan' and (st->>'paused')::boolean then raise exception 'Scanner paused. Card was not awarded'; end if;
  if (p_payload->>'question')::int is distinct from idx or (p_payload ? 'questionText' and coalesce(p_payload->>'questionText','') is distinct from coalesce(st->'questions'->idx->>'text','')) then raise exception 'Question changed while award was pending. Discard and record again after checking the award'; end if;
  if p_action='manual' then
   award_points:=(p_payload->>'points')::integer;
   if award_points is null or award_points not between 1 and 10 then raise exception 'Manual awards must be a whole number from 1 to 10'; end if;
   select r.id into sid from public.profiles r where r.id=p_payload->>'student' and r.class_id=s.class_id and r.role='student';
  else
  tag:=lower(regexp_replace(p_payload->>'tag','[^a-zA-Z0-9]','','g'));
  select c.student_id into sid from public.rfid_cards c join public.profiles r on r.id=c.student_id where c.is_active and lower(regexp_replace(c.tag_id,'[^a-zA-Z0-9]','','g'))=tag and r.class_id=s.class_id and r.role='student';
  end if;
  if sid is null then raise exception 'Card is unregistered or belongs to another class'; end if;
  if not exists(select 1 from public.attendance_logs a where a.student_id=sid and a.class_id=s.class_id and a.log_date=(stamp at time zone 'Asia/Manila')::date and a.status in ('Early','On Time','Late')) then raise exception 'Student must be marked present before awarding'; end if;
  if p_action='scan' and st->>'scanner'='selected' and sid is distinct from st->>'selected' and not coalesce((p_payload->>'override')::boolean,false) then
   return public.recitation_presentation_snapshot(s.id,p_device)||jsonb_build_object('mismatch',true,'scannedStudent',sid);
  end if;
  if p_action='scan' and exists(select 1 from public.recitation_scan_receipts r where r.session_id=s.id and r.student_id=sid and r.source='scan' and r.created_at>stamp-interval '5 seconds') then raise exception 'Card just scanned. Wait five seconds'; end if;
  logged:=public.log_recitation_point(sid,s.class_id,award_points,case when p_action='manual' then 'Manual recitation' else 'Recitation' end||' · question '||(idx+1)::text||case when p_action='manual' and nullif(trim(p_payload->>'note'),'') is not null then ' · '||left(trim(p_payload->>'note'),300) else '' end,p_action);
  insert into public.recitation_scan_receipts(id,session_id,student_id,log_id,question_index,points,source) values((p_payload->>'id')::uuid,s.id,sid,logged.id,idx,award_points,p_action) returning * into receipt;
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
