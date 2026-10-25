// Phase 7, Stream B — bridge for modules/admin/starter-pack-editor.js.
// Only the 18 identifiers that were actually `window.X =` assigned in the
// original are re-attached to window (matching the real page's onclick
// handlers and nav.js's renderStarterPackEditor() call). The other 17
// exports (2 `let` state vars, 1 tab-config `const`, 14 internal `_sp*`
// helpers) have zero real cross-file consumers today — exported from src/
// per the "export it anyway" rule, but not re-attached here.
import {
  renderStarterPackEditor, _spSwitchTab,
  _spOpenAchievementForm, _spSaveAchievement, _spDeleteAchievement,
  _spOpenTitleForm, _spSaveTitle, _spDeleteTitle,
  _spOpenQuizForm, _spAddQuizQuestion, _spSaveQuiz, _spDeleteQuiz,
  _spOpenWorldForm, _spSaveWorld, _spDeleteWorld,
  _spOpenShopForm, _spSaveShopItem, _spDeleteShopItem,
} from '../../src/modules/admin/starter-pack-editor.js';

window.renderStarterPackEditor = renderStarterPackEditor;
window._spSwitchTab = _spSwitchTab;
window._spOpenAchievementForm = _spOpenAchievementForm;
window._spSaveAchievement = _spSaveAchievement;
window._spDeleteAchievement = _spDeleteAchievement;
window._spOpenTitleForm = _spOpenTitleForm;
window._spSaveTitle = _spSaveTitle;
window._spDeleteTitle = _spDeleteTitle;
window._spOpenQuizForm = _spOpenQuizForm;
window._spAddQuizQuestion = _spAddQuizQuestion;
window._spSaveQuiz = _spSaveQuiz;
window._spDeleteQuiz = _spDeleteQuiz;
window._spOpenWorldForm = _spOpenWorldForm;
window._spSaveWorld = _spSaveWorld;
window._spDeleteWorld = _spDeleteWorld;
window._spOpenShopForm = _spOpenShopForm;
window._spSaveShopItem = _spSaveShopItem;
window._spDeleteShopItem = _spDeleteShopItem;
