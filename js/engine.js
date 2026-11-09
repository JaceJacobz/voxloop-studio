// =====================================================================
// The audio engine: instruments, mixer buses, sound presets and the
// function that plays one step of a bar.
//
// createEngine() builds the whole signal chain in the CURRENT Tone context.
// The page builds one for live playback; the WAV export builds another one
// inside an offline context, so what you download is what you heard.
// =====================================================================

const MASTER_BASE = 0.85;            // the master level before the auto-mix touches it
const FLAT_VELOCITY = 0.9;           // every hit's strength when humanize is off
const dbGain = db => Math.pow(10, db / 20);

// ---------- Sound presets ----------
// Drum kits: how the drum synths are shaped.
//   snare.body = the pitch of the drum shell under the noise      snare.hp = where the snare noise starts
//   hat.hp     = where the hi-hat noise starts (higher = thinner, more "tss")
const KIT_PRESETS = {
  soft:    { kick: { pitchDecay: .06, octaves: 4, decay: .45 }, snare: { decay: .17, type: "pink",  body: "F3",  hp: 600, bodyDecay: .13 }, clap: { decay: .16, freq: 1300 }, rim: { note: "E5", decay: .04 }, hat: { decay: .05,  hp: 6200 }, openhat: { decay: .35 } },
  punch:   { kick: { pitchDecay: .03, octaves: 7, decay: .28 }, snare: { decay: .14, type: "white", body: "A3",  hp: 900, bodyDecay: .10 }, clap: { decay: .12, freq: 1500 }, rim: { note: "E5", decay: .04 }, hat: { decay: .045, hp: 7000 }, openhat: { decay: .28 } },
  boom:    { kick: { pitchDecay: .09, octaves: 5, decay: .65 }, snare: { decay: .20, type: "white", body: "G3",  hp: 800, bodyDecay: .16 }, clap: { decay: .14, freq: 1400 }, rim: { note: "A5", decay: .03 }, hat: { decay: .035, hp: 7600 }, openhat: { decay: .25 } },
  tight:   { kick: { pitchDecay: .02, octaves: 3, decay: .18 }, snare: { decay: .09, type: "pink",  body: "B3",  hp: 1100, bodyDecay: .07 }, clap: { decay: .09, freq: 1700 }, rim: { note: "D5", decay: .05 }, hat: { decay: .04,  hp: 6600 }, openhat: { decay: .20 } },
  vintage: { kick: { pitchDecay: .04, octaves: 5, decay: .30 }, snare: { decay: .20, type: "white", body: "F#3", hp: 700, bodyDecay: .15 }, clap: { decay: .20, freq: 1200 }, rim: { note: "E5", decay: .05 }, hat: { decay: .06,  hp: 5600 }, openhat: { decay: .40 } }
};

// Keys / chords (an electric-piano style FM synth).
//   A high, fast-fading "tine" gives the attack its bell-like bite, then the body is soft.
//   filter = how dark the keys are      chorus = stereo width
const CHORD_PRESETS = {
  rhodes:   { filter: 3600, chorus: .35, synth: { type: "sine",     fmRatio: 14,   fmIndex: 1.1, fmAttack: .002, fmDecay: .09, fmSustain: .05, attack: .006, decay: 1.3, sustain: .22, release: 1.1, level: .25 } },
  wurli:    { filter: 3000, chorus: .25, synth: { type: "sine",     fmRatio: 2,    fmIndex: 2.6, fmAttack: .004, fmDecay: .30, fmSustain: .12, attack: .005, decay: .8,  sustain: .18, release: .6, level: .25 } },
  vibes:    { filter: 5200, chorus: .10, synth: { type: "sine",     fmRatio: 4.01, fmIndex: .8,  fmAttack: .004, fmDecay: .50, fmSustain: .08, attack: .004, decay: 1.6, sustain: .06, release: 1.3, level: .25 } },
  darkKeys: { filter: 1800, chorus: .40, synth: { type: "sine",     fmRatio: 1,    fmIndex: .8,  fmAttack: .02,  fmDecay: .70, fmSustain: .20, attack: .02,  decay: 1.4, sustain: .30, release: 1.5, level: .25 } },
  organ:    { filter: 2800, chorus: .30, synth: { type: "triangle", fmRatio: 2,    fmIndex: .3,  fmAttack: .015, fmDecay: .20, fmSustain: .50, attack: .015, decay: .2,  sustain: .70, release: .25, level: .25 } }
};

// Pads (a slow, wide synth under everything). Two or three slightly detuned oscillators per note.
const PAD_PRESETS = {
  warm: { filter: 1200, chorus: .5, synth: { type: "sawtooth", count: 3, spread: 22, attack: .8,  decay: .5, sustain: .8,  release: 1.6 } },
  airy: { filter: 2600, chorus: .6, synth: { type: "triangle", count: 3, spread: 18, attack: 1.1, decay: .6, sustain: .85, release: 2.0 } },
  dark: { filter: 700,  chorus: .4, synth: { type: "sawtooth", count: 2, spread: 14, attack: 1.2, decay: .8, sustain: .75, release: 2.2 } }
};

// Bass (a mono synth). portamento = glide between notes (never 0: an instant jump clicks)
//   drive = how much it is saturated      bite = a quiet octave-up layer so the bass is still heard on small speakers
const BASS_PRESETS = {
  sub808:    { drive: .35, bite: .30, synth: { portamento: .015, oscillator: { type: "sine" },     envelope: { attack: .006, decay: .3,  sustain: .7, release: .4 }, filterEnvelope: { attack: .005, decay: .2,  sustain: .5, baseFrequency: 150, octaves: 2 } } },
  glide808:  { drive: .55, bite: .26, synth: { portamento: .08,  oscillator: { type: "sine" },     envelope: { attack: .006, decay: .6,  sustain: .6, release: .5 }, filterEnvelope: { attack: .005, decay: .3,  sustain: .5, baseFrequency: 150, octaves: 2 } } },
  softSub:   { drive: .25, bite: .20, synth: { portamento: .015, oscillator: { type: "triangle" }, envelope: { attack: .008, decay: .25, sustain: .4, release: .25 }, filterEnvelope: { attack: .005, decay: .15, sustain: .4, baseFrequency: 120, octaves: 1.5 } } },
  moog:      { drive: .2,  bite: 0,   synth: { portamento: .02,  oscillator: { type: "sawtooth" }, envelope: { attack: .005, decay: .15, sustain: .3, release: .15 }, filterEnvelope: { attack: .003, decay: .15, sustain: .2, baseFrequency: 100, octaves: 3 } } }
};

// The hook / lead. vib = vibrato depth in cents (0 = none)
const LEAD_PRESETS = {
  glass:   { filter: 4500, synth: { level: .73, type: "triangle", fmRatio: 2.01, fmIndex: 1.2, vib: 10, attack: .005, decay: .9,  sustain: .25, release: .9 } },
  vibes:   { filter: 6000, synth: { level: .73, type: "sine",     fmRatio: 4,    fmIndex: .6, vib: 0,  attack: .004, decay: 1.2, sustain: .05, release: 1.0 } },
  softSaw: { filter: 2300, synth: { level: .73, type: "sawtooth", count: 2, spread: 16,        vib: 14, attack: .035, decay: .3,  sustain: .55, release: .7 } },
  kalimba: { filter: 3800, synth: { level: .73, type: "triangle", fmRatio: 5.01, fmIndex: 1.6, vib: 0,  attack: .003, decay: .5,  sustain: .01, release: .3 } }
};

// The arpeggio / pluck: the filter snaps shut after each note, like a real plucked string
const PLUCK_PRESETS = {
  kalimba:   { filter: 3600, synth: { type: "triangle", fmRatio: 5.01, fmIndex: 1.4, attack: .002, decay: .38, sustain: .01, release: .2, level: .6, filter: { base: 900,  octaves: 3.2, decay: .26, sustain: .08 } } },
  bellPluck: { filter: 5200, synth: { type: "sine",     fmRatio: 3.5,  fmIndex: 2,   attack: .002, decay: .55, sustain: .01, release: .3, level: .6, filter: { base: 1400, octaves: 2.5, decay: .40, sustain: .10 } } },
  pluckSaw:  { filter: 2600, synth: { type: "sawtooth",                              attack: .002, decay: .22, sustain: .01, release: .15, level: .6, filter: { base: 350,  octaves: 3.8, decay: .14, sustain: .05 } } }
};

// ---------- Extra sound libraries (added for the African genres, safe for every genre) ----------
// Every kit is a different drum machine / drum set, not a tweak of one: its own kick pitch and click,
// snare shell vs wires, clap spread, hat noise vs metal, and how long everything rings.
//   kick.note  = the kick's low note       kick.click = beater click level in dB
//   snare.shell / snare.wires = how much drum body vs rattle      clap.spread = seconds between the hand claps
//   hat.metal  = 0..1, how much 808-style metallic hat is blended over the noise hat
Object.assign(KIT_PRESETS, {
  // Warm, round kick and a woody cracking snare layered with a clap: the Afrobeats pocket
  afro:     { kick: { pitchDecay: .05,  octaves: 4.5, decay: .36, note: "E1",  click: -17 }, snare: { decay: .11, type: "white", body: "C4", hp: 1200, bodyDecay: .08, shell: 1.25, wires: .8 }, clap: { decay: .10, freq: 1600, spread: .010 }, rim: { note: "G5", decay: .03 }, hat: { decay: .04,  hp: 7400 }, openhat: { decay: .26 } },
  // Soft thud kick, airy snare / clap far back, long open hats: nothing fights the log drum
  ama:      { kick: { pitchDecay: .035, octaves: 2.6, decay: .44, note: "G1",  click: -28 }, snare: { decay: .22, type: "pink",  body: "E3", hp: 700,  bodyDecay: .12, shell: .55,  wires: .7 }, clap: { decay: .20, freq: 1100, spread: .016 }, rim: { note: "D5", decay: .035 }, hat: { decay: .03,  hp: 8200 }, openhat: { decay: .22 } },
  // Long boomy 808 kick, tight snapping snare, metallic hat: Afroswing and Afro-rave
  dembow:   { kick: { pitchDecay: .06,  octaves: 4,   decay: .55, note: "C1",  click: -20 }, snare: { decay: .10, type: "white", body: "G4", hp: 1400, bodyDecay: .05, shell: .8,   wires: 1 },  clap: { decay: .11, freq: 1700, spread: .009 }, rim: { note: "B5", decay: .025 }, hat: { decay: .035, hp: 7800, metal: .45 }, openhat: { decay: .24 } },
  // A live-sounding set: felt kick, brushed snare, ringing ride-like hat
  highlife: { kick: { pitchDecay: .07,  octaves: 3,   decay: .22, note: "G1",  click: -18 }, snare: { decay: .16, type: "pink",  body: "A3", hp: 600,  bodyDecay: .14, shell: 1.3,  wires: .9 }, clap: { decay: .14, freq: 1300, spread: .013 }, rim: { note: "E5", decay: .04 }, hat: { decay: .07,  hp: 5200 }, openhat: { decay: .38 } },
  // 909-style: punchy kick, snappy clap, mostly metal hats
  house:    { kick: { pitchDecay: .028, octaves: 5.5, decay: .32, note: "D#1", click: -12 }, snare: { decay: .12, type: "white", body: "B3", hp: 1000, bodyDecay: .08, shell: .9,   wires: 1 },  clap: { decay: .16, freq: 1400, spread: .014 }, rim: { note: "E5", decay: .03 }, hat: { decay: .03,  hp: 8200, metal: .6 },  openhat: { decay: .30 } },
  // Durban gqom: hard, long, distorted-sounding kick and harsh clap
  gqom:     { kick: { pitchDecay: .025, octaves: 8,   decay: .5,  note: "D1",  click: -7 },  snare: { decay: .12, type: "white", body: "D4", hp: 1500, bodyDecay: .06, shell: .9,   wires: 1 },  clap: { decay: .18, freq: 1900, spread: .008 }, rim: { note: "A5", decay: .03 }, hat: { decay: .03,  hp: 8400, metal: .8 },  openhat: { decay: .20 } }
});

