// Balanced rewards: policy and balances come from scoped server RPCs.
// No client-generated coin delta is ever sent by this service.
;(function(){
  'use strict';
  const DEFAULTS=Object.freeze({attendance_coins:10,attendance_xp:10,recitation_coins_per_point:2,recitation_daily_cap:20,streak_days:5,streak_coins:15,streak_xp:25,quest_default_coins:20,quest_max_coins:40});
  let identity=null,mode='unavailable',rules=null,loading=null,epoch=0,lastAttempt=0;
  const wallets=new Map(),queues=new Map();
  const userId=()=>typeof currentUser!=='undefined'?currentUser?.id:null;
  const role=()=>typeof currentRole!=='undefined'?currentRole:null;
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const key=(name,id)=>'eduquest-learning-'+name+'-'+id;
  function read(name,id){try{return JSON.parse(localStorage.getItem(key(name,id))||'null');}catch{return null;}}
  function write(name,id,value){try{if(value===null)localStorage.removeItem(key(name,id));else localStorage.setItem(key(name,id),JSON.stringify(value));return true;}catch{return false;}}
  async function rpc(name,args={}){let timer;try{return await Promise.race([DBService.rpc(name,args),new Promise(resolve=>{timer=setTimeout(()=>resolve({data:null,error:{code:'NETWORK',message:'Connection unavailable. Reconnect and try again.'}}),8000);})]);}catch(error){return {data:null,error};}finally{clearTimeout(timer);}}
  function snapshot(mutator){const state=AppStore.getState();mutator(state);AppStore.syncFromLegacy(state,{type:'state:remote-sync'});}
  function applyWallet(wallet){
    const row=wallet?.profile;if(!row)return;
    wallets.set(row.id,wallet);
    snapshot(state=>{const s=(state.students||[]).find(s=>s.id===row.id);if(s)for(const field of ['coins','xp','level','tier'])if(row[field]!==undefined&&row[field]!==null)s[field]=row[field];});
    if(userId()===row.id){Object.assign(currentUser,row);document.querySelectorAll('[data-learning-coins]').forEach(el=>el.textContent=Number(row.coins||0).toLocaleString());if(typeof updateTopbar==='function')updateTopbar();}
  }
  async function ready(force=false){
    const id=userId();if(!id)return 'unavailable';
    if(identity!==id){identity=id;mode='unavailable';rules=null;loading=null;epoch++;wallets.clear();queues.clear();}
    if(loading)return loading;
    if(!force&&mode!=='unavailable')return mode;
    if(!force&&Date.now()-lastAttempt<3000)return mode;
    lastAttempt=Date.now();const requestEpoch=epoch;
    loading=(async()=>{
      const result=await rpc('learning_reward_status');
      if(requestEpoch!==epoch||userId()!==id)return 'unavailable';
      if(result.error){
        if(['PGRST202','42883'].includes(result.error.code)){mode='legacy';write('policy','school',null);}
        else {const cached=read('policy','school');if(cached?.version===1){mode='balanced';rules=cached;}else mode='unavailable';}
      }else if(result.data?.version===1){mode='balanced';rules=result.data;write('policy','school',rules);}
      else mode='unavailable';
      loading=null;AppStore.emit({type:'learning-rewards:ready',payload:{mode}});return mode;
    })();
    return loading;
  }
  async function refreshStudent(id){
    if(!id||await ready()!=='balanced')return null;
    const previous=queues.get(id)||Promise.resolve(),requestEpoch=epoch;
    const next=previous.catch(()=>{}).then(async()=>{
      const result=await rpc('learning_reward_wallet',{p_student_id:id});
      if(!result.error&&requestEpoch===epoch)applyWallet(result.data);
      return result.error?null:result.data;
    });
    queues.set(id,next);try{return await next;}finally{if(queues.get(id)===next)queues.delete(id);}
  }
  function questBudget(quiz){
    const max=Number(rules?.quest_max_coins??DEFAULTS.quest_max_coins);
    const stored=wallets.get(userId())?.questBudgets?.[quiz.id];
    return Math.max(0,Math.min(max,Number(stored??quiz.coinReward??rules?.quest_default_coins??20)||0));
  }
  function pendingQuests(id){return read('quests',id)||[];}
  async function recordQuest(attempt,statsSync){
    const id=userId();if(!id)return {ok:false,coinsEarned:0};
    const queue=pendingQuests(id);if(!queue.some(q=>q.id===attempt.id))queue.push(attempt);
    const durable=write('quests',id,queue);
    if(!durable)return {ok:false,coinsEarned:0,error:'Your result could not be saved for synchronization. Keep this page open and try again.'};
    await statsSync;
    if(await ready()!=='balanced'||userId()!==id)return {ok:false,coinsEarned:0};
    const requestEpoch=epoch;
    const result=await rpc('record_learning_quest',{p_attempt_id:attempt.id,p_quiz_id:attempt.quizId,p_score:attempt.score,p_attempt:attempt.attempt||1,p_results:attempt.results||null});
    if(result.error||requestEpoch!==epoch||userId()!==id)return {ok:false,coinsEarned:0,error:result.error?.message};
    write('quests',id,pendingQuests(id).filter(q=>q.id!==attempt.id));
    snapshot(state=>{const saved=(state.quizHistory?.[id]||[]).find(q=>q.id===attempt.id);if(saved){delete saved.learningRewardPending;saved.learningRewardVersion=1;}});
    // This attempt is now on the server. Clear only its own pending upload key.
    AppStore.clearDirty?.('quiz_history',[id+':'+attempt.id]);
    applyWallet(result.data.wallet);
    return {ok:true,coinsEarned:Number(result.data.coinsEarned)||0};
  }
  async function recoverQuests(){const id=userId();for(const attempt of pendingQuests(id)){if(userId()!==id)break;await recordQuest(attempt);}}
  async function flushLegacy(id){await ready();if(mode!=='balanced')return;AppStore.flushNow?.();await DBService.flushPendingUpload?.();return refreshStudent(id);}
  function applyPurchase(data){
    const sid=data.wallet.profile.id;
    snapshot(state=>{
      state.orders=state.orders||[];state.redemptions=state.redemptions||[];state.inventory=state.inventory||{};
      for(const r of data.orders||[]){const mapped={orderId:r.order_id,studentId:r.student_id,studentName:r.student_name,studentInit:r.student_init,studentColor:r.student_color,itemId:r.item_id,itemName:r.item_name,emoji:r.emoji,cost:r.cost,category:r.category,claimCode:r.claim_code,status:r.status,createdAt:r.created_at,createdDateStr:r.created_date_str,claimedAt:r.claimed_at?Date.parse(r.claimed_at):null,claimedBy:r.claimed_by,cancelledAt:r.cancelled_at?Date.parse(r.cancelled_at):null,cancelReason:r.cancel_reason};const i=state.orders.findIndex(o=>o.orderId===mapped.orderId);if(i<0)state.orders.unshift(mapped);else state.orders[i]=mapped;}
      for(const r of data.redemptions||[])if(!state.redemptions.some(o=>o.orderId===r.order_id))state.redemptions.unshift({orderId:r.order_id,studentId:r.student_id,itemId:r.item_id,itemName:r.item_name,emoji:r.emoji,item:r.item_label,pts:r.pts,date:r.date_label,time:r.time_label,claimCode:r.claim_code});
      state.inventory[sid]=(data.inventory||[]).map(r=>({itemId:r.item_id,itemName:r.item_name,emoji:r.emoji,category:r.category,quantity:r.quantity,datePurchased:r.date_purchased,lastPurchased:r.last_purchased,source:r.source,status:r.status,usedAt:r.used_at}));
      for(const [id,stock] of Object.entries(data.stock||{})){const item=(state.store||[]).find(i=>i.id===id);if(item)item.stock=stock;}
    });
    applyWallet(data.wallet);
  }
  async function checkout(items){
    const sid=userId();if(!sid||await ready()!=='balanced')return {ok:false,error:'Coin checkout is unavailable. Please reconnect and try again.'};
    const requested=items.map(e=>({id:e.item.id,qty:e.qty,price:e.item.cost})).sort((a,b)=>a.id.localeCompare(b.id));
    let request=read('checkout',sid);
    if(!request){request={id:'lr-'+crypto.randomUUID(),items:requested};if(!write('checkout',sid,request))return {ok:false,error:'Could not prepare a recoverable checkout. Please check browser storage.'};}
    const result=await rpc('checkout_learning_rewards',{p_request_id:request.id,p_items:request.items});
    if(result.error){if(['P0001','42501'].includes(result.error.code)||/^(22|23)/.test(result.error.code||''))write('checkout',sid,null);return {ok:false,error:result.error.message||'Checkout could not be confirmed. Reconnect and retry; you will not be charged twice.'};}
    if(userId()!==sid)return {ok:false,error:'Please return to the account that started this purchase.'};
    applyPurchase(result.data);write('checkout',sid,null);
    return {ok:true,data:result.data,items:request.items,recovered:JSON.stringify(request.items)!==JSON.stringify(requested)};
  }
  async function openGuide(){
    const state=await ready(),p={...DEFAULTS,...rules};
    const wallet=wallets.get(userId());
    const content=state==='balanced'?`<p class="learning-reward-intro">XP builds your level. Coins buy the rewards and privileges available in your teacher’s Armory.</p>${rules?.enabled===false?'<p>Automatic coin rewards are temporarily paused.</p>':''}
      <table class="learning-reward-table"><thead><tr><th>Activity</th><th>Coins</th><th>How it works</th></tr></thead><tbody>
      <tr><td>Attendance</td><td>${p.attendance_coins} / day</td><td>Once per attended day, including late arrivals. Multiple scans do not pay again. Also earns ${p.attendance_xp} XP.</td></tr>
      <tr><td>Recitation</td><td>${p.recitation_coins_per_point} / point</td><td>Up to ${p.recitation_daily_cap} coins per Philippine calendar day.</td></tr>
      <tr><td>Attendance streak</td><td>+${p.streak_coins}</td><td>Every ${p.streak_days} attended class days, plus ${p.streak_xp} XP. Excused days and days without records are skipped; recorded absences reset the streak.</td></tr>
      <tr><td>Quests</td><td>Up to ${p.quest_max_coins} / quest</td><td>Your best score determines your total, within the quest’s coin budget. Improve your score to earn the difference; repeating the same score gives no extra coins.</td></tr>
      <tr><td>Other rewards</td><td>Teacher-set</td><td>Achievement, campaign, boss and mail rewards keep their own displayed amounts.</td></tr></tbody></table>
      ${wallet?`<p class="learning-reward-intro">Your available balance: <strong>${wallet.profile.coins} coins</strong>. Recitation coins today: ${wallet.todayRecitationCoins} / ${p.recitation_daily_cap}.</p>${wallet.debt?`<p>Upcoming learning coins first cover ${wallet.debt} coins from reversed rewards that had already been spent.</p>`:''}`:''}
      <p class="learning-reward-footnote">Corrections and undo can reverse rewards. Prices and available items are set by your teacher.</p>`:
      `<p class="learning-reward-intro">XP builds your level; coins can be spent in the Armory. Quests and teacher-issued rewards show their own amounts.</p><p>${role()==='student'?'Automatic attendance and participation coins are not available right now. Ask your teacher about your class reward rules.':'The balanced attendance and participation policy is not enabled on this school’s server yet. Existing rewards continue to work.'}</p>`;
    showModal(`<h2>How learning rewards work</h2>${content}<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModalForce()">Close</button></div>`,'lg');
  }
  window.LearningRewards=Object.freeze({ready,mode:()=>mode,active:()=>mode==='balanced',questBudget,recordQuest,refreshStudent,flushLegacy,checkout,openGuide,defaults:DEFAULTS});
  AppStore.subscribe('balanced-learning-rewards',(_state,event)=>{
    const type=event?.type;
    if(type==='session:booted'){ready(true).then(async state=>{if(state==='balanced'&&role()==='student'){await recoverQuests();if(read('checkout',userId())){const recovered=await checkout([]);if(recovered.ok&&typeof toast==='function')toast('Previous checkout confirmed. Your claim codes are in My Orders.');}await refreshStudent(userId());}});}
    else if(type==='nav:navigated'&&role()==='student'&&['s-dashboard','s-store'].includes(event.payload?.id))ready().then(state=>{if(state==='balanced')refreshStudent(userId());});
  });
})();
