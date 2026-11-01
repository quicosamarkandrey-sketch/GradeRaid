const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function renderer(){const c={console:{log:()=>{}},uid:()=> 'new-title',_esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),_cssColor:(value,fallback)=>/^#[a-f0-9]{3,8}$/i.test(value||'')?value:fallback};c.window=c;vm.runInNewContext(fs.readFileSync('modules/titles/titles_badge_renderer.js','utf8'),c);return c;}
test('title presentation recovers unreadable text without changing authored data',()=>{
 const r=renderer(),t=Object.freeze({name:'Bright plate',rarity:'Rare',bgColor:'#fff',textColor:'#fff',borderColor:'#7799cc',frameShape:'rectangle'});
 const doc=new JSDOM(r.tsBuildBadgeHTML(t)).window.document;
 assert.equal(doc.querySelector('.ts-badge-text').style.color,'rgb(0, 0, 0)');assert.equal(t.textColor,'#fff');assert.equal(t.bgColor,'#fff');
});
test('small and xs titles omit expensive animated content even when callers do not specify noParticles',()=>{
 const r=renderer(),t={name:'A blazing title',rarity:'Mythic',icon:'🔥',particles:'embers',effect:'embers',animation:'pulse',borderColor:'#ff8800'};
 for(const opts of [{small:true},{xs:true}]){const d=new JSDOM(r.tsBuildBadgeHTML(t,opts)).window.document;assert.equal(d.querySelectorAll('.ts-particle,.ts-fx-layer,.ts-rarity-overlay-host').length,0);assert.equal(d.querySelector('.ts-badge-text').textContent,t.name);}
});
test('names, icons and legacy class strings cannot become executable title markup',()=>{
 const r=renderer(),d=new JSDOM(r.tsBuildBadgeHTML({name:'<img src=x onerror="bad()">',icon:'<svg onload="bad()">',rarity:'Rare" onclick="bad()',animation:'pulse" onmouseover="bad()',borderColor:'#4477cc'})).window.document;
 assert.equal(d.querySelectorAll('img,[onerror],[onload],[onclick],[onmouseover]').length,0);assert.match(d.querySelector('.ts-badge-text').textContent,/<img/);
});

test('midtone backgrounds receive a contrasting foreground rather than another low-contrast shade',()=>{
 const r=renderer();for(const bgColor of ['#777777','#888888']){const d=new JSDOM(r.tsBuildBadgeHTML({name:'Readable',bgColor,textColor:bgColor})).window.document;assert.equal(d.querySelector('.ts-badge-text').style.color,'rgb(0, 0, 0)');}
});
