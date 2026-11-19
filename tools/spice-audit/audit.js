// node audit.js <port> <rollsPerStyle> -> JSON summary on stdout
const { chromium } = require('playwright');
(async () => {
  const port = process.argv[2], N = parseInt(process.argv[3] || '6', 10);
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + port + '/index.html'); await p.waitForTimeout(1500);
  const res = await p.evaluate((N) => {
    function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
    const real = Math.random, out = { styles: {}, problems: [] };
    const TR = ['kick','snare','clap','rim','hat','openhat','shaker','perc','bell','bass','logdrum','chords','pad','pluck','lead'];
    const CORE = ['kick','snare','clap','rim','hat','perc','bass','chords','shaker','openhat','bell','logdrum'];
    const CLAIM = { clave: p => [p.track], talk: p => [p.a, p.b], trip: () => ['hat'], kick: () => ['kick','bass'], stab: () => ['chords'], ghost: () => ['snare'], bassb: () => ['bass'], log: () => ['logdrum'], drive: () => ['hat'], half: () => ['hat'] };
    const sig = (beat) => { // a fingerprint of how the beat plays: per kind of bar, the steps of the main tracks
      const cells = [];
      for (let i = 0; i < beat.totalBars; i++) { const v = barView(beat, i, true); CORE.forEach(n => { const t = v.tracks[n] || []; for (let s = 0; s < 16; s++) cells.push(t[s] ? 1 : 0); }); }
      return cells;
    };
    const dist = (a, b) => { const n = Math.min(a.length, b.length); let d = 0, u = 0; for (let i = 0; i < n; i++) { if (a[i] !== b[i]) d++; if (a[i] || b[i]) u++; } return u ? d / u : 0; };
    let seed = 1000;
    for (const g of Object.keys(_templates)) for (const st of _templates[g].styleOrder) {
      const key = g + '/' + st, rec = { mains: {}, lifts: {}, extras: {}, repeatMain: 0, dSpice: [], dBase: [], audible: [], voiceMain: 0, issues: 0, layersSpice: [], layersBase: [], backbeatLost: 0, backbeatBars: 0, backbeatLostBase: 0 };
      let prev = null, prevSig = null, prevBase = null;
      for (let k = 0; k < N; k++) {
        seed++;
        // same random stream with and without the spice, to compare
        const saveRoll = window.spiceRoll;
        Math.random = mulberry(seed); const beat = generatePattern(g, { style: st, structure: 'full', from: prev }); Math.random = real;
        window.spiceRoll = undefined; Math.random = mulberry(seed); const base = generatePattern(g, { style: st, structure: 'full' }); Math.random = real; window.spiceRoll = saveRoll;
        const sp = beat.spice;
        if (!sp) { out.problems.push(key + ' no spice'); continue; }
        rec.mains[sp.id] = (rec.mains[sp.id] || 0) + 1; rec.lifts[sp.lift.id] = (rec.lifts[sp.lift.id] || 0) + 1; rec.extras[sp.extra.id] = (rec.extras[sp.extra.id] || 0) + 1;
        if (prev && prev.spice && prev.spice.id === sp.id) rec.repeatMain++;
        const s1 = sig(beat), s0 = sig(base);
        if (prevSig) rec.dSpice.push(dist(s1, prevSig));
        if (prevBase) rec.dBase.push(dist(s0, prevBase));
        rec.audible.push(dist(s1, s0));
        // validity + audibility + layers
        let claimHits = 0, claimBars = 0, layersS = 0, layersB = 0, nb = 0;
        for (let i = 0; i < beat.totalBars; i++) {
          const v = barView(beat, i, true), vb = barView(base, i, true); nb++;
          layersS += TR.filter(n => v.present[n] && v.tracks[n] && v.tracks[n].some(Boolean)).length;
          layersB += TR.filter(n => vb.present[n] && vb.tracks[n] && vb.tracks[n].some(Boolean)).length;
          for (const n of TR) {
            const t = v.tracks[n]; if (!t) continue;
            if (t.length !== 16 || t.some(x => x !== 0 && x !== 1)) { rec.issues++; out.problems.push(key + ' bad track ' + n + ' bar ' + i); }
            if (!v.present[n] && t.some(Boolean)) { rec.issues++; out.problems.push(key + ' hit on absent ' + n + ' bar ' + i + ' ' + sp.id); }
            const ve = v.velocities[n]; if (ve && ve.some((x, s) => (t[s] ? !(x > 0 && x <= 1) : x !== 0))) { rec.issues++; out.problems.push(key + ' velocity mismatch ' + n + ' bar ' + i); }
            if (v.offsets[n] && v.offsets[n].some(x => !isFinite(x))) { rec.issues++; out.problems.push(key + ' bad offset ' + n); }
            const dur = v.durations[n]; if (dur && dur.some((x, s) => (t[s] ? !(x > 0) : x !== 0))) { rec.issues++; out.problems.push(key + ' duration mismatch ' + n + ' bar ' + i + ' ' + sp.id); }
          }
          for (const n of Object.keys(v.doubles || {})) for (const s of Object.keys(v.doubles[n])) if (!(v.tracks[n] && v.tracks[n][+s]) || !['double','triplet'].includes(v.doubles[n][s])) { rec.issues++; out.problems.push(key + ' bad double ' + n + s); }
          const kind = v.kind;
          if (['verse','chorus'].includes(kind) && !v.isFill) { const vb2 = vb; const bb0 = (vb2.tracks.snare[4] || vb2.tracks.snare[12] || vb2.tracks.clap[4] || vb2.tracks.clap[12] || vb2.tracks.rim[4] || vb2.tracks.rim[12] || vb2.tracks.snare[8] || vb2.tracks.clap[8]); if (!bb0) rec.backbeatLostBase++; }
          if (CLAIM[sp.id] && ['verse','chorus'].includes(kind) && !v.isFill && !(i === beat.totalBars)) { const need = CLAIM[sp.id](sp.p || {}); if (sp.id !== 'half' || kind === 'chorus') { claimBars++; if (need.some(n => v.tracks[n] && v.tracks[n].some(Boolean))) claimHits++; } }
          // the backbeat survives (except in half-time): snare or clap on 4 or 12
          if (['verse','chorus'].includes(kind) && !v.isFill && v.present.snare || v.present.clap) { if (['verse','chorus'].includes(kind) && !v.isFill) { rec.backbeatBars++; const bb = (v.tracks.snare[4] || v.tracks.snare[12] || v.tracks.clap[4] || v.tracks.clap[12] || v.tracks.rim[4] || v.tracks.rim[12] || v.tracks.snare[8] || v.tracks.clap[8]); if (!bb) rec.backbeatLost++; } }
        }
        rec.layersSpice.push(layersS / nb); rec.layersBase.push(layersB / nb);
        rec.audible.push(0); rec.audible.pop();
        rec.claim = rec.claim || [0, 0]; rec.claim[0] += claimHits; rec.claim[1] += claimBars;
        prev = beat; prevSig = s1; prevBase = s0;
      }
      out.styles[key] = rec;
    }
    return out;
  }, N);
  console.log(JSON.stringify({ errs, res }));
  await b.close();
})();
