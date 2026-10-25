// Run after serving the repository on 127.0.0.1:4175. No backend writes.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:1400,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://127.0.0.1:4175/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/styles/base.css"></head><body style="background:#13121e;color:white"><div id="a-classroom-monitor"><button id="lm-coldcall-btn">Pick</button><div id="lm-canvas"></div></div><div id="modal-overlay" class="modal-overlay" style="display:none"><div id="modal-box" class="modal-box md"><div id="modal-content"></div></div></div></body></html>'}));
    await page.goto('http://127.0.0.1:4175/');
    await page.evaluate(()=>{
      window.CB_CANVAS_W=1200;window.CB_CANVAS_H=800;
      window._esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      window._cssColor=s=>s;window.toast=()=>{};
      window.student={id:'s1',name:'Alex Rivera',init:'AR',level:12,tier:'Explorer',color:'#a78bfa',profilePic:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#8171bc"/><circle cx="50" cy="40" r="22" fill="#eadbff"/></svg>')};
      window.vm={seatId:'seat1',studentId:'s1',studentName:'Alex Rivera',studentInit:'AR',studentPhoto:student.profilePic,xCoord:260,yCoord:190,color:{bg:'#202031',border:'#4edea3'},attendanceStatus:'On Time'};
      window.AppStore={getState:()=>({students:[student]}),unsubscribe(){}};
      window.ClassroomService={getLiveSeatingMap:()=>[vm],pickRandomStudent:()=>({ok:true,winner:vm,pool:[vm]})};
      window.RecitationService={getSessionCounts:()=>({s1:7}),getAllTimeTotalForStudent:()=>42,getTodayTotalForStudent:()=>11};
      window.showModal=html=>{document.getElementById('modal-content').innerHTML=html;document.getElementById('modal-overlay').style.display='flex';};
    });
    for (const name of ['live_monitor.js','live-monitor-render.js','live-monitor-coldcall.js']) await page.addScriptTag({url:'http://127.0.0.1:4175/modules/seat-arrangement/'+name});
    await page.evaluate(()=>{_lmMounted=true;_lmLayoutId='layout';_lmRecitationMode=true;_lmSessionStartAt='2026-01-01';_lmRenderCanvas();});
    assert.equal(await page.locator('.lm-seat-init .lm-recitation-badge').textContent(),'7');
    assert.equal(await page.locator('.lm-avatar-identity').evaluate(el=>getComputedStyle(el).opacity),'0.22');
    const centered=await page.locator('.lm-seat-init').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('.lm-recitation-badge').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<1&&Math.abs(a.y+a.height/2-b.y-b.height/2)<1;});assert.ok(centered);
    await page.evaluate(()=>window._lmStartColdCall());
    assert.equal(await page.locator('.flash-cycle').count(),1);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.flash-cycle').evaluate(el=>getComputedStyle(el).borderColor),'rgb(165, 180, 252)');
    await page.waitForSelector('.lm-spotlight',{timeout:6000});
    assert.equal(await page.locator('.lm-spotlight-headline-num').textContent(),'7');
    assert.equal(await page.locator('.lm-spotlight-name').textContent(),'Alex Rivera');
    await page.screenshot({path:'/workspace/live-monitor-redesign.png'});
    await page.evaluate(()=>{_lmClearCycle();document.getElementById('modal-content').innerHTML='';_lmLandOnWinner(vm);_lmClearCycle();});
    await page.waitForTimeout(800);assert.equal(await page.locator('.lm-spotlight').count(),0,'cancelled reveal');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>window._lmStartColdCall());
    await page.waitForSelector('.lm-spotlight',{timeout:1000});
    await page.evaluate(()=>{_lmClearCycle();_lmRecitationMode=false;_lmRenderCanvas();});
    assert.equal(await page.locator('.lm-recitation-badge').count(),0);
    assert.equal(await page.locator('.lm-avatar-identity').evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.deepEqual(errors,[]);
    console.log('PASS: centered session score, dimmed photo, violet picker, winner popup, cancellation, reduced motion, normal avatar outside recitation; no page errors');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
