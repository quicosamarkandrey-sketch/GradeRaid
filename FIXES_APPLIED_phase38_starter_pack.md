# FIXES APPLIED — Phase 38: Starter Pack (`seed_new_teacher()` + Starter Pack Editor)

(ISOLATION_ROLES_PLAN.md §6 "Starter pack — the mechanism", §7 "draft
content", §11 "Starter-template editor", §12 step 5 — chunk B.)

## What was unfinished
Chunk A shipped the invite-based teacher account creation flow
(`redeem_teacher_invite()`, phase37), but a brand-new teacher landed with a
completely empty catalog — no achievements, titles, quiz, campaign world, or
shop items. §6 called for a one-time copy mechanism instead, and §11 called
for a small admin screen to maintain that template content over time rather
than freezing it in a migration file forever.

## What changed

**`supabase/phase38_starter_pack.sql`** (new)
- `is_starter_template boolean not null default false` added to all 5
  catalog tables: `achievements`, `titles`, `quizzes`, `campaign_worlds`,
  **and `shop_products`** — §6's prose only names four tables, but §7's
  draft content explicitly includes 5 shop items, so shop_products gets the
  same treatment (it already has the identical `owner_teacher_id` shape
  from Phase 14). Documented as a drafting gap, not a deliberate exclusion.
- `starter_template_owner_id()` — helper returning a fixed pseudo-account id
  (`00000000-0000-0000-0000-000000000000`), so the constant lives in one
  place instead of being repeated across every function below.
- A real `profiles` row for that pseudo-account (`role = 'template'`,
  `is_active = false`) — required because every catalog table's
  `owner_teacher_id` is `references public.profiles(id)`. It can never be
  logged into (no matching Supabase Auth user exists, ever), and
  `role = 'template'` means it's automatically invisible to every existing
  `role in ('admin','teacher')` check with zero changes to any of them.
- Seed data for §7's draft content: 12 achievements, 8 manual-grant titles,
  1 sample quiz, 1 sample campaign world, 5 shop items — all deterministic
  ids, `on conflict do nothing`, so re-running this file never duplicates
  or resets anything since edited via the template editor.
- `seed_new_teacher(p_new_teacher_id)` — SECURITY DEFINER, the one-time copy
  itself. Guards against double-seeding (refuses if the target already owns
  ANY catalog content). Achievements are copied first into a temp
  old-id→new-id map so titles' `achievement_id` can be correctly repointed
  at the new copies rather than the template's ids — none of today's 8
  starter titles are achievement-linked, but this handles it correctly if
  a future template edit adds one. Shop items get a fresh `stock = null`
  (unlimited) on the copy — the template row's own stock value is never
  meaningful.
- `redeem_teacher_invite()` re-created (byte-for-byte identical to
  Phase 37's version otherwise) to call `seed_new_teacher()` at the end, in
  the same transaction — atomic, so a seeding failure rolls back the whole
  account creation instead of leaving a teacher with no starter content.
- `get_starter_pack()` — admin-only read, bundles all 5 tables' template
  rows in one jsonb call for the new editor screen.
- `upsert_starter_achievement()` / `upsert_starter_title()` /
  `upsert_starter_quiz()` / `upsert_starter_campaign_world()` /
  `upsert_starter_shop_item()` — admin-only create-or-update, one per table.
  The client always supplies `p_id` (a fresh `uid()` for new items, the
  existing row's id for edits); insert-or-update via `on conflict`.
- **Deletes reuse the existing `delete_achievement()` / `delete_title()` /
  `delete_quiz()` / `delete_campaign_world()` / `delete_shop_product()` RPCs
  unchanged** — each already checks `is_same_staff_or_admin(owner)`, and an
  admin session passes that regardless of which teacher (or the template
  account) owns the row. No new delete RPCs needed.

**`db-service.js`**
- The pull-side mapping for all 5 catalog arrays (`achievements`,
  `titlesArr`, `quizzesArr`, `campaignWorldsArr`, `store`) now filters out
  `is_starter_template` rows. Needed because RLS lets an admin session see
  template rows (the admin branch of `is_same_staff_or_admin()` bypasses
  the owner check for every row), so without this filter an admin's regular
  Achievement/Titles/Quiz/Campaign/Shop screens would show template content
  mixed in with their own real content. Template rows are now visible only
  through the new `get_starter_pack()` RPC, used exclusively by the new
  editor screen.

**`modules/admin/starter-pack-service.js`** (new)
- `StarterPackService` — `fetch()`, `save*()` ×5, `delete*()` ×5. Same
  repository-pattern contract as `TeacherDirectoryService`/`SectionService`:
  the render layer never calls `DBService.rpc()` directly.

**`modules/admin/starter-pack-editor.js`** (new)
- `renderStarterPackEditor()` — tabbed screen (Achievements / Titles / Quiz
  / Campaign World / Shop Items), each with add/edit/delete. Edit/delete
  buttons pass an array index into the fetched pack (same convention as
  `adminEditStage(wi, si)` / `setCorrect(qi, oi)` elsewhere in this app),
  not a serialized object embedded in the `onclick` attribute.

**`nav.js`**
- Added `a-starter-pack` to `NAV_ADMIN` and to `ADMIN_ONLY_NAV_IDS`, and
  wired it into `navTo()`'s routing chain → `renderStarterPackEditor()`.

**`index.html`**
- Added the `#a-starter-pack` page container div, and script tags for
  `starter-pack-service.js` / `starter-pack-editor.js` (after
  `teacher-directory.js`).

**`modules/admin/dsm-manager.js`**
- Added a matching `a-starter-pack` entry to `DSM_ADMIN_DEFAULTS`
  (`adminOnly: true`), keeping it in sync with `NAV_ADMIN` per this file's
  own documented "keep these two lists in sync" rule — the reconcile
  safety net would have caught a missing entry, but not the `adminOnly`
  flag, so this was added explicitly rather than left to the fallback.

**`modules/admin/index.js`**
- Added `renderStarterPackEditor` to the load-verification export list.

## Explicitly NOT touched / known v1 scope limits
- **Title cosmetics** — the editor covers name/description/icon/rarity/
  active + 4 basic colors (text/border/glow/bg). Gradients, animation,
  particles, background effects, and custom CSS are not editable on the
  template here; a teacher can still set all of that on their OWN copy
  after seeding, same as today. Flagged as a deliberate v1 scope choice.
- **Quiz questions** are edited as a small repeatable list (not the full
  Quest Builder UI); **campaign stages** are edited as a raw JSON textarea
  (not the full Stage Map Editor). Both match §11's "small screen" framing
  rather than rebuilding either full editor for template-only content.
- **`is_hidden`** (achievements' admin-side-only local category filter) is
  not part of the starter pack schema, same as it already isn't part of the
  regular `achievements` sync (Phase 17) — not a new gap introduced here.

## Files changed
- `supabase/phase38_starter_pack.sql` (new)
- `db-service.js`
- `modules/admin/starter-pack-service.js` (new)
- `modules/admin/starter-pack-editor.js` (new)
- `nav.js`
- `index.html`
- `modules/admin/dsm-manager.js`
- `modules/admin/index.js`

All edited/new JS files pass `node --check`.
