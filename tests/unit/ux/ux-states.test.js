const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function setup(){
 const dom=new JSDOM('<!doctype html><body><main id="page"><p>Existing data</p></main><div class="form-group"><input id="title" aria-describedby="help"><small id="help">Help</small></div><input type="password" id="password" value="DO-NOT-CAPTURE"></body>',{url:'https://school.example',runScripts:'outside-only'}),w=dom.window,subscribers={},timers=new Map();let next=0;
 w.currentUser={id:'teacher-a'};w.currentRole='teacher';w.AppStore={subscribe:(key,fn)=>subscribers[key]=fn};
 w.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next;};w.clearTimeout=id=>timers.delete(id);
 w.eval(fs.readFileSync('modules/shared/ux-states.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 return {w,dom,timers,boot:()=>subscribers['ux-states']({}, {type:'session:booted'}),run:ms=>{for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
test('states use text content, actionable recovery and preserve accessible field descriptions',()=>{
 const {w,dom}=setup(),page=w.document.getElementById('page');let acted=false;
 w.UXStates.render(page,'zero',{title:'<img src=x onerror=bad()>',actionLabel:'Clear filters',onAction:()=>acted=true});assert.equal(page.querySelector('img'),null);page.querySelector('button').click();assert.ok(acted);
 w.UXStates.fieldError('title','A title is required.');const field=w.document.getElementById('title');assert.equal(field.getAttribute('aria-invalid'),'true');assert.equal(field.getAttribute('aria-describedby'),'help title-ux-error');
 field.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(field.getAttribute('aria-describedby'),'help');assert.equal(field.hasAttribute('aria-invalid'),false);dom.window.close();
});
test('slow reads retain existing data, deduplicate requests, and expose retry after failure',async()=>{
 const {w,dom,run}=setup(),page=w.document.getElementById('page');let reject,calls=0,retried=false;
 const fn=()=>{calls++;return new Promise((_,r)=>reject=r);};const first=w.UXStates.task(page,'Updating section',fn,{retry:()=>retried=true});const second=w.UXStates.task(page,'Updating section',fn);
 assert.equal(calls,1);run(5000);assert.match(page.textContent,/taking longer|longer to respond/i);assert.match(page.textContent,/Existing data/);assert.equal(page.getAttribute('aria-busy'),'true');
 reject(new Error('Failed to fetch'));await Promise.all([first,second]);assert.equal(page.hasAttribute('aria-busy'),false);assert.match(page.textContent,/Connection interrupted/);page.querySelector('button').click();assert.ok(retried);dom.window.close();
});
test('an earlier account request cannot clear the loading state of a newer account request',async()=>{
 const {w,dom}=setup(),page=w.document.getElementById('page');let finishA,finishB;
 const a=w.UXStates.task(page,'A',()=>new Promise(r=>finishA=r),{scope:'a'});const b=w.UXStates.task(page,'B',()=>new Promise(r=>finishB=r),{scope:'b'});
 finishA('A');await a;assert.equal(page.getAttribute('aria-busy'),'true');assert.equal(page.querySelectorAll('.ux-request').length,1);finishB('B');await b;assert.equal(page.hasAttribute('aria-busy'),false);dom.window.close();
});
test('permission, expired session and network failures have distinct recovery explanations',()=>{
 const {w,dom}=setup();assert.equal(w.UXStates.explain({code:'42501',message:'permission denied'}).type,'permission');assert.match(w.UXStates.explain({name:'NotAllowedError'}).description,/browser settings/);assert.match(w.UXStates.explain({message:'JWT expired'}).title,/sign in again/);assert.equal(w.UXStates.explain(new Error('Failed to fetch')).type,'offline');dom.window.close();
});
test('editor recovery is tab-local, owner/role scoped, expiring and never restores automatically',async()=>{
 const {w,dom,boot}=setup();let restored=null;w.UXStates.registerDraft('quest',{label:'quest',get:()=>({title:'Biology draft'}),restore:data=>restored=data});assert.equal(w.UXStates.capture(),1);const key='eq-editor-recovery-v1:teacher-a',raw=w.sessionStorage.getItem(key);assert.ok(raw.includes('Biology draft'));assert.ok(!raw.includes('DO-NOT-CAPTURE'));
 w.currentUser={id:'teacher-b'};boot();await w.UXStates.resume('quest');assert.equal(restored,null);assert.equal(w.document.querySelector('#ux-recovery'),null);
 w.currentUser={id:'teacher-a'};w.currentRole='student';await w.UXStates.resume('quest');assert.equal(restored,null);w.currentRole='teacher';boot();assert.ok(w.document.querySelector('#ux-recovery'));assert.equal(restored,null);await w.UXStates.resume('quest');assert.equal(restored.title,'Biology draft');assert.equal(w.sessionStorage.getItem(key),null);
 w.sessionStorage.setItem(key,JSON.stringify({...JSON.parse(raw),savedAt:Date.now()-13*3600000}));await w.UXStates.resume('quest');assert.equal(w.document.querySelector('#ux-recovery'),null);dom.window.close();
});
test('session expiry captures editor data before teardown; explicit logout clears recovery',()=>{
 const {w,dom,boot,run}=setup();let listener,clear=false;
 w.DBService={getAuthClient:()=>({auth:{onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe(){}}}};}}})};
 w.UXStates.registerDraft('quest',{label:'quest',get:()=>clear?null:{title:'Unsaved work'},clear:()=>clear=true,restore(){}});
 w.doLogout=opts=>{w.UXStates.onLogout(opts.expired);w.currentUser=null;};boot();listener('SIGNED_OUT');assert.ok(w.sessionStorage.getItem('eq-editor-recovery-v1:teacher-a'));assert.equal(clear,false);run(0);assert.ok(clear);assert.match(w.document.getElementById('ux-session').textContent,/same account/);
 w.currentUser={id:'teacher-a'};boot();w.UXStates.onLogout(false);assert.equal(w.sessionStorage.getItem('eq-editor-recovery-v1:teacher-a'),null);dom.window.close();
});
test('button loading preserves disabled/width/ARIA, escapes labels, and suppresses duplicate actions',async()=>{
 const {w,dom,run}=setup();w.eval(fs.readFileSync('modules/shared/button-loading.js','utf8'));const b=w.document.createElement('button');b.innerHTML='<strong>Save</strong>';b.disabled=true;b.style.minWidth='80px';b.setAttribute('aria-busy','false');w.document.body.append(b);
 w.eqButtonLoading(b,true,{label:'<img src=x>'});assert.equal(b.querySelector('img'),null);run(5000);assert.match(b.textContent,/Still working/);w.eqButtonLoading(b,false);assert.equal(b.innerHTML,'<strong>Save</strong>');assert.ok(b.disabled);assert.equal(b.style.minWidth,'80px');assert.equal(b.getAttribute('aria-busy'),'false');
 b.disabled=false;let resolve,calls=0;const first=w.eqWithButtonLoading(b,'Saving',()=>{calls++;return new Promise(r=>resolve=r);});const second=w.eqWithButtonLoading(b,'Saving',()=>calls++);await Promise.resolve();assert.equal(calls,1);resolve('confirmed');assert.deepEqual(await Promise.all([first,second]),['confirmed','confirmed']);assert.equal(b.disabled,false);dom.window.close();
});

