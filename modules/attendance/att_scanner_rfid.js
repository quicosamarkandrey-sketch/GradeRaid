// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/attendance/att_scanner_rfid.js
//  Owns renderRfidScanner() / unmountRfidScanner() — the Phase 1 replacement
//  for the manual-only renderScanner() in att_scanner.js.
//
//  PHASE 4 — KIOSK REFACTOR
//    This screen ("Device 1") is now a headless, distraction-free full-screen
//    kiosk: no sidebar, no topbar, no admin chrome. It's a 2-column layout —
//    an 80% "Student Spotlight" (huge profile card on scan) and a 20%
//    "Recent Activity Log" (last 10 scans). Everything administrative that
//    used to live on this page (Manual Override, Schedule, Close Session,
//    Assign-Card mode) still works exactly as before — it just moved:
//      - Manual Override → now lives in the LiveClassroomMonitor sidebar
//        (modules/seat-arrangement/live_monitor.js), Device 2's screen,
//        per the Phase 4 spec. Same AttendanceService.overrideAttendance()
//        call underneath, just a different UI host.
//      - Schedule / Close Session / Assign-Card mode → tucked behind the
//        small ⚙️ settings icon in the kiosk's top-right corner, so the
//        main screen stays clean but nothing was deleted.
//
//  INTEGRATION (the only two edits needed outside this file):
//    nav.js, navTo():
//      else if(id==='a-scanner')renderScanner();
//      → else if(id==='a-scanner')renderRfidScanner();
//
//      Add a teardown line next to the existing _adminStoreInterval cleanup
//      at the top of navTo(), same pattern:
//        if(id!=='a-scanner') unmountRfidScanner();
//
//    index.html / load order: this file loads AFTER attendance-service.js,
//    state-manager.js, and db-service.js (same position att_scanner.js
//    occupies today).
//
//  HARDWARE MODEL
//    The RFID/NFC reader is a USB-HID keyboard emulator: it "types" the tag
//    ID into whatever has focus, character by character, then sends Enter.
//    Rather than a document-wide keydown listener (which would hijack
//    keystrokes from every other input on the page, including admin search
//    boxes elsewhere in the app), this screen keeps a single dedicated,
//    visually-hidden <input> focused at all times while mounted, and reads
//    from THAT input specifically. Two finalize triggers, so it works
//    whether or not your specific reader model sends an Enter keystroke:
//      1. Enter keydown on the capture input (the common case).
//      2. A 120ms inactivity timer after the last keystroke (fallback for
//         readers that don't emit a terminator).
//
//  OPTIMISTIC / REALTIME REACTIVITY
//    This module never mutates DB/AppStore itself — every action goes
//    through AttendanceService, which applies the authoritative RPC result
//    to AppStore the instant it resolves (see attendance-service.js header).
//    This module's job is purely:
//      - capture the scan and hand it to AttendanceService.processScan()
//      - subscribe to AppStore so the recent-activity log re-renders the
//        moment that update (or a realtime echo from another device)
//        lands — no polling, no manual refresh button needed.
//    This subscription is Supabase Realtime's job downstream (untouched
//    here) — this module only reacts to AppStore, never talks to Supabase
//    directly.
// ═══════════════════════════════════════════════════════════════════════════════

let _rfidFocusInterval = null;
let _rfidScanBuffer = '';
let _rfidInactivityTimer = null;
let _rfidScannerMounted = false;
let _rfidScanMode = 'attendance';   // 'attendance' | 'assign'
let _rfidAssignTargetStudentId = null;
let _rfidSelectedClassId = 'default-class';
let _rfidClockInterval = null;
let _rfidScheduleTimerInterval = null;

/**
 * renderRfidScanner() → void  [window.renderRfidScanner]
 * Mounts the full-screen attendance kiosk into #a-scanner.
 */
