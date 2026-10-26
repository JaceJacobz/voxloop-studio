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
// Drum kits: how the drum synths are shaped
const KIT_PRESETS = {
  soft:    { kick: { pitchDecay: .06, octaves: 4, decay: .45 }, snare: { decay: .17, type: "pink" },  clap: { decay: .16, freq: 1300 }, rim: { note: "E5", decay: .04 }, hat: { decay: .05,  resonance: 4500 }, openhat: { decay: .35 } },
  punch:   { kick: { pitchDecay: .03, octaves: 7, decay: .28 }, snare: { decay: .14, type: "white" }, clap: { decay: .12, freq: 1500 }, rim: { note: "E5", decay: .04 }, hat: { decay: .045, resonance: 5500 }, openhat: { decay: .28 } },
  boom:    { kick: { pitchDecay: .09, octaves: 5, decay: .65 }, snare: { decay: .20, type: "white" }, clap: { decay: .14, freq: 1400 }, rim: { note: "A5", decay: .03 }, hat: { decay: .035, resonance: 6500 }, openhat: { decay: .25 } },
  tight:   { kick: { pitchDecay: .02, octaves: 3, decay: .18 }, snare: { decay: .09, type: "pink" },  clap: { decay: .09, freq: 1700 }, rim: { note: "D5", decay: .05 }, hat: { decay: .04,  resonance: 4000 }, openhat: { decay: .20 } },
  vintage: { kick: { pitchDecay: .04, octaves: 5, decay: .30 }, snare: { decay: .20, type: "white" }, clap: { decay: .20, freq: 1200 }, rim: { note: "E5", decay: .05 }, hat: { decay: .06,  resonance: 3500 }, openhat: { decay: .40 } }
};

// Keys / chords (an FM synth)
const CHORD_PRESETS = {
  rhodes:   { filter: 3500, synth: { harmonicity: 3,    modulationIndex: 1.2, oscillator: { type: "sine" },     envelope: { attack: .01,  decay: 1.0, sustain: .25, release: 1.0 }, modulationEnvelope: { attack: .01,  decay: .5,  sustain: .2,  release: .5 } } },
  wurli:    { filter: 3000, synth: { harmonicity: 2,    modulationIndex: 2.4, oscillator: { type: "sine" },     envelope: { attack: .005, decay: .7,  sustain: .18, release: .6 }, modulationEnvelope: { attack: .005, decay: .35, sustain: .1,  release: .4 } } },
  vibes:    { filter: 5200, synth: { harmonicity: 5.01, modulationIndex: .7,  oscillator: { type: "sine" },     envelope: { attack: .004, decay: 1.4, sustain: .08, release: 1.2 }, modulationEnvelope: { attack: .004, decay: .6,  sustain: .1,  release: .6 } } },
  darkKeys: { filter: 1700, synth: { harmonicity: 1,    modulationIndex: .7,  oscillator: { type: "sine" },     envelope: { attack: .02,  decay: 1.2, sustain: .3,  release: 1.4 }, modulationEnvelope: { attack: .02,  decay: .8,  sustain: .2,  release: .8 } } },
  organ:    { filter: 2800, synth: { harmonicity: 2,    modulationIndex: .3,  oscillator: { type: "triangle" }, envelope: { attack: .015, decay: .2,  sustain: .7,  release: .25 }, modulationEnvelope: { attack: .015, decay: .2, sustain: .5,  release: .25 } } }
};

// Pads (a slow synth under everything)
const PAD_PRESETS = {
  warm: { filter: 1100, synth: { oscillator: { type: "sawtooth" }, envelope: { attack: .7,  decay: .5, sustain: .8,  release: 1.5 } } },
  airy: { filter: 2400, synth: { oscillator: { type: "triangle" }, envelope: { attack: 1.0, decay: .6, sustain: .85, release: 2.0 } } },
  dark: { filter: 650,  synth: { oscillator: { type: "sawtooth" }, envelope: { attack: 1.2, decay: .8, sustain: .75, release: 2.2 } } }
};

