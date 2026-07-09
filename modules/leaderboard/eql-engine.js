/* ============================================================
   modules/leaderboard/eql-engine.js
   EduQuest Leaderboard (EQL) — Pure Score Computation Layer

   Depends on globals: DB, saveDB()
   Exports via window.EQL  (object)
   Private functions stay file-scoped (no window.* needed —
   they are only called from within this IIFE and from
   hall-of-fame.js / admin-leaderboard.js which share scope
   because all files load in the same global page).

   NOTE: eqlComputeRecitation / eqlComputeBoss /
   eqlComputeAcademic / eqlComputeOverall / eqlBuildCategory
   are intentionally left as plain function declarations so
   hall-of-fame.js and admin-leaderboard.js (loaded after
   this file) can call them directly as globals.
   ============================================================ */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // 0. DB MIGRATION — ensure leaderboard config exists in localStorage DB
  // [SUPABASE MIGRATION] Deferred until AppStore.ready resolves — see the
  // matching note in modules/shop/shop_pos_terminal.js for why this can no
  // longer run synchronously at parse time.
  // ─────────────────────────────────────────────────────────────────────────────
  AppStore.ready.then(function eqlMigrate() {
    if (!DB.leaderboardConfig) {
      DB.leaderboardConfig = {
        recitation: { enabled: true,  resetAt: null, label: 'Recitation',  icon: '🎤', color: '#4edea3' },
        boss:       { enabled: true,  resetAt: null, label: 'Boss Raider', icon: '⚔️',  color: '#EC4899' },
        academic:   { enabled: true,  resetAt: null, label: 'Academic',    icon: '📚', color: '#d0bcff' },
        overall:    { enabled: true,  resetAt: null, label: 'Overall',     icon: '🏆', color: '#ffb95f' },
      };
      saveDB();
    }
    // Back-fill any missing keys non-destructively
    const defaults = { enabled: true, resetAt: null };
    ['recitation', 'boss', 'academic', 'overall'].forEach(k => {
      if (!DB.leaderboardConfig[k]) DB.leaderboardConfig[k] = Object.assign({}, defaults);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. RECITATION STATS  (from DB.recitationLog)
  //    Returns: { totalPts, sessionCount, streak, wins, qrCount }
  // ─────────────────────────────────────────────────────────────────────────────
  window.eqlComputeRecitation = function eqlComputeRecitation(sid, resetAt) {
    // BUGFIX: this used to filter/group by `r.when`, a cosmetic display
    // string ("Just now", "2 hours ago") that is NOT a parseable date —
    // `new Date(r.when)` is Invalid Date, and Invalid Date comparisons are
    // always false. That silently dropped every entry from any resetAt-
    // scoped leaderboard period (Invalid Date >= resetAt is always false)
    // and made the streak calculation below group everything under one
    // bogus "day". `createdAt` is the table's real timestamp column (always
    // populated — see phase3_recitation_command_center.sql) and is what
    // this should have used from the start.
    const log = (DB.recitationLog || []).filter(r => {
      if (r.studentId !== sid) return false;
      if (resetAt) { try { return new Date(r.createdAt || 0) >= new Date(resetAt); } catch (e) {} }
      return true;
    });

    const totalPts     = log.reduce((a, r) => a + (r.pts || 0), 0);
    const sessionCount = log.length;

    // QR-based recitations are identified by a 'qr:true' flag or note containing 'QR'
    const qrCount = log.filter(r => r.qr === true || (r.note || '').toUpperCase().includes('QR')).length;

    // Streak: consecutive sessions (by date string) without a gap day
    let streak = 0;
    if (log.length > 0) {
      // Group by calendar date (real timestamp, not the cosmetic label)
      const daySet = new Set(log.map(r => (r.createdAt || '').slice(0, 10)));
      const dayArr = [...daySet].sort();
      let cur = 1, max = 1;
      for (let i = 1; i < dayArr.length; i++) {
        // Simple consecutive-day heuristic: if two entries share back-to-back dates
        const a = new Date(dayArr[i - 1]), b = new Date(dayArr[i]);
        const diff = (b - a) / 86400000;
        if (diff <= 1) { cur++; if (cur > max) max = cur; }
        else cur = 1;
      }
      streak = max;
    }

    // Wins: sessions where pts >= 15 (above-average contribution)
    const winThreshold = 15;
    const wins = log.filter(r => (r.pts || 0) >= winThreshold).length;

    return { totalPts, sessionCount, streak, wins, qrCount };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. BOSS STATS  (from DB.bossParticipants, DB.bossEvents)
  //    Returns: { totalDamage, participationCount, victories, mvpCount,
  //               totalCrits, totalMinionsKilled, totalCorrect }
  // ─────────────────────────────────────────────────────────────────────────────
  window.eqlComputeBoss = function eqlComputeBoss(sid, resetAt) {
    let totalDamage = 0, participationCount = 0, victories = 0, mvpCount = 0;
    let totalCrits = 0, totalMinionsKilled = 0, totalCorrect = 0;

    (DB.bossEvents || []).forEach((boss, bi) => {
      // Apply period reset filter by boss startTime
      if (resetAt) { try { if (new Date(boss.startedAt || boss.createdAt || 0) < new Date(resetAt)) return; } catch (e) {} }

      const roster = (DB.bossParticipants || {})[bi] || {};
      const rec = roster[sid];
      if (!rec) return; // student didn't participate in this boss

      totalDamage        += (rec.totalDamage      || 0);
      totalCrits         += (rec.critHits         || 0);
      totalMinionsKilled += (rec.minionsDefeated  || 0);
      totalCorrect       += (rec.correctAnswers   || 0);
      participationCount++;

      // Count as victory if boss ended/loot and student dealt damage
      if ((boss.status === 'ended' || boss.status === 'loot') && (rec.totalDamage || 0) > 0) {
        victories++;
      }

      // MVP detection: rank #1 by damage within this boss
      const participants = Object.values(roster);
      if (participants.length > 0) {
        const sorted = [...participants].sort((a, b) => (b.totalDamage || 0) - (a.totalDamage || 0));
        if (sorted[0] && sorted[0].studentId === sid) mvpCount++;
        // Fallback for older records that may use the student id as key
        else if (participants[0] && Object.keys(roster)[0] === sid) mvpCount++;
      }
    });

    return { totalDamage, participationCount, victories, mvpCount, totalCrits, totalMinionsKilled, totalCorrect };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. ACADEMIC STATS  (from DB.pointLog, student.completedQuizzes, DB.quizzes)
  //    Returns: { academicXP, quizCount, perfectScores, bestScore, avgScore,
  //               questCompletions, perfectStreak }
  // ─────────────────────────────────────────────────────────────────────────────
  window.eqlComputeAcademic = function eqlComputeAcademic(sid, resetAt) {
    // Filter point log entries that are quest/quiz related
    const questLog = (DB.pointLog || []).filter(e => {
      if (e.studentId !== sid) return false;
      if (!e.what || !e.what.startsWith('Quest:')) return false;
      if (resetAt) { try { return new Date(e.when || 0) >= new Date(resetAt); } catch (e2) {} }
      return true;
    });

    const student    = DB.students.find(s => s.id === sid);
    const academicXP = questLog.reduce((a, e) => a + Math.abs(e.pts || 0), 0);
    const quizCount  = questLog.length;

    let scores = [];
    questLog.forEach(e => {
      const m = (e.what || '').match(/\((\d+)%\)/);
      if (m) scores.push(parseInt(m[1]));
    });

    const perfectScores    = scores.filter(s => s >= 100).length;
    const bestScore        = scores.length ? Math.max(...scores) : 0;
    const avgScore         = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const questCompletions = student ? (student.completedQuizzes || []).length : 0;

    // Perfect streak: max consecutive 100% scores in chronological order
    let maxPerfectStreak = 0, curStreak = 0;
    // questLog is newest-first; reverse for chronological
    [...questLog].reverse().forEach(e => {
      const m = (e.what || '').match(/\((\d+)%\)/);
      if (m && parseInt(m[1]) >= 100) { curStreak++; if (curStreak > maxPerfectStreak) maxPerfectStreak = curStreak; }
      else curStreak = 0;
    });

    return { academicXP, quizCount, perfectScores, bestScore, avgScore, questCompletions, perfectStreak: maxPerfectStreak };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. OVERALL COMPOSITE SCORE
  //    Weighted blend across all three pillars.
  //    Weights are calibrated so no single activity dominates.
  // ─────────────────────────────────────────────────────────────────────────────
  window.eqlComputeOverall = function eqlComputeOverall(sid, resetAt) {
    const R = eqlComputeRecitation(sid, resetAt);
    const B = eqlComputeBoss(sid, resetAt);
    const A = eqlComputeAcademic(sid, resetAt);
    const student = DB.students.find(s => s.id === sid);

    // Base XP component (core progression)
    const baseXP = student ? (student.xp || 0) : 0;

    // Weighted composite:
    //   Academic XP          × 1.0  (direct XP contribution)
    //   Recitation points    × 2.5  (encourage participation)
    //   Boss damage          × 0.15 (scale down large numbers)
    //   Boss victories       × 400  (reward completion)
    //   Perfect scores       × 200
    //   Recitation streak    × 150
    //   MVP count            × 500
    const score = Math.round(
      baseXP * 1.0 +
      R.totalPts * 2.5 +
      B.totalDamage * 0.15 +
      B.victories * 400 +
      A.perfectScores * 200 +
      R.streak * 150 +
      B.mvpCount * 500
    );

    return {
      score, baseXP,
      recitationPts: R.totalPts,
      bossDamage: B.totalDamage,
      bossVictories: B.victories,
      perfectScores: A.perfectScores,
      recitationStreak: R.streak,
      mvpCount: B.mvpCount,
      // raw pillars for display
      recitation: R, boss: B, academic: A,
    };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. CATEGORY BUILDER — returns sorted, ranked entries for a given category key
  //    Shape: [{ rank, student, stats, score, scoreLabel }]
  // ─────────────────────────────────────────────────────────────────────────────
  window.eqlBuildCategory = function eqlBuildCategory(key) {
    const cfg     = (DB.leaderboardConfig || {})[key] || {};
    const resetAt = cfg.resetAt || null;

    // Phase 14: leaderboard is per-section, not school-wide — otherwise
    // every teacher's students get ranked against every other section's,
    // which is exactly the "shouldn't be global" behavior flagged in review.
    const activeClassId = window.ActiveSection ? window.ActiveSection.get() : null;
    const scopedStudents = activeClassId
      ? DB.students.filter(s => s.classId === activeClassId)
      : DB.students; // no active section selected yet (e.g. first load) — fall back to unscoped rather than showing an empty board

    const entries = scopedStudents.map(student => {
      let stats, score, scoreLabel;
      switch (key) {
        case 'recitation': {
          stats      = eqlComputeRecitation(student.id, resetAt);
          score      = stats.totalPts;
          scoreLabel = score.toLocaleString() + ' pts';
          break;
        }
        case 'boss': {
          stats      = eqlComputeBoss(student.id, resetAt);
          score      = stats.totalDamage;
          scoreLabel = score.toLocaleString() + ' DMG';
          break;
        }
        case 'academic': {
          stats      = eqlComputeAcademic(student.id, resetAt);
          score      = stats.academicXP + stats.perfectScores * 200 + stats.questCompletions * 50;
          scoreLabel = score.toLocaleString() + ' pts';
          break;
        }
        case 'overall':
        default: {
          stats      = eqlComputeOverall(student.id, resetAt);
          score      = stats.score;
          scoreLabel = score.toLocaleString() + ' pts';
          break;
        }
      }
      return { student, stats, score, scoreLabel };
    });

    // Sort descending by score
    entries.sort((a, b) => b.score - a.score);

    // Assign ranks (ties share the same rank)
    let currentRank = 1;
    entries.forEach((e, i) => {
      if (i > 0 && entries[i - 1].score === e.score) e.rank = entries[i - 1].rank;
      else { e.rank = currentRank; }
      currentRank = e.rank + 1;
    });

    return entries;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────
  window.EQL = {
    /**
     * Get ranked leaderboard for a category.
     * @param {string} key  'recitation' | 'boss' | 'academic' | 'overall'
     * @returns {Array}  Sorted entries with rank, student, stats, score, scoreLabel
     */
    getLeaderboard(key) { return eqlBuildCategory(key); },

    /**
     * Get config for all leaderboard categories.
     */
    getConfig() { return DB.leaderboardConfig || {}; },

    /**
     * Enable or disable a leaderboard category.
     * @param {string} key
     * @param {boolean} enabled
     */
    setEnabled(key, enabled) {
      if (!DB.leaderboardConfig) return;
      if (!DB.leaderboardConfig[key]) return;
      DB.leaderboardConfig[key].enabled = !!enabled;
      saveDB();
    },

    /**
     * Reset a leaderboard period (sets resetAt to now; future calculations
     * only count activity after this timestamp).
     * @param {string} key
     */
    resetPeriod(key) {
      if (!DB.leaderboardConfig) return;
      if (!DB.leaderboardConfig[key]) return;
      DB.leaderboardConfig[key].resetAt = new Date().toISOString();
      saveDB();
    },

    /**
     * Clear the reset timestamp so the leaderboard counts all-time activity.
     * @param {string} key
     */
    clearReset(key) {
      if (!DB.leaderboardConfig) return;
      if (!DB.leaderboardConfig[key]) return;
      DB.leaderboardConfig[key].resetAt = null;
      saveDB();
    },

    /**
     * Aggregate statistics for admin overview panel.
     */
    getStats() {
      const keys  = ['recitation', 'boss', 'academic', 'overall'];
      const stats = {};
      keys.forEach(k => {
        const entries = eqlBuildCategory(k);
        const cfg     = (DB.leaderboardConfig || {})[k] || {};
        stats[k] = {
          enabled:          cfg.enabled !== false,
          resetAt:          cfg.resetAt || null,
          participantCount: entries.filter(e => e.score > 0).length,
          totalStudents:    entries.length,
          topScore:         entries.length ? entries[0].score : 0,
          topStudent:       entries.length ? entries[0].student.name : '—',
        };
      });
      return stats;
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. CSS — EQL tab bar, row, rank badge, avatar, stat pills, admin panel
  // ─────────────────────────────────────────────────────────────────────────────
  (function injectEqlStyles() {
    const style = document.createElement('style');
    style.textContent = `
/* ── EQL: Leaderboard Category Tabs ── */
.eql-tab-bar{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px;overflow-x:auto;flex-shrink:0}
.eql-tab{display:flex;align-items:center;gap:7px;padding:11px 18px;font-size:13px;font-weight:700;
  letter-spacing:.03em;color:var(--text-muted);background:none;border:none;cursor:pointer;
  border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s;font-family:var(--fb)}
.eql-tab:hover{color:var(--on-surface)}
.eql-tab.active{color:var(--primary);border-bottom-color:var(--primary-dark)}
.eql-tab .eql-tab-icon{font-size:16px}
.eql-tab .eql-count{font-size:10px;padding:1px 6px;border-radius:10px;
  background:rgba(208,188,255,.12);color:var(--primary);font-weight:800;margin-left:2px}

/* ── EQL: Leaderboard Row ── */
.eql-row{display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:12px;
  border:1px solid var(--border);background:rgba(35,31,56,0.7);transition:all .2s;margin-bottom:6px}
.eql-row:hover{border-color:rgba(208,188,255,0.2);background:rgba(35,31,56,0.9)}
.eql-row.me{border-color:rgba(208,188,255,0.45);background:rgba(208,188,255,0.06);
  box-shadow:0 0 14px rgba(208,188,255,0.08)}
.eql-row.top3{border-color:rgba(255,185,95,0.2);background:rgba(255,185,95,0.04)}

/* ── EQL: Rank Badge ── */
.eql-rank{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-family:var(--fm);font-size:11px;font-weight:900;flex-shrink:0;
  background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid rgba(255,255,255,0.08)}
.eql-rank.r1{background:rgba(255,185,95,.15);color:#ffb95f;border-color:rgba(255,185,95,.35)}
.eql-rank.r2{background:rgba(203,213,225,.1);color:#cbd5e1;border-color:rgba(203,213,225,.25)}
.eql-rank.r3{background:rgba(205,127,50,.1);color:#cd7f32;border-color:rgba(205,127,50,.25)}

/* ── EQL: Avatar ── */
.eql-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:var(--fh);font-weight:900;font-size:12px;flex-shrink:0;position:relative;overflow:hidden}

/* ── EQL: Info block ── */
.eql-info{flex:1;min-width:0}
.eql-info-name{font-family:var(--fh);font-size:13px;font-weight:800;color:var(--on-surface);
  display:flex;align-items:center;gap:6px}
.eql-info-sub{font-size:11px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eql-you-badge{font-size:9px;color:var(--primary);font-family:var(--fm);background:rgba(208,188,255,.12);
  padding:1px 6px;border-radius:6px;border:1px solid rgba(208,188,255,.2)}

/* ── EQL: Score cell ── */
.eql-score{text-align:right;flex-shrink:0;min-width:80px}
.eql-score-main{font-family:var(--fh);font-size:14px;font-weight:900}
.eql-score-label{font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;margin-top:1px}

/* ── EQL: Stat pills below row ── */
.eql-stat-pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.eql-stat-pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;
  font-size:10px;font-weight:700;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
  color:var(--text-muted)}

/* ── EQL: Empty state ── */
.eql-empty{text-align:center;padding:60px 20px;color:var(--text-muted)}
.eql-empty-icon{font-size:48px;margin-bottom:12px}
.eql-empty-title{font-family:var(--fh);font-size:16px;font-weight:800;color:var(--on-surface);margin-bottom:6px}
.eql-empty-sub{font-size:13px;line-height:1.5}

/* ── EQL: Admin panel ── */
.eql-admin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:28px}
.eql-admin-card{background:rgba(35,31,56,.8);border:1px solid var(--border);border-radius:16px;
  padding:20px;backdrop-filter:blur(12px);position:relative;overflow:hidden;transition:border .2s}
.eql-admin-card.disabled{opacity:.55}
.eql-admin-card-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px}
.eql-admin-card-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;
  justify-content:center;font-size:22px;flex-shrink:0;border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.04)}
.eql-admin-card-title{font-family:var(--fh);font-size:15px;font-weight:800;color:var(--on-surface);margin-bottom:3px}
.eql-admin-card-sub{font-size:11px;color:var(--text-muted)}
.eql-toggle{width:42px;height:24px;border-radius:12px;border:none;cursor:pointer;position:relative;
  flex-shrink:0;transition:background .2s;background:rgba(255,255,255,.1)}
.eql-toggle.on{background:#8b5cf6}
.eql-toggle::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;
  border-radius:50%;background:#fff;transition:transform .2s}
.eql-toggle.on::after{transform:translateX(18px)}
.eql-admin-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.eql-admin-stat{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);
  border-radius:10px;padding:10px 12px;text-align:center}
.eql-admin-stat-val{font-family:var(--fh);font-size:18px;font-weight:900;color:var(--on-surface)}
.eql-admin-stat-lbl{font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;margin-top:3px}
.eql-admin-actions{display:flex;gap:8px;flex-wrap:wrap}
.eql-reset-badge{font-size:10px;color:var(--text-muted);margin-top:8px;padding:4px 10px;
  background:rgba(255,255,255,.03);border-radius:6px;border:1px solid rgba(255,255,255,.06)}

/* ── EQL: Category header accent strip ── */
.eql-admin-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:16px 16px 0 0}
.eql-admin-card.cat-recitation::before{background:linear-gradient(90deg,#4edea3,#06b6d4)}
.eql-admin-card.cat-boss::before{background:linear-gradient(90deg,#EC4899,#9333ea)}
.eql-admin-card.cat-academic::before{background:linear-gradient(90deg,#8b5cf6,#d0bcff)}
.eql-admin-card.cat-overall::before{background:linear-gradient(90deg,#ffb95f,#f97316)}

/* ── EQL: Overall podium override ── */
.eql-podium{display:flex;align-items:flex-end;justify-content:center;gap:12px;margin-bottom:28px}
.eql-podium-slot{display:flex;flex-direction:column;align-items:center;gap:6px}
.eql-podium-slot.rank1 .eql-podium-block{height:72px;background:rgba(255,185,95,.18);border-color:rgba(255,185,95,.4)}
.eql-podium-slot.rank2 .eql-podium-block{height:54px;background:rgba(203,213,225,.1);border-color:rgba(203,213,225,.25)}
.eql-podium-slot.rank3 .eql-podium-block{height:42px;background:rgba(205,127,50,.1);border-color:rgba(205,127,50,.25)}
.eql-podium-block{width:70px;border-radius:8px 8px 0 0;border:1px solid rgba(255,255,255,.08);
  display:flex;align-items:center;justify-content:center;font-family:var(--fm);font-size:12px;
  font-weight:900;color:var(--text-muted)}
.eql-podium-av{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:var(--fh);font-weight:900;font-size:14px;position:relative;overflow:hidden}
.eql-podium-medal{font-size:20px;line-height:1}
.eql-podium-name{font-family:var(--fh);font-size:11px;font-weight:800;color:var(--on-surface);text-align:center;max-width:70px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eql-podium-score{font-size:10px;color:var(--text-muted);font-weight:700;text-align:center}

/* ── EQL: Disabled category notice ── */
.eql-disabled-notice{text-align:center;padding:40px 20px;background:rgba(255,255,255,.02);
  border:1px dashed rgba(255,255,255,.08);border-radius:14px;color:var(--text-muted);font-size:13px}
    `;
    document.head.appendChild(style);
  })();

  console.log('[EQL] eql-engine.js loaded. Categories: recitation, boss, academic, overall.');
})();
