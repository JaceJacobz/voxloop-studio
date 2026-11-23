"use strict";
// The ringing remover (studio.js deResonate) must never mistake the singer's own notes for room ringing.
// A song built on a few notes stacks the same partials in the long-term spectrum; those used to be flagged and dipped (-4.5 dB, on the voice).
// It must still act on a bump that sits at the same frequency whatever note is sung.
const fs = require("fs"), path = require("path"), vm = require("vm"), Sv = require("./synth-voice");
const g = globalThis; g.window = g; g.self = g; g.document = { getElementById: () => null, createElement: () => ({}), addEventListener() {} };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js/studio.js"), "utf8"), { filename: "studio.js" });
const E = g.VLStudio.engine, sr = 44100;
let pass = 0, fail = 0; const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m.padEnd(66) + (x || "")); };

function sing(notes, tract, seed, secs) {
  const plan = []; let t = 0.4, a = seed; const rr = () => (a = (a * 1664525 + 1013904223) >>> 0) / 4294967296;
  while (t < secs) { const m = notes[Math.floor(rr() * notes.length)]; const dur = 0.4 + 0.4 * rr(); plan.push({ t0: t, dur, vowel: Math.floor(rr() * 5), hz: (tt) => Sv.midiHz(m + 0.2 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, tt / 0.2)) }); t += dur + 0.1; }
  return Sv.render(plan, { tract, sibHz: 5400, seed, noise: 0.0005, breath: 0.06 }).x;
}
function ring(x, hz, q, gain) { const y = new Float32Array(x.length), w = 2 * Math.PI * hz / sr, r = Math.exp(-Math.PI * (hz / q) / sr), a1 = 2 * r * Math.cos(w), a2 = -r * r; let s1 = 0, s2 = 0; for (let i = 0; i < x.length; i++) { const v = (1 - r) * x[i] + a1 * s1 + a2 * s2; s2 = s1; s1 = v; y[i] = x[i] + gain * v; } return y; }
const HOOK = (b) => [b, b + 3, b + 7, b + 5, b + 10, b + 12], WIDE = (b) => [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17].map((d) => b + d);

for (const [lab, base, tract, set] of [["mid voice, few notes", 57, 1.0, HOOK], ["mid voice, wide melody", 57, 1.0, WIDE], ["high voice, few notes", 69, 0.9, HOOK], ["high voice, wide melody", 69, 0.9, WIDE]]) {
  const r = E.deResonate([sing(set(base), tract, 9, 40)], sr, {});
  ok(!r.applied && r.bands.length === 0, lab + ": a clean take is left untouched", r.bands.map((b) => b.hz + " Hz").join(" "));
}
{ // a very short take with just two notes cannot tell a ring from a sung partial: it must do nothing
  const r = E.deResonate([sing([57, 64], 1.0, 9, 14)], sr, {});
  ok(!r.applied, "two-note take: nothing is dipped (cannot tell ring from singing)");
}
{ // a narrow ring at the same frequency on every note is still found
  const r = E.deResonate([ring(sing(HOOK(57), 1.0, 9, 40), 2500, 15, 4)], sr, {});
  ok(r.applied && r.bands.some((b) => Math.abs(b.hz - 2500) / 2500 < 0.05), "a 2.5 kHz room-style ring on a mid voice is still caught", r.bands.map((b) => b.hz + " Hz").join(" "));
}
console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
