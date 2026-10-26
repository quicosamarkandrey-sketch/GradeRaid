// src/modules/leaderboard/hall-of-fame.js — real-ESM twin of
// ../../../modules/leaderboard/hall-of-fame.js.
// Phase 7 (Stream D), file 23/30. Original stays untouched.
//
// dependency-map declaresCount is 6 = 4 real exports + 2 in-body RUNTIME state slots. The 4 exports are the
// `window.X = function` assignments holGoToPage, holPrevPage, holNextPage, renderLeaderboard, each converted to
// `export const X = function (...)`. The other 2 counted names (window._eqlActiveTab, window._eqlActivePeriod) are
// assignments INSIDE renderLeaderboard that other files read through window (titles_student_page.js,
// titles_sidebar_refresh.js), so they stay verbatim `window.X = value` and cannot be exports.
// The outer `(function () { 'use strict'; ... })();` wrapper is stripped (body dedented 2sp, otherwise verbatim); the
// directive is dropped because ES modules are always strict. Dedent is TEMPLATE-LITERAL-AWARE: lines that start inside a
// template literal (139 continuation lines) are left exactly as-is, so every runtime string value is byte-identical.
// The IIFE-private helpers (HOL_CAT, HOL_PERIODS, HOL_PAGE_SIZE, _holPage, _holLastTabPeriodKey and every _hol* function)
// are now module-scoped and deliberately NOT exported — they were never on window.
//
// REAL IMPORTS: AppStore (../core/state-manager.js), _esc/_cssColor (../../utils.js), eqlComputeRecitation/Boss/Academic/
// Overall (./eql-engine.js, file 3; no cycle), tsBuildBadgeHTML (../titles/titles_badge_renderer.js, file 2; its `typeof`
// guards are kept verbatim and are now trivially true).
// BARE (global fallback, behavior): currentUser, currentRole (typeof-guarded reads), and tsGetEquippedTitle
// (modules/titles/titles_sidebar_refresh.js — file 26, not yet converted; its `typeof` guards are behavior).
//
// BINDING NOTE: the file's internal calls to its own exports are spelled `window.renderLeaderboard(...)` /
// `window.holGoToPage(...)` / inline `onclick` strings, so they still resolve through `window` at call time exactly as
// before (the bridge re-attaches them) — no lexical-binding change. Wrapper audit: none of the 4 names is assigned or
// wrapped by any other file; the 3 other files that CALL renderLeaderboard do so bare + typeof-guarded.
//
// Load-time side effect preserved: the trailing console.log.

/* ============================================================
   modules/leaderboard/hall-of-fame.js
   EduQuest — Hall of Legends student UI

   Depends on:
     eql-engine.js   (eqlComputeRecitation, eqlComputeBoss,
                      eqlComputeAcademic, eqlComputeOverall,
                      eqlBuildCategory, window.EQL)
     shared/dom.js   (showModal, closeModalForce, toast)
   Exports via window.*:
     window.renderLeaderboard(activeTab?, activePeriod?) → void

   All five tabs (hall, overall, recitation, boss, academic) render through
   the SAME premium HOL stage pipeline (_holRenderStage / _holRenderCard /
   _holRenderRow) — 'hall' is no longer a plain XP list bolted on top of the
   fancy tabs; it gets the full podium/beams/embers treatment PLUS its own
   "legendary" flourishes (multicolor shimmer rim, ambient sparkle field,
   class-wide summary strip) since it's the class's flagship rankings page.

   Renders into #s-leaderboard for students, and into #a-hall-of-fame for
   teachers/admins (see _holTargetPageId()) so staff can view the Hall of
   Fame without needing the separate Leaderboard Admin config page.

   References tsBuildBadgeHTML via typeof guard (extracted Day 8).
   ============================================================ */



import { AppStore } from '../core/state-manager.js';
import { _esc, _cssColor } from '../../utils.js';
import { eqlComputeRecitation, eqlComputeBoss, eqlComputeAcademic, eqlComputeOverall } from './eql-engine.js';
import { tsBuildBadgeHTML } from '../titles/titles_badge_renderer.js';

// ── CSS injection — owned by hall-of-fame-styles.js (Phase 6) ────────────
// injectHolStyles() used to live here (~640 lines) — moved to its own
// file since it's a fully self-contained, already-self-invoking IIFE with
// zero dependency on anything else in this file (see that file's
// header). It runs standalone via its own <script> tag now, exactly as it
// ran nested here before — no call site to update.


