// src/modules/seat-arrangement/classroom-builder-render.js — real-ESM twin of
// ../../../modules/seat-arrangement/classroom-builder-render.js.
// Phase 7 (Stream D), file 20/30. Original stays untouched.
//
// All 7 top-level declared symbols exported, matching declaresCount 7 exactly
// (dist/dependency-map.json): _cbRenderShell, _cbScaleCanvas, _cbRenderCanvas,
// _cbRepaintSeats, _cbRenderSidebar, _cbStudentChip, _cbRenderWizard — keyword
// swap only (`export function`). The original's own 6-line trailing "Phase 7
// explicit window exports" block is kept VERBATIM (_cbStudentChip was always a
// plain global declaration; the bridge attaches it too). No outer IIFE, no state
// of its own.
//
// LIVE-BINDING IMPORTS FROM THE BUILDER (the point of this file). The original
// reads the builder's state — _cbMode, _cbClassId, _cbLayoutId, _cbLocalSeats,
// _cbLocalProps, _cbSelectedSeatIds, _cbMounted, _cbDragStudentId,
// _cbAutoStrategy, _cbWizard* — as bare identifiers through the classic scripts'
// shared lexical scope. A `window` fallback would only ever see the builder's
// load-time snapshots (it reassigns most of these), so this twin instead imports
// the builder's `export let` bindings, which ES modules keep LIVE. The same goes
// for the constants (CB_CANVAS_W/H, CB_PROP_TYPES, CB_SHAPE_TYPES,
// CB_WALKWAY_PRESETS) and the builder functions it calls (_cbCanvasScale and the
// drag handlers). This deliberately departs from the guide's "use window
// fallback within the cycles" advice — and it creates NO ES cycle: the builder
// twin reaches the six render functions through bare window names (bridge-
// attached), so the module graph is just render -> builder. Wrapper audit: none
// of the imported builder names, nor any of this file's 7, is wrapped or
// reassigned by any other file.
//
// Other real imports: AppStore (../core/state-manager.js), ClassroomService
// (./classroom-service.js), toast (../../dom.js), _esc/_cssColor (../../utils.js).
// `window.getClassLabel` is already window-qualified in the original and stays so.
//
// ONE DELIBERATE IN-BODY EDIT — the sidebar chips' dragstart/dragend handlers.
// The original assigns the builder's _cbDragStudentId there (its header notes
// this is legal only because the lets are shared script scope). An importing
// module cannot assign an imported binding, so each handler now delegates to the
// builder's own exported _cbSeatOccupantDragStart / _cbSeatOccupantDragEnd, whose
// bodies are statement-for-statement what the chip handlers did (set/clear
// _cbDragStudentId, add/remove the 'dragging' class on e.currentTarget — which IS
// the chip in an addEventListener callback — set effectAllowed='move' and
// dataTransfer 'text/plain' to the student id). The check dispatches real
// dragstart/dragend events on the chips and compares the class, dataTransfer
// calls and the builder's live _cbDragStudentId against the original.
//
// Load order note: index.html loads this file BEFORE classroom_builder.js; as
// modules the order is irrelevant (everything is used at call time).

// ─────────────────────────────────────────────────────────────────────────────
// CLASSROOM BUILDER — render layer (DOM painting only)
//
// Phase 6 (Decompose God Files) extraction from classroom_builder.js. Owns
// every "given current module state, paint the DOM" function: the toolbar
// shell, canvas (seats + props), the fast-path repaint used by the AppStore
// subscription, the sidebar (build palette / assign-mode roster), the
// student-chip template, and the blueprint wizard modal. No behavior
// change — every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT (checked before moving anything, not
// assumed): every function here was read function-by-function to confirm it
// only READS the module state declared in classroom_builder.js (_cbMode,
// _cbLocalSeats, _cbLocalProps, _cbClassId, _cbLayoutId, _cbSelectedSeatIds,
// _cbWizardOpen/_cbWizardShape/_cbWizardRows/_cbWizardCols/_cbWizardSpacing/
// _cbWizardPreset) and never assigns to it directly. The one place a render
// function's OWN dragstart/dragend listener writes to module state
// (_cbRenderSidebar's chip drag handlers set _cbDragStudentId) is fine
// exactly because these `let` bindings are shared script-scope, not
// per-file — a variable declared in one <script> tag is the same binding
// every other <script> tag on the page reads and writes, and top-level
// function declarations (all of these) attach to `window` immediately on
// load regardless of order, so which file loads first doesn't matter for
// correctness here — only that both are present before the page is used.
//
// Exports: _cbRenderShell(), _cbScaleCanvas(), _cbRenderCanvas(),
//   _cbRepaintSeats(), _cbRenderSidebar(), _cbStudentChip(),
//   _cbRenderWizard()
//
// DEPENDENCIES: the module state and geometry helpers declared in
// classroom_builder.js (_cbCanvasScale(), CB_CANVAS_W/H, CB_SEAT_SIZE,
// CB_PROP_TYPES, CB_SHAPE_TYPES), AppStore, ClassroomService, _esc(),
// _cssColor(), toast() — all globals already available wherever this file
// loads, same as when this code lived inside classroom_builder.js.
// ─────────────────────────────────────────────────────────────────────────────

