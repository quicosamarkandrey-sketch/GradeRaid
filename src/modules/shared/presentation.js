import { uiIcon } from '../../dom.js';
/* Shared presentation for legacy renderers, across student and staff views.
   Emoji and palette changes affect rendered UI only, never stored records.
   New renderers can call refresh(root) directly; observation also covers older
   templates and asynchronous feeds without wrapping DOM or service APIs. */
;(function () {
  'use strict';
  const material = {
    "home": "home",
    "groups": "users",
    "group": "users",
    "person": "users",
    "person_add": "users",
    "badge": "users",
    "qr_code_scanner": "scan",
    "qr_code": "scan",
    "chair": "chair",
    "monitoring": "chart",
    "insights": "chart",
    "leaderboard": "chart",
    "bar_chart": "chart",
    "analytics": "chart",
    "inventory_2": "box",
    "backpack": "bag",
    "storefront": "bag",
    "shopping_cart": "bag",
    "point_of_sale": "coin",
    "monetization_on": "coin",
    "edit_note": "edit",
    "edit": "edit",
    "swords": "privilege",
    "local_fire_department": "flame",
    "smart_toy": "privilege",
    "emoji_events": "award",
    "military_tech": "award",
    "workspace_premium": "award",
    "campaign": "bell",
    "meeting_room": "door",
    "mail": "mail",
    "history": "clock",
    "history_edu": "book",
    "calendar_month": "calendar",
    "calendar_today": "calendar",
    "event_busy": "calendar",
    "event": "calendar",
    "tune": "settings",
    "settings": "settings",
    "redeem": "box",
    "travel_explore": "search",
    "theater_comedy": "users",
    "fact_check": "check",
    "monitor_heart": "chart",
    "menu": "menu",
    "logout": "logout",
    "notifications": "bell",
    "notifications_active": "bell",
    "record_voice_over": "mic",
    "mic": "mic",
    "grid_view": "box",
    "add_task": "check",
    "search": "search",
    "close": "close",
    "check": "check",
    "check_circle": "check",
    "done": "check",
    "verified": "check",
    "error": "warning",
    "warning": "warning",
    "info": "info",
    "lock": "lock",
    "lock_open": "lock",
    "add": "plus",
    "remove": "minus",
    "delete": "delete",
    "delete_forever": "delete",
    "save": "save",
    "visibility": "eye",
    "visibility_off": "eye",
    "arrow_forward": "arrow",
    "arrow_back": "back",
    "arrow_upward": "upload",
    "arrow_downward": "chevron-down",
    "chevron_right": "chevron",
    "chevron_left": "back",
    "expand_more": "chevron-down",
    "expand_less": "chevron-up",
    "keyboard_arrow_up": "chevron-up",
    "keyboard_arrow_down": "chevron-down",
    "refresh": "refresh",
    "sync": "refresh",
    "download": "chevron-down",
    "upload": "upload",
    "file_upload": "upload",
    "link": "link",
    "schedule": "clock",
    "timer": "clock",
    "bolt": "chart",
    "receipt_long": "book",
    "school": "book",
    "folder_managed": "box",
    "folder": "box",
    "content_copy": "book",
    "filter_list": "settings",
    "more_vert": "menu",
    "more_horiz": "menu",
    "print": "book",
    "play_arrow": "chevron",
    "pause": "menu",
    "star": "award",
    "star_outline": "award",
    "favorite": "award",
    "support_agent": "users",
    "person_remove": "users",
    "checklist": "check",
    "add_photo_alternate": "image",
    "admin_panel_settings": "privilege",
    "animation": "chevron",
    "auto_awesome": "award",
    "autorenew": "refresh",
    "broken_image": "image",
    "cancel": "close",
    "contactless": "scan",
    "explore": "search",
    "flag": "flag",
    "format_list_numbered": "book",
    "gpp_bad": "warning",
    "grain": "box",
    "image": "image",
    "image_not_supported": "image",
    "library_books": "book",
    "link_off": "link",
    "lock_reset": "lock",
    "menu_book": "book",
    "palette": "palette",
    "pending": "clock",
    "pending_actions": "clock",
    "people": "users",
    "pest_control": "privilege",
    "photo_camera": "camera",
    "play_circle": "chevron",
    "progress_activity": "refresh",
    "quiz": "book",
    "radar": "scan",
    "radio_button_unchecked": "circle",
    "replay": "refresh",
    "sell": "box",
    "send": "arrow",
    "share": "link",
    "shield": "privilege",
    "social_leaderboard": "chart",
    "stop": "stop",
    "table_chart": "box",
    "tag": "box",
    "tips_and_updates": "info",
    "upload_file": "upload",
    "view_list": "menu",
    "wb_sunny": "circle"
};
  const skip = 'script,style,textarea,input,select,option,svg,canvas,code,pre,[contenteditable], [data-user-content],.mail-body,.message-body,.quiz-q-text,.quest-desc,.store-desc,.student-name,.teacher-name,.lb-name,.dash-hero-name,.mascot-dialogue,[class*="-name"],[class*="-desc"],[class*="-note"],[class*="-message"]';
  const art = '.bsed-stage,.bsed-stage-art,.cbl-boss-core,.boss-art,.boss-sprite,.bs-animation-stage,[data-preserve-art]';
  const palette = new Map([
    ['208,188,255','200,200,200'],['139,92,246','147,147,147'],['109,40,217','120,120,120'],['124,58,237','147,147,147'],
    ['78,222,163','178,178,178'],['255,185,95','170,170,170'],['255,209,102','170,170,170'],['255,215,0','170,170,170'],
    ['35,31,56','28,28,28'],['26,20,56','26,26,26'],['42,40,54','39,39,39'],['19,18,30','19,19,19']
  ]);
  const hex = {
    "#d0bcff": "#eeeeee",
    "#8b5cf6": "#bdbdbd",
    "#6d28d9": "#787878",
    "#7c3aed": "#939393",
    "#4edea3": "#81b895",
    "#ffb95f": "#d7b16b",
    "#ffd166": "#d7b16b",
    "#ffd700": "#d7b16b",
    "#231f38": "#1c1c1c",
    "#1a1438": "#1a1a1a",
    "#2a2836": "#272727",
    "#13121e": "#131313",
    "#0f0d1f": "#121212",
    "#0e0d19": "#121212",
    "#0f172a": "#1e1e1e",
    "#1e293b": "#2a2a2a",
    "#22d3ee": "#8caee0",
    "#06b6d4": "#8caee0",
    "#38bdf8": "#8caee0",
    "#10b981": "#81b895",
    "#f97316": "#d7b16b",
    "#fb923c": "#d7b16b",
    "#ec4899": "#9e9e9e",
    "#3b82f6": "#8caee0",
    "#60a5fa": "#8caee0",
    "#93c5fd": "#8caee0",
    "#ef4444": "#e09393",
    "#c2c8c1": "#81b895",
    "#ffb4ab": "#e09393",
    "#d99b98": "#e09393",
    "#cbc7be": "#d7b16b",
    "#ccc8be": "#d7b16b"
};
  // CSSOM serializes most hex colors as rgb(), so cover both spellings.
  const triplet = value => [1,3,5].map(index=>parseInt(value.slice(index,index+2),16)).join(',');
  for (const [before,after] of Object.entries(hex)) palette.set(triplet(before),triplet(after));
  function neutralize(value) {
    if (/url\(/i.test(value)) return value; // uploaded artwork and SVG data URLs
    const normalized = value.replace(/(#[\da-f]{6})([\da-f]{2})?\b/gi, (value,base,alpha) => {
      return hex[base.toLowerCase()] ? hex[base.toLowerCase()]+(alpha || '') : value;
    })
      .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g, (v,r,g,b) => {
        const replacement = palette.get(`${r},${g},${b}`);
        return replacement ? v.slice(0,v.indexOf('(')+1)+replacement : v;
      });
    const semantic = new Map([['129,184,149','success'],['215,177,107','warning'],['224,147,147','danger'],['140,174,224','info']]);
    const semanticColor = (r,g,b,alpha) => {
      const name = semantic.get(`${r},${g},${b}`);
      if (!name) return null;
      return alpha === undefined ? `var(--${name})` : `color-mix(in srgb,var(--${name}) ${Number(alpha)*100}%,transparent)`;
    };
    const themed = normalized.replace(/#([\da-f]{6})([\da-f]{2})?\b/gi,(original,base,alpha)=>{
      const values = [0,2,4].map(i=>parseInt(base.slice(i,i+2),16));
      return semanticColor(...values,alpha === undefined ? undefined : parseInt(alpha,16)/255) || original;
    }).replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([.\d]+))?\s*\)/g,(original,r,g,b,a)=>semanticColor(r,g,b,a)||original);
    return tonalize(themed);
  }
  // Legacy renderers contain literal neutral colors. Give them reversible
  // tokens so both existing and newly rendered pages follow the chosen mode.
  const tones = new Map();
  let mode = 'dark';
  try { if (localStorage.getItem('eduquest-color-mode') === 'light') mode = 'light'; } catch {}
  function toneValue(shade) { return mode === 'light' ? 255 - shade : shade; }
  function tone(shade) {
    const key = '--ui-tone-' + shade;
    if (!tones.has(shade)) {
      tones.set(shade,key);
      document.documentElement.style.setProperty(key,String(toneValue(shade)));
    }
    return key;
  }
  function tonalize(value) {
    if (/url\(/i.test(value)) return value;
    const neutral = (r,g,b,a) => {
      if (+r !== +g || +g !== +b) return null;
      const token = `var(${tone(+r)})`;
      return `rgb(${token} ${token} ${token}${a === undefined ? '' : ' / '+a})`;
    };
    return value.replace(/#([\da-f]{3,8})\b/gi,(original,hex) => {
      if (![3,4,6,8].includes(hex.length)) return original;
      if (hex.length < 5) hex = [...hex].map(c=>c+c).join('');
      const rgb = [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
      return neutral(...rgb,hex.length===8 ? parseInt(hex.slice(6),16)/255 : undefined) || original;
    }).replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([.\d]+))?\s*\)/g,(original,r,g,b,a)=>neutral(r,g,b,a)||original);
  }
  function setMode(next, persist = true) {
    mode = next === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.colorMode = mode;
    for (const [shade,key] of tones) document.documentElement.style.setProperty(key,String(toneValue(shade)));
    const button = document.getElementById('color-mode-toggle');
    if (button) {
      button.textContent = mode === 'dark' ? '☀️' : '🌙';
      button.setAttribute('aria-label', 'Switch to ' + (mode === 'dark' ? 'light' : 'dark') + ' mode');
      button.title = button.getAttribute('aria-label');
      button.setAttribute('aria-pressed',String(mode === 'light'));
    }
    if (persist) try { localStorage.setItem('eduquest-color-mode',mode); } catch {}
  }
  document.getElementById('color-mode-toggle')?.addEventListener('click',()=>setMode(mode === 'dark' ? 'light' : 'dark'));
  setMode(mode,false);
  window.UITheme = Object.freeze({setMode,getMode:()=>mode});
  // Sidebar navigation keeps the previous local line icons; other UI keeps emoji.
