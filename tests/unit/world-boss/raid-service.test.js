const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(rpc){const events=[];const state={bossEvents:[{_id:'boss',raidVersion:1,raidRunId:'run',classId:'a',status:'active',currentHp:300,maxHp:300}],bossParticipants:{0:{}},students:[{id:'s',classId:'a',coins:20,xp:10}],inventory:{s:[]}},c={setTimeout,clearTimeout,Intl,Date,console,currentRole:'student',currentUser:{id:'s',classId:'a'},DBService:{rpc},AppStore:{getSlice:f=>structuredClone(f(state)),getBossEvent:i=>structuredClone(state.bossEvents[i]),getStudent:id=>structuredClone(state.students.find(s=>s.id===id)),updateState:f=>f(state),emit:e=>events.push(e)}};c.window=c;vm.runInNewContext(fs.readFileSync('repository/pull-mappers.js','utf8'),c);vm.runInNewContext(fs.readFileSync('modules/world-boss/raid-service.js','utf8'),c);return {c,state,events};}
const receipt=()=>({data:{ok:true,viewerId:'s',boss:{id:'boss',class_id:'a',raid_version:1,raid_run_id:'run',current_hp:0,max_hp:300,status:'loot'},participants:[{boss_id:'boss',student_id:'s',class_id:'a',total_damage:300,correct_answers:2,last_question_idx:2}],claims:[],wallet:{id:'s',xp:110,coins:70},inventory:[{student_id:'s',item_id:'loot_a',quantity:1}],outcome:{damage:150}}});
test('raid requests coalesce duplicate actions and apply only the confirmed server scores, wallet and inventory',async()=>{let finish,calls=0;const {c,state}=setup(()=>{calls++;return new Promise(r=>finish=r);});const first=c.RaidService.action(0,'answer',{questionIdx:0,choice:0}),again=c.RaidService.action(0,'answer',{questionIdx:0,choice:0});assert.equal(first,again);await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);assert.equal(state.bossEvents[0].currentHp,300);assert.equal(state.students[0].coins,20);finish(receipt());assert.equal((await first).ok,true);assert.equal(state.bossEvents[0].currentHp,0);assert.equal(state.bossParticipants[0].s.lastQIdx,2);assert.equal(state.students[0].coins,70);assert.equal(state.inventory.s[0].quantity,1);});
test('late responses from a signed-out identity cannot alter the next account',async()=>{let finish;const {c,state}=setup(()=>new Promise(r=>finish=r));const before=JSON.stringify(state),request=c.RaidService.action(0,'snapshot');await new Promise(r=>setTimeout(r,0));c.currentUser={id:'other',classId:'a'};finish(receipt());assert.equal((await request).ok,false);assert.equal(JSON.stringify(state),before);});
test('rejected server requests create no local damage, money, inventory or unlock writes',async()=>{const {c,state}=setup(async()=>({error:{message:'Connection lost'}})),before=JSON.stringify(state);assert.equal((await c.RaidService.action(0,'claim',{rewardId:'a',claimId:'same-retry-id'})).ok,false);assert.equal(JSON.stringify(state),before);});
test('student raid discovery stays in its own section and rejects foreign actions before contacting the server',async()=>{let calls=0;const {c,state}=setup(async()=>{calls++;return receipt();});state.bossEvents[0].classId='b';assert.equal(c.RaidService.visible(state.bossEvents[0]),false);assert.equal((await c.RaidService.action(0,'join')).ok,false);assert.equal(calls,0);});

test('an event cached before phase75 discovers the installed answer API before submitting attacks',async()=>{
 const calls=[],{c,state}=setup(async(name,args)=>{calls.push(args.p_action);return receipt();});state.bossEvents[0].raidVersion=0;delete state.bossEvents[0].raidRunId;
 const ready=await c.RaidService.prepare(0);assert.equal(ready.mode,'managed');assert.equal(c.RaidService.managed(state.bossEvents[0]),true);assert.equal(state.bossEvents[0].raidRunId,'run');assert.deepEqual(calls,['snapshot']);
});
test('protocol discovery never downgrades to local answers on authorization or connection errors',async()=>{
 for(const error of [{code:'42501',message:'Not authorized'},{message:'Failed to fetch'}]){const {c,state}=setup(async()=>({error}));state.bossEvents[0].raidVersion=0;const before=JSON.stringify(state),ready=await c.RaidService.prepare(0);assert.equal(ready.ok,false);assert.equal(JSON.stringify(state),before);}
});
test('legacy compatibility is used only when the new RPC actually does not exist',async()=>{
 const {c,state}=setup(async()=>({error:{code:'PGRST202',message:'Function missing'}}));state.bossEvents[0].raidVersion=0;const ready=await c.RaidService.prepare(0);assert.equal(ready.ok,true);assert.equal(ready.mode,'legacy');assert.equal(state.bossEvents[0].currentHp,300);
});

