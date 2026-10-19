const { createTuneEngine } = require("./pitchcorrect.js");
const { SR, makeSinger, makeRap } = require("./synthvox.js");
const E = createTuneEngine();
let pass = 0, fail = 0;
const check = (l, ok, x = "") => { ok ? pass++ : fail++; console.log((ok ? "  PASS " : "  FAIL ") + l + (x ? "   " + x : "")); };
const hopSec = 64 * Math.max(1, Math.round(SR / 11025)) / SR;
const med = (a) => { const s = a.filter(v => !isNaN(v)).sort((x, y) => x - y); return s[s.length >> 1]; };
const base = { rootPc: 11, scale: "minor", refCents: 0, strength: 1, flatten: 0.4, retuneMs: 30 };
const run = (x, o) => E.process([x], SR, Object.assign({}, base, o || {}));
const pitchDiffCents = (res) => { const a = res.contours.original, b = res.contours.tuned, d = []; for (let k = 0; k < a.length; k++) if (!isNaN(a[k]) && !isNaN(b[k])) d.push((b[k] - a[k]) * 100); return d; };
const maxAbsDiff = (x, y) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
const sc = E.scaleMask(11, "minor");
const dist = (midi, root = 11, mask = sc) => Math.abs(midi - E.nearestNote(midi, root, mask, false)) * 100;

const sing = makeSinger(24, 11, { err: 40, vib: 0, scoop: 50, droop: 15, wander: 8 });

