// Phase 7, Stream B — bridge for modules/admin/quiz-builder.js.
// Importing this module also runs its own `window.QUEST_TEMPLATES =
// QUEST_TEMPLATES;` load-time side effect (kept verbatim in src/) — this
// bridge doesn't need to re-attach QUEST_TEMPLATES itself.
import {
  qbSetSearch, qbGoToPage, qbPrevPage, qbNextPage, renderAdminQuizzes,
  openQuizBuilder, openEditQuiz, openQuestTemplateChooser, cloneQuiz,
  setQuestionType, setAltAnswers, setEnumAnswer, addEnumAnswer, removeEnumAnswer,
  setMatchPair, addMatchPair, removeMatchPair, updateDraftQuizSections,
  addQuestion, removeQuestion, setCorrect, addOption, removeOption,
  saveQuiz, deleteQuiz, confirmDeleteQuiz, openQuizAnalytics,
} from '../../src/modules/admin/quiz-builder.js';

window.qbSetSearch = qbSetSearch;
window.qbGoToPage = qbGoToPage;
window.qbPrevPage = qbPrevPage;
window.qbNextPage = qbNextPage;
window.renderAdminQuizzes = renderAdminQuizzes;
window.openQuizBuilder = openQuizBuilder;
window.openEditQuiz = openEditQuiz;
window.openQuestTemplateChooser = openQuestTemplateChooser;
window.cloneQuiz = cloneQuiz;
window.setQuestionType = setQuestionType;
window.setAltAnswers = setAltAnswers;
window.setEnumAnswer = setEnumAnswer;
window.addEnumAnswer = addEnumAnswer;
window.removeEnumAnswer = removeEnumAnswer;
window.setMatchPair = setMatchPair;
window.addMatchPair = addMatchPair;
window.removeMatchPair = removeMatchPair;
window.updateDraftQuizSections = updateDraftQuizSections;
window.addQuestion = addQuestion;
window.removeQuestion = removeQuestion;
window.setCorrect = setCorrect;
window.addOption = addOption;
window.removeOption = removeOption;
window.saveQuiz = saveQuiz;
window.deleteQuiz = deleteQuiz;
window.confirmDeleteQuiz = confirmDeleteQuiz;
window.openQuizAnalytics = openQuizAnalytics;
