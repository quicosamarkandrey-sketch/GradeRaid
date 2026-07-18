// ══════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/command-center.js
//  Teacher Command Center (a-dashboard) — full redesign per
//  "Teacher Command Center" brief (replaces the previous analytics-heavy
//  Command Center redesign: hero health snapshot / attention queue / live
//  pulse / trends preview / shortcuts are all removed).
//
//  Sections (in order):
//    1. Hero            — greeting, live clock, one motivational line
//    2. Today's Schedule — per-section attendance-window timeline
//    3. Quick Actions    — fixed 6-shortcut command bar
//    4. Recitation Progress — students called vs. roster, per section
//
//  ROLE SCOPING: a teacher (currentRole==='teacher') only sees sections they
//  advise (SectionService.listSections() filtered by adviserId). An admin
//  sees every non-archived section school-wide, same "every section, every
//  teacher" scope the previous dashboard used.
//
//  DATA GAPS (flagged per team convention — see the file this replaces —
//  rather than faked):
//    - No lesson/topic "discussion coverage" table exists anywhere in the
//      schema. Rather than invent a number with nothing behind it, the
//      ongoing card's coverage bar reuses the SAME "students called today
//      ÷ roster size" figure that drives the Recitation Progress panel
//      below — real data, just relabeled "Recitation coverage" instead of
//      a fabricated lesson-coverage metric.
//    - "Avg. Points" in the Recitation Progress panel is recitation_log's
//      `pts` field (RecitationService), averaged per student called today —
//      the app has no separate 1–10 rubric score, so this is the actual
//      number the app tracks, not a re-derived proxy for something else.
//    - Attendance "Present" bucket below folds together 'Present', 'Early',
//      'On Time', and 'Excused' — the brief only asks for three buckets
//      (Present/Late/Absent). Only 'Late' and 'Absent' are broken out.
// ══════════════════════════════════════════════════════════════════════════

