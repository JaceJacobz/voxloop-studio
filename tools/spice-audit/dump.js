// node dump.js <port> <outfile> '<json list of {genre,style,seed}>'   -> JSON of every bar of each beat
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const port = process.argv[2], out = process.argv[3], jobs = JSON.parse(process.argv[4]);
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('http://localhost:' + port + '/index.html'); await p.waitForTimeout(1500);
  const res = await p.evaluate((jobs) => {
    function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
    const real = Math.random; const outl = [];
    for (const j of jobs) {
      Math.random = mulberry(j.seed);
      const beat = generatePattern(j.genre, { style: j.style, structure: j.structure || 'full' });
      Math.random = real;
      const bars = [];
      for (let i = 0; i < beat.totalBars; i++) {
        const v = barView(beat, i, true);
        bars.push({ kind: v.kind, label: v.label, tracks: v.tracks, vel: v.velocities, dbl: v.doubles, fx: v.fx, present: v.present, isFill: v.isFill });
      }
      outl.push({ genre: j.genre, style: j.style, seed: j.seed, bpm: beat.bpm, swing: beat.swing, spice: beat.spice || null, form: beat.form, bars });
    }
    return outl;
  }, jobs);
  fs.writeFileSync(out, JSON.stringify(res)); console.log('wrote', out, res.length, 'beats');
  await b.close();
})();