window.renderRfidScanner = function () {
  DB = loadDB(); // legacy bridge — gives us a synchronous snapshot for the initial render
  _rfidScannerMounted = true;
  _rfidSelectedClassId = _rfidSelectedClassId || 'default-class';

  // Headless kiosk: hide the app shell (topbar + sidebar) while this page
  // is mounted. Scoped entirely to this body class — unmountRfidScanner()
  // removes it, so every other page is completely unaffected.
  document.body.classList.add('rfid-kiosk-mode');

  // Phase 4: read from Section Maker's canonical list (shows every section,
  // not just ones with an already-enrolled student) — falls back to the old
  // derive-from-students behavior automatically if no sections exist yet.
  // See modules/admin/sections-service.js.
  const state = (typeof AppStore !== 'undefined') ? AppStore.getState() : {};
  const classIds = window.getActiveClassIds ? window.getActiveClassIds(state) : Array.from(new Set((DB.students || []).map(s => s.classId || 'default-class'))).sort();
  if (!classIds.includes(_rfidSelectedClassId)) _rfidSelectedClassId = classIds[0] || 'default-class';

  document.getElementById('a-scanner').innerHTML = `
    <div class="kiosk-page">
      <input id="rfid-capture-input" autocomplete="off" inputmode="none"
             style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px" />

      <div class="kiosk-clock-corner" id="kiosk-clock-corner"></div>

      <div class="kiosk-topstrip">
        <select id="rfid-class-select" class="kiosk-class-select" onchange="_rfidOnClassChange(this.value)">
          ${classIds.map(c => `<option value="${_esc(c)}" ${c === _rfidSelectedClassId ? 'selected' : ''}>${_esc(_rfidClassOptionLabel(c, state))}</option>`).join('')}
        </select>
        <button class="kiosk-icon-btn" title="Settings — schedule, assign card, close session" onclick="_rfidOpenSettings()">⚙️</button>
        <!-- BUGFIX (report §4): the kiosk intentionally hides the whole app
             shell (topbar + sidebar) so students scanning cards don't see
             admin nav, but nothing was left in its place to get back out —
             the only way out was the browser Back button. This calls the
             same navTo() every other nav link uses, which already tears
             down kiosk mode via unmountRfidScanner() in nav.js. -->
        <button class="kiosk-icon-btn" title="Exit kiosk — back to admin dashboard" onclick="navTo('a-dashboard')">⏻</button>
      </div>

      <div class="kiosk-columns">
        <div class="kiosk-spotlight" id="kiosk-spotlight"></div>

        <div class="kiosk-activity">
          <div class="kiosk-activity-header">Recent Activity</div>
          <div class="kiosk-schedule-timer" id="kiosk-schedule-timer"></div>
          <div class="kiosk-roster-stats" id="kiosk-roster-stats"></div>
          <div class="kiosk-activity-summary" id="kiosk-activity-summary"></div>
          <div class="kiosk-activity-list" id="kiosk-activity-list"></div>
        </div>
      </div>
    </div>`;

  _rfidRenderSpotlight('idle');
  _rfidRenderActivity();
  _rfidStartCapture();
  _rfidStartClock();
  _rfidStartScheduleTimer();

  AppStore.subscribe('rfid-scanner', function (state, event) {
    if (!_rfidScannerMounted) return;
    // Cheap targeted re-render — only the activity log (and dropdown label
    // text), never the whole page (which would steal focus from the capture
    // input mid-scan).
    if (!event || event.type === 'state:updated' || event.type.indexOf('attendance:') === 0 || event.type === 'state:remote-sync') {
      _rfidRenderActivity();
      _rfidRefreshClassSelectCounts();
    }
  });
};

/**
 * _rfidClassOptionLabel(classId, state) → string  (Investigation Report §4)
 * "Section A (12/24)" — scanned-today / enrolled — instead of just the bare
 * section name, so the dropdown itself answers "how's this section doing"
 * without opening anything else.
 */
function _rfidClassOptionLabel(classId, state) {
  const label = window.getClassLabel ? window.getClassLabel(classId, state) : classId;
  const enrolled = (state.students || []).filter(s => (s.classId || 'default-class') === classId).length;
  const today = _rfidTodayISO();
  const scannedToday = (state.attendanceLogs || []).filter(l => l.classId === classId && l.logDate === today).length;
  return `${label} (${scannedToday}/${enrolled})`;
}

/**
 * _rfidRefreshClassSelectCounts() → void
 * Updates each <option>'s label text in place (never rebuilds the <select>
 * itself) so the enrolled/scanned-today counts stay live as scans come in
 * — called from the AppStore subscription alongside _rfidRenderActivity().
 */
function _rfidRefreshClassSelectCounts() {
  const select = document.getElementById('rfid-class-select');
  if (!select) return;
  const state = AppStore.getState();
  Array.from(select.options).forEach(opt => {
    opt.textContent = _rfidClassOptionLabel(opt.value, state);
  });
}

/**
 * unmountRfidScanner() → void  [window.unmountRfidScanner]
 * Call when navigating away from #a-scanner — stops the focus-stealing
 * interval, unsubscribes from AppStore, and restores the app shell.
 * See nav.js integration note above.
 */
window.unmountRfidScanner = function () {
  _rfidScannerMounted = false;
  if (_rfidFocusInterval) { clearInterval(_rfidFocusInterval); _rfidFocusInterval = null; }
  if (_rfidInactivityTimer) { clearTimeout(_rfidInactivityTimer); _rfidInactivityTimer = null; }
  if (_rfidClockInterval) { clearInterval(_rfidClockInterval); _rfidClockInterval = null; }
  if (_rfidScheduleTimerInterval) { clearInterval(_rfidScheduleTimerInterval); _rfidScheduleTimerInterval = null; }
  clearTimeout(window._rfidSpotlightResetTimer);
  document.body.classList.remove('rfid-kiosk-mode');
  AppStore.unsubscribe('rfid-scanner');
};

// ── Capture plumbing ────────────────────────────────────────────────────────

// ── Live clock (Task 4 — gives the otherwise-empty top-left corner a job,
//    and makes the kiosk feel "alive" during idle stretches between scans) ──

