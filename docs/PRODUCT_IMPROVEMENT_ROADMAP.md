# GradeRaid product improvement roadmap

Prepared 9 November 2026. Planning baseline: application commit `607f107`.

This is a proposal for product work, not an instruction to implement every feature at once. The research uses official manuals and public product source. The GradeRaid adaptations and priorities below are recommendations, not claims that competing products implement these exact experiences. Source review is not a hosted production audit or a usability test with students.

## 1. The product we are building

GradeRaid should make learning rewarding and enjoyable while giving teachers fast, dependable control of a real classroom. Its advantage is the connection between classroom participation, study, progression, meaningful rewards and shared battles.

The next objective is to make those parts feel like one application. A student should understand their next action and what they earned. A teacher should be able to run a lesson without repeatedly searching through separate screens.

### Decisions carried forward from the owner's feedback

| Preference | Product consequence |
| --- | --- |
| An established application rather than a generic game dashboard | Consistent typography, spacing, buttons, dialogs, status messages and interaction rules across student and staff views. |
| Predominantly black and white, with useful color | Neutral application surfaces; clear status colors; richer, deliberate palettes inside games and character artwork. White cards and light mode remain valid. |
| Repeated objections to decorative emoji | Consistent sidebar icons and no decorative emoji in titles. Use emoji selectively in content only where they help communicate. |
| Compact, usable phone layouts | Test common tasks at 320, 390 and 430 pixels; collapse secondary detail, not essential controls; retain usable touch targets. |
| A clean My Progress page | Summaries first, details on request, clear definitions of each score, and no duplicate achievement collection. |
| Previous changes to My Progress and Hall of Fame were reverted | Preserve their familiar structures. Any proposed substantial redesign needs a concrete comparison with the current page before implementation. |
| Points and coins should make classroom effort worthwhile | Explain earning, limits, reversals and purchases. Give coins a clear destination, not merely more ways to accumulate. |
| Some titles are teacher-granted | Distinguish automatic criteria from teacher recognition; do not present grant-only titles as farmable challenges. |
| Exciting, unique bosses with visible shared participation | A distinct encounter identity per boss, readable charges, noticeable confirmed damage, teacher preview and coherent animation rules. |
| Latest Cataclysm feedback | Keep questions intact; retain confirmed-answer/crown shatters; beam origins stay off-screen; make actual heart loss explicit. |
| Dramatic individual loot pickups | Preserve scattered, limited, server-confirmed pickups and the existing contributor rewards. Do not reintroduce in-arena stock counters or a prominent loot-race timer. |
| Always push project updates to GitHub | Deliver future work in reviewable commits with appropriate validation and a clear note when a database migration still needs applying. |

## 2. What is already present

These recommendations extend existing systems rather than proposing them as missing features.

| Area | Evidence in the current repository | Direction of improvement |
| --- | --- | --- |
| Study | `modules/quests/study-studio.js` has flashcards, practice, scored-quiz entry, known/learning markers, starred cards and missed-question review. | Add scheduled review and topic understanding rather than another parallel study mode. |
| Study synchronization | `modules/quests/study-sync.js` merges durable per-card patches between devices. | Extend the data carefully for review scheduling; make save/reconnect feedback consistent elsewhere. |
| Quest authoring | `modules/admin/quiz-builder.js` supports study preview, publishing and per-question statistics. Published material feeds the existing study modes. | Add stable question identities, topic tags, explanations and reusable versioned question-bank entries. |
| Learning paths | `modules/quest-chains.js`, the quest engine and stage map already provide sequencing and progression. | Connect paths to the daily lesson and offer a recovery route when a student needs practice. |
| Seating | `modules/seat-arrangement/classroom-editor.js` already includes undo/redo, multi-select, fit, snap, alignment and seat sizing; assignment tools support swaps. | Add recoverable saved versions and clearer lesson-specific configurations, not another basic undo implementation. |
| Live Monitor | Projection, private score controls, zoom/pan, attendance interactions, recitation selection and undoable recitation entries already exist. | Bring these into a coherent class-session workflow and explain participation-selection rules. |
| Analytics | `modules/admin/analytics.js` and quiz analytics already show performance information. | Connect findings to teacher actions and topic-level evidence. |
| Rewards | `modules/rewards/learning-rewards.js` and phase72 SQL provide server-confirmed rewards, caps, wallets and a ledger. | Expose useful transaction explanations and reward goals through authorized APIs. |
| Shop orders | `modules/shop/shop_orders.js` already distinguishes pending, ready, claimed and cancelled orders. | Make earning-to-redemption easier to follow and reduce teacher fulfillment work. |
| Boss battles | Shared snapshots, participant contributions, confirmed damage, atomic loot, Studio animations and Cataclysm already exist. | Build reusable boss identities and preview tools, preserving the reliable server lifecycle. |

