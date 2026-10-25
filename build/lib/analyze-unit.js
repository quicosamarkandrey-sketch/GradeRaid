// Phase 7 shared analysis library — extracted from build/dependency-map.js
// (session 4) so build/audit-window-exports.js (session 7) doesn't
// duplicate the parsing/scope-analysis logic and risk drifting from it.
//
// Parses each source unit with acorn (sourceType: 'script', matching how
// these files actually execute today) and runs real scope analysis via
// eslint-scope to find genuinely free (unresolved-within-file) references
// — not a regex guess at "looks like a global."

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const escope = require('eslint-scope');

// Ambient/browser/library globals this codebase legitimately relies on that
// are never "declared" by any of our own files. Extend this list rather
// than letting unresolvable names silently pollute the edge list.
const AMBIENT_GLOBALS = new Set([
  'window', 'document', 'console', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'FormData',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'Image',
  'Audio', 'Worker', 'WebSocket', 'Notification', 'Intl',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError',
  'Math', 'JSON', 'NaN', 'Infinity', 'undefined', 'globalThis', 'self',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone',
  'CustomEvent', 'Event', 'EventTarget', 'MutationObserver',
  'IntersectionObserver', 'ResizeObserver', 'AbortController', 'AbortSignal',
  'CSS', 'getComputedStyle', 'matchMedia', 'crypto', 'performance',
  'alert', 'confirm', 'prompt', 'atob', 'btoa', 'queueMicrotask',
  'Function', 'ArrayBuffer', 'Uint8Array', 'Int8Array', 'Float32Array',
  'Float64Array', 'DataView', 'BigInt',
  'NDEFReader', 'indexedDB',
  'supabase', // third-party CDN global (@supabase/supabase-js UMD build)
]);

function getOrderedScriptElements(html) {
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  const elements = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const srcMatch = /\bsrc=["']([^"']+)["']/.exec(attrs);
    if (srcMatch) elements.push({ type: 'external', src: srcMatch[1] });
    else if (m[2].trim().length > 0) elements.push({ type: 'inline', code: m[2] });
  }
  return elements;
}

