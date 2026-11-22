(function () {
  'use strict';

  const parserUrl = new URL('./assets/vendor/roster-xlsx.mjs', document.baseURI).href;
  const maxRows = 100;
  const drafts = new Map();
  let draftOwner;
  const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  const nameKey = value => clean(value).toLowerCase();
  const header = value => clean(value).toLowerCase().replace(/[_-]/g, ' ');
  const nameHeaders = ['name', 'full name', 'student name', 'student full name', 'display name', 'learner name', 'learner full name', 'student', 'student names', 'name of student'];
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
    skipped: 'Excluded from this import',
    rate_limited: 'Supabase is busy. Wait briefly, then resume.',
    quota: 'Supabase restricted requests. Check the project billing status.',
    setup: 'Roster import needs to be activated in Supabase.',
    auth: 'Session expired. Sign in again before continuing.',
  };

  function parseCsv(input) {
    const rows = [];
    let fields = [], field = '', quoted = false, closed = false;
    const text = input.replace(/^\uFEFF/, '');
    const sample = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 20)
      .map(line => line.replace(/"(?:[^"]|"")*"/g, ''));
    const candidates = [',', '\t', ';'];
    const score = separator => sample.filter(line => line.includes(separator)).length;
    const delimiter = candidates.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
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

  const hasCells = row => row.some(value => value != null && String(value).trim());
  const validName = name => name.length >= 2 && name.length <= 120 && /\p{L}/u.test(name)
    && !/[<>"`=&;{}()/\\\p{C}]/u.test(name);

  function columnName(index) {
    let label = '';
    for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) {
      label = String.fromCharCode(65 + (number - 1) % 26) + label;
    }
    return label;
  }

  function suggestMapping(cells) {
    const candidates = cells.slice(0, 25);
    for (let index = 0; index < candidates.length; index++) {
      const headers = candidates[index].map(header);
      const full = headers.findIndex(value => nameHeaders.includes(value));
      const first = headers.findIndex(value => ['first name', 'given name', 'given names'].includes(value));
      const last = headers.findIndex(value => ['last name', 'surname', 'family name'].includes(value));
      if (full >= 0) return { start: index + 2, full, last: -1 };
      if (first >= 0 && last >= 0) return { start: index + 2, full: first, last };
    }
    const first = cells.findIndex(hasCells);
    return { start: Math.max(1, first + 1), full: Math.max(0, cells[first]?.findIndex(value => clean(value)) ?? 0), last: -1 };
  }

  function selectRows(cells, mapping) {
    const result = [];
    for (let index = mapping.start - 1; index < cells.length; index++) {
      const row = cells[index];
      if (!hasCells(row)) continue;
      const name = [clean(row[mapping.full]), clean(row[mapping.last])].filter(Boolean).join(' ');
      result.push({ name, row: index + 1, status: 'ready' });
      if (result.length > maxRows) throw new Error('This selection has more than 100 rows. Split the class into smaller files.');
    }
    if (!result.length) throw new Error('No data rows were found for this selection.');
    checkRows(result);
    return result;
  }

  function checkRows(rows, existing = new Set()) {
    const counts = new Map();
    for (const row of rows) {
      row.name = clean(row.name);
      if (row.excluded || !validName(row.name)) continue;
      const key = nameKey(row.name);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const row of rows) {
      if (row.excluded) row.status = 'skipped';
      else if (!validName(row.name)) row.status = 'invalid';
      else if (existing.has(nameKey(row.name))) row.status = 'existing';
      else if (counts.get(nameKey(row.name)) > 1) row.status = 'duplicate';
      else row.status = 'ready';
    }
  }

  async function readCells(file, sheet = 1) {
    if (!file || file.size > 1024 * 1024) throw new Error('Choose a roster file up to 1 MB.');
    if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
    if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose an .xlsx or .csv file. Save older .xls workbooks as .xlsx first.');
    try {
      const { default: readSheet } = await import(parserUrl);
      return await readSheet(file, sheet);
    } catch {
      throw new Error('Could not open sheet ' + sheet + '. Check the sheet number or export that sheet as CSV.');
    }
  }

  async function read(file) {
    const cells = await readCells(file);
    return selectRows(cells, suggestMapping(cells));
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

  function downloadCsv(filename, rows) {
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const retryable = new Set(['ready', 'retry', 'limit', 'rate_limited', 'quota', 'setup', 'auth']);
  function protectDrafts(event) {
    if (draftOwner !== currentUser?.id) return;
    const hasUnconfirmedData = [...drafts.values()].some(draft =>
      draft.rows.filter(row => row.status === 'created').length > draft.downloadedCount ||
      draft.rows.some(row => row.attempt && retryable.has(row.status))
    );
    if (hasUnconfirmedData) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  function statusFrom(result) {
    const code = result.error?.context?.status;
    if (code === 402) return 'quota';
    if (code === 429) return 'rate_limited';
    if (code === 401) return 'auth';
    if (code === 404) return 'setup';
    const outcome = result.data?.status;
    return Object.hasOwn(statuses, outcome) && !['ready', 'duplicate', 'skipped'].includes(outcome) ? outcome : 'retry';
  }

  function open(sectionId, rosterFile) {
    const section = SectionService.getSection(sectionId);
    const owner = currentUser?.id;
    if (!owner || !section || section.archived || sectionId === 'default-class') return;
    if (draftOwner !== owner) { drafts.clear(); draftOwner = owner; }
    if (document.querySelector('.roster-import-dialog[open]')) return;
    const existing = new Set((window.AppStore?.getState?.()?.students || [])
      .filter(student => student.classId === sectionId)
      .map(student => nameKey(student.displayName || student.name)));
    const draft = drafts.get(sectionId) || { rows: [], started: false, downloadedCount: 0 };
    const dialog = document.createElement('dialog');
    dialog.className = 'roster-import-dialog';
    dialog.setAttribute('aria-labelledby', 'roster-import-title');
    dialog.innerHTML = `
      <header class="roster-heading">
        <h2 id="roster-import-title">Import student roster</h2>
        <p class="roster-section"></p>
      </header>
      <div class="roster-upload">
        <label class="form-label">Excel or CSV file <input type="file" accept=".xlsx,.csv"></label>
        <button type="button" class="btn btn-ghost btn-sm" data-action="template">Download template</button>
      </div>
      <p class="roster-filename" hidden></p>
      <details class="roster-mapping" hidden>
        <summary>Spreadsheet options</summary>
        <div class="roster-fields">
          <label class="roster-sheet">Excel sheet number <input data-field="sheet" type="number" min="1" max="99" value="1"></label>
          <label>First student row <input data-field="start" type="number" min="1" value="1"></label>
          <label>Full name or first name <select data-field="full"></select></label>
          <label>Last name (optional) <select data-field="last"></select></label>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="mapping">Update preview</button>
      </details>
      <p class="roster-status" role="status" aria-live="polite"></p>
      <p class="roster-counts"></p>
      <div class="roster-list" tabindex="0" aria-label="Roster preview"></div>
      <footer class="roster-actions">
        <button type="button" class="btn btn-primary" data-action="import" disabled>Create accounts</button>
        <button type="button" class="btn btn-ghost" data-action="pause" hidden>Pause after this row</button>
        <button type="button" class="btn btn-ghost" data-action="download" hidden>Download starter logins</button>
        <button type="button" class="btn btn-ghost" data-action="close">Close</button>
      </footer>`;

    const get = selector => dialog.querySelector(selector);
    const fileInput = get('input[type=file]');
    const list = get('.roster-list');
    const status = get('.roster-status');
    const counts = get('.roster-counts');
    const options = get('.roster-mapping');
    const button = action => get('[data-action="' + action + '"]');
    const field = key => get('[data-field="' + key + '"]');
    const ready = () => draft.rows.filter(row => retryable.has(row.status));
    const created = () => draft.rows.filter(row => row.status === 'created');
    let file, cells, loadedSheet, busy = false, paused = false, parsing = false;
    get('.roster-section').textContent = [section.gradeLevel && 'Grade ' + section.gradeLevel, section.sectionName].filter(Boolean).join(' · ');

    function paintControls() {
      const pending = ready().length;
      const done = created().length;
      const skipped = draft.rows.length - pending - done;
      counts.textContent = draft.rows.length ? `${pending} ${draft.started ? 'remaining' : 'ready'} · ${done} created · ${skipped} skipped or flagged` : '';
      fileInput.disabled = busy || parsing || draft.started;
      options.hidden = !file || draft.started;
      options.querySelectorAll('input,select,button').forEach(input => { input.disabled = parsing; });
      button('close').disabled = busy || parsing;
      button('pause').hidden = !busy;
      button('pause').disabled = paused;
      button('import').disabled = busy || parsing || !pending;
      button('import').textContent = pending
        ? `${draft.started ? 'Resume' : 'Create'} ${pending} account${pending === 1 ? '' : 's'}`
        : 'Create accounts';
      button('download').hidden = !done;
      button('download').disabled = busy;
    }

    function paintRow(row, item) {
      item.querySelector('small').textContent = statuses[row.status] || statuses.retry;
      item.dataset.status = row.status;
    }

    function paint() {
      list.replaceChildren(...draft.rows.map(row => {
        const item = document.createElement('div');
        const name = document.createElement('label');
        const result = document.createElement('small');
        const rowLabel = 'Row ' + row.row;
        if (draft.started) {
          name.textContent = rowLabel + ' · ' + (row.name || 'Unnamed');
        } else {
          name.append(rowLabel);
          const input = document.createElement('input');
          input.type = 'text';
          input.maxLength = 120;
          input.value = row.name;
          input.setAttribute('aria-label', rowLabel + ' student name');
          input.addEventListener('input', () => {
            row.name = input.value;
            checkRows(draft.rows, existing);
            Array.from(list.children).forEach((child, index) => paintRow(draft.rows[index], child));
            paintControls();
          });
          const include = document.createElement('input');
          include.type = 'checkbox';
          include.checked = !row.excluded;
          include.setAttribute('aria-label', 'Include ' + rowLabel.toLowerCase());
          include.addEventListener('change', () => {
            row.excluded = !include.checked;
            checkRows(draft.rows, existing);
            Array.from(list.children).forEach((child, index) => paintRow(draft.rows[index], child));
            paintControls();
          });
          name.append(input);
          item.append(include);
        }
        item.append(name, result);
        paintRow(row, item);
        return item;
      }));
      paintControls();
    }

    function setColumns(mapping) {
      const width = Math.min(256, cells.reduce((max, row) => Math.max(max, row.length), 1));
      const values = Array.from({ length: width }, (_, index) => {
        const caption = clean(cells[mapping.start - 2]?.[index]);
        return [index, 'Column ' + columnName(index) + (caption ? ' · ' + caption.slice(0, 45) : '')];
      });
      field('full').replaceChildren(...values.map(([key, label]) => new Option(label, key)));
      field('last').replaceChildren(new Option('None', -1), ...values.map(([key, label]) => new Option(label, key)));
      field('full').value = String(mapping.full < width ? mapping.full : 0);
      field('last').value = String(mapping.last < width ? mapping.last : -1);
      field('start').value = String(mapping.start);
    }

    async function preview(reset = false) {
      if (!file || draft.started || parsing) return;
      parsing = true;
      paintControls();
      status.textContent = 'Reading roster…';
      try {
        const sheet = Number(field('sheet').value);
        if (!Number.isInteger(sheet) || sheet < 1 || sheet > 99) throw new Error('Enter an Excel sheet number from 1 to 99.');
        if (reset || !cells || loadedSheet !== sheet) {
          cells = await readCells(file, sheet);
          loadedSheet = sheet;
          setColumns(suggestMapping(cells));
        }
        const mapping = { full: Number(field('full').value), last: Number(field('last').value), start: Number(field('start').value) };
        if (!Number.isInteger(mapping.start) || mapping.start < 1 || mapping.start > cells.length) throw new Error('Choose the row where student names begin.');
        if (mapping.full === mapping.last) throw new Error('Choose different first and last name columns.');
        draft.rows = selectRows(cells, mapping);
        checkRows(draft.rows, existing);
        status.textContent = 'Check the section and names. Edit names or clear the checkbox to skip a row.';
      } catch (error) {
        draft.rows = [];
        status.textContent = error.message;
        options.open = true;
      } finally { parsing = false; paint(); }
    }

    function chooseFile(next) {
      if (!next || parsing || draft.started) return;
      file = next;
      const filename = get('.roster-filename');
      filename.textContent = next.name;
      filename.hidden = false;
      cells = null;
      field('sheet').value = '1';
      get('.roster-sheet').hidden = !/\.xlsx$/i.test(next.name);
      preview(true);
    }

    async function provision() {
      const client = DBService.getAuthClient();
      if (busy || !ready().length) return;
      if (!client?.functions || currentUser?.id !== owner || !navigator.onLine) {
        status.textContent = 'Connect to the internet and sign in before importing.';
        return;
      }
      if (!draft.started) {
        checkRows(draft.rows, existing);
        if (!ready().length) { paint(); return; }
        draft.started = true;
        drafts.set(sectionId, draft);
        window.addEventListener('beforeunload', protectDrafts);
      }
      paused = false;
      busy = true;
      const queue = ready();
      paint();
      let stopped;
      try {
        for (let index = 0; index < queue.length; index++) {
          if (paused || drafts.get(sectionId) !== draft || currentUser?.id !== owner) break;
          const row = queue[index];
          makeCredential(row);
          status.textContent = `Processing ${index + 1} of ${queue.length}…`;
          let result;
          try {
            result = await client.functions.invoke('import-section-roster', {
              body: { section: sectionId, name: row.name, attempt: row.attempt, password: row.password },
              signal: AbortSignal.timeout?.(20000),
            });
            if (result.error?.context?.json) {
              try { result.data = await result.error.context.json(); } catch { /* Gateway errors may be plain text. */ }
            }
          } catch { result = {}; }
          if (drafts.get(sectionId) !== draft || currentUser?.id !== owner) break;
          row.status = statusFrom(result || {});
          if (row.status === 'created') {
            if (typeof result.data.login === 'string') row.login = result.data.login.replace(/@students\.graderaid\.example$/, '');
            else row.status = 'retry';
          }
          if (!retryable.has(row.status) && row.status !== 'created') delete row.password;
          paintRow(row, list.children[draft.rows.indexOf(row)]);
          paintControls();
          if (retryable.has(row.status) || row.status === 'forbidden') { stopped = row.status; break; }
        }
        if (paused) status.textContent = 'Import paused. Resume from here or reopen it from this section in this tab.';
        else if (stopped) status.textContent = statuses[stopped];
        else status.textContent = created().length
          ? 'Download the starter logins before refreshing or closing this tab. Share each student’s login privately.'
          : 'No new accounts were created. Review the result beside each name.';
      } finally {
        if (created().length && currentUser?.id === owner) DBService.refreshStudentRoster?.();
        busy = false;
        paintControls();
      }
    }

    function askClose() {
      if (busy || parsing) return;
      if (draft.started && !ready().length && draft.downloadedCount === created().length) {
        drafts.delete(sectionId);
        if (!drafts.size) window.removeEventListener('beforeunload', protectDrafts);
      } else if (draft.started && created().length > draft.downloadedCount) {
        if (!confirm('Starter logins are still available in this tab. Download them before refreshing the page or signing out. Close the import for now?')) return;
      }
      dialog.close();
    }

    dialog.addEventListener('cancel', event => { event.preventDefault(); askClose(); });
    dialog.addEventListener('close', () => {
      dialog.remove();
      window._secRenderList?.();
    }, { once: true });
    fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
    options.addEventListener('input', () => {
      if (draft.started || parsing) return;
      draft.rows = [];
      status.textContent = 'Select Update preview to apply the spreadsheet options.';
      paint();
    });
    button('mapping').addEventListener('click', () => preview());
    button('template').addEventListener('click', () => downloadCsv('student-roster-template.csv', [['Full Name']]));
    button('close').addEventListener('click', askClose);
    button('pause').addEventListener('click', () => { paused = true; paintControls(); });
    button('import').addEventListener('click', provision);
    button('download').addEventListener('click', () => {
      if (currentUser?.id !== owner) return;
      const filename = section.sectionName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'section';
      downloadCsv(filename + '-starter-logins.csv', [
        ['Student name', 'Student login', 'Starter password'],
        ...created().map(row => [row.name, row.login, row.password]),
      ]);
      draft.downloadedCount = created().length;
    });
    document.body.append(dialog);
    paint();
    dialog.showModal();
    if (draft.started) status.textContent = 'Resume this import or download confirmed logins. Closing or refreshing the browser tab clears this draft.';
    else if (rosterFile) chooseFile(rosterFile);
    else status.textContent = 'Choose a file or download the template. Up to 100 students per import.';
  }

  function hasDraft(sectionId) {
    return draftOwner === currentUser?.id && drafts.has(sectionId);
  }

  function clear() {
    drafts.clear();
    window.removeEventListener('beforeunload', protectDrafts);
    draftOwner = undefined;
    const dialog = document.querySelector('.roster-import-dialog[open]');
    dialog?.close();
  }

  window.SectionRosterImport = { open, read, hasDraft, clear };
})();
