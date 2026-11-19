// =====================================================================
// The producer: picks the INSTRUMENTS of a beat the way a producer would, not at random.
//
// It is a rule-based "ear", written down as knowledge (no network, no model download):
//   1. It decides the VIBE (chill, dark, romantic, uplifting, party, soulful, dreamy, hard). You can choose it,
//      otherwise it reads the genre, the style, the key (minor sounds darker, major brighter) and the tempo.
//   2. For every part (bass, keys, pad, pluck, lead) it scores each recorded instrument on how well it fits that part
//      in this genre, this vibe, this key mode and this tempo (a violin is a romantic pad, not a log drum; trumpet
//      is a party lead, not a trap pad; a pitched 808 is the bass of a trap beat).
//   3. Every part is a recording (there are no synthesized instruments). The producer never uses an instrument that
//      does not suit the part: a part gets the best-fitting recording, and a part the groove leaves silent stays silent.
//   4. Mixing rules keep the arrangement sane: no instrument twice, no two instruments of the same family
//      (two keyboards, two guitars...), no two bright mallets stacked, brass and sax are not given
//      to a pad part, and a recording is moved into the range the instrument can play.
//   5. It writes a short note saying what it chose and why, so you can learn from it (or disagree and change it).
//
// A beat stores the picks as sound ids: "s-piano" means the recorded piano (see instrumentbank.js).
// =====================================================================

const VIBES = {
  chill:     "Chill",
  dark:      "Dark",
  romantic:  "Romantic",
  uplifting: "Uplifting",
  party:     "Party",
  soulful:   "Soulful",
  dreamy:    "Dreamy",
  hard:      "Hard"
};

