const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const { zipSync, strToU8 } = require('fflate');

const spreadsheet = zipSync(Object.fromEntries(Object.entries({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Roster" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Alex Reyes</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Bea Cruz</t></is></c></row></sheetData></worksheet>',
}).map(([key, value]) => [key, strToU8(value)])));

(async () => {
  const source = fs.readFileSync('modules/admin/section-roster-import.js', 'utf8');
  const server = http.createServer((request, response) => {
    if (request.url === '/assets/vendor/roster-xlsx.mjs') {
      response.setHeader('Content-Type', 'text/javascript');
      return response.end(fs.readFileSync('assets/vendor/roster-xlsx.mjs'));
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Roster test</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      window.currentUser = { id: 'teacher' };
      window.SectionService = { getSection: () => ({ sectionName: 'Rizal' }) };
      window.requests = [];
      window.DBService = { getAuthClient: () => ({ functions: { invoke: async (name, { body }) => {
        requests.push(body);
        if (requests.length === 1) return { data: { status: 'retry' } };
        if (body.name === 'Bea Cruz') return { data: { status: 'existing' } };
        return { data: { status: 'created', login: 'student-fixture@students.graderaid.example' } };
      } } }) };
      SectionRosterImport.open('room');
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'class.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(spreadsheet) });
    await page.getByText('Alex Reyes', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => requests.length), 0, 'Preview cannot create accounts');
    await page.getByRole('button', { name: 'Create 2 accounts' }).click();
    await page.getByRole('button', { name: 'Retry 2 accounts' }).waitFor();
    await page.getByRole('button', { name: 'Retry 2 accounts' }).click();
    await page.getByText('Matching student already enrolled').waitFor();
    const requests = await page.evaluate(() => window.requests);
    assert.deepEqual(requests[0], requests[1], 'Retry retains the same credential attempt');
    assert.match(requests[0].password, /^Aa7![A-HJ-NP-Z2-9]{16}$/);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download starter logins' }).click();
    const file = await downloaded;
    const csv = fs.readFileSync(await file.path(), 'utf8');
    assert.match(csv, /Alex Reyes/);
    assert.doesNotMatch(csv, /@students/);
    assert.ok(csv.includes(requests[0].password));
    assert.doesNotMatch(csv, /Bea Cruz/);
    await page.getByRole('button', { name: 'Close' }).click();
    const rows = await page.evaluate(() => SectionRosterImport.read(new File([
      'Full Name\r\n"Reyes, Alex"\r\nBea Cruz\r\n bea  cruz \r\n<img>\r\n',
    ], 'class.csv')));
    assert.deepEqual(rows.map(row => row.status), ['ready', 'duplicate', 'duplicate', 'invalid']);
    const html = fs.readFileSync('index.html', 'utf8');
    const start = html.indexOf('async function savePassword()');
    const end = html.indexOf('/* ── Save: Email', start);
    await page.addScriptTag({ content: html.slice(start, end) });
    const passwordResult = await page.evaluate(async () => {
      document.body.innerHTML = '<p id="prof-pass-err"></p>' +
        '<input id="prof-cur-pass" value="StarterPassword"><input id="prof-new-pass" value="NewStudentPass">' +
        '<input id="prof-conf-pass" value="NewStudentPass"><button onclick="savePassword()">Save password</button>';
      window.currentUser = { id: 'student' };
      window.toast = () => {};
      window.DBService = { getAuthClient: () => ({ auth: {
        getUser: async () => ({ data: { user: { id: 'student', email: 'gr-fixture@students.graderaid.example' } } }),
      } }) };
      const events = [];
      window.supabase = { createClient: (_url, _key, options) => {
        events.push(options.auth.persistSession);
        return { auth: {
          signInWithPassword: async ({ email, password }) => {
            events.push([email, password]);
            return { error: { code: 'invalid_credentials' } };
          },
          updateUser: async () => { throw new Error('A rejected password must never reach the update'); },
        } };
      } };
      await savePassword();
      const denied = document.getElementById('prof-pass-err').textContent;
      window.supabase.createClient = () => ({ auth: {
        signInWithPassword: async () => ({ data: { user: { id: 'student' } } }),
        updateUser: async input => { events.push(input); return { data: {} }; },
        signOut: async input => { events.push(input); },
      } });
      await savePassword();
      return { denied, events, cleared: document.getElementById('prof-new-pass').value === '' };
    });
    assert.equal(passwordResult.denied, 'Current password is incorrect.');
    assert.deepEqual(passwordResult.events, [false, ['gr-fixture@students.graderaid.example', 'StarterPassword'],
      { password: 'NewStudentPass', current_password: 'StarterPassword' }, { scope: 'local' }]);
    assert.equal(passwordResult.cleared, true);
    console.log('PASS: real Excel parsing and preview, retry, duplicate skip, credential CSV, CSV validation, and real Auth password-update wiring.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
