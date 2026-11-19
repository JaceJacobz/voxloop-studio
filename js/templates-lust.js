// =====================================================================
// AFRO-LUST: Afrobeats rebuilt for close, slow, late-night music.
//
// What makes it its own genre (and not slow Afrobeats):
//   - SLOW and ROLLING: 85 to 100 BPM, a deep swing, and the backbeat (rim / soft snare) played a little BEHIND the beat
//     (humanize.lateMs), so it leans back like a body winding slowly.
//   - SPARSE DRUMS: a soft round kick with space around it, few and uneven hats, no loud snare. A muted rim and a very
//     quiet clap carry the backbeat. The drums come from samples/afrolust/ (soft, round one-shots).
//   - AFRO PERCUSSION KEPT LOW: congas, tumba and shaker on the off-beats, a log drum touch now and then.
//   - THE LOW END IS THE POINT: a long, warm 808 / bass that sits under the kick and slides between notes.
//   - THE SIGNATURE ("the tag"): a HEARTBEAT. The kick and the bass answer each other on steps 0 and 3 of every bar,
//     like a pulse (lub-dub), from the very first bar of the intro. It is in every pack. The muted nylon-guitar lick on
//     top is the same figure in every pack too (it goes away with the Melody switch, the heartbeat does not).
//   - SPACE: long reverb, a soft echo, lots of silence. The song form has a slow intro and a breakdown (bridge) of only
//     bass and percussion.
//   - NO LEAD MELODY by default: the beat is made to be sung on. (Turn the Melody switch on for the guitar lick, and the
//     Melody editor can add a lead.)
//
// Six styles, named for what they are for (the ids keep the old names): Classic (sung) = velvet, Rap (bars) = rap, Airy (soft vocals) = tide,
// Highlife (light) = moonlit, Late Night (dark) = smoke, Slow Wine (dance) = slowwine. Each has its own
// groove DNA, tempo, swing and space. The producer (producer.js) gives every pack its own taste in instruments.
//
// Rhythm strings: 16 sixteenth notes per bar. x = always, . = never, 1..9 = chance in tenths.
// Count: 0 1 2 3 | 4 5 6 7 | 8 9 10 11 | 12 13 14 15 (beats 1 2 3 4). Backbeat = steps 4 and 12.
// Loaded after templates-trap.js.
// =====================================================================
(function () {
  const clone = x => JSON.parse(JSON.stringify(x));
  const A = TEMPLATES.afrobeats, R = TEMPLATES.rnb;

  const lust = {
    name: "Afro-Lust",
    styleOrder: ["velvet", "rap", "tide", "moonlit", "smoke", "slowwine"],
    logdrum: { tones: [0, 0, 2] },
    // Long notes: the bass and chords ring, the pad holds the whole bar, the guitar lick is short and muted
    gate: { bell: { max: 2 }, bass: { max: 12 }, logdrum: { max: 3 }, chords: { max: 6 }, pad: { fixed: 16 }, pluck: { max: 2 }, lead: { max: 8 } },
    pan: {
      kick: 0, snare: 0, clap: 0.1, rim: -0.35, hat: 0.25, openhat: -0.3, shaker: -0.45, perc: 0.5,
      bell: 0.35, bass: 0, logdrum: 0.2, chords: -0.15, pad: 0, pluck: -0.35, lead: 0.2
    },
    // A very soft sidechain: the harmony breathes a little under the kick, the bass hardly moves
    sidechain: { harmony: 0.2, bass: 0.06, release: 0.28 },

    // The plain loop (structure "loop"): the same idea, chance per bar of a 4-bar phrase
    arrangement: {
      presence: {
        kick:    [1, 1, 1, 1],
        snare:   [0, 0.3, 0.3, 0.5],
        clap:    [0, 0, 0.3, 0.5],
        rim:     [0.7, 1, 1, 1],
        hat:     [0.4, 0.8, 0.8, 1],
        openhat: [0, 0, 0.3, 0.4],
        shaker:  [0.8, 1, 1, 1],
        perc:    [0.4, 0.8, 1, 1],
        bell:    [0, 0.3, 0.4, 0.5],
        bass:    [1, 1, 1, 1],
        logdrum: [0, 0.4, 0.6, 0.8],
        chords:  [1, 1, 1, 1],
        pad:     [1, 0.8, 1, 0.8],
        pluck:   [1, 1, 1, 1],
        lead:    [0, 0, 0, 0]
      },
      // Fills are soft: a few congas and a shaker run, never a drum roll
      fills: [
        { perc: P("....  ....  ....  .x.x"), shaker: P("....  ....  xxxx  xxxx") },
        { perc: P("....  ....  ..x.  x.xx"), rim: P("....  ....  ....  ..x.") }
      ],
      accent: ["kick", "rim"]
    },

    // Starting volumes (dB). The kick, the bass and the rim lead; the hats are barely there.
    mix: {
      kick: -9, snare: -11, clap: -16, rim: -10, hat: -27, openhat: -31,
      shaker: -15, perc: -14, bell: -18, bass: -6, logdrum: -14,
      chords: -12, pad: -21, pluck: -13, lead: -15
    },
    // Target balance against the kick (dB)
    balance: {
      kick: 0, snare: -6, clap: -13, rim: -9, hat: -18, openhat: -19,
      shaker: -15, perc: -10, bell: -18, bass: 0, logdrum: -7,
      chords: -7, pad: -13, pluck: -8, lead: -9
    },

    // Laid-back playing. lateMs = how far BEHIND the grid the part sits. Kick and bass stay on the grid (they are the
    // heartbeat); the backbeat, the percussion and the keys lean back.
    humanize: {
      kick:    { velocity: 0.88, variation: 0.06, ghost: 0.6,  timingMs: 4,  lateMs: 0 },
      snare:   { velocity: 0.70, variation: 0.10, ghost: 0.4,  timingMs: 7,  lateMs: 14 },
      clap:    { velocity: 0.60, variation: 0.10, ghost: 0.5,  timingMs: 7,  lateMs: 16 },
      rim:     { velocity: 0.72, variation: 0.10, ghost: 0.55, timingMs: 7,  lateMs: 14 },
      hat: {
        velocity: 0.55, variation: 0.18, ghost: 0.5, timingMs: 12, lateMs: 8,
        accent: [0.9, 0.5, 1, 0.45, 0.8, 0.5, 0.95, 0.5, 0.85, 0.5, 1, 0.45, 0.8, 0.5, 0.95, 0.55]
      },
      openhat: { velocity: 0.60, variation: 0.10, ghost: 0.7,  timingMs: 10, lateMs: 8 },
      shaker: {
        velocity: 0.62, variation: 0.14, ghost: 0.6, timingMs: 10, lateMs: 10,
        accent: [1, 0.5, 0.75, 0.5, 0.9, 0.5, 0.75, 0.5, 1, 0.5, 0.75, 0.5, 0.9, 0.5, 0.75, 0.5]
      },
      perc:    { velocity: 0.70, variation: 0.16, ghost: 0.55, timingMs: 14, lateMs: 12 },
      bell:    { velocity: 0.60, variation: 0.12, ghost: 0.6,  timingMs: 10, lateMs: 10 },
      bass:    { velocity: 0.90, variation: 0.05, ghost: 0.7,  timingMs: 4,  lateMs: 0 },
      logdrum: { velocity: 0.78, variation: 0.10, ghost: 0.6,  timingMs: 10, lateMs: 8 },
      chords:  { velocity: 0.62, variation: 0.10, ghost: 0.7,  timingMs: 12, lateMs: 10, strumMs: 14 },
      pad:     { velocity: 0.58, variation: 0.05, ghost: 1,    timingMs: 0,  lateMs: 0 },
      pluck:   { velocity: 0.62, variation: 0.14, ghost: 0.6,  timingMs: 10, lateMs: 8 },
      lead:    { velocity: 0.68, variation: 0.08, ghost: 1,    timingMs: 10, lateMs: 8 }
    }
  };

  // ---- The song form: slow intro, the groove builds, a breakdown of only bass and percussion, then back ----
  const RULES = {
    intro: {
      presence: { kick: 0.6, snare: 0, clap: 0, rim: 0.3, hat: 0, openhat: 0, shaker: 0.6, perc: 0.4, bell: 0.4, bass: 1, logdrum: 0, chords: 1, pad: 1, pluck: 1, lead: 0 },
      enter: { kick: 0.5, rim: 0.5, shaker: 0.25, perc: 0.5, bass: 0 },
      sec: { harm: -1.5, drums: -3, cut: 0.5 }
    },
    verse: {
      presence: { kick: 1, snare: 0.3, clap: 0.2, rim: 1, hat: 0.7, openhat: 0, shaker: 0.9, perc: 0.7, bell: 0.2, bass: 1, logdrum: 0.5, chords: 1, pad: 0.6, pluck: 0.8, lead: 0 },
      sec: { harm: -2.5, drums: -1, cut: 0.65 }
    },
    pre: {
      presence: { kick: 1, snare: 0.5, clap: 0.4, rim: 1, hat: 0.8, openhat: 0.3, shaker: 1, perc: 0.9, bell: 0.4, bass: 1, logdrum: 0.7, chords: 1, pad: 1, pluck: 1, lead: 0 },
      sec: { harm: -1, drums: -0.5, cut: 0.8 }
    },
    chorus: {
      presence: { kick: 1, snare: 0.5, clap: 0.5, rim: 1, hat: 0.9, openhat: 0.4, shaker: 1, perc: 1, bell: 0.5, bass: 1, logdrum: 0.9, chords: 1, pad: 1, pluck: 1, lead: 0 },
      sec: { harm: 0, drums: 0, cut: 1 }
    },
    // The breakdown: only the bass and the percussion (and the heartbeat kick, very soft)
    bridge: {
      presence: { kick: 0.4, snare: 0, clap: 0, rim: 0.4, hat: 0, openhat: 0, shaker: 1, perc: 1, bell: 0.5, bass: 1, logdrum: 1, chords: 0, pad: 0, pluck: 0, lead: 0 },
      enter: { kick: 0.5, rim: 0.5 },
      sec: { harm: -1.5, drums: -1.5, cut: 0.55 }
    },
    outro: {
      presence: { kick: 0.8, snare: 0, clap: 0, rim: 0.6, hat: 0.4, openhat: 0, shaker: 0.8, perc: 0.5, bell: 0.3, bass: 1, logdrum: 0.3, chords: 1, pad: 1, pluck: 0.8, lead: 0 },
      sec: { harm: -1, drums: -2, cut: 0.5 }
    }
  };

  // Chords: minor, slow, mostly one chord a bar, extended (7ths and 9ths give the warmth)
  const progs = {
    minor:  [[0, 5, 2, 6], [0, 3, 6, 2], [0, 5, 3, 6], [0, 6, 5, 3], [0, 3, 5, 4]],
    dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 3, 6, 3]],
    major:  [[0, 5, 3, 4], [0, 3, 4, 3]]
  };
  const chorusProgs = {
    minor:  [[5, 6, 0, 0], [3, 5, 6, 0], [5, 2, 6, 0], [3, 6, 0, 0]],
    dorian: [[3, 6, 0, 0], [3, 0, 6, 0]],
    major:  [[3, 4, 0, 5], [5, 3, 0, 4]]
  };
  const preProgs = {
    minor:  [[3, 5, 6, 6], [5, 6, 5, 6], [3, 6, 3, 6]],
    dorian: [[3, 6, 3, 6]],
    major:  [[3, 4, 3, 4]]
  };
  const common = {
    scales: ["minor", "minor", "minor", "dorian"],
    progressions: progs, chorusProgressions: chorusProgs, preProgressions: preProgs,
    chordsPerBar: [1],
    chord: { seventh: 0.85, ninth: 0.5 },
    looseness: 1.3,
    hookStyle: "sparse", arp: "up",
    rules: RULES
  };
  // The shared guitar lick (the tag): the same figure in every pack, off the beat, short and muted
  const LICK_VERSE  = V("...x ..x. ..5. .x..", "...x ..x. ..4. .x.5");
  const LICK_CHORUS = V("..x. ..x. ..x. .x.5", "...x ..x. ..x. .x..");

  lust.styles = {
    // ---- Velvet Sway: the centre of the genre. Round, warm, easy, hip-led ----
    velvet: Object.assign({}, common, {
      name: "Classic (sung)",
      bpm: [88, 94], swing: 0.26,
      bassTones: ["root", "root", "fifth", "root", "octave", "root"],
      gate: { bass: { max: 10 } },
      groove: {
        // the heartbeat: steps 0 and 3
        kick:    V("x..8 .... ..5. ....", "x..7 .... ..x. .4..", "x..8 ..4. .... .5.."),
        snare:   V(".... .... .... ..3.", ".... ...2 .... ..2."),
        clap:    P(".... .... .... 5..."),
        rim:     V(".... x... .... x...", ".... x... .... x..4", ".... x..3 .... x..."),
        hatSparse: V("..x. ...5 ..4. .6..", ".x.. ..5. ...4 ..6."),
        hatFull:   V("..x. .5.x ..5. .6.x", ".x.5 ..x. .5.x ..5."),
        openhat: P(".... .... .... ..3."),
        shaker:  V("x.7. x.7. x.7. x.7.", ".7.x .7.x .7.x .7.x"),
        perc:    V("..x. .x.. ..x4 .x..", ".... ..x. .5.x ..5.", "..x. ...x ..5. .x.."),
        bell:    P("5... .... .... ...."),
        bassExtra: V(".... .... ..5. ..3.", ".... ...4 .... ..4."),
        logdrum: V(".... ..4. .... ..4.", ".... .... ...5 ...."),
        chordsVerse:  V("x... .... .... ....", "x... .... ..5. ...."),
        chordsChorus: V("x... .... x... ....", "x... ..5. x... ..4."),
        pad:     P("x... .... .... ...."),
        pluckVerse: LICK_VERSE, pluckChorus: LICK_CHORUS
      },
      fx: { reverb: { decay: 3.2, send: 0.36 }, delay: { send: 0.24, feedback: 0.32 } }
    }),

    // ---- Rap (bars): a steady backbeat and a gliding 808 to rap over, the heartbeat kept. Chords and pad stay low so the voice has room ----
    rap: Object.assign({}, common, {
      name: "Rap (bars)",
      bpm: [90, 100], swing: 0.2,
      scales: ["minor", "minor", "minor", "dorian"],
      bassTones: ["root", "root", "fifth", "root", "root", "octave"],
      gate: { bass: { max: 12 }, chords: { max: 4 } },
      groove: {
        kick:    V("x..8 .... ..x. ....", "x..8 .... ..x. .4..", "x..7 ..4. ..x. ...5"),
        snare:   V(".... x... .... x...", ".... x... .... x..4"),
        clap:    V(".... 6... .... 6...", ".... 5... .... x..."),
        rim:     V(".... .... .... ..4.", ".... ..3. .... ...."),
        hatSparse: V("x.x. x.x. x.x. x.x.", "x.x. x.x. x.x. x.xx"),
        hatFull:   V("x.x. x.xx x.x. x.x5", "x.xx x.x. x.xx x.x."),
        openhat: P(".... .... .... ..5."),
        shaker:  V("..x. ..x. ..x. ..x."),
        perc:    V("..x. .... ..5. .x..", ".... ..x. .... ..5."),
        bell:    P("5... .... .... ...."),
        bassExtra: V(".... .... ..5. ...5", ".... ...4 .... ..5."),
        logdrum: V(".... .... .... ..4.", ".... ..3. .... ...."),
        chordsVerse:  V("x... .... .... ....", "x... .... ..4. ...."),
        chordsChorus: V("x... .... x... ....", "x... ..5. x... ...."),
        pad:     P("x... .... .... ...."),
        pluckVerse: LICK_VERSE, pluckChorus: LICK_CHORUS
      },
      rules: Object.assign({}, RULES, {
        intro:  { sec: RULES.intro.sec, presence: Object.assign({}, RULES.intro.presence, { kick: 0.8, snare: 0, hat: 0.5, rim: 0.3 }), enter: RULES.intro.enter },
        verse:  { sec: RULES.verse.sec, presence: Object.assign({}, RULES.verse.presence, { snare: 1, clap: 0.6, hat: 1, rim: 0.2, shaker: 0.5, perc: 0.4, chords: 0.6, pad: 0.3, pluck: 0.35, logdrum: 0.3 }) },
        chorus: { sec: RULES.chorus.sec, presence: Object.assign({}, RULES.chorus.presence, { snare: 1, clap: 0.8, hat: 1, chords: 1, pad: 0.8, pluck: 0.8 }) }
      }),
      fx: { reverb: { decay: 2.6, send: 0.28 }, delay: { send: 0.22, feedback: 0.3 } }
    }),

    // ---- Slow Tide: the sparsest. Mostly bass, space and one soft rim. Airy, hazy (the Tems side) ----
    tide: Object.assign({}, common, {
      name: "Airy (soft vocals)",
      bpm: [85, 90], swing: 0.3,
      bassTones: ["root", "root", "root", "fifth", "octave"],
      gate: { bass: { max: 14 }, chords: { max: 8 } },
      groove: {
        kick:    V("x..6 .... .... ..4.", "x..7 .... ..4. ....", "x..6 .... .... ...."),
        snare:   P(".... .... .... ...."),
        clap:    P(".... .... .... ...."),
        rim:     V(".... .... .... x...", ".... 5... .... x..."),
        hatSparse: V("..x. .... ..4. ....", ".... ..x. .... .5.."),
        hatFull:   V("..x. ..5. ..x. ..5.", ".x.. ..5. ..x. ...5"),
        openhat: P(".... .... .... ...."),
        shaker:  V("..x. ..x. ..x. ..x.", "x... x... x... x..."),
        perc:    V("..x. .... ...x ....", ".... ..x. .... .4.x"),
        bell:    V("5... .... ..3. ....", ".... ..4. .... ...."),
        bassExtra: V(".... ...4 .... ....", ".... .... ..5. ...."),
        logdrum: V(".... .... ..4. ....", ".... .... .... ...3"),
        chordsVerse:  P("x... .... .... ...."),
        chordsChorus: V("x... .... .... ..5.", "x... .... x... ...."),
        pad:     P("x... .... .... ...."),
        pluckVerse: LICK_VERSE, pluckChorus: LICK_CHORUS
      },
      fx: { reverb: { decay: 3.8, send: 0.42 }, delay: { send: 0.28, feedback: 0.36 } }
    }),

    // ---- Moonlit Highlife: the lightest, a lilting highlife sway with a soft 3-2 clave in the congas ----
    moonlit: Object.assign({}, common, {
      name: "Highlife (light)",
      bpm: [94, 100], swing: 0.2,
      bassTones: ["root", "fifth", "root", "octave", "root", "fifth"],
      gate: { bass: { max: 6 } },
      groove: {
        kick:    V("x..8 .... x... ..4.", "x..8 ..4. x... ....", "x..7 .... ..x. ...."),
        snare:   V(".... x... .... x..3", ".... x..2 .... x..."),
        clap:    P(".... .... .... 6..."),
        rim:     V(".5.. x.5. .5.. x.5.", "..5. x... ..5. x..5"),
        hatSparse: V("x.6. x.6. x.6. x.6.", "x.5. x.6. x.5. x.7."),
        hatFull:   V("x.6. x.6x x.6. x.6x", "x.x. 6.x. x.x. 6.x."),
        openhat: P(".... .... ..3. ...."),
        shaker:  V("x.7. x.7. x.7. x.7.", "7.x. 7.x. 7.x. 7.x."),
        perc:    V("x..x ..x. ..x. x...", "x..x ..x5 ..x. x..4", "5..x ..x. ..5. x..."),
        bell:    V("7... ..5. 7... ..5.", ".... ..5. .... 7..."),
        bassExtra: V(".... ..4. .... ..5.", ".... .... ..4. ...."),
        logdrum: V(".... ..5. .... ..5.", "...5 .... ..4. ...."),
        chordsVerse:  V("x... .... ..6. ....", "..x. .... ..x. ...."),
        chordsChorus: V("x... ..6. x... ..5.", "x..6 .... x... ..5."),
        pad:     P("x... .... .... ...."),
        pluckVerse: LICK_VERSE, pluckChorus: LICK_CHORUS
      },
      fx: { reverb: { decay: 2.6, send: 0.3 }, delay: { send: 0.22, feedback: 0.3 } }
    }),

    // ---- Smoke Room: darker and lower, a low-voiced late-night pack (the Omah Lay side). Soft snare, deep log drum ----
    smoke: Object.assign({}, common, {
      name: "Late Night (dark)",
      bpm: [86, 92], swing: 0.24,
      scales: ["minor", "minor", "minor", "minor", "dorian"],
      bassTones: ["root", "root", "root", "root", "fifth", "octave"],
      gate: { bass: { max: 14 } },
      groove: {
        kick:    V("x..7 .... ..x. ....", "x..8 ...4 .... ..x.", "x..7 .... ..x. .4.."),
        snare:   P(".... .... .... x..."),
        clap:    P(".... .... .... 6..."),
        rim:     V(".... x... .... ....", ".... x..4 .... .3.."),
        hatSparse: V("..x. .... ..5. ....", ".x.. .... ..x. ...5"),
        hatFull:   V("..x. .5.. ..5. .6..", ".x.. ..5. .x.. ..5."),
        openhat: P(".... .... .... ..3."),
        shaker:  V("x.6. x.6. x.6. x.6.", ".... x... .... x..."),
        perc:    V("..x. .... ..x. .4..", ".... ..x. ...x ...."),
        bell:    P("5... .... .... ...."),
        bassExtra: V(".... ...4 .... ..5.", ".... .... ..5. ...."),
        logdrum: V(".... ..5. .... ..x.", "...x .... ..5. ...."),
        chordsVerse:  V("x... .... .... ....", "x... .... ..5. ...."),
        chordsChorus: V("x... .... x... ....", "x... .... x... ..5."),
        pad:     P("x... .... .... ...."),
        pluckVerse: LICK_VERSE, pluckChorus: LICK_CHORUS
      },
      rules: Object.assign({}, RULES, {
        verse: { sec: RULES.verse.sec, presence: Object.assign({}, RULES.verse.presence, { logdrum: 0.9, snare: 0.8, hat: 0.5 }) }
      }),
      fx: { reverb: { decay: 3.4, send: 0.38 }, delay: { send: 0.26, feedback: 0.34 } }
    }),

    // ---- Slow Wine: the closest to a dance floor. A slow dembow-like sway with a prominent log drum ----
    slowwine: Object.assign({}, common, {
      name: "Slow Wine (dance)",
      bpm: [96, 100], swing: 0.22,
      bassTones: ["root", "root", "fifth", "root", "octave"],
      gate: { bass: { max: 8 }, logdrum: { max: 4 } },
      groove: {
        kick:    V("x..8 .... x... ....", "x..8 ..x. x... ....", "x..7 .... x... ..4."),
        snare:   P(".... .... .... ...."),
        clap:    P(".... .... .... 5..."),
        rim:     V("...x .... ...x ..x.", ".... ..x. ...x ..x.", "...x .... ..5x ..x."),
        hatSparse: V("..x. ...5 ..x. ...5", ".x.. ..5. .x.. ..6."),
        hatFull:   V("..x. .6.x ..x. .6.x", ".x.6 ..x. .x.6 ..x."),
        openhat: P(".... .... .... ..4."),
        shaker:  V("x.8. x.8. x.8. x.8."),
        perc:    V("x..x ..x. x..x ..x.", "x..x ..x. x..4 ..x5"),
        bell:    P("6... .... .... ...."),
        bassExtra: V(".... ..4. .... ..5.", ".... .... ..5. ...."),
        logdrum: V("x... ..x. .... ..x.", "...x .... ..x. x...", "x... .... ..x. ..5."),
        chordsVerse:  V("x... .... ..5. ....", "x... .... .... ...."),
        chordsChorus: V("x... ..5. x... ....", "x... .... x... ..5."),
        pad:     P("x... .... .... ...."),
        pluckVerse: LICK_VERSE, pluckChorus: LICK_CHORUS
      },
      rules: Object.assign({}, RULES, {
        verse: { sec: RULES.verse.sec, presence: Object.assign({}, RULES.verse.presence, { logdrum: 1, perc: 1, snare: 0 }) },
        chorus: { sec: RULES.chorus.sec, presence: Object.assign({}, RULES.chorus.presence, { logdrum: 1 }) }
      }),
      fx: { reverb: { decay: 2.4, send: 0.28 }, delay: { send: 0.2, feedback: 0.28 } }
    })
  };

  TEMPLATES.afrolust = lust;
})();