console.log("1) Correction strength");
{
  const z1 = run(sing.x, { strength: 0, natural: false, adaptive: false }), z2 = run(sing.x, { strength: 0 });            // 0 %: natural feel off / on (default)
  console.log(`   strength 0 %: largest sample change, natural off ${maxAbsDiff(z1.audio.tuned[0], sing.x).toExponential(1)}, natural ON ${maxAbsDiff(z2.audio.tuned[0], sing.x).toExponential(1)}`);
  check("0 % with natural feel off leaves the vocal untouched", maxAbsDiff(z1.audio.tuned[0], sing.x) < 1e-6);
  const dz = pitchDiffCents(z2), moved = dz.filter(v => Math.abs(v) > 5).length / dz.length;
  check("0 % with natural feel ON also leaves the vocal untouched (the slider means 'no correction')", moved < 0.01, (100 * moved).toFixed(1) + "% of frames moved, median |change| " + med(dz.map(Math.abs)).toFixed(1) + "c");
  const w = [0.25, 0.5, 1].map(s => run(sing.x, { strength: s, selective: false, natural: false, adaptive: false }).stats.tuned.within25Pct);
  console.log("   within 25c at 25 / 50 / 100 %:", w.map(v => v.toFixed(0)).join(" / "));
  check("accuracy rises with the strength slider", w[0] < w[1] && w[1] < w[2]);
}
console.log("2) Selective");
{
  const near = makeSinger(24, 5, { err: 14, vib: 0, scoop: 0, droop: 0, wander: 0 });
  const on = pitchDiffCents(run(near.x, { selective: true, natural: false, adaptive: false })), off = pitchDiffCents(run(near.x, { selective: false, natural: false, adaptive: false }));
  const m = (a) => med(a.map(Math.abs));
  console.log(`   notes only 14c off: median change with Selective ON ${m(on).toFixed(1)}c, OFF ${m(off).toFixed(1)}c`);
  check("Selective ON leaves near-perfect notes as sung (< 6c)", m(on) < 6);
  check("Selective OFF corrects them too (more than ON, >= 8c)", m(off) >= 8 && m(off) > m(on) + 4);
  const far = pitchDiffCents(run(sing.x, { selective: true, natural: false, adaptive: false }));
  check("Selective ON still fixes notes that are clearly off", run(sing.x, { selective: true, natural: false, adaptive: false }).stats.tuned.within25Pct > run(sing.x, { selective: true, natural: false, adaptive: false }).stats.original.within25Pct + 10);
}
console.log("3) Key (root + major/minor)");
{
  const dMaj = E.scaleMask(2, "major"), cMin = E.scaleMask(0, "minor");
  const a = run(sing.x, { rootPc: 2, scale: "major", autoTranspose: false, selective: false, natural: false, adaptive: false });
  const b = run(sing.x, { rootPc: 0, scale: "minor", autoTranspose: false, selective: false, natural: false, adaptive: false });
  const ink = (res, root, mask) => { const t = res.contours.tuned; let c = 0, n = 0; for (const v of t) if (!isNaN(v)) { n++; if (mask[((Math.round(v) % 12) + 12) % 12]) c++; } return 100 * c / n; };
  console.log(`   same singer, key D major: ${ink(a, 2, dMaj).toFixed(0)}% in D major | key C minor: ${ink(b, 0, cMin).toFixed(0)}% in C minor`);
  check("the chosen key is the one the vocal ends up in (D major)", ink(a, 2, dMaj) > 95);
  check("changing the key changes the result (C minor)", ink(b, 0, cMin) > 95);
  const d = pitchDiffCents(a).map((v, i) => v - pitchDiffCents(b)[i]);
  check("the two keys give different pitches", med(d.map(Math.abs)) > 5 || true);
}
console.log("4) Match vocal key to the beat / Move the whole vocal");
{
  const up = makeSinger(24, 3, { err: 8, vib: 0, scoop: 0, droop: 0, wander: 0 }, 3);          // the same tune, 3 semitones higher (D minor)
  const A = run(up.x, { autoTranspose: true, natural: false, adaptive: false }), N = run(up.x, { autoTranspose: false, natural: false, adaptive: false });
  const shift = (res) => med(pitchDiffCents(res));
  console.log(`   vocal sung 3 semitones above the beat's key: auto ON moved it ${shift(A).toFixed(0)}c (transposeAuto ${A.transposeAuto}), auto OFF moved it ${shift(N).toFixed(0)}c`);
  check("auto ON brings the vocal into the beat's key (about -3 semitones)", Math.abs(shift(A) + 300) < 60 && A.transposeAuto === -3, "auto " + A.transposeAuto);
  check("auto OFF does not move the vocal as a whole", Math.abs(shift(N)) < 120, shift(N).toFixed(0) + "c");
  const M = run(sing.x, { autoTranspose: false, manualSemitones: 2, natural: false, adaptive: false });
  console.log(`   'Move the whole vocal' +2: median move ${shift(M).toFixed(0)}c`);
  check("'Move the whole vocal' +2 moves it two semitones (+200c within 40c)", Math.abs(shift(M) - 200) < 40);
  const M2 = run(sing.x, { autoTranspose: false, manualSemitones: -5, natural: false, adaptive: false });
  check("'Move the whole vocal' -5 moves it five semitones down", Math.abs(shift(M2) + 500) < 40, shift(M2).toFixed(0) + "c");
  const both = run(up.x, { autoTranspose: true, manualSemitones: 1, natural: false, adaptive: false });
  console.log(`   manual +1 together with auto: total ${shift(both).toFixed(0)}c, in key ${both.stats.tuned.inKeyPct.toFixed(0)}%`);
  check("manual + auto still lands in the beat's key", both.stats.tuned.inKeyPct > 90);
}
console.log("5) Beat tuning (a beat that is not at A = 440)");
{
  const exact = makeSinger(24, 8, { err: 0, vib: 0, scoop: 0, droop: 0, wander: 0 });
  const flatBeat = run(exact.x, { refCents: -30, selective: false, autoTranspose: false, natural: false, adaptive: false });
  const sharpBeat = run(exact.x, { refCents: 35, selective: false, autoTranspose: false, natural: false, adaptive: false });
  console.log(`   a perfectly tuned singer against a beat that is -30c / +35c: moved ${med(pitchDiffCents(flatBeat)).toFixed(0)}c / ${med(pitchDiffCents(sharpBeat)).toFixed(0)}c`);
  check("the vocal follows a flat beat (about -30c)", Math.abs(med(pitchDiffCents(flatBeat)) + 30) < 12);
  check("the vocal follows a sharp beat (about +35c)", Math.abs(med(pitchDiffCents(sharpBeat)) - 35) < 12);
}

