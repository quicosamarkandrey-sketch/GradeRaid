// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/classroom/classroom_builder.js
//  Phase 2: Visual Drag-and-Drop Classroom Layout Builder.
//
//  WHAT THIS FILE OWNS:
//    window.renderClassroomBuilder()  — mounts the admin layout builder into
//                                       #a-classroom (admin view).
//    window.renderStudentSeating()    — mounts the read-only seat map into
//                                       #s-classroom (student view).
//    window.unmountClassroomBuilder() — teardown called by navTo() on page leave.
//
//  REPOSITORY PATTERN:
//    This file NEVER calls Supabase or mutates AppStore directly.
//    Every write goes through ClassroomService.<method>().
//    All reads come from AppStore.getState() or ClassroomService.getLiveSeatingMap().
//
//  DRAG-AND-DROP APPROACH:
//    Uses the HTML5 Drag-and-Drop API (no canvas library, no Fabric.js).
//    Seats and props are absolutely-positioned <div>s inside a relative
//    canvas container. The canvas is a fixed virtual 1200×800 space scaled
//    via CSS transform to fit the viewport — coordinates stored in DB are
//    always in this virtual space (scale-independent).
//
//  TWO MODES:
//    BUILD MODE  — teacher adds/moves/rotates/deletes seats and room props.
//                  Seat positions are updated in _localSeats[] optimistically;
//                  "Save Layout" flushes to Supabase via ClassroomService.
//    ASSIGN MODE — teacher drags students from a sidebar roster into seats.
//                  Each drop immediately calls ClassroomService.assignStudentToSeat()
//                  (no "Save" button needed — this is already written to DB).
//
//  REALTIME REACTIVITY:
//    Both modes subscribe to AppStore. When AttendanceService.processScan() (or
//    overrideAttendance()) fires AppStore.updateState(), the subscription here
//    calls _repaintSeats(), which re-runs ClassroomService.getLiveSeatingMap()
//    and updates only the CSS on existing seat elements (no full re-render).
//    This means a badge tap → visible seat color change in < 100ms.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Module-level state ────────────────────────────────────────────────────────
let _cbMounted       = false;
let _cbMode          = 'build';          // 'build' | 'assign'
let _cbClassId       = 'default-class';
let _cbLayoutId      = null;             // currently loaded layout UUID
let _cbLayoutName    = 'Default Layout';
let _cbLocalSeats    = [];               // working copy during build mode
let _cbLocalProps    = [];               // working copy of room props
let _cbDragSeatId    = null;             // seat being dragged in build mode
let _cbDragStudentId = null;             // student being dragged in assign mode
// Mass Seat Actions: build-mode multi-select (Shift-click toggles membership).
// A Set of seat ids; cleared on layout switch and on leaving build mode.
let _cbSelectedSeatIds = new Set();
let _cbDragOffsetX   = 0;
let _cbDragOffsetY   = 0;
let _cbSubscriberKey = 'classroom-builder';

// Virtual canvas dimensions (stored coordinates are in this space).
const CB_CANVAS_W = 1200;
const CB_CANVAS_H = 800;

// Seat box size — bumped 80→120px per the Seating/Cold Call enhancement
// report (§1). Seats are drawn centered on their xCoord/yCoord (see the
// translate(-50%,-50%) in _cbRenderCanvas), so CB_SEAT_MARGIN (half the
// seat size) is the minimum distance a seat center can sit from any canvas
// edge without the seat box clipping off it — used both for the drag clamp
// below and for the one-time overlap auto-fix (_cbResolveSeatOverlaps).
const CB_SEAT_SIZE   = 120;
const CB_SEAT_MARGIN = CB_SEAT_SIZE / 2;

// Prop type metadata for the toolbar palette.
const CB_PROP_TYPES = [
  { type: 'door',         emoji: '🚪', label: 'Door'         },
  { type: 'window',       emoji: '🪟', label: 'Window'       },
  { type: 'whiteboard',   emoji: '📋', label: 'Whiteboard'   },
  { type: 'teacher_desk', emoji: '🖥️',  label: 'Teacher Desk' },
];

// Blueprint wizard shape metadata.
const CB_SHAPE_TYPES = [
  { shape: 'grid',       emoji: '▦', label: 'Traditional Grid', rowsLabel: 'Rows', colsLabel: 'Columns' },
  { shape: 'u_shape',    emoji: '⊔', label: 'U-Shape',          rowsLabel: 'Per side', colsLabel: 'Across bottom' },
  { shape: 'group_pods', emoji: '⊞', label: 'Group Pods',       rowsLabel: 'Pods', colsLabel: 'Seats/pod' },
];

// Auto-allocate strategy state (persists across re-renders within a session).
let _cbAutoStrategy = 'alphabetical';

// Blueprint wizard modal state.
let _cbWizardOpen   = false;
let _cbWizardShape  = 'grid';
let _cbWizardRows   = 4;
let _cbWizardCols   = 6;
let _cbWizardSpacing = 130; // was 90 (sized for 80px seats + a 10px gap) — bumped for the 120px seat size so default-generated grids don't overlap
let _cbWizardPreset = 'traditional';   // grid-only: walkway split

// Room layout presets (walkway splits) — grid shape only.
const CB_WALKWAY_PRESETS = [
  { preset: 'traditional',  label: 'Traditional Block',     hint: 'One solid block, no walkway.' },
  { preset: 'center_aisle', label: 'Center Aisle Split',    hint: 'Two blocks with one walkway down the middle.' },
  { preset: 'double_aisle', label: 'Double Aisle Split',    hint: 'Three blocks with two walkways for easy pass-through.' },
];

