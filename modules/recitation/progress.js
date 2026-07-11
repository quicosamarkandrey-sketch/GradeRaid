// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/recitation/progress.js
//  Student Progress page: Attendance Calendar, Recitation History,
//  Streaks, Milestones, Academic Showcase.
//  Renders into #s-attendance (the "My Progress" nav item).
// ═══════════════════════════════════════════════════════════════════════════════

// ── CSS Injection ─────────────────────────────────────────────────────────────
// Injects all progress-page styles on module load.
;(function injectProgressCSS() {
  if (document.getElementById('recitation-progress-css')) return;
  const style = document.createElement('style');
  style.id = 'recitation-progress-css';
  style.textContent = `
/* ── PROGRESS PAGE BASE ── */
.prog-hero{
  position:relative;overflow:hidden;border-radius:20px;
  background:linear-gradient(135deg,#0f0d1f 0%,#1a1438 50%,#0e1a2a 100%);
  border:1px solid rgba(208,188,255,0.15);
  padding:36px 40px 32px;margin-bottom:28px;
}
.prog-hero::before{
  content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse at 75% 50%,rgba(78,222,163,0.10) 0%,transparent 55%),
             radial-gradient(ellipse at 20% 80%,rgba(208,188,255,0.10) 0%,transparent 50%);
  pointer-events:none;
}
.prog-hero-grid{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;position:relative;z-index:1}
.prog-hero-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(78,222,163,.7);margin-bottom:6px}
.prog-hero-name{font-family:var(--fh);font-size:36px;font-weight:900;letter-spacing:-.5px;color:var(--on-surface);line-height:1.1;margin-bottom:4px}
.prog-hero-sub{font-size:13px;color:var(--text-muted);margin-bottom:18px}
.prog-stat-strip{display:flex;gap:10px;flex-wrap:wrap}
.prog-stat-chip{
  display:flex;flex-direction:column;align-items:center;padding:10px 16px;
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);
  border-radius:12px;min-width:80px;backdrop-filter:blur(8px);
}
.prog-stat-chip .v{font-family:var(--fh);font-size:22px;font-weight:900;line-height:1}
.prog-stat-chip .l{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-top:3px}
.prog-hero-avatar{
  width:90px;height:90px;border-radius:18px;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--fh);font-size:28px;font-weight:900;
  box-shadow:0 0 40px rgba(139,92,246,0.3);
  border:2px solid rgba(208,188,255,0.25);flex-shrink:0;
}

/* ── TAB BAR ── */
.prog-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:28px;overflow-x:auto}
.prog-tab{
  display:flex;align-items:center;gap:7px;padding:12px 22px;
  font-size:13px;font-weight:700;letter-spacing:.04em;
  color:var(--text-muted);background:none;border:none;cursor:pointer;
  border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;
  font-family:var(--fb);
}
.prog-tab:hover{color:var(--on-surface)}
.prog-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.prog-tab .material-symbols-outlined{font-size:16px}
.prog-panel{display:none}
.prog-panel.active{display:block}

/* ── STREAK CARDS ── */
.streak-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-bottom:28px}
.streak-card{
  position:relative;overflow:hidden;
  border-radius:16px;padding:22px;
  background:rgba(35,31,56,0.85);
  border:1px solid var(--border);
  backdrop-filter:blur(12px);
  transition:all .3s;
}
.streak-card:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.4)}
.streak-card.fire{border-color:rgba(255,185,95,0.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(40,25,10,.6))}
.streak-card.fire::before{content:'';position:absolute;top:-20px;right:-20px;width:100px;height:100px;
  background:radial-gradient(circle,rgba(255,185,95,.18) 0%,transparent 70%);border-radius:50%}
.streak-card.crystal{border-color:rgba(78,222,163,0.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(10,30,25,.6))}
.streak-card.crystal::before{content:'';position:absolute;top:-20px;right:-20px;width:100px;height:100px;
  background:radial-gradient(circle,rgba(78,222,163,.15) 0%,transparent 70%);border-radius:50%}
.streak-card.violet{border-color:rgba(208,188,255,0.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(20,10,40,.6))}
.streak-card.violet::before{content:'';position:absolute;top:-20px;right:-20px;width:100px;height:100px;
  background:radial-gradient(circle,rgba(208,188,255,.12) 0%,transparent 70%);border-radius:50%}
.streak-icon{font-size:36px;margin-bottom:10px;line-height:1;display:block}
.streak-num{font-family:var(--fh);font-size:48px;font-weight:900;line-height:1;margin-bottom:2px}
.streak-lbl{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.streak-sub{font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.5}
.streak-badge{
  display:inline-flex;align-items:center;gap:5px;margin-top:10px;
  padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
}

/* ── CALENDAR ── */
.cal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.cal-nav-btn{
  width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,.05);
  border:1px solid var(--border2);cursor:pointer;color:var(--on-surface);
  display:flex;align-items:center;justify-content:center;transition:all .18s;font-size:16px;
}
.cal-nav-btn:hover{background:rgba(208,188,255,.1);border-color:rgba(208,188,255,.3)}
.cal-month-label{font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface)}
.cal-grid-wrap{background:rgba(35,31,56,0.8);border:1px solid var(--border);border-radius:16px;overflow:hidden;backdrop-filter:blur(12px)}
.cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--border)}
.cal-dow{padding:10px;text-align:center;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.cal-days-grid{display:grid;grid-template-columns:repeat(7,1fr)}
.cal-day{
  position:relative;aspect-ratio:1;padding:6px;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  cursor:default;transition:all .18s;border-right:1px solid rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.03);
}
.cal-day.has-data{cursor:pointer}
.cal-day.has-data:hover{background:rgba(208,188,255,.07)}
.cal-day.today .cal-day-num{background:var(--primary-dark);color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center}
.cal-day-num{font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:3px;line-height:1}
.cal-day.present .cal-day-num{color:var(--secondary)}
.cal-day.absent .cal-day-num{color:var(--error)}
.cal-day.empty{opacity:.25}
.cal-day-dots{display:flex;flex-wrap:wrap;gap:2px;justify-content:center;margin-top:2px}
.cal-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.cal-dot.present{background:var(--secondary);box-shadow:0 0 4px rgba(78,222,163,.6)}
.cal-dot.absent{background:var(--error);box-shadow:0 0 4px rgba(255,180,171,.6)}
.cal-dot.recitation{background:var(--primary);box-shadow:0 0 4px rgba(208,188,255,.6)}
.cal-dot.quiz{background:var(--tertiary);box-shadow:0 0 4px rgba(255,185,95,.6)}
.cal-day-detail{
  background:rgba(28,25,48,0.98);border:1px solid rgba(208,188,255,.2);
  border-radius:16px;padding:20px;margin-top:16px;
  box-shadow:0 0 32px rgba(139,92,246,.15);
  animation:fadeIn .2s ease;display:none;
}
.cal-day-detail.open{display:block}
.cal-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;padding:12px 16px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid var(--border)}
.cal-leg-item{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);font-weight:600}

/* ── RECITATION HISTORY ── */
.rec-timeline{display:flex;flex-direction:column;gap:8px;margin-bottom:24px}
.rec-entry{
  display:flex;align-items:flex-start;gap:14px;padding:14px 16px;
  background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:12px;
  transition:all .2s;backdrop-filter:blur(8px);position:relative;overflow:hidden;
}
.rec-entry::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--secondary);border-radius:3px 0 0 3px}
.rec-entry.high-pts::before{background:var(--primary)}
.rec-entry.epic-pts::before{background:var(--tertiary)}
.rec-entry:hover{border-color:rgba(78,222,163,.25);transform:translateX(2px)}
.rec-entry-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background:rgba(78,222,163,.1);border:1px solid rgba(78,222,163,.25)}
.rec-entry-icon.high{background:rgba(208,188,255,.1);border-color:rgba(208,188,255,.25)}
.rec-entry-icon.epic{background:rgba(255,185,95,.1);border-color:rgba(255,185,95,.25)}
.rec-entry-body{flex:1;min-width:0}
.rec-entry-pts{font-family:var(--fh);font-size:20px;font-weight:900}
.rec-entry-note{font-size:13px;color:var(--text-muted);margin-top:2px;line-height:1.4}
.rec-entry-when{font-size:10px;color:rgba(255,255,255,.3);margin-top:4px;font-weight:600;letter-spacing:.04em}
.rec-entry-rank{font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;white-space:nowrap;flex-shrink:0;margin-top:4px}

/* ── MILESTONE CARDS ── */
.milestone-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:28px}
.ms-card{
  border-radius:14px;padding:18px;
  background:rgba(35,31,56,.85);border:1px solid var(--border);
  backdrop-filter:blur(12px);transition:all .3s;position:relative;overflow:hidden;
}
.ms-card.unlocked{border-color:rgba(255,185,95,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(30,20,5,.7))}
.ms-card.unlocked::after{content:'✓';position:absolute;top:10px;right:12px;font-size:16px;font-weight:900;color:var(--tertiary)}
.ms-card.locked{opacity:.55}
.ms-card:hover:not(.locked){transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.4)}
.ms-icon{font-size:32px;margin-bottom:8px;display:block;line-height:1}
.ms-title{font-family:var(--fh);font-size:14px;font-weight:800;color:var(--on-surface);margin-bottom:4px}
.ms-desc{font-size:11px;color:var(--text-muted);line-height:1.5;margin-bottom:8px}
.ms-progress{background:rgba(255,255,255,.06);border-radius:20px;height:4px;overflow:hidden}
.ms-progress-fill{height:100%;border-radius:20px;transition:width .8s ease}

/* ── SHOWCASE / TROPHY ROOM ── */
.showcase-header{
  text-align:center;padding:32px;
  background:linear-gradient(135deg,rgba(25,20,50,.95),rgba(15,25,20,.9));
  border:1px solid rgba(208,188,255,.15);border-radius:20px;margin-bottom:24px;
  position:relative;overflow:hidden;
}
.showcase-header::before{content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse at 50% 0%,rgba(208,188,255,.12) 0%,transparent 60%);pointer-events:none}
.showcase-crown{font-size:56px;display:block;margin-bottom:8px;line-height:1;animation:floatCrown 3s ease-in-out infinite}
@keyframes floatCrown{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.showcase-title-text{font-family:var(--fm);font-size:22px;font-weight:900;letter-spacing:.1em;
  background:linear-gradient(135deg,#ffd700,#ffb95f,#d0bcff);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  margin-bottom:4px}
.showcase-sub{font-size:13px;color:var(--text-muted)}

.trophy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:28px}
.trophy-card{
  border-radius:16px;padding:20px;
  background:rgba(35,31,56,.85);border:1px solid var(--border);
  backdrop-filter:blur(12px);transition:all .3s;
  display:flex;flex-direction:column;
}
.trophy-card.gold{border-color:rgba(255,215,0,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(30,22,5,.7))}
.trophy-card.silver{border-color:rgba(192,192,192,.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(20,20,25,.8))}
.trophy-card.bronze{border-color:rgba(205,127,50,.35);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(25,15,5,.7))}
.trophy-card.emerald{border-color:rgba(78,222,163,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(5,25,15,.7))}
.trophy-card.violet{border-color:rgba(208,188,255,.4);background:linear-gradient(135deg,rgba(35,31,56,.9),rgba(20,10,40,.7))}
.trophy-card:hover{transform:translateY(-4px);box-shadow:0 14px 44px rgba(0,0,0,.5)}
.trophy-icon-row{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.trophy-icon{font-size:32px;line-height:1}
.trophy-grade{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;border-radius:6px}
.trophy-card-title{font-family:var(--fh);font-size:15px;font-weight:900;color:var(--on-surface);margin-bottom:4px}
.trophy-card-value{font-family:var(--fh);font-size:28px;font-weight:900;line-height:1;margin-bottom:2px}
.trophy-card-sub{font-size:11px;color:var(--text-muted);line-height:1.5;flex:1}
.trophy-card-footer{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:var(--text-muted)}

/* ── ATTENDANCE HISTORY TABLE ── */
.att-hist-list{display:flex;flex-direction:column;gap:8px}
.att-hist-row{
  display:flex;align-items:center;gap:14px;padding:12px 16px;
  background:rgba(35,31,56,.75);border:1px solid var(--border);border-radius:12px;
  transition:all .2s;backdrop-filter:blur(8px);
}
.att-hist-row:hover{border-color:rgba(255,255,255,.12);transform:translateX(2px)}
.att-status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.att-status-dot.present{background:var(--secondary);box-shadow:0 0 8px rgba(78,222,163,.5)}
.att-status-dot.absent{background:var(--error);box-shadow:0 0 8px rgba(255,180,171,.5)}

/* ── SHARE CARD STYLE ── */
.share-card{
  background:linear-gradient(135deg,#12102a 0%,#1a1438 40%,#0c1a14 100%);
  border:1px solid rgba(208,188,255,.25);border-radius:20px;
  padding:28px;position:relative;overflow:hidden;margin-bottom:20px;
}
.share-card::before{content:'';position:absolute;top:-30px;right:-30px;width:160px;height:160px;
  background:radial-gradient(circle,rgba(208,188,255,.12) 0%,transparent 70%);border-radius:50%;pointer-events:none}
.share-card::after{content:'';position:absolute;bottom:-40px;left:10%;width:120px;height:120px;
  background:radial-gradient(circle,rgba(78,222,163,.10) 0%,transparent 70%);border-radius:50%;pointer-events:none}
.share-card-inner{position:relative;z-index:1}
.share-watermark{font-family:var(--fm);font-size:9px;letter-spacing:.16em;color:rgba(208,188,255,.35);text-transform:uppercase;margin-bottom:16px}
.share-student-row{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;margin-bottom:18px}
.share-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.share-stat{text-align:center;padding:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px}
.share-stat .sv{font-family:var(--fh);font-size:20px;font-weight:900}
.share-stat .sl{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700}
.share-badges-row{display:flex;gap:8px;flex-wrap:wrap}
.share-badge-chip{padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;display:flex;align-items:center;gap:4px}
`;
  document.head.appendChild(style);
})();