function _rfidTickClock() {
  const el = document.getElementById('kiosk-clock-corner');
  if (!el) return;
  const now = new Date();
  const time = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
  el.innerHTML = `<div class="kiosk-clock-time">${_esc(time)}</div><div class="kiosk-clock-date">${_esc(date)}</div>`;
}

function _rfidStartClock() {
  if (_rfidClockInterval) clearInterval(_rfidClockInterval);
  _rfidTickClock();
  _rfidClockInterval = setInterval(_rfidTickClock, 1000 * 15);
}

// ── Schedule countdown (one chip, not three) ────────────────────────────────
// A teacher only ever cares about whichever milestone is coming up next, so
// instead of showing "opens/late/closes" as three separate timers this picks
// the single next one and switches automatically as the day progresses:
//   before openTime   → "Opens in"
//   openTime→lateCutoff → "Late in"     (counting down to when scans start
//                                        being marked Late)
//   lateCutoff→closeTime → "Closes in"  (counting down to auto-close, which
//                                        marks remaining students Absent)
//   after closeTime   → "Session closed"
function _rfidScheduleFor(classId) {
  const sched = AppStore.getSlice(s => (s.attendanceSchedules || []).find(x => x.classId === classId));
  return sched || { openTime: '07:00', startTime: '07:30', lateCutoff: '07:45', closeTime: '08:30' };
}

function _rfidTimeStrToDate(hhmm, base) {
  const parts = (hhmm || '00:00').split(':').map(Number);
  const d = new Date(base);
  d.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
  return d;
}

function _rfidNextScheduleMilestone(classId) {
  const sched = _rfidScheduleFor(classId);
  const now = new Date();
  const open = _rfidTimeStrToDate(sched.openTime, now);
  const late = _rfidTimeStrToDate(sched.lateCutoff, now);
  const close = _rfidTimeStrToDate(sched.closeTime, now);

  if (now < open) return { label: 'Opens in', target: open, tone: 'open' };
  if (now < late) return { label: 'Late in', target: late, tone: 'late' };
  if (now < close) return { label: 'Closes in', target: close, tone: 'close' };
  return { label: 'Session closed', target: null, tone: 'closed' };
}

function _rfidFormatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function _rfidTickScheduleTimer() {
  const el = document.getElementById('kiosk-schedule-timer');
  if (!el) return;
  const info = _rfidNextScheduleMilestone(_rfidSelectedClassId);
  if (!info.target) {
    el.innerHTML = `<div class="kiosk-timer-chip kiosk-timer-closed"><span class="kiosk-timer-label">🔒 Session closed</span></div>`;
    return;
  }
  const remaining = _rfidFormatCountdown(info.target - new Date());
  const icons = { open: '🚪', late: '⏰', close: '🔒' };
  el.innerHTML = `
    <div class="kiosk-timer-chip kiosk-timer-${info.tone}">
      <span class="kiosk-timer-icon">${icons[info.tone] || '⏱'}</span>
      <span class="kiosk-timer-label">${_esc(info.label)}</span>
      <span class="kiosk-timer-value">${_esc(remaining)}</span>
    </div>`;
}

function _rfidStartScheduleTimer() {
  if (_rfidScheduleTimerInterval) clearInterval(_rfidScheduleTimerInterval);
  _rfidTickScheduleTimer();
  _rfidScheduleTimerInterval = setInterval(_rfidTickScheduleTimer, 1000);
}

function _rfidStartCapture() {
  const input = document.getElementById('rfid-capture-input');
  if (!input) return;

  input.value = '';
  _rfidScanBuffer = '';
  input.focus();

  // Defensive refocus: clicking a button on this screen, or a modal opening
  // elsewhere (e.g. the ⚙️ Settings modal), can steal focus from the
  // capture input. Re-grab it continuously while mounted, but never while
  // the user is deliberately typing into a real text field (schedule
  // times, the assign-card picker, etc.) or while a select/dropdown is open.
  if (_rfidFocusInterval) clearInterval(_rfidFocusInterval);
  _rfidFocusInterval = setInterval(function () {
    if (!_rfidScannerMounted) return;
    const active = document.activeElement;
    const isRealInput = active && active !== input &&
      (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA');
    if (!isRealInput && document.getElementById('rfid-capture-input')) {
      document.getElementById('rfid-capture-input').focus();
    }
  }, 600);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      _rfidFinalizeScan(input.value);
      return;
    }
    // Reset the inactivity finalize-timer on every keystroke.
    if (_rfidInactivityTimer) clearTimeout(_rfidInactivityTimer);
    _rfidInactivityTimer = setTimeout(function () {
      if (input.value) _rfidFinalizeScan(input.value);
    }, 120);
  });
}

function _rfidFinalizeScan(rawValue) {
  const input = document.getElementById('rfid-capture-input');
  const tagId = String(rawValue || '').trim();
  if (input) input.value = '';
  if (_rfidInactivityTimer) { clearTimeout(_rfidInactivityTimer); _rfidInactivityTimer = null; }
  if (!tagId) return;

  if (_rfidScanMode === 'assign') {
    _rfidHandleAssignScan(tagId);
  } else {
    _rfidHandleAttendanceScan(tagId);
  }
}

