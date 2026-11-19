// =====================================================================
// Trap. Written the way trap producers build it:
//   - HALF-TIME: the snare / clap sits on beat 3 (step 8) only, so 140 BPM feels like 70
//   - 808 bass that follows the kick, long notes that glide into each other (the bass is a recorded 808, see producer.js)
//   - hi-hats on straight 16ths with rolls (doubles and triplets) that the generator adds before the end of a beat
//   - dark minor chords, a piano / pad / bell or flute on top, lots of space
// Three styles: Hard Trap (aggressive, Metro-Boomin dark), Melodic Trap (Future / Lil Baby: guitar, piano, flute),
// and Drill (sliding 808, snare late, triplet hats). The drum recordings come from samples/trap/.
// Loaded after templates.js (it borrows the shared mix, pan and humanize settings from R&B).
// =====================================================================
(function () {
  const clone = x => JSON.parse(JSON.stringify(x));
  const R = clone(TEMPLATES.rnb);

  const trap = {
    name: "Trap",
    styleOrder: ["hardtrap", "melodictrap", "drill"],
    logdrum: { tones: [0] },
    gate: { bell: { max: 3 }, bass: { max: 12 }, logdrum: { max: 2 }, chords: { max: 8 }, pad: { fixed: 16 }, pluck: { max: 2 }, lead: { max: 6 } },
    pan: { kick: 0, snare: 0, clap: 0, rim: -0.3, hat: 0.3, openhat: -0.3, shaker: 0.35, perc: -0.4, bell: 0.35, bass: 0, logdrum: 0, chords: -0.1, pad: 0, pluck: -0.3, lead: 0.25 },
    sidechain: { harmony: 0.3, bass: 0.1, release: 0.2 },
    arrangement: clone(R.arrangement),
    mix: Object.assign(clone(R.mix), { kick: -9, snare: -8, clap: -7, hat: -20, openhat: -26, bass: -9, chords: -11, pad: -22, bell: -13, pluck: -13, lead: -13 }),
    balance: Object.assign(clone(R.balance), { kick: 0, snare: -4, clap: -5, hat: -14, bass: 0 }),
    humanize: clone(R.humanize)
  };
  // Tighter, harder drums and a hat that is a little louder and less swung than R&B
  trap.humanize.kick.timingMs = 3; trap.humanize.snare.timingMs = 3; trap.humanize.clap.timingMs = 3;
  trap.humanize.hat = { velocity: 0.72, variation: 0.1, ghost: 0.6, timingMs: 3, accent: [1, .55, .75, .55, .95, .55, .75, .6, .95, .55, .75, .55, .95, .6, .75, .65] };
  trap.humanize.bass = { velocity: 0.95, variation: 0.04, ghost: 0.7, timingMs: 3 };
  Object.assign(trap.arrangement.presence, { chords: [0.5, 0.8, 1, 1], pad: [0.3, 0.6, 0.8, 0.6], hat: [1, 1, 1, 1], openhat: [0.3, 0.6, 0.6, 0.8], rim: [0.3, 0.3, 0.5, 0.5], shaker: [0, 0, 0, 0] });
  trap.arrangement.presence.bell = [0.4, 0.6, 0.9, 0.9];
  trap.arrangement.presence.pluck = [0.2, 0.5, 0.8, 1];
  trap.arrangement.presence.lead = [0, 0.3, 0.5, 0.7];
  trap.arrangement.fills = [
    { hat: P("xxxx  xxxx  xxxx  xxxx"), snare: P("....  ....  x...  x.xx"), openhat: P("....  ....  ....  ..8.") },
    { kick: P("x...  ..6.  ..8.  .x8x"), hat: P("x.xx  x.xx  xxxx  xxxx"), snare: P("....  ....  x...  ..xx") }
  ];

  const minorProg = { minor: [[0, 5, 2, 6], [0, 6, 5, 4], [0, 0, 5, 6], [0, 3, 5, 6], [0, 5]], dorian: [[0, 3, 0, 3], [0, 6, 3, 0]], major: [[0, 4, 5, 3], [0, 5, 3, 4]] };
  const minorChorus = { minor: [[5, 6, 0, 0], [3, 5, 6, 0], [0, 5, 3, 6], [5, 2, 6, 0]], dorian: [[3, 6, 0, 0], [3, 0, 6, 0]], major: [[3, 4, 0, 5], [5, 3, 0, 4]] };
  const minorPre = { minor: [[3, 5, 6, 6], [5, 6, 5, 6], [3, 3, 5, 6]], dorian: [[3, 6, 3, 6]], major: [[3, 4, 3, 4]] };

  trap.styles = {
    // ---- Hard Trap: aggressive, dark, sparse keys, a heavy booming 808 and fast hats ----
    hardtrap: {
      name: "Hard Trap",
      bpm: [136, 150], swing: 0, looseness: 0.5,
      scales: ["minor", "minor", "minor", "minor", "dorian"],
      progressions: minorProg, chorusProgressions: minorChorus, preProgressions: minorPre,
      chordsPerBar: [1],
      chord: { seventh: 0.3, ninth: 0.1 },
      bassTones: ["root", "root", "fifth", "root", "root", "fifth"],
      rules: {
        intro:  { presence: { chords: 0.6, pad: 0.4, bell: 0.7, pluck: 0.3, hat: 0.8 } },
        verse:  { presence: { chords: 0.45, pad: 0.15, bell: 0.4, pluck: 0.3, hat: 1, rim: 0.2 } },
        chorus: { presence: { chords: 0.8, pad: 0.8, bell: 0.9, pluck: 0.45, hat: 1, openhat: 0.9 } }
      },
      hookStyle: "sparse", arp: "up",
      hatRoll: { prob: 0.75, steps: [3, 5, 7, 9, 11, 13, 14, 15], kind: "triplet", everywhere: true },
      sidechain: { harmony: 0.3, bass: 0.1, release: 0.2 },
      gate: { bass: { max: 14 } },
      groove: {
        kick:    V("x... ..x. ...x ..5.", "x... ...x ..x. .5..", "x..4 ..x. ..5. x...", "x... .5.x ..x. ...6", "x..x .... ..x. x.5.", "x... ..x. ..xx ...5"),
        snare:   P(".... .... x... ...."),
        clap:    P(".... .... x... ...."),
        rim:     P(".... .... .... ..3."),
        hatSparse: V("x.x. x.x. x.x. x.x.", "x.xx x.x. x.xx x.x."),
        hatFull:   V("xxxx xxxx xxxx xxxx", "x7x7 x7x7 x7x7 x7xx", "xxxx x8x8 xxxx x8xx"),
        openhat: V(".... .... ..4. ...5", "...4 .... .... ..6."),
        shaker:  P(".... .... .... ...."),
        perc:    P(".... .... ...3 ...."),
        bell:    V("x... .... ..5. ....", "x... .... .... ..5."),
        bassExtra: V(".... ...4 .... ..4.", ".... .... ..4. ...5"),
        logdrum: P(".... .... .... ...."),
        chordsVerse:  V("x... .... .... ....", "x... .... ..5. ...."),
        chordsChorus: V("x... .... x... ....", "x... ..6. .... ..5."),
        pad:     P("x... .... .... ...."),
        pluckVerse:  V("x... .... x... ....", "5... .... 5... ...."),
        pluckChorus: V("x.5. .... x.5. ....", "x... .... x... 5...")
      },
      fx: { reverb: { decay: 2.6, send: 0.3 }, delay: { send: 0.28, feedback: 0.34 } }
    },

    // ---- Melodic Trap: a guitar, piano or flute melody over rolling hats and a soft, long 808 ----
    melodictrap: {
      name: "Melodic Trap",
      bpm: [140, 160], swing: 0, looseness: 0.5,
      scales: ["minor", "minor", "dorian", "minor", "major"],
      progressions: minorProg, chorusProgressions: minorChorus, preProgressions: minorPre,
      chordsPerBar: [1, 1, 2],
      chord: { seventh: 0.55, ninth: 0.3 },
      bassTones: ["root", "root", "fifth", "root", "fifth", "octave"],
      rules: {
        intro:  { presence: { chords: 0.6, pad: 0.4, bell: 0.7, pluck: 0.3, hat: 0.8 } },
        verse:  { presence: { chords: 0.45, pad: 0.15, bell: 0.4, pluck: 0.3, hat: 1, rim: 0.2 } },
        chorus: { presence: { chords: 0.8, pad: 0.8, bell: 0.9, pluck: 0.45, hat: 1, openhat: 0.9 } }
      },
      hookStyle: "long", arp: "updown",
      hatRoll: { prob: 0.6, steps: [5, 7, 11, 13, 14, 15], kind: "triplet", everywhere: true },
      sidechain: { harmony: 0.35, bass: 0.1, release: 0.22 },
      gate: { bass: { max: 16 }, lead: { max: 8 } },
      groove: {
        kick:    V("x... .... ..x. ...5", "x..5 .... x... ..x.", "x... ..5. ..x. .5.."),
        snare:   P(".... .... x... ...."),
        clap:    P(".... .... x... ...."),
        rim:     P(".... .... .... ..3."),
        hatSparse: V("x.x. x.x. x.x. x.x.", "x.7. x.7. x.7. x.7."),
        hatFull:   V("x5x5 x5x7 x5x5 x5x8", "xxxx xxxx xxxx xxxx", "x7x7 x7x7 x7x7 x7x8"),
        openhat: V(".... .... ..4. ...5", ".... .... .... ..6."),
        shaker:  V(".... .... .... ....", "..3. ..3. ..3. ..3."),
        perc:    P(".... .... ...3 ...."),
        bell:    V("x... .... ..5. ....", "x... ..5. .... .3.."),
        bassExtra: V(".... ...4 .... ..4.", ".... .... ..4. ...5"),
        logdrum: P(".... .... .... ...."),
        chordsVerse:  V("x... .... .... ....", "x... .... ..6. ...."),
        chordsChorus: V("x... .... x... ....", "x... ..6. x... ..5."),
        pad:     P("x... .... .... ...."),
        pluckVerse:  V("x.5. .... x.5. ....", "5.5. .... x.5. ....", "x... 5... x... 5..."),
        pluckChorus: V("x.5. .... x... ....", "x... ..5. x... ....", "x.5. .... x.5. ....")
      },
      fx: { reverb: { decay: 3.2, send: 0.38 }, delay: { send: 0.32, feedback: 0.36 } }
    },

    // ---- Drill: late snare, sliding 808, hats in triplet bursts, cold and tense ----
    drill: {
      name: "Drill",
      bpm: [138, 146], swing: 0, looseness: 0.4,
      scales: ["minor", "minor", "minor", "dorian"],
      progressions: { minor: [[0, 5], [0, 6, 5, 6], [0, 3, 0, 5], [0, 0, 6, 6]], dorian: [[0, 3, 0, 3]], major: [[0, 4, 5, 3]] },
      chorusProgressions: { minor: [[5, 6, 0, 0], [3, 5, 6, 0], [0, 6, 5, 4]], dorian: [[3, 6, 0, 0]], major: [[3, 4, 0, 5]] },
      preProgressions: { minor: [[3, 5, 6, 6], [5, 6, 5, 6]], dorian: [[3, 6, 3, 6]], major: [[3, 4, 3, 4]] },
      chordsPerBar: [1, 2],
      chord: { seventh: 0.2, ninth: 0 },
      bassTones: ["root", "root", "fifth", "root", "octave", "root"],
      rules: {
        intro:  { presence: { chords: 0.6, pad: 0.4, bell: 0.7, pluck: 0.3, hat: 0.8 } },
        verse:  { presence: { chords: 0.45, pad: 0.15, bell: 0.4, pluck: 0.3, hat: 1, rim: 0.2 } },
        chorus: { presence: { chords: 0.8, pad: 0.8, bell: 0.9, pluck: 0.45, hat: 1, openhat: 0.9 } }
      },
      hookStyle: "sparse", arp: "up",
      hatRoll: { prob: 0.8, steps: [3, 5, 7, 9, 11, 14, 15], kind: "triplet", everywhere: true },
      sidechain: { harmony: 0.25, bass: 0.1, release: 0.18 },
      gate: { bass: { max: 10 } },
      groove: {
        kick:    V("x... ..x. .... ..x.", "x... ...x .x.. ..5.", "x..x .... ..x. .5.."),
        snare:   V(".... .... ..x. ....", ".... .... x... ....", ".... .... ..x. ...3"),
        clap:    P(".... .... ..x. ...."),
        rim:     P(".... .... .... ..3."),
        hatSparse: V("x.x. x.x. x.x. x.x.", "x..x ..x. x..x ..x."),
        hatFull:   V("x.xx .xx. x.xx .xx.", "x.x. xx.x x.x. xx.x", "x.xx x.xx x.xx x.xx"),
        openhat: P(".... .... .... ..5."),
        shaker:  P(".... .... .... ...."),
        perc:    P(".... .... ...3 ...."),
        bell:    V("x... .... .... ..5.", ".... .... x... ...."),
        bassExtra: V(".... ..4. .... ..4.", ".... .... ..5. ...."),
        logdrum: P(".... .... .... ...."),
        chordsVerse:  V("x... .... .... ....", "x... .... ..5. ...."),
        chordsChorus: V("x... .... x... ....", "x... ..5. .... ..5."),
        pad:     P("x... .... .... ...."),
        pluckVerse:  V("x... .... x... ....", "5... .... 5... ...."),
        pluckChorus: V("x.5. .... x.5. ....", "x... .... x... 5...")
      },
      fx: { reverb: { decay: 2.4, send: 0.26 }, delay: { send: 0.22, feedback: 0.3 } }
    }
  };

  TEMPLATES.trap = trap;
})();
