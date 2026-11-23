"use strict";
// A key you set yourself (Studio "set by you") or the Beat Lab told us is the truth.
// Studio Autopilot must tune to it even when the singing looks like another key.
// A key that was only "listened" (guessed from the audio) can still be corrected by the singing.
const fs = require("fs"), path = require("path"), vm = require("vm"), S = require("./synth-voice");
const g = globalThis; g.window = g; g.self = g;
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"), { filename: f });
load("pitchcorrect.js"); g.createTuneEngine = createTuneEngine;
load("fxrack-dsp.js"); load("voiceid.js"); load("fxbrain.js");

(async () => {
  let bad = 0;
  const check = (name, ok, extra) => { if (!ok) bad++; console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); };

  // A clear A-minor tune: A C D E G with plenty of repetition, so the singing itself says "A minor".
  const PH = [[0, 2, 3, 2, 0], [7, 8, 7, 5, 3], [3, 5, 7, 5, 3, 2, 0], [0, 3, 7, 3, 0], [0, 2, 3, 5, 7], [7, 5, 3, 2, 0]];
  const plan = []; let t = 0.4, k = 0;
  PH.forEach((ph) => {
    ph.forEach((d) => {
      const m = 57 + 12 + d;
      plan.push({ t0: t, dur: 0.5, vowel: k++ % 5, hz: (tt) => S.midiHz(m + 0.15 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, tt / 0.2)) });
      t += 0.53;
    });
    t += 0.5;
  });
  const { x, sr } = S.render(plan, { tract: 1.1, sibHz: 6500, seed: 3, noise: 0.0005 });
  const mk = (rootPc, scale, src) => ({ bpm: 100, key: { rootPc, scale, label: "k", refCents: 0 }, genreId: "afrobeats", busy: 0.5, bright: 0.5, space: 0.5, source: { key: src } });

  for (const [rp, sc] of [[1, "minor"], [6, "major"], [5, "major"]]) {
    for (const src of ["set by you", "Beat Lab"]) {
      const r = await VLBrain.analyzeClip([x], sr, { type: "main", style: "polished", beat: mk(rp, sc, src) });
      check("kept the " + src + " key " + rp + " " + sc, r.key.rootPc === rp && r.key.scale === sc, "-> " + r.key.rootPc + " " + r.key.scale);
    }
  }
  // Guessed-by-ear keys can still be fixed by the singing (that is what the guess is for).
  {
    const r = await VLBrain.analyzeClip([x], sr, { type: "main", style: "polished", beat: mk(1, "minor", "listened") });
    check("a listened key may still be corrected by clear singing", r.key.rootPc === 9 && r.key.scale === "minor", "-> " + r.key.rootPc + " " + r.key.scale);
  }

  // The Pipeline's own decision (autodecide) must also leave a key you set, or one from the Beat Lab, alone.
  {
    const AD = require("../js/autodecide.js");
    const fsm = { rootPc: 6, scale: "Minor", tonicConfidence: 0.35 }, aMaj = { rootPc: 9, scale: "Major", tonicConfidence: 0.9 };
    check("Pipeline may relabel a merely listened key", AD.keyDecision({ beat: fsm, singer: aMaj, notes: 40 }).change === true);
    for (const src of ["set by you", "Beat Lab"]) check("Pipeline never overrides a '" + src + "' key", AD.keyDecision({ beat: Object.assign({ source: src }, fsm), singer: aMaj, notes: 40 }).change === false);
  }

  console.log(bad ? bad + " problem(s)" : "all as expected");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
