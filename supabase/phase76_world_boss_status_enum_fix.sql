-- Repair installed World Boss functions without changing enum values, data,
-- authorization, reward rules or function grants. Run after phase75. Repeatable.
begin;
do $repair$
declare
  target regprocedure;
  original text;
  patched text;
begin
  target := to_regprocedure('public.world_boss_action(uuid,text,jsonb)');
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

  target := to_regprocedure('public.apply_boss_damage(uuid,text,text,integer,boolean)');
  if target is not null then
    original := pg_get_functiondef(target);
    -- Legacy damage reports zero HP; start_loot_rush then sets loot status AND
    -- its timestamps. Setting loot here would bypass that function's guard.
    patched := replace(original,
      $old$case when current_hp - p_damage <= 0 then 'defeated' else status end$old$,
      'status');
    if patched <> original then execute patched; end if;
  end if;
end;
$repair$;
commit;
