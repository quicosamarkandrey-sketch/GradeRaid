// Phase 7 (Stream A) — bridge for index.html#inline2 (src/inline2.js).
// THE LAST FILE in Stream A's 29-file list. See src/inline2.js's own
// header for the full 79/2/7=88 export-count reconciliation and the
// real-import/exclusion reasoning — not repeated here.
//
// All 79 real exports re-attached to window. The 2 pass-through
// re-export lines (achUpdateSidebarBadge, achGrantRewardsForClaim,
// pointing at a different stream's ach_engine.js) and the 7
// window-only-value symbols (eqPlayLevelUpMoment, eqPreviewLevelUp,
// _eqComboToastHideTimer, _eqDashHeroBackdropStop, _eqLastSeenLevel,
// _eqMascotCustomLines, _eqQuizIntensityBackdropStop) are NOT imported
// here — they have no local binding in src/inline2.js to import, they
// self-attach to window when the module body runs, exactly as the
// original classic script did.
import {
  HINT_COST,
  MAX_HINTS_PER_QUEST,
  QUEST_TIER_ORDER,
  _eqQuestHintText,
  _makeInit,
  _mascotAmbientEmotion,
  _mascotCloudTimer,
  _mascotLinesHydrated,
  _mascotLowTimeWarnedFor,
  _profAccountHTML,
  _profEditHTML,
  _profOverviewHTML,
  _profPendingPic,
  _profRenderHero,
  _profRenderStats,
  _profShowPicUnsaved,
  _questRarityStyle,
  _quizAdvanceNow,
  _quizShowRevealThenAdvance,
  abortQuiz,
  activeQuiz,
  closeProfile,
  confirmAbortQuiz,
  eqHydrateMascotLines,
  finishQuiz,
  fireMascotEvent,
  getAvatarHTML,
  handleProfilePicUpload,
  openProfile,
  profEnsureFields,
  profGetCurrent,
  profInitAll,
  profileAvatarClick,
  profileOverlayClick,
  quizAdvanceTimer,
  quizAnswerRevealEvent,
  quizAnswers,
  quizAttemptNumber,
  quizCombo,
  quizComboLastEvent,
  quizComboMax,
  quizComboMilestoneHit,
  quizCurrent,
  quizEliminated,
  quizFinishing,
  quizHintRevealed,
  quizHintsRemaining,
  quizLastAnnouncedStage,
  quizLocked,
  quizMatchShuffle,
  quizNext,
  quizPrev,
  quizStreakSnapshot,
  quizTimeLeft,
  quizTimeout,
  quizTimer,
  refreshAllAvatars,
  removeProfilePic,
  renderAvatarEl,
  renderChainSection,
  renderChainStepCard,
  renderQuestCard,
  renderQuizQuestion,
  renderQuizTimerDisplay,
  renderStudentDashboard,
  renderStudentQuizzes,
  renderTopQuestersPanel,
  saveEmail,
  savePassword,
  saveProfileEdit,
  selectOpt,
  startQuestionTimer,
  startQuiz,
  submitEnumAnswer,
  submitIdAnswer,
  submitMatchAnswer,
  switchProfileTab,
  updateMascotAmbientMood,
  useHint,
} from '../../src/inline2.js';

window.HINT_COST = HINT_COST;
window.MAX_HINTS_PER_QUEST = MAX_HINTS_PER_QUEST;
window.QUEST_TIER_ORDER = QUEST_TIER_ORDER;
window._eqQuestHintText = _eqQuestHintText;
window._makeInit = _makeInit;
window._mascotAmbientEmotion = _mascotAmbientEmotion;
window._mascotCloudTimer = _mascotCloudTimer;
window._mascotLinesHydrated = _mascotLinesHydrated;
window._mascotLowTimeWarnedFor = _mascotLowTimeWarnedFor;
window._profAccountHTML = _profAccountHTML;
window._profEditHTML = _profEditHTML;
window._profOverviewHTML = _profOverviewHTML;
window._profPendingPic = _profPendingPic;
window._profRenderHero = _profRenderHero;
window._profRenderStats = _profRenderStats;
window._profShowPicUnsaved = _profShowPicUnsaved;
window._questRarityStyle = _questRarityStyle;
window._quizAdvanceNow = _quizAdvanceNow;
window._quizShowRevealThenAdvance = _quizShowRevealThenAdvance;
window.abortQuiz = abortQuiz;
window.activeQuiz = activeQuiz;
window.closeProfile = closeProfile;
window.confirmAbortQuiz = confirmAbortQuiz;
window.eqHydrateMascotLines = eqHydrateMascotLines;
window.finishQuiz = finishQuiz;
window.fireMascotEvent = fireMascotEvent;
window.getAvatarHTML = getAvatarHTML;
window.handleProfilePicUpload = handleProfilePicUpload;
window.openProfile = openProfile;
window.profEnsureFields = profEnsureFields;
window.profGetCurrent = profGetCurrent;
window.profInitAll = profInitAll;
window.profileAvatarClick = profileAvatarClick;
window.profileOverlayClick = profileOverlayClick;
window.quizAdvanceTimer = quizAdvanceTimer;
window.quizAnswerRevealEvent = quizAnswerRevealEvent;
window.quizAnswers = quizAnswers;
window.quizAttemptNumber = quizAttemptNumber;
window.quizCombo = quizCombo;
window.quizComboLastEvent = quizComboLastEvent;
window.quizComboMax = quizComboMax;
window.quizComboMilestoneHit = quizComboMilestoneHit;
window.quizCurrent = quizCurrent;
window.quizEliminated = quizEliminated;
window.quizFinishing = quizFinishing;
window.quizHintRevealed = quizHintRevealed;
window.quizHintsRemaining = quizHintsRemaining;
window.quizLastAnnouncedStage = quizLastAnnouncedStage;
window.quizLocked = quizLocked;
window.quizMatchShuffle = quizMatchShuffle;
window.quizNext = quizNext;
window.quizPrev = quizPrev;
window.quizStreakSnapshot = quizStreakSnapshot;
window.quizTimeLeft = quizTimeLeft;
window.quizTimeout = quizTimeout;
window.quizTimer = quizTimer;
window.refreshAllAvatars = refreshAllAvatars;
window.removeProfilePic = removeProfilePic;
window.renderAvatarEl = renderAvatarEl;
window.renderChainSection = renderChainSection;
window.renderChainStepCard = renderChainStepCard;
window.renderQuestCard = renderQuestCard;
window.renderQuizQuestion = renderQuizQuestion;
window.renderQuizTimerDisplay = renderQuizTimerDisplay;
window.renderStudentDashboard = renderStudentDashboard;
window.renderStudentQuizzes = renderStudentQuizzes;
window.renderTopQuestersPanel = renderTopQuestersPanel;
window.saveEmail = saveEmail;
window.savePassword = savePassword;
window.saveProfileEdit = saveProfileEdit;
window.selectOpt = selectOpt;
window.startQuestionTimer = startQuestionTimer;
window.startQuiz = startQuiz;
window.submitEnumAnswer = submitEnumAnswer;
window.submitIdAnswer = submitIdAnswer;
window.submitMatchAnswer = submitMatchAnswer;
window.switchProfileTab = switchProfileTab;
window.updateMascotAmbientMood = updateMascotAmbientMood;
window.useHint = useHint;
