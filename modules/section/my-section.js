// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/section/my-section.js
//  Student "My Section" page: your section's info, your adviser's profile
//  (+ how much content they've published), and a roster of your classmates.
//
//  DATA SOURCE: get_my_section_info() (Phase 53 — see
//  supabase/phase53_fix_catalog_visibility_and_my_section.sql). A student
//  can never read class_sections or a classmate's profiles.* row directly
//  (both are correctly locked down at the RLS layer), so this page goes
//  through a narrow, purpose-built SECURITY DEFINER RPC instead of
//  AppStore's students slice — that only ever contains rows this device has
//  independently synced, and won't reliably span a whole section either.
//
//  OFFLINE / LOCAL-ONLY FALLBACK: if Supabase isn't configured (or the RPC
//  call fails), falls back to whatever this device already has in
//  AppStore's students slice filtered by classId, and its admin slice as a
//  single-teacher stand-in — same "graceful degrade to local cache" posture
//  every other page in this app already has (see db-service.js's hybrid
//  design).
//
//  DEPENDENCY: DBService.rpc() (db-service.js), tsBuildBadgeHTML() —
//  typeof guard (titles module) for the equipped-title chip.
// ═══════════════════════════════════════════════════════════════════════════════

let _mySectionCache = null; // last successful fetch, so re-render (e.g. after nav away/back) doesn't always refetch

window.renderMySection = async function () {
  const el = document.getElementById('s-my-section');
  if (!el) return;
  const st = currentUser;
  if (!st) return;

  el.innerHTML = _mySectionSkeletonHTML();

  const info = await _mySectionFetch();
  _mySectionCache = info;
  _mySectionPaint(info);
};

async function _mySectionFetch() {
  const st = currentUser;
  try {
    if (typeof DBService !== 'undefined' && DBService.rpc) {
      const { data, error } = await DBService.rpc('get_my_section_info', {});
      if (!error && data) {
        return {
          section: data.section || null,
          teacher: data.teacher || null,
          classmates: data.classmates || [],
          source: 'remote',
        };
      }
      if (error) console.warn('[MySection] get_my_section_info failed, falling back to local cache:', error);
    }
  } catch (e) {
    console.warn('[MySection] get_my_section_info threw, falling back to local cache:', e);
  }

  // ── Local-only fallback ──────────────────────────────────────────────
  const students = (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.students) || []) : [];
  const equippedTitles = (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.equippedTitles) || {}) : {};
  const myClassId = st.classId || 'default-class';
  const classmates = students
    .filter(s => (s.classId || 'default-class') === myClassId)
    .map(s => ({
      id: s.id, displayName: s.name, init: s.init, color: s.color,
      profilePicUrl: s.profilePic, xp: s.xp, level: s.level, tier: s.tier,
      equippedTitleId: equippedTitles[s.id] || null,
    }))
    .sort((a, b) => (b.xp || 0) - (a.xp || 0));

  // No classSections slice available locally (that's a staff-only AppStore
  // slice, per phase51 — a student session never loads it), so this local
  // fallback can't resolve a real per-section adviser. Falls back to
  // whatever single admin/teacher record this device already has cached —
  // good enough offline, and get_my_section_info() (Supabase path above)
  // is what gives the real, multi-teacher-correct answer once online.
  const teacherRow = (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.admin) || null) : null;

  return {
    section: { id: myClassId, label: (typeof getClassLabel === 'function') ? getClassLabel(myClassId) : myClassId },
    teacher: teacherRow ? {
      id: teacherRow.id, displayName: teacherRow.name,
      achievementCount: (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.achievements) || []).length : 0,
      quizCount: (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.quizzes) || []).length : 0,
      campaignWorldCount: (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.stageMap) || []).length : 0,
      shopProductCount: (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.store) || []).length : 0,
    } : null,
    classmates,
    source: 'local',
  };
}

function _mySectionSkeletonHTML() {
  return `
  <div class="page-hero"><div class="page-hero-bg"></div><div style="position:relative;z-index:1">
    <div class="page-hero-label">🏫 My Section</div>
    <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">Loading your section…</h1>
    <p style="font-size:14px;color:var(--text-muted)">Fetching your classmates and adviser info</p>
  </div></div>`;
}

function _mySectionPaint(info) {
  const el = document.getElementById('s-my-section');
  if (!el) return;
  const st = currentUser;
  const section = info.section;
  const teacher = info.teacher;
  const classmates = info.classmates || [];
  // Fetched once per paint (not per-card) — AppStore.getSlice() clones the
  // whole titles array, so doing this inside the per-classmate map below
  // would mean one full clone per classmate instead of one for the page.
  const titles = (typeof AppStore !== 'undefined') ? (AppStore.getSlice(s => s.titles) || []) : [];

  el.innerHTML = `
  <div class="page-hero"><div class="page-hero-bg"></div><div style="position:relative;z-index:1">
    <div class="page-hero-label">🏫 My Section</div>
    <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">${section ? _esc(section.label) : 'Not yet assigned'}</h1>
    <p style="font-size:14px;color:var(--text-muted)">${classmates.length} classmate${classmates.length === 1 ? '' : 's'} · your shared quests, campaigns, shop, and badges live here</p>
  </div></div>

  ${_mySectionTeacherCardHTML(teacher)}

  <div style="display:flex;align-items:center;justify-content:space-between;margin:28px 0 16px">
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;color:var(--on-surface)">👥 Your Class</div>
    <span class="badge-pill bp-primary">${classmates.length} student${classmates.length === 1 ? '' : 's'}</span>
  </div>

  ${classmates.length ? `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px">
    ${classmates.map((c, i) => _mySectionStudentCardHTML(c, i, st, titles)).join('')}
  </div>` : `
  <div style="text-align:center;padding:64px;background:rgba(35,31,56,0.7);border:1px solid var(--border);border-radius:16px;backdrop-filter:blur(12px)">
    <div style="font-size:48px;margin-bottom:12px">🧑‍🤝‍🧑</div>
    <div style="font-family:var(--fh);font-size:18px;font-weight:800;margin-bottom:6px">No classmates found yet</div>
    <div style="color:var(--text-muted);font-size:13px">Once your section fills up, everyone will show up here.</div>
  </div>`}
  `;
}