// ── Milestone Definitions ─────────────────────────────────────────────────────
const PROG_ATTENDANCE_MILESTONES = [
  {id:'att_1',       icon:'🗓️', title:'First Attendance',    desc:'Log your first attendance session',       target:1,  field:'presentCount',   color:'#4edea3'},
  {id:'att_5',       icon:'📅', title:'Week Warrior',        desc:'Be present 5 times',                     target:5,  field:'presentCount',   color:'#4edea3'},
  {id:'att_10',      icon:'✨', title:'Consistent Scholar',  desc:'Be present 10 times',                    target:10, field:'presentCount',   color:'#8b5cf6'},
  {id:'att_25',      icon:'🌟', title:'Dedicated Student',   desc:'Be present 25 times',                    target:25, field:'presentCount',   color:'#ffb95f'},
  {id:'att_50',      icon:'🏆', title:'Attendance Legend',   desc:'Be present 50 times',                    target:50, field:'presentCount',   color:'#ffd700'},
  {id:'streak_3',    icon:'🔥', title:'3-Day Streak',        desc:'Attend 3 consecutive days',               target:3,  field:'currentStreak',  color:'#f97316'},
  {id:'streak_7',    icon:'🔥', title:'Weekly Fire',         desc:'Attend 7 consecutive days',               target:7,  field:'currentStreak',  color:'#ef4444'},
  {id:'streak_14',   icon:'💫', title:'Fortnight Flame',     desc:'Maintain a 14-day streak',                target:14, field:'longestStreak',  color:'#d0bcff'},
  {id:'streak_30',   icon:'⭐', title:'Eternal Flame',       desc:'30-day attendance streak',                target:30, field:'longestStreak',  color:'#ffd700'},
  {id:'perfect_month',  icon:'💎', title:'Perfect Month',   desc:'Zero absences in a whole month',          target:1,  field:'perfectMonths',  color:'#4edea3'},
  {id:'perfect_months_3',icon:'💎💎',title:'Diamond Attendance',desc:'3 perfect attendance months',          target:3,  field:'perfectMonths',  color:'#a78bfa'},
];
const PROG_RECITATION_MILESTONES = [
  {id:'rec_1',       icon:'🎤',  title:'First Word',          desc:'Complete your first recitation',          target:1,  field:'sessionCount', color:'#4edea3'},
  {id:'rec_5',       icon:'🗣️', title:'Active Participant',   desc:'Complete 5 recitations',                 target:5,  field:'sessionCount', color:'#4edea3'},
  {id:'rec_10',      icon:'📢',  title:'Vocal Scholar',       desc:'Complete 10 recitations',                target:10, field:'sessionCount', color:'#8b5cf6'},
  {id:'rec_25',      icon:'🎙️', title:'Voice of Class',       desc:'Complete 25 recitations',                target:25, field:'sessionCount', color:'#ffb95f'},
  {id:'rec_50',      icon:'👑',  title:'Recitation Master',   desc:'50 recitation sessions',                 target:50, field:'sessionCount', color:'#ffd700'},
  {id:'rec_pts_50',  icon:'⚡',  title:'50 Points Earned',    desc:'Earn 50 recitation points',              target:50, field:'totalPts',     color:'#4edea3'},
  {id:'rec_pts_150', icon:'⚡⚡',title:'Point Powerhouse',    desc:'Earn 150 recitation points',             target:150,field:'totalPts',     color:'#8b5cf6'},
  {id:'rec_pts_500', icon:'💥',  title:'Elite Contributor',   desc:'Earn 500 recitation points total',       target:500,field:'totalPts',     color:'#ffd700'},
  {id:'rec_streak_3',icon:'🎯',  title:'3 Recitations in a Row',desc:'Recite on 3 consecutive class days',  target:3,  field:'streak',       color:'#f97316'},
  {id:'rec_streak_5',icon:'🎯',  title:'Consistent Voice',    desc:'Recite on 5 consecutive days',           target:5,  field:'streak',       color:'#ef4444'},
  {id:'rec_wins',    icon:'🌠',  title:'High Scorer',         desc:'Earn 15+ pts in a single recitation',   target:1,  field:'wins',         color:'#ffb95f'},
  {id:'rec_wins_5',  icon:'🌠🌠',title:'Consistent Excellence',desc:'Earn 15+ pts 5 times',                 target:5,  field:'wins',         color:'#ffd700'},
];

