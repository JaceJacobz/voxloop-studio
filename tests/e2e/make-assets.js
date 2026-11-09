// Writes test WAVs (vocal + beat) for the Chromium end-to-end run.  node make-assets.js <scenario> <outdir>
"use strict";
const fs = require("fs"), path = require("path"), S = require("../synth-voice"), B = require("../synth-beat");
function wav(ch, sr) { const n = ch[0].length, nc = ch.length, buf = Buffer.alloc(44 + n * nc * 2); buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * nc * 2, 28); buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(ch[c][i] * 32767))), 44 + (i * nc + c) * 2); return buf; }
const SCEN = {
  rap_inSync: { bpm: 96, pattern: "rnb", prog: "minor4", kind: "rap", delay: 0, noise: 0.0005 },
  rap_late90: { bpm: 96, pattern: "afroAnticipate", prog: "minor4", kind: "rap", delay: 0.09, noise: 0.0005 },
  sung_inSync: { bpm: 96, pattern: "rnb", prog: "minor4", kind: "sung", delay: 0, noise: 0.0005 },
  sung_colour: { bpm: 96, pattern: "rnb", prog: "minor4", kind: "colour", delay: 0, noise: 0.0005 },
  rap_noisy: { bpm: 100, pattern: "halftime", prog: "minor4", kind: "rap", delay: 0, noise: 0.012 }
};
const name = process.argv[2] || "rap_inSync", out = process.argv[3] || "/tmp/e2e", sc = SCEN[name]; fs.mkdirSync(out, { recursive: true });
const bars = 16, beat = B.render({ bpm: sc.bpm, pattern: sc.pattern, prog: sc.prog, bars, seed: 5, tonic: 57, stab: sc.pattern.startsWith("afro") });
let truthOut = null; let plan = sc.kind === "colour" ? (() => { const cv = S.colourVocal(45, 4, 2 * beat.bar + 0.3); truthOut = cv.truth; return cv.plan; })() : sc.kind === "rap" ? S.rappedOnGrid(sc.bpm, bars, 11, 2) : S.sung(200, 11, bars * beat.bar - 2 * beat.bar).map((s) => Object.assign({}, s, { t0: s.t0 + 2 * beat.bar }));
const v = S.render(plan, { tract: 1, sibHz: 5400, seed: 3, noise: sc.noise });
let x = v.x; if (sc.delay) { const d = Math.round(sc.delay * v.sr), o = new Float32Array(x.length + d); o.set(x, d); x = o; }
fs.writeFileSync(path.join(out, "vocal.wav"), wav([x], v.sr)); fs.writeFileSync(path.join(out, "beat.wav"), wav(beat.channels, beat.sr));
if (truthOut) fs.writeFileSync(path.join(out, "truth.json"), JSON.stringify(truthOut));
console.log(JSON.stringify({ name, out, bar: beat.bar, delay: sc.delay }));
