/* A bounded, account/project-scoped cache of conditional TABLE packets.
 * Never displayed before a fresh authorized server read. No auth tokens stored. */
(function(){
 'use strict';
 const DB='eduquest-transfer-cache-v1',TTL=86400000,LIMIT=32*1024*1024,MAX=64;
 let connection=null;const pending=new Map();let timer=null;const stats={hits:0,writes:0,unavailable:false};
 function open(){
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  if(!connection)connection=new Promise(resolve=>{let settled=false;const done=db=>{if(settled){db?.close();return;}settled=true;clearTimeout(timeout);if(db)stats.unavailable=false;resolve(db);};const timeout=setTimeout(()=>{connection=null;stats.unavailable=true;done(null);},350);
   try{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('snapshots'))r.result.createObjectStore('snapshots',{keyPath:'scope'});};r.onsuccess=()=>done(r.result);r.onerror=()=>{connection=null;stats.unavailable=true;done(null);};r.onblocked=()=>{stats.unavailable=true;};}catch{connection=null;stats.unavailable=true;done(null);}
  });return connection;
 }
 async function load(scope){try{const db=await open();if(!db)return null;return await new Promise(resolve=>{const tx=db.transaction('snapshots','readonly'),r=tx.objectStore('snapshots').get(scope);r.onsuccess=()=>{const v=r.result;if(v?.v===1&&Date.now()-v.at<TTL){stats.hits++;resolve(v);}else resolve(null);};r.onerror=()=>resolve(null);});}catch{return null;}}
 async function flush(){clearTimeout(timer);timer=null;if(!pending.size)return;const items=[...pending.values()];pending.clear();try{const db=await open();if(!db)return;await new Promise(resolve=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');for(const item of items){if(item.bytes<=8*1024*1024){store.put(item);stats.writes++;}else store.delete(item.scope);}tx.oncomplete=resolve;tx.onerror=()=>{stats.unavailable=true;resolve();};tx.onabort=()=>resolve();});
   await new Promise(resolve=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),r=store.getAll();r.onsuccess=()=>{let size=0,count=0;const now=Date.now();for(const item of r.result.sort((a,b)=>b.at-a.at)){size+=item.bytes;count++;if(now-item.at>TTL||size>LIMIT||count>MAX)store.delete(item.scope);}};tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve;});
  }catch{stats.unavailable=true;}}
 function save(scope,owner,state){const item={scope,owner,v:1,at:Date.now(),parts:[...state.parts],hashes:{...state.hashes}};item.bytes=new TextEncoder().encode(JSON.stringify(item)).length;pending.set(scope,item);if(!timer)timer=setTimeout(flush,500);}
 async function forget(owner){for(const [key,item] of pending)if(item.owner===owner)pending.delete(key);try{const db=await open();if(!db)return;await new Promise(resolve=>{const tx=db.transaction('snapshots','readwrite'),r=tx.objectStore('snapshots').openCursor();r.onsuccess=()=>{const c=r.result;if(c){if(c.value.owner===owner)c.delete();c.continue();}};tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve;});}catch{}}
 window.EgressCache={load,save,flush,forget,diagnostics:()=>({...stats,pending:pending.size})};
})();
