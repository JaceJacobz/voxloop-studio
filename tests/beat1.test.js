"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), B = require("./synth-beat");
const g = globalThis; g.window = g; g.self = g; g.document = { getElementById: () => null, createElement: () => ({}), addEventListener() {} };
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"), { filename: f });
load("studio.js"); load("musictheory.js".replace("musictheory", "fill")); 
const Fill = g.VocalVaultFill.engine;
const VAR = process.argv[2] || 'base'; const results = []; let ok = 0, tot = 0; const byPat = {};
const pats = Object.keys(B.PATTERNS), progs = ["minor4", "major4", "minor2", "major2"], tempos = process.env.Q ? [92] : [92, 105], pres = [0, 1, 2, 3];
let seed = 1;
for (const pattern of pats) for (const prog of progs) for (const bpm of tempos) {
  const preBeats = pres[(seed++) % 4], b = B.render({ bpm, pattern, prog, preBeats, bars: 12, seed, stab: pattern.startsWith("afro"), barsPerChord: VAR === 'slow' ? 2 : 1, drumsOnly: VAR === 'drums', noise: VAR === 'noisy' ? 0.04 : 0 });
  const A = Fill.analyze(b.channels, b.sr, { bpm });
  if (!A) continue;
  const det = A.barStartFrame(1) * A.hopSec, diff = ((det - b.truthFirstBar) % b.bar + b.bar) % b.bar, err = Math.min(diff, b.bar - diff);
  const good = err < 0.06; tot++; if (good) ok++;
  (byPat[pattern] = byPat[pattern] || [0, 0]); byPat[pattern][1]++; if (good) byPat[pattern][0]++;
}
console.log("bar start (beat 1) correct:", ok, "of", tot);
Object.keys(byPat).forEach((p) => console.log("  ", p.padEnd(16), byPat[p][0] + "/" + byPat[p][1]));
