(function () {
  'use strict';

  const parserUrl = new URL('./assets/vendor/roster-xlsx.mjs', document.baseURI).href;
  const maxRows = 100;
  const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  const header = value => clean(value).toLowerCase().replace(/[_-]/g, ' ');
  const nameHeaders = ['name', 'full name', 'student name', 'student full name', 'display name', 'learner name'];
  const statuses = {
    ready: 'Ready',
    duplicate: 'Same name appears in this file',
    invalid: 'Check the name in this row',
    created: 'Account created',
    existing: 'Matching student already enrolled',
    pending: 'A different import already started this row',
    retry: 'Could not confirm. Retry this row.',
    forbidden: 'You no longer have access to this section',
    conflict: 'Account enrollment needs administrator review',
    limit: 'Daily import limit reached. Retry after 24 hours.',
  };

  function parseCsv(input) {
    const rows = [];
    let fields = [], field = '', quoted = false, closed = false;
    const text = input.replace(/^\uFEFF/, '');
    const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === delimiter || char === '\n' || char === '\r') {
        fields.push(field);
        field = '';
        closed = false;
        if (char !== delimiter) {
          rows.push(fields);
          fields = [];
          if (char === '\r' && text[i + 1] === '\n') i++;
        }
      } else if (char === '"' && !field && !closed) {
        quoted = true;
      } else {
        if (closed || char === '"') throw new Error('The CSV contains an invalid quoted cell.');
        field += char;
      }
    }
    if (quoted) throw new Error('A quoted cell is missing its closing quote.');
    rows.push([...fields, field]);
    return rows;
  }

  function readNames(rows) {
    const start = rows.findIndex(row => row.some(value => value != null && String(value).trim()));
    if (start < 0) throw new Error('The first sheet is empty.');
    const headers = rows[start].map(header);
    const full = headers.findIndex(value => nameHeaders.includes(value));
    const first = headers.findIndex(value => ['first name', 'given name'].includes(value));
    const last = headers.findIndex(value => ['last name', 'surname', 'family name'].includes(value));
    const hasHeader = full >= 0 || (first >= 0 && last >= 0);
    const result = [];
    const counts = new Map();
    for (let i = start + Number(hasHeader); i < rows.length; i++) {
      const row = rows[i];
      if (!row.some(value => value != null && String(value).trim())) continue;
      const name = full >= 0 ? clean(row[full]) : hasHeader
        ? [clean(row[first]), clean(row[last])].filter(Boolean).join(' ')
        : clean(row[0]);
      const valid = name.length >= 2 && name.length <= 120 && /\p{L}/u.test(name)
        && !/[<>"`=&;{}()/\\\p{C}]/u.test(name);
      const key = name.toLowerCase();
      if (valid) counts.set(key, (counts.get(key) || 0) + 1);
      result.push({ name, key, row: i + 1, status: valid ? 'ready' : 'invalid' });
      if (result.length > maxRows) throw new Error('Import up to 100 rows at a time. Split this roster into smaller files.');
    }
    if (!result.length) throw new Error('No student names were found.');
    for (const row of result) if (counts.get(row.key) > 1) row.status = 'duplicate';
    return result;
  }

  async function read(file) {
    if (!file || file.size > 1024 * 1024) throw new Error('Choose a roster file up to 1 MB.');
    if (/\.csv$/i.test(file.name)) return readNames(parseCsv(await file.text()));
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose an .xlsx or .csv file. Save older .xls workbooks as .xlsx first.');
    try {
      const { default: readSheet } = await import(parserUrl);
      return readNames(await readSheet(file));
    } catch (error) {
      if (error instanceof Error && /No student|sheet is empty|up to 100/.test(error.message)) throw error;
      throw new Error('Could not read the first Excel sheet. Check the workbook or export it as CSV.');
    }
  }

  function makeCredential(row) {
    if (row.attempt) return;
    row.attempt = crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    row.password = 'Aa7!' + Array.from(bytes, byte => alphabet[byte & 31]).join('');
  }

  function csvCell(value) {
    const text = String(value);
    return '"' + (/^\s*[=+\-@]/u.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"';
  }

  function download(rows) {
    const csv = [['Student name', 'Student login', 'Starter password'], ...rows.map(row => [row.name, row.login, row.password])]
      .map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'section-starter-logins.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open(sectionId, initialRows = []) {
    const section = SectionService.getSection(sectionId);
    if (!section || section.archived) return;
    const owner = currentUser?.id;
    const dialog = document.createElement('dialog');
    dialog.className = 'roster-import-dialog';
    dialog.setAttribute('aria-labelledby', 'roster-import-title');
    dialog.innerHTML = `
      <h2 id="roster-import-title">Import student roster</h2>
      <p class="roster-section"></p>
      <label class="form-label">Choose an Excel or CSV roster
        <input type="file" accept=".xlsx,.csv">
      </label>
      <p>Use a Name column, First Name and Last Name columns, or put one full name per row in column A of the first sheet. Up to 100 rows.</p>
      <p class="roster-status" role="status" aria-live="polite"></p>
      <div class="roster-list" tabindex="0" aria-label="Roster preview"></div>
      <div class="roster-actions">
        <button type="button" class="btn btn-primary" data-action="import" disabled>Create accounts</button>
        <button type="button" class="btn btn-ghost" data-action="download" hidden>Download starter logins</button>
        <button type="button" class="btn btn-ghost" data-action="close">Close</button>
      </div>`;
    const fileInput = dialog.querySelector('input');
    const list = dialog.querySelector('.roster-list');
    const status = dialog.querySelector('.roster-status');
    const button = action => dialog.querySelector('[data-action="' + action + '"]');
    let rows = initialRows, busy = false, started = false, downloaded = false;
    const ready = () => rows.filter(row => ['ready', 'retry', 'limit'].includes(row.status));
    const created = () => rows.filter(row => row.status === 'created');
    dialog.querySelector('.roster-section').textContent = section.sectionName;

    function paint() {
      list.replaceChildren(...rows.map(row => {
        const item = document.createElement('div');
        const name = document.createElement('strong');
        const result = document.createElement('small');
        name.textContent = row.name || 'Row ' + row.row;
        result.textContent = statuses[row.status] || statuses.retry;
        item.append(name, result);
        return item;
      }));
      fileInput.disabled = busy || started;
      button('close').disabled = busy;
      button('import').disabled = busy || !ready().length;
      button('import').textContent = (started ? 'Retry ' : 'Create ') + (ready().length || '') + ' accounts';
      button('download').hidden = !created().length;
      button('download').disabled = busy;
    }

    async function load() {
      if (!fileInput.files[0]) return;
      busy = true;
      rows = [];
      paint();
      status.textContent = 'Reading roster…';
      try {
        rows = await read(fileInput.files[0]);
        status.textContent = 'Review the names before creating accounts. Flagged rows will be skipped.';
      } catch (error) { status.textContent = error.message; }
      finally { busy = false; paint(); }
    }

    async function provision() {
      const client = DBService.getAuthClient();
      if (!client?.functions || currentUser?.id !== owner) {
        status.textContent = 'Sign in again before importing.';
        return;
      }
      busy = started = true;
      const queue = ready();
      paint();
      try {
        for (let i = 0; i < queue.length; i++) {
          if (currentUser?.id !== owner) break;
          const row = queue[i];
          makeCredential(row);
          status.textContent = 'Processing ' + (i + 1) + ' of ' + queue.length + '…';
          let result;
          try {
            result = await client.functions.invoke('import-section-roster', {
              body: { section: sectionId, name: row.name, attempt: row.attempt, password: row.password },
            });
            if (result.error?.context?.json) result.data = await result.error.context.json();
          } catch { result = {}; }
          const outcome = result.data?.status;
          row.status = Object.hasOwn(statuses, outcome) && !['ready', 'duplicate'].includes(outcome) ? outcome : 'retry';
          if (row.status === 'created' && typeof result.data.login === 'string') {
            row.login = result.data.login.replace(/@students\.graderaid\.example$/, '');
            downloaded = false;
          } else if (row.status === 'created') {
            row.status = 'retry';
          }
          paint();
          // Stop on infrastructure or permission errors to avoid spending a
          // whole batch on a missing deployment or a restricted project.
          if (['retry', 'forbidden', 'limit'].includes(row.status)) break;
        }
        status.textContent = created().length + ' accounts created. ' +
          (created().length ? 'Download the starter logins now and share them privately. ' : '') +
          (ready().length ? 'You can retry the remaining rows here. ' : '') +
          (rows.some(row => row.status === 'forbidden') ? 'Your access to this section changed. ' : '') +
          (rows.some(row => row.status === 'limit') ? 'You reached the daily limit. ' : '') +
          (rows.some(row => row.status === 'retry') ? 'Check that the roster function and SQL migration are deployed and the connection is available.' : '');
      } finally {
        if (created().length && currentUser?.id === owner) DBService.refreshStudentRoster?.();
        busy = false;
        paint();
      }
    }

    function askClose() {
      if (busy) return;
      if (created().length && !downloaded && !confirm('Close without downloading the starter logins? These passwords will not be shown again.')) return;
      if (rows.some(row => row.status === 'retry') && !confirm('Close with an unconfirmed account? Keep this window open to retry safely.')) return;
      dialog.close();
    }

    dialog.addEventListener('cancel', event => { event.preventDefault(); askClose(); });
    dialog.addEventListener('close', () => { rows = []; dialog.remove(); }, { once: true });
    fileInput.addEventListener('change', load);
    button('close').addEventListener('click', askClose);
    button('import').addEventListener('click', provision);
    button('download').addEventListener('click', () => {
      if (currentUser?.id !== owner) return;
      download(created());
      downloaded = true;
    });
    document.body.append(dialog);
    paint();
    dialog.showModal();
    if (rows.length) status.textContent = 'Review the names before creating accounts.';
  }

  window.SectionRosterImport = { open, read };
})();
