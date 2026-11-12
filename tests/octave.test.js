"use strict";
// Octave lift: a cover sung an octave low. Checks the decision, that low lines move exactly +12 while an already-high line stays,
// that the melody's own ups and downs survive (the shape inside each line), and that the raise adds no wobble, clicks or buzz and
// keeps vibrato. Synthetic voices: a regression check, not a promise (it cannot judge tone).
const S = require("./synth-voice"), B = require("./synth-beat"), AD = require("../js/autodecide.js");
const eng = S.loadTuneEngine();
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m.padEnd(62) + (x || "")); };

// a sung vocal: 4 lines. Lines 1,2,4 sit low (around A2 = 45, with dips and lifts), line 3 was already sung high (around A3+7 = 64)
const LINES = [
  { base: 45, deg: [0, 2, 3, 5, 3, 2, 0, -3, 0] },
  { base: 45, deg: [3, 5, 7, 5, 3, 0, -2, 0] },
  { base: 64, deg: [0, 2, 4, 2, 0, -2, 0] },
  { base: 45, deg: [0, 3, 7, 10, 7, 3, 0, -4, 0] }
];
const plan = [], truth = []; let t = 0.4;
LINES.forEach((L, li) => { L.t0 = t; L.deg.forEach((d, k) => { const m = L.base + d, dur = 0.42; plan.push({ t0: t, dur, vowel: (k + li) % 5, hz: () => S.midiHz(m) }); truth.push({ li, t0: t, t1: t + dur, midi: m }); t += dur + 0.02; }); L.t1 = t; t += 0.9; });
const { x, sr } = S.render(plan, { tract: 1, sibHz: 5400, seed: 3, breath: 0.03 });

const prof = eng.octaveProfile([x], sr, {});
ok(prof.lines.length === 4, "found the 4 lines", prof.lines.length + " lines, median " + prof.median.toFixed(1));
const dec = AD.octaveDecision({ median: prof.median, p95: prof.p95, delivery: "sung", mode: "auto" });
// overall median of this vocal is ~48 (3 of 4 lines at 45): the decision must not act on a borderline vocal, only suggest
ok(/^suggest/.test(dec.action), "borderline-low vocal: suggests, does not act on its own", dec.action + " (median " + prof.median.toFixed(1) + ")");
const forced = AD.octaveDecision({ median: prof.median, delivery: "sung", mode: "up" });
ok(forced.action === "raise", "when asked for, it raises");

const r = eng.octaveRaise([x], sr, { semis: 12 });
const rep = r.report;
ok(rep.shifted === 3 && rep.skipped === 1, "3 low lines raised, the already-high line left alone", rep.shifted + " raised / " + rep.skipped + " left");
ok(rep.lines[2] && !rep.lines[2].shifted && /already/.test(rep.lines[2].reason || ""), "line 3 explained as already sung high");

