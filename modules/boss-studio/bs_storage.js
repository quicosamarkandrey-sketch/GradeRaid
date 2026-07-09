// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/boss-studio/storage.js
//  LOAD FIRST — IndexedDB image layer + Boss Visual Profile (BVP) CRUD.
//  All other boss-studio files depend on the symbols exported here.
//
//  WHY IndexedDB:
//  A single 1MB boss artwork PNG = ~1.37MB of base64 — 2-3 uploads exhaust
//  the 5MB localStorage quota for the ENTIRE application. Uploaded bytes are
//  stored in IndexedDB under small reference keys ('idb:img_...'), keeping
//  DB.bossLibrary[] JSON-safe for localStorage/export.
//
//  Session flow:
//    Save:  _bsOffloadArtwork() → replaces data-URL with 'idb:img_...' ref → bsUpsert()
//    Load:  bsLoad() → _bsResolveProfileArtwork() → swaps ref back to cached data-URL
//    Render: all existing code reads artwork.value directly (unchanged)
//
//  CROSS-DEVICE SYNC + STORAGE-BACKED ARTWORK (Pending Fixes Report §2,
//  supabase/phase13_boss_studio_storage.sql):
//    IndexedDB is fast but strictly per-browser — DB.bossLibrary itself used
//    to live only in localStorage too, so a design (and its art) made on one
//    device simply wasn't there on another. Two additive changes close this,
//    neither of which changes any existing call site's signature:
//      • bsUpsert()/bsDelete() now ALSO queue a debounced push of the
//        profile's JSON (art refs, colors, animation slots — never the raw
//        image bytes) to a new `boss_library` table via
//        save_boss_library_entry()/delete_boss_library_entry(). Best-effort,
//        fire-and-forget — a failed/offline push leaves the local cache as
//        the source of truth for this browser, same posture as every other
//        sync layer in this app (see dsm-service.js's own comment header).
//      • _bsOffloadArtwork() now ALSO uploads the same bytes it's offloading
//        to IndexedDB to a public Supabase Storage bucket (`boss-art`), and
//        stamps the resulting public URL onto `artwork.remoteUrl` /
//        `rageArtwork.remoteUrl` once that resolves. That field is what lets
//        a DIFFERENT browser (with no entry for this ref in ITS IndexedDB)
//        still render the art, and — per admin-page.js's saveBossForm — is
//        what gets written into boss_events.image at deploy time instead of
//        a resolved base64 blob, so every device stops re-downloading the
//        full image on every sync.
//    None of this touches `artwork.value` (still the idb: ref, still what
//    every existing renderer reads first) — remoteUrl is purely additive.
// ═══════════════════════════════════════════════════════════════════════════════

// ── IndexedDB constants ───────────────────────────────────────────────────────
const BS_IMG_DB_NAME    = 'eduquest_boss_studio_images';
const BS_IMG_DB_VERSION = 1;
const BS_IMG_STORE      = 'images';
const BS_IMG_REF_PREFIX = 'idb:';
const BS_INLINE_DATAURL_THRESHOLD = 2048; // bytes; small inline values left as-is

// ── Schema / visual constants ─────────────────────────────────────────────────
window.BS_SCHEMA_VERSION  = 3;
window.BS_DEFAULT_THEME   = '#8b5cf6';
window.BS_DEFAULT_AURA    = '#7c3aed';
window.BS_DEFAULT_ACCENT  = '#d0bcff';

// ── DB connection (singleton promise) ─────────────────────────────────────────
let _bsImgDbPromise = null;

function _bsOpenImgDb() {
  if (_bsImgDbPromise) return _bsImgDbPromise;
  _bsImgDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(BS_IMG_DB_NAME, BS_IMG_DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(BS_IMG_STORE)) db.createObjectStore(BS_IMG_STORE);
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror   = function (e) { reject(e.target.error || new Error('IndexedDB open failed')); };
  }).catch(err => { _bsImgDbPromise = null; throw err; });
  return _bsImgDbPromise;
}

// ── In-memory image cache (ref key → data-URL) ────────────────────────────────
const _bsImgCache = new Map();

// ── Low-level IDB ops ─────────────────────────────────────────────────────────

async function _bsImgPut(dataUrl) {
  const key = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  _bsImgCache.set(key, dataUrl);
  try {
    const db = await _bsOpenImgDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BS_IMG_STORE, 'readwrite');
      tx.objectStore(BS_IMG_STORE).put(dataUrl, key);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[BossStudio] IndexedDB write failed, image kept in-memory only:', e);
  }
  return BS_IMG_REF_PREFIX + key;
}