// Analyze one source unit's code, returning:
//   declares: Set<string>              — every name reachable as a global today
//   declareKinds: Map<string,'fatal'|'reassign'>  — 'fatal' = top-level const/let/class
//   explicitWindowExports: Set<string> — subset of `declares` that has a real
//                                        `window.X = ...` assignment somewhere
//                                        in this unit (found via, not just
//                                        assumed from, the source text)
//   references: Set<string>            — genuinely free references (real
//                                        scope analysis, not regex)
function analyzeUnit(code) {
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'script', ranges: true, locations: true, allowReturnOutsideFunction: false });
  } catch (err) {
    return { declares: new Set(), astDeclares: new Set(), declareKinds: new Map(), explicitWindowExports: new Set(), references: new Set(), parseError: `${err.message}` };
  }

  const declares = new Set();
  const astDeclares = new Set(); // ONLY real AST-level top-level declarations —
    // does NOT include names added via the window.X= regex below. This
    // distinction matters: `window.mailGetForStudent = mailGetForStudent;`
    // adds `mailGetForStudent` to `declares` (this file DOES provide it to
    // others via window), but the identifier on the RIGHT side of that
    // assignment is a genuine reference that still needs to resolve to
    // wherever it's REALLY declared (often a different file — e.g. an
    // "index.js" aggregator file exporting symbols declared in sibling
    // files, a pattern used throughout this codebase's module structure).
    // Session 8 found this the hard way: mail/index.js's own regex-added
    // `declares` entry for `mailGetForStudent` was incorrectly treated as
    // "already locally satisfied," silently discarding the real
    // dependency on mail-engine.js and letting a real esbuild bundle ship
    // with a broken cross-file reference undetected by session 7's audit.
  const declareKinds = new Map();

  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && node.id) {
      declares.add(node.id.name);
      astDeclares.add(node.id.name);
      declareKinds.set(node.id.name, 'reassign');
    } else if (node.type === 'ClassDeclaration' && node.id) {
      declares.add(node.id.name);
      astDeclares.add(node.id.name);
      declareKinds.set(node.id.name, 'fatal');
    } else if (node.type === 'VariableDeclaration') {
      const kind = node.kind === 'var' ? 'reassign' : 'fatal';
      for (const decl of node.declarations) {
        if (decl.id && decl.id.type === 'Identifier') {
          declares.add(decl.id.name);
          astDeclares.add(decl.id.name);
          declareKinds.set(decl.id.name, kind);
        }
      }
    }
  }

  const explicitWindowExports = new Set(); // window.X = <anything>
  const windowAssignments = []; // collected first, resolved after scope analysis below

  walk.simple(ast, {
    AssignmentExpression(node) {
      if (
        node.left.type === 'MemberExpression' &&
        !node.left.computed &&
        node.left.object.type === 'Identifier' &&
        node.left.object.name === 'window' &&
        node.left.property.type === 'Identifier' &&
        node.operator === '='
      ) {
        const name = node.left.property.name;
        explicitWindowExports.add(name);
        declares.add(name);
        if (!declareKinds.has(name)) declareKinds.set(name, 'reassign');
        windowAssignments.push({ name, rhsIsIdentifier: node.right.type === 'Identifier', rhsName: node.right.type === 'Identifier' ? node.right.name : null });
      }
    },
  });

  const scopeManager = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'script', optimistic: false, ignoreEval: true });
  const globalScope = scopeManager.globalScope;
  const references = new Set();
  for (const ref of globalScope.through) {
    if (ref.identifier && ref.identifier.name) references.add(ref.identifier.name);
  }

  // Now resolve each window.X = ... assignment's astDeclares membership,
  // using the REAL free-reference set computed above — not textual
  // nesting depth. `window.X = {...}/function(){...}/other expressions`
  // is always self-contained (X originates here). `window.X = Y` (bare
  // identifier) is self-contained ONLY if Y is NOT a free reference in
  // this file — i.e. Y resolves locally (whether at true top level or
  // nested inside a wrapping IIFE, which eslint-scope already handles
  // correctly regardless of nesting). If Y IS free, X is a genuine
  // cross-file pointer (the mail/index.js -> mail-engine.js pattern) and
  // must NOT be treated as self-satisfying — session 8's root-cause
  // finding, refined further after the "renderStatBar inside a same-file
  // IIFE" false-positive this same session (a window.X = X pattern where
  // X is declared in an enclosing IIFE, not Program-top-level, but still
  // genuinely locally resolvable — textual nesting isn't the right test).
  for (const { name, rhsIsIdentifier, rhsName } of windowAssignments) {
    if (!rhsIsIdentifier || !references.has(rhsName)) {
      astDeclares.add(name);
    }
  }

  return { declares, astDeclares, declareKinds, explicitWindowExports, references, parseError: null };
}

// Loads and analyzes every source unit (external files + index.html's
// inline <script> blocks) in real document order. Returns an array of
// { label, kind: 'external'|'inline', ...analyzeUnit() result }.
function analyzeAllUnits(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const elements = getOrderedScriptElements(html).filter((e) => e.type === 'inline' || e.src.startsWith('./'));

  const units = [];
  let inlineIdx = 0;
  for (const el of elements) {
    if (el.type === 'external') {
      const rel = el.src.replace(/^\.\//, '');
      const code = fs.readFileSync(path.join(root, rel), 'utf8');
      units.push({ label: rel, kind: 'external', ...analyzeUnit(code) });
    } else {
      const label = `index.html#inline${inlineIdx}`;
      units.push({ label, kind: 'inline', ...analyzeUnit(el.code) });
      inlineIdx++;
    }
  }
  return units;
}

module.exports = { AMBIENT_GLOBALS, getOrderedScriptElements, analyzeUnit, analyzeAllUnits };
