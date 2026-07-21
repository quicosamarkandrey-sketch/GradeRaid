'use strict';
require('dotenv').config(); // loads .env automatically — see .env.example

// EduQuest — Phase 0 Playwright smoke suite config.
//
// WHY PLAYWRIGHT (per Phase_0_Safety_Net_Infrastructure.md): this app has no
// module system or build step — index.html loads ~60 files as plain global
// <script> tags in a specific order. A real browser context is the only
// thing that actually exercises that load order the way production does;
// jsdom or a bundler-based test runner would paper over load-order bugs.
//
// WHAT THESE TESTS DO / DON'T DO:
// These tests drive the REAL index.html in a REAL browser against a REAL
// (but test/staging) Supabase project — never production. They need three
// env vars pointing at that project's test accounts (see .env.example).
// If they're not set, every test in this suite SKIPS with a clear reason
// instead of failing — a missing secret in a dev's local shell is not the
// same thing as a broken app, and this suite should never cry wolf about
// that distinction.
//
// Nothing here mocks the network. Deliberately: the highest-value bugs this
// suite exists to catch (per the audit — stale-tab XP clobbering, RLS gaps,
// spurious sync failures) are exactly the class of bug that a mocked
// Supabase client would hide, since they live in the real request/response
// contract between this app and Postgres/RLS.

module.exports = {
  testDir: './tests/smoke',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // shared test accounts — avoid two workers logging in as the same student at once
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${process.env.EDUQUEST_STATIC_PORT || 4173}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/smoke/static-server.js',
    port: Number(process.env.EDUQUEST_STATIC_PORT) || 4173,
    reuseExistingServer: !process.env.CI,
  },
};
