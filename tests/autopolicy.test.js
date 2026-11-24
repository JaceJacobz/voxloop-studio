"use strict";
// Autopilot knows every plugin (js/autopolicy.js): each plugin the FX Rack has is described there, the brain only ever puts on a whole
// clip what the policy says it decides, extras stay extras, the Pitch editor (a hand tool) is never touched, and a plugin added later
// without a line in the policy fails here instead of being used wrongly.
const fs = require("fs"), path = require("path"), vm = require("vm"), S = require("./synth-voice");
const g = globalThis; g.window = g; g.self = g;
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"), { filename: f });
load("pitchcorrect.js"); g.createTuneEngine = createTuneEngine;
load("fxrack-dsp.js"); load("vlclean.js"); load("voiceid.js"); load("autopolicy.js"); load("fxbrain.js");
const Fx = g.VLFx, POL = g.VLAutoPolicy, Brain = g.VLBrain;
let bad = 0;
const check = (name, ok, extra) => { if (!ok) bad++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

(async () => {
  // 1. every plugin in the rack has a line, and no line is left over for a plugin that is gone
  const ids = Fx.ORDER.slice();
  check("the rack has plugins to check", ids.length >= 18, ids.length + " plugins: " + ids.join(", "));
  check("every plugin has an Autopilot policy line", POL.missing(ids).length === 0, POL.missing(ids).join(", ") || "none missing");
  const stale = Object.keys(POL.POLICY).filter((id) => ids.indexOf(id) < 0);
  check("no policy line for a plugin that does not exist", stale.length === 0, stale.join(", ") || "none");
  check("every line says where, when it is used and when it is left alone", ids.every((id) => { const p = POL.entry(id); return p && p.where && p.use && p.never && ["chain", "extra", "hand"].includes(p.mode); }));
  check("the Pitch editor is a hand tool", POL.isHand("pitchedit") && POL.modeOf("pitchedit") === "hand");
  check("only the Pitch editor is a hand tool today", ids.filter((id) => POL.isHand(id)).join() === "pitchedit", ids.filter((id) => POL.isHand(id)).join());
  check("a plugin with no line counts as a hand tool (left alone)", POL.isHand("brand-new-plugin") && POL.missing(["brand-new-plugin"]).length === 1);

  // 2. what the brain puts on a whole clip is only "chain" plugins (several voices, roles and styles)
  const beat = { bpm: 100, key: { rootPc: 9, scale: "minor", label: "A minor", refCents: 0 }, genreId: "afrobeats", busy: 0.5, bright: 0.5, space: 0.5, energy: 0.7,
                 sections: [{ start: 4, end: 9 }, { start: 14, end: 19 }] };
  const voices = [["sung", S.sung(230, 7, 12), { tract: 1.16, sibHz: 7000 }], ["rap", S.rapped(120, 7, 12), { tract: 1, sibHz: 5400 }], ["baritone", S.sung(125, 7, 12), { tract: 1, sibHz: 5400 }]];
  const seen = new Set(); let wholeBad = [], extraBad = [], metas = [];
  for (const [n, plan, o] of voices) {
    const { x, sr } = S.render(plan, Object.assign({ seed: 5 }, o));
    for (const style of ["natural", "polished", "big"]) for (const type of ["main", "adlib", "harmony"]) {
      const r = await Brain.analyzeClip([x], sr, { type, style, beat });
      r.chain.forEach((c) => { seen.add(c.type); if (POL.modeOf(c.type) !== "chain") wholeBad.push(n + "/" + style + "/" + type + ":" + c.type); });
      if (type === "main" && style === "polished") metas.push({ r, sr });
    }
  }
  check("the brain's whole-clip chains only use plugins the policy lets it decide", wholeBad.length === 0, wholeBad.join(", ") || "plugins seen: " + Array.from(seen).sort().join(", "));

  // 3. extras the brain places on part of a clip are all policy "extra" plugins, and nothing else
  const allOn = { doubs: true, tails: true, crowd: true, voice: true, orbit: true, ride: true, resonance: true, harmony: true };
  const used = new Set();
  for (const { r } of metas) {
    const zones = Brain.flavourZones(r.meas, allOn, beat, 0, r.meas.seconds, "main", "lots", { prof: r.prof, key: r.key, lines: null });
    zones.forEach((z) => z.chain.forEach((c) => { used.add(c.type); if (POL.modeOf(c.type) !== "extra") extraBad.push(c.type); }));
  }
  check("extras placed on part of a clip are all policy extras", extraBad.length === 0 && used.size > 0, extraBad.join(", ") || "extras seen: " + Array.from(used).sort().join(", "));

  // 4. what Autopilot turns on by itself matches what the policy says it turns on by itself
  const sungProf = metas[0].r.prof;
  const af = Brain.autoFlavors(Object.assign({}, beat, { genreId: "afrobeats" }), Object.assign({}, sungProf, { delivery: "sung" })).flavors;
  const flavToPlugin = { doubs: "doubler", tails: "delay", crowd: "crowd", voice: "voice", orbit: "orbit", resonance: "resonance", harmony: "harmony" };
  const mism = Object.keys(flavToPlugin).filter((k) => { const on = !!af[k], says = !/^no/.test(POL.entry(flavToPlugin[k]).byDefault || ""); return on !== says; });
  check("which extras Autopilot picks by itself matches the policy's 'byDefault'", mism.length === 0, mism.join(", ") || "all agree");

  // 5. a hand-fixed clip is not tuned again; a hand tool never appears in what Autopilot makes; "Auto this" keeps a hand tool already on the chain
  const handClip = { fxLog: [{ text: "Pitch editor @ 0:01.0-0:03.0", hand: ["pitchedit"] }] }, plainClip = { fxLog: [{ text: "Auto: Tune" }] };
  const mk = () => [{ type: "tune" }, { type: "eq" }, { type: "pitchedit" }, { type: "reverb" }];
  let ch = mk(), fi = []; const d1 = POL.respectHandWork(ch, fi, handClip);
  check("a clip with hand-fixed notes: tuning is dropped, the rest stays", ch.map((c) => c.type).join() === "eq,reverb" && d1.handPitched, ch.map((c) => c.type).join());
  check("…and the plan says why", fi.length === 1 && /by hand/.test(fi[0].text));
  ch = mk(); fi = []; POL.respectHandWork(ch, fi, plainClip);
  check("a normal clip: tuning stays, a hand tool is still never added", ch.map((c) => c.type).join() === "tune,eq,reverb" && fi.length === 0, ch.map((c) => c.type).join());
  const old = [{ type: "pitchedit", params: { moves: { 3: 2 } } }, { type: "eq" }], neu = [{ type: "tune" }, { type: "reverb" }];
  const kept = POL.keepHand(old, neu);
  check("'Auto this' keeps the hand tool and its moves", kept.length === 3 && kept[0].type === "pitchedit" && kept[0].params.moves[3] === 2 && kept.some((c) => c.type === "tune"));
  check("the clips that a pitch-edit made are recognised, plain ones are not", POL.handPitched(handClip) && !POL.handPitched(plainClip) && !POL.handPitched({}) && !POL.handPitched(null));

  // 6. the real whole-song plan (VLBrain.planProject) leaves a hand-fixed clip's notes alone, and tunes the same clip normally otherwise
  {
    const SB = require("./synth-beat");
    const buf = (chs, sr) => ({ numberOfChannels: chs.length, sampleRate: sr, length: chs[0].length, duration: chs[0].length / sr, getChannelData: (i) => chs[Math.min(i, chs.length - 1)] });
    const bt = SB.render({ bpm: 100, pattern: "afroOffbeat", prog: "minor4", bars: 8, seed: 3 }), v = S.render(S.sung(230, 7, 12), { seed: 9, tract: 1.16, sibHz: 7000 });
    const beatBuf = buf(bt.channels, bt.sr), voc = buf([v.x], v.sr);
    const lanes = (extra) => [{ id: "L1", name: "Lead", type: "main", clips: [Object.assign({ id: "c1", name: "take", buffer: voc, start: 0, duration: voc.duration }, extra)] }];
    const plain = await Brain.planProject(lanes({}), beatBuf, { style: "polished" });
    const hand = await Brain.planProject(lanes({ fxLog: [{ text: "Pitch editor", hand: ["pitchedit"] }] }), beatBuf, { style: "polished" });
    const types = (p) => p.lanes[0].chain.map((c) => c.type);
    check("planProject: the same take is tuned when nothing was fixed by hand", types(plain).includes("tune"), types(plain).join());
    check("planProject: a hand-fixed take is not tuned again, its other plugins are unchanged", !types(hand).includes("tune") && types(hand).join() === types(plain).filter((t) => t !== "tune").join(), types(hand).join());
    check("planProject: the plan tells the person why", hand.lanes[0].findings.some((f) => /by hand/.test(f.text)));
    check("planProject: no plan ever contains a hand tool", [plain, hand].every((p) => types(p).every((t) => !POL.isHand(t))));
  }

  // 7. the Auto buttons in fxrack.js ask the policy first (so a hand tool or an extra is never switched off with "not needed")
  const src = fs.readFileSync(path.join(__dirname, "../js/fxrack.js"), "utf8");
  const ap = src.slice(src.indexOf("async function autoPlugin"), src.indexOf("async function autoPlugin") + 1600);
  check("Auto on one plugin asks the policy before it switches anything off", /VLAutoPolicy/.test(ap) && ap.indexOf("pm !== \"chain\"") > 0 && ap.indexOf("pm !== \"chain\"") < ap.indexOf("analyzeClip"));
  check("'Auto this' keeps hand tools", /keepHand\(st\.chain, r\.chain\)/.test(src) && /respectHandWork\(r\.chain, r\.findings, f\.clip\)/.test(src));
  check("applying a chain with a hand tool marks the clip", /\{ hand \}/.test(src) && /isHand\(p\.type\)/.test(src));

  console.log(bad ? bad + " problem(s)" : "all as expected");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
