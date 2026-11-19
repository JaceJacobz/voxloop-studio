"use strict";
// Studio melody: the recorded trumpet. A past bug made every trumpet note silent (the loop stopped at the first sample, where the
// attack starts at zero). This loads js/melody.js with a stand-in "recording" (a held tone; only the test uses a tone) and checks
// that a written note is played from the recording, at the written pitch, only while it should sound, and that without recordings
// nothing is played and nothing is made up.
const fs = require("fs"), vm = require("vm"), path = require("path");
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m.padEnd(64) + (x || "")); };
const SR = 44100, midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function recording(midi) {                                  // 3.5 s held note with a little body, like a sustained brass recording
  const n = Math.round(3.5 * SR), d = new Float32Array(n), f = midiHz(midi);
  for (let i = 0; i < n; i++) { const t = i / SR; d[i] = 0.3 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t)) / 1.75; }
  return { sampleRate: SR, duration: 3.5, numberOfChannels: 1, getChannelData: () => d };
}
function load(withRecordings) {
  const sandbox = { console, Math, Float32Array, Float64Array, Uint8Array, Set, Map, Array, Object, Promise, setTimeout, setInterval: () => 0, clearTimeout };
  sandbox.document = { readyState: "loading", addEventListener() {}, querySelector: () => null, getElementById: () => null };
  sandbox.window = sandbox; sandbox.addEventListener = () => {};
  sandbox.instrumentSet = withRecordings ? () => ({ info: { kind: "sustain" }, notes: [60, 64, 67, 70], buffers: { 60: recording(60), 64: recording(64), 67: recording(67), 70: recording(70) } }) : () => null;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/melody.js"), "utf8"), sandbox);
  return sandbox.VLMelody._internal;
}
function pitch(x, from, n) {                                // autocorrelation pitch (Hz) of n samples from `from`
  let best = 0, bl = 0;
  for (let lag = Math.floor(SR / 1200); lag < Math.floor(SR / 150); lag++) { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i < n; i++) { const a = x[from + i], b = x[from + i + lag]; s += a * b; e1 += a * a; e2 += b * b; } const c = s / Math.sqrt(e1 * e2 + 1e-18); if (c > best) { best = c; bl = lag; } }
  return SR / bl;
}
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

const T = load(true);
const out = new Float32Array(SR * 5);
T.renderTrumpet(out, SR, { t: 1.0, dur: 1.2, midi: 62, vel: 0.8 }, { muted: false });
ok(rms(out, SR * 1.2, SR * 2.0) > 0.05, "a written note is played from the recording (not silent)", "rms " + rms(out, SR * 1.2, SR * 2.0).toFixed(3));
ok(rms(out, 0, SR * 0.99) === 0, "nothing sounds before the note starts");
ok(rms(out, Math.round(SR * 2.45), SR * 5) < 1e-4, "it has faded out shortly after the note ends", "tail rms " + rms(out, Math.round(SR * 2.45), SR * 5).toExponential(1));
const hz = pitch(out, Math.round(SR * 1.3), 4096), cents = 1200 * Math.log2(hz / midiHz(62));
ok(Math.abs(cents) < 25, "it plays the written pitch (D4)", hz.toFixed(1) + " Hz, " + cents.toFixed(1) + " cents off");
const out2 = new Float32Array(SR * 8);
T.renderTrumpet(out2, SR, { t: 0.5, dur: 5, midi: 66, vel: 0.9 }, { muted: true });
ok(rms(out2, SR * 4, SR * 5) > 0.03, "a note longer than the recording is held (steady middle looped)", "rms " + rms(out2, SR * 4, SR * 5).toFixed(3));
const out3 = new Float32Array(SR * 2);
T.renderTrumpet(out3, SR, { t: 0.1, dur: 0.3, midi: 70, vel: 0.5 }, { muted: false });
ok(rms(out3, Math.round(SR * 0.15), Math.round(SR * 0.35)) > 0.02, "a short note sounds too");

const N = load(false), out4 = new Float32Array(SR * 3);
let threw = false; try { N.renderTrumpet(out4, SR, { t: 0.5, dur: 1, midi: 62, vel: 0.8 }, {}); } catch (e) { threw = true; }
ok(!threw && rms(out4, 0, out4.length) === 0, "without recordings it plays nothing (and makes nothing up)");
console.log(fail ? "\n" + fail + " FAILED" : "\nall passed (" + pass + ")");
process.exit(fail ? 1 : 0);
