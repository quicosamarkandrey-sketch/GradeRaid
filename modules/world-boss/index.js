// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/world-boss/index.js
//  Load-order guard for the world-boss module bundle.
//  Verifies that every expected window.* export is present before declaring
//  the module ready.  A missing symbol surfaces as a clear console error
//  rather than a cryptic TypeError later.
//
//  Expected load order (each file must appear in <script> tags before this one):
//   1. combat-settings.js   — WBC, wbcGetActiveBoss, wbcApplyDamage, …
//   2. loot-rain.js         — WBLR, wblrShowLootRain, wblrFinalizeLoot, …
//   3. skills.js            — WBS, wbsFireSkill, wbsStartSkillLoop, …
//   4. phases.js            — WBP, wbpGetCurrentPhase, wbpCheckPhaseChange, …
//   5. rage.js              — WBRAGE, wbrageCheckAndActivate, …
//   6. summon-notify.js     — WBSN, wbsnShow, wbsnStartPolling, …
//   7. minions.js           — WBM, wbmSpawnMinion, wbmAnswerMinion, …
//   8. leaderboard.js       — wblTrackCrit, wblRenderPanel, wblShowVictoryScreen, …
//   9. student-page.js      — renderStudentWorldBoss (base), wbcAnswer, …
//  10. battle-overlay.js    — WBE, wbeRenderFullBattle, spawn-loop patches, …
//  11. raid-flow.js         — WBR, wbrRenderLobby, wbrOpenBattle, wbrAnswer, …
//  12. admin-page.js        — renderAdminBossEvents, openBossForm, bossActivate, …
//  13. bve-patches.js       — BVE §7-§9 patches, BVE CSS
//  14. index.js             — THIS FILE (load-order guard)
// ═══════════════════════════════════════════════════════════════════════════════