Existing features still need task-based checks against the deployed application before calling any observed friction a confirmed production bug.

## 3. Research and how to adapt it

Some product marketing sites were blocked by the environment's proxy. The following official manuals/source repositories were successfully retrieved instead. No claims about subscription tiers, current prices or paid-interface behavior are made.

| Application and verified pattern | Evidence | GradeRaid adaptation |
| --- | --- | --- |
| **Anki:** separates new, learning and due cards; answer ratings affect the next review interval; the interval is visible. AnkiWeb supports collection synchronization across devices. | [Studying manual](https://github.com/ankitects/anki-manual/blob/main/src/studying.md), [Syncing manual](https://github.com/ankitects/anki-manual/blob/main/src/syncing.md). | Evolve the existing known/learning and missed-question features into a small “Review due” queue. Show why an item is due and when it returns. Retain GradeRaid's simpler language rather than copying four assessment buttons automatically. |
| **Moodle:** a categorized question bank can supply random questions; quizzes support feedback/review settings. User reports combine grades, feedback and course totals. | [Official quiz help strings](https://github.com/moodle/moodle/blob/main/public/mod/quiz/lang/en/quiz.php), [User report descriptions](https://github.com/moodle/moodle/blob/main/public/grade/report/user/lang/en/gradereport_user.php). | Create reusable, tagged questions with explanations and versioned published attempts. Reuse a teacher's material across study, assessment and raids while preserving old results. Present explanatory feedback alongside scores. |
| **Canvas:** modules can specify prerequisite modules and sequential progression. | [Official Modules API documentation in source](https://github.com/instructure/canvas-lms/blob/master/app/controllers/context_modules_api_controller.rb). | Extend existing quest chains into a clear lesson sequence, with a visible next step and understandable unlock conditions. Provide a review/retry route instead of an unexplained lock. |
| **H5P Branching Scenario:** a course can change according to the learner's answers. | [Official project overview](https://github.com/h5p/h5p-branching-scenario/blob/master/README.md). | Later, offer a few teacher-editable story-quest templates with decisions, explanations, recovery branches and different endings. |
| **Excalidraw:** zoom/pan, undo/redo, reusable shape libraries and export; its hosted application documents local autosave and collaboration. | [Official feature overview](https://github.com/excalidraw/excalidraw/blob/master/README.md). | Extend the existing seat editor with recoverable room versions, reusable arrangements and understandable save/conflict states. Borrow the interaction principles, not its visual style or an unnecessary full editor rewrite. |
| **Habitica:** its official overview describes an RPG loop of completing real-world tasks, leveling up, earning gold and purchasing equipment. | [Official overview](https://github.com/HabitRPG/habitica/blob/develop/README.md). | GradeRaid already has this loop. Improve its meaning with visible savings goals, understandable earning receipts and a usable redemption process. Those specific additions are GradeRaid recommendations, not verified Habitica feature claims. |

## 4. Delivery plan

The product phases below are separate from existing SQL migration numbers. They describe an order of delivery, not a calendar commitment; estimates need actual task baselines and the selected scope.

### Phase 1 — Make the daily classroom flow coherent

**Priority:** highest. **Main benefit:** less navigation, clearer feedback and a more established feel.

Teacher flow: select the correct section → open the class session → confirm attendance → conduct recitation → finish with a concise session summary.

Student flow: open the dashboard → see an unfinished task or resume studying → reach recitation totals/history in one action → understand confirmed rewards.

Deliverables:

- A consistent section/session indicator and session toolbar in the Live Monitor. Reuse existing attendance, picker, award and projection functions.
- A compact student dashboard with one primary next action, concise recitation access and relevant pending work. Use current missed-question review; do not display a fictional scheduled-review count before Phase 2 exists.
- A consistent confirmation pattern for saved attendance, awarded points/coins and purchases: pending, confirmed, failed with retry. Reuse authoritative responses rather than showing guessed totals.
- A shared set of typography, button, dialog, card and state styles, introduced first on these two flows and then reused across the remaining pages.
- A consistent mobile density model for My Section, Inventory and Armory, using compact rows and detail views where appropriate.

Acceptance:

- Teacher attendance and recitation tasks are reachable from the same session view.
- A student reaches recitation history directly from the dashboard.
- Main tasks work at 320/390/430 pixels without horizontal overflow or hidden essential actions.
- Projection continues to support private scores; seat labels do not regain the clutter previously removed.

### Phase 2 — Make study useful over time

**Priority:** high. **Main benefit:** the student gets a useful reason to return, and teachers reuse content more confidently.

Deliver in two increments:

1. **Question foundations:** stable question IDs, topics, explanations, difficulty labels and versioned published question snapshots. Import existing teacher material rather than requiring re-entry. Preserve current flashcard/practice/scored modes and existing study preview.
2. **Scheduled review:** a short due queue built on saved per-question history, with clear explanations and transparent next-review dates. Keep practice, academic scores and coin rules clearly distinguished.

Student example: “Review 5 questions on fractions from your last attempt,” followed by an explanation and a similar question, not just repeated guessing at the same answer.

Acceptance:

- Editing published material does not silently rewrite old attempts, results or their answer explanations.
- Review state resumes correctly on another device and shows its synchronization status.
- A student's self-marked “known” card is not automatically treated as demonstrated academic mastery.
- Topic progress uses suitable academic evidence. Attendance, purchases and boss damage are not substituted for understanding.

### Phase 3 — Make teacher information actionable

**Priority:** high after topic data exists. **Main benefit:** teachers can respond to what happened in class.

Deliverables:

- Topic-level class findings linked to their supporting attempts, with a direct action to assign a short review set or inspect the source questions.
- A lightweight exit ticket linked to the active lesson; show who answered and the response distribution, then include it in the session summary.
- Participation coverage and an explanation of the selected recitation strategy. Extend the existing least-participative/random strategies instead of inventing another disconnected picker.
- Saved room versions and lesson-specific seating configurations. Show what will change and allow recovery of a prior version, including assignments.
- Clear saved/saving/error/conflict states when another device or teacher changes the same layout.
- Attendance review that distinguishes unmarked records from confirmed absence, with straightforward correction history where supported.

Acceptance:

- A teacher can move from a difficult topic to a targeted review assignment without manually rebuilding the questions.
- Selection explanations match the actual picker rules and attendance eligibility.
- Applying a room version does not duplicate a student assignment or alter the wrong section.
- Simultaneous edits do not silently overwrite each other.

### Phase 4 — Give progression and rewards a clear purpose

**Priority:** medium/high. **Main benefit:** students understand effort, progress and the reason to save coins.

Deliverables:

- A student-visible wallet history explaining earnings, spending and reversals, backed by the existing ledger through scoped server APIs.
- A reward savings goal selected from teacher-approved shop items. Show the actual cost, balance and remaining amount.
- A clearer purchase-to-claim journey using the existing order states; streamline teacher fulfillment rather than introducing another competing order queue.
- A plain-language weekly progress summary with access to the underlying recitation, attendance and quiz records. Keep the current My Progress structure as the starting point and keep achievements in their own collection.
- Clear title eligibility: automatic milestone, limited/event reward or teacher recognition. Teacher-granted titles remain teacher-granted.
- Review Hall of Fame's current filters and structure before proposing small scoped changes. Preserve the layout previously restored; any new recognition categories need defined criteria and sufficient evidence.

Acceptance:

- A student can explain a balance change and where their purchased reward is in the claim process.
- Displayed XP, coins, recitation points, academic results and game contribution have clear, distinct meanings.
- Undoing a classroom award produces a comprehensible reversal rather than an unexplained wallet discrepancy.
- Reward goals do not introduce a second currency or an unrestricted practice-farming loophole.

### Phase 5 — Give bosses distinct identities and dependable previews

**Priority:** signature feature work. Visual prototypes can be developed alongside earlier phases; production mechanics still need shared-state verification.

First identity set:

| Boss identity | Ultimate | Distinct disruption |
| --- | --- | --- |
| Celestial | Cataclysm | Off-screen solar sweeps and answer-card destruction. |
| Dragon | Infernal Dominion | Directional breath, burning cards and cooling fire trails. |
| Clockwork Sentinel | Execution Protocol | Scanners, mechanical shutters and timed lock sequences. |
| Phantom | Palace of False Reflections | Mirror movement and clearly identifiable original answer controls. |

Deliverables:

- A Boss Studio Ultimate Identity selector with understandable defaults, not CSS-class configuration in the student experience.
- Preview controls for charge, a successful answer impact, interruption, failure damage and recovery, including phone layouts and simulated classmates.
- A reusable encounter lifecycle and motion rules: visible progress fractures on confirmed correct answers, an unmistakable health-loss cue, intact academic questions, distinct phase transitions and clear recovery.
- Extend the existing shared interruption/server outcome model for different ultimate identities rather than creating separate client-authoritative damage systems.
- Preserve the existing contributor rewards, scattered individual loot race and atomic claiming; improve clarity and resuming the same event when needed.

Acceptance:

- Two students agree on cast progress, outcome, health and remaining loot after reconnecting.
- Each boss has a distinct silhouette, charging object, release behavior and interruption animation.
- Preview cannot change live scores, wallets, inventory or raid state.
- Real heart loss remains explicit; decorative beam collisions cannot invent damage.
- Questions are never split into flying fragments, and beam origins do not appear as visible caps inside the viewport.

### Phase 6 — Expand the learning adventure

**Priority:** later, after the daily loop and content foundations work well.

Deliverables:

- A small set of branching story templates inspired by H5P: an investigation, repair mission and expedition.
- Extend existing quest chains/stage maps with lesson objectives, clear next steps and a practice route after a setback.
- Pilot cooperative missions where every participant has a defined contribution and an absent teammate cannot permanently block completion.
- Reuse the question bank, topic evidence and reward rules. Avoid adding an independent content engine or duplicating the same collection in more pages.

Acceptance:

- Teachers can author a simple branch without programming.
- Every branch has a recoverable ending and uses the correct published question version.
- Replaying story paths does not duplicate rewards.
- Students can identify what they learned, not only the items they unlocked.

## 5. Dependencies and engineering work

- Stable question identities and published snapshots precede scheduled review, accurate topic reporting and branching content. Preserve old attempts during migration.
- Topic tags and sufficient answer evidence precede topic-level recommendations. Display “not enough evidence” when appropriate.
- Session/section ownership must be explicit for attendance, recitation and teacher reports.
- The existing reward ledger should remain authoritative; expose a paginated, authorized view rather than letting the browser write balances or read unrestricted ledger data.
- Layout versions need a defined seat/assignment snapshot and server-side conflict handling.
- New ultimate identities require validated server configuration and shared outcome state, not a collection of independent browser timers.
- Keep classic-script and role-bundle copies consistent where this repository currently maintains both. This roadmap does not require a framework rewrite.
- Recheck migration status in the hosted project before releasing database-dependent features; repository scripts alone do not prove a live installation is current.

## 6. How to decide whether each phase worked

First record a baseline for the current common tasks. Then compare the revised flow using the same tasks, roles and device sizes.

Track:

- Time and number of navigation steps to begin a class, correct attendance and award/undo recitation points.
- Whether a new student can find their next task, recitation history and reward goal without guidance.
- Whether students understand what a displayed score measures.
- Review completion and later topic accuracy, with enough attempts to support a conclusion.
- Save/reconnect failures, repeated actions and balance/claim discrepancies.
- Teacher time to prepare reusable content and assign a review after seeing class results.
- Whether students notice damage and can identify why it happened during a raid.
- Mobile overflow, unreachable controls and the reduced-motion experience.

Use these observations to prioritize the next iteration. Do not promise percentage improvements before measuring the baseline.

## 7. Recommended first release

Start with **the teacher's daily session flow and the student's compact dashboard**, plus the small shared component/state patterns needed to make both consistent.

Next, establish question IDs/topics/explanations and build scheduled review on the study/sync functionality already present. This gives the website daily educational value while boss identity previews develop as a separate, focused design track.

Deliver one useful flow at a time, validate it with real teacher/student tasks, and push each reviewed project update to GitHub. Keep this roadmap as a prioritized proposal rather than treating every idea as an approved redesign.
