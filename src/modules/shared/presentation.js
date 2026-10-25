import { uiIcon } from '../../dom.js';
/* Shared presentation for legacy renderers, across student and staff views.
   Icons and palette changes affect rendered UI only, never stored records.
   New renderers can call refresh(root) directly; observation also covers older
   templates and asynchronous feeds without wrapping DOM or service APIs. */
;(function () {
  'use strict';
  const aliases = {
    '👥':'users','👤':'users','🧑‍🏫':'users','👨‍🏫':'users','👩‍🏫':'users','🏫':'users',
    '📊':'chart','📈':'chart','📉':'chart','📋':'calendar','📅':'calendar','🗓️':'calendar','⏰':'calendar','🕐':'calendar',
    '🎯':'award','🏆':'award','🥇':'award','🥈':'award','🥉':'award','🏅':'award','🎖️':'award','👑':'award','⭐':'award','🌟':'award','✨':'award','💎':'award',
    '🔥':'flame','💀':'privilege','⚔️':'privilege','⚔':'privilege','🛡️':'privilege','⚡':'chart',
    '📦':'box','🎁':'box','🎒':'bag','🛍️':'bag','🛒':'bag','🏪':'bag','🍔':'food','🍕':'food','🍎':'food',
    '📚':'book','📖':'book','📝':'book','✏️':'edit','✉️':'mail','📬':'mail','📨':'mail','📩':'mail','💌':'mail',
    '🎤':'mic','✅':'check','✔️':'check','✓':'check','❌':'close','❎':'close','⚠️':'warning','🔒':'lock','🔓':'lock',
    '🗑':'delete','🗑️':'delete','🗄':'box','🗄️':'box','🔁':'refresh','🔍':'search','💾':'save','📷':'camera','🖼️':'image','⚙️':'settings','🔧':'settings','🪑':'chair','🚪':'door','🪟':'box','📡':'chart','🪙':'coin','💰':'coin'
  };
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
    ['208,188,255','228,198,140'],['139,92,246','173,145,93'],['109,40,217','145,117,70'],['124,58,237','173,145,93'],
    ['78,222,163','170,183,155'],['255,185,95','203,167,106'],['255,209,102','203,167,106'],['255,215,0','203,167,106'],
    ['35,31,56','27,29,23'],['26,20,56','24,27,19'],['42,40,54','37,41,30'],['19,18,30','18,19,16']
  ]);
  const hex = {'#d0bcff':'#e4c68c','#8b5cf6':'#ad915d','#6d28d9':'#917546','#7c3aed':'#ad915d','#4edea3':'#aab79b','#ffb95f':'#cba76a','#ffd166':'#cba76a','#ffd700':'#cba76a','#231f38':'#1b1d17','#1a1438':'#181b13','#2a2836':'#25291e','#13121e':'#121310','#0f0d1f':'#10130f','#0e0d19':'#10130e','#0f172a':'#182017','#1e293b':'#252c21','#22d3ee':'#aab79b','#06b6d4':'#aab79b','#38bdf8':'#aab79b','#10b981':'#aab79b','#f97316':'#cba76a','#fb923c':'#cba76a','#ec4899':'#c19783','#3b82f6':'#99aba2','#60a5fa':'#a8b9ad','#93c5fd':'#c4cfb8','#ef4444':'#c4877e'};
  // CSSOM serializes most hex colors as rgb(), so cover both spellings.
  const triplet = value => [1,3,5].map(index=>parseInt(value.slice(index,index+2),16)).join(',');
  for (const [before,after] of Object.entries(hex)) palette.set(triplet(before),triplet(after));
  function warm(value) {
    if (/url\(/i.test(value)) return value; // uploaded artwork and SVG data URLs
    return value.replace(/(#[\da-f]{6})([\da-f]{2})?\b/gi, (v,base,alpha) => hex[base.toLowerCase()] ? hex[base.toLowerCase()]+(alpha || '') : v)
      .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g, (v,r,g,b) => {
        const replacement = palette.get(`${r},${g},${b}`);
        return replacement ? v.slice(0,v.indexOf('(')+1)+replacement : v;
      });
  }
  const emoji = /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;
  const textLabel = /^(H[1-6]|BUTTON|LABEL|SUMMARY)$/;
  function decorateText(node) {
    const el = node.parentElement;
    if (!el || el.closest(skip+','+art)) return;
    const value = node.nodeValue;
    const matches = [...value.matchAll(emoji)];
    if (!matches.length) return;
    const iconOnly = !value.replace(emoji,'').trim();
    const label = textLabel.test(el.tagName) || /(?:icon|emoji|placeholder|badge|label|title|empty|stat|toolbar|btn|button|tab|nav|action|logo|heading|greeting|chip|pill|status)/i.test(el.className);
    const prefix = matches[0].index === 0 && aliases[matches[0][0]] && /^\s/.test(value.slice(matches[0][0].length));
    if (!iconOnly && !label && !prefix) return;
    // Do not rewrite mixed user prose, names, form values or existing media.
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      fragment.append(value.slice(cursor,match.index));
      const wrapper = document.createElement('span');
      wrapper.className = 'ui-symbol';
      wrapper.setAttribute('aria-hidden','true');
      wrapper.innerHTML = uiIcon(aliases[match[0]] || 'award'); // closed SVG registry
      fragment.append(wrapper);
      cursor = match.index + match[0].length;
    }
    fragment.append(value.slice(cursor));
    node.replaceWith(fragment);
  }
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
    if (root.nodeType === Node.TEXT_NODE) { decorateMaterial(root.parentElement); if(root.isConnected)decorateText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(skip)) return;
    decorateMaterial(root);
    root.querySelectorAll('.material-symbols-outlined').forEach(decorateMaterial);
    const elements = [root,...root.querySelectorAll('[style]')];
    for (const el of elements) {
      if (el.closest(skip+','+art+',.cb-seat,.lm-seat,.cal-day,.cal-dot,[class*=avatar],[class*=photo],[class*=ts-badge],[class*=title-preview]')) continue;
      for (const property of ['color','background','background-color','border-color','box-shadow','text-shadow']) {
        const before = el.style.getPropertyValue(property);
        const after = warm(before);
        if (after !== before) el.style.setProperty(property,after,el.style.getPropertyPriority(property));
      }
    }
    const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(decorateText);
  }
  // Normalize legacy CSS declarations too, including styles injected later by
  // staff tools. CSSOM edits leave selectors, layout, stored palettes and media
  // untouched; custom badge/art rules and attendance states are excluded.
  const styled = new WeakSet();
  function stylesheet(sheet) {
    if (!sheet || styled.has(sheet)) return;
    let rules;
    try { rules = sheet.cssRules; } catch { return; } // cross-origin font sheet
    styled.add(sheet);
    function visit(list) {
      for (const rule of list) {
        if (/(?:ts-|title-preview|badge-preview|sprite|boss-art|stage-art|\.lm-seat|\.cb-seat|\.cal-dot)/.test(rule.selectorText || '')) continue;
        if (rule.style) {
          for (const property of ['color','background','background-color','border','border-color','box-shadow','text-shadow','--glow','--rc','--rg']) {
            const before = rule.style.getPropertyValue(property);
            let after = warm(before);
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
