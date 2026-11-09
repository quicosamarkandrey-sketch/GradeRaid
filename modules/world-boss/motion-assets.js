/* Data-only animation format shared by Boss Studio and the battlefield. */
(function(){
 'use strict';
 const slots=['idle','cast','hit','rage','defeat','hit_fx','rage_fx','earthquake','chaos_wind','lightning_storm','meteor_shower','gravity_well','glacial_prison','void_lance','darkness','berserk_roar','phantom_orbit','mirror_trick','cataclysm'];
 const number=(v,def,min,max)=>{const n=v===''||v==null?def:Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`Value must be between ${min} and ${max}.`);return n;};
 function url(value,base=location.href){const u=new URL(String(value||'').trim(),base);if(!value||!['https:','http:'].includes(u.protocol)||u.username||u.password||String(value).length>2048)throw new Error('Use a public HTTPS asset URL or a relative asset path.');if(location.protocol==='https:'&&u.protocol!=='https:')throw new Error('Use HTTPS for this asset.');return u.href;}
 function validate(raw){
  const result={version:1,slots:{}};if(!raw)return result;
  for(const [key,value] of Object.entries(raw.slots||{})){
   if(!slots.includes(key))continue;if(!value||value.type==='none')continue;
   if(!['grid','atlas'].includes(value.type))throw new Error('Unsupported asset type for '+key);
   const c={type:value.type,url:url(value.url),fps:number(value.fps,12,1,60),scale:number(value.scale,1,.1,2),anchorX:number(value.anchorX,.5,0,1),anchorY:number(value.anchorY,.5,0,1)};
   if(c.type==='grid'){
    for(const field of ['columns','rows']){c[field]=number(value[field],1,1,32);if(!Number.isInteger(c[field]))throw new Error('Grid dimensions must be whole numbers.');}
    if(c.columns*c.rows>512)throw new Error('Use at most 512 grid frames.');
    c.start=number(value.start,0,0,c.columns*c.rows-1);c.end=number(value.end,c.columns*c.rows-1,c.start,c.columns*c.rows-1);
    if(!Number.isInteger(c.start)||!Number.isInteger(c.end))throw new Error('Frame indexes must be whole numbers.');
    if(!['idle','rage'].includes(key)&&(c.end-c.start+1)/c.fps>10)throw new Error('One-shot clips must last at most 10 seconds.');
   }else{c.animation=String(value.animation||'').trim();if(c.animation.length>80)throw new Error('Animation name is too long.');}
   result.slots[key]=c;
  }
  return result;
 }
 function atlasFrames(data,name=''){
  if(!data||typeof data!=='object'||!data.frames||data.meta?.related_multi_packs?.length)throw new Error('Use a single-page TexturePacker or Aseprite JSON atlas.');
  let rows=Array.isArray(data.frames)?data.frames.map((f,i)=>[f.filename||String(i),f]):Object.entries(data.frames);
  if(rows.length<1||rows.length>512)throw new Error('Atlas must have 1–512 frames.');
  if(name){
   const group=data.animations?.[name],tag=data.meta?.frameTags?.find(t=>t.name===name);
   if(Array.isArray(group)){const map=new Map(rows);rows=group.map(k=>[k,map.get(k)]);}
   else if(tag&&Number.isInteger(tag.from)&&Number.isInteger(tag.to)&&tag.from>=0&&tag.to>=tag.from&&tag.to<rows.length){rows=rows.slice(tag.from,tag.to+1);if(['reverse','pingpong_reverse'].includes(tag.direction))rows.reverse();if(['pingpong','pingpong_reverse'].includes(tag.direction))rows=rows.concat(rows.slice(1,-1).reverse());}
   else throw new Error('Animation group not found: '+name);
  }
  if(!rows.length||rows.length>512)throw new Error('Animation group must contain 1–512 frames.');
  return rows.map(([key,f])=>{const r=f?.frame;if(!r||!['x','y','w','h'].every(k=>Number.isInteger(r[k])&&r[k]>=0)||!r.w||!r.h)throw new Error('Invalid atlas frame: '+key);return {...f,name:key};});
 }
 function gridFrames(config,width,height){
  if(width%config.columns||height%config.rows)throw new Error('Image dimensions must divide evenly into the grid.');
  const w=width/config.columns,h=height/config.rows;return Array.from({length:config.end-config.start+1},(_,i)=>{const n=i+config.start;return {frame:{x:n%config.columns*w,y:Math.floor(n/config.columns)*h,w,h}};});
 }
 window.BossMotionAssets=Object.freeze({slots,validate,url,atlasFrames,gridFrames});
})();
