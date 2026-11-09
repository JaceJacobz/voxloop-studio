"use strict";
// Line-by-line allowed notes: does the brain choose the right set per line, and does the real tune engine then keep the colour notes?
const S = require("./synth-voice"), PB = require("../js/phrasebrain.js");
const eng = S.loadTuneEngine(), A = 45;                         // A2 (a baritone); the song is A minor
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = rng(4), plan = [], truth = [];                         // truth: [{t0,t1,midi}] designed pitch of each note
let t = 0.3;
const LINES = [
  { name: "in key", deg: [0, 3, 7, 5, 3, 0], dur: 0.5, want: "key" },
  { name: "blue note", deg: [0, 3, 5, 6, 6, 7, 5, 3, 0], dur: 0.45, want: "blues" },
  { name: "lift to the 4th (D minor)", deg: [5, 8, 12, 13, 13, 10, 8, 5], dur: 0.5, want: "up4" },
  { name: "rapped", rap: true, want: "rapped" },
  { name: "major colour", deg: [0, 4, 7, 9, 9, 7, 4, 0], dur: 0.5, want: "parallel" }
];
LINES.forEach((L) => {
  if (L.rap) { for (let k = 0; k < 14; k++) { const m0 = A + 3 + (r() * 2 - 1) * 2, sl = (r() * 2 - 1) * 4, d = 0.13; plan.push({ t0: t, dur: d, vowel: k % 5, hz: (tt) => S.midiHz(m0 + sl * (tt / d - 0.5)) }); t += 0.16; } }
  else L.deg.forEach((d, k) => { const m = A + d + (r() * 2 - 1) * 0.22, dur = L.dur; plan.push({ t0: t, dur, vowel: k % 5, hz: () => S.midiHz(m) }); truth.push({ t0: t, t1: t + dur, midi: A + d, line: L.name }); t += dur + 0.02; });
  t += 0.8;                                                      // a breath between lines
});
const { x, sr } = S.render(plan, { tract: 1, sibHz: 5400, seed: 3, breath: 0.02 });
const trk = eng.trackClean(x, sr), notes = eng.segmentNotes(trk.midi), hopSec = trk.hop / sr;
const res = PB.analyze({ notes, hopSec, key: { rootPc: 9, scale: "minor" }, refCents: 0, totalSec: x.length / sr });
let bad = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
console.log("lines found:", res.phrases.length, "| zones:", res.zones.length);
LINES.forEach((L, i) => { const p = res.phrases[i]; if (!p) { ok(false, "line " + (i + 1) + " (" + L.name + ") missing"); return; }
  const got = p.delivery === "rapped" ? "rapped" : p.setId; ok(got === L.want, "line " + (i + 1) + " " + L.name.padEnd(26) + "-> " + (p.delivery === "rapped" ? "rapped, untouched" : p.setLabel)); });
// ---- the real engine: with the zones vs one key for everything
function pitchErrors(audio) {
  const tr2 = eng.trackClean(audio, sr), out = [];
  truth.forEach((n) => { const v = []; for (let k = 0; k < tr2.midi.length; k++) { const ts = k * hopSec; if (ts > n.t0 + 0.12 && ts < n.t1 - 0.05 && !isNaN(tr2.midi[k])) v.push(tr2.midi[k]); } v.sort((a, b) => a - b); const m = v.length ? v[v.length >> 1] : NaN; out.push({ line: n.line, midi: n.midi, err: isNaN(m) ? 99 : Math.abs(m - n.midi) * 100 }); });
  return out;
}
const base = { rootPc: 9, scale: "minor", refCents: 0, strength: 1, retuneMs: 20, minRetuneMs: 20, flatten: 0.4, natural: true, adaptive: true, selective: true, selectiveCents: 6, selectiveSoftCents: 14, spokenSung: false };
const one = eng.process([Float32Array.from(x)], sr, base, () => {});
const withZ = eng.process([Float32Array.from(x)], sr, Object.assign({}, base, { zones: res.zones }), () => {});
const e1 = pitchErrors(one.audio.tuned[0]), e2 = pitchErrors(withZ.audio.tuned[0]), e0 = pitchErrors(x);
// notes the pitch tracker already misread BEFORE tuning (a harmonic error on a synthetic vowel) are left out of every column
const valid = e0.map((q) => q.err < 150);
const avg = (e, line) => { const a = e.filter((q, i) => q.line === line && valid[i]); return a.reduce((s, q) => s + q.err, 0) / a.length; };
console.log("\nmean distance (cents) from the pitch the singer meant:\n" + "line".padEnd(28) + "as sung".padStart(8) + "one key".padStart(9) + "per line".padStart(10));
["in key", "blue note", "lift to the 4th (D minor)", "major colour"].forEach((l) => console.log(l.padEnd(28) + avg(e0, l).toFixed(0).padStart(8) + avg(e1, l).toFixed(0).padStart(9) + avg(e2, l).toFixed(0).padStart(10)));
["blue note", "lift to the 4th (D minor)", "major colour"].forEach((l) => ok(avg(e2, l) < avg(e1, l) - 15 && avg(e2, l) < 45, "per-line tuning keeps the " + l + " notes (" + avg(e2, l).toFixed(0) + " vs " + avg(e1, l).toFixed(0) + " cents off with one key)"));
ok(avg(e2, "in key") < 40, "lines already in the key are still tuned (" + avg(e2, "in key").toFixed(0) + " cents off, from " + avg(e0, "in key").toFixed(0) + ")");
console.log(bad ? bad + " failed" : "all passed"); process.exit(bad ? 1 : 0);
