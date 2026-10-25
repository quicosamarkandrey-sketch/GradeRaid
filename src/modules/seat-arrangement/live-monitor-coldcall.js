// src/modules/seat-arrangement/live-monitor-coldcall.js — real-ESM twin of
// ../../../modules/seat-arrangement/live-monitor-coldcall.js.
// Phase 7 (Stream D), file 29/30. Original stays untouched.
//
// 4 exports = the 3 plain declarations (_lmClearCycle, _lmLandOnWinner, _lmShowSpotlight — keyword swap only) plus the one
// `window._lmStartColdCall = function` assignment converted to `export const _lmStartColdCall = function` (the window assignment itself is
// replaced by the bridge, same as file 25's _lmToggleRecitationMode). The original's own trailing "Phase 7 explicit window exports" line
// (`window._lmClearCycle = _lmClearCycle;`) is KEPT VERBATIM. The file-wide 'use strict'; is dropped (modules are strict) and the import
// block takes its place. LM_CYCLE_DURATION_MS / LM_CYCLE_TICK_MIN_MS / LM_CYCLE_TICK_MAX_MS / LM_CONFIRM_PAUSE_MS stay module-local
// consts (never on window in the classic file either: top-level `const` is not a window property, and nothing outside references them).
// Everything else, including the body's historical 2-space indent and the stale "live_monitor.js loaded" console.log line, is byte-identical.
//
// REAL IMPORTS: AppStore (../core/state-manager.js), toast / showModal (../../dom.js), _esc / _cssColor (../../utils.js),
// ClassroomService (./classroom-service.js, file 4), RecitationService (./recitation-service.js, file 5). None of them reaches back into this
// file (live_monitor.js calls _lmClearCycle only through the bare window name; live-monitor-render.js only has the inline string
// window._lmStartColdCall()), so there is no ES cycle. Nothing assigns or wraps window.showModal / toast / _esc / _cssColor.
//
// BARE (window / global fallback): tsGetEquippedTitle, tsBuildBadgeHTML (modules/titles, behind typeof guards that are behavior: no title
// badge until those exist); closeModalForce appears only inside the inline onclick string. SHARED STATE (live_monitor.js, file 27):
// READS _lmLayoutId, _lmStrategy, _lmTargetedSeatIds, _lmRecitationMode, _lmSessionStartAt, _lmClassId; READS AND WRITES _lmCycleTimeout and
// _lmCycleInterval (`_lmCycleTimeout = setTimeout(...)`, `_lmCycleInterval = null`). Since file 27 these are window ACCESSORS onto the real
// module-private bindings, so every bare read/write here lands on the one real binding, live, with no edit needed (a setter call, not an
// imported-binding assignment). Do not turn them into imports.
//
// BINDING NOTE: _lmStartColdCall -> _lmClearCycle / _lmLandOnWinner and _lmLandOnWinner -> _lmShowSpotlight now resolve lexically. Wrapper
// audit (tools/audit-patched-exports.js + repo grep): no other file assigns or wraps any of the 4 names.
// ─────────────────────────────────────────────────────────────────────────────
// LIVE MONITOR — Cold Call (random present/late student selector)
//
// Phase 6 (Decompose God Files) extraction from live_monitor.js. Owns the
// full cold-call sequence: button click → cycling flash animation across
// eligible seats (~2.2s, cubic ease-out via a recursive setTimeout chain,
// not setInterval, since each tick's delay differs from the last) → land on
// the actual winner → flash the winner's seat → open the Profile Spotlight
// popup. No behavior change — every function below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT: fully self-contained — every function here
// only calls its own cluster's other functions (_lmStartColdCall/
// _lmClearCycle/_lmLandOnWinner/_lmShowSpotlight), never reaching into
// recitation, scanner, or Web NFC. It does read the shared module state
// declared in live_monitor.js (_lmLayoutId, _lmStrategy, _lmTargetedSeatIds,
// _lmCycleInterval, _lmCycleTimeout), same shared top-level `let` bindings
// every Phase 6 split in this file relies on.
//
// Exports: window._lmStartColdCall()
//   Also declares: LM_CYCLE_DURATION_MS, LM_CYCLE_TICK_MIN_MS,
//   LM_CYCLE_TICK_MAX_MS
//
// DEPENDENCIES: the module state declared in live_monitor.js, ClassroomService,
// AppStore, showModal(), closeModalForce(), _esc(), _cssColor() — all
// globals already available wherever this file loads, same as when this
// code lived inside live_monitor.js.
// ─────────────────────────────────────────────────────────────────────────────

