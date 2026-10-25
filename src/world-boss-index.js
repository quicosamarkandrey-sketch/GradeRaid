// ═══════════════════════════════════════════════════════════════════════════════
//  src/world-boss-index.js
//  Load-order guard for the world-boss module bundle (real-ESM twin).
//
//  Phase 7 (2026-08-10, session 17) — step 5.3, sixteenth real conversion.
//  Real-ESM twin of the original ../modules/world-boss/index.js, which
//  stays completely untouched. Verification logic uses a DIFFERENT check
//  than every other aggregator conversion so far — `typeof window[sym]
//  === 'undefined'` (accepts any defined value: object, string, function
//  — not `!== 'function'` like recitation/attendance/admin's checks) —
//  preserved exactly, not normalized to match the other files' pattern.
//  Both declared symbols exported for consistency (__WB_MODULE_VERSION__,
//  __WB_SIGNAL_KEYS__); neither has any cross-file consumer (checked via
//  grep, not assumed) — same as leaderboard-index.js's unused-but-still-
//  exported alias.
// ═══════════════════════════════════════════════════════════════════════════════

const MODULE = 'world-boss';
export const VERSION = '1.0.0';

const REQUIRED = [
  'WBC', 'wbcDefaultSettings', 'wbcGetActiveBoss', 'wbcGetParticipants',
  'wbcMyRecord', 'wbcJoinBoss', 'wbcCalcDamage', 'wbcApplyDamage',
  'wbcGetBossQuestions', 'wbcBattleStats', 'wbcUpdateTopbarWidget',
  'WBLR_RARITIES', 'wblrDefaultRewards', 'wblrNormalizeRewards',
  'wblrShowLootRain', 'wblrShowInOverlayLoot', 'wblrFinalizeLoot',
  'wblrAdminFinalizeLoot', 'wblrRenderStudentLootPage',
  'wblrRenderFinalSummaryPage', 'wblrOpenFinalSummary',
  'wblrOpenLootSettings', 'wblrSaveLootSettings',
  'wblrGetCurrentLootBoss', 'wblrGetLatestSummaryBoss',
  'WBS', 'WBS_SKILL_DEFAULTS', 'wbsGetSkills', 'wbsFireSkill',
  'wbsAdminFireSkill', 'wbsStartSkillLoop', 'wbsStopSkillLoop',
  'wbsOpenSkillConfig', 'wbsSaveSkillConfig',
  'WBP', 'WBP_DEFAULT_PHASES', 'wbpGetPhases', 'wbpGetCurrentPhase',
  'wbpGetPhaseNumber', 'wbpCheckPhaseChange', 'wbpTriggerPhaseAnnouncement',
  'wbpOpenPhaseConfig', 'wbpSavePhaseConfig', 'wbpResetPhasesToDefault',
  'WBRAGE', 'wbrageDefaults', 'wbrageSettings', 'wbrageIsActive',
  'wbrageCheckAndActivate', 'wbrageReset',
  'wbrageOpenConfig', 'wbrageAdminSave',
  'WBSN', 'wbsnShow', 'wbsnJoin', 'wbsnDismiss', 'wbsnRemove',
  'wbsnWriteSignal', 'wbsnStartPolling', 'wbsnStopPolling',
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
  'wblTrackCrit', 'wblTrackMinionKill', 'wblRenderPanel',
  'wblSwitchTab', 'wblOpenAdminLeaderboard', 'wblExportCSV',
  'wbrShowBossDefeat', 'wbrShowBossVictory', 'wblShowVictoryScreen',
  'renderStudentWorldBoss', 'wbcAnswer',
  'WBR', 'wbrOpenBattle', 'wbrCloseBattle', 'wbrStop',
  'wbrSetBg', 'wbrType', 'wbrSceneClick',
  'wbrShowIntro', 'wbrShowEncounter', 'wbrAnswer',
  'wbrFeedHTML', 'wbrRenderSideOverlays', 'wbrRecordFeed',
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

const missing = REQUIRED.filter((sym) => typeof window[sym] === 'undefined');

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

window.__WB_MODULE_VERSION__ = VERSION;

export const SIGNAL_KEYS = ['pendingBossSummon', 'pendingSkill'];
window.__WB_SIGNAL_KEYS__ = SIGNAL_KEYS;
