// Phase 7 (Stream D) — equivalence check for
// modules/titles/titles_badge_renderer.js.
//
// Loads the ORIGINAL classic file into one jsdom window and the BUNDLED
// BRIDGE (dist/bridges/titles_badge_renderer.bridge.js, built from
// src/modules/titles/titles_badge_renderer.js) into another, with identical
// stubs for the three external bare-identifier dependencies (uid, _esc,
// _cssColor — utils.js, converted by another stream, so window fallback per
// the global rules; _esc/_cssColor are byte-for-byte the real implementations).
//
// DETERMINISM: tsBuildBadgeHTML draws from Math.random() (SVG gradient ids,
// particle/FX geometry). Both windows get the SAME seeded PRNG, re-seeded
// before EVERY call, so the two sides can only match if they consume random
// numbers in exactly the same order. tsDefaultTitle's createdAt timestamp is
// normalized.
//
// What's compared: the 12 exports' presence/kind, every constant (JSON),
// the TS_RARITY === TS_RARITY_ENHANCEMENTS alias IDENTITY (the one
// non-mechanical change in the conversion), the load-time console banner,
// tsDefaultTitle, tsGetFrameShape/Style (hit, miss, undefined), and a ~150-case
// tsBuildBadgeHTML matrix: every SVG frame shape + unknown, every rarity +
// unknown/missing, every FX effect, every particle type x small/noParticles,
// all 13 MMORPG templates, border/animation/bg custom-CSS branches, escaping,
// unsafe-color fallback, size classes.
//
// Hand-computed sanity assertions on the ORIGINAL's output keep an
// equal-but-wrong result from passing.
//
// NOTE (pre-existing, deliberately NOT changed — this is a verbatim move):
// buildFrameSVG uses the RAW title.borderColor for `stroke` while every other
// use goes through _cssColor(). Equivalence holds either way; flagged in
// HANDOFF for the maintainers.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const KINDS = {
  TS_FRAME_SHAPES_REGISTRY: 'array', TS_FRAME_STYLES_REGISTRY: 'array', TS_EFFECTS_REGISTRY: 'array',
  TS_ANIMATIONS_REGISTRY: 'array', TS_RARITY_ENHANCEMENTS: 'object', TS_RARITY: 'object',
  TS_BORDER_STYLES: 'array', TS_MMORPG_TEMPLATES: 'array',
  tsDefaultTitle: 'function', tsGetFrameShape: 'function', tsGetFrameStyle: 'function', tsBuildBadgeHTML: 'function',
};

const STUBS = `
function uid() { return 'UID'; }
function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _cssColor(s, fallback) {
  fallback = fallback || '#8b5cf6';
  const v = String(s || '').trim();
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
  if (/^var\\(--[a-zA-Z0-9-]+\\)$/.test(v)) return v;
  return fallback;
}
`;

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(ISO, '<ISO>'));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWindow(src) {
  const win = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://example.org/' }).window;
  const logs = [];
  win.console.log = (...a) => logs.push(a.join(' '));
  win.eval(STUBS);
  win.eval(src);
  return { win, logs };
}

