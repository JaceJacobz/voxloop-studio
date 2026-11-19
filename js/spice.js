// =====================================================================
// Spice (v2.25.0): every beat gets its own signature, so no two beats feel alike.
//
// A beat rolls three things when it is made (all kept in beat.spice, plain numbers and words, so drafts keep them):
//   main   the character of the groove. One of twelve, chosen from a list written for the genre and the style
//          (Clave pulse, Talking drums, Triplet rolls, Bounce kicks, Half-time chorus, Off-beat stabs, Stop-and-go,
//          Lazy pocket, Four-floor drive, Ghost-note groove, Bouncing bass, Log drum bounce).
//   lift   how the beat leans into a chorus (reverse cymbal swell, filter sweep, both, a one or two beat stop, a bar where the hats hush).
//   extra  a small habit at the end of phrases (snare drags, percussion fills, bass runs, open-hat lifts).
// The choice avoids what the last beats of the same style used (shuffle bag), so pressing New beat gives a different
// character, and each choice also rolls its own details (which clave, which kick pattern, which percussion plays it).
// Seeded like the rest of the generator: the bar you hear, loop or download is always the same bar.
// beatgen.js calls spiceRoll (once per beat), spiceApply (every bar, after the section rules) and spiceFeel (timing).
// Beats made around a voice (Vocal Sketch) get a gentler version: no half-time, fewer added hits under a busy line.
// =====================================================================
"use strict";

const SPICE_ENERGY = { intro: 0.35, verse: 0.7, pre: 0.85, chorus: 1, bridge: 0.55, outro: 0.4, loop: 0.9 };
const _spiceRecent = {};                                   // "genre/style" -> what the last beats used (so the next one differs)

// How well each main spice suits each style (0 = never, 1 = very much). A style that is not listed uses its genre's line.
const SPICE_WEIGHTS = {
  "afrobeats/smooth":    "clave:1,talk:.8,ghost:.8,kick:.7,stab:.5,lazy:.5,stop:.5,bassb:.5,trip:.2,drive:.2,log:.2",
  "afrobeats/afropop":   "clave:.8,talk:.7,kick:.8,ghost:.6,stab:.6,drive:.5,stop:.6,bassb:.6,trip:.3,log:.2",
  "afrobeats/afrofusion": "lazy:1,ghost:.8,talk:.7,clave:.6,stab:.6,kick:.5,stop:.5,bassb:.4,trip:.2",
  "afrobeats/afrorb":    "lazy:1,ghost:.9,talk:.5,stab:.6,stop:.4,kick:.4,clave:.4,bassb:.4",
  "afrobeats/afroswing": "trip:1,half:.6,kick:.8,ghost:.5,stop:.8,bassb:.7,clave:.5,talk:.5,stab:.3,drive:.1",
  "afrobeats/afrorave":  "drive:1,stab:.8,stop:.8,clave:.5,kick:.5,talk:.5,trip:.3,bassb:.5",
  "afrobeats/streetpop": "kick:.9,trip:.6,clave:.6,stop:.7,talk:.6,ghost:.4,drive:.5,stab:.5,bassb:.6",
  "afrobeats/highlife":  "clave:.9,talk:.8,ghost:.7,stab:.7,lazy:.4,kick:.5,stop:.4,bassb:.4",
  "afrobeats":           "clave:1,talk:.7,ghost:.6,kick:.7,stab:.5,stop:.5,bassb:.5,lazy:.4,trip:.3,drive:.3",
  "rnb/slowjam":         "lazy:1,ghost:.9,stab:.6,kick:.4,stop:.4,bassb:.5,talk:.2",
  "rnb/trapsoul":        "trip:1,half:.8,lazy:.6,ghost:.5,kick:.6,stop:.6,bassb:.6",
  "rnb/neosoul":         "ghost:1,lazy:.9,stab:.9,kick:.6,bassb:.7,clave:.3,stop:.3",
  "rnb/altrnb":          "lazy:.8,half:.6,stab:.6,stop:.7,ghost:.5,kick:.5,trip:.3,bassb:.5",
  "rnb/newjack":         "ghost:.9,kick:.8,stab:.8,lazy:.4,drive:.3,trip:.2,bassb:.7,stop:.5",
  "rnb/poprnb":          "kick:.8,stab:.7,drive:.5,trip:.4,ghost:.5,stop:.7,bassb:.6,clave:.3",
  "rnb":                 "ghost:.8,lazy:.7,stab:.6,kick:.6,bassb:.5,stop:.5,trip:.3",
  "amapiano/classic":    "log:1,talk:.7,clave:.5,stab:.8,drive:.5,kick:.4,stop:.6,bassb:.6,ghost:.2,lazy:.3",
  "amapiano/privateschool": "stab:1,log:.8,lazy:.6,ghost:.6,talk:.5,clave:.4,stop:.4,bassb:.5",
  "amapiano/sgija":      "log:1,trip:.6,kick:.6,drive:.5,stop:.6,talk:.5,stab:.5,bassb:.6",
  "amapiano":            "log:1,stab:.7,talk:.6,stop:.5,bassb:.5,clave:.4,drive:.4",
  "afrohouse/deephouse": "drive:1,stab:.9,clave:.8,talk:.7,stop:.8,lazy:.3,bassb:.5,kick:.2",
  "afrohouse/gqom":      "kick:1,drive:.8,talk:.7,stop:.8,clave:.4,trip:.4,bassb:.6,stab:.3",
  "afrohouse":           "drive:.9,stab:.7,clave:.6,talk:.6,stop:.8,kick:.4",
  "trap/hardtrap":       "trip:1,half:.7,stop:1,kick:.8,bassb:.8,ghost:.2",
  "trap/melodictrap":    "trip:.8,half:.8,stab:.6,lazy:.4,stop:.7,kick:.6,bassb:.6",
  "trap/drill":          "trip:.7,stop:.9,kick:.8,bassb:.7,half:.3,talk:.3",
  "trap":                "trip:.9,stop:.8,half:.6,kick:.7,bassb:.6",
  "afrolust/velvet":     "lazy:1,ghost:.8,clave:.5,talk:.5,stab:.6,kick:.6,bassb:.5,stop:.4",
  "afrolust/rap":        "kick:.9,stop:.9,trip:.5,ghost:.5,bassb:.7,half:.5,stab:.4,clave:.4",
  "afrolust/tide":       "lazy:1,ghost:.6,stab:.6,talk:.5,stop:.4,clave:.4,bassb:.3",
  "afrolust/moonlit":    "clave:1,talk:.8,ghost:.7,stab:.6,lazy:.5,kick:.5,stop:.4",
  "afrolust/smoke":      "lazy:.9,half:.7,ghost:.7,stab:.5,stop:.7,trip:.4,kick:.5,bassb:.5",
  "afrolust/slowwine":   "kick:.9,clave:.7,talk:.6,drive:.4,stab:.6,ghost:.6,stop:.5,lazy:.6,bassb:.6",
  "afrolust":            "lazy:.8,ghost:.7,clave:.6,talk:.5,stab:.5,kick:.6,stop:.5"
};

