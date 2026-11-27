"use strict";
// The kit designer (v2.27.0): each beat's own drum tuning, second percussion, mix and tone.
//   1. a design comes from the seed alone: the same seed gives the same design, another seed another one, and Math.random is never touched
//      (so the notes and patterns a seed makes stay exactly what they were)
//   2. every number sits inside its genre's range, and the second percussion / bell is another recording than the first
//   3. a drum that is reshaped stays the same loudness, stays finite, never passes full scale, never changes the original recording
//   4. what a design does is what it says: the click makes a kick's attack brighter, the tail lengthens a clap's top end, a short ring-out tightens
//   5. keeping a type (a locked "drums" group) keeps its design and the others change; an old beat (no design) is left exactly as it was
//   6. a damaged mix or tone value is clamped to something safe
// Plain arithmetic on arrays: no browser needed. (Whether it sounds good is for ears; tests/e2e/kit.js checks it is wired into a real beat.)
const fs = require("fs"), path = require("path"), vm = require("vm");
const g = globalThis; g.window = g; g.SAMPLE_VARIANTS = 5;
const mkBuffer = (chs, sr) => ({ numberOfChannels: chs.length, sampleRate: sr, length: chs[0].length, duration: chs[0].length / sr, getChannelData: (i) => chs[i], copyToChannel(a, i) { chs[i] = Float32Array.from(a); } });
g.decodeContext = () => ({ createBuffer: (n, len, sr) => { const chs = []; for (let i = 0; i < n; i++) chs.push(new Float32Array(len)); return mkBuffer(chs, sr); } });
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js/kitdesign.js"), "utf8"), { filename: "kitdesign.js" });
let bad = 0;
const check = (name, ok, extra) => { if (!ok) bad++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };
const SR = 44100;

// ---- synthetic drum hits
const rnd = kitRng(99);
const kick = () => { const x = new Float32Array(Math.round(SR * 0.4)); let ph = 0; for (let i = 0; i < x.length; i++) { const t = i / SR, f = 50 + 70 * Math.exp(-t / 0.03); ph += 2 * Math.PI * f / SR; x[i] = 0.9 * Math.sin(ph) * Math.exp(-t / 0.12); } return x; };
const noiseHit = (len, tau) => { const x = new Float32Array(Math.round(SR * len)); for (let i = 0; i < x.length; i++) x[i] = (rnd() * 2 - 1) * Math.exp(-i / SR / tau) * 0.8; return x; };
const peak = (x) => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; };
const rmsFirst = (x, sec) => { let s = 0; const n = Math.min(x.length, Math.round(SR * sec)); for (let i = 0; i < n; i++) s += x[i] * x[i]; return Math.sqrt(s / n); };
const db = (a, b) => 20 * Math.log10(a / b);
const hiShare = (x, from, to) => { let hi = 0, all = 0; const hp = kitBiquad(x.slice(from, to), SR, "highpass", 3000, 0, 0.7); for (let i = 0; i < hp.length; i++) hi += hp[i] * hp[i]; for (let i = from; i < to; i++) all += x[i] * x[i]; return hi / (all || 1); };

// ============================================================== 1. a design comes from the seed
const realRandom = Math.random; let draws = 0; Math.random = () => { draws++; return realRandom(); };
const drums = { genre: "afrobeats", kick: 2, snare: 4, clap: 1, rim: 3, hat: 5, openhat: 1, shaker: 2, perc: 3, bell: 4 };
const a1 = kitDesign("afrobeats", "smooth", drums, 12345), a2 = kitDesign("afrobeats", "smooth", drums, 12345), b = kitDesign("afrobeats", "smooth", drums, 12346);
Math.random = realRandom;
check("1: the same seed gives the same design", JSON.stringify(a1) === JSON.stringify(a2));
check("1: another seed gives another design (kick, snare and the mix all differ)", JSON.stringify(a1.dsn.kick) !== JSON.stringify(b.dsn.kick) && JSON.stringify(a1.dsn.snare) !== JSON.stringify(b.dsn.snare) && JSON.stringify(a1.mix) !== JSON.stringify(b.mix));
check("1: making a design never draws from Math.random", draws === 0, draws + " draws");

