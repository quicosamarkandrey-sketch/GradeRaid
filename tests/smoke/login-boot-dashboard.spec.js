'use strict';
// Highest-risk flow #1 (per Phase_0_Safety_Net_Infrastructure.md): login →
// boot → dashboard render, for both roles that matter most. bootApp() in
// auth.js is monkey-patched by at least four other modules (world-boss,
// titles, DSM, achievements — see its own header comment), so this is
// exactly the kind of flow where one broken patch silently wedges the
// entire post-login experience for every student or teacher.

const { test, expect } = require('@playwright/test');
const { requireStudentCreds, requireAdminCreds, login } = require('./helpers/credentials.js');

test('student: login lands on the student dashboard with no console errors', async ({ page }) => {
  const creds = requireStudentCreds(test);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await login(page, creds.studentEmail, creds.studentPassword);

  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#s-dashboard')).toBeVisible();
  expect(pageErrors, `Uncaught page errors during boot:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('admin/teacher: login lands on the admin dashboard (Command Center) with no console errors', async ({ page }) => {
  const creds = requireAdminCreds(test);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await login(page, creds.adminEmail, creds.adminPassword);

  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#a-dashboard')).toBeVisible();
  expect(pageErrors, `Uncaught page errors during boot:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('wrong password shows the incorrect-credentials message, not a silent dead button', async ({ page }) => {
  const creds = requireStudentCreds(test); // just needs a real, valid email to test against
  await page.goto('/');
  await page.locator('#login-user').fill(creds.studentEmail);
  await page.locator('#login-pass').fill('definitely-not-the-real-password');
  await page.locator('#login-submit-btn').click();

  await expect(page.locator('#login-err')).toBeVisible();
  await expect(page.locator('#main-app')).toBeHidden();
});
