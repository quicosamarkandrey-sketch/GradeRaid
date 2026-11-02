const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
async function runSchema(idType){const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 create table profiles(id text primary key,display_name text,role text,class_id text,is_active boolean default true,xp int default 0,coins int default 0,level int default 0,tier text default 'Novice');
 create function is_staff_for_section(cid text) returns boolean language sql as $$select exists(select 1 from profiles where id=auth.uid()::text and role in ('teacher','admin') and class_id=cid)$$;
 create type boss_status as enum ('draft','active','loot','ended');
 create table boss_events(id ${idType} primary key,class_id text,name text,status boss_status,max_hp int,current_hp int,start_date date,end_date date,xp_reward int,coin_reward int,participation_reward int,victory_reward int,boss_questions jsonb,combat_settings jsonb,loot_rewards jsonb,loot_duration_sec int,skills jsonb default '{}',minion_settings jsonb default '{}',defeated_at timestamptz,ended_at timestamptz,loot_started_at timestamptz,loot_finalized_at timestamptz);
 create table boss_participants(boss_id ${idType},class_id text,student_id text,total_damage int default 0,correct_answers int default 0,wrong_answers int default 0,crit_hits int default 0,minions_defeated int default 0,last_question_idx int default 0,joined_at timestamptz,primary key(boss_id,student_id));
 create table loot_claims(id text primary key,boss_id ${idType},class_id text,reward_id text,item_name text,rarity text,student_id text,student_name text,student_init text,student_color text,claimed_at timestamptz);
 create table inventory(student_id text,item_id text,item_name text,emoji text,category text,quantity int,date_purchased text,last_purchased text,source text,status text,primary key(student_id,item_id));`);
 const teacher='11111111-1111-4111-8111-111111111111',alex='22222222-2222-4222-8222-222222222222',bea='33333333-3333-4333-8333-333333333333',outsider='44444444-4444-4444-8444-444444444444',boss=idType==='text'?'boss_legacy_science_01':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const [id,role,cid,name] of [[teacher,'teacher','science','Morgan'],[alex,'student','science','Alex'],[bea,'student','science','Bea'],[outsider,'student','foreign','Other']])await db.query('insert into profiles(id,role,class_id,display_name) values($1,$2,$3,$4)',[id,role,cid,name]);
 await db.query(`insert into boss_events(id,class_id,name,status,max_hp,current_hp,end_date,xp_reward,coin_reward,participation_reward,victory_reward,boss_questions,combat_settings,loot_rewards,loot_duration_sec) values($1,'science','Sentinel','draft',300,300,current_date+30,100,50,25,10,$2,$3,$4,120)`,[boss,JSON.stringify([{q:'Two plus two?',opts:['4','5'],answer:0},{q:'Two times two?',opts:['4','5'],answer:0}]),JSON.stringify({damagePerAnswer:150,critChance:0,questionCooldown:0}),JSON.stringify([{id:'voucher',itemName:'Class voucher',rarity:'Rare',quantity:1,claimLimit:1}])]);
 // A stale opposite-type overload must not make PostgREST JSON dispatch ambiguous.
 await db.exec(`create function public.world_boss_action(p_boss_id ${idType==='text'?'uuid':'text'},p_action text,p_payload jsonb default '{}') returns jsonb language sql as $$select '{}'::jsonb$$;`);
 const migration=fs.readFileSync('supabase/phase75_world_boss_reliability.sql','utf8');await db.exec(migration);await db.exec(migration);
 assert.equal((await db.query('select id from boss_events')).rows[0].id,boss,'Existing event IDs are preserved');
 const signature=`public.world_boss_action(${idType},text,jsonb)`;
 assert.equal(Number((await db.query("select count(*) total from pg_proc where proname='world_boss_action'")).rows[0].total),1,'Only the native RPC signature remains');
 assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[signature])).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') allowed",[signature])).rows[0].allowed,true);
 const childTypes=(await db.query("select format_type(atttypid,null) type from pg_attribute where attrelid in ('boss_answer_receipts'::regclass,'boss_victory_rewards'::regclass) and attname='boss_id'")).rows;
 assert.deepEqual(childTypes.map(r=>r.type),[idType,idType],'Foreign keys use the parent ID type');
 await assert.rejects(()=>db.query("insert into boss_answer_receipts(boss_id,run_id,student_id,question_idx,response) values($1,gen_random_uuid(),$2,0,'{}')",[idType==='text'?'missing-boss':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',alex]),/foreign key constraint/);
 // Recreate the installed faulty definitions, then exercise the incremental repair.
 const broken=migration.replace("status::text in ('active','loot','defeated')","status in ('active','loot','defeated')");
 await db.exec(broken);
 await db.query("select set_config('app.uid',$1,false)",[teacher]);
 await assert.rejects(()=>db.query("select world_boss_action($1,'activate','{}')",[boss]),/invalid input value for enum boss_status: "defeated"/);
 const historical=fs.readFileSync('supabase/phase14_section_isolation.sql','utf8');
 const legacy=historical.slice(historical.indexOf('create or replace function public.apply_boss_damage('),historical.indexOf('grant execute on function public.apply_boss_damage'));
 await db.exec(legacy.replace(/p_boss_id(\s+)uuid/, 'p_boss_id$1public.boss_events.id%TYPE').replace('status     = status',"status     = case when current_hp - p_damage <= 0 then 'defeated' else status end"));
 await assert.rejects(()=>db.query('select * from apply_boss_damage($1,$2,$3,1,false)',[boss,'science',alex]),/invalid input value for enum boss_status: "defeated"/);
 const repair=fs.readFileSync('supabase/phase76_world_boss_status_enum_fix.sql','utf8');await db.exec(repair);await db.exec(repair);
 // Legacy final hits must leave loot initialization to start_loot_rush.
 await db.exec("begin;update boss_events set status='active'");const legacyHit=(await db.query('select * from apply_boss_damage($1,$2,$3,300,false)',[boss,'science',alex])).rows[0];assert.equal(legacyHit.new_hp,0);assert.equal(legacyHit.defeated,true);assert.equal((await db.query('select status from boss_events where id=$1',[boss])).rows[0].status,'active');await db.exec('rollback');
 const as=async id=>db.query("select set_config('app.uid',$1,false)",[id||'']);
 let run;const action=async(kind,payload={})=>(await db.query('select world_boss_action($1,$2,$3) data',[boss,kind,JSON.stringify({runId:run,...payload})])).rows[0].data;
 await as(teacher);let data=await action('activate');run=data.boss.raid_run_id;assert.equal(data.boss.status,'active');
 await as(outsider);await assert.rejects(()=>action('snapshot'),/another section/);await db.query('update profiles set class_id=null where id=$1',[outsider]);await assert.rejects(()=>action('snapshot'),/another section/);await db.query("update profiles set class_id='science',role=null where id=$1",[outsider]);await assert.rejects(()=>action('snapshot'),/another section/);
 await as(alex);await assert.rejects(()=>action('end'),/Teacher/);await assert.rejects(()=>action('signal',{kind:'minion'}),/Teacher/);await assert.rejects(()=>action('answer',{questionIdx:0,choice:0}),/Join/);
 await action('join');await db.exec("update boss_events set skills='{\"mirror_trick\":{\"enabled\":true}}',minion_settings='{\"enabled\":true}'");await as(teacher);data=await action('signal',{kind:'skill',skillId:'mirror_trick'});assert.equal(data.boss.raid_signals.length,1);data=await action('signal',{kind:'minion'});assert.equal(data.boss.raid_signals.length,2);await as(alex);await db.exec("update boss_participants set hp=0,is_ko=true,revive_at=now()+interval '1 minute'");await assert.rejects(()=>action('revive',{studentId:alex}),/revive timer/);await as(teacher);data=await action('revive',{studentId:alex});assert.equal(data.participants[0].hp,3);await as(alex);data=await action('answer',{questionIdx:0,choice:0});assert.equal(data.boss.current_hp,150);assert.equal(data.outcome.isCrit,false);assert.equal(data.participants[0].total_damage,150);
 data=await action('answer',{questionIdx:0,choice:1});assert.equal(data.boss.current_hp,150);assert.equal(data.outcome.replayed,true);assert.equal(data.participants[0].correct_answers,1);
 await as(bea);await action('join');data=await action('answer',{questionIdx:0,choice:1});assert.equal(data.boss.current_hp,150);assert.equal(data.outcome.correct,false);await assert.rejects(()=>action('answer',{questionIdx:5,choice:0}),/progress/);
 data=await action('answer',{questionIdx:1,choice:0});assert.equal(data.boss.current_hp,0);assert.equal(data.boss.status,'loot');assert.equal(data.wallet.xp,125);assert.equal(data.wallet.coins,60);
 const balances=async()=>(await db.query('select id,xp,coins from profiles order by id')).rows;
 const paid=await balances();await action('answer',{questionIdx:1,choice:0});assert.deepEqual(await balances(),paid,'Replayed final hits cannot pay twice');
 // Reinstall with populated receipts/rewards: no IDs, run IDs, history or balances reset.
 const savedReceipts=Number((await db.query('select count(*) total from boss_answer_receipts')).rows[0].total);
 await db.exec(migration);await db.exec(repair);
 assert.deepEqual(await balances(),paid);assert.equal(Number((await db.query('select count(*) total from boss_answer_receipts')).rows[0].total),savedReceipts);
 assert.equal((await db.query('select raid_run_id from boss_events')).rows[0].raid_run_id,run);
 await as(alex);data=await action('snapshot');assert.equal(data.reward.xp,125);assert.equal(data.reward.coins,60);
 data=await action('claim',{rewardId:'voucher',claimId:'claim-1'});assert.equal(data.inventory.length,1);assert.equal(data.inventory[0].quantity,1);assert.equal(data.boss.status,'ended','Last stock closes the loot window');
 data=await action('claim',{rewardId:'voucher',claimId:'claim-1'});assert.equal(data.inventory[0].quantity,1,'Same receipt cannot add inventory twice');
 await as(bea);await assert.rejects(()=>action('claim',{rewardId:'voucher',claimId:'claim-1'}),/another reward/);await assert.rejects(()=>action('claim',{rewardId:'voucher',claimId:'claim-2'}),/closed/);
 await as(teacher);data=await action('activate');const oldRun=run;run=data.boss.raid_run_id;assert.notEqual(run,oldRun);assert.equal(data.participants.length,0);assert.equal(data.claims.length,0);assert.equal((await db.query('select quantity from inventory')).rows[0].quantity,1,'New runs keep earned inventory');
 await as(alex);await assert.rejects(()=>action('join',{runId:oldRun}),/restarted/);await action('join');
 await db.query(`update boss_events set combat_settings='{"damagePerAnswer":150,"critChance":0,"questionCooldown":30}',xp_reward=0,coin_reward=0,participation_reward=0,victory_reward=0 where id=$1`,[boss]);
 await action('answer',{questionIdx:0,choice:0});await assert.rejects(()=>action('answer',{questionIdx:1,choice:0}),/cooldown/);await db.exec("update boss_participants set last_answer_at=now()-interval '1 minute'");data=await action('answer',{questionIdx:1,choice:0});assert.equal(data.reward.xp,0);assert.equal(data.reward.coins,0);assert.deepEqual(await balances(),paid,'Explicit zero rewards stay zero');
 await db.exec("update boss_events set loot_started_at=now()-interval '1 hour'");await assert.rejects(()=>action('claim',{rewardId:'voucher',claimId:'expired'}),/closed/);data=await action('snapshot');assert.equal(data.boss.status,'ended');
 await as(null);await assert.rejects(()=>action('snapshot'),/Sign in/);
 await as(alex);await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from boss_answer_receipts'),/permission denied/);await assert.rejects(()=>db.query('select * from boss_victory_rewards'),/permission denied/);await db.exec('reset role');
 await db.exec('begin');await db.query('delete from boss_events where id=$1',[boss]);assert.equal(Number((await db.query('select count(*) total from boss_answer_receipts')).rows[0].total),0);assert.equal(Number((await db.query('select count(*) total from boss_victory_rewards')).rows[0].total),0);await db.exec('rollback');
 console.log('PASS ['+idType+' boss IDs]: native foreign keys; preserved IDs and reward history on reinstall; unambiguous RPC grants; enum-backed status regression and repeatable installed-function repair; repeatable World Boss migration; section/staff access; join; correct/wrong/replayed answers; zero crit; shared HP; cooldown; per-run exactly-once rewards; atomic stock and inventory; claim retries; expiry; restart and stale run rejection; zero rewards; private receipts.');
}finally{await db.close();}}
(async()=>{for(const idType of ['uuid','text'])await runSchema(idType);})().catch(e=>{console.error(e);process.exit(1)});
