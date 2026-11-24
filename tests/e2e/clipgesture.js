// Studio touch gestures on a clip, driven with REAL (emulated) touch events through the browser's own input pipeline (CDP Input.dispatchTouchEvent),
// so scrolling, long press and pointer cancel behave like a phone's browser does. It is still not a real phone: finger size, a cheap
// touchscreen and a slow CPU are not reproduced.
// Needs the app served on :8080.   node tests/e2e/clipgesture.js
let chromium; try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e) { ({ chromium } = require('playwright')); }
const { execSync } = require('child_process');
const dir = '/tmp/e2e_sung_colour'; execSync(`node ${__dirname}/make-assets.js sung_colour ${dir}`);
let bad = 0;
const check = (name, ok, extra) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 900 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resourc|net::ERR/.test(m.text())) errs.push('console.error ' + m.text()); });
  await p.goto('http://localhost:8080/index.html'); await p.waitForTimeout(1200);
  const menu = await p.$('#nav-toggle');
  if (menu && await menu.isVisible()) { await menu.click(); await p.waitForTimeout(300); await p.click('.nav-item[data-mode="studio"]'); } else await p.click('.mode-btn[data-mode="studio"]');
  await p.waitForTimeout(500);
  await p.setInputFiles('#studio-beat-input', dir + '/beat.wav'); await p.waitForTimeout(2500);
  await p.setInputFiles('#studio-import-input', dir + '/vocal.wav');
  for (let i = 0; i < 20; i++) { if (await p.evaluate(() => VLDAW.lanes.some((l) => l.clips.some((c) => c.buffer)))) break; await p.waitForTimeout(500); }
  await p.waitForTimeout(1500);
  await p.evaluate(() => { VLEdit.setSnap(false); });

  const cdp = await ctx.newCDPSession(p);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const pt = (x, y, id) => ({ x, y, id: id || 0 });
  const wait = (ms) => p.waitForTimeout(ms);
  async function swipe(x0, y0, x1, y1, steps, ms) {
    await T('touchStart', [pt(x0, y0)]);
    for (let i = 1; i <= steps; i++) { await T('touchMove', [pt(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)]); await wait(ms || 16); }
    await T('touchEnd', []);
  }
  const clipBox = () => p.evaluate(() => { const el = document.querySelector('.studio-clip[data-clip-id]'); const r = el.getBoundingClientRect(); const h = document.querySelector('.studio-lane-head'); return { x: r.left, y: r.top, w: r.width, h: r.height, head: h ? h.getBoundingClientRect().right : 0 }; });
  const info = () => p.evaluate(() => { const l = VLDAW.lanes.find((x) => x.clips.length), c = l.clips[0]; const s = VLFxRack.st.sel; return { laneId: l.id, id: c.id, start: c.start, dur: c.duration, sel: s ? { start: s.start, end: s.end, clipId: s.clipId } : null, scroll: document.querySelector('#studio-lanes').scrollLeft, pps: VLDAW.api.pxPerSec(), plug: !!document.querySelector('.fx-plug'), lifted: !!document.querySelector('.studio-clip.is-lifted'), gest: VLClipGesture.state() }; });
  const start0 = (await info()).start;
  const cb = await clipBox();
  const px = Math.min(380, Math.max(cb.head + 30, cb.x + 40)), py = cb.y + cb.h / 2;
  console.log('clip box', JSON.stringify(cb), 'touch at', px, Math.round(py), 'start', start0);

  // 1. swiping across a vocal clip scrolls and never picks or moves anything (20 swipes)
  let picks = 0, moved = 0, scrolled = 0;
  for (let i = 0; i < 20; i++) {
    const before = await info();
    const dir2 = i % 2 === 0 ? -1 : 1;
    await swipe(px, py, px + dir2 * 150, py + (i % 5 - 2) * 4, 10, 16);
    await wait(120);
    const after = await info();
    if (after.sel) picks++; if (Math.abs(after.start - before.start) > 1e-6) moved++; if (Math.abs(after.scroll - before.scroll) > 1) scrolled++;
  }
  check('20 swipes over a clip: nothing was picked', picks === 0, picks + ' picks');
  check('20 swipes over a clip: the clip never moved', moved === 0 && (await info()).start === start0);
  check('20 swipes over a clip: the timeline scrolled', scrolled >= 10, scrolled + ' of 20 swipes scrolled it');
  await p.evaluate(() => { document.querySelector('#studio-lanes').scrollLeft = 0; });
  await wait(150);
  const cb2 = await clipBox(); const px2 = Math.min(380, Math.max(cb2.head + 30, cb2.x + 40)), py2 = cb2.y + cb2.h / 2;

  // 2. a tap picks the whole clip
  await T('touchStart', [pt(px2, py2)]); await wait(60); await T('touchEnd', []); await wait(200);
  let s = await info();
  check('a tap picks the whole clip', s.sel && s.sel.start === 0 && Math.abs(s.sel.end - s.dur) < 1e-6 && !s.plug, JSON.stringify(s.sel));
  check('picking a clip does not open the Effects panel by itself', await p.evaluate(() => !VLFxRack.st.open));

  // 3. tapping it again shows the plug-in icon; tapping the icon opens Effects
  await T('touchStart', [pt(px2, py2)]); await wait(60); await T('touchEnd', []); await wait(450);
  s = await info();
  if (!s.plug) console.log('ERRS', JSON.stringify(errs));
  check('tap it again: the plug-in icon shows', s.plug === true);
  const plugBox = await p.evaluate(() => { const r = document.querySelector('.fx-plug').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
  check('the plug-in icon is big enough to hit (>= 40 px)', plugBox.w >= 40, Math.round(plugBox.w) + ' px');
  await T('touchStart', [pt(plugBox.x, plugBox.y)]); await wait(60); await T('touchEnd', []); await wait(400);
  check('tapping the icon opens Effects for the pick', await p.evaluate(() => VLFxRack.st.open === true && !document.querySelector('.fx-plug')), JSON.stringify(await p.evaluate(() => ({ open: VLFxRack.st.open, plug: !!document.querySelector('.fx-plug'), panelHidden: document.querySelector('.fx-rack') && document.querySelector('.fx-rack').classList.contains('hidden'), status: (document.querySelector('#studio-status') || {}).textContent }))));
  await p.evaluate(() => { document.querySelector('#fx-close') && document.querySelector('#fx-close').click(); });
  await wait(200);

  // 4. a swipe starting on empty lane space scrolls (and puts away the icon)
  // 5. press and hold, then drag: the clip lifts and moves; drop it; Undo puts it back exactly
  await p.evaluate(() => { document.querySelector('#studio-lanes').scrollLeft = 0; VLFxRack.st.sel = null; });
  const cb3 = await clipBox(); const px3 = Math.min(380, Math.max(cb3.head + 30, cb3.x + 40)), py3 = cb3.y + cb3.h / 2;
  await T('touchStart', [pt(px3, py3)]);
  await wait(520);
  s = await info();
  check('press and hold 0.5 s: the clip is picked up', s.gest && s.gest.mode === 'move' && s.lifted, JSON.stringify(s.gest));
  check('…and it is picked (selected) as well', s.sel && s.sel.clipId === s.id);
  const pps = s.pps;
  for (let i = 1; i <= 10; i++) { await T('touchMove', [pt(px3 + 6 * i, py3)]); await wait(16); }
  await wait(60);
  const mid = await info();
  check('while moving the page does not scroll', mid.scroll === s.scroll, s.scroll + ' -> ' + mid.scroll);
  check('while moving there is a read-out', await p.evaluate(() => !!document.querySelector('.clip-tip') && /ms|s/.test(document.querySelector('.clip-tip').textContent)), await p.evaluate(() => (document.querySelector('.clip-tip') || {}).textContent));
  await T('touchEnd', []); await wait(300);
  s = await info();
  const expect = start0 + 60 / pps;
  check('let go: the clip is dropped about 60 px later', Math.abs(s.start - expect) < 0.03 && !s.lifted, 'start ' + s.start.toFixed(3) + ' expected about ' + expect.toFixed(3));
  const moved1 = s.start;
  await p.evaluate(() => VLEdit.undo()); await wait(200);
  s = await info();
  check('Undo puts the clip back exactly', s.start === start0, 'start ' + s.start);
  await p.evaluate(() => VLEdit.redo()); await wait(200);
  check('Redo moves it again', Math.abs((await info()).start - moved1) < 1e-9);
  await p.evaluate(() => VLEdit.undo()); await wait(100);

  // 6. a finger that wobbles more than 10 px during the hold is a swipe: nothing lifts
  await p.evaluate(() => { VLFxRack.st.sel = null; document.querySelector('#studio-lanes').scrollLeft = 0; }); await wait(100);
  const cb4 = await clipBox(); const px4 = Math.min(380, Math.max(cb4.head + 30, cb4.x + 40)), py4 = cb4.y + cb4.h / 2;
  await T('touchStart', [pt(px4, py4)]); await wait(80); await T('touchMove', [pt(px4 + 12, py4)]); await wait(600);
  s = await info();
  check('a 12 px wobble during the hold: the clip does not lift', !s.lifted && !(s.gest && s.gest.mode === 'move'), JSON.stringify(s.gest));
  await T('touchEnd', []); await wait(200);
  check('…and nothing is picked or moved', !(await info()).sel && (await info()).start === start0);

  // 7. a clip cannot be dragged before 0:00
  await p.evaluate(() => { document.querySelector('#studio-lanes').scrollLeft = 0; }); await wait(100);
  await T('touchStart', [pt(px4, py4)]); await wait(520);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [pt(px4 - 30 * i, py4)]); await wait(16); }
  await T('touchEnd', []); await wait(300);
  s = await info();
  check('dragging far left stops at 0:00', s.start >= 0 && s.start < 0.001, 'start ' + s.start);
  await p.evaluate(() => { VLEdit.undo(); }); await wait(100);

  // 8. snap: with Snap on, the dropped clip's start lands on the beat grid when it is close to a beat
  const grid = await p.evaluate(() => { const g = VLDAW.api.gridInfo(); return g ? { beatSec: g.beatSec } : null; });
  if (grid) {
    await p.evaluate(() => { VLEdit.setSnap(true); VLFxRack.st.sel = null; VLRack.afterRender(); document.querySelector('#studio-lanes').scrollLeft = 0; }); await wait(100);
    const pps2 = (await info()).pps, beatPx = grid.beatSec * pps2;
    await T('touchStart', [pt(px4, py4)]); await wait(520);
    const dx = Math.round(beatPx * 2 + 3);
    for (let i = 1; i <= 10; i++) { await T('touchMove', [pt(px4 + dx * i / 10, py4)]); await wait(16); }
    await T('touchEnd', []); await wait(300);
    s = await info();
    const k = s.start / grid.beatSec;
    check('Snap on: the start is a whole number of beats', Math.abs(k - Math.round(k)) < 0.01, 'start ' + s.start.toFixed(3) + ' = ' + k.toFixed(3) + ' beats');
    check('Snap on: and it moved (not left at 0:00)', s.start > 0.3, 'start ' + s.start.toFixed(3));
    await p.evaluate(() => { VLEdit.undo(); VLEdit.setSnap(false); }); await wait(100);
  } else console.log('SKIP snap test: the beat has no tempo grid');

  // 9. the beat clip never lifts
  const beatBox = await p.evaluate(() => { const el = document.querySelector('.beat-clip'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2 }; });
  if (beatBox) {
    await p.evaluate(() => { document.querySelector('#studio-lanes').scrollLeft = 0; }); await wait(100);
    await T('touchStart', [pt(px4, beatBox.y)]); await wait(520);
    check('press and hold on the beat: nothing lifts', !(await info()).lifted && !(await info()).gest);
    await T('touchEnd', []); await wait(100);
  }

  // 10. the two grips: after a tap the clip shows a grip at each end; dragging one picks just a part
  await p.evaluate(() => { VLFxRack.st.sel = null; document.querySelector('#studio-lanes').scrollLeft = 0; }); await wait(100);
  const cb5 = await clipBox(); const px5 = Math.min(380, Math.max(cb5.head + 30, cb5.x + 40)), py5 = cb5.y + cb5.h / 2;
  await T('touchStart', [pt(px5, py5)]); await wait(60); await T('touchEnd', []); await wait(250);
  const gh = await p.evaluate(() => { const h = document.querySelector('.fx-handle[data-edge="a"]'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2, w: r.width }; });
  check('the picked clip shows a grip with a 44 px touch area', gh && gh.w >= 40, gh ? Math.round(gh.w) + ' px' : 'no grip');
  if (gh) {
    const before = (await info()).sel;
    await T('touchStart', [pt(gh.x, gh.y)]);
    for (let i = 1; i <= 8; i++) { await T('touchMove', [pt(gh.x + 8 * i, gh.y)]); await wait(16); }
    await T('touchEnd', []); await wait(300);
    s = await info();
    check('dragging the left grip picks just a part', s.sel && s.sel.start > before.start + 0.1 && Math.abs(s.sel.end - before.end) < 1e-6 && s.start === start0, JSON.stringify(s.sel));
  }

  // 11. nudge buttons: 10 ms later, 100 ms later, one Undo returns to the start
  await p.evaluate(() => { VLEdit.nudge(1); VLEdit.nudge(1); });
  s = await info();
  check('Later nudges the picked clip by 10 ms', Math.abs(s.start - (start0 + 0.02)) < 1e-6, 'start +' + ((s.start - start0) * 1000).toFixed(1) + ' ms');
  await p.evaluate(() => VLEdit.undo()); s = await info();
  check('one Undo takes back a run of nudges', s.start === start0, 'start ' + s.start);
  const nb = await p.evaluate(() => !!document.querySelector('#studio-editbar [data-act="later"]') && !!document.querySelector('#studio-editbar [data-act="snap"]') && !!document.querySelector('#studio-editbar [data-act="step"]'));
  check('the edit bar has Snap, Earlier, Later and the step button', nb);

  // 12. a moved clip is where the mix puts it (the same position the Pipeline hand-over renders from)
  const click = await p.evaluate(async () => {
    const l = VLDAW.lanes.find((x) => x.clips.length), c = l.clips[0], sr = c.buffer.sampleRate;
    const ac = VLDAW.api.ensureCtx(), cb = ac.createBuffer(1, Math.round(sr * 0.5), sr); cb.getChannelData(0)[0] = 0.9;
    const keep = { buffer: c.buffer, duration: c.duration, start: c.start, muted: l.muted };
    l.muted = true; const beatOnly = (await VLDAW.api.renderMix()).getChannelData(0).slice(); l.muted = false;
    c.buffer = cb; c.duration = cb.duration; c.start = 1.0;
    const peakAt = async () => { const r = await VLDAW.api.renderMix(); const d = r.getChannelData(0); let best = 0, at = -1; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i] - (beatOnly[i] || 0)); if (v > best) { best = v; at = i; } } return at / r.sampleRate; };
    const before = await peakAt();
    VLEdit.moveClip(l.id, c.id, 1.12);
    const after = await peakAt();
    c.buffer = keep.buffer; c.duration = keep.duration; c.start = keep.start; l.muted = keep.muted;
    return { before, after };
  });
  check('moved +120 ms: the rendered mix has the clip 120 ms later', Math.abs((click.after - click.before) - 0.12) < 0.003, 'peak at ' + click.before.toFixed(3) + ' s -> ' + click.after.toFixed(3) + ' s');

  // 13. a two-finger pinch still zooms, and picks or moves nothing
  await p.evaluate(() => { VLFxRack.st.sel = null; VLRack.afterRender(); document.querySelector('#studio-lanes').scrollLeft = 0; }); await wait(100);
  const z0 = await p.evaluate(() => VLDAW.api.getZoom());
  const cb6 = await clipBox(); const cx = Math.min(300, cb6.x + 150), cy = cb6.y + cb6.h / 2;
  await T('touchStart', [pt(cx - 30, cy, 1), pt(cx + 30, cy, 2)]); await wait(40);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [pt(cx - 30 - 8 * i, cy, 1), pt(cx + 30 + 8 * i, cy, 2)]); await wait(16); }
  await T('touchEnd', []); await wait(300);
  const z1 = await p.evaluate(() => VLDAW.api.getZoom()), sp = await info();
  // (the emulated pinch applies only part of the spread, 1.00 -> 1.27, the same on v2.25.8 before the gesture change)
  check('pinch with two fingers still zooms in', z1 > z0 * 1.15, 'zoom ' + z0.toFixed(2) + ' -> ' + z1.toFixed(2));
  check('…and the pinch picked and moved nothing', !sp.sel && sp.start === start0 && !sp.lifted);
  // 14. the ruler still scrubs the playhead
  const rb = await p.evaluate(() => { const r = document.querySelector('#studio-ruler-scroll').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2 }; });
  await p.evaluate(() => VLDAW.api.setPlayhead(0)); await wait(100);
  await swipe(rb.x + 30, rb.y, rb.x + 150, rb.y, 6, 16); await wait(200);
  check('dragging on the ruler still moves the playhead', (await p.evaluate(() => VLDAW.api.getPlayhead())) > 0.3, 'playhead ' + (await p.evaluate(() => VLDAW.api.getPlayhead())).toFixed(2) + ' s');

  // 15. moving a clip while the song plays: it keeps playing (the clip is scheduled again from its new place) and nothing breaks
  await p.evaluate(() => { VLFxRack.st.sel = null; VLRack.afterRender(); });
  await p.click('#tr-play'); await wait(700);
  const playing1 = await p.evaluate(() => VLDAW.api.isPlaying());
  await p.evaluate(() => { const l = VLDAW.lanes.find((x) => x.clips.length); VLEdit.moveClip(l.id, l.clips[0].id, l.clips[0].start + 0.5); });
  await wait(500);
  const playing2 = await p.evaluate(() => VLDAW.api.isPlaying());
  check('moving a clip while playing: playback carries on', playing1 && playing2);
  await p.click('#tr-play'); await wait(200);
  await p.evaluate(() => VLEdit.undo()); await wait(100);

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(bad ? bad + ' problem(s)' : 'all as expected');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