// ── Module State ──────────────────────────────────────────────────────────────
let progCalYear   = new Date().getFullYear();
let progCalMonth  = new Date().getMonth();
let progActiveTab = 'streaks';

// ── Private Helpers ───────────────────────────────────────────────────────────

// BUGFIX (Investigation Report §1): this used to read DB.attendanceSessions,
// a legacy local-only array nothing has written to since the Phase 1 RFID/NFC
// attendance system shipped — which is why the whole Progress page (streak,
// calendar, rate ring, milestones) was stuck at 0 regardless of real scans.
// The real source of truth is DB.attendanceLogs (see attendance-service.js
// and recalcStudentStats() in utils.js, which already made this switch).
// Excused days are dropped entirely (neutral — they shouldn't break a streak
// or count as an absence); Early/On Time/Late all normalize to 'present' so
// every downstream helper in this file (progAttStreak, progPerfectMonths,
// the calendar renderer, etc.) keeps working unchanged against the same
// {studentId, date, status:'present'|'absent'} shape it already expects.
// BUGFIX (Investigation Report §1): this used to read DB.attendanceSessions,
// a legacy local-only array nothing has written to since the Phase 1 RFID/NFC
// attendance system shipped — which is why the whole Progress page (streak,
// calendar, rate ring, milestones) was stuck at 0 regardless of real scans.
// Now delegates to getStudentAttendanceRecords() in utils.js (Investigation
// Report §4 — lifted out here so the RFID kiosk's scan card can share the
// exact same normalization instead of drifting duplicate logic).
function progGetAttendanceForStudent(sid) {
  return getStudentAttendanceRecords(sid);
}

function progGetRecitationsForStudent(sid) {
  return (DB.recitationLog || []).filter(r => r.studentId === sid);
}

/**
 * Compute attendance streak (consecutive present days).
 * Delegates to computeAttendanceStreak() in utils.js (Investigation Report
 * §4) — kept as a thin wrapper so every existing call site in this file
 * (progAttStreak(...)) keeps working unchanged.
 */
function progAttStreak(sessions) {
  return computeAttendanceStreak(sessions);
}

/** Compute recitation streak (consecutive days with recitations). */
function progRecStreak(recitations) {
  const days = [...new Set(
    recitations.map(r => (r.when || '').split(' ')[0] || r.when || '').filter(Boolean)
  )].sort();
  if (!days.length) return { current: 0, longest: 0 };
  let longest = 1, cur = 1;
  function pd(d) { const t = new Date(d); return isNaN(t.getTime()) ? null : t; }
  for (let i = 1; i < days.length; i++) {
    const a = pd(days[i - 1]), b = pd(days[i]);
    if (a && b) { const diff = Math.round((b - a) / 86400000); if (diff <= 1) { cur++; longest = Math.max(longest, cur); } else cur = 1; }
  }
  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
  let curStreak = 0;
  const rev = [...days].reverse();
  let check = new Date(todayDate);
  for (const d of rev) {
    const pd2 = pd(d); if (!pd2) continue;
    const diff = Math.round((check - pd2) / 86400000);
    if (diff === 0 || diff === 1) { curStreak++; check = pd2; } else if (diff > 1) break;
  }
  return { current: curStreak, longest: Math.max(longest, curStreak) };
}

/** Count months with perfect attendance (zero absences). */
function progPerfectMonths(sessions) {
  const byMonth = {};
  sessions.forEach(s => {
    if (!s.date) return;
    const d = new Date(s.date); if (isNaN(d)) return;
    const key = d.getFullYear() + '-' + (d.getMonth() + 1);
    if (!byMonth[key]) byMonth[key] = { present: 0, absent: 0 };
    s.status === 'present' ? byMonth[key].present++ : byMonth[key].absent++;
  });
  return Object.values(byMonth).filter(m => m.absent === 0 && m.present > 0).length;
}

