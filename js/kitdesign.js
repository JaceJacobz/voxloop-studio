// =====================================================================
// Kit designer (v2.27.0): every beat gets its OWN sound, not just its own notes.
//
// Why: the drum recordings (samples/<genre>/<type>/1..5.wav) are a small, fixed set, and most of them are 1980s and 90s
// drum machines (MPC60, SP-12, LinnDrum, TR-808...). The kicks are almost pure sub-bass (91-100% of the energy under 150 Hz,
// no beater click), the snares are dull boom-bap, and the same five hits of a style came back in beat after beat. After a few
// beats the ear knows the kit, and a retro kit does not sound like modern Afrobeats, amapiano or Afro house.
//
// What it does: when a beat is made it also gets a "kit design": for each drum a handful of numbers (tuning, how long it rings,
// a bright or dark tilt, a little drive, a beater click on kicks and snares, a clap or snare "tail"). The numbers are drawn from
// ranges that belong to the genre, from the beat's own seed (so no extra randomness is consumed: the notes and patterns a seed
// makes are exactly what they were). The engine applies them ONCE, when the beat's sound is applied, by reshaping a copy of each
// recording. Playback, the download and a Studio session that receives the beat all read the same numbers, so what you hear
// is what you export.
//
// A beat also gets:
//   perc2 / bell2   a second percussion recording and a second bell/wood recording, so a pattern can answer itself high and low
//                   (hits between the beats use the second one) like a real conga pair, instead of one drum nudged up in pitch
//   mix             this beat's own reverb size and amount, delay amount, air, drum-bus drive and glue (not every beat of a style
//                   sitting in the same room)
//   tone            this beat's own filter, chorus, attack and release on the keys, pad, pluck and lead
//
// A beat saved by an older version has none of this and plays exactly as it always did (every field is optional).
// All the sound processing here is plain arithmetic on arrays (kitProcess), so it can be tested without a browser.
// =====================================================================

const KIT_VERSION = 1;

// ---------- small tools ----------
function kitRng(seed) {                                    // a seeded random stream (mulberry32)
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const kitRound = x => Math.round(x * 1000) / 1000;
const kitDb = db => Math.pow(10, db / 20);

// A biquad filter over an array (RBJ cookbook). type: lowshelf, highshelf, highpass, lowpass
function kitBiquad(x, sr, type, freq, gainDb, q) {
  const f = Math.min(freq, sr * 0.45), w0 = 2 * Math.PI * f / sr, cos = Math.cos(w0), sin = Math.sin(w0);
  const A = Math.pow(10, (gainDb || 0) / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lowshelf" || type === "highshelf") {
    const alpha = sin / 2 * Math.sqrt((A + 1 / A) * (1 / (q || 0.7) - 1) + 2), s = 2 * Math.sqrt(A) * alpha;
    if (type === "lowshelf") {
      b0 = A * ((A + 1) - (A - 1) * cos + s); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - s);
      a0 = (A + 1) + (A - 1) * cos + s; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - s;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cos + s); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - s);
      a0 = (A + 1) - (A - 1) * cos + s; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - s;
    }
  } else {
    const alpha = sin / (2 * (q || 0.707));
    if (type === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
    else { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Change the pitch (and so the length) by `ratio` with cubic interpolation. ratio > 1: higher and shorter.
function kitResample(x, ratio) {
  if (!ratio || Math.abs(ratio - 1) < 0.0005) return Float32Array.from(x);
  const n = Math.max(16, Math.floor((x.length - 2) / ratio)), y = new Float32Array(n), last = x.length - 1;
  for (let i = 0; i < n; i++) {
    const p = i * ratio, i1 = Math.floor(p), f = p - i1;
    const a = x[Math.max(0, i1 - 1)], b = x[i1], c = x[Math.min(last, i1 + 1)], d = x[Math.min(last, i1 + 2)];
    y[i] = b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
  }
  return y;
}

const kitPeak = chans => { let m = 0; chans.forEach(c => { for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > m) m = v; } }); return m; };
// The average level of the first `sec` seconds (what a drum hit "weighs"), all channels together
function kitRms(chans, sr, sec) {
  let s = 0, n = 0;
  chans.forEach(c => { const m = Math.min(c.length, Math.floor(sr * sec)); for (let i = 0; i < m; i++) s += c[i] * c[i]; n += m; });
  return Math.sqrt(s / Math.max(1, n));
}
// First sample that is clearly a hit (the recordings can start with a little silence)
function kitOnset(c, peak) {
  const th = peak * 0.12;
  for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= th) return i;
  return 0;
}

