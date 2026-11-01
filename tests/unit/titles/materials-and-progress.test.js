const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function setup(){const state={achievements:[{id:'auto',name:'Ten contributions',active:true,triggerType:'recitations',triggerValue:10},{id:'manual',name:'Teacher choice',active:true,triggerType:'manual'}],achievementUnlocks:{s:[]}};const c={document:{addEventListener:()=>{}},AppStore:{getSlice:fn=>structuredClone(fn(state))},_getTitleReqText:()=> 'Earn the achievement',currentUser:{id:'s'},currentRole:'student'};c.window=c;vm.runInNewContext(fs.readFileSync('modules/titles/title-materials.js','utf8'),c);vm.runInNewContext(fs.readFileSync('modules/titles/titles-collection.js','utf8'),c);return {c,state};}
test('teacher-granted titles never turn a large statistic into automatic progress or ownership',()=>{
 const {c,state}=setup();const before=JSON.stringify(state);for(const t of [{id:'t'},{id:'t',achievementId:'manual'}]){const result=c.TitleCollection.progressInfo(t,{id:'s'},false,{recitation_count:9999,xp:999999});assert.equal(result.kind,'manual');assert.equal(result.percent,undefined);}assert.equal(JSON.stringify(state),before);
});
test('achievement-linked title progress reads the existing metric and claiming state without granting anything',()=>{
 const {c,state}=setup();const t={id:'t',achievementId:'auto'};assert.equal(c.TitleCollection.progressInfo(t,{id:'s'},false,{recitation_count:4}).percent,40);state.achievementUnlocks.s=[{achId:'auto'}];assert.equal(c.TitleCollection.progressInfo(t,{id:'s'},false,{}).kind,'claim');assert.equal(c.TitleCollection.progressInfo(t,{id:'s'},true,{}).kind,'owned');
});
test('material SVGs have distinct artwork, safe colors, unique gradient IDs and no emoji text',()=>{
 const {c}=setup(),ids=new Set();for(const kind of ['flame','shield','crystal','shadow','smoke']){const markup=c.tsBuildMaterialFrame(kind,{primary:'#99bbff',accent:'#eaf5ff',border:'#6688aa',bg:'#112233'},false),doc=new JSDOM(markup).window.document;assert.equal(doc.querySelectorAll('svg').length,1);assert.ok(doc.querySelectorAll('path').length>1);assert.ok(!/\p{Extended_Pictographic}/u.test(doc.body.textContent));for(const el of doc.querySelectorAll('[id]')){assert.equal(ids.has(el.id),false);ids.add(el.id);}}
 const attack=new JSDOM(c.tsBuildMaterialFrame('shield',{primary:'" onload="bad()',accent:'#fff',border:'#aaa',bg:'#000'},false)).window.document;assert.equal(attack.querySelectorAll('[onload]').length,0);
});
test('still/compact material rendering omits drifting, glint and ward layers',()=>{
 const {c}=setup();for(const kind of ['shield','crystal','shadow','smoke']){const d=new JSDOM(c.tsBuildMaterialFrame(kind,{primary:'#abc',accent:'#fff',border:'#aaa',bg:'#000'},true)).window.document;assert.equal(d.querySelectorAll('.tsm-shield-ward,.tsm-crystal-refraction,.tsm-shadow-ribbon,.tsm-smoke-roll').length,0);}
});