async function _bsImgFetch(ref) {
  const key = ref.slice(BS_IMG_REF_PREFIX.length);
  if (_bsImgCache.has(key)) return _bsImgCache.get(key);
  try {
    const db  = await _bsOpenImgDb();
    const val = await new Promise((resolve, reject) => {
      const tx = db.transaction(BS_IMG_STORE, 'readonly');
      const rq = tx.objectStore(BS_IMG_STORE).get(key);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror   = () => reject(rq.error);
    });
    if (val) _bsImgCache.set(key, val);
    return val || null;
  } catch (e) {
    console.warn('[BossStudio] IndexedDB read failed for', ref, e);
    return null;
  }
}

async function _bsImgDelete(ref) {
  if (!ref || !ref.startsWith(BS_IMG_REF_PREFIX)) return;
  const key = ref.slice(BS_IMG_REF_PREFIX.length);
  _bsImgCache.delete(key);
  try {
    const db = await _bsOpenImgDb();
    const tx = db.transaction(BS_IMG_STORE, 'readwrite');
    tx.objectStore(BS_IMG_STORE).delete(key);
  } catch (e) { /* best-effort cleanup */ }
}

function _bsIsImgRef(value) {
  return typeof value === 'string' && value.startsWith(BS_IMG_REF_PREFIX);
}

// ── Artwork resolve / offload helpers ─────────────────────────────────────────

function _bsResolveArtwork(art) {
  if (!art || !_bsIsImgRef(art.value)) return art;
  const cached = _bsImgCache.get(art.value.slice(BS_IMG_REF_PREFIX.length));
  return cached ? { ...art, value: cached } : art;
}

function _bsResolveProfileArtwork(profile) {
  if (profile.artwork)     profile.artwork     = _bsResolveArtwork(profile.artwork);
  if (profile.rageArtwork) profile.rageArtwork = _bsResolveArtwork(profile.rageArtwork);
  return profile;
}

async function _bsOffloadArtwork(art) {
  if (!art || typeof art.value !== 'string') return art;
  if (_bsIsImgRef(art.value)) return art;
  if (art.type !== 'upload') return art;
  if (art.value.length <= BS_INLINE_DATAURL_THRESHOLD) return art;
  const dataUrl = art.value;
  const ref = await _bsImgPut(dataUrl);
  // Fire-and-forget: also push the same bytes to Supabase Storage so this
  // artwork is reachable from a device that has no entry for `ref` in ITS
  // OWN IndexedDB. Never awaited — local save/render must not wait on a
  // network upload. See _bsPatchRemoteUrlInPlace() for how the result lands.
  _bsUploadArtworkToStorage(dataUrl, ref).then(function (url) {
    if (url) _bsPatchRemoteUrlInPlace(ref, url);
  }).catch(function () { /* best-effort — this device just stays local-only */ });
  return { ...art, value: ref };
}

// ── Storage upload (Pending Fixes Report §2b) ─────────────────────────────────

function _bsDataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1], b64 = m[2];
  let bin;
  try { bin = atob(b64); } catch (e) { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/png' });
}

async function _bsUploadArtworkToStorage(dataUrl, ref) {
  if (typeof DBService === 'undefined' || typeof DBService.uploadPublicFile !== 'function') return null;
  const blob = _bsDataUrlToBlob(dataUrl);
  if (!blob) return null;
  const ownerId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser.id : null;
  if (!ownerId) return null; // no session yet — storage RLS (Phase 33) requires an owner-prefixed path
  const ext = (blob.type && blob.type.split('/')[1]) || 'png';
  const key = ref.slice(BS_IMG_REF_PREFIX.length);
  // Phase 33 — boss-art write/update/delete policies now check that the
  // first path segment equals the caller's own uid (or that the caller is
  // admin). Every upload MUST land under this teacher's own folder.
  const path = ownerId + '/library/' + key + '.' + ext;
  try {
    const { data, error } = await DBService.uploadPublicFile('boss-art', path, blob, blob.type);
    if (error) {
      console.warn('[BossStudio] Storage upload failed, artwork stays local-only on this device:', error);
      return null;
    }
    return data.publicUrl;
  } catch (e) {
    console.warn('[BossStudio] Storage upload threw, artwork stays local-only on this device:', e);
    return null;
  }
}

