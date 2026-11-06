// Synthetic voices for regression tests (source-filter model). NOT real singers: a regression check, not a promise.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
function loadTuneEngine() {
  const src = fs.readFileSync(path.join(__dirname, "../js/pitchcorrect.js"), "utf8");
  const ctx = { console, Math, Float32Array, Float64Array, Array, Object, isNaN, setTimeout };
  vm.createContext(ctx); vm.runInContext(src + "\n;this.createTuneEngine = createTuneEngine;", ctx);
  return ctx.createTuneEngine();
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const VOWELS = [[700, 1220, 2600], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410]];
// resonator (2-pole) coefficients
function res(f, bw, sr) { const r = Math.exp(-Math.PI * bw / sr), th = 2 * Math.PI * f / sr; return [2 * r * Math.cos(th), -r * r, 1 - 2 * r * Math.cos(th) + r * r]; }
/**
 * plan: [{t0, dur, hz(t)->Hz or 0 for silence, vowel, sib:boolean}]  tract: formant scale (1 = adult male-like)
 */
function render(plan, o) {
  const sr = o.sr || 44100, tract = o.tract || 1, breath = o.breath == null ? 0.03 : o.breath, rnd = rng(o.seed || 1);
  const total = Math.ceil((plan.reduce((m, s) => Math.max(m, s.t0 + s.dur), 0) + 0.3) * sr), y = new Float32Array(total);
  let phase = 0, lp = 0;
  const st = VOWELS.map(() => [0, 0, 0, 0, 0, 0, 0, 0]);
  for (const seg of plan) {
    const a = Math.floor(seg.t0 * sr), n = Math.floor(seg.dur * sr);
    if (seg.sib) { // fricative: noise through a band centred on the speaker-size dependent sibilant frequency
      const fc = (o.sibHz || 5600) , [c1, c2, g] = res(fc, 1800, sr); let s1 = 0, s2 = 0;
      for (let i = 0; i < n; i++) { const env = Math.sin(Math.PI * i / n); const v = g * (rnd() * 2 - 1) * 3 + c1 * s1 + c2 * s2; s2 = s1; s1 = v; y[a + i] += v * env * 0.5 * (o.sibGain || 1); }
      continue;
    }
    if (!seg.hz) continue;
    const V = VOWELS[seg.vowel % VOWELS.length].map((f, k) => f * tract * (k === 3 ? 1 : 1)); V.push(3500 * tract);
    const co = V.map((f, k) => res(f, 60 + 40 * k, sr)); const s = V.map(() => [0, 0]);
    for (let i = 0; i < n; i++) {
      const t = i / sr, f0 = seg.hz(t);
      phase += f0 / sr; if (phase >= 1) phase -= 1;
      // glottal-ish pulse: smooth asymmetric pulse train
      let g = phase < 0.4 ? Math.sin(Math.PI * phase / 0.4) ** 2 : 0; g = g - 0.2;
      lp += 0.35 * (g - lp);
      let x = lp + breath * (rnd() * 2 - 1);
      for (let k = 0; k < co.length; k++) { const v = co[k][2] * x + co[k][0] * s[k][0] + co[k][1] * s[k][1]; s[k][1] = s[k][0]; s[k][0] = v; x = v; }
      const env = Math.min(1, i / (0.02 * sr), (n - i) / (0.03 * sr));
      y[a + i] += x * env * 0.08;
    }
  }
  let pk = 0; for (let i = 0; i < total; i++) pk = Math.max(pk, Math.abs(y[i]));
  for (let i = 0; i < total; i++) y[i] = y[i] / pk * 0.5 + (rnd() * 2 - 1) * (o.noise || 0.0005);
  return { x: y, sr };
}
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SCALE = [0, 2, 3, 5, 7, 8, 10];
// sung: held notes with vibrato and little rests, S sounds between phrases
function sung(centerHz, seed, secs) {
  const r = rng(seed), plan = []; let t = 0.1; const c0 = 69 + 12 * Math.log2(centerHz / 440);
  while (t < (secs || 14)) {
    const deg = SCALE[Math.floor(r() * 7)] + (r() < 0.3 ? 12 : 0) - 5, base = c0 + deg * 0.9, dur = 0.45 + r() * 0.8, vr = 5.2 + r(), vd = 0.25 + r() * 0.25, v = Math.floor(r() * 5);
    const m0 = base; plan.push({ t0: t, dur, vowel: v, hz: (tt) => midiHz(m0 + vd * Math.sin(2 * Math.PI * vr * tt) * (tt > 0.12 ? 1 : 0.3)) });
    t += dur; if (r() < 0.25) { plan.push({ t0: t + 0.01, dur: 0.12, sib: true }); t += 0.14; }
    t += 0.04 + (r() < 0.2 ? 0.5 : 0);
  }
  return plan;
}
// rapped / spoken: 6-7 short syllables a second, speech-like contour (slopes, no plateaus)
function rapped(centerHz, seed, secs, rate) {
  const r = rng(seed), plan = []; let t = 0.1; const c0 = 69 + 12 * Math.log2(centerHz / 440), dd = 1 / (rate || 6.5);
  while (t < (secs || 14)) {
    const dur = dd * (0.62 + r() * 0.15), m0 = c0 + (r() * 2 - 1) * 2.6, sl = (r() * 2 - 1) * 4.5, v = Math.floor(r() * 5);
    plan.push({ t0: t, dur, vowel: v, hz: (tt) => midiHz(m0 + sl * (tt / dur - 0.5)) });
    t += dd; if (r() < 0.2) plan.push({ t0: t - 0.04, dur: 0.07, sib: true });
    if (r() < 0.06) t += 0.5;
  }
  return plan;
}
module.exports = { loadTuneEngine, render, sung, rapped, midiHz };
// harder cases
function melodicRap(centerHz, seed, secs) { // alternating rapped lines and sung tags
  const a = rapped(centerHz, seed, secs), b = sung(centerHz, seed + 1, secs), out = []; 
  a.forEach((s) => { if (Math.floor(s.t0 / 3) % 2 === 0) out.push(s); }); b.forEach((s) => { if (Math.floor(s.t0 / 3) % 2 === 1) out.push(s); }); return out;
}
function sungFast(centerHz, seed, secs) { // short sung notes (0.18-0.3 s), runs
  const r = rng(seed), plan = []; let t = 0.1; const c0 = 69 + 12 * Math.log2(centerHz / 440);
  while (t < (secs || 14)) { const dur = 0.2 + r() * 0.12, m0 = c0 + SCALE[Math.floor(r() * 7)] * 0.8 - 4; plan.push({ t0: t, dur, vowel: Math.floor(r() * 5), hz: (tt) => midiHz(m0 + 0.2 * Math.sin(2 * Math.PI * 5.5 * tt)) }); t += dur + 0.02; if (r() < 0.15) t += 0.4; }
  return plan;
}
module.exports.melodicRap = melodicRap; module.exports.sungFast = sungFast;