Object.assign(CHORD_PRESETS, {
  // Bright, soft piano with a quick tine (the amapiano / private-school keys)
  amaPiano: { filter: 4800, chorus: .15, synth: { type: "sine",     fmRatio: 3,    fmIndex: 1.4, fmAttack: .002, fmDecay: .25, fmSustain: .08, attack: .004, decay: .9,  sustain: .12, release: .5,  level: .25 } },
  // House stab: two detuned saws that snap shut
  stab:     { filter: 3800, chorus: .35, synth: { type: "sawtooth", count: 2, spread: 12, attack: .004, decay: .18, sustain: .15, release: .12, level: .22, filter: { base: 700, octaves: 3, decay: .15, sustain: .3 } } },
  // Strummed clean guitar chords (highlife / afro-fusion)
  guitar:   { filter: 3200, chorus: .2,  synth: { type: "triangle", attack: .002, decay: .6, sustain: .03, release: .25, level: .3, filter: { base: 600, octaves: 3, decay: .3, sustain: .1 } } }
});

Object.assign(PAD_PRESETS, {
  strings: { filter: 2200, chorus: .6, synth: { type: "sawtooth", count: 3, spread: 20, attack: .5, decay: .6, sustain: .85, release: 1.2 } },
  choir:   { filter: 1500, chorus: .55, synth: { type: "triangle", count: 3, spread: 10, attack: 1.0, decay: .5, sustain: .85, release: 1.6 } }
});

Object.assign(BASS_PRESETS, {
  // Round electric-bass-like pluck (Afrobeats / highlife)
  pluckSub: { drive: .3,  bite: .35, synth: { portamento: .01,  oscillator: { type: "triangle" }, envelope: { attack: .004, decay: .22, sustain: .35, release: .18 }, filterEnvelope: { attack: .004, decay: .12, sustain: .3,  baseFrequency: 140, octaves: 2.6 } } },
  // Long deep sub under a log drum
  amaSub:   { drive: .15, bite: 0,   synth: { portamento: .03,  oscillator: { type: "sine" },     envelope: { attack: .01,  decay: .5,  sustain: .85, release: .35 }, filterEnvelope: { attack: .005, decay: .2,  sustain: .6,  baseFrequency: 130, octaves: 1 } } },
  // Gritty saw (gqom)
  // (kept dark on purpose: its saw harmonics must not climb into the singer's 1-4 kHz range)
  growl:    { drive: .35, bite: 0,   synth: { portamento: .02,  oscillator: { type: "sawtooth" }, envelope: { attack: .004, decay: .3,  sustain: .6,  release: .12 }, filterEnvelope: { attack: .004, decay: .25, sustain: .4,  baseFrequency: 120, octaves: 2 } } },
  // Rolling house bass
  rolling:  { drive: .3,  bite: .25, synth: { portamento: .012, oscillator: { type: "sawtooth" }, envelope: { attack: .004, decay: .12, sustain: .3,  release: .1 },  filterEnvelope: { attack: .003, decay: .12, sustain: .25, baseFrequency: 110, octaves: 2 } } }
});

Object.assign(LEAD_PRESETS, {
  flute: { filter: 5200, synth: { level: .73, type: "sine",     vib: 16, attack: .05,  decay: .2,  sustain: .7,  release: .25 } },
  horn:  { filter: 2000, synth: { level: .6,  type: "sawtooth", count: 2, spread: 8, vib: 6, attack: .03, decay: .15, sustain: .6, release: .2 } },
  whistle: { filter: 6500, synth: { level: .6, type: "sine",    vib: 22, attack: .08,  decay: .2,  sustain: .75, release: .3 } }
});

Object.assign(PLUCK_PRESETS, {
  // The signature Afrobeats guitar: two slightly detuned saws, filter snaps shut
  afroGuitar: { filter: 3400, synth: { type: "sawtooth", count: 2, spread: 8, attack: .002, decay: .28, sustain: .02, release: .2, level: .5, filter: { base: 700, octaves: 3.2, decay: .22, sustain: .08 } } },
  // West African harp: bright and ringing
  kora:       { filter: 6000, synth: { type: "sine", fmRatio: 4, fmIndex: .5, fmAttack: .001, fmDecay: .12, fmSustain: .05, attack: .001, decay: .7,  sustain: .01, release: .3,  level: .55 } },
  marimba:    { filter: 4200, synth: { type: "sine", fmRatio: 3.99, fmIndex: .9, fmAttack: .001, fmDecay: .08, fmSustain: .02, attack: .001, decay: .3, sustain: .01, release: .15, level: .65 } },
  nylon:      { filter: 3000, synth: { type: "triangle", attack: .002, decay: .45, sustain: .01, release: .2, level: .6, filter: { base: 400, octaves: 2.8, decay: .35, sustain: .1 } } },
  // The quick piano runs of amapiano
  pianoRun:   { filter: 5000, synth: { type: "sine", fmRatio: 3, fmIndex: 1.1, fmAttack: .002, fmDecay: .2, fmSustain: .06, attack: .003, decay: .5, sustain: .02, release: .25, level: .55 } }
});

// Bells, clave, cowbell. fixed = plays set pitches (Hz) instead of following the chord (real agogos and cowbells are not tuned to the song)
const BELL_KINDS = {
  bell:    { synth: { type: "sine", fmRatio: 6, fmIndex: 3, fmAttack: .001, fmDecay: .2, fmSustain: .01, attack: .001, decay: .25, sustain: .01, release: .2, level: .8 }, gain: 1 },
  agogo:   { synth: { type: "sine", fmRatio: 2.76, fmIndex: 1.8, fmAttack: .001, fmDecay: .12, fmSustain: .02, attack: .001, decay: .2, sustain: .01, release: .12, level: .7 }, gain: 1, fixed: high => (high ? [1175] : [784]) },
  cowbell: { synth: { type: "square", attack: .001, decay: .16, sustain: .02, release: .08, level: .35, filter: { base: 3000, octaves: .8, decay: .1, sustain: .4 } }, gain: 1, fixed: () => [540, 800] },
  clave:   { synth: { type: "sine", fmRatio: 2.3, fmIndex: .6, fmAttack: .0005, fmDecay: .02, fmSustain: .1, attack: .0005, decay: .05, sustain: .001, release: .03, level: .9 }, gain: 1, fixed: high => (high ? [2000] : [1650]) }
};

// Shakers and friends: hp = where the noise starts, attack/decay in seconds, gain = loudness, double = a second jingle burst
const SHAKER_KINDS = {
  shaker:     { hp: 5500, attack: .012, decay: .05, gain: .5 },
  shekere:    { hp: 3000, attack: .022, decay: .11, gain: .6 },
  caxixi:     { hp: 4800, attack: .006, decay: .04, gain: .5 },
  tambourine: { hp: 6500, attack: .003, decay: .09, gain: .45, double: .012 }
};

// Log drum: pd/oct = pitch drop, decay = ring, over = octave-up layer level, snap = wooden click level
const LOG_KINDS = {
  classic: { pd: .06,  oct: 1.5, decay: .35, over: 0,  snap: 0 },
  ama:     { pd: .05,  oct: .55, decay: .5,  over: .3, snap: .25 },
  wood:    { pd: .03,  oct: .9,  decay: .24, over: .4, snap: .5 }
};

// A riff is written as a rhythm plus the chord note each hit plays, so a bass line or log-drum line is
// PLAYED over the chords instead of rolled: r root, 3 third, 5 fifth, 7 seventh, 8 octave, 9 ninth,
// 4 fourth, l low fifth (below the root), b step below the root.
function riffOffset(token, chord) {
  const iv = chord.intervals;
  switch (token) {
    case "r": return 0;
    case "3": return iv[1];
    case "5": return iv[2];
    case "7": return iv[3] !== undefined ? iv[3] : 10;
    case "8": return 12;
    case "9": return 14;
    case "4": return 5;
    case "l": return -5;
    case "b": return -2;
    default:  return 0;
  }
}

// Loudness matching. Every new sound was measured (loudest short-term level of the same test phrase, the way the
// auto-mix measures) against the original sound it replaces, and the difference is taken off here, so picking a
// different kit or instrument changes the SOUND and not the LEVEL. dB, added to the velocity. Only the new sounds are
// listed: the original ones are untouched. (Run audiotest/calib.js to re-measure after changing a preset.)
const LEVEL_DB = {
  bass:     { pluckSub: 2.5, amaSub: 1, growl: 1.5, rolling: 2.5 },
  chords:   { amaPiano: -2.5, guitar: 1, stab: 0.5 },
  pad:      { strings: 0.5, choir: -1 },
  lead:     { horn: -0.5, whistle: -1 },
  pluck:    { kora: -4.5, afroGuitar: -1, marimba: -2, nylon: -1, pianoRun: -2 },
  bellKind: { agogo: 1.5, cowbell: 1, clave: 6 },
  shaker:   { shekere: -4, caxixi: 2 },
  perc:     { conga: -4, bongo: -1, djembe: -5, talking: -5.5, tom: -6 },
  log:      { ama: -1, wood: 0.5 },
  kit: {
    afro:     { clap: 1 },
    ama:      { snare: 3, hat: 1.5, openhat: 1 },
    dembow:   { snare: 3, hat: 3, openhat: 2.5 },
    highlife: { snare: -1.5, hat: -1.5, kick: 1 },
    house:    { snare: 1.5, hat: 4.5, openhat: 3 },
    gqom:     { snare: 2, hat: 6, openhat: 5, kick: -1 }
  }
};

