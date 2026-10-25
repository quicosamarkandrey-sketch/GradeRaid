// Local build-mode editing tools. Server writes remain in ClassroomService.
let _cbEditorSeatSize = 120;
let _cbEditorSelectMode = false;
const _cbEditorUndo = [];
const _cbEditorRedo = [];
function _cbEditorSnapshot() {
  return JSON.stringify({ seats: _cbLocalSeats, props: _cbLocalProps, name: _cbLayoutName });
}
function _cbEditorRemember(before) {
  if (before === _cbEditorSnapshot()) return;
  _cbEditorUndo.push(before);
  if (_cbEditorUndo.length > 80) _cbEditorUndo.shift();
  _cbEditorRedo.length = 0;
  _cbEditorToolbar();
}
function _cbEditorRestore(from, to) {
  if (!from.length) return;
  to.push(_cbEditorSnapshot());
  const saved = JSON.parse(from.pop());
  _cbLocalSeats = saved.seats;
  _cbLocalProps = saved.props;
  _cbLayoutName = saved.name;
  _cbSelectedSeatIds.clear();
  _cbRefreshSelectionToolbar();
}
function _cbEditorToolbar() {
  const page = document.getElementById('a-classroom');
  if (!page) return;
  let bar = page.querySelector('.cb-editor-tools');
  if (_cbMode !== 'build') { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'cb-toolbar cb-editor-tools';
    page.querySelector('.cb-toolbar')?.after(bar);
  }
  bar.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-editor="undo" ${_cbEditorUndo.length ? '' : 'disabled'}>↶ Undo</button>
    <button class="btn btn-ghost btn-sm" data-editor="redo" ${_cbEditorRedo.length ? '' : 'disabled'}>↷ Redo</button>
    <button class="btn btn-ghost btn-sm" data-editor="select" aria-pressed="${_cbEditorSelectMode}">${_cbEditorSelectMode ? '✓ Select seats: On' : 'Select multiple seats'}</button>
    <button class="btn btn-ghost btn-sm" data-editor="fit">Fit all seats</button>
    <label>Seat display size <input aria-label="Seat display size" type="range" min="40" max="120" step="10" value="${_cbEditorSeatSize}"> <output>${_cbEditorSeatSize}px</output></label>
    <span style="font-size:12px">Drag empty space to select. Drag a selected seat to move the group. Undo applies to unsaved edits.</span>`;
  bar.querySelector('[data-editor="undo"]').onclick = () => _cbEditorRestore(_cbEditorUndo, _cbEditorRedo);
  bar.querySelector('[data-editor="redo"]').onclick = () => _cbEditorRestore(_cbEditorRedo, _cbEditorUndo);
  bar.querySelector('[data-editor="select"]').onclick = () => { _cbEditorSelectMode = !_cbEditorSelectMode; _cbEditorToolbar(); };
  bar.querySelector('[data-editor="fit"]').onclick = _cbEditorFit;
  bar.querySelector('input').oninput = e => {
    _cbEditorSeatSize = Number(e.target.value);
    bar.querySelector('output').textContent = _cbEditorSeatSize + 'px';
    page.querySelectorAll('.cb-seat').forEach(el => { el.style.width = _cbEditorSeatSize + 'px'; el.style.height = _cbEditorSeatSize + 'px'; });
  };
}
// Each discrete local action has one history entry. Saving/generation changes
// server identities and is an explicit history boundary, not a local undo.
for (const name of ['_cbAddSeat', '_cbDeleteSeat', '_cbRotateSeat', '_cbDuplicateSelectedSeats', '_cbAddProp', '_cbDeleteProp', '_cbRenameLayout', '_cbOnCanvasDrop']) {
  const original = window[name];
  window[name] = function (...args) {
    const before = _cbEditorSnapshot();
    const result = original.apply(this, args);
    _cbEditorRemember(before);
    return result;
  };
}
for (const name of ['_cbOnClassChange', '_cbOnLayoutChange', '_cbNewLayout', '_cbDeleteLayout', '_cbSave', '_cbSubmitBlueprintWizard']) {
  const original = window[name];
  window[name] = function (...args) {
    _cbEditorUndo.length = _cbEditorRedo.length = 0;
    _cbEditorToolbar();
    return original.apply(this, args);
  };
}
const _cbEditorStyle = document.createElement('style');
_cbEditorStyle.textContent = `
.cb-editor-tools label{display:flex;align-items:center;gap:8px;font-size:12px}
.cb-editor-tools [aria-pressed=true]{background:rgba(208,188,255,.25);border-color:var(--primary)}
.cb-seat{touch-action:none;cursor:grab;box-sizing:border-box}
.cb-seat:active{cursor:grabbing}
.cb-seat .cb-seat-init{max-width:48%;max-height:48%;font-size:clamp(10px,2vw,21px)!important}
.cb-seat .cb-seat-name{max-width:95%;font-size:10px}
.cb-seat .cb-seat-status{font-size:8px}
.cb-selection-rect{position:absolute;border:2px solid #d0bcff;background:rgba(208,188,255,.18);pointer-events:none;z-index:100}
.cb-canvas{touch-action:none}
`;
document.head.appendChild(_cbEditorStyle);
// Pointer capture gives a real seat preview for mouse, pen and touch. During
// the gesture only the DOM moves; cancel/Escape never mutates the draft.
let _cbEditorGesture = null;
function _cbEditorPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * CB_CANVAS_W / rect.width,
    y: (e.clientY - rect.top) * CB_CANVAS_H / rect.height };
}
function _cbEditorFinish(cancel) {
  const g = _cbEditorGesture;
  if (!g) return;
  _cbEditorGesture = null;
  if (!cancel && g.moved && g.seats) {
    for (const seat of _cbLocalSeats) {
      if (g.ids.has(seat.id)) { seat.xCoord += g.dx; seat.yCoord += g.dy; }
    }
    _cbEditorRemember(g.before);
  }
  if (!cancel && g.moved && !g.seats) _cbSelectedSeatIds = g.selection;
  if (!cancel && !g.moved && g.seats && (_cbEditorSelectMode || g.shift)) {
    if (_cbSelectedSeatIds.has(g.seatId)) _cbSelectedSeatIds.delete(g.seatId);
    else _cbSelectedSeatIds.add(g.seatId);
  }
  if (!cancel && !g.moved && !g.seats) _cbSelectedSeatIds.clear();
  g.box?.remove();
  if (g.canvas.hasPointerCapture?.(g.pointerId)) g.canvas.releasePointerCapture(g.pointerId);
  _cbRenderCanvas();
  _cbEditorToolbar();
}
document.addEventListener('pointerdown', e => {
  const canvas = e.target.closest('#cb-canvas');
  if (!canvas || _cbMode !== 'build' || e.button !== 0 || e.target.closest('button,.cb-prop')) return;
  const el = e.target.closest('.cb-seat');
  e.preventDefault();
  const seatId = el?.dataset.seatId;
  const ids = _cbSelectedSeatIds.has(seatId) ? new Set(_cbSelectedSeatIds) : new Set([seatId]);
  const point = _cbEditorPoint(e, canvas);
  _cbEditorGesture = { canvas, pointerId: e.pointerId, start: point, seats: !!el, seatId, ids,
    before: _cbEditorSnapshot(), moved: false, dx: 0, dy: 0, shift: e.shiftKey,
    selection: new Set(e.shiftKey ? _cbSelectedSeatIds : []) };
  canvas.setPointerCapture(e.pointerId);
}, true);
document.addEventListener('dragstart', e => {
  if (_cbMode === 'build' && e.target.closest('.cb-seat')) e.preventDefault();
}, true);
document.addEventListener('pointermove', e => {
  const g = _cbEditorGesture;
  if (!g || e.pointerId !== g.pointerId) return;
  const p = _cbEditorPoint(e, g.canvas);
  if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 3) g.moved = true;
  if (!g.moved) return;
  if (g.seats) {
    const seats = _cbLocalSeats.filter(s => g.ids.has(s.id));
    const half = _cbEditorSeatSize / 2;
    g.dx = Math.max(half - Math.min(...seats.map(s => s.xCoord)), Math.min(p.x - g.start.x, CB_CANVAS_W - half - Math.max(...seats.map(s => s.xCoord))));
    g.dy = Math.max(half - Math.min(...seats.map(s => s.yCoord)), Math.min(p.y - g.start.y, CB_CANVAS_H - half - Math.max(...seats.map(s => s.yCoord))));
    g.canvas.querySelectorAll('.cb-seat').forEach(el => {
      const seat = seats.find(s => s.id === el.dataset.seatId);
      if (seat) { el.style.left = seat.xCoord + g.dx + 'px'; el.style.top = seat.yCoord + g.dy + 'px'; el.style.opacity = '.7'; }
    });
  } else {
    if (!g.box) { g.box = document.createElement('div'); g.box.className = 'cb-selection-rect'; g.canvas.appendChild(g.box); }
    const x = Math.min(p.x, g.start.x), y = Math.min(p.y, g.start.y);
    const w = Math.abs(p.x - g.start.x), h = Math.abs(p.y - g.start.y);
    Object.assign(g.box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    g.selection = new Set(g.shift ? _cbSelectedSeatIds : []);
    _cbLocalSeats.forEach(s => { if (s.xCoord >= x && s.xCoord <= x+w && s.yCoord >= y && s.yCoord <= y+h) g.selection.add(s.id); });
    g.canvas.querySelectorAll('.cb-seat').forEach(el => el.classList.toggle('selected', g.selection.has(el.dataset.seatId)));
  }
});
document.addEventListener('pointerup', e => { if (_cbEditorGesture?.pointerId === e.pointerId) _cbEditorFinish(false); });
document.addEventListener('pointercancel', () => _cbEditorFinish(true));
document.addEventListener('keydown', e => {
  if (!_cbMounted || _cbMode !== 'build' || e.target.closest('input,textarea,select,[contenteditable=true]')) return;
  if (e.key === 'Escape') _cbEditorFinish(true);
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    _cbEditorRestore(e.shiftKey || e.key.toLowerCase() === 'y' ? _cbEditorRedo : _cbEditorUndo,
      e.shiftKey || e.key.toLowerCase() === 'y' ? _cbEditorUndo : _cbEditorRedo);
  }
});
// Selection is handled on pointerup; suppress the legacy Shift-click toggle.
document.addEventListener('click', e => {
  if (_cbMode === 'build' && e.target.closest('#cb-canvas .cb-seat') && !e.target.closest('button')) {
    e.stopImmediatePropagation();
  }
}, true);

// Bring oversized blueprints into the room while preserving their arrangement.
function _cbEditorFit() {
  if (!_cbLocalSeats.length) return;
  const before = _cbEditorSnapshot();
  const xs = _cbLocalSeats.map(s => s.xCoord), ys = _cbLocalSeats.map(s => s.yCoord);
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
  const scale = Math.min(1, (CB_CANVAS_W - _cbEditorSeatSize) / (width || 1), (CB_CANVAS_H - _cbEditorSeatSize) / (height || 1));
  _cbLocalSeats.forEach(s => {
    s.xCoord = Math.round((CB_CANVAS_W - width * scale) / 2 + (s.xCoord - left) * scale);
    s.yCoord = Math.round((CB_CANVAS_H - height * scale) / 2 + (s.yCoord - top) * scale);
  });
  _cbEditorRemember(before);
  _cbRenderCanvas();
}
window.addEventListener('blur', () => _cbEditorFinish(true));
const _cbEditorOriginalUnmount = window.unmountClassroomBuilder;
window.unmountClassroomBuilder = function () {
  _cbEditorFinish(true);
  return _cbEditorOriginalUnmount();
};
