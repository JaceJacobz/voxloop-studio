// Vocal Sketch analysis test: synthesises a sung melody (vibrato, breath noise, a flat voice) at a known tempo and checks that
// the notes, the key, the grid positions and the chords come back right. Run:  node tests/vocaldsp.js
const D = require('../js/vocaldsp.js');
const SR = 16000;
function sing(notes, bpm, opts) {                      // notes: [startBeat, lenBeats, midi]
  opts = opts || {}; const spb = 60 / bpm, total = Math.ceil((notes.reduce((m, n) => Math.max(m, n[0] + n[1]), 0) + 1) * spb * SR);
  const x = new Float32Array(total); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (const [sb, lb, midi] of notes) {
    const a = Math.floor(sb * spb * SR), n = Math.floor(lb * spb * SR * 0.92), f0 = 440 * Math.pow(2, (midi + (opts.cents || 0) / 100 - 69) / 12); let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, env = Math.min(1, i / 600) * Math.min(1, (n - i) / 900), vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t);
      ph += 2 * Math.PI * f0 * vib / SR;
      let v = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph) + 0.12 * Math.sin(4 * ph);
      x[a + i] += (v * 0.25 + rnd() * 0.02) * env;
    }
  }
  for (let i = 0; i < total; i++) x[i] += rnd() * 0.004;     // room noise
  return x;
}
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  // A minor, 94 BPM: A3 C4 E4 D4 | C4 A3 ... a pickup-free two-bar phrase, repeated for 4 bars. midi: A3=57 C4=60 D4=62 E4=64 G4=67
  const bpm = 94, phrase = [[0, 1, 57], [1, 1, 60], [2, 1, 64], [3, 1, 62], [4, 1.5, 60], [5.5, 0.5, 57], [6, 2, 57]];
  const song = []; for (let r = 0; r < 2; r++) phrase.forEach(([s, l, m]) => song.push([s + r * 8, l, m]));
  for (const [label, cents] of [['in tune', 0], ['35 cents flat', -35]]) {
    const x = sing(song, bpm, { cents });
    const frames = await D.trackPitch(x, {}); const seg = D.segmentNotes(frames);
    const grid = D.toGrid(seg.notes, bpm, 0);
    // every sung note must come back with its pitch near its grid step (two notes of one pitch with a tiny gap may merge: allowed)
    const found = song.filter(([sb, lb, m]) => grid.some(g => g.pitch === m && Math.abs(g.abs - Math.round(sb * 4)) <= 1)).length;
    ok(found >= song.length - 2, label + ': ' + found + ' of ' + song.length + ' sung notes found with the right pitch and step');
    ok(seg.notes.length <= song.length + 2, label + ': no stray notes (' + seg.notes.length + ' found)');
    const key = D.detectKey(grid.map(g => ({ pitch: g.pitch, len: g.len })));
    ok(key.best && key.best.root === 9 && key.best.scale === 'minor', label + ': key ' + JSON.stringify(key.best && [key.best.root, key.best.scale]) + ' (expect 9 minor), confidence ' + key.confidence.toFixed(2));
    const ch = D.fitChords(grid, { root: 9, scale: 'minor' }, 4, 1);
    console.log('       chord options (degrees):', ch.map(o => o.join('')).join('  '));
    ok(ch.every(o => o.length === 4) && ch[0][0] === 0, label + ': four chords per option, starting on i');
  }
  // a melody that outlines i, VI, VII, v in A minor: bar by bar A C E | F A C | G B D | E G B
  const outline = [[0,1,57],[1,1,60],[2,2,64],[4,1,65],[5,1,69],[6,2,72-12],[8,1,67],[9,1,71],[10,2,62+12],[12,1,64],[13,1,67],[14,2,71]];
  const og = D.toGrid(D.segmentNotes(await D.trackPitch(sing(outline, bpm), {})).notes, bpm, 0);
  const oc = D.fitChords(og, { root: 9, scale: 'minor' }, 4, 1);
  console.log('       outlined chords (degrees):', oc.map(o => o.join('')).join('  '));
  ok(oc[0].join('') === '0562' || oc[0].join('') === '0564' || oc[0].join('') === '0563', 'chords follow the melody: i VI VII (then v/iv) -> ' + oc[0].join(''));
  // an octave jump the tracker must not follow, a low male voice, and a high one
  for (const shift of [-12, 12]) {
    const x = sing(song.map(([s, l, m]) => [s, l, m + shift]), bpm); const seg = D.segmentNotes(await D.trackPitch(x, {}));
    const key = D.detectKey(D.toGrid(seg.notes, bpm, 0).map(g => ({ pitch: g.pitch, len: g.len })));
    ok(key.best && key.best.root === 9 && key.best.scale === 'minor', 'shifted ' + shift + ' semitones: key still A minor');
  }
  // a major tune: C major, G4 E4 C4 ...
  const maj = [[0, 1, 60], [1, 1, 64], [2, 1, 67], [3, 1, 64], [4, 2, 65], [6, 2, 64], [8, 1, 62], [9, 1, 62], [10, 1, 60], [11, 1, 59], [12, 4, 60]];
  const km = D.detectKey(D.toGrid(D.segmentNotes(await D.trackPitch(sing(maj, bpm), {})).notes, bpm, 0).map(g => ({ pitch: g.pitch, len: g.len })));
  ok(km.best && km.best.root === 0 && km.best.scale === 'major', 'major tune: key ' + JSON.stringify(km.best && [km.best.root, km.best.scale]) + ' (expect 0 major)');
  // tempo of a pulse train (a voice note with no click)
  const pulse = new Float32Array(SR * 12); for (let b = 0; b < 12 * 100 / 60; b++) { const a = Math.floor(b * 0.6 * SR); for (let i = 0; i < 1200 && a + i < pulse.length; i++) pulse[a + i] = Math.sin(i * 0.3) * Math.exp(-i / 300); }
  const tp = D.estimateTempo(pulse); ok(Math.abs(tp - 100) <= 3, 'tempo guess ' + tp + ' (expect 100)');
  // rap: 10 onsets a bar
  const rap = []; for (let b = 0; b < 8; b++) for (let k = 0; k < 10; k++) rap.push([b * 4 + k * 0.4, 0.18, 55]);
  const fl = D.flow(sing(rap, 94), 94, 0, 8); ok(fl.level === 'fast' || fl.level === 'medium', 'rap flow: ' + fl.density.toFixed(1) + ' syllables a bar -> ' + fl.level);
  // chords from the notes: a wobbly singer (every note about 25 cents sharp) over A minor, F, C, G (one chord a bar, 4 notes a bar)
  const prog = [[57, 60, 64, 60], [53, 57, 60, 57], [48, 52, 55, 52], [55, 59, 62, 59]], tnotes = [];
  prog.forEach((bar, b) => bar.forEach((m, i) => tnotes.push({ t: b * 2.4 + i * 0.6, dur: 0.5, midi: m + 0.25 + (i % 2 ? -0.1 : 0.1) })));
  const tri = D.fitTriads(tnotes, 100, 0, 4, 1, null)[0], names = tri.map(c => c.root + (c.minor ? 'm' : ''));
  ok(names.join(' ') === '9m 5 0 7', 'triads from a sharp, wobbly tune: ' + names.join(' ') + ' (expect 9m 5 0 7 = Am F C G)');
  ok(D.triadFit(tri, tnotes, 100, 0, 4, 1) > 0.9, 'those chords cover the notes: ' + D.triadFit(tri, tnotes, 100, 0, 4, 1).toFixed(2));
  const bad = [0, 0, 0, 0].map(r => ({ root: r, minor: false })); ok(D.triadFit(bad, tnotes, 100, 0, 4, 1) < 0.8, 'one wrong chord for all four bars covers less: ' + D.triadFit(bad, tnotes, 100, 0, 4, 1).toFixed(2));
  // tap along: someone taps the beat at 113.9 BPM, beat line at 1.036 s, +-25 ms of human wobble, a double tap and two missed beats
  { let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, spb = 60 / 113.9, taps = [];
    for (let k = 0; k < 24; k++) { if (k === 5 || k === 13) continue; taps.push(1.036 + k * spb + (rnd() - 0.5) * 0.05); if (k === 9) taps.push(1.036 + k * spb + 0.06); }
    const f = D.fitTaps(taps, 110);
    ok(f && Math.abs(f.bpm - 113.9) < 0.5, 'taps: tempo ' + (f && f.bpm.toFixed(2)) + ' (expect 113.9)');
    ok(f && Math.abs(((f.phase - 1.036) % spb + spb * 1.5) % spb - spb / 2) < 0.02, 'taps: beat line within 20 ms');
    ok(D.fitTaps([1, 1.5, 2], 120) === null, 'taps: too few taps give nothing'); }
  // groove: sung eighth notes straight vs swung (off-beats at 2/3), with 30 ms of wobble and a 90 ms constant lag
  { let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, spb = 60 / 100;
    const mk = off => { const n = []; for (let k = 0; k < 40; k++) { n.push({ t: 0.09 + k * spb + (rnd() - 0.5) * 0.06, dur: 0.3 }); n.push({ t: 0.09 + k * spb + off * spb + (rnd() - 0.5) * 0.06, dur: 0.25 }); } return n; };
    const st = D.swingOf(mk(0.5), 100), sw = D.swingOf(mk(0.667), 100);
    ok(st && st.s < 0.25, 'straight eighths read as straight: ' + (st && st.s.toFixed(2)));
    ok(sw && sw.s > 0.7 && sw.s < 1.3, 'swung eighths read as swung: ' + (sw && sw.s.toFixed(2)));
    ok(st && st.r > 0.8 && sw && sw.r > 0.45, 'on the grid: confidence is high (' + (st && st.r.toFixed(2)) + ', ' + (sw && sw.r.toFixed(2)) + ')');
    const scatter = []; for (let k = 0; k < 80; k++) scatter.push({ t: rnd() * 40, dur: 0.3 }); const sc = D.swingOf(scatter, 100);
    ok(!sc || sc.r < 0.35, 'a random scatter has low confidence: ' + (sc && sc.r.toFixed(2)));
    ok(D.swingOf([{ t: 0, dur: 0.3 }], 100) === null, 'too few notes give nothing'); }
  console.log(fails ? '\nVOCAL DSP TEST FAILED' : '\nVocal DSP test passed.'); process.exit(fails ? 1 : 0);
})();
