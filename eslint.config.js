'use strict';
// EduQuest — Phase 0 lint config (Refactor Roadmap, Phase 0: Safety-Net Infrastructure)
//
// Deliberately small. This is not "turn on eslint:recommended and fix
// everything" — it targets three specific, previously-diagnosed hazard
// classes from the production audit:
//
//   1. Duplicate top-level function names across files. Every file here is
//      loaded as a plain global <script> (no module system yet — that's
//      Phase 7), so two files declaring the same top-level function name
//      silently collide depending on <script> load order in index.html.
//   2. Raw `.innerHTML =` assignment bypassing the shared escape helper
//      (_esc in utils.js). Unescaped interpolation into innerHTML is an XSS
//      hazard the moment any of that string comes from user/student input
//      (quiz answers, chat/mail text, display names, etc).
//   3. Direct `DB.*` mutation from outside the state layer. Phase 3 (Single
//      Source of Truth) will make AppStore the only writer; until then this
//      is a warning, not an error, since most of the app still writes DB.*
//      directly by design — it's here so new code stops doing it, and so
//      the count is visible instead of invisible.
//
// no-undef is intentionally OFF: this codebase's execution model is dozens
// of files sharing one global scope on purpose (see index.html's <script>
// order), so nearly everything is "undefined" to a single-file linter by
// default. Revisit once Phase 7 (module system) lands and imports/exports
// replace implicit globals.

