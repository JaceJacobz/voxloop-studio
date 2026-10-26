// Synthetic voices for testing the pitch correction controls
const SR = 44100;
function rng(seed) { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function vowel(src, n) {
  let y = src;
  for (const [fc, bw] of [[700, 90], [1150, 100], [2600, 140]]) {
    const rr = Math.exp(-Math.PI * bw / SR), th = 2 * Math.PI * fc / SR, a1 = -2 * rr * Math.cos(th), a2 = rr * rr, g = 1 - rr;
    const o = new Float32Array(n); let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const v = g * y[i] - a1 * y1 - a2 * y2; o[i] = v; y2 = y1; y1 = v; } y = o;
  }
  return y;
}
function finish(y, r, n) { let pk = 0; for (let i = 0; i < n; i++) { y[i] += (r() - .5) * 0.0008; pk = Math.max(pk, Math.abs(y[i])); } for (let i = 0; i < n; i++) y[i] *= 0.7 / pk; return y; }
function render(f0, amp, n) {
  const src = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { if (!f0[i]) continue; ph += f0[i] / SR; ph -= Math.floor(ph); let s = 0; for (let h = 1; h <= Math.floor(5000 / f0[i]); h++) s += Math.sin(2 * Math.PI * h * ph) / Math.pow(h, 1.6); src[i] = s * amp[i]; }
  return src;
}
// A singer in `rootPc` minor. p: err (+- cents), vib (cents), scoop, droop, wander; shiftSt moves the whole melody
function makeSinger(seconds, seed, p, shiftSt = 0, scalePcs = [11, 1, 2, 4, 6, 7, 9]) {
  const r = rng(seed), n = Math.floor(seconds * SR);
  const pool = []; for (let m = 59; m <= 70; m++) if (scalePcs.includes(m % 12)) pool.push(m);
  const notes = []; let t = 0.3, prev = 62;
  while (t < seconds - 1.4) {
    let m; do { m = pool[Math.floor(r() * pool.length)]; } while (Math.abs(m - prev) > 5 && r() < 0.8);
    const dur = p.fast ? 0.11 + r() * 0.05 : (p.legato ? 0.35 + r() * 0.25 : (r() < 0.45 ? 0.9 + r() * 0.5 : 0.3 + r() * 0.35));
    notes.push({ t0: t, t1: t + dur, midi: m + shiftSt, err: (r() * 2 - 1) * p.err, wph: r() * 6.28, prevMidi: notes.length ? notes[notes.length - 1].midi : null, prevErr: notes.length ? notes[notes.length - 1].err : 0 }); prev = m; t += dur + (p.fast ? 0.012 : (p.legato ? 0.0 : 0.08 + r() * 0.1));
  }
  const f0 = new Float64Array(n), amp = new Float32Array(n);
  for (const nt of notes) for (let i = Math.floor(nt.t0 * SR); i < Math.floor(nt.t1 * SR) && i < n; i++) {
    const tt = i / SR - nt.t0, dur = nt.t1 - nt.t0, tEnd = dur - tt;
    const scoop = tt < 0.12 ? -(p.scoop || 0) * (1 - tt / 0.12) : 0, droop = tEnd < 0.12 ? -(p.droop || 0) * (1 - tEnd / 0.12) : 0;
    const vib = p.vib && tt > 0.2 ? p.vib * Math.sin(2 * Math.PI * 5.6 * (tt - 0.2)) * Math.min(1, (tt - 0.2) / 0.2) : 0;
    const wander = (p.wander || 0) * Math.sin(2 * Math.PI * 1.3 * tt + nt.wph);
    let glide = 0;
    if (p.legato && nt.prevMidi != null && tt < 0.07) glide = (nt.prevMidi + nt.prevErr / 100 - (nt.midi + nt.err / 100)) * 100 * (1 - tt / 0.07) * 0.5 * (1 + Math.cos(Math.PI * tt / 0.07)) / (1 - tt / 0.07 + 1e-9) * (1 - tt / 0.07);
    f0[i] = 440 * Math.pow(2, (nt.midi - 69) / 12) * Math.pow(2, (nt.err + scoop + droop + vib + wander + glide) / 1200);
    amp[i] = p.legato ? Math.min(1, tt / 0.004, tEnd / 0.004) : Math.min(1, tt / 0.03, tEnd / 0.05);
  }
  return { x: finish(vowel(render(f0, amp, n), n), r, n), notes };
}
// Rap / talk: short syllables whose pitch glides (intonation) instead of sitting on notes, consonant noise in between.
function makeRap(seconds, seed) {
  const r = rng(seed), n = Math.floor(seconds * SR), f0 = new Float64Array(n), amp = new Float32Array(n), noise = new Float32Array(n);
  let t = 0.3, base = 52;                                                  // ~ A3 region (speaking range)
  while (t < seconds - 1) {
    const dur = 0.08 + r() * 0.12, gap = 0.03 + r() * 0.07;
    base += (r() - 0.5) * 3; base = Math.max(46, Math.min(60, base));
    const slope = (r() - 0.5) * 5;                                          // semitones across the syllable
    for (let i = Math.floor(t * SR); i < Math.floor((t + dur) * SR) && i < n; i++) {
      const tt = (i / SR - t) / dur;
      f0[i] = 440 * Math.pow(2, (base + slope * (tt - 0.5) - 69) / 12) * Math.pow(2, (8 * Math.sin(tt * 9 + t)) / 1200);
      amp[i] = Math.min(1, tt * 12, (1 - tt) * 12) * (0.6 + 0.4 * r());
    }
    for (let i = Math.floor((t + dur) * SR); i < Math.floor((t + dur + gap) * SR) && i < n; i++) noise[i] = (r() * 2 - 1) * 0.08;
    t += dur + gap;
  }
  const y = vowel(render(f0, amp, n), n);
  for (let i = 0; i < n; i++) y[i] += noise[i];
  return { x: finish(y, r, n) };
}
module.exports = { SR, rng, makeSinger, makeRap };