// Once an upload resolves, stamp the public URL onto whichever profile (and
// slot — main or rage) currently holds this ref, so a re-save isn't required
// for the URL to start syncing cross-device via _bsQueueLibraryPush() below.
function _bsPatchRemoteUrlInPlace(ref, url) {
  DB = loadDB();
  if (!Array.isArray(DB.bossLibrary)) return;
  let touched = null;
  DB.bossLibrary.forEach(function (b) {
    if (b.artwork && b.artwork.value === ref)         { b.artwork.remoteUrl     = url; touched = b; }
    if (b.rageArtwork && b.rageArtwork.value === ref) { b.rageArtwork.remoteUrl = url; touched = b; }
  });
  if (touched) {
    saveDB();
    // Queue the push BEFORE bsLoad(): bsLoad() resolves idb: refs back into
    // full data-URLs in place for rendering, reassigning `touched.artwork`
    // to a new object — queueing first (and _bsQueueLibraryPush snapshotting
    // immediately) guarantees we send the still-unresolved ref, never the
    // resolved bytes. See _bsQueueLibraryPush()'s own comment for the
    // second, independent layer of protection against that.
    _bsQueueLibraryPush(touched.id, touched);
    bsLoad();
  }
}

// ── Cross-device library sync (Pending Fixes Report §2a) ──────────────────────
// Mirrors dsm-service.js's cache-through facade shape, woven directly into
// bsLoad()/bsUpsert()/bsDelete() instead of a separate service object, so
// every existing call site (bs_editor.js, bs_library.js, bs_bve_engine.js,
// world-boss/admin-page.js) needs zero changes — they already only ever call
// these exported functions, never touch DB.bossLibrary or localStorage
// directly.

function _bsCanUseRemoteLibrary() {
  return typeof DBService !== 'undefined'
    && typeof DBService.rpc === 'function'
    && typeof DBService.getAuthClient === 'function'
    && !!DBService.getAuthClient();
}

// Never let a raw, un-offloaded data: URL reach the remote `boss_library`
// table. Every editor-driven save goes through bsUpsertAsync() → 
// _bsOffloadArtwork() first, so `.value` is already an 'idb:...' ref by the
// time bsUpsert() is called — but a few call sites (bsDuplicate(), JSON
// import) call bsUpsert() directly with a profile pulled from bsGet(),
// whose artwork is already RESOLVED back to a full data-URL for on-screen
// rendering. Silently dropping the raw bytes here (keeping remoteUrl if one
// already exists) is a safe degrade: the design's colors/animations/etc.
// still sync, and the next real edit-and-save in Boss Studio re-offloads
// the art properly.
function _bsSanitizeArtForRemote(art) {
  if (!art || typeof art.value !== 'string' || art.type === 'emoji') return art;
  if (art.value.indexOf('data:') === 0 && art.value.length > BS_INLINE_DATAURL_THRESHOLD) {
    return { ...art, value: art.remoteUrl || '' };
  }
  return art;
}

// Deep-clones AND sanitizes at the moment of queueing — the clone matters
// just as much as the sanitize: bsLoad() is very often called synchronously
// right after bsUpsert()/this queue call, and it resolves a profile's
// artwork/rageArtwork objects IN PLACE for rendering. Without a snapshot
// here, the object sitting in _bsLibraryDirty could balloon back into a
// full data-URL by the time the debounced flush actually reads it.
function _bsSnapshotProfileForRemote(profile) {
  const clone = JSON.parse(JSON.stringify(profile));
  if (clone.artwork)     clone.artwork     = _bsSanitizeArtForRemote(clone.artwork);
  if (clone.rageArtwork) clone.rageArtwork = _bsSanitizeArtForRemote(clone.rageArtwork);
  return clone;
}

// id -> profile object to push, or null to mean "delete this id". Map (not
// array) so a rapid edit-then-edit on the same boss collapses to one push,
// same trailing-edge debounce shape as DBService's own _queueUpload().
const _bsLibraryDirty = new Map();
let _bsLibraryPushTimer = null;

function _bsQueueLibraryPush(id, profileOrNull) {
  if (!id) return;
  const snapshot = profileOrNull === null ? null : _bsSnapshotProfileForRemote(profileOrNull);
  _bsLibraryDirty.set(id, snapshot);
  if (_bsLibraryPushTimer) clearTimeout(_bsLibraryPushTimer);
  _bsLibraryPushTimer = setTimeout(_bsFlushLibraryPush, 400);
}