async function _rfidHandleAttendanceScan(tagId) {
  _rfidRenderSpotlight('loading', { text: 'Checking card…' });
  const result = await AttendanceService.processScan(tagId, _rfidSelectedClassId);

  if (!result.ok) {
    // BUGFIX (Investigation Report §4): "the attendance window closed for
    // the day" isn't a mistake the way "unknown card" is — it's an expected
    // end-of-period state. It used to render through the same 🚫 error
    // look as everything else; now it gets its own calmer 'closed' mode.
    if (result.error === 'closed') {
      _rfidRenderSpotlight('closed', { message: result.message });
      return;
    }
    const messages = {
      unknown_card:  'Unknown card — not registered to any student.',
      no_schedule:   'No schedule configured for this class.',
      not_open:      'Attendance has not opened yet.',
      wrong_section: result.message || 'This student is enrolled in a different section and cannot be scanned here.',
    };
    _rfidRenderSpotlight('error', { message: messages[result.error] || result.message || 'Scan failed.' });
    return;
  }

  const student = AppStore.getStudent(result.studentId);
  _rfidRenderSpotlight('profile', {
    student, status: result.status,
    alreadyRecorded: result.alreadyRecorded, fallbackName: result.studentName,
  });
  // _rfidRenderActivity() is also triggered by the AppStore subscription
  // once AttendanceService applies the result — no need to call it here
  // directly, but doing so keeps the log snappy on this device specifically
  // rather than waiting on the realtime round-trip.
  _rfidRenderActivity();
}

async function _rfidHandleAssignScan(tagId) {
  if (!_rfidAssignTargetStudentId) {
    _rfidRenderSpotlight('message', { icon: '⚠️', text: 'Pick a student in Settings before scanning.', color: '#ffd166' });
    return;
  }
  _rfidRenderSpotlight('loading', { text: 'Assigning card…' });
  const result = await AttendanceService.assignCard(_rfidAssignTargetStudentId, tagId);
  if (!result.ok) {
    _rfidRenderSpotlight('message', { icon: '❌', text: result.error || 'Could not assign card.', color: '#ffb4ab' });
    return;
  }
  const student = AppStore.getStudent(_rfidAssignTargetStudentId);
  _rfidRenderSpotlight('message', { icon: '🪪', text: `Card assigned to ${student ? student.name : _rfidAssignTargetStudentId}.`, color: '#4edea3' });
}

// ── Student Spotlight (Task 1, left column — 80%) ───────────────────────────

function _rfidSpotlightIdleHtml() {
  if (_rfidScanMode === 'assign') {
    const target = _rfidAssignTargetStudentId ? AppStore.getStudent(_rfidAssignTargetStudentId) : null;
    return `
      <div class="kiosk-spotlight-idle">
        <div class="kiosk-spotlight-idle-icon">🪪</div>
        <div class="kiosk-spotlight-idle-text">Ready to assign a card</div>
        <div class="kiosk-spotlight-idle-sub">${target ? `Tap a card for ${_esc(target.name)}` : 'Pick a student in Settings first'}</div>
      </div>`;
  }
  return `
    <div class="kiosk-spotlight-idle">
      <div class="kiosk-spotlight-idle-icon">📶</div>
      <div class="kiosk-spotlight-idle-text">Waiting for a card…</div>
      <div class="kiosk-spotlight-idle-sub">Class: ${_esc(_rfidSelectedClassId)}</div>
    </div>`;
}

function _rfidWelcomeMessage(name, status, streak, alreadyRecorded) {
  const firstName = _esc(String(name || 'Student').trim().split(/\s+/)[0]);
  if (alreadyRecorded) return `You're already logged in for today, ${firstName}. See you in class!`;
  if (status === 'Late') return `You're logged in, ${firstName} — try to beat the bell tomorrow!`;
  if (streak && streak.current >= 3) return `Welcome back, ${firstName}! That's a ${streak.current}-day streak — keep up the great work!`;
  if (status === 'Early') return `Welcome back, ${firstName}! Great to see you here early!`;
  return `Welcome back, ${firstName}! Keep up the great work!`;
}

// Level/XP progress — mirrors the exact formula topbar.js's updateTopbar()
// uses for the sidebar XP bar (xpNext=(level+1)*1000), so the number shown
// here always agrees with what the student sees in their own sidebar.
function _rfidLevelProgress(student) {
  if (!student) return null;
  const lvl = student.level || 0;
  const xp = student.xp || 0;
  const xpNext = (lvl + 1) * 1000;
  const pct = Math.min(100, Math.round((xp / xpNext) * 100));
  return { lvl, xp, xpNext, pct };
}

// Class rank by XP — same sort AttendanceService/hall-of-fame.js already
// uses for the leaderboard podium, scoped to this student's own section.
// Returns null when there's no meaningful ranking to show (solo section).
function _rfidClassRank(student) {
  if (!student) return null;
  const classmates = AppStore.getSlice(s => (s.students || []).filter(
    x => (x.classId || 'default-class') === (student.classId || 'default-class')
  )) || [];
  if (classmates.length < 2) return null;
  const sorted = classmates.slice().sort((a, b) => (b.xp || 0) - (a.xp || 0));
  const idx = sorted.findIndex(s => s.id === student.id);
  return idx === -1 ? null : { rank: idx + 1, of: sorted.length };
}