// measure: per note, pitch after - pitch before
const t0 = eng.trackClean(x, sr), t1 = eng.trackClean(r.channels[0], sr), hop = t0.hop / sr;
const med = (a) => { a = a.filter((v) => !isNaN(v)).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };
const noteMidi = (tr, n) => { const v = []; for (let k = 0; k < tr.midi.length; k++) { const ts = k * hop; if (ts > n.t0 + 0.12 && ts < n.t1 - 0.06) v.push(tr.midi[k]); } return med(v); };
const diffs = truth.map((n) => ({ li: n.li, d: noteMidi(t1, n) - noteMidi(t0, n) }));
const lowD = diffs.filter((d) => d.li !== 2).map((d) => d.d), highD = diffs.filter((d) => d.li === 2).map((d) => d.d);
const maxErr = Math.max(...lowD.map((d) => Math.abs(d - 12)));
ok(maxErr < 0.35, "every note on a low line moved exactly one octave", "worst error " + (maxErr * 100).toFixed(0) + " cents");
ok(Math.max(...highD.map(Math.abs)) < 0.2, "the already-high line did not move", "worst " + (Math.max(...highD.map(Math.abs)) * 100).toFixed(0) + " cents");
// the shape inside each raised line is kept: note-to-note intervals identical
let shapeErr = 0, cnt = 0;
for (let li of [0, 1, 3]) { const ns = truth.filter((n) => n.li === li); for (let k = 1; k < ns.length; k++) { const before = noteMidi(t0, ns[k]) - noteMidi(t0, ns[k - 1]), after = noteMidi(t1, ns[k]) - noteMidi(t1, ns[k - 1]); shapeErr = Math.max(shapeErr, Math.abs(after - before)); cnt++; } }
ok(shapeErr < 0.35, "the melody's ups and downs are kept (" + cnt + " intervals)", "worst interval change " + (shapeErr * 100).toFixed(0) + " cents");
// silence between lines stays silent, the sound is not louder than the original beyond a sane margin, nothing blows up
const rms = (a, s0, s1) => { let v = 0; const i0 = Math.round(s0 * sr), i1 = Math.round(s1 * sr); for (let i = i0; i < i1; i++) v += a[i] * a[i]; return Math.sqrt(v / (i1 - i0)); };
const peak = r.channels[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
ok(peak < 1.2 * x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) + 0.02 && r.channels[0].every(Number.isFinite), "no clipping or NaN", "peak " + peak.toFixed(3));
const a = rms(x, LINES[0].t1 + 0.2, LINES[0].t1 + 0.7), b = rms(r.channels[0], LINES[0].t1 + 0.2, LINES[0].t1 + 0.7);
ok(b < Math.max(a * 1.6, 0.003), "gaps between lines are not made noisier", a.toFixed(4) + " -> " + b.toFixed(4));
ok(r.channels[0].length === x.length, "same length as the original");

function fftMag(frame) { const n = frame.length; const re = Float64Array.from(frame), im = new Float64Array(n); for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } } for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const wr = Math.cos(ang * k), wi = Math.sin(ang * k), ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; } } const m = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = re[i] * re[i] + im[i] * im[i]; return m; }
// ---- naturalness checks that can be measured (tone/timbre still needs ears: see README)
// 1. held notes are as steady after the raise as before (the shifter adds no wobble), in cents of spread inside each note
const spread = (tr, n) => { const v = []; for (let k = 0; k < tr.midi.length; k++) { const ts = k * hop; if (ts > n.t0 + 0.12 && ts < n.t1 - 0.06 && !isNaN(tr.midi[k])) v.push(tr.midi[k]); } if (v.length < 5) return 0; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length) * 100; };
let wob = 0; truth.filter((n) => n.li !== 2).forEach((n) => { wob = Math.max(wob, spread(t1, n) - spread(t0, n)); });
ok(wob < 8, "held notes are not made wobbly by the raise", "worst +" + wob.toFixed(1) + " cents of spread");
// 2. no clicks or hiss added: energy above 7 kHz after the raise, relative to the original's, stays small (a click train or grain buzz would add a lot)
function hf(sig) { const N = 2048; let e = 0, tot = 0; for (let p = 0; p + N < sig.length; p += N) { const fr = new Float64Array(N); for (let i = 0; i < N; i++) fr[i] = sig[p + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); const m = fftMag(fr); for (let k = 0; k < N / 2; k++) { const f = k * sr / N; tot += m[k]; if (f > 7000) e += m[k]; } } return e / (tot + 1e-12); }
const hfBefore = hf(x), hfAfter = hf(r.channels[0]);
ok(hfAfter < Math.max(hfBefore * 3, 0.002), "no clicks or buzz added up high (above 7 kHz)", (hfBefore * 100).toFixed(3) + "% -> " + (hfAfter * 100).toFixed(3) + "% of the energy");
// 3. vibrato survives: a note with a 5.5 Hz, +-35 cent vibrato still has it after the raise (depth within 25%)
{ const vplan = [{ t0: 0.3, dur: 2.2, vowel: 0, hz: (tt) => S.midiHz(45 + 0.35 * Math.sin(2 * Math.PI * 5.5 * tt)) }];
  const v = S.render(vplan, { tract: 1, sibHz: 5400, seed: 3, breath: 0.02 }), vr = eng.octaveRaise([v.x], sr, { semis: 12 }).channels[0];
  const depth = (sig) => { const tr = eng.trackClean(sig, sr), a = []; for (let k = 0; k < tr.midi.length; k++) { const ts = k * hop; if (ts > 0.6 && ts < 2.2 && !isNaN(tr.midi[k])) a.push(tr.midi[k]); } const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) * (q - m), 0) / a.length) * 100; };
  const d0 = depth(v.x), d1 = depth(vr);
  ok(Math.abs(d1 - d0) / d0 < 0.25, "vibrato depth is kept", d0.toFixed(0) + " -> " + d1.toFixed(0) + " cents (rms)"); }

