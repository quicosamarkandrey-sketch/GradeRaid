/* Student title collection: presentation and discovery only. Equip/unlock rules
   remain in the title service; filters are scoped to the current student. */
;(function(){
 'use strict';
 const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const ranks=['Common','Uncommon','Rare','Epic','Legendary','Mythic'];
 const svg=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
 const medal=()=>svg('M8 3 5 9l7 12 7-12-3-6 M5 9h14 M8 3h8 M12 9v12');
 let owner=null,filter='all',query='',family='all';
 function reset(st){if(owner!==st.id){owner=st.id;filter='all';query='';family='all';}}
 const tone=title=>_cssColor(title.primaryColor||title.borderColor,'#89b7fa');
 function state(){const st=currentUser,unlocked=tsGetUnlockedTitles(st.id),ids=new Set(unlocked.map(t=>t.id));return {st,unlocked,titles:AppStore.getSlice(s=>s.titles||[]).filter(t=>t.active&&_tsTitleVisibleToStudent(t,st,ids)),equipped:AppStore.getSlice(s=>s.equippedTitles?.[st.id])};}
 function familyInfo(title){
  const meta=window.TitleRecords?.meta(title.id)||{};
  if(meta.family||meta.season)return {label:(meta.family||'Seasonal recognition')+(meta.season?' · '+meta.season:''),key:JSON.stringify([title.ownerTeacherId||'school',meta.family||'season',meta.season||'']),stage:meta.stage||1,explicit:!!meta.family};
  const achievement=AppStore.getSlice(s=>(s.achievements||[]).find(a=>a.id===title.achievementId));
  return {label:title.achievementId?(achievement?.category||'Achievement titles'):'Teacher recognition',key:title.achievementId?'achievement:'+(achievement?.category||'all'):'teacher',explicit:false};
 }
 function progressInfo(title,st,isOwned,stats){
  if(isOwned)return {label:'In your collection',kind:'owned'};
  if(!title.achievementId)return {label:'Teacher grant only',detail:'Awarded by your teacher. Points do not unlock this title automatically.',kind:'manual'};
  const ach=AppStore.getSlice(s=>(s.achievements||[]).find(a=>a.id===title.achievementId));
  if(!ach||ach.triggerType==='manual')return {label:'Teacher recognition required',detail:_getTitleReqText(title),kind:'manual'};
  const unlocked=(AppStore.getSlice(s=>s.achievementUnlocks?.[st.id])||[]).some(a=>a.achId===ach.id);
  if(unlocked)return {label:'Achievement earned',detail:'Claim the linked achievement to receive its title.',kind:'claim'};
  const keys={level:'level',xp_earned:'xp',coins_earned:'coins',coins_spent:'coins_spent',quests_completed:'quests_completed',quiz_score:'best_quiz_score',quiz_avg:'quizAvg',perfect_streak:'perfect_streak',boss_victories:'boss_victories',boss_damage:'boss_damage',boss_crits:'boss_crits',minions_killed:'minions_killed',attendance_present:'attendance_present',attendance_pct:'attendance',store_purchases:'store_purchases',recitations:'recitation_count',quest_chains_completed:'quest_chains_completed',quest_streak:'quest_streak'};
  const target=ach.triggerType==='all_quests'?Number(stats.total_quests):Number(ach.triggerValue),value=Number(stats[ach.triggerType==='all_quests'?'quests_completed':keys[ach.triggerType]]);
  if(!Number.isFinite(target)||target<=0||!Number.isFinite(value))return {label:_getTitleReqText(title),kind:'unknown'};
  return {label:Math.min(value,target).toLocaleString()+' / '+target.toLocaleString()+' toward '+ach.name,detail:value>=target?'Requirement met. Complete and claim the achievement to unlock.':_getTitleReqText(title),percent:Math.min(100,Math.max(0,value/target*100)),kind:'progress'};
 }
 function renderProgress(info){return `<div class="tc-unlock-progress"><strong>${esc(info.label)}</strong>${info.percent!==undefined?`<div class="tc-progress-track" role="progressbar" aria-label="Title unlock progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(info.percent)}"><i style="width:${info.percent}%"></i></div>`:''}${info.detail?`<span>${esc(info.detail)}</span>`:''}</div>`;}
 function dateLabel(value){const date=new Date(value);return value&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('en',{dateStyle:'medium',timeZone:'Asia/Manila'}).format(date):'';}
 function renderHistory(title){
  const rows=window.TitleRecords?.history(title.id)||[],legacyDate=window.TitleRecords?.earned(title.id);
  if(!rows.length)return legacyDate?`<section class="tc-award-history"><h3>Your award record</h3><p>Earned ${esc(dateLabel(legacyDate))}. Earlier award details were not recorded.</p></section>`:'';
  return `<section class="tc-award-history"><h3>Your award history</h3>${rows.map(row=>`<div><strong>${row.event==='revoked'?'Title revoked':'Title earned'}${row.actor_name?' · '+esc(row.actor_name):''}</strong><time>${esc(dateLabel(row.created_at))}</time><span>${row.source==='teacher'?'Teacher recognition':row.source==='achievement'?'Achievement unlock':'Recorded reward'}</span>${row.description?`<p>${esc(row.description)}</p>`:''}</div>`).join('')}</section>`;
 }
 function renderPath(title,titles,unlocked){
  const family=familyInfo(title);if(!family.explicit)return '';
  const path=titles.filter(t=>familyInfo(t).key===family.key).sort((a,b)=>familyInfo(a).stage-familyInfo(b).stage);
  if(path.length<2)return '';const ids=new Set(unlocked.map(t=>t.id)),earned=path.filter(t=>ids.has(t.id)),highest=earned.at(-1);
  return `<section class="tc-evolution"><h3>${esc(family.label)}</h3><p>${highest?'Your highest earned rank: '+esc(highest.name)+'.':'Your title journey starts with its first award.'} Each stage keeps its own achievement or teacher-grant requirement.</p><ol>${path.map(t=>`<li class="${ids.has(t.id)?'is-earned':''}${t.id===title.id?' is-current':''}"><span>${familyInfo(t).stage}</span><div><strong>${esc(t.name)}</strong><small>${ids.has(t.id)?'Earned':t.achievementId?'Achievement required':'Teacher grant required'}</small></div></li>`).join('')}</ol></section>`;
 }

 function cards(st,titles,unlocked,equipped){
  const owned=new Set(unlocked.map(t=>t.id)),stats=typeof achBuildStats==='function'?achBuildStats(st):{};
  const list=titles.filter(t=>(filter==='all'||(filter==='unlocked'?owned.has(t.id):!owned.has(t.id)))&&(family==='all'||familyInfo(t).key===family)&&(t.name+' '+(t.description||'')).toLowerCase().includes(query.trim().toLowerCase()));
  list.sort((a,b)=>Number(b.id===equipped)-Number(a.id===equipped)||Number(owned.has(b.id))-Number(owned.has(a.id))||ranks.indexOf(b.rarity)-ranks.indexOf(a.rarity)||String(a.name).localeCompare(String(b.name)));
  if(!list.length)return `<div class="tc-empty">${medal()}<h3>${titles.length?'No titles match this view.':'Your collection starts here.'}</h3><p>${titles.length?'Try another search or show all titles.':'Earn recognition in class. Your teacher’s titles will appear here.'}</p>${titles.length?'<button type="button" class="btn btn-ghost" data-tc-action="clear">Show all titles</button>':''}</div>`;
  return `<div class="tc-grid">${list.map(t=>{const isOwned=owned.has(t.id),isEquipped=equipped===t.id,rarity=ranks.includes(t.rarity)?t.rarity:'Common';const info=progressInfo(t,st,isOwned,stats);return `<article class="tc-card${isEquipped?' is-equipped':''}${isOwned?'':' is-locked'}" style="--tc-accent:${tone(t)}"><div class="tc-card-art"><div class="tc-art-grid" aria-hidden="true"></div><span class="tc-rarity">${esc(rarity)}</span>${isEquipped?'<span class="tc-equipped-tag">✓ Equipped</span>':''}<div class="tc-badge-stage">${tsBuildBadgeHTML(t,{noParticles:true})}</div><span class="tc-art-caption">${esc(window.tsTitleMaterial?.(t)||tsGetFrameShape(t.frameShape).label)} edition</span></div><div class="tc-card-body"><h3>${esc(t.name)}</h3><p class="tc-description">${esc(t.description||'A signature for the effort you put in.')}</p>${isOwned?'<p class="tc-requirement is-unlocked">✓ In your collection</p>':''}${!isOwned?renderProgress(info):''}<div class="tc-card-actions"><button type="button" class="tc-preview-btn" data-tc-action="preview" data-id="${esc(t.id)}" aria-label="Preview ${esc(t.name)}">Preview</button>${isOwned?`<button type="button" class="tc-equip-btn${isEquipped?' is-equipped':''}" data-tc-action="${isEquipped?'unequip':'equip'}" data-id="${esc(t.id)}">${isEquipped?'Unequip':'Equip title'}</button>`:'<span class="tc-locked-label">Locked</span>'}</div></div></article>`;}).join('')}</div>`;
 }
 function build(st,titles,unlocked,equipped){
  reset(st);if(family!=='all'&&!titles.some(t=>familyInfo(t).key===family))family='all';const owned=new Set(unlocked.map(t=>t.id)),active=titles.find(t=>t.id===equipped),count=titles.filter(t=>owned.has(t.id)).length;
  return `<div class="title-collection"><header class="tc-intro"><div><span class="tc-eyebrow">Personal recognition</span><h2>Find your signature.</h2><p>A title is a little story about what you’ve accomplished.</p></div><div class="tc-collection-count"><strong>${count}<small> / ${titles.length}</small></strong><span>titles collected</span></div></header><section class="tc-profile-preview" style="--tc-accent:${active?tone(active):'#91a8d0'}"><div class="tc-profile-copy"><span class="tc-eyebrow">${active?'Your equipped title':'Make it yours'}</span><div class="tc-profile-name"><span class="tc-avatar">${esc(st.init||(st.name||'?').slice(0,2))}</span><strong>${esc(st.name||'Your profile')}</strong></div><p>${active?'Shown beside your name on your profile, sidebar, and class rankings.':'Choose an unlocked title below to give your profile a signature.'}</p>${active?'<button type="button" class="tc-text-button" data-tc-action="unequip">Remove equipped title</button>':''}</div><div class="tc-profile-stage">${active?tsBuildBadgeHTML(active,{noParticles:true}):`<div class="tc-placeholder">${medal()}<span>Your next title belongs here</span></div>`}</div></section><div class="tc-toolbar"><div class="tc-filters" role="group" aria-label="Filter titles">${[['all','All titles',titles.length],['unlocked','Unlocked',count],['locked','To unlock',titles.length-count]].map(([id,label,n])=>`<button type="button" data-tc-action="filter" data-filter="${id}" aria-pressed="${filter===id}">${label}<span>${n}</span></button>`).join('')}</div><label class="tc-family-filter"><span>Collection</span><select id="tc-family-filter" aria-label="Filter title collections"><option value="all">All collections</option>${[...new Map(titles.map(t=>{const f=familyInfo(t);return [f.key,f.label];})).entries()].map(([key,label])=>`<option value="${esc(key)}" ${family===key?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label class="tc-search"><span>Search titles</span><input id="tc-title-search" type="search" placeholder="Find a title" value="${esc(query)}" aria-label="Search titles"></label></div><div id="tc-title-results" aria-live="polite">${cards(st,titles,unlocked,equipped)}</div></div>`;
 }
 function refresh(){const data=state(),panel=document.getElementById('ts-tab-titles');if(panel)panel.innerHTML=build(data.st,data.titles,data.unlocked,data.equipped);}
 function preview(id){
  const data=state(),title=data.titles.find(t=>t.id===id);if(!title)return;
  const owned=data.unlocked.some(t=>t.id===id),equipped=data.equipped===id;
  showModal(`<div class="tc-preview-modal" style="--tc-accent:${tone(title)}"><span class="tc-eyebrow">Title preview · ${esc(title.rarity||'Common')}</span><h2>${esc(title.name)}</h2><p>${esc(title.description||'Your effort, made visible.')}</p><div class="tc-modal-stage">${tsBuildBadgeHTML(title)}</div><div class="tc-preview-context"><span>On your profile</span><div><strong>${esc(data.st.name)}</strong>${tsBuildBadgeHTML(title,{small:true,noParticles:true})}</div><span>Beside your name</span><div><strong>${esc(data.st.init||'You')}</strong>${tsBuildBadgeHTML(title,{xs:true,noParticles:true})}</div></div><p class="tc-preview-requirement">${owned?'Unlocked and ready to wear.':esc(!title.achievementId?'Teacher grant only. Your teacher decides when to award this title.':_getTitleReqText(title))}</p>${!owned?renderProgress(progressInfo(title,data.st,false,typeof achBuildStats==='function'?achBuildStats(data.st):{})):''}${renderPath(title,data.titles,data.unlocked)}${renderHistory(title)}<div class="modal-actions"><button type="button" class="btn btn-ghost" data-tc-action="close-preview">Close</button>${owned?`<button type="button" class="btn btn-primary" data-tc-action="${equipped?'unequip-preview':'equip-preview'}" data-id="${esc(id)}">${equipped?'Unequip title':'Equip this title'}</button>`:''}</div></div>`,'md');
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
  if(action==='clear'){filter='all';query='';family='all';refresh();}
 },true);
 document.addEventListener('input',event=>{if(event.target.id!=='tc-title-search'||!currentUser)return;reset(currentUser);query=event.target.value;const d=state(),results=document.getElementById('tc-title-results');if(results)results.innerHTML=cards(d.st,d.titles,d.unlocked,d.equipped);});
 document.addEventListener('change',event=>{if(event.target.id==='tc-family-filter'){family=event.target.value;refresh();}});
 document.addEventListener('titles:records-loaded',()=>{if(typeof currentRole!=='undefined'&&currentRole==='student'&&document.getElementById('s-badges')?.classList.contains('active')&&document.getElementById('ts-tab-titles')?.classList.contains('active')&&document.activeElement?.id!=='tc-title-search')refresh();});
 document.addEventListener('keydown',event=>{if(!['tab-badges-btn','tab-titles-btn'].includes(event.target.id)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tab=event.key==='Home'?'badges':event.key==='End'?'titles':event.target.id==='tab-badges-btn'?'titles':'badges';tsTabSwitch(tab);document.getElementById('tab-'+tab+'-btn')?.focus();});
 window.TitleCollection=Object.freeze({build,preview,refresh,progressInfo,familyInfo});
})();