function _rfidProfileCardHtml(student, status, alreadyRecorded, fallbackName) {
  const icons  = { 'Early': '🌅', 'On Time': '✅', 'Late': '⏰' };
  const colors = { 'Early': '#7fd8ff', 'On Time': '#4edea3', 'Late': '#ffd166' };
  const badgeColor = colors[status] || '#4edea3';
  const name = student ? (student.name || student.displayName) : fallbackName;
  const initials = (student && student.init) || String(name || '?').trim().slice(0, 2).toUpperCase();
  const avatarColor = (student && student.color) || '#8b5cf6';
  const pct = student ? Math.round(Number(student.attendance) || 0) : null;
  const pctColor = pct === null ? 'var(--text-muted)' : pct >= 90 ? '#4edea3' : pct >= 75 ? '#ffd166' : '#ffb4ab';

  // Attendance streak (Investigation Report §4) — shares the exact same
  // normalization + math as the student's own Progress page via the utils.js
  // helpers, rather than a second copy of this logic living here.
  const streak = student ? computeAttendanceStreak(getStudentAttendanceRecords(student.id)) : null;

  // Too-many-absences warning (Investigation Report §4): no threshold existed
  // anywhere in the app before. Reuses the same 75% line the progress ring
  // color already draws, so a teacher sees one consistent cutoff everywhere
  // instead of two different thresholds meaning slightly different things.
  const showAbsenceWarning = pct !== null && pct < 75;

  // Circular progress ring drawn with a conic-gradient — no SVG needed, and
  // it scales/recolors purely through CSS custom properties set inline.
  const ringDeg = pct !== null ? Math.round((pct / 100) * 360) : 0;

  const lvlInfo = _rfidLevelProgress(student);
  const rankInfo = _rfidClassRank(student);
  // Equipped title — reuses the same tsGetEquippedTitle()/tsBuildBadgeHTML()
  // pair the sidebar and dashboard use (modules/titles/), so the kiosk shows
  // the exact same badge a student sees everywhere else. Guarded with
  // typeof since modules/titles/*.js loads after this file (see index.html).
  const equippedTitle = student && typeof tsGetEquippedTitle === 'function' ? tsGetEquippedTitle(student.id) : null;
  const hasStatsPanel = (student && student.coins != null) || rankInfo;

  return `
    <div class="kiosk-dashboard">
      <div class="kiosk-welcome-banner">
        <div class="kiosk-welcome-icon">${!alreadyRecorded ? '✅' : '👋'}</div>
        <div class="kiosk-welcome-copy">
          <div class="kiosk-welcome-kicker">${!alreadyRecorded ? 'Scan Successful' : 'Already Checked In'}</div>
          <div class="kiosk-welcome-text">${_rfidWelcomeMessage(name, status, streak, alreadyRecorded)}</div>
        </div>
      </div>

      <div class="kiosk-dashboard-grid${pct === null ? ' kiosk-dashboard-grid-single' : ''}">
        <div class="kiosk-panel kiosk-identity-panel">
          ${student && student.profilePic
            ? `<img class="kiosk-profile-avatar" src="${_esc(student.profilePic)}" alt="" />`
            : `<div class="kiosk-profile-avatar" style="background:${avatarColor}22;color:${avatarColor};border-color:${avatarColor}44">${_esc(initials)}</div>`
          }
          <div class="kiosk-identity-info">
            <div class="kiosk-profile-name">${_esc(name || 'Student')}</div>
            <div class="kiosk-name-accent"></div>
            ${student ? `<div class="kiosk-profile-section">Section: ${_esc(student.classId)}</div>` : ''}
            <div>
              <div class="kiosk-status-badge" style="background:${badgeColor}22;color:${badgeColor};border:2px solid ${badgeColor}55">
                ${icons[status] || '✅'} ${_esc(status)}${alreadyRecorded ? ' · already logged today' : ''}
              </div>
              ${streak && streak.current > 0 ? `<div class="kiosk-streak-pill">🔥 ${streak.current}-day streak</div>` : ''}
            </div>
            ${lvlInfo ? `
            <div class="kiosk-level-block">
              <div class="kiosk-level-label"><span>Level ${lvlInfo.lvl}</span><span>${lvlInfo.xp.toLocaleString()} / ${lvlInfo.xpNext.toLocaleString()} XP</span></div>
              <div class="kiosk-level-track"><div class="kiosk-level-fill" style="width:${lvlInfo.pct}%"></div></div>
              ${equippedTitle ? `<div class="kiosk-equipped-title"><div class="kiosk-equipped-label">Equipped Title</div>${tsBuildBadgeHTML(equippedTitle, { noParticles: true })}</div>` : ''}
            </div>` : ''}
          </div>
        </div>

        ${pct !== null ? `
        <div class="kiosk-panel kiosk-attendance-panel" style="--ring-color:${pctColor}">
          <div class="kiosk-ring" style="--ring-deg:${ringDeg}deg;--ring-color:${pctColor}">
            <div class="kiosk-ring-inner">
              <div class="kiosk-ring-pct">${pct}<span>%</span></div>
              <div class="kiosk-ring-label">Cumulative<br>Attendance</div>
            </div>
          </div>
          ${showAbsenceWarning ? `<div class="kiosk-absence-warning">⚠️ Below 75% — worth checking in with this student.</div>` : ''}
        </div>` : ''}

        ${pct !== null && hasStatsPanel ? `
        <div class="kiosk-panel kiosk-stats-panel">
          ${student && student.coins != null ? `
          <div class="kiosk-stat-chip kiosk-stat-chip-coins">
            <div class="kiosk-stat-label">Coins</div>
            <div class="kiosk-stat-value">🪙 ${Number(student.coins || 0).toLocaleString()}</div>
          </div>` : ''}
          ${rankInfo ? `
          <div class="kiosk-stat-chip kiosk-stat-chip-rank">
            <div class="kiosk-stat-label">Class Rank</div>
            <div class="kiosk-stat-value">#${rankInfo.rank} <span>of ${rankInfo.of}</span></div>
          </div>` : ''}
        </div>` : ''}
      </div>
    </div>`;
}

