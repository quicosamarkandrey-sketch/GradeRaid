/* Durable per-card patches. Last change received wins for the same field;
   independent cards merge and retries never replay an older operation. */
;(function(){
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value));
 let context=null,timer=null;
 const account=()=>typeof currentUser==='undefined'?null:currentUser?.id;
 const active=c=>context===c&&account()===c.id&&(typeof currentRole!=='undefined'&&currentRole==='student');
 const key=id=>'eduquest-study-sync-v1-'+id;
 function store(c){try{localStorage.setItem(key(c.id),JSON.stringify(c.queue));c.durable=true;}catch{c.durable=false;}}
 function status(c,value){if(!active(c))return;c.status=value;c.onStatus(c.durable===false?'Kept in this tab — browser storage unavailable':value);}
 async function rpc(name,args){let timeout;try{return await Promise.race([DBService.rpc(name,args),new Promise(resolve=>{timeout=setTimeout(()=>resolve({error:{code:'NETWORK'}}),8000);})]);}catch(error){return {error};}finally{clearTimeout(timeout);}}
 function enqueue(c,quizId,signature,patch,front=false){
  const op={id:crypto.randomUUID(),quizId,signature,patch};front?c.queue.unshift(op):c.queue.push(op);store(c);
 }
 function indices(map){return Object.keys(map||{}).filter(i=>map[i]===true).map(Number);}
 function overlay(memory,op){
  if(op.patch.saved!==undefined){memory.saved=memory.saved.filter(id=>id!==op.quizId);if(op.patch.saved)memory.saved.push(op.quizId);}
  const state=memory.sets[op.quizId];if(state?.signature!==op.signature)return;
  for(const field of ['known','starred'])if(op.patch[field]){const values=new Set(state[field]||[]);for(const [i,value]of Object.entries(op.patch[field]))value?values.add(Number(i)):values.delete(Number(i));state[field]=[...values];}
  if(op.patch.position!==undefined)state.position=op.patch.position;
  if(op.patch.opened)memory.lastSet=op.quizId;
 }
 function merge(c,remote){
  const memory=clone(c.getMemory());memory.saved=remote.sets.filter(s=>s.saved).map(s=>s.quizId);
  let latest=null;
  for(const set of remote.sets){
   const signature=c.getSignature(set.quizId);const version=set.versions.find(v=>v.signature===signature);
   if(version)memory.sets[set.quizId]={signature,known:indices(version.known),starred:indices(version.starred),position:version.position};
   if(set.lastOpenedAt&&(!latest||set.lastOpenedAt>latest.lastOpenedAt))latest=set;
  }
  if(latest)memory.lastSet=latest.quizId;
  for(const op of c.queue)overlay(memory,op);
  c.baseline=clone(memory);c.onMerge(memory);
 }
 function migrate(c,remote){
  // Existing local progress is imported only where no account version exists.
  // Place imports before queued edits so newer local unstars/unknown marks win.
  const imports=[];const local=c.initial;
  for(const [quizId,state]of Object.entries(local.sets||{})){
   const signature=state.signature&&c.getSignature(quizId,state.signature);if(!signature)continue;
   const row=remote.sets.find(s=>s.quizId===quizId),version=row?.versions.find(v=>v.signature===signature),patch={};
   if(!version){for(const field of ['known','starred'])if(state[field]?.length)patch[field]=Object.fromEntries(state[field].map(i=>[i,true]));if(state.position)patch.position=state.position;}
   if(!row&&local.saved.includes(quizId))patch.saved=true;
   if(!row&&local.lastSet===quizId)patch.opened=true;
   if(Object.keys(patch).length)imports.push({id:crypto.randomUUID(),quizId,signature,patch});
  }
  c.queue=[...imports,...c.queue];store(c);c.imported=true;
 }
 async function refresh(c){
  if(!active(c)||c.running)return;c.running=true;status(c,'Syncing study progress…');
  let skipped=0;
  try{
   const result=await rpc('study_progress_pull');if(!active(c))return;
   if(result.error){status(c,['PGRST202','42883'].includes(result.error.code)?'Saved on this device — account sync is not enabled yet':'Offline — changes saved on this device');return;}
   if(result.data?.studentId!==c.id||!Array.isArray(result.data.sets)){status(c,'Could not confirm account sync — saved on this device');return;}
   if(!c.imported)migrate(c,result.data);
   merge(c,result.data);
   while(c.queue.length&&active(c)){
    const op=c.queue[0];const reply=await rpc('study_progress_apply',{p_operation_id:op.id,p_quiz_id:op.quizId,p_signature:op.signature,p_patch:op.patch});if(!active(c))return;
    if(reply.error?.code==='42501'&&reply.error.message==='Study set unavailable'){c.queue=c.queue.filter(item=>item.id!==op.id);store(c);skipped++;continue;}
    if(reply.error){status(c,'Changes saved on this device — account sync needs a retry');return;}
    if(reply.data?.studentId!==c.id||!Array.isArray(reply.data.sets)){status(c,'Could not confirm account sync — saved on this device');return;}
    c.queue=c.queue.filter(item=>item.id!==op.id);store(c);merge(c,reply.data);
   }
   status(c,skipped?'Other study changes saved; some sets are no longer available':'Saved to your account');
  }finally{c.running=false;}
 }
 function schedule(c){clearTimeout(timer);timer=setTimeout(()=>refresh(c),600);}
 function connect(id,options){
  clearTimeout(timer);
  if(!id||typeof currentRole==='undefined'||currentRole!=='student'){context=null;return;}
  let queue=[];try{const parsed=JSON.parse(localStorage.getItem(key(id))||'[]');if(Array.isArray(parsed))queue=parsed.filter(op=>op.id&&op.quizId&&op.signature&&op.patch);}catch{}
  const memory=clone(options.getMemory());
  context={id,...options,baseline:memory,initial:clone(memory),queue,running:false,imported:false,durable:true};
  refresh(context);
 }
 function capture(memory){
  const c=context;if(!c||!active(c))return;const before=c.baseline;
  const ids=new Set([...Object.keys(memory.sets||{}),...(memory.saved||[]),...(before.saved||[])]);
  for(const quizId of ids){
   const state=memory.sets?.[quizId],old=before.sets?.[quizId];const signature=state?.signature||c.getSignature(quizId);if(!signature)continue;
   const patch={};const saved=memory.saved.includes(quizId);if(saved!==before.saved.includes(quizId))patch.saved=saved;
   if(state){for(const field of ['known','starred']){const a=new Set(state[field]||[]),b=new Set(old?.signature===signature?old[field]||[]:[]);const changes={};for(const i of new Set([...a,...b]))if(a.has(i)!==b.has(i))changes[i]=a.has(i);if(Object.keys(changes).length)patch[field]=changes;}
    if(old?.signature===signature?state.position!==old.position:state.position>0)patch.position=state.position||0;
   }
   if(Object.keys(patch).length)enqueue(c,quizId,signature,patch);
  }
  c.baseline=clone(memory);if(c.queue.length){status(c,'Changes saved on this device · Syncing…');schedule(c);}
 }
 function opened(quizId,signature){const c=context;if(!c||!active(c))return;enqueue(c,quizId,signature,{opened:true});status(c,'Changes saved on this device · Syncing…');schedule(c);}
 window.addEventListener('online',()=>{if(context)refresh(context);});
 window.addEventListener('focus',()=>{if(context)refresh(context);});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&context)refresh(context);});
 window.StudySync=Object.freeze({connect,capture,opened,refresh:()=>context?refresh(context):Promise.resolve()});
})();