// ─────────────────────────────────────────────────────────────────────────────
// Category metadata — colors, gradients, spotlight tints
// ─────────────────────────────────────────────────────────────────────────────
const HOL_CAT = {
  hall:       { label: 'Hall of Fame',   icon: '🏛️', color: '#ffd873', grad: 'linear-gradient(135deg,#ffb95f,#d0bcff 55%,#4edea3)', glow: 'rgba(255,216,115,.32)', beam: 'rgba(255,255,255,.16)' },
  recitation: { label: 'Recitation',     icon: '🎤', color: '#4edea3', grad: 'linear-gradient(135deg,#4edea3,#06b6d4)',      glow: 'rgba(78,222,163,.28)',  beam: 'rgba(78,222,163,.14)'  },
  boss:       { label: 'Boss Raider',    icon: '⚔️',  color: '#EC4899', grad: 'linear-gradient(135deg,#EC4899,#9333ea)',      glow: 'rgba(236,72,153,.3)',   beam: 'rgba(236,72,153,.16)'  },
  academic:   { label: 'Academic',       icon: '📚', color: '#d0bcff', grad: 'linear-gradient(135deg,#8b5cf6,#d0bcff)',      glow: 'rgba(139,92,246,.28)',  beam: 'rgba(139,92,246,.14)'  },
  overall:    { label: 'Overall',        icon: '🏆', color: '#ffb95f', grad: 'linear-gradient(135deg,#ffb95f,#f97316)',      glow: 'rgba(255,185,95,.3)',   beam: 'rgba(255,185,95,.18)'  },
};

