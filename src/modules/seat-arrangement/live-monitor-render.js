// src/modules/seat-arrangement/live-monitor-render.js — real-ESM twin of
// ../../../modules/seat-arrangement/live-monitor-render.js.
// Phase 7 (Stream D), file 28/30. Original stays untouched.
//
// All 11 top-level declared functions are exported (keyword swap `function` -> `export function` only): _lmRender, _lmScaleCanvas,
// _lmRenderCanvas, _lmRenderSidebar, _lmRenderAttendanceSidebar, _lmOverridePanelHtml, _lmFeedItem, _lmRenderRecitationSidebar,
// _lmRecitationFeedItem, _lmAnimateNewRecitationEntries, _lmSpawnFloatingPoint. The original's own trailing "Phase 7 explicit window
// exports" block (5 `window._lmX = _lmX` lines) is KEPT VERBATIM. The file-wide 'use strict'; is dropped (modules are strict) and the
// import block takes its place. Everything else, including the body's historical 2-space indent, is byte-identical to the original.
//
// REAL IMPORTS: AppStore (../core/state-manager.js), _esc / isoDate (../../utils.js), ClassroomService (./classroom-service.js, file 4),
// RecitationService (./recitation-service.js, file 5), CB_CANVAS_W / CB_CANVAS_H (./classroom_builder.js, file 16),
// _lmWebNfcSupported (./live-monitor-webnfc.js, file 17). None of those twins reaches back into this file (live_monitor.js and the
// recitation / webnfc twins call the render functions only through bare window names), so there is no ES cycle.
//
// SHARED STATE (the part that needed thought): the original READS 17 live-monitor lets declared by live_monitor.js (_lmClassId, _lmLayoutId,
// _lmStrategy, _lmTargetedSeatIds, _lmKioskMode, _lmRecitationMode, _lmSessionStartAt, _lmWebNfcActive, _lmAwardSearch/_StudentId/_Points,
// _lmOverrideStudentId/_Status/_Note/_Expanded, _lmRecitationSeenIds [.add only], _lmResizeListenerAttached) and WRITES exactly one of
// them: `_lmResizeListenerAttached = true` in _lmRender. Since file 27, live_monitor.js publishes all of them as window ACCESSORS onto its
// module-private bindings, so every bare name here resolves to window.<name> and lands on the one real binding, live, in both directions.
// NOTHING IN THIS FILE CHANGED FOR THAT (the single bare write goes through the accessor setter; strict mode does not throw because the
// property exists on the global object). Do not "fix" these into imports: an importer cannot assign.
//
// BINDING NOTE: the 11 functions call each other lexically now (_lmRenderCanvas, _lmRenderSidebar, _lmScaleCanvas, ... inside _lmRender).
// Wrapper audit (tools/audit-patched-exports.js + repo grep): no other file assigns or wraps any of the 11 names (live_monitor.js only mentions
// them in comments / calls them bare), so lexical resolution cannot skip a wrapper. The 5 names live_monitor.js and the recitation twin call
// bare (_lmRender, _lmRenderCanvas, _lmRenderSidebar, _lmRenderRecitationSidebar, _lmAnimateNewRecitationEntries) are attached to window by
// the original's trailing block plus the bridge. `window.addEventListener('resize', _lmScaleCanvas)` now registers the module-local function
// (same function the original registered).
//
// Inline-handler strings in the markup (window._lmOnClassChange, _lmToggleKioskMode, _lmStartColdCall, _lmToggleRecitationMode,
// _lmToggleWebNfc, _lmSelectAwardStudentFromSeat, ...) resolve through window at click time exactly as before.
// ─────────────────────────────────────────────────────────────────────────────
// LIVE MONITOR — render layer (DOM painting only)
//
// Phase 6 (Decompose God Files) extraction from live_monitor.js. Owns every
// "given current module state, paint the DOM" function: the toolbar/canvas/
// sidebar shell, the read-only seating canvas, the attendance scoreboard +
// arrival feed, the manual-override panel markup, the recitation command
// center sidebar (award panel + undo-able feed), and the floating "+N" score
// animation. No behavior change — every function below is moved verbatim
// (original 2-space indent kept as-is, not reflowed to top-level 0-indent —
// see this session's Refactoring Report entry for why: keeping the text
// byte-identical to the original let every extraction here be verified with
// an exact diff instead of an eyeball review, which mattered more than
// cosmetic reindenting for a file this size with no test coverage).
//
// WHY THIS WAS SAFE TO EXTRACT (checked before moving anything, not
// assumed): every function here was read to confirm it only READS the
// module state declared in live_monitor.js (_lmClassId, _lmLayoutId,
// _lmStrategy, _lmTargetedSeatIds, _lmKioskMode, _lmRecitationMode,
// _lmSessionStartAt, _lmAwardSearch/_lmAwardStudentId/_lmAwardPoints,
// _lmOverrideStudentId/_lmOverrideStatus/_lmOverrideNote/_lmOverrideExpanded,
// _lmResizeListenerAttached) and never assigns to it — with one deliberate
// exception: _lmAnimateNewRecitationEntries() adds ids to
// _lmRecitationSeenIds (a dedup Set, so a repaint never re-plays the same
// entry's float animation twice). That's fine for the same reason
// classroom_builder.js's render-layer split relied on: these are shared
// top-level `let` bindings once live_monitor.js's IIFE wrapper is removed
// (see that file's own header note on this), not per-file state — a
// variable declared in one <script> tag is the same binding every other
// <script> tag on the page reads and writes, and top-level function
// declarations (all of these) attach to `window` immediately on load
// regardless of order.
//
// Exports: _lmRender(), _lmScaleCanvas(), _lmRenderCanvas(),
//   _lmRenderSidebar(), _lmRenderAttendanceSidebar(), _lmOverridePanelHtml(),
//   _lmFeedItem(), _lmRenderRecitationSidebar(), _lmRecitationFeedItem(),
//   _lmAnimateNewRecitationEntries(), _lmSpawnFloatingPoint()
//
// DEPENDENCIES: the module state above plus CB_CANVAS_W/H, ClassroomService,
// RecitationService, AppStore, _esc(), isoDate(), toast() — all globals
// already available wherever this file loads, same as when this code lived
// inside live_monitor.js. Must load after live_monitor.js (see index.html)
// so the state exists — though as with every other Phase 6 split, nothing
// here runs at load time beyond declarations, so which file loads first
// doesn't actually affect correctness, only reading order.
// ─────────────────────────────────────────────────────────────────────────────