function _mySectionTeacherCardHTML(teacher) {
  if (!teacher) {
    return `<div class="glass-card" style="display:flex;align-items:center;gap:14px">
      <div style="font-size:32px">🧑‍🏫</div>
      <div>
        <div style="font-family:var(--fh);font-size:15px;font-weight:800;color:var(--on-surface)">Adviser not yet assigned</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Check back once your section has a teacher assigned.</div>
      </div>
    </div>`;
  }
  const initials = (teacher.displayName || 'T').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `
  <div class="glass-card" style="background:linear-gradient(135deg,rgba(139,92,246,0.10),rgba(78,222,163,0.05));border-color:rgba(208,188,255,0.25)">
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <div style="width:76px;height:76px;border-radius:20px;flex-shrink:0;background:rgba(208,188,255,0.14);border:2px solid rgba(208,188,255,0.35);display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:28px;color:#d0bcff">${_esc(initials)}</div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:10px;letter-spacing:.12em;color:var(--text-muted);text-transform:uppercase;font-weight:700;margin-bottom:2px">Your Adviser</div>
        <div style="font-family:var(--fh);font-size:20px;font-weight:900;color:var(--on-surface)">${_esc(teacher.displayName || 'Teacher')}</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <span class="badge-pill bp-primary">📝 ${teacher.quizCount ?? 0} quests</span>
          <span class="badge-pill bp-green">🗺️ ${teacher.campaignWorldCount ?? 0} campaign worlds</span>
          <span class="badge-pill bp-gold">🏪 ${teacher.shopProductCount ?? 0} shop items</span>
          <span class="badge-pill bp-gray">🏅 ${teacher.achievementCount ?? 0} achievements</span>
        </div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:14px;padding-top:14px;border-top:1px solid var(--border2)">
      Your shop, achievements, and titles always match your adviser above — quests and campaign worlds may differ from other sections this teacher runs, since they're assigned per-section.
    </div>
  </div>`;
}

function _mySectionStudentCardHTML(c, i, st, titles) {
  const isMe = st && c.id === st.id;
  const rank = i + 1;
  const rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  const color = c.color || '#8b5cf6';
  const avatarInner = c.profilePicUrl
    ? `<img src="${c.profilePicUrl}" alt="${_esc(c.init || '')}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" onerror="this.remove()">`
    : _esc(c.init || (c.displayName || '?')[0]);
  let titleBadgeHTML = '';
  if (c.equippedTitleId && typeof tsBuildBadgeHTML === 'function' && Array.isArray(titles)) {
    const t = titles.find(x => x.id === c.equippedTitleId);
    if (t) titleBadgeHTML = `<div style="margin-top:10px;display:flex;justify-content:center">${tsBuildBadgeHTML(t, { small: true })}</div>`;
  }
  return `
  <div style="position:relative;background:${isMe ? 'linear-gradient(135deg,rgba(208,188,255,0.14),rgba(139,92,246,0.06))' : 'rgba(35,31,56,0.7)'};border:1px solid ${isMe ? 'rgba(208,188,255,0.4)' : 'var(--border)'};border-radius:18px;padding:22px 18px;text-align:center;backdrop-filter:blur(12px);transition:transform .2s"
    onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
    ${rankIcon ? `<div style="position:absolute;top:10px;right:14px;font-size:20px">${rankIcon}</div>` : `<div style="position:absolute;top:10px;right:14px;font-size:11px;color:var(--text-muted);font-weight:800">#${rank}</div>`}
    ${isMe ? `<div style="position:absolute;top:10px;left:14px;font-size:9px;letter-spacing:.08em;color:#d0bcff;font-weight:800;background:rgba(208,188,255,0.15);border:1px solid rgba(208,188,255,0.3);padding:2px 8px;border-radius:8px">YOU</div>` : ''}
    <div style="width:72px;height:72px;border-radius:50%;margin:8px auto 12px;position:relative;overflow:hidden;background:${color}33;border:3px solid ${color}88;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:26px;color:${color}">${avatarInner}</div>
    <div style="font-family:var(--fh);font-size:15px;font-weight:800;color:var(--on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(c.displayName || 'Student')}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Level ${c.level ?? 1} · ${_esc(c.tier || 'Scholar')}</div>
    <div style="margin-top:10px;font-family:var(--fm);font-size:16px;font-weight:800;color:${color}">${(c.xp || 0).toLocaleString()} <span style="font-size:10px;color:var(--text-muted);font-weight:600">XP</span></div>
    ${titleBadgeHTML}
  </div>`;
}