// Each recorded instrument. roles: how good it is for each part (0 = never). genres / vibes: how well it fits.
// mode: factor for minor / major keys. bpm: the tempo range where it sits well. family: only one per family is used.
// why: what a producer would say about it.
const _I = (family, roles, genres, vibes, extra) => Object.assign({ family, roles, genres, vibes }, extra || {});
const PRODUCER_KB = {
  "piano":    _I("keys", { chords: 1, pluck: .55, lead: .3 },
    { afrobeats: .5, amapiano: 1, afrohouse: .65, rnb: 1, trap: .45 },
    { chill: .8, romantic: 1, soulful: 1, dreamy: .6, uplifting: .7, party: .5, dark: .75, hard: .6 },
    { why: "a real piano carries the chords" }),
  "epiano":   _I("keys", { chords: 1, pluck: .3, lead: .3 },
    { afrobeats: .8, amapiano: .7, afrohouse: .5, rnb: 1, trap: .3 },
    { chill: 1, romantic: 1, soulful: 1, dreamy: 1, dark: .6, party: .4, uplifting: .6, hard: .45 },
    { why: "electric piano is the warm, late-night chord sound" }),
  "organ":    _I("keys", { chords: .8, pad: .6 },
    { afrobeats: .4, amapiano: .3, afrohouse: .9, rnb: .5, trap: .1 },
    { uplifting: 1, soulful: 1, party: .7, chill: .4, romantic: .4, dark: .2, dreamy: .3, hard: .1 },
    { why: "organ gives that church-and-gospel lift" }),
  "harmonium":_I("keys", { pad: .5, chords: .3 },
    { afrobeats: .3, amapiano: .2, afrohouse: .6, rnb: .2, trap: .1 },
    { soulful: .9, dreamy: .8, chill: .6, uplifting: .5, dark: .3, romantic: .4, party: .2, hard: 0 },
    { why: "harmonium adds a breathy, spiritual bed" }),
  "guitar-nylon":    _I("guitar", { chords: .8, pluck: 1, lead: .4 },
    { afrobeats: 1, amapiano: .3, afrohouse: .5, rnb: .8, trap: .7 },
    { chill: 1, romantic: 1, dreamy: .8, uplifting: .7, soulful: .6, party: .5, dark: .4, hard: .2 },
    { why: "nylon guitar licks are the Afrobeats and melodic-trap signature" }),
  "guitar-acoustic": _I("guitar", { chords: .7, pluck: .7 },
    { afrobeats: .8, amapiano: .1, afrohouse: .3, rnb: .6, trap: .3 },
    { uplifting: 1, chill: .8, romantic: .7, soulful: .6, dreamy: .5, dark: .4, party: .5, hard: .2 },
    { why: "strummed acoustic guitar keeps it open and human" }),
  "guitar-electric": _I("guitar", { chords: .8, pluck: .8, lead: .6 },
    { afrobeats: .9, amapiano: .2, afrohouse: .3, rnb: .9, trap: .5 },
    { soulful: 1, dreamy: .9, chill: .8, party: .6, dark: .6, romantic: .7, uplifting: .6, hard: .55 },
    { why: "a clean electric guitar gives groove and shimmer" }),
  "harp":     _I("strings", { pluck: .7, chords: .3, pad: .2 },
    { afrobeats: .3, amapiano: .3, afrohouse: .3, rnb: .6, trap: .85 },
    { dreamy: 1, romantic: .9, chill: .6, dark: .5, soulful: .4, uplifting: .4, party: .1, hard: .2 },
    { why: "harp runs are a dreamy, luxurious touch" }),
  "vibraphone":_I("mallet", { chords: .5, pluck: .7, lead: .6 },
    { afrobeats: .6, amapiano: .8, afrohouse: .5, rnb: .9, trap: .15 },
    { chill: 1, soulful: .9, dreamy: .9, romantic: .7, dark: .3, uplifting: .5, party: .4, hard: .1 },
    { why: "vibes are smooth and jazzy" }),
  "violin":   _I("strings", { lead: .7, pad: .8 },
    { afrobeats: .4, amapiano: .4, afrohouse: .3, rnb: .7, trap: .8 },
    { romantic: 1, dark: .8, dreamy: .7, soulful: .6, chill: .4, uplifting: .4, hard: .55, party: .1 },
    { why: "violin sings the emotion", mode: { minor: 1.1, major: .9 } }),
  "cello":    _I("strings", { pad: .8, lead: .5 },
    { afrobeats: .3, amapiano: .3, afrohouse: .3, rnb: .7, trap: .95 },
    { dark: 1, romantic: 1, dreamy: .6, soulful: .6, chill: .5, hard: .6, uplifting: .3, party: 0 },
    { why: "cello gives the pad weight and a dark warmth", mode: { minor: 1.15, major: .8 } }),
  "trumpet":  _I("brass", { lead: .8 },
    { afrobeats: .6, amapiano: .5, afrohouse: .4, rnb: .6, trap: .3 },
    { party: 1, uplifting: 1, soulful: .7, hard: .4, romantic: .4, chill: .3, dark: .3, dreamy: .2 },
    { why: "a trumpet line brings the party", mode: { minor: .85, major: 1.1 }, bpm: [85, 135] }),
  "saxophone":_I("wind", { lead: 1 },
    { afrobeats: .6, amapiano: .8, afrohouse: .5, rnb: 1, trap: .3 },
    { romantic: 1, soulful: 1, chill: .8, dreamy: .6, party: .5, dark: .4, uplifting: .5, hard: .1 },
    { why: "sax is the sultry voice of late-night R&B and private-school amapiano", bpm: [55, 125] }),
  "flute":    _I("wind", { lead: 1, pluck: .3 },
    { afrobeats: .8, amapiano: 1, afrohouse: .8, rnb: .7, trap: 1 },
    { chill: 1, dreamy: 1, uplifting: .8, romantic: .6, dark: .7, soulful: .6, party: .5, hard: .6 },
    { why: "flute melodies are the signature of amapiano and trap" }),
  "clarinet": _I("wind", { lead: .5 },
    { afrobeats: .3, amapiano: .5, afrohouse: .3, rnb: .4, trap: .1 },
    { chill: .6, soulful: .6, dreamy: .5, romantic: .5, uplifting: .4, party: .3, dark: .3, hard: 0 },
    { why: "clarinet adds a woody, jazzy colour" }),
  "french-horn": _I("brass", { pad: .6, lead: .4 },
    { afrobeats: .3, amapiano: .2, afrohouse: .3, rnb: .4, trap: .8 },
    { dark: .8, romantic: .7, dreamy: .6, soulful: .5, uplifting: .5, chill: .4, hard: .5, party: .1 },
    { why: "French horn gives a cinematic, soft-brass bed" }),
  "trombone": _I("brass", { lead: .3 },
    { afrobeats: .3, amapiano: .4, afrohouse: .2, rnb: .2, trap: .1 },
    { party: .8, uplifting: .6, soulful: .5, hard: .3, chill: .2, dark: .1, romantic: .2, dreamy: .1 },
    { why: "trombone adds a gutsy horn answer" }),
  "kalimba":  _I("mallet", { pluck: 1, lead: .6 },
    { afrobeats: 1, amapiano: .5, afrohouse: 1, rnb: .6, trap: .5 },
    { chill: 1, dreamy: 1, uplifting: .8, romantic: .7, party: .6, dark: .4, soulful: .5, hard: .1 },
    { why: "kalimba plucks are the African thumb-piano sparkle" }),
  "mbira":    _I("mallet", { pluck: .9, lead: .5, log: .6 },
    { afrobeats: .8, amapiano: .6, afrohouse: 1, rnb: .3, trap: .3 },
    { dreamy: 1, chill: .8, party: .7, uplifting: .8, soulful: .6, romantic: .4, dark: .4, hard: .1 },
    { why: "mbira is a rooted, trance-like pluck" }),
  "marimba":  _I("mallet", { pluck: .9, lead: .6, log: 1 },
    { afrobeats: .8, amapiano: .9, afrohouse: .8, rnb: .3, trap: .3 },
    { party: 1, uplifting: 1, chill: .6, dreamy: .5, soulful: .4, romantic: .3, dark: .2, hard: .2 },
    { why: "marimba runs make it bounce" }),
  "balafon":  _I("mallet", { pluck: .7, lead: .5, log: .85 },
    { afrobeats: .8, amapiano: .5, afrohouse: .8, rnb: .2, trap: .1 },
    { party: 1, uplifting: .8, dreamy: .5, chill: .5, soulful: .5, romantic: .2, dark: .1, hard: .1 },
    { why: "balafon brings West African wooden-key rhythm" }),
  "xylophone":_I("mallet", { pluck: .4, lead: .3 },
    { afrobeats: .4, amapiano: .3, afrohouse: .5, rnb: .1, trap: .2 },
    { party: .8, uplifting: .7, chill: .3, dreamy: .3, soulful: .2, romantic: .1, dark: .1, hard: .1 },
    { why: "xylophone is bright and playful" }),
  "glockenspiel": _I("mallet", { pluck: .5, lead: .5 },
    { afrobeats: .3, amapiano: .2, afrohouse: .3, rnb: .4, trap: 1 },
    { dark: .85, dreamy: 1, romantic: .5, chill: .5, hard: .85, uplifting: .3, soulful: .2, party: .1 },
    { why: "a glassy bell melody is the classic trap top-line", mode: { minor: 1.15, major: .8 } }),
  "bass-electric": _I("bass", { bass: .9 },
    { afrobeats: .8, amapiano: .4, afrohouse: .45, rnb: .9, trap: .1 },
    { soulful: 1, chill: .9, romantic: .8, party: .7, dreamy: .6, uplifting: .7, dark: .4, hard: .2 },
    { why: "an electric bass guitar gives the groove a real player's feel", bpm: [60, 125] }),
  "upright-bass": _I("bass", { bass: .8 },
    { afrobeats: .3, amapiano: .75, afrohouse: .3, rnb: .7, trap: 0 },
    { soulful: 1, chill: 1, romantic: .8, dreamy: .6, party: .3, uplifting: .4, dark: .3, hard: 0 },
    { why: "an upright bass is jazzy and warm", bpm: [55, 118] }),
  "tuba":     _I("bass", { bass: .1 },
    { afrobeats: .1, amapiano: .1, afrohouse: .1, rnb: .1, trap: 0 },
    { party: .5, uplifting: .3, soulful: .2, chill: .1, romantic: 0, dreamy: 0, dark: 0, hard: 0 },
    { why: "a tuba bass is a novelty" }),
  "808-boom": _I("bass", { bass: 1 },
    { afrobeats: .5, amapiano: .1, afrohouse: .05, rnb: .7, trap: 1 },
    { hard: 1, dark: 1, chill: .6, romantic: .6, dreamy: .6, party: .6, soulful: .4, uplifting: .4 },
    { why: "a long, booming 808 is the foundation of the genre", bpm: [58, 175], styles: { trapsoul: 1.2, hardtrap: 1.3, afroswing: 1.2, afrorave: 1.1 } }),
  "808-punch":_I("bass", { bass: 1 },
    { afrobeats: .5, amapiano: .1, afrohouse: .05, rnb: .6, trap: 1 },
    { hard: 1, party: .9, uplifting: .6, dark: .7, chill: .5, romantic: .4, dreamy: .4, soulful: .4 },
    { why: "a tighter 808 keeps fast patterns clean", bpm: [90, 180], styles: { drill: 1.3, melodictrap: 1.1, afrorave: 1.2 } }),
  "808-deep": _I("bass", { bass: 1 },
    { afrobeats: .45, amapiano: .15, afrohouse: .05, rnb: .8, trap: 1 },
    { dark: 1, romantic: .9, dreamy: .9, chill: .9, hard: .7, soulful: .5, uplifting: .3, party: .3 },
    { why: "a deep, soft-edged 808 sits under moody keys", bpm: [58, 150], styles: { trapsoul: 1.3, slowjam: 1.1, melodictrap: 1.1 } })
};
// Where a sampled instrument can be used: the Sound-menu role keys of the engine
const PRODUCER_ROLES = ["bass", "chords", "pad", "pluck", "lead", "log"];

