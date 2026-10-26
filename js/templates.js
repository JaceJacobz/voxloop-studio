// Genre templates are DATA, not code.
//
// A genre (R&B, Afrobeats...) has several STYLES. Every style is its own feel:
// its own tempo range, swing, drum grooves, chord palette, melody character and
// instrument sounds. Pressing "New beat" picks a style (unless you choose one),
// then picks one groove, one chord palette and one set of sounds from it, so two
// beats of the same genre no longer sound alike.
//
// Rhythm patterns are written as 16 characters (one bar of 16th notes):
//   x = always plays      . = never      1..9 = chance in tenths (5 = 50%)
// Spaces are ignored, so write them in groups of four (one group per beat).
//
// To add a genre or a style later, add another entry here.

// ---------- Pattern helpers ----------
function P(text) {
  const chars = String(text).replace(/[\s|]/g, "");
  if (chars.length !== 16) throw new Error("A pattern needs 16 steps, got " + chars.length + ": " + text);
  return [...chars].map(c => (c === "x" ? 1 : c === "." ? 0 : Number(c) / 10));
}
const V = (...texts) => texts.map(P);     // a list of pattern variants

// ---------- Tracks (shared by every genre) ----------
// Row order on screen, top to bottom.
const TRACK_ORDER = [
  "kick", "snare", "clap", "rim",            // drums
  "hat", "openhat",                          // hi-hats
  "shaker", "perc", "bell",                  // percussion
  "bass", "logdrum",                         // low end
  "chords", "pad", "pluck", "lead"           // harmony / melody
];

const TRACK_GROUPS = {
  kick: "drums", snare: "drums", clap: "drums", rim: "drums",
  hat: "hats", openhat: "hats",
  shaker: "percussion", perc: "percussion", bell: "percussion",
  bass: "low", logdrum: "low",
  chords: "harmony", pad: "harmony", pluck: "harmony", lead: "harmony"
};

const TRACK_LABELS = {
  kick: "kick", snare: "snare", clap: "clap", rim: "rim",
  hat: "hat", openhat: "open hat",
  shaker: "shaker", perc: "conga", bell: "bell",
  bass: "bass", logdrum: "log drum",
  chords: "chords", pad: "pad", pluck: "pluck", lead: "lead"
};

// Names for the lock buttons (one per group of rows)
const TRACK_GROUP_LABELS = {
  drums: "Drums", hats: "Hats", percussion: "Percussion", low: "Low end", harmony: "Harmony"
};

// Names for the key pickers (value = number of semitones above C)
const ROOT_LABELS = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"];
const SCALE_LABELS = { minor: "Minor", dorian: "Dorian", major: "Major" };

// Tracks that play pitched notes (they follow the key and the chords)
const TONAL_TRACKS = ["bell", "bass", "logdrum", "chords", "pad", "pluck", "lead"];

// ---------- Song structures ----------
// A structure is a list of [section, bars]. "loop" is the old 4 / 8 bar loop.
const STRUCTURES = {
  full: {
    name: "Full song",
    sections: [
      ["intro", 4], ["verse", 8], ["pre", 4], ["chorus", 8],
      ["verse", 8], ["pre", 4], ["chorus", 8],
      ["bridge", 4], ["chorus", 8], ["outro", 4]
    ]
  },
  short: {
    name: "Short song (hook first)",
    sections: [
      ["intro", 4], ["chorus", 8], ["verse", 8], ["pre", 4],
      ["chorus", 8], ["outro", 4]
    ]
  },
  loop: { name: "Loop (4 / 8 bars)", loop: true }
};

const SECTION_LABELS = {
  intro: "Intro", verse: "Verse", pre: "Pre-chorus", chorus: "Chorus", bridge: "Bridge", outro: "Outro"
};

// How each kind of section behaves (the same for every genre; a style can override parts).
//   presence : chance that each track plays in this kind of section. It is rolled once,
//              and a later verse / chorus can only ADD tracks (like a producer would).
//   enter    : a track only starts after this fraction of the section (0.5 = halfway)
//   exit     : a track stops after this fraction of the section
//   fill     : last bar gets a drum fill      endBuild : last bar is a riser + snare roll
//   riser    : sweep noise during the last 2 bars
//   sec      : bus levels in dB (harmony / drums). Verses sit lower to leave room for a voice.
const SECTION_RULES = {
  intro: {
    presence: { kick: .4, snare: 0, clap: 0, rim: .3, hat: .6, openhat: 0, shaker: .4, perc: 0, bell: .6,
                bass: .5, logdrum: 0, chords: 1, pad: 1, pluck: .6, lead: 0 },
    enter:    { kick: .5, hat: .25, shaker: .25, rim: .5, bass: .5 },
    fill: true, sec: { harm: -1.5, drums: -3 }, dyn: .85
  },
  verse: {
    presence: { kick: 1, snare: 1, clap: .7, rim: .6, hat: 1, openhat: 0, shaker: .7, perc: .4, bell: .25,
                bass: 1, logdrum: .5, chords: 1, pad: .6, pluck: .5, lead: 0 },
    fill: true, sec: { harm: -2.5, drums: -1 }, dyn: .92
  },
  pre: {
    presence: { kick: 1, snare: 1, clap: .8, rim: .5, hat: 1, openhat: .5, shaker: .8, perc: .6, bell: .4,
                bass: 1, logdrum: .6, chords: 1, pad: 1, pluck: .85, lead: .8 },
    endBuild: true, riser: true, sec: { harm: -1, drums: -.5 }, dyn: .96
  },
  chorus: {
    presence: { kick: 1, snare: 1, clap: 1, rim: .5, hat: 1, openhat: 1, shaker: 1, perc: .8, bell: .7,
                bass: 1, logdrum: .8, chords: 1, pad: 1, pluck: .5, lead: 1 },
    fill: true, sec: { harm: 0, drums: 0 }, dyn: 1
  },
  bridge: {
    presence: { kick: .6, snare: .6, clap: .3, rim: .5, hat: .7, openhat: 0, shaker: .5, perc: .6, bell: .7,
                bass: .8, logdrum: .4, chords: 1, pad: 1, pluck: .8, lead: .85 },
    enter:    { kick: .5, snare: .5, hat: .25, perc: .5 },
    endBuild: true, riser: true, sec: { harm: -1.5, drums: -1.5 }, dyn: .9
  },
  outro: {
    presence: { kick: .7, snare: .5, clap: .3, rim: .4, hat: .8, openhat: 0, shaker: .5, perc: .3, bell: .5,
                bass: .8, logdrum: .3, chords: 1, pad: 1, pluck: .5, lead: .8 },
    exit:     { kick: .5, snare: .5, clap: .5, hat: .75, shaker: .75, perc: .5, bass: .75 },
    sec: { harm: -1, drums: -2 }, dyn: .85
  }
};