/** Build day-keyed calendar data for a given year/month (0-indexed month). */
function progBuildCalendar(sid, year, month) {
  const attendance  = progGetAttendanceForStudent(sid);
  const recitations = progGetRecitationsForStudent(sid);
  const quizLog     = (DB.pointLog || []).filter(l => l.studentId === sid && (l.what || '').startsWith('Quest:'));

  const data = {};
  attendance.forEach(a => {
    if (!a.date) return;
    const d = new Date(a.date); if (isNaN(d) || d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = d.getDate();
    if (!data[key]) data[key] = { status: null, recitations: [], quizzes: [], rewards: [] };
    data[key].status = a.status;
  });
  recitations.forEach(r => {
    if (!r.when) return;
    const d = new Date(r.when); if (isNaN(d) || d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = d.getDate();
    if (!data[key]) data[key] = { status: null, recitations: [], quizzes: [], rewards: [] };
    data[key].recitations.push(r);
  });
  quizLog.forEach(q => {
    if (!q.when) return;
    const d = new Date(q.when); if (isNaN(d) || d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = d.getDate();
    if (!data[key]) data[key] = { status: null, recitations: [], quizzes: [], rewards: [] };
    data[key].quizzes.push(q);
  });
  return data;
}

// ── Panel Renderers ───────────────────────────────────────────────────────────

function progRenderStreaks(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, absentCount, attPct) {
  const totalSess = attendanceSess.length;
  const attBar    = Math.min(100, attPct);
  return `
  <div class="streak-grid">
    <div class="streak-card fire">
      <span class="streak-icon">🔥</span>
      <div class="streak-num" style="color:#ffb95f">${attStreaks.current}</div>
      <div class="streak-lbl">Attendance Streak</div>
      <div class="streak-sub">Consecutive days present<br>Longest ever: <strong style="color:#fff">${attStreaks.longest} days</strong></div>
      ${attStreaks.current >= 3 ? `<span class="streak-badge" style="background:rgba(255,185,95,.15);border:1px solid rgba(255,185,95,.35);color:#ffb95f">🔥 On Fire</span>` : ''}
      ${attStreaks.current >= 7 ? `<span class="streak-badge" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.35);color:#f87171;margin-left:4px">🏅 Weekly Hero</span>` : ''}
    </div>
    <div class="streak-card crystal">
      <span class="streak-icon">🎤</span>
      <div class="streak-num" style="color:#4edea3">${recStreaks.current}</div>
      <div class="streak-lbl">Recitation Streak</div>
      <div class="streak-sub">Consecutive class days recited<br>Best ever: <strong style="color:#fff">${recStreaks.longest} days</strong></div>
      ${recStreaks.current >= 3 ? `<span class="streak-badge" style="background:rgba(78,222,163,.15);border:1px solid rgba(78,222,163,.35);color:#4edea3">🎯 Active Voice</span>` : ''}
    </div>
    <div class="streak-card violet">
      <span class="streak-icon">💎</span>
      <div class="streak-num" style="color:#d0bcff">${perfectMonths}</div>
      <div class="streak-lbl">Perfect Months</div>
      <div class="streak-sub">Months with zero absences<br>${perfectMonths === 0 ? "Work toward your first!" : "Keep going, you're amazing!"}</div>
      ${perfectMonths >= 1 ? `<span class="streak-badge" style="background:rgba(208,188,255,.15);border:1px solid rgba(208,188,255,.35);color:#d0bcff">💎 Diamond Scholar</span>` : ''}
    </div>
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">calendar_today</span>
    <h2>Attendance Overview</h2>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px">
    <div class="glass-card" style="padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px">Attendance Rate</div>
          <div style="font-family:var(--fh);font-size:40px;font-weight:900;color:${attPct >= 90 ? '#4edea3' : attPct >= 75 ? '#ffb95f' : '#ffb4ab'};line-height:1">${attPct}%</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-muted)">Present</div>
          <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:#4edea3">${presentCount}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Absent</div>
          <div style="font-family:var(--fh);font-size:18px;font-weight:900;color:#ffb4ab">${absentCount}</div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,.06);border-radius:20px;height:10px;overflow:hidden;margin-bottom:6px">
        <div style="height:100%;border-radius:20px;width:${attBar}%;background:linear-gradient(90deg,#4edea3,#06b6d4);box-shadow:0 0 10px rgba(78,222,163,.5);transition:width .8s ease"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">Total sessions recorded: ${totalSess}</div>
    </div>
    <div class="glass-card" style="padding:20px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:14px">Recitation Summary</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[
          { v: recStats.sessionCount || recitations.length, l: 'Sessions',       c: '#d0bcff' },
          { v: recStats.totalPts     || 0,                  l: 'Total Pts',      c: '#4edea3' },
          { v: recStats.streak       || recStreaks.longest,  l: 'Best Streak',   c: '#f97316' },
          { v: recStats.wins         || 0,                  l: 'High Scores',    c: '#ffd700' },
        ].map(s => `
        <div style="text-align:center;padding:12px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px">
          <div style="font-family:var(--fh);font-size:28px;font-weight:900;color:${s.c}">${s.v}</div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700">${s.l}</div>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">history</span>
    <h2>Recent Attendance</h2>
    <span class="badge-pill bp-primary">${attendanceSess.length} records</span>
  </div>
  <div class="att-hist-list">
    ${attendanceSess.length ? attendanceSess.slice(0, 12).map(a => `
    <div class="att-hist-row">
      <div class="att-status-dot ${a.status}"></div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:${a.status === 'present' ? '#4edea3' : '#ffb4ab'}">${a.status === 'present' ? '✅ Present' : '❌ Absent'}</div>
        <div style="font-size:11px;color:var(--text-muted)">${a.date || '—'}</div>
      </div>
      <div class="badge-pill ${a.status === 'present' ? 'bp-green' : 'bp-red'}">${a.status === 'present' ? '+5 coins' : '-5 coins'}</div>
    </div>`).join('') :
    `<div style="text-align:center;padding:48px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px;color:var(--text-muted)">
      <div style="font-size:40px;margin-bottom:10px">📅</div>
      <div style="font-family:var(--fh);font-weight:800;margin-bottom:4px">No records yet</div>
      <div style="font-size:13px">Your attendance will appear here once your teacher logs it.</div>
    </div>`}
  </div>`;
}

function progRenderCalendarPanel(st) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const calData    = progBuildCalendar(st.id, progCalYear, progCalMonth);
  const firstDay   = new Date(progCalYear, progCalMonth, 1).getDay();
  const daysInMonth = new Date(progCalYear, progCalMonth + 1, 0).getDate();
  const todayD     = new Date();
  const isThisMonth = todayD.getFullYear() === progCalYear && todayD.getMonth() === progCalMonth;

  let dayCells = '';
  for (let i = 0; i < firstDay; i++) dayCells += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayData = calData[d];
    const hasData = !!(dayData && (dayData.status || dayData.recitations.length || dayData.quizzes.length));
    const isToday = isThisMonth && d === todayD.getDate();
    let cls = 'cal-day';
    if (dayData?.status === 'present') cls += ' present';
    else if (dayData?.status === 'absent') cls += ' absent';
    if (isToday)   cls += ' today';
    if (hasData)   cls += ' has-data';
    const dots = [];
    if (dayData?.status === 'present')         dots.push('<span class="cal-dot present"></span>');
    else if (dayData?.status === 'absent')     dots.push('<span class="cal-dot absent"></span>');
    if (dayData?.recitations?.length)          dots.push('<span class="cal-dot recitation"></span>');
    if (dayData?.quizzes?.length)              dots.push('<span class="cal-dot quiz"></span>');
    dayCells += `<div class="${cls}" ${hasData ? `onclick="progShowCalDay(${d},${progCalYear},${progCalMonth})"` : ''}>
      <div class="cal-day-num">${d}</div>
      <div class="cal-day-dots">${dots.join('')}</div>
    </div>`;
  }

  return `
  <div class="cal-header">
    <button class="cal-nav-btn" onclick="progCalNav(-1)">‹</button>
    <div class="cal-month-label">${months[progCalMonth]} ${progCalYear}</div>
    <button class="cal-nav-btn" onclick="progCalNav(1)">›</button>
  </div>
  <div class="cal-grid-wrap">
    <div class="cal-dow-row">
      ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
    </div>
    <div class="cal-days-grid">${dayCells}</div>
  </div>
  <div class="cal-legend">
    <div class="cal-leg-item"><span class="cal-dot present" style="width:8px;height:8px"></span>Present</div>
    <div class="cal-leg-item"><span class="cal-dot absent" style="width:8px;height:8px"></span>Absent</div>
    <div class="cal-leg-item"><span class="cal-dot recitation" style="width:8px;height:8px"></span>Recitation</div>
    <div class="cal-leg-item"><span class="cal-dot quiz" style="width:8px;height:8px"></span>Quiz</div>
  </div>
  <div class="cal-day-detail" id="cal-day-detail"></div>
  `;
}