// Bass (a mono synth). portamento = glide between notes, drive = how much it is saturated
const BASS_PRESETS = {
  sub808:    { drive: .35, synth: { portamento: 0,   oscillator: { type: "sine" },     envelope: { attack: .005, decay: .3,  sustain: .7, release: .4 }, filterEnvelope: { attack: .005, decay: .2,  sustain: .5, baseFrequency: 150, octaves: 2 } } },
  glide808:  { drive: .55, synth: { portamento: .06, oscillator: { type: "sine" },     envelope: { attack: .005, decay: .6,  sustain: .6, release: .5 }, filterEnvelope: { attack: .005, decay: .3,  sustain: .5, baseFrequency: 150, octaves: 2 } } },
  softSub:   { drive: .25, synth: { portamento: 0,   oscillator: { type: "triangle" }, envelope: { attack: .008, decay: .25, sustain: .4, release: .25 }, filterEnvelope: { attack: .005, decay: .15, sustain: .4, baseFrequency: 120, octaves: 1.5 } } },
  moog:      { drive: .2,  synth: { portamento: .01, oscillator: { type: "sawtooth" }, envelope: { attack: .005, decay: .15, sustain: .3, release: .15 }, filterEnvelope: { attack: .003, decay: .15, sustain: .2, baseFrequency: 100, octaves: 3 } } }
};

// The hook / lead
const LEAD_PRESETS = {
  glass:   { filter: 4500, synth: { oscillator: { type: "triangle" }, envelope: { attack: .004, decay: .9,  sustain: .25, release: .9 } } },
  vibes:   { filter: 6000, synth: { oscillator: { type: "sine" },     envelope: { attack: .003, decay: 1.2, sustain: .05, release: 1.0 } } },
  softSaw: { filter: 2300, synth: { oscillator: { type: "sawtooth" }, envelope: { attack: .03,  decay: .3,  sustain: .55, release: .7 } } },
  kalimba: { filter: 3500, synth: { oscillator: { type: "triangle" }, envelope: { attack: .003, decay: .45, sustain: 0,   release: .25 } } }
};

// The arpeggio / pluck
const PLUCK_PRESETS = {
  kalimba:   { filter: 3000, synth: { oscillator: { type: "triangle" }, envelope: { attack: .003, decay: .35, sustain: 0, release: .2 } } },
  bellPluck: { filter: 5000, synth: { oscillator: { type: "sine" },     envelope: { attack: .002, decay: .5,  sustain: 0, release: .3 } } },
  pluckSaw:  { filter: 2200, synth: { oscillator: { type: "sawtooth" }, envelope: { attack: .002, decay: .2,  sustain: 0, release: .15 } } }
};

