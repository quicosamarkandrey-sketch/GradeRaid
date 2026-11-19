'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('bounded peer history preserves named critical hits, full own review and exact aggregate recovery',async()=>{
 const own='alex',peer='bea',uuid='boss',run='run',events=[];
 const history=n=>Array.from({length:n},(_,i)=>({questionIdx:i,correct:true,damage:150,isCrit:i%10===0}));
 const rawBoss={id:uuid,class_id:'science',status:'active',raid_version:1,raid_run_id:run,max_hp:100000,current_hp:100000,end_date:'2099-01-01',boss_questions:[]};
 const row=(id,n)=>({boss_id:uuid,student_id:id,class_id:'science',student_name:id==='bea'?'Bea Santos':'Alex Rivera',student_init:'AR',answer_history:history(n),last_question_idx:n,total_damage:n*150,hp:3,max_hp:3});
 let data={ok:true,viewerId:own,boss:rawBoss,participants:[row(own,80),row(peer,80)],claims:[],inventory:[]},state;
 const c=vm.createContext({console,Date,Intl,setTimeout,clearTimeout,currentUser:{id:own,classId:'science'},currentRole:'student'});c.window=c;
 c.AppStore={getSlice:fn=>fn(state),getBossEvent:i=>state.bossEvents[i],getStudent:id=>state.students.find(s=>s.id===id),updateState:fn=>{state=JSON.parse(JSON.stringify(state));fn(state);},emit:e=>events.push(e)};c.DBService={rpc:async()=>({data})};
 vm.runInContext(fs.readFileSync('repository/pull-mappers.js','utf8'),c);
 state={students:[{id:own}],bossEvents:c._deriveBossEvents([rawBoss],[]).bossEventsArr,bossParticipants:c._deriveBossParticipants(data.participants,{[uuid]:0}),inventory:{}};
 vm.runInContext(fs.readFileSync('modules/world-boss/raid-service.js','utf8'),c);c.RaidService.watch(0);
 data={...data,boss:{...rawBoss,current_hp:99850},participants:[row(own,80),{...row(peer,81),answer_history:history(81).slice(-8),answer_history_offset:73}]};
 assert.equal((await c.RaidService.action(0,'snapshot')).ok,true);const first=events.find(e=>e.type==='world-boss:raid-hits').payload.hits;assert.equal(first.length,1);assert.equal(first[0].name,'Bea Santos');assert.equal(first[0].damage,150);assert.equal(first[0].crit,true);assert.equal(first[0].aggregate,false);assert.equal(state.bossParticipants[0][own].answerHistory.length,80);
 const before=events.filter(e=>e.type==='world-boss:raid-hits').length;await c.RaidService.action(0,'snapshot');assert.equal(events.filter(e=>e.type==='world-boss:raid-hits').length,before);
 data={...data,participants:[row(own,80),{...row(peer,100),answer_history:history(100).slice(-8),answer_history_offset:92}]};await c.RaidService.action(0,'snapshot');const recovered=events.filter(e=>e.type==='world-boss:raid-hits').at(-1).payload.hits;assert.equal(recovered.length,1);assert.equal(recovered[0].damage,19*150);assert.equal(recovered[0].aggregate,true);assert.equal(state.bossParticipants[0][peer].lastQIdx,100);
});