// Your own samples. A loaded sample replaces the synthesized sound of that track (same fader, pan and effects).
// Only the drum and percussion tracks can take a sample: tonal tracks follow the chords, and one recording cannot.
// Kept here (not inside the engine) so every render, including the download, plays the same samples.
const SAMPLE_TRACKS = ["kick", "snare", "clap", "rim", "hat", "openhat", "shaker", "perc", "bell"];
const USER_SAMPLES = {};          // track name -> AudioBuffer

// What the Beat Lab "Sound" menu offers (id, name). The first entry of each is the style's own pick.
const SOUND_MENU = {
  kit:      { label: "Drum kit",    options: [["soft", "Soft"], ["punch", "Punch"], ["boom", "Boom"], ["tight", "Tight"], ["vintage", "Vintage"], ["afro", "Afro warm"], ["ama", "Amapiano soft"], ["dembow", "Dembow 808"], ["highlife", "Highlife live"], ["house", "House 909"], ["gqom", "Gqom hard"]] },
  perc:     { label: "Percussion",  options: [["legacy", "Congas (basic)"], ["conga", "Congas"], ["bongo", "Bongos"], ["djembe", "Djembe"], ["talking", "Talking drum"], ["tom", "Floor tom"]] },
  bellKind: { label: "Bell",        options: [["bell", "Chime bell"], ["agogo", "Agogo"], ["cowbell", "Cowbell"], ["clave", "Clave"]] },
  shaker:   { label: "Shaker",      options: [["shaker", "Shaker"], ["shekere", "Shekere"], ["caxixi", "Caxixi"], ["tambourine", "Tambourine"]] },
  log:      { label: "Log drum",    options: [["classic", "Classic"], ["ama", "Amapiano"], ["wood", "Wooden"]] },
  chords:   { label: "Keys",        options: [["rhodes", "Rhodes"], ["wurli", "Wurlitzer"], ["vibes", "Vibes"], ["darkKeys", "Dark keys"], ["organ", "Organ"], ["amaPiano", "Piano"], ["guitar", "Clean guitar"], ["stab", "House stab"]] },
  pad:      { label: "Pad",         options: [["warm", "Warm"], ["airy", "Airy"], ["dark", "Dark"], ["strings", "Strings"], ["choir", "Choir"]] },
  bass:     { label: "Bass",        options: [["sub808", "808 sub"], ["glide808", "Gliding 808"], ["softSub", "Soft sub"], ["moog", "Moog"], ["pluckSub", "Plucked bass"], ["amaSub", "Deep sub"], ["growl", "Growl"], ["rolling", "Rolling house"]] },
  lead:     { label: "Lead",        options: [["glass", "Glass"], ["vibes", "Vibes"], ["softSaw", "Soft saw"], ["kalimba", "Kalimba"], ["flute", "Flute"], ["horn", "Horn"], ["whistle", "Whistle"]] },
  pluck:    { label: "Pluck",       options: [["kalimba", "Kalimba"], ["bellPluck", "Bell pluck"], ["pluckSaw", "Saw pluck"], ["afroGuitar", "Afro guitar"], ["kora", "Kora"], ["marimba", "Marimba"], ["nylon", "Nylon guitar"], ["pianoRun", "Piano run"]] }
};

// ---------- Light building blocks ----------
// Tone.js synths are rich but heavy: each one is dozens of audio nodes that run all the time, even when they
// are silent. The whole engine used to be about 1,600 of them, which is why a slower computer crackled and the
// download took forever. The pieces below make the same sounds out of a handful of plain Web Audio nodes
// that exist only while a note is sounding.

// A level control in decibels with the same .value / .rampTo() the mixer already uses on Tone synths
class DbParam {
  constructor(gainNode, ctx) { this.node = gainNode; this.ctx = ctx; this._db = 0; }
  get value() { return this._db; }
  set value(db) {
    const g = this.node.gain, t = this.ctx.currentTime;
    this._db = db;
    g.cancelScheduledValues(t);
    g.setValueAtTime(dbGain(db), t);
  }
  rampTo(db, seconds) {
    const g = this.node.gain, t = this.ctx.currentTime;
    this._db = db;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(dbGain(db), t + Math.max(0.005, seconds));
  }
}

// A single filter: a Tone.Filter is 11 nodes, this is 1
class Biquad extends Tone.ToneAudioNode {
  constructor(type, frequency, opts = {}) {
    super();
    this.name = "Biquad";
    const ctx = Tone.getContext().rawContext;
    this.input = this.output = ctx.createBiquadFilter();
    this.input.type = type;
    this.input.frequency.value = frequency;
    this.input.Q.value = opts.Q === undefined ? 1 : opts.Q;
    if (opts.gain !== undefined) this.input.gain.value = opts.gain;
    this.frequency = this.input.frequency;
    this.Q = this.input.Q;
    this.gain = this.input.gain;
  }
}

// A stereo chorus: two short delays swept slowly in opposite directions, panned apart (53 nodes in Tone, 12 here)
class LightChorus extends Tone.ToneAudioNode {
  constructor({ rate = 1.6, delay = 0.012, depth = 0.003, wet = 0.4 } = {}) {
    super();
    this.name = "LightChorus";
    const ctx = Tone.getContext().rawContext;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    const dry = ctx.createGain();
    const wetGain = ctx.createGain();
    this.input.connect(dry); dry.connect(this.output);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    lfo.start();
    [-1, 1].forEach(side => {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = delay;
      const swing = ctx.createGain();
      swing.gain.value = depth * side;
      lfo.connect(swing); swing.connect(d.delayTime);
      const panner = ctx.createStereoPanner();
      panner.pan.value = side * 0.8;
      this.input.connect(d); d.connect(panner); panner.connect(wetGain);
    });
    wetGain.connect(this.output);
    const set = w => { wetGain.gain.value = w; dry.gain.value = 1 - 0.5 * w; };
    set(wet);
    this.wet = { get value() { return wetGain.gain.value; }, set value(w) { set(w); } };
  }
}

// Hold a parameter at whatever value it has right now, and drop everything scheduled after `time`
// (so a new hit can start from where the last one had got to, without a jump)
// Stop whatever was scheduled from `time` on.
// For a VOLUME envelope pass `level`, where the maths says the previous hit has got to at `time`: the old decay
// is replaced by the same exponential curve, cut short at that level. (cancelAndHoldAtTime does this too, but
// Firefox does not have it, and without it a drum that is hit again while still ringing stays at full volume
// until the next hit: a long kick turns into a held tone.)
function holdParam(param, time, level) {
  if (level !== undefined) {
    param.cancelScheduledValues(time);
    if (level > 0) param.exponentialRampToValueAtTime(Math.max(level, 0.0005), time);
    return;
  }
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
  else param.cancelScheduledValues(time);
}

// Noise for hats, snare wires, claps and shakers, WITHOUT making an audio node for every hit.
// One looping noise source (shared by every drum) feeds a permanent volume control; each hit only adds a few
// envelope events to that control. (Tone's NoiseSynth builds and throws away a node set per hit: ~20 ms of
// audio-thread time each, which adds up to crackles live and minutes in the download.)
class NoiseVoice extends Tone.ToneAudioNode {
  constructor(sources, { type = "white", attack = 0.001, decay = 0.1, release = 0.03 } = {}) {
    super();
    this.name = "NoiseVoice";
    const ctx = Tone.getContext().rawContext;
    this.sources = sources;
    this.env = { type, attack, decay, release };
    this.vca = ctx.createGain();                  // the envelope: silent until a hit
    this.vca.gain.value = 0;
    this.out = this.output = ctx.createGain();    // the fader the mixer moves
    this.vca.connect(this.out);
    this.volume = new DbParam(this.out, ctx);
    this.source = null;
    this._attach(type);
  }
  _attach(type) {
    if (this.source) { try { this.source.disconnect(this.vca); } catch (err) { /* not connected */ } }
    this.source = this.sources[type] || this.sources.white;
    this.source.connect(this.vca);
  }
  // Same shape as Tone's NoiseSynth.set(), so the presets read the same
  set({ noise, envelope } = {}) {
    if (noise && noise.type && noise.type !== this.env.type) { this.env.type = noise.type; this._attach(noise.type); }
    if (envelope) Object.assign(this.env, envelope);
    return this;
  }
  // Where the volume is at `time`, given the last hit (so a new hit or a choke can start from there)
  _levelAt(time) {
    const h = this.last;
    if (!h || time <= h.time) return 0;
    const into = time - h.time;
    if (into < h.attack) return h.peak * (into / h.attack);
    if (into < h.attack + h.decay) return h.peak * Math.pow(0.001 / h.peak, (into - h.attack) / h.decay);
    return 0;
  }
  triggerAttackRelease(duration, time, velocity = 1) {
    const g = this.vca.gain, e = this.env;
    const peak = Math.max(0.0002, velocity);
    // Every ramp needs a starting point. Without the setValueAtTime, the browser draws the ramp from the END
    // of the previous hit, so the noise slowly swelled up between hits: a constant wash, like waves.
    const start = this._levelAt(time);
    holdParam(g, time, start);
    g.setValueAtTime(start, time);
    g.linearRampToValueAtTime(peak, time + e.attack);
    g.exponentialRampToValueAtTime(0.001, time + e.attack + e.decay);
    g.linearRampToValueAtTime(0, time + e.attack + e.decay + 0.01);
    this.last = { time, peak, attack: e.attack, decay: e.decay };
  }
  // A quick fade (an open hi-hat being closed, or Stop)
  triggerRelease(time) {
    const g = this.vca.gain, t = time === undefined ? this.vca.context.currentTime : time;
    const start = this._levelAt(t);
    holdParam(g, t, start);
    g.setValueAtTime(start, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.006, this.env.release));
    this.last = null;
  }
}

// Where a drum envelope (rise, fall to 0.001, then to zero) is at `time`, given the hit that started it
function drumLevel(hit, time) {
  if (!hit || time <= hit.time) return 0;
  const into = time - hit.time;
  if (into < hit.attack) return hit.peak * (into / hit.attack);
  if (into < hit.attack + hit.decay) return hit.peak * Math.pow(0.001 / hit.peak, (into - hit.attack) / hit.decay);
  return 0;
}