test('failed restoration preserves its backup; a completed restore never deletes another account backup',async()=>{
 const {w,dom}=setup();w.UXStates.registerDraft('quest',{label:'quest',get:()=>({title:'Keep me'}),restore:async()=>{throw new Error('Content unavailable');}});w.UXStates.capture();await w.UXStates.resume('quest');assert.ok(w.sessionStorage.getItem('eq-editor-recovery-v1:teacher-a'));assert.match(w.document.getElementById('ux-feedback').textContent,/still saved/);
 let done;w.UXStates.registerDraft('quest',{label:'quest',get:()=>null,restore:()=>new Promise(r=>done=r)});const pending=w.UXStates.resume('quest');w.currentUser={id:'teacher-b'};done();await pending;assert.ok(w.sessionStorage.getItem('eq-editor-recovery-v1:teacher-a'));dom.window.close();
});
test('storage failure does not promise that a draft was recovered',()=>{
 const {w,dom}=setup();Object.defineProperty(w,'sessionStorage',{value:{getItem:()=>null,setItem(){throw new Error('Quota exceeded');},removeItem(){}}});w.UXStates.registerDraft('quest',{label:'quest',get:()=>({title:'Draft'}),clear(){},restore(){}});assert.equal(w.UXStates.capture(),0);w.UXStates.onLogout(true);assert.match(w.document.getElementById('ux-session').textContent,/may not be available/);dom.window.close();
});
