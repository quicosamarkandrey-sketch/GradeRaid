'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(){const context={window:{},TextEncoder,currentUser:{id:'a'}};vm.runInNewContext(fs.readFileSync('repository/egress-transport.js','utf8'),context);return {api:context.window.EgressTransport,context};}
const packet=(changes,removed=[])=>({__egress:1,changes,versions:Object.fromEntries(Object.keys(changes).map(k=>[k,'version-'+JSON.stringify(changes[k])])),removed});
const start=()=>packet({'["$shape"]':{boss:'object',roster:'rows',outcome:'object'},'["boss","hp"]':100,'["boss","questions"]':['cached question'],'["roster","@order"]':['a','b'],'["roster","a","id"]':'a','["roster","a","photo"]':'cached portrait','["roster","a","score"]':1,'["roster","b","id"]':'b'});
const params=(action='snapshot',payload={})=>({p_class_id:'room',p_device:'teacher',p_action:action,p_payload:payload});
test('conditional snapshots reconstruct mutable fields, ordered removals, nulls and reused heavy fields',async()=>{
 const {api}=load();let wire=start();const client={rpc:async()=>({data:wire})};
 let r=await api.rpc(client,'recitation_presentation',params());assert.equal(r.data.boss.hp,100);
 wire=packet({'["boss","hp"]':70,'["roster","a","score"]':2,'["roster","@order"]':['a']},['["roster","b","id"]']);
 r=await api.rpc(client,'recitation_presentation',params());assert.equal(r.data.roster.length,1);assert.equal(r.data.roster[0].score,2);assert.equal(r.data.roster[0].photo,'cached portrait');assert.equal(r.data.boss.questions[0],'cached question');
 wire=packet({'["roster","a","photo"]':null});r=await api.rpc(client,'recitation_presentation',params());assert.equal(r.data.roster[0].photo,null);
 r.data.boss.questions.push('local edit');wire=packet({});r=await api.rpc(client,'recitation_presentation',params());assert.equal(r.data.boss.questions.length,1,'Callers cannot poison raw snapshot cache');
});
test('missing migration falls back once; network/auth errors never replay a mutation',async()=>{
 const {api}=load(),calls=[];const client={rpc:async(name)=>{calls.push(name);return name.endsWith('_delta')?{error:{code:'PGRST202'}}:{data:{ok:true}};}};
 await api.rpc(client,'world_boss_action',params('answer'));await api.rpc(client,'world_boss_action',params('answer'));
 assert.deepEqual(calls,['world_boss_delta','world_boss_action','world_boss_action']);
 for(const code of ['42501','NETWORK']){const t=load().api;let n=0;const result=await t.rpc({rpc:async()=>{n++;return {error:{code}};}},'world_boss_action',params('claim'));assert.equal(result.error.code,code);assert.equal(n,1);}
});
test('same-scope requests serialize and duplicate reads coalesce without merging different presence requests',async()=>{
 const {api}=load();let release,calls=0;const barrier=new Promise(r=>release=r);const client={rpc:async()=>{calls++;if(calls===1)await barrier;return {data:{ok:true}};}};
 const a=api.rpc(client,'world_boss_action',params('snapshot',{inBattle:true})),b=api.rpc(client,'world_boss_action',params('snapshot',{inBattle:true})),c=api.rpc(client,'world_boss_action',params('snapshot',{inBattle:false}));
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();await Promise.all([a,b,c]);assert.equal(calls,2);
});
test('account switch and explicit logout invalidate in-flight snapshots and cached versions',async()=>{
 const {api,context}=load();let release;const barrier=new Promise(r=>release=r);const client={rpc:async()=>{await barrier;return {data:start()};}};
 const pending=api.rpc(client,'recitation_presentation',params());await new Promise(r=>setImmediate(r));context.currentUser.id='b';api.clear();release();assert.equal((await pending).error.code,'ACCOUNT_CHANGED');
 let known;client.rpc=async(name,args)=>{known=args.p_payload._egress;return {data:start()};};await api.rpc(client,'recitation_presentation',params());assert.equal(Object.keys(known.hashes).length,0);
});

test('v2 packets negotiate only after server support, preserve fields and downgrade without replaying mutations',async()=>{
 const {api}=load(),seen=[];let step=0;const client={rpc:async(name,args)=>{seen.push(args.p_payload._egress.v);step++;if(step===1)return {data:{...start(),packetVersion:2}};if(step===2)return {data:{__egress:2,changed:[[['boss','hp'],'v2',75]],removed:[]}};if(step===3)return {data:{ok:true}};return {data:start()};}};
 assert.equal((await api.rpc(client,'world_boss_action',params())).data.boss.hp,100);let reply=await api.rpc(client,'world_boss_action',params());assert.equal(reply.data.boss.hp,75);assert.equal(reply.data.roster[0].photo,'cached portrait');
 reply=await api.rpc(client,'world_boss_action',params('answer'));assert.equal(reply.data.ok,true);assert.equal(seen.length,3,'Downgrade never resubmits an answer');await api.rpc(client,'world_boss_action',params());assert.deepEqual(seen,[1,2,2,1]);
});