// ---------- the sound of one hit ----------
// q (all optional): p pitch ratio | dk ring-out time (s, shorter = tighter) | lo, hi tilt (dB; hf = the shelf's frequency) |
//   dr drive 0..1 | ck click 0..1 (ckf Hz) | tl tail 0..1 (tld s) | sd noise seed
// Returns new arrays (one per channel) at the same sample rate; the level is matched to the original so the mixer's settings still fit.
function kitProcess(type, chans, sr, q) {
  if (!q) return chans;
  const origPeak = Math.max(1e-6, kitPeak(chans)), origRms = Math.max(1e-6, kitRms(chans, sr, 0.15));
  let out = chans.map(c => kitResample(c, q.p || 1));

  if (q.lo) out = out.map(c => kitBiquad(c, sr, "lowshelf", 110, q.lo, 0.7));
  if (q.hi) out = out.map(c => kitBiquad(c, sr, "highshelf", q.hf || 4500, q.hi, 0.7));

  // Ring-out: an exponential fade that starts just after the hit (it can only make a hit tighter)
  if (q.dk) {
    const peak = kitPeak(out), start = kitOnset(out[0], peak) + Math.floor(sr * 0.012), tau = Math.max(0.01, q.dk) * sr;
    out.forEach(c => {
      for (let i = start; i < c.length; i++) c[i] *= Math.exp(-(i - start) / tau);
      const fade = Math.min(c.length, Math.floor(sr * 0.004)); for (let i = 0; i < fade; i++) c[c.length - 1 - i] *= i / fade;   // never end on a click
    });
  }

  // Drive: a soft clip blended in (adds weight and edge without changing the level much)
  if (q.dr) {
    const amt = Math.min(1, Math.max(0, q.dr)), g = 1 + 3.2 * amt, norm = Math.tanh(g);
    out.forEach(c => {
      const peak = Math.max(1e-6, kitPeak([c]));
      for (let i = 0; i < c.length; i++) { const x = c[i] / peak, wet = Math.tanh(g * x) / norm; c[i] = peak * (x * (1 - 0.75 * amt) + wet * 0.75 * amt); }
    });
  }

  // Layers made from noise and a short tone, placed on the hit
  if ((q.ck || q.tl) && out[0].length > 64) {
    const rnd = kitRng(q.sd || 7), peak = kitPeak(out), on = Math.max(0, kitOnset(out[0], peak) - 6), n0 = out[0].length;
    if (q.ck) {            // beater / stick click: ~12 ms, bright. The part that makes a kick or snare "cut through" a phone speaker
      const len = Math.min(n0 - on, Math.floor(sr * 0.012)), f = q.ckf || 2600, raw = new Float32Array(len);
      for (let i = 0; i < len; i++) { const t = i / sr, env = Math.exp(-t / 0.0022) * Math.min(1, i / 6); raw[i] = env * (0.55 * Math.sin(2 * Math.PI * f * t) + 0.55 * (rnd() * 2 - 1)); }
      const click = kitBiquad(raw, sr, "highpass", 1400, 0, 0.7), amp = origPeak * kitDb(-15 + 12 * Math.min(1, q.ck)) / Math.max(1e-6, kitPeak([click]));
      out.forEach(c => { for (let i = 0; i < len; i++) c[on + i] += click[i] * amp; });
    }
    if (q.tl) {            // snare / clap tail: bright noise that rings on after the hit (a modern clap has a little room in it)
      const tld = Math.max(0.02, q.tld || 0.08), late = Math.floor(sr * (type === "clap" ? 0.009 : 0.005)), room = n0 - on - late;
      const len = Math.min(room, Math.floor(sr * Math.min(0.5, tld * 5)));
      if (len > 32) {
        let noise = new Float32Array(len);
        for (let i = 0; i < len; i++) { const t = i / sr; noise[i] = (rnd() * 2 - 1) * Math.exp(-t / tld) * Math.min(1, i / (sr * 0.0015)); }
        noise = kitBiquad(kitBiquad(noise, sr, "highpass", 2200, 0, 0.7), sr, "lowpass", 9500, 0, 0.7);
        const amp = origPeak * kitDb(-30 + 18 * Math.min(1, q.tl)) / Math.max(1e-6, kitPeak([noise]));
        out.forEach(c => { for (let i = 0; i < len; i++) c[on + late + i] += noise[i] * amp; });
      }
    }
  }

  // Level: the same weight (loudness over the first 150 ms) as the recording it came from, never above full scale
  const peak = Math.max(1e-6, kitPeak(out)), rms = Math.max(1e-6, kitRms(out, sr, 0.15));
  let gain = Math.min(1.8, Math.max(0.5, origRms / rms));
  if (peak * gain > origPeak * 1.12) gain = origPeak * 1.12 / peak;       // a hit that was shortened is not boosted past the original's peak
  if (peak * gain > 0.98) gain = 0.98 / peak;
  out.forEach(c => { for (let i = 0; i < c.length; i++) { const v = c[i] * gain; c[i] = Number.isFinite(v) ? v : 0; } });

  return out;
}