/**
 * _rfidRenderSpotlight(mode, data) — the single entry point for everything
 * shown in the left "Student Spotlight" column.
 *   mode: 'idle' | 'loading' | 'message' | 'error' | 'profile'
 * Auto-returns to 'idle' after a beat (except 'idle'/'loading' themselves)
 * so the kiosk is always ready for the next student in line.
 */
function _rfidRenderSpotlight(mode, data) {
  const el = document.getElementById('kiosk-spotlight');
  if (!el) return;
  data = data || {};
  clearTimeout(window._rfidSpotlightResetTimer);

  if (mode === 'idle') {
    el.innerHTML = _rfidSpotlightIdleHtml();
    return;
  }
  if (mode === 'loading') {
    el.innerHTML = `
      <div class="kiosk-spotlight-idle">
        <div class="kiosk-spotlight-idle-icon">⏳</div>
        <div class="kiosk-spotlight-idle-text">${_esc(data.text || 'Checking card…')}</div>
      </div>`;
    return;
  }
  if (mode === 'message') {
    el.innerHTML = `
      <div class="kiosk-spotlight-idle">
        <div class="kiosk-spotlight-idle-icon">${_esc(data.icon || 'ℹ️')}</div>
        <div class="kiosk-spotlight-idle-text" style="color:${data.color || 'inherit'}">${_esc(data.text || '')}</div>
      </div>`;
    window._rfidSpotlightResetTimer = setTimeout(function () { _rfidRenderSpotlight('idle'); }, 2600);
    return;
  }
  if (mode === 'error') {
    el.innerHTML = `
      <div class="kiosk-spotlight-error">
        <div class="kiosk-spotlight-error-icon">🚫</div>
        <div class="kiosk-spotlight-error-text">${_esc(data.message || 'Scan failed.')}</div>
      </div>`;
    window._rfidSpotlightResetTimer = setTimeout(function () { _rfidRenderSpotlight('idle'); }, 3200);
    return;
  }
  if (mode === 'closed') {
    // Distinct from 'error' (Investigation Report §4) — a closed window is
    // an expected end-of-period state, not a scan gone wrong, so it gets a
    // calmer icon/color and a direct pointer to where to still record it.
    el.innerHTML = `
      <div class="kiosk-spotlight-closed">
        <div class="kiosk-spotlight-closed-icon">🔒</div>
        <div class="kiosk-spotlight-closed-text">Attendance Window Closed</div>
        <div class="kiosk-spotlight-closed-sub">${_esc(data.message || 'Use the Manual Override on the Live Classroom Monitor instead.')}</div>
      </div>`;
    window._rfidSpotlightResetTimer = setTimeout(function () { _rfidRenderSpotlight('idle'); }, 3200);
    return;
  }
  if (mode === 'profile') {
    el.innerHTML = _rfidProfileCardHtml(data.student, data.status, data.alreadyRecorded, data.fallbackName);
    window._rfidSpotlightResetTimer = setTimeout(function () { _rfidRenderSpotlight('idle'); }, 5000);
    return;
  }
}

// ── Recent Activity Log (Task 1, right column — 20%) ────────────────────────

// BUGFIX: this used to be new Date().toISOString().slice(0,10) — the UTC
// date, not the Manila date, same class of bug already fixed elsewhere for
// the 8am-instead-of-midnight rollover (FIXES_APPLIED.md §2). Now shares
// utils.js's isoDate() so "today" means the same thing everywhere.
function _rfidTodayISO() {
  return isoDate();
}

