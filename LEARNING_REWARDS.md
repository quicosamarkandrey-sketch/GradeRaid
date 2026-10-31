# Balanced learning rewards

Apply `supabase/phase72_learning_rewards.sql` in the Supabase SQL Editor after the existing migrations, then refresh open app tabs. This migration is transactional and repeatable; it preserves balances and its original activation time. Code deployment alone does not enable these new automatic earnings. Without the new RPCs, the app keeps the existing reward/checkout paths. Connection errors never authorize an unconfirmed coin purchase.

| Activity | Default coins | Limit |
| --- | ---: | --- |
| Attendance, including late arrivals | 10 | Once per Philippine calendar day across sections; also 10 XP |
| Recitation | 2 per net point | 20 coins per Philippine calendar day |
| Attendance streak | 15 extra | Every 5 recorded attended class days; also 25 XP |
| Quest | 20 budget, teacher configurable | Maximum 40 per quest; score determines total entitlement |

A quest with a 20-coin budget pays 10 at 50%, then another 8 when improved to 90%, then 2 at 100%. Repeating or lowering a score earns no further coins. The budget is fixed at the first eligible result. Existing XP/combo/retry rules remain. Existing achievement, boss, campaign and mail rewards remain separate; this is a baseline economy rather than a cap on all teacher-issued rewards.

Only recitation recorded from activation, attendance days from activation's Philippine date, and explicitly opted-in new quest results are eligible. No retrospective payout for old quest attempts. Missing attendance days and Excused records are skipped; a recorded absence breaks the streak. An absence in one section does not cancel confirmed attendance elsewhere on the same day. Streaks count recorded class days, not weekends/calendar gaps.

Corrections and undo recompute the entitlement. If the removed coins were already spent, the visible balance stays nonnegative and future learning earnings first repay the reversal. XP already earned from recitation retains its existing backend handling. The new attendance/streak XP is reconciled here.

Checkout validates current price, adviser ownership, active product, stock and wallet under database locks. Coins, stock, inventory and claim-code orders commit together. A durable request ID makes uncertain network retries safe, including after reload. Existing order cancellation rules still apply (no automatic refund).

Students can open **How to earn coins** from their dashboard or Armory. Suggested catalog prices: 50–100 for small rewards, 150–250 for larger rewards, 400+ for special privileges. Existing teacher prices are preserved.

The database owner can inspect or edit `learning_reward_policy` through Supabase. Policy changes reconcile existing entitlements since activation, so review changes before applying them; increases can grant top-ups and decreases can reverse coins. `enabled=false` pauses reconciliation; re-enabling catches up eligible activity during the pause. This is not a policy editor exposed to students.

## Verification

- `npm run test:unit` — includes wallet settlement, pending quest recovery and checkout retry tests.
- `npm run test:rewards-db` — runs the migration twice in PGlite and checks payouts, caps, streaks, scope/ACLs, corrections, legacy isolation and atomic purchases. It uses a minimal existing-schema fixture; production deployment still needs review against the school's installed migrations. It does not simulate concurrent browser sessions.
- `node tests/browser/landing.cjs` — landing/auth and responsive light/dark checks.
- `node tests/browser/learning-rewards.cjs` — real app guide, atomic checkout and completed-quest settlement with intercepted RPCs.
- `node tests/browser/classroom-tools.cjs` — attendance, monitor and seating regressions.

Quiz grading retains the application's existing client grading model. The new database layer validates result range and quest eligibility, and enforces coin caps and replay protection; it does not independently regrade submitted answers. Existing legacy stat RPCs and inventory/order policies are not replaced by this migration. This change does not claim to secure every pre-existing reward path against a modified client.