// Build a fixed, ordered list of [label, title, opts] cases (outer realm; JSON-cloned into each call).
function buildCases() {
  const cases = [];
  const add = (label, title, opts) => cases.push([label, title, opts || {}]);
  const SHAPES = ['classic', 'solid', 'double', 'dashed', 'dotted', 'custom', 'rectangle', 'capsule', 'ribbon', 'banner', 'shield',
    'hexagon', 'diamond', 'dragon', 'scale', 'flame', 'crystal', 'ghost', 'poison', 'shadow', 'royal', 'arcane', 'celestial', 'zzz-unknown'];
  SHAPES.forEach(s => add('shape:' + s, { name: 'N', rarity: 'Common', frameShape: s, borderColor: '#123456' }));
  add('shape:UPPERCASE', { name: 'N', frameShape: 'DRAGON' });
  add('shape:fallback-frameTemplate', { name: 'N', frameTemplate: 'hexagon' });
  add('shape:fallback-borderStyle', { name: 'N', borderStyle: 'flame' });
  add('shape:fallback-classic', { name: 'N' });

  ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Bogus', undefined, '', 'LEGENDARY', 'mythic'].forEach(r =>
    [false, true].forEach(small => add('rarity:' + r + ':small=' + small, { name: 'R', rarity: r, particles: 'sparkles', effect: 'glow' }, { small })));

  ['none', 'glow', 'embers', 'runes', 'lightning', 'stars', 'drips', 'unknown-fx'].forEach(e =>
    [false, true].forEach(small => add('effect:' + e + ':small=' + small, { name: 'E', rarity: 'Rare', effect: e, glowColor: '#22aa44' }, { small })));

  ['embers', 'smoke', 'mist', 'stars', 'bubbles', 'lightning', 'leaves', 'snow', 'sparkles', 'none', 'zzz'].forEach(p =>
    [false, true].forEach(small => [false, true].forEach(noParticles =>
      add(`particles:${p}:small=${small}:noP=${noParticles}`, { name: 'P', rarity: 'Epic', particles: p }, { small, noParticles }))));

  add('particles:mythic-count', { name: 'M', rarity: 'Mythic', particles: 'embers' });
  add('particles:mythic-count-small', { name: 'M', rarity: 'Mythic', particles: 'embers' }, { small: true });

  // border style / template / animation / bg / effect / frame-style classes
  ['none', 'solid', 'double', 'dashed', 'flame', 'scale', 'crystal', 'shadow', 'ghost', 'poison', 'custom', 'nope'].forEach(b => {
    add('border:' + b, { name: 'B', borderStyle: b, customBorderCSS: '3px dotted red' });
    add('border+template:' + b, { name: 'B', borderStyle: b, frameTemplate: 'metal' });
    // tsDefaultTitle() produces frameTemplate:'solid', so this is the common real-world combination
    add('border+solid-template:' + b, { name: 'B', borderStyle: b, frameTemplate: 'solid' });
  });
  add('anim:pulse', { name: 'A', animation: 'pulse' });
  add('anim:none', { name: 'A', animation: 'none' });
  add('anim:custom', { name: 'A', animation: 'custom', customAnimationCSS: 'spin 2s infinite' });
  add('anim:custom-without-css', { name: 'A', animation: 'custom' });
  add('anim:css-without-custom', { name: 'A', animation: 'pulse', customAnimationCSS: 'spin 2s infinite' });
  add('bg:x', { name: 'G', bgEffect: 'aurora' });
  add('bg:custom', { name: 'G', bgEffect: 'custom', customBgCSS: 'linear-gradient(red,blue)' });
  add('bg:custom-without-css', { name: 'G', bgEffect: 'custom' });
  add('bg:none', { name: 'G', bgEffect: 'none' });
  add('frameStyle:Metal', { name: 'S', frameStyle: 'Metal' });
  add('frameStyle:none', { name: 'S', frameStyle: 'none' });

  // colors, escaping, opts
  add('unsafe-borderColor', { name: 'U', borderColor: 'javascript:alert(1)', glowColor: '"><script>' });
  add('var-color', { name: 'U', borderColor: 'var(--primary)', glowColor: '#abc' });
  add('short-hex-glow', { name: 'U', glowColor: '#f00' });
  add('all-colors', { name: 'C', bgColor: '#000', textColor: '#eee', gradientFrom: '#111', gradientTo: '#222', primaryColor: '#333', accentColor: '#444' });
  add('escape', { name: '<i>"x"</i>&', rarity: '<b>' });
  add('empty-name', { name: '', rarity: 'Rare' });
  add('no-name', { rarity: 'Rare' });
  add('opts:xs', { name: 'X' }, { xs: true });
  add('opts:xs+small', { name: 'X' }, { xs: true, small: true });
  add('opts:small', { name: 'X' }, { small: true });
  add('opts:style', { name: 'X' }, { style: 'margin:0;color:red' });
  add('opts:none', { name: 'X' }, undefined);
  return cases;
}