;(function _worldBossLoadGuard() {

  const MODULE = 'world-boss';
  const VERSION = '1.0.0';

  // ── Symbols that must exist on window after all 13 files have run ───────────
  const REQUIRED = [
    // combat-settings.js
    'WBC', 'wbcDefaultSettings', 'wbcGetActiveBoss', 'wbcGetParticipants',
    'wbcMyRecord', 'wbcJoinBoss', 'wbcCalcDamage', 'wbcApplyDamage',
    'wbcGetBossQuestions', 'wbcBattleStats', 'wbcUpdateTopbarWidget',

    // loot-rain.js
    'WBLR_RARITIES', 'wblrDefaultRewards', 'wblrNormalizeRewards',
    'wblrShowLootRain', 'wblrShowInOverlayLoot', 'wblrFinalizeLoot',
    'wblrAdminFinalizeLoot', 'wblrRenderStudentLootPage',
    'wblrRenderFinalSummaryPage', 'wblrOpenFinalSummary',
    'wblrOpenLootSettings', 'wblrSaveLootSettings',
    'wblrGetCurrentLootBoss', 'wblrGetLatestSummaryBoss',

    // skills.js
    'WBS', 'WBS_SKILL_DEFAULTS', 'wbsGetSkills', 'wbsFireSkill',
    'wbsAdminFireSkill', 'wbsStartSkillLoop', 'wbsStopSkillLoop',
    'wbsOpenSkillConfig', 'wbsSaveSkillConfig',

    // phases.js
    'WBP', 'WBP_DEFAULT_PHASES', 'wbpGetPhases', 'wbpGetCurrentPhase',
    'wbpGetPhaseNumber', 'wbpCheckPhaseChange', 'wbpTriggerPhaseAnnouncement',
    'wbpOpenPhaseConfig', 'wbpSavePhaseConfig', 'wbpResetPhasesToDefault',

    // rage.js
    'WBRAGE', 'wbrageDefaults', 'wbrageSettings', 'wbrageIsActive',
    'wbrageCheckAndActivate', 'wbrageReset',
    'wbrageOpenConfig', 'wbrageAdminSave',

    // summon-notify.js  [BLOCKER-SIGNAL keys: pendingBossSummon, pendingSkill]
    'WBSN', 'wbsnShow', 'wbsnJoin', 'wbsnDismiss', 'wbsnRemove',
    'wbsnWriteSignal', 'wbsnStartPolling', 'wbsnStopPolling',

    // minions.js
    'WBM', 'WBM_MINIONS', 'wbmDefaultSettings', 'wbmSettings',
    'wbmEnsureActiveMinions', 'wbmSpawnMinion', 'wbmPruneExpiredMinions',
    'wbmStartSpawnLoop', 'wbmStopSpawnLoop',
    'wbmMyHp', 'wbmGetCurrentMinion', 'wbmGetCurrentMinionBySide',
    'wbmRenderHearts', 'wbmRenderHpBar', 'wbmRenderMinionSection',
    'wbmRenderKOSection', 'wbmDealDamage', 'wbmAnswerMinion',
    'wbmMinionTimeout', 'wbmSelfRevive',
    'wbmStartKoTimer', 'wbmStopKoTimer', 'wbmStartMinionCountdown',
    'wbmAdminForceSpawn', 'wbmAdminReviveStudent', 'wbmOpenRevivePanel',
    'wbmOpenMinionSettings', 'wbmSelectSide',
    'wbmAdminAddMinionQ', 'wbmAdminRemoveMinionQ',
    'wbmAdminImportQs', 'wbmSaveMinionSettings',

    // leaderboard.js
    'wblTrackCrit', 'wblTrackMinionKill', 'wblRenderPanel',
    'wblSwitchTab', 'wblOpenAdminLeaderboard', 'wblExportCSV',
    'wbrShowBossDefeat', 'wbrShowBossVictory', 'wblShowVictoryScreen',

    // student-page.js
    'renderStudentWorldBoss', 'wbcAnswer',

    // battle-overlay.js  (WBE + patched spawn loop + patched renderStudentWorldBoss)
    // No new window.* symbols — patches replace existing globals in place.

    // raid-flow.js
    'WBR', 'wbrOpenBattle', 'wbrCloseBattle', 'wbrStop',
    'wbrSetBg', 'wbrType', 'wbrSceneClick',
    'wbrShowIntro', 'wbrShowEncounter', 'wbrAnswer',
    'wbrFeedHTML', 'wbrRenderSideOverlays', 'wbrRecordFeed',

    // admin-page.js
    'renderAdminBossEvents', '_bossEventCardHTML',
    'bossActivate', 'bossEnd', 'bossDelete',
    'openBossForm', 'saveBossForm', 'bossFormSetDiff',
    'clearFieldErr', 'showFieldErr',
    'wbcOpenCombatSettings', 'wbcSaveCombatSettings',
    'wbcOpenQuestionEditor', 'wbcAddQuestion', 'wbcRemoveQuestion',
    'wbcImportFromQuiz', 'wbcSaveQuestions',
    'bfOpenLibraryPicker', '_bflpRefreshGrid', '_bflpSelectCard',
    '_bflpConfirmSelection', 'bfUnlinkProfile', 'bfSkipLibraryLink',
  ];

  // ── Check ──────────────────────────────────────────────────────────────────
  const missing = REQUIRED.filter(sym => typeof window[sym] === 'undefined');

  if (missing.length > 0) {
    console.error(
      `[EduQuest] modules/${MODULE}/index.js — LOAD ORDER ERROR: ` +
      `${missing.length} expected export(s) are undefined. ` +
      `Check that all 13 world-boss module files are loaded before index.js.\n` +
      `Missing: ${missing.join(', ')}`
    );
  } else {
    console.log(
      `[EduQuest] modules/${MODULE}/index.js v${VERSION} — ` +
      `all ${REQUIRED.length} exports verified ✓`
    );
  }

  // ── Version stamp ──────────────────────────────────────────────────────────
  window.__WB_MODULE_VERSION__ = VERSION;

  // ── Confirm critical [BLOCKER-SIGNAL] localStorage keys are untouched ─────
  // These key names are used for cross-tab signalling between the teacher
  // dashboard and student view.  They MUST NOT be renamed.
  const SIGNAL_KEYS = ['pendingBossSummon', 'pendingSkill'];
  // (We do not set them here — just record them in a stable place for docs.)
  window.__WB_SIGNAL_KEYS__ = SIGNAL_KEYS;

})();
