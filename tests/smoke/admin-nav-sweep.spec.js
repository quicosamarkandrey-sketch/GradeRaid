'use strict';
// Highest-risk flow #3 (broader than the doc's named 5, but cheap and high
// value): most production bugs in this app have historically surfaced as
// "the page is just blank/broken after I click into it," not a crash on
// the dashboard itself. This sweeps the primary admin nav destinations and
// fails if any of them throws a page error or renders empty. It intentionally
// does NOT interact with each page's contents (that's what the more
// targeted flow-specific smoke tests are for) — this is a tripwire for
// "the whole page silently didn't render," which the audit's own
// System Health work (client_error_logs) was built to catch in production
// after the fact. This is the same thing, before merge.

const { test, expect } = require('@playwright/test');
const { requireAdminCreds, login } = require('./helpers/credentials.js');

// A representative subset of admin nav destinations — not exhaustive, but
// covers the modules with the most historical bug reports per the refactor
// log (shop, achievements, titles, world boss, nav manager).
const PAGES_TO_SWEEP = [
  'a-store', 'a-quizzes', 'a-achievements', 'a-titles',
  'a-bossevents', 'a-sections', 'a-nav-manager', 'a-system-health',
];

test('primary admin pages render without throwing or ending up empty', async ({ page }) => {
  const creds = requireAdminCreds(test);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await login(page, creds.adminEmail, creds.adminPassword);

  for (const pageId of PAGES_TO_SWEEP) {
    await page.evaluate((id) => window.navTo && window.navTo(id), pageId);
    const container = page.locator(`#${pageId}`);
    await expect(container, `#${pageId} should be visible after navTo('${pageId}')`).toBeVisible();
    const html = await container.innerHTML();
    expect(html.trim().length, `#${pageId} rendered empty`).toBeGreaterThan(0);
  }

  expect(pageErrors, `Uncaught page errors while sweeping admin nav:\n${pageErrors.join('\n')}`).toEqual([]);
});

const STUDENT_PAGES_TO_SWEEP = [
  's-my-section', 's-quizzes', 's-store', 's-inventory',
  's-leaderboard', 's-badges', 's-world-boss', 's-mail',
];

test('primary student pages render without throwing or ending up empty', async ({ page }) => {
  const { requireStudentCreds } = require('./helpers/credentials.js');
  const creds = requireStudentCreds(test);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await login(page, creds.studentEmail, creds.studentPassword);

  for (const pageId of STUDENT_PAGES_TO_SWEEP) {
    await page.evaluate((id) => window.navTo && window.navTo(id), pageId);
    const container = page.locator(`#${pageId}`);
    await expect(container, `#${pageId} should be visible after navTo('${pageId}')`).toBeVisible();
    const html = await container.innerHTML();
    expect(html.trim().length, `#${pageId} rendered empty`).toBeGreaterThan(0);
  }

  expect(pageErrors, `Uncaught page errors while sweeping student nav:\n${pageErrors.join('\n')}`).toEqual([]);
});