function run(win) {
  const out = {};
  const seed = n => { win.Math.random = mulberry32(n); };

  out.kinds = {};
  for (const [name, kind] of Object.entries(KINDS)) {
    const v = win[name];
    out.kinds[name] = Array.isArray(v) ? 'array' : typeof v;
    assert.strictEqual(out.kinds[name], kind, `window.${name} should be a ${kind}`);
  }
  out.aliasIdentity = win.TS_RARITY === win.TS_RARITY_ENHANCEMENTS;
  out.constants = clean(Object.fromEntries(Object.keys(KINDS).filter(k => KINDS[k] !== 'function').map(k => [k, win[k]])));

  out.defaultTitle = clean(win.tsDefaultTitle());
  const ids = win.TS_FRAME_SHAPES_REGISTRY.map(s => s.id), sids = win.TS_FRAME_STYLES_REGISTRY.map(s => s.id);
  out.lookups = clean({
    shapeHit: win.tsGetFrameShape(ids[1]), shapeMiss: win.tsGetFrameShape('nope'), shapeUndef: win.tsGetFrameShape(),
    styleHit: win.tsGetFrameStyle(sids[1]), styleMiss: win.tsGetFrameStyle('nope'), styleUndef: win.tsGetFrameStyle(),
  });

  out.falsy = [win.tsBuildBadgeHTML(null), win.tsBuildBadgeHTML(undefined), win.tsBuildBadgeHTML(''), win.tsBuildBadgeHTML(0)];

  out.html = {};
  const cases = buildCases();
  cases.forEach(([label, title, opts], i) => {
    seed(1000 + i);
    // clone inputs INTO this window's realm via JSON so neither side shares objects
    const t = win.eval('(' + JSON.stringify(title) + ')');
    const o = opts === undefined ? undefined : win.eval('(' + JSON.stringify(opts) + ')');
    out.html[label] = o === undefined ? win.tsBuildBadgeHTML(t) : win.tsBuildBadgeHTML(t, o);
  });
  win.TS_MMORPG_TEMPLATES.forEach((tpl, i) => {
    seed(5000 + i);
    out.html['template:' + tpl.id] = win.tsBuildBadgeHTML(tpl);
    seed(6000 + i);
    out.html['template-small:' + tpl.id] = win.tsBuildBadgeHTML(tpl, { small: true, noParticles: true });
  });
  // determinism sanity: same seed twice -> same HTML (guards the harness itself)
  seed(42); const d1 = win.tsBuildBadgeHTML({ name: 'D', particles: 'embers', effect: 'embers', rarity: 'Legendary' });
  seed(42); const d2 = win.tsBuildBadgeHTML({ name: 'D', particles: 'embers', effect: 'embers', rarity: 'Legendary' });
  assert.strictEqual(d1, d2, 'harness: seeded output must be repeatable');
  return out;
}

function count(str, needle) { return str.split(needle).length - 1; }

