/* Actual PostgreSQL + production transport: byte savings, authorization,
 * mutable fields/deletions, cold reconnects and text/UUID compatibility. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const migration=fs.readFileSync('supabase/phase84_egress_optimization.sql','utf8')+fs.readFileSync('supabase/phase85_classroom_bandwidth.sql','utf8');
const source=fs.readFileSync('repository/egress-transport.js','utf8');
function transport(db,uid){
 const sandbox={window:{},TextEncoder,currentUser:{id:uid}};vm.runInNewContext(source,sandbox);
 const packets=[];const client={rpc:async(name,args={})=>{
  const keys=Object.keys(args);try{await db.query("select set_config('app.uid',$1,false)",[sandbox.currentUser.id]);
   const data=(await db.query(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) data`,keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]))).rows[0].data;
   packets.push({name,bytes:Buffer.byteLength(JSON.stringify(data)),data});return {data,error:null};
  }catch(error){return {data:null,error:{code:error.code,message:error.message}};}
 }};
 return {api:sandbox.window.EgressTransport,client,packets,sandbox};
}
(async()=>{
 for(const type of ['text','uuid']){
  const {db,users,boss}=await require('../helpers/raid-ultimate-db.cjs')(type);
  try{
   await db.exec(migration);await db.exec(migration);
   await db.exec("alter table boss_events add column if not exists visual_profile jsonb;update boss_events set visual_profile=jsonb_build_object('art',repeat('x',100000))");
   const {api,client,packets}=transport(db,users.alex),call=(action,p={})=>api.rpc(client,'world_boss_action',{p_boss_id:boss,p_action:action,p_payload:{inBattle:true,...p}});
   let first=await call('snapshot');assert.equal(first.error,null);assert.equal(first.data.boss.id,boss);
   const second=await call('snapshot');assert.equal(second.error,null);assert.equal(second.data.boss.visual_profile.art.length,100000);assert.ok(packets.at(-1).bytes<800,'Unchanged snapshot is tiny');
   const warmStart=packets.length;for(let n=0;n<12;n++)await call('snapshot');const warmBytes=packets.slice(warmStart).reduce((sum,r)=>sum+r.bytes,0);assert.ok(warmBytes<12*JSON.stringify(first.data).length*.02);console.log(type+' warm snapshot bytes: '+warmBytes+' vs full '+(12*JSON.stringify(first.data).length));
   const run=first.data.boss.raid_run_id;
   const answer=await call('answer',{runId:run,questionIdx:0,choice:0});assert.equal(answer.error,null);assert.ok(answer.data.outcome.damage>0);assert.equal(answer.data.participants.find(p=>p.student_id===users.alex).last_question_idx,1);assert.ok(packets.at(-1).bytes<5000,'An attack does not resend question bank/art');
   const bad=transport(db,users.other);const denied=await bad.api.rpc(bad.client,'world_boss_action',{p_boss_id:boss,p_action:'snapshot',p_payload:{}});assert.equal(denied.error.code,'42501');
   await db.query('delete from boss_participants where student_id=$1',[users.bea]);const removal=await call('snapshot');assert.equal(removal.data.participants.length,1,'Deleted array members disappear');
   await db.query("update profiles set display_name='Foreign private name' where id=$1",[users.other]);
   await db.exec('set role anon');await assert.rejects(db.query('select world_boss_delta($1,$2,$3)',[boss,'snapshot','{}']),/permission denied/);await db.exec('reset role');
   // Invoker reads preserve RLS; hashes are never an authorization token.
   await db.exec("grant usage on schema auth to authenticated;alter table profiles enable row level security;grant select on profiles to authenticated;create policy own_profile on profiles for select to authenticated using(id=auth.uid()::text)");
   await db.query("select set_config('app.uid',$1,false)",[users.alex]);await db.exec('set role authenticated');
   const table=await api.table(client,'profiles');assert.equal(table.error,null);assert.deepEqual(Array.from(table.data,r=>r.id),[users.alex]);
   const again=await api.table(client,'profiles');assert.equal(again.data.length,1);assert.ok(packets.at(-1).bytes<150);
   const invalid=await client.rpc('egress_table_snapshot',{p_table:'pg_authid'});assert.equal(invalid.error.code,'42501');
   const notices=(await db.query('select * from sync_invalidations')).rows;assert.ok(notices.every(n=>n.class_id!=='foreign'));assert.ok(notices.every(n=>!('profile_pic_url'in n)));
   await db.exec('reset role');
   // Cold reconnect/account reset receives complete data again.
   api.clear();const cold=await call('snapshot');assert.equal(cold.data.boss.visual_profile.art.length,100000);assert.ok(packets.at(-1).bytes>100000);
   console.log(type+': '+JSON.stringify(api.diagnostics()));
  }finally{await db.close();}
 }
 {
  const {db,rpc}=await require('../helpers/recitation-db.cjs').setup();try{
   await db.exec(migration);await db.query("update profiles set profile_pic_url='data:image/png;base64,'||repeat('A',40000) where id='alex'");const initial=await rpc('start');await rpc('claim');
   const {api,client,packets}=transport(db,'00000000-0000-4000-8000-000000000001'),call=(a,p={})=>api.rpc(client,'recitation_presentation',{p_class_id:'room-a',p_action:a,p_device:'teacher-phone-12345678901234567890',p_payload:{session:initial.session.id,...p}});
   let s=await call('snapshot');assert.equal(s.error,null);s=await call('snapshot');assert.ok(packets.at(-1).bytes<800);
   s=await call('manual',{id:crypto.randomUUID(),student:'alex',points:2,question:0});assert.equal(s.error,null);assert.equal(s.data.roster.find(r=>r.id==='alex').session,2);assert.equal(s.data.roster.find(r=>r.id==='alex').photo.length,40022);assert.ok(packets.at(-1).bytes<4500);
   const receipt=s.data.receipt.id;s=await call('undo',{id:receipt});assert.equal(s.error,null);assert.equal(s.data.roster.find(r=>r.id==='alex').session,0);assert.equal(s.data.receipts[0].undone,true);
   await db.query("update profiles set profile_pic_url=null where id='alex'");s=await call('snapshot');assert.equal(s.data.roster.find(r=>r.id==='alex').photo,null);
   console.log('recitation: '+JSON.stringify(api.diagnostics()));
  }finally{await db.close();}
 }
 {
  const {db}=await require('../helpers/attendance-station-db.cjs')();try{
   await db.exec(migration);await db.query("update profiles set profile_pic_url='data:image/png;base64,'||repeat('A',40000) where id='alex'");const {api,client,packets}=transport(db,'00000000-0000-4000-8000-000000000001'),call=(a,p={})=>api.rpc(client,'attendance_station',{p_class_id:'room-a',p_action:a,p_payload:p});
   let s=await call('snapshot');assert.equal(s.error,null);s=await call('snapshot');assert.ok(packets.at(-1).bytes<800);
   const id=crypto.randomUUID();s=await call('scan',{id,tag:'1001',capturedAt:new Date().toISOString()});assert.equal(s.error,null);assert.equal(s.data.ok,true);const retry=await call('scan',{id,tag:'1001',capturedAt:new Date().toISOString()});assert.equal(retry.data.duplicate,true);
   s=await call('snapshot');assert.equal(s.data.logs.length,1);assert.equal(s.data.roster.length,3);s=await call('snapshot');assert.ok(packets.at(-1).bytes<800);
   console.log('attendance: '+JSON.stringify(api.diagnostics()));
  }finally{await db.close();}
 }
 console.log('PASS: compact snapshots, changed fields, unchanged photos/art/questions, confirmed answers/manual awards/undo/scans, deletions, text/UUID, idempotent migration, account reset, invoker RLS and denied foreign/anonymous access.');
})().catch(e=>{console.error(e);process.exit(1);});
