# App feedback and recovery

This pass establishes shared UI patterns and applies them to the flows listed below. It is not a claim that every legacy page has been redesigned.

| State | Behavior shipped | Applied to |
|---|---|---|
| Empty | Explain what will appear and offer a relevant first step | Inventory, purchase history, Armory, existing World Boss onboarding |
| Loading | Keep existing content, mark the region busy, prevent duplicate submissions | My Section refresh; shared async buttons |
| Error | Distinguish network failures, access restrictions and generic failures; allow retry for reads | My Section; reusable `UXStates.task` |
| Offline | Persistent connection notice; show loaded data and disclose that it may be stale | All screens; My Section fallback; login connection requirement |
| Slow network | After five seconds, explain that the request is still pending; keep content available | My Section and shared async buttons |
| Zero results | Distinguish no matching data from first use; clear filters in one click | Inventory, purchase history, Armory category, World Boss events |
| Permission denied | Explain role/section access and a recovery route | Admin-only navigation and My Section failures; shared device-permission error copy |
| Session expiry | Capture registered authoring drafts before teardown, close editors, return to login | Quest Builder, World Boss event editor, Boss Studio profile editor |
| Validation | Place errors at inputs, associate with `aria-describedby`, focus the first invalid field | Login, quest title/end date, Boss Studio name, World Boss event fields |
| Success | Confirm the outcome and offer the next relevant destination | Confirmed Boss Studio saves; reconnect notice explicitly asks users to check pending actions |

## Recovery boundaries

Recovery uses **sessionStorage in the same browser tab**, keyed by account ID and checked against the current role. Drafts expire after 12 hours. Another account cannot restore them through the UI. Recovery is offered after signing in with the same account; it never publishes or saves automatically. Explicit logout clears that account's recovery backup. Discard removes a backup immediately.

Only the three explicitly registered authoring adapters are captured. Login passwords, arbitrary form fields, active graded quiz answers, attendance queues, cart transactions and battle state are not copied by this feature. Existing services retain ownership of those workflows. Backups are capped at roughly two million JSON characters; browser quota limits or large embedded art can prevent capture. The expiry message does not promise recovery when capture fails. Prefer uploaded Boss Studio assets over embedded image data.

Capture runs before expiry cleanup and on pagehide. This protects sign-out and ordinary navigation/reload, but cannot guarantee recovery from a browser/device crash before pagehide, a closed tab, cleared site storage, or a storage failure. It is not cloud synchronization. A saved draft remains local on the shared device until resumed, discarded, explicitly logged out, or expired; users should complete sign-out when finished.

Expired-session cleanup does not flush remote writes with invalid credentials or issue another sign-out from inside Supabase's auth callback. Normal logout retains the existing flush-before-sign-out behavior. Auth callbacks capture synchronously, then defer teardown to avoid auth-client callback deadlocks.

## Extending the pattern

`UXStates.render(container, type, options)` creates accessible feedback with text content and optional action callbacks. Types: `empty`, `loading`, `slow`, `offline`, `error`, `zero`, `permission`, `success`.

`UXStates.task(target, label, async stage => ..., {scope, retry})` adds progress to an existing region without erasing its content. Update `stage` only for actual milestones; never invent percentages. Use `scope` for the account/request context. It deduplicates concurrent requests within that scope. A previous account's request cannot remove a newer account's loading state. The consuming renderer must still check identity before displaying its result, as My Section does.

Provide a retry callback only for reads or operations whose service already guarantees idempotency. This module does not automatically repeat payments, claims, scans, quiz submissions or publishing actions. It never treats a local write or restored connection as proof that the server confirmed an action.

`UXStates.fieldError(inputOrId, message, existingHintId)` marks an exact field and preserves its other descriptive hints. Input/change clears that error. `UXStates.focusError(root)` moves focus to the first invalid input.

Register another authoring adapter with `registerDraft(name, {label, get, restore, clear})`. Capture a bounded data model, never arbitrary DOM values. The restore adapter must recheck current ownership and availability before editing existing records.

## Verification

- `npm run test:unit`: includes recovery isolation/expiry, field accessibility, safe text rendering, concurrent requests, slow/error states, and loading-button restoration/deduplication.
- `npm run test:ux`: actual Chromium page covering inline login validation, expired-session teardown, all three real editor restorations, account isolation, navigation permissions, empty/filter recovery, stale section data, and offline/reconnection at phone and desktop widths.
- Admin, student and full role entries compile with esbuild.

Live Supabase authentication and production network/load behavior still require staging verification. The browser suite controls service responses and auth events; it does not sign out a real production user.
