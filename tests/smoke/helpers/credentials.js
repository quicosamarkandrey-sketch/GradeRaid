'use strict';
// Reads test-account credentials from env vars and gives every smoke test a
// single, consistent way to skip (with a clear reason) when they're absent,
// rather than each spec file inventing its own guard.
//
// These MUST point at a test/staging Supabase project — never production.
// See .env.example at the repo root.

function creds() {
  return {
    studentEmail: process.env.EDUQUEST_TEST_STUDENT_EMAIL,
    studentPassword: process.env.EDUQUEST_TEST_STUDENT_PASSWORD,
    adminEmail: process.env.EDUQUEST_TEST_ADMIN_EMAIL,
    adminPassword: process.env.EDUQUEST_TEST_ADMIN_PASSWORD,
  };
}

function requireStudentCreds(test) {
  const c = creds();
  if (!c.studentEmail || !c.studentPassword) {
    test.skip(true, 'EDUQUEST_TEST_STUDENT_EMAIL / EDUQUEST_TEST_STUDENT_PASSWORD not set — see .env.example');
  }
  return c;
}

function requireAdminCreds(test) {
  const c = creds();
  if (!c.adminEmail || !c.adminPassword) {
    test.skip(true, 'EDUQUEST_TEST_ADMIN_EMAIL / EDUQUEST_TEST_ADMIN_PASSWORD not set — see .env.example');
  }
  return c;
}

async function login(page, email, password) {
  await page.goto('/');
  await page.locator('#login-user').fill(email);
  await page.locator('#login-pass').fill(password);
  await page.locator('#login-submit-btn').click();
  // #main-app is the real post-boot container (see bootApp() in auth.js) —
  // waiting on it, not a fixed delay, is what makes this robust to the
  // real signInWithPassword() + profile-fetch network round trip.
  await page.locator('#main-app').waitFor({ state: 'visible' });
}

module.exports = { creds, requireStudentCreds, requireAdminCreds, login };