import { AppStore } from '../core/state-manager.js';
import { toast } from '../../dom.js';
import { _esc, _cssColor } from '../../utils.js';
import { ClassroomService } from './classroom-service.js';
import {
  _cbClassId, _cbLayoutId, _cbMode, _cbLocalSeats, _cbLocalProps, _cbSelectedSeatIds,
  _cbMounted, _cbDragStudentId, _cbAutoStrategy,
  _cbWizardOpen, _cbWizardShape, _cbWizardRows, _cbWizardCols, _cbWizardSpacing, _cbWizardPreset,
  CB_CANVAS_W, CB_CANVAS_H, CB_PROP_TYPES, CB_SHAPE_TYPES, CB_WALKWAY_PRESETS,
  _cbCanvasScale, _cbPropDragStart, _cbPropDragEnd, _cbSeatDragStart, _cbSeatDragEnd,
  _cbSeatAssignDragOver, _cbSeatAssignDragLeave, _cbSeatAssignDrop,
  _cbSeatOccupantDragStart, _cbSeatOccupantDragEnd, _cbUnassign,
} from './classroom_builder.js';

export function _cbRenderShell(page, classIds, state) {
  const layouts = (state.classroomLayouts || []).filter(l => l.classId === _cbClassId);

  page.innerHTML = `
  <!-- TOOLBAR -->
  <div class="cb-toolbar">
    <select class="cb-class-select" onchange="window._cbOnClassChange(this.value)">${
      classIds.map(c => `<option value="${_esc(c)}"${c===_cbClassId?' selected':''}>${_esc(window.getClassLabel ? window.getClassLabel(c, state) : c)}</option>`).join('')
    }</select>

    <div class="cb-toolbar-sep"></div>

    <select class="cb-layout-select" id="cb-layout-select" onchange="window._cbOnLayoutChange(this.value)">${
      layouts.length
        ? layouts.map(l => `<option value="${_esc(l.id)}"${l.id===_cbLayoutId?' selected':''}>${_esc(l.name)}</option>`).join('')
        : `<option value="">— No layouts yet —</option>`
    }</select>
    <button class="btn btn-ghost btn-sm" onclick="window._cbNewLayout()">＋ New</button>
    <button class="btn btn-ghost btn-sm" onclick="window._cbOpenBlueprintWizard()" title="Generate a structural room layout">📐 Blueprint</button>
    ${_cbLayoutId ? `<button class="btn btn-ghost btn-sm" onclick="window._cbRenameLayout()">✏️ Rename</button>` : ''}
    ${_cbLayoutId ? `<button class="btn btn-danger btn-sm" onclick="window._cbDeleteLayout()">🗑</button>` : ''}

    <div class="cb-toolbar-sep"></div>

    <button class="cb-mode-btn ${_cbMode==='build'?'active':''}" onclick="window._cbSetMode('build')">
      🧱 Build Mode
    </button>
    <button class="cb-mode-btn ${_cbMode==='assign'?'active':''}" onclick="window._cbSetMode('assign')" ${!_cbLayoutId?'disabled':''}>
      🪑 Assign Mode
    </button>

    <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
      ${_cbMode==='build' ? `
        <span style="font-size:11px;color:var(--text-muted);font-weight:700">
          ${_cbLocalSeats.length} seat${_cbLocalSeats.length!==1?'s':''}
        </span>
        <button class="btn btn-primary btn-sm" onclick="window._cbSave()" ${!_cbLayoutId&&_cbLocalSeats.length===0?'disabled':''}>
          💾 Save Layout
        </button>
      ` : `
        <span style="font-size:11px;color:var(--text-muted);font-weight:700">
          Drag students → seats
        </span>
      `}
    </div>
  </div>

  ${_cbMode==='build' && _cbLocalSeats.length > 0 ? `
  <!-- MASS SEAT ACTIONS (build mode only) -->
  <div class="cb-toolbar" style="padding-top:4px;padding-bottom:4px">
    <button class="btn btn-ghost btn-sm" onclick="window._cbSelectAllSeats()" title="Select every seat on the canvas">☑️ Select All</button>
    <button class="btn btn-ghost btn-sm" onclick="window._cbClearSeatSelection()" ${_cbSelectedSeatIds.size===0?'disabled':''}>✖️ Clear Selection</button>
    <div class="cb-toolbar-sep"></div>
    <button class="btn btn-primary btn-sm" onclick="window._cbDuplicateSelectedSeats()" ${_cbSelectedSeatIds.size===0?'disabled':''}
      title="Clone the selected seats, offset by 30px so they don't stack on the originals">
      📑 Duplicate Selected
    </button>
    ${_cbSelectedSeatIds.size > 0 ? `
      <div class="cb-selection-bar">
        <span class="count">${_cbSelectedSeatIds.size}</span> selected
      </div>
    ` : `
      <span style="font-size:11px;color:var(--text-muted)">Shift-click seats to select multiple</span>
    `}
  </div>
  ` : ''}

  <!-- WORKSPACE -->
  <div class="cb-workspace">
    <!-- CANVAS WRAP -->
    <div class="cb-canvas-wrap" id="cb-canvas-wrap"
      ondragover="window._cbOnCanvasDragOver(event)"
      ondrop="window._cbOnCanvasDrop(event)"
      ondragleave="window._cbOnCanvasDragLeave(event)">
      <div class="cb-canvas" id="cb-canvas"></div>
      <div class="cb-empty" id="cb-empty" style="display:${(_cbLocalSeats.length||_cbLocalProps.length)?'none':'flex'}">
        <div class="cb-empty-icon">🪑</div>
        <div class="cb-empty-text">${_cbMode==='build'?'Add seats from the panel →':'No layout to display'}</div>
      </div>
    </div>

    <!-- SIDEBAR -->
    <div class="cb-sidebar" id="cb-sidebar"></div>
  </div>

  <!-- LEGEND -->
  <div class="cb-legend">
    ${Object.entries(ClassroomService.STATUS_COLORS).map(([k,v])=>`
      <div class="cb-legend-item">
        <div class="cb-legend-dot" style="background:${v.border};opacity:.8"></div>
        ${k==='_no_log'?'No scan yet':k==='_empty'?'Empty seat':k}
      </div>
    `).join('')}
  </div>

  <!-- MODAL MOUNT (blueprint wizard, etc.) -->
  <div id="cb-modal-root"></div>
  `;

  _cbScaleCanvas();
  _cbRenderCanvas();
  _cbRenderSidebar();
  _cbRenderWizard();
  window.addEventListener('resize', _cbScaleCanvas);
}

