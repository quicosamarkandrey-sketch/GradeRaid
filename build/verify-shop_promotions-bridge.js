// Phase 7 (Stream D) — equivalence check for modules/shop/shop_promotions.js.
//
// Real-imports AppStore (state-manager.js, zero imports of its own), plus
// dom.js's toast/showModal/closeModalForce and utils.js's _esc/uid — all
// clean leaf files, used FOR REAL on both sides (shop_orders.js/
// shop_inventory.js pattern) rather than mocked.
//
// navTo/showPage/renderStudentStore (bare, shop_store.js — not yet
// converted) are stubbed; their own behavior isn't under test here.
//
// TIMING: promoRenderCarousel/promoNav/promoGoTo schedule a real
// setInterval for carousel auto-rotation (6s, or a promo's own
// rotationInterval), and promoStartCountdownTick schedules one at a fixed
// 60s. Both are FAR too long to literally wait out per the project's
// prefer-real-timers convention without making this check impractically
// slow (worse under mutation testing, where it reruns many times). Instead:
// `win.setInterval`/`win.clearInterval` are wrapped to RECORD every call
// (delay + the callback itself) without altering real scheduling, so the
// check can assert the exact delay/clear-before-reschedule behavior AND
// invoke the captured callback directly and immediately to exercise its
// real logic — a faithful test of "what the interval does when it fires"
// without the wall-clock cost. The two real timer FUNCTIONS used elsewhere
// in this file (none — this file has no short setTimeout/debounce) don't
// need this treatment.
//
// What's compared: promoTypeConfig/promoIsActive/promoGetActive (date
// windows, priority sort), the three analytics recorders (incl. the
// draftState in-place-mutation path), promoGetAutoLabel's every branch,
// promoCountdownStr's d/h/m/expired/no-endDate branches, the carousel build
// + render (empty/single/multi, interval scheduling + reschedule-on-nav),
// promoActivateSlide's wraparound + DOM class toggling, promoClickBanner's
// linked-item vs. plain-navTo paths, promoGetCardBadge's 3 branches, the
// countdown tick's real update/remove logic (invoked directly, see above),
// renderAdminPromotions' full HTML (stats, most-clicked/purchased, empty
// state), the create/edit form + save (validation, id generation, in-place
// edit vs. push), toggle/delete/confirmDelete, and both preview modals.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const STARTER_HTML = `<!doctype html><html><body>
  <div id="promo-carousel-wrap"></div>
  <div id="a-promotions"></div>
  <div id="toast"></div>
  <div id="modal-box" class="modal-box"></div>
  <div id="modal-content"></div>
  <div id="modal-overlay" style="display:none"></div>
