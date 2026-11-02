-- Allow the five new teacher-triggered elemental skills. Run after phase75.
-- Repeatable; preserves function grants, event data, damage and reward rules.
begin;
do $elemental$
declare target regprocedure;body text;patched text;key_type text;
begin
 select format_type(atttypid,null) into key_type from pg_attribute where attrelid='public.boss_events'::regclass and attname='id';
 target:=to_regprocedure(format('public.world_boss_action(%s,text,jsonb)',key_type));
 if target is null then raise exception 'Apply the updated phase75 script first';end if;
 body:=pg_get_functiondef(target);
 if strpos(body,'phantom_orbit')=0 then
   patched:=replace(body,
     $old$('earthquake','chaos_wind','darkness','mirror_trick','berserk_roar','meteor_shower')$old$,
     $new$('earthquake','chaos_wind','darkness','mirror_trick','berserk_roar','meteor_shower','lightning_storm','glacial_prison','void_lance','gravity_well','phantom_orbit')$new$);
   patched:=replace(patched,$old9$('earthquake','chaos_wind','darkness','mirror_trick','berserk_roar','meteor_shower','lightning_storm','glacial_prison','void_lance')$old9$,$new11$('earthquake','chaos_wind','darkness','mirror_trick','berserk_roar','meteor_shower','lightning_storm','glacial_prison','void_lance','gravity_well','phantom_orbit')$new11$);
   if patched=body then raise exception 'Unexpected battle function version. Apply the updated phase75 script.';end if;
   execute patched;
 end if;
end;
$elemental$;
notify pgrst, 'reload schema';
commit;
