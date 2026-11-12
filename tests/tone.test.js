"use strict";
// Tone guard: a vocal that was dulled by processing gets its top end back, a vocal that kept its shine is left alone,
// and a very noisy / dull one is not lifted past the cap.
const fs = require("fs"), path = require("path"), vm = require("vm");
const g = globalThis; g.window = g; g.self = g; g.document = { getElementById: () => null, createElement: () => ({}), addEventListener() {} };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js/studio.js"), "utf8"), { filename: "studio.js" });
const E = g.VLStudio.engine;
const sr = 44100, n = sr * 12;
let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
// a voiced-ish signal: harmonics of 200 Hz with 1/h roll-off + a little breath noise, in phrases with gaps
function voice(top) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, ph = (t % 3) < 2.4 ? 1 : 0;                      // 2.4 s of singing, 0.6 s gap
    let v = 0; for (let h = 1; h <= 40; h++) v += Math.sin(2 * Math.PI * 200 * h * t) / Math.pow(h, top);
    x[i] = ph * (0.12 * v + 0.004 * rnd());
  }
  return x;
}
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log(ok ? "PASS " : "FAIL ", name.padEnd(52), extra || ""); };
const bright = voice(0.9);
const dull = E.runCascade(bright, [E.design.highShelf(4800, -5, sr)]);       // what cleaning + tuning + compression can add up to
const mB = E.measureTop([bright], sr).medianDb, mD = E.measureTop([dull], sr).medianDb;
console.log("top-end ratio  bright:", mB.toFixed(1), "dB   dulled:", mD.toFixed(1), "dB");
const r = E.restoreTop([dull], sr, [bright], sr, {});
check("dulled vocal gets its shine back", r.applied && r.afterDb > r.beforeDb + 1.8 && Math.abs(r.afterDb - mB) < 1.0, `+${r.boostDb.toFixed(1)} dB shelf, ${r.beforeDb.toFixed(1)} -> ${r.afterDb.toFixed(1)} dB`);
check("never lifted past the ceiling (-13 dB)", r.afterDb <= -12.5, r.afterDb.toFixed(1));
const same = E.restoreTop([bright], sr, [bright], sr, {});
check("a vocal that kept its brightness is left alone", !same.applied);
const capped = E.restoreTop([dull], sr, [bright], sr, { maxBoostDb: 1.5 });
check("a rough take is only lifted up to the cap", capped.applied && capped.boostDb <= 1.5 + 1e-9, capped.boostDb.toFixed(1) + " dB");
check("output is finite and same length", r.channels[0].length === n && r.channels[0].every(Number.isFinite));
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