const TEMPLATES = {

  // =====================================================================
  afrobeats: {
    name: "Afrobeats",
    styleOrder: ["smooth", "afropop"],

    logdrum: { tones: [0, 0, 1, 2] },            // chord tone: 0 root, 1 third, 2 fifth
    // How long pitched notes ring, in 16th-note steps (fixed = always, max = up to)
    gate: { bell: {max: 1}, bass: {max: 4}, logdrum: {max: 2}, chords: {max: 2},
            pad: {fixed: 16}, pluck: {max: 2}, lead: {max: 8} },

    // Stereo position of each track: -1 = hard left, 0 = centre, 1 = hard right
    pan: {
      kick: 0, snare: 0, clap: 0, rim: -0.3, hat: 0.3, openhat: -0.2,
      shaker: -0.4, perc: 0.45, bell: 0.3, bass: 0, logdrum: 0.15,
      chords: -0.1, pad: 0, pluck: -0.3, lead: 0.2
    },

    // Sidechain: the harmony bus and the bass dip each time the kick hits.
    sidechain: { harmony: 0.4, bass: 0.2, release: 0.18 },

    // The plain 4 / 8 bar loop (structure "loop"): chance each track plays per bar of a phrase,
    // plus drum fills for the last bar and tracks that always hit on beat 1 of a new phrase.
    arrangement: {
      presence: {
        kick:    [1, 1, 1, 1],
        snare:   [1, 1, 1, 1],
        clap:    [0.5, 1, 1, 1],
        rim:     [0.6, 1, 0.8, 1],
        hat:     [0.8, 1, 1, 1],
        openhat: [0, 0.6, 0.6, 1],
        shaker:  [1, 1, 1, 1],
        perc:    [0.4, 0.8, 1, 1],
        bell:    [0, 0.5, 0.8, 0.8],
        bass:    [1, 1, 1, 1],
        logdrum: [0, 0.5, 1, 1],
        chords:  [1, 1, 1, 1],
        pad:     [0.8, 0.5, 0.8, 0.5],
        pluck:   [0.3, 0.6, 1, 1],
        lead:    [0, 0, 0, 0]
      },
      fills: [
        { snare: P("....  x...  ..66  x7xx"),
          hat:   P("x.6.  x.6.  x...  ...."),
          perc:  P("....  ....  ..88  8888"),
          openhat: P("....  ....  ....  ...8") },
        { perc:  P("....  ....  x.x.  xxxx"),
          snare: P("....  x...  ....  x..6"),
          kick:  P("x...  ..6.  .8..  ..86"),
          shaker: P("9797  9797  xxxx  xxxx") }
      ],
      accent: ["kick", "openhat"]
    },

    // Starting volume of each track in dB (0 is loudest). The auto-mix fine-tunes these.
    mix: {
      kick: -9, snare: -6.3, clap: -9.1, rim: -13.1, hat: -22.2, openhat: -29,
      shaker: -13.4, perc: -15.7, bell: -11.4, bass: -7.1, logdrum: -12.1,
      chords: -10.7, pad: -22.8, pluck: -14.8, lead: -13
    },

    // Target balance: how loud each track's hits should be compared with the kick, in dB.
    balance: {
      kick: 0, snare: -3, clap: -9, rim: -13, hat: -15, openhat: -16,
      shaker: -14, perc: -10, bell: -15, bass: -1, logdrum: -3,
      chords: -6, pad: -12, pluck: -8, lead: -7
    },

    // How each track is "played by a human".
    //   velocity  : normal hit strength (0 to 1)      variation : random +/- added to every hit
    //   ghost     : hits with probability under 0.5 are ghost notes, played at this fraction
    //   accent    : optional 16 values that scale the velocity per step
    //   timingMs  : random +/- milliseconds early or late      strumMs : (chords) gap between notes
    humanize: {
      kick:    { velocity: 0.95, variation: 0.06, ghost: 0.7,  timingMs: 4 },
      snare:   { velocity: 0.90, variation: 0.08, ghost: 0.45, timingMs: 6 },
      clap:    { velocity: 0.80, variation: 0.10, ghost: 0.5,  timingMs: 6 },
      rim:     { velocity: 0.70, variation: 0.12, ghost: 0.6,  timingMs: 8 },
      hat: {
        velocity: 0.70, variation: 0.10, ghost: 0.6, timingMs: 8,
        accent: [1,.5,.8,.5, 1,.5,.8,.5, 1,.5,.8,.5, 1,.5,.8,.5]
      },
      openhat: { velocity: 0.70, variation: 0.10, ghost: 0.7,  timingMs: 8 },
      shaker: {
        velocity: 0.80, variation: 0.10, ghost: 0.7, timingMs: 10,
        accent: [1,.55,.8,.55, 1,.55,.8,.55, 1,.55,.8,.55, 1,.55,.8,.55]
      },
      perc:    { velocity: 0.75, variation: 0.15, ghost: 0.6,  timingMs: 12 },
      bell:    { velocity: 0.70, variation: 0.12, ghost: 0.6,  timingMs: 8 },
      bass:    { velocity: 0.90, variation: 0.06, ghost: 0.7,  timingMs: 5 },
      logdrum: { velocity: 0.85, variation: 0.10, ghost: 0.6,  timingMs: 8 },
      chords:  { velocity: 0.70, variation: 0.10, ghost: 0.7,  timingMs: 10, strumMs: 6 },
      pad:     { velocity: 0.60, variation: 0.05, ghost: 1,    timingMs: 0 },
      pluck:   { velocity: 0.75, variation: 0.15, ghost: 0.6,  timingMs: 10 },
      lead:    { velocity: 0.78, variation: 0.08, ghost: 1,    timingMs: 8 }
    },

    styles: {
      // ---- Smooth Afrobeats: warm, bouncy, melodic (the Wizkid / Burna Boy / Tems lane) ----
      // The feel comes from the "3-3-2" count: kicks, rim and keys land on steps 0, 3, 6 | 8, 11, 14 instead of
      // straight on the beat, the congas play the 3-2 clave (0, 3, 6, 10, 12), the backbeat is a snare layered
      // with a clap, and the hats and shaker swing. Underneath: a round (not harsh) bass and a warm Rhodes.
      smooth: {
        name: "Smooth Afrobeats",
        bpm: [94, 106], swing: 0.17, looseness: 1,
        scales: ["minor", "dorian", "minor", "major"],
        progressions: {
          minor:  [[0,5,2,6], [0,6,5,6], [0,3,5,6], [0,6], [0,5,6,4]],
          dorian: [[0,3,0,3], [0,6,3,0], [0,3,6,3]],
          major:  [[0,4,5,3], [0,5,3,4], [0,3,4,3], [0,4,1,4]]
        },
        chorusProgressions: {
          minor:  [[5,6,0,0], [3,5,6,0], [5,2,6,0], [3,6,0,0]],
          dorian: [[3,6,0,0], [3,0,6,0]],
          major:  [[3,4,0,5], [5,3,0,4], [3,4,5,0]]
        },
        preProgressions: {
          minor:  [[3,5,6,6], [5,6,5,6], [3,6,3,6]],
          dorian: [[3,6,3,6]],
          major:  [[3,4,3,4], [5,3,4,4]]
        },
        chordsPerBar: [1],
        chord: { seventh: 0.6, ninth: 0.3 },
        bassTones: ["root","root","fifth","octave","root","fifth"],
        hookStyle: "afro", arp: "up",
        sidechain: { harmony: 0.25, bass: 0.1, release: 0.2 },        // a soft pump: warm, not punchy
        gate: { bass: {max: 3}, chords: {max: 2}, pluck: {max: 1}, logdrum: {max: 2} },
        groove: {
          // kick: the tresillo (3-3-2) with a few maybe-hits, so no two beats sit the same
          kick:    V("x..5 ..x. x..4 ..5.", "x... ..x. ..x. ...5", "x..4 ..x. x... ..x5", "x... ..x. ..x. .x.."),
          // snare + clap together on 2 and 4, with a ghost note leading into the next beat
          snare:   V(".... x... ...3 x..2", ".... x..2 .... x.3.", ".... x... ..3. x..."),
          clap:    V(".... x... .... x...", ".... 8... .... x..4"),
          // rim "tok" on the syncopations
          rim:     V("..5. .5.. ..5. .5..", "...5 ..5. 5..5 ..5.", ".5.. ..5. .5.. ..5."),
          hatSparse: V("x.6. x.6. x.6. x.67", "x.x. x.x. x.x. x.x6", "x.5x x.5. x.5x x.5."),
          hatFull:   V("x6x6 x6x6 x6x6 x6x7", "x6x6 x7x6 x6x6 x7x7", "x5x5 x6x5 x5x5 x6x7"),
          openhat: V(".... .... ..4. ..7.", ".... .... .... ..8.", "..3. .... ..4. ..6."),
          shaker:  V("x8x8 x8x8 x8x8 x8x8", "x7x8 x7x8 x7x8 x7x9"),
          // congas on the 3-2 clave (steps 0, 3, 6, 10, 12) with ghost notes between
          perc:    V("x..x ..x. ..x. x...", "x..x 4.x. ..x. x.4.", "5..x ..x4 ..x. x..5"),
          bell:    V("7... ..7. ..7. ....", ".... ..7. .... ..7.", "7..7 .... ..7. ...."),
          bassExtra: V(".... .... ..4. ..5.", ".... ...4 .... ..5.", ".... .... .... ..6."),
          logdrum: V(".... ..4. .... ..4.", "...4 .... ..5. ....", ".... .... .... ...5"),
          // keys: offbeat stabs (verse), then a fuller 3-3-2 comp in the chorus
          chordsVerse:  V("..8. ..6. ..8. ..5.", "...8 ..6. ...8 ..5.", "..8. ...6 ..8. ...5"),
          chordsChorus: V("x..8 ..8. ..x. .6..", "x..8 ..x. x..8 ..6.", "..x. x..8 ..x. .8.."),
          pad:     P("6... .... .... ...."),
          // plucked "Afro guitar" figure on the same 3-3-2 count
          pluckVerse:  V("x..5 ..x. 5..5 ..4.", "x... ..x. ..5. 5..5", "5..x ..5. x... ..4."),
          pluckChorus: V("x..x ..x. x..x ..x.", "x..x ..x. x..5 ..x5", "x..x ..5. x..x ..x.")
        },
        sound: {
          kit: ["soft", "vintage", "punch"], chords: ["rhodes", "darkKeys", "rhodes"], pad: ["warm", "airy"],
          bass: ["softSub", "sub808"], lead: ["glass", "vibes", "kalimba"], pluck: ["pluckSaw", "kalimba", "bellPluck"]
        },
        fx: { reverb: { decay: 2.1, send: 0.26 }, delay: { send: 0.22, feedback: 0.3 } }
      },

      afropop: {
        name: "Afropop",
        bpm: [98, 108], swing: 0.12, looseness: 1,
        scales: ["minor", "dorian", "major"],
        // Chord progressions as scale degrees (0 = first note of the scale).
        // progressions = verse palette, chorusProgressions = chorus palette (a lift),
        // preProgressions = tension chords just before the chorus.
        progressions: {
          minor:  [[0,5,2,6], [0,6,5,6], [0,3,5,6], [0,5], [0,6]],
          dorian: [[0,3,0,3], [0,6,3,0], [0,3]],
          major:  [[0,4,5,3], [0,5,3,4], [0,3,4,3], [0,4]]
        },
        chorusProgressions: {
          minor:  [[5,6,0,0], [3,5,6,0], [5,2,6,0]],
          dorian: [[3,6,0,0], [3,0,6,0]],
          major:  [[3,4,0,5], [5,3,0,4], [3,4,5,0]]
        },
        preProgressions: {
          minor:  [[3,5,6,6], [5,6,5,6]],
          dorian: [[3,6,3,6]],
          major:  [[3,4,3,4], [5,3,4,4]]
        },
        chordsPerBar: [1],
        chord: { seventh: 0.3, ninth: 0 },
        bassTones: ["root","root","root","root","fifth","octave"],
        hookStyle: "afro", arp: "up",
        groove: {
          kick:    V("x... ..6. .8.. ..4.", "x... ..5. ..8. .4..", "x..4 ..6. .8.. ...4"),
          snare:   V(".... x..2 ...3 x...", ".... x... ..3. x..2"),
          clap:    null,
          rim:     P(".... .5.. ..5. .4.."),
          hatSparse: V("x.6. x.6. x.6. x.63", "x.x. x.x. x.x. x.x."),
          hatFull:   V("x.66 x.66 x.66 x.66", "x366 x366 x366 x376"),
          openhat: P(".... ..4. .... ..5."),
          shaker:  V("9797 9797 9797 9797", "8686 8686 8686 8686"),
          perc:    V("..5. .4.6 ..5. .4.7", ".... 5.4. ..5. .6.4"),
          bell:    V("7..7 ..7. 7..7 ..7.", "7..7 ..7. .... ..7."),
          bassExtra: P(".... .... .... ..3."),
          logdrum: V("..5. ..5. .5.. 4..5", "...5 ..5. ..5. 5..4"),
          chordsVerse:  V("...8 ...6 ...7 ..5.", "..8. ...6 ..7. ...5"),
          chordsChorus: V("...9 ..8. ...9 ..7.", "..9. ..8. ..9. .6.."),
          pad:     P("6... .... .... ...."),
          pluckVerse:  V("8.5. 6.54 7.5. 6.45", "6.5. ..6. 7.5. ..6."),
          pluckChorus: V("8.8. 6.64 8.7. 6.64", "x.7. 7.7. x.7. 7.76")
        },
        sound: {
          kit: ["punch"], chords: ["rhodes", "wurli"], pad: ["warm"], bass: ["sub808"],
          lead: ["glass", "vibes", "kalimba"], pluck: ["kalimba", "bellPluck"]
        },
        fx: { reverb: { decay: 2.4, send: 0.3 }, delay: { send: 0.2, feedback: 0.3 } }
      }
    }
  },

  // =====================================================================
  rnb: {
    name: "R&B",
    styleOrder: ["slowjam", "trapsoul", "neosoul", "altrnb", "newjack", "poprnb"],

    logdrum: { tones: [0] },
    gate: { bell: {max: 2}, bass: {max: 8}, logdrum: {max: 2}, chords: {max: 6},
            pad: {fixed: 16}, pluck: {max: 3}, lead: {max: 8} },

    pan: {
      kick: 0, snare: 0, clap: 0, rim: -0.3, hat: 0.25, openhat: -0.25,
      shaker: 0.35, perc: -0.4, bell: 0.3, bass: 0, logdrum: 0,
      chords: 0, pad: 0, pluck: -0.3, lead: 0.25    // lead off-centre: the middle is for the vocal
    },

    sidechain: { harmony: 0.5, bass: 0.15, release: 0.25 },

    arrangement: {
      presence: {
        kick:    [1, 1, 1, 1],
        snare:   [1, 1, 1, 1],
        clap:    [1, 1, 1, 1],
        rim:     [0.5, 0.5, 0.8, 0.8],
        hat:     [0.7, 1, 1, 1],
        openhat: [0, 0.5, 0.5, 0.8],
        shaker:  [0.5, 1, 1, 1],
        perc:    [0, 0.5, 0.5, 0.8],
        bell:    [0, 0, 0.5, 0.5],
        bass:    [1, 1, 1, 1],
        logdrum: [0, 0, 0, 0],
        chords:  [1, 1, 1, 1],
        pad:     [1, 1, 1, 1],
        pluck:   [0, 0.6, 0.8, 1],
        lead:    [0, 0, 0, 0]
      },
      fills: [
        { hat:   P("xxxx  xxxx  xxxx  xxxx"),
          snare: P("....  x...  ....  x.55"),
          clap:  P("....  9...  ....  9.55") },
        { kick:  P("x..3  ...5  ..8.  ..77"),
          openhat: P("....  ....  ....  ..8."),
          perc:  P("....  ....  ....  6666") }
      ],
      accent: ["kick", "openhat"]
    },

    mix: {
      kick: -10, snare: -9.6, clap: -5.9, rim: -9.2, hat: -24.2, openhat: -31.3,
      shaker: -11.8, perc: -13.2, bell: -16, bass: -6.3, logdrum: -34,
      chords: -10.9, pad: -22.7, pluck: -13, lead: -14
    },

    balance: {
      kick: 0, snare: -6, clap: -4, rim: -14, hat: -16, openhat: -18,
      shaker: -18, perc: -14, bell: -18, bass: -1, logdrum: null,
      chords: -5, pad: -10, pluck: -8, lead: -7
    },

    humanize: {
      kick:    { velocity: 0.90, variation: 0.06, ghost: 0.7,  timingMs: 6 },
      snare:   { velocity: 0.85, variation: 0.08, ghost: 0.4,  timingMs: 9 },
      clap:    { velocity: 0.85, variation: 0.08, ghost: 0.5,  timingMs: 9 },
      rim:     { velocity: 0.60, variation: 0.12, ghost: 0.6,  timingMs: 10 },
      hat: {
        velocity: 0.70, variation: 0.12, ghost: 0.6, timingMs: 12,
        accent: [1,.45,.7,.45, .9,.45,.7,.5, .9,.45,.7,.45, .9,.5,.7,.6]
      },
      openhat: { velocity: 0.60, variation: 0.10, ghost: 0.7,  timingMs: 10 },
      shaker:  { velocity: 0.60, variation: 0.12, ghost: 0.7,  timingMs: 12 },
      perc:    { velocity: 0.60, variation: 0.15, ghost: 0.6,  timingMs: 14 },
      bell:    { velocity: 0.50, variation: 0.12, ghost: 0.6,  timingMs: 10 },
      bass:    { velocity: 0.90, variation: 0.05, ghost: 0.7,  timingMs: 7 },
      logdrum: { velocity: 0.70, variation: 0.10, ghost: 0.6,  timingMs: 10 },
      chords:  { velocity: 0.65, variation: 0.10, ghost: 0.7,  timingMs: 14, strumMs: 16 },
      pad:     { velocity: 0.55, variation: 0.05, ghost: 1,    timingMs: 0 },
      pluck:   { velocity: 0.65, variation: 0.15, ghost: 0.6,  timingMs: 14 },
      lead:    { velocity: 0.72, variation: 0.08, ghost: 1,    timingMs: 12 }
    },

    styles: {

      // ---- Slow jam: late-night, lots of space, silky Rhodes, long 808 ----
      slowjam: {
        name: "Slow Jam",
        bpm: [62, 72], swing: 0.22, looseness: 1,
        scales: ["minor", "minor", "dorian", "major", "major"],
        progressions: {
          minor:  [[0,3,6,2], [0,5,2,6], [0,2,3,6], [0,6,5,6]],
          dorian: [[0,3,0,3], [0,3,6,3], [1,4,0,0]],
          major:  [[1,4,0,5], [0,5,1,4], [3,2,1,0], [0,2,3,4]]
        },
        chorusProgressions: {
          minor:  [[5,6,0,0], [3,6,2,5], [5,2,6,0]],
          dorian: [[3,6,0,0], [3,0,6,0], [1,3,6,0]],
          major:  [[3,4,2,5], [5,3,0,4], [3,2,1,4]]
        },
        preProgressions: {
          minor:  [[3,5,6,6], [5,6,5,6], [3,4,5,6]],
          dorian: [[1,3,4,6], [3,6,3,6]],
          major:  [[1,4,1,4], [3,4,3,4]]
        },
        chordsPerBar: [1, 1, 2],
        chord: { seventh: 1, ninth: 0.65 },
        bassTones: ["root","root","root","root","root","fifth"],
        hookStyle: "long", arp: "updown",
        gate: { bass: {max: 10}, chords: {max: 8} },
        groove: {
          kick:    V("x..3 ...5 ..8. ...2", "x... ..5. ..x. .3..", "x..5 ..3. .5x. ...."),
          snare:   V(".... x..1 .... x..2", ".... x.3. ..2. x..3"),
          clap:    null,
          rim:     P(".... ..3. .... ..3."),
          hatSparse: V("x.7. x.7. x.7. x.7.", "x... x.6. x... x.6."),
          hatFull:   V("x474 x475 x474 x576", "x.7. x.74 x.7. x.75"),
          openhat: P(".... ..3. .... ..5."),
          shaker:  P("..4. ..4. ..4. ..4."),
          perc:    P(".... ..2. ...2 ...."),
          bell:    P(".... .... .... .2.."),
          bassExtra: P(".... ...3 .... ..3."),
          logdrum: P(".... .... .... ...."),
          chordsVerse:  V("9... ..4. ..5. .3..", "x... .... ..6. ...."),
          chordsChorus: V("x... ..6. x... ..5.", "x... .6.. ..x. .5.."),
          pad:     P("x... .... .... ...."),
          pluckVerse:  V("..5. .4.. 5..4 ..4.", ".... 5... .... 4..."),
          pluckChorus: V("4.5. .45. 4.5. .45.", "x.5. ..5. x.5. ..5.")
        },
        sound: {
          kit: ["soft"], chords: ["rhodes", "wurli"], pad: ["warm", "airy"], bass: ["sub808", "softSub"],
          lead: ["glass", "vibes", "softSaw"], pluck: ["kalimba", "bellPluck"]
        },
        fx: { reverb: { decay: 3.2, send: 0.4 }, delay: { send: 0.25, feedback: 0.32 } }
      },

      // ---- Trap soul: half-time snare, hat rolls, dark keys, gliding 808 ----
      trapsoul: {
        name: "Trap Soul",
        bpm: [64, 76], swing: 0.08, looseness: 0.6,
        scales: ["minor", "minor", "minor", "dorian"],
        progressions: {
          minor:  [[0,5,2,6], [0,3,5,6], [0,0,5,5], [0,6,5,4]],
          dorian: [[0,3,0,3], [0,6,3,0]],
          major:  [[0,4,5,3], [0,5,3,4]]
        },
        chorusProgressions: {
          minor:  [[5,6,0,0], [0,5,3,6], [3,5,0,6]],
          dorian: [[3,6,0,0], [3,0,6,0]],
          major:  [[3,4,0,5], [5,3,0,4]]
        },
        preProgressions: {
          minor:  [[3,3,5,6], [5,6,5,6]],
          dorian: [[1,3,1,3]],
          major:  [[3,4,3,4]]
        },
        chordsPerBar: [1],
        chord: { seventh: 0.6, ninth: 0.3 },
        bassTones: ["root","root","root","root","root","octave"],
        hookStyle: "sparse", arp: "up",
        hatRoll: { prob: 0.4, steps: [7, 11, 14, 15], kind: "triplet" },
        sidechain: { harmony: 0.35, bass: 0.1, release: 0.22 },
        gate: { bass: {max: 12} },
        groove: {
          kick:    V("x..4 ..x. .... 4.5.", "x... ...x ..5. ....", "x.5. ..x. 5... ..4."),
          snare:   V(".... .... x... ....", ".... .... x... ..3.", ".... x... .... x..."),
          clap:    null,
          rim:     P(".... ..3. .... ..4."),
          hatSparse: V("x.x. x.x. x.x. x.x.", "x.7. x.7. x.7. x.7."),
          hatFull:   V("x5x5 x5x7 x5x5 x5x8", "x.xx x.x. x.xx x.xx"),
          openhat: P(".... ..3. .... ..5."),
          shaker:  P(".... .... .... ...."),
          perc:    P(".... .... ...3 ...."),
          bell:    V("x... .... ..5. ....", "x... ..5. .... .3.."),
          bassExtra: P(".... ...4 .... ..4."),
          logdrum: P(".... .... .... ...."),
          chordsVerse:  V("x... .... .... ....", "x... .... ..5. ...."),
          chordsChorus: V("x... .... x... ....", "x... ..6. .... ..5."),
          pad:     P("x... .... .... ...."),
          pluckVerse:  V("5... 5... 5... 5...", "x.5. .... x.5. ...."),
          pluckChorus: V("x.x. x.x. x.x. x.x.", "5.5. 5.5. 5.5. 5.5.")
        },
        sound: {
          kit: ["boom", "punch"], chords: ["darkKeys", "rhodes"], pad: ["dark", "airy"], bass: ["glide808"],
          lead: ["glass", "softSaw"], pluck: ["bellPluck", "kalimba"]
        },
        fx: { reverb: { decay: 3.6, send: 0.45 }, delay: { send: 0.35, feedback: 0.38 } }
      },

      // ---- Neo-soul: loose behind-the-beat drums, jazzy 9th chords, moving harmony ----
      neosoul: {
        name: "Neo-Soul",
        bpm: [76, 90], swing: 0.30, looseness: 1.5,
        scales: ["dorian", "dorian", "minor", "major"],
        progressions: {
          minor:  [[0,3,6,2], [0,2,3,6], [5,6,0,3]],
          dorian: [[0,3,0,3], [1,4,0,0], [0,3,6,3], [0,6,3,2]],
          major:  [[1,4,0,5], [0,5,1,4], [0,2,3,4]]
        },
        chorusProgressions: {
          minor:  [[3,6,2,5], [5,3,6,0]],
          dorian: [[3,4,0,0], [3,6,0,0], [1,3,6,0]],
          major:  [[3,2,1,4], [3,4,2,5]]
        },
        preProgressions: {
          minor:  [[3,4,5,6]],
          dorian: [[1,4,1,4], [3,4,3,4]],
          major:  [[1,4,1,4]]
        },
        chordsPerBar: [2, 2, 1],
        chord: { seventh: 1, ninth: 0.85 },
        bassTones: ["root","root","fifth","third","seventh","root"],
        hookStyle: "jazzy", arp: "broken",
        sidechain: { harmony: 0.25, bass: 0.1, release: 0.2 },
        gate: { bass: {max: 4}, chords: {max: 4} },
        groove: {
          kick:    V("x..5 ..x. .3.5 ..3.", "x.3. ...x ..5. .3..", "x... .5.x ..x. ...4"),
          snare:   V(".... x..3 ..2. x.3.", ".... x.2. 3.2. x..3"),
          clap:    P(".... 4... .... 4..."),
          rim:     P(".... ..5. .... ..4."),
          hatSparse: V("x.6. x.6. x.6. x.6.", "x.4. x.7. x.4. x.7."),
          hatFull:   V("x354 x364 x354 x365", "x4.5 x4.6 x4.5 x56."),
          openhat: P(".... ...3 .... ..4."),
          shaker:  P("...3 ..5. ...3 ..5."),
          perc:    P(".... .3.5 ..3. 5..3"),
          bell:    P(".... .... .3.. ...."),
          bassExtra: P(".... ..4. .... .4.5"),
          logdrum: P(".... .... .... ...."),
          chordsVerse:  V("9... .3.. ..5. ..3.", "8... ..5. .6.. ...3"),
          chordsChorus: V("x... .5.. ..x. .5..", "x... ..6. 7... .5.."),
          pad:     P("x... .... .... ...."),
          pluckVerse:  V(".... 5... ..4. .3..", ".... ..5. 4... ..3."),
          pluckChorus: V("4.5. .4.5 4.5. .4.5", "5.4. 5.4. 5.4. .5.4")
        },
        sound: {
          kit: ["tight", "soft"], chords: ["wurli", "rhodes"], pad: ["airy", "warm"], bass: ["softSub", "sub808"],
          lead: ["vibes", "glass"], pluck: ["kalimba", "bellPluck"]
        },
        fx: { reverb: { decay: 2.2, send: 0.28 }, delay: { send: 0.2, feedback: 0.3 } }
      },

      // ---- Alt R&B: sparse, moody, wide reverb, odd kick placement ----
      altrnb: {
        name: "Alt R&B",
        bpm: [60, 72], swing: 0.10, looseness: 1,
        scales: ["minor", "minor", "dorian"],
        progressions: {
          minor:  [[0,5,2,6], [0,3,5,6], [0,6,5,6], [5,6,0,0]],
          dorian: [[0,3,0,3], [0,6,3,0]],
          major:  [[0,5,1,4], [0,4,5,3]]
        },
        chorusProgressions: {
          minor:  [[3,6,2,5], [5,6,0,3], [0,5,3,6]],
          dorian: [[3,6,0,0], [3,0,6,0]],
          major:  [[3,4,0,5], [5,3,0,4]]
        },
        preProgressions: {
          minor:  [[3,4,5,6], [5,5,6,6]],
          dorian: [[1,3,1,3]],
          major:  [[3,4,3,4]]
        },
        chordsPerBar: [1],
        chord: { seventh: 0.8, ninth: 0.6 },
        bassTones: ["root","root","root","root","octave","fifth"],
        hookStyle: "sparse", arp: "updown",
        sidechain: { harmony: 0.3, bass: 0.1, release: 0.3 },
        gate: { bass: {max: 12} },
        groove: {
          kick:    V("x... .... ...x ..5.", "x.5. .... ..x. ....", "x... ..4. .... x..5"),
          snare:   V(".... .... x... ....", ".... x... .... x...", ".... .... x... ..3."),
          clap:    null,
          rim:     P(".... ..3. ...4 ...."),
          hatSparse: V("x... ..5. x... ..4.", ".... x.5. .... x.4."),
          hatFull:   V("x.5. x.55 x.5. x.56", "x.x. ..5. x.x. 5.5."),
          openhat: P(".... ...4 .... ...4"),
          shaker:  P(".... .... .... ...."),
          perc:    P(".... ..3. .... 3..."),
          bell:    P("x... .... .... ..4."),
          bassExtra: P(".... .... ..3. ...3"),
          logdrum: P(".... .... .... ...."),
          chordsVerse:  V("x... .... .... ....", "x... .... ..4. ...."),
          chordsChorus: V("x... .... x... ....", "x... ..5. x... .5.."),
          pad:     P("x... .... .... ...."),
          pluckVerse:  V(".... .... 5... ....", "5... .... .... 4..."),
          pluckChorus: V("5... 5... 5... 5...", "x... ..5. x... ..5.")
        },
        sound: {
          kit: ["boom", "soft"], chords: ["darkKeys", "rhodes", "vibes"], pad: ["dark", "airy"], bass: ["glide808", "sub808"],
          lead: ["glass", "softSaw"], pluck: ["bellPluck", "kalimba"]
        },
        fx: { reverb: { decay: 4.2, send: 0.55 }, delay: { send: 0.4, feedback: 0.4 } }
      },

      // ---- 90s swing: hard swing, snappy snare + clap, bouncy synth bass ----
      newjack: {
        name: "90s Swing",
        bpm: [88, 102], swing: 0.34, looseness: 0.8,
        scales: ["major", "dorian", "minor"],
        progressions: {
          minor:  [[0,5,2,6], [0,3,6,2]],
          dorian: [[0,3,0,3], [1,4,0,0], [0,3,6,3]],
          major:  [[1,4,0,5], [0,5,1,4], [0,4,5,3], [0,2,3,4]]
        },
        chorusProgressions: {
          minor:  [[5,6,0,0], [3,6,2,5]],
          dorian: [[3,4,0,0], [3,6,0,0]],
          major:  [[3,4,2,5], [5,3,0,4], [3,2,1,4]]
        },
        preProgressions: {
          minor:  [[3,4,5,6]],
          dorian: [[1,4,1,4]],
          major:  [[1,4,1,4], [3,4,3,4]]
        },
        chordsPerBar: [1, 2],
        chord: { seventh: 0.9, ninth: 0.5 },
        bassTones: ["root","root","root","fifth","octave","root"],
        hookStyle: "bouncy", arp: "up",
        sidechain: { harmony: 0.15, bass: 0.05, release: 0.15 },
        gate: { bass: {max: 3}, chords: {max: 2} },
        groove: {
          kick:    V("x... ..x. ..x. .5..", "x..4 ..x. ..x. ...5", "x.5. ..x. x... ..5."),
          snare:   V(".... x..2 ..2. x..3", ".... x... ...3 x..."),
          clap:    null,
          rim:     P(".... ..3. .... ...."),
          hatSparse: V("x.x. x.x. x.x. x.x.", "x.xx x.x. x.xx x.x."),
          hatFull:   V("x5x5 x5x5 x5x5 x5x6", "xx5x xx5x xx5x xx5x"),
          openhat: P(".... ..5. .... ..6."),
          shaker:  P("5.8. 5.8. 5.8. 5.8."),
          perc:    P(".... ..3. ...5 ...3"),
          bell:    P(".... .... .... ...."),
          bassExtra: P(".... ..6. ..5. ...6"),
          logdrum: P(".... .... .... ...."),
          chordsVerse:  V("9... ..5. 9... ..5.", "8..5 ..6. 8..5 ...6"),
          chordsChorus: V("x..5 ..x. x..5 ..x.", "x.x. ..x. x.x. .x.."),
          pad:     P("x... .... .... ...."),
          pluckVerse:  V("..5. ..5. ..5. ..5.", "5... ..5. 5... ..5."),
          pluckChorus: V("5.5. 5.5. 5.5. 5.5.", "x.5. x.5. x.5. x.5.")
        },
        sound: {
          kit: ["vintage", "punch"], chords: ["wurli", "organ"], pad: ["warm"], bass: ["moog", "sub808"],
          lead: ["softSaw", "glass"], pluck: ["pluckSaw", "kalimba"]
        },
        fx: { reverb: { decay: 1.8, send: 0.22 }, delay: { send: 0.15, feedback: 0.25 } }
      },

      // ---- Pop R&B: straighter, bigger chorus, bright keys, pumping ----
      poprnb: {
        name: "Pop R&B",
        bpm: [92, 110], swing: 0.06, looseness: 0.7,
        scales: ["major", "major", "minor", "dorian"],
        progressions: {
          minor:  [[0,5,2,6], [0,3,5,6], [0,6,5,6]],
          dorian: [[0,3,0,3], [0,6,3,0]],
          major:  [[0,4,5,3], [0,5,3,4], [0,3,4,3], [1,4,0,5]]
        },
        chorusProgressions: {
          minor:  [[5,6,0,0], [5,2,6,0], [3,5,6,0]],
          dorian: [[3,6,0,0], [3,0,6,0]],
          major:  [[3,4,0,5], [5,3,0,4], [3,4,2,5]]
        },
        preProgressions: {
          minor:  [[3,5,6,6], [5,6,5,6]],
          dorian: [[3,6,3,6]],
          major:  [[1,4,1,4], [3,4,3,4], [5,3,4,4]]
        },
        chordsPerBar: [1],
        chord: { seventh: 0.5, ninth: 0.3 },
        bassTones: ["root","root","root","root","fifth","octave"],
        hookStyle: "anthem", arp: "up",
        sidechain: { harmony: 0.45, bass: 0.2, release: 0.2 },
        groove: {
          kick:    V("x... ..3. x... ..4.", "x... x... x... x.5.", "x..4 .... x.5. ...."),
          snare:   V(".... x... .... x...", ".... x... .... x.3."),
          clap:    null,
          rim:     P("..3. ..3. ..3. ..3."),
          hatSparse: V("x.x. x.x. x.x. x.x.", "..x. ..x. ..x. ..x."),
          hatFull:   V("x5x5 x5x5 x5x5 x5x7", "x.x. x.x. x.x. x.xx"),
          openhat: P("..6. ..6. ..6. ..6."),
          shaker:  P("x5x5 x5x5 x5x5 x5x5"),
          perc:    P(".... ..3. ...3 ...."),
          bell:    P(".... .... .... ...."),
          bassExtra: P(".... ...5 .... ..5."),
          logdrum: P(".... .... .... ...."),
          chordsVerse:  V("x... .... ..6. ....", "x... .... .... ...."),
          chordsChorus: V("x... ..6. x... ..6.", "x... x... x... x..."),
          pad:     P("x... .... .... ...."),
          pluckVerse:  V("x.5. x.5. x.5. x.5.", "5.5. .... 5.5. ...."),
          pluckChorus: V("x.x. x.x. x.x. x.x.", "x.5. x.5. x.5. x.5.")
        },
        sound: {
          kit: ["punch", "tight"], chords: ["rhodes", "vibes", "wurli"], pad: ["airy", "warm"], bass: ["sub808", "softSub"],
          lead: ["glass", "softSaw", "vibes"], pluck: ["bellPluck", "pluckSaw"]
        },
        fx: { reverb: { decay: 2.4, send: 0.3 }, delay: { send: 0.3, feedback: 0.34 } }
      }
    }
  }
};

// Lets the same file be tested in Node. Ignored in the browser.
if (typeof module !== "undefined") {
  module.exports = {
    TEMPLATES, TRACK_ORDER, TRACK_GROUPS, TRACK_LABELS, TRACK_GROUP_LABELS,
    ROOT_LABELS, SCALE_LABELS, TONAL_TRACKS, STRUCTURES, SECTION_LABELS, SECTION_RULES, P, V
  };
}
