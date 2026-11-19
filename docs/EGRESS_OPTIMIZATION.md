# Supabase bandwidth optimization

## Activate the update

For the latest classroom upgrade and measurements, see [Classroom bandwidth](CLASSROOM_BANDWIDTH.md).

1. Deploy the updated `main` branch.
2. Run **`supabase/phase84_egress_optimization.sql`** in the project's Supabase SQL Editor. Install the existing classroom/world-boss migrations through phase83 first. The migration is additive and repeatable; native text and UUID boss IDs are supported.
3. Run **`supabase/phase85_classroom_bandwidth.sql`** after phase84 to enable change-driven sessions, v2 packets and the latest classroom optimizations.
4. Reload every teacher, projector, scanner and student tab. Old tabs continue using the original full-response endpoints and subscriptions until reloaded.
5. Check **Organization → Usage → current billing cycle**, including Database, Realtime and Storage egress. Compare active teaching periods with similar class sizes; the counters are cumulative and this change does not erase a previous overage.

The app works before the migration by falling back to its existing RPCs when the new endpoint is missing. Most bandwidth savings require the migration **and reloaded clients**. Network/permission failures never select a legacy scoring path or replay a mutation.

## What changes

- Boss, recitation and attendance snapshots send changed fields plus deletion/order information. Unchanged questions, boss visual profiles, photos, seating and history stay in an account-scoped memory cache.
- All 29 shared bootstrap tables and scoped refresh reads use the same conditional protocol. The first read is complete; later reads reuse unchanged fields. Existing history windows, ordering, RLS and pagination remain. Unspecified table reads have a 1,000-row ceiling, matching the usual Supabase REST ceiling; explicit history windows keep their configured limits. Existing load-more history requests retain their original path.
- Small attendance scan/correction receipts still use the original endpoint immediately. A scan does not evict the cached roster; the next snapshot sends only changed attendance fields.
- Full Postgres row subscriptions are replaced by `sync_invalidations`, a small table of table names, scope keys and opaque revisions. Class/student notices use RLS; shared catalog notices contain no record contents. The existing table stream remains available only for pre-migration compatibility. Pure raid-presence timestamp changes do not generate notices.
- Simultaneous reads coalesce, same-context requests serialize, and refresh bursts produce one refresh at a time. Hidden/offline screens defer polling and queued refresh reads; visibility/reconnect catches up. Attendance recovery polling changes from 3 to 5 seconds; individual taps still submit immediately. Active boss/recitation polling remains responsive with small packets and local animation.
- New identical boss-art/sprite/atlas uploads receive content-derived immutable URLs and a one-year cache policy. Mutable/custom paths retain short caching. Existing asset URLs/files are preserved. This does not recompress artwork or change frames, dimensions, alpha or animation timing.
- Account changes/logout clear conditional data and reject stale responses. Scores, hearts, loot claims and wallet changes remain server-confirmed and retain existing idempotency and authorization rules.

No service-role or management token is embedded in the client. The table snapshot reader is **SECURITY INVOKER** and uses existing table SELECT permissions/RLS. Domain wrappers delegate to existing authoritative functions. The pure packet helper has no database reads. Invalidations are server-written; authenticated clients cannot create or modify them.

## Verification and measurement

`npm run test:egress` uses real PostgreSQL with the production transport, both boss ID types, the idempotent migration, foreign/anonymous rejection, table RLS, changes/deletions/null photos, awards/undo/scans, and fresh reconnects. Browser recitation, attendance, ultimate and loot-race suites exercise compact responses. Unit tests cover serialized/deduplicated requests, legacy negotiation, account isolation, compact subscriptions, hidden tabs and content-derived asset caching.

A fixture with a 100 KB visual profile and 50 questions transferred under **7 KB for twelve warm boss snapshots**, compared with about **1.3 MB** for equivalent full snapshots. This measures JSON bodies in a test, not production billed egress. A cold response includes version metadata and can be larger than a full response; savings come from reuse across subsequent polls and updates. Actual results depend on class size, asset sizes, changes, browser cache, compression and usage.

In the browser console, `DBService.diagnostics().egress` reports estimated response-body bytes, reconstructed full-body bytes, compact/legacy counts and missing compact endpoints. It excludes HTTP headers, Realtime traffic and image downloads; **Supabase Usage is authoritative**. Counters are local to the tab and are not sent to a telemetry service.

`supabase/egress_usage_audit.sql` is an optional read-only size audit. It reports aggregate boss JSON/photo fields and stored assets without dumping student details. It cannot report billed egress.

## Remaining capacity considerations

- First-time devices still download the questions and artwork they need. Prefer WebP for large artwork/sheets, reuse a sheet across slots and avoid huge embedded campaign images/photos. The update preserves existing content; it does not rewrite or delete stored media.
- Existing images retain their previous HTTP cache headers. Newly uploaded generated assets use the immutable policy; replacing a file creates a different content URL.
- Conditional responses reduce outgoing bytes, but the original snapshot functions still perform their database reads. This is a bandwidth optimization, not a promise of unlimited compute or concurrent users.
- Add available usage/budget notifications in Supabase and review usage during real classes. Sustained legitimate traffic can still exceed a plan's allowance; optimization cannot guarantee otherwise.

Existing endpoints remain intact. Rolling back application code does not require deleting student data or reward records.
