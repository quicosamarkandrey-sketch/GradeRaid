/* Presentation only. No answers, damage, hearts, loot or timers are decided here. */
(function(){
 'use strict';
 const A=()=>window.BossMotionAssets;
 const levels={light:{fps:30,resolution:1,particles:80,bytes:16*1024*1024},standard:{fps:45,resolution:1.5,particles:180,bytes:40*1024*1024},high:{fps:60,resolution:2,particles:320,bytes:64*1024*1024}};
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 let loading=null,battle=null,preview=null,defeated=null,failedKey=null;
 function preference(){try{return localStorage.getItem('eq-raid-effects')||'auto';}catch{return 'auto';}}
 function effective(){const p=preference();if(p==='off'||reduced())return 'off';if(levels[p])return p;return (navigator.deviceMemory&&navigator.deviceMemory<=4)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4)||innerWidth<700?'light':'standard';}
 function engine(){
  if(window.EQPIXI)return Promise.resolve(window.EQPIXI);if(loading)return loading;
  loading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('assets/vendor/pixi-runtime.min.js',document.baseURI).href;script.async=true;const timer=setTimeout(()=>{script.remove();reject(new Error('Graphics engine timed out.'));},15000);script.onload=()=>{clearTimeout(timer);window.EQPIXI?resolve(window.EQPIXI):reject(new Error('Graphics engine unavailable.'));};script.onerror=()=>{clearTimeout(timer);reject(new Error('Graphics engine could not load.'));};document.head.append(script);}).catch(e=>{loading=null;throw e;});return loading;
 }
 async function download(url,signal,limit){
  const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,15000);if(signal.aborted)controller.abort();signal.addEventListener('abort',cancel,{once:true});
  try{const response=await fetch(url,{signal:controller.signal,credentials:'omit'});if(!response.ok)throw new Error('Asset could not load ('+response.status+').');
  if(Number(response.headers.get('content-length'))>limit)throw new Error('Asset download exceeds the size limit.');
  if(!response.body){const blob=await response.blob();if(blob.size>limit)throw new Error('Asset download exceeds the size limit.');return blob;}
  const reader=response.body.getReader(),chunks=[];let length=0;try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>limit){await reader.cancel();throw new Error('Asset download exceeds the size limit.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
  }catch(e){if(controller.signal.aborted&&!signal.aborted)throw new Error('Asset download timed out.');throw e;}finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
 }
 async function json(url,signal){return JSON.parse(await (await download(url,signal,524288)).text());}
 async function image(url,signal){
  const blob=await download(url,signal,12*1024*1024);if(signal.aborted)throw new Error('Asset load cancelled.');
  const objectURL=URL.createObjectURL(blob);
  return new Promise((resolve,reject)=>{const img=new Image();let done=false;const cleanup=()=>{signal.removeEventListener('abort',cancel);clearTimeout(timer);img.onload=img.onerror=null;URL.revokeObjectURL(objectURL);};const cancel=()=>{if(done)return;done=true;cleanup();img.src='';reject(new Error('Asset load cancelled.'));};const timer=setTimeout(()=>{if(done)return;done=true;cleanup();img.src='';reject(new Error('Image timed out. Check URL and CORS settings.'));},15000);signal.addEventListener('abort',cancel,{once:true});img.onload=()=>{if(done)return;done=true;cleanup();resolve(img);};img.onerror=()=>{if(done)return;done=true;cleanup();reject(new Error('Image could not load. Use a PNG/WebP sheet and check CORS settings.'));};img.src=objectURL;});
 }
 class Scene{
  constructor(host,profile,poster,quality,onStatus){this.host=host;this.profile=profile||{};this.poster=poster;this.quality=quality;this.limits=levels[quality]||levels.light;this.status=onStatus||(()=>{});this.abort=new AbortController();this.dead=false;this.ready=false;this.cache=new Map();this.sources=new Map();this.atlases=new Map();this.bytes=0;this.particles=[];this.rings=[];this.motifs=[];this.pending=[];this.trails=[];this.actor=null;this.actorToken=0;this.stateName='idle';this.raging=false;this.castUntil=0;this.elapsed=0;this.lastSkill=0;this.theme=0xb9e7ff;this.solar=null;this.artOwned=false;this.actorPlaying=false;}
  async init(){
   this.P=await engine();if(this.dead)return;
   const P=this.P;this.app=new P.Application();
   try{await this.app.init({preference:'webgl',backgroundAlpha:0,antialias:this.quality!=='light',resolution:Math.min(devicePixelRatio||1,this.limits.resolution),autoDensity:true,powerPreference:this.quality==='high'?'high-performance':'low-power',autoStart:false,sharedTicker:false});}
   catch(e){try{if(this.app?.renderer)this.app.destroy(true,{children:true});}catch{}this.app=null;throw new Error('WebGL unavailable. Standard boss visuals remain active.');}
   if(this.dead){this.app.destroy(true,{children:true,texture:false,textureSource:false});return;}
   this.app.canvas.className='raid-pixi-canvas';this.app.canvas.setAttribute('aria-hidden','true');this.app.canvas.style.pointerEvents='none';this.host.append(this.app.canvas);
   this.lines=new P.Graphics();this.aura=new P.Graphics();this.actorLayer=new P.Container();this.effects=new P.Container();this.app.stage.addChild(this.aura,this.actorLayer,this.effects,this.lines);
   const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d'),g=c.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'#fff');g.addColorStop(.15,'#fff');g.addColorStop(.5,'rgba(255,255,255,.3)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,0,64,64);this.glow=P.Texture.from(canvas,true);
   this.app.ticker.maxFPS=this.limits.fps;this.tickFn=t=>this.tick(t.deltaMS);this.app.ticker.add(this.tickFn);
   this.resize=()=>{if(this.dead)return;const r=this.host.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.app.renderer.resize(this.width,this.height);this.positionActor();};this.observer=new ResizeObserver(this.resize);this.observer.observe(this.host);this.resize();
   this.visibility=()=>{if(document.hidden){this.app.ticker.stop();this.motifs=[];this.rings=[];for(const p of this.particles){p.alive=false;p.sprite.visible=false;}}else if(!this.dead)this.app.ticker.start();};document.addEventListener('visibilitychange',this.visibility);
   this.lost=e=>{e.preventDefault();this.status('Graphics paused; standard boss visuals are active.');this.destroy();};this.app.canvas.addEventListener('webglcontextlost',this.lost);
   this.config=A().validate(this.profile.motionAssets);this.ready=true;this.status('Graphics ready · '+this.quality);this.state(this.stateName,true);if(!document.hidden)this.app.ticker.start();
   for(const entry of this.pending.splice(0))this.emit(...entry);
  }
  center(){if(this.poster?.isConnected){const a=this.poster.getBoundingClientRect(),b=this.host.getBoundingClientRect();if(a.width&&a.height)return {x:a.x-b.x+a.width/2,y:a.y-b.y+a.height/2,size:Math.max(80,Math.min(640,Math.max(a.width,a.height)))};}return {x:this.width*.5,y:this.height*.4,size:Math.min(this.width*.5,this.height*.65)};}
  positionActor(){if(!this.actor)return;const p=this.center(),c=this.actorConfig;this.actor.position.set(p.x,p.y);const texture=this.actor.texture,orig=texture.orig;const scale=p.size/Math.max(orig.width,orig.height)*c.scale;this.actor.scale.set(scale);this.actor.anchor.set(c.anchorX,c.anchorY);}
  evictFor(bytes){
   if(bytes>this.limits.bytes)throw new Error('Animation exceeds this device’s texture budget. Choose a smaller sheet.');
   for(const [url,old] of this.sources){if(this.bytes+bytes<=this.limits.bytes)break;if(!old.texture)continue;const source=old.texture.source;
    if(this.clips?.some(c=>c.textures[0]?.source===source))continue;
    if(this.actorFrames?.[0]?.source===source){this.hideActor();this.actor.texture=this.P.Texture.EMPTY;}
    for(const [key,frames] of this.cache)if(frames.source===old.texture){frames.textures.forEach(t=>t.destroy(false));this.cache.delete(key);}
    old.texture.destroy(true);this.bytes=Math.max(0,this.bytes-old.bytes);this.sources.delete(url);
   }
   if(this.bytes+bytes>this.limits.bytes)throw new Error('Active effect sheets fill this device’s texture budget. Use smaller shared sheets.');
  }
  async source(url){
   if(this.sources.has(url))return this.sources.get(url).promise;
   if(this.sources.size>=8)throw new Error('Use up to eight shared image sheets per scene.');
   const entry={bytes:0,texture:null};this.sources.set(url,entry);
   entry.promise=(async()=>{const img=await image(url,this.abort.signal);if(this.dead)throw new Error('Scene closed.');if(img.width>4096||img.height>4096||!img.width||!img.height)throw new Error('Use images up to 4096 × 4096 pixels.');const bytes=img.width*img.height*4;this.evictFor(bytes);entry.texture=this.P.Texture.from(img,true);entry.bytes=bytes;this.bytes+=bytes;return {img,texture:entry.texture};})().catch(e=>{this.sources.delete(url);throw e;});return entry.promise;
  }
  async frames(c){
   const key=JSON.stringify(c);let entry=this.cache.get(key);if(entry)return entry.promise;
   if(this.cache.size>=24)throw new Error('Animation cache limit reached. Reuse sheets or reduce distinct clips.');
   entry={textures:[],source:null,bytes:0};this.cache.set(key,entry);
   entry.promise=(async()=>{
    let data,source=c.url;if(c.type==='atlas'){if(!this.atlases.has(c.url)){if(this.atlases.size>=8)throw new Error('Use up to eight atlas manifests per scene.');this.atlases.set(c.url,json(c.url,this.abort.signal).catch(e=>{this.atlases.delete(c.url);throw e;}));}data=await this.atlases.get(c.url);if(!data.meta?.image)throw new Error('Atlas needs meta.image.');source=A().url(data.meta.image,c.url);}
    const loaded=await this.source(source),img=loaded.img;const rows=c.type==='atlas'?A().atlasFrames(data,c.animation):A().gridFrames(c,img.width,img.height),P=this.P;
    entry.source=loaded.texture;
    rows.forEach(f=>{const r=f.frame;if(r.x+(f.rotated?r.h:r.w)>img.width||r.y+(f.rotated?r.w:r.h)>img.height)throw new Error('Frame extends outside image.');if(f.sourceSize&&!['w','h'].every(k=>Number.isInteger(f.sourceSize[k])&&f.sourceSize[k]>0&&f.sourceSize[k]<=4096))throw new Error('Invalid frame source size.');if(f.trimmed&&(!f.spriteSourceSize||!['x','y','w','h'].every(k=>Number.isInteger(f.spriteSourceSize[k])&&f.spriteSourceSize[k]>=0)))throw new Error('Invalid trimmed frame.');});
    entry.textures=rows.map(f=>{const r=f.frame;if(r.x+(f.rotated?r.h:r.w)>img.width||r.y+(f.rotated?r.w:r.h)>img.height)throw new Error('Frame extends outside image.');const original=f.trimmed!==false&&f.sourceSize?f.sourceSize:r;const orig=new P.Rectangle(0,0,original.w,original.h);if(orig.width>4096||orig.height>4096||orig.width<=0||orig.height<=0)throw new Error('Invalid original frame dimensions.');const trim=f.trimmed!==false&&f.spriteSourceSize?new P.Rectangle(f.spriteSourceSize.x,f.spriteSourceSize.y,r.w,r.h):undefined;return new P.Texture({source:entry.source.source,frame:new P.Rectangle(r.x,r.y,f.rotated?r.h:r.w,f.rotated?r.w:r.h),orig,trim,rotate:f.rotated?2:0});});return entry.textures;
   })().catch(e=>{entry.textures.forEach(t=>t.destroy(false));this.cache.delete(key);throw e;});return entry.promise;
  }
  async state(name,force=false){
   if(this.dead)return;if(name==='hit'&&this.stateName==='cast'&&(performance.now()<this.castUntil||(this.actorFrames&&this.actorAt<this.actorFrames.length)))return;
   if(!force&&['idle','rage'].includes(name)&&['hit','cast'].includes(this.stateName)&&this.actorFrames&&this.actorAt<this.actorFrames.length&&!this.actorLoop)return;
   if(name==='cast')this.castUntil=performance.now()+1200;
   if(name===this.stateName&&!force)return;this.stateName=name;if(!this.ready)return;
   const token=++this.actorToken,c=this.config.slots[name]||(name==='defeat'?null:this.config.slots[this.raging?'rage':'idle']||this.config.slots.idle);
   if(!c){this.hideActor();return;}
   try{const frames=await this.frames(c);if(this.dead||token!==this.actorToken)return;if(!['idle','rage'].includes(name)&&frames.length/c.fps>10)throw new Error('One-shot clips must last at most 10 seconds.');
    if(!this.actor){this.actor=new this.P.Sprite(frames[0]);this.actorLayer.addChild(this.actor);}this.actor.texture=frames[0];this.actor.visible=true;this.actorConfig=c;this.actorFrames=frames;this.actorAt=0;this.actorLoop=['idle','rage'].includes(name);this.actorPlaying=true;this.positionActor();
    this.coverPoster();this.status('Playing '+name+' · '+frames.length+' frames');
   }catch(e){if(!this.dead&&token===this.actorToken){this.hideActor();this.stateName=this.raging?'rage':'idle';this.status(e.message);}}
  }
  coverPoster(){if(this.poster){if(!this.artOwned){this.previousVisibility=this.poster.style.visibility;this.previousAnimation=this.poster.style.getPropertyValue('animation');this.previousAnimationPriority=this.poster.style.getPropertyPriority('animation');this.artOwned=true;}this.poster.style.visibility='hidden';this.poster.style.setProperty('animation','none','important');}}
  restorePoster(){if(this.poster&&this.artOwned){this.poster.style.visibility=this.previousVisibility||'';if(this.previousAnimation)this.poster.style.setProperty('animation',this.previousAnimation,this.previousAnimationPriority);else this.poster.style.removeProperty('animation');}this.artOwned=false;}
  hideActor(){if(this.actor)this.actor.visible=false;this.restorePoster();this.actorFrames=null;}
  async clip(key){const c=this.config?.slots[key];if(!c||!this.ready)return;const until=performance.now()+5000;
   try{const textures=await this.frames(c);if(this.dead||performance.now()>until)return;if(textures.length/c.fps>10)throw new Error('One-shot effects must last at most 10 seconds.');const sprite=new this.P.Sprite(textures[0]),p=this.center();sprite.anchor.set(c.anchorX,c.anchorY);sprite.position.set(p.x,p.y);sprite.scale.set(p.size*c.scale/Math.max(textures[0].orig.width,textures[0].orig.height));this.effects.addChild(sprite);this.clips=this.clips||[];while(this.clips.length>=3)this.clips.shift().sprite.destroy();this.clips.push({sprite,textures,c,at:0});}catch(e){if(!this.dead)this.status(e.message);}
  }
  spawn(x,y,color,count,speed=180,life=.8,inward=false){
   for(let i=0;i<count&&this.particles.filter(p=>p.alive).length<this.limits.particles;i++){
    let p=this.particles.find(p=>!p.alive);if(!p){const sprite=new this.P.Sprite(this.glow);sprite.anchor.set(.5);sprite.blendMode='add';this.effects.addChild(sprite);p={sprite};this.particles.push(p);}
    const angle=Math.random()*Math.PI*2,velocity=speed*(.3+Math.random());Object.assign(p,{alive:true,x:x+(inward?Math.cos(angle)*speed:0),y:y+(inward?Math.sin(angle)*speed:0),vx:Math.cos(angle)*(inward?-speed/life:velocity),vy:Math.sin(angle)*(inward?-speed/life:velocity),life:life*(.5+Math.random()*.5),max:life,size:4+Math.random()*13,color});p.sprite.position.set(p.x,p.y);p.sprite.alpha=p.life/p.max;p.sprite.width=p.size*(1+p.life/p.max);p.sprite.height=p.sprite.width*.55;p.sprite.rotation=Math.atan2(p.vy,p.vx);p.sprite.tint=color;p.sprite.visible=true;
   }
  }
  ring(x,y,color,radius=100){this.rings.push({x,y,color,radius,age:0});if(this.rings.length>8)this.rings.shift();}
  emit(kind,spec={}){
   if(this.dead)return;if(!this.ready){if(this.pending.length<8)this.pending.push([kind,spec]);return;}
   const p=this.center(),danger=['rage','cataclysm'].includes(kind),color=danger?0xff4d35:kind.includes('ice')?0x91e9ff:kind==='hit'?(spec.critical?0xffdc91:0xd5f3ff):0xa8d9ff;
   if(kind.startsWith('minion_')&&spec.node){const box=spec.node.getBoundingClientRect(),field=this.host.getBoundingClientRect(),x=box.x-field.x+box.width/2,y=box.y-field.y+box.height/2,color=this.raging?0xff775c:0xb9e9ff;this.spawn(x,y,color,kind==='minion_arrive'?18:10,95,.7);this.ring(x,y,color,70);return;}
   if(kind.startsWith('loot_')){const tone=/^#[a-f0-9]{6}$/i.test(spec.color||'')?parseInt(spec.color.slice(1),16):0xedd4a2,x=Number.isFinite(spec.x)?spec.x:p.x,y=Number.isFinite(spec.y)?spec.y:p.y;this.spawn(x,y,tone,kind==='loot_burst'?55:kind==='loot_pickup'?20:8,kind==='loot_burst'?200:80,1.1);this.ring(x,y,tone,kind==='loot_burst'?p.size*1.2:45);if(kind==='loot_launch'&&spec.node){this.trails.push({node:spec.node,color:tone,until:performance.now()+1300,last:0});if(this.trails.length>12)this.trails.shift();}return;}
   this.theme=color;if(!['hit','rage','phase'].includes(kind)){const life=kind==='cast'?1200:Math.min(10000,Math.max(700,(Number(spec.durationSec)||2.2)*1000));this.motifs.push({kind,color,start:performance.now(),until:performance.now()+life,seed:Math.random()*10});if(this.motifs.length>3)this.motifs.shift();}
   if(kind==='hit'){this.spawn(p.x,p.y,color,spec.critical?42:22,240);this.ring(p.x,p.y,color,p.size*.7);this.clip('hit_fx');}
   else if(kind==='rage'){this.spawn(p.x,p.y,color,70,220,1.6);this.ring(p.x,p.y,color,p.size);this.clip('rage_fx');}
   else{this.spawn(p.x,p.y,color,kind==='cast'?25:50,kind==='cast'?p.size*.55:280,1.3,kind==='cast');this.ring(p.x,p.y,color,p.size*.9);if(kind!=='cast')this.clip(kind);}
  }
  tick(ms){
   if(this.dead||!this.host.isConnected){this.destroy();return;}const dt=Math.min(.05,ms/1000);this.elapsed+=dt;if(this.posterId){const node=this.host.querySelector('#'+this.posterId);if(node&&node!==this.poster){this.restorePoster();this.poster=node;if(this.actor?.visible&&this.actorFrames)this.coverPoster();}}const p=this.center(),P=this.P;
   this.aura.clear();this.lines.clear();
   const tone=this.raging?0xff452e:this.theme;for(let i=0;i<3;i++)this.aura.ellipse(p.x,p.y+p.size*.45,p.size*(.5+i*.08),p.size*(.12+i*.025)).stroke({width:1.5,color:tone,alpha:(this.raging?.3:.13)*(1+Math.sin(this.elapsed*2+i)*.2)});
   if(this.raging&&this.elapsed-(this.lastEmber||0)>.12){this.lastEmber=this.elapsed;this.spawn(p.x+(Math.random()-.5)*p.size,p.y+p.size*.4,0xff5334,2,55,1.5);}
   for(const particle of this.particles){if(!particle.alive)continue;particle.life-=dt;if(particle.life<=0){particle.alive=false;particle.sprite.visible=false;continue;}particle.x+=particle.vx*dt;particle.y+=particle.vy*dt;particle.vy+=60*dt;particle.sprite.position.set(particle.x,particle.y);particle.sprite.alpha=Math.max(0,particle.life/particle.max);particle.sprite.width=particle.size*(1+particle.life/particle.max);particle.sprite.height=particle.sprite.width*.55;particle.sprite.rotation=Math.atan2(particle.vy,particle.vx);}
   this.rings=this.rings.filter(r=>r.age<.8);for(const r of this.rings){r.age+=dt;const progress=r.age/.8;this.lines.ellipse(r.x,r.y,r.radius*progress,r.radius*progress*.42).stroke({width:3*(1-progress)+.5,color:r.color,alpha:(1-progress)*.7});}
   const field=this.host.getBoundingClientRect();this.trails=this.trails.filter(t=>t.node.isConnected&&performance.now()<t.until&&!t.node._landed);for(const t of this.trails)if(this.elapsed-t.last>.06){t.last=this.elapsed;const r=t.node.querySelector('.rla-drop-visual')?.getBoundingClientRect()||t.node.getBoundingClientRect();this.spawn(r.x-field.x+r.width/2,r.y-field.y+r.height/2,t.color,2,16,.35);}
   if(this.ultimate?.phase==='casting'){const u=this.ultimate,progress=Math.min(1,u.progress/Math.max(1,u.target)),radius=p.size*(.48+.03*Math.sin(this.elapsed*4));for(let i=0;i<3;i++){const r=radius+i*13;this.lines.ellipse(p.x,p.y,r,r*.47).stroke({width:i===0?2:1,color:i===0?0xff6b4d:0xf6d4a4,alpha:.3+i*.08});}for(let i=0;i<10;i++){const angle=i*Math.PI/5+this.elapsed*.24,x=p.x+Math.cos(angle)*radius,y=p.y+Math.sin(angle)*radius*.47;this.lines.moveTo(x,y).lineTo(x+Math.cos(angle)*12,y+Math.sin(angle)*7).stroke({width:2,color:0xffd9b0,alpha:.5});}for(let i=0;i<Math.ceil(progress*6);i++){const a=i*2.4;this.lines.moveTo(p.x+Math.cos(a)*radius*.4,p.y+Math.sin(a)*radius*.2).lineTo(p.x+Math.cos(a+.15)*radius*.67,p.y+Math.sin(a+.15)*radius*.33).lineTo(p.x+Math.cos(a)*radius,p.y+Math.sin(a)*radius*.47).stroke({width:1.6,color:0xfff1d7,alpha:.8});}}
   this.motifs=this.motifs.filter(m=>m.until>performance.now());
   for(const m of this.motifs){const age=(performance.now()-m.start)/1000,fade=Math.min(1,age*5)*Math.min(1,Math.max(0,(m.until-performance.now())/1800)),r=p.size*.65;
    if(m.kind==='cast'){const progress=Math.min(1,age/1.2);for(let i=0;i<3;i++)this.lines.ellipse(p.x,p.y,r*(1.4-progress)+i*10,r*(.35-progress*.2)+i*3).stroke({width:1.5,color:0xc2e7ff,alpha:fade*.4});}
    else if(m.kind==='berserk_roar'){for(let i=0;i<4;i++){const t=(age*1.5+i*.25)%1;this.lines.ellipse(p.x,p.y,r*t*1.8,r*t*.7).stroke({width:4*(1-t)+.5,color:0xff9b77,alpha:fade*(1-t)*.7});}}
    else if(m.kind==='mirror_trick'){for(let i=0;i<8;i++){const a=i*Math.PI/4+age*.25,x=p.x+Math.cos(a)*r*.9,y=p.y+Math.sin(a)*r*.45,d=12+i%3*5;this.lines.poly([x-d,y,x+d*.2,y-d*2,x+d,y+d]).fill({color:i%2?0xb6e9ff:0xdabfff,alpha:fade*.15}).stroke({width:1,color:0xe4f4ff,alpha:fade*.6});}}
    else if(m.kind==='darkness'){this.lines.circle(p.x,p.y,r*.5).fill({color:0x10091c,alpha:fade*.7});this.lines.circle(p.x,p.y,r*.53).stroke({width:2,color:0xad8bdc,alpha:fade*.65});}
    else if(m.kind==='void_lance'){for(let i=-1;i<=1;i++){const end=p.x+i*r*.8;this.lines.moveTo(p.x,p.y-r*.5).lineTo(end,p.y+r*.8).stroke({width:10,color:0x6e42b9,alpha:fade*.15});this.lines.moveTo(p.x,p.y-r*.5).lineTo(end,p.y+r*.8).stroke({width:2,color:0xe8d7ff,alpha:fade*.75});}}
    else if(m.kind==='chaos_wind'||m.kind==='phantom_orbit'){for(let i=0;i<4;i++){const angle=age*3+i*Math.PI/2,x=p.x+Math.cos(angle)*r,y=p.y+Math.sin(angle)*r*.35;this.lines.moveTo(x,y).quadraticCurveTo(p.x,p.y-r*.4,p.x-Math.cos(angle)*r,p.y-Math.sin(angle)*r*.35).stroke({width:2+i%2,color:0xbdeeff,alpha:fade*.45});}}
    else if(m.kind==='earthquake'){for(let i=0;i<7;i++){const angle=i*Math.PI*2/7;this.lines.moveTo(p.x,p.y+p.size*.4);for(let j=1;j<=5;j++)this.lines.lineTo(p.x+Math.cos(angle)*r*j/5+Math.sin(j*5+i)*12,p.y+p.size*.4+Math.sin(angle)*r*j/5*.3);this.lines.stroke({width:2,color:0xeac29a,alpha:fade*.65});}}
    else if(m.kind==='lightning_storm'){for(let i=0;i<(this.quality==='light'?1:3);i++){const x=p.x+(i-1)*r*.7;this.lines.moveTo(x,-50);for(let j=1;j<=7;j++)this.lines.lineTo(x+Math.sin(j*13+m.seed+Math.floor(age*8))*(j%2?24:-16),p.y*j/7);this.lines.stroke({width:3,color:0xc6e7ff,alpha:fade*.65});}}
    else if(m.kind==='glacial_prison'){for(let i=0;i<7;i++){const x=p.x+(i-3)*r*.25,y=p.y+p.size*.43,h=(.4+.3*Math.sin(i*4+1))*r*Math.min(1,age*3);this.lines.poly([x-12,y,x-8,y-h*.7,x,y-h,x+12,y-h*.6,x+15,y]).fill({color:0x77cbea,alpha:fade*.18}).stroke({width:1,color:0xc1f3ff,alpha:fade*.65});}}
    else if(m.kind==='gravity_well'){for(let i=0;i<5;i++){const radius=r*(i+1)/5*(1-.15*Math.sin(age*2));this.lines.ellipse(p.x,p.y,radius,radius*.38).stroke({width:2,color:0xc4b4ff,alpha:fade*(.1+i*.07)});}}
    else if(m.kind==='meteor_shower'){for(let i=0;i<4;i++){const t=(age*.9+i*.21)%1,x=p.x-r+i*r*.65,y=-80+t*(p.y+p.size*.5+80);this.lines.moveTo(x-55,y-120).lineTo(x,y).stroke({width:4,color:0xffbc79,alpha:fade*.45});this.lines.circle(x,y,6).fill({color:0xffeac7,alpha:fade*.8});}}
   }
   if(this.solar&&performance.now()<this.solar.until){const count=this.quality==='light'?2:4;for(let i=0;i<count;i++){const x=this.width*(i+1)/(count+1)+Math.sin(this.elapsed*(.7+i*.1)+i)*this.width*.25,end=x+Math.sin(this.elapsed+i)*this.width*.2;this.lines.moveTo(x-this.width*.2,-this.height).lineTo(end,this.height*1.6).stroke({width:24,color:0xff652b,alpha:.08});this.lines.moveTo(x-this.width*.2,-this.height).lineTo(end,this.height*1.6).stroke({width:5,color:0xffa452,alpha:.28});this.lines.moveTo(x-this.width*.2,-this.height).lineTo(end,this.height*1.6).stroke({width:1.5,color:0xfff1c9,alpha:.8});if(Math.random()<dt*5)this.spawn(end,this.height*.75,0xff8c3a,3,90,.6);}}
   if(this.actor?.visible&&this.actorFrames?.length){this.actorAt+=dt*this.actorConfig.fps;const index=this.actorLoop?Math.floor(this.actorAt)%this.actorFrames.length:Math.min(this.actorFrames.length-1,Math.floor(this.actorAt));this.actor.texture=this.actorFrames[index];this.positionActor();if(!this.actorLoop&&this.actorAt>=this.actorFrames.length&&this.stateName!=='defeat'&&!(this.stateName==='cast'&&(performance.now()<this.castUntil||this.ultimate?.phase==='casting')))this.state(this.raging?'rage':'idle');}
   if(this.clips)this.clips=this.clips.filter(c=>{c.at+=dt*c.c.fps;if(c.at>=c.textures.length){c.sprite.destroy();return false;}c.sprite.texture=c.textures[Math.floor(c.at)];return true;});
   if(ms>55)this.slowFor=(this.slowFor||0)+dt;else this.slowFor=Math.max(0,(this.slowFor||0)-dt*.3);
   if(this.slowFor>3&&this.quality!=='light'){this.quality=this.quality==='high'?'standard':'light';this.limits=levels[this.quality];this.app.ticker.maxFPS=this.limits.fps;this.app.renderer.resolution=Math.min(devicePixelRatio||1,this.limits.resolution);this.resize();try{this.evictFor(0);}catch{}this.slowFor=0;this.status('Effects adjusted for smoother play · '+this.quality);for(const item of this.particles.slice(this.limits.particles)){item.alive=false;item.sprite.visible=false;}}
  }
  destroy(){
   if(this.dead)return;this.dead=true;this.abort.abort();this.observer?.disconnect();document.removeEventListener('visibilitychange',this.visibility);this.hideActor();
   if(this.app?.renderer?.canvas)this.app.renderer.canvas.removeEventListener('webglcontextlost',this.lost);
   if(this.app?.renderer){this.app.ticker.stop();this.app.destroy(true,{children:true,texture:false,textureSource:false});}
   for(const entry of this.cache.values()){entry.textures.forEach(t=>t.destroy(false));}this.cache.clear();for(const source of this.sources.values())source.texture?.destroy(true);this.sources.clear();this.atlases.clear();this.glow?.destroy(true);this.pending=[];this.particles=[];this.rings=[];
  }
 }
 function stop(){battle?.scene.destroy();battle=null;}
 function profile(boss){try{return window.bveGetLinkedProfile?.(boss)||{};}catch{return {};}}
 function sync(index){
  const boss=window.AppStore?.getBossEvent(index),host=document.getElementById('camp-scene'),poster=host?.querySelector('#wb-boss-sprite-art'),mode=effective();
  if(!host||!document.querySelector('.raid-battle.open')||boss?.status!=='active'){stop();return;}
  const key=[JSON.stringify(profile(boss).motionAssets||{}),boss._id,index,boss.raidRunId,typeof currentUser!=='undefined'?currentUser?.id:'',mode].join(':');
  let controls=document.getElementById('raid-effects-quality');if(!controls){controls=document.createElement('label');controls.id='raid-effects-quality';controls.innerHTML='Effects <select aria-label="Battle effects quality"><option value="auto">Auto</option><option value="light">Light</option><option value="standard">Standard</option><option value="high">High</option><option value="off">Off</option></select>';document.getElementById('camp-enemy-bar')?.append(controls);controls.querySelector('select').value=preference();controls.querySelector('select').onchange=e=>{try{localStorage.setItem('eq-raid-effects',e.target.value);}catch{}failedKey=null;stop();sync(index);};}
  if(mode==='off'){stop();return;}
  if(battle?.key===key&&!battle.scene.dead&&battle.scene.host===host)return;if(failedKey===key)return;stop();
  const scene=new Scene(host,profile(boss),poster,mode,message=>{host.dataset.pixiStatus=message;});scene.posterId='wb-boss-sprite-art';battle={key,scene};scene.init().catch(e=>{scene.status(e.message);scene.destroy();if(battle?.scene===scene){battle=null;failedKey=key;}});
 }
 function emit(kind,spec){battle?.scene.emit(kind,spec);}
 function state(name){battle?.scene.state(name);}
 function rage(active){if(battle){const scene=battle.scene;scene.raging=!!active;if(['idle','rage'].includes(scene.stateName))scene.state(active?'rage':'idle');}}
 function ultimate(u){if(!battle)return;const scene=battle.scene,old=scene.ultimate;scene.ultimate=u;if(!u){if(old?.phase==='casting')scene.state(scene.raging?'rage':'idle',true);return;}if(old?.id!==u.id||old.phase!==u.phase){if(u.phase==='casting'){scene.state('cast',true);scene.emit('cast');}else if(u.phase==='eruption'){scene.state('cast',true);scene.emit('cataclysm');}else if(u.phase==='interrupted'){scene.state('hit',true);scene.emit('cast_break');}}else if(u.progress>old.progress)scene.emit('crown_hit');}
 function solar(until){if(battle)battle.scene.solar={until};}
 async function showPreview(host,config,stateName,onStatus,poster=null){preview?.destroy();preview=null;const settings=A().validate({slots:{[stateName]:config}}),scene=new Scene(host,{motionAssets:settings},poster,effective()==='off'?'light':effective(),onStatus);preview=scene;try{await scene.init();if(preview!==scene)return;await scene.state(stateName,true);if(reduced()){scene.app.ticker.stop();scene.app.render();}}catch(e){scene.destroy();if(preview===scene)preview=null;throw e;}}
 async function defeat(host,boss,poster,cinematic=true){
  defeated?.destroy();defeated=null;const p=profile(boss);if(effective()==='off')return;
  const scene=new Scene(host,p,poster,effective());scene.stateName='defeat';scene.theme=0xe7c48b;defeated=scene;try{await scene.init();await scene.state('defeat',true);if(!cinematic&&scene.actorFrames)scene.actorAt=scene.actorFrames.length-1;if(cinematic)scene.emit('loot_burst');}catch{scene.destroy();}
 }
 window.RaidCanvas={ultimate,loot(kind,spec){defeated?.emit('loot_'+kind,spec);},defeat,stopDefeat(){defeated?.destroy();defeated=null;},sync,stop,emit,state,rage,solar,Scene,preview:showPreview,stopPreview(){preview?.destroy();preview=null;},diagnostics(){const s=battle?.scene;return s?{ready:s.ready,quality:s.quality,particles:s.particles.filter(p=>p.alive).length,cap:s.limits.particles,textures:s.cache.size,bytes:s.bytes,paused:!s.app?.ticker.started,actorState:s.stateName,actorFrame:Math.floor(s.actorAt||0),actorVisible:!!s.actor?.visible,sources:s.sources.size,motifs:s.motifs.length,solar:!!(s.solar&&performance.now()<s.solar.until)}:null;}};
 matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{failedKey=null;stop();preview?.destroy();preview=null;defeated?.destroy();defeated=null;});
})();
