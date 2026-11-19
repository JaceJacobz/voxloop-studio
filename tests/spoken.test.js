"use strict";
// Melodic flow vs rap: a line that clearly holds notes is sung (even if it slides) and is tuned when it clashes with the beat's key;
// a rap contour (it only glides) stays exactly as performed; a melody already in key is not touched. Synthetic voices: a regression
// check for the decision, not a promise about tone. (Found on a real Afrobeats cover: 194 of 219 notes were called "speech" and left
// alone, so only 64% of the vocal ended up in the beat's key; with this it is 91%.)
const S = require("./synth-voice");
const eng = S.loadTuneEngine();
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m.padEnd(70) + (x || "")); };
const base = { rootPc: 6, scale: "minor", refCents: 0, strength: 1, retuneMs: 35, minRetuneMs: 35, flatten: 0.5, manualSemitones: 0, autoTranspose: false, selective: true, selectiveCents: 6, selectiveSoftCents: 14, spokenSung: false, natural: true, adaptive: true };
const inKey = new Set([6, 8, 9, 11, 1, 2, 4]);                                   // F# minor = A major
function share(x, sr) { const tr = eng.trackClean(x, sr); let n = 0, k = 0; for (const m of tr.midi) { if (isNaN(m)) continue; n++; if (inKey.has(((Math.round(m) % 12) + 12) % 12)) k++; } return n ? k / n : 0; }
const run = (x, sr, o) => eng.process([x], sr, Object.assign({}, base, o || {}));

// 1. rap: stays as performed
const rap = S.render(S.rapped(150, 12, 22), { tract: 1, sibHz: 5400, seed: 3 });
const rN = run(rap.x, rap.sr), sel = rN.selective;
ok((sel.melodicLifted || 0) === 0 && sel.spokenLeft > 100, "a rap contour is not lifted: it stays as performed", "lifted " + sel.melodicLifted + ", left as performed " + sel.spokenLeft);
ok(Math.abs(share(rN.audio.tuned[0], rap.sr) - share(rap.x, rap.sr)) < 0.05, "...and its key fit does not change", (100 * share(rap.x, rap.sr)).toFixed(0) + "% -> " + (100 * share(rN.audio.tuned[0], rap.sr)).toFixed(0) + "%");

// 2. melodic FLOW that clashes with the key, built the way a real take looks to the tracker: confident (0.92), short notes that each
//    slide a little (so the per-note test calls them speech), but every note holds a pitch for >= 120 ms. The pitch track is built
//    directly, so the decision is tested exactly (no synthesis quirks).
function makeTrack(kind, seed) {
  let sd = seed; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const hop = 256, sr = 44100, hopS = hop / sr, midi = [], conf = [], degs = [0, 2, 4, 5, 7, 9, 11];
  let deg = 4, t = 0;
  for (let ln = 0; ln < 8; ln++) {                                              // 8 lines of ~12 notes, a gap between lines
    for (let i = 0; i < 12; i++) {
      deg = Math.max(0, Math.min(13, deg + Math.round((rnd() - 0.5) * 5)));
      const m = 55 + 12 * Math.floor(deg / 7) + degs[deg % 7];                      // G major: clashes with F# minor
      const dur = 0.13 + rnd() * 0.04, n = Math.round(dur / hopS), glide = (rnd() < 0.5 ? -1 : 1) * (0.2 + rnd() * 0.3);   // short notes, each sliding 40-100 cents
      for (let k = 0; k < n; k++) {
        if (kind === "rap") midi.push(m + 2.5 * Math.sin(k / n * Math.PI * 2 + rnd() * 6));       // a rap contour: it only glides, no pitch holds
        else midi.push(m + glide * (k / n * 2 - 1) + (rnd() - 0.5) * 0.06);                         // a melody: each note slides a little but holds
        conf.push(0.92);
      }
    }
    for (let k = 0; k < Math.round(0.5 / hopS); k++) { midi.push(NaN); conf.push(0); }
  }
  return { sampleRate: sr, hop, midi: Float32Array.from(midi), conf: Float32Array.from(conf) };
}
const planWith = (kind, o) => { const tr = makeTrack(kind, 9); const notes = eng.segmentNotes(tr.midi); return eng.planCorrection(tr, notes, Object.assign({}, base, o || {})).selective; };
const flowOld = planWith("melody", { spokenAuto: false }), flowNew = planWith("melody");
ok(flowOld.spokenLeft >= 10, "(the case: the old logic calls this melodic flow speech and leaves it alone)", "old left " + flowOld.spokenLeft + " notes as performed");
ok(flowNew.melodicLifted >= 5 && flowNew.spokenLeft < flowOld.spokenLeft, "a melodic line that clashes with the key is lifted", "lifted " + flowNew.melodicLifted + ", left as speech " + flowNew.spokenLeft + " (old: " + flowOld.spokenLeft + ")");
ok(flowNew.lines.length >= 6 && flowNew.lines.every((L) => L.held > 0.2) && flowNew.lines.some((L) => L.clash > 0.5), "the report carries the evidence for each line", "held " + flowNew.lines[0].held + ", clash " + flowNew.lines[0].clash);
const rapOld = planWith("rap", { spokenAuto: false }), rapNew = planWith("rap");
ok((rapNew.melodicLifted || 0) === 0 && rapNew.spokenLeft === rapOld.spokenLeft, "a rap contour on the same notes is not lifted: it stays as performed", "lifted " + rapNew.melodicLifted + ", left " + rapNew.spokenLeft);

