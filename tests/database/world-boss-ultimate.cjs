const fixture=require('../helpers/raid-ultimate-db.cjs'),assert=require('node:assert/strict');
(async()=>{for(const type of ['text','uuid']){const {db,rpc,boss}=await fixture(type);try{
 const state=async()=> (await rpc('alex','snapshot',{inBattle:true})).boss.raid_ultimate;
 await assert.rejects(()=>rpc('alex','ultimate'),/Teacher access/);await assert.rejects(()=>rpc('other','snapshot'),/another section/);
 let start=await rpc('teacher','ultimate');assert.equal(start.boss.raid_ultimate.target,2);assert.equal(start.boss.raid_ultimate.phase,'casting');
 await rpc('alex','answer',{questionIdx:0,choice:1,inBattle:true});assert.equal((await state()).progress,0);
 await rpc('alex','answer',{questionIdx:1,choice:0,inBattle:true});assert.equal((await state()).progress,1);
 await rpc('alex','answer',{questionIdx:1,choice:0,inBattle:true});assert.equal((await state()).progress,1,'Replays cannot contribute twice');
 const broken=await rpc('bea','answer',{questionIdx:0,choice:0,inBattle:true});assert.equal(broken.boss.raid_ultimate.phase,'interrupted');assert.equal(broken.boss.raid_ultimate.progress,2);assert.ok(broken.participants.every(p=>p.hp===3));
 await rpc('teacher','ultimate');await db.query("update boss_events set raid_ultimate=jsonb_set(raid_ultimate,'{deadline}',to_jsonb((extract(epoch from clock_timestamp())*1000-1000)::bigint)) where id=$1",[boss]);
 let failed=await rpc('alex','answer',{questionIdx:2,choice:0,inBattle:true});assert.equal(failed.outcome.correct,true);assert.equal(failed.boss.raid_ultimate.progress,0,'A correct answer arriving after the deadline cannot break the cast');assert.equal(failed.boss.raid_ultimate.phase,'eruption');assert.ok(failed.participants.every(p=>p.hp===2),'A failed cast damages every active raider');
 failed=await rpc('bea','snapshot',{inBattle:true});assert.ok(failed.participants.every(p=>p.hp===2),'Snapshot polling cannot apply damage twice');
 await db.query("update boss_events set raid_ultimate=jsonb_set(raid_ultimate,'{endsAt}',to_jsonb((extract(epoch from clock_timestamp())*1000-1)::bigint)) where id=$1",[boss]);assert.equal((await state()).phase,'recovered');
 await rpc('bea','snapshot',{inBattle:false});await rpc('teacher','ultimate');await db.query("update boss_participants set hp=1 where boss_id=$1 and student_id=$2",[boss,failed.viewerId]);
 await db.query("update boss_events set raid_ultimate=jsonb_set(raid_ultimate,'{deadline}',to_jsonb((extract(epoch from clock_timestamp())*1000-1000)::bigint)) where id=$1",[boss]);
 const once=await rpc('alex','snapshot',{inBattle:true});const bea=once.participants.find(p=>p.student_id===failed.viewerId);assert.equal(bea.hp,1,'A raider who explicitly leaves is not damaged');
 // A second failure can KO a low-health raider; server revival remains available.
 await db.query("update boss_events set raid_ultimate='{}' where id=$1",[boss]);await rpc('teacher','ultimate');
 await db.query("update boss_events set raid_ultimate=jsonb_set(raid_ultimate,'{deadline}',to_jsonb((extract(epoch from clock_timestamp())*1000-1)::bigint)) where id=$1",[boss]);
 const ko=await rpc('alex','snapshot',{inBattle:true}),alexId=ko.viewerId;const record=ko.participants.find(p=>p.student_id===alexId);assert.equal(record.hp,0);assert.equal(record.is_ko,true);assert.ok(record.revive_at);
 await assert.rejects(()=>rpc('alex','answer',{questionIdx:3,choice:0,inBattle:true}),/knocked|reviv|KO/i);
 await rpc('teacher','revive',{studentId:alexId});
 // Automatic casts are started once, by server time, with available answers.
 await db.query("update boss_events set raid_ultimate=jsonb_build_object('runId',raid_run_id,'phase','idle','nextAt',0),skills=jsonb_set(skills,'{cataclysm,automatic}','true') where id=$1",[boss]);
 assert.equal((await state()).phase,'casting');
 await db.query("update boss_events set raid_ultimate='{}' where id=$1",[boss]);await db.query('update boss_participants set last_question_idx=49 where boss_id=$1 and student_id=$2',[boss,alexId]);
 assert.equal((await rpc('teacher','ultimate')).boss.raid_ultimate.target,1,'A solo raider with one remaining answer has an achievable target');
 await db.query('update boss_participants set last_question_idx=3 where boss_id=$1 and student_id=$2',[boss,alexId]);
 await db.query("update boss_events set raid_ultimate='{}',current_hp=150 where id=$1",[boss]);await rpc('bea','snapshot',{inBattle:true});await rpc('teacher','ultimate');
 const win=await rpc('alex','answer',{questionIdx:3,choice:0,inBattle:true});assert.ok(['loot','ended'].includes(win.boss.status));assert.equal(win.boss.raid_ultimate.phase,'cancelled','Defeating the boss cancels its ultimate');
 const signature=`public.world_boss_ultimate_tick(${type},text,jsonb)`;assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') ok",[signature])).rows[0].ok,false);
 console.log('PASS ultimate '+type+': section/teacher checks, scalable target, wrong/replayed answers, shared interrupt, one-time class damage, departure, recovery, defeat cancellation, private helper and repeatable migration');
 }finally{await db.close();}}})().catch(e=>{console.error(e);process.exit(1)});