function progRenderRecitationPanel(st, recitations, recStats, recStreaks) {
  const sorted = [...recitations].sort((a, b) => (b.pts || 0) - (a.pts || 0));
  const topPts = sorted[0]?.pts || 0;
  return `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:28px">
    ${[
      { v: recStats.sessionCount || recitations.length, l: 'Total Sessions',    c: '#d0bcff' },
      { v: recStats.totalPts     || 0,                  l: 'Total Points',      c: '#4edea3' },
      { v: recStats.wins         || 0,                  l: 'High Scores (15+)', c: '#ffd700' },
      { v: recStreaks.longest,                           l: 'Best Streak',       c: '#f97316' },
      { v: topPts,                                       l: 'Best Single Score', c: '#ffb95f' },
      { v: recitations.length > 0 ? Math.round((recStats.totalPts || 0) / (recStats.sessionCount || recitations.length)) : 0, l: 'Avg Points/Session', c: '#8b5cf6' },
    ].map(s => `
    <div class="glass-card" style="padding:16px;text-align:center">
      <div style="font-family:var(--fh);font-size:28px;font-weight:900;color:${s.c}">${s.v}</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700;margin-top:4px">${s.l}</div>
    </div>`).join('')}
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">mic</span>
    <h2>Recitation Timeline</h2>
    <span class="badge-pill bp-green">${recitations.length} sessions</span>
  </div>

  ${recitations.length ? `
  <div class="rec-timeline">
    ${[...recitations].sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0)).map(r => {
      const pts  = r.pts || 0;
      const tier = pts >= 20 ? 'epic' : pts >= 15 ? 'high' : 'normal';
      const icon = pts >= 20 ? '🌟' : pts >= 15 ? '⭐' : '🎤';
      return `<div class="rec-entry ${tier === 'high' ? 'high-pts' : ''} ${tier === 'epic' ? 'epic-pts' : ''}">
        <div class="rec-entry-icon ${tier}"><span style="font-size:20px">${icon}</span></div>
        <div class="rec-entry-body">
          <div class="rec-entry-pts" style="color:${pts >= 20 ? '#ffd700' : pts >= 15 ? '#d0bcff' : '#4edea3'}">+${pts} pts</div>
          <div class="rec-entry-note">${r.note || 'Recitation session'}</div>
          <div class="rec-entry-when">🕐 ${r.when || '—'}</div>
        </div>
        ${pts >= 20 ? `<span class="badge-pill bp-gold" style="font-size:10px">🌟 Epic</span>` : pts >= 15 ? `<span class="badge-pill bp-primary" style="font-size:10px">⭐ High Score</span>` : ''}
      </div>`;
    }).join('')}
  </div>` : `
  <div style="text-align:center;padding:64px 20px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px">
    <div style="font-size:48px;margin-bottom:12px">🎤</div>
    <div style="font-family:var(--fh);font-size:16px;font-weight:800;color:var(--on-surface);margin-bottom:6px">No recitations yet</div>
    <div style="color:var(--text-muted);font-size:13px">Your recitation history will appear here. Speak up in class!</div>
  </div>`}`;
}

function progRenderMilestones(st, presentCount, attStreaks, recStats, perfectMonths) {
  const attFields = { presentCount, currentStreak: attStreaks.current, longestStreak: attStreaks.longest, perfectMonths };
  const recFields = { sessionCount: recStats.sessionCount || 0, totalPts: recStats.totalPts || 0, streak: recStats.streak || 0, wins: recStats.wins || 0 };

  function msCard(ms, fields) {
    const val     = fields[ms.field] || 0;
    const pct     = Math.min(100, Math.round(val / ms.target * 100));
    const unlocked = val >= ms.target;
    return `<div class="ms-card ${unlocked ? 'unlocked' : 'locked'}">
      <span class="ms-icon">${ms.icon}</span>
      <div class="ms-title">${ms.title}</div>
      <div class="ms-desc">${ms.desc}</div>
      <div class="ms-progress"><div class="ms-progress-fill" style="width:${pct}%;background:${ms.color};box-shadow:0 0 8px ${ms.color}55"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--text-muted);font-weight:700">
        <span>${val} / ${ms.target}</span><span>${pct}%</span>
      </div>
    </div>`;
  }

  const attUnlocked = PROG_ATTENDANCE_MILESTONES.filter(m => (attFields[m.field] || 0) >= m.target).length;
  const recUnlocked = PROG_RECITATION_MILESTONES.filter(m => (recFields[m.field] || 0) >= m.target).length;
  const total        = PROG_ATTENDANCE_MILESTONES.length + PROG_RECITATION_MILESTONES.length;
  const totalUnlocked = attUnlocked + recUnlocked;

  return `
  <div class="glass-card" style="padding:18px;margin-bottom:24px;display:flex;align-items:center;gap:18px">
    <div style="font-size:48px">🏆</div>
    <div style="flex:1">
      <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface)">${totalUnlocked} / ${total} Milestones</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Keep pushing — every achievement counts!</div>
      <div style="background:rgba(255,255,255,.06);border-radius:20px;height:8px;overflow:hidden">
        <div style="height:100%;border-radius:20px;width:${Math.round(totalUnlocked / total * 100)}%;background:linear-gradient(90deg,#8b5cf6,#4edea3);box-shadow:0 0 10px rgba(139,92,246,.5)"></div>
      </div>
    </div>
    <div style="text-align:center;padding:12px 20px;background:rgba(255,185,95,.08);border:1px solid rgba(255,185,95,.2);border-radius:12px">
      <div style="font-family:var(--fh);font-size:32px;font-weight:900;color:#ffd700">${Math.round(totalUnlocked / total * 100)}%</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);font-weight:700">Complete</div>
    </div>
  </div>

  <div class="section-header"><span class="material-symbols-outlined">calendar_today</span><h2>Attendance Milestones</h2><span class="badge-pill bp-green">${attUnlocked}/${PROG_ATTENDANCE_MILESTONES.length} unlocked</span></div>
  <div class="milestone-grid">${PROG_ATTENDANCE_MILESTONES.map(m => msCard(m, attFields)).join('')}</div>

  <div class="section-header"><span class="material-symbols-outlined">mic</span><h2>Recitation Milestones</h2><span class="badge-pill bp-primary">${recUnlocked}/${PROG_RECITATION_MILESTONES.length} unlocked</span></div>
  <div class="milestone-grid">${PROG_RECITATION_MILESTONES.map(m => msCard(m, recFields)).join('')}</div>
  `;
}

