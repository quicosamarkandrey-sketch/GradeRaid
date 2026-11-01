/* Student title collection: presentation and discovery only. Equip/unlock rules
   remain in the title service; filters are scoped to the current student. */
;(function(){
 'use strict';
 const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const ranks=['Common','Uncommon','Rare','Epic','Legendary','Mythic'];
 const svg=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
 const medal=()=>svg('M8 3 5 9l7 12 7-12-3-6 M5 9h14 M8 3h8 M12 9v12');
 let owner=null,filter='all',query='';
 function reset(st){if(owner!==st.id){owner=st.id;filter='all';query='';}}
 const tone=title=>_cssColor(title.primaryColor||title.borderColor,'#89b7fa');
 function state(){const st=currentUser,unlocked=tsGetUnlockedTitles(st.id),ids=new Set(unlocked.map(t=>t.id));return {st,unlocked,titles:AppStore.getSlice(s=>s.titles||[]).filter(t=>t.active&&_tsTitleVisibleToStudent(t,st,ids)),equipped:AppStore.getSlice(s=>s.equippedTitles?.[st.id])};}
 function cards(st,titles,unlocked,equipped){
  const owned=new Set(unlocked.map(t=>t.id));
  const list=titles.filter(t=>(filter==='all'||(filter==='unlocked'?owned.has(t.id):!owned.has(t.id)))&&(t.name+' '+(t.description||'')).toLowerCase().includes(query.trim().toLowerCase()));
  list.sort((a,b)=>Number(b.id===equipped)-Number(a.id===equipped)||Number(owned.has(b.id))-Number(owned.has(a.id))||ranks.indexOf(b.rarity)-ranks.indexOf(a.rarity)||String(a.name).localeCompare(String(b.name)));
  if(!list.length)return `<div class="tc-empty">${medal()}<h3>${titles.length?'No titles match this view.':'Your collection starts here.'}</h3><p>${titles.length?'Try another search or show all titles.':'Earn recognition in class. Your teacher’s titles will appear here.'}</p>${titles.length?'<button type="button" class="btn btn-ghost" data-tc-action="clear">Show all titles</button>':''}</div>`;
  return `<div class="tc-grid">${list.map(t=>{const isOwned=owned.has(t.id),isEquipped=equipped===t.id,rarity=ranks.includes(t.rarity)?t.rarity:'Common';return `<article class="tc-card${isEquipped?' is-equipped':''}${isOwned?'':' is-locked'}" style="--tc-accent:${tone(t)}"><div class="tc-card-art"><div class="tc-art-grid" aria-hidden="true"></div><span class="tc-rarity">${esc(rarity)}</span>${isEquipped?'<span class="tc-equipped-tag">✓ Equipped</span>':''}<div class="tc-badge-stage">${tsBuildBadgeHTML(t,{noParticles:true})}</div><span class="tc-art-caption">${esc(tsGetFrameShape(t.frameShape).label)} edition</span></div><div class="tc-card-body"><h3>${esc(t.name)}</h3><p class="tc-description">${esc(t.description||'A signature for the effort you put in.')}</p><p class="tc-requirement${isOwned?' is-unlocked':''}">${isOwned?'✓ In your collection':esc(_getTitleReqText(t))}</p><div class="tc-card-actions"><button type="button" class="tc-preview-btn" data-tc-action="preview" data-id="${esc(t.id)}" aria-label="Preview ${esc(t.name)}">Preview</button>${isOwned?`<button type="button" class="tc-equip-btn${isEquipped?' is-equipped':''}" data-tc-action="${isEquipped?'unequip':'equip'}" data-id="${esc(t.id)}">${isEquipped?'Unequip':'Equip title'}</button>`:'<span class="tc-locked-label">Locked</span>'}</div></div></article>`;}).join('')}</div>`;
 }
 function build(st,titles,unlocked,equipped){
  reset(st);const owned=new Set(unlocked.map(t=>t.id)),active=titles.find(t=>t.id===equipped),count=titles.filter(t=>owned.has(t.id)).length;
  return `<div class="title-collection"><header class="tc-intro"><div><span class="tc-eyebrow">Personal recognition</span><h2>Find your signature.</h2><p>A title is a little story about what you’ve accomplished.</p></div><div class="tc-collection-count"><strong>${count}<small> / ${titles.length}</small></strong><span>titles collected</span></div></header><section class="tc-profile-preview" style="--tc-accent:${active?tone(active):'#91a8d0'}"><div class="tc-profile-copy"><span class="tc-eyebrow">${active?'Your equipped title':'Make it yours'}</span><div class="tc-profile-name"><span class="tc-avatar">${esc(st.init||(st.name||'?').slice(0,2))}</span><strong>${esc(st.name||'Your profile')}</strong></div><p>${active?'Shown beside your name on your profile, sidebar, and class rankings.':'Choose an unlocked title below to give your profile a signature.'}</p>${active?'<button type="button" class="tc-text-button" data-tc-action="unequip">Remove equipped title</button>':''}</div><div class="tc-profile-stage">${active?tsBuildBadgeHTML(active,{noParticles:true}):`<div class="tc-placeholder">${medal()}<span>Your next title belongs here</span></div>`}</div></section><div class="tc-toolbar"><div class="tc-filters" role="group" aria-label="Filter titles">${[['all','All titles',titles.length],['unlocked','Unlocked',count],['locked','To unlock',titles.length-count]].map(([id,label,n])=>`<button type="button" data-tc-action="filter" data-filter="${id}" aria-pressed="${filter===id}">${label}<span>${n}</span></button>`).join('')}</div><label class="tc-search"><span>Search titles</span><input id="tc-title-search" type="search" placeholder="Find a title" value="${esc(query)}" aria-label="Search titles"></label></div><div id="tc-title-results" aria-live="polite">${cards(st,titles,unlocked,equipped)}</div></div>`;
 }
 function refresh(){const data=state(),panel=document.getElementById('ts-tab-titles');if(panel)panel.innerHTML=build(data.st,data.titles,data.unlocked,data.equipped);}
 function preview(id){
  const data=state(),title=data.titles.find(t=>t.id===id);if(!title)return;
  const owned=data.unlocked.some(t=>t.id===id),equipped=data.equipped===id;
  showModal(`<div class="tc-preview-modal" style="--tc-accent:${tone(title)}"><span class="tc-eyebrow">Title preview · ${esc(title.rarity||'Common')}</span><h2>${esc(title.name)}</h2><p>${esc(title.description||'Your effort, made visible.')}</p><div class="tc-modal-stage">${tsBuildBadgeHTML(title)}</div><div class="tc-preview-context"><span>On your profile</span><div><strong>${esc(data.st.name)}</strong>${tsBuildBadgeHTML(title,{small:true,noParticles:true})}</div><span>Beside your name</span><div><strong>${esc(data.st.init||'You')}</strong>${tsBuildBadgeHTML(title,{xs:true,noParticles:true})}</div></div><p class="tc-preview-requirement">${owned?'Unlocked and ready to wear.':esc(_getTitleReqText(title))}</p><div class="modal-actions"><button type="button" class="btn btn-ghost" data-tc-action="close-preview">Close</button>${owned?`<button type="button" class="btn btn-primary" data-tc-action="${equipped?'unequip-preview':'equip-preview'}" data-id="${esc(id)}">${equipped?'Unequip title':'Equip this title'}</button>`:''}</div></div>`,'md');
 }
 document.addEventListener('click',event=>{
  const el=event.target.closest('[data-tc-action]');if(!el||el.disabled)return;
  if(typeof currentRole==='undefined'||currentRole!=='student'||!currentUser)return;
  reset(currentUser);const action=el.dataset.tcAction;
  if(action==='close-preview')return closeModalForce();
  if(action==='preview')return preview(el.dataset.id);
  if(action==='equip'||action==='equip-preview'){const d=state();if(!d.titles.some(t=>t.id===el.dataset.id)||!d.unlocked.some(t=>t.id===el.dataset.id))return;if(action==='equip-preview')closeModalForce();return tsStudentEquip(el.dataset.id);}
  if(action==='unequip'||action==='unequip-preview'){if(action==='unequip-preview')closeModalForce();return tsStudentUnequip();}
  if(action==='filter'){filter=el.dataset.filter;return refresh();}
  if(action==='clear'){filter='all';query='';refresh();}
 },true);
 document.addEventListener('input',event=>{if(event.target.id!=='tc-title-search'||!currentUser)return;reset(currentUser);query=event.target.value;const d=state(),results=document.getElementById('tc-title-results');if(results)results.innerHTML=cards(d.st,d.titles,d.unlocked,d.equipped);});
 document.addEventListener('keydown',event=>{if(!['tab-badges-btn','tab-titles-btn'].includes(event.target.id)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tab=event.key==='Home'?'badges':event.key==='End'?'titles':event.target.id==='tab-badges-btn'?'titles':'badges';tsTabSwitch(tab);document.getElementById('tab-'+tab+'-btn')?.focus();});
 window.TitleCollection=Object.freeze({build,preview,refresh});
})();