// ── CSS injection (idempotent) ────────────────────────────────────────────────
;(function injectClassroomCSS() {
  if (document.getElementById('classroom-builder-css')) return;
  const s = document.createElement('style');
  s.id = 'classroom-builder-css';
  s.textContent = `
/* ── Classroom page layout ── */
#a-classroom,#s-classroom{padding:0!important;max-width:100%!important;overflow:hidden}

/* ── Toolbar ── */
.cb-toolbar{
  display:flex;align-items:center;gap:10px;padding:14px 20px;
  background:rgba(19,18,30,0.95);border-bottom:1px solid var(--border);
  flex-wrap:wrap;position:sticky;
  z-index:50;backdrop-filter:blur(16px);
}
.cb-toolbar-sep{width:1px;height:28px;background:var(--border);flex-shrink:0}
.cb-mode-btn{
  display:flex;align-items:center;gap:6px;padding:8px 16px;
  border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;
  border:1px solid var(--border2);background:rgba(255,255,255,.05);
  color:var(--text-muted);transition:all .18s;font-family:var(--fb);
}
.cb-mode-btn.active{
  background:rgba(208,188,255,.18);border-color:rgba(208,188,255,.4);
  color:var(--primary);box-shadow:0 0 12px rgba(139,92,246,.25);
}
.cb-mode-btn:hover:not(.active){background:rgba(255,255,255,.08);color:var(--on-surface)}
.cb-class-select{min-width:140px}
.cb-layout-select{min-width:160px}

/* ── Main area: canvas + sidebar ── */
.cb-workspace{
  display:flex;height:calc(100vh - 64px - 57px);overflow:hidden;
}

/* ── Canvas wrapper (scales the virtual 1200×800 space) ── */
.cb-canvas-wrap{
  flex:1;overflow:hidden;position:relative;
  background:
    radial-gradient(circle at 50% 50%,rgba(139,92,246,0.04) 0%,transparent 70%),
    repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.03) 39px,rgba(255,255,255,0.03) 40px),
    repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.03) 39px,rgba(255,255,255,0.03) 40px);
  background-color:var(--bg-low);
  cursor:default;
}
.cb-canvas{
  position:absolute;
  transform-origin:top left;
  /* width/height set via JS based on viewport */
}

/* ── Seats ── */
.cb-seat{
  position:absolute;width:${CB_SEAT_SIZE}px;height:${CB_SEAT_SIZE}px;border-radius:14px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  border:2px solid rgba(255,255,255,.12);
  background:rgba(42,40,54,0.6);
  cursor:grab;user-select:none;
  transition:border-color .2s,background .2s,box-shadow .2s;
  font-family:var(--fh);will-change:transform;
}
.cb-seat:active{cursor:grabbing}
.cb-seat.drag-over{
  border-color:var(--primary)!important;
  box-shadow:0 0 0 2px rgba(139,92,246,.5),0 0 20px rgba(139,92,246,.3)!important;
}
.cb-seat.selected{
  border-color:var(--primary)!important;
  box-shadow:0 0 0 2px rgba(139,92,246,.35);
}
.cb-seat-init{font-size:25px;font-weight:900;line-height:1;position:relative;overflow:hidden}
.cb-seat-init img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}
.cb-seat-name{font-size:13px;font-weight:700;color:rgba(255,255,255,.55);
  text-align:center;max-width:105px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;margin-top:2px}
.cb-seat-status{font-size:14px;font-weight:800;letter-spacing:.04em;margin-top:1px}
.cb-seat-label{
  position:absolute;top:-10px;left:50%;transform:translateX(-50%);
  font-size:8px;font-weight:800;letter-spacing:.05em;
  background:rgba(19,18,30,.9);border:1px solid var(--border2);
  border-radius:4px;padding:1px 5px;color:var(--text-muted);
  white-space:nowrap;pointer-events:none;
}
.cb-seat-del{
  position:absolute;top:-8px;right:-8px;width:18px;height:18px;
  background:#ffb4ab;border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:10px;
  color:#1a0808;font-weight:900;z-index:10;
}
.cb-seat:hover .cb-seat-del{display:flex}

/* ── Room props (doors, windows, etc.) ── */
.cb-prop{
  position:absolute;width:56px;height:56px;border-radius:8px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  border:1px dashed rgba(255,255,255,.18);background:rgba(255,255,255,.04);
  cursor:grab;user-select:none;font-size:24px;
  transition:border-color .2s;
}
.cb-prop:hover{border-color:rgba(208,188,255,.3)}
.cb-prop-label{font-size:8px;color:var(--text-muted);font-weight:700;margin-top:2px}
.cb-prop-del{
  position:absolute;top:-8px;right:-8px;width:18px;height:18px;
  background:rgba(255,180,171,.8);border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:10px;
  color:#1a0808;font-weight:900;z-index:10;
}
.cb-prop:hover .cb-prop-del{display:flex}

/* ── Sidebar (student roster in assign mode) ── */
.cb-sidebar{
  width:220px;flex-shrink:0;
  border-left:1px solid var(--border);
  background:rgba(35,31,56,0.85);
  display:flex;flex-direction:column;
  overflow:hidden;
}
.cb-sidebar-header{
  padding:14px 16px 10px;font-family:var(--fh);font-size:13px;font-weight:800;
  color:var(--on-surface);border-bottom:1px solid var(--border);flex-shrink:0;
}
.cb-sidebar-list{flex:1;overflow-y:auto;padding:8px}
.cb-student-chip{
  display:flex;align-items:center;gap:8px;padding:8px 10px;
  border-radius:10px;border:1px solid var(--border);
  background:rgba(255,255,255,.04);cursor:grab;
  margin-bottom:6px;transition:all .15s;
}
.cb-student-chip:hover{background:rgba(255,255,255,.08);border-color:rgba(208,188,255,.25)}
.cb-student-chip.assigned{opacity:.4;cursor:not-allowed}
.cb-student-chip.dragging{opacity:.3}
.cb-chip-avatar{
  width:32px;height:32px;border-radius:8px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:900;color:#fff;
}
.cb-chip-info{min-width:0}
.cb-chip-name{font-size:12px;font-weight:700;color:var(--on-surface);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-chip-status{font-size:10px;color:var(--text-muted);margin-top:1px}

/* ── Prop palette (build mode sidebar) ── */
.cb-palette{padding:12px}
.cb-palette-title{font-size:10px;font-weight:800;letter-spacing:.08em;
  text-transform:uppercase;color:var(--text-muted);margin-bottom:10px}
.cb-palette-item{
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  border-radius:10px;border:1px solid var(--border);
  background:rgba(255,255,255,.04);cursor:pointer;margin-bottom:6px;
  font-size:13px;font-weight:700;color:var(--on-surface);transition:all .15s;
}
.cb-palette-item:hover{background:rgba(255,255,255,.08);border-color:rgba(208,188,255,.25)}
.cb-add-seat-btn{
  width:100%;padding:10px;border-radius:10px;border:1px dashed rgba(208,188,255,.3);
  background:rgba(208,188,255,.06);color:var(--primary);font-family:var(--fb);
  font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;margin-bottom:10px;
}
.cb-add-seat-btn:hover{background:rgba(208,188,255,.12);border-color:rgba(208,188,255,.5)}

/* ── Legend ── */
.cb-legend{
  display:flex;gap:10px;flex-wrap:wrap;padding:8px 16px;
  border-top:1px solid var(--border);background:rgba(19,18,30,.8);flex-shrink:0;
}
.cb-legend-item{display:flex;align-items:center;gap:5px;font-size:10px;
  font-weight:700;color:var(--text-muted)}
.cb-legend-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}

/* ── Rotation handle ── */
.cb-rotate-btn{
  position:absolute;bottom:-8px;right:-8px;width:20px;height:20px;
  background:rgba(208,188,255,.8);border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:11px;z-index:10;
  color:#1a0038;font-weight:900;
}
.cb-seat:hover .cb-rotate-btn{display:flex}

/* ── Drop indicator ── */
.cb-canvas.drop-active .cb-canvas-wrap{cursor:copy}

/* ── Empty state ── */
.cb-empty{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;pointer-events:none;
  color:rgba(255,255,255,.15);
}
.cb-empty-icon{font-size:64px;margin-bottom:16px}
.cb-empty-text{font-size:14px;font-weight:700;letter-spacing:.04em}
/* ── Multi-select (Mass Seat Actions) ── */
.cb-seat.selected{
  outline:3px solid var(--primary)!important;
  outline-offset:2px;
  box-shadow:0 0 0 1px rgba(208,188,255,.5),0 0 16px rgba(208,188,255,.3)!important;
  z-index:5;
}
.cb-selection-bar{
  display:flex;align-items:center;gap:8px;padding:6px 10px;
  background:rgba(208,188,255,.08);border:1px solid rgba(208,188,255,.25);
  border-radius:10px;font-size:12px;font-weight:700;color:var(--primary);
}
.cb-selection-bar .count{font-weight:900}

/* ── Seat locking ── */
.cb-seat.locked{
  border-color:#ffb95f!important;
  box-shadow:0 0 0 1px rgba(255,185,95,.4)!important;
}
.cb-lock-btn{
  position:absolute;bottom:-8px;left:-8px;width:18px;height:18px;
  background:rgba(255,185,95,.85);border-radius:50%;border:none;cursor:pointer;
  display:none;align-items:center;justify-content:center;font-size:9px;z-index:10;
  color:#2a1a00;font-weight:900;
}
.cb-seat:hover .cb-lock-btn,.cb-seat.locked .cb-lock-btn{display:flex}
.cb-seat.locked .cb-lock-btn{background:#ffb95f}

/* ── Unassigned pool sidebar (assign mode) ── */
.cb-pool-zone{
  border:1px dashed rgba(255,255,255,.12);border-radius:10px;
  padding:4px;min-height:40px;transition:all .15s;
}
.cb-pool-zone.drag-over{
  border-color:var(--primary);background:rgba(208,188,255,.06);
}
.cb-auto-bar{
  display:flex;gap:6px;padding:10px 12px;border-top:1px solid var(--border);
  flex-shrink:0;flex-wrap:wrap;
}
.cb-auto-bar select{flex:1;min-width:90px}
.cb-auto-bar button{flex-shrink:0}

/* ── Blueprint wizard modal ── */
.cb-modal-backdrop{
  position:fixed;inset:0;background:rgba(8,7,14,.7);backdrop-filter:blur(4px);
  display:flex;align-items:center;justify-content:center;z-index:200;
}
.cb-modal{
  width:420px;max-width:92vw;background:rgba(28,26,42,.98);
  border:1px solid var(--border2);border-radius:16px;padding:24px;
  box-shadow:0 24px 60px rgba(0,0,0,.5);
}
.cb-modal-title{font-family:var(--fh);font-size:17px;font-weight:900;margin-bottom:4px}
.cb-modal-sub{font-size:12px;color:var(--text-muted);margin-bottom:18px}
.cb-shape-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.cb-shape-btn{
  padding:14px 8px;border-radius:10px;border:1px solid var(--border2);
  background:rgba(255,255,255,.04);cursor:pointer;text-align:center;
  transition:all .15s;color:var(--text-muted);
}
.cb-shape-btn .ic{font-size:22px;display:block;margin-bottom:4px}
.cb-shape-btn .lb{font-size:10px;font-weight:800}
.cb-shape-btn.active{
  border-color:var(--primary);background:rgba(208,188,255,.14);color:var(--primary);
}
.cb-field-row{display:flex;gap:10px;margin-bottom:12px}
.cb-field{flex:1}
.cb-field label{display:block;font-size:10px;font-weight:800;letter-spacing:.05em;
  text-transform:uppercase;color:var(--text-muted);margin-bottom:5px}
.cb-field input{width:100%}
.cb-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.cb-modal-hint{font-size:11px;color:var(--text-muted);line-height:1.5;margin-top:2px;margin-bottom:14px}
`;
  document.head.appendChild(s);
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

function _cbGenId() {
  // Temporary client-side ID for new items; server replaces on save.
  return 'new_' + Math.random().toString(36).slice(2, 9);
}

function _cbCanvasScale() {
  const wrap = document.querySelector('.cb-canvas-wrap');
  if (!wrap) return 1;
  return Math.min(wrap.clientWidth / CB_CANVAS_W, wrap.clientHeight / CB_CANVAS_H);
}

function _cbVirtualCoords(clientX, clientY) {
  const wrap = document.querySelector('.cb-canvas-wrap');
  if (!wrap) return { x: 0, y: 0 };
  const rect  = wrap.getBoundingClientRect();
  const scale = _cbCanvasScale();
  return {
    x: Math.round((clientX - rect.left) / scale),
    y: Math.round((clientY - rect.top)  / scale),
  };
}

// ── State loading ─────────────────────────────────────────────────────────────

function _cbLoadState() {
  const state    = AppStore.getState();
  const layouts  = (state.classroomLayouts || []).filter(l => l.classId === _cbClassId);

  if (!_cbLayoutId && layouts.length > 0) {
    _cbLayoutId   = layouts[0].id;
    _cbLayoutName = layouts[0].name;
  }

  const layout = layouts.find(l => l.id === _cbLayoutId);
  if (layout) {
    _cbLayoutName  = layout.name;
    _cbLocalProps  = JSON.parse(JSON.stringify(layout.roomData || []));
    const seats    = (state.seats || []).filter(s => s.layoutId === _cbLayoutId);
    const assigns  = (state.seatAssignments || []).filter(a => a.layoutId === _cbLayoutId);
    const assignMap = Object.fromEntries(assigns.map(a => [a.seatId, a.studentId]));
    _cbLocalSeats  = seats.map(s => ({
      id:       s.id,
      xCoord:   s.xCoord,
      yCoord:   s.yCoord,
      rotation: s.rotation || 0,
      label:    s.label || null,
      isLocked: !!s.isLocked,
      studentId: assignMap[s.id] || null,
    }));
  } else if (!layout && _cbLayoutId) {
    // Layout was deleted — reset.
    _cbLayoutId   = null;
    _cbLocalSeats = [];
    _cbLocalProps = [];
  }
}

// ── One-time seat-overlap auto-fix (report §1, option 2) ───────────────────
//
// Existing layouts may have seats placed closer together than the new
// 120px seat box (only a 32px canvas-edge margin was ever enforced — never
// a minimum gap between seats). This resolves any such overlaps the first
// time a layout is opened after the size bump, then permanently marks the
// layout as fixed so it never re-runs — even if a teacher later packs
// seats tight on purpose. See phase6_seat_size_migration.sql for the
// seat_overlap_fixed column + mark_seat_overlap_fixed() RPC this relies on.
let _cbAutoFixInFlight = new Set(); // layoutIds currently mid-fix — guards re-entrancy from overlapping store events

// Pairwise separation: repeatedly nudges any two seat centers closer than
// CB_SEAT_SIZE apart away from each other until nothing overlaps (or the
// iteration cap is hit — a generous cap is fine here, this only ever runs
// once per layout, not on every frame). Locked seats are treated as fixed
// anchors — a locked seat is never moved, only unlocked seats get pushed
// away from it — matching the existing convention that locking protects a
// seat from every automated process (auto-allocate, blueprint regen, and
// now this). Two locked seats that already overlap are left alone; there's
// no automated move that would respect both locks.
function _cbResolveSeatOverlaps(seats) {
  if (!seats.length) return { changed: false, seats };
  const pts = seats.map(s => ({ id: s.id, x: s.xCoord, y: s.yCoord, locked: !!s.isLocked }));
  let changed = false;
  const MAX_ITER = 60;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let movedThisPass = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        if (a.locked && b.locked) continue; // can't fix without violating a lock — leave as-is

        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= CB_SEAT_SIZE) continue;

        movedThisPass = true;
        changed = true;
        if (dist < 0.01) { dx = 1; dy = 0; dist = 1; } // exact same spot — nudge apart deterministically

        const ux = dx / dist, uy = dy / dist;
        const overlap = CB_SEAT_SIZE - dist;

        if (a.locked) {
          b.x += ux * overlap; b.y += uy * overlap;
        } else if (b.locked) {
          a.x -= ux * overlap; a.y -= uy * overlap;
        } else {
          a.x -= ux * (overlap / 2); a.y -= uy * (overlap / 2);
          b.x += ux * (overlap / 2); b.y += uy * (overlap / 2);
        }
      }
    }
    if (!movedThisPass) break;
  }

  // Keep every seat on the canvas after spreading.
  pts.forEach(p => {
    p.x = Math.max(CB_SEAT_MARGIN, Math.min(CB_CANVAS_W - CB_SEAT_MARGIN, p.x));
    p.y = Math.max(CB_SEAT_MARGIN, Math.min(CB_CANVAS_H - CB_SEAT_MARGIN, p.y));
  });

  const byId = Object.fromEntries(pts.map(p => [p.id, p]));
  const newSeats = seats.map(s => ({ ...s, xCoord: Math.round(byId[s.id].x), yCoord: Math.round(byId[s.id].y) }));
  return { changed, seats: newSeats };
}