const noDuplicateGlobalFunctions = require('./eslint-rules/no-duplicate-global-functions.js');
const noRawInnerhtmlAssignment = require('./eslint-rules/no-raw-innerhtml-assignment.js');
const noUnescapedDbFieldInHtml = require('./eslint-rules/no-unescaped-db-field-in-html.js');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'tests/**',
      'playwright-report/**',
      'test-results/**',
      'supabase/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['**/*.js'],
    plugins: {
      eduquest: {
        rules: {
          'no-duplicate-global-functions': noDuplicateGlobalFunctions,
          'no-raw-innerhtml-assignment': noRawInnerhtmlAssignment,
          'no-unescaped-db-field-in-html': noUnescapedDbFieldInHtml,
        },
      },
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'writable',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off', // see note above — global-script architecture, pre-Phase 7
      'no-unused-vars': 'warn',

      // Audit finding #1 — duplicate top-level function declarations.
      'eduquest/no-duplicate-global-functions': 'error',

      // Audit finding #2 — innerHTML must go through the shared escape
      // helper (_esc in utils.js) rather than raw string interpolation.
      //
      // PHASE 2 FIX: this was previously a `no-restricted-syntax` selector
      // living in this same rule block. It never actually fired: the third
      // config block below (DB.* mutation check) also matches every
      // `**/*.js` file and also sets `no-restricted-syntax`, and ESLint's
      // flat config replaces a rule's value wholesale (not merged) when two
      // matching config objects both set it — so the DB.* selector silently
      // clobbered this one. Every one of the 334 raw `.innerHTML =` sites in
      // this codebase has had zero enforcement since Phase 0 shipped, which
      // is almost certainly how the leaderboard/hall-of-fame unescaped-name
      // bug got past a lint rule that was supposedly guarding exactly that.
      // Split into real plugin rules (own config keys, can't collide) below:
      //   - warn on every raw innerHTML assignment (334 pre-existing sites —
      //     this is a floor to fix over time, not a one-session job, so it's
      //     warn-level like the DB.* rule rather than a 334-error big bang)
      //   - error on the specific, narrow, high-confidence case Phase 2's
      //     audit actually found: a known user-controlled display field
      //     (name/profilePic/etc.) interpolated raw into a template literal
      'eduquest/no-raw-innerhtml-assignment': 'warn',
      'eduquest/no-unescaped-db-field-in-html': 'error',
    },
  },
  {
    // Audit finding #3 — direct DB.* mutation outside the state layer.
    // Warning-level everywhere until Phase 3 (Single Source of Truth)
    // makes AppStore the sole writer; the state layer itself is exempt
    // since it IS the intended place DB gets mutated.
    files: ['**/*.js'],
    ignores: ['modules/core/state-manager.js', 'db-service.js', 'db-migrations.js', 'db-schema.js'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "AssignmentExpression[left.object.name='DB']",
          message:
            'Direct DB.* mutation outside the state layer. Prefer AppStore.updateState() (modules/core/state-manager.js) so subscribers repaint and writes go through one place — see Phase 3 of the refactor roadmap.',
        },
      ],
    },
  },
  {
    // Phase 3 (Single Source of Truth) — per-module CI gate, added as each
    // directory finishes its migration off direct DB.* mutation. This is
    // deliberately narrower-but-stricter than the repo-wide warn rule above:
    // once a directory is clean, a NEW direct DB.* write in it is a mistake,
    // not debt, so it's an error here instead of joining the warn-level floor.
    //
    // modules/shared/ — migrated 2026-07-21 (notification-service.js was the
    // only file in this directory with any DB.* references; the other eight
    // files never touched DB directly). See refactor log, Phase 3 entry.
    //
    // modules/attendance/ — migrated 2026-07-21. att_scanner_rfid.js had 3
    // real DB.students reads plus 3 `DB = loadDB()` legacy-bridge
    // reassignments feeding them; att_index.js's only match was a comment.
    //
    // modules/section/ — migrated 2026-07-21. my-section.js's local-only
    // offline fallback (used only when the get_my_section_info() RPC is
    // unavailable) read DB.students/equippedTitles/admin/achievements/
    // quizzes/stageMap/store/titles directly; all now go through
    // AppStore.getSlice().
    //
    // modules/recitation/ — migrated 2026-07-21. logger.js had a real write
    // path (DB.students[idx].xp += pts, plus recitationLog/pointLog
    // prepends) now routed through AppStore.updateState(); progress.js had
    // 4 read sites (recitationLog, pointLog, achievementUnlocks/
    // achievements/titles/students) now routed through AppStore.getSlice().
    //
    // modules/leaderboard/ — migrated 2026-07-21. eql-engine.js had a config
    // read/write path (setEnabled/resetPeriod/clearReset + the config
    // migration block) plus per-student read sites called inside a
    // full-roster loop (recitationLog/bossEvents/bossParticipants/
    // pointLog/students) — all now go through AppStore, with a shared
    // per-render cache bundle so eqlComputeRecitation/Boss/Academic/Overall
    // don't each clone the same arrays once per student. hall-of-fame.js's
    // renderLeaderboard had the same full-roster loop pattern (same cache
    // fix applied) plus 2 achievement-lookup reads; admin-leaderboard.js
    // had 1 config read.
    //
    // modules/mail/ — migrated 2026-07-21. mail-engine.js had two write
    // paths (mailMarkRead, mailClaimRewards) that used to mutate a found
    // mail/student object from a live DB reference then call saveDB() —
    // both now build their mutation inside one AppStore.updateState()
    // draft callback (mailClaimRewards's checkLevelUp() call had to move
    // inside the draft too, since it mutates its argument in place).
    // admin-compose.js had a full CRUD surface (compose/edit/delete) — the
    // edit path had a real persistence bug (see log entry) fixed as part of
    // the migration. student-inbox.js had 3 read-only DB reads.
    //
    // modules/boss-studio/ — migrated 2026-07-21. bs_storage.js's bsLoad()
    // used to do double duty (read + resolve artwork refs in place),
    // relying on DB being one shared mutable object every other function
    // implicitly depended on having been "warmed" first — redesigned so
    // bsLoad()/bsGet() are each self-sufficient instead. bs_animation_
    // library.js had a full CRUD surface; bs_library.js/bs_bve_engine.js/
    // bs_index.js had read-only sites plus one migration-guard block.
    //
    // modules/campaign/ — migrated 2026-07-21. campaign_admin_map_editor.js
    // had a full world/stage CRUD surface (30 refs) — including a real
    // persistence bug in adminSaveEditWorld() (section-assignment mutation
    // never saved, same shape as mailAdminSend()'s edit-branch bug in
    // modules/mail/) fixed as part of the migration. campaign_engine.js
    // (26 refs) had a stage-clear reward-grant write plus a second
    // never-persisted mutation bug in its async skill-sync reconciliation
    // callback. campaign_stage_map.js/campaign_index.js had read-only sites
    // plus one migration-guard block.
    //
    // modules/titles/ — migrated 2026-07-21. titles_admin_page.js (38 refs)
    // had a full CRUD + grant/revoke surface. titles_sidebar_refresh.js
    // (24) had the core equip/unlock write paths plus a third instance of
    // the "duplicate migration guard" pattern first seen in
    // modules/boss-studio/ (bootApp's patch here duplicates titles_index.js's
    // own guard — flagged, not fixed). titles_designer.js (13) had a fourth
    // instance of the never-persisted-async-mutation bug (section
    // assignment, same shape as campaign/mail's). titles_student_page.js
    // (10) was read-only. titles_badge_renderer.js had zero references.
    files: ['modules/shared/**/*.js', 'modules/attendance/**/*.js', 'modules/section/**/*.js', 'modules/recitation/**/*.js', 'modules/leaderboard/**/*.js', 'modules/mail/**/*.js', 'modules/boss-studio/**/*.js', 'modules/campaign/**/*.js', 'modules/titles/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression[left.object.name='DB']",
          message:
            'Direct DB.* mutation in modules/shared/ — this directory is fully migrated to AppStore.updateState() (Phase 3). Do not reintroduce direct DB writes here.',
        },
      ],
    },
  },
];