// An AudioBuffer from arrays (made on the decoding context, which every other context can play)
function kitBuffer(chans, sr) {
  const ctx = typeof decodeContext === "function" ? decodeContext() : new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  const b = ctx.createBuffer(chans.length, chans[0].length, sr);
  chans.forEach((c, i) => { if (b.copyToChannel) b.copyToChannel(c, i); else b.getChannelData(i).set(c); });
  return b;
}
const KIT_CACHE = new WeakMap();     // recording (AudioBuffer) -> { "<design>": reshaped AudioBuffer }
// The recording reshaped by a design. The same recording and design give the same buffer (made once, then reused).
function kitHit(type, buffer, q) {
  if (!buffer || !q) return buffer;
  const key = JSON.stringify(q);
  let per = KIT_CACHE.get(buffer);
  if (!per) KIT_CACHE.set(buffer, per = {});
  if (!per[key]) {
    try {
      const chans = []; for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(Float32Array.from(buffer.getChannelData(c)));
      per[key] = kitBuffer(kitProcess(type, chans, buffer.sampleRate, q), buffer.sampleRate);
    } catch (err) { console.warn("Kit design skipped:", err && err.message); per[key] = buffer; }
  }
  return per[key];
}

// ---------- what each genre's kit is allowed to become ----------
// [low, high] ranges. Modern Afrobeats: a tuned kick with a bit of beater, a snare and clap with air, bright but not harsh tops.
// The other genres lean from there (amapiano a little rounder, Afro house tighter and brighter, R&B softer and darker, trap harder).
const KIT_BASE = {
  kick:    { p: [0.92, 1.12], dk: [0.50, 1.00], lo: [0, 3], hi: [-1, 2.5], dr: [0, 0.35], ck: [0.40, 0.95], ckf: [1700, 3600] },
  snare:   { p: [0.90, 1.12], dk: [0.09, 0.30], lo: [-2, 1.5], hi: [1, 6], dr: [0, 0.30], ck: [0.25, 0.70], ckf: [2500, 4500], tl: [0.20, 0.75], tld: [0.04, 0.12] },
  clap:    { p: [0.94, 1.10], dk: [0.10, 0.35], hi: [0, 5], dr: [0, 0.25], tl: [0.30, 0.90], tld: [0.06, 0.18] },
  rim:     { p: [0.90, 1.18], dk: [0.03, 0.10], hi: [0, 4], ck: [0.10, 0.35], ckf: [3000, 5000] },
  hat:     { p: [0.94, 1.10], dk: [0.02, 0.06], hi: [0, 5] },
  openhat: { p: [0.94, 1.08], dk: [0.12, 0.30], hi: [0, 4] },
  shaker:  { p: [0.92, 1.12], dk: [0.04, 0.14], hi: [-1, 5] },
  perc:    { p: [0.92, 1.12], dk: [0.10, 0.30], hi: [0, 6], dr: [0, 0.20], ck: [0.30, 0.70], ckf: [1500, 2800] },   // the click is the slap of the hand: the recordings are soft, dark hits
  bell:    { p: [0.92, 1.10], dk: [0.10, 0.40], hi: [-1, 4] }
};
const KIT_LEAN = {          // per genre: ranges that replace the base ones for a type (or a "shift" in dB / ratio)
  afrobeats: {},
  amapiano:  { kick: { ck: [0.15, 0.55], dk: [0.60, 1.20] }, snare: { tl: [0.05, 0.4] }, shaker: { hi: [0, 6], dk: [0.05, 0.16] } },
  afrohouse: { kick: { ck: [0.40, 0.90], dk: [0.40, 0.80] }, hat: { hi: [1, 6] }, openhat: { hi: [1, 5], dk: [0.10, 0.24] } },
  afrolust:  { kick: { ck: [0.15, 0.5] }, snare: { hi: [0, 3], tl: [0.05, 0.4] }, hat: { hi: [0, 3.5] } },
  rnb:       { kick: { ck: [0.10, 0.45], hi: [-2, 1] }, snare: { hi: [-1, 3], tl: [0.05, 0.4] }, hat: { hi: [-1, 3] }, shaker: { hi: [-2, 3] } },
  trap:      { kick: { ck: [0.45, 0.95], dk: [0.60, 1.20], p: [0.90, 1.1] }, snare: { ck: [0.35, 0.8] }, hat: { hi: [1, 6], dk: [0.015, 0.05] } }
};
const KIT_TONE_ROLES = ["chords", "pad", "pluck", "lead"];

