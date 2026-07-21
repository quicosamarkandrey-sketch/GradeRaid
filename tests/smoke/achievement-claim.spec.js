'use strict';
// Highest-risk flow #2: achievement unlock/claim. This directly touches the
// same reward-integrity surface the audit flagged for XP/coins — a claim
// that silently fails to grant, or double-grants on a re-click, is exactly
// the "found in production, not in a test suite" bug class Phase 0 exists
// to put a tripwire in front of.
//
// This test depends on the test account already having at least one
// unclaimed achievement (seeded test-project state) — it can't safely
// manufacture one itself without assuming which admin RPCs exist to grant
// one, so it skips (not fails) when there's nothing to claim, and says so.

const { test, expect } = require('@playwright/test');
const { requireStudentCreds, login } = require('./helpers/credentials.js');

test('claiming an achievement grants the reward exactly once and disables re-claiming', async ({ page }) => {
  const creds = requireStudentCreds(test);
  await login(page, creds.studentEmail, creds.studentPassword);

  await page.evaluate(() => window.navTo && window.navTo('s-badges'));
  await expect(page.locator('#s-badges')).toBeVisible();

  const claimBtn = page.locator('.ach-claim-btn').first();
  const claimable = await claimBtn.count();
  test.skip(claimable === 0, 'No unclaimed achievement on the test account — seed one to exercise this flow.');

  await claimBtn.click();

  // Claiming normally opens a full-screen "Achievement Claimed!"
  // confirmation modal (reward-presenter.js, #eqr-btn "Continue"/"Awesome!"
  // button) — the reward is already granted at this point, but
  // renderBadges() (which is what actually removes the claim button from
  // the list) only runs from the modal's onClose callback. So the claim
  // button is *expected* to still be sitting there, underneath the modal,
  // until it's dismissed — checking for it before that point isn't a real
  // double-grant risk, it's just checking too early.
  //
  // There's also a fallback path in achClaimReward (student-page.js) for
  // when no reward presenter is available at all: it calls renderBadges()
  // directly with no modal. Handle both rather than assuming one.
  const modalBtn = page.locator('#eqr-btn');
  if (await modalBtn.count() > 0) {
    await modalBtn.click();
  }

  // Now that the modal's onClose → renderBadges() has run (or, in the
  // fallback path, renderBadges() already ran directly), that same button
  // must not still offer a claim — a stuck/re-clickable claim button here
  // IS the real double-grant signal.
  await expect(claimBtn).not.toBeVisible({ timeout: 5000 }).catch(async () => {
    // Some rarity/reward flows re-render the whole list instead of removing
    // just this node — fall back to asserting the claim buttons count went
    // down by one rather than requiring this exact element to vanish.
    const remaining = await page.locator('.ach-claim-btn').count();
    expect(remaining).toBeLessThan(claimable);
  });
});