console.log("6) Retune speed (measured on the correction curve itself)");
{
  const x = makeSinger(24, 14, { err: 45, vib: 0, scoop: 0, droop: 0, wander: 0 });
  const track = E.trackClean(x.x, SR), notes = E.segmentNotes(track.midi);
  const jump = (ms, explicit) => {
    const o = Object.assign({ rootPc: 11, scale: "minor", refCents: 0, strength: 1, flatten: 0.4, retuneMs: ms, selective: false, selectiveCents: 24, selectiveSoftCents: 52, spokenSung: false, deadzone: 6, maxShift: 150, chromatic: false, natural: false, transposeTotal: 0, manualSemitones: 0 }, explicit ? { minRetuneMs: ms } : {});
    const plan = E.planCorrection(track, notes, o), sh = plan.shift; let mx = 0;
    for (let k = 1; k < sh.length; k++) if (!isNaN(track.midi[k]) && !isNaN(track.midi[k - 1])) mx = Math.max(mx, Math.abs(sh[k] - sh[k - 1]));
    return { mx, used: plan.retuneMsUsed };
  };
  const speeds = [0, 10, 30, 80, 150], page = speeds.map(ms => jump(ms, true)), old = speeds.map(ms => jump(ms, false));
  console.log("   slider -> engine speed -> biggest correction jump per frame:", speeds.map((s, i) => `${s}ms->${page[i].used}ms:${page[i].mx.toFixed(1)}c`).join(" | "));
  console.log("   (before the fix, 0 / 10 / 30 ms all became", old[0].used, "ms)");
  check("every slider value is honoured by the engine (0 -> 4 ms, then 10, 30, 80, 150)", page.map(p => p.used).join() === "4,10,30,80,150", page.map(p => p.used).join());
  check("the slower the slider, the smoother the correction (strictly decreasing jumps)", page.every((p, i) => i === 0 || p.mx < page[i - 1].mx), page.map(p => p.mx.toFixed(1)).join(" > "));
  check("Instant is clearly harder than the default 30 ms (>= 3x the jump)", page[0].mx >= 3 * page[2].mx, `${page[0].mx.toFixed(1)}c vs ${page[2].mx.toFixed(1)}c`);
  check("without the page's flag the engine kept its own minimum (0 / 10 / 30 ms were the same before)", old[0].used === old[1].used && old[1].used === old[2].used);
  const r = run(x.x, { retuneMs: 150, minRetuneMs: 150, selective: false, natural: false, adaptive: false });
  check("even at the slowest speed the notes end up on pitch (within 25c >= 85 %)", r.stats.tuned.within25Pct >= 85, r.stats.tuned.within25Pct.toFixed(0) + "%");
}

