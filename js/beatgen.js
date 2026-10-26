// The generator. No UI code and no audio code in here,
// so it can be reused later (for example inside Vocal Vault).
//
// It builds a whole SONG: intro, verses, pre-chorus build-ups, a hook-driven chorus,
// a bridge and an outro, each with its own drums, chords and energy. It can still make
// the old short loop (structure "loop").

// In the browser, TEMPLATES comes from templates.js.
// In Node (for tests) we load it ourselves.
const _tpl = typeof TEMPLATES !== "undefined" ? { TEMPLATES, TRACK_GROUPS, STRUCTURES, SECTION_RULES, SECTION_LABELS }
                                               : require("./templates.js");
const _templates = _tpl.TEMPLATES;
const _groups = _tpl.TRACK_GROUPS;
const _structures = _tpl.STRUCTURES;
const _sectionRules = _tpl.SECTION_RULES;
const _sectionLabels = _tpl.SECTION_LABELS;

const STEPS_PER_BAR = 16;

// ---------- Small random helpers ----------
function randomInt(min, max) {                 // whole number, both ends included
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomBetween(min, max) {             // decimal
  return min + Math.random() * (max - min);
}
function roll(probability) {                   // 1 (hit) or 0 (rest)
  return Math.random() < probability ? 1 : 0;
}
function pick(list) {                          // one random item from a list
  return list[Math.floor(Math.random() * list.length)];
}
// A seeded random generator. Everything structural in a bar (fills, hat rolls) uses one,
// so the song sounds the same when it is played and when it is exported.
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const zeros16 = () => Array(STEPS_PER_BAR).fill(0);
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- Music theory ----------
const NOTE_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const NOTE_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

// Semitones from the root for each scale degree
const SCALES = {
  minor:  [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major:  [0, 2, 4, 5, 7, 9, 11]
};
// Keys whose notes are normally written with flats (Bb instead of A#)
const FLAT_ROOTS = {
  minor:  [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 3, 5, 7, 10],
  major:  [1, 3, 5, 8, 10]
};

// MIDI number to note name: 60 -> "C4"
function midiToName(midi, flats) {
  const names = flats ? NOTE_FLAT : NOTE_SHARP;
  return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// Name a chord from its intervals above the root, e.g. [0,3,7,10,14] -> "m9"
function chordSuffix(intervals) {
  const third = intervals[1], fifth = intervals[2];
  const seventh = intervals[3], ninth = intervals[4];

  let quality;
  if (third === 3 && fifth === 7) quality = "m";
  else if (third === 4 && fifth === 7) quality = "";
  else if (third === 3 && fifth === 6) quality = "dim";
  else if (third === 4 && fifth === 8) quality = "aug";
  else quality = "?";

  if (seventh === undefined) return quality;     // plain triad

  let name;
  if (quality === "")         name = seventh === 11 ? "maj7" : "7";
  else if (quality === "m")   name = seventh === 11 ? "m(maj7)" : "m7";
  else if (quality === "dim") name = seventh === 9 ? "dim7" : "m7b5";
  else                        name = quality + "7";

  if (ninth === undefined) return name;          // 7th chord

  // add the 9th: Cm7 -> Cm9, Cmaj7 -> Cmaj9, C7 -> C9
  if (name === "m7b5") return "m9b5";
  if (name === "m(maj7)") return "m(maj9)";
  return name.slice(0, -1) + "9";
}

// Build one chord from a scale degree (root position, around C3-B3).
function buildChord(keyRoot, scaleName, degree, ext, flats) {
  const scale = SCALES[scaleName];
  const semis = d => scale[d % 7] + 12 * Math.floor(d / 7);   // any degree, any octave

  const offsets = [0, 2, 4];                                    // stack thirds: root, 3rd, 5th
  if (ext.seventh) offsets.push(6);
  if (ext.seventh && ext.ninth) offsets.push(8);

  const intervals = offsets.map(o => semis(degree + o) - semis(degree));
  const rootPc = (keyRoot + scale[degree]) % 12;
  const rootMidi = 48 + rootPc;
  const midi = intervals.map(i => rootMidi + i);

  // Bass note: root in the G1-F#2 range (low, but still on a laptop speaker)
  let bassMidi = 24 + rootPc;
  if (bassMidi < 31) bassMidi += 12;

  const rootName = (flats ? NOTE_FLAT : NOTE_SHARP)[rootPc];
  return {
    degree,
    rootPc,
    rootName,
    name: rootName + chordSuffix(intervals),
    intervals,
    midi,
    notes: midi.map(m => midiToName(m, flats)),
    bassMidi,
    bass: midiToName(bassMidi, flats),
    bell: midiToName(72 + rootPc, flats)                        // chord root, high (C5-B5)
  };
}

// Voice leading: choose the inversion of each chord that moves the least from the one
// before it (like a keyboard player does). Chords flow instead of jumping every bar.
function voiceLead(chordList, flats) {
  let prev = null;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  chordList.forEach(chord => {
    const base = chord.midi.slice().sort((a, b) => a - b);
    const candidates = [];
    for (let inv = 0; inv < base.length; inv++) {
      const notes = base.map((m, i) => (i < inv ? m + 12 : m)).sort((a, b) => a - b);
      [-12, 0, 12].forEach(shift => candidates.push(notes.map(m => m + shift)));
    }
    const score = notes => {
      let s = Math.abs(mean(notes) - 62) * 0.6;
      if (notes[0] < 45) s += 40;                              // not too muddy
      if (notes[notes.length - 1] > 80) s += 40;               // not too thin
      if (prev) {
        const n = Math.min(notes.length, prev.length);
        for (let i = 0; i < n; i++) s += Math.abs(notes[i] - prev[i]);
        s += Math.abs(notes.length - prev.length) * 3;
      }
      return s;
    };
    let best = candidates[0], bestScore = Infinity;
    candidates.forEach(c => {
      const s = score(c) + Math.random() * 0.4;
      if (s < bestScore) { bestScore = s; best = c; }
    });
    chord.midi = best;
    chord.notes = best.map(m => midiToName(m, flats));
    prev = best;
  });
  return chordList;
}

// Make a key from a root (0-11) and a scale name
function makeKey(root, scale) {
  const flats = FLAT_ROOTS[scale].includes(root);
  const rootName = (flats ? NOTE_FLAT : NOTE_SHARP)[root];
  return { root, rootName, scale, flats, name: rootName + " " + scale };
}

// Pick the key. The caller can fix the root and/or the scale; anything left
// out is chosen at random (the scale from the ones the style allows).
function pickKey(template, fixed = {}) {
  const root = Number.isInteger(fixed.root) ? fixed.root : randomInt(0, 11);
  const scale = fixed.scale && SCALES[fixed.scale] ? fixed.scale : pick(template.scales);
  return makeKey(root, scale);
}

// Roman numerals for a progression: minor [0,5,2,6] -> "i-VI-III-VII"
function progressionLabel(scaleName, degrees) {
  const scale = SCALES[scaleName];
  const semis = d => scale[d % 7] + 12 * Math.floor(d / 7);
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  return degrees.map(d => {
    const third = semis(d + 2) - semis(d);
    const fifth = semis(d + 4) - semis(d);
    const roman = numerals[d];
    if (third === 3 && fifth === 6) return roman.toLowerCase() + "\u00b0";   // diminished
    return third === 3 ? roman.toLowerCase() : roman;
  }).join("\u2013");
}

// Build the chords for a list of scale degrees (with smooth voice leading)
function chordsFor(template, key, degrees, keepSizesFrom) {
  const chords = degrees.map((degree, i) => {
    const old = keepSizesFrom && keepSizesFrom[i];
    const seventh = old ? old.intervals.length >= 4 : Math.random() < template.chord.seventh;
    const ninth = old ? old.intervals.length >= 5 : seventh && Math.random() < template.chord.ninth;
    return buildChord(key.root, key.scale, degree, { seventh, ninth }, key.flats);
  });
  return voiceLead(chords, key.flats);
}

// How long each hit rings, in steps: until the next hit, but no more than the max
function gateLengths(hits, gate) {
  return hits.map((hit, step) => {
    if (!hit) return 0;
    if (gate && gate.fixed) return gate.fixed;
    let next = STEPS_PER_BAR;
    for (let n = step + 1; n < STEPS_PER_BAR; n++) {
      if (hits[n]) { next = n; break; }
    }
    return Math.min(next - step, (gate && gate.max) || 1);
  });
}

// ---------- Resolving a style ----------
// A "template" for the generator is the genre's shared settings plus one style's own.
const _resolved = {};
function resolveTemplate(genre, styleId) {
  const g = _templates[genre];
  if (!g) throw new Error("Unknown genre: " + genre);
  const sid = styleId && g.styles[styleId] ? styleId : g.styleOrder[0];
  const cacheKey = genre + "/" + sid;
  if (_resolved[cacheKey]) return _resolved[cacheKey];

  const s = g.styles[sid];
  const t = Object.assign({}, g, s);
  t.genre = genre;
  t.styleId = sid;
  t.styleName = s.name;
  t.sidechain = Object.assign({}, g.sidechain, s.sidechain || {});
  t.gate = Object.assign({}, g.gate, s.gate || {});

  // Section rules: the shared ones, with the style's own tweaks laid on top
  t.rules = {};
  Object.keys(_sectionRules).forEach(kind => {
    const base = _sectionRules[kind], extra = (s.rules && s.rules[kind]) || {};
    t.rules[kind] = Object.assign({}, base, extra, {
      presence: Object.assign({}, base.presence, extra.presence || {}),
      enter: Object.assign({}, base.enter || {}, extra.enter || {}),
      exit: Object.assign({}, base.exit || {}, extra.exit || {})
    });
  });

  // The names of the tracks, with the first groove's loop pattern (used by the old loop mode)
  t.tracks = probsForKind(firstGroove(s.groove), "chorus");
  return (_resolved[cacheKey] = t);
}

// A groove picks one variant of every pattern
function isVariantList(v) { return Array.isArray(v) && Array.isArray(v[0]); }
function firstGroove(groove) {
  const g = {};
  Object.keys(groove).forEach(k => { g[k] = isVariantList(groove[k]) ? groove[k][0] : groove[k]; });
  return g;
}
function chooseGroove(t) {
  const g = {};
  Object.keys(t.groove).forEach(k => {
    const v = t.groove[k];
    g[k] = isVariantList(v) ? pick(v).slice() : (v ? v.slice() : null);
  });
  return g;
}

// ---------- Patterns for each kind of section ----------
// Soft hits (chance under 0.8) are thinned or pushed up; the strong hits never change.
const thinSoft = (arr, k) => arr.map(p => (p >= 0.8 ? p : p * k));
const densify  = (arr, a) => arr.map(p => (p > 0 && p < 0.8 ? Math.min(0.85, p + a) : p));

// Chance of every step, for every track, in one kind of section
function probsForKind(g, kind) {
  const clap = g.clap || g.snare.map(p => (p >= 0.8 ? 0.9 : 0));
  let kick = g.kick, snare = g.snare, hat = g.hatSparse, chords = g.chordsVerse, pluck = g.pluckVerse;
  let perc = g.perc, shaker = g.shaker, bassExtra = g.bassExtra;

  switch (kind) {
    case "intro": case "outro":
      kick = thinSoft(kick, 0.5); snare = thinSoft(snare, 0.3); perc = thinSoft(perc, 0.5);
      break;
    case "verse":
      snare = thinSoft(snare, 0.8);
      break;
    case "pre":
      hat = g.hatFull; pluck = g.pluckChorus; kick = densify(kick, 0.1);
      break;
    case "chorus":
      kick = densify(kick, 0.25); hat = g.hatFull; chords = g.chordsChorus; pluck = g.pluckChorus;
      perc = densify(perc, 0.2); shaker = densify(shaker, 0.15); bassExtra = densify(bassExtra, 0.2);
      break;
    case "bridge":
      kick = thinSoft(kick, 0.5); chords = g.chordsChorus;
      break;
  }

  // The bass follows the kick (808 style), plus a few pick-up notes
  const bass = kick.map((p, i) => (p > 0 ? Math.min(1, p * 0.95 + 0.05) : bassExtra[i]));

  return {
    kick, snare, clap, rim: g.rim, hat, openhat: g.openhat, shaker, perc, bell: g.bell,
    bass, logdrum: g.logdrum, chords, pad: g.pad, pluck, lead: zeros16()
  };
}

// Roll the hits of one kind of section. A locked group keeps what it had.
function buildPatterns(t, groove, from, locked) {
  const patterns = {};
  Object.keys(t.rules).forEach(kind => {
    const probs = probsForKind(groove, kind);
    const old = from && from.patterns && from.patterns[kind];
    const hits = {};
    Object.keys(probs).forEach(name => {
      if (name === "bass") return;                       // made from the kick below
      const kept = old && locked.has(_groups[name]);
      if (kept) { hits[name] = old.hits[name].slice(); probs[name] = old.probs[name].slice(); }
      else hits[name] = probs[name].map(roll);
    });
    if (old && locked.has(_groups.bass)) {
      hits.bass = old.hits.bass.slice(); probs.bass = old.probs.bass.slice();
    } else {
      hits.bass = hits.kick.map((h, i) => (h ? roll(0.93) : roll(probs.bass[i] < 0.9 && probs.kick[i] === 0 ? probs.bass[i] : 0)));
      if (!hits.bass.some(Boolean)) hits.bass[0] = 1;
    }
    patterns[kind] = { probs, hits };
  });
  return patterns;
}

// ---------- Sections ----------
function makeSections(structureId) {
  const structure = _structures[structureId];
  if (!structure || structure.loop) return { sections: [], sectionAt: [], totalBars: 0 };

  const sections = [];
  const sectionAt = [];
  const seen = {}, count = {};
  structure.sections.forEach(([kind]) => { count[kind] = (count[kind] || 0) + 1; });

  let start = 0;
  structure.sections.forEach(([kind, bars], index) => {
    seen[kind] = (seen[kind] || 0) + 1;
    const label = _sectionLabels[kind] + (count[kind] > 1 ? " " + seen[kind] : "");
    sections.push({ kind, bars, start, index, occurrence: seen[kind], label, final: false });
    for (let b = 0; b < bars; b++) sectionAt.push({ index, barIn: b });
    start += bars;
  });

  // The last chorus (when there are several) is the big one
  let last = -1;
  sections.forEach((s, i) => { if (s.kind === "chorus") last = i; });
  if (last >= 0 && count.chorus > 1) { sections[last].final = true; sections[last].label = "Final chorus"; }

  return { sections, sectionAt, totalBars: start };
}

// Which tracks play in which section. Rolled once per kind of section, and a later verse
// or chorus can only ADD tracks (like a producer layering a second verse).
const FINAL_BOOST = ["clap", "openhat", "shaker", "perc", "bell", "pluck", "lead"];
function rollPresence(t, sections) {
  const names = Object.keys(t.tracks);
  const seen = {};
  return sections.map(sec => {
    const rules = t.rules[sec.kind];
    const before = seen[sec.kind];
    const presence = {};
    names.forEach(name => {
      let p = rules.presence[name] || 0;
      if (sec.final && p > 0 && FINAL_BOOST.includes(name)) p = Math.min(1, p + 0.4);
      let on = roll(p) === 1;
      if (before) on = before[name] || on || roll(Math.min(1, p + 0.15)) === 1 && p > 0;
      presence[name] = on;
    });
    seen[sec.kind] = presence;
    return presence;
  });
}

function pickFills(t, sections) {
  return sections.map(() => randomInt(0, t.arrangement.fills.length - 1));
}

// ---------- Harmony for the whole song ----------
function pickProgression(pool, avoid) {
  const options = pool.filter(p => !avoid.some(a => sameList(a, p)));
  return pick(options.length ? options : pool);
}
function rotate(list, k) { return list.map((_, i) => list[(i + k) % list.length]); }

// Verse, pre-chorus, chorus and bridge each get their own progression.
// The chorus is a lift away from the verse, which is what makes it feel like a chorus.
function buildHarmony(t, key, options, keepFrom) {
  const scale = key.scale;
  const versePool  = t.progressions[scale];
  const chorusPool = (t.chorusProgressions && t.chorusProgressions[scale]) || versePool;
  const prePool    = (t.preProgressions && t.preProgressions[scale]) || chorusPool;

  const verse = Number.isInteger(options.progression) && versePool[options.progression]
    ? versePool[options.progression] : pick(versePool);
  let chorus = pickProgression(chorusPool, [verse]);
  if (sameList(chorus, verse)) chorus = rotate(verse, 2);
  const pre = pick(prePool);
  let bridge = pickProgression(versePool.concat(chorusPool), [verse, chorus]);
  if (sameList(bridge, verse) || sameList(bridge, chorus)) bridge = rotate(chorus, 1);

  const degrees = { verse, pre, chorus, bridge };
  const chords = {};
  Object.keys(degrees).forEach(kind => {
    const old = keepFrom && keepFrom[kind] && sameList(keepFrom[kind].map(c => c.degree), degrees[kind])
      ? keepFrom[kind] : null;
    chords[kind] = chordsFor(t, key, degrees[kind], old);
  });
  degrees.intro = verse; degrees.outro = verse;
  chords.intro = chords.verse; chords.outro = chords.verse;
  return { degrees, chords };
}

// ---------- The hook ----------
// Written as positions on the 7-note scale (not as notes), so it can be replayed in any key.
// Strong beats land on chord tones; the steps in between move by single scale steps.
// Shape: A, A answered, B (a lift), A resolving: a call-and-response a singer can follow.
const HOOK_CELLS = {      // [step, length in steps]
  long:   [ [[0,6],[6,2],[8,8]], [[0,4],[4,4],[8,6],[14,2]], [[2,6],[8,4],[12,4]] ],
  sparse: [ [[0,3],[6,2],[10,6]], [[0,8],[10,6]], [[3,3],[8,8]] ],
  jazzy:  [ [[0,2],[3,3],[6,2],[8,2],[11,5]], [[2,2],[4,2],[7,3],[10,2],[12,4]], [[0,3],[3,2],[5,3],[8,4],[12,4]] ],
  bouncy: [ [[0,2],[2,2],[4,2],[7,2],[8,4],[12,2]], [[0,3],[3,3],[6,2],[8,2],[10,2],[12,4]] ],
  anthem: [ [[0,4],[4,2],[6,2],[8,4],[12,4]], [[0,2],[2,2],[4,4],[8,6],[14,2]], [[0,3],[3,3],[6,2],[8,8]] ],
  afro:   [ [[0,3],[3,3],[6,2],[8,3],[11,3],[14,2]], [[0,2],[3,2],[6,3],[10,2],[12,4]] ]
};
const MOVES = [-2, -1, -1, 0, 1, 1, 2];
const MOVES_UP = [0, 1, 1, 2, -1];
const HOOK_LOW = 3, HOOK_HIGH = 11;

// The chord tone (root, 3rd, 5th or 7th of the chord on `degree`) closest to `target`
function nearestChordTone(target, degree, onlyRootFifth) {
  const parts = onlyRootFifth ? [0, 4] : [0, 2, 4, 6];
  let best = target, bestDist = Infinity;
  for (let oct = -2; oct <= 2; oct++) {
    parts.forEach(p => {
      const n = degree + p + 7 * oct;
      const d = Math.abs(n - target) + Math.random() * 0.3;
      if (n >= HOOK_LOW && n <= HOOK_HIGH && d < bestDist) { bestDist = d; best = n; }
    });
  }
  return best;
}

function slotDegree(degrees, cpb, bar, step) {
  return degrees[(bar * cpb + (cpb === 2 && step >= 8 ? 1 : 0)) % degrees.length];
}

function buildHook(t, degrees, cpb, bars, style) {
  const cells = HOOK_CELLS[style || t.hookStyle] || HOOK_CELLS.long;
  const cellA = pick(cells);
  const others = cells.filter(c => c !== cellA);
  const cellB = others.length ? pick(others) : cellA;
  const barCells = [cellA, cellA, cellB, cellA].slice(0, bars);
  const movesA = cellA.map(() => pick(MOVES_UP));
  const movesB = cellB.map(() => pick(MOVES));

  const notes = [];
  let n = nearestChordTone(randomInt(5, 8), slotDegree(degrees, cpb, 0, 0));
  for (let b = 0; b < bars; b++) {
    const cell = barCells[b];
    const moves = cell === cellB && b === 2 ? movesB : movesA;
    cell.forEach(([step, len], i) => {
      const target = clampNum(n + moves[i % moves.length], HOOK_LOW, HOOK_HIGH);
      const strong = step % 4 === 0 || i === 0;
      n = strong ? nearestChordTone(target, slotDegree(degrees, cpb, b, step)) : target;
      notes.push({ bar: b, step, len: Math.min(len, STEPS_PER_BAR - step), n });
    });
  }
  // The last note settles on the root or fifth of the last chord and rings
  const last = notes[notes.length - 1];
  last.n = nearestChordTone(last.n, slotDegree(degrees, cpb, bars - 1, last.step), true);
  last.len = Math.max(last.len, Math.min(8, STEPS_PER_BAR - last.step));
  return { bars, notes };
}

// Pre-chorus: a calm line on chord tones that sets up the chorus. It used to climb one step higher every
// bar, so every pre-chorus sounded the same. Now it picks a different shape each time, and none of them climb.
function buildPreHook(degrees, cpb, bars) {
  const shape = pick(["hold", "sway", "fall", "pairs", "question"]);
  const top = randomInt(6, 8);
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const degree = slotDegree(degrees, cpb, b, 0);
    const tone = offset => nearestChordTone(top + offset, degree);
    if (shape === "hold") {
      notes.push({ bar: b, step: 0, len: STEPS_PER_BAR, n: tone(0) });
    } else if (shape === "sway") {
      notes.push({ bar: b, step: 0, len: STEPS_PER_BAR, n: tone([0, -1, 0, -2][b % 4]) });
    } else if (shape === "fall") {
      notes.push({ bar: b, step: 0, len: STEPS_PER_BAR, n: tone(-Math.min(b, 3)) });
    } else if (shape === "pairs") {
      notes.push({ bar: b, step: 0, len: 8, n: tone(0) });
      notes.push({ bar: b, step: 8, len: 8, n: tone(-1 - (b % 2)) });
    } else {
      notes.push({ bar: b, step: 0, len: 6, n: tone(0) });
      notes.push({ bar: b, step: 8, len: 4, n: tone(b % 2 ? -2 : 1) });
    }
  }
  return { bars, notes };
}

function buildHooks(t, degrees, cpb) {
  return {
    chorus: buildHook(t, degrees.chorus, cpb, 4),
    bridge: buildHook(t, degrees.bridge, cpb, 4, "long"),
    pre: buildPreHook(degrees.pre, cpb, 4)
  };
}

// A hook position to a MIDI note in the given key
function leadMidi(key, n) {
  const tonic = (key.root <= 6 ? 60 : 48) + key.root;
  const scale = SCALES[key.scale];
  return tonic + scale[((n % 7) + 7) % 7] + 12 * Math.floor(n / 7);
}

// ---------- Sounds ----------
function pickSound(t) {
  const s = t.sound;
  return {
    kit: pick(s.kit), chords: pick(s.chords), pad: pick(s.pad),
    bass: pick(s.bass), lead: pick(s.lead), pluck: pick(s.pluck)
  };
}

// ---------- Humanizing ----------
// How hard one hit is played (0.1 to 1).
function humanVelocity(probability, cfg, step, rnd) {
  const rand = rnd || Math.random;
  let v = cfg.velocity;
  if (cfg.accent) v *= cfg.accent[step];          // loud/soft pattern
  if (probability < 0.5) v *= cfg.ghost;          // unlikely hits are ghost notes
  v += -cfg.variation + rand() * 2 * cfg.variation;
  return Math.min(1, Math.max(0.1, v));
}

// Re-roll HOW the beat is played (strength and timing) without changing
// WHICH steps play. Called every bar so no two bars feel identical.
//   template : a resolved template (or a genre name)
//   probOverrides : { track: [16 probabilities] } used to tell ghost notes from normal hits
// `rnd` (optional) is a seeded generator: with one, the same bar is always played the same way,
// which is what lets the download match what you heard. Without one it is random every time.
function humanizeTracks(templateOrGenre, tracks, probOverrides, rnd) {
  const rand = rnd || Math.random;
  const template = typeof templateOrGenre === "string" ? resolveTemplate(templateOrGenre) : templateOrGenre;
  const loose = template.looseness || 1;
  const velocities = {};
  const offsets = {};

  Object.keys(template.tracks).forEach(trackName => {
    const probabilities = (probOverrides && probOverrides[trackName]) || template.tracks[trackName];
    const cfg = template.humanize[trackName];
    velocities[trackName] = tracks[trackName].map((hit, step) =>
      hit ? humanVelocity(probabilities[step], cfg, step, rand) : 0
    );
    offsets[trackName] = probabilities.map(() =>
      (-cfg.timingMs + rand() * 2 * cfg.timingMs) * loose / 1000
    );
  });

  return { velocities, offsets };
}

// ---------- Bars ----------
// Notes for the pluck: it walks up or down the notes of the chord that is playing
function arpPick(chord, k, mode) {
  const tones = chord.midi.slice().sort((a, b) => a - b);
  const pool = tones.concat(tones.map(m => m + 12));
  const len = Math.min(6, pool.length);
  let idx;
  if (mode === "updown") {
    const span = Math.max(1, 2 * (len - 1));
    const pos = k % span;
    idx = pos < len ? pos : span - pos;
  } else if (mode === "broken") {
    idx = [0, 2, 1, 3, 2, 4, 3, 1][k % 8] % len;
  } else {
    idx = k % len;
  }
  let m = pool[idx] + 12;
  while (m > 88) m -= 12;
  return m;
}
function arpNotes(hits, c1, c2, mode, bar) {
  const out = zeros16();
  let k = bar % 3;
  hits.forEach((hit, step) => { if (hit) out[step] = arpPick(step >= 8 ? c2 : c1, k++, mode); });
  return out;
}

// The part of a view that every kind of bar shares: note lengths, pluck notes,
// two-chord bars, and how hard / how early each hit is played.
function finishView(beat, t, p) {
  const names = Object.keys(t.tracks);
  const tracks = p.tracks;
  const twoChords = p.c1 !== p.c2;

  // Two chords in one bar: chords and pad play both, the bass plays the second root
  if (twoChords) {
    if (p.present.chords) tracks.chords[8] = 1;
    if (p.present.bass) tracks.bass[8] = tracks.bass[8] || 1;
    if (p.present.pad) { tracks.pad = zeros16(); tracks.pad[0] = 1; tracks.pad[8] = 1; }
  }

  const durations = {};
  names.forEach(n => { durations[n] = gateLengths(tracks[n], t.gate[n]); });
  if (twoChords && p.present.pad) { durations.pad[0] = 8; durations.pad[8] = 8; }
  if (p.lead) durations.lead = p.lead.dur;

  const pluckNotes = arpNotes(tracks.pluck, p.c1, p.c2, t.arp, p.barNumber);

  const probs = Object.assign({}, p.probs);
  probs.lead = tracks.lead.map(h => (h ? 1 : 0));
  // Strength and timing are seeded by the beat and the bar number: every bar feels a little different
  // from the one before, but bar 17 is the same every time it plays (live, looped, or in the download).
  const feelRng = seededRandom(((beat.seed || 1) ^ Math.imul((p.barNumber || 0) + 7, 0x9E3779B1)) >>> 0);
  const human = humanizeTracks(t, tracks, probs, feelRng);

  // Section energy: verses are played a little softer than choruses
  if (p.dyn && p.dyn !== 1) {
    names.forEach(n => { human.velocities[n] = human.velocities[n].map(v => (v ? clampNum(v * p.dyn, 0.1, 1) : 0)); });
  }
  // The snare roll swells
  if (p.build) {
    for (let s = 8; s < 16; s++) {
      if (human.velocities.snare[s]) human.velocities.snare[s] *= 0.5 + 0.5 * ((s - 8) / 7);
    }
  }

  return {
    tracks, durations, present: p.present, isFill: Boolean(p.isFill),
    phraseBar: p.phraseBar, bars: p.bars,
    chord: p.c1, chord2: p.c2,
    leadNotes: p.lead ? p.lead.midi : zeros16(), leadExtra: Boolean(p.leadExtra),
    pluckNotes, doubles: p.doubles || {}, fx: p.fx || {},
    voicing: p.voicing || 0, strumDown: p.strumDown !== false, bassTones: p.bassTones || null,
    kind: p.kind || null, label: p.label || "", sec: p.sec || null,
    sectionIndex: p.sectionIndex === undefined ? -1 : p.sectionIndex,
    velocities: human.velocities, offsets: human.offsets
  };
}

// One bar of a full song
function songBarView(beat, bar) {
  const t = resolveTemplate(beat.genre, beat.style);
  const at = beat.sectionAt[bar];
  const sec = beat.sections[at.index];
  const rules = t.rules[sec.kind];
  const names = Object.keys(t.tracks);
  const pattern = beat.patterns[sec.kind];
  const rng = seededRandom((beat.seed ^ Math.imul(bar + 1, 2654435761)) >>> 0);

  const b = at.barIn, n = sec.bars;
  const isFirst = b === 0, isLast = b === n - 1;
  const hasNext = at.index < beat.sections.length - 1;

  const tracks = {}, present = {};
  const probs = Object.assign({}, pattern.probs);
  names.forEach(name => {
    const enterAt = Math.floor(n * (rules.enter[name] || 0));
    const exitAt = rules.exit[name] ? Math.floor(n * rules.exit[name]) : n;
    present[name] = Boolean(beat.presence[at.index][name]) && b >= enterAt && b < exitAt;
    tracks[name] = present[name] ? pattern.hits[name].slice() : zeros16();
  });

  // Chords: one per bar, or two per bar (the second lands on beat 3)
  const slots = beat.harmony.chords[sec.kind];
  const cpb = beat.chordsPerBar;
  const c1 = slots[(b * cpb) % slots.length];
  const c2 = cpb === 2 ? slots[(b * cpb + 1) % slots.length] : c1;

  // A new section starts with a hit on beat 1
  if (isFirst && at.index > 0) {
    (t.arrangement.accent || []).forEach(name => { if (present[name]) tracks[name][0] = 1; });
  }

  let isFill = false, build = false;
  const fx = {};

  if (isLast && hasNext && rules.endBuild) {
    // Build-up into the next section: snare roll, and everything else drops out for the last 2 beats
    const roll16 = [0,0,0,0, 0,0,0,0, 1,0,1,0, 1,1,1,1];
    tracks.snare = roll16.slice(); probs.snare = roll16.slice(); present.snare = true;
    tracks.clap = zeros16();
    ["kick", "bass", "chords", "hat", "openhat", "perc", "bell", "pluck", "shaker", "rim"].forEach(name => {
      for (let s = 8; s < 16; s++) tracks[name][s] = 0;
    });
    build = true; isFill = true;
  } else if (isLast && hasNext && rules.fill) {
    const fills = t.arrangement.fills;
    const fill = fills[beat.fillPick[at.index] % fills.length];
    names.forEach(name => {
      if (fill[name] && present[name]) { probs[name] = fill[name].slice(); tracks[name] = fill[name].map(p => (rng() < p ? 1 : 0)); }
    });
    isFill = true;
  }

  // Impact + crash on the first bar of a chorus (the old rising noise riser is gone)
  if (isFirst && sec.kind === "chorus") { fx.impact = true; fx.crash = true; tracks.kick[0] = present.kick ? 1 : 0; }

  // ---- Variation: no two bars, and no two passes of the same section, are quite alike ----
  // Which time this section has come round (0 = the first verse, 1 = the second verse, ...)
  const pass = beat.sections.slice(0, at.index).filter(s => s.kind === sec.kind).length;
  const oddBar = b % 2 === 1;
  const phraseEnd = b % 4 === 3;                       // the end of a 4-bar phrase changes the most
  let bassTones = null;
  if (!build && !isFill) {
    const keep = phraseEnd ? 0.80 : oddBar ? 0.92 : 0.97;                        // chance an off-beat hit stays
    const more = (phraseEnd ? 0.8 : oddBar ? 0.45 : 0.15) + 0.2 * Math.min(pass, 2) / 2;   // how many "maybe" hits join in
    ["hat", "openhat", "shaker", "perc", "rim", "bell", "pluck", "logdrum"].forEach(name => {
      if (!present[name]) return;
      const base = tracks[name], maybe = pattern.probs[name] || [];
      const varied = base.map((hit, s) => hit ? ((s % 4 === 0 || rng() < keep) ? 1 : 0) : (rng() < (maybe[s] || 0) * more ? 1 : 0));
      if (varied.some(Boolean)) tracks[name] = varied;
    });
    if (present.kick && phraseEnd) {                   // an extra, off-beat kick now and then
      const maybe = pattern.probs.kick || [];
      [3, 7, 10, 11, 14].forEach(s => { if (!tracks.kick[s] && rng() < (maybe[s] || 0) * 0.6) tracks.kick[s] = 1; });
    }
    if (present.bass) {                                // the bass walks at the end of a phrase
      const live = beat.bassTones.map((tone, s) => (tracks.bass[s] ? s : -1)).filter(s => s >= 0);
      if (live.length) {
        bassTones = beat.bassTones.slice();
        const last = live[live.length - 1];
        if (phraseEnd && live.length >= 2) {
          bassTones[last] = ["fifth", "octave", "third"][Math.floor(rng() * 3)];
          if (rng() < 0.5) bassTones[live[live.length - 2]] = "fifth";
        } else if (oddBar && rng() < 0.35) {
          bassTones[last] = "octave";
        }
      }
    }
  }
  // Keys change voicing from bar to bar and alternate their strum direction
  const voicing = (b % 4 === 2 ? 1 : 0) + (pass % 2);
  const strumDown = b % 2 === 0;

  // Hat rolls (trap hats): some steps get a quick double or triplet
  const doubles = {};
  if (t.hatRoll && present.hat && !build && (sec.kind === "chorus" || isFill)) {
    const hatDoubles = {};
    t.hatRoll.steps.forEach(s => { if (tracks.hat[s] && rng() < t.hatRoll.prob) hatDoubles[s] = t.hatRoll.kind; });
    doubles.hat = hatDoubles;
  }

  // The lead plays the hook (chorus), a new melody (bridge), a held note (pre) or an echo (outro)
  let lead = null, leadExtra = false;
  if (present.lead) {
    let hook = null;
    if (sec.kind === "chorus") hook = beat.hooks.chorus;
    else if (sec.kind === "bridge") hook = beat.hooks.bridge;
    else if (sec.kind === "pre") hook = beat.hooks.pre;
    else if (sec.kind === "outro" && b < 2) hook = beat.hooks.chorus;
    if (hook) {
      lead = { midi: zeros16(), dur: zeros16() };
      const barNotes = hook.notes.filter(note => note.bar === b % hook.bars);
      const lastBarOfHook = (b % hook.bars) === hook.bars - 1;
      barNotes.forEach((note, i) => {
        let degree = note.n;
        // The second time round, the end of the phrase answers the first time instead of repeating it
        if (sec.kind === "chorus" && pass > 0 && lastBarOfHook && i < barNotes.length - 1 && rng() < 0.7) degree += pass % 2 ? 1 : -1;
        tracks.lead[note.step] = 1;
        lead.midi[note.step] = leadMidi(beat.key, degree);
        lead.dur[note.step] = note.len;
      });
      leadExtra = sec.final && b >= 4;              // the last time round the hook is doubled an octave up
    }
  }

  return finishView(beat, t, {
    tracks, probs, present, c1, c2, lead, leadExtra, doubles, fx, isFill, build,
    voicing, strumDown, bassTones,
    phraseBar: b, bars: n, barNumber: bar, dyn: rules.dyn,
    kind: sec.kind, label: sec.label, sec: rules.sec, sectionIndex: at.index
  });
}

// One bar of the plain loop (the old behaviour): a short phrase with fills
function loopBarView(beat, bar, enabled) {
  const t = resolveTemplate(beat.genre, beat.style);
  const names = Object.keys(t.tracks);
  const chordList = beat.chords;
  const c1 = chordList[bar % chordList.length];
  const barsInPhrase = (beat.arrangement && beat.arrangement.bars) || 4;

  if (!enabled || !beat.arrangement) {
    const present = {};
    const tracks = {};
    names.forEach(name => { present[name] = true; tracks[name] = beat.tracks[name].slice(); });
    return finishView(beat, t, {
      tracks, probs: beat.loopProbs, present, c1, c2: c1, phraseBar: bar % barsInPhrase,
      bars: barsInPhrase, barNumber: bar
    });
  }

  const arr = beat.arrangement;
  const phraseBar = bar % arr.bars;
  // the last bar of the phrase is the fill; an 8-bar phrase also gets one halfway
  const isFill = phraseBar === arr.bars - 1 || (arr.bars === 8 && phraseBar === 3);
  const source = isFill ? arr.fillTracks : beat.tracks;

  const tracks = {}, present = {};
  names.forEach(name => {
    present[name] = arr.presence[name][phraseBar];
    tracks[name] = present[name] ? source[name].slice() : zeros16();
  });

  // New phrase (not the very first one): a crash-like hit on beat 1
  if (phraseBar === 0 && bar > 0) {
    (t.arrangement.accent || []).forEach(name => { if (present[name]) tracks[name][0] = 1; });
  }

  const probs = Object.assign({}, beat.loopProbs, isFill ? arr.fillProbs : {});
  return finishView(beat, t, {
    tracks, probs, present, c1, c2: c1, isFill, phraseBar, bars: arr.bars, barNumber: bar
  });
}

// What is actually played in a given bar (0, 1, 2, ... counting from the start).
// Songs ignore `enabled`; the plain loop uses it (false = everything, every bar, no fills).
function barView(beat, bar, enabled) {
  if (beat.structure && beat.structure !== "loop" && beat.sections.length) {
    return songBarView(beat, bar % beat.totalBars);
  }
  return loopBarView(beat, bar, enabled);
}

// ---------- Loop arrangement (structure "loop") ----------
function buildArrangement(t, bars, tracks, from, locked) {
  const arr = t.arrangement;
  const keeps = group => Boolean(from) && locked && locked.has(group)
    && from.arrangement && from.arrangement.bars === bars;

  const presence = {};
  Object.keys(t.tracks).forEach(trackName => {
    if (keeps(_groups[trackName])) {
      presence[trackName] = from.arrangement.presence[trackName].slice();
      return;
    }
    const profile = arr.presence[trackName];
    presence[trackName] = Array.from({ length: bars }, (_, i) => {
      let p = profile[i % profile.length];
      if (bars > profile.length && i >= profile.length) p = Math.min(1, p + 0.3);  // 2nd half is fuller
      return Math.random() < p;
    });
  });

  const fill = pick(arr.fills);
  const fillTracks = {};
  const fillProbs = {};
  Object.keys(t.tracks).forEach(trackName => {
    if (keeps(_groups[trackName])) {
      fillTracks[trackName] = from.arrangement.fillTracks[trackName].slice();
      fillProbs[trackName] = from.arrangement.fillProbs[trackName].slice();
    } else if (fill[trackName]) {
      fillProbs[trackName] = fill[trackName].slice();
      fillTracks[trackName] = fill[trackName].map(roll);
    } else {
      fillProbs[trackName] = t.tracks[trackName].slice();
      fillTracks[trackName] = tracks[trackName].slice();
    }
  });

  return { bars, presence, fillTracks, fillProbs };
}

// Same beat, new loop phrase length (4 or 8 bars). The rhythm is untouched.
function rebuildArrangement(beat, bars) {
  const t = resolveTemplate(beat.genre, beat.style);
  const arrangement = buildArrangement(t, bars, beat.tracks);
  return { ...beat, arrangement, totalBars: beat.structure === "loop" ? bars : beat.totalBars };
}

// Same beat, different song form (full song / short song / loop). Drums, chords and hook stay.
function rebuildStructure(beat, structureId) {
  const t = resolveTemplate(beat.genre, beat.style);
  const made = makeSections(structureId);
  return {
    ...beat,
    structure: structureId,
    sections: made.sections,
    sectionAt: made.sectionAt,
    totalBars: made.sections.length ? made.totalBars : beat.arrangement.bars,
    presence: rollPresence(t, made.sections),
    fillPick: pickFills(t, made.sections)
  };
}

// ---------- The generator ----------
// Build a fresh song from a genre.
//
// options (all optional):
//   style       : which style of the genre ("slowjam", "trapsoul"...); random if left out
//   structure   : "full" (default), "short" or "loop"
//   root, scale : fix the key (root 0-11, scale "minor" | "dorian" | "major")
//   progression : index into the style's verse progressions for that scale
//   bpm         : fix the tempo (otherwise a random tempo for the style)
//   phraseBars  : 4 (default) or 8 bars per phrase (loop mode)
//   from        : the beat being replaced; needed for locking
//   lockGroups  : group names to keep from `from`, e.g. ["drums", "harmony"]
//                 (harmony also keeps the key, chords and hook)
//
// Returns a beat: { genre, style, styleName, bpm, key, structure, sections, totalBars,
//   harmony, hooks, patterns, presence, sound, chords (the verse chords), tracks (the plain loop), ... }
function generatePattern(genreKey, options = {}) {
  const g = _templates[genreKey];
  if (!g) throw new Error("Unknown genre: " + genreKey);

  const from = options.from || null;
  const locked = new Set(options.lockGroups || []);
  const keeps = group => Boolean(from) && locked.has(group);

  const styleId = options.style && g.styles[options.style] ? options.style : pick(g.styleOrder);
  const t = resolveTemplate(genreKey, styleId);
  const groove = chooseGroove(t);
  const structure = _structures[options.structure] ? options.structure : "full";

  // Key, chords and hook
  let key, harmony, hooks, chordsPerBar;
  if (keeps("harmony") && from.harmony) {
    key = { ...from.key };
    harmony = from.harmony;
    hooks = from.hooks;
    chordsPerBar = from.chordsPerBar;
  } else {
    key = pickKey(t, { root: options.root, scale: options.scale });
    chordsPerBar = pick(t.chordsPerBar);
    harmony = buildHarmony(t, key, { progression: options.progression });
    hooks = buildHooks(t, harmony.degrees, chordsPerBar);
  }

  // The rhythm of every kind of section
  const patterns = buildPatterns(t, groove, from, locked);
  const loopProbs = patterns.chorus.probs;
  const tracks = {};
  Object.keys(patterns.chorus.hits).forEach(name => { tracks[name] = patterns.chorus.hits[name].slice(); });

  const made = makeSections(structure);
  const phraseBars = options.phraseBars === 8 ? 8 : 4;
  const arrangement = buildArrangement(t, phraseBars, tracks, from, locked);

  const durations = {};
  Object.keys(tracks).forEach(name => { durations[name] = gateLengths(tracks[name], t.gate[name]); });

  return {
    genre: genreKey,
    style: styleId,
    styleName: t.styleName,
    seed: randomInt(1, 2147483646),
    bpm: Number.isFinite(options.bpm) ? options.bpm : randomInt(t.bpm[0], t.bpm[1]),
    key,
    chordsPerBar,
    harmony,
    hooks,
    chords: harmony.chords.verse,
    patterns,
    loopProbs,
    tracks,
    durations,
    bassTones: keeps("low") ? from.bassTones.slice()
      : Array.from({ length: STEPS_PER_BAR }, () => pick(t.bassTones)),
    logTones: keeps("low") ? from.logTones.slice()
      : Array.from({ length: STEPS_PER_BAR }, () => pick(t.logdrum.tones)),
    sound: pickSound(t),
    structure,
    sections: made.sections,
    sectionAt: made.sectionAt,
    totalBars: made.sections.length ? made.totalBars : phraseBars,
    presence: rollPresence(t, made.sections),
    fillPick: pickFills(t, made.sections),
    arrangement,
    ...humanizeTracks(t, tracks, loopProbs)
  };
}

// Change only the harmony of a beat (key, scale, chord progression) and keep the
// rhythm exactly as it is. The hook keeps its shape in the new key.
//   options: { root, scale, progression }  (anything left out stays as it is)
function rebuildHarmony(beat, options = {}) {
  const t = resolveTemplate(beat.genre, beat.style);
  const scale = options.scale && t.progressions[options.scale] ? options.scale : beat.key.scale;
  const root = Number.isInteger(options.root) ? options.root : beat.key.root;
  const key = makeKey(root, scale);

  const keepDegrees = scale === beat.key.scale && !Number.isInteger(options.progression);
  let harmony, hooks = beat.hooks;
  if (keepDegrees) {
    // Same chords in a new key keep their size (triad / 7th / 9th)
    const chords = {};
    const degrees = { ...beat.harmony.degrees };
    ["verse", "pre", "chorus", "bridge"].forEach(kind => {
      chords[kind] = chordsFor(t, key, degrees[kind], beat.harmony.chords[kind]);
    });
    chords.intro = chords.verse; chords.outro = chords.verse;
    harmony = { degrees, chords };
  } else {
    harmony = buildHarmony(t, key, { progression: options.progression }, null);
    hooks = buildHooks(t, harmony.degrees, beat.chordsPerBar);
  }
  return { ...beat, key, harmony, hooks, chords: harmony.chords.verse };
}

// Song length in seconds
function songSeconds(beat) {
  return beat.totalBars * STEPS_PER_BAR * 60 / beat.bpm / 4;
}

// Lets the same file be tested in Node. Ignored in the browser.
if (typeof module !== "undefined") {
  module.exports = {
    generatePattern, rebuildHarmony, rebuildArrangement, rebuildStructure, barView, songBarView, loopBarView,
    humanizeTracks, buildChord, chordSuffix, midiToName, gateLengths, makeKey, pickKey, progressionLabel,
    resolveTemplate, makeSections, leadMidi, songSeconds, seededRandom, probsForKind,
    roll, randomInt, randomBetween, humanVelocity,
    SCALES, STEPS_PER_BAR
  };
}
