"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), S = require("./synth-voice");
const g = globalThis; g.window = g; g.self = g;
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"), { filename: f });
load("pitchcorrect.js"); g.createTuneEngine = createTuneEngine; load("fxrack-dsp.js");
(async () => {
  const eng = S.loadTuneEngine(), key = { rootPc: 9, scale: "minor", refCents: 0 }, inKey = (m) => [0, 2, 3, 5, 7, 8, 10].includes((((Math.round(m) - 9) % 12) + 12) % 12);
  // a vocal that sits exactly on A minor notes
  const plan = [], A = 57; let t = 0.1; [0, 3, 7, 5, 2, 0, 10 - 12, 7].forEach((d) => { plan.push({ t0: t, dur: 0.7, vowel: 0, hz: () => S.midiHz(A + d) }); t += 0.75; });
  const { x, sr } = S.render(plan, { tract: 1, seed: 2 });
  const trL = eng.trackClean(x, sr), hopS = trL.hop / sr;
  const med = (a) => { a = a.filter((v) => !isNaN(v)).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };
  const noteMed = (tr, t0) => med(Array.from(tr.midi).filter((_, k) => k * hopS > t0 + 0.15 && k * hopS < t0 + 0.6));
  let bad = 0;
  for (const [deg, expect] of [[2, "3rd above"], [4, "5th above"], [7, "octave above"], [-2, "3rd below"], [-4, "5th below"], [-7, "octave below"]]) {
    const r = await VLFx.runTask("harmonize", { channels: [x], sr, options: { rootPc: 9, scale: "minor", refCents: 0, degrees: deg, retuneMs: 25 } });
    const trH = eng.trackClean(r.channels[0], sr), iv = [], inK = [];
    plan.forEach((n) => { const a = noteMed(trL, n.t0), b = noteMed(trH, n.t0); iv.push(Math.round(b - a)); inK.push(inKey(b)); });
    inK.forEach((v) => { if (!v) bad++; });
    console.log(expect.padEnd(14), "semitones from lead per note:", iv.join(","), "| all in A minor:", inK.every(Boolean));
  }
  const out = await VLFx.P.harmony.process([x], sr, Object.assign(VLFx.defaults("harmony"), { v1: "3rd above", v2: "5th above" }), { key });
  let pk = 0, pk0 = 0; for (const v of out.channels[0]) pk = Math.max(pk, Math.abs(v)); for (const v of x) pk0 = Math.max(pk0, Math.abs(v));
  console.log("plugin: stereo", out.channels.length === 2, "| length", out.channels[0].length, ">=", x.length, "| peak ratio vs input", (pk / pk0).toFixed(2), "| no-key fallback:", JSON.stringify((await VLFx.P.harmony.process([x], sr, Object.assign(VLFx.defaults("harmony"), { v1: "3rd above", v2: "octave above" }), {})).info));
  console.log(bad ? "FAIL: " + bad + " notes outside the key" : "OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