// Where a note's volume envelope is at `time`, given that note (rise, fall to the sustain level, hold, then release)
function noteLevel(n, time) {
  if (!n || time <= n.t) return 0;
  const { attack, decay, sustain, release } = n.env;
  const sus = Math.max(0.0001, n.peak * sustain), into = time - n.t;
  const atEnd = n.duration >= attack + decay ? sus : n.duration > attack ? n.peak * Math.pow(sus / n.peak, (n.duration - attack) / decay) : n.peak;
  if (into < attack) return n.peak * into / attack;
  if (into <= n.duration) return into < attack + decay ? n.peak * Math.pow(sus / n.peak, (into - attack) / decay) : sus;
  if (into < n.duration + release) return atEnd * Math.pow(0.0001 / atEnd, (into - n.duration) / release);
  return 0;
}

// A volume envelope for one note on a gain parameter: rise, fall to the sustain level, hold until `duration`,
// then die away. If the note is shorter than rise + fall it is released from wherever the fall had got to.
// `startLevel` = where the gain is when this note starts. Every ramp needs a starting point: without one the
// browser draws the ramp from the END of the previous note, so the sound swells up between notes.
function scheduleEnvelope(param, t, duration, peak, { attack, decay, sustain, release }, startLevel) {
  const sus = Math.max(0.0001, peak * sustain);
  holdParam(param, t, startLevel);
  param.setValueAtTime(startLevel, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (duration >= attack + decay) {
    param.exponentialRampToValueAtTime(sus, t + attack + decay);
    if (duration > attack + decay) param.setValueAtTime(sus, t + duration);
  } else if (duration > attack) {
    param.exponentialRampToValueAtTime(Math.max(0.0001, peak * Math.pow(sus / peak, (duration - attack) / decay)), t + duration);
  }
  param.exponentialRampToValueAtTime(0.0001, t + duration + release);
  param.linearRampToValueAtTime(0, t + duration + release + 0.01);
}

// A drum voice with a falling pitch (kick, tom, snare shell, rim, impact). Same idea as NoiseVoice: ONE
// oscillator that runs for the life of the engine; a hit just schedules a pitch drop and a volume envelope.
// (Tone's MembraneSynth starts a new oscillator for every hit and leaves the old ones attached, so the work
// piled up as the song went on.)
class PitchDrum extends Tone.ToneAudioNode {
  constructor({ pitchDecay = 0.05, octaves = 6, attack = 0.001, decay = 0.3, release = 0.1 } = {}) {
    super();
    this.name = "PitchDrum";
    const ctx = Tone.getContext().rawContext;
    this.osc = ctx.createOscillator();
    this.osc.type = "sine";
    this.osc.frequency.value = 40;
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;
    this.out = this.output = ctx.createGain();       // the fader the mixer moves
    this.osc.connect(this.vca); this.vca.connect(this.out);
    this.osc.start(0);
    this.volume = new DbParam(this.out, ctx);
    this.p = { pitchDecay, octaves, attack, decay, release };
    this.last = null;
  }
  // Same shape as Tone's MembraneSynth.set()
  set({ pitchDecay, octaves, envelope } = {}) {
    if (pitchDecay !== undefined) this.p.pitchDecay = pitchDecay;
    if (octaves !== undefined) this.p.octaves = octaves;
    if (envelope) Object.assign(this.p, envelope);
    return this;
  }
  triggerAttackRelease(note, duration, time, velocity = 1) {
    const p = this.p, f = Tone.Frequency(note).toFrequency();
    const pitch = this.osc.frequency, g = this.vca.gain;
    const peak = Math.max(0.0002, velocity);
    holdParam(pitch, time);
    pitch.setValueAtTime(f * Math.pow(2, p.octaves), time);
    pitch.exponentialRampToValueAtTime(f, time + Math.max(0.002, p.pitchDecay));
    const start = drumLevel(this.last, time);
    holdParam(g, time, start);
    g.setValueAtTime(start, time);                    // the anchor: without it the volume swells between hits
    g.linearRampToValueAtTime(peak, time + p.attack);
    g.exponentialRampToValueAtTime(0.001, time + p.attack + p.decay);
    g.linearRampToValueAtTime(0, time + p.attack + p.decay + 0.02);
    this.last = { time, peak, attack: p.attack, decay: p.decay };
  }
  // A hit whose pitch glides from one note to another (a talking drum being squeezed or released)
  bend(fromNote, toNote, glide, decay, time, velocity = 1) {
    const p = this.p, pitch = this.osc.frequency, g = this.vca.gain;
    const f0 = Tone.Frequency(fromNote).toFrequency(), f1 = Tone.Frequency(toNote).toFrequency();
    const peak = Math.max(0.0002, velocity);
    holdParam(pitch, time);
    pitch.setValueAtTime(f0, time);
    pitch.exponentialRampToValueAtTime(f1, time + Math.max(0.01, glide));
    const start = drumLevel(this.last, time);
    holdParam(g, time, start);
    g.setValueAtTime(start, time);
    g.linearRampToValueAtTime(peak, time + 0.003);
    g.exponentialRampToValueAtTime(0.001, time + 0.003 + decay);
    g.linearRampToValueAtTime(0, time + 0.003 + decay + 0.02);
    this.last = { time, peak, attack: 0.003, decay };
  }
  triggerRelease(time) {
    const g = this.vca.gain, t = time === undefined ? this.vca.context.currentTime : time;
    const start = drumLevel(this.last, t);
    holdParam(g, t, start);
    g.setValueAtTime(start, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.006, this.p.release));
    this.last = null;
  }
}

// The bass: ONE oscillator that never stops, a volume envelope, and a low-pass whose cutoff drops after each
// note starts. Notes that follow each other glide (portamento) instead of jumping, which is what the
// click on bass notes was.
class MonoBass extends Tone.ToneAudioNode {
  constructor() {
    super();
    this.name = "MonoBass";
    const ctx = Tone.getContext().rawContext;
    this.osc = ctx.createOscillator();
    this.osc.type = "sine";
    this.osc.frequency.value = 55;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 1;
    this.filter.frequency.value = 600;
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;
    this.out = this.output = ctx.createGain();
    this.osc.connect(this.filter); this.filter.connect(this.vca); this.vca.connect(this.out);
    this.osc.start(0);
    this.volume = new DbParam(this.out, ctx);
    this.p = { portamento: 0.015, env: { attack: 0.006, decay: 0.3, sustain: 0.7, release: 0.4 }, filterEnv: { attack: 0.005, decay: 0.2, sustain: 0.5, baseFrequency: 150, octaves: 2 } };
    this.until = -1;                    // when the last note is due to be released
    this.note = null;                   // the last note (for knowing where its volume is)
    this.freq = 0;
  }
  // Same shape as Tone's MonoSynth.set(), so the presets read the same
  set({ portamento, oscillator, envelope, filterEnvelope } = {}) {
    if (portamento !== undefined) this.p.portamento = portamento;
    if (oscillator && oscillator.type) this.osc.type = oscillator.type;
    if (envelope) Object.assign(this.p.env, envelope);
    if (filterEnvelope) Object.assign(this.p.filterEnv, filterEnvelope);
    return this;
  }
  triggerAttackRelease(note, duration, time, velocity = 0.8) {
    const p = this.p, f = Tone.Frequency(note).toFrequency();
    const pitch = this.osc.frequency, g = this.vca.gain, fc = this.filter.frequency, fe = p.filterEnv;
    const peak = Math.max(0.0002, velocity);
    holdParam(pitch, time);
    if (p.portamento > 0 && this.until > time - 0.001 && this.freq) {
      pitch.setValueAtTime(this.freq, time);                 // glide from the note we were on
      pitch.exponentialRampToValueAtTime(f, time + p.portamento);
    } else {
      pitch.setValueAtTime(f, time);
    }
    scheduleEnvelope(g, time, duration, peak, p.env, noteLevel(this.note, time));
    holdParam(fc, time);                           // the cutoff opens at the start of the note and settles
    fc.setValueAtTime(fe.baseFrequency, time);
    fc.linearRampToValueAtTime(Math.min(18000, fe.baseFrequency * Math.pow(2, fe.octaves)), time + fe.attack);
    fc.exponentialRampToValueAtTime(Math.max(40, fe.baseFrequency * Math.pow(2, fe.octaves * fe.sustain)), time + fe.attack + fe.decay);
    this.until = time + duration;
    this.freq = f;
    this.note = { t: time, duration, peak, env: Object.assign({}, p.env) };
  }
  triggerRelease(time) {
    const g = this.vca.gain, t = time === undefined ? this.vca.context.currentTime : time;
    const start = noteLevel(this.note, t);
    holdParam(g, t, start);
    g.setValueAtTime(start, t);
    g.linearRampToValueAtTime(0, t + 0.03);
    this.until = -1;
    this.note = null;
  }
}

// A synth made of plain nodes, built fresh for every note and thrown away when the note has died.
//   type, count, spread : the oscillator, and how many detuned copies of it (spread = cents from first to last)
//   fmRatio, fmIndex    : optional FM (a second oscillator bends the pitch of the first: bells, electric piano)
//   fmAttack, fmDecay, fmSustain : the FM amount's envelope (a bright "tine" that fades is what makes a piano)
//   attack, decay, sustain, release : the volume envelope
//   filter {base, octaves, decay, sustain, Q} : a low-pass that closes after the note starts (plucks)
//   vib : vibrato depth in cents (fades in)
class LightSynth extends Tone.ToneAudioNode {
  constructor(preset) {
    super();
    this.name = "LightSynth";
    this.ctx = Tone.getContext().rawContext;
    this.out = this.output = this.ctx.createGain();
    this.volume = new DbParam(this.out, this.ctx);
    this.preset = Object.assign({ type: "sine", count: 1, spread: 0, attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3, level: 1 }, preset || {});
    this.live = [];
  }
  set(preset) { this.preset = Object.assign({}, this.preset, preset); return this; }
  // Swap the whole sound (set() only layers on top, so an old filter or FM setting would stay behind)
  replace(preset) { this.preset = Object.assign({ type: "sine", count: 1, spread: 0, attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3, level: 1 }, preset || {}); return this; }

  triggerAttackRelease(notes, duration, time, velocity = 0.8) {
    (Array.isArray(notes) ? notes : [notes]).forEach(note => this._voice(note, duration, time, velocity));
  }