// ---- the producer brain: voice + beat + genre + vibe, with a listen-back before it acts
const reg = (tonic, pat) => { const b = B.render({ bpm: 96, pattern: pat || "rnb", prog: "minor4", bars: 16, seed: 5, tonic }); return eng.beatRegister(b.channels, b.sr, {}); };
const bHigh = reg(57), bLow = reg(33), bMid = reg(45);
ok(bHigh.bodyMidi > bMid.bodyMidi && bMid.bodyMidi >= bLow.bodyMidi, "beat register: higher-pitched beats read higher", "body " + bLow.bodyMidi + " < " + bMid.bodyMidi + " < " + bHigh.bodyMidi);
const V = (m, extra) => Object.assign({ median: m, p05: m - 5, p95: m + 7, delivery: "sung", mode: "auto" }, extra || {});
const act = (r) => r.action === "raise" || r.action === "lower";
let r1 = AD.octaveBrain(V(45, { beat: bHigh, genreId: "afrobeats", vibe: { energy: 0.7, space: 0.3 } }));
ok(r1.action === "raise", "very low voice over a high, busy beat: raised", r1.action + " score " + r1.score.toFixed(2));
console.log("   heard:", r1.heard.join(" "), "\n   why:  ", r1.why.join(" "));
let r2 = AD.octaveBrain(V(45, { beat: bLow, genreId: "trap", vibe: { energy: 0.4, space: 0.7 } }));
ok(!act(r2), "same voice over a deep, sparse trap beat: NOT moved (it belongs there)", r2.action + " score " + r2.score.toFixed(2));
console.log("   why:  ", r2.why.join(" "));
const vo = AD.octaveBrain(V(49)), wb = AD.octaveBrain(V(49, { beat: bHigh }));
ok(wb.score > vo.score, "a beat that sits far above the voice strengthens the case", vo.score.toFixed(2) + " -> " + wb.score.toFixed(2));
const chordsEv = (r) => (r.evidence.find((e) => e.name === "chords") || { value: 0 }).value;
const lowB = AD.octaveBrain(V(49, { beat: bLow }));
ok(chordsEv(lowB) < chordsEv(wb), "a beat that sits low gives weaker 'buried' evidence than a high one (the voice may belong there)", "chords evidence " + chordsEv(lowB).toFixed(2) + " < " + chordsEv(wb).toFixed(2));
const tr = AD.octaveBrain(V(48, { beat: bHigh, genreId: "trap" })), af = AD.octaveBrain(V(48, { beat: bHigh, genreId: "afrobeats" }));
ok(af.score > tr.score, "genre: afrobeats asks for the voice higher than trap does", "trap " + tr.score.toFixed(2) + " < afrobeats " + af.score.toFixed(2));
const calm = AD.octaveBrain(V(48, { beat: bHigh, vibe: { energy: 0.2, space: 0.9 } })), hard = AD.octaveBrain(V(48, { beat: bHigh, vibe: { energy: 0.9, space: 0.1 } }));
ok(hard.score > calm.score, "vibe: a hard busy beat wants the voice higher than a sparse one", "sparse " + calm.score.toFixed(2) + " < hard " + hard.score.toFixed(2));
ok(!act(AD.octaveBrain(V(62, { beat: bHigh, genreId: "afrobeats" }))), "a normal voice is left alone");
// too high
const hiBeat = AD.octaveBrain(V(80, { beat: bLow, genreId: "rnb" }));
ok(hiBeat.action === "lower" || hiBeat.action === "suggest-lower", "a voice far above a low beat: lowering is chosen/suggested", hiBeat.action + " score " + hiBeat.score.toFixed(2));
ok(hiBeat.semis === -12, "...and the move is down");
ok(AD.octaveBrain({ median: 80, delivery: "rapped", mode: "auto", beat: bLow }).action === "none", "a rap is never moved, up or down");
ok(AD.octaveBrain(V(40, { mode: "off" })).action === "none", "Off means off");
// the listen-back: a deep, dark beat means a raised voice would float detached above the track, so the move is not made
const deep = { bodyMidi: 40, bassMidi: 31, bassStrength: 2, confidence: 1 };
const veto = AD.octaveBrain(V(46, { beat: deep, genreId: "trap", vibe: { energy: 0.4, space: 0.7 } }));
ok(!act(veto), "listen-back: on a deep dark beat the raised voice would float above it, so nothing is changed", veto.action + " score " + veto.score.toFixed(2));
// the bass evidence: a voice on the bass's notes is called out, and a voice well above the bass is not
const bassy = { bodyMidi: 52, bassMidi: 40, bassStrength: 3, confidence: 1 }, bassUp = { bodyMidi: 52, bassMidi: 28, bassStrength: 3, confidence: 1 };
const eb = (r) => (r.evidence.find((e) => e.name === "bass") || { value: 0 }).value;
ok(eb(AD.octaveBrain(V(46, { beat: bassy }))) > eb(AD.octaveBrain(V(46, { beat: bassUp }))), "a voice on the bass line's notes gets 'muddy' evidence; one clear of it does not");
// lowering in the engine: -12 on a high sung vocal, melody shape kept
{ const HL = [{ base: 70, deg: [0, 2, 4, 2, 0, -2, 0] }, { base: 70, deg: [0, 3, 5, 3, 0, -3, 0] }]; const pl = [], tt = []; let t0b = 0.4;
  HL.forEach((L, li) => { L.deg.forEach((d, k) => { const m = L.base + d; pl.push({ t0: t0b, dur: 0.42, vowel: (k + li) % 5, hz: () => S.midiHz(m) }); tt.push({ t0: t0b, t1: t0b + 0.42, midi: m }); t0b += 0.44; }); t0b += 0.9; });
  const hv = S.render(pl, { tract: 1, sibHz: 5400, seed: 3, breath: 0.03 }), lo = eng.octaveRaise([hv.x], hv.sr, { semis: -12 });
  const a0 = eng.trackClean(hv.x, hv.sr), a1 = eng.trackClean(lo.channels[0], hv.sr), hp = a0.hop / hv.sr;
  const nm = (trk, n) => { const v = []; for (let k = 0; k < trk.midi.length; k++) { const ts = k * hp; if (ts > n.t0 + 0.12 && ts < n.t1 - 0.06) v.push(trk.midi[k]); } return med(v); };
  const worst = Math.max(...tt.map((n) => Math.abs(nm(a1, n) - nm(a0, n) + 12)));
  ok(lo.report.shifted === 2 && worst < 0.4, "lowering: every note moves exactly one octave down", "worst error " + (worst * 100).toFixed(0) + " cents"); }
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
