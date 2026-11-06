"use strict";
// Master engine on a synthetic "song" (kick + bass + chord pad + vocal-like tone). Checks loudness target and true-peak ceiling.
const fs = require("fs"), path = require("path"), vm = require("vm");
const g = globalThis; g.window = g; g.self = g; g.document = { getElementById: () => null, createElement: () => ({}), addEventListener() {} };
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"), { filename: f });
load("studio.js"); load("levelmatch.js");
const E = g.VocalVaultStudio.engine, M = g.VocalVaultLevels && g.VocalVaultLevels.engine;
if (!M) { console.log("no loudness meter exported"); process.exit(2); }
const sr = 44100, secs = 20, n = sr * secs;
function song(level, peaky) {
  const L = new Float32Array(n), R = new Float32Array(n); let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / sr, beat = t % 0.5, kick = Math.exp(-beat * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-beat * 30)) * beat) * (peaky ? 1.4 : 0.9);
    const bass = 0.25 * Math.sin(2 * Math.PI * 55 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t));
    const pad = 0.12 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t));
    const hat = (t % 0.25 < 0.02) ? 0.12 * rnd() : 0, voc = 0.18 * Math.sin(2 * Math.PI * 330 * t + 3 * Math.sin(2 * Math.PI * 5.5 * t)) * (Math.sin(2 * Math.PI * 0.3 * t) > -0.3 ? 1 : 0.1);
    L[i] = (kick + bass + pad + hat + voc) * level; R[i] = (kick + bass + pad * 0.9 + hat + voc * 1.05) * level;
  }
  return [L, R];
}
let bad = 0;
for (const [name, level, peaky, target] of [["quiet mix", 0.18, false, -12.5], ["normal mix", 0.4, false, -12.5], ["peaky hot mix", 0.7, true, -10], ["peaky quiet", 0.25, true, -14]]) {
  const r = E.master(song(level, peaky), sr, { targetLufs: target, ceilingDb: -1, maxLimiterDb: 4.5, meter: M });
  const rep = r.report, tp = E.truePeakDb(r.channels);
  const ok = tp <= -0.95; if (!ok) bad++;
  console.log(name.padEnd(14), "in", rep.inputLufs.toFixed(1), "LUFS -> out", rep.outputLufs.toFixed(1), "(target", target + ")", "| true peak", tp.toFixed(2), "dB (ceiling -1)", ok ? "OK" : "OVER", "| limiter max", (rep.limiterMaxDb || 0).toFixed(1), "dB");
}
process.exit(bad ? 1 : 0);
