// ─────────────────────────────────────────────────────────────────────────────
// UI TOPBAR — Top bar rendering and sidebar toggle
//
// Exports: updateTopbar(), toggleSidebar()
//
// DEPENDENCIES:
//   - currentUser, currentRole (globals / core/app-state)
//   - wbcUpdateTopbarWidget() (world-boss/combat — global)
//   - refreshAllAvatars() (index.html inline — typeof-guarded)
//   DOM elements required: #topbar-coin-val, #topbar-coins, #topbar-av,
//     #sb-avatar, #sb-name, #sb-tier, #sb-xp-fill, #sb-xp-label, #sb-xp-next,
//     #sidebar
//
// Cleanup 5: refreshAllAvatars() call absorbed from index.html monkey patch.
//   The patch wrapped updateTopbar to call refreshAllAvatars() after every
//   invocation. It is now a direct call here, removing the wrapper entirely.
// ─────────────────────────────────────────────────────────────────────────────

function updateTopbar(){
  if(!currentUser)return;
  const coins=currentRole==='student'?currentUser.coins:'-';
  document.getElementById('topbar-coin-val').textContent=typeof coins==='number'?coins.toLocaleString():coins;
  document.getElementById('topbar-coins').style.display=currentRole==='student'?'flex':'none';
  const av=document.getElementById('topbar-av');
  const init=currentRole==='student'?currentUser.init:'MS';
  const color=currentRole==='student'?currentUser.color:'#ffb4ab';
  av.textContent=init;av.style.background=`linear-gradient(135deg,${color}44,${color}22)`;av.style.color=color;
  if(currentRole==='student'){
    // XP_PER_LEVEL kept in sync with recalcStudentStats() in utils.js (1000)
    const st=currentUser;const xpNext=(st.level+1)*1000;const pct=Math.min(100,Math.round(st.xp/xpNext*100));
    document.getElementById('sb-avatar').textContent=st.init;
    document.getElementById('sb-avatar').style.cssText=`width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:14px;flex-shrink:0;border:2px solid ${st.color}55;background:${st.color}22;color:${st.color}`;
    // Minor fix: guard against single-word names (split[1] would be undefined)
    const nameParts=st.name.split(' ');
    document.getElementById('sb-name').textContent=nameParts.length>=2?nameParts[0]+' '+nameParts[1]:nameParts[0];
    document.getElementById('sb-tier').textContent=`${st.tier} · Level ${st.level}`;
    document.getElementById('sb-xp-fill').style.width=pct+'%';
    document.getElementById('sb-xp-label').textContent=`${st.xp.toLocaleString()} XP`;
    document.getElementById('sb-xp-next').textContent=`+${(xpNext-st.xp).toLocaleString()} to lv${st.level+1}`;
  } else {
    // Role split fix: this branch used to cover BOTH 'admin' and 'teacher'
    // and hardcoded admin-only copy for either. Show the label that matches
    // the actual logged-in role.
    const isAdmin=currentRole==='admin';
    document.getElementById('sb-avatar').textContent='MS';
    document.getElementById('sb-avatar').style.cssText='width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:14px;flex-shrink:0;border:2px solid rgba(255,180,171,0.3);background:rgba(255,180,171,0.12);color:#ffb4ab';
    document.getElementById('sb-name').textContent=currentUser.name;
    document.getElementById('sb-tier').textContent=isAdmin?'Administrator':'Teacher';
    document.getElementById('sb-xp-fill').style.width='100%';
    document.getElementById('sb-xp-label').textContent=isAdmin?'Admin Mode':'Teacher Mode';
    document.getElementById('sb-xp-next').textContent='';
  }
  // Update boss topbar widget whenever topbar refreshes
  if(typeof wbcUpdateTopbarWidget === 'function') wbcUpdateTopbarWidget();
  // Cleanup 5: absorbed from index.html patch — refreshAllAvatars after every update
  if(typeof refreshAllAvatars === 'function') refreshAllAvatars();
  // Phase 67 — student-only notification bell. NotificationService.refresh()
  // itself no-ops (and hides the bell) for non-student roles.
  if(typeof NotificationService !== 'undefined') NotificationService.refresh();
}
// Sidebar collapse — dual behavior depending on viewport:
//   Mobile (≤1024px):  existing overlay drawer, unchanged. Toggles #sidebar.open;
//                       CSS in the max-width:1024px block slides it over the content.
//   Desktop (>1024px):  push-style collapse. Toggles #main-app.sidebar-collapsed;
//                       CSS in the min-width:1025px block slides the sidebar off
//                       and the main content reclaims the width. Persisted so it
//                       doesn't reset to "open" on every page load.
const SIDEBAR_COLLAPSE_KEY='eq_sidebar_collapsed';
function toggleSidebar(){
  if(window.innerWidth<=1024){
    document.getElementById('sidebar').classList.toggle('open');
    return;
  }
  const collapsed=document.getElementById('main-app').classList.toggle('sidebar-collapsed');
  try{localStorage.setItem(SIDEBAR_COLLAPSE_KEY,collapsed?'1':'0');}catch(e){/* storage unavailable — non-fatal, just won't persist */}
}
// Restores the desktop collapsed/expanded state saved from a previous session.
// Called once from bootApp(). No-op on mobile — the overlay drawer always starts closed.
function restoreSidebarState(){
  if(window.innerWidth<=1024)return;
  let collapsed=false;
  try{collapsed=localStorage.getItem(SIDEBAR_COLLAPSE_KEY)==='1';}catch(e){/* storage unavailable — default to expanded */}
  document.getElementById('main-app').classList.toggle('sidebar-collapsed',collapsed);
}
