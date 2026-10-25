// src/modules/leaderboard/admin-leaderboard.js — real-ESM twin of
// ../../../modules/leaderboard/admin-leaderboard.js.
// Phase 7 (Stream D), file 14/30. Original stays untouched.
//
// All 6 top-level declared symbols exported, matching declaresCount 6
// exactly (dist/dependency-map.json): the 6 `window.X = function X(){...}`
// assignments (renderAdminLeaderboards, eqlToggle, eqlAdminPreview,
// eqlAdminResetConfirm, eqlDoReset, eqlDoClearReset), each converted to
// `export const X = function X(){...}`. The outer `(function () {
// 'use strict'; ... }());` wrapper is stripped (body dedented 2sp, otherwise
// verbatim); the directive is dropped because ES modules are always strict.
// Dedent is TEMPLATE-LITERAL-AWARE: lines that start inside a template literal
// (114 continuation lines of the big HTML strings) are left exactly as-is, so
// every runtime string value is byte-identical to the original — a blanket
// dedent would have shifted the rendered innerHTML whitespace by 2 spaces.
// The IIFE-private helpers (KEYS, DEFAULTS, _esc, _cfg, _fmtDate) are now
// module-scoped and deliberately NOT exported — they were never on window.
// `_esc` here is this file's own local helper (same shape as utils.js's) and
// stays local, so utils.js is not imported.
//
// REAL IMPORTS: AppStore (../core/state-manager.js), toast/showModal/
// closeModalForce (../../dom.js), EQL + eqlBuildCategory (./eql-engine.js,
// this stream's file 3 — no cycle: eql-engine.js imports only AppStore).
//
// Bare-identifier window fallback, per the global rule: DB (the legacy-compat
// read alias, index.html inline script / db-schema.js).
//
// BINDING NOTE: the file's internal calls to its own exports are all spelled
// `window.renderAdminLeaderboards()` / inline `onclick="window.eqlX(...)"`,
// so they still resolve through `window` at call time exactly as before (the
// bridge re-attaches them) — no lexical-binding change. Checked repo-wide: none
// of the 6 names is ever reassigned outside this file.
//
// Load-time side effect preserved: the trailing console.log.

// ─────────────────────────────────────────────────────────────────────────────
//  EduQuest — modules/leaderboard/admin-leaderboard.js
//  Admin panel for the EQL leaderboard system.
//
//  Exports (window.*):
//    renderAdminLeaderboards  — renders the a-leaderboard admin page
//    eqlToggle(key)           — toggle a category enabled/disabled
//    eqlAdminPreview(key)     — show a leaderboard preview in a modal
//    eqlAdminResetConfirm(key)— ask for confirmation before resetting a period
//    eqlDoReset(key)          — set resetAt = now, re-render
//    eqlDoClearReset(key)     — clear resetAt, re-render
//
//  Dependencies (must be loaded before this file):
//    eql-engine.js  → window.EQL, window.eqlBuildCategory, window.eqlComputeOverall, etc.
//    hall-of-fame.js (optional — only hall renders use it directly)
//    nav.js         → NAV_ADMIN is already defined; we push one entry to it here
//    dom.js         → showModal(), closeModalForce(), toast()
//    db-schema.js   → DB (the AppStore legacy-compat read alias)
//    app-state.js   → saveDB()
//
//  NOTE: This file intentionally does NOT re-declare NAV_STUDENT, NAV_ADMIN,
//  setupSidebar(), navTo(), or showPage(). Those all live exclusively in
//  nav.js. The old version of this file accidentally duplicated the entire
//  nav.js body here, causing a "Identifier 'NAV_STUDENT' has already been
//  declared" SyntaxError that crashed the page and halted every script that
//  loaded after it (including the classroom seating module). That is the bug
//  this rewrite fixes.
// ─────────────────────────────────────────────────────────────────────────────

import { AppStore } from '../core/state-manager.js';
import { toast, showModal, closeModalForce } from '../../dom.js';
import { EQL, eqlBuildCategory } from './eql-engine.js';

const KEYS = ['recitation', 'boss', 'academic', 'overall'];

// ── Icons / accent colours for each category ──────────────────────────────
// These mirror the defaults in eql-engine.js's migration block but are
// read directly from DB.leaderboardConfig (which is the single source of
// truth for these values after migration runs).
const DEFAULTS = {
  recitation: { label: 'Recitation',  icon: '🎤', color: '#4edea3' },
  boss:       { label: 'Boss Raider', icon: '⚔️',  color: '#EC4899' },
  academic:   { label: 'Academic',    icon: '📚', color: '#d0bcff' },
  overall:    { label: 'Overall',     icon: '🏆', color: '#ffb95f' },
};