import { AppStore } from '../core/state-manager.js';
import { _esc, isoDate } from '../../utils.js';
import { ClassroomService } from './classroom-service.js';
import { RecitationService } from './recitation-service.js';
import { CB_CANVAS_W, CB_CANVAS_H } from './classroom_builder.js';
import { _lmWebNfcSupported } from './live-monitor-webnfc.js';

// View-only state: filters never change attendance or the random picker pool.
const LMView = window.LMView = (() => {
  const view = {projection:false, scores:false, filter:'All', zoom:1, panX:0, panY:0, key:null, kiosk:null};
  let gesture = null;
  const group = status => ['Early','On Time','Present'].includes(status) ? 'Present' : ['Late','Absent','Excused'].includes(status) ? status : 'Unscanned';
  function controls() {
    return `<div class="lm-view-tools" role="group" aria-label="Monitor display controls">
      <button class="btn btn-ghost" data-lm-action="projection" aria-pressed="${view.projection}">${view.projection ? 'Exit projection view' : 'Projection view'}</button>
      <button class="btn btn-ghost" data-lm-action="fit">Center & fit seats</button>
      <span class="lm-zoom-controls"><button class="btn btn-ghost" data-lm-action="out" aria-label="Zoom out">−</button>
      <output id="lm-zoom-label" aria-label="Zoom relative to fit">100%</output>
      <button class="btn btn-ghost" data-lm-action="in" aria-label="Zoom in">+</button></span>
      <label><input type="checkbox" id="lm-show-scores" ${view.scores ? 'checked' : ''}> Show scores in projection</label>
      <span class="lm-pan-hint">Drag empty space to pan</span>
    </div><div class="lm-attendance-filters" id="lm-attendance-filters" role="group" aria-label="Highlight attendance"></div>
    <div class="lm-filter-summary" id="lm-filter-summary" role="status" aria-live="polite"></div>`;
  }
  function stats() {
    const state = AppStore.getState(), today = isoDate();
    const roster = (state.students || []).filter(s=>(s.classId || 'default-class') === _lmClassId);
    const byStudent = new Map((state.attendanceLogs || []).filter(l=>l.classId === _lmClassId && l.logDate === today).map(l=>[l.studentId,l.status]));
    const counts = {All:roster.length,Present:0,Late:0,Absent:0,Excused:0,Unscanned:0};
    roster.forEach(s=>counts[group(byStudent.get(s.id))]++);
    return counts;
  }
  function highlight() {
    const seats = [...document.querySelectorAll('#lm-canvas .lm-seat')];
    let matched = 0;
    seats.forEach(el=>{
      const matches = !!el.dataset.studentId && (view.filter === 'All' || group(el.dataset.attendanceStatus) === view.filter);
      el.classList.toggle('lm-filter-muted',view.filter !== 'All' && !matches);
      el.classList.toggle('lm-filter-match',view.filter !== 'All' && matches);
      if (matches) matched++;
    });
    const summary = document.getElementById('lm-filter-summary');
    if (summary) {
      const counts = stats(), total = counts[view.filter];
      summary.textContent = view.filter === 'All' ? 'Showing all seats · Attendance highlights do not change who can be picked.' : `${view.filter === 'Unscanned' ? 'Not checked in' : view.filter}: ${matched} seated · ${Math.max(0,total-matched)} without a seat. Highlight only; picker eligibility stays unchanged.`;
    }
  }
  function filters() {
    const bar = document.getElementById('lm-attendance-filters');
    if (!bar) return;
    bar.innerHTML = Object.entries(stats()).map(([key,count])=>`<button type="button" class="lm-attendance-chip" data-status="${key}" aria-pressed="${view.filter === key}"><span>${key === 'Unscanned' ? 'Not checked in' : key}</span><strong>${count}</strong></button>`).join('');
    bar.querySelectorAll('button').forEach(button=>button.onclick=()=>{view.filter = view.filter === button.dataset.status ? 'All' : button.dataset.status;filters();});
    highlight();
  }
  function applyMode() {
    document.body.classList.toggle('lm-projection-mode',view.projection);
    document.body.classList.toggle('lm-private-scores',view.projection && !view.scores);
    document.querySelector('.lm-page')?.classList.toggle('lm-projection',view.projection);
  }
  function fitCanvas() {
    const canvas = document.getElementById('lm-canvas'), wrap = document.getElementById('lm-canvas-wrap');
    if (!canvas || !wrap || wrap.clientWidth <= 0 || wrap.clientHeight <= 0) return;
    const seats = [...canvas.querySelectorAll('.lm-seat')];
    const points = seats.map(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    const left = points.length ? Math.min(...points.map(p=>p.x))-90 : 0;
    const top = points.length ? Math.min(...points.map(p=>p.y))-90 : 0;
    const right = points.length ? Math.max(...points.map(p=>p.x))+90 : CB_CANVAS_W;
    const bottom = points.length ? Math.max(...points.map(p=>p.y))+90 : CB_CANVAS_H;
    const base = Math.max(.03,Math.min(1.6,(wrap.clientWidth-40)/(right-left),(wrap.clientHeight-40)/(bottom-top)));
    const scale = base * view.zoom;
    const x = wrap.clientWidth/2-(left+right)/2*scale+view.panX;
    const y = wrap.clientHeight/2-(top+bottom)/2*scale+view.panY;
    canvas.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    canvas.style.transformOrigin = '0 0';
    const label = document.getElementById('lm-zoom-label');
    if (label) label.textContent = Math.round(view.zoom*100)+'%';
  }
  function reset() { view.zoom=1;view.panX=0;view.panY=0;fitCanvas(); }
  function mount() {
    const key = `${_lmClassId}:${_lmLayoutId}`;
    if (key !== view.key) {view.key=key;view.zoom=1;view.panX=0;view.panY=0;view.filter='All';}
    if (view.kiosk !== _lmKioskMode) {view.kiosk=_lmKioskMode;view.zoom=1;view.panX=0;view.panY=0;}
    document.querySelectorAll('[data-lm-action]').forEach(button=>button.onclick=()=>{
      const action=button.dataset.lmAction;
      if (action === 'projection') {
        view.projection=!view.projection;applyMode();reset();
        button.textContent=view.projection ? 'Exit projection view' : 'Projection view';button.setAttribute('aria-pressed',String(view.projection));
      } else if (action === 'fit') reset();
      else {view.zoom=Math.max(.5,Math.min(3,view.zoom+(action==='in'?.15:-.15)));fitCanvas();}
    });
    const checkbox=document.getElementById('lm-show-scores');
    if (checkbox) checkbox.onchange=()=>{view.scores=checkbox.checked;applyMode();};
    const wrap=document.getElementById('lm-canvas-wrap');
    if (wrap) {
      wrap.onpointerdown=e=>{
        if (e.button!==0 || e.target.closest('.lm-seat,button,input,select')) return;
        gesture={id:e.pointerId,x:e.clientX,y:e.clientY,panX:view.panX,panY:view.panY};
        wrap.setPointerCapture(e.pointerId);wrap.classList.add('lm-panning');e.preventDefault();
      };
      wrap.onpointermove=e=>{if(!gesture||e.pointerId!==gesture.id)return;view.panX=gesture.panX+e.clientX-gesture.x;view.panY=gesture.panY+e.clientY-gesture.y;fitCanvas();};
      wrap.onpointerup=wrap.onpointercancel=e=>{if(gesture?.id!==e.pointerId)return;gesture=null;wrap.classList.remove('lm-panning');};
    }
    applyMode();filters();requestAnimationFrame(fitCanvas);
  }
  function cleanup() {gesture=null;view.projection=false;view.scores=false;view.key=null;document.body.classList.remove('lm-projection-mode','lm-private-scores');}
  document.addEventListener('keydown',e=>{
    if (e.key!=='Escape' || !document.getElementById('a-classroom-monitor')?.classList.contains('active')) return;
    if (view.projection) {view.projection=false;applyMode();document.querySelector('[data-lm-action="projection"]')?.setAttribute('aria-pressed','false');const b=document.querySelector('[data-lm-action="projection"]');if(b)b.textContent='Projection view';reset();}
    else if (_lmKioskMode) window._lmToggleKioskMode();
  });
  return {controls,mount,fitCanvas,highlight,filters,cleanup};
})();

  export function _lmRender(page, classIds, state) {
    _lmClearCycle();
    const layouts = (state.classroomLayouts || []).filter(l => l.classId === _lmClassId);
    const coldCallDisabled = !_lmLayoutId ||
      (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);

    page.innerHTML = `
      <div class="lm-page">
        <div class="lm-toolbar">
          <span class="lm-toolbar-title">📡 Live Classroom Monitor</span>
          <select class="cb-class-select" id="lm-class-select" name="lm-class-select" onchange="window._lmOnClassChange(this.value)">${
            classIds.map(c => `<option value="${_esc(c)}"${c===_lmClassId?' selected':''}>${_esc(window.getClassLabel ? window.getClassLabel(c, state) : c)}</option>`).join('')
          }</select>
          <select class="cb-layout-select" id="lm-layout-select" name="lm-layout-select" onchange="window._lmOnLayoutChange(this.value)">${
            layouts.length
              ? layouts.map(l => `<option value="${_esc(l.id)}"${l.id===_lmLayoutId?' selected':''}>${_esc(l.name)}</option>`).join('')
              : `<option value="">— No layout for this class —</option>`
          }</select>

          <div style="margin-left:auto"></div>

          <button class="lm-fullscreen-btn${_lmKioskMode ? ' active' : ''}" id="lm-fullscreen-btn"
            onclick="window._lmToggleKioskMode()"
            title="${_lmKioskMode ? 'Exit fullscreen' : 'Fill the screen for projecting/kiosk display'}">
            ${_lmKioskMode ? '⤢ Exit Fullscreen' : '⛶ Fullscreen'}
          </button>

          ${_lmRecitationMode ? `
          <div class="lm-toolbar-sep" style="width:1px;height:28px;background:var(--border)"></div>

          <select class="lm-strategy-select" id="lm-strategy-select" title="Cold Call Strategy"
            onchange="window._lmOnStrategyChange(this.value)">
            <option value="pure_random" ${_lmStrategy==='pure_random'?'selected':''}>🎲 Pure Random</option>
            <option value="least_participative" ${_lmStrategy==='least_participative'?'selected':''}>🤫 Least Participative</option>
            <option value="late_only" ${_lmStrategy==='late_only'?'selected':''}>⏰ Late Only</option>
            <option value="spatial_block" ${_lmStrategy==='spatial_block'?'selected':''}>📍 Roll Selected Seats Only</option>
          </select>

          ${_lmStrategy === 'spatial_block' ? `
            <span class="lm-target-hint">
              👆 Tap present/late seats below to target them
              <span class="lm-target-count">${_lmTargetedSeatIds.size}</span>
            </span>
          ` : ''}
          <button class="lm-coldcall-btn" id="lm-coldcall-btn" onclick="window._lmStartColdCall()"
            ${coldCallDisabled ? 'disabled' : ''}>
            🎯 Pick Random Student
          </button>
          ` : ''}
          <button class="lm-recitation-toggle${_lmRecitationMode ? ' active' : ''}" id="lm-recitation-toggle"
            onclick="window._lmToggleRecitationMode()">
            ${_lmRecitationMode ? '🎤 Recitation Active' : '🎤 Start Recitation Session'}
          </button>
          ${_lmRecitationMode && _lmWebNfcSupported() ? `
          <button class="lm-recitation-toggle${_lmWebNfcActive ? ' active' : ''}" id="lm-webnfc-toggle"
            title="${_lmWebNfcActive ? 'Stop using this phone as an NFC reader' : 'Use this phone as an NFC reader — tap to arm, then hold cards to the back of the phone'}"
            onclick="window._lmToggleWebNfc()">
            ${_lmWebNfcActive ? '📱 NFC On — Roaming' : '📱 Use This Phone as Reader'}
          </button>
          ` : ''}
        </div>

        ${LMView.controls()}
        <div class="lm-workspace">
          <div class="lm-canvas-wrap" id="lm-canvas-wrap">
            <div class="lm-canvas" id="lm-canvas"></div>
          </div>
          <div class="lm-sidebar" id="lm-sidebar"></div>
        </div>
      </div>
    `;

    _lmRenderCanvas();
    _lmRenderSidebar();
    LMView.mount();
    _lmScaleCanvas();
    if (!_lmResizeListenerAttached) {
      window.addEventListener('resize', _lmScaleCanvas);
      _lmResizeListenerAttached = true;
    }
  }

  export function _lmScaleCanvas() {
    const wrap   = document.getElementById('lm-canvas-wrap');
    const canvas = document.getElementById('lm-canvas');
    if (!wrap || !canvas) return;
    if (!wrap.clientWidth || !wrap.clientHeight) {
      if (_lmMounted) requestAnimationFrame(_lmScaleCanvas);
      return;
    }
    LMView.fitCanvas();
  }

  // ── Canvas (read-only seating map) ───────────────────────────────────────────

  export function _lmRenderCanvas() {
    const canvas = document.getElementById('lm-canvas');
    if (!canvas) return;
    canvas.innerHTML = '';

    if (!_lmLayoutId) {
      canvas.innerHTML = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        color:var(--text-muted);font-size:13px">No layout selected for this class.</div>`;
      return;
    }

    const seatingMap = ClassroomService.getLiveSeatingMap(_lmClassId, _lmLayoutId);
    const eligibleStatuses = ['Early', 'On Time', 'Late'];

    // Task 1: session point counts, computed once per canvas paint rather
    // than once per seat — this screen can have dozens of seats and
    // getSessionCounts() already does a single pass over recitationLog.
    const recitationCounts = (_lmRecitationMode && _lmSessionStartAt)
      ? RecitationService.getSessionCounts(_lmClassId, _lmSessionStartAt)
      : null;

    seatingMap.forEach(vm => {
      const el = document.createElement('div');
      el.className = 'lm-seat';
      el.dataset.seatId = vm.seatId;
      el.dataset.attendanceStatus = vm.attendanceStatus || 'Unscanned';
      el.dataset.studentId = vm.studentId || '';
      el.setAttribute('aria-label', vm.studentId ? `${vm.studentName || 'Student'}: ${vm.attendanceStatus || 'Unscanned'}` : 'Empty seat');
      el.title = vm.studentId ? `${vm.studentName || 'Student'} · ${vm.attendanceStatus || 'Unscanned'}` : 'Empty seat';
      el.style.left = vm.xCoord + 'px';
      el.style.top  = vm.yCoord + 'px';
      el.style.transform = `translate(-50%,-50%) rotate(${vm.rotation || 0}deg)`;
      el.style.background = vm.color.bg;
      el.style.borderColor = vm.color.border;

      const studentColor = vm.studentColor || 'rgba(139,92,246,0.5)';
      // Task 1 — Live Counter Badge: only when isRecitationMode is true AND
      // the seat is occupied. A student with 0 points this session still
      // gets the badge (so "recitation mode is on and nobody's been called
      // yet" is visibly a zero, not just an absent badge that pops in on
      // their first point) — recitationCounts[id] defaults to 0 via `|| 0`.
      const badgeHtml = (recitationCounts && vm.studentId)
        ? `<div class="lm-recitation-badge" aria-label="${recitationCounts[vm.studentId] || 0} recitation points this session" data-badge-for="${_esc(vm.studentId)}">${recitationCounts[vm.studentId] || 0}</div>`
        : '';
      // Photo, if the student has one, layers over the initials as an <img>
      // absolutely positioned to fill the badge; onerror removes it so a
      // missing/broken URL falls back invisibly to the initials underneath
      // (same pattern used for avatars elsewhere in the app — topbar,
      // sidebar, dashboard, leaderboard).
      const photoHtml = vm.studentPhoto
        ? `<img src="${_esc(vm.studentPhoto)}" alt="" onerror="this.remove()">`
        : '';
      el.innerHTML = vm.studentId
        ? `<div class="lm-seat-init${badgeHtml ? ' lm-score-avatar' : ''}" style="background:${studentColor}"><span class="lm-avatar-identity">${photoHtml}${_esc(vm.studentInit || '?')}</span>${badgeHtml}</div>
           <div class="lm-seat-name">${_esc((vm.studentName||'').split(' ')[0])}</div>`
        : `<div style="font-size:18px;opacity:.25">🪑</div>`;

      // Spatial-block targeting: only seats that could actually win a roll
      // (present/late + occupied) are clickable for targeting — tapping an
      // absent student's or an empty seat would be a dead end, so it never
      // gets the 'targetable' affordance in the first place.
      //
      // BUGFIX: this branch used to run AFTER the general recitation-mode
      // award-click branch below, as an `else if`. Since spatial_block can
      // only be selected while recitation mode is already on, the award-click
      // branch's condition (`_lmRecitationMode && vm.studentId`) matched
      // every occupied seat first and this branch never ran — tapping seats
      // while "Roll Selected Seats Only" was selected always fell through to
      // award-selection instead of toggling the target pool, so a teacher
      // could never actually build a multi-seat selection. Checking the
      // active strategy first lets targeting win when it's the chosen mode.
      const isEligible = !!vm.studentId && eligibleStatuses.includes(vm.attendanceStatus);
      if (_lmRecitationMode && _lmStrategy === 'spatial_block' && isEligible) {
        el.classList.add('targetable');
        if (_lmTargetedSeatIds.has(vm.seatId)) el.classList.add('targeted');
        el.onclick = () => window._lmToggleSeatTarget(vm.seatId);
      } else if (_lmRecitationMode && vm.studentId) {
        // Task 3's "click seat -> select points" path for the Manual Award
        // Panel — what a seat click does whenever spatial_block targeting
        // isn't the thing currently in play.
        el.classList.add('targetable');
        el.onclick = () => window._lmSelectAwardStudentFromSeat(vm.studentId);
      }

      canvas.appendChild(el);
    });
    LMView.highlight();
  }

  // ── Sidebar: Scoreboard + Arrival Feed (Phase 1/2, unchanged) ───────────────
  // OR the Task 3 Recitation Command Center, when a session is active. The
  // branch happens here rather than inside a single mega-function so the
  // Phase 1/2 sidebar body below is untouched byte-for-byte from before —
  // Recitation Mode simply swaps which function owns #lm-sidebar's contents.

  export function _lmRenderSidebar() {
    if (_lmRecitationMode) { _lmRenderRecitationSidebar(); return; }
    _lmRenderAttendanceSidebar();
  }

  export function _lmRenderAttendanceSidebar() {
    const sidebar = document.getElementById('lm-sidebar');
    if (!sidebar) return;

    const state   = AppStore.getState();
    // BUGFIX: was new Date().toISOString().slice(0,10) — the UTC date, which
    // rolls the Live Monitor over to a new day 8 hours late relative to
    // Manila time. See utils.js isoDate() for the full explanation.
    const today   = isoDate();
    const roster  = (state.students || []).filter(s => (s.classId || 'default-class') === _lmClassId);
    const logs    = (state.attendanceLogs || [])
      .filter(l => l.classId === _lmClassId && l.logDate === today);

    // Arrival feed: every log with a scannedAt timestamp today, newest first.
    const feedLogs = logs
      .filter(l => l.scannedAt)
      .slice()
      .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))
      .slice(0, 30); // cap — this is a rolling feed, not a full audit log

    const studentById = Object.fromEntries(roster.map(s => [s.id, s]));

    sidebar.innerHTML = `
      ${_lmOverridePanelHtml(roster, { collapsible: false })}


      <div class="lm-feed-header">Arrival Feed</div>
      <div class="lm-feed" id="lm-feed">
        ${feedLogs.length ? feedLogs.map(l => _lmFeedItem(l, studentById[l.studentId])).join('') : `
          <div class="lm-feed-empty">No scans yet today.</div>
        `}
      </div>
    `;
  }

  // ── Phase 4: Manual Attendance Override Panel ───────────────────────────────
  // Shared markup for State A (always expanded, primary sidebar content) and
  // State B (collapsible, pinned to the bottom — see _lmRenderRecitationSidebar).
  // Submits through AttendanceService.overrideAttendance(), same RPC the old
  // standalone kiosk override form used — the logic didn't move, just the UI.
  export function _lmOverridePanelHtml(roster, opts) {
    opts = opts || {};
    const collapsible = !!opts.collapsible;
    const collapsed = collapsible && !_lmOverrideExpanded;
    const statuses = ['On Time', 'Early', 'Late', 'Absent', 'Excused', 'Remove'];

    return `
      <div class="lm-override-panel">
        <div class="lm-override-header" ${collapsible ? `onclick="window._lmToggleOverridePanel()" style="cursor:pointer"` : ''}>
          <h4>✏️ Manual Attendance Override</h4>
          ${collapsible ? `<span class="lm-override-caret">${collapsed ? '▸ Show' : '▾ Hide'}</span>` : ''}
        </div>
        ${collapsed ? '' : `
          <div class="lm-override-hint">Mark absent/present, or correct a scan anomaly. Stays available until the session is closed.</div>
          <select class="lm-override-select" id="lm-override-student" onchange="window._lmOnOverrideStudentChange(this.value)">
            <option value="">Select student…</option>
            ${roster.map(s => `<option value="${_esc(s.id)}" ${s.id === _lmOverrideStudentId ? 'selected' : ''}>${_esc(s.name || s.displayName || 'Student')}</option>`).join('')}
          </select>
          <select class="lm-override-select" id="lm-override-status" onchange="window._lmOnOverrideStatusChange(this.value)">
            ${statuses.map(v => `<option value="${_esc(v)}" ${v === _lmOverrideStatus ? 'selected' : ''}>${v === 'Remove' ? 'Remove entry' : v}</option>`).join('')}
          </select>
          <input class="lm-override-input" id="lm-override-note" placeholder="Optional note (e.g. reason for excused absence)"
            value="${_esc(_lmOverrideNote)}" oninput="window._lmOnOverrideNoteInput(this.value)" />
          <button class="lm-override-submit" id="lm-override-submit" ${_lmOverrideStudentId ? '' : 'disabled'}
            onclick="window._lmSubmitOverride()">Save Override</button>
        `}
      </div>
    `;
  }

  export function _lmFeedItem(log, student) {
    const time = log.scannedAt ? new Date(log.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const name = student ? (student.name || student.displayName || 'Unknown') : 'Unknown student';
    const statusTag = log.status === 'Late' ? ' <span style="color:var(--warning,#d7b16b);font-weight:700">[Marked Late]</span>'
      : log.status === 'Absent'  ? ' <span style="color:var(--danger,#e09393);font-weight:700">[Absent]</span>'
      : log.status === 'Excused' ? ' <span style="color:var(--info,#8caee0);font-weight:700">[Excused]</span>'
      : '';
    const verb = (log.entryMethod === 'RFID' || log.entryMethod === 'NFC') ? 'scanned in' : 'recorded';
    return `
      <div class="lm-feed-item">
        <div class="lm-feed-time">${_esc(time)}</div>
        <div class="lm-feed-text">${_esc(name)} ${verb}${statusTag}</div>
      </div>
    `;
  }

  // ── Phase 3: Recitation Command Center ──────────────────────────────────────

  // Task 3 — Sidebar Command Center: Session Status + Manual Award Panel +
  // the undo-able Recitation Feed. Rendered into #lm-sidebar in place of the
  // Scoreboard/Arrival Feed for as long as isRecitationMode is true.
  export function _lmRenderRecitationSidebar() {
    const sidebar = document.getElementById('lm-sidebar');
    if (!sidebar) return;

    const state   = AppStore.getState();
    const roster  = (state.students || []).filter(s => (s.classId || 'default-class') === _lmClassId);
    const entries = RecitationService.getSessionEntries(_lmClassId, _lmSessionStartAt);
    const studentById = Object.fromEntries(roster.map(s => [s.id, s]));

    const searchTerm = _lmAwardSearch.trim().toLowerCase();
    const matches = searchTerm
      ? roster.filter(s => (s.name || s.displayName || '').toLowerCase().includes(searchTerm))
      : roster;

    const selectedStudent = _lmAwardStudentId ? studentById[_lmAwardStudentId] : null;

    sidebar.innerHTML = `
      <div class="lm-recitation-status">
        <div class="lm-recitation-status-dot"></div>
        <div class="lm-recitation-status-text">Session Active — started ${_esc(_lmSessionStartAt ? new Date(_lmSessionStartAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '')}</div>
      </div>

      <div class="lm-award-panel">
        <h4>🎯 Manual Award</h4>
        <input class="lm-award-search" id="lm-award-search" placeholder="Search student by name…"
          value="${_esc(_lmAwardSearch)}" oninput="window._lmOnAwardSearchInput(this.value)" />
        <div class="lm-award-results" id="lm-award-results">
          ${matches.length ? matches.map(s => `
            <div class="lm-award-result${s.id === _lmAwardStudentId ? ' selected' : ''}"
              onclick="window._lmSelectAwardStudentFromSeat('${_esc(s.id)}')">
              <span>${_esc(s.name || s.displayName || 'Student')}</span>
              ${s.id === _lmAwardStudentId ? '<span>✓</span>' : ''}
            </div>`).join('') : `<div class="lm-award-empty">No matching students.</div>`}
        </div>
        ${selectedStudent ? `
          <div class="lm-award-selected">Selected: ${_esc(selectedStudent.name || selectedStudent.displayName)}</div>
        ` : ''}
        <div class="lm-points-row">
          ${[1, 2, 3, 5].map(n => `
            <button class="lm-points-btn${n === _lmAwardPoints ? ' selected' : ''}"
              onclick="window._lmSetAwardPoints(${n})">+${n}</button>
          `).join('')}
        </div>
        <button class="lm-award-submit" id="lm-award-submit" ${selectedStudent ? '' : 'disabled'}
          onclick="window._lmSubmitManualAward()">🎤 Award Points</button>
      </div>

      <div class="lm-feed-header">Recitation Feed</div>
      <div class="lm-feed" id="lm-feed">
        ${entries.length ? entries.map(e => _lmRecitationFeedItem(e, studentById[e.studentId])).join('') : `
          <div class="lm-feed-empty">No recitations logged yet this session.</div>
        `}
      </div>

      ${_lmOverridePanelHtml(roster, { collapsible: true })}
    `;
  }

  export function _lmRecitationFeedItem(entry, student) {
    const name = student ? (student.name || student.displayName || 'Unknown') : 'Unknown student';
    const time = entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const via  = entry.note === 'Manual award' || (entry.note && !/^scan$/i.test(entry.note)) ? (entry.note ? entry.note : 'manual') : 'scan';
    return `
      <div class="lm-recitation-feed-item">
        <div class="lm-recitation-feed-main">
          <div class="lm-recitation-feed-name">${_esc(name)}</div>
          <div class="lm-recitation-feed-meta">${_esc(time)} · ${_esc(via)}</div>
        </div>
        <div class="lm-recitation-feed-pts">+${entry.pts}</div>
        <button class="lm-undo-btn" onclick="window._lmUndoRecitation('${_esc(entry.id)}')">Undo</button>
      </div>
    `;
  }

  // Task 4 — Floating +N: diffs the current session feed against
  // _lmRecitationSeenIds and spawns a float on any brand-new entry's seat.
  // Called after every recitation-triggered repaint (own actions AND
  // realtime echoes from another device), so it fires exactly once per
  // entry no matter which tab/device logged it.
  export function _lmAnimateNewRecitationEntries() {
    const entries = RecitationService.getSessionEntries(_lmClassId, _lmSessionStartAt);
    entries.forEach(e => {
      if (_lmRecitationSeenIds.has(e.id)) return;
      _lmRecitationSeenIds.add(e.id);
      _lmSpawnFloatingPoint(e.studentId, e.pts);
    });
  }

  export function _lmSpawnFloatingPoint(studentId, pts) {
    const seatEl = document.querySelector(`.lm-seat[data-student-id="${studentId}"]`);
    if (!seatEl) return;

    const badgeEl = seatEl.querySelector('.lm-recitation-badge');
    if (badgeEl) {
      badgeEl.classList.remove('bump');
      // Force reflow so re-adding the class restarts the animation even if
      // two points land on the same student back-to-back.
      void badgeEl.offsetWidth;
      badgeEl.classList.add('bump');
    }

    const floatEl = document.createElement('div');
    floatEl.className = 'lm-float-point';
    floatEl.textContent = `+${pts}`;
    seatEl.appendChild(floatEl);
    setTimeout(() => floatEl.remove(), 1500);
  }

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._lmRender = _lmRender;
window._lmAnimateNewRecitationEntries = _lmAnimateNewRecitationEntries;
window._lmRenderCanvas = _lmRenderCanvas;
window._lmRenderSidebar = _lmRenderSidebar;
window._lmRenderRecitationSidebar = _lmRenderRecitationSidebar;
