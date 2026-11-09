// node run.js <scenario>   (needs the app served on :8080 and PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers)
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const { execSync } = require('child_process');
const name = process.argv[2] || 'rap_inSync', dir = '/tmp/e2e_' + name, t0 = Date.now(), ts = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(3) + 's';
execSync(`node ${__dirname}/make-assets.js ${name} ${dir}`);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errs.push('console.error ' + m.text().slice(0, 240)); });
  await p.goto('http://localhost:8080/index.html'); await p.waitForTimeout(1500);
  await p.setInputFiles('#vocal-input', dir + '/vocal.wav'); await p.setInputFiles('#beat-input', dir + '/beat.wav');
  let last = '';
  for (let i = 0; i < 1500; i++) {
    const st = await p.evaluate(() => ({ s: VLAutopilot.state.state, c: VLAutopilot.state.current, e: VLAutopilot.state.error }));
    const line = st.s + ' / ' + st.c; if (line !== last) { console.log(ts(), line); last = line; }
    if (st.s === 'done' || st.s === 'error' || st.s === 'cancelled') break; await p.waitForTimeout(400);
  }
  const flags = await p.evaluate(() => { const ms = document.getElementById('automix-summary'); return { state: VLAutopilot.state.state, error: VLAutopilot.state.error, alignOffsetMs: VLAutopilot.alignment ? Math.round(VLAutopilot.alignment.offsetSec * 1000) : null, hasMix: !!VLState.mixBuffer, masterSummaryExists: !!ms, masterSummaryOpen: !!(ms && ms.open), masterSummaryTitle: ms ? ms.querySelector('summary').textContent : null, apSummaryOpen: !!(document.getElementById('ap-summary') || {}).open, apSummaryTitle: (document.getElementById('ap-summary-title') || {}).textContent }; });
  console.log('FLAGS ' + JSON.stringify(flags));
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  if (name === 'sung_colour') {
    const fs = require('fs'); const truth = JSON.parse(fs.readFileSync(dir + '/truth.json', 'utf8'));
    const ev = await p.evaluate((truth) => { const S = VLState, buf = S.tunedVocal || S.preparedVocal || S.vocalBuffer, x = buf.getChannelData(0), sr = buf.sampleRate, off = (VLAutopilot.alignment ? VLAutopilot.alignment.offsetSec : 0);
      const eng = createTuneEngine(), tr = eng.trackClean(x, sr), hop = tr.hop / sr, res = {};
      truth.forEach(n => { const v = []; for (let k = 0; k < tr.midi.length; k++) { const t = k * hop - off; if (t > n.t0 + 0.12 && t < n.t1 - 0.05 && !isNaN(tr.midi[k])) v.push(tr.midi[k]); } v.sort((a, b) => a - b); const m = v.length ? v[v.length >> 1] : NaN; (res[n.line] = res[n.line] || []).push(isNaN(m) ? 999 : Math.abs(m - n.midi) * 100); });
      return { tuned: !!S.tunedVocal, phrase: S.phraseResult ? { lines: S.phraseResult.summary, texts: S.phraseResult.lines } : null, err: Object.fromEntries(Object.entries(res).map(([k, a]) => { const ok = a.filter(e => e < 150); return [k, ok.length ? Math.round(ok.reduce((s, e) => s + e, 0) / ok.length) : null]; })) }; }, truth);
    console.log('COLOUR ' + JSON.stringify(ev, null, 1));
  }
  await p.evaluate(() => document.getElementById('mix-section').scrollIntoView()); await p.waitForTimeout(300);
  await p.screenshot({ path: '/tmp/e2e_' + name + '_closed.png' });
  await p.evaluate(() => { document.getElementById('autopilot-card').scrollIntoView(); }); await p.waitForTimeout(200);
  await p.click('#ap-summary summary').catch(() => {}); await p.waitForTimeout(200); await p.screenshot({ path: '/tmp/e2e_' + name + '_ap.png' });
  await b.close();
})();