function _rfidRenderActivity() {
  const statsEl = document.getElementById('kiosk-roster-stats');
  const summaryEl = document.getElementById('kiosk-activity-summary');
  const listEl = document.getElementById('kiosk-activity-list');
  if (!summaryEl || !listEl) return;

  const today = _rfidTodayISO();
  const students = AppStore.getSlice(s => s.students) || [];
  const todaysLogs = AppStore.getSlice(s => (s.attendanceLogs || []).filter(
    l => l.classId === _rfidSelectedClassId && l.logDate === today
  ));

  const by = { 'Early': 0, 'On Time': 0, 'Late': 0, 'Absent': 0, 'Excused': 0 };
  todaysLogs.forEach(l => { if (by[l.status] !== undefined) by[l.status]++; });
  const colors = { 'Early': '#7fd8ff', 'On Time': '#4edea3', 'Late': '#ffd166', 'Absent': '#ffb4ab', 'Excused': '#c4b5fd' };

  // Roster snapshot — the four numbers a teacher glances at first when the
  // kiosk is idle: how many are enrolled, how many are in (on time or
  // early), how many came in late, and how many the kiosk hasn't seen yet
  // today. "Not Checked In" mirrors the "already logged in" phrasing the
  // spotlight card already uses, instead of the more clinical "not yet
  // scanned".
  if (statsEl) {
    const enrolledCount = students.filter(s => (s.classId || 'default-class') === _rfidSelectedClassId).length;
    const presentCount = by['Early'] + by['On Time'];
    const lateCount = by['Late'];
    const loggedCount = todaysLogs.length;
    const notCheckedInCount = Math.max(0, enrolledCount - loggedCount);

    statsEl.innerHTML = `
      <div class="kiosk-roster-stat">
        <div class="kiosk-roster-stat-value">${enrolledCount}</div>
        <div class="kiosk-roster-stat-label">Total</div>
      </div>
      <div class="kiosk-roster-stat kiosk-roster-stat-present">
        <div class="kiosk-roster-stat-value">${presentCount}</div>
        <div class="kiosk-roster-stat-label">Present</div>
      </div>
      <div class="kiosk-roster-stat kiosk-roster-stat-late">
        <div class="kiosk-roster-stat-value">${lateCount}</div>
        <div class="kiosk-roster-stat-label">Late</div>
      </div>
      <div class="kiosk-roster-stat kiosk-roster-stat-pending">
        <div class="kiosk-roster-stat-value">${notCheckedInCount}</div>
        <div class="kiosk-roster-stat-label">Not Checked In</div>
      </div>`;
  }

  // Compact one-line summary — the full stat grid the old layout had would
  // crowd the spec'd 80/20 split, so this keeps the same information
  // available at a glance without competing with the activity list.
  summaryEl.innerHTML = ['Early', 'On Time', 'Late', 'Absent', 'Excused']
    .filter(k => by[k] > 0)
    .map(k => `<span style="color:${colors[k]};font-weight:800">${by[k]}</span> ${_esc(k)}`)
    .join(' <span style="opacity:.35">·</span> ') || 'No scans yet today';

  const last10 = todaysLogs.slice()
    .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))
    .slice(0, 10);

  listEl.innerHTML = last10.length ? last10.map(l => {
    const student = students.find(s => s.id === l.studentId);
    const name = student ? (student.name || student.displayName) : l.studentId;
    const initials = (student && student.init) || String(name || '?').trim().slice(0, 2).toUpperCase();
    const avatarColor = (student && student.color) || '#8b5cf6';
    const color = colors[l.status] || 'var(--text-muted)';
    return `
      <div class="kiosk-activity-item">
        ${student && student.profilePic
          ? `<img class="kiosk-activity-avatar" src="${_esc(student.profilePic)}" alt="" />`
          : `<div class="kiosk-activity-avatar" style="background:${avatarColor}22;color:${avatarColor}">${_esc(initials)}</div>`
        }
        <div class="kiosk-activity-main">
          <div class="kiosk-activity-name">${_esc(name)}</div>
          <div class="kiosk-activity-meta" style="color:${color}">${_esc(l.status)}${l.entryMethod === 'Manual' ? ' · manual' : ''}</div>
        </div>
        <div class="kiosk-activity-time">${_esc(new Date(l.scannedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }))}</div>
      </div>`;
  }).join('') : `<div class="kiosk-activity-empty">No scans yet today</div>`;
}

// ── Mode / class switching ──────────────────────────────────────────────────

window._rfidSetMode = function (mode) {
  _rfidScanMode = mode;
  _rfidAssignTargetStudentId = null;
  window.renderRfidScanner();
  // Settings modal stays open across mode switches so the teacher can flip
  // between Attendance/Assign and immediately see the updated picker.
  if (document.getElementById('rfid-settings-panel')) window._rfidOpenSettings();
};
window._rfidOpenAssignPicker = function () {
  DB = loadDB();
  _rfidAssignTargetStudentId = (DB.students && DB.students[0]) ? DB.students[0].id : null;
  _rfidSetMode('assign');
};
window._rfidOnClassChange = function (classId) {
  _rfidSelectedClassId = classId;
  window.renderRfidScanner();
};

