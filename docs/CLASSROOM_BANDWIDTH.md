# Classroom bandwidth and the 5 GB plan

## Activate

Deploy this commit, run `supabase/phase84_egress_optimization.sql` if it has not already been installed, then run **`supabase/phase85_classroom_bandwidth.sql`**. Reload all teacher, projector, scanner and student tabs afterward. Both scripts are repeatable; run them in that order. No production database access or usage-management credentials were available during implementation, so these scripts have been tested locally and must still be applied to the project.

Phase85 upgrades the existing compact endpoints. Old clients and phase84 servers remain compatible. New clients negotiate v2 packets only after the server advertises support. A downgrade never retries a submitted answer, award or loot claim.

## Changes students and teachers should notice

- Recitation questions, calls, confirmed awards and undo wake the paired screen from a small authorized change notice. Healthy idle presentations no longer poll every 1.2 seconds. A 15-second authoritative safety read catches a missed notice; a reported Realtime disconnection restores the previous fast polling. Suspense, timers, recognition and seat score animations remain local and retain their timing. Students still do not need their phones for recitation.
- Active boss battles coalesce class changes into bounded reads (roughly one per 750 ms at most during a burst). Quiet battles use an 8-second safety read to retain the server's 20-second participant-presence rules; loot uses a 15-second recovery interval. Cast, eruption, automatic-ultimate and loot-expiry deadlines trigger their own authoritative reads. A disconnected live stream restores fast polling. Own attacks/claims still submit immediately and require confirmation.
- Live battle/studio views own their snapshot data instead of also downloading the same shared tables on each notice. Leaving the view refreshes any deferred tables for the ordinary dashboards.
- A transaction that updates several raid rows emits one class raid notice. Presentation/receipt writes are similarly grouped. Presence-only timestamps no longer fan out to the class. Recitation presentation notices are staff-only under RLS.
- Classmates' last eight answer outcomes are sufficient for recent named damage/critical feedback; older peer histories are no longer retransmitted. Their total damage, correct/wrong counts and rankings remain exact. A student's own complete answer review stays intact. After a long missed-update gap, the exact damage difference is shown as one aggregate hit rather than inventing individual hits. No database history is deleted.
- Compact v2 packets avoid repeated path metadata, shorten cache identifiers, and use set-based SQL packet assembly. They preserve nulls, deletions and array ordering.
- Authenticated shared-table reads can reuse a bounded IndexedDB transfer cache after reload. A fresh authorized server read validates every reuse before it is returned to the app. Account/project keys stay separate; logout forgets that account's entries. Entries expire after 24 hours, with a 32 MB/64-entry limit and an 8 MB per-entry limit. Unavailable/full/corrupt storage falls back to normal server reads. No credentials or auth tokens are stored in this cache.
- New JPEG/static PNG profile uploads preserve their aspect ratio and use a high-quality, maximum-640-pixel WebP when it is at least 10% smaller. Existing photos are untouched; animated GIF/APNG and other formats retain their original upload behavior. Picture changes still require Save Changes. A late image-processing result cannot overwrite a different account or a pending removal.

## Measured packet model

`node tests/database/classroom-capacity.cjs` exercises real PostgreSQL packet generation with 10/30/50 participants. The sample starts late in a raid (80 prior answers per student), uses a 400-question bank, and simulates five class answers batched every two seconds. It compares the previous phase84 packet/read pattern with phase85. A representative client's measured bytes are extrapolated across the class and 20 minutes; this is **not a 20-minute concurrency/load test or a billing forecast**.

| Students | Previous modeled API JSON | New modeled API JSON | Sample active-response reduction |
|---|---:|---:|---:|
| 10 | 296 MB | 53 MB | 82% |
| 30 | 878 MB | 112 MB | 88% |
| 50 | 1,473 MB | 189 MB | 87% |

Values use decimal MB and exclude artwork and profile-photo downloads, shared bootstrap tables, Realtime traffic, HTTP/WebSocket envelopes, compression and other website activity. The model does not demonstrate 50 concurrent production connections or Supabase compute capacity. Actual results vary with answer rate, session length, content and network conditions. See `classroom-capacity-results.json` for the measured inputs and assumptions.

A browser test revalidated an unchanged cached 250 KB record after reload with a response under 150 bytes. Another real-SQL phone/projector test confirmed no old 1.2-second idle polls and prompt award feedback. These examples identify specific savings; they do not establish a universal percentage for billed egress.

## Is 5 GB enough?

It can be workable for moderate classroom use after eliminating waste, but it is not an unlimited classroom plan. For the 30-student model, twenty 20-minute sessions consume about **2.24 GB of modeled API data alone**. Add Realtime, attendance, other pages and media before comparing that with the organization's allowance.

Media can dominate: one new 10 MB sprite sheet downloaded by 30 students is about **300 MB** before any reuse. Five different sheets can be about **1.5 GB**. Prefer appropriately sized WebP sheets, reuse a sheet across animation slots, and reuse unchanged boss assets across sessions. Content-derived boss upload URLs already receive long caching; existing URLs keep their previous headers. Image quality, sprite dimensions, frame definitions and current battle visuals are not automatically reduced.

Watch Organization → Usage during a real class, particularly Database/Realtime/Storage egress, then size the monthly plan using actual sessions and class counts. The update cannot erase a past overage. If legitimate recurring use exceeds the remaining allowance, a larger plan or a separate asset CDN is still necessary; neither was purchased or provisioned by this change.

## Checks

- `npm run test:unit`: scheduler deadlines/batching/recovery, exact peer critical and aggregate feedback, v1/v2 negotiation, account changes and existing application tests.
- `npm run test:egress`: actual PostgreSQL text/UUID endpoints, conditional fields, awards/undo/scans, RLS and native ID compatibility.
- `node tests/database/live-notices.cjs`: transaction grouping, class lookup, no presence fan-out, staff/student separation.
- `node tests/browser/recitation-live-sync.cjs`: phone/projector notices, idle behavior, prompt awards/undo, missing-stream fallback and class filtering.
- `node tests/browser/transfer-cache.cjs`: real IndexedDB reuse, account separation, corrupt/unavailable cache and logout eviction.
- `node tests/browser/profile-image-transfer.cjs`: real image reduction, aspect ratio, animation preservation and staged-upload account/removal guards.
- Existing recitation, ultimate, attendance and loot-race browser suites exercise the upgraded packets. The loot test uses change-driven peer updates without manually polling for the first peer hit.

`DBService.diagnostics()` exposes the live-sync version/connection state and estimated transfer counters. Supabase Usage remains the source of truth for billed traffic.