// ---------- The engine ----------
// opts.live (default true): build the level meters the auto-mix listens to
// opts.reverbDecay: the reverb is built with this decay (changing it later rebuilds the reverb)
function createEngine(opts = {}) {
  const live = opts.live !== false;
  const E = { live };

  // ---- Master chain ----
  // The very last stage: a soft safety ceiling. It leaves everything below 0.7 (-3 dBFS) exactly
  // as it is and only rounds off anything above, so no peak can ever pass 0.9 (-0.9 dBFS).
  const safety = new Tone.WaveShaper(x => {
    const a = Math.abs(x);
    return a <= 0.7 ? x : Math.sign(x) * (0.7 + 0.2 * Math.tanh((a - 0.7) / 0.2));
  }, 4096).toDestination();
  safety.oversample = "2x";

  const limiter = new Tone.Limiter(-2).connect(safety);

  // Mastering is OFF by default. Two parallel routes into the limiter: the plain one and a
  // mastered one (a little EQ, a gentle compressor). The Mastering switch crossfades between them.
  const cleanPath = new Tone.Gain(1).connect(limiter);
  const masteredPath = new Tone.Gain(0).connect(limiter);
  const masterComp = new Tone.Compressor({ threshold: -22, ratio: 2, attack: 0.03, release: 0.25 }).connect(masteredPath);
  const masterHigh = new Tone.Filter({ type: "highshelf", frequency: 8000, gain: 1.5 }).connect(masterComp);
  const masterLow = new Tone.Filter({ type: "lowshelf", frequency: 100, gain: 1 }).connect(masterHigh);

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
  const vocalEQ = new Tone.Filter({ type: "peaking", frequency: 2500, Q: 0.9, gain: -3 }).connect(master);
  const harmonyHP = new Tone.Filter(100, "highpass").connect(vocalEQ);
  const harmonyLevel = new Tone.Gain(1).connect(harmonyHP);  // section level
  const harmonyDuck = new Tone.Gain(1).connect(harmonyLevel); // sidechain pump

  // Bass: top end rounded off, and ducked a little by the kick
  const bassDuck = new Tone.Gain(1).connect(master);
  const bassLP = new Tone.Filter(2500, "lowpass").connect(bassDuck);

  // Every track gets its own stereo panner
  const pan = {};
  const panFor = (name, destination) => { pan[name] = new Tone.Panner(0).connect(destination); return pan[name]; };

  // ---- Drums ----
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05, octaves: 6,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 }
  }).connect(panFor("kick", drumBus));

  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 }
  }).connect(panFor("snare", drumBus));

  // Clap: noise squeezed into the middle frequencies (the filter removes volume, so a gain makes it back up)
  const clapGain = new Tone.Gain(6).connect(panFor("clap", drumBus));
  const clapFilter = new Tone.Filter(1500, "bandpass").connect(clapGain);
  const clap = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.002, decay: 0.12, sustain: 0 }
  }).connect(clapFilter);

  // Rim / snap: a very short, high "tok"
  const rim = new Tone.MembraneSynth({
    pitchDecay: 0.005, octaves: 1.2,
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }
  }).connect(panFor("rim", drumBus));

  // Hi-hats (metallic noise: short = closed, long = open)
  const hat = new Tone.MetalSynth({
    frequency: 250, harmonicity: 5.1, modulationIndex: 32, resonance: 5000, octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 }
  }).connect(panFor("hat", master));

  const openhat = new Tone.MetalSynth({
    frequency: 250, harmonicity: 5.1, modulationIndex: 32, resonance: 5000, octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.3, release: 0.1 }
  }).connect(panFor("openhat", master));

  // ---- Percussion ----
  const shakerFilter = new Tone.Filter(7000, "highpass").connect(panFor("shaker", master));
  const shaker = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.005, decay: 0.05, sustain: 0 }
  }).connect(shakerFilter);

  const percFilter = new Tone.Filter(120, "highpass").connect(panFor("perc", master));
  const perc = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 2,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 }
  }).connect(percFilter);

  const bell = new Tone.FMSynth({
    harmonicity: 6, modulationIndex: 3,
    envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
    modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
  }).connect(panFor("bell", harmonyDuck));

  // ---- Low end ----
  const bassDrive = new Tone.Chebyshev(3).connect(bassLP);
  bassDrive.wet.value = 0.35;
  const bass = new Tone.MonoSynth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.4 },
    filter: { type: "lowpass", Q: 1, rolloff: -12 },
    filterEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.5, baseFrequency: 150, octaves: 2 }
  }).connect(bassDrive);
  panFor("bass", bassDuck);

  const logdrum = new Tone.MembraneSynth({
    pitchDecay: 0.06, octaves: 1.5,
    envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.1 }
  }).connect(panFor("logdrum", master));

  // ---- Harmony ----
  const chordFilter = new Tone.Filter(3500, "lowpass").connect(panFor("chords", harmonyDuck));
  chordFilter.connect(reverbSend);
  const chordSynth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3, modulationIndex: 1.2,
    oscillator: { type: "sine" },
    envelope: { attack: 0.01, decay: 1.0, sustain: 0.25, release: 1.0 },
    modulation: { type: "sine" },
    modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 0.5 }
  }).connect(chordFilter);

  const padFilter = new Tone.Filter(1100, "lowpass").connect(panFor("pad", harmonyDuck));
  padFilter.connect(reverbSend);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.7, decay: 0.5, sustain: 0.8, release: 1.5 }
  }).connect(padFilter);

  const pluckFilter = new Tone.Filter(3000, "lowpass").connect(panFor("pluck", harmonyDuck));
  pluckFilter.connect(reverbSend);
  pluckFilter.connect(delaySend);
  const pluck = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.003, decay: 0.35, sustain: 0, release: 0.2 }
  }).connect(pluckFilter);

  const leadFilter = new Tone.Filter(4500, "lowpass").connect(panFor("lead", harmonyDuck));
  leadFilter.connect(reverbSend);
  leadFilter.connect(delaySend);
  // Polyphonic, so the octave double in the final chorus layers on top and long notes can overlap
  const lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.004, decay: 0.9, sustain: 0.25, release: 0.9 }
  }).connect(leadFilter);

  // ---- Effects for transitions: riser sweep, impact boom, crash ----
  const fxBus = new Tone.Gain(1).connect(master);
  const riserGain = new Tone.Gain(0).connect(fxBus);
  const riserFilter = new Tone.Filter({ type: "bandpass", frequency: 300, Q: 1.2 }).connect(riserGain);
  riserFilter.connect(reverbSend);
  const riserNoise = new Tone.Noise("white").connect(riserFilter);
  const crashFilter = new Tone.Filter(4500, "highpass").connect(fxBus);
  const crash = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 1.4, sustain: 0 } }).connect(crashFilter);
  crash.volume.value = -17;
  const impact = new Tone.MembraneSynth({
    pitchDecay: 0.2, octaves: 4, envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 0.4 }
  }).connect(fxBus);
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
      kick, snare, clap: clapGain, rim, hat, openhat, shaker: shakerFilter, perc: percFilter,
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
    riserNoise, riserFilter, riserGain, crash, impact,
    reverbDecay: opts.reverbDecay || 2.5, masteringOn: false
  });

  // ---- Sound design: apply a beat's sound choices ----
  const safe = fn => { try { fn(); } catch (err) { console.warn("Sound preset skipped:", err.message); } };

  E.applySound = sound => {
    const kit = KIT_PRESETS[sound.kit] || KIT_PRESETS.punch;
    safe(() => kick.set({ pitchDecay: kit.kick.pitchDecay, octaves: kit.kick.octaves, envelope: { decay: kit.kick.decay } }));
    safe(() => snare.set({ noise: { type: kit.snare.type }, envelope: { decay: kit.snare.decay } }));
    safe(() => clap.set({ envelope: { decay: kit.clap.decay } }));
    safe(() => { clapFilter.frequency.value = kit.clap.freq; });
    safe(() => rim.set({ envelope: { decay: kit.rim.decay } }));
    safe(() => hat.set({ envelope: { decay: kit.hat.decay }, resonance: kit.hat.resonance }));
    safe(() => openhat.set({ envelope: { decay: kit.openhat.decay }, resonance: kit.hat.resonance }));
    E.rimNote = kit.rim.note;

    const ch = CHORD_PRESETS[sound.chords] || CHORD_PRESETS.rhodes;
    safe(() => chordSynth.set(ch.synth));
    safe(() => { chordFilter.frequency.value = ch.filter; });

    const pd = PAD_PRESETS[sound.pad] || PAD_PRESETS.warm;
    safe(() => pad.set(pd.synth));
    safe(() => { padFilter.frequency.value = pd.filter; });

    const bs = BASS_PRESETS[sound.bass] || BASS_PRESETS.sub808;
    safe(() => bass.set(bs.synth));
    safe(() => { bassDrive.wet.value = bs.drive; });

    const ld = LEAD_PRESETS[sound.lead] || LEAD_PRESETS.glass;
    safe(() => lead.set(ld.synth));
    safe(() => { leadFilter.frequency.value = ld.filter; });

    const pl = PLUCK_PRESETS[sound.pluck] || PLUCK_PRESETS.kalimba;
    safe(() => pluck.set(pl.synth));
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
    E.masteringOn = on;
    if (on) compressor.connect(masterLow);
    if (immediately) {
      cleanPath.gain.value = on ? 0 : 1;
      masteredPath.gain.value = on ? 1 : 0;
      if (!on) safe(() => compressor.disconnect(masterLow));
      return;
    }
    cleanPath.gain.rampTo(on ? 0 : 1, 0.05);
    masteredPath.gain.rampTo(on ? 1 : 0, 0.05);
    if (!on) setTimeout(() => { if (!E.masteringOn) safe(() => compressor.disconnect(masterLow)); }, 150);
  };

  // Sidechain "pump": drop the volume of the harmony and bass at the kick, then let it swell back.
  E.duck = (time, sc) => {
    [[harmonyDuck, sc.harmony], [bassDuck, sc.bass]].forEach(([node, depth]) => {
      node.gain.cancelScheduledValues(time);
      node.gain.setValueAtTime(1 - depth, time);
      node.gain.linearRampToValueAtTime(1, time + sc.release);
    });
  };
  E.openDucks = () => {
    [harmonyDuck, bassDuck].forEach(node => { node.gain.cancelScheduledValues(Tone.now()); node.gain.value = 1; });
  };

  // Section levels: verses sit lower (room for a voice), choruses are full
  E.setSection = (sec, time) => {
    if (!sec) return;
    harmonyLevel.gain.rampTo(dbGain(sec.harm), 0.15, time);
    drumBus.gain.rampTo(dbGain(sec.drums), 0.15, time);
  };

  // Transition effects
  E.fx = {
    riser: (time, seconds) => {
      riserNoise.start(time);
      riserNoise.stop(time + seconds + 0.05);
      riserFilter.frequency.cancelScheduledValues(time);
      riserFilter.frequency.setValueAtTime(300, time);
      riserFilter.frequency.exponentialRampToValueAtTime(9000, time + seconds);
      riserGain.gain.cancelScheduledValues(time);
      riserGain.gain.setValueAtTime(0.0001, time);
      riserGain.gain.exponentialRampToValueAtTime(0.3, time + seconds);
      riserGain.gain.setValueAtTime(0, time + seconds + 0.02);
    },
    impact: time => impact.triggerAttackRelease("C1", 0.9, time, 0.9),
    crash: time => crash.triggerAttackRelease(1.2, time, 0.8)
  };

  // Let notes that are still ringing (pad, chords, bass) die away
  E.silence = name => {
    const inst = instruments[name];
    if (inst.releaseAll) inst.releaseAll(); else inst.triggerRelease();
  };
  E.stopAll = () => {
    Object.keys(instruments).forEach(E.silence);
    safe(() => { riserNoise.stop(); riserGain.gain.cancelScheduledValues(Tone.now()); riserGain.gain.value = 0; });
  };

  // ---- Voices: how each track turns a hit into sound ----
  //   t : exact time to play    v : velocity (0 to 1)
  //   c : { step, beat, chord, view, dur (seconds), strum (seconds), s16 (one 16th note, seconds) }
  const name = (midi, beat) => midiToName(midi, beat.key.flats);
  const BASS_OFFSET = { root: 0, octave: 12 };

  E.voices = {
    kick:    (t, v, c) => kick.triggerAttackRelease("C1", c.s16 * 2, t, v),
    snare:   (t, v, c) => snare.triggerAttackRelease(c.s16, t, v),
    clap:    (t, v, c) => clap.triggerAttackRelease(c.s16, t, v),
    rim:     (t, v, c) => rim.triggerAttackRelease(E.rimNote || "E5", c.s16 / 2, t, v),
    // MetalSynth takes (frequency, duration, time, velocity), unlike the noise synths
    hat:     (t, v, c) => hat.triggerAttackRelease(250, c.s16 / 2, t, v),
    openhat: (t, v, c) => openhat.triggerAttackRelease(250, c.s16 * 2, t, v),
    shaker:  (t, v, c) => shaker.triggerAttackRelease(c.s16 / 2, t, v),
    perc:    (t, v, c) => perc.triggerAttackRelease("G3", c.s16, t, v),
    bell:    (t, v, c) => bell.triggerAttackRelease(c.chord.bell, c.s16, t, v),

    bass: (t, v, c) => {
      const tone = c.beat.bassTones[c.step];
      const iv = c.chord.intervals;
      const offset = tone === "fifth" ? iv[2] : tone === "third" ? iv[1]
        : tone === "seventh" ? (iv[3] !== undefined ? iv[3] : 10) - 12 : (BASS_OFFSET[tone] || 0);
      bass.triggerAttackRelease(name(c.chord.bassMidi + offset, c.beat), c.dur, t, v);
    },
    logdrum: (t, v, c) => {
      const midi = c.chord.midi[Math.min(c.beat.logTones[c.step], c.chord.midi.length - 1)] - 12;
      logdrum.triggerAttackRelease(name(midi, c.beat), c.s16 * 2, t, v);
    },
    chords: (t, v, c) => {
      // Strum: each note of the chord lands slightly after the one before
      c.chord.notes.forEach((note, i) => chordSynth.triggerAttackRelease(note, c.dur, t + i * c.strum, v));
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
    if (fx.riser) E.fx.riser(time, fx.riser * barSec);
    if (fx.impact) E.fx.impact(time);
    if (fx.crash) E.fx.crash(time);
  } catch (err) {
    console.warn("Skipped a transition effect:", err.message);
  }
}
