// Phase 7 (Stream D) — bridge for modules/shop/shop_store.js.
// Re-attaches all 17 real exports to window (_CART, _cartTotal, _cartCount, _cartRenderFab, _cartRenderModal were global lexical/function bindings in the classic script).
import {
  getItemRarity,
  renderStudentStore,
  _CART,
  cartAdd,
  cartRemove,
  cartSetQty,
  cartClear,
  _cartTotal,
  _cartCount,
  _cartRenderFab,
  cartOpenModal,
  _cartRenderModal,
  cartCheckout,
  posGenCode,
  posShowClaimCode,
  buyItem,
  confirmBuy,
} from '../../src/modules/shop/shop_store.js';

window.getItemRarity = getItemRarity;
window.renderStudentStore = renderStudentStore;
window._CART = _CART;
window.cartAdd = cartAdd;
window.cartRemove = cartRemove;
window.cartSetQty = cartSetQty;
window.cartClear = cartClear;
window._cartTotal = _cartTotal;
window._cartCount = _cartCount;
window._cartRenderFab = _cartRenderFab;
window.cartOpenModal = cartOpenModal;
window._cartRenderModal = _cartRenderModal;
window.cartCheckout = cartCheckout;
window.posGenCode = posGenCode;
window.posShowClaimCode = posShowClaimCode;
window.buyItem = buyItem;
window.confirmBuy = confirmBuy;
