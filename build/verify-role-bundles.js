// Phase 7 (2026-08-10, session 10) — real execution test for the two
// role-specific bundles (student, admin), same discipline as session 8's
// build/verify-full-bundle.js: evaluate against the REAL index.html body
// in jsdom, check for synchronous throws. This is the check that caught
// 3 real bugs in session 8 — a clean `node --check` alone proved nothing
// there, and there's no reason to trust it more here.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function extractBody(html) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/.exec(html);
  return m[1].replace(/<script[\s\S]*?<\/script>/g, '');
}

function runBuild(label, jsSource, bodyHtml) {
  console.log(`\n=== ${label} ===`);
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'dangerously',
    url: 'https://example.org/',
  });
  const win = dom.window;
  let threw = null;
  try {
    win.eval(jsSource);
  } catch (err) {
    threw = err;
  }
  if (threw) {
    console.log('THREW SYNCHRONOUSLY:', threw.message);
    console.log(threw.stack.split('\n').slice(0, 6).join('\n'));
  } else {
    console.log('Evaluated without throwing synchronously.');
  }
  return { win, threw };
}

function main() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const bodyHtml = extractBody(html);

  const studentSrc = fs.readFileSync(path.join(ROOT, 'dist', 'app.student-bundle.js'), 'utf8');
  const adminSrc = fs.readFileSync(path.join(ROOT, 'dist', 'app.admin-bundle.js'), 'utf8');

  const student = runBuild('STUDENT BUNDLE', studentSrc, bodyHtml);
  const admin = runBuild('ADMIN BUNDLE', adminSrc, bodyHtml);

  console.log('\n=== SUMMARY ===');
  console.log('Student bundle threw:', !!student.threw);
  console.log('Admin bundle threw:', !!admin.threw);
  process.exit(0);
}

main();