function progRenderShowcase(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, attPct) {
  const unlocks     = (DB.achievementUnlocks || {})[st.id] || [];
  const earnedAchs  = unlocks.map(u => (DB.achievements || []).find(a => a.id === u.achId)).filter(Boolean);
  const earnedTitles = (st.unlockedTitles || []).map(tid => (DB.titles || []).find(t => t.id === tid)).filter(Boolean);

  const sorted  = [...DB.students].sort((a, b) => b.xp - a.xp);
  const myRank  = sorted.findIndex(s => s.id === st.id) + 1;
  const trophies = [];

  if (attPct >= 100) trophies.push({ icon: '💎', grade: 'LEGENDARY', gradeColor: '#4edea3', gradeBg: 'rgba(78,222,163,.15)',  title: 'Perfect Attendance',    value: `${attPct}%`,      sub: 'You have never missed a single class. A true legend.', variant: 'emerald' });
  else if (attPct >= 95) trophies.push({ icon: '🏆', grade: 'PLATINUM', gradeColor: '#d0bcff', gradeBg: 'rgba(208,188,255,.15)', title: 'Elite Attendance',     value: `${attPct}%`,      sub: 'Exceptional dedication — only the most committed scholars achieve this.', variant: 'violet' });
  else if (attPct >= 85) trophies.push({ icon: '⭐', grade: 'GOLD',     gradeColor: '#ffd700', gradeBg: 'rgba(255,215,0,.15)',  title: 'Strong Attendance',    value: `${attPct}%`,      sub: 'A reliable presence that teachers and classmates can count on.', variant: 'gold' });
  else if (attPct > 0)   trophies.push({ icon: '📅', grade: 'BRONZE',   gradeColor: '#cd7f32', gradeBg: 'rgba(205,127,50,.15)',  title: 'Attendance Record',   value: `${attPct}%`,      sub: 'Building good attendance habits.', variant: 'bronze' });

  if (attStreaks.longest >= 14) trophies.push({ icon: '🔥', grade: 'EPIC',   gradeColor: '#ef4444', gradeBg: 'rgba(239,68,68,.15)',   title: 'Attendance Streak Record', value: `${attStreaks.longest} days`, sub: 'Your best run of consecutive days present. Incredible discipline.', variant: 'gold' });
  else if (attStreaks.longest >= 7) trophies.push({ icon: '🔥', grade: 'RARE', gradeColor: '#f97316', gradeBg: 'rgba(249,115,22,.15)',  title: 'Week-Long Streak',   value: `${attStreaks.longest} days`, sub: 'A full week of consecutive attendance. Keep building!', variant: 'silver' });
  else if (attStreaks.longest >= 3) trophies.push({ icon: '🔥', grade: 'COMMON',gradeColor:'#ffb95f', gradeBg: 'rgba(255,185,95,.15)', title: 'Attendance Streak',  value: `${attStreaks.longest} days`, sub: 'Your current best streak. Aim higher!', variant: 'bronze' });

  if (perfectMonths >= 3) trophies.push({ icon: '💎', grade: 'LEGENDARY', gradeColor: '#a78bfa', gradeBg: 'rgba(167,139,250,.15)', title: 'Diamond Attendance', value: `${perfectMonths} perfect months`, sub: 'Three or more months of flawless attendance. Extraordinary commitment.', variant: 'violet' });
  else if (perfectMonths >= 1) trophies.push({ icon: '🌟', grade: 'GOLD',   gradeColor: '#ffd700', gradeBg: 'rgba(255,215,0,.15)',  title: 'Perfect Month',      value: `${perfectMonths} month${perfectMonths > 1 ? 's' : ''}`, sub: 'Zero absences for an entire month. Outstanding achievement!', variant: 'gold' });

  const sessCount = recStats.sessionCount || recitations.length;
  if (sessCount >= 25)      trophies.push({ icon: '👑', grade: 'EPIC',   gradeColor: '#ffd700', gradeBg: 'rgba(255,215,0,.15)',  title: 'Recitation Master',   value: `${sessCount} sessions`, sub: '25+ recitation sessions. A true voice of the classroom.', variant: 'gold' });
  else if (sessCount >= 10) trophies.push({ icon: '🎙️',grade: 'RARE',   gradeColor: '#4edea3', gradeBg: 'rgba(78,222,163,.15)', title: 'Vocal Scholar',       value: `${sessCount} sessions`, sub: '10+ recitations completed. Your voice matters!', variant: 'emerald' });
  else if (sessCount >= 1)  trophies.push({ icon: '🎤', grade: 'COMMON', gradeColor: '#4edea3', gradeBg: 'rgba(78,222,163,.15)', title: 'Active Participant',  value: `${sessCount} sessions`, sub: "You've started your recitation journey. Keep it up!", variant: 'silver' });

  const totalRecPts = recStats.totalPts || 0;
  if (totalRecPts >= 500)      trophies.push({ icon: '💥', grade: 'LEGENDARY', gradeColor: '#ffd700', gradeBg: 'rgba(255,215,0,.15)',  title: 'Recitation Elite',    value: `${totalRecPts} pts`, sub: '500+ recitation points earned. An academic force to be reckoned with.', variant: 'gold' });
  else if (totalRecPts >= 150) trophies.push({ icon: '⚡', grade: 'GOLD',     gradeColor: '#d0bcff', gradeBg: 'rgba(208,188,255,.15)', title: 'Point Powerhouse',    value: `${totalRecPts} pts`, sub: '150+ points through recitation. Your contributions truly shine.', variant: 'violet' });

  if (myRank === 1)      trophies.push({ icon: '🥇', grade: 'LEGENDARY', gradeColor: '#ffd700', gradeBg: 'rgba(255,215,0,.15)', title: 'Class Champion',   value: 'Rank #1',         sub: 'Top of the entire class leaderboard. The undisputed champion.', variant: 'gold' });
  else if (myRank <= 3)  trophies.push({ icon: '🏅', grade: 'EPIC',     gradeColor: '#ffd700', gradeBg: 'rgba(255,215,0,.15)', title: `Top ${myRank} Leaderboard`, value: `Rank #${myRank}`, sub: `Among the top 3 students in your class. Elite performance.`, variant: 'gold' });
  else if (myRank <= 5)  trophies.push({ icon: '⭐', grade: 'RARE',     gradeColor: '#ffb95f', gradeBg: 'rgba(255,185,95,.15)', title: 'Top 5 Scholar',    value: `Rank #${myRank}`, sub: 'Inside the top 5 in class rankings. A strong competitor.', variant: 'silver' });

  const topRecSession = recitations.length ? Math.max(...recitations.map(r => r.pts || 0)) : 0;

  return `
  <div class="showcase-header">
    <span class="showcase-crown">👑</span>
    <div class="showcase-title-text">ACADEMIC SHOWCASE</div>
    <div class="showcase-sub" style="position:relative;z-index:1">${st.name} · ${st.tier} · Level ${st.level}</div>
  </div>

  <div class="section-header">
    <span class="material-symbols-outlined">share</span>
    <h2>Your Highlight Card</h2>
  </div>
  <div class="share-card">
    <div class="share-card-inner">
      <div class="share-watermark">EduQuest · Academic Achievement Profile</div>
      <div class="share-student-row">
        <div style="width:96px;height:96px;border-radius:50%;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-size:32px;font-weight:900;background:${st.color + '33'};color:${st.color};border:3px solid ${st.color + '55'};box-shadow:0 0 30px ${st.color + '33'}">${
          st.profilePic
            ? `<img src="${st.profilePic}" alt="${st.init}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" onerror="this.remove()">`
            : st.init
        }</div>
        <div>
          <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface)">${st.name}</div>
          <div style="font-size:13px;color:var(--text-muted)">${st.tier} · Level ${st.level} · Rank #${myRank}</div>
        </div>
      </div>
      <div class="share-stats-grid">
        ${[
          { sv: `${attPct}%`,  sl: 'Attendance',    c: '#4edea3' },
          { sv: attStreaks.longest, sl: 'Best Streak', c: '#f97316' },
          { sv: sessCount,     sl: 'Recitations',   c: '#d0bcff' },
          { sv: perfectMonths, sl: 'Perfect Months', c: '#ffd700' },
          { sv: totalRecPts,   sl: 'Rec Points',    c: '#4edea3' },
          { sv: topRecSession, sl: 'Best Score',    c: '#ffb95f' },
        ].map(s => `<div class="share-stat"><div class="sv" style="color:${s.c}">${s.sv}</div><div class="sl">${s.sl}</div></div>`).join('')}
      </div>
      <div class="share-badges-row">
        ${attPct >= 90    ? `<span class="share-badge-chip" style="background:rgba(78,222,163,.15);border:1px solid rgba(78,222,163,.3);color:#4edea3">📅 ${attPct}% Attendance</span>` : ''}
        ${attStreaks.longest >= 7 ? `<span class="share-badge-chip" style="background:rgba(255,185,95,.15);border:1px solid rgba(255,185,95,.3);color:#ffb95f">🔥 ${attStreaks.longest}-Day Streak</span>` : ''}
        ${perfectMonths > 0 ? `<span class="share-badge-chip" style="background:rgba(208,188,255,.15);border:1px solid rgba(208,188,255,.3);color:#d0bcff">💎 Perfect Month</span>` : ''}
        ${myRank <= 3     ? `<span class="share-badge-chip" style="background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.3);color:#ffd700">🥇 Top ${myRank}</span>` : ''}
        ${earnedTitles.length > 0 ? `<span class="share-badge-chip" style="background:rgba(236,72,153,.15);border:1px solid rgba(236,72,153,.3);color:#EC4899">🎖️ ${earnedTitles[0].name}</span>` : ''}
      </div>
    </div>
  </div>

  <div class="section-header" style="margin-top:24px">
    <span class="material-symbols-outlined">emoji_events</span>
    <h2>Trophy Room</h2>
    <span class="badge-pill bp-gold">${trophies.length} trophies</span>
  </div>
  ${trophies.length ? `
  <div class="trophy-grid">
    ${trophies.map(t => `
    <div class="trophy-card ${t.variant || ''}">
      <div class="trophy-icon-row">
        <span class="trophy-icon">${t.icon}</span>
        <span class="trophy-grade" style="color:${t.gradeColor};background:${t.gradeBg};border:1px solid ${t.gradeColor}33">${t.grade}</span>
      </div>
      <div class="trophy-card-title">${t.title}</div>
      <div class="trophy-card-value" style="color:${t.gradeColor}">${t.value}</div>
      <div class="trophy-card-sub">${t.sub}</div>
    </div>`).join('')}
  </div>` : `
  <div style="text-align:center;padding:56px 20px;background:rgba(35,31,56,.7);border:1px solid var(--border);border-radius:16px;margin-bottom:24px">
    <div style="font-size:48px;margin-bottom:12px">🏆</div>
    <div style="font-family:var(--fh);font-size:16px;font-weight:800;margin-bottom:6px">No trophies yet</div>
    <div style="color:var(--text-muted);font-size:13px">Attend class, recite, and earn perfect months to fill your trophy room!</div>
  </div>`}

  ${earnedAchs.length ? `
  <div class="section-header" style="margin-top:24px">
    <span class="material-symbols-outlined">workspace_premium</span>
    <h2>Achievements Earned</h2>
    <span class="badge-pill bp-primary">${earnedAchs.length} unlocked</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:28px">
    ${earnedAchs.map(a => `
    <div class="glass-card" style="padding:16px;text-align:center;border-color:rgba(255,185,95,.25)">
      <div style="font-size:32px;margin-bottom:8px">${a.icon || '🏆'}</div>
      <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface);margin-bottom:4px">${a.name}</div>
      <div style="font-size:11px;color:var(--text-muted)">${a.description}</div>
    </div>`).join('')}
  </div>` : ''}

  ${earnedTitles.length ? `
  <div class="section-header">
    <span class="material-symbols-outlined">military_tech</span>
    <h2>Titles Earned</h2>
    <span class="badge-pill bp-gold">${earnedTitles.length} titles</span>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:28px">
    ${earnedTitles.map(t => `
    <div style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:12px;background:${t.bgColor || 'rgba(255,215,0,.1)'};border:2px solid ${t.borderColor || 'rgba(255,215,0,.4)'};font-family:var(--fh);font-size:14px;font-weight:800;color:${t.textColor || '#ffd700'}">
      ${t.icon || '🎖️'} ${t.name}
    </div>`).join('')}
  </div>` : ''}
  `;
}

