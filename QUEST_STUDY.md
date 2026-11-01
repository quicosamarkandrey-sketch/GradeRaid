# Quest study experience

The Quest Board is now a study library with search, recommended/title/recent sorting, and All sets / To review / Attempted / Saved filters. Opening a set offers three separate modes:

- **Flashcards:** flip questions and answers, shuffle, star difficult questions, mark known/still learning, and review only starred or still-learning cards. Keyboard: Space to flip, arrows to navigate, K to mark known, S to star. Matching flashcards include the terms on the question side.
- **Practice:** untimed questions using the existing MC, true/false, identification, enumeration and matching grader. Supports alternate identification answers and partial credit. Students can check an answer or choose “I don’t know yet,” see feedback, and retry just the missed questions at the end. Enter checks a typed identification answer.
- **Scored quiz:** a confirmation explains timing, attempt number, answer locking, leaving early, and reward rules before starting the existing scored runner. The screen now uses quiet surfaces, readable choices, and progress based on answers submitted. Results link back to the set to review and practice.

Flashcards and practice never write quiz history, XP, coins, completion flags or attempt overrides. Scored grading, attempts, cooldowns, chain progression, and the balanced coin policy keep their existing behavior. A perfect scored result still blocks further scored attempts while study stays available for an open set.

Study entry points check section assignment, active status, schedule, daily/weekly rotation and prerequisite chain steps. A previously completed set that is later reassigned remains visible with its historical best score, but new study/scored actions are disabled if it is no longer available. These are UI checks on already-loaded content, not a replacement for database authorization or server-side assessment security.

Saved sets, known/starred cards, flashcard position and the most recently opened set synchronize through the student account after applying phase73. A local cache and durable per-card operation queue support offline study and safe retries. The UI reports account-saved versus device-only status. On the same card/field, the last change received by the server wins; independent card changes merge. Refresh occurs on login, tab focus, visibility return, reconnect, or Sync now. Practice rounds remain session-only. Editing a question set resets its self-assessment state using a content fingerprint; an in-progress study session also checks that fingerprint before continuing. New scored attempts record their question fingerprint locally so missed-question review can reject a changed set. Older attempts and attempts from other browsers lack that metadata: review uses their per-question results only when the question count still matches.

Teacher Quest library cards now provide a student flashcard preview and collapsible question/answer lists. Existing authoring templates, question types, analytics, section assignment, schedules, cloning and publishing are retained. Every open published set supports study modes; there is no separate exam-only toggle in this version.

Apply `supabase/phase73_study_progress.sql` in Supabase SQL Editor, then refresh app tabs to enable account sync. It is transactional/repeatable and requires the existing profiles, quizzes, quiz_sections and quiz_history tables. Without these RPCs the app keeps study progress locally and reports that account sync is not enabled. This environment does not have production database credentials, so the migration is provided for the database owner to apply. The previously added balanced learning coins independently require phase72.

Existing browser progress imports only where the account has no corresponding content version; it cannot replace existing cloud marks. Question fingerprints isolate revisions and ignore JSON object-key ordering, so a database round-trip does not reset progress. Existing browser fingerprints are upgraded without losing marks. Saved bookmarks are per quiz; card marks/position are per content version. Operation IDs prevent a network retry from replaying an old edit over a later change. No study RPC can write profiles, grades, XP, coins, or attempts. New tables use RLS with direct authenticated access revoked; scoped RPCs derive the student from auth.uid().

## Reward summary

The shared reward popup now uses a theme-aware receipt layout, clear amounts, compact rarity badge and a fixed Continue footer. It supports long lists and title rewards, keyboard focus trapping/restoration, Escape and reduced motion. It removes the rainbow strip, large glows and confetti. Rewards are still granted by their original callers; dismissing or replacing this presentation cannot grant them again. Close callbacks run once, including on replacement.

## Checks

- `npm run test:unit` — includes simulated two-device merging, offline reload/retry and late-response account isolation.
- `npm run test:study-db` — PostgreSQL semantics in PGlite: repeatable installation, patches, idempotency, scopes/ACLs and unchanged grade/reward tables.
- `node tests/browser/quest-studio.cjs` — actual app library controls, responsive themes at 320/390/1440, keyboard cards, saved progress, five practice types, partial credit, missed review, no study reward mutations, scored handoff and safe exit during answer reveal, schedule/section/chain restrictions, account isolation, content changes, escaping, teacher preview and saved sets surviving reload. External services are intercepted.
- `node tests/browser/study-sync.cjs` — two isolated browser contexts with a local RPC fixture test cross-device progress, offline merging/reload and unchanged XP/coins/grades.
- `node tests/browser/reward-summary.cjs` — responsive light/dark summary, amounts/titles/empty/long lists, visible footer, focus/Escape/replacement, callback idempotency and no reward mutations.
- `node tests/browser/learning-rewards.cjs` — scored settlement and Armory regression.
- `node tests/browser/application-theme.cjs` — shared page/theme regression.
- `node tests/browser/student-learning.cjs` — existing dashboard/Progress/Hall of Fame navigation regression.
- `npx esbuild build/entry.full.js --bundle --outfile=/tmp/graderaid-study.js`
