const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),path=require('node:path');
module.exports=async function fixture(idType='text'){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 create table profiles(id text primary key,display_name text,role text,class_id text,is_active boolean default true,xp int default 0,coins int default 0,level int default 0,tier text default 'Novice');
 create function is_staff_for_section(cid text) returns boolean language sql as $$select exists(select 1 from profiles where id=auth.uid()::text and role in ('teacher','admin') and class_id=cid)$$;
 create type boss_status as enum ('draft','active','loot','ended');
 create table boss_events(id ${idType} primary key,class_id text,name text,status boss_status,max_hp int,current_hp int,start_date date,end_date date,xp_reward int,coin_reward int,participation_reward int,victory_reward int,boss_questions jsonb,combat_settings jsonb,loot_rewards jsonb,loot_duration_sec int,skills jsonb default '{}',minion_settings jsonb default '{}',defeated_at timestamptz,ended_at timestamptz,loot_started_at timestamptz,loot_finalized_at timestamptz);
 create table boss_participants(boss_id ${idType},class_id text,student_id text,total_damage int default 0,correct_answers int default 0,wrong_answers int default 0,crit_hits int default 0,minions_defeated int default 0,last_question_idx int default 0,joined_at timestamptz,primary key(boss_id,student_id));
 create table loot_claims(id text primary key,boss_id ${idType},class_id text,reward_id text,item_name text,rarity text,student_id text,student_name text,student_init text,student_color text,claimed_at timestamptz);
 create table inventory(student_id text,item_id text,item_name text,emoji text,category text,quantity int,date_purchased text,last_purchased text,source text,status text,primary key(student_id,item_id));`);

 await db.exec("alter table boss_events add column image text default './assets/bosses/phantom.svg';alter table boss_events add column skill_fire_mode text default 'manual';");
 const users={teacher:'11111111-1111-4111-8111-111111111111',alex:'22222222-2222-4222-8222-222222222222',bea:'33333333-3333-4333-8333-333333333333',other:'44444444-4444-4444-8444-444444444444'};
 const boss=idType==='text'?'cataclysm_text_boss':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const [key,id] of Object.entries(users))await db.query('insert into profiles(id,role,class_id,display_name,xp,coins) values($1,$2,$3,$4,0,0)',[id,key==='teacher'?'teacher':'student',key==='other'?'foreign':'science',key==='alex'?'Alex Rivera':key==='bea'?'Bea Santos':key]);
 for(const file of ['phase75_world_boss_reliability.sql','phase80_world_boss_ultimate.sql','phase80_world_boss_ultimate.sql'])await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase',file),'utf8'));
 const questions=Array.from({length:50},(_,i)=>({q:'Question '+(i+1)+': choose the correct response.',opts:['Work together','Give up','Ignore it','Guess blindly'],answer:0}));
 await db.query(`insert into boss_events(id,class_id,name,status,max_hp,current_hp,end_date,boss_questions,combat_settings,skills,minion_settings,loot_rewards) values($1,'science','The Cataclysm Warden','active',100000,100000,current_date+30,$2,$3,$4,'{}','[]')`,[boss,JSON.stringify(questions),JSON.stringify({damagePerAnswer:150,critChance:0,questionCooldown:0}),JSON.stringify({cataclysm:{enabled:true,automatic:false,castSec:18,durationSec:22,damage:1,cooldownSec:120}})]);
 let queue=Promise.resolve();
 function rpc(user,action,payload={}){const job=queue.catch(()=>{}).then(async()=>{await db.query("select set_config('app.uid',$1,false)",[users[user]||user]);const run=(await db.query('select raid_run_id from boss_events where id=$1',[boss])).rows[0].raid_run_id;const result=await db.query('select world_boss_action($1,$2,$3) data',[boss,action,JSON.stringify({runId:run,...payload})]);return result.rows[0].data;});queue=job;return job;}
 for(const user of ['alex','bea']){await rpc(user,'join');await rpc(user,'snapshot',{inBattle:true});}
 await db.exec('update boss_participants set boss_intro_seen=true');
 return {db,users,boss,rpc};
};