// ── Main Render ───────────────────────────────────────────────────────────────

/**
 * renderStudentProgress() → void  [window.renderStudentProgress]
 *
 * Renders the full "My Progress" page (s-attendance) for the current student.
 * Tabs: Streaks & Stats | Attendance Calendar | Recitation History | Milestones | Academic Showcase
 *
 * DEPENDENCY: eqlComputeRecitation() — typeof guard (leaderboard module provides it).
 */
window.renderStudentProgress = function () {
  const st = currentUser;
  if (!st) {
    document.getElementById('s-attendance').innerHTML =
      '<div class="page" style="padding:40px;text-align:center;color:var(--text-muted)">Not logged in</div>';
    return;
  }

  DB = loadDB();
  const attendanceSess = progGetAttendanceForStudent(st.id);
  const recitations    = progGetRecitationsForStudent(st.id);
  const presentCount   = attendanceSess.filter(a => a.status === 'present').length;
  const absentCount    = attendanceSess.filter(a => a.status === 'absent').length;
  const totalSess      = attendanceSess.length;
  const attPct         = totalSess > 0 ? Math.round(presentCount / totalSess * 100) : 0;
  const attStreaks     = progAttStreak(attendanceSess);
  const recStreaks     = progRecStreak(recitations);
  const perfectMonths  = progPerfectMonths(attendanceSess);
  const recStats       = typeof eqlComputeRecitation === 'function'
    ? eqlComputeRecitation(st.id)
    : { totalPts: 0, sessionCount: recitations.length, streak: 0, wins: 0 };

  document.getElementById('s-attendance').innerHTML = `
  <div class="prog-hero">
    <div class="prog-hero-grid">
      <div>
        <div class="prog-hero-label">📊 Academic Progress</div>
        <div class="prog-hero-name">${_esc(st.name)}</div>
        <div class="prog-hero-sub">${_esc(st.tier)} · Level ${st.level} · <span style="color:var(--primary)">Your Complete Record</span></div>
        <div class="prog-stat-strip">
          <div class="prog-stat-chip"><span class="v" style="color:#4edea3">${attPct}%</span><span class="l">Attendance</span></div>
          <div class="prog-stat-chip"><span class="v" style="color:#f97316">${attStreaks.current}</span><span class="l">Current Streak</span></div>
          <div class="prog-stat-chip"><span class="v" style="color:#d0bcff">${recStats.sessionCount || recitations.length}</span><span class="l">Recitations</span></div>
          <div class="prog-stat-chip"><span class="v" style="color:#ffd700">${perfectMonths}</span><span class="l">Perfect Months</span></div>
        </div>
      </div>
      <div class="prog-hero-avatar" style="background:${st.color + '22'};color:${st.color};border-color:${st.color + '44'};box-shadow:0 0 40px ${st.color + '44'}">${_esc(st.init)}</div>
    </div>
  </div>

  <div class="prog-tabs">
    <button class="prog-tab ${progActiveTab === 'streaks'    ? 'active' : ''}" onclick="progSwitchTab('streaks')"><span class="material-symbols-outlined">local_fire_department</span>Streaks &amp; Stats</button>
    <button class="prog-tab ${progActiveTab === 'calendar'   ? 'active' : ''}" onclick="progSwitchTab('calendar')"><span class="material-symbols-outlined">calendar_month</span>Attendance Calendar</button>
    <button class="prog-tab ${progActiveTab === 'recitation' ? 'active' : ''}" onclick="progSwitchTab('recitation')"><span class="material-symbols-outlined">mic</span>Recitation History</button>
    <button class="prog-tab ${progActiveTab === 'milestones' ? 'active' : ''}" onclick="progSwitchTab('milestones')"><span class="material-symbols-outlined">emoji_events</span>Milestones</button>
    <button class="prog-tab ${progActiveTab === 'showcase'   ? 'active' : ''}" onclick="progSwitchTab('showcase')"><span class="material-symbols-outlined">workspace_premium</span>Academic Showcase</button>
  </div>

  <div class="prog-panel ${progActiveTab === 'streaks'    ? 'active' : ''}" id="prog-panel-streaks">
    ${progRenderStreaks(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, absentCount, attPct)}
  </div>
  <div class="prog-panel ${progActiveTab === 'calendar'   ? 'active' : ''}" id="prog-panel-calendar">
    ${progRenderCalendarPanel(st)}
  </div>
  <div class="prog-panel ${progActiveTab === 'recitation' ? 'active' : ''}" id="prog-panel-recitation">
    ${progRenderRecitationPanel(st, recitations, recStats, recStreaks)}
  </div>
  <div class="prog-panel ${progActiveTab === 'milestones' ? 'active' : ''}" id="prog-panel-milestones">
    ${progRenderMilestones(st, presentCount, attStreaks, recStats, perfectMonths)}
  </div>
  <div class="prog-panel ${progActiveTab === 'showcase'   ? 'active' : ''}" id="prog-panel-showcase">
    ${progRenderShowcase(st, attendanceSess, recitations, attStreaks, recStreaks, perfectMonths, recStats, presentCount, attPct)}
  </div>
  `;
};

