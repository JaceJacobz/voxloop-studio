// Studio autopilot: load a beat, import a vocal, expect it to be produced by itself. node studio.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const { execSync } = require('child_process');
const dir = '/tmp/e2e_sung_colour'; execSync(`node ${__dirname}/make-assets.js sung_colour ${dir}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 400, height: 900 } }); const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errs.push('console.error ' + m.text().slice(0, 240)); });
  await p.goto('http://localhost:8080/index.html'); await p.waitForTimeout(1200);
  await p.click('.mode-btn[data-mode="studio"]'); await p.waitForTimeout(500);
  await p.setInputFiles('#studio-beat-input', dir + '/beat.wav'); await p.waitForTimeout(2500);
  const before = await p.evaluate(() => ({ lanes: VLDAW.lanes.length, beat: !!(VLDAW.beat && VLDAW.beat.buffer), ap: VLStudioAutopilot.on }));
  console.log('before', JSON.stringify(before));
  await p.evaluate(() => { const o = VLBrain.planProject; VLBrain.planProject = async function (...a) { const r = await o.apply(this, a); window.__plan = r.lanes.map(l => ({ findings: l.findings, extra: l.extra.map(z => z.label), chain: l.chain.map(c => c.type) })); return r; }; });
  await p.setInputFiles('#studio-import-input', dir + '/vocal.wav');
  let last = '';
  for (let i = 0; i < 12; i++) {
    const st = await p.evaluate(() => { const c = []; VLDAW.lanes.forEach(l => l.clips.forEach(k => c.push({ lane: l.name || l.id, dur: +(k.duration || 0).toFixed(1), hist: (k.history || k.undo || []).length, label: (k.label || '') }))); const busy = document.getElementById('fx-plan-busy'); return { clips: c, busy: busy && !busy.hidden ? busy.textContent : '', status: (document.getElementById('studio-status') || {}).textContent }; });
    const line = JSON.stringify({ busy: st.busy, status: st.status && st.status.slice(0, 90), hist: st.clips.map(c => c.hist) }); if (line !== last) { console.log(i * 2 + 's', line); last = line; }
    if (/Auto-produce done/.test(st.status || '')) break; await p.waitForTimeout(2000);
  }
  console.log('clip labels:', JSON.stringify(await p.evaluate(() => VLDAW.lanes.flatMap(l => l.clips.map(c => Object.entries(c).filter(([k, v]) => typeof v === 'string' && /Auto/.test(v)).map(([k, v]) => v.slice(0, 160)))))));
  console.log('PLAN', JSON.stringify(await p.evaluate(() => window.__plan), null, 1).slice(0, 2600));
  const done = await p.evaluate(() => { const d = document.querySelector('#fx-plan .fx-done'); return d ? d.textContent.trim().slice(0, 80) : null; });
  console.log('autopilot result panel:', done);
  // per-plugin Auto: select part of the clip, press Auto (selection), then Auto on one plugin card
  await p.evaluate(() => { const l = VLDAW.lanes.find(x => x.clips.some(c => c.buffer)), c = l.clips.find(k => k.buffer); VLFxRack.select({ laneId: l.id, clipId: c.id, start: 0, end: c.duration }); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { ['comp', 'gate', 'deess'].forEach(id => VLFxRack.addPlugin(id)); }); await p.waitForTimeout(500);
  console.log('before:', JSON.stringify(await p.evaluate(() => VLFxRack.st.chain.map(c => ({ t: c.type, bypass: !!c.bypass, thr: c.params.thr })))));
  for (let i = 0; i < 3; i++) { await p.evaluate((k) => VLFxRack.autoPlugin(k), i); await p.waitForTimeout(500); }
  console.log('after :', JSON.stringify(await p.evaluate(() => VLFxRack.st.chain.map(c => ({ t: c.type, bypass: !!c.bypass, thr: c.params.thr, why: (c.reason || '').slice(0, 90) })))));
  const cards = await p.evaluate(() => [...document.querySelectorAll('#fx-chain .fx-card strong')].map(e => e.textContent.trim()));
  console.log('plugins in chain after Auto:', JSON.stringify(cards));
  const btn = null;
  if (btn) { await p.evaluate(() => { window.__st = []; const o = VLDAW.api.status; }); await btn.click(); await p.waitForTimeout(9000); console.log('status line:', await p.evaluate(() => [...document.querySelectorAll('[class*=status],[id*=status]')].map(e => e.id + '=' + e.textContent.trim().slice(0, 90)).filter(x => x.length > 12).join(' | '))); console.log('after per-plugin Auto:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#fx-chain .fx-card')].map(c => ({ name: c.querySelector('strong').textContent.trim(), off: c.classList.contains('is-bypassed'), why: (c.querySelector('.fx-why') || {}).textContent }))))); }
  console.log(JSON.stringify(await p.evaluate(() => ({ gate: !!VLFx.P.gate, harmony: !!VLFx.P.harmony, autoBtn: !!document.querySelector('.fx-aplug'), apToggle: !!document.getElementById('fx-ap') }))));
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await p.screenshot({ path: '/tmp/e2e_studio.png' }); await b.close();
})();