// Period labels for the filter bar
const HOL_PERIODS = [
  { key: 'all',     label: 'All Time' },
  { key: 'monthly', label: 'Monthly'  },
  { key: 'weekly',  label: 'Weekly'   },
  { key: 'daily',   label: 'Daily'    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Full-rankings-list pagination (rows beyond the top-3 podium)
// ─────────────────────────────────────────────────────────────────────────────
const HOL_PAGE_SIZE = 20;
let _holPage = 1;
let _holLastTabPeriodKey = '';

export const holGoToPage = function (page) {
  _holPage = Math.max(1, page | 0);
  window.renderLeaderboard(window._eqlActiveTab, window._eqlActivePeriod);
  const list = document.getElementById(`hol-list-${window._eqlActiveTab || 'hall'}`);
  if (list) list.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
export const holPrevPage = function () { window.holGoToPage(_holPage - 1); };
export const holNextPage = function () { window.holGoToPage(_holPage + 1); };

function _holPagination(page, totalPages, totalCount, rangeStart, rangeEnd) {
  if (totalPages <= 1) {
    return `<div class="hol-page-range">Showing all ${totalCount}</div>`;
  }
  const nums = new Set([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  const pages = Array.from(nums).filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  let btns = '';
  let prevN = 0;
  pages.forEach(n => {
    if (n - prevN > 1) btns += `<span class="hol-page-ellipsis">…</span>`;
    btns += `<button class="hol-page-btn ${n === page ? 'active' : ''}" onclick="holGoToPage(${n})">${n}</button>`;
    prevN = n;
  });
  return `
    <div class="hol-pagination">
      <button class="hol-page-btn" ${page <= 1 ? 'disabled' : ''} onclick="holPrevPage()">← Prev</button>
      ${btns}
      <button class="hol-page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="holNextPage()">Next →</button>
    </div>
    <div class="hol-page-range">Showing ${rangeStart}–${rangeEnd} of ${totalCount}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Period → resetAt conversion (client-side, for display filtering)
// ─────────────────────────────────────────────────────────────────────────────
function _holPeriodResetAt(period) {
  if (period === 'all') return null;
  const now = new Date();
  if (period === 'daily') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString();
  }
  if (period === 'weekly') {
    const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString();
  }
  if (period === 'monthly') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1); return d.toISOString();
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get equipped title object for a student (returns title obj or null)
// ─────────────────────────────────────────────────────────────────────────────
function _holGetTitleObj(student) {
  return (typeof tsGetEquippedTitle === 'function') ? tsGetEquippedTitle(student.id) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derive a short title for a student
// ─────────────────────────────────────────────────────────────────────────────
function _holGetTitle(student, categoryKey) {
  // 0. Equipped titles override all fallback labels
  const equipped = (typeof tsGetEquippedTitle === 'function') ? tsGetEquippedTitle(student.id) : null;
  if (equipped) return equipped.name;

  // 1. Check unlocked achievement names for category-appropriate titles
  const unlocks = (AppStore.getSlice(s => s.achievementUnlocks) || {})[student.id] || [];
  if (unlocks.length > 0) {
    const achList = (AppStore.getSlice(s => s.achievements) || []);
    const rarityOrder = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
    for (const rarity of rarityOrder) {
      const ach = achList.find(a => a.rarity === rarity && unlocks.some(u => u.achId === a.id));
      if (ach) return ach.name;
    }
  }

  // 2. Category-specific fallback titles based on student tier/stats
  const tierTitles = {
    'Master':   { overall: 'Grand Master', boss: 'Raid Legend',   recitation: 'Voice of Wisdom', academic: 'Top Scholar'  },
    'Scholar':  { overall: 'Scholar',      boss: 'Raid Veteran',  recitation: 'Silver Tongue',   academic: 'Bright Mind'  },
    'Achiever': { overall: 'Achiever',      boss: 'Raider',        recitation: 'Eager Speaker',   academic: 'Quest Seeker' },
    'Novice':   { overall: 'Novice',        boss: 'Recruit',       recitation: 'Rising Voice',    academic: 'Apprentice'   },
  };
  const tier   = student.tier || 'Scholar';
  const catKey = categoryKey === 'hall' ? 'overall' : categoryKey;
  return (tierTitles[tier] || {})[catKey] || student.tier || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG spotlight beams for the stage — 3 beams, one per podium slot
// ─────────────────────────────────────────────────────────────────────────────
function _holBeamSVG(beamColor) {
  const cx       = [25, 50, 75];
  const opacities = [0.55, 0.85, 0.45];
  const widths    = [18,  26,   16];
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"
      style="position:absolute;inset:0;pointer-events:none;">
      <defs>
        <filter id="hol-blur"><feGaussianBlur stdDeviation="2.5"/></filter>
      </defs>
      ${cx.map((x, i) => `
      <polygon
        points="${x - widths[i] / 2},0 ${x + widths[i] / 2},0 ${x + widths[i]},100 ${x - widths[i]},100"
        fill="${beamColor}"
        opacity="${opacities[i]}"
        filter="url(#hol-blur)"
      />
      `).join('')}
    </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render a single podium card
// ─────────────────────────────────────────────────────────────────────────────
function _holRenderCard(entry, rankNum, catKey, meta) {
  if (!entry) {
    return `<div class="hol-card rank${rankNum}" style="opacity:.3;padding-bottom:24px;">
        <div style="color:rgba(240,238,255,.25);font-family:var(--fm);font-size:11px;font-weight:800;letter-spacing:.08em;padding-top:20px;text-align:center;">#${rankNum}</div>
      </div>`;
  }
  const s      = entry.student;
  const color  = _cssColor(s.color);
  const title  = _holGetTitle(s, catKey);
  const medals = ['🥇', '🥈', '🥉'];

  // BUGFIX (Investigation Report §2): the initials <span> used to be
  // rendered unconditionally alongside the <img>, so it was always in the
  // DOM and could peek out from behind/around the photo. "Has photo" is
  // now a real conditional — only one of img/initials ever exists at a
  // time, matching the pattern att_scanner_rfid.js's _rfidProfileCardHtml()
  // already uses correctly. A broken image URL swaps in the initials at
  // the moment it fails to load, rather than initials sitting underneath
  // a photo that hasn't failed yet.
  const portraitHtml = s.profilePic
    ? `<div class="hol-portrait" style="background:${color}22;border-color:${color}55;">
           <img src="${_esc(s.profilePic)}" alt="${_esc(s.name)}" onerror="this.parentElement.style.color='${color}';this.parentElement.innerHTML='<span class=&quot;hol-portrait-init&quot;>${_esc(s.init)}</span>'">
         </div>`
    : `<div class="hol-portrait" style="background:${color}22;color:${color};border-color:${color}55;">
           <span class="hol-portrait-init">${_esc(s.init)}</span>
         </div>`;

  // Rank1 gets the full 6-particle ember plume (it's the centerpiece);
  // rank2/rank3 get a lighter 4-particle plume recolored to match their
  // theme, so all three podium spots feel alive without tripling the
  // total particle count animating on screen at once.
  const emberLefts     = [10, 24, 40, 58, 74, 88];
  const secondaryLefts = [16, 38, 62, 84];
  const particleThemeClass = rankNum === 1 ? 'hol-embers-fire'
    : rankNum === 2 ? 'hol-embers-icy'
    : rankNum === 3 ? 'hol-embers-bronze' : '';
  const particleLefts = rankNum === 1 ? emberLefts : secondaryLefts;
  const embersHtml = (rankNum >= 1 && rankNum <= 3)
    ? `<div class="hol-embers ${particleThemeClass}">${particleLefts.map((left, i) =>
        `<span class="hol-ember" style="left:${left}%;animation-delay:${(i * 0.5).toFixed(1)}s;animation-duration:${(2.6 + (i % 3) * 0.4).toFixed(1)}s"></span>`
      ).join('')}</div>`
    : '';

  const rankBadgeHtml = rankNum === 1
    ? `<div class="hol-rank-badge hol-rank-badge-fire">1</div>`
    : `<div class="hol-rank-badge">${medals[rankNum - 1]}</div>`;

  // Crown lives inside .hol-portrait-wrap (not .hol-card) and sits low —
  // .hol-card has overflow:hidden, so anything above the card's own top
  // edge gets clipped invisible. Placing it here, low, guarantees it's
  // actually on screen, resting right on the portrait. Gold for 1st,
  // silver for 2nd, bronze for 3rd — same shape, recolored + slightly
  // smaller for 2nd/3rd so 1st still reads as the champion.
  const crownPalette = {
    1: { base: '#f59e0b', jewel: '#fde68a', side: '#fbbf24', band: '#d97706', glow: 'rgba(249,115,22,.7)' },
    2: { base: '#cbd5e1', jewel: '#f8fafc', side: '#e2e8f0', band: '#64748b', glow: 'rgba(203,213,225,.65)' },
    3: { base: '#cd7f32', jewel: '#fbcf9d', side: '#e3a35c', band: '#92400e', glow: 'rgba(205,127,50,.65)' },
  };
  const cp = crownPalette[rankNum];
  const crownHtml = (cp) ? `
      <div class="hol-crown-wrap${rankNum !== 1 ? ' hol-crown-wrap-sm' : ''}" style="--hol-crown-glow:${cp.glow}">
        <svg viewBox="0 0 46 34" fill="none" xmlns="http://www.w3.org/2000/svg" width="${rankNum === 1 ? 46 : 38}" height="${rankNum === 1 ? 34 : 28}" overflow="visible">
          <path d="M3 29 L10 8 L23 18 L36 8 L43 29 Z" fill="${cp.base}" stroke="${cp.side}" stroke-width="1.4" stroke-linejoin="round"/>
          <circle cx="3"  cy="29" r="2.8" fill="${cp.base}"/>
          <circle cx="43" cy="29" r="2.8" fill="${cp.base}"/>
          <circle cx="23" cy="8"  r="3" fill="${cp.jewel}"/>
          <circle cx="10" cy="8"  r="2.2" fill="${cp.side}"/>
          <circle cx="36" cy="8"  r="2.2" fill="${cp.side}"/>
          <rect x="1.5" y="28.5" width="42" height="4.2" rx="1.8" fill="${cp.band}"/>
        </svg>
      </div>` : '';

  const displayName = s.displayName || s.name;
  const firstName   = displayName.split(' ')[0];

  // tsBuildBadgeHTML typeof guard — safe until Day 8 (titles module)
  // Rendered at full size (not opts.small) now that it lives in the
  // bigger footprint left behind by the removed plinth.
  const titleObj = _holGetTitleObj(s);
  const titleDisplayHTML = (titleObj && typeof tsBuildBadgeHTML === 'function')
    ? `<div class="hol-card-title">${tsBuildBadgeHTML(titleObj, { noParticles: true })}</div>`
    : (title ? `<div class="hol-card-title" style="--hol-title-color:${color}88">${_esc(title)}</div>` : '');

  return `<div class="hol-card rank${rankNum}" title="${_esc(displayName)}" style="">
      ${embersHtml}
      <div class="hol-portrait-wrap">
        ${portraitHtml}
        ${crownHtml}
        ${rankBadgeHtml}
      </div>
      <div class="hol-card-name">${_esc(firstName)}</div>
      <div class="hol-card-score" style="color:${meta.color}">${entry.scoreLabel}</div>
      <div class="hol-card-score-lbl">${catKey === 'boss' ? 'damage' : catKey === 'recitation' ? 'points' : catKey === 'hall' ? 'experience' : 'score'}</div>
      ${titleDisplayHTML}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the complete stage scene (podium + beams + header)
// ─────────────────────────────────────────────────────────────────────────────
function _holRenderStage(entries, catKey, periodKey, myEntry) {
  const meta        = HOL_CAT[catKey] || HOL_CAT.overall;
  const periodLabel = (HOL_PERIODS.find(p => p.key === periodKey) || HOL_PERIODS[0]).label;
  const isHall       = catKey === 'hall';

  // Slot order: index 1 (2nd), index 0 (1st), index 2 (3rd)
  const slots = [entries[1], entries[0], entries[2]];
  const ranks = [2, 1, 3];

  const myRank      = myEntry ? `#${myEntry.rank}` : '—';
  const myScore     = myEntry ? myEntry.scoreLabel  : '—';
  const myName      = myEntry ? (myEntry.student.displayName || myEntry.student.name).split(' ')[0] : 'You';
  const isInPodium  = myEntry && myEntry.rank <= 3;

  // Hall exclusive: a lazy drifting field of gold dust across the whole
  // stage (not just the podium cards) — reads as "the whole room", since
  // this is the class's flagship board, not one activity's leaderboard.
  const sparkleLefts = [4, 12, 20, 30, 38, 48, 58, 66, 74, 82, 90, 96];
  const sparkleHtml = isHall
    ? `<div class="hol-sparkle-field">${sparkleLefts.map((left, i) => {
        const size = 2 + (i % 3);
        const top  = 15 + ((i * 37) % 70);
        return `<span class="hol-sparkle" style="left:${left}%;top:${top}%;width:${size}px;height:${size}px;animation-delay:${(i * 0.55).toFixed(2)}s;animation-duration:${(4.5 + (i % 4)).toFixed(1)}s"></span>`;
      }).join('')}</div>`
    : '';

  return `<div class="hol-stage${isHall ? ' hol-stage-legendary' : ''}">
      ${isHall ? '<div class="hol-legend-bar"></div>' : ''}
      ${sparkleHtml}
      <div class="hol-beams">${_holBeamSVG(meta.beam)}</div>
      <div class="hol-scene-header">
        <div class="hol-scene-kicker">${isHall ? 'The Flagship Board' : 'Hall of Legends'}</div>
        <div class="hol-scene-title" style="--hol-grad:${meta.grad};--hol-glow:${meta.glow}">${meta.icon} ${meta.label}</div>
        <div class="hol-scene-period">${isHall ? 'Class-wide · All Activities' : periodLabel}</div>
      </div>

      <div class="hol-podium-row">
        ${slots.map((e, i) => _holRenderCard(e, ranks[i], catKey, meta)).join('')}
      </div>

      ${(myEntry && !isInPodium) ? `<div class="hol-my-rank-bar">
        <div>
          <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">Your Standing</div>
          <div style="font-size:13px;font-weight:700;color:var(--on-surface)">${_esc(myName)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="text-align:right">
            <div class="hol-my-rank-score" style="color:${meta.color}">${myScore}</div>
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:.05em">score</div>
          </div>
          <div style="text-align:center">
            <div class="hol-my-rank-num">${myRank}</div>
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:.05em">rank</div>
          </div>
        </div>
      </div>` : ''}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hall-exclusive: class-wide summary strip beneath the podium — total
// legends, combined XP, average level, and top tier count. Gives the
// flagship board a "hub overview" feel none of the single-category
// leaderboards have.
// ─────────────────────────────────────────────────────────────────────────────
function _holRenderHallSummary(entries) {
  const totalStudents = entries.length;
  const active        = entries.filter(e => e.score > 0).length;
  const totalXP        = entries.reduce((a, e) => a + (e.score || 0), 0);
  const avgLevel       = totalStudents ? Math.round(entries.reduce((a, e) => a + (e.student.level || 1), 0) / totalStudents) : 0;
  const masters        = entries.filter(e => e.student.tier === 'Master').length;

  const cards = [
    { icon: '🎓', val: totalStudents.toLocaleString(), lbl: 'Class Legends' },
    { icon: '✨', val: totalXP.toLocaleString(),        lbl: 'Combined XP' },
    { icon: '📈', val: 'Lv ' + avgLevel,                lbl: 'Average Level' },
    { icon: '👑', val: masters.toLocaleString(),        lbl: 'Grand Masters' },
  ];

  return `<div class="hol-hall-summary">
      ${cards.map(c => `<div class="hol-summary-card">
        <div class="hol-summary-icon">${c.icon}</div>
        <div class="hol-summary-val">${c.val}</div>
        <div class="hol-summary-lbl">${c.lbl}</div>
      </div>`).join('')}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render a single row for rank #4 onward
// ─────────────────────────────────────────────────────────────────────────────
function _holRenderRow(entry, catKey, meta, animDelay) {
  const { rank, student: s, stats, scoreLabel } = entry;
  const isMe  = currentUser && s.id === currentUser.id;
  const color = _cssColor(s.color);
  const title = _holGetTitle(s, catKey);

  let rowTint = '';
  if (rank === 1)      rowTint = 'top3-gold';
  else if (rank === 2) rowTint = 'top3-silver';
  else if (rank === 3) rowTint = 'top3-bronze';

  // BUGFIX (Investigation Report §2): the initials <span> was explicitly
  // z-index:1 — one layer above the photo — so it always painted on top
  // regardless of whether the photo loaded. Only render one or the other;
  // a broken image URL swaps in the initials at load-failure time.
  const avHtml = s.profilePic
    ? `<div class="hol-row-av" style="border-color:${color}44;background:${color}11;">
           <img src="${_esc(s.profilePic)}" alt="${_esc(s.name)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.style.background='${color}22';this.parentElement.style.color='${color}';this.parentElement.textContent='${_esc(s.init)}'">
         </div>`
    : `<div class="hol-row-av" style="border-color:${color}44;background:${color}22;color:${color};">${_esc(s.init)}</div>`;

  let sub = '';
  switch (catKey) {
    case 'hall':
      sub = `✅ ${(s.attendance || 0)}% attendance · ${s.tier || 'Novice'}`;
      break;
    case 'recitation':
      sub = `🎤 ${(stats.sessionCount || 0)} sessions · 🔥 ${(stats.streak || 0)} streak`;
      break;
    case 'boss':
      sub = `⚔️ ${(stats.participationCount || 0)} raids · 🏆 ${(stats.victories || 0)} victories`;
      break;
    case 'academic':
      sub = `📖 ${(stats.quizCount || 0)} quests · ⭐ ${(stats.perfectScores || 0)} perfect`;
      break;
    case 'overall':
      sub = `XP ${(stats.baseXP || 0).toLocaleString()} · 🎤 ${(stats.recitationPts || 0)} pts`;
      break;
  }

  const rankLabel = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;

  // tsBuildBadgeHTML typeof guard
  const titleObj = _holGetTitleObj(s);
  const titleLineHTML = (titleObj && typeof tsBuildBadgeHTML === 'function')
    ? `<div class="hol-row-title" style="margin-top:2px;display:flex;align-items:center">${tsBuildBadgeHTML(titleObj, { small: true, noParticles: true })}</div>`
    : (title ? `<div class="hol-row-title" style="color:${color}88">${_esc(title)}</div>` : '');

  return `<div class="hol-row ${rowTint} ${isMe ? 'hol-me' : ''}"
      style="animation-delay:${animDelay}ms">
      <div class="hol-row-rank">${rankLabel}</div>
      ${avHtml}
      <div class="hol-row-info">
        <div class="hol-row-name">
          ${_esc(s.displayName || s.name)}
          ${isMe ? '<span class="hol-row-badge-you">You</span>' : ''}
        </div>
        ${titleLineHTML}
        <div class="hol-row-sub">${sub}</div>
      </div>
      <div class="hol-row-score">
        <div class="hol-row-score-main" style="color:${meta.color}">${scoreLabel}</div>
        <div class="hol-row-score-lbl">${s.tier} · LV${s.level}</div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the category + period selector bars
// ─────────────────────────────────────────────────────────────────────────────
function _holBuildNavBars(activeTab, activePeriod) {
  const cats = [
    { key: 'hall',       label: 'Hall of Fame', icon: '🏛️' },
    { key: 'overall',    label: 'Overall',       icon: '🏆' },
    { key: 'recitation', label: 'Recitation',    icon: '🎤' },
    { key: 'boss',       label: 'Boss Raider',   icon: '⚔️'  },
    { key: 'academic',   label: 'Academic',      icon: '📚' },
  ];
  const catBar = `<div class="hol-cat-bar">
      ${cats.map(c => `<button class="hol-cat-btn ${c.key === 'hall' ? 'hall-tab' : ''} ${activeTab === c.key ? 'active' : ''}"
        onclick="renderLeaderboard('${c.key}','${activePeriod}')">
        <span class="hol-cat-icon">${c.icon}</span>${c.label}
      </button>`).join('')}
    </div>`;

  const periodBar = activeTab !== 'hall' ? `<div class="hol-period-bar">
      ${HOL_PERIODS.map(p => `<button class="hol-period-btn ${activePeriod === p.key ? 'active' : ''}"
        onclick="renderLeaderboard('${activeTab}','${p.key}')">${p.label}</button>`).join('')}
    </div>` : '';

  return `<div class="hol-nav">${catBar}</div>${periodBar}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Which page container to render into — students get #s-leaderboard,
// teachers/admins get their own #a-hall-of-fame page so staff can view
// the Hall of Fame without needing the separate Leaderboard Admin
// (config-only) page.
// ─────────────────────────────────────────────────────────────────────────────
function _holTargetPageId() {
  const staff = (typeof currentRole !== 'undefined') && (currentRole === 'admin' || currentRole === 'teacher');
  return staff ? 'a-hall-of-fame' : 's-leaderboard';
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PATCH: renderLeaderboard
// All five tabs — hall, overall, recitation, boss, academic — share this
// one pipeline. 'hall' is class-wide XP/level standing (no period concept,
// since XP is cumulative, not an event log); the other four are EQL
// category scores with optional period filtering.
// ─────────────────────────────────────────────────────────────────────────────
export const renderLeaderboard = function (activeTab, activePeriod) {
  activeTab    = activeTab    || window._eqlActiveTab    || 'hall';
  activePeriod = activePeriod || window._eqlActivePeriod || 'all';
  window._eqlActiveTab    = activeTab;
  window._eqlActivePeriod = activePeriod;

  const tabPeriodKey = activeTab + '|' + activePeriod;
  if (tabPeriodKey !== _holLastTabPeriodKey) { _holPage = 1; _holLastTabPeriodKey = tabPeriodKey; }

  const isStaffViewer = (typeof currentRole !== 'undefined') && (currentRole === 'admin' || currentRole === 'teacher');
  const leaderboardConfig = AppStore.getSlice(s => s.leaderboardConfig) || {};
  const cfg     = leaderboardConfig[activeTab] || {};
  const enabled = cfg.enabled !== false;
  const meta    = HOL_CAT[activeTab] || HOL_CAT.overall;

  // Period-aware resetAt (overrides stored config reset for display purposes)
  const periodResetAt = _holPeriodResetAt(activePeriod);

  // Build entries with period filter applied
  let entries = [];
  if (enabled) {
    const allStudents = AppStore.getSlice(s => s.students) || [];
    // Shared across the whole roster below — same rationale as
    // eqlBuildCategory's cache in eql-engine.js: without this,
    // eqlComputeRecitation/Boss/Academic/Overall would each clone
    // recitationLog/bossEvents/bossParticipants/pointLog/students once
    // per student instead of once per render.
    const cache = {
      recitationLog: AppStore.getSlice(s => s.recitationLog) || [],
      bossEvents: AppStore.getSlice(s => s.bossEvents) || [],
      bossParticipants: AppStore.getSlice(s => s.bossParticipants) || {},
      pointLog: AppStore.getSlice(s => s.pointLog) || [],
      students: allStudents,
    };
    entries = allStudents.map(student => {
      let stats, score, scoreLabel;
      switch (activeTab) {
        case 'hall': {
          // Class-wide flagship ranking — raw XP/level standing, the same
          // number shown on the student's own sidebar and dashboard.
          stats      = { xp: student.xp || 0, level: student.level || 1, tier: student.tier || 'Novice', attendance: student.attendance || 0 };
          score      = student.xp || 0;
          scoreLabel = score.toLocaleString() + ' XP';
          break;
        }
        case 'recitation': {
          stats      = eqlComputeRecitation(student.id, periodResetAt, cache);
          score      = stats.totalPts;
          scoreLabel = score.toLocaleString() + ' pts';
          break;
        }
        case 'boss': {
          stats      = eqlComputeBoss(student.id, periodResetAt, cache);
          score      = stats.totalDamage;
          scoreLabel = score.toLocaleString() + ' DMG';
          break;
        }
        case 'academic': {
          stats      = eqlComputeAcademic(student.id, periodResetAt, cache);
          score      = stats.academicXP + stats.perfectScores * 200 + stats.questCompletions * 50;
          scoreLabel = score.toLocaleString() + ' pts';
          break;
        }
        default: {
          stats      = eqlComputeOverall(student.id, periodResetAt, cache);
          score      = stats.score;
          scoreLabel = score.toLocaleString() + ' pts';
          break;
        }
      }
      return { student, stats, score, scoreLabel };
    });
    entries.sort((a, b) => b.score - a.score);
    let cr = 1;
    entries.forEach((e, i) => {
      if (i > 0 && entries[i - 1].score === e.score) e.rank = entries[i - 1].rank;
      else e.rank = cr;
      cr = e.rank + 1;
    });
  }

  const myEntry = entries.find(e => currentUser && e.student.id === currentUser.id);
  const myRank  = myEntry ? myEntry.rank : '—';
  const active  = entries.filter(e => e.score > 0).length;
  const top3    = entries.slice(0, 3);
  const isHall  = activeTab === 'hall';

  const pg = document.getElementById(_holTargetPageId());
  if (!pg) return;

  pg.innerHTML = `
    <div class="page-hero">
      <div class="page-hero-bg"></div>
      <div class="page-hero-bg2"></div>
      <div style="position:relative;z-index:1">
        <div class="page-hero-label">🏆 Hall of Legends</div>
        <h1 style="font-family:var(--fh);font-size:32px;font-weight:900;color:var(--on-surface);margin-bottom:8px">${isHall ? 'Class Rankings' : meta.label + ' Rankings'}</h1>
        <p style="font-size:14px;color:var(--text-muted)">${
        isStaffViewer
          ? (isHall ? 'Where your class\'s legends are forged.' : `See how your class stacks up in ${meta.label}.`)
          : (myEntry ? `Your rank: <span style="color:${meta.color};font-weight:700">#${myRank}</span>` : 'Where legends are forged.')
      }</p>
      </div>
    </div>

    ${_holBuildNavBars(activeTab, activePeriod)}

    ${!enabled
    ? `<div class="hol-disabled">
          <div style="font-size:44px;margin-bottom:14px">🔒</div>
          <div style="font-family:var(--fh);font-size:17px;font-weight:900;color:var(--on-surface);margin-bottom:6px">Leaderboard Disabled</div>
          <div style="font-size:13px;color:var(--text-muted)">This leaderboard is currently turned off${isStaffViewer ? '.' : ' by your teacher.'}</div>
         </div>`
    : entries.length < 1
      ? `<div class="hol-empty">
            <div class="hol-empty-icon">${meta.icon}</div>
            <div class="hol-empty-title">No Data Yet</div>
            <div class="hol-empty-sub">Rankings will appear here as students participate. Be the first on the board!</div>
           </div>`
      : `
    ${_holRenderStage(top3, activeTab, activePeriod, myEntry)}

    ${isHall ? _holRenderHallSummary(entries) : ''}

    <div class="hol-list-header">
      <div class="hol-list-title">
        <span class="material-symbols-outlined" style="color:${meta.color};font-size:20px">format_list_numbered</span>
        Full Rankings
        <span class="hol-active-pill">${active} active</span>
      </div>
    </div>
    <div id="hol-list-${activeTab}">
      ${(() => {
      const rest = entries.filter(e => e.rank > 3);
      const totalPages = Math.max(1, Math.ceil(rest.length / HOL_PAGE_SIZE));
      if (_holPage > totalPages) _holPage = totalPages;
      const start = (_holPage - 1) * HOL_PAGE_SIZE;
      const shown = rest.slice(start, start + HOL_PAGE_SIZE);
      return shown.map((e, i) => _holRenderRow(e, activeTab, meta, Math.min(i * 22, 200))).join('')
        + _holPagination(_holPage, totalPages, rest.length, rest.length ? start + 1 : 0, start + shown.length);
    })()}
    </div>`
  }`;
};

console.log('[HOL] hall-of-fame.js loaded. renderLeaderboard patched with HOL stage.');
