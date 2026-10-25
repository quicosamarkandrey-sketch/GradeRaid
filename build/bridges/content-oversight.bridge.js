// Phase 7, Stream B — bridge for modules/admin/content-oversight.js.
// Only the 24 identifiers that were actually `window.X =` assigned in the
// original are re-attached to window (matching real onclick handlers and
// nav.js's renderContentOversight()/unmountContentOversight() calls, and
// teacher-directory.js's openContentOversightFor() call). The other 34
// exports (12 module-state `let`s, 1 tab-config `const`, 21 internal
// `_co*` helpers) have zero real cross-file consumers today — exported
// from src/ per the "export it anyway" rule, but not re-attached here.
import {
  _coSetPickerSearch, _coSetSearch, openContentOversightFor, renderContentOversight,
  unmountContentOversight, _coBackToPicker, _coToggleEditMode, _coSwitchTab,
  _coOpenAchievementForm, _coSaveAchievement, _coDeleteAchievement,
  _coOpenTitleForm, _coSaveTitle, _coDeleteTitle,
  _coOpenQuizForm, _coAddQuizQuestion, _coSaveQuiz, _coDeleteQuiz,
  _coOpenWorldForm, _coSaveWorld, _coDeleteWorld,
  _coOpenShopForm, _coSaveShopItem, _coDeleteShopItem,
} from '../../src/modules/admin/content-oversight.js';

window._coSetPickerSearch = _coSetPickerSearch;
window._coSetSearch = _coSetSearch;
window.openContentOversightFor = openContentOversightFor;
window.renderContentOversight = renderContentOversight;
window.unmountContentOversight = unmountContentOversight;
window._coBackToPicker = _coBackToPicker;
window._coToggleEditMode = _coToggleEditMode;
window._coSwitchTab = _coSwitchTab;
window._coOpenAchievementForm = _coOpenAchievementForm;
window._coSaveAchievement = _coSaveAchievement;
window._coDeleteAchievement = _coDeleteAchievement;
window._coOpenTitleForm = _coOpenTitleForm;
window._coSaveTitle = _coSaveTitle;
window._coDeleteTitle = _coDeleteTitle;
window._coOpenQuizForm = _coOpenQuizForm;
window._coAddQuizQuestion = _coAddQuizQuestion;
window._coSaveQuiz = _coSaveQuiz;
window._coDeleteQuiz = _coDeleteQuiz;
window._coOpenWorldForm = _coOpenWorldForm;
window._coSaveWorld = _coSaveWorld;
window._coDeleteWorld = _coDeleteWorld;
window._coOpenShopForm = _coOpenShopForm;
window._coSaveShopItem = _coSaveShopItem;
window._coDeleteShopItem = _coDeleteShopItem;