// ── Time helpers — all comparisons happen in Asia/Manila local time (same
//    timezone convention as isoDate() in utils.js), never the browser's own
//    timezone, since attendance_schedules times are entered by PH-based
//    staff and mean nothing without a fixed reference zone. ──
function _ccNowHMS() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour12: false }); // "HH:MM:SS"
}
function _ccHmsToSec(hms) {
  if (!hms) return null;
  const parts = String(hms).split(':').map(n => parseInt(n, 10));
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}
function _ccNowSec() { return _ccHmsToSec(_ccNowHMS()); }
function _ccFmtClockLabel(hms) {
  // 'HH:MM:SS' -> '8:05 AM'
  const [h, m] = String(hms).split(':').map(n => parseInt(n, 10));
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = (h % 12) || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}
function _ccFmtDuration(totalSec) {
  totalSec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// Manila calendar date, 'YYYY-MM-DD' — matches isoDate() in utils.js.
function _ccTodayISO() {
  return (typeof isoDate === 'function') ? isoDate() : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
function _ccIsToday(iso8601) {
  if (!iso8601) return false;
  const d = new Date(iso8601).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return d === _ccTodayISO();
}

// ── Motivational line — one per day, no reroll/mode controls (per sign-off).
//    Static local pool, not a service call — there is no motivational-quote
//    table in the schema, so this stays a plain client-side array rather
//    than pretending to be backend content. ──
const _CC_QUOTES = [
  'Consistency compounds. A calm classroom is built one well-run period at a time.',
  'Clear expectations remove more friction than any amount of enthusiasm.',
  'The best lesson plan is the one you can adjust without losing the room.',
  'Attendance is data. Attention is the thing you are actually measuring.',
  'Small, repeated feedback moves a section further than one big correction.',
  'A quiet transition between activities saves more time than a faster lecture.',
  'Model the pace you want the room to keep.',
];
function _ccDayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}
function _ccTodaysQuote() {
  return _CC_QUOTES[_ccDayOfYear(new Date()) % _CC_QUOTES.length];
}

// ── Section scoping — mirrors getMySectionsLabel()'s ownership rule exactly. ──
function _ccMySections(isAdmin) {
  const all = (typeof SectionService !== 'undefined') ? SectionService.listSections({ includeArchived: false }) : [];
  const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  const mine = isAdmin ? all : all.filter(s => uid && s.adviserId === uid);
  return mine.slice().sort((a, b) => {
    const schedA = _ccScheduleFor(a.id), schedB = _ccScheduleFor(b.id);
    const tA = (schedA && !schedA.dayOff) ? _ccHmsToSec(schedA.startTime) : Infinity;
    const tB = (schedB && !schedB.dayOff) ? _ccHmsToSec(schedB.startTime) : Infinity;
    if (tA !== tB) return tA - tB;
    return String(a.gradeLevel).localeCompare(String(b.gradeLevel), undefined, { numeric: true })
      || String(a.sectionName).localeCompare(String(b.sectionName));
  });
}
function _ccScheduleFor(classId) {
  // Phase 54: a section can have per-weekday overrides now — resolve
  // TODAY's actual window (see AttendanceService.getEffectiveSchedule)
  // instead of grabbing whatever single row used to be the only one.
  if (typeof AttendanceService !== 'undefined' && AttendanceService.getEffectiveSchedule) {
    return AttendanceService.getEffectiveSchedule(classId);
  }
  return (DB.attendanceSchedules || []).find(s => s.classId === classId && (s.dayOfWeek || 0) === 0 && s.active !== false) || null;
}
function _ccSectionLabel(section) {
  return `Grade ${section.gradeLevel} – ${section.sectionName}`;
}
function _ccRosterFor(classId) {
  return (DB.students || []).filter(s => (s.classId || 'default-class') === classId);
}
function _ccRecitationCalledToday(classId) {
  const entries = (DB.recitationLog || []).filter(r => r.classId === classId && _ccIsToday(r.createdAt));
  const byStudent = {};
  entries.forEach(r => { byStudent[r.studentId] = (byStudent[r.studentId] || 0) + (r.pts || 0); });
  return byStudent; // { studentId: totalPtsToday }
}
function _ccAttendanceCountsToday(classId) {
  const today = _ccTodayISO();
  const logs = (DB.attendanceLogs || []).filter(l => l.classId === classId && l.logDate === today);
  let present = 0, late = 0, absent = 0;
  logs.forEach(l => {
    if (l.status === 'Late') late++;
    else if (l.status === 'Absent') absent++;
    else present++; // Present / Early / On Time / Excused
  });
  return { present, late, absent, hasAny: logs.length > 0 };
}

let _ccMounted = false;
window.renderAdminDashboard = function () {
  const el = document.getElementById('a-dashboard');
  if (!el) return;
  _ccMounted = true;

  const isAdmin = currentRole === 'admin';
  const sections = _ccMySections(isAdmin);

  el.innerHTML = `
  ${_ccHeroHTML()}
  <div class="section">
    <div class="cc-section-head">
      <h2>Today's Schedule</h2>
      <span class="cc-sub">${sections.length} section${sections.length === 1 ? '' : 's'} · updates live</span>
    </div>
    ${_ccScheduleHTML(sections)}
  </div>
  <div class="section">
    <div class="cc-section-head">
      <h2>Quick Actions</h2>
      <span class="cc-sub">Jump straight into a workflow</span>
    </div>
    ${_ccQuickActionsHTML()}
  </div>
  <div class="section">
    <div class="cc-section-head">
      <h2>Recitation Progress</h2>
      <span class="cc-sub">Students called vs. class capacity</span>
    </div>
    ${_ccRecitationPanelHTML(sections)}
  </div>`;

  _ccStartTicking();
};

// BUGFIX (dashboard shows "No sections yet" on first login until you nav
// away and back): _ccMySections() reads AppStore.classSections
// synchronously, but that slice is filled in by a SEPARATE, unawaited fetch
// (sections_index.js's _bootstrapSectionData(), kicked off from auth.js
// right before bootApp() renders this dashboard). So the very first paint
// almost always runs before that fetch resolves and shows the empty state.
// Every other module that depends on live section data (Section Maker,
// Classroom Builder, Live Monitor, Enrollment Hub, etc.) subscribes to
// AppStore and repaints itself when the data lands — this dashboard was the
// one screen that didn't, so it just sat frozen on the stale first render.
// Subscribing here and re-running renderAdminDashboard() on the
// 'sections:bootstrapped' event (and other state updates) fixes that.
AppStore.subscribe('command-center', function (state, event) {
  if (!_ccMounted) return;
  if (!event || event.type === 'state:updated' || event.type.indexOf('sections:') === 0 || event.type === 'state:remote-sync') {
    window.renderAdminDashboard();
  }
});

/**
 * unmountCommandCenter() → void  [window.unmountCommandCenter]
 * Stops the 1s clock/countdown interval. Same convention as
 * unmountRfidScanner()/unmountClassroomMonitor() — called from nav.js's
 * navTo() the moment the teacher leaves a-dashboard.
 */
let _ccTickInterval = null;
function _ccStartTicking() {
  if (_ccTickInterval) clearInterval(_ccTickInterval);
  _ccTickInterval = setInterval(_ccTick, 1000);
}
window.unmountCommandCenter = function () {
  if (_ccTickInterval) { clearInterval(_ccTickInterval); _ccTickInterval = null; }
  _ccMounted = false; // gates the module-level AppStore subscriber above — see its comment
};

function _ccTick() {
  const clockEl = document.getElementById('cc-clock');
  if (!clockEl) { window.unmountCommandCenter(); return; } // page navigated away without going through nav.js
  const [hh, mm, ss] = _ccNowHMS().split(':');
  clockEl.innerHTML = `${hh}<span class="cc-blink">:</span>${mm}<span class="cc-blink">:</span>${ss}`;

  const hourNum = parseInt(hh, 10);
  const greetWord = hourNum < 12 ? 'Good morning' : hourNum < 17 ? 'Good afternoon' : 'Good evening';
  const greetEl = document.getElementById('cc-greeting');
  if (greetEl) greetEl.textContent = `${greetWord}, ${currentUser ? currentUser.name : ''}!`;

  document.querySelectorAll('[data-cc-countdown]').forEach(elm => {
    const closeSec = parseInt(elm.dataset.ccCountdown, 10);
    const remain = closeSec - _ccNowSec();
    elm.textContent = remain > 0 ? _ccFmtDuration(remain) : 'Ending now';
    const card = elm.closest('.cc-tl-card');
    if (card && card.dataset.ccOpenSec) {
      const openSec = parseInt(card.dataset.ccOpenSec, 10);
      const frac = Math.min(1, Math.max(0, (_ccNowSec() - openSec) / (closeSec - openSec)));
      card.style.setProperty('--p', frac.toFixed(3));
    }
  });
  document.querySelectorAll('[data-cc-starts-in]').forEach(elm => {
    const openSec = parseInt(elm.dataset.ccStartsIn, 10);
    const remain = openSec - _ccNowSec();
    elm.textContent = remain > 0 ? _ccFmtDuration(remain) : 'Now';
  });
}

// ── 1. HERO ──────────────────────────────────────────────────────────────
function _ccHeroHTML() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Manila' }).toUpperCase();
  return `
  <div class="cc-hero">
    <div class="cc-hero-greeting">
      <div class="cc-eyebrow"><span class="cc-live-dot-sm"></span><span>${dayStr} · IN SESSION</span></div>
      <h1 id="cc-greeting">Good morning, ${_esc(currentUser ? currentUser.name : '')}!</h1>
      <div class="cc-date-row">
        <span>${dateStr}</span>
        <span class="cc-clock" id="cc-clock">00:00:00</span>
      </div>
    </div>
    <div class="cc-quote-panel">
      <div class="cc-quote-eyebrow">Motivation</div>
      <p class="cc-quote-text">"${_esc(_ccTodaysQuote())}"</p>
    </div>
  </div>`;
}