// ============================================================== 2. ranges, and the second percussion
let outOfRange = [], same = 0, total = 0;
["afrobeats", "amapiano", "afrohouse", "afrolust", "rnb", "trap"].forEach((genre) => {
  for (let s = 1; s <= 200; s++) {
    const d = kitDesign(genre, "x", Object.assign({}, drums, { genre }), s * 7919), lean = KIT_LEAN[genre] || {};
    Object.keys(KIT_BASE).forEach((type) => {
      const spec = Object.assign({}, KIT_BASE[type], lean[type] || {});
      Object.keys(spec).forEach((k) => { const v = d.dsn[type][k]; if (!(v >= spec[k][0] - 0.0011 && v <= spec[k][1] + 0.0011)) outOfRange.push(genre + "/" + type + "." + k + "=" + v); });
    });
    total++; if (d.perc2 === drums.perc || d.bell2 === drums.bell || !(d.perc2 >= 1 && d.perc2 <= 5) || !(d.bell2 >= 1 && d.bell2 <= 5)) same++;
    if (!(d.mix.rev >= 0.75 && d.mix.rev <= 1.3 && d.mix.dec >= 0.85 && d.mix.dec <= 1.25 && d.mix.dly >= 0.7 && d.mix.dly <= 1.3)) outOfRange.push(genre + "/mix");
  }
});
check("2: every number is inside its genre's range (6 genres x 200 beats)", outOfRange.length === 0, outOfRange.slice(0, 3).join(", "));
check("2: the second percussion and bell are always another recording (1-5, not the first one)", same === 0, same + " of " + total);
check("2: the design has a type for every drum plus perc2 and bell2", Object.keys(KIT_BASE).concat(["perc2", "bell2"]).every((t) => a1.dsn[t]));

// ============================================================== 3. a reshaped hit
let broke = [], louder = 0, worst = 0;
const sources = { kick: kick(), snare: noiseHit(0.35, 0.08), clap: noiseHit(0.3, 0.05), rim: noiseHit(0.1, 0.012), hat: noiseHit(0.1, 0.02), openhat: noiseHit(0.5, 0.14), shaker: noiseHit(0.2, 0.05), perc: kick(), bell: noiseHit(0.5, 0.1) };
Object.keys(sources).forEach((type) => {
  const src = sources[type], copy = Float32Array.from(src);
  for (let s = 1; s <= 60; s++) {
    const q = kitDesign("afrobeats", "x", drums, s * 31).dsn[type], out = kitProcess(type, [Float32Array.from(src)], SR, q)[0];
    if (!out.every(Number.isFinite)) broke.push(type + " not finite");
    if (peak(out) > 0.981) broke.push(type + " peak " + peak(out).toFixed(3));
    const dif = Math.abs(db(rmsFirst(out, 0.15), rmsFirst(src, 0.15))); worst = Math.max(worst, dif);
    if (out.length < 32) broke.push(type + " too short");
  }
  if (!src.every((v, i) => v === copy[i])) broke.push(type + " original changed");
});
check("3: reshaped drums are finite, never pass full scale, and the recording itself is never changed", broke.length === 0, broke.slice(0, 3).join(", "));
check("3: a reshaped drum weighs about what the recording weighed (within 4 dB, first 150 ms)", worst < 4, worst.toFixed(1) + " dB worst");
const stereo = kitProcess("snare", [noiseHit(0.3, 0.08), noiseHit(0.3, 0.08)], SR, kitDesign("afrobeats", "x", drums, 5).dsn.snare);
check("3: a stereo recording stays stereo with both sides the same length", stereo.length === 2 && stereo[0].length === stereo[1].length);
check("3: no design returns the recording itself", kitProcess("kick", [kick()], SR, undefined)[0].length === kick().length);