// ── Helper: safely escape HTML ─────────────────────────────────────────────
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Helper: get config for one category, with safe defaults ───────────────
function _cfg(key) {
  const base = DEFAULTS[key] || { label: key, icon: '📊', color: '#d0bcff' };
  const saved = (DB.leaderboardConfig || {})[key] || {};
  return Object.assign({}, base, saved);
}

// ── Helper: format an ISO timestamp for display ────────────────────────────
function _fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return iso; }
}

// ─────────────────────────────────────────────────────────────────────────────
// renderAdminLeaderboards()
//   Renders the full admin control panel into #a-leaderboard.
//   Called by navTo('a-leaderboard').
// ─────────────────────────────────────────────────────────────────────────────
export const renderAdminLeaderboards = function renderAdminLeaderboards() {
  const page = document.getElementById('a-leaderboard');
  if (!page) {
    console.error('[EQL admin] #a-leaderboard page div not found.');
    return;
  }

  // Wait for AppStore to be ready before reading DB values.
  AppStore.ready.then(function () {
    const stats = EQL.getStats();

    const cards = KEYS.map(key => {
      const cfg      = _cfg(key);
      const st       = stats[key] || {};
      const enabled  = cfg.enabled !== false;
      const resetAt  = cfg.resetAt || null;

      return `
          <div class="eql-admin-card cat-${_esc(key)} ${enabled ? '' : 'disabled'}" id="eql-card-${_esc(key)}">
            <div class="eql-admin-card-header">
              <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
                <div class="eql-admin-card-icon" style="color:${_esc(cfg.color)}">
                  ${_esc(cfg.icon)}
                </div>
                <div>
                  <div class="eql-admin-card-title">${_esc(cfg.label)}</div>
                  <div class="eql-admin-card-sub">${_esc(key)} leaderboard</div>
                </div>
              </div>
              <button class="eql-toggle ${enabled ? 'on' : ''}"
                title="${enabled ? 'Click to disable' : 'Click to enable'}"
                onclick="window.eqlToggle('${_esc(key)}')"></button>
            </div>

            <div class="eql-admin-stats">
              <div class="eql-admin-stat">
                <div class="eql-admin-stat-val" style="color:${_esc(cfg.color)}">${st.participantCount || 0}</div>
                <div class="eql-admin-stat-lbl">With Score</div>
              </div>
              <div class="eql-admin-stat">
                <div class="eql-admin-stat-val">${st.totalStudents || 0}</div>
                <div class="eql-admin-stat-lbl">Total Students</div>
              </div>
              <div class="eql-admin-stat" style="grid-column:1/-1">
                <div class="eql-admin-stat-val" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  ${_esc(st.topStudent || '—')}
                </div>
                <div class="eql-admin-stat-lbl">Top Student · ${(st.topScore || 0).toLocaleString()} pts</div>
              </div>
            </div>

            ${resetAt ? `
              <div class="eql-reset-badge">
                📅 Active period from: <strong>${_esc(_fmtDate(resetAt))}</strong>
              </div>
            ` : ''}

            <div class="eql-admin-actions" style="margin-top:${resetAt ? '8px' : '0'}">
              <button class="btn btn-ghost btn-sm" onclick="window.eqlAdminPreview('${_esc(key)}')">
                👁 Preview
              </button>
              <button class="btn btn-ghost btn-sm" onclick="window.eqlAdminResetConfirm('${_esc(key)}')">
                🔄 New Period
              </button>
              ${resetAt ? `
                <button class="btn btn-ghost btn-sm" onclick="window.eqlDoClearReset('${_esc(key)}')">
                  ↩ All-Time
                </button>
              ` : ''}
            </div>
          </div>
        `;
    }).join('');

    page.innerHTML = `
        <div style="max-width:960px;margin:0 auto;padding:28px 24px">

          <div style="margin-bottom:28px">
            <h2 style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--on-surface);margin:0 0 4px">
              🏆 Leaderboard Admin
            </h2>
            <p style="font-size:13px;color:var(--text-muted);margin:0">
              Toggle categories, preview current standings, and manage scoring periods.
              A "New Period" reset keeps all-time history — only the ranking window changes.
            </p>
          </div>

          <div class="eql-admin-grid">
            ${cards}
          </div>

        </div>
      `;
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// eqlToggle(key)  — flip enabled flag, persist, re-render
// ─────────────────────────────────────────────────────────────────────────────
export const eqlToggle = function eqlToggle(key) {
  const cfg     = _cfg(key);
  const enabled = cfg.enabled !== false;
  EQL.setEnabled(key, !enabled);
  toast(`${_esc(cfg.icon)} ${_esc(cfg.label)} leaderboard ${!enabled ? 'enabled' : 'disabled'}.`, !enabled ? '#4edea3' : '#ffb95f');
  window.renderAdminLeaderboards();
};

// ─────────────────────────────────────────────────────────────────────────────
// eqlAdminPreview(key)  — show a modal with the top-10 rankings
// ─────────────────────────────────────────────────────────────────────────────
export const eqlAdminPreview = function eqlAdminPreview(key) {
  const cfg     = _cfg(key);
  const entries = eqlBuildCategory(key);
  const top10   = entries.slice(0, 10);
  const resetAt = cfg.resetAt || null;

  const rows = top10.length ? top10.map(e => {
    const r      = e.rank;
    const rankCls = r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : '';
    const rankLabel = r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r;
    const color  = e.student.color || '#8b5cf6';
    const init   = e.student.init || (e.student.name || '?')[0];
    return `
        <div class="eql-row ${r <= 3 ? 'top3' : ''}">
          <div class="eql-rank ${rankCls}">${rankLabel}</div>
          <div class="eql-av" style="background:${_esc(color)}22;color:${_esc(color)}">${_esc(init)}</div>
          <div class="eql-info">
            <div class="eql-info-name">${_esc(e.student.name || e.student.displayName || '—')}</div>
          </div>
          <div class="eql-score">
            <div class="eql-score-main" style="color:${_esc(cfg.color)}">${_esc(e.scoreLabel)}</div>
          </div>
        </div>
      `;
  }).join('') : `
      <div class="eql-empty">
        <div class="eql-empty-icon">${_esc(cfg.icon)}</div>
        <div class="eql-empty-title">No scores yet</div>
        <div class="eql-empty-sub">No students have logged ${_esc(cfg.label)} activity yet.</div>
      </div>
    `;

  showModal(`
      <div style="padding:8px 4px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
          <span style="font-size:26px">${_esc(cfg.icon)}</span>
          <div>
            <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface)">${_esc(cfg.label)} Rankings</div>
            <div style="font-size:11px;color:var(--text-muted)">${resetAt ? 'Period from ' + _esc(_fmtDate(resetAt)) : 'All-time'} · Top ${top10.length} of ${entries.length}</div>
          </div>
        </div>
        ${rows}
        <div style="margin-top:16px;text-align:right">
          <button class="btn btn-ghost btn-sm" onclick="closeModalForce()">Close</button>
        </div>
      </div>
    `, 'md');
};

// ─────────────────────────────────────────────────────────────────────────────
// eqlAdminResetConfirm(key)  — confirmation dialog before starting a new period
// ─────────────────────────────────────────────────────────────────────────────
export const eqlAdminResetConfirm = function eqlAdminResetConfirm(key) {
  const cfg = _cfg(key);
  showModal(`
      <div style="padding:8px 4px;text-align:center">
        <div style="font-size:36px;margin-bottom:12px">${_esc(cfg.icon)}</div>
        <div style="font-family:var(--fh);font-size:16px;font-weight:900;color:var(--on-surface);margin-bottom:8px">
          Start new ${_esc(cfg.label)} period?
        </div>
        <p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin:0 0 20px">
          Rankings will show only activity <strong>from this moment forward</strong>.
          All-time records are preserved — "All-Time" mode restores them any time.
        </p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn btn-ghost btn-sm" onclick="closeModalForce()">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="closeModalForce(); window.eqlDoReset('${_esc(key)}');">
            ✅ Start New Period
          </button>
        </div>
      </div>
    `, 'sm');
};

// ─────────────────────────────────────────────────────────────────────────────
// eqlDoReset(key)  — stamp resetAt = now
// ─────────────────────────────────────────────────────────────────────────────
export const eqlDoReset = function eqlDoReset(key) {
  EQL.resetPeriod(key);
  const cfg = _cfg(key);
  toast(`🔄 ${_esc(cfg.label)} period reset. Rankings now start from today.`, '#4edea3');
  window.renderAdminLeaderboards();
};

// ─────────────────────────────────────────────────────────────────────────────
// eqlDoClearReset(key)  — wipe resetAt, return to all-time mode
// ─────────────────────────────────────────────────────────────────────────────
export const eqlDoClearReset = function eqlDoClearReset(key) {
  EQL.clearReset(key);
  const cfg = _cfg(key);
  toast(`↩ ${_esc(cfg.label)} back to all-time mode.`, '#d0bcff');
  window.renderAdminLeaderboards();
};

console.log('[EQL] admin-leaderboard.js loaded — renderAdminLeaderboards / eqlToggle / eqlAdminPreview / eqlAdminResetConfirm / eqlDoReset / eqlDoClearReset registered.');
