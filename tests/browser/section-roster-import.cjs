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
    await page.getByRole('textbox', { name: 'Row 2 student name' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Row 2 student name' }).inputValue(), 'Alex Reyes');
    assert.equal(await page.evaluate(() => requests.length), 0, 'Preview cannot create accounts');
    await page.getByRole('button', { name: 'Create 2 accounts' }).click();
    await page.getByRole('button', { name: 'Resume 2 accounts' }).waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.evaluate(() => SectionRosterImport.open('room'));
    await page.getByRole('button', { name: 'Resume 2 accounts' }).click();
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
    await page.evaluate(() => SectionRosterImport.open('room'));
    await page.locator('input[type=file]').setInputFiles({
      name: 'teacher.csv', mimeType: 'text/csv',
      buffer: Buffer.from('Room 1 roster\nNo.;Pupil\n1;Toni Tan\n2;Toni Tan\n3;Lia Santos\n'),
    });
    await page.getByRole('textbox', { name: 'Row 3 student name' }).waitFor();
    await page.getByText('Spreadsheet options').click();
    await page.locator('[data-field=start]').fill('3');
    await page.locator('[data-field=full]').selectOption('1');
    await page.getByRole('button', { name: 'Update preview' }).click();
    await page.getByText('Same name appears in this file').first().waitFor();
    await page.getByRole('checkbox', { name: 'Include row 4' }).uncheck();
    await page.getByRole('textbox', { name: 'Row 3 student name' }).fill('Toni Marie Tan');
    await page.getByRole('button', { name: 'Create 2 accounts' }).waitFor();
    assert.equal(await page.evaluate(() => requests.length), 3, 'Editing and remapping the preview makes no API writes');
    await page.getByRole('button', { name: 'Close' }).click();
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
    await page.setViewportSize({ width: 360, height: 760 });
    await page.addStyleTag({ content: fs.readFileSync('styles/modules/sections.css', 'utf8') });
    await page.addStyleTag({ content: fs.readFileSync('styles/modules/section-roster-import.css', 'utf8') });
    await page.evaluate(() => {
      document.body.innerHTML = '<main id="a-sections"></main><div id="modal-overlay" style="display:none"><div id="modal-content"></div></div>';
      currentUser = { id: 'teacher', name: 'Morgan Lee' };
      window.currentRole = 'teacher';
      window._esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      window._cssColor = () => '#64748b';
      window.showModal = content => {
        document.getElementById('modal-content').innerHTML = content;
        document.getElementById('modal-overlay').style.display = 'flex';
      };
      window.closeModalForce = () => { document.getElementById('modal-overlay').style.display = 'none'; };
      window.state = { classSections: [
        { id: 'room', gradeLevel: '7', sectionName: 'Rizal', adviserId: 'teacher', archived: false },
        { id: 'old', gradeLevel: '8', sectionName: 'Mabini', adviserId: 'teacher', archived: true },
        { id: 'unrelated', gradeLevel: '7', sectionName: 'Other class', adviserId: 'someone-else', archived: false },
      ], students: [] };
      window.AppStore = { getState: () => state, subscribe: (_, callback) => { window.sectionUpdate = callback; }, unsubscribe: () => {} };
      SectionService.getSection = id => state.classSections.find(section => section.id === id);
      SectionService.createSection = async (gradeLevel, sectionName) => {
        const section = { id: 'new-room', gradeLevel, sectionName, adviserId: 'teacher', archived: false };
        state.classSections.push(section);
        return { ok: true, section };
      };
    });
    await page.addScriptTag({ content: fs.readFileSync('modules/admin/sections.js', 'utf8') });
    await page.evaluate(() => renderSectionMaker());
    assert.equal(await page.getByText('Other class', { exact: true }).count(), 0);
    await page.getByRole('searchbox', { name: 'Search sections' }).fill('absent');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('combobox', { name: 'Status' }).selectOption('archived');
    await page.getByText('Mabini', { exact: true }).waitFor();
    assert.equal(await page.getByText('Rizal', { exact: true }).count(), 0);
    await page.evaluate(() => renderSectionMaker());
    assert.equal(await page.getByRole('combobox', { name: 'Status' }).inputValue(), 'archived');
    await page.getByRole('combobox', { name: 'Status' }).selectOption('active');
    await page.getByText('Manage section').click();
    await page.evaluate(() => sectionUpdate(state, { type: 'state:remote-sync' }));
    assert.equal(await page.locator('.sec-manage[open]').count(), 1);
    await page.getByRole('button', { name: 'View roster' }).click();
    await page.evaluate(() => {
      state.students.push({ classId: 'room', name: 'New Student' });
      sectionUpdate(state, { type: 'state:remote-sync' });
    });
    await page.locator('#sec-roster-grid').getByText('New Student').waitFor();
    await page.locator('#modal-content').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'New section' }).click();
    await page.locator('#sec-form-grade').selectOption('9');
    await page.locator('#sec-form-name').fill('Sampaguita');
    await page.locator('#sec-form-roster').setInputFiles({
      name: 'new-section.csv', mimeType: 'text/csv', buffer: Buffer.from('Full Name\nLia Santos\n'),
    });
    await page.getByRole('button', { name: 'Create Section', exact: true }).click();
    assert.equal(await page.locator('.roster-section').textContent(), 'Grade 9 · Sampaguita');
    await page.getByRole('button', { name: 'Create 1 account', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => {
      DBService.getAuthClient = () => ({ functions: { invoke: async () => ({
        error: { context: new Response('restricted', { status: 402 }) },
      }) } });
    });
    await page.getByRole('button', { name: 'Create 1 account', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Supabase restricted requests' }).waitFor();
    await page.locator('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Resume import' }).click();
    await page.getByRole('button', { name: 'Resume 1 account', exact: true }).waitFor();
    await page.evaluate(() => SectionRosterImport.clear());
    assert.equal(await page.locator('dialog[open]').count(), 0);
    console.log('PASS: real Excel parsing and preview, retry, duplicate skip, credential CSV, CSV validation, Auth password-update wiring, and mobile Sections workflows.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
