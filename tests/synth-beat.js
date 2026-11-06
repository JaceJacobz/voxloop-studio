// Synthetic beats with a KNOWN bar start, for checking beat-1 detection. Not real recordings: a regression check, not a promise.
"use strict";
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// beat positions are in beats from the bar start (0 = beat 1)
const PATTERNS = {
  fourfloor: { kick: [0, 1, 2, 3], snare: [1, 3], hat: [0.5, 1.5, 2.5, 3.5] },
  rnb: { kick: [0, 1.75, 2.5], snare: [1, 3], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
  afroOffbeat: { kick: [0, 1.5, 2.75], snare: [2], hat: [0.5, 1.5, 2.5, 3.5], perc: [0.75, 1.25, 2.25, 3.25] },
  afroAnticipate: { kick: [0.0, 1.5, 3.5], snare: [1, 3], hat: [0.5, 1, 1.5, 2.5, 3, 3.5], perc: [0.75, 2.75] },
  halftime: { kick: [0, 2.5], snare: [2], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
  noKickOne: { kick: [0.5, 1.75, 3], snare: [1, 3], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], perc: [0.75, 2.25] }
};
// chord loops as [root semitone from tonic, minor?]  (one chord per bar unless twoBar)
const PROGS = { minor4: [[0, 1], [8, 0], [3, 0], [10, 0]], major4: [[0, 0], [7, 0], [9, 1], [5, 0]], minor2: [[0, 1], [10, 0]], major2: [[0, 0], [5, 0]], minor4b: [[0, 1], [5, 1], [10, 0], [3, 0]] };
function render(o) {
  const sr = 44100, bpm = o.bpm, beat = 60 / bpm, bar = 4 * beat, bars = o.bars || 16, pat = PATTERNS[o.pattern], prog = PROGS[o.prog], tonic = o.tonic == null ? 57 : o.tonic;
  const pre = (o.preBeats || 0) * beat, total = Math.ceil((bars * bar + 0.5) * sr), L = new Float32Array(total), R = new Float32Array(total), r = rng(o.seed || 1);
  const add = (t0, fn, len) => { const a = Math.round(t0 * sr); for (let i = 0; i < len * sr && a + i < total; i++) { if (a + i < 0) continue; const v = fn(i / sr); L[a + i] += v; R[a + i] += v; } };
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, ch = prog[Math.floor(b / (o.barsPerChord || 1)) % prog.length], root = tonic + ch[0], notes = [root, root + (ch[1] ? 3 : 4), root + 7, root + 12];
    if (o.drumsOnly) { /* skip chords and bass */ } else {
    // chord: soft attack pad + piano-like stab on beat 1 (and a syncopated re-stab for afro grooves)
    notes.forEach((m, k) => add(t0, (t) => 0.05 * (Math.sin(2 * Math.PI * hz(m) * t) + 0.3 * Math.sin(4 * Math.PI * hz(m) * t)) * Math.min(1, t / 0.05) * Math.min(1, (bar - t) / 0.05) * 1, bar));
    if (o.stab) [0, 1.5, 2.75].forEach((p) => notes.forEach((m) => add(t0 + p * beat, (t) => 0.05 * Math.sin(2 * Math.PI * hz(m) * 2 * t) * Math.exp(-t * 9), 0.4)));
    // bass on the root, played on the kick pattern's own positions
    add(t0, (t) => 0.22 * Math.sin(2 * Math.PI * hz(root - 24) * t) * Math.exp(-t * 2.5), beat * 1.8);
    (pat.bassPos || [2.5]).forEach((p) => add(t0 + p * beat, (t) => 0.18 * Math.sin(2 * Math.PI * hz(root - 24 + (p > 2 ? 7 : 0)) * t) * Math.exp(-t * 4), beat));
    }
    pat.kick.forEach((p) => add(t0 + p * beat, (t) => 0.7 * Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-t * 35)) * t) * Math.exp(-t * 12), 0.3));
    pat.snare.forEach((p) => add(t0 + p * beat, (t) => 0.3 * ((r() * 2 - 1) * Math.exp(-t * 22) + 0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 28)), 0.25));
    pat.hat.forEach((p) => { let pn = 0; add(t0 + p * beat, (t) => { const w = r() * 2 - 1, v = 0.09 * (w - pn) * Math.exp(-t * 70); pn = w; return v; }, 0.08); });
    (pat.perc || []).forEach((p) => add(t0 + p * beat, (t) => 0.16 * Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 30), 0.15));
  }
  if (o.noise) for (let i = 0; i < total; i++) { const w = (r() * 2 - 1) * o.noise; L[i] += w; R[i] += (r() * 2 - 1) * o.noise; }
  // cut the audio so the file starts `preBeats` beats AFTER the beginning of a bar
  const cut = Math.round(pre * sr), n = total - cut, l = L.subarray(cut, cut + n), rr = R.subarray(cut, cut + n);
  const truthFirstBar = (bar - pre) % bar;           // seconds from file start to the first bar line
  return { channels: [Float32Array.from(l), Float32Array.from(rr)], sr, truthFirstBar, bar, bpm };
}
module.exports = { render, PATTERNS, PROGS };
