'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const {loadDbServiceWindow}=require('./helpers/load-globals');
function setup(mode='modern'){
 const {win,DBService}=loadDbServiceWindow({currentUser:{id:'a'},currentRole:'student'});win.TextEncoder=TextEncoder;win.eval(fs.readFileSync('repository/egress-transport.js','utf8'));Object.defineProperty(win.document,'hidden',{value:false,configurable:true});
 const channels=[],reads=[];const client={auth:{getSession:async()=>({data:{session:{user:{id:'a'}}}})},
 rpc:async(name,args)=>{if(name==='egress_sync_status')return mode==='modern'?{data:{v:1}}:{error:{code:'PGRST202'}};reads.push(args?.p_table);return mode==='modern'?{data:{rows:[]}}:{error:{code:'PGRST202'}};},
 from(table){reads.push(table);const q={select:()=>q,order:()=>q,limit:()=>q,then:resolve=>Promise.resolve({data:[]}).then(resolve)};return q;},
 channel(name){const handlers=[];const c={name,handlers,on:(...args)=>{handlers.push(args);return c;},subscribe:cb=>{cb?.('SUBSCRIBED');return c;}};channels.push(c);return c;},removeChannel:()=>{}};
 win.SupabaseClient.getClient=()=>client;win.AppStore.syncFromLegacy=()=>{};
 return {win,DBService,client,channels,reads};
}
test('modern sessions subscribe to small notices, coalesce reads and defer hidden-tab work',async()=>{
 const {win,DBService,channels,reads}=setup();try{
  await DBService.initRemote();await new Promise(r=>setTimeout(r,750));
  assert.ok(channels.some(c=>c.name==='eduquest-compact-sync'));assert.ok(!channels.some(c=>c.name==='eduquest-table-sync'));
  const notice=channels.find(c=>c.name==='eduquest-compact-sync').handlers[0];assert.equal(notice[1].table,'sync_invalidations');reads.length=0;
  notice[2]({new:{table_name:'profiles'}});notice[2]({new:{table_name:'profiles'}});await new Promise(r=>setTimeout(r,750));assert.deepEqual(reads,['profiles']);
  reads.length=0;Object.defineProperty(win.document,'hidden',{value:true,configurable:true});notice[2]({new:{table_name:'profiles'}});await new Promise(r=>setTimeout(r,650));assert.equal(reads.length,0);
  Object.defineProperty(win.document,'hidden',{value:false,configurable:true});win.document.dispatchEvent(new win.Event('visibilitychange'));await new Promise(r=>setTimeout(r,750));assert.deepEqual(reads,['profiles']);
  DBService.teardownRealtime();assert.equal(DBService.diagnostics().signalChannelReady,false);
 }finally{DBService.teardownRealtime();win.close();}
});
test('a server without the migration retains the original authorized change subscriptions',async()=>{
 const {win,DBService,channels}=setup('legacy');try{await DBService.initRemote();await new Promise(r=>setImmediate(r));assert.ok(channels.some(c=>c.name==='eduquest-table-sync'));assert.ok(!channels.some(c=>c.name==='eduquest-compact-sync'));}finally{DBService.teardownRealtime();win.close();}
});
test('identical boss assets share immutable URLs while custom mutable paths keep short caching',async()=>{
 const {win,DBService,client}=setup();try{
  Object.defineProperty(win.crypto,'subtle',{value:webcrypto.subtle});const writes=[];
  client.storage={from:()=>({upload:async(path,blob,options)=>{writes.push({path,options});return {data:{path}};},getPublicUrl:path=>({data:{publicUrl:'https://example.com/'+path}})})};
  const blob=new Blob(['identical asset'],{type:'image/png'});
  const a=await DBService.uploadPublicFile('boss-art','a/library/img_one.png',blob,'image/png'),b=await DBService.uploadPublicFile('boss-art','a/library/motion_two.png',blob,'image/png');
  assert.equal(a.error,null);assert.equal(a.data.publicUrl,b.data.publicUrl);assert.match(writes[0].path,/^a\/library\/asset_[a-f0-9]{64}\.png$/);assert.equal(writes[0].options.cacheControl,'31536000');
  await DBService.uploadPublicFile('boss-art','a/custom.png',blob,'image/png');assert.equal(writes[2].path,'a/custom.png');assert.equal(writes[2].options.cacheControl,'3600');
 }finally{DBService.teardownRealtime();win.close();}
});
