-- Shared loot release for the in-battle victory burst. Run after phase75.
-- Preserves events, stock, inventory, authorization and existing function grants.
begin;
do $loot_race$
declare target regprocedure;original text;patched text;boss_key_type text;
 anchor text := $anchor$     if not exists(select 1 from boss_participants where boss_id=b.id and student_id=sid and total_damage>0) then raise exception 'Contribute damage in this raid to claim loot';end if;$anchor$;
 guard text := $guard$     if now()<b.loot_started_at+make_interval(secs=>least(4.0,greatest(0.0,coalesce(b.loot_duration_sec,120)/4.0))::double precision) then raise exception 'Loot is scattering. Wait for the shared countdown.';end if;$guard$;
begin
 select format_type(atttypid,null) into boss_key_type from pg_attribute
 where attrelid='public.boss_events'::regclass and attname='id' and not attisdropped;
 target := to_regprocedure(format('public.world_boss_action(%s,text,jsonb)',boss_key_type));
 if target is null then raise exception 'Apply the updated phase75_world_boss_reliability.sql first';end if;
 original := pg_get_functiondef(target);patched := original;
 if strpos(original,'Loot is scattering. Wait for the shared countdown.')=0 then
   if strpos(original,anchor)=0 then raise exception 'Unexpected battle function version. Reapply the updated phase75 script.';end if;
   patched := replace(patched,anchor,guard||chr(10)||anchor);
 end if;
 patched := replace(patched,
   $old$return jsonb_build_object('ok',true,'viewerId',sid,'boss',$old$,
   $new$return jsonb_build_object('ok',true,'serverNow',extract(epoch from clock_timestamp())*1000,'viewerId',sid,'boss',$new$);
 if patched<>original then execute patched;end if;
end;
$loot_race$;
notify pgrst, 'reload schema';
commit;
