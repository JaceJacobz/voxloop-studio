"use strict";
// End-to-end: synthetic vocal -> VLBrain.analyzeClip -> chain. Regression check on synthetic voices only.
const fs = require("fs"), path = require("path"), vm = require("vm"), S = require("./synth-voice");
const g = globalThis; g.window = g; g.self = g;
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"), { filename: f });
load("pitchcorrect.js"); g.createTuneEngine = createTuneEngine;
load("fxrack-dsp.js"); load("voiceid.js"); load("fxbrain.js");
(async () => {
  const cases = [["baritone sung", S.sung(125, 7, 12), { tract: 1, sibHz: 5400 }], ["female sung", S.sung(230, 7, 12), { tract: 1.16, sibHz: 7000 }], ["male rap", S.rapped(120, 7, 12), { tract: 1, sibHz: 5400 }], ["female rap", S.rapped(210, 7, 12), { tract: 1.16, sibHz: 7000 }]];
  let bad = 0;
  for (const [n, plan, o] of cases) {
    const { x, sr } = S.render(plan, Object.assign({ seed: 3 }, o));
    const beat = { bpm: 100, key: { rootPc: 9, scale: "minor", label: "A minor", refCents: 0 }, genreId: "afrobeats", busy: 0.5, bright: 0.5, space: 0.5 };
    const r = await VLBrain.analyzeClip([x], sr, { type: "main", style: "polished", beat });
    const tune = r.chain.find((c) => c.type === "tune"), de = r.chain.find((c) => c.type === "deess"), eq = r.chain.find((c) => c.type === "eq");
    console.log(n.padEnd(14), "|", r.prof.label);
    console.log("   tune:", tune ? "ON speed " + tune.params.speed : "off", "| de-ess:", de ? de.params.freq + " Hz" : "none", "| EQ low cut:", eq && eq.params.hp, "presF", eq && eq.params.presF);
    const isRap = n.includes("rap"); if ((isRap && tune) || (!isRap && !tune && r.prof.delivery !== "sung")) { /* tune may be skipped if pitch is already exact */ }
    if (isRap && tune) bad++;
    if (r.prof.delivery !== (isRap ? "rapped" : "sung")) bad++;
  }
  console.log(bad ? bad + " problem(s)" : "all as expected");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
