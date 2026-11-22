/* Full-screen authoring layout for forms that use the shared dialog lifecycle. */
(function () {
  'use strict';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
  const current = () => {
    const overlay = document.getElementById('modal-overlay');
    return overlay?.style.display === 'flex' ? overlay.querySelector('.creator-shell') : null;
  };
  let session;

  function section(key, title, description, fields) {
    return `<section class="creator-chapter" id="creator-${escape(key)}" data-creator-section="${escape(key)}" tabindex="-1">
      <header><h2>${escape(title)}</h2>${description ? `<p>${escape(description)}</p>` : ''}</header>
      <div class="creator-fields">${fields}</div>
    </section>`;
  }

  function signature(root, getDraft) {
    const values = [...root.querySelectorAll('.creator-editor :is(input,select,textarea):not([data-creator-derived])')].map(field => {
      if (field.type === 'file') return [...field.files].map(file => [file.name, file.size, file.lastModified]);
      if (['checkbox', 'radio'].includes(field.type)) return field.checked;
      if (field.multiple) return [...field.selectedOptions].map(option => option.value);
      return field.value;
    });
    return JSON.stringify([values, getDraft?.()]);
  }

  function paintSummary(root, read) {
    const summary = read?.();
    if (!summary) return;
    const block = root.querySelector('.creator-summary');
    const { title, subtitle, rows = [], note } = summary;
    const markup = `<h3>${escape(title)}</h3>${subtitle ? `<p>${escape(subtitle)}</p>` : ''}
      ${rows.length ? `<dl>${rows.map(([label, value]) =>
        `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` : ''}
      ${note ? `<p class="creator-summary-note">${escape(note)}</p>` : ''}`;
    if (block.dataset.markup === markup) return;
    block.dataset.markup = markup;
    block.innerHTML = markup;
  }

  function go(key, focus = true) {
    const root = current();
    const destination = root && [...root.querySelectorAll('[data-creator-section]')].find(chapter => chapter.dataset.creatorSection === key);
    if (!destination) return;
    if (focus) destination.focus({ preventScroll: true });
    destination.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  function dismiss() {
    const root = current();
    if (!root || session?.root !== root) return false;
    if (root.dataset.saving === 'true' || root.querySelector('.creator-footer :is([aria-busy="true"],[data-section-form-cancel]:disabled)')) return false;
    if (signature(root, session.getDraft) !== session.baseline && !confirm('Leave this editor? Changes since your last save will be discarded.')) return false;
    window.closeModalForce();
    root.remove();
    session = null;
    return true;
  }

  function open(options, fields) {
    const previous = current();
    const same = previous && session?.root === previous && session.key === options.key;
    const scroll = same ? previous.querySelector('.creator-scroll').scrollTop : 0;
    const navScroll = same ? previous.querySelector('.creator-nav').scrollLeft : 0;
    const focused = same && previous.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id;
    const focusIndex = focused ? [...previous.querySelectorAll('button,input,select,textarea')].indexOf(focused) : -1;
    const focusType = focused?.tagName;
    const baseline = same ? session.baseline : null;

    window.showModal(`<div class="creator-shell" data-creator-kind="${escape(options.kind)}">
      <header class="creator-heading">
        <div class="creator-heading-copy"><span>${escape(options.area)}</span><h1>${escape(options.title)}</h1></div>
        <button type="button" class="btn btn-ghost creator-exit" data-creator-close>Close editor</button>
      </header>
      <div class="creator-body">
        <nav class="creator-nav" aria-label="Editor sections"></nav>
        <div class="creator-scroll">
          <div class="creator-stage">
            <div class="creator-editor">${fields}</div>
            <aside class="creator-aside" aria-label="${escape(options.previewLabel || 'Preview and review')}">
              <section id="creator-review" data-creator-section="review" tabindex="-1">
                <h2>${escape(options.previewLabel || 'Review')}</h2><div class="creator-preview"></div><div class="creator-summary"></div>
              </section>
            </aside>
          </div>
        </div>
      </div>
      <footer class="creator-footer"><p>${escape(options.footer)}</p><div class="creator-actions"></div></footer>
    </div>`, 'creator-workspace');
    const root = current();
    if (!root) return;
    const editor = root.querySelector('.creator-editor');
    const actionBlock = editor.querySelector('[data-creator-actions]');
    if (actionBlock) root.querySelector('.creator-actions').append(actionBlock);
    if (options.preview) {
      const preview = editor.querySelector(options.preview);
      if (preview) root.querySelector('.creator-preview').append(preview);
    }

    const nav = root.querySelector('.creator-nav');
    const chapters = [...editor.querySelectorAll('[data-creator-section]'), root.querySelector('#creator-review')];
    for (const chapter of chapters) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'creator-jump';
      button.textContent = chapter.querySelector('h2').textContent;
      button.dataset.jump = chapter.dataset.creatorSection;
      button.addEventListener('click', () => go(button.dataset.jump));
      nav.append(button);
    }

    const scrollport = root.querySelector('.creator-scroll');
    const highlight = () => {
      const line = scrollport.getBoundingClientRect().top + 45;
      const atBottom = scrollport.scrollTop + scrollport.clientHeight >= scrollport.scrollHeight - 2;
      const inlineReview = getComputedStyle(root.querySelector('.creator-aside')).position === 'static';
      const scrollChapters = inlineReview ? chapters : chapters.slice(0, -1);
      const active = inlineReview && atBottom && scrollport.scrollTop > 0 ? chapters.at(-1)
        : scrollChapters.findLast(chapter => chapter.getBoundingClientRect().top <= line) || chapters[0];
      const selected = [...nav.children].find(button => button.dataset.jump === active.dataset.creatorSection);
      if (selected?.hasAttribute('aria-current')) return;
      for (const button of nav.children) button.toggleAttribute('aria-current', button === selected);
      selected?.setAttribute('aria-current', 'location');
      if (selected && nav.scrollWidth > nav.clientWidth) {
        const visible = nav.getBoundingClientRect();
        const tab = selected.getBoundingClientRect();
        if (tab.right > visible.right) nav.scrollLeft += tab.right - visible.right + 12;
        else if (tab.left < visible.left) nav.scrollLeft -= visible.left - tab.left + 12;
      }
    };
    const refresh = () => { if (current() === root) paintSummary(root, options.summary); };
    root.addEventListener('input', refresh);
    root.addEventListener('change', refresh);
    root.addEventListener('click', () => queueMicrotask(refresh));
    scrollport.addEventListener('scroll', highlight, { passive: true });
    for (const button of root.querySelectorAll('[data-creator-close]')) button.addEventListener('click', dismiss);

    session = { root, key: options.key, getDraft: options.getDraft, baseline: baseline ?? signature(root, options.getDraft), refresh };
    refresh();
    scrollport.scrollTop = scroll;
    nav.scrollLeft = navScroll;
    highlight();
    if (same && focused) {
      const byId = focusId && document.getElementById(focusId);
      const target = byId || root.querySelectorAll('button,input,select,textarea')[focusIndex];
      if (target?.tagName === focusType && root.contains(target)) target.focus({ preventScroll: true });
    }
    return root;
  }

  function setArtwork(source) {
    const preview = current()?.querySelector('.creator-preview');
    if (!preview || preview.dataset.art === source) return;
    preview.dataset.art = source || '';
    preview.replaceChildren();
    if (!source) return;
    const img = /^https?:\/\/|^data:image\/(?:png|jpe?g|webp|gif|avif);base64,|^\.\/assets\//i.test(source);
    const art = document.createElement(img ? 'img' : 'div');
    art.className = 'creator-boss-art';
    if (img) { art.src = source; art.alt = 'Boss artwork'; art.addEventListener('error', () => art.remove()); }
    else if (source.length <= 16) art.textContent = source;
    else return;
    preview.append(art);
  }

  function sectionChoices(id, sections, selected, change) {
    // ID and handler are provided only by the owning editor. Section labels
    // and values come from the database and must be escaped.
    return `<fieldset id="${escape(id)}" class="creator-checklist" onchange="${escape(change)}">
      <legend>Sections</legend>${sections.map(({ value, label }) =>
        `<label><input type="checkbox" value="${escape(value)}" ${selected.includes(value) ? 'checked' : ''}>${escape(label)}</label>`).join('')}
    </fieldset>`;
  }

  window.CreatorWorkspace = {
    open, section, go, dismiss, sectionChoices, setArtwork,
    refresh() { if (session && session.root === current()) session.refresh(); },
    isOpen: () => !!current(),
  };
})();
