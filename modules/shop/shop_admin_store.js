// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/shop/admin-store.js
//  Admin "Manage Store" page: product list, inline stock edit, add/edit/delete.
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level state: interval handle for live stock refresh
let _adminStoreInterval = null;

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * renderAdminStore() → void  [window.renderAdminStore]
 *
 * Renders the admin store management page into #a-store.
 * Starts a 3-second setInterval (_adminStoreInterval) that re-renders only the
 * tbody rows if stock values have changed — skips if a .stock-edit-input is focused.
 * Clears the previous interval on each call.
 */
window.renderAdminStore = function () {
  DB = loadDB();
  const catColor = { food: 'bp-green', supplies: 'bp-primary', privilege: 'bp-gold', mystery: 'bp-gray' };

  document.getElementById('a-store').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
    <div>
      <div style="font-family:var(--fh);font-size:26px;font-weight:900">🏪 Manage Store</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">${DB.store.length} items · ${DB.store.reduce((a, i) => a + i.stock, 0)} total stock</div>
    </div>
    <button class="btn btn-primary" onclick="openAddProduct()">＋ Add Item</button>
  </div>
  <div class="glass-card" style="padding:0;overflow:hidden">
    <table class="admin-table">
      <thead>
        <tr>
          <th style="width:52px"></th>
          <th>Product</th>
          <th>Category</th>
          <th style="text-align:right">Cost</th>
          <th style="text-align:right">Stock <span style="font-size:9px;color:var(--text-muted);font-weight:400">(click to edit)</span></th>
          <th style="width:120px"></th>
        </tr>
      </thead>
      <tbody id="admin-product-list">${renderProductRows()}</tbody>
    </table>
  </div>`;

  // Live stock refresh every 3s
  if (_adminStoreInterval) clearInterval(_adminStoreInterval);
  _adminStoreInterval = setInterval(() => {
    const page = document.getElementById('a-store');
    if (!page || !page.classList.contains('active')) { clearInterval(_adminStoreInterval); _adminStoreInterval = null; return; }
    const freshDB = loadDB();
    const tbody   = document.getElementById('admin-product-list');
    if (!tbody) return;
    if (tbody.querySelector('.stock-edit-input')) return; // skip while user is editing
    const changed = freshDB.store.some((item, i) => DB.store[i] && DB.store[i].stock !== item.stock);
    if (changed) { DB = freshDB; tbody.innerHTML = renderProductRows(); }
  }, 3000);
};

/**
 * renderProductRows() → HTML string  [window.renderProductRows]
 * Renders all store item <tr> rows for the admin table.
 * Inline stock display uses .stock-val (onclick → stockStartEdit).
 */
window.renderProductRows = function () {
  const catColor = { food: 'bp-green', supplies: 'bp-primary', privilege: 'bp-gold', mystery: 'bp-gray' };
  return DB.store.map(item => {
    const stockColor = item.stock === 0 ? '#ffb4ab' : item.stock <= 3 ? '#ffb95f' : 'var(--text)';
    return `<tr>
    <td style="font-size:28px;text-align:center">${item.emoji}</td>
    <td>
      <div style="font-weight:700;font-size:13px">${_esc(item.name)}</div>
      <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${_esc(item.desc)}</div>
    </td>
    <td><span class="badge-pill ${catColor[item.cat] || 'bp-gray'}">${item.cat}</span></td>
    <td style="text-align:right"><span class="coin-tag">🪙 ${item.cost}</span></td>
    <td style="text-align:right">
      <div class="stock-cell" id="stock-cell-${item.id}">
        <span class="stock-val" style="color:${stockColor}" title="Click to edit stock" onclick="stockStartEdit('${item.id}')">×${item.stock}</span>
      </div>
    </td>
    <td style="text-align:right">
      <button class="btn btn-ghost btn-xs" onclick="openEditProduct('${item.id}')" style="margin-right:6px">✏️</button>
      <button class="btn btn-danger btn-xs" onclick="deleteProduct('${item.id}')">🗑</button>
    </td>
  </tr>`;
  }).join('');
};

// ── Inline stock edit ─────────────────────────────────────────────────────────

/**
 * stockStartEdit(id) → void  [window.stockStartEdit]
 * Replaces the .stock-val span in #stock-cell-{id} with an input + save button.
 * Enter key triggers stockSave; Escape key re-renders full admin store.
 */
window.stockStartEdit = function (id) {
  const cell = document.getElementById('stock-cell-' + id);
  if (!cell) return;
  const item = DB.store.find(i => i.id === id);
  if (!item) return;
  cell.innerHTML = `<div class="stock-edit-wrap">
    <input class="stock-edit-input" id="stock-input-${id}" type="number" min="0" value="${item.stock}"
      onkeydown="if(event.key==='Enter')stockSave('${id}');if(event.key==='Escape')renderAdminStore()">
    <button class="stock-save-btn" onclick="stockSave('${id}')">✓</button>
  </div>`;
  setTimeout(() => { const el = document.getElementById('stock-input-' + id); if (el) { el.focus(); el.select(); } }, 30);
};

/**
 * stockSave(id) → void  [window.stockSave]
 * Reads #stock-input-{id} value. Updates DB.store item.stock (min 0). saveDB() → toast → renderAdminStore().
 */
window.stockSave = async function (id) {
  const input = document.getElementById('stock-input-' + id);
  if (!input) return;
  const val  = Math.max(0, parseInt(input.value) || 0);
  DB = loadDB();
  const item = DB.store.find(i => i.id === id);
  if (!item) return;
  // Phase 14: stock is RPC-owned (see db-service.js push comment) — write
  // it straight to the server instead of the generic saveDB() bulk upsert,
  // which no longer carries this field at all.
  const { data, error } = await DBService.rpc('restock_shop_product', { p_product_id: id, p_new_stock: val });
  if (error) { toast('❌ Could not update stock: ' + error.message, '#ffb4ab'); renderAdminStore(); return; }
  item.stock = (typeof data === 'number') ? data : val;
  saveDB(); // persists the other (non-stock) fields as usual; harmless no-op for stock itself
  toast(`✅ Stock updated: ${item.name} → ×${item.stock}`, '#4edea3');
  renderAdminStore();
};

// ── Product form ──────────────────────────────────────────────────────────────

/**
 * productForm(item) → HTML string
 * Shared Add/Edit form HTML used by both openAddProduct and openEditProduct.
 * item: null for Add, item object for Edit.
 */
function productForm(item = null) {
  const isEdit = !!item;
  return `<div class="modal-h2">${isEdit ? '✏️ Edit' : '➕ Add'} Product</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Emoji</label><input type="text" id="pf-emoji" value="${item?.emoji || '🎁'}" style="width:100%;font-size:24px" maxlength="4"></div>
      <div class="form-group"><label class="form-label">Category</label><select id="pf-cat" style="width:100%">${['food', 'supplies', 'privilege', 'mystery'].map(c => `<option value="${c}" ${item?.cat === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label class="form-label">Name</label><input type="text" id="pf-name" placeholder="Product name" value="${_esc(item?.name || '')}" style="width:100%"></div>
    <div class="form-group"><label class="form-label">Description</label><input type="text" id="pf-desc" placeholder="Short description..." value="${_esc(item?.desc || '')}" style="width:100%"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Coin Cost</label><input type="number" id="pf-cost" min="1" value="${item?.cost || 100}" style="width:100%"></div>
      <div class="form-group"><label class="form-label">Stock</label><input type="number" id="pf-stock" min="0" value="${item?.stock || 10}" style="width:100%"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-primary" style="flex:1" onclick="${isEdit ? `doEditProduct('${item.id}')` : 'doAddProduct()'}">${isEdit ? 'Save Changes' : 'Add Product'}</button>
    </div>`;
}

/**
 * openAddProduct() → void  [window.openAddProduct]
 * Opens 'md' modal with empty product form.
 */
window.openAddProduct = function () { showModal(productForm(null), 'md'); };

/**
 * openEditProduct(id) → void  [window.openEditProduct]
 * Opens 'md' modal with prefilled product form for the given store item id.
 */
window.openEditProduct = function (id) { showModal(productForm(DB.store.find(i => i.id === id)), 'md'); };

/**
 * doAddProduct() → void  [window.doAddProduct]
 * Reads #pf-* form fields. Validates name. Pushes new item to DB.store with uid().
 * saveDB() → closeModalForce() → renderAdminStore() → toast.
 */
window.doAddProduct = async function () {
  const emoji = document.getElementById('pf-emoji').value.trim() || '🎁';
  const name  = document.getElementById('pf-name').value.trim();
  if (!name) { toast('❌ Name required', '#ffb4ab'); return; }
  const newId    = uid();
  const newStock = parseInt(document.getElementById('pf-stock').value) || 10;
  DB.store.push({
    id: newId,
    ownerTeacherId: currentUser.id, // Phase 14: shop is per-teacher
    emoji, name,
    desc:  document.getElementById('pf-desc').value.trim(),
    cat:   document.getElementById('pf-cat').value,
    cost:  parseInt(document.getElementById('pf-cost').value)  || 100,
    stock: newStock, // local/display value only — see RPC call below
    addedAt: new Date().toISOString(),
  });
  saveDB(); // pushes name/emoji/desc/cat/cost/owner — stock excluded, see db-service.js
  closeModalForce(); renderAdminStore(); toast(`✅ "${name}" added!`);
  // Set the real server-side stock now that the row exists. If this fails
  // (e.g. still offline), the product exists with column-default stock
  // until the next successful restock — flagged via toast rather than
  // silently left wrong.
  const { error } = await DBService.rpc('restock_shop_product', { p_product_id: newId, p_new_stock: newStock });
  if (error) toast('⚠️ Product added, but initial stock may not have synced: ' + error.message, '#ffb95f');
};

/**
 * doEditProduct(id) → void  [window.doEditProduct]
 * Reads #pf-* form fields. Validates name. Merges changes into DB.store[idx].
 * saveDB() → closeModalForce() → renderAdminStore() → toast.
 */
window.doEditProduct = async function (id) {
  const idx  = DB.store.findIndex(i => i.id === id);
  if (idx < 0) return;
  const name = document.getElementById('pf-name').value.trim();
  if (!name) { toast('❌ Name required', '#ffb4ab'); return; }
  const newStock   = parseInt(document.getElementById('pf-stock').value) || 0;
  const stockDirty = newStock !== DB.store[idx].stock;
  DB.store[idx] = {
    ...DB.store[idx],
    emoji: document.getElementById('pf-emoji').value.trim() || '🎁',
    name,
    desc:  document.getElementById('pf-desc').value.trim(),
    cat:   document.getElementById('pf-cat').value,
    cost:  parseInt(document.getElementById('pf-cost').value)  || 100,
    stock: newStock, // local/display value — server write happens below if changed
  };
  saveDB(); // stock excluded from this push, see db-service.js
  closeModalForce(); renderAdminStore(); toast(`✅ "${name}" updated!`);
  if (stockDirty) {
    const { error } = await DBService.rpc('restock_shop_product', { p_product_id: id, p_new_stock: newStock });
    if (error) toast('⚠️ Other changes saved, but stock may not have synced: ' + error.message, '#ffb95f');
  }
};

/**
 * deleteProduct(id) → void  [window.deleteProduct]
 * Opens a confirm modal before actually deleting.
 */
window.deleteProduct = function (id) {
  const item = DB.store.find(i => i.id === id);
  showModal(`<div style="text-align:center;padding:10px">
    <div style="font-size:40px;margin-bottom:12px">🗑️</div>
    <div class="modal-h2" style="text-align:center">Delete Product?</div>
    <div style="color:var(--text-muted);margin-bottom:20px">Remove "${_esc(item?.name)}" from the store?</div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-ghost"  style="flex:1" onclick="closeModalForce()">Cancel</button>
      <button class="btn btn-danger" style="flex:1" onclick="confirmDeleteProduct('${id}')">Delete</button>
    </div>
  </div>`, 'sm');
};

/**
 * confirmDeleteProduct(id) → void  [window.confirmDeleteProduct]
 * Removes item from DB.store. saveDB() → closeModalForce() → renderAdminStore() → toast.
 */
window.confirmDeleteProduct = async function (id) {
  const item = DB.store.find(i => i.id === id);
  DB.store = DB.store.filter(i => i.id !== id);
  saveDB(); closeModalForce(); renderAdminStore();
  toast(`🗑️ "${item?.name}" removed`);
  // Phase 14: the bulk push is upsert-only and never deletes server rows —
  // without this, the product would silently reappear for everyone on the
  // next pull. delete_shop_product() is owner-checked the same as the
  // other shop RPCs.
  const { error } = await DBService.rpc('delete_shop_product', { p_product_id: id });
  if (error) toast('⚠️ Removed locally, but may not have synced: ' + error.message, '#ffb95f');
};

console.log('[EduQuest] shop/admin-store.js loaded — renderAdminStore, product CRUD, stock edit registered.');