// ── ⚙️ Settings (Task 1: everything administrative, tucked out of the way) ──
// Assign-Card mode, Schedule, and Close Session all still work exactly as
// they did before the kiosk refactor — they're just one tap away instead of
// permanently on-screen, keeping the main kiosk view distraction-free.
// (Manual Override moved out entirely — see the file header.)

window._rfidOpenSettings = function () {
  DB = loadDB();
  showModal(`
    <h3 style="margin-bottom:4px">⚙️ Kiosk Settings</h3>
    <div id="rfid-settings-panel" style="color:var(--text-muted);font-size:12px;margin-bottom:18px">Class: ${_esc(window.getClassLabel ? window.getClassLabel(_rfidSelectedClassId, AppStore.getState()) : _rfidSelectedClassId)}</div>

    <div style="margin-bottom:20px">
      <label class="form-label">Scan Mode</label>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn ${_rfidScanMode === 'attendance' ? 'btn-primary' : ''}" onclick="_rfidSetMode('attendance')">📡 Attendance Mode</button>
        <button class="btn ${_rfidScanMode === 'assign' ? 'btn-primary' : ''}" onclick="_rfidOpenAssignPicker()">🪪 Assign Card</button>
      </div>
      ${_rfidScanMode === 'assign' ? `
      <div style="margin-top:12px;background:rgba(255,255,255,.03);border-radius:10px;padding:12px;border:1px solid var(--border)">
        <div style="font-size:11px;color:var(--text-muted);font-weight:700;margin-bottom:8px;letter-spacing:.06em">ASSIGNING NEXT SCANNED CARD TO</div>
        <select id="rfid-assign-student" style="width:100%" onchange="_rfidAssignTargetStudentId=this.value">
          ${(DB.students || []).map(s => `<option value="${s.id}" ${s.id === _rfidAssignTargetStudentId ? 'selected' : ''}>${_esc(s.name)}</option>`).join('')}
        </select>
      </div>` : ''}
    </div>

    <div style="margin-bottom:20px">
      <label class="form-label">⏰ Schedule — ${_esc(window.getClassLabel ? window.getClassLabel(_rfidSelectedClassId, AppStore.getState()) : _rfidSelectedClassId)}</label>
      <div style="margin-top:8px">${_rfidRenderScheduleForm()}</div>
      <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">
        Manage sections, grades, and advisers in
        <a style="color:var(--primary);font-weight:700;cursor:pointer;text-decoration:none" onclick="closeModalForce();navTo('a-sections')">Section Maker →</a>
      </div>
    </div>

    <div style="border-top:1px solid var(--border);padding-top:16px;display:flex;justify-content:space-between;align-items:center">
      <button class="btn btn-danger" onclick="_rfidCloseSession()">🔒 Close Session</button>
      <button class="btn" onclick="closeModalForce()">Done</button>
    </div>
  `, 'md');
};

function _rfidRenderScheduleForm() {
  const sched = AppStore.getSlice(s => (s.attendanceSchedules || []).find(x => x.classId === _rfidSelectedClassId));
  const v = sched || { openTime: '07:00', startTime: '07:30', lateCutoff: '07:45', closeTime: '08:30' };
  return `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;align-items:end">
      <div><label class="form-label">Opens</label><input type="time" id="rfid-sched-open" value="${_esc(v.openTime)}"></div>
      <div><label class="form-label">Start (On Time from)</label><input type="time" id="rfid-sched-start" value="${_esc(v.startTime)}"></div>
      <div><label class="form-label">Late cutoff</label><input type="time" id="rfid-sched-late" value="${_esc(v.lateCutoff)}"></div>
      <div><label class="form-label">Closes</label><input type="time" id="rfid-sched-close" value="${_esc(v.closeTime)}"></div>
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="_rfidSaveSchedule()">Save Schedule</button>`;
}

window._rfidSaveSchedule = async function () {
  const times = {
    openTime: document.getElementById('rfid-sched-open').value,
    startTime: document.getElementById('rfid-sched-start').value,
    lateCutoff: document.getElementById('rfid-sched-late').value,
    closeTime: document.getElementById('rfid-sched-close').value,
  };
  const result = await AttendanceService.upsertSchedule(_rfidSelectedClassId, times);
  if (!result.ok) { toast(result.error || 'Could not save schedule.', '#ffb4ab'); return; }
  toast('⏰ Schedule saved', '#4edea3');
};

window._rfidCloseSession = async function () {
  if (!confirm(`Close today's attendance for "${_rfidSelectedClassId}"? Every student with no scan will be marked Absent.`)) return;
  const result = await AttendanceService.closeAttendanceSession(_rfidSelectedClassId);
  if (!result.ok) { toast(result.error || 'Could not close session.', '#ffb4ab'); return; }
  closeModalForce();
  toast(`🔒 Session closed — ${result.absencesRecorded} marked Absent`, '#4edea3');
};

console.log('[EduQuest] attendance/att_scanner_rfid.js loaded — renderRfidScanner, unmountRfidScanner registered (Phase 4 kiosk).');