// ── Canvas scale ──────────────────────────────────────────────────────────────

export function _cbScaleCanvas() {
  const canvas = document.getElementById('cb-canvas');
  const wrap   = document.getElementById('cb-canvas-wrap');
  if (!canvas || !wrap) return;
  const scale = _cbCanvasScale();
  // ROOT CAUSE OF "blank / doesn't reflect the saved layout": nav.js calls
  // renderClassroomBuilder() BEFORE showPage() adds the .active class that
  // makes #a-classroom visible (.page{display:none} until .active). At that
  // instant #cb-canvas-wrap is display:none, so clientWidth/clientHeight
  // read 0, _cbCanvasScale() returns 0, and we'd otherwise commit
  // transform:scale(0) — the seats ARE there, correctly positioned, just
  // shrunk to nothing, and it silently stays that way until the user
  // happens to resize the window. Self-heal instead of committing a broken
  // scale: if the container isn't laid out yet, retry next frame (by which
  // point showPage() has already run synchronously, so it resolves in one
  // extra frame, not a visible flicker).
  if (!isFinite(scale) || scale <= 0) {
    requestAnimationFrame(_cbScaleCanvas);
    return;
  }
  canvas.style.width    = CB_CANVAS_W + 'px';
  canvas.style.height   = CB_CANVAS_H + 'px';
  canvas.style.transform = `scale(${scale})`;
}

