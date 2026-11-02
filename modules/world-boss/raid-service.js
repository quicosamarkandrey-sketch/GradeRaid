/* World Boss account boundary. Confirmed snapshots only; no optimistic money,
   inventory, damage or claim writes. Older events keep their existing RPC path. */
;(function(){
 'use strict';
 const queues=new Map(),pending=new Map(),signals=new Set(),legacyUntil=new Map();
 const userId=()=>typeof currentUser==='undefined'?null:currentUser?.id;
 const managed=b=>!!(b?._id&&b.raidVersion>=1);
 function visible(b){
  if(typeof currentRole==='undefined'||!userId())return false;
  if(currentRole==='student')return (b.classId||'default-class')===(currentUser.classId||'default-class');
  if(currentRole==='admin')return true;
  const sections=AppStore.getSlice(s=>s.classSections||[]);
  return sections.some(s=>s.id===b.classId&&s.adviserId===userId());
 }
 function expired(b){return !!b.endDate&&String(b.endDate).slice(0,10)<new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
 function apply(data,identity){
  if(userId()!==identity||data?.viewerId!==identity||!data.ok)return false;
  const uuid=data.boss?.id||data.bossId;if(!uuid)return false;
  const index=(AppStore.getSlice(s=>s.bossEvents)||[]).findIndex(b=>b._id===uuid);if(index<0)return false;
  const previous=AppStore.getBossEvent(index);
  AppStore.updateState(d=>{
   if(data.deleted){d.bossEvents[index]={...d.bossEvents[index],status:'deleted'};delete d.bossParticipants?.[index];return;}
   const mapped=_deriveBossEvents([data.boss],data.claims||[]).bossEventsArr[0];
   d.bossEvents[index]={...d.bossEvents[index],...mapped,raidVersion:data.boss.raid_version||mapped.raidVersion||0,raidRunId:data.boss.raid_run_id||mapped.raidRunId,_raidReward:data.reward||null};
   if(data.serverNow!=null&&Number.isFinite(Number(data.serverNow)))d.bossEvents[index]._raidClockOffset=Number(data.serverNow)-Date.now();
   if(previous.raidRunId!==d.bossEvents[index].raidRunId){d.bossEvents[index].activeMinions=[];d.bossEvents[index].raidFeed=[];delete d.bossEvents[index]._victoryRewardedAt;}
   if(!d.bossParticipants)d.bossParticipants={};
   const roster=_deriveBossParticipants(data.participants||[],{[uuid]:index})[index]||{};
   // Keep device-only narration state; authoritative scores and question index win.
   for(const [sid,record] of Object.entries(roster))roster[sid]={...d.bossParticipants[index]?.[sid],...record};
   d.bossParticipants[index]=roster;
   if(data.wallet){const student=(d.students||[]).find(s=>s.id===identity);if(student)Object.assign(student,data.wallet);}
   if(data.inventory){if(!d.inventory)d.inventory={};d.inventory[identity]=_deriveInventory(data.inventory)[identity]||[];}
  },{type:data.boss?.current_hp===0&&previous.currentHp>0?'world-boss:defeated':'world-boss:server-synced',payload:{bossIdx:index,studentId:identity,damage:data.outcome?.damage||0}});
  if(data.outcome?.damage&&data.boss?.current_hp>0)AppStore.emit({type:'world-boss:damage-applied',payload:{bossIdx:index,studentId:identity,damage:data.outcome.damage}});
  if(currentUser?.id===identity){const student=AppStore.getStudent(identity);if(student)Object.assign(currentUser,student);}
  if(currentRole==='student'&&window.WBR?.bossIdx===index&&data.boss?.status==='active'&&WBR.phase==='battle'){
   for(const signal of (data.boss?.raid_signals||[]).slice().reverse()){
    const key=[identity,data.boss.raid_run_id,signal.id].join(':');
    if(signals.has(key)||Date.now()-Number(signal.at)>15000)continue;
    signals.add(key);if(signals.size>200)signals.delete(signals.values().next().value);
    if(signal.kind==='minion')wbmSpawnMinion(index);
    if(signal.kind==='skill')wbsFireSkill(index,signal.skillId);
   }
  }
  return true;
 }
 function action(index,kind,payload={}){
  const boss=AppStore.getBossEvent(index),identity=userId();if(!boss?._id||(!managed(boss)&&kind!=='snapshot')||!visible(boss))return Promise.resolve({ok:false,reason:'This raid is unavailable.'});
  const key=[identity,boss._id,kind,payload.questionIdx??'',payload.rewardId??'',payload.studentId??payload.skillId??payload.kind??''].join(':');
  if(pending.has(key))return pending.get(key);
  const uuid=boss._id,body={runId:boss.raidRunId,...payload};
  const request=(queues.get(uuid)||Promise.resolve()).catch(()=>{}).then(async()=>{
   if(userId()!==identity)return {ok:false,reason:'Account changed.'};
   let timeout;try{
    const result=await Promise.race([DBService.rpc('world_boss_action',{p_boss_id:uuid,p_action:kind,p_payload:body}),new Promise(resolve=>{timeout=setTimeout(()=>resolve({error:{message:'Connection interrupted. Retry to confirm the result.'}}),12000);})]);
    if(result.error)return {ok:false,code:result.error.code,reason:result.error.message||'Could not connect. Please retry.'};
    if(!apply(result.data,identity))return {ok:false,reason:'The raid changed. Reopen it to continue.'};
    return result.data;
   }catch(error){return {ok:false,reason:error.message||'Could not connect. Please retry.'};}finally{clearTimeout(timeout);}
  });
  queues.set(uuid,request);pending.set(key,request);
  request.finally(()=>{if(queues.get(uuid)===request)queues.delete(uuid);if(pending.get(key)===request)pending.delete(key);});
  return request;
 }
 async function prepare(index){
  const boss=AppStore.getBossEvent(index);if(!boss?._id||!visible(boss))return {ok:false,reason:'This raid is unavailable.'};
  if(managed(boss)&&boss.raidRunId)return {ok:true,mode:'managed'};
  const key=[userId(),boss._id].join(':');
  if((legacyUntil.get(key)||0)>Date.now())return {ok:true,mode:'legacy'};
  // Read-only negotiation: old cache data must not choose a legacy damage RPC
  // after the database has been upgraded. Never fall back on network/auth errors.
  const result=await action(index,'snapshot');
  if(result.ok)return {ok:true,mode:'managed'};
  if(['PGRST202','42883'].includes(result.code)){legacyUntil.set(key,Date.now()+15000);return {ok:true,mode:'legacy'};}
  return result;
 }
 window.RaidService=Object.freeze({managed,visible,expired,action,prepare});
})();