// The kit design, perc2/bell2, mix and tone for one beat. Pure: the same seed gives the same answer, and it never touches Math.random.
//   drums   : the beat's drum picks ({ genre, kick: 3, ... })
//   opts    : { keep: { kick: true, ... }  types whose design comes from `from`,  from: the previous beat's drums,
//               keepMix: sound with mix/tone to carry over }
function kitDesign(genre, style, drums, seed, opts) {
  opts = opts || {};
  const rnd = kitRng((seed >>> 0) ^ 0x5bd1e995), lean = KIT_LEAN[genre] || {};
  const range = (a, b) => a + (b - a) * rnd();
  const dsn = {};
  const design = type => {
    const spec = Object.assign({}, KIT_BASE[type], lean[type] || {}), q = {};
    Object.keys(spec).forEach(k => { q[k] = kitRound(range(spec[k][0], spec[k][1])); });
    if (q.hi !== undefined) q.hf = Math.round(range(3500, 6000));
    q.sd = Math.floor(rnd() * 1e6);
    return q;
  };
  const from = opts.from && opts.from.dsn ? opts.from.dsn : null;
  Object.keys(KIT_BASE).forEach(type => {
    const fresh = design(type);                                 // always drawn, so keeping one type does not shift the others
    dsn[type] = opts.keep && opts.keep[type] && from && from[type] ? from[type] : fresh;
  });
  // The second percussion and bell: another recording of the same kind (never the same one)
  const other = (cur, avoidN) => { const o = []; for (let n = 1; n <= SAMPLE_VARIANTS; n++) if (n !== cur && n !== avoidN) o.push(n); return o[Math.floor(rnd() * o.length)]; };
  const out = { dsn, perc2: other(drums.perc), bell2: other(drums.bell) };
  if (opts.from && opts.from.genre === genre) {
    ["perc2", "bell2"].forEach(v => { const t = v.replace("2", ""); if (opts.keep && opts.keep[t] && opts.from[v] && opts.from[v] !== drums[t]) out[v] = opts.from[v]; });
  }
  dsn.perc2 = design("perc"); dsn.bell2 = design("bell");

  const mix = { rev: kitRound(range(0.75, 1.30)), dec: kitRound(range(0.85, 1.25)), dly: kitRound(range(0.70, 1.30)),
    air: kitRound(range(-1, 1.5)), dd: kitRound(range(0, 0.12)), gl: kitRound(range(-2, 2)) };
  const tone = {};
  KIT_TONE_ROLES.forEach(r => { tone[r] = { f: kitRound(range(0.82, 1.22)), c: kitRound(range(-0.06, 0.14)), a: kitRound(range(0.8, 1.5)), r: kitRound(range(0.85, 1.4)) }; });
  tone.bass = { d: kitRound(range(0, 0.12)) };
  out.mix = mix; out.tone = tone;
  return out;
}

// The pieces a beat's sound gets, ready to be merged: drums get dsn/perc2/bell2, the sound gets mix and tone.
function kitApply(sound, genre, style, seed, opts) {
  if (!sound || !sound.drums) return sound;
  const d = kitDesign(genre, style, sound.drums, seed, opts), keepMix = opts && opts.keepMix;
  const drums = Object.assign({}, sound.drums, { dsn: d.dsn, perc2: d.perc2, bell2: d.bell2 });
  return Object.assign({}, sound, { drums, mix: keepMix && keepMix.mix ? keepMix.mix : d.mix, tone: keepMix && keepMix.tone ? keepMix.tone : d.tone });
}

// What the engine does with a beat's mix (clamped, so a hand-edited or damaged number cannot ruin the sound)
const kitClamp = (x, lo, hi, dflt) => Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dflt;
function kitMixValues(mix) {
  const m = mix || {};
  return { rev: kitClamp(m.rev, 0.5, 1.6, 1), dec: kitClamp(m.dec, 0.6, 1.5, 1), dly: kitClamp(m.dly, 0.4, 1.6, 1),
    air: kitClamp(m.air, -3, 3, 0), dd: kitClamp(m.dd, 0, 0.2, 0), gl: kitClamp(m.gl, -3, 3, 0) };
}
function kitToneValues(tone, role) {
  const t = (tone && tone[role]) || {};
  return { f: kitClamp(t.f, 0.6, 1.4, 1), c: kitClamp(t.c, -0.1, 0.2, 0), a: kitClamp(t.a, 0.6, 2, 1), r: kitClamp(t.r, 0.6, 2, 1), d: kitClamp(t.d, 0, 0.2, 0) };
}
