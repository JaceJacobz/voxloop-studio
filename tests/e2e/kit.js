// The kit designer in a real browser (v2.27.0). Needs the app served on :8080 (PORT=... to change).
// What this proves: a new beat carries its own kit design, second percussion, mix and tone; the notes and patterns a seed makes are exactly
// what they were without the designer; the engine plays reshaped recordings (not the raw ones) and the second percussion on the hits between
// the beats; an older beat (no design) still plays the raw recordings with the style's own reverb; Beat Lab's Sound panel and a variation of a
// beat keep working; the download renders and a second download of the same beat is the same sound. It does NOT judge how it sounds.
let chromium; try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e) { ({ chromium } = require('playwright')); }
let bad = 0; const check = (n, ok, x) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const PORT = process.env.PORT || 8080;

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 420, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errs.push('console.error ' + m.text().slice(0, 200)); });
  await p.goto('http://localhost:' + PORT + '/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const m = document.querySelector('.mode-btn[data-mode=beatlab]'); if (m) m.click(); }); await p.waitForTimeout(800);

  // ---------- A: the designer changes the sound and nothing else
  // (The generator remembers a little between beats, so the same seed is not the same beat twice in a row; the proof that a seed makes the same
  // notes as before was made by running one sequence of 94 seeded beats on this version and on v2.26.2 and comparing them one by one.
  // Here: the designer adds only its own fields and never draws a random number.)
  const A = await p.evaluate(() => {
    const real = Math.random, orig = window.kitApply, out = [];
    let calls = 0, draws = 0, touched = [];
    window.kitApply = function (sound, ...rest) {
      const before = JSON.stringify(sound), r0 = Math.random; let d = 0; Math.random = () => { d++; return r0(); };
      const res = orig(sound, ...rest); Math.random = r0; draws += d; calls++;
      const c = JSON.parse(JSON.stringify(res)); delete c.mix; delete c.tone; ['dsn', 'perc2', 'bell2'].forEach((k) => delete c.drums[k]);
      if (JSON.stringify(c) !== before) touched.push('changed more than its own fields');
      return res;
    };
    const beats = [];
    for (const [g, s] of [['afrobeats', 'afropop'], ['afrobeats', 'smooth'], ['afrobeats', 'afrofusion'], ['amapiano', 'classic'], ['afrohouse', 'deephouse'], ['rnb', 'slowjam'], ['trap', 'hardtrap'], ['afrolust', 'velvet']])
      for (const st of ['loop', 'song']) beats.push(generatePattern(g, { style: s, structure: st }));
    window.kitApply = orig;
    const has = beats.map((x) => !!(x.sound.drums.dsn && x.sound.drums.perc2 && x.sound.drums.bell2 && x.sound.mix && x.sound.tone));
    const distinct = new Set(beats.map((x) => JSON.stringify(x.sound.drums.dsn))).size, distinctMix = new Set(beats.map((x) => JSON.stringify(x.sound.mix))).size;
    return { calls, draws, touched, has, n: beats.length, distinct, distinctMix };
  });
  check('A: the designer draws no random numbers (so the notes and patterns a seed makes are what they were)', A.draws === 0 && A.calls === A.n, A.draws + ' draws in ' + A.calls + ' calls');
  check('A: it adds only its own fields (design, perc2, bell2, mix, tone) to the sound', A.touched.length === 0, A.touched.join(', '));
  check('A: every new beat carries a kit design, a second percussion and bell, a mix and a tone', A.has.every(Boolean), A.has.filter(Boolean).length + ' of ' + A.n);
  check('A: no two beats share a kit design or a mix', A.distinct === A.n && A.distinctMix === A.n, A.distinct + ' kits, ' + A.distinctMix + ' mixes in ' + A.n + ' beats');

  // ---------- B: the engine plays the design
  const B = await p.evaluate(async () => {
    const beat = generatePattern('afrobeats', { style: 'afropop', structure: 'loop' });
    await new Promise((r) => { useBeat(beat, 'x', 'y'); setTimeout(r, 4000); });
    const E = engine, d = beat.sound.drums, raw = (v) => SAMPLE_BANK[sampleKey(d.genre, v.replace(/2$/, ''), d[v])];
    const res = { ready: samplesReady(d), voices: drumVoices(d).length };
    res.reshaped = Object.fromEntries(['kick', 'snare', 'clap', 'hat', 'perc', 'perc2', 'bell2'].map((v) => [v, !!E.kitSamples[v] && E.kitSamples[v] !== raw(v)]));
    res.hasAll = drumVoices(d).every(([v]) => !!E.kitSamples[v]);
    res.mixApplied = !!E.mix && Math.abs(E.mix.rev - beat.sound.mix.rev) < 1e-9;
    // the second percussion plays on the hits between the beats
    const played = []; const perc = E.instruments.perc, orig = perc.play.bind(perc); perc.play = (buf, t, g, r) => { played.push({ buf, r }); };
    E.voices.perc(Tone.now() + 1, 0.8, { step: 2 }); E.voices.perc(Tone.now() + 1, 0.8, { step: 3 });
    perc.play = orig;
    res.evenFirst = played[0] && played[0].buf === E.kitSamples.perc; res.oddSecond = played[1] && played[1].buf === E.kitSamples.perc2 && Math.abs(played[1].r - 1) < 0.02;
    res.tone = beat.sound.tone;
    return res;
  });
  check('B: the beat\'s sounds all loaded (the nine drums, perc2 and bell2)', B.ready && B.voices === 11, B.voices + ' voices');
  check('B: the engine plays reshaped copies, not the raw recordings (kick, snare, clap, hat, perc, perc2, bell2)', Object.values(B.reshaped).every(Boolean), JSON.stringify(B.reshaped));
  check('B: every voice has a buffer', B.hasAll);
  check('B: the beat\'s own mix reached the engine', B.mixApplied);
  check('B: hits on the beat play the first percussion, hits between the beats the second one (not just nudged up)', B.evenFirst && B.oddSecond);

  // ---------- C: an older beat plays as it always did
  const C = await p.evaluate(async () => {
    const beat = generatePattern('afrobeats', { style: 'smooth', structure: 'loop' });
    const old = JSON.parse(JSON.stringify(beat)); delete old.sound.mix; delete old.sound.tone; ['dsn', 'perc2', 'bell2'].forEach((k) => delete old.sound.drums[k]);
    await new Promise((r) => { useBeat(old, 'x', 'y'); setTimeout(r, 3500); });
    const E = engine, d = old.sound.drums, t = resolveTemplate(old.genre, old.style), res = {};
    res.raw = SAMPLE_TYPES.every((v) => E.kitSamples[v] === SAMPLE_BANK[sampleKey(d.genre, v, d[v])]);
    res.noExtras = !E.kitSamples.perc2 && !E.kitSamples.bell2;
    res.mix = E.mix && E.mix.rev === 1 && E.mix.dec === 1 && E.mix.dly === 1 && E.mix.air === 0;
    res.decay = Math.abs(E.reverbDecay - t.fx.reverb.decay) < 0.02;
    const played = []; const perc = E.instruments.perc, orig = perc.play.bind(perc); perc.play = (buf, tt, g, r) => { played.push({ buf, r }); };
    E.voices.perc(Tone.now() + 1, 0.8, { step: 3 }); perc.play = orig;
    res.nudged = played[0] && played[0].buf === E.kitSamples.perc && Math.abs(played[0].r - 1.09) < 0.02;
    return res;
  });
  check('C: an older beat (no design) plays the raw recordings', C.raw && C.noExtras);
  check('C: an older beat has the style\'s own reverb and the plain mix', C.mix && C.decay);
  check('C: an older beat still plays the between-the-beats percussion as the same drum nudged up', C.nudged);

  // ---------- D: the Sound panel, a variation and Studio hand-over keep the design
  const D = await p.evaluate(async () => {
    const res = {};
    const beat = generatePattern('amapiano', { style: 'classic', structure: 'loop' });
    await new Promise((r) => { useBeat(beat, 'x', 'y'); setTimeout(r, 3500); });
    const before = JSON.stringify(current.sound.drums.dsn), n = current.sound.drums.kick % 5 + 1;
    setDrumPick('kick', n); await new Promise((r) => setTimeout(r, 1500));
    res.pick = current.sound.drums.kick === n && JSON.stringify(current.sound.drums.dsn) === before && !!engine.kitSamples.kick;
    const v = generatePattern('amapiano', { style: 'classic', structure: 'loop', from: current, lockGroups: ['drums'], keepSound: true });
    res.keptKick = ['kick', 'snare', 'clap', 'rim'].every((t) => JSON.stringify(v.sound.drums.dsn[t]) === JSON.stringify(current.sound.drums.dsn[t]) && v.sound.drums[t] === current.sound.drums[t]);   // the whole 'drums' group
    res.keptMix = JSON.stringify(v.sound.mix) === JSON.stringify(current.sound.mix) && JSON.stringify(v.sound.tone) === JSON.stringify(current.sound.tone);
    res.newHat = JSON.stringify(v.sound.drums.dsn.hat) !== JSON.stringify(current.sound.drums.dsn.hat) && JSON.stringify(v.sound.drums.dsn.perc) !== JSON.stringify(current.sound.drums.dsn.perc);   // hats and percussion are other groups: not locked
    const copy = JSON.parse(JSON.stringify(current.sound)); res.json = !!(copy.drums.dsn && copy.mix && copy.tone);        // what a Studio session receives
    return res;
  });
  check('D: choosing another kick in the Sound panel keeps the kit design', D.pick);
  check('D: locking the drums in a variation keeps the kick, snare, clap and rim designs; hats and percussion get new ones', D.keptKick && D.newHat);
  check('D: a variation that keeps the sound keeps its mix and tone', D.keptMix);
  check('D: the design survives a JSON copy (what a Studio session receives)', D.json);

  // ---------- F: the "New kit" button
  const F = await p.evaluate(async () => {
    const beat = generatePattern('afrobeats', { style: 'smooth', structure: 'loop' });
    await new Promise((r) => { useBeat(beat, 'x', 'y'); setTimeout(r, 3500); });
    const before = { dsn: JSON.stringify(current.sound.drums.dsn), mix: JSON.stringify(current.sound.mix), tone: JSON.stringify(current.sound.tone), picks: SAMPLE_TYPES.map((t) => current.sound.drums[t]).join(), tracks: JSON.stringify(current.tracks), kick: engine.kitSamples.kick, rev: engine.mix.rev, harm: JSON.stringify(current.sound.chords) };
    document.getElementById('bl-newKit').click(); await new Promise((r) => setTimeout(r, 2500));
    return { changedKit: JSON.stringify(current.sound.drums.dsn) !== before.dsn, changedMix: JSON.stringify(current.sound.mix) !== before.mix, changedTone: JSON.stringify(current.sound.tone) !== before.tone,
      samePicks: SAMPLE_TYPES.map((t) => current.sound.drums[t]).join() === before.picks, sameNotes: JSON.stringify(current.tracks) === before.tracks && JSON.stringify(current.sound.chords) === before.harm,
      engineNew: engine.kitSamples.kick !== before.kick, engineMix: Math.abs(engine.mix.rev - current.sound.mix.rev) < 1e-9, hasAll: drumVoices(current.sound.drums).every(([v]) => !!engine.kitSamples[v]), status: document.getElementById('bl-status') ? document.getElementById('bl-status').textContent : '' };
  });
  check('F: New kit draws another kit design, mix and tone', F.changedKit && F.changedMix && F.changedTone);
  check('F: New kit keeps the notes, the pattern and the chosen recordings', F.samePicks && F.sameNotes);
  check('F: New kit reaches the engine (new drum buffers, the new reverb amount)', F.engineNew && F.engineMix && F.hasAll);

  // ---------- E: the download renders, and the same beat downloads the same sound twice
  const render = async () => { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 300000 }), p.evaluate(() => { const t = document.querySelector('.blux-tab[data-tab=export]'); if (t) t.click(); document.getElementById('bl-export').click(); })]); const path = await dl.path(); return require('fs').readFileSync(path); };
  await p.evaluate(async () => { const beat = generatePattern('afrobeats', { style: 'afropop', structure: 'loop' }); await new Promise((r) => { useBeat(beat, 'x', 'y'); setTimeout(r, 3000); }); });
  const w1 = await render(), w2 = await render();
  check('E: the download is a real WAV', w1.length > 100000 && w1.toString('ascii', 0, 4) === 'RIFF', w1.length + ' bytes');
  // (two downloads of one beat are never sample for sample the same, with or without the designer: the reverb builds its tail from fresh noise)
  const rms = (w) => { let s = 0, c = 0; for (let i = 44; i + 1 < w.length; i += 2) { const v = w.readInt16LE(i); s += v * v; c++; } return 20 * Math.log10(Math.sqrt(s / c) / 32768); };
  check('E: downloading the same beat twice gives the same length and loudness', Math.abs(w1.length - w2.length) < w1.length * 0.0005 && Math.abs(rms(w1) - rms(w2)) < 0.3, 'lengths ' + w1.length + '/' + w2.length + ', ' + rms(w1).toFixed(1) + ' / ' + rms(w2).toFixed(1) + ' dB');
  check('E: no page errors', errs.length === 0, errs.join(' | '));

  console.log(bad ? bad + ' problem(s)' : 'all as expected');
  await b.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