// ── 2. TODAY'S SCHEDULE ──────────────────────────────────────────────────
function _ccScheduleHTML(sections) {
  if (!sections.length) {
    return `
    <div class="cc-empty-card">
      <span class="material-symbols-outlined" style="font-size:28px;color:var(--text-muted)">event_busy</span>
      <div style="font-family:var(--fh);font-weight:800;margin:8px 0 4px">No sections yet</div>
      <div style="color:var(--text-muted);font-size:13px">Create a section to see today's schedule here.</div>
      <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="navTo('a-sections')">Go to Sections</button>
    </div>`;
  }

  const nowSec = _ccNowSec();
  const cards = sections.map(sec => {
    const sched = _ccScheduleFor(sec.id);
    const label = _ccSectionLabel(sec);

    if (!sched) {
      // No attendance window configured for this section at all — an honest
      // "locked" state distinct from "scheduled but not open yet".
      return `
      <div class="cc-tl-card cc-tl-locked">
        <div class="cc-tl-row-top">
          <div class="cc-tl-title"><div class="cc-tl-name">${_esc(label)}</div><div class="cc-tl-time">No schedule set</div></div>
          <span class="cc-status-tag">Locked</span>
        </div>
      </div>`;
    }

    if (sched.dayOff) {
      // Phase 55 "no class this day" override — sched.openTime/closeTime
      // are DB placeholders ('00:00'), never real times, so this must be
      // caught before the timeline math below or the card renders as a
      // bogus "Completed 12:00 AM – 12:00 AM" period.
      return `
      <div class="cc-tl-card cc-tl-dayoff">
        <div class="cc-tl-row-top">
          <div class="cc-tl-title"><div class="cc-tl-name">${_esc(label)}</div><div class="cc-tl-time">No class today</div></div>
          <span class="cc-status-tag">Day off</span>
        </div>
      </div>`;
    }

    const openSec = _ccHmsToSec(sched.openTime), closeSec = _ccHmsToSec(sched.closeTime);
    const roster = _ccRosterFor(sec.id);
    const timeStr = `${_ccFmtClockLabel(sched.openTime)} – ${_ccFmtClockLabel(sched.closeTime)}`;

    if (nowSec >= closeSec) {
      const att = _ccAttendanceCountsToday(sec.id);
      const calledToday = _ccRecitationCalledToday(sec.id);
      const recTracked = Object.keys(calledToday).length > 0;
      return `
      <div class="cc-tl-card cc-tl-finished">
        <div class="cc-tl-row-top">
          <div class="cc-tl-title"><div class="cc-tl-name">${_esc(label)}</div><div class="cc-tl-time">${timeStr}</div></div>
          <span class="cc-status-tag">Completed</span>
        </div>
        <div class="cc-tl-checks">
          <span class="${att.hasAny ? '' : 'cc-tl-check-off'}"><span class="material-symbols-outlined">${att.hasAny ? 'check_circle' : 'radio_button_unchecked'}</span>Attendance ${att.hasAny ? 'logged' : 'not logged'}</span>
          <span class="${recTracked ? '' : 'cc-tl-check-off'}"><span class="material-symbols-outlined">${recTracked ? 'check_circle' : 'radio_button_unchecked'}</span>Recitation ${recTracked ? 'tracked' : 'not tracked'}</span>
        </div>
      </div>`;
    }

    if (nowSec >= openSec) {
      const att = _ccAttendanceCountsToday(sec.id);
      const calledToday = _ccRecitationCalledToday(sec.id);
      const calledCount = Object.keys(calledToday).length;
      const coveragePct = roster.length ? Math.round((calledCount / roster.length) * 100) : 0;
      return `
      <div class="cc-tl-card cc-tl-ongoing" data-cc-open-sec="${openSec}" style="--p:0">
        <div class="cc-tl-row-top">
          <div class="cc-tl-title"><div class="cc-tl-name">${_esc(label)}</div><div class="cc-tl-time">${timeStr}</div></div>
          <span class="cc-live-tag"><span class="cc-pulse-dot"></span>Live</span>
        </div>
        <div class="cc-tl-body">
          <div class="cc-metric-row">
            <div class="cc-metric cc-metric-present"><div class="cc-metric-num">${att.present}</div><div class="cc-metric-lbl">Present</div></div>
            <div class="cc-metric cc-metric-late"><div class="cc-metric-num">${att.late}</div><div class="cc-metric-lbl">Late</div></div>
            <div class="cc-metric cc-metric-absent"><div class="cc-metric-num">${att.absent}</div><div class="cc-metric-lbl">Absent</div></div>
          </div>
          <div class="cc-coverage-label"><span>Recitation coverage</span><span class="cc-mono">${coveragePct}%</span></div>
          <div class="cc-progress-track"><div class="cc-progress-fill" style="width:${coveragePct}%"></div></div>
          <div class="cc-countdown-row">
            <span>Time remaining in period</span>
            <span class="cc-mono cc-countdown-val" data-cc-countdown="${closeSec}">—</span>
          </div>
        </div>
      </div>`;
    }

    // Upcoming — schedule exists, hasn't opened yet.
    return `
    <div class="cc-tl-card cc-tl-upcoming">
      <div class="cc-tl-row-top">
        <div class="cc-tl-title"><div class="cc-tl-name">${_esc(label)}</div><div class="cc-tl-time">${timeStr}</div></div>
        <span class="cc-status-tag">Scheduled</span>
      </div>
      <div class="cc-tl-upcoming-meta">Opens in <span class="cc-mono" data-cc-starts-in="${openSec}">—</span></div>
    </div>`;
  }).join('');

  return `<div class="cc-timeline">${cards}</div>`;
}