test('confirmed class hits retain each answer, ignore duplicate snapshots and survive background roster pulls',async()=>{
 let result=receipt();result.data.boss.current_hp=100;result.data.boss.status='active';
 const histories=[{questionIdx:0,correct:true,damage:50,isCrit:false},{questionIdx:1,correct:true,damage:100,isCrit:true}];
 result.data.participants=[{boss_id:'boss',student_id:'peer',student_name:'Bea',total_damage:150,last_question_idx:2,answer_history:histories}];
 const {c,state,events}=setup(async()=>result);c.RaidService.watch(0);
 // A realtime pull may run ahead of the explicit snapshot.
 state.bossParticipants[0].peer={studentId:'peer',totalDamage:150,lastQIdx:2,answerHistory:histories};
 await c.RaidService.action(0,'snapshot');
 assert.equal(state.bossEvents[0].damageFeed.length,2);
 assert.deepEqual(Array.from(state.bossEvents[0].damageFeed,h=>h.damage),[100,50]);
 assert.equal(events.filter(e=>e.type==='world-boss:raid-hits').length,1);
 await c.RaidService.action(0,'snapshot');
 assert.equal(state.bossEvents[0].damageFeed.length,2);
 assert.equal(events.filter(e=>e.type==='world-boss:raid-hits').length,1);
 result.data.boss.raid_run_id='new-run';result.data.participants=[];
 await c.RaidService.action(0,'snapshot');assert.equal(state.bossEvents[0].damageFeed.length,0);
});
test('old clients without per-answer receipts label confirmed total changes as aggregate updates',async()=>{
 const result=receipt();result.data.boss.current_hp=50;result.data.boss.status='active';
 result.data.participants=[{boss_id:'boss',student_id:'peer',student_name:'Bea',total_damage:80,last_question_idx:1}];
 const {c,state}=setup(async()=>result);c.RaidService.watch(0);await c.RaidService.action(0,'snapshot');
 assert.equal(state.bossEvents[0].damageFeed[0].damage,80);assert.equal(state.bossEvents[0].damageFeed[0].aggregate,true);
});

test('explicit battlefield departure is not coalesced into an in-flight presence snapshot',async()=>{
 const payloads=[],{c}=setup(async(name,args)=>{payloads.push(args.p_payload.inBattle);return receipt();});c.WBR={bossIdx:0,phase:'battle'};
 const present=c.RaidService.action(0,'snapshot'),leaving=c.RaidService.action(0,'snapshot',{inBattle:false});
 assert.notEqual(present,leaving);await Promise.all([present,leaving]);assert.deepEqual(payloads,[true,false]);
});

test('Cataclysm personal damage uses confirmed HP loss once and survives background roster replacement',async()=>{
 const result=receipt();result.data.boss.current_hp=100;result.data.boss.status='active';result.data.boss.raid_ultimate={id:'solar-cast',phase:'eruption'};
 result.data.participants=[{boss_id:'boss',student_id:'s',hp:2,max_hp:3,total_damage:0,last_question_idx:0}];
 const {c,state,events}=setup(async()=>result);state.bossParticipants[0].s={studentId:'s',hp:3,maxHp:3};state.bossEvents[0].raidUltimate={id:'solar-cast',phase:'casting'};c.RaidService.watch(0);
 state.bossParticipants[0].s.hp=2; // An earlier realtime pull must not eat the feedback.
 await c.RaidService.action(0,'snapshot');let hits=events.filter(e=>e.type==='world-boss:player-hit');assert.equal(hits.length,1);assert.equal(hits[0].payload.damage,1);assert.equal(hits[0].payload.after,2);
 await c.RaidService.action(0,'snapshot');assert.equal(events.filter(e=>e.type==='world-boss:player-hit').length,1);
 result.data.participants[0].hp=1;await c.RaidService.action(0,'snapshot');assert.equal(events.filter(e=>e.type==='world-boss:player-hit').length,1,'Later unrelated damage is not another Cataclysm hit');
});
test('Cataclysm damage feedback never invents a loss for an unharmed or late-arriving raider',async()=>{
 const result=receipt();result.data.boss.current_hp=100;result.data.boss.status='active';result.data.boss.raid_ultimate={id:'old-solar',phase:'eruption'};result.data.participants=[{boss_id:'boss',student_id:'s',hp:3,max_hp:3}];
 const {c,state,events}=setup(async()=>result);state.bossParticipants[0].s={hp:3,maxHp:3};c.RaidService.watch(0);await c.RaidService.action(0,'snapshot');assert.equal(events.filter(e=>e.type==='world-boss:player-hit').length,0);
});
