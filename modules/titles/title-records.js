/* Optional account-backed family metadata and factual award history.
   This service never grants titles or changes XP/coins. */
;(function(){
 'use strict';let id=null,data=null,pending=null,status='unavailable';
 async function rpc(name,args){let timer;try{return await Promise.race([DBService.rpc(name,args),new Promise(resolve=>{timer=setTimeout(()=>resolve({error:{message:'Account details are unavailable. Please reconnect.'}}),8000);})]);}catch(error){return {error};}finally{clearTimeout(timer);}}
 const uid=()=>typeof currentUser==='undefined'?null:currentUser?.id;
 async function ready(force=false){
  if(uid()!==id){id=uid();data=null;pending=null;status='unavailable';}
  if(!id)return false;if(pending)return pending;if(!force&&status!=='unavailable')return status==='ready';
  const requested=id;
  pending=(async()=>{try{const result=await rpc('title_collection_details');if(uid()!==requested||id!==requested)return false;
   if(result.error||result.data?.viewerId!==requested||result.data?.version!==1){status='device';return false;}
   data=result.data;status='ready';document.dispatchEvent(new CustomEvent('titles:records-loaded'));return true;
  }catch{status='device';return false;}finally{if(id===requested)pending=null;}})();return pending;
 }
 function meta(tid){if(id!==uid())return {};const row=data?.metadata?.find(m=>m.title_id===tid);return row?{family:row.family||'',stage:row.stage||1,season:row.season||''}:{};}
 function history(tid){return id===uid()?(data?.history||[]).filter(e=>e.title_id===tid):[];}
 function earned(tid){return id===uid()?data?.legacyEarned?.find(e=>e.title_id===tid)?.unlocked_at:null;}
 async function save(tid,values){
  if(!await ready())return {ok:false,message:'Collection details could not be saved to your account.'};const requested=id;
  const result=await rpc('set_title_collection_details',{p_title_id:tid,p_family:values.family||'',p_stage:values.stage||1,p_season:values.season||''});
  if(uid()!==requested)return {ok:false,message:'Account changed.'};
  if(result.error||result.data?.viewerId!==requested)return {ok:false,message:result.error?.message||'Collection details could not be saved.'};
  data=result.data;document.dispatchEvent(new CustomEvent('titles:records-loaded'));return {ok:true};
 }
 AppStore.subscribe('title-records',(_state,event)=>{if(event?.type==='session:booted')ready(true);if(event?.type==='nav:navigated'&&['s-badges','a-titles'].includes(event.payload?.id))ready(true);if(['titles:unlocked','titles:revoked'].includes(event?.type))setTimeout(()=>ready(true),700);});
 window.TitleRecords=Object.freeze({ready,meta,history,earned,save,available:()=>id===uid()&&status==='ready'});
})();
