// =====================================================================
// Sound packs.
//
// A pack is a complete, matched sound set: the drum kit, keys, pad, bass, lead, pluck, percussion, bell, shaker
// and log drum that belong together (for example "Highlife Live" is a live-sounding kit, clean guitar, horn and
// cowbell). Before packs, every sound was picked on its own from a list, so one beat could mix parts that were
// never meant to meet. Now a beat picks ONE pack, and a style only offers the packs that suit it.
//
//   styles : the styles that can use the pack (leave out = every style of the genre)
//   Every other key is a sound id that exists in engine.js (SOUND_MENU lists them).
//
// Auto mode also mixes it up a little: on about 3 beats in 10 ONE "colour" part (lead, pluck, percussion, bell or
// shaker) is borrowed from another pack that suits the style. The drum kit, bass, keys, pad and log drum are never
// borrowed, because those decide the groove and the weight of the beat. Every sound has been loudness-matched
// (LEVEL_DB in engine.js), so a swapped part changes the colour and not the level.
// =====================================================================

const PACKS = {
  afrobeats: [
    { id: "lagos", name: "Lagos Nights", blurb: "Warm round kick, soft keys, bright guitar licks, congas and an agogo.",
      kit: "afro", chords: "rhodes", pad: "warm", bass: "pluckSub", lead: "glass", pluck: "afroGuitar", perc: "conga", bellKind: "agogo", shaker: "shaker", log: "classic" },
    { id: "highlifelive", name: "Highlife Live", blurb: "A live-sounding kit, clean guitar chords, a horn line and a steady cowbell.", styles: ["smooth", "afropop", "afrofusion", "highlife"],
      kit: "highlife", chords: "guitar", pad: "warm", bass: "pluckSub", lead: "horn", pluck: "nylon", perc: "bongo", bellKind: "cowbell", shaker: "shekere", log: "classic" },
    { id: "streetorgan", name: "Street Organ", blurb: "Church-style organ and choir, a talking drum and a horn: the street-pop sound.", styles: ["streetpop", "afroswing", "afropop", "afrorave"],
      kit: "afro", chords: "organ", pad: "choir", bass: "amaSub", lead: "horn", pluck: "kora", perc: "talking", bellKind: "agogo", shaker: "shekere", log: "ama" },
    { id: "sunsetrave", name: "Sunset Rave", blurb: "Punchy 808 drums, bright stabs, a whistle lead and tambourine.", styles: ["afrorave", "afropop", "afroswing", "streetpop"],
      kit: "dembow", chords: "stab", pad: "airy", bass: "sub808", lead: "whistle", pluck: "marimba", perc: "bongo", bellKind: "cowbell", shaker: "tambourine", log: "classic" },
    { id: "swing808", name: "808 Swing", blurb: "Boomy 808 kick and gliding bass, soft keys, vibes and kora.", styles: ["afroswing", "afrorave", "afropop", "streetpop", "smooth"],
      kit: "dembow", chords: "rhodes", pad: "dark", bass: "glide808", lead: "vibes", pluck: "kora", perc: "conga", bellKind: "clave", shaker: "caxixi", log: "classic" },
    { id: "alte", name: "Alté Dreams", blurb: "Laid-back and airy: soft drums, rhodes, flute and nylon guitar.", styles: ["afrofusion", "smooth"],
      kit: "soft", chords: "rhodes", pad: "airy", bass: "softSub", lead: "flute", pluck: "nylon", perc: "bongo", bellKind: "clave", shaker: "caxixi", log: "classic" },
    { id: "goldenera", name: "Golden Era", blurb: "Vintage drums, wurlitzer and vibes with a retro soul warmth.",
      kit: "vintage", chords: "wurli", pad: "warm", bass: "softSub", lead: "vibes", pluck: "kalimba", perc: "conga", bellKind: "bell", shaker: "shaker", log: "classic" },
    { id: "koragarden", name: "Kora Garden", blurb: "Gentle and ringing: kora and kalimba over soft keys.", styles: ["afrofusion", "smooth", "highlife", "afropop"],
      kit: "afro", chords: "wurli", pad: "airy", bass: "softSub", lead: "kalimba", pluck: "kora", perc: "bongo", bellKind: "clave", shaker: "caxixi", log: "classic" },
    { id: "darkswing", name: "Dark Swing", blurb: "Moody and heavy: dark keys, deep 808 and a glassy lead.", styles: ["afroswing", "afrorave", "streetpop"],
      kit: "dembow", chords: "darkKeys", pad: "dark", bass: "sub808", lead: "glass", pluck: "marimba", perc: "conga", bellKind: "cowbell", shaker: "caxixi", log: "classic" },
    { id: "brass", name: "Brass Parade", blurb: "Live kit, strummed guitar, strings and a bold horn.", styles: ["highlife", "afropop", "smooth"],
      kit: "highlife", chords: "guitar", pad: "strings", bass: "pluckSub", lead: "horn", pluck: "afroGuitar", perc: "conga", bellKind: "cowbell", shaker: "tambourine", log: "classic" }
  ],

  amapiano: [
    { id: "soweto", name: "Soweto Classic", blurb: "The core sound: soft thud kick, bright piano, log drum, flute and piano runs.",
      kit: "ama", chords: "amaPiano", pad: "airy", bass: "amaSub", lead: "flute", pluck: "pianoRun", perc: "conga", bellKind: "clave", shaker: "shaker", log: "ama" },
    { id: "pskeys", name: "Private School Keys", blurb: "Smooth and jazzy: wurlitzer, strings, vibes and quick piano runs.", styles: ["classic", "privateschool"],
      kit: "ama", chords: "wurli", pad: "strings", bass: "amaSub", lead: "vibes", pluck: "pianoRun", perc: "bongo", bellKind: "clave", shaker: "caxixi", log: "ama" },
    { id: "sgijahard", name: "Sgija Hard", blurb: "Punchy 909 drums, stabs and a short wooden log drum.", styles: ["classic", "sgija"],
      kit: "house", chords: "stab", pad: "dark", bass: "amaSub", lead: "whistle", pluck: "marimba", perc: "tom", bellKind: "cowbell", shaker: "tambourine", log: "wood" },
    { id: "soulful", name: "Soulful Garden", blurb: "Warm rhodes, flute and kora over a soft log drum.", styles: ["classic", "privateschool"],
      kit: "ama", chords: "rhodes", pad: "airy", bass: "amaSub", lead: "flute", pluck: "kora", perc: "bongo", bellKind: "agogo", shaker: "caxixi", log: "ama" },
    { id: "logold", name: "Log Drum Gold", blurb: "Log drum up front: piano, warm pad, whistle and marimba.", styles: ["classic", "sgija"],
      kit: "ama", chords: "amaPiano", pad: "warm", bass: "amaSub", lead: "whistle", pluck: "marimba", perc: "conga", bellKind: "agogo", shaker: "shaker", log: "wood" },
    { id: "midnight", name: "Midnight Piano", blurb: "Late-night mood: piano, strings and vibes.", styles: ["classic", "privateschool"],
      kit: "ama", chords: "amaPiano", pad: "strings", bass: "amaSub", lead: "vibes", pluck: "pianoRun", perc: "conga", bellKind: "clave", shaker: "shaker", log: "ama" },
    { id: "sundayjazz", name: "Sunday Jazz", blurb: "Soft and jazzy: rhodes, strings, flute and kora.", styles: ["privateschool"],
      kit: "ama", chords: "rhodes", pad: "strings", bass: "softSub", lead: "flute", pluck: "kora", perc: "bongo", bellKind: "clave", shaker: "caxixi", log: "ama" },
    { id: "darkwood", name: "Dark Wood", blurb: "Dark and gritty: dark keys, growling bass and a wooden log drum.", styles: ["sgija"],
      kit: "house", chords: "darkKeys", pad: "dark", bass: "growl", lead: "whistle", pluck: "marimba", perc: "tom", bellKind: "cowbell", shaker: "tambourine", log: "wood" },
    { id: "bounce", name: "Township Bounce", blurb: "Bright and bouncy: stabs, glass lead and marimba.", styles: ["sgija", "classic"],
      kit: "ama", chords: "stab", pad: "airy", bass: "amaSub", lead: "glass", pluck: "marimba", perc: "conga", bellKind: "clave", shaker: "tambourine", log: "wood" }
  ],

  afrohouse: [
    { id: "deepwarm", name: "Deep & Warm", blurb: "Warm organ and strings with a rolling bass and flute.", styles: ["deephouse"],
      kit: "house", chords: "organ", pad: "strings", bass: "rolling", lead: "flute", pluck: "kora", perc: "djembe", bellKind: "agogo", shaker: "shaker", log: "classic" },
    { id: "club909", name: "Club 909", blurb: "Classic club drums, stabs, a glass lead and marimba.",
      kit: "house", chords: "stab", pad: "airy", bass: "rolling", lead: "glass", pluck: "marimba", perc: "conga", bellKind: "cowbell", shaker: "tambourine", log: "classic" },
    { id: "tribal", name: "Tribal Drums", blurb: "Hand drums up front: talking drum, agogo and a choir pad.",
      kit: "afro", chords: "organ", pad: "choir", bass: "pluckSub", lead: "whistle", pluck: "kora", perc: "talking", bellKind: "agogo", shaker: "shekere", log: "wood" },
    { id: "durbanraw", name: "Durban Raw", blurb: "Hard, raw gqom drums, stabs and a growling bass.", styles: ["gqom", "deephouse"],
      kit: "gqom", chords: "stab", pad: "dark", bass: "growl", lead: "glass", pluck: "marimba", perc: "tom", bellKind: "cowbell", shaker: "tambourine", log: "wood" },
    { id: "sunrise", name: "Sunrise", blurb: "Soft and uplifting: piano, flute and piano runs.", styles: ["deephouse"],
      kit: "ama", chords: "amaPiano", pad: "airy", bass: "amaSub", lead: "flute", pluck: "pianoRun", perc: "bongo", bellKind: "clave", shaker: "caxixi", log: "ama" },
    { id: "industrial", name: "Industrial Gqom", blurb: "Cold and dark: dark keys, tom rolls and a whistle.", styles: ["gqom"],
      kit: "gqom", chords: "darkKeys", pad: "dark", bass: "growl", lead: "whistle", pluck: "kora", perc: "tom", bellKind: "clave", shaker: "tambourine", log: "wood" },
    { id: "nightsmoke", name: "Night Smoke", blurb: "Smoky and late: rhodes, vibes and a rolling bass.", styles: ["deephouse"],
      kit: "house", chords: "rhodes", pad: "dark", bass: "rolling", lead: "vibes", pluck: "kalimba", perc: "conga", bellKind: "cowbell", shaker: "shaker", log: "classic" },
    { id: "townshiphouse", name: "Township House", blurb: "Stabs, strings and a horn over djembe.", styles: ["gqom", "deephouse"],
      kit: "house", chords: "stab", pad: "strings", bass: "amaSub", lead: "horn", pluck: "marimba", perc: "djembe", bellKind: "cowbell", shaker: "tambourine", log: "wood" }
  ],

  rnb: [
    { id: "velvet", name: "Velvet Slow", blurb: "Soft drums, rhodes and kalimba: smooth and intimate.",
      kit: "soft", chords: "rhodes", pad: "warm", bass: "softSub", lead: "kalimba", pluck: "kalimba", perc: "legacy", bellKind: "bell", shaker: "shaker", log: "classic" },
    { id: "vintagesoul", name: "Vintage Soul", blurb: "Vintage drums, wurlitzer and vibes: a classic soul feel.",
      kit: "vintage", chords: "wurli", pad: "warm", bass: "softSub", lead: "vibes", pluck: "bellPluck", perc: "legacy", bellKind: "bell", shaker: "shaker", log: "classic" },
    { id: "trapsoul", name: "Trap Soul Dark", blurb: "Heavy boom kick, dark keys and a deep 808.",
      kit: "boom", chords: "darkKeys", pad: "dark", bass: "sub808", lead: "glass", pluck: "kalimba", perc: "legacy", bellKind: "bell", shaker: "shaker", log: "classic" },
    { id: "neogold", name: "Neo Gold", blurb: "Punchy drums, vibes and light congas: neo-soul groove.",
      kit: "punch", chords: "vibes", pad: "airy", bass: "softSub", lead: "vibes", pluck: "kalimba", perc: "conga", bellKind: "clave", shaker: "caxixi", log: "classic" },
    { id: "newjacktight", name: "New Jack Tight", blurb: "Tight snappy drums, wurlitzer and a moog bass.",
      kit: "tight", chords: "wurli", pad: "airy", bass: "moog", lead: "softSaw", pluck: "pluckSaw", perc: "legacy", bellKind: "bell", shaker: "shaker", log: "classic" }
  ]
};

// The sound parts a pack sets, and the "colour" parts a beat may borrow from another pack
const PACK_PARTS = ["kit", "chords", "pad", "bass", "lead", "pluck", "perc", "bellKind", "shaker", "log"];
const PACK_COLOUR_PARTS = ["lead", "pluck", "perc", "bellKind", "shaker"];
const PACK_PART_NAMES = { lead: "lead", pluck: "pluck", perc: "percussion", bellKind: "bell", shaker: "shaker" };

// The packs that suit one style
function packsFor(genre, styleId) {
  return (PACKS[genre] || []).filter(p => !p.styles || p.styles.includes(styleId));
}
function packParts(pack) {
  const out = {};
  PACK_PARTS.forEach(k => { out[k] = pack[k]; });
  return out;
}
