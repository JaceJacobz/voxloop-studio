"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), S = require("./synth-voice");
const g = globalThis; g.window = g; g.self = g;
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"), { filename: f });
load("pitchcorrect.js"); g.createTuneEngine = createTuneEngine; load("fxrack-dsp.js"); load("voiceid.js"); load("fxbrain.js");
const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
function rnd(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }
function withBed(x, sr, o) { const r = rnd(5), y = Float32Array.from(x); for (let i = 0; i < y.length; i++) { y[i] += (r() * o.noiseDb) ; if (o.hum) { for (let h = 1; h <= 4; h++) y[i] += o.humAmp / h * Math.sin(2 * Math.PI * o.hum * h * i / sr); } } return y; }
let bad = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
(async () => {
  const sr = 44100, voc = S.render(S.sung(150, 7, 12), { tract: 1, sibHz: 5400, seed: 3, noise: 0 });
  // ---- gate: voice + hiss at about -50 dBFS between lines
  const hissAmp = Math.pow(10, -50 / 20) * Math.sqrt(3);
  const x = withBed(voc.x, sr, { noiseDb: hissAmp });
  // voice (3 s) + 2 s of silence + voice (3 s), all with the same hiss
  const seg = Math.round(3 * sr), gapN = Math.round(2 * sr), xs = new Float32Array(seg * 2 + gapN); xs.set(voc.x.subarray(Math.round(1 * sr), Math.round(1 * sr) + seg), 0); xs.set(voc.x.subarray(Math.round(5 * sr), Math.round(5 * sr) + seg), seg + gapN);
  const x2 = withBed(xs, sr, { noiseDb: hissAmp }), gapAt = seg + Math.round(0.4 * sr), blk = Math.round(1.2 * sr), loudAt = Math.round(0.3 * sr), vblk = Math.round(2 * sr);
  const gp = VLFx.defaults("gate"); gp.thr = -40; gp.range = 14;
  const y = VLFx.P.gate.process([x2], sr, gp).channels[0];
  { const d = db(rms(y, gapAt, gapAt + blk)) - db(rms(x2, gapAt, gapAt + blk)); ok(d < -12 && d > -15, "gate quiets the gap by its 14 dB range (" + d.toFixed(1) + " dB)"); }
  { const dl = db(rms(y, loudAt, loudAt + vblk)) - db(rms(x2, loudAt, loudAt + vblk)); ok(Math.abs(dl) < 0.5, "gate leaves the voice alone (" + dl.toFixed(2) + " dB)"); }
  // word start: a burst after silence; its first 6 ms must survive
  const burst = new Float32Array(sr), r2 = rnd(9); for (let i = 0; i < sr; i++) burst[i] = (r2() * hissAmp);
  const t0 = Math.round(0.5 * sr); for (let i = 0; i < 0.3 * sr; i++) burst[t0 + i] += 0.2 * Math.sin(2 * Math.PI * 300 * i / sr);
  const yb = VLFx.P.gate.process([burst], sr, gp).channels[0];
  const first = db(rms(yb, t0 + 20, t0 + Math.round(0.006 * sr))) - db(rms(burst, t0 + 20, t0 + Math.round(0.006 * sr)));
  ok(first > -1.5, "word start is not chopped (first 6 ms changed by " + first.toFixed(2) + " dB)");
  // ---- hum
  const detect = (xx) => VLBrain.measureVocal ? VLBrain.measureVocal([xx], sr).hum : null;
  const cases = [["clean", withBed(voc.x, sr, { noiseDb: 0.0003 }), null], ["hiss only", x, null], ["50 Hz hum", withBed(voc.x, sr, { noiseDb: 0.0005, hum: 50, humAmp: 0.004 }), 50], ["60 Hz hum", withBed(voc.x, sr, { noiseDb: 0.0005, hum: 60, humAmp: 0.004 }), 60]];
  for (const [n, sig, want] of cases) { const h = detect(sig); ok((want == null ? h == null : h && h.hz === want), "hum detector on " + n + ": " + (h ? h.hz + " Hz (" + h.strengthDb.toFixed(0) + " dB)" : "none")); }
  // removal
  const hum = withBed(voc.x, sr, { noiseDb: 0.0005, hum: 50, humAmp: 0.004 }), gp2 = VLFx.defaults("gate"); gp2.range = 0; gp2.hum = "50 Hz";
  const yh = VLFx.P.gate.process([hum], sr, gp2).channels[0], h2 = VLBrain.measureVocal([yh], sr).hum;
  ok(!h2, "after the hum notch the hum is gone (detector: " + (h2 ? h2.hz + " Hz" : "none") + ")");
  // ---- brain adds it by itself
  const beat = { bpm: 100, key: { rootPc: 9, scale: "minor", refCents: 0 }, genreId: "universal", busy: 0.6, bright: 0.5, space: 0.5 };
  const r = await VLBrain.analyzeClip([withBed(voc.x, sr, { noiseDb: hissAmp, hum: 50, humAmp: 0.004 })], sr, { type: "main", style: "polished", beat });
  const gi = r.chain.find((c) => c.type === "gate");
  ok(!!gi && gi.params.hum === "50 Hz", "brain adds a gate with 50 Hz hum removal for a noisy humming take: " + (gi ? gi.reason : "no gate"));
  const r0 = await VLBrain.analyzeClip([withBed(voc.x, sr, { noiseDb: 0.0002 })], sr, { type: "main", style: "polished", beat });
  ok(!r0.chain.find((c) => c.type === "gate"), "brain adds no gate to a clean take");
  console.log(bad ? bad + " failed" : "all passed"); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
