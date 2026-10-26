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
  function decorateMaterial(el) {
    if (!el?.matches('.material-symbols-outlined') || el.children.length || el.closest(art)) return;
    const name = el.textContent.trim();
    if (!/^[a-z0-9_]+$/.test(name)) return;
    el.innerHTML = uiIcon(material[name] || 'settings');
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
