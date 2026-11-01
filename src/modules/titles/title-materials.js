/* Material artwork is part of the frame, never an icon beside the title.
   Only decorative layers move; text and the hit target remain stable. */
;(function(){
 'use strict';let serial=0;
 const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 window.tsTitleMaterial=function(title){
  const shape=String(title.frameShape||title.frameTemplate||title.borderStyle||'').toLowerCase(),style=String(title.frameStyle||'').toLowerCase(),effect=String(title.effect||'').toLowerCase();
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
   art=`<path d="M8 29Q12 17 25 20H295Q311 18 314 29L310 65Q300 76 280 71H34Q14 75 8 62Z" fill="${bg}" stroke="${border}" stroke-width="1.8"/><path d="M17 30H303M20 63Q160 72 302 63" fill="none" stroke="${primary}" stroke-opacity=".7" stroke-width="1.5"/>`;
   art+=[{x:-2,w:20,h:11},{x:12,w:26,h:22},{x:36,w:20,h:15},{x:59,w:30,h:28},{x:88,w:22,h:17},{x:111,w:27,h:24},{x:139,w:20,h:13},{x:163,w:25,h:29},{x:190,w:31,h:18},{x:219,w:20,h:25},{x:242,w:29,h:16},{x:271,w:23,h:27},{x:297,w:22,h:14}].map((p,i)=>`<g transform="translate(${p.x} ${27-p.h}) scale(${p.w/20} ${p.h/32})"><path class="tsm-flame-tongue${quiet?' tsm-static':''}" style="--tsm-delay:${-i*.37}s;--tsm-duration:${1.4+i%4*.29}s" d="M1 27C-3 18 12 11 9 0C10 10 21 12 19 20C17 15 13 15 15 10C11 17 8 20 10 25C12 29 17 29 19 24C19 33 4 35 1 27Z" fill="${fire}"/><path class="tsm-flame-tongue${quiet?' tsm-static':''}" style="--tsm-delay:${-i*.37-.15}s;--tsm-duration:${1.5+i%4*.31}s" d="M7 29C4 24 12 21 11 15C16 22 16 26 13 30Z" fill="${accent}" opacity=".8"/></g>`).join('');
   if(!quiet)art+=`<g class="tsm-ember-track" fill="${accent}"><circle cx="22" cy="47" r="1.3"/><circle cx="298" cy="48" r="1"/><circle cx="41" cy="23" r="1"/></g>`;
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
