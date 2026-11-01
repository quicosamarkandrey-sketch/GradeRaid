/* Material artwork is part of the frame, never an icon beside the title.
   Only decorative layers move; text and the hit target remain stable. */
;(function(){
 'use strict';let serial=0;
 const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 window.tsTitleMaterial=function(title){
  const shape=String(title.frameShape||title.frameTemplate||title.borderStyle||'').toLowerCase(),style=String(title.frameStyle||'').toLowerCase(),effect=String(title.effect||'').toLowerCase();
  // An explicit sculpted shape takes priority over a legacy fire/smoke effect.
  if(shape==='dragon'||shape==='scale')return 'dragon';
  if(shape==='circuit')return 'circuit';
  if(shape==='banner')return 'banner';
  if(shape==='celestial')return 'celestial';
  if(shape==='smoke'||effect==='smoke'||shape==='ghost')return 'smoke';
  if(shape==='flame'||style==='fire'||effect==='embers')return 'flame';
  if(shape==='shield')return 'shield';
  if(shape==='crystal'||style==='crystal')return 'crystal';
  if(shape==='shadow'||style==='shadow')return 'shadow';
  return '';
 };
 window.tsBuildMaterialFrame=function(kind,palette,quiet){
  const id='tsm-'+(++serial),primary=esc(palette.primary),accent=esc(palette.accent),border=esc(palette.border),bg=esc(palette.bg);
  const defs=`<defs><linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset=".22" stop-color="${border}"/><stop offset=".5" stop-color="${bg}"/><stop offset=".76" stop-color="${primary}"/><stop offset="1" stop-color="${border}"/></linearGradient><linearGradient id="${id}-fire" x1="0" y1="1" x2="0" y2="0"><stop stop-color="${border}"/><stop offset=".5" stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/></linearGradient><linearGradient id="${id}-shine"><stop stop-color="white" stop-opacity="0"/><stop offset=".5" stop-color="white" stop-opacity=".65"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>${kind==='smoke'&&!quiet?`<filter id="${id}-haze" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4.5"/></filter>`:''}</defs>`;
  const ink=`fill="${bg}"`,metal=`url(#${id}-metal)`,fire=`url(#${id}-fire)`;
  let art='';
  if(kind==='flame'){
   // Broad, connected fire currents wrap an obsidian core; no repeated flame stamps.
   art=`<path class="tsm-flame-tongue${quiet?' tsm-static':''}" d="M8 59C-4 39 20 32 14 13C28 18 29 30 26 36C41 24 38 13 59 3C48 17 65 22 82 20C108 14 125 24 151 19C131 31 111 28 94 29L45 56Z M312 57C327 40 300 30 307 14C288 21 295 33 282 36C287 20 270 11 253 7C267 25 251 20 239 18C213 13 202 23 178 20C194 32 218 28 237 30L274 57Z" fill="${fire}" opacity=".85"/><path class="tsm-flame-tongue tsm-fire-current${quiet?' tsm-static':''}" d="M13 61C4 46 35 42 24 23C46 39 23 47 43 48C34 32 65 27 57 15C78 31 50 35 72 35L105 28L86 49Z M307 61C323 42 287 44 300 28C273 38 297 50 273 49C288 34 259 33 267 21C249 31 269 40 246 36L221 29L237 50Z" fill="${accent}" opacity=".75"/>`;
   art+=`<path d="M30 29 55 22H266L291 29 302 48 284 65 253 70H64L34 65 19 48Z" fill="${bg}" stroke="${border}" stroke-width="1.6"/><path d="M41 31 60 27H258L279 32M38 58 66 64H250L281 58" fill="none" stroke="${primary}" stroke-width="1.3"/><path d="M27 41 36 35 41 46 31 53Z M292 41 284 35 279 46 289 53Z" fill="${metal}"/>`;
   art+=`<path class="tsm-fire-undertow${quiet?' tsm-static':''}" d="M20 60C61 76 83 61 116 69S177 72 211 69S272 74 306 56C295 72 271 80 250 75C222 80 201 72 175 76C149 81 126 72 107 75C78 80 39 78 20 60Z" fill="${fire}"/>`;
   if(!quiet)art+=`<g class="tsm-ember-track" fill="${accent}"><path d="m20 31 2-4 1 4-2 3Z m48-14 2-4 1 3-2 3Z m232 9 2-4 1 3-2 4Z"/></g><g class="tsm-ember-track tsm-embers-late" fill="${primary}"><circle cx="33" cy="30" r="1"/><circle cx="280" cy="24" r="1.2"/><circle cx="243" cy="17" r=".9"/></g>`;
  }else if(kind==='dragon'){
   const outline='M5 41 19 26 13 8 42 19 58 7 73 18H247L262 7 278 19 307 8 301 26 315 41 299 53 304 66 279 61 260 75 242 66H78L60 75 41 61 16 66 21 53Z';
   art=`<defs><pattern id="${id}-scales" width="24" height="18" patternUnits="userSpaceOnUse"><path d="M-12 0H12Q11 10 0 16Q-11 10-12 0Z M12 0H36Q35 10 24 16Q13 10 12 0Z M0 9H24Q23 19 12 25Q1 19 0 9Z" fill="${primary}" fill-opacity=".45" stroke="${accent}" stroke-opacity=".48" stroke-width=".9"/></pattern><clipPath id="${id}-dragon"><path d="${outline}"/></clipPath></defs><path d="${outline}" fill="${bg}" stroke="${border}" stroke-width="1.2"/><path d="${outline}" fill="url(#${id}-scales)"/><path d="M18 14 38 25 56 14 64 24M302 14 282 25 264 14 256 24" stroke="${accent}" stroke-width="1.5" fill="none"/><path d="M46 28 71 23H249L274 28 287 41 274 55 249 61H71L46 55 33 41Z" fill="${bg}" stroke="${border}" stroke-width="1.6"/><path d="M56 30 76 27H244L264 30M56 53 76 57H244L264 53" stroke="${primary}" stroke-opacity=".7" fill="none"/>`;
   if(!quiet)art+=`<g clip-path="url(#${id}-dragon)"><path class="tsm-dragon-luster" d="M-70 0H-30L-60 80H-100Z" fill="url(#${id}-shine)"/></g>`;
  }else if(kind==='circuit'){
   art=`<path d="M23 12H103L112 7H274L307 28V59L293 73H209L200 68H36L8 49V27Z" fill="${bg}" stroke="${border}" stroke-width="1.5"/><path d="M23 18H98L108 13H271L301 32V56L290 67H214M19 42V29L28 23M29 58 40 63H189L200 68" stroke="${primary}" fill="none" stroke-width="1.2"/><path d="M40 27H276M44 55H274" stroke="${border}" stroke-opacity=".35"/><path d="M9 28 22 15H57M264 8H278L307 27M265 73H293L308 58M8 48 35 68H65" fill="none" stroke="${accent}" stroke-width="2.3"/><path d="M30 31v17m5-17v17m250-16v16m5-16v16" stroke="${primary}" stroke-width="1.5" stroke-opacity=".7"/><path d="M115 12h7m5 0h7m5 0h7M216 67h7m5 0h7m5 0h7" stroke="${accent}" stroke-opacity=".6"/>`;
   if(!quiet)art+=`<path class="tsm-circuit-signal" d="M25 19H98L109 13H272L300 32V55L289 66H214L202 61H42L20 46V30Z" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="24 680"/><g class="tsm-circuit-nodes" fill="${accent}"><circle cx="78" cy="19" r="1.8"/><circle cx="253" cy="66" r="1.8"/></g>`;
  }else if(kind==='banner'){
   art=`<path d="M4 20 49 24V71L24 65 4 68 15 45Z M316 20 271 24V71L296 65 316 68 305 45Z" fill="${primary}" stroke="${border}" stroke-width="1"/><path d="M31 16 49 24V70L31 60Z M289 16 271 24V70L289 60Z" fill="${bg}"/><path d="M31 16Q160 4 289 16V60Q160 72 31 60Z" fill="${bg}" stroke="${border}" stroke-width="1.7"/><path d="M37 22Q160 11 283 22M37 55Q160 66 283 55" fill="none" stroke="${accent}" stroke-width="1.2"/><path d="M39 25Q160 15 281 25M39 52Q160 63 281 52" fill="none" stroke="${primary}" stroke-opacity=".6" stroke-dasharray="2 3"/><path d="M7 23 25 28 25 59 8 62M313 23 295 28 295 59 312 62" fill="none" stroke="${accent}" stroke-opacity=".55"/><path d="M33 18 48 24V59L33 59Z M287 18 272 24V59L287 59Z" fill="${primary}" opacity=".22"/>`;
   if(!quiet)art+=`<path class="tsm-banner-satin" d="M44 24Q160 13 276 24V30Q160 20 44 30Z M44 49Q160 60 276 49V55Q160 66 44 55Z" fill="${accent}" opacity=".15"/>`;
  }else if(kind==='celestial'){
   art=`<path d="M20 27 47 17H273L300 27 309 40 300 54 273 64H47L20 54 11 40Z" fill="${bg}" stroke="${border}" stroke-width="1.2"/><ellipse cx="160" cy="40" rx="153" ry="30" fill="none" stroke="${primary}" stroke-opacity=".5"/><path d="M43 25 68 21H252L277 25M43 56 68 60H252L277 56" stroke="${accent}" stroke-opacity=".6" fill="none"/><path d="m160 1 3 6 8 3-8 3-3 6-3-6-8-3 8-3Z m-140 32 2 5 6 2-6 2-2 5-2-5-6-2 6-2Z m280 0 2 5 6 2-6 2-2 5-2-5-6-2 6-2Z m-140 28 3 6 8 3-8 3-3 6-3-6-8-3 8-3Z" fill="${accent}"/><path d="m48 11 18 6m207-5-18 5M48 69l18-6m207 5-18-5" stroke="${border}"/>`;
   if(!quiet)art+=`<ellipse class="tsm-celestial-orbit" cx="160" cy="40" rx="153" ry="30" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="3 41 1 600"/><g class="tsm-celestial-stars" fill="${accent}"><circle cx="53" cy="18" r="1.4"/><circle cx="266" cy="62" r="1.5"/><circle cx="286" cy="24" r="1"/></g>`;
  }else if(kind==='shield'){
   const outline='M20 7H300L315 19L306 58L279 69L160 79L41 69L14 58L5 19Z';
   art=`<path d="${outline}" fill="${metal}"/><path d="M23 13H297L307 22L299 53L276 62L160 72L44 62L21 53L13 22Z" ${ink} stroke="${accent}" stroke-opacity=".58"/><path d="M25 16H295M27 57 160 69 293 57" stroke="${primary}" stroke-width="1.2" fill="none"/><path d="M10 20 40 8M310 20 280 8M18 56 44 67M302 56 276 67" stroke="white" stroke-opacity=".4"/>${[22,298].map(x=>`<circle cx="${x}" cy="36" r="3.1" fill="${metal}" stroke="${accent}" stroke-opacity=".65"/><circle cx="${x}" cy="36" r=".9" fill="${accent}"/>`).join('')}`;
   if(!quiet)art+=`<path class="tsm-shield-ward" d="${outline}" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="30 750"/>`;
  }else if(kind==='crystal'){
   art=`<path d="M22 5H297L318 24L308 60L282 76H35L4 57L1 25Z" fill="${metal}"/><path d="M30 15H288L304 28L296 55L278 66H42L17 52L14 29Z" ${ink} stroke="${primary}" stroke-opacity=".7"/><path d="m22 5 8 10L1 25l13 4M297 5l-9 10 30 9-14 4M308 60l-12-5-14 21-4-10M4 57l13-5 18 24 7-10" fill="none" stroke="${accent}" stroke-opacity=".8"/><path d="m23 6 7 9L2 25Z M297 6 288 15 316 24Z M305 59 296 55 283 74Z" fill="${accent}" opacity=".35"/><path d="M47 11H274M44 70H274" stroke="white" stroke-opacity=".3"/>`;
   if(!quiet)art+=`<rect class="tsm-crystal-refraction" x="-100" y="0" width="64" height="80" fill="url(#${id}-shine)" opacity=".6"/><path class="tsm-crystal-spark" d="M22 16v12M16 22h12M294 50v12M288 56h12" stroke="${accent}" stroke-width="1.6"/>`;
  }else if(kind==='shadow'){
   art=`<path d="M16 8 74 5 88 10H235L246 5 306 12 314 29 307 40 316 56 294 73 235 70 223 75H72L60 70 9 64 3 46 10 32 4 20Z" fill="#080b14" stroke="${border}" stroke-opacity=".75"/><path d="M22 18 79 13 92 18H231L247 13 296 21M24 62 65 65 79 62H222L238 66 292 60" fill="none" stroke="${primary}" stroke-opacity=".7" stroke-width="1.3"/>`;
   if(!quiet)art+=`<path class="tsm-shadow-ribbon" d="M-10 29Q41-3 91 17T189 12T320 20V6Q254-4 203 8T93 7T-10 17Z" fill="${primary}" opacity=".2"/><path class="tsm-shadow-ribbon tsm-shadow-lower" d="M-10 58Q49 87 109 67T213 72T332 58V77Q256 92 203 80T94 82T-10 73Z" fill="${accent}" opacity=".13"/><path class="tsm-shadow-edge" d="M16 8 74 5 88 10H235L246 5 306 12" fill="none" stroke="${accent}" stroke-width="1.4" stroke-dasharray="12 46"/>`;
  }else if(kind==='smoke'){
   art=`<path d="M15 19Q20 8 43 16Q69 6 94 15H229Q257 6 277 16Q305 8 311 24L306 61Q292 73 270 66Q248 77 223 69H91Q61 77 43 67Q15 74 9 57Z" fill="${bg}" stroke="${border}" stroke-opacity=".55"/>`;
   if(!quiet)art+=`<g class="tsm-smoke-roll" fill="${primary}" filter="url(#${id}-haze)" opacity=".28"><path d="M-30 17C-4-7 29 2 49 12C65-8 96-5 117 13C139-8 176-4 193 13C217-3 251-4 269 15C291-2 328 0 348 20L348 29C313 19 289 29 268 24C243 32 215 20 195 25C166 18 141 30 118 24C93 31 66 21 48 26C18 18-6 30-30 24Z"/><path d="M-25 64C5 46 29 64 48 60C68 78 97 53 118 64C144 51 166 73 190 62C216 80 242 54 266 66C292 50 318 74 345 60V92H-25Z"/></g><g class="tsm-smoke-roll tsm-smoke-return" fill="${accent}" filter="url(#${id}-haze)" opacity=".18"><path d="M-25 19C20 31 47 4 85 17S142 29 174 13S235 29 264 14S317 24 345 11V1H-25Z M-20 75C18 51 51 80 85 63S147 81 180 67S239 78 269 63S320 80 345 67V90H-20Z"/></g>`;
   art+=`<path class="${quiet?'':'tsm-smoke-curl'}" d="M5 27Q29 3 57 20T110 15 M206 65Q236 79 257 63T318 60" fill="none" stroke="${accent}" stroke-width="1.3" stroke-opacity=".65"/>`;
  }
  // A quiet central ink wash keeps moving refractions behind readable text.
  return `<svg class="ts-material-art" viewBox="0 0 320 80" preserveAspectRatio="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${defs}${art}<rect x="38" y="27" width="244" height="27" rx="8" fill="${bg}" opacity="${kind==='flame'?'.88':'.32'}"/></svg>`;
 };
})();