function main() {
  const originalSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'titles', 'titles_badge_renderer.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'dist', 'bridges', 'titles_badge_renderer.bridge.js'), 'utf8');
  const A = makeWindow(originalSrc), B = makeWindow(bridgeSrc);

  assert.deepStrictEqual(clean(B.logs), clean(A.logs), 'load-time console output must match');
  assert.strictEqual(A.logs.length, 1);
  assert.ok(A.logs[0].includes('titles/badge-renderer.js loaded'));

  const oa = run(A.win), ob = run(B.win);
  assert.deepStrictEqual(clean(ob), clean(oa), 'bridge output must exactly match the original at every step');

  // ── hand-computed sanity on the ORIGINAL's output ──
  const o = clean(oa);
  assert.strictEqual(o.aliasIdentity, true, 'TS_RARITY must be the same object as TS_RARITY_ENHANCEMENTS');
  assert.strictEqual(clean(ob).aliasIdentity, true, '...in the bridge too');
  assert.strictEqual(Object.keys(o.kinds).length, 12);
  assert.strictEqual(o.constants.TS_RARITY.Mythic.glowMul, 1.0);
  assert.strictEqual(o.constants.TS_MMORPG_TEMPLATES.length, 13);
  assert.strictEqual(o.defaultTitle.id, 'UID', 'uid() resolved via window fallback');
  assert.strictEqual(o.defaultTitle.rarity, 'Common'); assert.strictEqual(o.defaultTitle.active, true);
  assert.strictEqual(o.defaultTitle.createdAt, '<ISO>');
  assert.strictEqual(o.lookups.shapeMiss.id, o.constants.TS_FRAME_SHAPES_REGISTRY[0].id, 'miss falls back to first registry entry');
  assert.deepStrictEqual(o.lookups.shapeUndef, o.lookups.shapeMiss);
  assert.deepStrictEqual(o.lookups.styleUndef, o.lookups.styleMiss);
  assert.deepStrictEqual(o.falsy, ['', '', '', '']);

  const H = o.html;
  const cls = h => /<span class="([^"]*)" style=/.exec(h)[1];
  assert.strictEqual(cls(H['shape:classic']), 'ts-badge-wrap ts-frame-classic ts-rarity-common');
  assert.strictEqual(cls(H['shape:UPPERCASE']), 'ts-badge-wrap ts-frame-dragon ts-rarity-common', 'shape lower-cased');
  assert.ok(cls(H['shape:fallback-frameTemplate']).includes('ts-frame-hexagon'));
  assert.ok(cls(H['shape:fallback-borderStyle']).includes('ts-frame-flame'));
  assert.ok(H['shape:zzz-unknown'].includes('<!-- no svg -->') && !H['shape:zzz-unknown'].includes('ts-frame-svg'), 'unknown shape -> no svg');
  assert.ok(H['shape:flame'].includes('ts-flame-anim-svg') && H['shape:poison'].includes('ts-poison-anim-svg') && H['shape:arcane'].includes('ts-arcane-glass'));
  ['classic', 'rectangle', 'capsule', 'ribbon', 'banner', 'shield', 'hexagon', 'diamond', 'dragon', 'scale', 'crystal', 'ghost', 'shadow', 'royal', 'celestial']
    .forEach(s => assert.ok(H['shape:' + s].includes('class="ts-frame-svg'), s + ' renders an svg frame'));
  assert.ok(H['shape:capsule'].includes('viewBox="0 0 220 58"'), 'capsule viewBox');
  // rarity overlays
  assert.ok(H['rarity:Legendary:small=false'].includes('ts-legendary-glint') && !H['rarity:Legendary:small=false'].includes('ts-mythic-burst'));
  assert.ok(H['rarity:Mythic:small=false'].includes('ts-mythic-burst') && !H['rarity:Mythic:small=false'].includes('ts-legendary-glint'));
  assert.ok(H['rarity:LEGENDARY:small=false'].includes('ts-legendary-glint'), 'overlay check is case-insensitive');
  assert.ok(!H['rarity:Rare:small=false'].includes('ts-legendary-glint') && !H['rarity:Rare:small=false'].includes('ts-mythic-burst'));
  assert.ok(cls(H['rarity:Bogus:small=false']).includes('ts-rarity-bogus'), 'unknown rarity keeps its class but Common config');
  assert.ok(cls(H['rarity:undefined:small=false']).includes('ts-rarity-common'));
  assert.ok(H['rarity:Mythic:small=true'].includes('--ts-glow-shadow:0 0 18px '), 'small: spread 30*0.6=18');
  assert.ok(H['rarity:Mythic:small=false'].includes('--ts-glow-shadow:0 0 30px '), 'spread 30');
  // FX layers
  assert.strictEqual(count(H['effect:embers:small=false'], 'ts-fx-ember"'), 7);
  assert.strictEqual(count(H['effect:embers:small=true'], 'ts-fx-ember"'), 4);
  assert.strictEqual(count(H['effect:lightning:small=false'], 'ts-fx-bolt"'), 5);
  assert.strictEqual(count(H['effect:stars:small=false'], 'ts-fx-star"'), 6);
  assert.strictEqual(count(H['effect:drips:small=false'], 'ts-fx-drip"'), 6);
  assert.ok(H['effect:runes:small=false'].includes('ᚦ ᚨ ᚱ ᚲ ᛉ ᛊ') && !H['effect:runes:small=false'].includes('ᛏ'), '6 runes');
  assert.ok(H['effect:runes:small=true'].includes('ᚦ ᚨ ᚱ ᚲ<') , '4 runes when small');
  assert.ok(!H['effect:none:small=false'].includes('ts-fx-layer'));
  assert.ok(H['effect:glow:small=false'].includes('<span class="ts-fx-layer" aria-hidden="true"></span>'), 'glow: layer present, empty inner');
  assert.ok(H['effect:unknown-fx:small=false'].includes('<span class="ts-fx-layer" aria-hidden="true"></span>'), 'unknown effect -> empty fx layer');
  // particles: Mythic glowMul 1.0 -> round(5*3)=15 ; small round(3*3)=9
  assert.strictEqual(count(H['particles:mythic-count'], 'class="ts-particle"'), 15);
  assert.strictEqual(count(H['particles:mythic-count-small'], 'class="ts-particle"'), 9);
  assert.ok(!H['particles:embers:small=false:noP=true'].includes('ts-particle-host'), 'noParticles suppresses');
  assert.ok(!H['particles:none:small=false:noP=false'].includes('ts-particle-host'));
  assert.ok(H['particles:zzz:small=false:noP=false'].includes('background:#ffffff'), 'unknown particle color -> white');
  assert.ok(H['particles:embers:small=false:noP=false'].includes('background:#f97316'));
  // classes / styles
  assert.ok(cls(H['border:flame']).includes('tsb-flame'), 'legacy border class applies with no frameTemplate');
  assert.ok(!cls(H['border+template:flame']).includes('tsb-flame'), 'not with a non-solid frameTemplate');
  assert.ok(cls(H['border+solid-template:flame']).includes('tsb-flame'), "frameTemplate 'solid' still uses the legacy border class");
  assert.ok(H['border:custom'].includes('border:3px dotted red;') && !H['border:solid'].includes('border:3px dotted red'));
  assert.ok(cls(H['anim:pulse']).includes('ts-anim-pulse') && !cls(H['anim:none']).includes('ts-anim') && !cls(H['anim:custom']).includes('ts-anim'));
  assert.ok(H['anim:custom'].includes('animation:spin 2s infinite;') && !H['anim:custom-without-css'].includes('animation:') && !H['anim:css-without-custom'].includes('animation:spin'));
  assert.ok(cls(H['bg:x']).includes('tsbg-aurora') && !cls(H['bg:custom']).includes('tsbg-') && !cls(H['bg:none']).includes('tsbg-'));
  assert.ok(H['bg:custom'].includes('background:linear-gradient(red,blue);') && !H['bg:custom'].includes('background:transparent'), 'custom bg replaces transparent');
  assert.ok(H['bg:x'].includes('background:transparent'));
  assert.ok(cls(H['frameStyle:Metal']).includes('ts-style-metal') && !cls(H['frameStyle:none']).includes('ts-style-'));
  assert.ok(H['unsafe-borderColor'].includes('--ts-border:#8b5cf6') && H['unsafe-borderColor'].includes('border-color:#8b5cf6;'), '_cssColor fallback on unsafe color');
  assert.ok(H['unsafe-borderColor'].includes('--ts-glow:#8b5cf6'), 'unsafe glow -> fallback too');
  assert.ok(H['var-color'].includes('--ts-border:var(--primary)') && H['var-color'].includes('--ts-glow:#abc'));
  // h2rgba slices fixed positions: '#f00' -> 'f0'=240, '0'=0 (falsy -> 92), ''=NaN (-> 246). Quirky, pre-existing, preserved.
  assert.ok(H['short-hex-glow'].includes('rgba(240,92,246,'), 'h2rgba on a 3-digit hex (verbatim quirk)');
  assert.ok(H['escape'].includes('title="&lt;i&gt;&quot;x&quot;&lt;/i&gt;&amp; (&lt;b&gt;)"'), 'title attr escaped via _esc');
  assert.ok(H['escape'].includes('&lt;i&gt;&quot;x&quot;&lt;/i&gt;&amp;</span>'), 'name text escaped');
  assert.ok(H['empty-name'].includes('title=" (Rare)"') && H['empty-name'].includes('>Title</span>'), "empty name: attr blank, text falls back to 'Title'");
  assert.ok(H['no-name'].includes('>Title</span>'));
  assert.ok(cls(H['opts:xs']).includes('ts-size-xs') && cls(H['opts:xs+small']).includes('ts-size-xs') && !cls(H['opts:xs+small']).includes('ts-size-sm') && cls(H['opts:small']).includes('ts-size-sm'));
  assert.ok(H['opts:style'].includes(';margin:0;color:red"'), 'opts.style appended last');
  assert.ok(H['opts:none'].includes('ts-badge-wrap') && !H['opts:none'].includes('ts-size-'), 'opts omitted: no throw, no size class');

  console.log('EQUIVALENCE CHECK PASSED');
  console.log('Original titles_badge_renderer.js and the bundled src/ twin agree on:');
  console.log(' - all 12 exports present with the right kinds; load-time banner identical');
  console.log(' - TS_RARITY === TS_RARITY_ENHANCEMENTS alias identity holds in both');
  console.log(' - every constant; tsDefaultTitle; tsGetFrameShape/Style hit/miss/undefined');
  console.log(' - tsBuildBadgeHTML: ' + Object.keys(o.html).length + ' seeded cases (all frame shapes, rarities, FX, particles, custom-CSS branches, escaping, colors, sizes, all 13 templates)');
}

main();