async function _bsFlushLibraryPush() {
  _bsLibraryPushTimer = null;
  if (!_bsCanUseRemoteLibrary()) return;
  const entries = Array.from(_bsLibraryDirty.entries());
  _bsLibraryDirty.clear();
  for (const [id, profile] of entries) {
    try {
      if (profile === null) {
        const { error } = await DBService.rpc('delete_boss_library_entry', { p_id: id });
        if (error) console.warn('[BossStudio] remote library delete failed for', id, error);
      } else {
        const { error } = await DBService.rpc('save_boss_library_entry', { p_id: id, p_data: profile });
        if (error) console.warn('[BossStudio] remote library sync failed for', id, error);
      }
    } catch (e) {
      console.warn('[BossStudio] remote library sync threw for', id, e);
    }
  }
}

/**
 * _bsInitRemoteLibrary() → Promise<void>
 * Pulls every boss_library row this staff session can see and merges it
 * into DB.bossLibrary (remote entries win on id conflict — same "server is
 * authoritative once reachable" posture DBService.initRemote() takes for
 * everything else). If the RPC fails (no session yet, offline, or a
 * legitimately non-staff session — get_boss_library() is staff-only, unlike
 * get_dsm_settings()), this is a silent no-op: whatever's already local
 * stays exactly as it was, never wiped.
 *
 * NOT wired into the module's own AppStore.ready.then() below on purpose:
 * that runs at page boot, BEFORE login, when no Supabase Auth session
 * exists yet — get_boss_library() would always reject at that point for
 * every session. Call sites: bs_library.js's renderBossStudio(), the first
 * time the admin actually opens the Boss Studio page each session (i.e.
 * safely after doLogin() has run).
 */
async function _bsInitRemoteLibrary() {
  if (!_bsCanUseRemoteLibrary()) return;
  try {
    const { data, error } = await DBService.rpc('get_boss_library', {});
    if (error) throw error;
    if (Array.isArray(data) && data.length) {
      DB = loadDB();
      if (!Array.isArray(DB.bossLibrary)) DB.bossLibrary = [];
      const byId = {};
      DB.bossLibrary.forEach(function (b) { byId[b.id] = b; });
      data.forEach(function (row) { byId[row.id] = row.data; });
      DB.bossLibrary = Object.values(byId);
      saveDB();
      bsLoad();
    }
    // Remote has nothing yet (fresh migration, before any design has been
    // re-saved under the new sync) — keep whatever this browser already
    // has locally rather than silently wiping an existing customization.
  } catch (e) {
    // Expected/benign for a non-staff session (get_boss_library() rejects
    // by design) as well as offline/no-session cases — not logged as a
    // warning to avoid noise on every non-admin page load.
  }
}
window._bsInitRemoteLibrary = _bsInitRemoteLibrary;

// ── BVP sync CRUD (localStorage) ─────────────────────────────────────────────

function bsLoad() {
  DB = loadDB();
  if (!Array.isArray(DB.bossLibrary)) DB.bossLibrary = [];
  DB.bossLibrary.forEach(b => {
    if (!b.visual) b.visual = { themeColor: BS_DEFAULT_THEME, auraColor: BS_DEFAULT_AURA, cardAccent: BS_DEFAULT_ACCENT };
    if (!b.schemaVersion) b.schemaVersion = BS_SCHEMA_VERSION;
    _bsResolveProfileArtwork(b);
  });
  return DB.bossLibrary;
}

function bsGet(id) { return (DB.bossLibrary || []).find(b => b.id === id) || null; }

function bsUpsert(profile) {
  if (!Array.isArray(DB.bossLibrary)) DB.bossLibrary = [];
  const idx = DB.bossLibrary.findIndex(b => b.id === profile.id);
  if (idx >= 0) DB.bossLibrary[idx] = profile;
  else          DB.bossLibrary.push(profile);
  saveDB();
  // Cross-device sync (Pending Fixes Report §2a) — best-effort, debounced;
  // see "Cross-device library sync" section above.
  _bsQueueLibraryPush(profile.id, profile);
}

function bsDelete(id) {
  if (!Array.isArray(DB.bossLibrary)) return;
  const idx = DB.bossLibrary.findIndex(b => b.id === id);
  if (idx < 0) return;
  const prof = DB.bossLibrary[idx];
  // Best-effort cleanup of orphaned IDB images
  if (prof.artwork?.value)     _bsImgDelete(prof.artwork.value);
  if (prof.rageArtwork?.value) _bsImgDelete(prof.rageArtwork.value);
  DB.bossLibrary.splice(idx, 1);
  saveDB();
  // Cross-device sync (Pending Fixes Report §2a) — remove the remote row
  // too, so this design doesn't reappear on another device's next pull.
  _bsQueueLibraryPush(id, null);
}

// ── Async save (offloads images to IDB first) ─────────────────────────────────