const SPICE_MAIN = {
  clave: { name: "Clave pulse", what: t => "A two-bar clave (the Afro-Cuban 3-2 pattern) ticks on the " + t + " and flips every bar, so the percussion has a spine." },
  talk:  { name: "Talking drums", what: () => "Two percussion voices ask and answer each other across two bars, then shout together at the end of the phrase." },
  trip:  { name: "Triplet rolls", what: () => "Quick hi-hat rolls at the ends of beats, with the hats thinning out in between so the rolls pop." },
  kick:  { name: "Bounce kicks", what: () => "The kick leaves the straight beat and bounces on the off-beats; the bass locks in with it." },
  half:  { name: "Half-time chorus", what: () => "The chorus drops into half-time: the snare waits for beat 3 and the hats double up." },
  stab:  { name: "Off-beat stabs", what: () => "The keys stop holding chords and stab on the off-beats." },
  stop:  { name: "Stop-and-go", what: () => "The beat catches its breath at the end of phrases (a beat of near silence), then slams back." },
  lazy:  { name: "Lazy pocket", what: () => "The snare sits a touch behind the beat, with extra swing, ghost notes and thinner hats." },
  drive: { name: "Four-floor drive", what: () => "Open hats on the off-beats, and the choruses lock to a four-on-the-floor kick." },
  ghost: { name: "Ghost-note groove", what: () => "Soft ghost notes between the backbeats keep the groove talking." },
  bassb: { name: "Bouncing bass", what: () => "The bass jumps octaves and syncopates instead of sitting on the root." },
  log:   { name: "Log drum bounce", what: () => "The log drum plays a syncopated bounce between the bass notes (the Amapiano trademark)." }
};
const SPICE_LIFT = {
  reverse:  { name: "Reverse swell", what: "A reversed cymbal swells into every chorus." },
  sweep:    { name: "Filter sweep", what: "The keys and pads close down, then burst open on the chorus." },
  both:     { name: "Swell and sweep", what: "A reverse swell and a filter sweep into every chorus." },
  stop:     { name: "One-beat stop", what: "Everything drops out for the last beat before the chorus, then lands together." },
  halfstop: { name: "Two-beat stop", what: "Everything stops for the last two beats before the chorus, under a reverse swell." },
  hush:     { name: "Hats hush", what: "The hats and percussion lay out for the last bar before the chorus, under a reverse swell." }
};
const SPICE_EXTRA = {
  drag:    { name: "Snare drags", what: "The snare gets a quick drag (a double hit) at the end of phrases." },
  percfill:{ name: "Percussion fills", what: "A little percussion run at the end of phrases." },
  bassrun: { name: "Bass runs", what: "The bass climbs a little run at the end of phrases." },
  hatlift: { name: "Open-hat lifts", what: "An open hat breathes in at the end of phrases." },
  none:    { name: "No extras", what: "Nothing added at the ends of phrases." }
};

