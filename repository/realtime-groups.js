// ─────────────────────────────────────────────────────────────────────────────
// REPOSITORY — scoped realtime refresh groups (Priority 2 Fix 1)
//
// Phase 6 (Decompose God Files) extraction from db-service.js. Owns the
// declarative mapping from each realtime-subscribed table to its "refresh
// group" — the minimal set of Supabase tables that must be re-fetched
// together to correctly rebuild the cache slice(s) that table feeds into —
// and each group's fetch()+apply() pair. This is the same declarative-config
// pattern as repository/table-sync.js (Phase 5A/5B's push side, session 2)
// and repository/pull-mappers.js (session 7): db-service.js's
// _applyScopedRefresh() uses this to re-fetch only the 1-4 tables a
// realtime burst actually touched instead of unconditionally re-running all
// 27 queries in _pullCacheFromSupabase() on every single event. See
// EduQuest_Priority2_Plan.md "Fix 1" for the full writeup. No behavior
// change — every line below is moved verbatim.
//
// WHY THIS WAS SAFE TO EXTRACT (checked before moving anything, not
// assumed): grepped this entire block for every reference to db-service.js's
// OTHER internals — _cache, _getClient(), _meta, _pushCacheToSupabase,
// _pullCacheFromSupabase() itself — and found none (one comment mention of
// _pullCacheFromSupabase, not a real call). Every group's `apply` function
// takes `cache` as its own parameter rather than closing over db-service.js's
// `_cache` — that's what makes this config pure and _applyScopedRefresh()
// itself (which reads and reassigns `_cache` directly, and stayed in
// db-service.js for exactly that reason) genuinely different. NOTE: unlike
// every other Phase 6 extraction in this file, this piece has NO unit-test
// coverage exercising it directly — the delta-sync test suite covers the
// push side (repository/table-sync.js) and the pull side indirectly through
// DBService._test, but nothing in this codebase's test harness constructs a
// fake realtime payload and asserts on _applyScopedRefresh()'s output. This
// extraction was still done, but verified by the same static
// dependency-tracing method used for classroom_builder.js/live_monitor.js
// (sessions 3/5/9), not by a passing test suite — see this session's
// Refactoring Report entry for the full reasoning on why that's a
// meaningfully different confidence level than sessions 2/7's config
// extractions had.
//
// Exports: (none — both are read directly as module-scope consts)
//   Declares: _REALTIME_TABLE_GROUPS, _REFRESH_GROUPS
//
// DEPENDENCIES: the _deriveX() mapper functions and _HISTORY_LIMITS
// (repository/pull-mappers.js, session 7) — all globals already available
// wherever this file loads. Must load after repository/pull-mappers.js and
// before db-service.js (see index.html) — though as with every other
// Phase 6 split, nothing here runs at load time beyond declarations, so
// load order doesn't actually affect correctness, only reading order.
// ─────────────────────────────────────────────────────────────────────────────

  // ── Priority 2 Fix 1: scoped realtime refresh ─────────────────────────────
  // Maps each realtime-subscribed table to a small "refresh group" — the
  // minimal set of Supabase tables that must be re-fetched together to
  // correctly rebuild the cache slice(s) that table feeds into — and gives
  // each group a fetch()+apply() pair built entirely from the _deriveX()
  // helpers above. _schedulePullRefresh()/_applyScopedRefresh() (below) use
  // this to re-fetch only the 1-4 tables a realtime burst actually touched
  // instead of unconditionally re-running all 27 queries in
  // _pullCacheFromSupabase() on every single event. See
  // EduQuest_Priority2_Plan.md "Fix 1" for the full writeup, including why
  // boss_events/boss_participants/loot_claims are grouped as one "raid" unit.
  const _REALTIME_TABLE_GROUPS = {
    profiles: 'profiles',
    boss_events: 'raid',
    boss_participants: 'raid',
    loot_claims: 'raid',
    achievements: 'achievements',
    user_achievements: 'achievements',
    point_log: 'pointLog',
    recitation_log: 'recitationLog',
    rfid_cards: 'rfidCards',
    attendance_logs: 'attendanceLogs',
    mail_messages: 'mail',
    quiz_sections: 'quizSectionAssignments',
    achievement_sections: 'achievementSectionAssignments',
    titles: 'titles',
    title_unlocks: 'titles',
    title_sections: 'titles',
    quizzes: 'quizzes',
    campaign_worlds: 'campaign',
    campaign_stage_sections: 'campaign',
    orders: 'orders',
    inventory: 'inventory',
    quiz_history: 'quizHistory',
    notifications: 'notifications',
    student_skills: 'studentSkills',
    recitation_sessions: 'recitationSessions', // Phase 71
  };

  const _REFRESH_GROUPS = {
    profiles: {
      fetch: async (client) => ({ profiles: await client.from('profiles').select('*') }),
      apply: (raw, cache) => ({
        students: _deriveStudents(raw.profiles.data, cache.quizHistory),
        admin: _deriveAdmin(raw.profiles.data, cache.admin),
        equippedTitles: _deriveEquippedTitles(raw.profiles.data),
      }),
    },
    raid: {
      // The plan's documented stress case: a boss-event raid where up to 30
      // students trigger boss_participants/loot_claims changes in a tight
      // window. All three tables feed the same two cache keys, so they're
      // always fetched together — refreshing them separately would just
      // mean re-deriving bossEvents/bossParticipants 2-3x in a row for no
      // benefit.
      fetch: async (client) => {
        const [bossEvents, bossParticipants, lootClaims] = await Promise.all([
          client.from('boss_events').select('*'),
          client.from('boss_participants').select('*'),
          client.from('loot_claims').select('*'),
        ]);
        return { bossEvents, bossParticipants, lootClaims };
      },
      apply: (raw) => {
        const { bossEventsArr, bossIdById } = _deriveBossEvents(raw.bossEvents.data, raw.lootClaims.data);
        return {
          bossEvents: bossEventsArr,
          bossParticipants: _deriveBossParticipants(raw.bossParticipants.data, bossIdById),
          _bossIdById: bossIdById,
        };
      },
    },
    achievements: {
      fetch: async (client) => {
        const [achievements, userAchievements] = await Promise.all([
          client.from('achievements').select('*'),
          client.from('user_achievements').select('*'),
        ]);
        return { achievements, userAchievements };
      },
      apply: (raw) => ({
        achievements: _deriveAchievements(raw.achievements.data),
        achievementUnlocks: _deriveAchievementUnlocks(raw.userAchievements.data),
      }),
    },
    pointLog: {
      fetch: async (client) => ({
        pointLog: await client.from('point_log').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.point_log),
      }),
      apply: (raw) => ({ pointLog: _derivePointLog(raw.pointLog.data) }),
    },
    recitationLog: {
      fetch: async (client) => ({
        recitationLog: await client.from('recitation_log').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.recitation_log),
      }),
      apply: (raw) => ({ recitationLog: _deriveRecitationLog(raw.recitationLog.data) }),
    },
    rfidCards: {
      fetch: async (client) => ({ rfidCards: await client.from('rfid_cards').select('*') }),
      apply: (raw) => ({ rfidCards: _deriveRfidCards(raw.rfidCards.data) }),
    },
    attendanceLogs: {
      fetch: async (client) => ({
        attendanceLogs: await client.from('attendance_logs').select('*').order('log_date', { ascending: false }).limit(_HISTORY_LIMITS.attendance_logs),
      }),
      apply: (raw) => ({ attendanceLogs: _deriveAttendanceLogs(raw.attendanceLogs.data) }),
    },
    mail: {
      // Needs profiles alongside mail_messages purely to resolve sender
      // display names (see _deriveMail) — still just 2 tables instead of 27.
      // Title-reward lookups reuse the already-cached titles slice instead
      // of re-fetching titles too.
      fetch: async (client) => {
        const [mailMessages, profiles] = await Promise.all([
          client.from('mail_messages').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.mail_messages),
          client.from('profiles').select('*'),
        ]);
        return { mailMessages, profiles };
      },
      apply: (raw, cache) => ({ mail: _deriveMail(raw.mailMessages.data, raw.profiles.data, cache.titles) }),
    },
    quizSectionAssignments: {
      fetch: async (client) => ({ quizSections: await client.from('quiz_sections').select('*') }),
      apply: (raw) => ({ quizSectionAssignments: _deriveQuizSectionAssignments(raw.quizSections.data) }),
    },
    achievementSectionAssignments: {
      fetch: async (client) => ({ achievementSections: await client.from('achievement_sections').select('*') }),
      apply: (raw) => ({ achievementSectionAssignments: _deriveAchievementSectionAssignments(raw.achievementSections.data) }),
    },
    titles: {
      // titles + title_unlocks + title_sections grouped together: unlocking
      // or re-scoping a title routinely touches more than one of these at
      // once, and all three only ever feed the "titles domain" of the cache.
      fetch: async (client) => {
        const [titles, titleUnlocks, titleSections] = await Promise.all([
          client.from('titles').select('*'),
          client.from('title_unlocks').select('*'),
          client.from('title_sections').select('*'),
        ]);
        return { titles, titleUnlocks, titleSections };
      },
      apply: (raw) => ({
        titles: _deriveTitles(raw.titles.data),
        titleUnlocks: _deriveTitleUnlocks(raw.titleUnlocks.data),
        titleSectionAssignments: _deriveTitleSectionAssignments(raw.titleSections.data),
      }),
    },
    quizzes: {
      fetch: async (client) => ({ quizzes: await client.from('quizzes').select('*') }),
      apply: (raw) => ({ quizzes: _deriveQuizzes(raw.quizzes.data) }),
    },
    campaign: {
      fetch: async (client) => {
        const [campaignWorlds, campaignStageSections] = await Promise.all([
          client.from('campaign_worlds').select('*').order('sort_order', { ascending: true }),
          client.from('campaign_stage_sections').select('*'),
        ]);
        return { campaignWorlds, campaignStageSections };
      },
      apply: (raw) => {
        const campaignWorldsArr = _deriveCampaignWorlds(raw.campaignWorlds.data);
        return {
          stageMap: campaignWorldsArr,
          campaignSectionAssignments: _deriveCampaignSectionAssignments(raw.campaignStageSections.data, campaignWorldsArr),
        };
      },
    },
    orders: {
      fetch: async (client) => ({
        orders: await client.from('orders').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.orders),
      }),
      apply: (raw) => ({ orders: _deriveOrders(raw.orders.data) }),
    },
    inventory: {
      fetch: async (client) => ({ inventory: await client.from('inventory').select('*') }),
      apply: (raw) => ({ inventory: _deriveInventory(raw.inventory.data) }),
    },
    quizHistory: {
      fetch: async (client) => ({
        quizHistory: await client.from('quiz_history').select('*').order('completed_at', { ascending: false }).limit(_HISTORY_LIMITS.quiz_history),
      }),
      apply: (raw, cache) => {
        const { quizHistoryByStudent, completedQuizzesByStudent } = _deriveQuizHistory(raw.quizHistory.data);
        // quiz_history also feeds students[].completedQuizzes (Phase 63) —
        // patch the already-cached student list in place instead of
        // re-fetching profiles just for this; this group already has
        // everything it needs to keep the two in sync (see the "quiz
        // reappears / chain resets to step 1" bug this originally fixed).
        const students = (cache.students || []).map(s => ({
          ...s,
          completedQuizzes: Array.from(completedQuizzesByStudent[s.id] || []),
        }));
        return { quizHistory: quizHistoryByStudent, students };
      },
    },
    notifications: {
      fetch: async (client) => ({
        notifications: await client.from('notifications').select('*').order('created_at', { ascending: false }).limit(_HISTORY_LIMITS.notifications),
      }),
      apply: (raw) => ({ notifications: _deriveNotifications(raw.notifications.data) }),
    },
    studentSkills: {
      fetch: async (client) => ({ studentSkills: await client.from('student_skills').select('*') }),
      apply: (raw) => ({ studentSkills: _deriveStudentSkills(raw.studentSkills.data) }),
    },
    // Phase 71 — cross-device "Start Recitation Session" sync.
    recitationSessions: {
      fetch: async (client) => ({ recitationSessions: await client.from('recitation_sessions').select('*') }),
      apply: (raw) => ({ recitationSessions: _deriveRecitationSessions(raw.recitationSessions.data) }),
    },
  };

// ── Phase 7 (2026-08-10, session 7): explicit window exports ──
// These were previously implicit globals (bare top-level declarations,
// reachable to other files only via classic-script auto-attach-to-window
// behavior). Made explicit ahead of any real bundle/module scoping change
// — found by build/audit-window-exports.js, which checks every symbol with
// a real cross-file consumer, not just ones reachable from onclick markup.
// See PHASE7_WINDOW_EXPORT_AUDIT.md.
window._REALTIME_TABLE_GROUPS = _REALTIME_TABLE_GROUPS;
window._REFRESH_GROUPS = _REFRESH_GROUPS;