  _voice(note, duration, t, velocity) {
    const ctx = this.ctx, p = this.preset;
    const f = typeof note === "number" ? note : Tone.Frequency(note).toFrequency();
    const peak = Math.max(0.0001, velocity * p.level);
    const end = t + duration + p.release + 0.05;

    // The volume envelope (see scheduleEnvelope)
    const amp = ctx.createGain();
    scheduleEnvelope(amp.gain, t, duration, peak, p, 0.0001);
    amp.connect(this.out);

    const nodes = [amp];
    let tail = amp;
    if (p.filter) {                                 // the low-pass that closes after the attack
      const fl = p.filter, filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.Q.value = fl.Q === undefined ? 1 : fl.Q;
      const top = fl.base * Math.pow(2, fl.octaves), low = fl.base * Math.pow(2, fl.octaves * fl.sustain);
      filt.frequency.setValueAtTime(fl.base, t);
      filt.frequency.linearRampToValueAtTime(Math.min(top, 18000), t + 0.002);
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, low), t + 0.002 + fl.decay);
      filt.connect(amp);
      nodes.push(filt);
      tail = filt;
    }

    const count = Math.max(1, p.count);
    const share = ctx.createGain();
    share.gain.value = 1 / Math.sqrt(count);        // several copies add up louder: keep the level the same
    share.connect(tail);
    nodes.push(share);

    const carriers = [];
    for (let i = 0; i < count; i++) {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = f;
      if (count > 1) o.detune.value = -p.spread / 2 + (p.spread * i) / (count - 1);
      o.connect(share);
      o.start(t);
      o.stop(end);
      carriers.push(o);
      nodes.push(o);
    }

    if (p.fmRatio) {                                // FM: the modulator's volume is the pitch deviation in Hz
      const m = ctx.createOscillator(), mg = ctx.createGain();
      const dev = p.fmIndex * f * p.fmRatio;
      m.frequency.value = f * p.fmRatio;
      mg.gain.setValueAtTime(0.0001, t);
      mg.gain.linearRampToValueAtTime(dev, t + (p.fmAttack || 0.002));
      if (p.fmDecay) mg.gain.exponentialRampToValueAtTime(Math.max(0.0001, dev * (p.fmSustain === undefined ? 1 : p.fmSustain)), t + (p.fmAttack || 0.002) + p.fmDecay);
      m.connect(mg);
      carriers.forEach(o => mg.connect(o.frequency));
      m.start(t); m.stop(end);
      nodes.push(m, mg);
    }

    if (p.vib) {                                    // vibrato that fades in, like a player letting a note bloom
      const v = ctx.createOscillator(), vg = ctx.createGain();
      v.frequency.value = 5.2;
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(p.vib, t + Math.min(0.35, duration));
      v.connect(vg);
      carriers.forEach(o => vg.connect(o.detune));
      v.start(t); v.stop(end);
      nodes.push(v, vg);
    }

    // Free everything when the last oscillator has stopped
    carriers[carriers.length - 1].onended = () => nodes.forEach(n => { try { n.disconnect(); } catch (err) { /* already gone */ } });

    this.live = this.live.filter(v => v.end > ctx.currentTime);
    this.live.push({ end, amp, nodes });
  }

  // Let notes that are still sounding die away (Stop)
  releaseAll() {
    const t = this.ctx.currentTime;
    this.live.forEach(v => {
      try {
        v.amp.gain.cancelScheduledValues(t);
        v.amp.gain.setTargetAtTime(0, t, 0.02);
      } catch (err) { /* already finished */ }
    });
    this.live = [];
  }
}

