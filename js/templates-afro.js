// =====================================================================
// The African genres, written the way a producer thinks about them.
//
// Loaded right after templates.js. It adds styles to Afrobeats and two new genres
// (Amapiano, Afro House). Every style has its OWN:
//   - drum kit and percussion instruments (afro warm, amapiano soft, 808 dembow, live highlife kit, 909, gqom...)
//   - rhythm DNA (3-3-2 tresillo, dembow, four-on-the-floor, 3-2 clave, offbeat open hats...)
//   - written bass / log-drum riffs that follow the chords (see RIFF)
//   - "B" bars (kickB, percB, ...): the answer to the first bar of every two-bar phrase
//   - how a song builds (which parts enter in the intro, verse and chorus)
//
// Rhythm strings: 16 sixteenth notes per bar. x = always, . = never, 1..9 = chance in tenths.
// Count: 0 1 2 3 | 4 5 6 7 | 8 9 10 11 | 12 13 14 15 (beats 1 2 3 4). Backbeat = steps 4 and 12.
// =====================================================================
(function () {
  const clone = x => JSON.parse(JSON.stringify(x));
  // Same humanize table with some tracks tweaked
  const human = (base, over) => {
    const h = clone(base);
    Object.keys(over).forEach(k => { h[k] = Object.assign({}, h[k], over[k]); });
    return h;
  };
  const ZERO = "....  ....  ....  ....";
  const A = TEMPLATES.afrobeats;

  // ===================================================================
  // 1. Afrobeats: richer sounds and written bass lines for the two original styles
  // ===================================================================
  A.styles.smooth.sound = {
    kit: ["afro", "soft", "highlife", "vintage"], chords: ["rhodes", "guitar", "darkKeys", "rhodes"], pad: ["warm", "airy", "strings"],
    bass: ["pluckSub", "softSub", "sub808"], lead: ["glass", "vibes", "kalimba", "flute"], pluck: ["afroGuitar", "nylon", "kalimba", "bellPluck"],
    perc: ["conga", "bongo"], bellKind: ["agogo", "clave", "bell"], shaker: ["shaker", "shekere"], log: ["classic"]
  };
  A.styles.afropop.sound = {
    kit: ["afro", "punch", "dembow"], chords: ["rhodes", "wurli", "stab"], pad: ["warm", "airy"], bass: ["sub808", "pluckSub"],
    lead: ["glass", "vibes", "kalimba", "whistle"], pluck: ["kalimba", "bellPluck", "kora", "marimba", "afroGuitar"],
    perc: ["conga", "bongo", "djembe"], bellKind: ["agogo", "cowbell", "bell"], shaker: ["caxixi", "tambourine", "shaker"], log: ["classic"]
  };
  // Bass lines that sit with the 3-3-2 count and follow the chords
  A.styles.smooth.riffs = { bass: [
    RIFF("x..x ..x. ..x. ..x.", "r r 5 r 5"),
    RIFF("x..x ..x. x... ..x.", "r r r r 5"),
    RIFF("x... ..x. ..x. x.x.", "r r 5 8 5")
  ] };
  A.styles.afropop.riffs = { bass: [
    RIFF("x... ..x. .x.. ..x.", "r r 5 r"),
    RIFF("x..x ..x. x..x ..x.", "r r 5 r r 5")
  ] };
  A.styleOrder = ["smooth", "afropop", "afrofusion", "afroswing", "afrorave", "streetpop", "highlife"];

  // ---------------------------------------------------------------------
  // Afro-fusion / Alté: laid back, guitar-led, jazzy chords, loose drums (the Tems / Omah Lay / Rema-ballad lane)
  // ---------------------------------------------------------------------
  A.styles.afrofusion = {
    name: "Afro-fusion (Alté)",
    bpm: [86, 98], swing: 0.20, looseness: 1.4,
    scales: ["dorian", "minor", "dorian", "major"],
    progressions: {
      minor:  [[0,3,0,4], [0,6,5,6], [0,2,6,3], [0,5,3,6]],
      dorian: [[0,3,0,3], [0,3,6,3], [1,4,0,0], [0,6,3,6]],
      major:  [[0,3,4,3], [1,4,0,0], [0,5,3,4], [0,2,3,4]]
    },
    chorusProgressions: {
      minor:  [[3,6,0,0], [5,6,0,0], [3,4,0,5]],
      dorian: [[3,6,0,0], [3,0,6,0]],
      major:  [[3,4,0,0], [3,4,5,0]]
    },
    preProgressions: { minor: [[3,5,6,6], [5,6,5,6]], dorian: [[3,6,3,6]], major: [[3,4,3,4]] },
    chordsPerBar: [1, 2], chord: { seventh: 0.85, ninth: 0.55 },
    bassTones: ["root", "root", "fifth", "root", "octave", "fifth"],
    hookStyle: "jazzy", arp: "broken",
    sidechain: { harmony: 0.12, bass: 0.05, release: 0.2 },
    gate: { bass: { max: 4 }, chords: { max: 6 }, pluck: { max: 2 } },
    riffs: { bass: [
      RIFF("x..x ..x. .... ..x.", "r r 5 r"),
      RIFF("x... ..x. ..x. ...x", "r 5 r l"),
      RIFF("x..x ..x. x... ..x.", "r r 3 5 r")
    ] },
    groove: {
      kick:  V("x..x ..x. .... ..4.", "x... ..x. ..x. ....", "x..x .... ..x. ..4."),
      kickB: V("x... ..x. ..x. ...5", "x..x ..x. .... ..x."),
      snare: V(".... x... .... x...", ".... x... ...2 x..."),
      clap:  V(".... 6... .... 6..."),
      rim:   V("..5. .5.. ..5. .5..", "...5 ..5. ...5 ..5."),
      rimB:  V(".5.. ..5. .5.. ..5."),
      hatSparse: V("x.5. x.5. x.5. x.5.", "x... x.6. x... x.6."),
      hatFull:   V("x.6. x.7. x.6. x.7.", "x5x5 x5x6 x5x5 x5x7"),
      openhat: V(".... .... ..4. ....", ".... .... .... ..5."),
      shaker:  V("x5x5 x5x5 x5x5 x5x5", "5.x. 5.x. 5.x. 5.x."),
      perc:    V("x..x ..x. ..x. x...", "5..x ..x5 ..x. x..5"),       // the 3-2 clave
      percB:   V("..x. x..x ..x. .x..", "x..x ..x. x... ..x."),
      bell:    V("..4. .... ..4. ....", ".... .... .... ..4."),
      bassExtra: V(".... .... .... ..4.", ".... ...4 .... ...."),
      logdrum: P(ZERO),
      chordsVerse:  V("x... ..6. .... ..5.", "..x. .... ..6. ...5"),
      chordsChorus: V("x..6 ..x. ..6. .5..", "x... ..x. x..6 ..x."),
      pad:     P("6... .... .... ...."),
      pluckVerse:  V("x..5 ..x. 5..5 ..4.", "x... ..x. ..5. 5..5"),     // the guitar figure
      pluckVerseB: V("..x. ..5. x..5 ..x.", "x..x ..5. .... 5..4"),
      pluckChorus: V("x..x ..x. x..x ..x.", "x..x ..x. x..5 ..x5")
    },
    sound: {
      kit: ["afro", "soft", "highlife"], chords: ["guitar", "rhodes", "wurli"], pad: ["airy", "warm"], bass: ["pluckSub", "softSub"],
      lead: ["vibes", "glass", "flute"], pluck: ["afroGuitar", "nylon", "kora"],
      perc: ["conga", "bongo"], bellKind: ["clave", "agogo"], shaker: ["shekere", "shaker"], log: ["classic"]
    },
    fx: { reverb: { decay: 2.6, send: 0.30 }, delay: { send: 0.28, feedback: 0.34 } }
  };

  // ---------------------------------------------------------------------
  // Afroswing: UK Afrobeats. Boomy 808 kick, snappy snare, trap-style hats with rolls, gliding bass.
  // ---------------------------------------------------------------------
  A.styles.afroswing = {
    stopBeforeChorus: ["kick", "snare", "clap", "bass", "logdrum", "chords", "pluck"],
    name: "Afroswing",
    bpm: [96, 104], swing: 0.10, looseness: 0.8,
    scales: ["minor", "minor", "dorian"],
    progressions: {
      minor:  [[0,5,2,6], [0,0,5,6], [0,3,5,6], [0,6,5,4]],
      dorian: [[0,3,0,3], [0,6,3,0]],
      major:  [[0,4,5,3], [0,5,3,4]]
    },
    chorusProgressions: {
      minor:  [[5,6,0,0], [3,5,6,0], [5,2,6,0]],
      dorian: [[3,6,0,0], [3,0,6,0]],
      major:  [[3,4,0,5], [5,3,0,4]]
    },
    preProgressions: { minor: [[3,5,6,6], [5,6,5,6]], dorian: [[3,6,3,6]], major: [[3,4,3,4]] },
    chordsPerBar: [1], chord: { seventh: 0.5, ninth: 0.2 },
    bassTones: ["root", "root", "root", "fifth", "root", "octave"],
    hookStyle: "bouncy", arp: "up",
    hatRoll: { prob: 0.25, steps: [7, 15], kind: "double" },
    sidechain: { harmony: 0.3, bass: 0.15, release: 0.18 },
    gate: { bass: { max: 6 } },
    riffs: { bass: [
      RIFF("x..x ..x. ..x. ....", "r r 5 r"),
      RIFF("x..x ..x. x... ..x.", "r r r r 5"),
      RIFF("x... ..x. x..x ..x.", "r r 5 5 8")
    ] },
    groove: {
      kick:  V("x..x ..x. ..x. ....", "x..x ..x. x... ..x.", "x... ..x. ..x. x..."),
      kickB: V("x... ..x. ..x. ..x.", "x..x .... x..x ...."),
      snare: V(".... x... .... x...", ".... x... .... x..3"),
      clap:  V(".... x... .... x..."),
      rim:   V("...x ..5. ...x ..5.", "..5. .5.. ..5. .5.."),
      hatSparse: V("x.x. x.x. x.x. x.x.", "x.xx x.x. x.xx x.x."),
      hatFull:   V("x6x6 x6x6 x6x6 x6x7", "xx6x xx6x xx6x xx67"),
      openhat: V(".... ..4. .... ..6."),
      shaker:  V("x7x7 x7x7 x7x7 x7x7"),
      perc:    V("..x. ...x ..x. .x..", "x..x ..x. ..x. x..."),
      bell:    V(".... ..4. .... ...."),
      bassExtra: V(".... ...5 .... ..5."),
      logdrum: P(ZERO),
      chordsVerse:  V("x... .... ..6. ....", "x... ..5. .... ..6."),
      chordsChorus: V("x... ..x. x... ..6.", "x..6 .... x..6 ...."),
      pad:     P("x... .... .... ...."),
      pluckVerse:  V("..5. ..x. ..5. ..x.", "x.5. .... x.5. ...."),
      pluckChorus: V("x.x. x.x. x.x. x.x5", "x.5x .x5. x.5x .x5.")
    },
    sound: {
      kit: ["dembow"], chords: ["rhodes", "amaPiano", "darkKeys"], pad: ["dark", "airy"], bass: ["glide808", "sub808"],
      lead: ["glass", "vibes"], pluck: ["afroGuitar", "kora", "bellPluck"],
      perc: ["conga", "bongo"], bellKind: ["clave", "agogo"], shaker: ["caxixi", "shaker"], log: ["classic"]
    },
    fx: { reverb: { decay: 2.2, send: 0.26 }, delay: { send: 0.26, feedback: 0.32 } }
  };

  // ---------------------------------------------------------------------
  // Afro-rave: driving, dembow-leaning, bright keys and arps (the big crossover sound)
  // The dembow: kick on every beat, snare on steps 3, 6, 11, 14.
  // ---------------------------------------------------------------------
  A.styles.afrorave = {
    stopBeforeChorus: ["kick", "snare", "clap", "bass", "logdrum", "chords", "pluck"],
    name: "Afro-rave",
    bpm: [104, 112], swing: 0.04, looseness: 0.6,
    scales: ["minor", "dorian", "major", "minor"],
    progressions: {
      minor:  [[0,5,2,6], [0,3,5,6], [0,6,5,6]],
      dorian: [[0,3,0,3], [0,6,3,0]],
      major:  [[0,4,5,3], [0,5,3,4], [0,3,4,3]]
    },
    chorusProgressions: {
      minor:  [[5,6,0,0], [3,5,6,0], [5,2,6,0]],
      dorian: [[3,6,0,0], [3,0,6,0]],
      major:  [[3,4,0,5], [5,3,0,4], [3,4,5,0]]
    },
    preProgressions: { minor: [[3,5,6,6], [5,6,5,6]], dorian: [[3,6,3,6]], major: [[3,4,3,4], [5,3,4,4]] },
    chordsPerBar: [1], chord: { seventh: 0.4, ninth: 0.1 },
    bassTones: ["root", "root", "root", "fifth", "octave", "root"],
    hookStyle: "anthem", arp: "up",
    sidechain: { harmony: 0.35, bass: 0.2, release: 0.15 },
    gate: { bass: { max: 3 } },
    riffs: { bass: [
      RIFF("x..x ..x. x..x ..x.", "r r 5 r r 5"),
      RIFF("x... x... x... x..x", "r r r r 5")
    ] },
    groove: {
      kick:  V("x... x... x... x...", "x... x... x... x..4", "x... x..4 x... x..."),
      snare: V("...x ..x. ...x ..x.", "...x ..x. ...x ..xx"),                 // the dembow
      clap:  V(".... x... .... x...", ".... 8... .... x..."),
      rim:   V("..5. .... ..5. ...."),
      hatSparse: V("x.x. x.x. x.x. x.x.", "..x. ..x. ..x. ..x."),
      hatFull:   V("x6x6 x6x6 x6x6 x6x7"),
      openhat: V("..x. ..x. ..x. ..x.", "..x. ..6. ..x. ..7."),
      shaker:  V("x7x7 x7x7 x7x7 x7x7"),
      perc:    V("..x. ...x ..x. .x..", "x..x ..x. ..x. x..."),
      bell:    V("...7 ..7. ...7 ..7."),                                          // agogo doubling the dembow
      bassExtra: V(".... ...5 .... ..5."),
      logdrum: P(ZERO),
      chordsVerse:  V("x... .... ..8. ....", "...8 ..8. ...8 ..8."),
      chordsChorus: V("x..x ..x. x..x ..x.", "...x ..x. ...x ..x."),
      pad:     P("6... .... .... ...."),
      pluckVerse:  V("x.x. x.x. x.x. x.x.", "..x. ..x. ..x. ..x."),
      pluckChorus: V("x.xx x.xx x.xx x.xx", "x.x. x.x. x.x. x.xx")
    },
    sound: {
      kit: ["dembow", "afro"], chords: ["stab", "rhodes", "amaPiano"], pad: ["airy", "strings"], bass: ["sub808", "pluckSub", "glide808"],
      lead: ["glass", "whistle", "flute"], pluck: ["kora", "marimba", "afroGuitar"],
      perc: ["conga", "bongo"], bellKind: ["agogo", "cowbell"], shaker: ["tambourine", "caxixi"], log: ["classic"]
    },
    fx: { reverb: { decay: 2.2, send: 0.25 }, delay: { send: 0.30, feedback: 0.32 } }
  };

  // ---------------------------------------------------------------------
  // Street-pop: heavy percussion, talking drum, log drum, organ and a chanted hook
  // ---------------------------------------------------------------------
  A.styles.streetpop = {
    stopBeforeChorus: ["kick", "snare", "clap", "bass", "logdrum", "chords", "pluck"],
    name: "Street-pop",
    bpm: [102, 112], swing: 0.10, looseness: 1.3,
    scales: ["minor", "dorian", "minor"],
    progressions: {
      minor:  [[0,0,5,6], [0,5,6,6], [0,3,0,6], [0,6]],
      dorian: [[0,3,0,3], [0,0,3,3]],
      major:  [[0,4,5,3], [0,5,3,4]]
    },
    chorusProgressions: {
      minor:  [[5,6,0,0], [3,6,0,0], [5,5,6,0]],
      dorian: [[3,6,0,0], [3,0,6,0]],
      major:  [[3,4,0,5], [5,3,0,4]]
    },
    preProgressions: { minor: [[3,5,6,6], [5,6,5,6]], dorian: [[3,6,3,6]], major: [[3,4,3,4]] },
    chordsPerBar: [1], chord: { seventh: 0.4, ninth: 0.1 },
    bassTones: ["root", "root", "root", "root", "fifth", "octave"],
    hookStyle: "chant", arp: "updown",
    sidechain: { harmony: 0.3, bass: 0.2, release: 0.2 },
    gate: { bass: { max: 4 }, logdrum: { max: 2 } },
    riffs: {
      bass: [ RIFF("x... .... ..x. ....", "r 5"), RIFF("x..x .... x... ....", "r r 5") ],
      logdrum: [
        RIFF("x..x ..x. ..x. x.x.", "r r 5 8 5 3"),
        RIFF("x..x ..x. x..x ..x.", "r 5 r 8 r 5"),
        RIFF("x.x. ..x. x.x. ..x.", "r l r 5 r 8")
      ]
    },
    groove: {
      kick:  V("x..x ..x. ..x. ....", "x... ..x. x..x ..x.", "x..x ..x. ..x. ..4."),
      kickB: V("x... ..x. ..x. x..4", "x..x .... x... ..x."),
      snare: V(".... x... .... x...", ".... x... ...4 x..."),
      clap:  V(".... x... .... x..."),
      rim:   V("..5. .5.. ..5. .5.."),
      hatSparse: V("x.x. x.x. x.x. x.x6"),
      hatFull:   V("x6x6 x6x6 x6x6 x6x7", "x.xx x.x6 x.xx x.x7"),
      openhat: V("..4. .... ..4. ..6."),
      shaker:  V("x7x7 x7x7 x7x7 x7x8"),
      perc:    V("x..x ..x. x..x ..x.", "x.xx ..x. x.x. x..x"),                   // dense talking-drum / conga part
      percB:   V("..x. x..x ..x. .x.x", "x..x ..x. ..xx ..x."),
      bell:    V("x..x ..x. x... ..x.", "x... ..x. ..x. x..."),
      bassExtra: V(".... ...5 .... ..5."),
      logdrum: P("x..x ..x. ..x. x.x."),                                           // (the riff above replaces this)
      chordsVerse:  V("x... .... ..6. ....", "x... ..8. .... ..6."),
      chordsChorus: V("x..x ..x. x..x ..x."),
      pad:     P("x... .... .... ...."),
      pluckVerse:  V("..x. ..x. ..x. ..x.", "x..x ..x. x..x ..x."),
      pluckChorus: V("x.x. x.x. x.x. x.x.", "x..x ..x. x..x ..x.")
    },
    sound: {
      kit: ["afro", "dembow"], chords: ["organ", "darkKeys", "rhodes"], pad: ["choir", "dark"], bass: ["amaSub", "pluckSub"],
      lead: ["horn", "whistle", "glass"], pluck: ["kora", "afroGuitar", "marimba"],
      perc: ["talking", "djembe", "conga"], bellKind: ["agogo", "cowbell"], shaker: ["shekere", "shaker"], log: ["ama", "wood"]
    },
    fx: { reverb: { decay: 2.8, send: 0.30 }, delay: { send: 0.25, feedback: 0.30 } }
  };

  // ---------------------------------------------------------------------
  // Afro-highlife: shuffling live feel, clean guitar, horns, walking bass, cowbell and shekere
  // ---------------------------------------------------------------------
  A.styles.highlife = {
    name: "Afro-highlife",
    bpm: [100, 112], swing: 0.22, looseness: 1.4,
    scales: ["major", "major", "dorian", "minor"],
    progressions: {
      minor:  [[0,3,6,3], [0,5,6,0], [0,3,4,3]],
      dorian: [[0,3,0,3], [0,3,6,3]],
      major:  [[0,3,4,3], [0,4,5,3], [0,5,3,4], [0,3,0,4]]
    },
    chorusProgressions: {
      minor:  [[3,6,0,0], [5,6,0,0]],
      dorian: [[3,6,0,0], [3,0,6,0]],
      major:  [[3,4,0,0], [3,4,0,5], [5,3,4,0]]
    },
    preProgressions: { minor: [[3,5,6,6]], dorian: [[3,6,3,6]], major: [[1,4,1,4], [3,4,3,4]] },
    chordsPerBar: [1, 2], chord: { seventh: 0.3, ninth: 0.1 },
    bassTones: ["root", "fifth", "octave", "fifth", "root", "fifth"],
    hookStyle: "bouncy", arp: "up",
    sidechain: { harmony: 0.1, bass: 0.0, release: 0.15 },
    gate: { bass: { max: 2 }, chords: { max: 2 }, pluck: { max: 2 } },
    riffs: { bass: [
      RIFF("x.x. x.x. x.x. x.x.", "r 5 8 5 r 5 8 5"),                       // walking
      RIFF("x... x.x. x... x.x.", "r r 5 r r 5")
    ] },
    groove: {
      kick:  V("x... ..x. x... ..x.", "x... .... x... ..x.", "x..x .... x... ...x"),
      kickB: V("x... ..x. x... ...4", "x... ...x x... ..x."),
      snare: V(".... x... .... x...", ".... x..3 .... x..."),
      clap:  P(ZERO),
      rim:   V("..x. ..x. x..x ..x.", "x..x ..x. ..x. ..x."),                // the woodblock / clave line
      hatSparse: V("x.x. x.x. x.x. x.x.", "x.xx x.xx x.xx x.xx"),
      hatFull:   V("x5x5 x5x5 x5x5 x5x6"),
      openhat: V(".... ...4 .... ...5"),
      shaker:  V("x.x7 x.x7 x.x7 x.x7", "x5x5 x5x5 x5x5 x5x8"),
      perc:    V("x..x ..x. ..x. x...", "..x. x..x ..x. .x.."),
      bell:    V("x... x... x... x...", "x.x. x.x. x.x. x.x."),                 // steady cowbell
      bassExtra: V(".... .... .... ..4."),
      logdrum: P(ZERO),
      chordsVerse:  V("..x. ..x. ..x. ..x.", "..x. ...x ..x. ...x"),            // offbeat guitar skank
      chordsChorus: V("x.x. x.x. x.x. x.x.", "..x. x.x. ..x. x.x."),
      pad:     P("6... .... .... ...."),
      pluckVerse:  V("x.x. ..x. x.x. ..x.", "x..x ..x. x..x ..x."),            // guitar riff
      pluckChorus: V("x.xx x.x. x.xx x.x.", "x.x. x.xx x.x. x.xx")
    },
    sound: {
      kit: ["highlife", "afro"], chords: ["guitar", "organ", "rhodes"], pad: ["warm", "strings"], bass: ["pluckSub", "softSub"],
      lead: ["horn", "flute", "vibes"], pluck: ["afroGuitar", "nylon"],
      perc: ["conga", "bongo"], bellKind: ["cowbell", "agogo"], shaker: ["shekere", "tambourine"], log: ["classic"]
    },
    fx: { reverb: { decay: 1.9, send: 0.20 }, delay: { send: 0.20, feedback: 0.28 } }
  };

  // ===================================================================
  // 2. Amapiano
  // The engine of the genre: a log-drum bass line, offbeat open hats, 16th-note shakers with accents,
  // soft four-on-the-floor kick, and jazzy piano. Slower than house, wider than afrobeats.
  // ===================================================================
  const ama = clone(A);
  delete ama.styles;
  Object.assign(ama, {
    name: "Amapiano",
    styleOrder: ["classic", "privateschool", "sgija"],
    logdrum: { tones: [0, 0, 2] },
    gate: { bell: { max: 1 }, bass: { max: 8 }, logdrum: { max: 2 }, chords: { max: 2 }, pad: { fixed: 16 }, pluck: { max: 1 }, lead: { max: 8 } },
    pan: {
      kick: 0, snare: 0, clap: 0, rim: -0.3, hat: 0.3, openhat: -0.25, shaker: -0.45, perc: 0.4,
      bell: 0.3, bass: 0, logdrum: 0, chords: -0.15, pad: 0, pluck: 0.3, lead: 0.2
    },
    sidechain: { harmony: 0.2, bass: 0.08, release: 0.2 },
    mix: {
      kick: -10, snare: -14, clap: -8, rim: -16, hat: -26, openhat: -24, shaker: -11, perc: -16,
      bell: -17, bass: -9, logdrum: -8, chords: -11, pad: -23, pluck: -14, lead: -14
    },
    // (measured: with bass and log drum at the kick's level the mix was 72% below 150 Hz, too heavy for a vocal;
    //  3 dB / 2 dB under it brings that to the range of the original R&B and Afrobeats genres)
    balance: {
      kick: 0, snare: -9, clap: -5, rim: -14, hat: -17, openhat: -13, shaker: -10, perc: -11,
      bell: -16, bass: -3, logdrum: -2, chords: -6, pad: -12, pluck: -8, lead: -8
    },
    // Amapiano shakers lean on the off-16ths; the snare is a soft whisper behind the claps; the log drum is played firmly
    humanize: human(A.humanize, {
      kick:    { velocity: 0.80, variation: 0.04, timingMs: 3 },
      snare:   { velocity: 0.60, variation: 0.08, timingMs: 6 },
      clap:    { velocity: 0.78, variation: 0.08, timingMs: 5 },
      shaker:  { velocity: 0.80, variation: 0.08, timingMs: 6, accent: [1,.5,.78,.58, .95,.5,.78,.62, 1,.5,.78,.58, .95,.5,.78,.68] },
      hat:     { velocity: 0.60, variation: 0.08, accent: [1,.6,.8,.6, 1,.6,.8,.6, 1,.6,.8,.6, 1,.6,.8,.6] },
      openhat: { velocity: 0.75, variation: 0.06, timingMs: 5 },
      logdrum: { velocity: 0.88, variation: 0.07, ghost: 0.7, timingMs: 4 },
      bass:    { velocity: 0.85, variation: 0.04, timingMs: 3 }
    }),
    arrangement: Object.assign(clone(A.arrangement), {
      presence: {
        kick: [1, 1, 1, 1], snare: [0.6, 0.8, 0.8, 1], clap: [0.8, 1, 1, 1], rim: [0.4, 0.6, 0.6, 0.8],
        hat: [0.8, 1, 1, 1], openhat: [0.6, 1, 1, 1], shaker: [1, 1, 1, 1], perc: [0.4, 0.8, 1, 1],
        bell: [0, 0.4, 0.6, 0.6], bass: [1, 1, 1, 1], logdrum: [0.6, 1, 1, 1], chords: [1, 1, 1, 1],
        pad: [1, 0.6, 1, 0.6], pluck: [0.4, 0.8, 1, 1], lead: [0, 0, 0, 0]
      },
      // Fills: a shaker + perc roll, or a log-drum run into the next section
      fills: [
        { shaker: P("xxxx  xxxx  xxxx  xxxx"), perc: P("....  ....  ..88  8888"), snare: P("....  ....  ....  x.xx"), openhat: P("....  ....  ....  ...8") },
        { logdrum: P("x..x  ..x.  x.x.  x.xx"), clap: P("....  x...  ....  x.xx"), shaker: P("x7x7  x7x7  xxxx  xxxx") }
      ],
      accent: ["kick", "openhat", "logdrum"]
    })
  });
  TEMPLATES.amapiano = ama;

  const amaCommon = {
    // the stop: on the last beat before a chorus these drop out (see songBarView)
    stopBeforeChorus: ["kick", "snare", "clap", "bass", "logdrum", "chords", "pluck"],
    chordsPerBar: [1, 2],
    hookStyle: "ama"
  };

  // ---- Classic amapiano: log-drum led, bouncy, club ready ----
  ama.styles = {};
  ama.styles.classic = Object.assign({}, amaCommon, {
    name: "Classic Amapiano",
    bpm: [111, 115], swing: 0.06, looseness: 1.1,
    scales: ["minor", "minor", "dorian"],
    progressions: {
      minor:  [[0,5,6,6], [0,3,6,5], [0,0,3,3], [0,6,5,4]],
      dorian: [[0,3,0,3], [0,3,6,3]],
      major:  [[0,4,5,3], [0,5,3,4]]
    },
    chorusProgressions: {
      minor:  [[5,6,0,0], [3,6,0,0], [5,5,6,6]],
      dorian: [[3,6,0,0], [3,0,6,0]],
      major:  [[3,4,0,5], [5,3,0,4]]
    },
    preProgressions: { minor: [[3,5,6,6], [5,6,5,6]], dorian: [[3,6,3,6]], major: [[3,4,3,4]] },
    chord: { seventh: 0.9, ninth: 0.7 },
    bassTones: ["root", "root", "root", "fifth"],
    arp: "updown",
    gate: { bass: { max: 8 } },
    riffs: {
      logdrum: [
        RIFF("x..x ..x. ..x. x.x.", "r r 5 8 5 3"),
        RIFF("x..x ..x. x..x ..x.", "r 5 r 8 r 5"),
        RIFF("x... ..x. ..xx ..x.", "r 5 8 7 5"),
        RIFF("x.x. ..x. x.x. ..x.", "r l r 5 r 8")
      ],
      bass: [ RIFF("x... .... ..6. ....", "r 5"), RIFF("x... .... .... ....", "r"), RIFF("x... ...6 ..x. ....", "r r 5") ]
    },
    groove: {
      kick:  V("x... x... x... x...", "x... x... x... x..4", "x... ..x. x... x..."),
      kickB: V("x... x... x... ...x", "x... ..x. x... x..4"),
      snare: V(".... x... .... x...", ".... x... ..3. x..4"),
      clap:  V(".... x... .... x...", ".... x... .... x.6."),
      rim:   V("..4. .... ..4. ....", ".... ..4. .... ..4."),
      hatSparse: V("x.x. x.x. x.x. x.x.", "..x. ..x. ..x. ..x."),
      hatFull:   V("x.xx x.xx x.xx x.xx", "x6x6 x6x6 x6x6 x6x7"),
      openhat: V("..x. ..x. ..x. ..x.", "..x. ..x. ..x. ..8."),                 // the offbeat open hat: the amapiano bounce
      shaker:  V("xxxx xxxx xxxx xxxx"),                                    // steady 16ths: the accents (humanize) make the groove
      shakerB: V("xxxx xxxx xxxx xxx."),
      perc:    V("..x. ...x ..x. .x..", ".x.. ..x. x... ...x", "x..x ..x. ..x. x..."),
      percB:   V("x..x ..x. ..x. x...", "..x. x..x ..x. ...x"),
      bell:    V("...5 .... ..5. ....", ".... ..5. .... ...5"),
      bassExtra: V(".... .... ..5. ....", ".... .... .... ..5."),
      logdrum: P("x..x ..x. ..x. x.x."),
      chordsVerse:  V("x..8 ..6. ..x. .5..", "..x. .8.. ..x. ..6.", "x... ..x. ..8. ..6."),
      chordsChorus: V("x..x ..x. x..x ..6.", "x.x. ..x. x.x. ..x."),
      pad:     P("6... .... .... ...."),
      pluckVerse:  V("..x. .... ..5. .5..", ".... x... ..5. ...5"),
      pluckVerseB: V(".... ..5. x... ..5."),
      pluckChorus: V("x.x. x..5 x.x. x.5x", "x.xx .5.. x.xx .5..")
    },
    rules: {
      intro:  { presence: { kick: 0.3, snare: 0, clap: 0, logdrum: 0, bass: 0.5, hat: 0.8, openhat: 0.5, shaker: 1, perc: 0.3, pad: 1, chords: 1, pluck: 0.7 }, enter: { kick: 0.5, bass: 0.5, shaker: 0 } },
      verse:  { presence: { logdrum: 0.9, clap: 1, snare: 0.5, openhat: 0.9, shaker: 1, perc: 0.6, pad: 0.5, bell: 0.3, pluck: 0.7 } },
      pre:    { presence: { logdrum: 1, openhat: 0.8 } },
      chorus: { presence: { logdrum: 1, lead: 0.9, pluck: 0.7, perc: 0.9 } },
      bridge: { presence: { logdrum: 0.3, kick: 0.5 } }
    },
    sound: {
      kit: ["ama"], chords: ["amaPiano", "rhodes"], pad: ["airy", "strings"], bass: ["amaSub"],
      lead: ["flute", "vibes", "whistle"], pluck: ["pianoRun", "marimba", "kora"],
      perc: ["conga", "bongo"], bellKind: ["clave", "agogo"], shaker: ["shaker", "caxixi"], log: ["ama", "wood"]
    },
    fx: { reverb: { decay: 2.8, send: 0.30 }, delay: { send: 0.22, feedback: 0.30 } }
  });

  // ---- Private school: slower, jazzy, piano runs, a whisper of log drum ----
  ama.styles.privateschool = Object.assign({}, amaCommon, {
    name: "Private School",
    bpm: [106, 111], swing: 0.10, looseness: 1.5,
    scales: ["dorian", "minor", "dorian"],
    progressions: {
      minor:  [[0,3,6,2], [0,2,3,6], [0,5,3,6]],
      dorian: [[0,3,0,3], [1,4,0,0], [0,3,6,3], [0,6,3,2]],
      major:  [[1,4,0,5], [0,2,3,4], [3,2,1,4]]
    },
    chorusProgressions: {
      minor:  [[3,6,2,5], [5,3,6,0]],
      dorian: [[3,4,0,0], [3,6,0,0], [1,3,6,0]],
      major:  [[3,2,1,4], [3,4,2,5]]
    },
    preProgressions: { minor: [[3,4,5,6]], dorian: [[1,4,1,4], [3,4,3,4]], major: [[1,4,1,4]] },
    chordsPerBar: [1, 2, 2], chord: { seventh: 1, ninth: 0.85 },
    bassTones: ["root", "root", "fifth", "third"],
    hookStyle: "jazzy", arp: "broken",
    sidechain: { harmony: 0.1, bass: 0.05, release: 0.2 },
    gate: { chords: { max: 4 }, bass: { max: 10 } },
    riffs: {
      logdrum: [ RIFF("x... .... ..x. ....", "r 5"), RIFF("..x. .... x... ...x", "5 r 8") ],
      bass: [ RIFF("x... .... .... ....", "r"), RIFF("x... .... ..5. ....", "r 5") ]
    },
    groove: {
      kick:  V("x... .... x... ....", "x... ..x. x... ....", "x... x... x... ...."),
      kickB: V("x... .... x... ..x."),
      snare: V(".... x... .... x...", ".... x... .... x..2"),
      clap:  V(".... 6... .... 6..."),
      rim:   V("..3. .... ..3. ...."),
      hatSparse: V("x.5. x.5. x.5. x.5."),
      hatFull:   V("x5x5 x5x5 x5x5 x5x6"),
      openhat: V("..x. .... ..x. ....", "..5. ..5. ..5. ..5."),
      shaker:  V("x.xx x.xx x.xx x.xx"),
      perc:    V("..x. ...x ..5. .x..", ".... x..x ..x. ...x"),
      bell:    V(".... ..4. .... ...."),
      bassExtra: V(".... .... ..5. ...."),
      logdrum: P("x... .... ..x. ...."),
      chordsVerse:  V("x..8 ..6. ..x. .5..", "..x. .8.. ..8. ..6."),
      chordsChorus: V("x..x ..x. x..8 ..6.", "x.x. ..8. x.x. ..8."),
      pad:     P("6... .... .... ...."),
      pluckVerse:  V("x.x. .5.5 x.x. .5.6", "..5x .5x. ..5x .5x."),            // the piano runs
      pluckChorus: V("x.xx .5x5 x.xx .5x5")
    },
    rules: {
      intro:  { presence: { kick: 0.2, snare: 0, clap: 0, logdrum: 0, bass: 0.5, shaker: 1, pad: 1, chords: 1, pluck: 0.8 }, enter: { kick: 0.5, shaker: 0 } },
      verse:  { presence: { logdrum: 0.5, pluck: 0.8, pad: 0.8 } },
      chorus: { presence: { logdrum: 0.8, lead: 0.7, pluck: 0.9 } }
    },
    sound: {
      kit: ["ama"], chords: ["amaPiano", "rhodes", "wurli"], pad: ["strings", "airy"], bass: ["amaSub", "softSub"],
      lead: ["flute", "vibes"], pluck: ["pianoRun", "kora"],
      perc: ["bongo", "conga"], bellKind: ["clave"], shaker: ["caxixi", "shaker"], log: ["ama"]
    },
    fx: { reverb: { decay: 3.2, send: 0.36 }, delay: { send: 0.25, feedback: 0.30 } }
  });

  // ---- Sgija: hard, sparse, short wooden log drum ----
  ama.styles.sgija = Object.assign({}, amaCommon, {
    name: "Sgija",
    bpm: [112, 118], swing: 0.04, looseness: 0.9,
    scales: ["minor", "minor", "dorian"],
    progressions: {
      minor:  [[0,0,5,6], [0,0,3,3], [0,6,5,5]],
      dorian: [[0,3,0,3], [0,0,3,3]],
      major:  [[0,0,4,4], [0,5,3,4]]
    },
    chorusProgressions: {
      minor:  [[5,6,0,0], [3,3,6,0]],
      dorian: [[3,6,0,0]],
      major:  [[3,4,0,0]]
    },
    preProgressions: { minor: [[3,5,6,6]], dorian: [[3,6,3,6]], major: [[3,4,3,4]] },
    chordsPerBar: [1], chord: { seventh: 0.6, ninth: 0.3 },
    bassTones: ["root", "root", "fifth", "root"],
    hookStyle: "ama", arp: "up",
    sidechain: { harmony: 0.3, bass: 0.12, release: 0.18 },
    gate: { bass: { max: 4 } },
    riffs: {
      logdrum: [
        RIFF("x..x ..x. x..x ..x.", "r r 5 r r 5"),
        RIFF("x.x. x.x. x.x. ..x.", "r r 5 8 5 3 r"),
        RIFF("x..x .xx. x..x ..x.", "r r 5 8 5 r 3")
      ],
      bass: [ RIFF("x... .... ..x. ....", "r r"), RIFF("x..x .... x... ....", "r 5 r") ]
    },
    groove: {
      kick:  V("x... x... x... x...", "x... x... x... x.x.", "x..x ..x. x... x..."),
      kickB: V("x... x... x... ..x."),
      snare: V(".... x... .... x..."),
      clap:  V(".... x... .... x...", ".... x... .... xx.."),
      rim:   V("..5. ..5. ..5. ..5."),
      hatSparse: V("x.x. x.x. x.x. x.x."),
      hatFull:   V("x.xx x.xx x.xx x.xx"),
      openhat: V("..x. ..x. ..x. ..x."),
      shaker:  V("xxxx xxxx xxxx xxxx"),
      perc:    V("..x. ...x ..x. .x..", ".x.. ..x. x..x ..x."),
      bell:    V(".... .... ..5. ...."),
      bassExtra: V(".... .... ..5. ...."),
      logdrum: P("x..x ..x. x..x ..x."),
      chordsVerse:  V("x... .... .... ..5.", "x... .... ..x. ...."),
      chordsChorus: V("x... ..x. x... ..5.", "x... .... x... ..6."),
      pad:     P("6... .... .... ...."),
      pluckVerse:  V(".... ..5. .... ..5.", ".... .... ..5. ...."),
      pluckChorus: V("x... ..x. x... ..x.", "x..5 .... x..5 ....")
    },
    rules: {
      intro:  { presence: { kick: 0.4, logdrum: 0.2, snare: 0, clap: 0 }, enter: { kick: 0.5 } },
      verse:  { presence: { logdrum: 1, pad: 0.3, pluck: 0.5 } },
      chorus: { presence: { logdrum: 1, lead: 0.8 } }
    },
    sound: {
      kit: ["house", "ama"], chords: ["stab", "amaPiano", "darkKeys"], pad: ["dark", "strings"], bass: ["amaSub", "growl"],
      lead: ["whistle", "glass"], pluck: ["marimba", "kora"],
      perc: ["conga", "tom"], bellKind: ["cowbell", "clave"], shaker: ["tambourine", "caxixi"], log: ["wood", "ama"]
    },
    fx: { reverb: { decay: 2.2, send: 0.24 }, delay: { send: 0.20, feedback: 0.28 } }
  });

  // ===================================================================
  // 3. Afro House (and Gqom): four on the floor, hand percussion, offbeat open hats, pumping sidechain
  // ===================================================================
  const house = clone(A);
  delete house.styles;
  Object.assign(house, {
    name: "Afro House",
    styleOrder: ["deephouse", "gqom"],
    logdrum: { tones: [0, 0, 2] },
    gate: { bell: { max: 1 }, bass: { max: 2 }, logdrum: { max: 2 }, chords: { max: 2 }, pad: { fixed: 16 }, pluck: { max: 1 }, lead: { max: 8 } },
    pan: {
      kick: 0, snare: 0, clap: 0.05, rim: -0.3, hat: 0.3, openhat: -0.25, shaker: -0.4, perc: 0.45,
      bell: 0.3, bass: 0, logdrum: 0.1, chords: -0.15, pad: 0, pluck: 0.3, lead: 0.2
    },
    sidechain: { harmony: 0.5, bass: 0.3, release: 0.18 },
    mix: {
      kick: -8, snare: -13, clap: -7.5, rim: -15, hat: -23, openhat: -22, shaker: -11, perc: -13,
      bell: -16, bass: -8, logdrum: -14, chords: -12, pad: -22, pluck: -15, lead: -14
    },
    balance: {
      kick: 0, snare: -8, clap: -4, rim: -13, hat: -15, openhat: -13, shaker: -11, perc: -9,
      bell: -15, bass: -1, logdrum: -6, chords: -6, pad: -12, pluck: -8, lead: -8
    },
    // House is played tight: very little timing wobble
    humanize: human(A.humanize, {
      kick:    { velocity: 0.95, variation: 0.03, timingMs: 2 },
      clap:    { velocity: 0.85, variation: 0.05, timingMs: 3 },
      hat:     { velocity: 0.65, variation: 0.08, timingMs: 4 },
      openhat: { velocity: 0.78, variation: 0.06, timingMs: 4 },
      shaker:  { velocity: 0.75, variation: 0.08, timingMs: 5 },
      perc:    { velocity: 0.75, variation: 0.12, timingMs: 6 },
      bass:    { velocity: 0.90, variation: 0.04, timingMs: 3 }
    }),
    arrangement: Object.assign(clone(A.arrangement), {
      presence: {
        kick: [1, 1, 1, 1], snare: [0, 0, 0.5, 1], clap: [0.5, 1, 1, 1], rim: [0.4, 0.6, 0.8, 0.8],
        hat: [0.8, 1, 1, 1], openhat: [0.6, 1, 1, 1], shaker: [1, 1, 1, 1], perc: [0.4, 0.8, 1, 1],
        bell: [0, 0.4, 0.6, 0.6], bass: [1, 1, 1, 1], logdrum: [0, 0, 0, 0], chords: [1, 1, 1, 1],
        pad: [0.8, 0.5, 0.8, 0.5], pluck: [0.3, 0.6, 1, 1], lead: [0, 0, 0, 0]
      },
      fills: [
        { snare: P("....  ....  x.x.  xxxx"), perc: P("....  ....  ..88  8888"), openhat: P("....  ....  ....  ..x.") },
        { perc: P("....  x.x.  x.x.  xxxx"), clap: P("....  ....  ....  xxxx"), shaker: P("xxxx  xxxx  xxxx  xxxx") }
      ],
      accent: ["kick", "openhat"]
    })
  });
  TEMPLATES.afrohouse = house;
  house.styles = {};

  // ---- Afro house: warm, rolling, hand-percussion heavy ----
  house.styles.deephouse = {
    stopBeforeChorus: ["kick", "snare", "clap", "bass", "logdrum", "chords", "pluck"],
    name: "Deep Afro House",
    bpm: [120, 124], swing: 0.03, looseness: 0.5,
    scales: ["minor", "dorian", "minor"],
    progressions: {
      minor:  [[0,0,3,3], [0,5,3,6], [0,6,5,6]],
      dorian: [[0,3,0,3], [0,0,3,3]],
      major:  [[0,3,4,3], [0,5,3,4]]
    },
    chorusProgressions: {
      minor:  [[3,3,6,6], [5,6,0,0]],
      dorian: [[3,6,0,0], [3,0,6,0]],
      major:  [[3,4,0,0]]
    },
    preProgressions: { minor: [[3,5,6,6]], dorian: [[3,6,3,6]], major: [[3,4,3,4]] },
    chordsPerBar: [2, 1], chord: { seventh: 0.8, ninth: 0.5 },
    bassTones: ["root", "root", "fifth", "root"],
    hookStyle: "house", arp: "up",
    gate: { bass: { max: 2 }, chords: { max: 2 } },
    riffs: { bass: [
      RIFF("..x. ..x. ..x. ..x.", "r r 5 r"),
      RIFF("..x. ..x. ..x. ..x.", "r 5 r 8"),
      RIFF("x.x. ..x. x.x. ..x.", "r r 5 r 5 8")
    ] },
    groove: {
      kick:  V("x... x... x... x..."),
      snare: P(ZERO),
      clap:  V(".... x... .... x...", ".... x... .... x.5."),
      rim:   V("..5. .... ..5. .5.."),
      hatSparse: V("x.x. x.x. x.x. x.x.", "..x. ..x. ..x. ..x."),
      hatFull:   V("x.xx x.xx x.xx x.xx"),
      openhat: V("..x. ..x. ..x. ..x."),                                     // offbeat open hat
      shaker:  V("x6x7 x6x7 x6x7 x6x8"),
      perc:    V("..x. x..x ..x. .x..", "x..x ..x. ..x. x..x"),
      percB:   V(".x.. ..x. x... ..x.", "..x. ..x. x..x ...x"),
      bell:    V("..5. .... ..5. ....", ".... ..5. .... ..5."),
      bassExtra: V(".... ..5. .... ..5."),
      logdrum: P(ZERO),
      chordsVerse:  V("..x. ..x. ..x. ..x.", "..x. ...x ..x. ...x"),         // offbeat stabs
      chordsChorus: V("x.x. ..x. x.x. ..x.", "..x. x.x. ..x. x.x."),
      pad:     P("6... .... .... ...."),
      pluckVerse:  V("..x. ..5. ..x. ..5.", "x.5. .... x.5. ...."),
      pluckChorus: V("x.x. x.x. x.x. x.x.", "..x. ..x. x.x. ..x.")
    },
    rules: {
      intro:  { presence: { kick: 1, hat: 0.6, openhat: 0.4, clap: 0.2, shaker: 0.8, bass: 0.4, chords: 0.5, pad: 1 }, enter: { kick: 0, hat: 0.25, openhat: 0.5, bass: 0.5 } }
    },
    sound: {
      kit: ["house"], chords: ["stab", "organ", "rhodes"], pad: ["strings", "airy"], bass: ["rolling", "pluckSub"],
      lead: ["flute", "glass", "whistle"], pluck: ["kora", "marimba"],
      perc: ["conga", "djembe", "bongo"], bellKind: ["agogo", "cowbell", "clave"], shaker: ["shaker", "tambourine"], log: ["classic"]
    },
    fx: { reverb: { decay: 2.4, send: 0.30 }, delay: { send: 0.30, feedback: 0.34 } }
  };

  // ---- Gqom: raw Durban club music: broken, hard kick, sparse dark synths, tom rolls ----
  house.styles.gqom = {
    stopBeforeChorus: ["kick", "snare", "clap", "bass", "logdrum", "chords", "pluck"],
    name: "Gqom",
    bpm: [122, 128], swing: 0, looseness: 0.5,
    scales: ["minor", "minor", "dorian"],
    progressions: {
      minor:  [[0,0,0,5], [0,0,6,6], [0,3,0,3]],
      dorian: [[0,0,3,3]],
      major:  [[0,0,4,4]]
    },
    chorusProgressions: { minor: [[5,5,0,0], [3,3,0,0]], dorian: [[3,3,0,0]], major: [[4,4,0,0]] },
    preProgressions: { minor: [[3,3,6,6]], dorian: [[3,3,6,6]], major: [[4,4,4,4]] },
    chordsPerBar: [1], chord: { seventh: 0.3, ninth: 0 },
    bassTones: ["root", "root", "root", "fifth"],
    hookStyle: "house", arp: "up",
    sidechain: { harmony: 0.5, bass: 0.3, release: 0.15 },
    gate: { bass: { max: 3 } },
    riffs: { bass: [
      RIFF("x..x ..x. x..x ..x.", "r r r r 5 r"),
      RIFF("x..x ..x. ..x. x...", "r r r 5 r")
    ] },
    groove: {
      kick:  V("x..x ..x. x..x ..x.", "x..x ..x. ..x. x...", "x..x ..x. x... ..x."),   // broken kick
      snare: P(ZERO),
      clap:  V(".... .... x... ..x.", ".... x... .... ..x.", "..x. .... x... ...x"),
      rim:   V("..5. .5.. ..5. .5.."),
      hatSparse: V("x.x. x.x. x.x. x.x."),
      hatFull:   V("x.xx x.xx x.xx xxxx"),
      openhat: V("..x. .... ..x. ...."),
      shaker:  V("x.x. x.x. x.x. x.x."),
      perc:    V("x... ..x. ...x x...", "..x. x... ..x. ...x"),               // tom hits
      bell:    V(".... .... ..4. ...."),
      bassExtra: V(".... ..5. .... ...5"),
      logdrum: P(ZERO),
      chordsVerse:  V("x... .... .... ....", "x... .... ..5. ...."),
      chordsChorus: V("x... .... x... ....", "x..x .... x... ...."),
      pad:     P("x... .... .... ...."),
      pluckVerse:  V(".... .... x... ....", ".... ..x. .... ...."),
      pluckChorus: V("x... ..x. x... ..x.", "x..x ..x. ..x. ...x")
    },
    rules: {
      verse:  { presence: { chords: 0.5, pad: 0.4, pluck: 0.3 } },
      chorus: { presence: { lead: 0.7, pluck: 0.8 } }
    },
    sound: {
      kit: ["gqom"], chords: ["stab", "darkKeys"], pad: ["dark"], bass: ["growl"],
      lead: ["glass", "whistle"], pluck: ["marimba", "kora"],
      perc: ["tom", "conga"], bellKind: ["cowbell", "clave"], shaker: ["tambourine", "shaker"], log: ["wood"]
    },
    fx: { reverb: { decay: 2.0, send: 0.20 }, delay: { send: 0.22, feedback: 0.30 } }
  };
})();