const PRODUCER_MIN_SCORE = 0.01;                 // every part gets the best recording that can play it at all

// ---- The vibe ----
const GENRE_VIBES = {
  afrobeats: { chill: 3, romantic: 2, party: 2, uplifting: 2, dreamy: 1, soulful: 1 },
  amapiano:  { chill: 2, soulful: 2, party: 3, dreamy: 1, uplifting: 1 },
  afrohouse: { dreamy: 3, uplifting: 2, party: 2, soulful: 1, chill: 1 },
  rnb:       { romantic: 3, chill: 2, soulful: 2, dreamy: 2, dark: 1 },
  trap:      { dark: 3, hard: 3, dreamy: 1, romantic: 1, chill: 1 },
  afrolust:  { romantic: 3, dreamy: 2, chill: 2, soulful: 2, dark: 1 }
};
const STYLE_VIBES = {
  slowjam: { romantic: 3 }, trapsoul: { dark: 3, romantic: 2 }, neosoul: { soulful: 3, chill: 2 },
  altrnb: { dreamy: 3, dark: 1 }, newjack: { party: 3 }, poprnb: { uplifting: 2, party: 1 },
  afrorave: { party: 3 }, streetpop: { party: 2, hard: 1 }, afroswing: { dark: 1, chill: 1 }, highlife: { uplifting: 3 },
  privateschool: { soulful: 3, chill: 2 }, sgija: { hard: 3, dark: 1 }, gqom: { hard: 3, dark: 2 }, deephouse: { dreamy: 2, soulful: 1 },
  velvet: { romantic: 3, chill: 1 }, rap: { dark: 2, hard: 2, chill: 1 }, afrorb: { romantic: 3, soulful: 2, chill: 2 }, tide: { dreamy: 3, chill: 2 }, moonlit: { soulful: 2, romantic: 2, chill: 1 }, smoke: { dark: 2, romantic: 2 }, slowwine: { romantic: 2, soulful: 1, party: 1 },
  hardtrap: { hard: 4, dark: 2 }, drill: { dark: 4, hard: 2 }, melodictrap: { dreamy: 3, romantic: 2, dark: 1 }
};

