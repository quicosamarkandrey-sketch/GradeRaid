# Classroom attendance station

The Scanner & Records page now opens the arrival station. The classroom computer and its existing keyboard-style RFID reader remain the primary scanning device. Student phones are unnecessary.

## Install

Run [phase83_attendance_station.sql](../supabase/phase83_attendance_station.sql) in the hosted Supabase SQL Editor after the existing attendance schema, weekly/day-off schedule migrations 54/55, section authorization, and learning reward migration 72. It is additive and repeatable. It creates scan receipts, station-day finalization state and an edit audit. `attendance_logs` remains the record used by the existing attendance pages, live monitor and reward triggers.

This SQL has been tested locally. Pushing the repository does not apply SQL to hosted Supabase. The station does not fall back to unconfirmed local attendance when its RPC is missing.

## Student-facing design

A black canvas, white student reveal, large square saved profile photo and bold name replace the busy dashboard shown after each tap. The receipt contains the saved first arrival time and Early / On Time / Late status. It deliberately omits cumulative attendance percentage, absence warnings, wallet balance and rank. Unknown/wrong-section card IDs are never shown publicly.

The idle screen gives two steps: tap once, then wait for your name. The side panel shows Here / enrolled (including late students), not-yet-recorded count and the latest five arrivals. Absent and excused students are not counted as here or as unrecorded. Photos support uploaded raster data images and normal image URLs; missing/failed images fall back to initials.

**Monitor view** fills the available screen with the student reveal and moves recent arrivals into a slim lower strip. Exit monitor view restores the app navigation; the setting is remembered on that browser. Full screen also enables monitor view. Each new confirmed scan has a short photo reveal, staggered name/arrival entrance and checkmark animation. Photographs keep their original colors; green is limited to confirmed/ready cues, amber to late/attention and blue to early status.

The last confirmed student stays visible until another result is ready, with a live **Ready for the next card** cue. Queued arrivals each receive at least 1.25 seconds rather than overwriting one another, then the last one remains. Attention messages clear after a short interval. Finalizing attendance, a day change or a correction invalidating the held record clears the old reveal.

Confirmed, duplicate and attention results have distinct short tones. **Enable sound** requires a browser gesture; audio starts muted each visit. Staff can change volume. Muting retains all visual feedback. Reduced-motion preferences disable receipt transitions.

The browser reports whether its window is active and input is armed. It cannot verify physical USB-reader connectivity, so it never claims a reader is connected based merely on an open webpage. Use Station setup's dedicated test input to verify a card read without recording attendance.

## Daily workflow

1. Sign in as staff for the class, open Scanner & Records and check the selected section.
2. Open **Teacher view**, confirm the current staff account's password, then use **Station setup** to check today's schedule, connection, volume and reader input. Set the reader to keyboard/HID mode, ideally with an Enter suffix.
3. Return to scanning and optionally enter full screen. Keep this browser window active. Students tap one by one; new taps are accepted while previous confirmations are displayed.
4. A duplicate tap shows **Already checked in** and the original saved arrival time. It creates neither an extra attendance entry nor extra attendance rewards.
5. Review exceptions and forgotten cards in Teacher view. It locks on returning to scanning or after two minutes without staff interaction. Keyboard focus stays inside the teacher dialog. Opening it pauses new card input, including phone NFC.
6. Use **Manual entry** or **Record / correct** on a roster row. Enter the actual school date/time and a reason. Automatic status calculation uses the effective schedule. Outside the attendance window, choose an explicit status and explain the exception. Absent, Excused and Remove are also available. Edits preserve before/after records and the staff name.
7. Before **Finalize**, review not-checked-in students, excuse anyone appropriate, and resolve scan issues. Finalization marks only remaining unrecorded students absent. It preserves existing excused/arrival entries and prevents new ordinary station check-ins. Reopen keeps records intact; correction is still deliberate and audited.

Staff boards: Here, Not checked in, Late, All records, Needs review, Manual entry, Station setup, Edit history and Finalize. Here includes early/on-time/late arrivals. Not checked in means no entry, rather than an automatic absence. Staff can open the same class on another signed-in device and view arrivals via the same server snapshot, refreshed approximately every three seconds. No student-facing pairing step is needed.

The legacy schedule and card-assignment tools remain available through Station setup. The attendance station routes the legacy Close Session action to its review/finalization flow including when returning from card-assignment mode.

## Reliability and offline behavior

- Each tap receives a UUID and is persisted to this browser before transmission. A FIFO queue serializes requests and separates server work from public recognition so slow responses cannot reorder arrivals. The reader does not wait for the current animation to finish.
- The server authorizes the class and serializes competing stations. It stores the receipt and attendance insert in the same transaction. A retry with the same ID returns the saved result. A different tap of an already-present student preserves the original attendance and first arrival time.
- Same-card bounce within 2.5 seconds is ignored locally. Confirmations are remembered separately, so a response lost in transit can still be recognized once after a retry. Reloading does not replay previously seen receipts.
- An offline tap is **pending**, never displayed as confirmed. Its UUID and captured time survive page reload. Keep browser storage intact; clearing storage deletes unsent taps. Storage failure prevents accepting a tap.
- Captured times are aligned to the last server clock sample. A delayed tap over 20 seconds old, an implausible clock, a date mismatch or even a short delay crossing an attendance-status boundary goes to teacher review. It is not silently assigned the later reconnection status. The teacher confirms the actual arrival, which is recorded as a manual entry with an audit reason.
- Wrong-section, unknown-card, schedule and existing absent/excused conflicts also enter review. An absent/excused record is never celebrated as a successful arrival. Resolving an unknown-card arrival does not automatically bind that card to the student; card assignment stays a separate deliberate task.
- Finalizing is blocked by server review items and pending taps known on the current device. A disconnected computer's unsent storage cannot be seen by another device: check that the designated computer has synced before finalizing from a phone. This is cloud synchronization, not an offline LAN relay.
- Attendance coins/XP/streak adjustments remain owned by the existing phase72 triggers. The client does not mint rewards. Corrections/removals reconcile those rewards through the same attendance rows.
- Navigation/logout stops polling, capture, NFC and playback. Late responses from a previous class/account cannot change the current station. Existing attendance histories receive the authoritative rows and use their existing subscriptions.

Phone Web NFC remains optional for compatible Android browsers/cards. The computer reader remains the intended setup. iPhone browser NFC access has not been added by this change.

## Checks

`npm run test:attendance` runs the actual migration in PGlite with real phase72 reward triggers and the weekly schedule resolver, plus a SQL-backed Playwright test of the real application route. Covers permissions, UUID IDs, duplicates and saved arrival time, cutoff crossing, offline recovery across reload, absence/excused handling, manual correction and reward reversal, private review, password gate, reader testing without attendance, two-device teacher arrival feed, sounds, finalization/reopen, audit and responsive/reduced-motion cleanup. Automated readers are simulated; test your physical reader and browser/audio settings before class.
