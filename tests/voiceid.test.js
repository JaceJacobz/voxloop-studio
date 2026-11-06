"use strict";
const S = require("./synth-voice"), VoiceID = require("../js/voiceid.js");
const eng = S.loadTuneEngine();
// [name, plan, tract scale, sibilant Hz, expect {delivery, sizeIn, regIn}]
const cases = [];
const male = (n, hz, d) => cases.push({ n, hz, tract: 1.0, sib: 5400, kind: d });
male("baritone sung 125Hz", 125, "sung"); male("tenor sung 200Hz", 200, "sung"); male("bass sung 90Hz", 90, "sung");
cases.push({ n: "alto sung 230Hz", hz: 230, tract: 1.16, sib: 7000, kind: "sung" });
cases.push({ n: "soprano sung 340Hz", hz: 340, tract: 1.2, sib: 7600, kind: "sung" });
cases.push({ n: "male falsetto 330Hz", hz: 330, tract: 1.0, sib: 5400, kind: "sung" });
cases.push({ n: "low female sung 170Hz", hz: 170, tract: 1.16, sib: 7000, kind: "sung" });
cases.push({ n: "male rap 115Hz", hz: 115, tract: 1.0, sib: 5400, kind: "rapped" });
cases.push({ n: "male rap 150Hz fast", hz: 150, tract: 1.0, sib: 5400, kind: "rapped", rate: 7.5 });
cases.push({ n: "female rap 210Hz", hz: 210, tract: 1.16, sib: 7000, kind: "rapped" });
cases.push({ n: "spoken-ish 4/s 130Hz", hz: 130, tract: 1.0, sib: 5400, kind: "rapped", rate: 4.2 });
let pass = 0, fail = 0;
for (const c of cases) {
  const plan = c.kind === "sung" ? S.sung(c.hz, 7, 14) : S.rapped(c.hz, 7, 14, c.rate);
  const { x, sr } = S.render(plan, { tract: c.tract, sibHz: c.sib, seed: 3, breath: 0.03 });
  const tr = eng.trackClean(x, sr), notes = eng.segmentNotes(tr.midi);
  const p = VoiceID.describe({ mono: x, sr, midi: tr.midi, hop: tr.hop, notes });
  const ok = p.delivery.label === c.kind || (c.kind === "sung" && p.delivery.label === "mixed" && false);
  const sibOk = !p.sib || Math.abs(p.sib.hz - c.sib) < 1800;
  const f = (v, d) => v == null ? "-" : v.toFixed(d == null ? 2 : d);
  console.log((ok && sibOk ? "PASS " : "FAIL ") + c.n.padEnd(24), "|", p.delivery.label.padEnd(6), "reg:", p.register.padEnd(22),
    "sib", p.sib ? f(p.sib.hz, 0) : "-", "| sus", f(p.delivery.sustained), "plat", f(p.delivery.plateau), "syl/s", f(p.delivery.syllablesPerSec, 1), "score", f(p.delivery.score), "conf", f(p.confidence), "harm", f(p.harmonicity));
  ok && sibOk ? pass++ : fail++;
}
console.log(pass + " passed, " + fail + " failed");
