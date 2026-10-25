// Phase 7 (Stream D) — bridge for modules/shop/shop_promotions.js.
// Re-attaches all 28 real exports to window, including the two mutable
// state variables (promoCarousel, promoCountdownInterval — neither is
// consumed bare by any other file, so a plain one-time assignment is
// sufficient; see the src file's header).
import {
  PROMO_TYPES,
  promoTypeConfig,
  promoIsActive,
  promoGetActive,
  promoRecordView,
  promoRecordClick,
  promoRecordPurchase,
  promoGetAutoLabel,
  promoCountdownStr,
  promoCarousel,
  promoBuildSlideHTML,
  promoRenderCarousel,
  promoActivateSlide,
  promoNav,
  promoGoTo,
  promoClickBanner,
  promoGetCardBadge,
  promoCountdownInterval,
  promoStartCountdownTick,
  renderAdminPromotions,
  promoAdminOpenForm,
  promoFormTypeChange,
  promoAdminSaveForm,
  promoAdminToggle,
  promoAdminDelete,
  promoAdminConfirmDelete,
  promoAdminPreview,
  promoAdminPreviewStore,
} from '../../src/modules/shop/shop_promotions.js';

window.PROMO_TYPES = PROMO_TYPES;
window.promoTypeConfig = promoTypeConfig;
window.promoIsActive = promoIsActive;
window.promoGetActive = promoGetActive;
window.promoRecordView = promoRecordView;
window.promoRecordClick = promoRecordClick;
window.promoRecordPurchase = promoRecordPurchase;
window.promoGetAutoLabel = promoGetAutoLabel;
window.promoCountdownStr = promoCountdownStr;
window.promoCarousel = promoCarousel;
window.promoBuildSlideHTML = promoBuildSlideHTML;
window.promoRenderCarousel = promoRenderCarousel;
window.promoActivateSlide = promoActivateSlide;
window.promoNav = promoNav;
window.promoGoTo = promoGoTo;
window.promoClickBanner = promoClickBanner;
window.promoGetCardBadge = promoGetCardBadge;
window.promoCountdownInterval = promoCountdownInterval;
window.promoStartCountdownTick = promoStartCountdownTick;
window.renderAdminPromotions = renderAdminPromotions;
window.promoAdminOpenForm = promoAdminOpenForm;
window.promoFormTypeChange = promoFormTypeChange;
window.promoAdminSaveForm = promoAdminSaveForm;
window.promoAdminToggle = promoAdminToggle;
window.promoAdminDelete = promoAdminDelete;
window.promoAdminConfirmDelete = promoAdminConfirmDelete;
window.promoAdminPreview = promoAdminPreview;
window.promoAdminPreviewStore = promoAdminPreviewStore;