// Entry point — safe to call on every load/repaint; it's a no-op unless
// the current layout's seat_overlap_fixed flag is still false.
async function _cbMaybeAutoFixSeatOverlap() {
  if (!_cbLayoutId || _cbMode !== 'build') return; // only meaningful in Build mode, on a real layout
  if (_cbAutoFixInFlight.has(_cbLayoutId)) return;

  const state  = AppStore.getState();
  const layout = (state.classroomLayouts || []).find(l => l.id === _cbLayoutId);
  if (!layout || layout.seatOverlapFixed) return;

  _cbAutoFixInFlight.add(_cbLayoutId);
  try {
    const { changed, seats } = _cbResolveSeatOverlaps(_cbLocalSeats);

    if (changed) {
      _cbLocalSeats = seats;
      const saveResult = await ClassroomService.saveLayout(
        _cbClassId, _cbLayoutName, _cbLocalSeats, _cbLocalProps, _cbLayoutId
      );
      if (!saveResult.ok) {
        // Don't mark fixed on failure — leave it to retry next time the layout loads.
        toast('❌ Could not auto-spread seats: ' + saveResult.error, '#ffb4ab');
        return;
      }
      toast('🪑 Seats auto-spread to fit the new 120px size — drag any that still look off', '#d0bcff');
      _cbRenderCanvas();
    }

    await ClassroomService.markSeatOverlapFixed(_cbLayoutId);
  } finally {
    _cbAutoFixInFlight.delete(_cbLayoutId);
  }
}

