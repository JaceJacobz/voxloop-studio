"use strict";
// Beats whose chords never play B or B-flat (Am - F - C - Dm): A minor and F major fit the notes equally well.
// 1. the detector must settle it by where the loop starts / rests, not by leakage, and must say what else fits;
// 2. the tuner must leave a sung B or B-flat alone when the key is only a toss-up between those two (and still pull it when it is not).
const B = require("./synth-beat"), S = require("./synth-voice"), MT = require("../js/musictheory.js");
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m.padEnd(70) + (x || "")); };

const Am = [0, 1], F = [8, 0], C = [3, 0], Dm = [5, 1];
Object.assign(B.PROGS, { "Am F C Dm": [Am, F, C, Dm], "Am Dm F C": [Am, Dm, F, C], "F C Dm Am": [F, C, Dm, Am], "C F": [[0, 0], [5, 0]] });
const read = (prog, tonic, seed) => {
  const b = B.render({ bpm: 96, pattern: "rnb", prog, tonic, bars: 16, seed: seed || 5 });
  const mono = new Float32Array(b.channels[0].length); for (let i = 0; i < mono.length; i++) mono[i] = (b.channels[0][i] + b.channels[1][i]) / 2;
  return MT.analyzeKey(mono, b.sr);
};
const nm = (k) => k.key + " " + k.scale;

for (const seed of [5, 9]) {
  const a = read("Am F C Dm", 57, seed);
  ok(nm(a) === "A Minor", "Am F C Dm (starts on Am) reads A minor [seed " + seed + "]", "-> " + nm(a));
  ok(a.ambiguous === true && a.alsoFits.some((f) => f.key === "F" && f.scale === "Major"), "  and says F major also fits", JSON.stringify(a.alsoFits.map((f) => f.key + " " + f.scale)));
  ok(Array.isArray(a.alsoAllow) && a.alsoAllow.indexOf(10) >= 0, "  and offers B-flat as an allowed extra note", JSON.stringify(a.alsoAllow));
  ok(Array.isArray(a.tieNotes) && a.tieNotes.indexOf(10) >= 0 && a.tieNotes.indexOf(11) >= 0, "  and names B and B-flat as the unplayed notes", JSON.stringify(a.tieNotes));
}
{
  const a = read("Am Dm F C", 57); ok(nm(a) === "A Minor", "Am Dm F C reads A minor", "-> " + nm(a));
  const f = read("F C Dm Am", 57); ok(nm(f) === "F Major", "F C Dm Am (starts on F) reads F major", "-> " + nm(f));
  const c = read("C F", 48); ok(nm(c) === "C Major", "C - F (starts on C) reads C major (was F major)", "-> " + nm(c));
}
{ // a beat that really plays every note is NOT ambiguous
  const m = read("minor4", 48); ok(m.ambiguous === false && !m.alsoAllow.length, "a beat that plays all seven notes is not ambiguous", nm(m));
}

// ---- the tuner
const eng = S.loadTuneEngine();
const sing = (midis) => { const plan = []; let t = 0.4; midis.forEach((m, k) => { plan.push({ t0: t, dur: 0.6, vowel: k % 5, hz: (tt) => S.midiHz(m + 0.12 * Math.sin(2 * Math.PI * 5.5 * tt) * Math.min(1, tt / 0.2)) }); t += 0.66; }); return S.render(plan, { tract: 1.1, sibHz: 6500, seed: 3, noise: 0.0005 }); };
// notes sung: B natural (71) four times and B-flat (70) four times, in A/F context, on both sides of the beat's toss-up
const NOTES = [69, 71, 72, 71, 69, 70, 69, 70, 72, 70, 69, 71];
const { x, sr } = sing(NOTES);
const noteMedians = (ch) => {
  const mono = eng.mixDown([ch]), tr = eng.trackClean(mono, sr), notes = eng.segmentNotes(tr.midi);
  return notes.map((n) => n.center);
};
const base = { strength: 1, retuneMs: 10, selective: false, flatten: 0, adaptive: false, autoTranspose: false, refCents: 0 };
const run = (o) => eng.process([x], sr, Object.assign({}, base, o)).audio.tuned[0];
const nearestSemis = (cs, want) => cs.filter((c) => Math.abs(c - want) < 0.9);
const pitchOf = (ch, midi) => { const c = noteMedians(ch); const hit = nearestSemis(c, midi); return hit.length ? hit : []; };
{ // truth is F major as the key but nobody plays B: B natural was sung 3x -> without help, it is pulled onto Bb/A. With "also allow B", it stays.
  const plain = run({ rootPc: 5, scale: "major" }), safe = run({ rootPc: 5, scale: "major", alsoAllow: [11] });
  const nB = (ch) => noteMedians(ch).filter((c) => Math.abs(c - 71) < 0.25).length;
  ok(nB(plain) < 3, "F major alone: sung B naturals are pulled away from B", "kept " + nB(plain) + " of 3");
  ok(nB(safe) >= 3, "F major + B allowed: sung B naturals stay on B", "kept " + nB(safe) + " of 3");
}
{ // the other way round: A minor chosen, B-flat sung 3x
  const plain = run({ rootPc: 9, scale: "minor" }), safe = run({ rootPc: 9, scale: "minor", alsoAllow: [10] });
  const nBb = (ch) => noteMedians(ch).filter((c) => Math.abs(c - 70) < 0.25).length;
  ok(nBb(plain) < 3, "A minor alone: sung B-flats are pulled away from B-flat", "kept " + nBb(plain) + " of 3");
  ok(nBb(safe) >= 3, "A minor + B-flat allowed: sung B-flats stay on B-flat", "kept " + nBb(safe) + " of 3");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
