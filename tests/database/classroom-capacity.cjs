/* Representative-client model with actual PostgreSQL packets. Output excludes
 * media, HTTP/WebSocket headers and connection messages; not a billing forecast. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{const {db,users,boss}=await require('../helpers/raid-ultimate-db.cjs')();try{
 for(const file of ['phase84_egress_optimization.sql','phase85_classroom_bandwidth.sql']){const sql=fs.readFileSync('supabase/'+file,'utf8');await db.exec(sql);await db.exec(sql);}
 const old=fs.readFileSync('supabase/phase84_egress_optimization.sql','utf8');await db.exec(old.slice(old.indexOf('create or replace function public.egress_pack('),old.indexOf('revoke all on function public.egress_pack')).replace('public.egress_pack(', 'public.egress_pack_baseline('));
 await db.query('update boss_events set boss_questions=$1,max_hp=10000000,current_hp=10000000 where id=$2',[JSON.stringify(Array.from({length:400},(_,i)=>({q:'Question '+(i+1)+': choose the correct response.',opts:['Work together','Give up','Ignore it','Guess blindly'],answer:0}))),boss]);
 const c={window:{},TextEncoder};vm.runInNewContext(fs.readFileSync('repository/egress-transport.js','utf8'),c);const reports=[];
 for(const students of [10,30,50]){
  await db.exec('delete from boss_participants');await db.query('update boss_events set current_hp=10000000-$1 where id=$2',[students*12000,boss]);const ids=[users.alex,...Array.from({length:students-1},(_,i)=>'55555555-5555-4555-8555-'+String(i+1).padStart(12,'0'))];
  const histories=ids.map(()=>Array.from({length:80},(_,q)=>({questionIdx:q,correct:true,damage:150,isCrit:q%10===0,correctAnswer:0,choice:0,cooldown:0})));
  for(let i=0;i<students;i++){await db.query("insert into profiles(id,display_name,role,class_id) values($1,$2,'student','science') on conflict(id) do nothing",[ids[i],'Raider '+i]);await db.query("insert into boss_participants(boss_id,class_id,student_id,total_damage,last_question_idx,answer_history,hp,max_hp,boss_intro_seen) values($1,'science',$2,12000,80,$3,3,3,true)",[boss,ids[i],JSON.stringify(histories[i])]);}
  await db.query("select set_config('app.uid',$1,false)",[users.alex]);const state84={parts:new Map(),hashes:{}},state85={parts:new Map(),hashes:{}};
  const pack=async(raw,state)=>{const wire=(await db.query('select '+(state===state84?'egress_pack_baseline':'egress_pack')+'($1,$2) data',[JSON.stringify(raw),JSON.stringify({v:state===state84?1:2,hashes:state.hashes})])).rows[0].data;c.window.EgressTransport.decode(wire,state);return Buffer.byteLength(JSON.stringify(wire));};
  const raw=async()=>((await db.query('select world_boss_action($1,$2,$3) data',[boss,'snapshot','{"inBattle":true}'])).rows[0].data);
  const trim=async data=>({...data,participants:(await db.query('select egress_peer_roster($1,$2) rows',[JSON.stringify(data.participants),users.alex])).rows[0].rows});
  let data=await raw(),slim=await trim(data);assert.equal(slim.participants.find(r=>r.student_id===users.alex).answer_history.length,80);assert.ok(slim.participants.filter(r=>r.student_id!==users.alex).every(r=>r.answer_history.length===8&&r.answer_history_offset===72));assert.ok(slim.participants.every(r=>!('raid_seen_at'in r)));
  const cold84=await pack(data,state84),cold85=await pack(slim,state85);let active84=0,active85=0,idle84=0;const samples=12;
  for(let batch=0;batch<samples;batch++){
   for(let j=0;j<Math.min(5,students);j++){const i=(batch*5+j)%students,q=histories[i].length;histories[i].push({questionIdx:q,correct:true,damage:150,isCrit:q%10===0,correctAnswer:0,choice:0,cooldown:0});await db.query('update boss_participants set answer_history=$1,total_damage=total_damage+150,last_question_idx=last_question_idx+1 where boss_id=$2 and student_id=$3',[JSON.stringify(histories[i]),boss,ids[i]]);}
   await db.query('update boss_events set current_hp=current_hp-$1 where id=$2',[Math.min(5,students)*150,boss]);data=await raw();slim=await trim(data);active84+=await pack(data,state84);active85+=await pack(slim,state85);idle84+=await pack({...data,serverNow:data.serverNow+1000},state84);
  }
  assert.ok(active85<active84*.65,'Active traffic falls without changing totals or own review');const report={students,coldBytesPerClientBefore:cold84,coldBytesPerClientAfter:cold85,sampleActiveBytesBefore:active84,sampleActiveBytesAfter:active85,activeReductionPercent:Math.round((1-active85/active84)*100),modeled20MinuteClassDataMB:Math.round((cold85+(active85/samples)*600)*students/1e6),modeled20MinutePreviousDataMB:Math.round((cold84+((active84+idle84)/samples)*600)*students/1e6),assumptions:'400-question bank; 5 answers batched every 2 seconds; 80 prior answers each; representative viewer; excludes media and Realtime/header bytes'};reports.push(report);console.log(JSON.stringify(report));
 }
 fs.writeFileSync('/tmp/classroom-capacity-results.json',JSON.stringify(reports,null,2)+'\n');
 console.log('PASS: real PostgreSQL 10/30/50-participant active packet comparison; own full review preserved; peer tail bounded; totals unchanged.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});
