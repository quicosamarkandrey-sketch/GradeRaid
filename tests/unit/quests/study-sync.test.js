const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('modules/quests/study-sync.js','utf8'),copy=value=>JSON.parse(JSON.stringify(value));
function server(){
 const accounts=new Map(),receipts=new Map();let calls=0;
 const data=id=>{if(!accounts.has(id))accounts.set(id,{studentId:id,sets:[]});return accounts.get(id);};
 async function rpc(id,name,args){
  if(name==='study_progress_pull')return {data:copy(data(id))};
  calls++;const key=id+':'+args.p_operation_id,request=JSON.stringify(args);
  if(receipts.has(key)){assert.equal(receipts.get(key),request);return {data:copy(data(id))};}
  const rows=data(id).sets;let row=rows.find(s=>s.quizId===args.p_quiz_id);if(!row){row={quizId:args.p_quiz_id,saved:false,versions:[]};rows.push(row);}
  let version=row.versions.find(v=>v.signature===args.p_signature);if(!version){version={signature:args.p_signature,known:{},starred:{},position:0};row.versions.push(version);}
  const patch=args.p_patch;for(const field of ['known','starred'])Object.assign(version[field],patch[field]||{});
  if(patch.position!==undefined)version.position=patch.position;if(patch.saved!==undefined)row.saved=patch.saved;if(patch.opened)row.lastOpenedAt=String(Date.now());
  receipts.set(key,request);return {data:copy(data(id))};
 }
 return {rpc,data,get calls(){return calls;}};
}
function device(cloud,initial={sets:{q:{signature:'v1',known:[],starred:[],position:0}},saved:[]},storage=new Map()){
 let memory=copy(initial),intercept=null;const statuses=[];
 const ctx={currentUser:{id:'student'},currentRole:'student',crypto:require('node:crypto').webcrypto,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>1,clearTimeout:()=>{},document:{hidden:false,addEventListener:()=>{}},addEventListener:()=>{},DBService:{rpc:(name,args)=>intercept?intercept(name,args):cloud.rpc(ctx.currentUser.id,name,args)}};ctx.window=ctx;vm.runInNewContext(source,ctx);
 const connect=()=>ctx.StudySync.connect(ctx.currentUser.id,{getMemory:()=>memory,getSignature:()=> 'v1',onMerge:value=>{memory=value;},onStatus:value=>statuses.push(value)});
 connect();
 return {api:ctx.StudySync,ctx,storage,statuses,connect,get memory(){return memory;},edit(fn){fn(memory);ctx.StudySync.capture(memory);},intercept(fn){intercept=fn;},switchAccount(id){ctx.currentUser={id};memory={sets:{q:{signature:'v1',known:[],starred:[],position:0}},saved:[]};connect();}};
}
async function settle(){for(let i=0;i<12;i++)await new Promise(setImmediate);}
test('two devices merge independent cards, unmarks and saved status; sync does not invent blank writes',async()=>{
 const cloud=server(),a=device(cloud),b=device(cloud);await settle();assert.equal(cloud.calls,0);
 a.edit(m=>{m.sets.q.known=[0];m.saved=['q'];});await a.api.refresh();
 b.edit(m=>{m.sets.q.starred=[2];});await b.api.refresh();await a.api.refresh();
 assert.deepEqual(copy(a.memory.sets.q.known),[0]);assert.deepEqual(copy(a.memory.sets.q.starred),[2]);assert.deepEqual(copy(b.memory.saved),['q']);
 b.edit(m=>{m.sets.q.known=[];m.saved=[];});await b.api.refresh();await a.api.refresh();assert.deepEqual(copy(a.memory.sets.q.known),[]);assert.deepEqual(copy(a.memory.saved),[]);
});
test('uncertain successful write keeps durable operation for retry without replaying it over another device',async()=>{
 const cloud=server(),a=device(cloud),b=device(cloud);await settle();let once=true;
 a.intercept(async(name,args)=>{const result=await cloud.rpc('student',name,args);if(name==='study_progress_apply'&&once){once=false;return {error:{code:'NETWORK'}};}return result;});
 a.edit(m=>m.sets.q.known.push(0));await a.api.refresh();assert.ok(JSON.parse(a.storage.get('eduquest-study-sync-v1-student')).length);
 await b.api.refresh();b.edit(m=>m.sets.q.known=[]);await b.api.refresh();
 await a.api.refresh();assert.deepEqual(copy(a.memory.sets.q.known),[]);assert.equal(JSON.parse(a.storage.get('eduquest-study-sync-v1-student')).length,0);
});
test('offline changes survive reload and import never overwrites existing account progress',async()=>{
 const cloud=server(),storage=new Map(),a=device(cloud,undefined,storage);await settle();
 a.intercept(async()=>({error:{code:'NETWORK'}}));a.edit(m=>{m.sets.q.known=[1];m.sets.q.position=3;});await a.api.refresh();assert.match(a.statuses.at(-1),/saved on this device/);
 const restored=device(cloud,a.memory,storage);await settle();assert.deepEqual(copy(restored.memory.sets.q.known),[1]);assert.equal(restored.memory.sets.q.position,3);
 const stale=device(cloud,{sets:{q:{signature:'v1',known:[9],starred:[8],position:0}},saved:['q']});await settle();assert.deepEqual(copy(stale.memory.sets.q.known),[1]);assert.deepEqual(copy(stale.memory.saved),[]);
});
test('old-device content version cannot overwrite a newer version and a late response cannot cross accounts',async()=>{
 const cloud=server();cloud.data('student').sets.push({quizId:'q',saved:false,versions:[{signature:'v1',known:{3:true},starred:{},position:4},{signature:'old',known:{8:true},starred:{},position:8}]});
 const a=device(cloud);await settle();assert.equal(a.memory.sets.q.position,4);assert.deepEqual(copy(a.memory.sets.q.known),[3]);assert.equal(cloud.calls,0);
 let release;a.intercept(()=>new Promise(resolve=>release=resolve));const pending=a.api.refresh();await settle();a.intercept(null);a.switchAccount('other');await settle();release({data:copy(cloud.data('student'))});await pending;
 assert.deepEqual(copy(a.memory.saved),[]);assert.equal(a.statuses.at(-1),'Saved to your account');
 assert.deepEqual(copy(a.memory.sets.q.known),[]);assert.equal(cloud.data('other').sets.length,0,'No old-account progress is imported');
});
test('missing migration is reported honestly and pending local progress remains recoverable',async()=>{
 const cloud=server(),a=device(cloud);await settle();a.intercept(async()=>({error:{code:'PGRST202'}}));a.edit(m=>m.sets.q.starred.push(1));await a.api.refresh();assert.match(a.statuses.at(-1),/not enabled yet/);assert.equal(JSON.parse(a.storage.get('eduquest-study-sync-v1-student')).length,1);
});
