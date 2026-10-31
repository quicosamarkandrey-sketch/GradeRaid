const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('modules/rewards/learning-rewards.js','utf8');
function fixture(handler){
 const storage=new Map(),events=[],cleared=[];let state={students:[{id:'student',coins:0,xp:0}],quizHistory:{student:[{id:'attempt',learningRewardPending:true}]},store:[{id:'book',stock:2}]};
 const context={currentUser:{id:'student'},currentRole:'student',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},DBService:{rpc:handler},AppStore:{getState:()=>structuredClone(state),syncFromLegacy:(s,e)=>{state=s;events.push(e.type)},emit:()=>{},subscribe:()=>{},clearDirty:(...args)=>cleared.push(args)},document:{querySelectorAll:()=>[]},crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,console};context.window=context;vm.runInNewContext(source,context);
 return {api:context.LearningRewards,context,storage,events,cleared,state:()=>state};
}
const wallet=coins=>({profile:{id:'student',coins,xp:10,level:0,tier:'Novice'}});
test('missing reward API retains legacy; connection failures never authorize legacy payouts',async()=>{
 const missing=fixture(async()=>({error:{code:'PGRST202'}}));assert.equal(await missing.api.ready(),'legacy');
 const offline=fixture(async()=>({error:{code:'NETWORK'}}));assert.equal(await offline.api.ready(),'unavailable');assert.equal((await offline.api.checkout([])).ok,false);
});
test('quest settlement waits for XP sync, applies authoritative wallet and clears only the saved attempt',async()=>{
 let release,seen=false;const sync=new Promise(r=>release=r);
 const f=fixture(async(name,args)=>{if(name==='learning_reward_status')return {data:{version:1}};assert.equal(name,'record_learning_quest');assert.equal(args.p_attempt_id,'attempt');seen=true;return {data:{coinsEarned:10,wallet:wallet(10)}};});
 const pending=f.api.recordQuest({id:'attempt',quizId:'quest',score:50},sync);await Promise.resolve();assert.equal(seen,false);assert.ok(f.storage.get('eduquest-learning-quests-student'));
 release();const result=await pending;assert.equal(result.coinsEarned,10);assert.equal(f.state().students[0].coins,10);assert.equal(f.state().quizHistory.student[0].learningRewardPending,undefined);assert.deepEqual(f.events,['state:remote-sync','state:remote-sync']);assert.equal(f.cleared[0][0],'quiz_history');
});
test('uncertain checkout retains request ID for retry and applies server purchase without local deduction',async()=>{
 let calls=0,requestId;
 const f=fixture(async(name,args)=>{
  if(name==='learning_reward_status')return {data:{version:1}};
  assert.equal(name,'checkout_learning_rewards');assert.equal(args.p_items[0].price,20);
  if(!calls++){requestId=args.p_request_id;return {error:{code:'NETWORK',message:'Disconnected'}};}
  assert.equal(args.p_request_id,requestId);return {data:{total:20,wallet:wallet(80),orders:[{order_id:'order',student_id:'student',item_id:'book',claim_code:'CODE'}],inventory:[{item_id:'book',quantity:1}],stock:{book:1}}};
 });
 const cart=[{item:{id:'book',cost:20},qty:1}];assert.equal((await f.api.checkout(cart)).ok,false);assert.ok(f.storage.get('eduquest-learning-checkout-student'));
 assert.equal((await f.api.checkout(cart)).ok,true);assert.equal(f.state().students[0].coins,80);assert.equal(f.state().orders.length,1);assert.equal(f.state().store[0].stock,1);assert.equal(f.storage.has('eduquest-learning-checkout-student'),false);assert.ok(f.events.every(type=>type==='state:remote-sync'));
});
test('known rejected checkout clears pending receipt so a corrected cart can be submitted',async()=>{
 const f=fixture(async name=>name==='learning_reward_status'?{data:{version:1}}:{error:{code:'P0001',message:'Price changed'}});
 assert.equal((await f.api.checkout([{item:{id:'book',cost:20},qty:1}])).ok,false);assert.equal(f.storage.has('eduquest-learning-checkout-student'),false);
});