import { AppStore } from '../core/state-manager.js';
import { toast, showModal } from '../../dom.js';
import { _esc, _cssColor } from '../../utils.js';
import { ClassroomService } from './classroom-service.js';
import { RecitationService } from './recitation-service.js';

  // ── Cold Call: random present/late student selector ─────────────────────────
  //
  // Sequence: button click → _lmStartColdCall() → cycling flash animation
  // across eligible seats for ~2.2s → land on the actual winner → flash the
  // winner's seat → open the Profile Spotlight popup via the app's shared
  // showModal(). "Roll Again" inside the popup just re-runs this whole
  // sequence; "Close" calls the app's closeModalForce().

  // Cold Call cycling animation: flashes a random seat repeatedly before
  // landing on the actual winner. Ticks start fast and progressively slow
  // down as the roll nears its end — a cubic ease-out curve, the same
  // "settling down" feel as a wheel spinner or slot machine — instead of a
  // flat, constant-speed flicker the whole way through. Implemented as a
  // recursive setTimeout chain (not setInterval) because each tick's delay
  // is different from the last; setInterval can only fire at one fixed period.
  const LM_CYCLE_DURATION_MS = 2800; // total time from tap to landing on the winner
  const LM_CYCLE_TICK_MIN_MS = 140;   // fastest flash interval, right at the start
  const LM_CYCLE_TICK_MAX_MS = 420;  // slowest flash interval, right before landing

  export const _lmStartColdCall = function () {
    if (!_lmLayoutId) return;
    _lmClearCycle();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // pickRandomStudent() is called ONCE, upfront, and is authoritative —
    // both the cycling-flicker animation below and the eventual winner come
    // from this exact same {pool, winner} result, so there is exactly one
    // random decision per roll, not a second one hiding at reveal time.
    const result = ClassroomService.pickRandomStudent(
      _lmLayoutId, _lmStrategy, Array.from(_lmTargetedSeatIds)
    );
    if (!result.ok) {
      toast('⚠️ ' + result.error, '#ffb95f');
      return;
    }

    const btn = document.getElementById('lm-coldcall-btn');
    if (btn) { btn.disabled = true; btn.textContent = '🎲 Picking…'; }

    if (reduceMotion) { _lmLandOnWinner(result.winner); return; }

    const seatEls = Array.from(document.querySelectorAll('.lm-seat')).filter(
      el => result.pool.some(c => c.seatId === el.dataset.seatId)
    );
    if (seatEls.length === 0) {
      // Pool exists in data but the seat elements aren't on screen for some
      // reason (e.g. layout just changed mid-click) — bail out gracefully.
      if (btn) { btn.disabled = false; btn.textContent = '🎯 Pick Random Student'; }
      return;
    }

    let lastFlashed = null;
    const startedAt = Date.now();

    const scheduleNextFlash = () => {
      if (lastFlashed) lastFlashed.classList.remove('flash-cycle');
      const pick = seatEls[Math.floor(Math.random() * seatEls.length)];
      pick.classList.add('flash-cycle');
      lastFlashed = pick;

      const elapsed  = Date.now() - startedAt;
      const progress = Math.min(elapsed / LM_CYCLE_DURATION_MS, 1);
      // Cubic ease-out: delay stays near TICK_MIN while progress is low,
      // then stretches out toward TICK_MAX as progress approaches 1 — the
      // flashing visibly decelerates instead of cutting off abruptly.
      const eased = 1 - Math.pow(1 - progress, 3);
      const delay = LM_CYCLE_TICK_MIN_MS + eased * (LM_CYCLE_TICK_MAX_MS - LM_CYCLE_TICK_MIN_MS);

      if (elapsed + delay >= LM_CYCLE_DURATION_MS) {
        _lmCycleTimeout = setTimeout(() => {
          _lmClearCycle();
          _lmLandOnWinner(result.winner);
          if (btn) {
            btn.disabled = !_lmLayoutId || (_lmStrategy === 'spatial_block' && _lmTargetedSeatIds.size === 0);
            btn.textContent = '🎯 Pick Random Student';
          }
        }, delay);
      } else {
        _lmCycleInterval = setTimeout(scheduleNextFlash, delay);
      }
    };

    scheduleNextFlash();
  };

  export function _lmClearCycle() {
    if (_lmCycleInterval) { clearTimeout(_lmCycleInterval); _lmCycleInterval = null; }
    if (_lmCycleTimeout)  { clearTimeout(_lmCycleTimeout);   _lmCycleTimeout  = null; }
    document.querySelectorAll('.lm-seat.flash-cycle,.lm-seat.flash-confirm,.lm-seat.flash-winner').forEach(el => el.classList.remove('flash-cycle', 'flash-confirm', 'flash-winner'));
    document.querySelectorAll('.lm-confirm-label').forEach(el => el.remove());
    const button = document.getElementById('lm-coldcall-btn');
    if (button) {
      button.disabled = !_lmLayoutId || (_lmStrategy === 'spatial_block' && !_lmTargetedSeatIds.size);
      button.textContent = '🎯 Pick Random Student';
    }
  }


  export function _lmLandOnWinner(winnerVm) {
    const el = document.querySelector(`.lm-seat[data-seat-id="${winnerVm.seatId}"]`);
    const layoutId = _lmLayoutId;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' });
    el.classList.add('flash-confirm');
    const label = document.createElement('div');
    label.className = 'lm-confirm-label';
    label.textContent = 'YOUR TURN';
    el.appendChild(label);
    _lmCycleTimeout = setTimeout(() => {
      _lmCycleTimeout = null;
      label.remove();
      el.classList.remove('flash-confirm');
      if (!_lmMounted || _lmLayoutId !== layoutId || !el.isConnected) return;
      el.classList.add('flash-winner');
      _lmShowSpotlight(winnerVm);
      const button = document.getElementById('lm-coldcall-btn');
      if (button) { button.disabled = false; button.textContent = '🎯 Pick Random Student'; }
      _lmCycleTimeout = setTimeout(_lmClearCycle, 2000);
    }, reduced ? 0 : 650);
  }

  export function _lmShowSpotlight(winnerVm) {
    const state   = AppStore.getState();
    const student = (state.students || []).find(s => s.id === winnerVm.studentId);
    if (!student) {
      toast('❌ Could not load that student\'s profile.', '#ffb4ab');
      return;
    }


    // Equipped title, rendered with the same badge renderer the kiosk/
    // sidebar/leaderboard use — reuses tsGetEquippedTitle()/tsBuildBadgeHTML()
    // from modules/titles/ rather than re-deriving title styling here.
    const equippedTitle = typeof tsGetEquippedTitle === 'function' ? tsGetEquippedTitle(student.id) : null;
    const titleHtml = (equippedTitle && typeof tsBuildBadgeHTML === 'function')
      ? `<div class="lm-spotlight-title-slot">${tsBuildBadgeHTML(equippedTitle, { small: true, noParticles: true })}</div>`
      : '';

    // Points stats. Overall is the big highlighted headline (visible from
    // across the room); Today and This Session are supporting context.
    const overallPts = (typeof RecitationService.getAllTimeTotalForStudent === 'function')
      ? RecitationService.getAllTimeTotalForStudent(student.id) : 0;
    const todayPts = (typeof RecitationService.getTodayTotalForStudent === 'function')
      ? RecitationService.getTodayTotalForStudent(student.id) : 0;
    const sessionPts = (_lmRecitationMode && _lmSessionStartAt)
      ? (RecitationService.getSessionCounts(_lmClassId, _lmSessionStartAt)[student.id] || 0)
      : null;

    showModal(`
      <div class="lm-spotlight">
        <div class="lm-spotlight-eyebrow">The floor is yours</div>
        <div class="lm-spotlight-avatar">
          ${student.profilePic ? `<img src="${_esc(student.profilePic)}" alt="" onerror="this.remove()">` : ''}
          ${_esc(student.init || (student.name || '?')[0])}
        </div>
        ${titleHtml}
        <div class="lm-spotlight-name">${_esc(student.name || student.displayName || 'Student')}</div>
        <div class="lm-spotlight-tier">${_esc(student.tier || 'Novice')} · Level ${_esc(student.level || 0)}</div>
        <div class="lm-spotlight-headline">
          <div class="lm-spotlight-headline-num">${_esc(sessionPts === null ? overallPts : sessionPts)}</div>
          <div class="lm-spotlight-headline-label">${sessionPts === null ? 'Overall recitation points' : 'Points this session'}</div>
        </div>
        <div class="lm-spotlight-stats">
          <div><div class="lm-spotlight-stat-num">${_esc(todayPts)}</div><div class="lm-spotlight-stat-label">Today</div></div>
          <div><div class="lm-spotlight-stat-num">${_esc(overallPts)}</div><div class="lm-spotlight-stat-label">All time</div></div>
          <div><div class="lm-spotlight-stat-num">${_esc(student.level || 0)}</div><div class="lm-spotlight-stat-label">Level</div></div>
        </div>
        <div class="lm-spotlight-status">${_esc(winnerVm.attendanceStatus || 'Selected student')}</div>
        <div class="lm-spotlight-actions">
          <button class="btn btn-ghost btn-sm" onclick="closeModalForce()">Back to class</button>
          <button class="btn btn-primary btn-sm" onclick="closeModalForce(); window._lmStartColdCall();">Pick another student →</button>
        </div>
      </div>
    `, 'md');
  }

  console.log('[EduQuest] seat-arrangement/live_monitor.js loaded — renderClassroomMonitor/unmountClassroomMonitor registered.');

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._lmClearCycle = _lmClearCycle;
