const fs = require('fs');
const path = require('path');

function walk(dir, exts, exclude) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (exclude.some((e) => full.includes(e))) continue;
    if (entry.isDirectory()) out = out.concat(walk(full, exts, exclude));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

const exclude = ['node_modules', '/dist', '/tests', '/.git'];
const files = walk('.', ['.js', '.html'], exclude);

const handlerRe = /on(?:click|change|submit|input|keydown|keyup)="([a-zA-Z_][a-zA-Z0-9_]*)\(/g;
const nameSet = new Set();
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = handlerRe.exec(txt))) nameSet.add(m[1]);
}

// Build one combined haystack search: for each name check literal "window.NAME ="
// (allow optional whitespace) across all source files.
const allSrc = files.map((f) => ({ f, txt: fs.readFileSync(f, 'utf8') }));

const atRisk = [];
const safe = [];
for (const name of nameSet) {
  const assignRe = new RegExp('window\\.' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=');
  const found = allSrc.some(({ txt }) => assignRe.test(txt));
  if (found) safe.push(name);
  else atRisk.push(name);
}

console.log('distinct inline-handler function names:', nameSet.size);
console.log('confirmed explicit window.X = assignment:', safe.length);
console.log('NO explicit window.X = anywhere (bare declaration, relies on implicit global):', atRisk.length);
console.log('---sample safe---', safe.slice(0, 5));
console.log('---at risk---');
console.log(atRisk.sort());
fs.writeFileSync('.at-risk-globals.json', JSON.stringify(atRisk.sort(), null, 2));
