-- Repair installed World Boss functions without changing enum values, data,
-- authorization, reward rules or function grants. Run after phase75. Repeatable.
begin;
do $repair$
declare
  target regprocedure;
  original text;
  patched text;
  boss_key_type text;
begin
  select format_type(atttypid,null) into boss_key_type from pg_attribute
  where attrelid='public.boss_events'::regclass and attname='id' and not attisdropped;
  target := to_regprocedure(format('public.world_boss_action(%s,text,jsonb)',boss_key_type));
  if target is null then
    raise exception 'Apply phase75_world_boss_reliability.sql before this repair';
  end if;
  original := pg_get_functiondef(target);
  -- A text comparison also supports older schemas that stored defeated as text.
  -- Comparing the enum directly coerces every IN literal, even on empty tables.
  patched := replace(original,
    $old$status in ('active','loot','defeated')$old$,
    $new$status::text in ('active','loot','defeated')$new$);
  if patched <> original then execute patched; end if;

  for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='apply_boss_damage' and p.pronargs=5 loop
    original := pg_get_functiondef(target);
    -- Legacy damage reports zero HP; start_loot_rush then sets loot status AND
    -- its timestamps. Setting loot here would bypass that function's guard.
    patched := replace(original,
      $old$case when current_hp - p_damage <= 0 then 'defeated' else status end$old$,
      'status');
    if patched <> original then execute patched; end if;
  end loop;
end;
$repair$;
commit;