// ── Tab Switcher ──────────────────────────────────────────────────────────────

/**
 * progSwitchTab(tab) → void  [window.progSwitchTab]
 * Switches the active progress tab and re-renders the page.
 * tab: 'streaks' | 'calendar' | 'recitation' | 'milestones' | 'showcase'
 */
window.progSwitchTab = function (tab) {
  progActiveTab = tab;
  window.renderStudentProgress();
};

// ── Calendar Navigation ───────────────────────────────────────────────────────

/**
 * progCalNav(dir) → void  [window.progCalNav]
 * Advances/rewinds the calendar month by dir (+1 / -1).
 * Re-renders only the calendar panel (no full page re-render).
 */
window.progCalNav = function (dir) {
  progCalMonth += dir;
  if (progCalMonth < 0)  { progCalMonth = 11; progCalYear--; }
  else if (progCalMonth > 11) { progCalMonth = 0; progCalYear++; }
  const panel = document.getElementById('prog-panel-calendar');
  if (panel) panel.innerHTML = progRenderCalendarPanel(currentUser);
};

/**
 * progShowCalDay(day, year, month) → void  [window.progShowCalDay]
 * Shows the detail panel for a clicked calendar day.
 * Called from onclick="progShowCalDay(d, year, month)" in calendar cells.
 */
window.progShowCalDay = function (day, year, month) {
  const calData = progBuildCalendar(currentUser.id, year, month);
  const d = calData[day];
  if (!d) return;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${months[month]} ${day}, ${year}`;

  let html = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <div style="font-size:28px">${d.status === 'present' ? '✅' : d.status === 'absent' ? '❌' : '📋'}</div>
    <div>
      <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface)">${dateStr}</div>
      <div style="font-size:12px;color:${d.status === 'present' ? '#4edea3' : d.status === 'absent' ? '#ffb4ab' : 'var(--text-muted)'};font-weight:700;margin-top:2px">
        ${d.status === 'present' ? 'Present' : d.status === 'absent' ? 'Absent' : 'No attendance recorded'}
      </div>
    </div>
  </div>`;

  if (d.recitations.length) {
    html += `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">🎤 Recitations (${d.recitations.length})</div>`;
    d.recitations.forEach(r => {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(78,222,163,.06);border:1px solid rgba(78,222,163,.15);border-radius:8px;margin-bottom:6px;font-size:12px">
        <span style="color:var(--on-surface)">${r.note || 'Recitation'}</span>
        <span style="color:#4edea3;font-weight:800">+${r.pts} pts</span>
      </div>`;
    });
  }
  if (d.quizzes.length) {
    html += `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-top:10px;margin-bottom:8px">📝 Quests Completed (${d.quizzes.length})</div>`;
    d.quizzes.forEach(q => {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,185,95,.06);border:1px solid rgba(255,185,95,.15);border-radius:8px;margin-bottom:6px;font-size:12px">
        <span style="color:var(--on-surface)">${(q.what || '').replace('Quest: ', '')}</span>
        <span style="color:#ffb95f;font-weight:800">+${q.pts} XP</span>
      </div>`;
    });
  }
  if (!d.recitations.length && !d.quizzes.length && !d.status) {
    html += `<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:8px">No activities recorded for this day.</div>`;
  }

  const detail = document.getElementById('cal-day-detail');
  if (detail) { detail.innerHTML = html; detail.classList.add('open'); }
};

console.log('[EduQuest] recitation/progress.js loaded — renderStudentProgress, progSwitchTab, progCalNav, progShowCalDay registered.');
