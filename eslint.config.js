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
];