// ============================================================== 4. what a design does
const k0 = kick(), onlyClick = kitProcess("kick", [k0], SR, { ck: 1, ckf: 3000, sd: 3 })[0], noClick = kitProcess("kick", [k0], SR, { sd: 3 })[0];
check("4: the click puts more bright energy into the first 12 ms of a kick", hiShare(onlyClick, 0, 530) > 3 * hiShare(noClick, 0, 530) + 1e-6, hiShare(noClick, 0, 530).toExponential(1) + " -> " + hiShare(onlyClick, 0, 530).toExponential(1));
const c0 = noiseHit(0.5, 0.01), tail = kitProcess("clap", [c0], SR, { tl: 1, tld: 0.15, sd: 4 })[0], bare = kitProcess("clap", [c0], SR, { sd: 4 })[0];
const lateRms = (x) => rmsFirst(x.slice(Math.round(SR * 0.08)), 0.2);
check("4: a clap tail rings on after the hit (the part after 80 ms is louder)", lateRms(tail) > 3 * lateRms(bare), db(lateRms(tail), lateRms(bare)).toFixed(1) + " dB");
const sh = kitProcess("kick", [k0], SR, { dk: 0.05, sd: 1 })[0], ring = (x) => { const p = peak(x); for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) < 0.1 * p && i > 200 && peak(x.slice(i, i + 200)) < 0.1 * p) return i / SR; return x.length / SR; };
check("4: a short ring-out tightens a kick", ring(sh) < ring(k0) * 0.8, ring(k0).toFixed(3) + " s -> " + ring(sh).toFixed(3) + " s");
const hi = kitProcess("hat", [noiseHit(0.1, 0.02)], SR, { hi: 6, hf: 4000, sd: 1 })[0], lo = kitProcess("hat", [noiseHit(0.1, 0.02)], SR, { hi: -6, hf: 4000, sd: 1 })[0];
check("4: a bright tilt makes a hat brighter than a dark tilt", hiShare(hi, 0, 3000) > hiShare(lo, 0, 3000));
const up = kitProcess("perc", [k0], SR, { p: 1.2 })[0];
check("4: a higher pitch is a shorter recording", Math.abs(up.length - Math.floor((k0.length - 2) / 1.2)) <= 1, up.length + " vs " + k0.length);
const same1 = kitProcess("kick", [k0], SR, { p: 1.1, ck: 0.5, dk: 0.2, sd: 9 })[0], same2 = kitProcess("kick", [k0], SR, { p: 1.1, ck: 0.5, dk: 0.2, sd: 9 })[0];
check("4: the same design on the same recording is sample for sample the same", same1.every((v, i) => v === same2[i]));
const buf1 = mkBuffer([Float32Array.from(k0)], SR), h1 = kitHit("kick", buf1, { p: 1.05, ck: 0.4, sd: 2 }), h2 = kitHit("kick", buf1, { p: 1.05, ck: 0.4, sd: 2 }), h3 = kitHit("kick", buf1, { p: 0.95, sd: 2 });
check("4: a design is built once per recording and reused; another design is another buffer", h1 === h2 && h1 !== h3 && h1 !== buf1);
check("4: no design: the recording itself comes back (an older beat is untouched)", kitHit("kick", buf1, undefined) === buf1);