function spiceParseWeights(str) {
  const o = {};
  String(str || "").split(",").forEach(p => { const [k, v] = p.split(":"); if (k) o[k.trim()] = parseFloat(v); });
  return o;
}
function spiceWeightFor(genre, style) {
  return spiceParseWeights(SPICE_WEIGHTS[genre + "/" + style] || SPICE_WEIGHTS[genre] || "clave:1,talk:.6,kick:.6,ghost:.6,stop:.5");
}
function spiceWeightedPick(items, weightOf) {
  const w = items.map(weightOf), total = w.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// Is this spice audible in this beat? It needs the tracks it plays on to be in at least one verse, chorus or bridge.
function spiceNeeds(id, o) {
  const pres = (o.presence || []), kinds = (o.sections || []).map(s => s.kind);
  const has = names => pres.some((p, i) => kinds[i] !== "intro" && kinds[i] !== "outro" && names.some(n => p[n]));
  const riffs = o.riffs || {};
  if (!pres.length) return true;                                      // a plain loop: everything is there
  switch (id) {
    case "clave": return has(["rim", "perc", "bell"]);
    case "talk": return has(["perc"]) && has(["rim", "bell"]) || has(["perc", "rim"]);
    case "trip": return has(["hat", "shaker"]);
    case "kick": return has(["kick"]);
    case "half": return has(["snare", "clap"]) && has(["hat"]);
    case "stab": return has(["chords"]);
    case "stop": return true;
    case "lazy": return has(["snare", "clap", "rim"]);
    case "drive": return has(["openhat", "hat"]) && has(["kick"]);
    case "ghost": return has(["snare", "clap", "rim"]);
    case "bassb": return has(["bass"]) && !riffs.bass;
    case "log": return has(["logdrum"]) && !riffs.logdrum;
    case "drag": return has(["snare", "clap"]);
    case "percfill": return has(["perc", "rim", "bell"]);
    case "bassrun": return has(["bass"]) && !riffs.bass;
    case "hatlift": return has(["openhat"]);
    default: return true;
  }
}
function spicePresentIn(o, names) {
  const pres = o.presence || [], kinds = (o.sections || []).map(s => s.kind);
  return names.filter(n => pres.some((p, i) => kinds[i] !== "intro" && p[n]));
}

// Roll the spice of a new beat. o = { from (the beat it follows), presence, sections, riffs, keepSpice }
function spiceRoll(genreKey, styleId, t, o) {
  o = o || {};
  if (o.keepSpice && o.from && o.from.spice) return JSON.parse(JSON.stringify(o.from.spice));
  const key = genreKey + "/" + styleId;
  const recent = _spiceRecent[key] || (_spiceRecent[key] = { main: [], lift: [], extra: [] });
  const prev = o.from && o.from.spice ? o.from.spice : null;
  const avoid = (list, id, prevId) => (list.includes(id) ? 0.12 : 1) * (id === prevId ? 0.03 : 1);
  const w = spiceWeightFor(genreKey, styleId);

  const mains = Object.keys(SPICE_MAIN).filter(id => (w[id] || 0) > 0 && spiceNeeds(id, o));
  const mainId = spiceWeightedPick(mains.length ? mains : ["stop"], id => (w[id] || 0.1) * avoid(recent.main, id, prev && prev.id));

  const liftW = { reverse: 1, sweep: 0.6, both: 0.85, stop: 0.55, halfstop: 0.35, hush: 0.45 };
  const fam = genreKey;
  if (fam === "trap" || fam === "afrohouse") { liftW.stop += 0.4; liftW.halfstop += 0.3; }
  if (fam === "rnb" || fam === "afrolust") { liftW.sweep += 0.4; liftW.hush += 0.2; liftW.halfstop -= 0.2; }
  if (mainId === "stop") { liftW.stop = 0.1; liftW.halfstop = 0.1; }           // its habit is already stopping
  const liftId = spiceWeightedPick(Object.keys(liftW), id => liftW[id] * avoid(recent.lift, id, prev && prev.lift && prev.lift.id));

  const exW = { drag: 0.8, percfill: fam === "afrobeats" || fam === "amapiano" || fam === "afrolust" ? 1 : 0.5, bassrun: 0.6, hatlift: 0.6, none: 0.08 };
  if (mainId === "talk" || mainId === "clave") exW.percfill *= 0.4;
  if (mainId === "bassb") exW.bassrun *= 0.3;
  const extras = Object.keys(exW).filter(id => id === "none" || spiceNeeds(id, o));
  const extraId = spiceWeightedPick(extras, id => exW[id] * avoid(recent.extra, id, prev && prev.extra && prev.extra.id));

  recent.main.push(mainId); recent.lift.push(liftId); recent.extra.push(extraId);
  ["main", "lift", "extra"].forEach(k => { while (recent[k].length > 3) recent[k].shift(); });

  const ri = n => Math.floor(Math.random() * n);
  const p = {};
  const back = ["snare", "clap", "rim"].filter(n => o.tracks && o.tracks[n] && (o.tracks[n][4] || o.tracks[n][12]));   // tracks that carry the backbeat stay untouched by clave / talk
  p.back = back;
  let what;
  if (mainId === "clave") {
    const tr = spicePresentIn(o, ["rim", "perc", "bell"]); const order = ["rim", "perc", "bell"].filter(n => !back.includes(n) && (!tr.length || tr.includes(n)));
    p.variant = ri(3); p.track = order[ri(order.length)] || (back.includes("rim") ? "perc" : "rim");
    what = SPICE_MAIN.clave.what(p.track === "perc" ? "percussion" : p.track);
  } else if (mainId === "talk") {
    // two different voices: the ones already in the beat first, then whichever other percussion is needed (the claim switches it on)
    const free = ["perc", "rim", "bell"].filter(n => !back.includes(n));
    const tr = spicePresentIn(o, free), others = free.filter(n => !tr.includes(n));
    const pool = tr.concat(others.sort(() => Math.random() - 0.5));
    const a = pool[ri(Math.min(2, pool.length))], b = pool.filter(n => n !== a)[0];
    p.variant = ri(4); p.a = a; p.b = b;
  } else if (mainId === "kick") { p.variant = ri(4); }
  else if (mainId === "stab") { p.variant = ri(5); }
  else if (mainId === "bassb") { p.variant = ri(4); }
  else if (mainId === "log") { p.variant = ri(4); }
  else if (mainId === "ghost") { p.variant = ri(3); }
  else if (mainId === "half") { p.variant = ri(2); }
  else if (mainId === "trip") { p.double = 0.25 + Math.random() * 0.3; }
  else if (mainId === "stop") { p.beats = Math.random() < 0.75 ? 1 : 2; p.odds = 0.5 + Math.random() * 0.3; }
  else if (mainId === "drive") { p.offbass = Math.random() < 0.5; }
  else if (mainId === "lazy") { p.late = 10 + Math.round(Math.random() * 7); }

  // Feel: a few spices change the swing and the timing of the backbeat
  const baseSwing = typeof t.swing === "number" ? t.swing : 0;
  const swingDelta = { lazy: baseSwing >= 0.24 ? 0.02 + Math.random() * 0.02 : 0.04 + Math.random() * 0.04, drive: -0.02, kick: 0.01 + Math.random() * 0.02, ghost: 0.02, clave: 0.01, talk: 0.01 }[mainId];
  const swing = swingDelta ? clampNum(Math.round((baseSwing + swingDelta) * 100) / 100, 0, 0.32) : null;
  const late = mainId === "lazy" ? { snare: p.late, clap: p.late, rim: Math.round(p.late * 0.7), kick: -2 } : null;

  return {
    id: mainId, name: SPICE_MAIN[mainId].name, what: what || SPICE_MAIN[mainId].what(),
    lift: { id: liftId, name: SPICE_LIFT[liftId].name, what: SPICE_LIFT[liftId].what },
    extra: { id: extraId, name: SPICE_EXTRA[extraId].name, what: SPICE_EXTRA[extraId].what },
    p, swing, late, seed: Math.floor(Math.random() * 2147483646) + 1, v: 1
  };
}


// A spice lives on certain tracks. A track the producer left out of a section would make the spice silent there, so the tracks the
// spice plays on are switched on in the verses, pre-choruses and choruses (and the layer cap then drops the least important other
// tracks instead, so the beat does not pile up). Called once per beat, after the arrangement.
const SPICE_CLAIMS = {
  clave: (p, o) => ({ tracks: [p.track], kinds: ["verse", "pre", "chorus"] }),
  talk:  (p) => ({ tracks: [p.a, p.b], kinds: ["verse", "pre", "chorus"] }),
  trip:  () => ({ tracks: ["hat"], kinds: ["verse", "pre", "chorus"] }),
  kick:  () => ({ tracks: ["kick", "bass"], kinds: ["verse", "pre", "chorus", "bridge"] }),
  half:  () => ({ tracks: ["hat"], kinds: ["chorus"] }),
  stab:  () => ({ tracks: ["chords"], kinds: ["verse", "pre", "chorus"] }),
  ghost: () => ({ tracks: ["snare"], kinds: ["verse", "pre", "chorus"] }),
  drive: () => ({ tracks: ["openhat", "hat"], kinds: ["pre", "chorus"] }),
  bassb: () => ({ tracks: ["bass"], kinds: ["verse", "pre", "chorus", "bridge"] }),
  log:   () => ({ tracks: ["logdrum"], kinds: ["verse", "pre", "chorus"] })
};
function spiceClaim(spice, presence, sections, t) {
  const fn = spice && SPICE_CLAIMS[spice.id]; if (!fn || !presence || !presence.length) return;
  const claim = fn(spice.p || {}), names = Object.keys(t.tracks), claimed = claim.tracks.filter(n => names.includes(n));
  if (!claimed.length) return;
  presence.forEach((pres, i) => {
    const sec = sections[i]; if (!sec || !claim.kinds.includes(sec.kind)) return;
    claimed.forEach(n => { pres[n] = true; });
    const cap = t.maxLayers ? ((t.maxLayers[sec.kind] || t.maxLayers.default || 0) + (sec.final ? 1 : 0)) : 0;
    if (!cap) return;
    let n = names.filter(k => pres[k]).length;
    for (let j = LAYER_PRIORITY.length - 1; n > cap && j >= 0; j--) {
      const k = LAYER_PRIORITY[j];
      if (pres[k] && !claimed.includes(k)) { pres[k] = false; n--; }
    }
  });
}

// The one line shown on the screen
function spiceLine(beat) {
  const s = beat && beat.spice; if (!s) return "";
  const bits = [s.name, s.lift && s.lift.name, s.extra && s.extra.id !== "none" ? s.extra.name : ""].filter(Boolean);
  return bits.join(" · ");
}

// ------------------------------------------------------------------------------------------------ the bars
const SPICE_CLAVES = [[0, 3, 6, 10, 12], [0, 3, 7, 10, 12], [0, 3, 6, 10, 13]];                     // 3-2 son, rumba, bossa
const SPICE_TALK = [
  { call: [2, 5, 7], ans: [10, 13, 15] }, { call: [3, 6, 7], ans: [11, 14] },
  { call: [1, 4, 7], ans: [9, 12, 14] }, { call: [0, 3, 7, 10], ans: [5, 12, 15] }
];
const SPICE_KICKS = {
  afro: [[0, 6, 10], [0, 3, 7, 10], [0, 7, 10, 14], [0, 5, 8, 11]],
  rnb:  [[0, 7, 10], [0, 3, 10, 13], [0, 6, 10], [0, 7, 9, 14]],
  trap: [[0, 7, 10], [0, 3, 10, 13], [0, 6, 9, 14], [0, 10, 13]],
  gqom: [[0, 3, 6, 10], [0, 3, 8, 11], [0, 4, 7, 10, 14], [0, 3, 6, 9, 12]]
};
const SPICE_STABS = [[2, 6, 10, 14], [0, 3, 6, 10], [3, 6, 10, 13], [0, 7, 10], [2, 5, 8, 11, 14]];
const SPICE_BASS = [
  { steps: [0, 3, 6, 10, 14], tones: { 3: "octave", 10: "fifth", 14: "octave" } },
  { steps: [0, 6, 10, 12], tones: { 6: "octave", 12: "fifth" } },
  { steps: [0, 3, 7, 10, 13], tones: { 7: "fifth", 10: "octave" } },
  { steps: [0, 4, 6, 10, 11, 14], tones: { 6: "octave", 11: "fifth", 14: "octave" } }
];
const SPICE_LOGS = [[3, 6, 10, 11, 14], [0, 3, 7, 10, 13], [2, 5, 8, 11, 14], [3, 7, 10, 12, 15]];
const SPICE_GHOSTS = [[3, 7, 9, 15], [5, 7, 11, 13], [3, 9, 11, 15]];

function spiceKickFamily(genre, style) {
  if (genre === "trap") return "trap";
  if (genre === "rnb") return "rnb";
  if (genre === "afrohouse") return "gqom";
  return "afro";
}
function spSet(c, name, steps, prob) {
  if (!c.present[name]) return false;
  const h = zeros16(), pr = (c.probs[name] || zeros16()).slice();
  steps.forEach(s => { if (s >= 0 && s < 16) { h[s] = 1; pr[s] = Math.max(pr[s] || 0, prob == null ? 0.85 : prob); } });
  c.tracks[name] = h; c.probs[name] = pr;
  return true;
}
function spAdd(c, name, steps, prob) {
  if (!c.present[name]) return false;
  const pr = (c.probs[name] || zeros16()).slice();
  steps.forEach(s => { if (s >= 0 && s < 16 && !c.tracks[name][s]) { c.tracks[name][s] = 1; pr[s] = prob == null ? 0.85 : prob; } });
  c.probs[name] = pr;
  return true;
}
function spCut(c, name, steps) {
  if (!c.present[name]) return;
  steps.forEach(s => { c.tracks[name][s] = 0; if (c.doubles[name]) delete c.doubles[name][s]; });   // a roll goes with its hit
}
function spRange(a, b) { const r = []; for (let s = a; s < b; s++) r.push(s); return r; }
function spFirst(c, names) { return names.find(n => c.present[n]) || null; }

// Where the main spice goes: sections it plays in, and how strongly
function spiceMainBar(beat, sp, c, e) {
  const p = sp.p || {}, rng = c.rng, loop = c.loopRng;
  const odd = c.b % 2 === 1, phraseEnd = c.b % 4 === 3, add = !c.build && !c.isFill && !c.quiet;
  switch (sp.id) {
    case "clave": {
      if (!add || e < 0.3) return;
      const track = spFirst(c, [p.track, "rim", "perc", "bell"].filter(n => !(p.back || []).includes(n)));
      if (!track) return;
      let steps = SPICE_CLAVES[p.variant % SPICE_CLAVES.length].slice();
      if (odd) steps = steps.map(s => (s + 8) % 16);                                      // 3-2, then 2-3
      steps = steps.filter((s, i) => !(e < 0.8 && i % 2 === 1 && loop() > e + 0.2) && !(phraseEnd && i >= steps.length - 1 && rng() < 0.5));
      spSet(c, track, steps, 0.85);
      ["perc", "rim", "bell"].forEach(n => { if (n !== track && c.present[n] && !(p.back || []).includes(n)) c.tracks[n] = c.tracks[n].map((h, s) => (h && rng() < 0.55 ? 0 : h)); });   // the others step back
      return;
    }
    case "talk": {
      if (!add || e < 0.3) return;
      const okT = n => !(p.back || []).includes(n);
      const a = spFirst(c, [p.a, "perc", "rim", "bell"].filter(okT)), b = spFirst(c, [p.b, p.a === "perc" ? "rim" : "perc", "bell", "rim"].filter(okT)) || a;
      if (!a) return;
      const L = SPICE_TALK[p.variant % SPICE_TALK.length];
      if (phraseEnd) { spSet(c, a, [12, 14], 0.85); if (b !== a) spSet(c, b, [13, 15], 0.85); return; }     // both shout together
      if (!odd) { spSet(c, a, L.call, 0.85); if (b !== a) spCut(c, b, spRange(0, 16)); }
      else { if (b !== a) spSet(c, b, L.ans, 0.85); else spSet(c, a, L.ans, 0.7); if (b !== a) spAdd(c, a, [L.call[0]], 0.3); }
      return;
    }
    case "trip": {
      const top = spFirst(c, ["hat", "shaker"]);
      if (!top || c.isFill || c.build) return;
      const rollAmt = c.kind === "chorus" ? 1 : c.kind === "verse" || c.kind === "pre" ? 0.7 : 0.3;
      if (c.kind === "verse" || c.kind === "pre" || c.kind === "bridge") {                // verses breathe: the in-between 16ths thin out, so the rolls pop
        c.tracks[top] = c.tracks[top].map((h, s) => (h && s % 2 === 1 && rng() < 0.55 ? 0 : h));
      }
      if (c.quiet) return;
      const spots = [3, 7, 11, 15].filter(() => rng() < 0.55 * rollAmt * Math.min(1, e + 0.2)), n = phraseEnd ? 3 : 2;
      spots.slice(0, n).forEach(s => {
        if (!c.tracks[top][s]) { c.tracks[top][s] = 1; c.probs[top] = (c.probs[top] || zeros16()).slice(); c.probs[top][s] = 0.7; }
        (c.doubles[top] = c.doubles[top] || {})[s] = rng() < (p.double || 0.35) ? "double" : "triplet";
      });
      if (phraseEnd) spAdd(c, top, [12, 13, 14, 15], 0.7);                                // a hat run into the next phrase
      return;
    }
    case "kick": {
      if (!add || e < 0.3 || !c.present.kick) return;
      const fam = SPICE_KICKS[spiceKickFamily(beat.genre, beat.style)];
      const v = fam[(p.variant + (odd ? 1 : 0)) % fam.length].slice();
      if (phraseEnd && !v.includes(14) && !v.includes(15)) v.push(rng() < 0.5 ? 14 : 15);
      spSet(c, "kick", v, 0.9);
      if (c.present.bass && !(beat.riffs && beat.riffs.bass)) {                           // the bass locks with the kick
        const old = c.tracks.bass.map((h, s) => (h && !v.includes(s) && rng() < 0.4 ? s : -1)).filter(s => s >= 0);
        spSet(c, "bass", v.concat(old), 0.9);
      }
      return;
    }
    case "half": {
      if (c.kind !== "chorus" || beat.voice) return;
      const bb = spFirst(c, ["snare", "clap"]);
      if (!bb || c.tracks[bb].every((h, s) => !h || s === 8)) return;                    // no backbeat here, or already half-time
      if (c.build || c.isFill) return;
      if (c.present.snare) spSet(c, "snare", [8], 1);
      if (c.present.clap) spSet(c, "clap", [8], 1);
      if (c.present.kick) spSet(c, "kick", odd ? [0, 7, 10] : (p.variant ? [0, 11] : [0, 10]), 0.9);
      if (c.present.hat) {
        const h = zeros16(), pr = (c.probs.hat || zeros16()).slice();
        for (let s = 0; s < 16; s++) { if (s % 2 === 0 || rng() < 0.6) { h[s] = 1; pr[s] = Math.max(pr[s] || 0, 0.7); } }
        c.tracks.hat = h; c.probs.hat = pr;
        if (phraseEnd) (c.doubles.hat = c.doubles.hat || {})[14] = "triplet";
      }
      return;
    }
    case "stab": {
      if (!add || !c.present.chords || e < 0.5) return;
      let v = SPICE_STABS[(p.variant + (odd ? 1 : 0)) % SPICE_STABS.length].slice();
      if (e < 0.9 && v.length > 3) v = v.filter((s, i) => i !== 2 || loop() < 0.5);
      spSet(c, "chords", v, 0.9);
      c.dur.chords = 2;                                                                   // short stabs, not held chords
      return;
    }
    case "stop": {
      if (c.build || c.isFill || !phraseEnd || (c.isLast && c.hasNext)) return;          // the bar before a chorus has its own lift
      if (c.kind === "intro" || c.kind === "outro") return;
      if (rng() > (p.odds || 0.7)) return;
      const from = p.beats === 2 ? 8 : 12, keeper = spFirst(c, ["shaker", "perc"]);
      ["kick", "snare", "clap", "bass", "chords", "pluck", "lead", "hat", "openhat", "rim", "bell", "logdrum", "pad"].forEach(n => spCut(c, n, spRange(from, 16)));
      if (keeper) { spCut(c, keeper, spRange(from, 16)); spAdd(c, keeper, [from, from + 2], 0.3); }
      return;
    }
    case "lazy": {
      if (c.kind === "intro" || c.build) return;
      ["hat", "shaker"].forEach(n => { if (c.present[n]) c.tracks[n] = c.tracks[n].map((h, s) => (h && s % 2 === 1 && s % 4 !== 3 && rng() < 0.5 ? 0 : h)); });   // thinner hats
      if (add && rng() < 0.7) spiceGhosts(c, 0.3, [3, 9, 15], 1 + (rng() < 0.4 ? 1 : 0), loop);
      return;
    }
    case "drive": {
      if (c.build || c.isFill) return;
      const hot = c.kind === "chorus" || c.kind === "pre";
      if (c.present.openhat && hot) { spSet(c, "openhat", [2, 6, 10, 14], 0.85); [2, 6, 10, 14].forEach(s => { spCut(c, "hat", [s]); }); }
      if (c.present.hat && !hot) c.tracks.hat = c.tracks.hat.map((h, s) => (h && s % 2 === 1 ? 0 : h));
      if (c.kind === "chorus" && c.present.kick) {
        spSet(c, "kick", [0, 4, 8, 12], 0.95);                                            // four on the floor
        if (p.offbass && c.present.bass && !(beat.riffs && beat.riffs.bass)) spSet(c, "bass", [2, 6, 10, 14], 0.9);   // the off-beat house bass
      }
      return;
    }
    case "ghost": {
      if (!add || c.kind === "intro") return;
      spiceGhosts(c, 0.3, SPICE_GHOSTS[p.variant % SPICE_GHOSTS.length], phraseEnd ? 3 : 2, loop);
      return;
    }
    case "bassb": {
      if (!add || !c.present.bass || (beat.riffs && beat.riffs.bass) || e < 0.4) return;
      const B = SPICE_BASS[(p.variant + (odd ? 1 : 0)) % SPICE_BASS.length];
      spSet(c, "bass", B.steps, 0.9);
      const tones = (c.bassTones || beat.bassTones).slice();
      B.steps.forEach(s => { tones[s] = B.tones[s] || "root"; });
      c.bassTones = tones;
      return;
    }
    case "log": {
      if (!add || !c.present.logdrum || (beat.riffs && beat.riffs.logdrum) || e < 0.4) return;
      spSet(c, "logdrum", SPICE_LOGS[(p.variant + (odd ? 1 : 0)) % SPICE_LOGS.length], 0.85);
      return;
    }
  }
}

// Soft notes (ghosts) between the backbeats: picks some of the given steps, the same two bars after two bars
function spiceGhosts(c, prob, steps, count, loop) {
  const back = spFirst(c, ["snare", "clap", "rim"]);
  if (!back) return;
  const pool = steps.filter(s => !c.tracks[back][s]);
  const chosen = [];
  while (chosen.length < count && pool.length) chosen.push(pool.splice(Math.floor(loop() * pool.length), 1)[0]);
  spAdd(c, back, chosen, prob);
}

// The lift into a chorus (or a bridge, now and then)
function spiceLiftBar(beat, sp, c) {
  if (!c.hasNext || !c.isLast || !sp.lift) return false;
  let into = c.nextKind === "chorus" || (c.nextKind === "bridge" && seededRandom((sp.seed ^ 0x51ED) >>> 0)() < 0.6);
  if (c.nextKind === "verse" && c.kind === "intro") into = seededRandom((sp.seed ^ 0x77) >>> 0)() < 0.5;     // from the intro into the first verse
  if (!into) return false;
  const id = sp.lift.id, rng = c.rng;
  if (id === "reverse" || id === "both" || id === "halfstop" || id === "hush") c.fx.reverse = true;
  if (id === "sweep" || id === "both" || id === "halfstop") c.fx.sweep = true;
  if (id === "stop" && rng() < 0.6) c.fx.reverse = true;
  if (c.build) return true;                                                              // the snare roll already strips the bar
  const core = ["kick", "snare", "clap", "bass", "chords", "pluck", "lead", "hat", "openhat", "rim", "bell", "perc", "shaker", "logdrum", "pad"];
  if (id === "stop") core.forEach(n => spCut(c, n, spRange(12, 16)));
  if (id === "halfstop") { core.forEach(n => spCut(c, n, spRange(8, 16))); if (c.present.shaker) spAdd(c, "shaker", [8, 10, 12, 14], 0.3); }
  if (id === "hush") ["hat", "openhat", "shaker", "perc", "rim", "bell"].forEach(n => spCut(c, n, spRange(0, 16)));
  return id === "stop" || id === "halfstop" || id === "hush";
}

// Small habits at the end of phrases
function spiceExtraBar(beat, sp, c, e) {
  const x = sp.extra && sp.extra.id; if (!x || x === "none" || c.build || c.isFill || c.quiet || c.kind === "intro") return;
  const phraseEnd = c.b % 4 === 3, mid = c.b % 4 === 1, rng = c.rng;
  if (!phraseEnd && !(mid && rng() < 0.25)) return;
  if (x === "drag") { if (c.tracks.snare && c.tracks.snare[12]) (c.doubles.snare = c.doubles.snare || {})[12] = "double"; if (c.tracks.clap && c.tracks.clap[12]) (c.doubles.clap = c.doubles.clap || {})[12] = "double"; }
  if (x === "percfill") { const t = spFirst(c, ["perc", "rim", "bell"]); if (t && rng() < 0.45 + 0.4 * e) spAdd(c, t, rng() < 0.5 ? [12, 13, 14, 15] : [11, 13, 14, 15], 0.7); }
  if (x === "bassrun" && c.present.bass && !(beat.riffs && beat.riffs.bass) && rng() < 0.6) {
    const tones = (c.bassTones || beat.bassTones).slice(); tones[13] = "third"; tones[14] = "fifth"; tones[15] = "octave";
    c.bassTones = tones; spAdd(c, "bass", [13, 14, 15], 0.8);
  }
  if (x === "hatlift" && c.present.openhat && rng() < 0.6) { spAdd(c, "openhat", [14], 0.85); spCut(c, "hat", [13, 14, 15]); }
}

// Called by beatgen for every bar. c is a plain object with what the bar needs (see songBarView).
function spiceApply(beat, c) {
  const sp = beat.spice; if (!sp || sp.off) return;
  let k = SPICE_ENERGY[c.kind] || 0.7;
  if (c.final) k = Math.min(1.15, k * 1.15);
  if (beat.voice) k *= beat.voice.groove && beat.voice.groove.calm ? 0.55 : 0.7;
  const vm = beat.voice && beat.voice.bars && beat.voice.bars[c.bar];
  c.quiet = Boolean(vm && vm.act && vm.act.filter(v => v === 1).length >= 5);           // a busy singer: add nothing
  c.dur = c.dur || {};
  c.loopRng = seededRandom(((sp.seed || 1) ^ Math.imul((beat.sectionAt && beat.sectionAt[c.bar] ? beat.sectionAt[c.bar].index : 0) * 2 + (c.b % 2) + 17, 2246822519)) >>> 0);
  const e = k;
  spiceMainBar(beat, sp, c, e);
  spiceExtraBar(beat, sp, c, e);
  spiceLiftBar(beat, sp, c);                                                              // last: its stops cut the end of the bar
  Object.keys(c.doubles).forEach(n => Object.keys(c.doubles[n]).forEach(s => { if (!(c.tracks[n] && c.tracks[n][+s])) delete c.doubles[n][s]; }));   // a roll needs its hit
}

// Timing: a few spices play the backbeat behind the beat (called with the offsets of the bar, in seconds)
function spiceFeel(beat, offsets) {
  const sp = beat.spice; if (!sp || !sp.late || beat.voice) return;
  Object.keys(sp.late).forEach(name => { if (offsets[name]) offsets[name] = offsets[name].map(o => o + sp.late[name] / 1000); });
}

// Roll a new spice onto an existing beat (the "More spice" button)
function spiceRespice(beat) {
  const t = resolveTemplate(beat.genre, beat.style);
  const spice = spiceRoll(beat.genre, beat.style, t, { from: beat, presence: beat.presence, sections: beat.sections, riffs: beat.riffs });
  const next = Object.assign({}, beat, { spice });
  if (spice.swing != null) next.swing = spice.swing; else delete next.swing;
  return next;
}