</body></html>`;

function makeWindow() {
  const dom = new JSDOM(STARTER_HTML, { runScripts: 'dangerously', url: 'https://example.org/' });
  const win = dom.window;
  win.__navCalls = [];
  win.navTo = (x) => win.__navCalls.push({ k: 'navTo', x });
  win.showPage = (x) => win.__navCalls.push({ k: 'showPage', x });
  win.renderStudentStore = (cat) => win.__navCalls.push({ k: 'renderStudentStore', cat });
  win.DEFAULT_DB = { promotions: [], promoAnalytics: {}, store: [], redemptions: [] };
  win.DBService = { initRemote: async () => {}, read: () => null, write() {} };

  // Spy wrappers: record every setInterval/clearInterval call; still
  // schedule for real (so "an interval exists" checks via truthy ids keep
  // working), but let the test invoke a captured callback directly instead
  // of waiting for it to fire.
  win.__intervalCalls = [];
  const realSetInterval = win.setInterval.bind(win);
  const realClearInterval = win.clearInterval.bind(win);
  win.setInterval = (fn, delay) => { const id = realSetInterval(fn, delay); win.__intervalCalls.push({ op: 'set', id, delay, fn }); return id; };
  win.clearInterval = (id) => { win.__intervalCalls.push({ op: 'clear', id }); return realClearInterval(id); };

  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  return { win, logs };
}
async function evalOriginal(win) {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  win.eval(read('modules/core/state-manager.js'));
  win.eval(read('dom.js'));
  win.eval(read('utils.js'));
  win.eval(read('modules/shop/shop_promotions.js'));
  await win.AppStore.ready;
}
async function evalBridge(win) {
  win.eval(fs.readFileSync(path.join(__dirname, 'test-helpers', 'shop_promotions-combined-bundle.js'), 'utf8'));
  await win.AppStore.ready;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const IDRE = /id_[a-z0-9]+/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>').replace(IDRE, '<TMPID>'));

function seedState(win, state) {
  win.AppStore.updateState(draft => Object.assign(draft, state), { type: 'test:seed' });
}
const lastInterval = win => win.__intervalCalls.filter(c => c.op === 'set').slice(-1)[0];
const modalSnap = win => ({ visible: win.document.getElementById('modal-overlay').style.display, content: win.document.getElementById('modal-content').innerHTML });
const toastSnap = win => ({ visible: win.document.getElementById('toast').style.display, html: win.document.getElementById('toast').innerHTML });

const fixedState = () => ({
  store: [
    { id: 'it1', name: 'Sticker Pack', emoji: '🎨', cost: 50, cat: 'supplies' },
    { id: 'it2', name: 'Nap Pass', emoji: '😴', cost: 100, cat: 'privilege' },
  ],
  promotions: [
    { id: 'p1', title: 'Weekend Sale', subtitle: 'Save big', type: 'sale', active: true, priority: 5, linkedItemId: 'it1' },
    { id: 'p2', title: 'New Arrival', subtitle: 'Check it out', type: 'new', active: true, priority: 10 },
    { id: 'p3', title: 'Expired Promo', type: 'featured', active: true, endDate: '2020-01-01T00:00:00.000Z' },
    { id: 'p4', title: 'Inactive Promo', type: 'featured', active: false },
  ],
  promoAnalytics: { p1: { views: 10, clicks: 5, purchases: 1 }, p2: { views: 20, clicks: 2, purchases: 0 } },
  redemptions: [],
});

async function run(win) {
  const out = {};
  seedState(win, fixedState());

  // ── promoTypeConfig / promoIsActive / promoGetActive ──
  out.typeConfig = { known: win.promoTypeConfig('sale'), unknown: win.promoTypeConfig('bogus') };
  out.active = {
    expiredFalse: win.promoIsActive({ active: true, endDate: '2020-01-01T00:00:00.000Z' }),
    notStartedFalse: win.promoIsActive({ active: true, startDate: '2099-01-01T00:00:00.000Z' }),
    inactiveFalse: win.promoIsActive({ active: false }),
    plainTrue: win.promoIsActive({ active: true }),
  };
  out.getActive = win.promoGetActive().map(p => p.id); // p3 expired, p4 inactive -> excluded; p2(pri10) before p1(pri5)

  // ── analytics recorders ──
  out.analytics = {};
  win.promoRecordView(null); win.promoRecordView(undefined); // no-ops, no throw
  win.promoRecordView('p1'); win.promoRecordClick('p1');
  out.analytics.afterViewClick = clean(win.AppStore.getSlice(s => s.promoAnalytics.p1));
  win.promoRecordView('new-id'); // creates a fresh analytics entry
  out.analytics.freshEntry = clean(win.AppStore.getSlice(s => s.promoAnalytics['new-id']));
  win.promoRecordPurchase('it1'); // p1 is linked to it1 and active -> its purchases++
  out.analytics.purchaseViaOwnUpdateState = clean(win.AppStore.getSlice(s => s.promoAnalytics.p1.purchases));
  const draft = { promoAnalytics: clean(win.AppStore.getSlice(s => s.promoAnalytics)), promotions: fixedState().promotions };
  win.promoRecordPurchase('it1', draft); // caller-supplied draft -> mutated directly, NOT through AppStore
  out.analytics.purchaseViaDraft = clean(draft.promoAnalytics.p1.purchases);
  out.analytics.storeUnchangedByDraftCall = clean(win.AppStore.getSlice(s => s.promoAnalytics.p1.purchases));

  // ── promoGetAutoLabel ──
  const now = new Date();
  const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
  out.autoLabel = {
    override: win.promoGetAutoLabel({ _promoLabel: 'custom-label' }),
    isNew: win.promoGetAutoLabel({ addedAt: dayAgo }),
    limited: win.promoGetAutoLabel({ stock: 2 }),
    zeroStockNotLimited: win.promoGetAutoLabel({ stock: 0 }),
    hot: win.promoGetAutoLabel({ id: 'it1' }), // it1 has 0 redemptions seeded so far below seeds some
    none: win.promoGetAutoLabel({ id: 'nope-item' }),
  };
  seedState(win, Object.assign({}, fixedState(), { redemptions: [{ itemId: 'it1' }, { itemId: 'it1' }, { itemId: 'it1' }] }));
  out.autoLabel.hotWithThreeRedemptions = win.promoGetAutoLabel({ id: 'it1' });
  seedState(win, fixedState());

  // ── promoCountdownStr ──
  const inDays = d => new Date(Date.now() + d * 86400000).toISOString();
  const inHours = h => new Date(Date.now() + h * 3600000).toISOString();
  // +30s margin: the countdown string floors the remaining minutes, so an exact `now + 5min` fixture read 5 or 4 minutes
  // depending on whether a millisecond ticked over between the original run and the bridge run (a rare spurious failure).
  const inMins = m => new Date(Date.now() + m * 60000 + 30000).toISOString();
  out.countdown = {
    none: win.promoCountdownStr(null),
    expired: win.promoCountdownStr('2020-01-01T00:00:00.000Z'),
    days: win.promoCountdownStr(inDays(2)).replace(/\d+h/, 'Nh'), // hour component is time-sensitive; normalize it
    hours: win.promoCountdownStr(inHours(3)).replace(/\d+m/, 'Nm'),
    minutes: win.promoCountdownStr(inMins(5)),
  };

  // ── carousel: empty / single / multi ──
  out.carousel = {};
  seedState(win, { promotions: [], promoAnalytics: {}, store: [], redemptions: [] });
  win.promoRenderCarousel();
  out.carousel.empty = win.document.getElementById('promo-carousel-wrap').innerHTML;
  seedState(win, { promotions: [{ id: 'solo', title: 'Solo', active: true, type: 'featured' }], promoAnalytics: {}, store: [], redemptions: [] });
  win.promoRenderCarousel();
  out.carousel.single = win.document.getElementById('promo-carousel-wrap').innerHTML;
  out.carousel.singleNoIntervalScheduled = win.__intervalCalls.filter(c => c.op === 'set').length; // only 1 active -> no rotation interval
  seedState(win, fixedState());
  win.__intervalCalls.length = 0;
  win.promoRenderCarousel();
  out.carousel.multi = win.document.getElementById('promo-carousel-wrap').innerHTML;
  out.carousel.multiIntervalDelay = lastInterval(win).delay; // default 6000 (p2 has no rotationInterval, is first after priority sort)
  out.carousel.multiActiveSlideFirst = [...win.document.querySelectorAll('.promo-slide')].map(el => el.classList.contains('active'));
  // call promoRenderCarousel() a SECOND time directly (not via promoNav/
  // promoGoTo, which have their own reschedule logic) -> must clear the
  // first interval itself before scheduling a new one.
  const clearsBeforeSecondRender = win.__intervalCalls.filter(c => c.op === 'clear').length;
  win.promoRenderCarousel();
  out.carousel.secondRenderClearsFirst = win.__intervalCalls.filter(c => c.op === 'clear').length > clearsBeforeSecondRender;

  // ── promoActivateSlide / promoNav / promoGoTo (interval reschedule) ──
  out.nav = {};
  win.promoGoTo(1);
  out.nav.afterGoTo1 = [...win.document.querySelectorAll('.promo-slide')].map(el => el.classList.contains('active'));
  out.nav.rescheduledAfterGoTo = win.__intervalCalls.filter(c => c.op === 'set').length > 1;
  const clearCount = win.__intervalCalls.filter(c => c.op === 'clear').length;
  win.promoNav(-1); // back to slide 0 (wraps)
  out.nav.afterNavBack = [...win.document.querySelectorAll('.promo-slide')].map(el => el.classList.contains('active'));
  out.nav.navAlsoClearsOldInterval = win.__intervalCalls.filter(c => c.op === 'clear').length > clearCount;
  // invoke the captured rotation callback directly instead of waiting out the real 6s interval
  const rotateCb = lastInterval(win).fn;
  rotateCb();
  out.nav.afterAutoRotateInvoked = [...win.document.querySelectorAll('.promo-slide')].map(el => el.classList.contains('active'));

  // ── promoClickBanner ──
  out.click = {};
  win.promoClickBanner('p2'); // not linked -> navTo('s-store')
  out.click.plainNav = clean(win.__navCalls);
  win.__navCalls.length = 0;
  win.promoClickBanner('p1'); // linked to it1 -> renderStudentStore(cat) + showPage, no navTo
  out.click.linkedNav = clean(win.__navCalls);
  win.__navCalls.length = 0;
  win.promoClickBanner('nope'); // vanished promo -> recordClick still happens, then early return, no throw
  out.click.vanishedNoThrow = true;

  // ── promoGetCardBadge ──
  out.cardBadge = {
    linkedPromo: win.promoGetCardBadge({ id: 'it1' }), // p1 linked + active -> promo's own tag
    autoHot: win.promoGetCardBadge({ id: 'it1-copy' }), // not linked to any promo; falls to auto-label (none, since 0 redemptions for this id)
    none: win.promoGetCardBadge({ id: 'totally-unrelated' }),
  };

  // ── countdown tick: invoke the captured callback directly ──
  out.tick = {};
  // 30 minutes away: strictly between the mutation-test's 60000ms (1min)
  // and the real 3600000ms (1hr) urgent threshold, so a threshold change
  // either direction is distinguishable.
  seedState(win, { promotions: [{ id: 'tp', title: 'Tick Promo', active: true, type: 'featured', endDate: inMins(30) }], promoAnalytics: {}, store: [], redemptions: [] });
  win.promoRenderCarousel();
  win.__intervalCalls.length = 0;
  win.promoStartCountdownTick();
  out.tick.scheduledDelay = lastInterval(win).delay;
  const tickCb1 = lastInterval(win).fn;
  tickCb1();
  const cdEl1 = win.document.querySelector('.promo-countdown');
  out.tick.afterFirstTick = cdEl1?.textContent || null;
  out.tick.urgentAt30Min = cdEl1?.classList.contains('urgent') || false;
  // start again -> must clear the previous interval before scheduling a new one
  win.promoStartCountdownTick();
  out.tick.secondStartCleared = win.__intervalCalls.some(c => c.op === 'clear');
  // simulate expiry: seed an already-past endDate, then invoke the NEW callback -> element removed
  seedState(win, { promotions: [{ id: 'tp', title: 'Tick Promo', active: true, type: 'featured', endDate: '2020-01-01T00:00:00.000Z' }], promoAnalytics: {}, store: [], redemptions: [] });
  const tickCb2 = lastInterval(win).fn;
  tickCb2();
  out.tick.afterExpiryTick = win.document.querySelector('.promo-countdown');

  // ── renderAdminPromotions ──
  seedState(win, fixedState());
  out.admin = {};
  win.renderAdminPromotions();
  out.admin.full = win.document.getElementById('a-promotions').innerHTML;
  seedState(win, { promotions: [], promoAnalytics: {}, store: [], redemptions: [] });
  win.renderAdminPromotions();
  out.admin.empty = win.document.getElementById('a-promotions').innerHTML;
  seedState(win, fixedState());

  // ── create/edit form + save ──
  out.form = {};
  win.promoAdminOpenForm();
  out.form.addModal = win.document.getElementById('modal-content').innerHTML;
  win.promoAdminOpenForm('p1');
  out.form.editModal = win.document.getElementById('modal-content').innerHTML;
  win.document.getElementById('prf-title').value = '';
  win.promoAdminSaveForm('p1');
  out.form.emptyTitleToast = toastSnap(win);
  out.form.notSavedOnEmptyTitle = clean(win.AppStore.getSlice(s => s.promotions).find(p => p.id === 'p1').title) === 'Weekend Sale';
  win.document.getElementById('prf-title').value = 'Renamed Sale';
  win.promoAdminSaveForm('p1');
  out.form.editedInPlace = clean(win.AppStore.getSlice(s => s.promotions).map(p => p.id));
  out.form.editedTitle = clean(win.AppStore.getSlice(s => s.promotions).find(p => p.id === 'p1').title);
  win.promoAdminOpenForm();
  win.document.getElementById('prf-title').value = 'Brand New';
  win.promoAdminSaveForm('');
  const afterCreate = clean(win.AppStore.getSlice(s => s.promotions));
  out.form.createdCount = afterCreate.length;
  out.form.createdIdIsTmp = afterCreate.find(p => p.title === 'Brand New').id === '<TMPID>';
  win.document.getElementById('prf-type').value = 'custom';
  win.promoFormTypeChange();
  out.form.customLabelShown = win.document.getElementById('prf-custom-label-wrap').style.display;
  win.document.getElementById('prf-type').value = 'sale';
  win.promoFormTypeChange();
  out.form.customLabelHidden = win.document.getElementById('prf-custom-label-wrap').style.display;
  // draft.promotions is not an array at all (corrupted/uninitialized state)
  // -> save must initialize it to [] before pushing, not throw
  seedState(win, { promotions: null, promoAnalytics: {}, store: [], redemptions: [] });
  win.promoAdminOpenForm();
  win.document.getElementById('prf-title').value = 'First Ever';
  win.promoAdminSaveForm('');
  out.form.savedIntoNonArrayPromotions = clean(win.AppStore.getSlice(s => s.promotions));
  seedState(win, fixedState());

  // ── toggle / delete / confirmDelete ──
  out.manage = {};
  win.promoAdminToggle('p4'); // was active:false
  out.manage.toggledOn = clean(win.AppStore.getSlice(s => s.promotions).find(p => p.id === 'p4').active);
  win.promoAdminToggle('p1'); // was active:true -> must flip OFF, not stay/become true
  out.manage.toggledOff = clean(win.AppStore.getSlice(s => s.promotions).find(p => p.id === 'p1').active);
  win.promoAdminToggle('nope'); // vanished -> no-op, no throw
  out.manage.toggleVanishedNoThrow = true;
  win.promoAdminDelete('p2');
  out.manage.deleteConfirmModal = modalSnap(win);
  win.promoAdminConfirmDelete('p2');
  out.manage.afterDelete = { ids: clean(win.AppStore.getSlice(s => s.promotions).map(p => p.id)), analyticsGone: clean(win.AppStore.getSlice(s => s.promoAnalytics.p2)) };
  seedState(win, fixedState());

  // ── preview modals ──
  out.preview = {};
  win.promoAdminPreview('p1');
  out.preview.single = modalSnap(win);
  win.promoAdminPreview('nope');
  out.preview.vanishedNoThrow = true;
  win.promoAdminPreviewStore();
  out.preview.store = modalSnap(win);
  seedState(win, { promotions: [], promoAnalytics: {}, store: [], redemptions: [] });
  win.promoAdminPreviewStore();
  out.preview.storeNoActiveToast = toastSnap(win);

  return out;
}

async function main() {
  const A = makeWindow(), B = makeWindow();
  await evalOriginal(A.win);
  await evalBridge(B.win);

  assert.ok(A.logs.some(l => l.includes('shop/promotions.js loaded')));
  assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');

  const oa = await run(A.win), ob = await run(B.win);
  assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

  const o = clean(oa);
  assert.strictEqual(o.typeConfig.known.value, 'sale');
  assert.ok(o.typeConfig.unknown && o.typeConfig.unknown.value, 'unknown type falls back to the LAST config entry');

  assert.deepStrictEqual(o.active, { expiredFalse: false, notStartedFalse: false, inactiveFalse: false, plainTrue: true });
  assert.deepStrictEqual(o.getActive, ['p2', 'p1'], 'p3 (expired) and p4 (inactive) excluded; p2 (priority 10) before p1 (priority 5)');

  assert.deepStrictEqual(o.analytics.afterViewClick, { views: 11, clicks: 6, purchases: 1 });
  assert.deepStrictEqual(o.analytics.freshEntry, { views: 1, clicks: 0, purchases: 0 });
  assert.strictEqual(o.analytics.purchaseViaOwnUpdateState, 2, 'own-updateState path increments purchases for p1');
  assert.strictEqual(o.analytics.purchaseViaDraft, 3, 'draft-mutation path also increments it, inside the caller-supplied draft');
  assert.strictEqual(o.analytics.storeUnchangedByDraftCall, 2, 'the draft-mutation path must NOT touch the real AppStore');

  assert.strictEqual(o.autoLabel.override, 'custom-label');
  assert.strictEqual(o.autoLabel.isNew, 'new');
  assert.strictEqual(o.autoLabel.limited, 'limited');
  assert.strictEqual(o.autoLabel.zeroStockNotLimited, null, 'stock 0 is NOT limited (stock > 0 required)');
  assert.strictEqual(o.autoLabel.hot, null, 'no redemptions yet for it1 at this point');
  assert.strictEqual(o.autoLabel.none, null);
  assert.strictEqual(o.autoLabel.hotWithThreeRedemptions, 'hot');

  assert.strictEqual(o.countdown.none, null);
  assert.strictEqual(o.countdown.expired, null);
  assert.ok(o.countdown.days.startsWith('⏰ 2d ') && o.countdown.days.includes('Nh left'));
  assert.ok(o.countdown.hours.startsWith('⏰ 2h ') || o.countdown.hours.startsWith('⏰ 3h '));
  assert.ok(o.countdown.minutes.startsWith('⏰ ') && o.countdown.minutes.endsWith('m left'));

  assert.ok(o.carousel.empty.includes('Welcome') && o.carousel.empty.includes('The Armory'));
  assert.ok(o.carousel.single.includes('Solo') && !o.carousel.single.includes('promo-carousel-controls'), 'single active promo -> no nav controls');
  assert.strictEqual(o.carousel.singleNoIntervalScheduled, 0, 'only one active slide -> no rotation interval scheduled');
  assert.ok(o.carousel.multi.includes('promo-carousel-controls') && o.carousel.multi.includes('New Arrival') && o.carousel.multi.includes('Weekend Sale'));
  assert.strictEqual(o.carousel.multiIntervalDelay, 6000, "p2 (first after priority sort) has no rotationInterval -> default 6000ms");
  assert.deepStrictEqual(o.carousel.multiActiveSlideFirst, [true, false], 'first slide (p2) starts active');
  assert.strictEqual(o.carousel.secondRenderClearsFirst, true, 'a second promoRenderCarousel() call clears its own earlier interval before scheduling a new one');

  assert.deepStrictEqual(o.nav.afterGoTo1, [false, true]);
  assert.strictEqual(o.nav.rescheduledAfterGoTo, true, 'promoGoTo reschedules the rotation interval');
  assert.deepStrictEqual(o.nav.afterNavBack, [true, false], 'promoNav(-1) from slide 1 wraps back to slide 0');
  assert.strictEqual(o.nav.navAlsoClearsOldInterval, true);
  assert.deepStrictEqual(o.nav.afterAutoRotateInvoked, [false, true], 'the real rotation callback advances to the next slide, same as promoNav(1)');

  assert.deepStrictEqual(o.click.plainNav, [{ k: 'navTo', x: 's-store' }]);
  assert.deepStrictEqual(o.click.linkedNav.map(c => c.k), ['renderStudentStore', 'showPage']);

  assert.deepStrictEqual(o.cardBadge.linkedPromo, { cls: 'sale', label: o.typeConfig.known.tagLabel });
  assert.strictEqual(o.cardBadge.autoHot, null);
  assert.strictEqual(o.cardBadge.none, null);

  assert.strictEqual(o.tick.scheduledDelay, 60000);
  assert.ok(o.tick.afterFirstTick && o.tick.afterFirstTick.includes('left'), 'first tick updates the countdown text in place');
  assert.strictEqual(o.tick.urgentAt30Min, true, '30 minutes left is inside the 1-hour urgent threshold');
  assert.strictEqual(o.tick.secondStartCleared, true, 'calling promoStartCountdownTick again clears the previous interval first');
  assert.strictEqual(o.tick.afterExpiryTick, null, 'once the promo\'s countdown expires, the tick removes the .promo-countdown element');

  assert.ok(o.admin.full.includes('2 currently live') && o.admin.full.includes('4 total'));
  assert.ok(o.admin.full.includes('Most Clicked') || o.admin.full.includes('New Arrival'), 'most-clicked/most-purchased callouts render');
  assert.ok(o.admin.empty.includes('No promotions yet'));

  assert.ok(o.form.addModal.includes('Create Promotion'));
  assert.ok(o.form.editModal.includes('Edit Promotion') && o.form.editModal.includes('Weekend Sale'));
  assert.ok(o.form.emptyTitleToast.html.includes('Title is required'));
  assert.strictEqual(o.form.notSavedOnEmptyTitle, true);
  assert.strictEqual(o.form.editedTitle, 'Renamed Sale');
  assert.deepStrictEqual(o.form.editedInPlace, ['p1', 'p2', 'p3', 'p4'], 'editing keeps the same array position/length');
  assert.strictEqual(o.form.createdCount, 5, 'a brand-new promo is appended');
  assert.strictEqual(o.form.createdIdIsTmp, true, 'a new promo with no editId gets a uid()-generated id');
  assert.strictEqual(o.form.customLabelShown, 'block');
  assert.strictEqual(o.form.customLabelHidden, 'none');
  assert.strictEqual(o.form.savedIntoNonArrayPromotions.length, 1, 'a null promotions slice is initialized to [] before the new promo is pushed');
  assert.strictEqual(o.form.savedIntoNonArrayPromotions[0].title, 'First Ever');

  assert.strictEqual(o.manage.toggledOn, true);
  assert.strictEqual(o.manage.toggledOff, false, 'toggling an already-active promo must turn it off, not force it true');
  assert.strictEqual(o.manage.deleteConfirmModal.visible, 'flex');
  assert.ok(o.manage.deleteConfirmModal.content.includes('New Arrival'));
  assert.ok(!o.manage.afterDelete.ids.includes('p2'));
  assert.strictEqual(o.manage.afterDelete.analyticsGone, null);

  assert.strictEqual(o.preview.single.visible, 'flex');
  assert.ok(o.preview.single.content.includes('Weekend Sale'));
  assert.strictEqual(o.preview.store.visible, 'flex');
  assert.ok(o.preview.storeNoActiveToast.html.includes('No active promotions'));

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Original shop_promotions.js (via the real state-manager/dom/utils chain) and');
  console.log('the bundled src/ twin (real-imported through the same chain) agree on:');
  console.log(' - promoTypeConfig/promoIsActive/promoGetActive (date windows, priority sort)');
  console.log(' - the 3 analytics recorders, incl. the caller-supplied-draft mutation path');
  console.log(' - promoGetAutoLabel\'s every branch; promoCountdownStr\'s d/h/m/expired branches');
  console.log(' - the carousel: empty/single/multi render, interval scheduling + reschedule-on-nav');
  console.log('   (interval callbacks invoked directly rather than waiting out real 6s/60s timers)');
  console.log(' - promoActivateSlide wraparound, promoClickBanner, promoGetCardBadge, the live');
  console.log('   countdown tick\'s update/remove logic');
  console.log(' - renderAdminPromotions, the create/edit form + save, toggle/delete, both previews');
  // Real carousel/countdown intervals were genuinely scheduled during run()
  // (deliberately never faked, per the project's prefer-real-timers rule)
  // and are still live — exit explicitly rather than let them keep the
  // process alive. This is a test-harness concern, not a product bug.
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
