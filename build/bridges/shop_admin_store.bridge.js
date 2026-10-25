// Phase 7 (Stream D) — bridge for modules/shop/shop_admin_store.js.
// Re-attaches all 12 real exports to window, including the mutable
// _adminStoreInterval state variable (see the src file's header for the
// known one-time-snapshot limitation for not-yet-converted nav.js).
import {
  _adminStoreInterval,
  renderAdminStore,
  renderProductRows,
  stockStartEdit,
  stockSave,
  productForm,
  openAddProduct,
  openEditProduct,
  doAddProduct,
  doEditProduct,
  deleteProduct,
  confirmDeleteProduct,
} from '../../src/modules/shop/shop_admin_store.js';

window._adminStoreInterval = _adminStoreInterval;
window.renderAdminStore = renderAdminStore;
window.renderProductRows = renderProductRows;
window.stockStartEdit = stockStartEdit;
window.stockSave = stockSave;
window.productForm = productForm;
window.openAddProduct = openAddProduct;
window.openEditProduct = openEditProduct;
window.doAddProduct = doAddProduct;
window.doEditProduct = doEditProduct;
window.deleteProduct = deleteProduct;
window.confirmDeleteProduct = confirmDeleteProduct;
