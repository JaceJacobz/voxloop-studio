"use strict";
const S = require("./synth-voice"), B = require("./synth-beat"), AD = require("../js/autodecide.js");
let pass = 0, fail = 0;
const mono = (ch) => ch[0];
function shiftBy(x, sr, sec) { const n = Math.round(sec * sr), o = new Float32Array(x.length + Math.max(0, n)); if (n >= 0) o.set(x, n); else o.set(x.subarray(-n), 0); return o; }
for (const [bpm, pattern, seed] of [[92, "rnb", 1], [105, "afroAnticipate", 2], [120, "fourfloor", 3], [96, "halftime", 4]]) {
  const beat = B.render({ bpm, pattern, prog: "minor4", bars: 12, seed }), bar = beat.bar;
  const plan = S.rappedOnGrid(bpm, 12, seed + 9, 1), v = S.render(plan, { tract: 1, sibHz: 5400, seed: 3 });   // vocal starts at bar 2, in sync
  const trimmed = (x, sec) => x.subarray(Math.round(sec * v.sr));
  const cases = [
    ["in sync (starts bar 2)", v.x, 0, "exact"],
    ["recorded 90 ms late", shiftBy(v.x, v.sr, 0.09), -0.09, "exact"],
    ["recorded 40 ms early", shiftBy(v.x, v.sr, -0.04), 0.04, "exact"],
    ["cut to first word", trimmed(v.x, bar), 0, "bar"],
    ["cut + 60 ms late", trimmed(shiftBy(v.x, v.sr, 0.06), bar), -0.06, "bar"]
  ];
  for (const [name, x, truth, mode] of cases) {
    const d = AD.alignDecision([x], v.sr, beat.channels, beat.sr, {});
    let err = d.offsetSec - truth; if (mode === "bar") { err = ((err % bar) + bar) % bar; err = Math.min(err, bar - err); } else err = Math.abs(err);
    const oldErr = (() => { const first = (z) => { let pk = 0; for (const q of z) pk = Math.max(pk, Math.abs(q)); const th = pk * 0.06; for (let i = 0; i < z.length; i++) if (Math.abs(z[i]) >= th) return i / v.sr; return 0; };
      let e = (first(beat.channels[0]) - first(x)) - truth; if (mode === "bar") { e = ((e % bar) + bar) % bar; e = Math.min(e, bar - e); } else e = Math.abs(e); return e; })();
    const ok = err <= 0.025; ok ? pass++ : fail++;
    console.log((ok ? "PASS " : "FAIL "), (bpm + " " + pattern).padEnd(18), name.padEnd(24), "error", (err * 1000).toFixed(0).padStart(4), "ms (old auto-align:", (oldErr * 1000).toFixed(0) + " ms)", "| conf", d.confidence.toFixed(2), d.method);
  }
}
console.log(pass + " passed, " + fail + " failed");
