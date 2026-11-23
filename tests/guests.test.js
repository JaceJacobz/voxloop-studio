"use strict";
// Studio melody "Full band": guest instruments. Every guest must be a real recording from the library, have a playing range, never be an
// instrument the beat already uses, change with the seed, and play from its recording (held ones loop, struck ones ring and are damped).
const fs = require("fs"), vm = require("vm"), path = require("path");
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m.padEnd(70) + (x || "")); };
const SR = 44100;
const LIB = new Function(fs.readFileSync(path.join(__dirname, "../js/instrumentmap.js"), "utf8") + ";return INSTRUMENT_LIBRARY")();

function recording(midi, decay) {                                   // test stand-in for a recording: a held tone, or one that dies away
  const n = Math.round(3.5 * SR), d = new Float32Array(n), f = 440 * Math.pow(2, (midi - 69) / 12);
  for (let i = 0; i < n; i++) { const t = i / SR; d[i] = 0.2 * Math.sin(2 * Math.PI * f * t) * (decay ? Math.exp(-t * 2.2) : 1); }
  return { sampleRate: SR, duration: 3.5, numberOfChannels: 1, getChannelData: () => d };
}
const ABOVE = { marimba: 12, vibraphone: 12, kalimba: 12, mbira: 12, balafon: 12, glockenspiel: 12 };
function load() {
  const sb = { console, Math, Float32Array, Float64Array, Uint8Array, Set, Map, WeakMap, Array, Object, Promise, setTimeout, setInterval: () => 0, clearTimeout };
  sb.document = { readyState: "loading", addEventListener() {}, querySelector: () => null, getElementById: () => null };
  sb.window = sb; sb.addEventListener = () => {};
  sb.INSTRUMENT_LIBRARY = LIB;
  sb.instrumentInfo = (id) => LIB[id] || null;
  // like the real recordings: six of them sound an octave above the note they are filed under (measured, see README v2.25.4 / v2.25.5).
  // The REAL js/instrumentbank.js is loaded, so what is tested is the code that offers the recordings (instrumentSet), not a copy of it.
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/instrumentbank.js"), "utf8"), sb);
  const bank = {}; Object.keys(LIB).forEach((id) => LIB[id].notes.forEach((n) => { bank[id + "/" + n] = recording(n + (ABOVE[id] || 0), LIB[id].kind === "decay"); }));
  vm.runInContext("(function (b) { Object.keys(b).forEach(function (k) { INSTRUMENT_BANK[k] = b[k]; }); })", sb)(bank);
  sb.soundInstrumentIds = (sound) => Object.values(sound || {}).filter((v) => typeof v === "string");
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/melody.js"), "utf8"), sb);
  return sb.VLMelody._internal;
}
const T = load();
const rms = (x, a, b) => { a = Math.round(a); b = Math.round(b); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

// 1. the tables
const roles = ["answer", "fill", "sparkle", "support"];
let missing = [], noReg = [], notMelodic = [];
Object.keys(T.GUESTS).forEach((g) => roles.forEach((r) => T.GUESTS[g][r].forEach((id) => { if (!LIB[id]) missing.push(id); if (!T.REG[id]) noReg.push(id); else if (LIB[id] && LIB[id].kind === "808") notMelodic.push(id); })));
ok(missing.length === 0, "every guest is a recording in the instrument library", missing.join(","));
ok(noReg.length === 0, "every guest has a playing range", noReg.join(","));
ok(notMelodic.length === 0, "no drum / 808 recordings among the guests");
const badReg = Object.entries(T.REG).filter(([, r]) => !(r.hi - r.lo >= 12)).map(([k]) => k);
ok(badReg.length === 0, "every range is at least an octave wide (so a line fits)", badReg.join(","));

// 2. choosing
const g1 = T.chooseGuests("afrobeats", { lead: "kalimba", pluck: "guitar-nylon" }, 1);
ok(g1.answer.length === 2 && g1.fill && g1.sparkle && g1.support, "a guest for every role is chosen", JSON.stringify(g1));
ok(!g1.all.includes("kalimba") && !g1.all.includes("guitar-nylon"), "never an instrument the beat already plays");
ok(!g1.all.includes("trumpet"), "the trumpet is not a guest (it is already in the mix)");
const again = T.chooseGuests("afrobeats", { lead: "kalimba", pluck: "guitar-nylon" }, 1);
ok(JSON.stringify(again) === JSON.stringify(g1), "the same seed gives the same guests");
const seen = new Set(); for (let s = 1; s <= 12; s++) seen.add(T.chooseGuests("amapiano", null, s).all.join("+"));
ok(seen.size >= 4, "other seeds ('Regenerate') bring other instruments", seen.size + " different line-ups in 12 seeds");
const noGuest = T.chooseGuests("nope-style", null, 3);
ok(noGuest.all.length > 0, "an unknown style falls back to the neutral set");
let inPool = true; for (let s = 1; s <= 20; s++) ["afrobeats", "amapiano", "afrohouse", "rnb", "trap", "universal"].forEach((k) => { const g = T.chooseGuests(k, null, s), pool = T.GUESTS[k]; if (!g.answer.every((i) => pool.answer.includes(i)) || (g.fill && !pool.fill.includes(g.fill)) || (g.sparkle && !pool.sparkle.includes(g.sparkle)) || (g.support && !pool.support.includes(g.support))) inPool = false; });
ok(inPool, "guests only come from their style's list (20 seeds x 6 styles)");

// 3. playing
const held = new Float32Array(SR * 6); T.renderRecorded(held, SR, { t: 0.5, dur: 4.5, midi: 64, vel: 0.8, role: "answer" }, {}, "saxophone");
ok(rms(held, SR * 0.6, SR * 1.2) > 0.03 && rms(held, SR * 3.5, SR * 4.5) > 0.03, "a held instrument (sax) sounds, and is kept going past its recording's end", "rms " + rms(held, SR * 3.5, SR * 4.5).toFixed(3));
ok(rms(held, 0, SR * 0.49) === 0 && rms(held, Math.round(SR * 5.3), SR * 6) < 1e-4, "it is silent before the note and stops after it");
const struck = new Float32Array(SR * 6); T.renderRecorded(struck, SR, { t: 0.5, dur: 0.4, midi: 72, vel: 0.8, role: "fill" }, {}, "kalimba");
ok(rms(struck, SR * 0.5, SR * 0.7) > 0.02, "a struck instrument (kalimba) sounds on the hit", "rms " + rms(struck, SR * 0.5, SR * 0.7).toFixed(3));
ok(rms(struck, Math.round(SR * 1.3), SR * 6) < 1e-4, "and is damped soon after the note ends (does not ring on)");
ok(rms(struck, 0, SR * 0.49) === 0, "nothing before it");
const loud = new Float32Array(SR * 3), soft = new Float32Array(SR * 3);
T.renderRecorded(loud, SR, { t: 0.2, dur: 1, midi: 62, vel: 0.9, role: "answer" }, {}, "flute"); T.renderRecorded(soft, SR, { t: 0.2, dur: 1, midi: 62, vel: 0.4, role: "answer" }, {}, "flute");
ok(rms(loud, SR * 0.3, SR * 1) > rms(soft, SR * 0.3, SR * 1), "harder playing is louder");
const sp = new Float32Array(SR * 3), an = new Float32Array(SR * 3);
T.renderRecorded(sp, SR, { t: 0.2, dur: 1, midi: 76, vel: 0.8, role: "sparkle" }, {}, "vibraphone"); T.renderRecorded(an, SR, { t: 0.2, dur: 1, midi: 76, vel: 0.8, role: "answer" }, {}, "vibraphone");
ok(rms(sp, SR * 0.2, SR * 0.7) < rms(an, SR * 0.2, SR * 0.7), "a chime is placed softer than an answer");
// 3b. a written note sounds as written (the recording's own octave is accounted for)
function hzOf(x, from, n, lo, hi) {                                       // autocorrelation: the first lag that is nearly as good as the best one
  const cs = []; let best = 0;
  for (let lag = Math.floor(SR / hi); lag < Math.floor(SR / lo); lag++) { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i < n; i++) { const a = x[from + i], b = x[from + i + lag]; s += a * b; e1 += a * a; e2 += b * b; } const c = s / Math.sqrt(e1 * e2 + 1e-18); cs.push([lag, c]); if (c > best) best = c; }
  const first = cs.find(([, c], i) => c >= 0.97 * best && (i === 0 || c >= cs[i - 1][1]) && (i === cs.length - 1 || c >= cs[i + 1][1]));
  return SR / (first || cs[0])[0];
}
Object.keys(ABOVE).concat(["saxophone", "cello"]).forEach((id) => {
  const midi = id === "cello" ? 52 : id === "glockenspiel" ? 84 : 72, r = T.REG[id];       // a note inside the instrument's own sounding range (outside it the player moves it by whole octaves)
  const o = new Float32Array(SR * 3); T.renderRecorded(o, SR, { t: 0.1, dur: 1.2, midi, vel: 0.8, role: "answer" }, {}, id);
  const f = hzOf(o, Math.round(SR * 0.2), 3000, 150, 1500), want = 440 * Math.pow(2, (midi - 69) / 12), cents = 1200 * Math.log2(f / want);
  ok(Math.abs(cents) < 30, "a written note sounds as written: " + id.padEnd(13), Math.round(cents) + " cents");
});
ok(Object.keys(ABOVE).every((id) => T.REG[id].lo >= 48), "the six octave-corrected instruments have sounding ranges");

// 4. nothing recorded -> nothing played, nothing made up
const sb2 = load; const none = new Float32Array(SR * 2); let threw = false;
try { const T2 = (function () { const s = { console, Math, Float32Array, Float64Array, Uint8Array, Set, Map, WeakMap, Array, Object, Promise, setTimeout, setInterval: () => 0, clearTimeout }; s.document = { readyState: "loading", addEventListener() {}, querySelector: () => null, getElementById: () => null }; s.window = s; s.addEventListener = () => {}; s.instrumentSet = () => null; vm.createContext(s); vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/melody.js"), "utf8"), s); return s.VLMelody._internal; })(); T2.renderRecorded(none, SR, { t: 0.2, dur: 1, midi: 62, vel: 0.8, role: "answer" }, {}, "cello"); } catch (e) { threw = true; }
ok(!threw && rms(none, 0, none.length) === 0, "a guest whose recordings are missing plays nothing (never a code-made sound)");
console.log(fail ? "\n" + fail + " FAILED" : "\nall passed (" + pass + ")");
process.exit(fail ? 1 : 0);
