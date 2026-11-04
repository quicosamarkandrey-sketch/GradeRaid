const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){const context={console:{log(){}},alGet:id=>id==='known'?{id,cssClass:'bs-anim-play-idle-float'}:null};context.window=context;vm.runInNewContext(fs.readFileSync('modules/boss-studio/bs_bve_engine.js','utf8'),context);return context;}
test('event animation snapshots resolve teacher custom presets without a local library',()=>{
 const c=setup(),profile={animations:{idle:'teacher-only'},animationPresets:{idle:{id:'teacher-only',cssClass:'bs-anim-play-idle-levitate'}}};
 assert.equal(c.bveResolveAnimation(profile,'idle').cssClass,'bs-anim-play-idle-levitate');
 assert.equal(c.bveResolveAnimation(profile,'cast'),null);
});
test('a stale slot snapshot cannot override a newly selected preset',()=>{
 const c=setup(),profile={animations:{idle:'known'},animationPresets:{idle:{id:'previous',cssClass:'wrong-motion'}}};
 assert.equal(c.bveResolveAnimation(profile,'idle').cssClass,'bs-anim-play-idle-float');
});
test('portable animation definitions accept CSS class tokens without allowing HTML attributes',()=>{
 const c=setup(),profile={animations:{idle:'custom'},animationPresets:{idle:{id:'custom',cssClass:'bs-anim-play-idle-float invalid"onload="bad'}}};
 assert.equal(c.bveResolveAnimation(profile,'idle').cssClass,'bs-anim-play-idle-float');
});