async function bsUpsertAsync(profile) {
  if (!profile) { console.warn('[BossStudio] bsUpsertAsync called without a profile'); return; }
  if (!profile.id) profile.id = 'bvp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  const prevDB    = loadDB() || { bossLibrary: [] };
  const prevList  = Array.isArray(prevDB.bossLibrary) ? prevDB.bossLibrary : [];
  const prev      = prevList.find(b => b.id === profile.id);
  const prevArtRef  = prev?.artwork?.value     && _bsIsImgRef(prev.artwork.value)     ? prev.artwork.value     : null;
  const prevRageRef = prev?.rageArtwork?.value && _bsIsImgRef(prev.rageArtwork.value) ? prev.rageArtwork.value : null;

  const toSave = { ...profile };
  if (profile.artwork)     toSave.artwork     = await _bsOffloadArtwork(profile.artwork);
  if (profile.rageArtwork) toSave.rageArtwork = await _bsOffloadArtwork(profile.rageArtwork);
  bsUpsert(toSave);
  bsLoad();
  const stored = bsGet(profile.id);
  if (stored) {
    if (profile.artwork)     stored.artwork     = { ...profile.artwork };
    if (profile.rageArtwork) stored.rageArtwork = { ...profile.rageArtwork };
  }
  if (prevArtRef  && prevArtRef  !== toSave.artwork?.value)     _bsImgDelete(prevArtRef);
  if (prevRageRef && prevRageRef !== toSave.rageArtwork?.value) _bsImgDelete(prevRageRef);
}

// ── Legacy inline-image migration (one-shot, async) ───────────────────────────
let _bsLegacyMigrationDone = false;

async function _bsMigrateLegacyInlineImages() {
  if (_bsLegacyMigrationDone) return;
  _bsLegacyMigrationDone = true;
  const candidates = (DB.bossLibrary || []).filter(b =>
    (b.artwork?.type === 'upload' && typeof b.artwork.value === 'string' && b.artwork.value.length > BS_INLINE_DATAURL_THRESHOLD && !_bsIsImgRef(b.artwork.value)) ||
    (b.rageArtwork?.type === 'upload' && typeof b.rageArtwork.value === 'string' && b.rageArtwork.value.length > BS_INLINE_DATAURL_THRESHOLD && !_bsIsImgRef(b.rageArtwork.value))
  );
  if (!candidates.length) return;
  for (const boss of candidates) {
    try { await bsUpsertAsync(boss); }
    catch (e) { console.warn('[BossStudio] Legacy image migration failed for', boss.id, e); }
  }
  console.log(`[BossStudio] Migrated ${candidates.length} legacy inline image${candidates.length !== 1 ? 's' : ''} to IndexedDB.`);
}

// ── Public exports ─────────────────────────────────────────────────────────────
window.bsLoad           = bsLoad;
window._bsLoad          = bsLoad;
window.bsGet            = bsGet;
window._bsGet           = bsGet;
window._bsUpsert        = bsUpsert;
window.bsUpsertAsync    = bsUpsertAsync;
window._bsDelete        = bsDelete;

window._bsImgFetch      = _bsImgFetch;
window._bsIsImgRef      = _bsIsImgRef;
window._bsResolveArtwork = _bsResolveArtwork;
window._bsImgCacheGet   = function (ref) {
  if (!ref || !ref.startsWith('idb:')) return null;
  return _bsImgCache.get(ref.slice(4)) || null;
};
window._bsPreloadArt    = async function (profile) {
  if (!profile) return;
  for (const art of [profile.artwork, profile.rageArtwork].filter(Boolean)) {
    if (art?.value?.startsWith('idb:')) {
      try { await _bsImgFetch(art.value); } catch (e) {}
    }
  }
};
window._bsMigrateLegacyInlineImages = _bsMigrateLegacyInlineImages;

// DB migration on load — ensure tables exist and run legacy image migration
// [SUPABASE MIGRATION] Deferred until AppStore.ready resolves — see the
// matching note in modules/shop/shop_pos_terminal.js for why this can no
// longer run synchronously at parse time.
AppStore.ready.then(function () {
  DB = loadDB();
  let dirty = false;
  if (!DB.bossLibrary)      { DB.bossLibrary      = []; dirty = true; }
  if (!DB.animationLibrary) { DB.animationLibrary = []; dirty = true; }
  if (dirty) saveDB();
  bsLoad();
  setTimeout(_bsMigrateLegacyInlineImages, 2000);
});

console.log('[EduQuest] boss-studio/storage.js loaded — IndexedDB image layer, BVP CRUD registered. Migration scheduled.');
