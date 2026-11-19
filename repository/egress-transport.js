/* Account-scoped, in-memory conditional snapshots. Mutations always reach the server.
 * Wire byte counters estimate JSON payloads, not Supabase billing/compression. */
(function(){
 'use strict';
 const caches=new Map(),missing=new Set(),inflight=new Map();let epoch=0;
 const routes={world_boss_action:'world_boss_delta',recitation_presentation:'recitation_presentation_delta',attendance_station:'attendance_station_delta'};
 const stats={requests:0,wireBytes:0,fullBytes:0,compactResponses:0,legacyResponses:0};
 const clone=x=>JSON.parse(JSON.stringify(x));
 const bytes=x=>new TextEncoder().encode(JSON.stringify(x??null)).length;
 async function identity(client){if(client.auth?.getSession){const {data,error}=await client.auth.getSession();if(error)throw error;return data?.session?.user?.id||'anonymous';}return typeof currentUser==='undefined'?'anonymous':currentUser?.id||'anonymous';}
 function materialize(parts){
  const shape=parts.get('["$shape"]');if(!shape||typeof shape!=='object')throw new Error('Incomplete compact snapshot.');
  const result=Object.create(null);
  for(const [name,type] of Object.entries(shape)){
   if(type==='value')result[name]=parts.get(JSON.stringify([name]));
   else if(type==='object')result[name]=Object.create(null);
   else if(type==='rows')result[name]=new Map();
  }
  for(const [key,value] of parts){const path=JSON.parse(key),[name,row,field]=path;if(name==='$shape')continue;
   if(shape[name]==='object'&&path.length===2)result[name][row]=value;
   if(shape[name]==='rows'&&path.length===3){if(!result[name].has(row))result[name].set(row,Object.create(null));result[name].get(row)[field]=value;}
  }
  for(const [name,type] of Object.entries(shape))if(type==='rows')result[name]=(parts.get(JSON.stringify([name,'@order']))||[]).map(id=>result[name].get(id)||Object.create(null));
  return clone(result);
 }
 function decode(wire,state){
  if(wire?.__egress!==1)return wire;
  // Commit only after a complete, valid packet has been reconstructed.
  const parts=new Map(state.parts),hashes={...state.hashes};
  for(const key of wire.removed||[]){parts.delete(key);delete hashes[key];}
  for(const [key,value] of Object.entries(wire.changes||{})){parts.set(key,value);hashes[key]=wire.versions[key];}
  const result=materialize(parts);state.parts=parts;state.hashes=hashes;return result;
 }
 async function request(client,name,params={},options={}){
  const owner=await identity(client),stamp=epoch;
  const target=options.table?'egress_table_snapshot':routes[name];if(!target)return client.rpc(name,params);
  const scope=JSON.stringify([owner,target,options.table?params.p_table:params.p_boss_id||params.p_class_id||'',params.p_device||'',options.table?params.p_order:'',options.table?params.p_limit:'',options.table?params.p_ascending:'']);
  const snapshot=options.table||params.p_action==='snapshot',pendingKey=scope+':snapshot:'+JSON.stringify(params);
  if(snapshot&&inflight.has(pendingKey))return inflight.get(pendingKey);
  let state=caches.get(scope);if(!state){state={parts:new Map(),hashes:{},tail:Promise.resolve(),jobs:0};caches.set(scope,state);}
  state.jobs++;
  const run=state.tail.catch(()=>{}).then(async()=>{
   if(stamp!==epoch||owner!==await identity(client))return {data:null,error:{message:'Account changed.',code:'ACCOUNT_CHANGED'}};
   const known={v:1,hashes:state.hashes},args=options.table?{...params,p_known:known}:{...params,p_payload:{...params.p_payload,_egress:known}};
   let result;
   if(missing.has(target))result=await options.fallback();
   else {result=await client.rpc(target,args);if(['PGRST202','42883'].includes(result.error?.code)){missing.add(target);result=await options.fallback();}}
   if(stamp!==epoch||owner!==await identity(client))return {data:null,error:{message:'Account changed.',code:'ACCOUNT_CHANGED'}};
   if(result.error)return result;
   const wire=result.data;let data;
   try{data=decode(wire,state);}catch(error){state.parts.clear();state.hashes={};return {data:null,error:{message:error.message,code:'COMPACT_RESET'}};}
   stats.requests++;stats.wireBytes+=bytes(wire);stats.fullBytes+=bytes(data);stats[wire?.__egress===1?'compactResponses':'legacyResponses']++;
   return {...result,data};
  });
  state.tail=run;if(snapshot){inflight.set(pendingKey,run);run.finally(()=>{if(inflight.get(pendingKey)===run)inflight.delete(pendingKey);}).catch(()=>{});}
  // Only evict settled, unused contexts; a fresh context requests all fields.
  run.finally(()=>{state.jobs--;if(caches.size>64)for(const [key,value] of caches){if(key!==scope&&!value.jobs){caches.delete(key);break;}}}).catch(()=>{});
  return run;
 }
 function rpc(client,name,params={}){if(!routes[name]||(name==='attendance_station'&&params.p_action!=='snapshot'))return client.rpc(name,params);return request(client,name,params,{fallback:()=>client.rpc(name,params)});}
 async function table(client,table,options={}){
  const args={p_table:table,p_order:options.order||null,p_ascending:options.ascending??false,p_limit:options.limit??null};
  const fallback=()=>{let q=client.from(table).select('*');if(options.order)q=q.order(options.order,{ascending:options.ascending??false});if(options.limit!=null)q=q.limit(options.limit);return q;};
  const result=await request(client,'',args,{table:true,fallback:async()=>{const r=await fallback();return r.error?r:{...r,data:{rows:r.data}};}});
  return result.error?result:{...result,data:result.data.rows};
 }
 function clear(){epoch++;caches.clear();inflight.clear();missing.clear();}
 window.EgressTransport={rpc,table,clear,decode,materialize,diagnostics:()=>({...stats,estimatedSavedPercent:stats.fullBytes?Math.max(0,Math.round((1-stats.wireBytes/stats.fullBytes)*100)):0,compactUnavailable:[...missing]})};
})();
