// Mix-drift test: renders beats of every genre offline and checks the mix still sits where it was calibrated.
//   1. Each main track's level against the kick (minus its target in TEMPLATES[g].balance) must not move more than
//      DRIFT dB from tests/mix-baseline.json. (Small percussion changes level with the random sample it gets, so only
//      the main tracks are held to the baseline; the rest are listed for information.)
//   2. The main tracks (bass, keys, pad, pluck, snare, clap, hat) must stay within MAIN dB of their target.
//   3. The whole mix must keep headroom (peak below PEAK dBFS) and no track may be silent.
// Run (needs Playwright and a server on the project folder):
//   (python3 -m http.server 8765 &) ; NODE_PATH=$(npm root -g) node tests/mixdrift.js
// After a deliberate sound change, accept the new levels with:  node tests/mixdrift.js --update
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, 'mix-baseline.json');
const DRIFT = 4, MAIN = 7, PEAK = -1.0, REPS = 4;
// pluck and pad change level with whichever instrument the producer picked (a bell or a cello), so they get more room
const DRIFT_OF = { pluck: 6.5, pad: 6.5 };
const MAIN_TRACKS = ['bass', 'chords', 'pad', 'pluck', 'snare', 'clap', 'hat'];
const update = process.argv.includes('--update');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.click('.mode-btn[data-mode="beatlab"]'); await p.waitForTimeout(1000);
  const res = await p.evaluate(async (reps) => {
    const out = {};
    const meter = buf => { const n = buf.numberOfChannels, d = buf.getChannelData(0), e = buf.getChannelData(n - 1), w = 2048; let best = 0; for (let i = 0; i + w < d.length; i += 256) { let s = 0; for (let k = 0; k < w; k++) { const m = (d[i + k] + e[i + k]) / 2; s += m * m; } best = Math.max(best, s / w); } return 10 * Math.log10(best + 1e-12); };
    const peak = buf => { let m = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; } } return 20 * Math.log10(m + 1e-12); };
    for (const g of ['afrobeats', 'amapiano', 'afrohouse', 'rnb', 'trap', 'afrolust']) {
      out[g] = { tracks: {}, peaks: [] };
      for (let rep = 0; rep < reps; rep++) {
        const beat = generatePattern(g, { structure: 'loop' });
        await ensureBeatSound(beat.sound);
        const base = currentRenderSettings();
        const lv = {};
        for (const name of TRACK_ORDER) {
          const z = {}; TRACK_ORDER.forEach(n => { z[n] = 0; });
          const s = Object.assign({}, base, { trim: z, autos: Object.assign({}, z), isAudible: n => n === name, fxOn: false, masterDb: 0, masteringOn: false });
          lv[name] = meter(await renderSongBuffer(beat, s, () => {}));
        }
        const tpl = TEMPLATES[g];
        for (const name of TRACK_ORDER) {
          const target = tpl.balance[name];
          if (target === null || target === undefined || name === 'kick' || lv[name] < -80) continue;
          (out[g].tracks[name] = out[g].tracks[name] || []).push(lv[name] - lv.kick - target);
        }
        const full = await renderSongBuffer(beat, base, () => {});
        out[g].peaks.push(peak(full));
        out[g].silent = (out[g].silent || []).concat(TRACK_ORDER.filter(n => beat.pattern && lv[n] < -80 && tpl.balance[n] !== null && tpl.balance[n] !== undefined && n !== 'kick' && beat.presence && false));
      }
    }
    return out;
  }, REPS);
  await b.close();
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const now = {}; const fails = [];
  for (const g of Object.keys(res)) {
    now[g] = {};
    for (const [t, arr] of Object.entries(res[g].tracks)) now[g][t] = +med(arr).toFixed(1);
    const pk = Math.max(...res[g].peaks);
    if (pk > PEAK) fails.push(`${g}: full-mix peak ${pk.toFixed(1)} dBFS is above ${PEAK}`);
    for (const t of MAIN_TRACKS) if (now[g][t] !== undefined && Math.abs(now[g][t]) > MAIN) fails.push(`${g}/${t}: ${now[g][t]} dB from its target (limit ${MAIN})`);
  }
  if (update) { const old = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {}; fs.writeFileSync(BASE, JSON.stringify(Object.assign(old, now), null, 1) + '\n'); console.log('Baseline written:', BASE); }
  else if (fs.existsSync(BASE)) {
    const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
    for (const g of Object.keys(now)) for (const t of Object.keys(now[g]).filter(t => MAIN_TRACKS.includes(t))) {
      if (base[g] && base[g][t] !== undefined && Math.abs(now[g][t] - base[g][t]) > (DRIFT_OF[t] || DRIFT)) fails.push(`${g}/${t}: moved ${(now[g][t] - base[g][t]).toFixed(1)} dB from baseline (${base[g][t]} -> ${now[g][t]})`);
    }
  } else console.log('No baseline yet: run with --update first.');
  if (errs.length) fails.push('page errors: ' + errs.join(' | '));
  console.log(JSON.stringify(now));
  if (fails.length) { console.log('\nMIX DRIFT FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('\nMix drift test passed.');
})();
