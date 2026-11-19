/* Change-driven reads with bounded batching and authoritative recovery polling.
 * Rendering, animation clocks and mutations remain independent of this scheduler. */
(function(){
 'use strict';
 function create(options){
  const clock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  let stopped=false,running=false,wasActive=false,dirty=0,handled=0,last=clock(),wake=null,failures=0,lastDeadline=Infinity,deadlineAttempt=0;
  const active=()=>!stopped&&options.active()&&!document.hidden&&navigator.onLine;
  const release=()=>window.DBService?.releaseRemoteTables?.(options.tables);
  function synced(){last=clock();failures=0;}
  function schedule(){if(stopped||wake)return;const delay=Math.max(options.batchMs??160,(options.minGapMs??120)-(clock()-last));wake=setTimeout(()=>{wake=null;run();},delay);}
  async function run(){
   if(running||!active())return;
   const now=clock(),wallNow=Date.now(),interval=failures?Math.min(15000,1000*2**Math.min(failures,4)):options.interval(),deadline=options.deadline?.()??Infinity;
   if(failures&&now-last<interval)return;
   const due=deadline<=wallNow&&(deadline!==lastDeadline||now-deadlineAttempt>=1000);
   if(dirty===handled&&now-last<interval&&!due)return;
   if(now-last<(options.minGapMs??120)){schedule();return;}
   const version=dirty;running=true;last=now;if(due){lastDeadline=deadline;deadlineAttempt=now;}
   try{const ok=await options.refresh();if(ok===false){failures++;}else{handled=version;synced();}}
   catch{failures++;}
   finally{running=false;if(!stopped&&active()&&dirty>handled&&!failures)schedule();}
  }
  const unwatch=window.DBService?.watchRemoteChanges?.(options.tables,notice=>{
   if(stopped||!options.active()||!options.matches(notice))return false;
   dirty++;schedule();return options.owns?.(notice)===true;
  });
  const pulse=setInterval(()=>{const on=options.active();if(wasActive&&!on)release();wasActive=on;run();},options.tickMs??500);
  const visible=()=>{if(active()){dirty++;run();}};
  document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);
  return {synced,refresh(){dirty++;return run();},stop(){if(stopped)return;stopped=true;clearInterval(pulse);clearTimeout(wake);unwatch?.();release();document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);},diagnostics:()=>({running,pending:dirty-handled,last,failures})};
 }
 window.LiveSync={create};
})();
