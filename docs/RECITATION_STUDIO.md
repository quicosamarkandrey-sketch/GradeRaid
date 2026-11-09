# Recitation Studio

Live Monitor → **Recitation Studio** opens a teacher remote and a paired classroom presentation. Students raise their hands, answer aloud and tap a card; students need neither an account open nor an internet connection during recitation.

## Database installation

Run **[phase81_recitation_presentation.sql](../supabase/phase81_recitation_presentation.sql)**, then **[phase82_recitation_spotlight.sql](../supabase/phase82_recitation_spotlight.sql)** in the hosted Supabase SQL Editor. If phase81 is already installed, only run phase82. Phase82 adds manual award amounts and shared random-call reveals. Always apply phase82 after phase81 when rerunning migrations. It requires the existing attendance/seating schema and migrations 30 (authorized scoring), 71 (shared sessions), and 72 (learning rewards). This migration adds presentation state and scan receipts; it reuses `log_recitation_point` and `undo_recitation_log`, so existing XP/coin triggers and recitation histories retain responsibility for rewards. It does not replace scoring rules or award extra coins locally. Safe to run again.

The migration is tested locally; repository deployment does not run it on hosted Supabase automatically. A missing RPC produces a setup message rather than falling back to unsafe local scoring.

## Classroom workflow

1. On the teacher phone, select the class in Live Monitor and open Recitation Studio. Start/resume the session.
2. In **Connect**, read the eight-character code or open a presentation tab. On the classroom computer, sign in as authorized staff, open the studio, and join using the code. A code locates the session; it never grants classroom access.
3. In **Questions**, enter one question per line, or import an existing quiz. `Question | private answer note` keeps the note on the remote. Add a question image URL if useful. Select a seating layout, score period and presentation view.
4. Offer 10/20/30 seconds of thinking time. Pause, resume or add ten seconds. Expiry never forces a pick.
5. For raised hands, select the volunteer and give them the floor. Otherwise use **Call a student** with a preset and optional advanced filters. Random calls run a synchronized 2.4-second sequence cycling through eligible students' square profile photos, then reveal the server-selected speaker. Rejoining uses the remaining reveal time rather than restarting it. Volunteers open their spotlight directly. Calling records a speaking opportunity; it awards nothing.
6. After an accepted verbal answer, have the student tap their card. **Open** accepts any present class member; **Selected speaker** privately checks that the scanned card matches the person called. A mismatch requires an explicit teacher decision.
7. If a student forgot their card, expand **No card? Give points manually**, choose the present student (or **Use called student**), enter 1–10 whole points and an optional private note, then award. Manual awards use durable UUID receipts, the same server scoring/reward rules, and the same confirmation and undo as scans. Pausing card scans does not block intentional manual awards. Duplicate submissions while an award is pending are blocked.
8. A confirmed point amount appears over the student's faded square photo, followed by their confirmed total. Recognition is queued so rapid successful scans do not stack popups. The presentation receives awards and corrections without displaying teacher notes, scanner errors or filters.
9. Use **Undo** for the latest active studio award, including after finishing while this studio remains open. Finish shows a public summary. Existing recitation history remains the full record.

## Selection and display

Presets: everyone present, fresh voices, fewer speaking opportunities, lower recitation score, and return-later queue. Advanced filters support the last 2/3/5 picks, repeats per question/session, temporary student groups, seat rows/columns and exclusions. Lower score can use this session, today or a chosen reporting period. Unseated present students remain eligible. An empty pool is explained; filters are never silently relaxed.

Rows/columns are derived from equal seat coordinates in the selected saved layout. Arbitrary groups use the roster checkboxes. Attendance follows the app's existing Asia/Manila school day. Students must be marked Early, On Time or Late before a studio tap can earn a point.

The presentation offers question focus, fitted seating with labelled totals, and speaker spotlight with the question still visible. A new call can transition from its seat into the spotlight. The student's current saved profile photo is used for seats, call selection, spotlight and award recognition, including uploaded base64 images and web image URLs. Missing or failed pictures fall back to initials. Photo updates are reflected by polling even without a new presentation revision. Reduced-motion preferences suppress animations; random calls show a steady placeholder before the same timed reveal. The projector receives snapshots approximately every 1.2 seconds; the remote applies confirmed RPC responses immediately. Reopening or joining seeds existing receipts without replaying old applause.

Only one device controls a session. **Remote controls** on a display explicitly transfers control after confirmation. The previous remote becomes a display on its next snapshot. Separate devices must each sign in with a staff account authorized for the same class.

## Scanners and connection recovery

- Phone NFC uses Web NFC (`NDEFReader`), requires a compatible secure-context browser such as Android Chrome, permission and compatible cards with a readable serial number. Keep the browser foregrounded. Device hardware has not been physically validated by automated tests.
- Web NFC does not read 125 kHz RFID cards. An external keyboard-wedge reader or the card-ID field remains available. Keyboard capture avoids text fields; use the dedicated card field when typing in settings. Phone NFC stays armed across remote tabs, timers and question controls.
- Normal accepted taps award +1 without a confirmation dialog. A five-second per-student cooldown protects against card bounce, on both client and server.
- Every scan gets a random UUID saved to this phone before transmission. The server serializes the session and stores the receipt in the same transaction as the score. Retrying a committed receipt returns its original result, including after undo or session end.
- Unsent cards are visibly **pending**, never counted as confirmed. Reconnect/reopen retries them with the same UUID. Cards from a changed question, a paused/ended session, another class, or an absent student require teacher review and remain visible with an error and a discard button. There is no blind batch award.
- Phone and projector need internet for live synchronization. Offline pending storage is not an offline LAN presentation relay. Clearing browser storage deletes unsent scans; the interface refuses to accept a scan if it cannot persist it.

## Validation

`npm run test:recitation` runs real PostgreSQL-compatible migration/RPC tests and a two-browser Playwright scenario using the actual app with SQL-backed RPC responses. Includes authorized pairing and role grants, controller transfer, present/unseated selection, strict filters, volunteer selection, no points on pick, wrong-card prompts, duplicate retry, cooldown, question context, timer, undo, finish, an offline queue across reload, private notes, one recognition per receipt, simulated NFC continuity, 320/390/768 viewport checks, reduced motion and cleanup. Browser tests use `/usr/bin/chromium`.