// ---------- The engine ----------
// opts.live (default true): build the level meters the auto-mix listens to
// opts.reverbDecay: the reverb is built with this decay (changing it later rebuilds the reverb)
function createEngine(opts = {}) {
  const live = opts.live !== false;
  const E = { live };

  // ---- Master chain ----
  // The very last gain: the vocal recorder moves it to balance the beat against a voice. It sits after
  // the ceiling, so turning the beat down never changes how the beat itself is mixed.
  const outGain = new Tone.Gain(1).toDestination();
  // A soft safety ceiling. It leaves everything below 0.7 (-3 dBFS) exactly as it is and only rounds off
  // anything above, so no peak can ever pass 0.9 (-0.9 dBFS).
  const safety = new Tone.WaveShaper(x => {
    const a = Math.abs(x);
    return a <= 0.7 ? x : Math.sign(x) * (0.7 + 0.2 * Math.tanh((a - 0.7) / 0.2));
  }, 4096).connect(outGain);
  safety.oversample = "2x";

  const limiter = new Tone.Limiter(-2).connect(safety);

  // Mastering is OFF by default. Two parallel routes into the limiter: the plain one and a
  // mastered one (a little EQ, a gentle compressor). The Mastering switch crossfades between them.
  const cleanPath = new Tone.Gain(1).connect(limiter);
  const masteredPath = new Tone.Gain(0).connect(limiter);
  const masterComp = new Tone.Compressor({ threshold: -22, ratio: 2, attack: 0.03, release: 0.25 }).connect(masteredPath);
  const masterHigh = new Biquad("highshelf", 8000, { gain: 1.5 }).connect(masterComp);
  const masterLow = new Biquad("lowshelf", 100, { gain: 1 }).connect(masterHigh);

  const compressor = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.01, release: 0.2 });
  compressor.connect(cleanPath);

  const master = new Tone.Gain(MASTER_BASE).connect(compressor);

  // Reverb and delay: shared, fed by small "send" gains
  const reverb = new Tone.Reverb({ decay: opts.reverbDecay || 2.5, preDelay: 0.02 }).connect(master);
  reverb.wet.value = 1;
  const reverbSend = new Tone.Gain(0.3).connect(reverb);
  const delay = new Tone.PingPongDelay({ delayTime: 0.3, feedback: 0.3, wet: 1 }).connect(master);
  const delaySend = new Tone.Gain(0.2).connect(delay);

  // ---- Buses ----
  // Drums: a light compressor to glue them together, plus a touch of saturation
  const drumComp = new Tone.Compressor({ threshold: -16, ratio: 3, attack: 0.02, release: 0.15 }).connect(master);
  const drumDrive = new Tone.Distortion({ distortion: 0.1, wet: 0.12 }).connect(drumComp);
  const drumBus = new Tone.Gain(1).connect(drumDrive);       // its gain follows the section (verse lower, chorus full)

  // Harmony (chords, pad, bell, pluck, lead): high-passed so it leaves room for the bass,
  // ducked every time the kick hits (sidechain), and dipped around 2.5 kHz where a voice sits.
  // (vocalEQ stays a Tone.Filter: the mixer animates its gain with Tone's rampTo.)
  const vocalEQ = new Tone.Filter({ type: "peaking", frequency: 2500, Q: 0.9, gain: -3 }).connect(master);
  const harmonyHP = new Biquad("highpass", 100).connect(vocalEQ);
  const harmonyLevel = new Tone.Gain(1).connect(harmonyHP);  // section level
  const harmonyDuck = new Tone.Gain(1).connect(harmonyLevel); // sidechain pump

  // Bass: top end rounded off, and ducked a little by the kick
  const bassDuck = new Tone.Gain(1).connect(master);
  const bassLP = new Biquad("lowpass", 2500).connect(bassDuck);

  // One white and one pink noise source, looping forever, shared by every noise drum
  const noiseSources = (() => {
    const ctx = Tone.getContext().rawContext;
    const rand = seededRandom(7);
    const make = pink => {
      const length = Math.floor(ctx.sampleRate * 3), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = rand() * 2 - 1;
        if (!pink) { data[i] = white; continue; }
        b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856; b4 = 0.55000 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.start(0);
      return source;
    };
    return { white: make(false), pink: make(true) };
  })();

  // Every track gets its own stereo panner
  const pan = {};
  const panFor = (name, destination) => { pan[name] = new Tone.Panner(0).connect(destination); return pan[name]; };

  // ---- Drums ----
  // Every drum is a small stack of layers, so it sounds like an instrument and not a beep:
  // the layers all feed into the main synth's own output, so one fader still moves the whole drum.

  // Kick: a tuned body (a fast pitch drop) plus a tiny noise "click" from the beater
  const kick = new PitchDrum({ pitchDecay: 0.05, octaves: 6, decay: 0.3, release: 0.1 }).connect(panFor("kick", drumBus));
  const kickClickHP = new Biquad("highpass", 2200).connect(kick.output);
  const kickClick = new NoiseVoice(noiseSources, { type: "white", attack: 0.0005, decay: 0.011, release: 0.005 }).connect(kickClickHP);
  kickClick.volume.value = -15;

  // Snare: a short tuned "thump" of the drum shell, with the rattle of the snare wires on top
  const snare = new PitchDrum({ pitchDecay: 0.012, octaves: 2.2, decay: 0.1, release: 0.05 }).connect(panFor("snare", drumBus));
  const snareNoiseHP = new Biquad("highpass", 900).connect(snare.output);
  const snareNoise = new NoiseVoice(noiseSources, { type: "white", attack: 0.001, decay: 0.15, release: 0.05 }).connect(snareNoiseHP);
  snareNoise.volume.value = -3;

  // Clap: three quick bursts (a real clap is several hands, not one), squeezed into the middle frequencies
  const clapGain = new Tone.Gain(1.6).connect(panFor("clap", drumBus));
  clapGain.connect(reverbSend);                                  // a little room around it
  const clapFilter = new Biquad("bandpass", 1500).connect(clapGain);
  const clap = new NoiseVoice(noiseSources, { type: "pink", attack: 0.002, decay: 0.12, release: 0.03 }).connect(clapFilter);

  // Rim / snap: a very short, high "tok"
  const rim = new PitchDrum({ pitchDecay: 0.005, octaves: 1.2, decay: 0.04, release: 0.02 }).connect(panFor("rim", drumBus));

  // Hi-hats: filtered noise with a metallic shine. The closed hat chokes the open one, like a real pedal.
  const hatLevel = new Tone.Gain(1).connect(panFor("hat", master));
  const hatShine = new Biquad("peaking", 9500, { Q: 1.3, gain: 5 }).connect(hatLevel);
  const hatFilter = new Biquad("highpass", 7000).connect(hatShine);
  const hat = new NoiseVoice(noiseSources, { type: "white", attack: 0.001, decay: 0.05, release: 0.02 }).connect(hatFilter);

  const openhatLevel = new Tone.Gain(1).connect(panFor("openhat", master));
  const openhatShine = new Biquad("peaking", 9000, { Q: 1.1, gain: 4 }).connect(openhatLevel);
  const openhatFilter = new Biquad("highpass", 6400).connect(openhatShine);
  const openhat = new NoiseVoice(noiseSources, { type: "white", attack: 0.001, decay: 0.3, release: 0.012 }).connect(openhatFilter);

  // 808-style metal hats: six square waves at fixed odd ratios, mixed into one bus that a hat voice can open and close
  const raw = Tone.getContext().rawContext;
  const metalBus = raw.createGain();
  metalBus.gain.value = 0.4;
  [205.3, 304.4, 369.6, 522.7, 540, 800].forEach(f => {
    const o = raw.createOscillator();
    o.type = "square"; o.frequency.value = f;
    o.connect(metalBus); o.start(0);
  });
  const metalSources = { white: metalBus };
  const hatM = new NoiseVoice(metalSources, { attack: 0.001, decay: 0.05, release: 0.02 }).connect(hatFilter);
  const openhatM = new NoiseVoice(metalSources, { attack: 0.001, decay: 0.3, release: 0.012 }).connect(openhatFilter);

  // ---- Percussion ----
  const shakerFilter = new Biquad("highpass", 5500).connect(panFor("shaker", master));
  const shaker = new NoiseVoice(noiseSources, { type: "white", attack: 0.012, decay: 0.05, release: 0.02 })   // a soft push, like a real shaker
    .connect(shakerFilter);

  const percFilter = new Biquad("highpass", 120).connect(panFor("perc", master));
  const perc = new PitchDrum({ pitchDecay: 0.02, octaves: 2, decay: 0.12, release: 0.05 }).connect(percFilter);
  // Extra layers for the percussion kinds. They feed perc's own output, so the one perc fader still moves them all.
  const perc2 = new PitchDrum({ pitchDecay: 0.02, octaves: 1.5, decay: 0.12, release: 0.05 }).connect(perc.output);
  const slapBP = new Biquad("bandpass", 2400, { Q: 1.1 }).connect(perc.output);
  const percSlap = new NoiseVoice(noiseSources, { type: "white", attack: 0.001, decay: 0.05, release: 0.02 }).connect(slapBP);

  const bell = new LightSynth({ type: "sine", fmRatio: 6, fmIndex: 3, fmAttack: 0.001, fmDecay: 0.2, fmSustain: 0.01, attack: 0.001, decay: 0.25, sustain: 0.01, release: 0.2, level: 0.8 })
    .connect(panFor("bell", harmonyDuck));

  // ---- Low end ----
  const bassDrive = new Tone.Chebyshev(3).connect(bassLP);
  bassDrive.wet.value = 0.35;
  const bass = new MonoBass().connect(bassDrive);
  panFor("bass", bassDuck);
  // A quiet, short saw an octave up: it gives the sub a "front" you can hear on laptop speakers.
  // It feeds the sub's own output, so the bass fader moves both.
  const bassBite = new LightSynth({
    type: "sawtooth", attack: 0.004, decay: 0.18, sustain: 0.12, release: 0.12,
    filter: { base: 180, octaves: 3, decay: 0.14, sustain: 0.05, Q: 2 }
  }).connect(bass.output);

  const logdrum = new PitchDrum({ pitchDecay: 0.06, octaves: 1.5, attack: 0.002, decay: 0.35, release: 0.1 }).connect(panFor("logdrum", master));
  // An octave-up layer (so it is heard on small speakers) and a wooden click, both on the log drum's own fader
  const logOver = new PitchDrum({ pitchDecay: 0.03, octaves: 0.3, attack: 0.002, decay: 0.2, release: 0.05 }).connect(logdrum.output);
  const logSnapBP = new Biquad("bandpass", 1800, { Q: 1.5 }).connect(logdrum.output);
  const logSnap = new NoiseVoice(noiseSources, { type: "white", attack: 0.0005, decay: 0.02, release: 0.01 }).connect(logSnapBP);

  // ---- Harmony ----
  // Keys: a light chorus (stereo width), then the pan and the reverb
  const chordChorus = new LightChorus({ rate: 1.6, delay: 0.012, depth: 0.003, wet: 0.35 })
    .connect(panFor("chords", harmonyDuck));
  chordChorus.connect(reverbSend);
  const chordFilter = new Biquad("lowpass", 3500).connect(chordChorus);
  const chordSynth = new LightSynth(CHORD_PRESETS.rhodes.synth).connect(chordFilter);

  // Pad: detuned oscillators and a slow chorus make it wide and alive
  const padChorus = new LightChorus({ rate: 0.5, delay: 0.015, depth: 0.004, wet: 0.5 })
    .connect(panFor("pad", harmonyDuck));
  padChorus.connect(reverbSend);
  const padFilter = new Biquad("lowpass", 1100).connect(padChorus);
  const pad = new LightSynth(PAD_PRESETS.warm.synth).connect(padFilter);

  const pluckFilter = new Biquad("lowpass", 3000).connect(panFor("pluck", harmonyDuck));
  pluckFilter.connect(reverbSend);
  pluckFilter.connect(delaySend);
  const pluck = new LightSynth(PLUCK_PRESETS.kalimba.synth).connect(pluckFilter);

  // Lead: has a little vibrato (singers and players never hold a note perfectly still)
  const leadFilter = new Biquad("lowpass", 4500).connect(panFor("lead", harmonyDuck));
  leadFilter.connect(reverbSend);
  leadFilter.connect(delaySend);
  const lead = new LightSynth(LEAD_PRESETS.glass.synth).connect(leadFilter);

  // ---- Effects for transitions: impact boom and crash ----
  // (The old rising noise "riser" is gone: it made every pre-chorus sound the same, and its abrupt end clicked.)
  const fxBus = new Tone.Gain(1).connect(master);
  const crashFilter = new Biquad("highpass", 4500).connect(fxBus);
  const crash = new NoiseVoice(noiseSources, { type: "white", attack: 0.002, decay: 1.4, release: 0.4 }).connect(crashFilter);
  crash.volume.value = -17;
  const impact = new PitchDrum({ pitchDecay: 0.2, octaves: 4, decay: 1.2, release: 0.4 }).connect(fxBus);
  impact.volume.value = -9;

  const instruments = {
    kick, snare, clap, rim, hat, openhat, shaker, perc, bell,
    bass, logdrum, chords: chordSynth, pad, pluck, lead
  };

  // Level meters for the auto-mix (live only): each one listens to a track right after its own
  // sound and processing, before panning and the buses, so it hears the track on its own.
  let trackAnalyser = null, masterAnalyser = null;
  if (live) {
    const meterSource = {
      kick, snare, clap: clapGain, rim, hat: hatLevel, openhat: openhatLevel, shaker: shakerFilter, perc: percFilter,
      bell, bass: bassLP, logdrum, chords: chordFilter, pad: padFilter, pluck: pluckFilter, lead: leadFilter
    };
    trackAnalyser = {};
    Object.entries(meterSource).forEach(([name, node]) => {
      trackAnalyser[name] = new Tone.Analyser("waveform", 2048);   // long enough to hold a whole cycle of a 32 Hz kick
      node.connect(trackAnalyser[name]);
    });
    masterAnalyser = new Tone.Analyser("waveform", 2048);
    safety.connect(masterAnalyser);
  }

  Object.assign(E, {
    instruments, pan, trackAnalyser, masterAnalyser,
    kick, snare, clap, rim, hat, openhat, shaker, perc, bell, bass, logdrum, chordSynth, pad, pluck, lead,
    clapFilter, chordFilter, padFilter, pluckFilter, leadFilter, bassDrive,
    master, compressor, cleanPath, masteredPath, masterLow, vocalEQ,
    reverb, reverbSend, delay, delaySend, drumBus, harmonyLevel, harmonyDuck, bassDuck,
    crash, impact, outGain,
    reverbDecay: opts.reverbDecay || 2.5, masteringOn: false
  });

  // ---- Sound design: apply a beat's sound choices ----
  const safe = fn => { try { fn(); } catch (err) { console.warn("Sound preset skipped:", err.message); } };

  E.applySound = sound => {
    const kit = KIT_PRESETS[sound.kit] || KIT_PRESETS.punch;
    safe(() => kick.set({ pitchDecay: kit.kick.pitchDecay, octaves: kit.kick.octaves, envelope: { decay: kit.kick.decay } }));
    safe(() => { snare.set({ envelope: { decay: kit.snare.bodyDecay } }); E.snareNote = kit.snare.body; });
    safe(() => snareNoise.set({ noise: { type: kit.snare.type }, envelope: { decay: kit.snare.decay } }));
    safe(() => { snareNoiseHP.frequency.value = kit.snare.hp; });
    safe(() => clap.set({ envelope: { decay: kit.clap.decay } }));
    safe(() => { clapFilter.frequency.value = kit.clap.freq; });
    safe(() => rim.set({ envelope: { decay: kit.rim.decay } }));
    safe(() => hat.set({ envelope: { decay: kit.hat.decay } }));
    safe(() => { hatFilter.frequency.value = kit.hat.hp; E.hatBase = kit.hat.hp; });
    safe(() => openhat.set({ envelope: { decay: kit.openhat.decay } }));
    safe(() => { openhatFilter.frequency.value = kit.hat.hp - 700; });
    E.filterBase = { clap: kit.clap.freq, hat: kit.hat.hp, openhat: kit.hat.hp - 700 };
    if (E.refreshSamples) E.refreshSamples();         // a loaded sample keeps its filter opened up
    E.rimNote = kit.rim.note;
    E.openDecay = kit.openhat.decay;
    // Kit details the first five kits did not have (all optional, so old kits sound as before)
    E.kickNote = kit.kick.note || "C1";
    safe(() => { kickClick.volume.value = kit.kick.click === undefined ? -15 : kit.kick.click; });
    E.snareShell = kit.snare.shell === undefined ? 1 : kit.snare.shell;
    E.snareWires = kit.snare.wires === undefined ? 1 : kit.snare.wires;
    E.clapSpread = kit.clap.spread || 0.011;
    E.hatMetal = kit.hat.metal || 0;
    safe(() => hatM.set({ envelope: { decay: kit.hat.decay } }));
    safe(() => openhatM.set({ envelope: { decay: kit.openhat.decay } }));

    // Percussion, bell, shaker and log drum kinds (a beat that does not name one keeps the original sound)
    E.percKind = sound.perc || "legacy";
    E.bellKind = sound.bellKind || "bell";
    E.logKind = sound.log || "classic";
    const bk = BELL_KINDS[E.bellKind] || BELL_KINDS.bell;
    safe(() => bell.replace(bk.synth));
    const sk = SHAKER_KINDS[sound.shaker] || SHAKER_KINDS.shaker;
    safe(() => { shakerFilter.frequency.value = sk.hp; shaker.set({ envelope: { attack: sk.attack, decay: sk.decay } }); });
    E.shakerKind = sk;
    if (USER_SAMPLES.shaker) safe(() => { shakerFilter.frequency.value = 20; });

    // Level matching (see LEVEL_DB): a multiplier on the velocity of each track's voice
    const gdb = db => Math.pow(10, (db || 0) / 20), LD = LEVEL_DB, kitLd = LD.kit[sound.kit] || {};
    E.lvl = {
      bass: gdb((LD.bass[sound.bass])), chords: gdb(LD.chords[sound.chords]), pad: gdb(LD.pad[sound.pad]),
      lead: gdb(LD.lead[sound.lead]), pluck: gdb(LD.pluck[sound.pluck]), bell: gdb(LD.bellKind[sound.bellKind]),
      shaker: gdb(LD.shaker[sound.shaker]), perc: gdb(LD.perc[sound.perc]), logdrum: gdb(LD.log[sound.log]),
      kick: gdb(kitLd.kick), snare: gdb(kitLd.snare), clap: gdb(kitLd.clap), hat: gdb(kitLd.hat), openhat: gdb(kitLd.openhat)
    };

    const ch = CHORD_PRESETS[sound.chords] || CHORD_PRESETS.rhodes;
    safe(() => chordSynth.replace(ch.synth));
    safe(() => { chordFilter.frequency.value = ch.filter; chordChorus.wet.value = ch.chorus; });

    const pd = PAD_PRESETS[sound.pad] || PAD_PRESETS.warm;
    safe(() => pad.replace(pd.synth));
    safe(() => { padFilter.frequency.value = pd.filter; padChorus.wet.value = pd.chorus; });

    const bs = BASS_PRESETS[sound.bass] || BASS_PRESETS.sub808;
    safe(() => bass.set(bs.synth));
    safe(() => { bassDrive.wet.value = bs.drive; });
    E.bassBite = bs.bite;

    const ld = LEAD_PRESETS[sound.lead] || LEAD_PRESETS.glass;
    safe(() => lead.set(Object.assign({ vib: 0, fmRatio: 0, count: 1 }, ld.synth)));
    safe(() => { leadFilter.frequency.value = ld.filter; });

    const pl = PLUCK_PRESETS[sound.pluck] || PLUCK_PRESETS.kalimba;
    safe(() => pluck.set(Object.assign({ fmRatio: 0, count: 1 }, pl.synth)));
    safe(() => { pluckFilter.frequency.value = pl.filter; });
  };

  // Reverb and delay amounts for a style. In a live engine a new decay rebuilds the reverb tail.
  E.applyFx = (fx, bpm) => {
    if (!fx) return;
    safe(() => {
      if (Math.abs(fx.reverb.decay - E.reverbDecay) > 0.01) { reverb.decay = fx.reverb.decay; E.reverbDecay = fx.reverb.decay; }
      reverbSend.gain.value = fx.reverb.send;
      delaySend.gain.value = fx.delay.send;
      delay.feedback.value = fx.delay.feedback;
    });
    if (bpm) E.setTempo(bpm);
  };

  // The delay repeats on dotted eighth notes
  E.setTempo = bpm => { safe(() => { delay.delayTime.value = (60 / bpm) * 0.75; }); };

  E.setMastering = (on, immediately) => {
    const unlink = () => { try { compressor.disconnect(masterLow); } catch (err) { /* it was not connected */ } };
    E.masteringOn = on;
    if (on) compressor.connect(masterLow);
    if (immediately) {
      cleanPath.gain.value = on ? 0 : 1;
      masteredPath.gain.value = on ? 1 : 0;
      if (!on) unlink();
      return;
    }
    cleanPath.gain.rampTo(on ? 0 : 1, 0.05);
    masteredPath.gain.rampTo(on ? 1 : 0, 0.05);
    if (!on) setTimeout(() => { if (!E.masteringOn) unlink(); }, 150);
  };

  // Sidechain "pump": drop the volume of the harmony and bass at the kick, then let it swell back.
  // The dip is a short smooth ramp that starts from wherever the volume is right now. (The old version
  // jumped straight to the low level, and that jump is what you heard as a crack on every kick.)
  E.duck = (time, sc) => {
    [[harmonyDuck, sc.harmony], [bassDuck, sc.bass]].forEach(([node, depth]) => {
      const g = node.gain;
      g.cancelAndHoldAtTime(time);
      g.linearRampToValueAtTime(1 - depth, time + 0.008);
      g.linearRampToValueAtTime(1, time + 0.008 + Math.max(0.05, sc.release));
    });
  };
  E.openDucks = () => {
    [harmonyDuck, bassDuck].forEach(node => {
      node.gain.cancelAndHoldAtTime(Tone.now());
      node.gain.rampTo(1, 0.03);
    });
  };

  // Section levels: verses sit lower (room for a voice), choruses are full
  E.setSection = (sec, time) => {
    if (!sec) return;
    harmonyLevel.gain.rampTo(dbGain(sec.harm), 0.15, time);
    drumBus.gain.rampTo(dbGain(sec.drums), 0.15, time);
  };

  // Transition effects (impact boom and crash). `riser` is kept so older beats do not break, but it plays nothing.
  E.fx = {
    riser: () => {},
    impact: time => impact.triggerAttackRelease("C1", 0.9, time, 0.9),
    crash: time => crash.triggerAttackRelease(1.2, time, 0.8)
  };

  // Let notes that are still ringing (pad, chords, bass) die away
  E.silence = name => {
    const inst = instruments[name];
    if (inst.releaseAll) inst.releaseAll(); else inst.triggerRelease();
    if (name === "bass") bassBite.releaseAll();
  };
  E.stopAll = () => {
    Object.keys(instruments).forEach(E.silence);
  };

  // ---- Voices: how each track turns a hit into sound ----
  //   t : exact time to play    v : velocity (0 to 1)
  //   c : { step, beat, chord, view, dur (seconds), strum (seconds), s16 (one 16th note, seconds) }
  const name = (midi, beat) => midiToName(midi, beat.key.flats);
  const BASS_OFFSET = { root: 0, octave: 12 };

  // The notes of a chord for this bar. voicing 0 = as written, 1 = first inversion (lowest note up an
  // octave), 2 = open (second note up an octave). Rotating the voicing between bars keeps keys from
  // sounding like the same chord played over and over.
  const voiceChord = c => {
    const v = c.view.voicing || 0;
    if (!v || !c.chord.midi || c.chord.midi.length < 3) return c.chord.notes;
    const midi = c.chord.midi.slice().sort((x, y) => x - y);
    if (v === 1) midi.push(midi.shift() + 12);
    else if (v === 2) midi.push(midi.splice(1, 1)[0] + 12);
    return midi.map(m => name(m, c.beat));
  };

  // One hit on a drum with the stroke's own pitch drop and length
  // (E.lvl.perc matches the loudness of this kind of percussion to the others. It scales the SOUND only: which
  // stroke is played is decided by the hit's real velocity, so a quiet hit still plays a ghost note, not a slap.)
  const pl = () => (E.lvl && E.lvl.perc) || 1;
  const stroke = (drum, note, t, vel, pd, oct, decay) => {
    drum.set({ pitchDecay: pd, octaves: oct, envelope: { decay } });
    drum.triggerAttackRelease(note, decay, t, vel * pl());
  };
  const slap = (t, vel, decay, freq) => {
    slapBP.frequency.setValueAtTime(freq || 2400, t);
    percSlap.set({ envelope: { decay } });
    percSlap.triggerAttackRelease(decay, t, vel * pl());
  };
  const PERC_VOICES = {
    // The original single conga (kept so older genres sound exactly as before)
    legacy: (t, v, c) => {
      const onBeat = c.step % 4 === 0;
      stroke(perc, onBeat ? "A3" : "E4", t, v * 0.5, 0.02, 2, 0.12);
    },
    // Congas: open tone on the beat, closed tone between, slap on hard hits, muted touch on ghost notes
    conga: (t, v, c) => {
      if (v < 0.42) { stroke(perc2, "E4", t, v * 0.55, 0.015, 1, 0.05); return; }
      if (c.step % 4 === 0) stroke(perc, "A3", t, v * 0.6, 0.03, 1.5, 0.24);
      else if (v > 0.78) { slap(t, v * 0.5, 0.06, 2600); stroke(perc2, "E4", t, v * 0.45, 0.012, 1.2, 0.07); }
      else stroke(perc2, "E4", t, v * 0.55, 0.02, 1.4, 0.13);
    },
    // Bongos: a higher, drier pair
    bongo: (t, v, c) => {
      const high = c.step % 2 === 1;
      if (v > 0.8) slap(t, v * 0.35, 0.04, 3200);
      stroke(high ? perc2 : perc, high ? "A4" : "E4", t, v * 0.55, 0.012, 1.1, high ? 0.09 : 0.13);
    },
    // Djembe: deep bass tone, ringing tone, sharp slap
    djembe: (t, v, c) => {
      if (c.step % 4 === 0 && v > 0.5) stroke(perc, "D3", t, v * 0.65, 0.045, 1.8, 0.3);
      else if (c.step % 4 === 2 || v < 0.6) stroke(perc2, "A3", t, v * 0.5, 0.02, 1.2, 0.16);
      else { slap(t, v * 0.6, 0.05, 3000); stroke(perc2, "E5", t, v * 0.3, 0.008, 0.8, 0.05); }
    },
    // Talking drum: squeezed up on the beat, let down between, with the stick's tick
    talking: (t, v, c) => {
      const up = c.step % 8 < 4;
      if (c.step % 4 === 0 || v > 0.6) perc2.bend(up ? "F3" : "B3", up ? "A#3" : "F3", 0.11, 0.3, t, v * 0.62 * pl());
      else perc2.bend("D4", "A3", 0.05, 0.12, t, v * 0.5 * pl());
      slap(t, v * 0.18, 0.025, 2200);
    },
    // Floor tom: a low drum with a long pitch fall
    tom: (t, v, c) => stroke(perc, c.step % 8 < 4 ? "F2" : "C3", t, v * 0.65, 0.07, 2.2, 0.4)
  };

  E.voices = {
    // Kick: body + beater click (the click only really speaks on hard hits)
    kick: (t, v, c) => {
      kick.triggerAttackRelease(E.kickNote || "C1", c.s16 * 2, t, v * 0.75);
      kickClick.triggerAttackRelease(0.012, t, v * v * 0.75);
    },
    // Snare: shell + wires. Soft hits are mostly wires, hard hits bring the shell.
    snare: (t, v, c) => {
      snare.triggerAttackRelease(E.snareNote || "A3", 0.1, t, (0.35 + 0.5 * v) * 0.38 * (E.snareShell === undefined ? 1 : E.snareShell));
      snareNoise.triggerAttackRelease(c.s16, t, v * 0.38 * (E.snareWires === undefined ? 1 : E.snareWires));
    },
    // Clap: three bursts a few milliseconds apart
    clap: (t, v, c) => {
      clap.triggerAttackRelease(0.01, t, v * 0.75);
      const sp = E.clapSpread || 0.011;
      clap.triggerAttackRelease(0.01, t + sp, v * 0.85);
      clap.triggerAttackRelease(c.s16, t + sp * 2.1, v);
    },
    rim: (t, v, c) => rim.triggerAttackRelease(E.rimNote || "E5", c.s16 / 2, t, v),
    // Closed hat: chokes any open hat that is still ringing; harder hits are brighter
    hat: (t, v, c) => {
      openhat.triggerRelease(t);
      if (E.hatMetal) openhatM.triggerRelease(t);
      hatFilter.frequency.setValueAtTime((E.hatBase || 7000) - 900 + 1800 * v, t);
      const m = E.hatMetal || 0;
      if (m < 1) hat.triggerAttackRelease(c.s16 / 2, t, v * (1 - 0.6 * m));
      if (m > 0) hatM.triggerAttackRelease(c.s16 / 2, t, v * m * 0.9);
    },
    openhat: (t, v, c) => {
      const m = E.hatMetal || 0, len = (E.openDecay || 0.3) * 1.5;
      if (m < 1) openhat.triggerAttackRelease(len, t, v * (1 - 0.6 * m));
      if (m > 0) openhatM.triggerAttackRelease(len, t, v * m * 0.9);
    },
    shaker:  (t, v, c) => {
      const k = E.shakerKind || SHAKER_KINDS.shaker;
      shaker.triggerAttackRelease(c.s16 / 2, t, v * k.gain);
      if (k.double) shaker.triggerAttackRelease(c.s16 / 3, t + k.double, v * k.gain * 0.6);   // the second jingle of a tambourine
    },
    // Percussion: the track plays whichever drum the beat chose. Real hand drums are not one pitch: each
    // kind below plays two or three different strokes (open, closed, slap) depending on WHERE in the bar
    // the hit lands and HOW hard it is played, so a pattern sounds like a player and not a drum machine.
    perc:    (t, v, c) => PERC_VOICES[E.percKind] ? PERC_VOICES[E.percKind](t, v, c) : PERC_VOICES.legacy(t, v, c),
    bell:    (t, v, c) => {
      const k = BELL_KINDS[E.bellKind] || BELL_KINDS.bell;
      if (!k.fixed) { bell.triggerAttackRelease(c.chord.bell, c.s16, t, v); return; }
      const high = c.step % 2 === 1 || c.step % 8 === 6;
      k.fixed(high).forEach(f => bell.triggerAttackRelease(f, c.s16, t, v * k.gain));
    },

    bass: (t, v, c) => {
      const riff = c.beat.riffs && c.beat.riffs.bass;
      const tone = (c.view.bassTones || c.beat.bassTones)[c.step];
      const iv = c.chord.intervals;
      const offset = riff ? riffOffset(riff.tokens[c.step], c.chord)
        : tone === "fifth" ? iv[2] : tone === "third" ? iv[1]
        : tone === "seventh" ? (iv[3] !== undefined ? iv[3] : 10) - 12 : (BASS_OFFSET[tone] || 0);
      const midi = c.chord.bassMidi + offset;
      bass.triggerAttackRelease(name(midi, c.beat), c.dur, t, v);
      if (E.bassBite) bassBite.triggerAttackRelease(name(midi + 12, c.beat), Math.min(c.dur, 0.3), t, v * E.bassBite);
    },
    logdrum: (t, v, c) => {
      const k = LOG_KINDS[E.logKind] || LOG_KINDS.classic;
      const riff = c.beat.riffs && c.beat.riffs.logdrum;
      // A written riff plays over the chord's root (an octave above the bass); older beats pick chord tones
      const midi = riff ? c.chord.bassMidi + 12 + riffOffset(riff.tokens[c.step], c.chord)
        : c.chord.midi[Math.min(c.beat.logTones[c.step], c.chord.midi.length - 1)] - 12;
      logdrum.set({ pitchDecay: k.pd, octaves: k.oct, envelope: { decay: k.decay } });
      logdrum.triggerAttackRelease(name(midi, c.beat), c.s16 * 2, t, v);
      if (k.over) {
        logOver.set({ pitchDecay: k.pd, octaves: k.oct * 0.6, envelope: { decay: k.decay * 0.5 } });
        logOver.triggerAttackRelease(name(midi + 12, c.beat), 0.1, t, v * k.over);
      }
      if (k.snap) logSnap.triggerAttackRelease(0.02, t, v * k.snap * 0.6);
    },
    chords: (t, v, c) => {
      // Strum: each note of the chord lands slightly after the one before. The direction alternates
      // (down, up) from bar to bar, and the top notes are played a touch softer, like fingers do.
      const notes = voiceChord(c);
      const order = c.view.strumDown === false ? notes.slice().reverse() : notes;
      order.forEach((note, i) => chordSynth.triggerAttackRelease(note, c.dur, t + i * c.strum, v * (1 - 0.05 * i)));
    },
    pad:   (t, v, c) => pad.triggerAttackRelease(c.chord.notes, c.dur, t, v),
    pluck: (t, v, c) => pluck.triggerAttackRelease(name(c.view.pluckNotes[c.step], c.beat), c.dur, t, v),
    lead:  (t, v, c) => {
      const midi = c.view.leadNotes[c.step];
      lead.triggerAttackRelease(name(midi, c.beat), c.dur, t, v);
      // The last time round the hook it is doubled an octave up (once per hit, quieter)
      if (c.view.leadExtra) lead.triggerAttackRelease(name(midi + 12, c.beat), c.dur, t + 0.001, v * 0.5);
    }
  };

  // ---- Your samples ----
  // The synth tracks shape their sound with a filter (a clap is a band-pass, hats a high-pass...). A recording
  // already has its own sound, so while a sample is loaded that filter is opened up so it passes the sample untouched.
  const SAMPLE_FILTER = {
    clap:    { node: clapFilter,    type: "bandpass", freq: 1500, open: ["allpass", 1500] },
    hat:     { node: hatFilter,     type: "highpass", freq: 7000, open: ["highpass", 20] },
    openhat: { node: openhatFilter, type: "highpass", freq: 6400, open: ["highpass", 20] }
  };
  E.filterBase = {};
  E.refreshSamples = () => {
    Object.keys(SAMPLE_FILTER).forEach(track => {
      const f = SAMPLE_FILTER[track], has = Boolean(USER_SAMPLES[track]);
      f.node.input.type = has ? f.open[0] : f.type;
      f.node.input.frequency.value = has ? f.open[1] : (E.filterBase[track] || f.freq);   // the kit's own value once one is set
    });
    // The shaker's high-pass moves with its kind (see applySound), so it is reset there; open it here while a sample plays
    if (USER_SAMPLES.shaker) shakerFilter.frequency.value = 20;
  };
  let openhatPlaying = null;                       // the open-hat sample that a closed hat should cut off
  const playSample = (track, buffer, time, vel) => {
    const src = raw.createBufferSource();
    src.buffer = buffer;
    const gain = raw.createGain();
    gain.gain.value = Math.min(1.5, Math.max(0, vel) * 0.9);
    src.connect(gain);
    gain.connect(instruments[track].output);       // through the track's own fader
    if (track === "hat" && openhatPlaying) { openhatPlaying.gain.cancelScheduledValues(time); openhatPlaying.gain.setTargetAtTime(0, time, 0.008); openhatPlaying = null; }
    if (track === "openhat") openhatPlaying = gain.gain && gain;
    src.start(time);
  };

  // Every voice plays at the loudness its current sound was matched to (E.lvl is filled in by applySound)
  E.lvl = {};
  Object.keys(E.voices).forEach(trackName => {
    if (trackName === "perc") return;                          // percussion applies E.lvl.perc itself (see stroke)
    const raw = E.voices[trackName];
    E.voices[trackName] = (t, v, c) => raw(t, v * (E.lvl[trackName] || 1), c);
  });
  // A loaded sample takes over its track (the sample is its own loudness: no level matching)
  SAMPLE_TRACKS.forEach(trackName => {
    const synth = E.voices[trackName];
    E.voices[trackName] = (t, v, c) => (USER_SAMPLES[trackName] ? playSample(trackName, USER_SAMPLES[trackName], t, v) : synth(t, v, c));
  });
  E.refreshSamples();

  return E;
}