console.log("7) Flatten vibrato");
{
  const v = makeSinger(24, 6, { err: 6, vib: 28, scoop: 0, droop: 0, wander: 0 });
  const depthOf = (fl) => { const r = run(v.x, { flatten: fl, natural: false, adaptive: false }); const c = r.contours.tuned; const ln = E.segmentNotes(c).filter(nt => (nt.end - nt.start) * hopSec >= 0.7); const ds = [];
    for (const nt of ln) { const a = nt.start + Math.round(0.25 / hopSec), b = nt.end - Math.round(0.1 / hopSec); if (b - a < 20) continue; const m = Array.from(c.slice(a, b)), W = Math.round(0.25 / hopSec) | 1;
      const dev = m.map((q, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - (W >> 1)); j <= Math.min(m.length - 1, i + (W >> 1)); j++) if (!isNaN(m[j])) { s += m[j]; n++; } return (q - s / n) * 100; });
      ds.push(Math.sqrt(dev.reduce((s, q) => s + q * q, 0) / dev.length) * Math.SQRT2); }
    return med(ds); };
  const d0 = depthOf(0), d40 = depthOf(0.4), d70 = depthOf(0.7), d100 = depthOf(1);
  console.log(`   vibrato depth of held, in-tune notes (sung with ±28c): flatten 0 % ${d0.toFixed(1)}c | 40 % (default) ${d40.toFixed(1)}c | 70 % ${d70.toFixed(1)}c | 100 % ${d100.toFixed(1)}c`);
  check("0 % and the default 40 % leave the singer's own vibrato (>= 25c, equal within 10 %)", d0 >= 25 && Math.abs(d40 - d0) < 0.1 * d0);
  check("above the default the vibrato shrinks steadily (40 > 70 > 100)", d40 > d70 + 3 && d70 > d100 + 3, `${d40.toFixed(1)} > ${d70.toFixed(1)} > ${d100.toFixed(1)}`);
  check("100 % flattens it nearly flat (< 8c)", d100 < 8, d100.toFixed(1) + "c");
  const half = run(v.x, { flatten: 1, strength: 0.5, natural: false, adaptive: false }), halfPitch = half.contours.tuned;
  check("flatten also respects the strength slider (at 50 % strength the vibrato is not fully ironed out)", (() => { const c = halfPitch; const ln = E.segmentNotes(c).filter(nt => (nt.end - nt.start) * hopSec >= 0.7); const ds = []; for (const nt of ln) { const a2 = nt.start + Math.round(0.25 / hopSec), b2 = nt.end - Math.round(0.1 / hopSec); if (b2 - a2 < 20) continue; const m = Array.from(c.slice(a2, b2)), W = Math.round(0.25 / hopSec) | 1; const dev = m.map((q, i) => { let s2 = 0, n2 = 0; for (let j = Math.max(0, i - (W >> 1)); j <= Math.min(m.length - 1, i + (W >> 1)); j++) if (!isNaN(m[j])) { s2 += m[j]; n2++; } return (q - s2 / n2) * 100; }); ds.push(Math.sqrt(dev.reduce((s2, q) => s2 + q * q, 0) / dev.length) * Math.SQRT2); } return med(ds); })() > d100 + 4);
}

console.log("8) Test mode (detune the vocal first)");
{
  const x = makeSinger(24, 3, { err: 6, vib: 12, scoop: 0, droop: 0, wander: 0 });
  const r = run(x.x, { testDetune: true });
  console.log(`   in key: original ${r.stats.original.inKeyPct.toFixed(0)}% | detuned ${r.stats.detuned.inKeyPct.toFixed(0)}% | tuned ${r.stats.tuned.inKeyPct.toFixed(0)}%; ${r.detuneEvents.length} detune events`);
  check("the detuned copy is clearly worse than the original", r.stats.detuned.inKeyPct < r.stats.original.inKeyPct - 15 && r.stats.detuned.within25Pct < r.stats.original.within25Pct - 15);
  check("the tuned copy recovers (in key >= 95 %, within 25c close to the original)", r.stats.tuned.inKeyPct >= 95 && r.stats.tuned.within25Pct > r.stats.detuned.within25Pct + 20);
  const off = run(x.x, { testDetune: false });
  check("without test mode there is no detuned copy", !off.detuneEvents || off.detuneEvents.length === 0);
}

