/* UI motion is brief and input never waits for animation. Battle poses are presentation only. */
(function () {
 'use strict';
 const media=matchMedia('(prefers-reduced-motion: reduce)'),running=new Map(),recent=new WeakMap();
 const easing='cubic-bezier(.16,1,.3,1)';
 const clips={
  dialog:{duration:250,frames:[{opacity:0,translate:'0 12px',scale:'.97'},{opacity:1,translate:'0 -1px',scale:'1.003',offset:.8},{opacity:1,translate:'0 0',scale:'1'}]},
  update:{duration:120,frames:[{opacity:.7},{opacity:1}]},
  page:{duration:160,frames:[{opacity:.7},{opacity:1}]},
  notice:{duration:220,frames:[{opacity:0,translate:'0 8px',scale:'.985'},{opacity:1,translate:'0 0',scale:'1'}]},
  error:{duration:240,frames:[{translate:'0 0'},{translate:'-3px 0',offset:.2},{translate:'3px 0',offset:.45},{translate:'-1px 0',offset:.7},{translate:'0 0'}]}
 };
 function cancel(node){const animation=running.get(node);if(animation){animation.cancel();running.delete(node);}}
 function enter(node,kind='notice'){
  if(!node?.isConnected||media.matches||!node.animate||document.hidden)return;
  const clip=clips[kind]||clips.notice,previous=recent.get(node),now=performance.now();
  // Frequent updates stay still. Reopening a dialog still gets a short entrance.
  if(previous&&kind!=='dialog'&&now-previous.at<400){cancel(node);return;}
  recent.set(node,{at:now});cancel(node);
  const animation=node.animate(clip.frames,{duration:clip.duration,easing,fill:'none'});running.set(node,animation);
  const cleanup=()=>{if(running.get(node)===animation)running.delete(node);};animation.onfinish=cleanup;animation.oncancel=cleanup;
 }
 const neutral={x:0,y:0,sx:1,sy:1,r:0};
 // Key poses: anticipation, contact, overshoot, and a neutral settled pose.
 const poses={
  hit:{duration:260,keys:[[0,0,0,1,1,0],[.12,-.012,.012,1.075,.9,-.025],[.36,.018,-.018,.955,1.055,.03],[.7,-.004,.004,1.015,.985,-.008],[1,0,0,1,1,0]]},
  cast:{duration:900,keys:[[0,0,0,1,1,0],[.22,0,.025,1.035,.955,-.015],[.72,0,-.025,.975,1.04,.012],[1,0,-.008,.995,1.01,0]]},
  release:{duration:280,keys:[[0,0,-.008,.995,1.01,0],[.12,-.01,.012,1.035,.97,-.02],[.4,.012,-.025,.97,1.045,.025],[.76,-.003,.004,1.015,.99,-.006],[1,0,0,1,1,0]]},
  rage:{duration:700,keys:[[0,0,0,1,1,0],[.2,0,.035,1.055,.93,0],[.52,0,-.04,.965,1.06,0],[.78,0,.008,1.02,.98,0],[1,0,0,1,1,0]]}
 };
 const smooth=t=>t*t*(3-2*t);
 function pose(kind,elapsed,strength=1){
  const score=poses[kind];if(!score||media.matches)return {...neutral};
  const t=Math.min(1,Math.max(0,elapsed/score.duration)),keys=score.keys;
  let a=keys[0],b=keys.at(-1);for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){a=keys[i-1];b=keys[i];break;}
  const u=smooth(Math.min(1,Math.max(0,(t-a[0])/(b[0]-a[0]||1)))),weight=Math.min(1.35,Math.max(0,strength)),result={};
  ['x','y','sx','sy','r'].forEach((key,i)=>{const baseline=key==='sx'||key==='sy'?1:0;result[key]=baseline+(a[i+1]+(b[i+1]-a[i+1])*u-baseline)*weight;});return result;
 }
 function easeOut(t){return 1-Math.pow(1-Math.min(1,Math.max(0,t)),3);}
 function arc(start,end,height,t){const u=Math.min(1,Math.max(0,t));return {x:start.x+(end.x-start.x)*u,y:start.y+(end.y-start.y)*u-4*height*u*(1-u)};}
 media.addEventListener('change',()=>{if(media.matches)for(const node of [...running.keys()])cancel(node);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const node of [...running.keys()])cancel(node);});
 let page=null;
 const boot=()=>window.AppStore?.subscribe('shared-motion',(_,event)=>{if(event?.type!=='nav:navigated'&&event?.type!=='session:booted')return;const next=document.querySelector('.page.active');if(next&&next!==page){page=next;enter(next,'page');}});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
 window.AppMotion={enter,cancel,pose,arc,easeOut,diagnostics:()=>({reduced:media.matches,active:running.size}),durations:Object.freeze(Object.fromEntries(Object.entries(clips).map(([key,c])=>[key,c.duration])))};
})();