// a kick keeps its weight in the sub-bass (the part that makes it a kick on a big speaker): within 1.2 dB on average, 3.2 dB at worst (this test kick has a long tail; the real recordings lose about 0.3 dB)
{
  const lowE = (x) => { let y = kitBiquad(kitBiquad(x, SR, "lowpass", 90, 0, 0.7), SR, "lowpass", 90, 0, 0.7), s = 0; for (const v of y) s += v * v; return s; };
  const k = kick(), e0 = lowE(k); let sum = 0, worstDb = 0;
  for (let s = 1; s <= 60; s++) { const out = kitProcess("kick", [Float32Array.from(k)], SR, kitDesign("afrobeats", "x", drums, s * 53).dsn.kick)[0], d = 10 * Math.log10(lowE(out) / e0); sum += d; worstDb = Math.min(worstDb, d); }
  check("4: a reshaped kick keeps its sub-bass weight (mean within 1.2 dB, worst within 3.2 dB; the test kick has a long tail, so it is harsher than the recordings)", sum / 60 > -1.2 && worstDb > -3.2, (sum / 60).toFixed(2) + " dB mean, " + worstDb.toFixed(2) + " worst");
}

// ============================================================== 5. keeping, and old beats
const prev = Object.assign({}, kitDesign("afrobeats", "smooth", drums, 111).dsn), prevDrums = Object.assign({}, drums, { dsn: prev, perc2: 5, bell2: 2 });
const kept = kitDesign("afrobeats", "smooth", drums, 222, { from: prevDrums, keep: { kick: true, perc: true } });
check("5: a kept type keeps its design, the others are new", JSON.stringify(kept.dsn.kick) === JSON.stringify(prev.kick) && JSON.stringify(kept.dsn.snare) !== JSON.stringify(prev.snare));
check("5: a kept percussion keeps its second recording too", kept.perc2 === 5 && kept.perc2 !== drums.perc);
const free = kitDesign("afrobeats", "smooth", drums, 222), free2 = kitDesign("afrobeats", "smooth", drums, 222, { from: prevDrums, keep: { kick: true } });
check("5: keeping one type does not shift the others (they are the same as with nothing kept)", JSON.stringify(free.dsn.snare) === JSON.stringify(free2.dsn.snare) && JSON.stringify(free.mix) === JSON.stringify(free2.mix));
const sound = { chords: "rhodes", drums: Object.assign({}, drums) }, applied = kitApply(sound, "afrobeats", "smooth", 77);
check("5: kitApply adds a design, perc2, bell2, mix and tone and leaves the rest alone", applied.drums.dsn && applied.drums.perc2 && applied.drums.bell2 && applied.mix && applied.tone && applied.chords === "rhodes" && applied.drums.kick === 2 && !sound.mix && !sound.drums.dsn);
const carried = kitApply(sound, "afrobeats", "smooth", 78, { keepMix: { mix: { rev: 1.1 }, tone: { pad: { f: 1 } } } });
check("5: a variation of a beat keeps the mix and tone it had", carried.mix.rev === 1.1 && carried.tone.pad.f === 1);
check("5: a sound without drums is returned as it is", kitApply({ chords: "x" }, "afrobeats", "smooth", 1).chords === "x" && !kitApply({ chords: "x" }, "afrobeats", "smooth", 1).mix);

// ============================================================== 6. damaged numbers
const m = kitMixValues({ rev: 99, dec: -5, dly: "x", air: NaN, dd: 5, gl: 40 }), n0 = kitMixValues(undefined), t = kitToneValues({ pad: { f: 50, c: -3, a: 0, r: 99 } }, "pad"), t0 = kitToneValues(undefined, "lead");
check("6: a damaged mix is clamped", m.rev <= 1.6 && m.dec >= 0.6 && m.dly === 1 && m.air === 0 && m.dd <= 0.2 && m.gl <= 3, JSON.stringify(m));
check("6: no mix means the plain values (1 / 0)", n0.rev === 1 && n0.dec === 1 && n0.dly === 1 && n0.air === 0 && n0.dd === 0 && n0.gl === 0);
check("6: a damaged tone is clamped, no tone is neutral", t.f <= 1.4 && t.c >= -0.1 && t.a >= 0.6 && t.r <= 2 && t0.f === 1 && t0.c === 0 && t0.a === 1 && t0.r === 1);

console.log(bad ? bad + " problem(s)" : "all as expected");
process.exit(bad ? 1 : 0);