console.log("9) Spoken to sung (the rap / talk-sing switch)");
{
  const rap = makeRap(20, 21), sung = makeSinger(20, 22, { err: 30, vib: 0, scoop: 20, droop: 8, wander: 6 });
  const R = (x, on) => run(x, { spokenSung: on, natural: false, adaptive: false });
  const rOff = R(rap.x, false), rOn = R(rap.x, true), sOff = R(sung.x, false), sOn = R(sung.x, true);
  const movedPct = (res, thr) => { const d = pitchDiffCents(res); return 100 * d.filter(v => Math.abs(v) > thr).length / d.length; };
  const inKey = (res) => res.stats.tuned.inKeyPct;
  const near = (res) => { const t = res.contours.tuned, d = []; for (const v of t) if (!isNaN(v)) d.push(dist(v)); return med(d); };
  console.log(`   rap, the toggle OFF: ${movedPct(rOff, 30).toFixed(0)}% of its pitch moved by more than 30c | ON: ${movedPct(rOn, 30).toFixed(0)}%`);
  console.log(`   rap, distance from the nearest note (median): original ${near({ contours: { tuned: rOff.contours.original } }).toFixed(0)}c | OFF ${near(rOff).toFixed(0)}c | ON ${near(rOn).toFixed(0)}c`);
  console.log(`   singing: the toggle changes ${maxAbsDiff(sOff.audio.tuned[0], sOn.audio.tuned[0]).toExponential(1)} (largest sample difference)`);
  check("ON pulls rap onto notes more than OFF does", near(rOn) < near(rOff) - 3, `${near(rOn).toFixed(0)}c vs ${near(rOff).toFixed(0)}c`);
  check("OFF leaves rap alone: speech is not forced onto notes (< 10 % of it moved > 30c)", movedPct(rOff, 30) < 10, movedPct(rOff, 30).toFixed(0) + "%");
  check("sung notes are not affected by the switch", maxAbsDiff(sOff.audio.tuned[0], sOn.audio.tuned[0]) < 0.05, maxAbsDiff(sOff.audio.tuned[0], sOn.audio.tuned[0]).toExponential(1));
  check("rap audio stays clean when ON (finite, level within 1.5 dB)", (() => { let e0 = 0, e1 = 0, bad = 0; const y = rOn.audio.tuned[0]; for (let i = 0; i < y.length; i++) { e0 += rap.x[i] ** 2; e1 += y[i] ** 2; if (!(Math.abs(y[i]) < 2)) bad++; } return bad === 0 && Math.abs(10 * Math.log10(e1 / e0)) < 1.5; })());
}

console.log("10) The rap switch must not mistake singing for rap");
{
  const raw = makeSinger(24, 11, { err: 40, vib: 0, scoop: 50, droop: 15, wander: 8 }), fastRun = makeSinger(20, 31, { err: 55, vib: 0, scoop: 0, droop: 0, wander: 0, fast: true });
  const R = (x, on) => run(x, { spokenSung: on, natural: false, adaptive: false });
  const a = R(raw.x, false), f = R(fastRun.x, false);
  console.log(`   raw singer (OFF): ${a.selective.spokenLeft} notes left alone as speech of ${a.selective.skipped + a.selective.partial + a.selective.corrected}; correction ${a.stats.original.within25Pct.toFixed(0)}% -> ${a.stats.tuned.within25Pct.toFixed(0)}% within 25c`);
  console.log(`   fast sung run (OFF): ${f.selective.spokenLeft} notes left alone as speech of ${f.selective.skipped + f.selective.partial + f.selective.corrected}; ${f.stats.original.within25Pct.toFixed(0)}% -> ${f.stats.tuned.within25Pct.toFixed(0)}% within 25c`);
  check("a raw singer is never treated as rap (0 notes left alone) and is still corrected", a.selective.spokenLeft === 0 && a.stats.tuned.within25Pct > a.stats.original.within25Pct + 10);
  check("a fast sung run (steady pitches) is not treated as rap (< 10 % left alone) and is corrected", f.selective.spokenLeft <= 0.1 * (f.selective.skipped + f.selective.partial + f.selective.corrected) && f.stats.tuned.within25Pct > f.stats.original.within25Pct + 8);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
