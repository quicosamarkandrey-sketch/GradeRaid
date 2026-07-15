// ─────────────────────────────────────────────────────────────────────────────
// DB MIGRATIONS  — All one-time migration blocks that run at boot
//
// PURPOSE
//   Each block below ensures a DB key exists (adding it if missing) and
//   performs any one-time data shape upgrades needed for new features.
//
// DEPENDENCY: DB (global), DEFAULT_DB, and saveDB() must exist before
//   runMigrations() is called.
//
// Cleanup 6: saveDB() is now called ONCE at the end via a dirty flag,
//   replacing the 3 unconditional saveDB() calls that fired on every page load.
//   One-time migrations (inventory, achievements, profile bootstrap) still mark
//   dirty so the flag fires; the orphan-cleanup block already used a local dirty
//   flag and is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

function runMigrations() {
  let _migrationDirty = false; // tracks whether any migration actually changed DB
  // ── SCHEMA VERSION CHECK (Added for Phase 0) ──
  if (!DB.schemaVersion || DB.schemaVersion < 3) {
    DB.schemaVersion = 3;
    _migrationDirty = true;
  }

  // ── Initial field guards (non-destructive — only set if missing) ──
if(!DB.attendanceSessions){DB.attendanceSessions=[];_migrationDirty=true;}
if(!DB.recitationLog){DB.recitationLog=[];_migrationDirty=true;}
if(!DB.pointLog){DB.pointLog=[];_migrationDirty=true;}
if(!DB.achievements){DB.achievements=[];_migrationDirty=true;}
if(!DB.achievementUnlocks){DB.achievementUnlocks={};_migrationDirty=true;}
if(!DB.titles){DB.titles=[];_migrationDirty=true;}
if(!DB.titleUnlocks){DB.titleUnlocks={};_migrationDirty=true;}
if(!DB.equippedTitles){DB.equippedTitles={};_migrationDirty=true;}
if(!DB.redemptions){DB.redemptions=[];_migrationDirty=true;}
if(!DB.stageMap){DB.stageMap=JSON.parse(JSON.stringify(DEFAULT_DB.stageMap));_migrationDirty=true;}
if(!DB.stageProgress){DB.stageProgress={};_migrationDirty=true;}
if(!DB.bossEvents){DB.bossEvents=[];_migrationDirty=true;}
if(!DB.bossParticipants){DB.bossParticipants={};_migrationDirty=true;}

// ── BOSS STUDIO DB MIGRATION ──
if(!DB.bossLibrary){DB.bossLibrary=[];_migrationDirty=true;}

// ── ANIMATION LIBRARY DB MIGRATION ──
if(!DB.animationLibrary){DB.animationLibrary=[];_migrationDirty=true;}

// ── POS SYSTEM DB MIGRATION ──
if(!DB.orders){DB.orders=[];_migrationDirty=true;}

// ── QUIZ HISTORY DB MIGRATION (Critical Fix #1 support) ──
// Stores per-quiz scores so quizAvg can be recalculated from real data.
if(!DB.quizHistory){DB.quizHistory={};_migrationDirty=true;}

// ── ACHIEVEMENT CLAIM SYSTEM DB MIGRATION ──
if(!DB._achClaimMigrated){
  Object.keys(DB.achievementUnlocks||{}).forEach(sid=>{
    (DB.achievementUnlocks[sid]||[]).forEach(u=>{
      if(u.claimed===undefined){u.claimed=true;u.claimedAt=u.unlockedAt||new Date().toISOString();}
    });
  });
  DB._achClaimMigrated=true;
  _migrationDirty=true;
}

// ── MAIL SYSTEM DB MIGRATION ──
if(!DB.mail){DB.mail=[];_migrationDirty=true;}

// ── PROMOTIONS DB MIGRATION ──
if(!DB.promotions){DB.promotions=[];_migrationDirty=true;}
if(!DB.promoAnalytics){DB.promoAnalytics={};_migrationDirty=true;}

// ── STUDENT REGISTRATION DB MIGRATION ──
if(!DB.registrations){DB.registrations=[];_migrationDirty=true;}

// ── NOTIFICATION SYSTEM DB MIGRATION (Phase 67) ──
if(!DB.notifications){DB.notifications=[];_migrationDirty=true;}

// ── INVENTORY SYSTEM DB MIGRATION ──
if(!DB.inventory){DB.inventory={};_migrationDirty=true;}
// Migrate existing redemptions into inventory on first load
(function(){
  if(DB._inventoryMigrated)return;
  DB.redemptions.forEach(function(r){
    if(!r.itemId)return;
    if(!DB.inventory[r.studentId])DB.inventory[r.studentId]=[];
    const inv=DB.inventory[r.studentId];
    const existing=inv.find(function(i){return i.itemId===r.itemId;});
    if(existing){existing.quantity=(existing.quantity||1)+1;}
    else{
      const storeItem=DB.store.find(function(s){return s.id===r.itemId;});
      inv.push({
        itemId:r.itemId,
        itemName:r.itemName||r.item||'Unknown Item',
        emoji:r.emoji||(storeItem?storeItem.emoji:'🎁'),
        category:storeItem?storeItem.cat:'unknown',
        quantity:1,
        datePurchased:r.date||'Unknown',
        source:'Store',
        status:'active'
      });
    }
  });
  DB._inventoryMigrated=true;
  _migrationDirty=true;
})();

// ── DYNAMIC ACHIEVEMENT SYSTEM DB MIGRATION ──
if(!DB.achievementCategories){
  DB.achievementCategories=[
    'Attendance','Quests','Boss Battles','Store Purchases',
    'Coins Earned','XP Earned','Level Milestones','Quiz Performance',
    'Scanner Activities','Special Events','Seasonal Events','Hidden Achievements'
  ];
  _migrationDirty=true;
}

// ── TITLE SYSTEM DB MIGRATION ──
// (guards already set above; orphan cleanup uses its own dirty flag)
(function(){
  const validTitleIds = new Set((DB.titles || []).map(t => t.id));
  let dirty = false;
  Object.keys(DB.titleUnlocks || {}).forEach(function(sid){
    const before = (DB.titleUnlocks[sid] || []).length;
    DB.titleUnlocks[sid] = (DB.titleUnlocks[sid] || []).filter(function(tid){ return validTitleIds.has(tid); });
    if(DB.titleUnlocks[sid].length !== before) dirty = true;
  });
  Object.keys(DB.equippedTitles || {}).forEach(function(sid){
    if(DB.equippedTitles[sid] && !validTitleIds.has(DB.equippedTitles[sid])){
      DB.equippedTitles[sid] = null;
      dirty = true;
    }
  });
  if(dirty){saveDB();} // orphan cleanup is conditional — keeps its own immediate save
})();

// ── Profile field bootstrap (non-destructive — only sets if missing) ──
(function() {
  function _ensureProf(user) {
    if (!user) return;
    if (!user.firstName) { const p=(user.name||'').split(' '); user.firstName=p[0]||''; user.lastName=p.slice(1).join(' ')||''; _migrationDirty=true; }
    if (!user.displayName) { user.displayName = user.name || user.id; _migrationDirty=true; }
    if (!user.email) { user.email = ''; _migrationDirty=true; }
    if (!user.joinDate) { user.joinDate = new Date().toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}); _migrationDirty=true; }
    if (!user.profilePic) { user.profilePic = ''; _migrationDirty=true; }
  }
  _ensureProf(DB.admin);
  (DB.students||[]).forEach(_ensureProf);
})();

// ── WAVE 1 SUPABASE MIGRATION: backfill ids on pre-existing log entries ──
// point_log / recitation_log entries are now upserted to Supabase by a
// client-generated `id` (added at every new-entry call site). Entries that
// already existed in localStorage before this change have no id, so without
// this backfill they'd be silently skipped by the upload filter in
// _pushCacheToSupabase and never make it to Postgres.
if (!DB._wave1IdBackfillMigrated) {
  (DB.pointLog || []).forEach(function (p) { if (!p.id) p.id = 'pl_' + uid(); });
  (DB.recitationLog || []).forEach(function (r) { if (!r.id) r.id = 'rec_' + uid(); });
  DB._wave1IdBackfillMigrated = true;
  _migrationDirty = true;
}

// ── Single consolidated save (replaces 3 unconditional saveDB() calls) ──
if(_migrationDirty) saveDB();

}