// ---------- Playing one step ----------
// ctx = {
//   template, beat, view,                 what is playing
//   stepSec, swing, humanize,             feel
//   sidechainOn, isAudible(name),         switches
//   floorTime,                            the earliest time a hit may be scheduled (now, live)
//   lastWhen: {}                          per-track last hit time (single voices refuse earlier hits)
// }
function playTrackStep(E, ctx, trackName, step, time) {
  const view = ctx.view;
  if (!view || !ctx.isAudible(trackName) || !view.tracks[trackName][step]) return;

  const chord = step >= 8 ? view.chord2 : view.chord;
  if (!chord) return;                       // not inside a bar (for example just after Stop)

  const cfg = ctx.template.humanize[trackName];
  const velocity = ctx.humanize ? view.velocities[trackName][step] : FLAT_VELOCITY;
  const jitter = ctx.humanize ? view.offsets[trackName][step] : 0;

  // Swing: every second 16th note lands a little late
  const swingDelay = step % 2 === 1 ? ctx.swing * ctx.stepSec : 0;

  // Never schedule a hit in the past, and always later than this track's previous hit
  const wanted = Math.max(time + swingDelay + jitter, ctx.floorTime);
  const when = Math.max(wanted, (ctx.lastWhen[trackName] || 0) + 0.001);
  ctx.lastWhen[trackName] = when;

  // Sidechain: the kick pushes the harmony and bass down for a moment
  if (trackName === "kick" && ctx.sidechainOn) E.duck(when, ctx.template.sidechain);

  const c = {
    step, beat: ctx.beat, chord, view,
    dur: Math.max(0.03, view.durations[trackName][step] * ctx.stepSec * 0.95),
    strum: ctx.humanize ? (cfg.strumMs || 0) / 1000 : 0,
    s16: ctx.stepSec
  };

  // One failed hit must not stop the other tracks, or the playhead, on this step
  try {
    E.voices[trackName](when, velocity, c);

    // Quick doubles / triplets (trap hat rolls)
    const roll = view.doubles && view.doubles[trackName] && view.doubles[trackName][step];
    if (roll) {
      const parts = roll === "triplet" ? [1 / 3, 2 / 3] : [0.5];
      parts.forEach((p, i) => {
        const at = Math.max(when + ctx.stepSec * p, ctx.lastWhen[trackName] + 0.001);
        ctx.lastWhen[trackName] = at;
        E.voices[trackName](at, velocity * (0.7 + 0.1 * i), c);
      });
    }
  } catch (err) {
    console.warn("Skipped a " + trackName + " hit:", err.message);
  }
}

// What happens at the start of a bar: section levels and transition effects
function playBarStart(E, ctx, time) {
  const view = ctx.view;
  if (!view) return;
  E.setSection(view.sec, time);
  const fx = view.fx || {};
  const barSec = ctx.stepSec * 16;
  try {
    if (ctx.fxOn !== false) {
      if (fx.impact) E.fx.impact(time);
      if (fx.crash) E.fx.crash(time);
    }
  } catch (err) {
    console.warn("Skipped a transition effect:", err.message);
  }
}