function producerVibe(ctx) {
  if (ctx.vibe && VIBES[ctx.vibe]) return ctx.vibe;
  const w = {};
  Object.keys(VIBES).forEach(v => { w[v] = 0.25; });
  [GENRE_VIBES[ctx.genre], STYLE_VIBES[ctx.style]].forEach(table => {
    if (table) Object.keys(table).forEach(v => { w[v] += table[v] * (table === STYLE_VIBES[ctx.style] ? 2 : 1); });
  });
  const minor = ctx.scale === "minor";
  if (minor) { w.dark *= 1.5; w.romantic *= 1.25; w.hard *= 1.2; w.uplifting *= 0.6; w.party *= 0.75; }
  else if (ctx.scale === "major") { w.uplifting *= 1.6; w.party *= 1.3; w.chill *= 1.1; w.dark *= 0.45; w.hard *= 0.6; }
  if (ctx.bpm < 82) { w.chill *= 1.4; w.romantic *= 1.3; w.dark *= 1.2; w.party *= 0.5; }
  else if (ctx.bpm > 118) { w.party *= 1.4; w.uplifting *= 1.2; w.hard *= 1.15; w.chill *= 0.7; }
  return weightedPick(Object.keys(w), v => w[v]);
}

function weightedPick(list, weightOf) {
  let total = 0;
  const weights = list.map(item => { const w = Math.max(0, weightOf(item)); total += w; return w; });
  if (total <= 0) return list[Math.floor(Math.random() * list.length)];
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

// Each sound pack has its own taste in instruments: a multiplier per "role:instrument" (1 = no opinion).
// Afro-Lust: every pack keeps the muted nylon-guitar lick (the tag), and the rest of the sound is what tells the packs apart.
const NO_GUITAR_KEYS = { "chords:guitar-electric": 0.05, "chords:guitar-acoustic": 0.05, "chords:guitar-nylon": 0.05 };   // the guitar slot belongs to the lick
// Each genre has its own taste too (the styles above refine it): a multiplier per "role:instrument" (1 = no opinion).
// Without this, every genre reached for the same flute, violin and electric bass. Sources: producer guides for each genre.
const GENRE_PREFS = {
  // Afrobeats: guitar and keys, a pluck from the wood percussion family, a sax or flute line; the bass is a played bass
  afrobeats: { "bass:bass-electric": 1.25, "bass:808-deep": .6, "bass:808-boom": .6, "bass:808-punch": .6, "chords:guitar-nylon": 1.4, "chords:guitar-electric": 1.3, "chords:epiano": 1.2,
    "pad:violin": .5, "pad:cello": .6, "pad:organ": .7, "pluck:kalimba": 1.2, "pluck:marimba": 1.3, "pluck:balafon": 1.5, "lead:saxophone": 1.3 },
  // Amapiano: piano chords and a deep sub under the log drum; the bass is the log drum and a quiet sub, not a played bass
  amapiano: { "chords:piano": 1.6, "chords:epiano": 1.2, "bass:808-deep": 2.2, "bass:upright-bass": .8, "bass:bass-electric": .6, "pad:violin": .85,
    "pluck:marimba": 1.2, "pluck:vibraphone": 1.2, "lead:saxophone": 1.2 },
  // Afro house: organ and keys, a warm bed of pads, a rolling sub; fewer flute lines
  afrohouse: { "bass:808-deep": 2, "bass:bass-electric": .5, "chords:organ": 1.8, "chords:piano": 1.2, "chords:epiano": 1.3, "pad:harmonium": 1.5, "pad:violin": .7,
    "lead:flute": .6, "lead:saxophone": 1.2, "pluck:kalimba": 1.3, "pluck:mbira": 1.4, "pluck:marimba": 1.2 },
  // R&B: Rhodes and piano, a played (walking) bass rather than an 808, warm pads, guitar and sax lines
  rnb: { "bass:bass-electric": 1.4, "bass:upright-bass": 1.3, "bass:808-deep": .45, "bass:808-boom": .3, "bass:808-punch": .15,
    "chords:epiano": 1.3, "chords:piano": 1.1, "pad:harmonium": 1.5, "pad:cello": 1.2, "pad:violin": .8, "pluck:guitar-electric": 1.2, "pluck:kalimba": .5,
    "lead:saxophone": 1.2, "lead:guitar-electric": 1.4, "lead:flute": .5 },
  // Trap: cold and spare (bells, harp, dark strings, a guitar loop), never a flute or a warm Rhodes
  trap: { "lead:flute": .2, "lead:glockenspiel": 1.8, "lead:guitar-electric": 1.5, "lead:cello": 1.5, "pluck:glockenspiel": 1.3, "pluck:harp": 1.3,
    "chords:epiano": .5, "chords:guitar-electric": 1.0, "pad:cello": 1.3, "pad:violin": .8,
    // v2.12.1: warm soulful sounds are what made trap read as hip hop. Keep it cold: bells, harp, dark strings; no sax, trumpet, piano or nylon-guitar warmth.
    "lead:saxophone": .25, "lead:trumpet": .2, "chords:piano": .5, "chords:guitar-nylon": .4, "chords:harp": 2.5,
    "pluck:guitar-nylon": .4, "pluck:vibraphone": .5, "pluck:kalimba": .6, "pluck:piano": .4, "lead:piano": .5, "lead:vibraphone": .4 }
};
const SIGNATURE = { afrolust: { pluck: "guitar-nylon" } };
const STYLE_PREFS = {
  // Trap is cold and spare: bells, harp, flute, dark strings. Warm soulful keys are what make a trap beat sound like hip-hop.
  trapsoul:    { "bass:808-deep": 2.6, "bass:808-boom": 2.5, "bass:808-punch": 3 },
  hardtrap:    { "chords:piano": 0.6, "pluck:glockenspiel": 1.6, "pluck:harp": 1.3, "pad:cello": 1.3, "pad:french-horn": 1.4, "lead:flute": 1.3, "lead:glockenspiel": 1.3, "bass:808-boom": 1.3 },
  drill:       { "chords:piano": 0.6, "pluck:glockenspiel": 1.5, "pluck:harp": 1.5, "pad:violin": 1.4, "pad:cello": 1.3, "bass:808-punch": 1.3 },
  melodictrap: { "pluck:guitar-nylon": 1.5, "lead:flute": 1.7, "pluck:glockenspiel": 1.2, "chords:piano": 0.8, "bass:808-deep": 1.2 },
  velvet:   Object.assign({ "pluck:guitar-nylon": 6, "chords:epiano": 1.6, "pad:cello": 1.3, "bass:808-deep": 1.4, "lead:vibraphone": 1.2 }, NO_GUITAR_KEYS),
  afrorb:   { "pluck:guitar-electric": 3, "pluck:guitar-nylon": 2.2, "pluck:vibraphone": .3, "pluck:kalimba": .3, "pluck:marimba": .3, "pluck:balafon": .2, "chords:epiano": 1.6, "chords:piano": 1.2, "pad:cello": 1.2, "pad:violin": .8, "bass:bass-electric": 1.8, "bass:808-deep": 1.1, "lead:saxophone": .5, "lead:flute": .4 },
  // Afro-rave (Ozeba, Kelebu): a brass lead carries the chant, a hard bass underneath, a bright pluck
  afrorave: { "lead:trumpet": 3, "lead:trombone": 2.5, "lead:saxophone": 2, "lead:french-horn": .6, "lead:flute": .4, "bass:808-punch": 1.6, "bass:808-boom": 1.3, "bass:bass-electric": .5, "bass:upright-bass": .1, "pad:cello": .5, "chords:organ": 1.3, "chords:guitar-electric": 1.2 },
  rap:      Object.assign({ "pluck:guitar-nylon": 6, "chords:epiano": 1.2, "pad:cello": 1.5, "bass:808-deep": 2.2, "bass:808-boom": 1.6, "bass:bass-electric": .25, "lead:flute": .4 }, NO_GUITAR_KEYS),
  tide:     Object.assign({ "pluck:guitar-nylon": 6, "chords:epiano": 1.3, "pad:harmonium": 1.6, "pad:cello": 1.2, "bass:808-deep": 1.6, "lead:flute": 1.3 }, NO_GUITAR_KEYS),
  moonlit:  Object.assign({ "pluck:guitar-nylon": 6, "chords:vibraphone": 1.3, "chords:epiano": 1.2, "bass:bass-electric": 1.8, "bass:upright-bass": 1.3, "lead:vibraphone": 1.5, "log:marimba": 1.3 }, NO_GUITAR_KEYS),
  smoke:    Object.assign({ "pluck:guitar-nylon": 6, "chords:piano": 1.5, "pad:cello": 1.6, "pad:french-horn": 1.3, "bass:808-boom": 1.5, "lead:saxophone": 1.9, "log:balafon": 1.2 }, NO_GUITAR_KEYS),
  slowwine: Object.assign({ "pluck:guitar-nylon": 6, "chords:piano": 1.6, "log:marimba": 1.6, "log:balafon": 1.4, "bass:808-deep": 1.2, "bass:upright-bass": 1.2 }, NO_GUITAR_KEYS)
};
// Afro-Lust sits between R&B and Afrobeats: every instrument gets the blend of the two, then these are set by hand
const LUST_GENRE = {
  "808-deep": 1, "808-boom": .85, "808-punch": .3, "bass-electric": .8, "upright-bass": .6, "tuba": 0,
  "guitar-nylon": 1, "guitar-electric": .8, "guitar-acoustic": .5, "epiano": 1, "piano": .75, "vibraphone": .8, "harp": .7,
  "cello": 1, "violin": .7, "french-horn": .6, "harmonium": .6, "organ": .4,
  "saxophone": .95, "flute": .6, "kalimba": .8, "mbira": .8, "marimba": .7, "balafon": .75,
  "trumpet": .05, "trombone": .03, "xylophone": .05, "glockenspiel": .2, "clarinet": .25
};
Object.keys(PRODUCER_KB).forEach(id => {
  const g = PRODUCER_KB[id].genres, blend = (g.rnb === undefined ? .3 : g.rnb) * .55 + (g.afrobeats === undefined ? .3 : g.afrobeats) * .45;
  g.afrolust = LUST_GENRE[id] !== undefined ? LUST_GENRE[id] : +blend.toFixed(2);
});

// How well one recorded instrument fits one part of this beat (0 to about 1.3)
function producerScore(id, role, ctx) {
  const k = PRODUCER_KB[id];
  if (!k || !instrumentInfo(id)) return 0;
  const roleW = k.roles[role];
  if (!roleW) return 0;
  const genreW = k.genres[ctx.genre] === undefined ? 0.3 : k.genres[ctx.genre];
  const vibeW = k.vibes[ctx.vibe] === undefined ? 0.5 : k.vibes[ctx.vibe];
  const modeW = (k.mode && k.mode[ctx.scale === "major" ? "major" : "minor"]) || 1;
  const bpmW = k.bpm ? (ctx.bpm >= k.bpm[0] && ctx.bpm <= k.bpm[1] ? 1 : 0.55) : 1;
  const styleW = ((k.styles && k.styles[ctx.style]) || 1) * ((STYLE_PREFS[ctx.style] && STYLE_PREFS[ctx.style][role + ":" + id]) || 1)
    * ((GENRE_PREFS[ctx.genre] && GENRE_PREFS[ctx.genre][role + ":" + id]) || 1);
  // Not the instrument the last beat used for this part (so the next beat sounds different)
  const lastW = ctx.last && ctx.last[role] === "s-" + id ? 0.4 : 1;
  return roleW * genreW * vibeW * modeW * bpmW * styleW * lastW;
}

// The producer's decision for one beat.
//   ctx: { genre, style, styleName, scale, root (note name), bpm, vibe (optional), last (previous beat's sound) }
// Returns { sound: {bass, chords, pad, lead, pluck, log}, vibe, note, picks: [{role, id, why}] }
function producerPick(ctx) {
  ctx = Object.assign({}, ctx);
  ctx.vibe = producerVibe(ctx);
  const sound = {};
  const used = new Set(), families = new Set(), picks = [];
  // Order matters: the low end and the harmony are decided first, then the colours on top of them
  PRODUCER_ROLES.forEach(role => {
    // An instrument the person asked to keep stays; the producer builds the rest of the sound around it
    const kept = ctx.keep && ctx.keep[role] && resolveInstrument(role, ctx.keep[role]);
    if (kept && instrumentInfo(kept) && PRODUCER_KB[kept]) {
      used.add(kept);
      if (role !== "log" && PRODUCER_KB[kept].family !== "bass") families.add(PRODUCER_KB[kept].family);
      sound[role] = "s-" + kept;
      picks.push({ role, id: kept, why: "you kept it" });
      return;
    }
    // A genre's signature sound is always there (Afro-Lust: the muted nylon-guitar lick), unless you kept another one
    const sig = SIGNATURE[ctx.genre] && SIGNATURE[ctx.genre][role];
    if (sig && !used.has(sig) && instrumentInfo(sig) && PRODUCER_KB[sig]) {
      used.add(sig); families.add(PRODUCER_KB[sig].family);
      sound[role] = "s-" + sig;
      picks.push({ role, id: sig, why: PRODUCER_KB[sig].why + " (the genre's signature)" });
      return;
    }
    const candidates = strict => Object.keys(PRODUCER_KB)
      .filter(id => !used.has(id) && instrumentInfo(id))
      .filter(id => PRODUCER_KB[id].roles[role] > 0)
      .filter(id => !strict || role === "bass" || role === "log" || !families.has(PRODUCER_KB[id].family))
      .map(id => {
        let score = producerScore(id, role, ctx) * (typeof TASTE !== "undefined" ? TASTE.factor(id, role) : 1);       // your taste nudges it (at most 50%)
        const fam = PRODUCER_KB[id].family;
        // no two bright mallets stacked on top of each other
        if (fam === "mallet" && (role === "pluck" || role === "lead") && picks.some(p => p.role !== "log" && PRODUCER_KB[p.id].family === "mallet")) score *= 0.2;
        // a log drum is the low wooden voice: it should not be the same instrument as the pluck or lead above it
        return { id, score: score * (0.85 + Math.random() * 0.3) };     // a little luck, so two beats of one vibe differ
      })
      .filter(x => x.score >= PRODUCER_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);                                                       // one of the three that fit best
    let scored = candidates(true);
    if (!scored.length) scored = candidates(false);
    if (!scored.length) { used.clear(); scored = candidates(false); }
    if (!scored.length) return;
    const chosen = weightedPick(scored, x => x.score * x.score);
    used.add(chosen.id);
    if (role !== "log" && PRODUCER_KB[chosen.id].family !== "bass") families.add(PRODUCER_KB[chosen.id].family);
    sound[role] = "s-" + chosen.id;
    picks.push({ role, id: chosen.id, why: PRODUCER_KB[chosen.id].why + (typeof TASTE !== "undefined" && TASTE.liked(chosen.id, role) ? ", and you like it" : "") });
  });

  const roleName = { bass: "bass", chords: "keys", pad: "pad", pluck: "pluck", lead: "lead", log: "log drum" };
  const parts = picks.filter(p => p.role !== "log").map(p => roleName[p.role] + ": " + instrumentInfo(p.id).name.toLowerCase() + " (" + p.why + ")");
  const note = VIBES[ctx.vibe] + " mood. " + (ctx.styleName || ctx.genre) + " in " + (ctx.keyName || "this key") +
    " at " + Math.round(ctx.bpm) + " BPM. I used " + parts.join("; ") + ".";
  return { sound, vibe: ctx.vibe, note, picks };
}

// ---- Arrangement ----
// Which parts play in which section. The templates roll this by chance; the producer then reviews it with what it
// knows about the instruments and the vibe, the way a producer would mute and unmute channels:
//   - one voice owns the melody: a lead and a pluck do not play together in calm vibes
//   - a hard / dark verse stays bare and the pad (strings, horn) arrives as a lift in the pre-chorus and chorus
//   - a calm verse keeps its pad but drops the bells, so it breathes
//   - a romantic / dreamy / soulful bridge becomes a keys-and-pad moment (no log drum, bass thinned out)
//   - the last chorus always has the lead (and the pluck returns unless the vibe is calm)
// Changes the presence of the sections in place; returns a list of what it did (for the producer's note).
const CALM_VIBES = ["chill", "romantic", "dreamy", "soulful"];
const DRIVING_VIBES = ["hard", "dark", "party"];
function producerArrangeSong(sections, presence, sound, vibe, genre) {
  const notes = [];
  if (genre === "afrolust") return lustArrange(sections, presence, sound);
  const calm = CALM_VIBES.includes(vibe), driving = DRIVING_VIBES.includes(vibe);
  const has = role => isSampledId(sound[role]);
  const name = role => (instrumentInfo(instrumentIdOf(sound[role])) || { name: role }).name.toLowerCase();
  const said = new Set();
  const say = text => { if (!said.has(text)) { said.add(text); notes.push(text); } };
  sections.forEach((sec, i) => {
    const pr = presence[i]; if (!pr) return;
    if (calm && pr.lead && pr.pluck && (sec.kind === "chorus" || sec.kind === "bridge" || sec.kind === "pre")) {
      pr.pluck = false; say("the " + name("lead") + " carries the melody alone in calm sections, so the " + name("pluck") + " steps out");
    }
    if (sec.kind === "verse") {
      if (driving && vibe !== "party" && pr.pad) { pr.pad = false; say("verses stay bare (no pad) so the chorus lifts"); }
      if (calm && pr.bell && pr.pluck) { pr.bell = false; }
      if (!sec.final) pr.lead = false;
    }
    if ((sec.kind === "pre" || sec.kind === "chorus") && has("pad")) pr.pad = true;
    if (sec.kind === "bridge" && CALM_VIBES.includes(vibe) && vibe !== "chill") {
      if (pr.logdrum) pr.logdrum = false;
      if (pr.bass && i % 2 === 0) pr.bass = false;
      pr.chords = true; pr.pad = true;
      say("the bridge drops the log drum and thins the bass, leaving keys and pad");
    }
    if (sec.kind === "chorus" && sec.final) {
      if (has("lead")) pr.lead = true;
      if (!calm && has("pluck")) pr.pluck = true;
      say(calm ? "the last chorus brings the lead in" : "the last chorus brings in lead and pluck");
    }
  });
  return notes;
}
// Afro-Lust has its own form (see templates-lust.js): the song rules decide what plays, and this keeps three promises:
// the heartbeat (kick + bass) is there from the first bar, a breakdown is only bass and percussion, no lead melody.
function lustArrange(sections, presence, sound) {
  const notes = [];
  sections.forEach((sec, i) => {
    const pr = presence[i]; if (!pr) return;
    pr.lead = false;
    if (sec.kind === "intro") { pr.bass = true; }
    if (sec.kind === "bridge") { pr.chords = false; pr.pad = false; pr.pluck = false; pr.snare = false; pr.clap = false; pr.hat = false; pr.bass = true; pr.perc = true; }
  });
  notes.push("the beat has no lead, so you can sing on it; the heartbeat (kick and bass) starts in the first bar", "the bridge is a breakdown of only bass and percussion");
  return notes;
}
// A loop has no sections: only the melody-ownership rule applies (bar by bar)
function producerArrangeLoop(arrangement, sound, vibe) {
  if (!arrangement || !CALM_VIBES.includes(vibe)) return [];
  const lead = arrangement.presence.lead, pluck = arrangement.presence.pluck;
  if (!lead || !pluck) return [];
  let changed = false;
  for (let i = 0; i < lead.length; i++) if (lead[i] && pluck[i]) { pluck[i] = false; changed = true; }
  return changed ? ["lead and pluck take turns instead of playing together"] : [];
}

// The recorded instruments that can play a part, for the Sound menu (best fit for the genre first)
function producerMenuOptions(role) {
  return Object.keys(PRODUCER_KB)
    .filter(id => PRODUCER_KB[id].roles[role] >= 0.3 && instrumentInfo(id))
    .sort((a, b) => PRODUCER_KB[b].roles[role] - PRODUCER_KB[a].roles[role])
    .map(id => ["s-" + id, instrumentInfo(id).name]);
}
// Fill the Sound menu of Beat Lab with them
if (typeof SOUND_MENU !== "undefined") {
  PRODUCER_ROLES.forEach(role => {
    if (SOUND_MENU[role]) SOUND_MENU[role].options = SOUND_MENU[role].options.concat(producerMenuOptions(role));
  });
}


// Background warm-up: while a beat plays, quietly fetch the instruments the producer is most likely to pick for this
// genre next, one recording at a time, so the next generation does not wait. Skipped on data-saver and low-memory phones.
let _warmGenre = null;
function producerWarmUp(genre) {
  if (_warmGenre === genre || typeof loadInstrumentNote !== "function") return;
  const nav = typeof navigator !== "undefined" ? navigator : {};
  if ((nav.connection && nav.connection.saveData) || (nav.deviceMemory && nav.deviceMemory <= 2)) return;
  if (instrumentBankMB() > INSTRUMENT_BUDGET_MB * 0.55) return;             // memory first: only warm up when there is room
  _warmGenre = genre;
  const ids = Object.keys(PRODUCER_KB)
    .filter(id => instrumentInfo(id) && (PRODUCER_KB[id].genres[genre] || 0) >= 0.6 && !instrumentReady(id))
    .sort((a, b) => PRODUCER_KB[b].genres[genre] - PRODUCER_KB[a].genres[genre])
    .slice(0, INSTRUMENT_BUDGET_MB <= 110 ? 4 : 8);
  const jobs = [];
  ids.forEach(id => instrumentInfo(id).notes.forEach(n => jobs.push([id, n])));
  const idle = fn => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 400));
  const next = () => {
    const job = jobs.shift();
    if (!job || _warmGenre !== genre || instrumentBankMB() > INSTRUMENT_BUDGET_MB * 0.7) return;
    loadInstrumentNote(job[0], job[1]).then(() => idle(next));
  };
  idle(next);
}