// ── Canvas render (seats + props) ─────────────────────────────────────────────

export function _cbRenderCanvas() {
  const canvas = document.getElementById('cb-canvas');
  if (!canvas) return;

  const seatingMap = _cbLayoutId
    ? ClassroomService.getLiveSeatingMap(_cbClassId, _cbLayoutId)
    : [];
  const mapBySeatId = Object.fromEntries(seatingMap.map(s => [s.seatId, s]));

  // Clear previous seats/props (keep the canvas div).
  canvas.querySelectorAll('.cb-seat,.cb-prop').forEach(el => el.remove());

  // Render props.
  _cbLocalProps.forEach((prop, idx) => {
    const el = document.createElement('div');
    el.className = 'cb-prop';
    el.dataset.propIdx = idx;
    el.style.left     = prop.x + 'px';
    el.style.top      = prop.y + 'px';
    el.style.transform = `rotate(${prop.rotation||0}deg)`;
    el.draggable = (_cbMode === 'build');
    el.innerHTML = `
      <span>${CB_PROP_TYPES.find(t=>t.type===prop.type)?.emoji || '📦'}</span>
      <span class="cb-prop-label">${CB_PROP_TYPES.find(t=>t.type===prop.type)?.label||prop.type}</span>
      ${_cbMode==='build'?`<button class="cb-prop-del" onclick="window._cbDeleteProp(${idx})" title="Remove">✕</button>`:''}
    `;
    if (_cbMode === 'build') {
      el.addEventListener('dragstart', e => _cbPropDragStart(e, idx));
      el.addEventListener('dragend',   _cbPropDragEnd);
    }
    canvas.appendChild(el);
  });

  // Render seats.
  _cbLocalSeats.forEach(seat => {
    const vm  = mapBySeatId[seat.id] || {};
    const col = vm.color || ClassroomService.STATUS_COLORS['_empty'];

    const el = document.createElement('div');
    el.className  = 'cb-seat' + (seat.isLocked ? ' locked' : '') + (_cbSelectedSeatIds.has(seat.id) ? ' selected' : '');
    el.dataset.seatId = seat.id;
    el.dataset.attendanceStatus = vm.attendanceStatus || 'Unscanned';
    el.style.left     = seat.xCoord + 'px';
    el.style.top      = seat.yCoord + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${seat.rotation||0}deg)`;
    el.style.background = col.bg;
    el.style.borderColor = seat.isLocked ? '#ffb95f' : col.border;

    const studentColor = vm.studentColor || 'rgba(139,92,246,0.5)';
    const initText     = vm.studentInit  || (vm.studentId ? '?' : '');
    const statusText   = vm.attendanceStatus || (vm.studentId ? '—' : '');

    el.innerHTML = `
      ${seat.label ? `<div class="cb-seat-label">${_esc(seat.label)}</div>` : ''}
      ${vm.studentId
        ? `<div class="cb-seat-init" style="width:57px;height:57px;border-radius:9px;background:${studentColor};display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:900">${vm.studentPhoto ? `<img src="${_esc(vm.studentPhoto)}" alt="" onerror="this.remove()">` : ''}${_esc(initText)}</div>
           <div class="cb-seat-name">${_esc(vm.studentName||'')}</div>
           <div class="cb-seat-status" style="color:${col.border}">${statusText}</div>`
        : `<div style="font-size:30px;opacity:.3">🪑</div>`
      }
      ${_cbMode==='build'
        ? `<button class="cb-seat-del" onclick="window._cbDeleteSeat('${seat.id}')" title="Remove seat">✕</button>
           <button class="cb-rotate-btn" onclick="window._cbRotateSeat('${seat.id}')" title="Rotate">↻</button>`
        : ''
      }
      ${_cbMode==='assign'
        ? `<button class="cb-lock-btn" onclick="window._cbToggleSeatLock(event,'${seat.id}')"
             title="${seat.isLocked ? 'Unlock — let auto-allocate/blueprint touch this seat again' : 'Lock — protect this seat from auto-allocate and blueprint regeneration'}">
             ${seat.isLocked ? '🔒' : '🔓'}
           </button>`
        : ''
      }
    `;

    // Draggable in BUILD mode (repositioning seats on the canvas).
    if (_cbMode === 'build') {
      el.draggable = true;
      el.addEventListener('dragstart', e => _cbSeatDragStart(e, seat.id));
      el.addEventListener('dragend',   _cbSeatDragEnd);
      // Mass Seat Actions: Shift-click toggles this seat's membership in
      // the selection set without starting a drag. A plain click (no
      // Shift) is intentionally a no-op here, so accidental clicks while
      // repositioning seats don't also mutate the selection.
      el.addEventListener('click', (e) => {
        if (!e.shiftKey) return;
        e.stopPropagation();
        window._cbToggleSeatSelection(seat.id);
      });
    }

    // ASSIGN mode: every seat is BOTH a drop target (sidebar→seat,
    // seat→seat swap) AND, if occupied, a drag SOURCE (seat→sidebar evict,
    // seat→another seat swap). Locking does not block dragging the seat
    // itself here — that's a deliberate manual override, see
    // manual_move_student()'s doc comment in classroom-service.js.
    if (_cbMode === 'assign') {
      el.addEventListener('dragover',  e => _cbSeatAssignDragOver(e));
      el.addEventListener('dragleave', _cbSeatAssignDragLeave);
      el.addEventListener('drop',      e => _cbSeatAssignDrop(e, seat.id));

      if (vm.studentId) {
        el.draggable = true;
        el.title = (seat.isLocked ? '🔒 Locked — ' : '') + 'Drag to move/swap, or drop on the sidebar to unseat ' + (vm.studentName || '');
        el.addEventListener('dragstart', e => _cbSeatOccupantDragStart(e, seat.id, vm.studentId));
        el.addEventListener('dragend',   _cbSeatOccupantDragEnd);
        // Click is kept as a quick one-tap unassign for non-drag users.
        el.addEventListener('click', (e) => {
          if (e.target.closest('.cb-lock-btn')) return;
          _cbUnassign(seat.id);
        });
      }
    }

    canvas.appendChild(el);
  });

  // Show/hide empty state.
  const empty = document.getElementById('cb-empty');
  if (empty) {
    empty.style.display = (_cbLocalSeats.length || _cbLocalProps.length) ? 'none' : 'flex';
  }
}

// ── Repaint only (no full re-render — called by AppStore subscription) ─────────

export function _cbRepaintSeats() {
  if (!_cbLayoutId || !_cbMounted) return;
  const seatingMap  = ClassroomService.getLiveSeatingMap(_cbClassId, _cbLayoutId);
  const mapBySeatId = Object.fromEntries(seatingMap.map(s => [s.seatId, s]));

  document.querySelectorAll('.cb-seat').forEach(el => {
    const seatId = el.dataset.seatId;
    const vm     = mapBySeatId[seatId];
    if (!vm) return;
    const col = vm.color || ClassroomService.STATUS_COLORS['_empty'];
    el.dataset.attendanceStatus = vm.attendanceStatus || 'Unscanned';
    el.style.background   = col.bg;
    el.style.borderColor  = vm.isLocked ? '#ffb95f' : col.border;

    // Update attendance status text only (don't rebuild innerHTML).
    const statusEl = el.querySelector('.cb-seat-status');
    if (statusEl) {
      statusEl.textContent  = vm.attendanceStatus || (vm.studentId ? '—' : '');
      statusEl.style.color  = col.border;
    }
  });

  // Also repaint the assign-mode sidebar chip statuses.
  if (_cbMode === 'assign') _cbRenderSidebar();
}

// ── Sidebar renderer ──────────────────────────────────────────────────────────

export function _cbRenderSidebar() {
  const sidebar = document.getElementById('cb-sidebar');
  if (!sidebar) return;

  if (_cbMode === 'build') {
    sidebar.innerHTML = `
      <div class="cb-sidebar-header">🛠 Room Elements</div>
      <div class="cb-palette">
        <div class="cb-palette-title">Seats</div>
        <button class="cb-add-seat-btn" onclick="window._cbAddSeat()">＋ Add Seat</button>
        <div class="cb-palette-title" style="margin-top:12px">Props</div>
        ${CB_PROP_TYPES.map(pt => `
          <div class="cb-palette-item" onclick="window._cbAddProp('${pt.type}')">
            <span style="font-size:20px">${pt.emoji}</span>${pt.label}
          </div>
        `).join('')}
        <div class="cb-palette-title" style="margin-top:16px">Tips</div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.6;padding:4px 0">
          • Drag seats anywhere on the canvas<br>
          • Click ↻ to rotate a seat 90°<br>
          • Click ✕ to remove a seat<br>
          • Hit <b style="color:var(--primary)">Save Layout</b> when done
        </div>
      </div>
    `;
    return;
  }

  // ASSIGN mode — Unassigned Students pool + auto-allocate controls.
  const state       = AppStore.getState();
  const students    = (state.students || []).filter(s => (s.classId||'default-class') === _cbClassId);
  const assigns     = (state.seatAssignments || []).filter(a => a.layoutId === _cbLayoutId);
  const assignedSet = new Set(assigns.map(a => a.studentId));
  const logs        = (state.attendanceLogs || []).filter(
    l => l.classId === _cbClassId && l.logDate === new Date().toISOString().slice(0,10)
  );
  const logByStudent = Object.fromEntries(logs.map(l => [l.studentId, l]));

  const unassigned = students.filter(s => !assignedSet.has(s.id));
  const assigned   = students.filter(s =>  assignedSet.has(s.id));

  sidebar.innerHTML = `
    <div class="cb-sidebar-header">👥 Students
      <span style="font-size:10px;color:var(--text-muted);font-weight:600;margin-left:6px">
        ${unassigned.length} unseated
      </span>
    </div>
    <div class="cb-sidebar-list">
      <div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
        color:var(--text-muted);margin-bottom:8px;padding:0 2px">Unassigned Pool</div>
      <div class="cb-pool-zone" id="cb-pool-zone">
        ${unassigned.length
          ? unassigned.map(s => _cbStudentChip(s, false, logByStudent[s.id])).join('')
          : `<div style="font-size:12px;color:var(--text-muted);padding:8px 2px">All students are seated ✅<br>Drag a seated student here to unseat them.</div>`
        }
      </div>
      ${assigned.length ? `
        <div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
          color:var(--text-muted);margin:14px 0 8px;padding:0 2px">Assigned</div>
        ${assigned.map(s => _cbStudentChip(s, true, logByStudent[s.id])).join('')}
      ` : ''}
    </div>
    <div class="cb-auto-bar">
      <select id="cb-auto-strategy" onchange="window._cbSetAutoStrategy(this.value)">
        <option value="alphabetical" ${_cbAutoStrategy==='alphabetical'?'selected':''}>Alphabetical</option>
        <option value="random" ${_cbAutoStrategy==='random'?'selected':''}>Random</option>
      </select>
      <button id="cb-auto-btn" class="btn btn-primary btn-sm" onclick="window._cbRunAutoAllocate()"
        ${!unassigned.length ? 'disabled' : ''} title="Fills empty, unlocked seats only — never touches locked seats or already-seated students">
        ⚡ Auto-Fill
      </button>
    </div>
  `;

  // Wire up drag events on unassigned chips (sidebar → seat).
  sidebar.querySelectorAll('.cb-student-chip[draggable="true"]').forEach(chip => {
    chip.addEventListener('dragstart', e => {
      // TWIN EDIT (see header): an importer can't assign the builder's _cbDragStudentId, so delegate to the
      // builder's exported handler, which performs exactly the four original statements.
      _cbSeatOccupantDragStart(e, null, chip.dataset.studentId);
    });
    chip.addEventListener('dragend', e => {
      // TWIN EDIT (see header): same, for the two original dragend statements.
      _cbSeatOccupantDragEnd(e);
    });
  });

  // Wire up the pool zone itself as a drop target — dragging an occupied
  // seat here is the "drag assigned student back to sidebar to vacate"
  // workflow from the spec.
  const poolZone = document.getElementById('cb-pool-zone');
  if (poolZone) {
    poolZone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      poolZone.classList.add('drag-over');
    });
    poolZone.addEventListener('dragleave', () => poolZone.classList.remove('drag-over'));
    poolZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      poolZone.classList.remove('drag-over');
      if (!_cbDragStudentId || !_cbLayoutId) return;
      const result = await ClassroomService.manualMoveStudent(_cbDragStudentId, null, _cbLayoutId);
      if (!result.ok) { toast('❌ ' + result.error, '#ffb4ab'); return; }
      toast('✅ Returned to unassigned pool', '#d0bcff');
    });
  }
}

export function _cbStudentChip(student, isAssigned, log) {
  const statusText = log ? log.status : (isAssigned ? '—' : 'Not yet scanned');
  const chipColor  = isAssigned ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.04)';
  return `
    <div class="cb-student-chip ${isAssigned?'assigned':''}"
      draggable="${isAssigned?'false':'true'}"
      data-student-id="${_esc(student.id)}"
      title="${isAssigned?'Already seated — drag them off their seat on the canvas to unseat':'Drag to a seat'}">
      <div class="cb-chip-avatar" style="background:${_cssColor(student.color)}">${_esc(student.init||'?')}</div>
      <div class="cb-chip-info">
        <div class="cb-chip-name">${_esc(student.name||student.displayName||student.id)}</div>
        <div class="cb-chip-status">${statusText}</div>
      </div>
    </div>
  `;
}

// ── Blueprint wizard modal (render only — see classroom_builder.js for the
// window._cbOpenBlueprintWizard / _cbSetWizardShape / _cbSubmitBlueprintWizard
// controllers that call this) ───────────────────────────────────────────────

export function _cbRenderWizard() {
  const root = document.getElementById('cb-modal-root');
  if (!root) return;
  if (!_cbWizardOpen) { root.innerHTML = ''; return; }

  const lockedCount = _cbLocalSeats.filter(s => s.isLocked).length;
  const activeShapeMeta = CB_SHAPE_TYPES.find(s => s.shape === _cbWizardShape);

  root.innerHTML = `
    <div class="cb-modal-backdrop" onclick="if(event.target===this) window._cbCloseBlueprintWizard()">
      <div class="cb-modal">
        <div class="cb-modal-title">📐 Generate Room Blueprint</div>
        <div class="cb-modal-sub">Pick a room shape and dimensions — seats drop onto the canvas instantly.</div>

        <div class="cb-shape-grid">
          ${CB_SHAPE_TYPES.map(st => `
            <div class="cb-shape-btn ${st.shape===_cbWizardShape?'active':''}" onclick="window._cbSetWizardShape('${st.shape}')">
              <span class="ic">${st.emoji}</span>
              <span class="lb">${st.label}</span>
            </div>
          `).join('')}
        </div>

        <div class="cb-field-row">
          <div class="cb-field">
            <label>${_esc(activeShapeMeta.rowsLabel)}</label>
            <input type="number" id="cb-wiz-rows" class="cb-class-select" min="1" max="20" value="${_cbWizardRows}">
          </div>
          <div class="cb-field">
            <label>${_esc(activeShapeMeta.colsLabel)}</label>
            <input type="number" id="cb-wiz-cols" class="cb-class-select" min="1" max="20" value="${_cbWizardCols}">
          </div>
        </div>
        <div class="cb-field-row">
          <div class="cb-field">
            <label>Spacing (px)</label>
            <input type="number" id="cb-wiz-spacing" class="cb-class-select" min="40" max="200" step="10" value="${_cbWizardSpacing}">
          </div>
        </div>

        ${_cbWizardShape === 'grid' ? `
          <div class="cb-field-row">
            <div class="cb-field">
              <label>Room Layout Preset</label>
              <select id="cb-wiz-preset" class="cb-class-select" onchange="window._cbSetWizardPreset(this.value)">
                ${CB_WALKWAY_PRESETS.map(p => `
                  <option value="${p.preset}" ${p.preset===_cbWizardPreset?'selected':''}>${_esc(p.label)}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="cb-modal-hint" style="margin-top:-6px">
            ${_esc(CB_WALKWAY_PRESETS.find(p=>p.preset===_cbWizardPreset).hint)}
          </div>
        ` : ''}

        ${lockedCount > 0 ? `
          <div class="cb-modal-hint">
            🔒 ${lockedCount} locked seat${lockedCount!==1?'s':''} in this layout will be preserved exactly as-is —
            only the unlocked seats will be regenerated.
          </div>
        ` : `
          <div class="cb-modal-hint">This replaces all current (unlocked) seats on this layout with the new arrangement.</div>
        `}

        <div class="cb-modal-actions">
          <button class="btn btn-ghost btn-sm" onclick="window._cbCloseBlueprintWizard()">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="window._cbSubmitBlueprintWizard()">⚡ Generate</button>
        </div>
      </div>
    </div>
  `;
}

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._cbRenderCanvas = _cbRenderCanvas;
window._cbRenderShell = _cbRenderShell;
window._cbRepaintSeats = _cbRepaintSeats;
window._cbRenderSidebar = _cbRenderSidebar;
window._cbScaleCanvas = _cbScaleCanvas;
window._cbRenderWizard = _cbRenderWizard;