// ── 3. QUICK ACTIONS ─────────────────────────────────────────────────────
function _ccQuickActionsHTML() {
  const actions = [
    { icon: 'qr_code_scanner',   label: 'Scanner',             sub: 'Hardware scan console', glow: 'var(--secondary)',   go: `navTo('a-scanner')` },
    { icon: 'record_voice_over', label: 'Recitation',          sub: 'Randomizer drawer',     glow: 'var(--primary)',     go: `navTo('a-classroom-monitor')` },
    { icon: 'grid_view',         label: 'Seating Arrangement', sub: 'Layout map grid',       glow: '#22d3ee',            go: `navTo('a-classroom')` },
    { icon: 'military_tech',     label: 'Hall of Fame',        sub: 'Section honors ledger', glow: 'var(--tertiary)',    go: `navTo('a-hall-of-fame')` },
    { icon: 'add_task',          label: 'Quest Builder',       sub: 'Assignment architect',  glow: '#8b5cf6',            go: `navTo('a-quizzes')` },
    { icon: 'monitoring',        label: 'Deep Analytics',      sub: 'Historic logs',         glow: 'var(--error)',       go: `navTo('a-analytics')` },
  ];
  return `
  <div class="cc-actions-row">
    ${actions.map(a => `
    <button class="cc-action-card" style="--glow:${a.glow}" onclick="${a.go}">
      <div class="cc-action-icon"><span class="material-symbols-outlined">${a.icon}</span></div>
      <div>
        <div class="cc-action-label">${a.label}</div>
        <div class="cc-action-sub">${a.sub}</div>
      </div>
    </button>`).join('')}
  </div>`;
}