function sidebarIcon(name) {
  const paths = {
    "users": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4",
    "book": "M4 4h7l1 2 1-2h7v15h-7l-1 2-1-2H4V4Z M12 6v15",
    "bag": "M6 7h12l1 14H5L6 7Z M9 7V5a3 3 0 0 1 6 0v2",
    "box": "M3 7l9-4 9 4v10l-9 4-9-4V7Z M3 7l9 4 9-4 M12 11v10 M7 5l10 4",
    "award": "M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z M8 14l-2 7 6-3 6 3-2-7",
    "calendar": "M3 5h18v16H3V5Z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M13 14h4",
    "mic": "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
    "chart": "M4 20V10h4v10 M10 20V4h4v16 M16 20v-7h4v7",
    "flame": "M12 3c1 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 3 5 2-3 2-6 0-10Z",
    "check": "M5 12l4 4L19 6",
    "food": "M4 3v6a3 3 0 0 0 6 0V3 M7 3v18 M19 3c-4 2-4 8 0 8v10 M19 3v8",
    "privilege": "M12 3l8 4v6c0 4-8 8-8 8s-8-4-8-8V7l8-4Z M8 12l3 3 5-6",
    "mystery": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2 M12 17h.01",
    "close": "M6 6l12 12 M6 18L18 6",
    "mail": "M3 5h18v14H3V5Z M3 5l9 8 9-8",
    "coin": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9 9h4a2 2 0 0 1 0 4h-2a2 2 0 0 0 0 4h4 M12 7v12",
    "lock": "M6 10h12v11H6V10Z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
    "warning": "M12 3l10 18H2L12 3Z M12 9v5 M12 17h.01",
    "chair": "M6 3h12v9H6V3Z M4 12h16v5H4v-5Z M6 17v5 M18 17v5",
    "door": "M5 22V3l13-2v21 M3 22h18 M14 12h.01",
    "settings": "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
    "home": "M3 10l9-7 9 7 M5 9v12h5v-7h4v7h5V9",
    "scan": "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M6 12h12 M8 8v8 M12 8v8 M16 8v8",
    "search": "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M15 15l6 6",
    "menu": "M3 6h18 M3 12h18 M3 18h18",
    "bell": "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Z M10 21h4",
    "arrow": "M4 12h16 M14 6l6 6-6 6",
    "back": "M20 12H4 M10 6l-6 6 6 6",
    "plus": "M12 4v16 M4 12h16",
    "minus": "M4 12h16",
    "edit": "M4 16L16 4l4 4L8 20H4v-4Z M14 6l4 4",
    "delete": "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
    "save": "M4 3h13l4 4v14H3V3h1Z M7 3v6h10V3 M7 21v-8h10v8",
    "eye": "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    "logout": "M9 3H3v18h6 M8 12h13 M16 7l5 5-5 5",
    "clock": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l4 2",
    "link": "M10 14l4-4 M8 16l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0",
    "upload": "M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5",
    "chevron": "M8 4l8 8-8 8",
    "chevron-down": "M4 8l8 8 8-8",
    "chevron-up": "M4 16l8-8 8 8",
    "refresh": "M20 7a9 9 0 1 0 1 9 M20 3v5h-5",
    "info": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v6 M12 7h.01",
    "image": "M3 3h18v18H3V3Z M3 17l5-5 4 4 3-3 6 6 M16 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
    "camera": "M3 7h4l2-3h6l2 3h4v14H3V7Z M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "palette": "M12 3a9 9 0 1 0 0 18h1c3 0 2-4 5-4 4 0 5-14-6-14Z M7 9h.01 M11 6h.01 M16 8h.01 M6 14h.01",
    "flag": "M5 22V3h14l-3 5 3 5H5",
    "circle": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    "stop": "M5 5h14v14H5V5Z"
};
  const aliases = { supplies: 'box', unknown: 'box' };
  const key = Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
  const path = Object.prototype.hasOwnProperty.call(paths, key) ? paths[key] : paths.box;
  return '<svg class="eq-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
}
  function decorateMaterial(el) {
    if (!el?.matches('.material-symbols-outlined') || el.children.length || el.closest(art)) return;
    const name = el.textContent.trim();
    if (!/^[a-z0-9_]+$/.test(name)) return;
    const icon = material[name] || 'settings';
    el.innerHTML = el.closest('#sidebar') ? sidebarIcon(icon) : uiIcon(icon);
    el.setAttribute('aria-hidden','true');
    const button = el.closest('button');
    if (button && !button.textContent.trim() && !button.hasAttribute('aria-label')) button.setAttribute('aria-label',button.title || name.replaceAll('_',' '));
  }
  function refresh(root) {
    if (!root || !document.documentElement.classList.contains('theme-nocturne')) return;
    if (root.nodeType === Node.TEXT_NODE) { decorateMaterial(root.parentElement);  return; }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(skip)) return;
    decorateMaterial(root);
    root.querySelectorAll('.material-symbols-outlined').forEach(decorateMaterial);
    const elements = [root,...root.querySelectorAll('[style]')];
    for (const el of elements) {
      if (el.closest(skip+','+art+',.cb-seat,.lm-seat,.cal-day,.cal-dot,[class*=avatar],[class*=photo],[class*=ts-badge],[class*=title-preview]')) continue;
      for (const property of ['color','background','background-color','border','border-color','border-left','border-right','border-top','border-bottom','box-shadow','text-shadow']) {
        const before = el.style.getPropertyValue(property);
        const after = /shadow/.test(property) ? before : neutralize(before);
        if (after !== before) el.style.setProperty(property,after,el.style.getPropertyPriority(property));
      }
    }

  }
  // Normalize legacy CSS declarations too, including styles injected later by
  // staff tools. CSSOM edits leave selectors, layout, stored palettes and media
  // untouched; custom badge/art rules and attendance states are excluded.
  const styled = new WeakSet();
  function stylesheet(sheet) {
    if (!sheet || styled.has(sheet) || sheet.ownerNode?.hasAttribute('data-preserve-theme')) return;
    let rules;
    try { rules = sheet.cssRules; } catch { return; } // cross-origin font sheet
    styled.add(sheet);
    function visit(list) {
      for (const rule of list) {
        if (/(?:ts-|title-preview|badge-preview|sprite|boss-art|stage-art|\.lm-seat|\.cb-seat|\.cal-dot)/.test(rule.selectorText || '')) continue;
        if (rule.style) {
          for (const property of ['color','background','background-color','border','border-color','box-shadow','text-shadow','--glow','--rc','--rg']) {
            const before = rule.style.getPropertyValue(property);
            let after = /shadow/.test(property) ? before : neutralize(before);
            if ((property === 'box-shadow' || property === 'text-shadow') && /^(?:0px|0) (?:0px|0) /.test(before) && after !== before) after = 'none';
            if (after !== before) rule.style.setProperty(property,after,rule.style.getPropertyPriority(property));
          }
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    }
    visit(rules);
  }
  for (const sheet of document.styleSheets) stylesheet(sheet);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.target.nodeName === 'STYLE') stylesheet(record.target.sheet);
      for (const node of record.addedNodes) if (node.nodeName === 'STYLE' || node.nodeName === 'LINK') stylesheet(node.sheet);
    }
  }).observe(document.head,{childList:true,subtree:true});
  const pending = new Set();
  let queued = false;
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') pending.add(record.target);
      else for (const node of record.addedNodes) if (node.nodeType === 1 || node.nodeType === 3) pending.add(node);
    }
    if (queued || !pending.size) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const roots = [...pending];pending.clear();
      for (const root of roots) if (root.isConnected && !roots.some(other=>other!==root && other.contains?.(root))) refresh(root);
    });
  });
  window.UIPresentation = Object.freeze({refresh});
  refresh(document.body);
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
}());