// ── Main renderer ─────────────────────────────────────────────────────────────

window.renderClassroomBuilder = function () {
  const page = document.getElementById('a-classroom');
  if (!page) return;

  _cbMounted = true;
  // Classroom module reads exclusively from AppStore — never from the legacy DB blob.
  // (DB = loadDB() would be a no-op here: classroom data never lives in the legacy cache.)

  const state    = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  if (classIds.length && !classIds.includes(_cbClassId)) {
    _cbClassId = classIds[0];
  }

  _cbLoadState();
  _cbRenderShell(page, classIds, state);
  _cbSubscribeToStore();
  _cbMaybeAutoFixSeatOverlap();

  // Defense-in-depth: also refetch on every mount, not just once after
  // login. See the matching note in live_monitor.js / auth.js doLogin() —
  // this is a no-op render-wise until the fetch resolves; the AppStore
  // subscription above repaints automatically when data lands.
  if (typeof window.refreshClassroomData === 'function') {
    window.refreshClassroomData().catch(function (e) {
      console.warn('[ClassroomBuilder] mount-time classroom data refresh failed:', e);
    });
  }
};

function _cbRenderShell(page, classIds, state) {
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

function _cbScaleCanvas() {
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

function _cbRenderCanvas() {
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

function _cbRepaintSeats() {
  if (!_cbLayoutId || !_cbMounted) return;
  const seatingMap  = ClassroomService.getLiveSeatingMap(_cbClassId, _cbLayoutId);
  const mapBySeatId = Object.fromEntries(seatingMap.map(s => [s.seatId, s]));

  document.querySelectorAll('.cb-seat').forEach(el => {
    const seatId = el.dataset.seatId;
    const vm     = mapBySeatId[seatId];
    if (!vm) return;
    const col = vm.color || ClassroomService.STATUS_COLORS['_empty'];
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

function _cbRenderSidebar() {
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
      _cbDragStudentId = chip.dataset.studentId;
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chip.dataset.studentId);
    });
    chip.addEventListener('dragend', () => {
      _cbDragStudentId = null;
      chip.classList.remove('dragging');
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

function _cbStudentChip(student, isAssigned, log) {
  const statusText = log ? log.status : (isAssigned ? '—' : 'Not yet scanned');
  const chipColor  = isAssigned ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.04)';
  return `
    <div class="cb-student-chip ${isAssigned?'assigned':''}"
      draggable="${isAssigned?'false':'true'}"
      data-student-id="${_esc(student.id)}"
      title="${isAssigned?'Already seated — drag them off their seat on the canvas to unseat':'Drag to a seat'}">
      <div class="cb-chip-avatar" style="background:${student.color||'#8b5cf6'}">${_esc(student.init||'?')}</div>
      <div class="cb-chip-info">
        <div class="cb-chip-name">${_esc(student.name||student.displayName||student.id)}</div>
        <div class="cb-chip-status">${statusText}</div>
      </div>
    </div>
  `;
}

// ── AppStore subscription ─────────────────────────────────────────────────────

function _cbSubscribeToStore() {
  AppStore.subscribe(_cbSubscriberKey, (state, event) => {
    if (!_cbMounted) return;
    const type = event && event.type;

    // Attendance change → repaint seat colors only (fast path).
    if (type === 'attendance:scan-recorded' || type === 'attendance:override' || type === 'state:remote-sync') {
      _cbRepaintSeats();
      return;
    }

    // Layout/assignment change → reload state and re-render canvas + sidebar.
    if (type && (type.startsWith('classroom:') || type === 'state:legacy-sync')) {
      _cbLoadState();
      _cbRenderCanvas();
      _cbRenderSidebar();
      // Re-render toolbar counts.
      const seatCountEl = document.querySelector('.cb-toolbar span[style*="text-muted"]');
      if (seatCountEl && _cbMode === 'build') {
        seatCountEl.textContent = `${_cbLocalSeats.length} seat${_cbLocalSeats.length!==1?'s':''}`;
      }
      _cbMaybeAutoFixSeatOverlap();
    }
  });
}

// ── Toolbar actions ───────────────────────────────────────────────────────────

window._cbOnClassChange = function(classId) {
  _cbClassId  = classId;
  _cbLayoutId = null;
  _cbLoadState();
  const page = document.getElementById('a-classroom');
  const state = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  _cbRenderShell(page, classIds, state);
  _cbMaybeAutoFixSeatOverlap();
};

window._cbOnLayoutChange = function(layoutId) {
  _cbLayoutId = layoutId || null;
  _cbSelectedSeatIds.clear();
  _cbLoadState();
  _cbScaleCanvas();
  _cbRenderCanvas();
  _cbRenderSidebar();
  _cbMaybeAutoFixSeatOverlap();
};

window._cbSetMode = function(mode) {
  if (!_cbLayoutId && mode === 'assign') {
    toast('⚠️ Save a layout first before assigning students.', '#ffb95f');
    return;
  }
  if (mode === 'assign') _cbSelectedSeatIds.clear();
  _cbMode = mode;
  const page  = document.getElementById('a-classroom');
  const state = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  _cbRenderShell(page, classIds, state);
};

window._cbNewLayout = async function() {
  const name = prompt('Layout name:', 'New Layout');
  if (!name) return;
  const result = await ClassroomService.saveLayout(_cbClassId, name, [], []);
  if (!result.ok) { toast('❌ ' + result.error, '#ffb4ab'); return; }
  _cbLayoutId   = result.layoutId;
  _cbLayoutName = name;
  _cbLocalSeats = [];
  _cbLocalProps = [];
  const page  = document.getElementById('a-classroom');
  const state = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  _cbRenderShell(page, classIds, state);
  toast('✅ Layout created', '#4edea3');
};

window._cbRenameLayout = function() {
  const name = prompt('Rename layout:', _cbLayoutName);
  if (!name) return;
  _cbLayoutName = name;
  const sel = document.getElementById('cb-layout-select');
  if (sel) {
    const opt = sel.querySelector(`option[value="${_cbLayoutId}"]`);
    if (opt) opt.textContent = name;
  }
  toast('✏️ Name updated — save to persist', '#d0bcff');
};

window._cbDeleteLayout = async function() {
  if (!_cbLayoutId) return;
  if (!confirm(`Delete layout "${_cbLayoutName}"? This also removes all seat assignments.`)) return;
  const result = await ClassroomService.deleteLayout(_cbLayoutId);
  if (!result.ok) { toast('❌ ' + result.error, '#ffb4ab'); return; }
  _cbLayoutId   = null;
  _cbLocalSeats = [];
  _cbLocalProps = [];
  const page  = document.getElementById('a-classroom');
  const state = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  _cbRenderShell(page, classIds, state);
  toast('🗑 Layout deleted', '#ffb4ab');
};

window._cbSave = async function() {
  const btn = document.querySelector('.cb-toolbar .btn-primary');
  if (btn) { btn.textContent = '⏳ Saving…'; btn.disabled = true; }

  const result = await ClassroomService.saveLayout(
    _cbClassId,
    _cbLayoutName,
    _cbLocalSeats.map(s => ({
      id:       s.id && !s.id.startsWith('new_') ? s.id : null,
      xCoord:   s.xCoord,
      yCoord:   s.yCoord,
      rotation: s.rotation || 0,
      label:    s.label || null,
      isLocked: !!s.isLocked,
    })),
    _cbLocalProps,
    _cbLayoutId,
  );

  if (!result.ok) {
    toast('❌ Save failed: ' + result.error, '#ffb4ab');
    if (btn) { btn.textContent = '💾 Save Layout'; btn.disabled = false; }
    return;
  }

  // Server may have assigned UUIDs to new seats — update local copies.
  _cbLayoutId   = result.layoutId;
  _cbLocalSeats = result.seats.map(s => ({
    id:        s.id,
    xCoord:    s.xCoord,
    yCoord:    s.yCoord,
    rotation:  s.rotation || 0,
    label:     s.label || null,
    isLocked:  !!s.isLocked,
    studentId: null, // assignments are a separate slice
  }));
  _cbSelectedSeatIds.clear(); // old ids (incl. any unsaved 'new_*' temp ids) no longer apply

  _cbRenderCanvas();
  if (btn) { btn.textContent = '💾 Save Layout'; btn.disabled = false; }
  toast('✅ Layout saved', '#4edea3');
};

// ── Build mode: seat management ───────────────────────────────────────────────

window._cbAddSeat = function() {
  // Place new seat at center of visible canvas.
  const wrap  = document.getElementById('cb-canvas-wrap');
  const x = wrap ? Math.round(CB_CANVAS_W / 2) : 400;
  const y = wrap ? Math.round(CB_CANVAS_H / 2) : 300;
  _cbLocalSeats.push({ id: _cbGenId(), xCoord: x, yCoord: y, rotation: 0, label: null, isLocked: false, studentId: null });
  _cbRenderCanvas();
  _cbRenderSidebar();
};

window._cbDeleteSeat = function(seatId) {
  _cbLocalSeats = _cbLocalSeats.filter(s => s.id !== seatId);
  _cbSelectedSeatIds.delete(seatId);
  _cbRenderCanvas();
  _cbRenderSidebar();
};

window._cbRotateSeat = function(seatId) {
  const seat = _cbLocalSeats.find(s => s.id === seatId);
  if (seat) { seat.rotation = ((seat.rotation || 0) + 90) % 360; }
  _cbRenderCanvas();
};

// ── Build mode: Mass Seat Actions (multi-select + duplicate) ─────────────────
//
// Deliberately lightweight per the spec: this is plain Shift-click toggling
// into a Set, re-rendered via the existing _cbRenderCanvas()/_cbRenderShell()
// paths. No new drag machinery, no separate selection-rectangle code. The
// selection lives only in memory for the build session — it is NOT part of
// the persisted seat shape and resets on layout switch (see _cbOnLayoutChange)
// and on leaving build mode (see _cbSetMode), so a stray selection can never
// leak into Assign Mode or get saved as seat data.

window._cbToggleSeatSelection = function(seatId) {
  if (_cbSelectedSeatIds.has(seatId)) _cbSelectedSeatIds.delete(seatId);
  else _cbSelectedSeatIds.add(seatId);
  _cbRenderCanvas();
  _cbRefreshSelectionToolbar();
};

window._cbSelectAllSeats = function() {
  _cbSelectedSeatIds = new Set(_cbLocalSeats.map(s => s.id));
  _cbRenderCanvas();
  _cbRefreshSelectionToolbar();
};

window._cbClearSeatSelection = function() {
  _cbSelectedSeatIds.clear();
  _cbRenderCanvas();
  _cbRefreshSelectionToolbar();
};

// Re-paints just the toolbar row (button disabled states + count badge)
// without a full shell re-render, since that's the only part that changes
// when the selection set changes and seats themselves don't move.
function _cbRefreshSelectionToolbar() {
  const page  = document.getElementById('a-classroom');
  const state = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  _cbRenderShell(page, classIds, state);
}

window._cbDuplicateSelectedSeats = function() {
  if (_cbSelectedSeatIds.size === 0) return;
  const selected = _cbLocalSeats.filter(s => _cbSelectedSeatIds.has(s.id));
  const clones   = ClassroomService.duplicateSeats(selected, 30);

  _cbLocalSeats.push(...clones);
  // Selection follows the new clones, so a teacher can immediately nudge
  // or duplicate again from the copies without having to re-select them.
  _cbSelectedSeatIds = new Set(clones.map(c => c.id));

  const page  = document.getElementById('a-classroom');
  const state = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  _cbRenderShell(page, classIds, state);
  toast(`✅ Duplicated ${clones.length} seat${clones.length!==1?'s':''} — remember to Save`, '#4edea3');
};

// ── Build mode: seat drag ─────────────────────────────────────────────────────

function _cbSeatDragStart(e, seatId) {
  _cbDragSeatId = seatId;
  const seat   = _cbLocalSeats.find(s => s.id === seatId);
  const scale  = _cbCanvasScale();
  const el     = e.currentTarget;
  const rect   = el.getBoundingClientRect();
  // Offset is relative to the virtual canvas coordinates.
  _cbDragOffsetX = Math.round((e.clientX - rect.left) / scale);
  _cbDragOffsetY = Math.round((e.clientY - rect.top)  / scale);
  e.dataTransfer.effectAllowed = 'move';
  // Ghost image: transparent (the seat moves visually via the dragover handler).
  const ghost = document.createElement('div');
  ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;width:1px;height:1px';
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 0, 0);
  setTimeout(() => document.body.removeChild(ghost), 0);
}

function _cbSeatDragEnd() {
  _cbDragSeatId = null;
  _cbDragOffsetX = 0;
  _cbDragOffsetY = 0;
}

// ── Build mode: prop drag ─────────────────────────────────────────────────────

function _cbPropDragStart(e, propIdx) {
  _cbDragSeatId  = '__prop__' + propIdx;
  const el       = e.currentTarget;
  const rect     = el.getBoundingClientRect();
  const scale    = _cbCanvasScale();
  _cbDragOffsetX = Math.round((e.clientX - rect.left) / scale);
  _cbDragOffsetY = Math.round((e.clientY - rect.top)  / scale);
  e.dataTransfer.effectAllowed = 'move';
}

function _cbPropDragEnd() {
  _cbDragSeatId  = null;
  _cbDragOffsetX = 0;
  _cbDragOffsetY = 0;
}

// ── Canvas drop zone ──────────────────────────────────────────────────────────

window._cbOnCanvasDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};

window._cbOnCanvasDragLeave = function(e) {
  // Only clear when truly leaving the wrap, not entering a child.
  const wrap = document.getElementById('cb-canvas-wrap');
  if (wrap && !wrap.contains(e.relatedTarget)) {
    // nothing to update visually
  }
};

window._cbOnCanvasDrop = function(e) {
  e.preventDefault();
  const { x, y } = _cbVirtualCoords(e.clientX, e.clientY);

  if (_cbMode === 'build') {
    if (!_cbDragSeatId) return;

    if (_cbDragSeatId.startsWith('__prop__')) {
      const propIdx = parseInt(_cbDragSeatId.replace('__prop__', ''), 10);
      if (_cbLocalProps[propIdx]) {
        _cbLocalProps[propIdx].x = Math.max(0, x - _cbDragOffsetX);
        _cbLocalProps[propIdx].y = Math.max(0, y - _cbDragOffsetY);
        _cbRenderCanvas();
      }
    } else {
      const seat = _cbLocalSeats.find(s => s.id === _cbDragSeatId);
      if (seat) {
        const newX = Math.max(CB_SEAT_MARGIN, Math.min(CB_CANVAS_W - CB_SEAT_MARGIN, x - _cbDragOffsetX + CB_SEAT_MARGIN));
        const newY = Math.max(CB_SEAT_MARGIN, Math.min(CB_CANVAS_H - CB_SEAT_MARGIN, y - _cbDragOffsetY + CB_SEAT_MARGIN));

        // GROUP DRAG: if the seat being dragged is part of a multi-select
        // (Select All / Shift-click), move every selected seat by the same
        // delta instead of only relocating the one seat under the cursor —
        // previously this only ever moved the single dragged seat, silently
        // leaving the rest of the selection behind.
        if (_cbSelectedSeatIds.has(seat.id) && _cbSelectedSeatIds.size > 1) {
          const dx = newX - seat.xCoord;
          const dy = newY - seat.yCoord;
          _cbLocalSeats.forEach(s => {
            if (!_cbSelectedSeatIds.has(s.id)) return;
            s.xCoord = Math.max(CB_SEAT_MARGIN, Math.min(CB_CANVAS_W - CB_SEAT_MARGIN, s.xCoord + dx));
            s.yCoord = Math.max(CB_SEAT_MARGIN, Math.min(CB_CANVAS_H - CB_SEAT_MARGIN, s.yCoord + dy));
          });
        } else {
          seat.xCoord = newX;
          seat.yCoord = newY;
        }
        _cbRenderCanvas();
      }
    }
    _cbDragSeatId = null;
  }
};

// ── Build mode: props management ──────────────────────────────────────────────

window._cbAddProp = function(type) {
  _cbLocalProps.push({ type, x: Math.round(CB_CANVAS_W/2), y: 40, rotation: 0 });
  _cbRenderCanvas();
};

window._cbDeleteProp = function(propIdx) {
  _cbLocalProps.splice(propIdx, 1);
  _cbRenderCanvas();
};

// ── Blueprint wizard (Structural Room Generation) ────────────────────────────
//
// Drops a perfectly-aligned array of seats onto the canvas in one RPC call
// instead of individual placement. Locked seats are never touched — the
// server-side generate_room_blueprint() RPC only regenerates the unlocked
// portion, so this is safe to re-run on a layout a teacher has already
// partially hand-tuned.

window._cbOpenBlueprintWizard = function() {
  _cbWizardOpen = true;
  _cbRenderWizard();
};

window._cbCloseBlueprintWizard = function() {
  _cbWizardOpen = false;
  const root = document.getElementById('cb-modal-root');
  if (root) root.innerHTML = '';
};

window._cbSetWizardShape = function(shape) {
  _cbWizardShape = shape;
  _cbRenderWizard();
};

window._cbSetWizardPreset = function(preset) {
  _cbWizardPreset = preset;
  _cbRenderWizard();
};

function _cbRenderWizard() {
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

window._cbSubmitBlueprintWizard = async function() {
  const rows    = Math.max(1, parseInt(document.getElementById('cb-wiz-rows').value, 10)    || 1);
  const cols    = Math.max(1, parseInt(document.getElementById('cb-wiz-cols').value, 10)    || 1);
  const spacing = Math.max(40, parseInt(document.getElementById('cb-wiz-spacing').value, 10) || 80);
  const preset  = _cbWizardShape === 'grid' ? _cbWizardPreset : 'traditional';
  _cbWizardRows = rows; _cbWizardCols = cols; _cbWizardSpacing = spacing;

  if (rows * cols > 400) {
    toast('❌ That\'s too many seats (max 400) — lower rows/columns.', '#ffb4ab');
    return;
  }
  if (preset === 'center_aisle' && cols < 2) {
    toast('❌ Center Aisle Split needs at least 2 columns.', '#ffb4ab');
    return;
  }
  if (preset === 'double_aisle' && cols < 3) {
    toast('❌ Double Aisle Split needs at least 3 columns.', '#ffb4ab');
    return;
  }

  const btn = document.querySelector('.cb-modal-actions .btn-primary');
  if (btn) { btn.textContent = '⏳ Generating…'; btn.disabled = true; }

  const result = await ClassroomService.generateBlueprint(
    _cbLayoutId,              // null → wizard creates a new layout
    _cbClassId,
    _cbLayoutId ? _cbLayoutName : `${CB_SHAPE_TYPES.find(s=>s.shape===_cbWizardShape).label} Layout`,
    _cbWizardShape,
    rows, cols, spacing, preset,
  );

  if (!result.ok) {
    toast('❌ ' + result.error, '#ffb4ab');
    if (btn) { btn.textContent = '⚡ Generate'; btn.disabled = false; }
    return;
  }

  _cbLayoutId = result.layoutId;
  _cbWizardOpen = false;
  _cbLoadState();
  const page  = document.getElementById('a-classroom');
  const state = AppStore.getState();
  const classIds = window.getActiveClassIds(state);
  _cbRenderShell(page, classIds, state);

  const lockedNote = result.preservedLockedCount > 0
    ? ` (${result.preservedLockedCount} locked seat${result.preservedLockedCount!==1?'s':''} preserved)`
    : '';
  toast(`✅ Generated ${result.generatedSeats.length} seats${lockedNote}`, '#4edea3');
};

// ── Assign mode: drag-and-drop ────────────────────────────────────────────────
//
// One student id travels through dataTransfer regardless of WHERE the drag
// started — sidebar chip or an already-occupied seat. The drop target
// (another seat, or the pool zone) decides what happens, and
// ClassroomService.manualMoveStudent() resolves move-vs-swap-vs-evict
// server-side from wherever that student currently sits.

function _cbSeatAssignDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function _cbSeatAssignDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function _cbSeatAssignDrop(e, seatId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!_cbDragStudentId || !seatId || !_cbLayoutId) return;

  const result = await ClassroomService.manualMoveStudent(
    _cbDragStudentId, seatId, _cbLayoutId
  );
  if (!result.ok) {
    toast('❌ ' + result.error, '#ffb4ab');
    return;
  }
  if (result.note) {
    // No-op (e.g. dropped a seat onto itself) — nothing to celebrate.
    return;
  }
  // AppStore.updateState was already called inside ClassroomService — the
  // subscription above will call _cbRenderCanvas() + _cbRenderSidebar().
  toast(result.swapped ? '🔄 Seats swapped' : '✅ Seat assigned', '#4edea3');
}

// Drag SOURCE: starting a drag from an already-occupied seat (for
// seat→seat swap, or seat→pool evict). Reuses the same _cbDragStudentId
// channel that sidebar chips use, so the drop handlers don't need to care
// where the drag began.
function _cbSeatOccupantDragStart(e, seatId, studentId) {
  _cbDragStudentId = studentId;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', studentId);
}

function _cbSeatOccupantDragEnd(e) {
  _cbDragStudentId = null;
  e.currentTarget.classList.remove('dragging');
}

async function _cbUnassign(seatId) {
  if (!_cbLayoutId) return;
  // Deliberately NOT reading _cbLocalSeats[].studentId here — that field is
  // only ever populated by _cbLoadState() and gets reset to null for every
  // seat right after a Build-mode Save (assignments are a separate slice,
  // untouched by save_classroom_layout's response). If a teacher saves a
  // geometry edit and switches straight to Assign mode, that stale null
  // would make this function silently no-op on a seat that's visibly
  // occupied (the canvas itself renders from the live map, not this field,
  // so the seat LOOKS occupied even though _cbLocalSeats disagrees).
  // getLiveSeatingMap() is the same always-correct source every other read
  // in this file already uses for "who's actually in this seat right now."
  const vm = ClassroomService.getLiveSeatingMap(_cbClassId, _cbLayoutId).find(v => v.seatId === seatId);
  const studentId = vm ? vm.studentId : null;
  if (!studentId) return;

  const result = await ClassroomService.manualMoveStudent(studentId, null, _cbLayoutId);
  if (!result.ok) {
    toast('❌ ' + result.error, '#ffb4ab');
    return;
  }
  toast('✅ Seat unassigned', '#d0bcff');
}

// Toggle a seat's is_locked flag. Stops the click from also bubbling into
// the seat's own unassign-on-click handler.
window._cbToggleSeatLock = async function(e, seatId) {
  e.stopPropagation();
  if (!_cbLayoutId) return;
  const seat = _cbLocalSeats.find(s => s.id === seatId);
  if (!seat) return;

  const result = await ClassroomService.setSeatLock(seatId, _cbLayoutId, !seat.isLocked);
  if (!result.ok) {
    toast('❌ ' + result.error, '#ffb4ab');
    return;
  }
  toast(result.seat.isLocked ? '🔒 Seat locked' : '🔓 Seat unlocked', '#d0bcff');
};

// ── Assign mode: bulk auto-allocate ───────────────────────────────────────────

window._cbSetAutoStrategy = function(strategy) {
  _cbAutoStrategy = strategy;
};

window._cbRunAutoAllocate = async function() {
  if (!_cbLayoutId) return;
  const unassigned = ClassroomService.getUnassignedStudents(_cbClassId, _cbLayoutId).map(s => s.id);
  if (!unassigned.length) {
    toast('✅ Everyone is already seated', '#4edea3');
    return;
  }

  const btn = document.getElementById('cb-auto-btn');
  if (btn) { btn.textContent = '⏳…'; btn.disabled = true; }

  const result = await ClassroomService.autoAllocateRemaining(_cbLayoutId, unassigned, _cbAutoStrategy);

  if (btn) { btn.textContent = '⚡ Auto-Fill'; btn.disabled = false; }

  if (!result.ok) {
    toast('❌ ' + result.error, '#ffb4ab');
    return;
  }
  const remNote = result.unplacedRemaining > 0
    ? ` — ${result.unplacedRemaining} still unseated (not enough open seats)`
    : '';
  toast(`✅ Seated ${result.placedCount} student${result.placedCount!==1?'s':''}${remNote}`, '#4edea3');
};

// ── Student view (read-only) ──────────────────────────────────────────────────

window.renderStudentSeating = function () {
  const page = document.getElementById('s-classroom');
  if (!page) return;

  const state  = AppStore.getState();
  const student = currentUser;
  if (!student) return;

  const classId = student.classId || 'default-class';
  const layouts = (state.classroomLayouts || []).filter(l => l.classId === classId);
  if (!layouts.length) {
    page.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">
      <div style="font-size:48px;margin-bottom:12px">🪑</div>
      <div style="font-size:15px;font-weight:700">No seating layout has been set up yet.</div>
      <div style="font-size:13px;margin-top:6px">Your teacher will configure this soon.</div>
    </div>`;
    // Defense-in-depth: this view has no AppStore subscription of its own
    // (it's a one-shot render), so if classroom data hasn't landed yet —
    // see the "PRE-LOGIN BOOTSTRAP RACE" note in classroom_index.js — a
    // refetch here and a single re-render once it resolves is the only way
    // this page recovers without the student navigating away and back.
    if (typeof window.refreshClassroomData === 'function') {
      window.refreshClassroomData().then(function () {
        if (page.classList.contains('active')) renderStudentSeating();
      }).catch(function (e) {
        console.warn('[ClassroomBuilder] student-seating refresh failed:', e);
      });
    }
    return;
  }

  const layout     = layouts[0];
  const seatingMap = ClassroomService.getLiveSeatingMap(classId, layout.id);
  const myVm       = seatingMap.find(s => s.studentId === student.id);

  page.innerHTML = `
    <div style="padding:24px">
      <div style="font-family:var(--fh);font-size:22px;font-weight:900;margin-bottom:4px">🪑 My Seat</div>
      <div style="color:var(--text-muted);font-size:13px;margin-bottom:20px">${_esc(layout.name)} — ${_esc(classId)}</div>

      ${myVm ? `
        <div class="glass-card" style="display:inline-flex;align-items:center;gap:16px;padding:20px 24px;margin-bottom:24px">
          <div style="font-size:40px">🪑</div>
          <div>
            <div style="font-family:var(--fh);font-size:18px;font-weight:800;color:var(--on-surface)">Seat ${myVm.label||'assigned'}</div>
            <div style="font-size:13px;color:${myVm.color.border};font-weight:700;margin-top:4px">
              Today: ${myVm.attendanceStatus||'Not yet scanned'}
            </div>
          </div>
        </div>
      ` : `
        <div class="glass-card" style="display:inline-flex;align-items:center;gap:12px;padding:16px 20px;margin-bottom:24px;border-color:rgba(255,185,95,.3)">
          <span style="font-size:24px">⚠️</span>
          <span style="color:var(--tertiary);font-weight:700;font-size:14px">No seat assigned yet</span>
        </div>
      `}

      <div style="position:relative;width:100%;max-width:800px;aspect-ratio:3/2;
        border-radius:16px;overflow:hidden;border:1px solid var(--border);background:var(--bg-low)">
        <div style="position:absolute;inset:0;
          background:repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,.02) 39px,rgba(255,255,255,.02) 40px),
          repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,.02) 39px,rgba(255,255,255,.02) 40px)">
        </div>
        ${seatingMap.map(s => {
          const pct_x = (s.xCoord / CB_CANVAS_W * 100).toFixed(2);
          const pct_y = (s.yCoord / CB_CANVAS_H * 100).toFixed(2);
          const isMe  = s.studentId === student.id;
          return `<div style="
            position:absolute;left:${pct_x}%;top:${pct_y}%;
            transform:translate(-50%,-50%) rotate(${s.rotation||0}deg);
            width:48px;height:48px;border-radius:10px;
            background:${s.color.bg};border:2px solid ${isMe?'var(--primary)':s.color.border};
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            font-family:var(--fh);box-shadow:${isMe?'0 0 0 3px rgba(139,92,246,.4)':''};
            transition:all .3s;
          " title="${_esc(s.studentName||'')}">
            ${s.studentId
              ? `<div style="width:26px;height:26px;border-radius:6px;background:${s.studentColor||'rgba(139,92,246,.5)'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900">${_esc(s.studentInit||'?')}</div>
                 ${isMe?`<div style="font-size:6px;color:var(--primary);font-weight:800;margin-top:1px">YOU</div>`:''}`
              : `<div style="font-size:16px;opacity:.25">🪑</div>`
            }
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
};

// ── Teardown ──────────────────────────────────────────────────────────────────

window.unmountClassroomBuilder = function () {
  _cbMounted = false;
  AppStore.unsubscribe(_cbSubscriberKey);
  window.removeEventListener('resize', _cbScaleCanvas);
};

console.log('[EduQuest] classroom/classroom_builder.js loaded — renderClassroomBuilder/renderStudentSeating registered.');