// ── 4. RECITATION PROGRESS PANEL ─────────────────────────────────────────
function _ccRecitationPanelHTML(sections) {
  if (!sections.length) {
    return `<div class="cc-empty-card"><div style="color:var(--text-muted);font-size:13px">No sections to show yet.</div></div>`;
  }
  const rows = sections.map(sec => {
    const roster = _ccRosterFor(sec.id);
    const total = roster.length;
    const calledToday = _ccRecitationCalledToday(sec.id);
    const calledIds = Object.keys(calledToday);
    const called = calledIds.length;
    const remaining = Math.max(0, total - called);
    const totalPts = calledIds.reduce((a, id) => a + calledToday[id], 0);
    const avgPts = called ? (totalPts / called) : 0;
    const pct = total ? Math.round((called / total) * 100) : 0;
    const remClass = remaining === 0 && total > 0 ? 'cc-rem-zero' : remaining > 0 && remaining <= Math.max(3, Math.round(total * 0.25)) ? 'cc-rem-low' : '';

    return `
    <div class="cc-rec-row">
      <div class="cc-rec-name">
        <div class="cc-rec-section">${_esc(_ccSectionLabel(sec))}</div>
        <div class="cc-rec-meta">${total} student${total === 1 ? '' : 's'}</div>
      </div>
      <div class="cc-rec-progress">
        <div class="cc-rec-bar-label"><span>Called vs. capacity</span><span class="cc-mono">${called} / ${total}</span></div>
        <div class="cc-progress-track"><div class="cc-progress-fill cc-progress-fill-rec" style="width:${pct}%"></div></div>
      </div>
      <div class="cc-rec-remaining ${remClass}">${remaining}<span class="cc-rec-sublbl">Remaining</span></div>
      <div class="cc-rec-score">${avgPts.toFixed(1)}<span class="cc-rec-sublbl">Avg. Points</span></div>
    </div>`;
  }).join('');

  return `<div class="cc-recitation-list">${rows}</div>`;
}

console.log('[EduQuest] Teacher Command Center loaded.');
