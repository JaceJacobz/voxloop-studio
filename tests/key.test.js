"use strict";
const B = require("./synth-beat"), MT = require("../js/musictheory.js");
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const rows = []; const stat = {};
for (const prog of ["minor2", "major2", "minor4", "major4", "minor4b"]) for (const tonicPc of [0, 2, 4, 7, 9, 10]) {
  const tonic = 48 + tonicPc, b = B.render({ bpm: 96, pattern: "rnb", prog, tonic, bars: 8, seed: tonicPc + 3 });
  const mono = new Float32Array(b.channels[0].length); for (let i = 0; i < mono.length; i++) mono[i] = (b.channels[0][i] + b.channels[1][i]) / 2;
  const k = MT.analyzeKey(mono, b.sr, { weights: process.env.W ? JSON.parse(process.env.W) : undefined }); const NM = { "C":0,"C#":1,"Db":1,"D":2,"D#":3,"Eb":3,"E":4,"F":5,"F#":6,"Gb":6,"G":7,"G#":8,"Ab":8,"A":9,"A#":10,"Bb":10,"B":11 };
  if (k && k.key != null) { k.rootPc = NM[k.key]; k.scale = String(k.scale).toLowerCase(); }
  if (!k || k.rootPc == null) { rows.push([prog, NAMES[tonicPc], "none"]); continue; }
  const isMinor = prog.startsWith("minor"), truthScale = isMinor ? "minor" : "major";
  const relPc = isMinor ? (tonicPc + 3) % 12 : (tonicPc + 9) % 12;       // relative key's home note
  const exact = k.rootPc === tonicPc && k.scale === truthScale, sevenOk = exact || (k.rootPc === relPc && k.scale === (isMinor ? "major" : "minor"));
  (stat[prog] = stat[prog] || { exact: 0, seven: 0, n: 0 }); stat[prog].n++; if (exact) stat[prog].exact++; if (sevenOk) stat[prog].seven++;
  if (!exact) rows.push([prog, NAMES[tonicPc] + " " + truthScale, "got " + NAMES[k.rootPc] + " " + k.scale + (sevenOk ? " (same 7 notes)" : " (WRONG notes)")]);
}
Object.keys(stat).forEach((p) => console.log(p.padEnd(8), "exact home note", stat[p].exact + "/" + stat[p].n, "| right 7 notes", stat[p].seven + "/" + stat[p].n));
rows.forEach((r) => console.log("  ", r.join("  ")));