// 3. the switch: off gives the old behaviour exactly
ok((flowOld.melodicLifted || 0) === 0, "with the switch off nothing is lifted (the old behaviour)");

// 4. a melody already in key is not touched by it
const scaleDegs = [0, 2, 3, 5, 7, 8, 10];                                          // F# minor
let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const plan = []; let t = 0.3, deg = 4;
for (let i = 0; i < 36; i++) { deg = Math.max(0, Math.min(13, deg + Math.round((rnd() - 0.5) * 4))); const m = 54 + 12 * Math.floor(deg / 7) + scaleDegs[deg % 7] + (rnd() - 0.5) * 0.24, dur = 0.4 + rnd() * 0.5; plan.push({ t0: t, dur, vowel: i % 5, hz: () => 440 * Math.pow(2, (m - 69) / 12) }); t += dur + 0.05; }
const inkey = S.render(plan, { tract: 1, sibHz: 5400, seed: 5 });
const a = run(inkey.x, inkey.sr, { spokenAuto: false }).selective, b = run(inkey.x, inkey.sr).selective;
ok(a.corrected === b.corrected && a.partial === b.partial && a.skipped === b.skipped, "a melody already in the key gets exactly the same treatment", "corrected " + b.corrected + ", partial " + b.partial + ", left " + b.skipped);

// 5. "Land every note on the key": held notes land closer to the key, fragments glide instead of snapping, and it does not make the
//    take less natural (no more big pitch jumps than the raw take, vibrato mostly kept).
const distKey = (m) => { let b = 1e9; for (const pc of inKey) { let d = ((m - pc) % 12 + 12) % 12; d = Math.min(d, 12 - d); b = Math.min(b, d * 100); } return b; };
const med = (a) => { a = a.filter((x) => !isNaN(x)).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };
function flow(seed, tonic, secs) {                                                 // fast melodic flow: short notes, each sliding, in a clashing key
  let sd = seed; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const degs = [0, 2, 4, 5, 7, 9, 11], pl = []; let t = 0.3, dg = 4;
  while (t < secs) { dg = Math.max(0, Math.min(13, dg + Math.round((rnd() - 0.5) * 5))); const m = tonic + 12 * Math.floor(dg / 7) + degs[dg % 7], dur = 0.11 + rnd() * 0.25, gl = (rnd() < 0.5 ? -1 : 1) * 0.35;
    pl.push({ t0: t, dur, vowel: Math.floor(rnd() * 5), hz: (tt) => 440 * Math.pow(2, (m + gl * (Math.min(1, tt / dur) * 2 - 1) - 69) / 12) }); t += dur + 0.03 + (rnd() < 0.12 ? 0.4 : 0); }
  return pl;
}
const fv = S.render(flow(8, 55, 24), { tract: 1, sibHz: 5400, seed: 3 });
const t0 = eng.trackClean(fv.x, fv.sr), hopS = t0.hop / fv.sr, fnotes = eng.segmentNotes(t0.midi).filter((n) => (n.end - n.start) * hopS >= 0.07);
function coreStats(o) {
  const r = eng.process([fv.x], fv.sr, Object.assign({}, base, { spokenAuto: true }, o)), t1 = eng.trackClean(r.audio.tuned[0], fv.sr);
  const cores = fnotes.map((n) => med(Array.from(t1.midi.slice(Math.round(n.start + (n.end - n.start) * 0.3), Math.round(n.start + (n.end - n.start) * 0.8))))).filter((x) => !isNaN(x)).map(distKey);
  let jumps = 0, prev = NaN; for (const m of t1.midi) { if (isNaN(m)) { prev = NaN; continue; } if (!isNaN(prev) && Math.abs(m - prev) * 100 > 100) jumps++; prev = m; }
  return { w10: cores.filter((c) => c <= 10).length / cores.length, w25: cores.filter((c) => c <= 25).length / cores.length, jumps, glided: r.selective.glided || 0 };
}
let rawJumps = 0, pv = NaN; for (const m of t0.midi) { if (isNaN(m)) { pv = NaN; continue; } if (!isNaN(pv) && Math.abs(m - pv) * 100 > 100) rawJumps++; pv = m; }
const cur = coreStats({ glideShort: false }), land = coreStats({ lockMelodic: true, settleShortNotes: true });
ok(land.w10 >= cur.w10 + 0.03, "landing every note puts more held notes within 10 cents of the key", Math.round(100 * cur.w10) + "% -> " + Math.round(100 * land.w10) + "%");
ok(land.w25 >= cur.w25, "...and within 25 cents", Math.round(100 * cur.w25) + "% -> " + Math.round(100 * land.w25) + "%");
// snapping notes onto discrete pitches creates some real note-to-note steps, so allow a modest rise (on the real vocal it FELL: 29 -> 20)
ok(land.jumps <= rawJumps * 1.25 + 2, "...without a pile of extra big pitch jumps (no stair-stepping)", "raw " + rawJumps + ", landed " + land.jumps);
ok(land.glided > 0 && cur.glided === 0, "fast-slide fragments glide instead of being snapped (and not when glide is off)", "glided " + land.glided);
const offSw = coreStats({ lockMelodic: false, settleShortNotes: false, glideShort: false });
ok(Math.abs(offSw.w10 - cur.w10) < 0.01 && offSw.glided === 0, "with the switch off it behaves as before");
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
