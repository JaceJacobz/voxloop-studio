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

// Your own samples. A sample you load replaces the built-in recording of that drum for every beat (same fader, pan and
// effects). The list is the drum and percussion tracks (the tonal tracks follow the chords, and one recording cannot).
// Kept here (not inside the engine) so every render, including the download, plays the same samples.
const SAMPLE_TRACKS = ["kick", "snare", "clap", "rim", "hat", "openhat", "shaker", "perc", "bell"];
const USER_SAMPLES = {};          // track name -> AudioBuffer

// What the Beat Lab "Sound" menu offers for the tonal parts: the recorded instruments (filled in by producer.js).
// Every part is a recording; there are no synthesized instruments.
const SOUND_MENU = {
  log:      { label: "Log drum", options: [] },
  chords:   { label: "Keys",     options: [] },
  pad:      { label: "Pad",      options: [] },
  bass:     { label: "Bass",     options: [] },
  lead:     { label: "Lead",     options: [] },
  pluck:    { label: "Pluck",    options: [] }
};

// ---------- Light building blocks ----------
// The pieces below are small Web Audio nodes (fader, filter, chorus, sample players) that exist only while a note is sounding.

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

// A drum or percussion track that plays recordings. It owns the track's fader (volume) and keeps track of the hits
// that are still sounding, so an open hi-hat can be cut off by a closed one and Stop can fade everything out.
class SampleTrack extends Tone.ToneAudioNode {
  constructor() {
    super();
    this.name = "SampleTrack";
    const ctx = Tone.getContext().rawContext;
    this.ctx = ctx;
    this.out = this.output = ctx.createGain();      // the fader the mixer moves
    this.volume = new DbParam(this.out, ctx);
    this.live = [];
  }
  // Play one recording at `time`. gain = hit strength, rate = playback speed (1 = as recorded)
  play(buffer, time, gain, rate = 1) {
    const ctx = this.ctx, src = ctx.createBufferSource(), amp = ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    amp.gain.value = gain;
    src.connect(amp); amp.connect(this.out);
    src.start(time);
    this.live = this.live.filter(v => v.end > ctx.currentTime);
    this.live.push({ src, amp, end: time + buffer.duration / rate });
    src.onended = () => { try { amp.disconnect(); } catch (err) { /* already gone */ } };
  }
  // Fade out whatever is sounding from `time` on (an open hat being closed, or Stop)
  choke(time, tc = 0.01) {
    const ctx = this.ctx, t = time === undefined ? ctx.currentTime : time;
    this.live.forEach(v => {
      if (v.end <= t) return;
      try {
        v.amp.gain.cancelScheduledValues(t);
        v.amp.gain.setTargetAtTime(0, t, tc);
        v.src.stop(t + tc * 8);
      } catch (err) { /* already finished */ }
    });
    this.live = this.live.filter(v => v.end <= t);
  }
  releaseAll() { this.choke(undefined, 0.012); }
  triggerRelease(time) { this.choke(time, 0.012); }
}

// A recorded instrument (piano, trumpet, violin, 808 ...). Same playing interface as LightSynth, but each note is the
// nearest real recording, re-pitched by the few semitones in between (see instrumentbank.js).
//   kind "decay"   : plucked / struck sounds ring out by themselves; the note is cut with a short fade at its end
//   kind "sustain" : bowed / blown sounds are held for the length of the note (the middle of the recording is looped
//                    when the note is longer than the recording) and fade out when it ends
//   kind "808"     : one long low recording that is re-pitched over the whole range; notes that follow each other glide
class SampledInstrument extends Tone.ToneAudioNode {
  constructor() {
    super();
    this.name = "SampledInstrument";
    const ctx = Tone.getContext().rawContext;
    this.ctx = ctx;
    this.out = this.output = ctx.createGain();
    this.volume = new DbParam(this.out, ctx);
    this.live = [];
    this.id = null;
    this.opts = {};
  }
  // opts: { attack, release, gain (dB), glide (seconds), maxRate }
  use(id, opts) { this.id = id; this.opts = Object.assign({}, opts || {}); this.set_ = instrumentSet(id); return this; }
  get ready() { return Boolean(this.set_); }

  triggerAttackRelease(notes, duration, time, velocity = 0.8) {
    if (!this.id) return;
    if (!this.set_ || (this.set_.notes.length < instrumentInfo(this.id).notes.length)) this.set_ = instrumentSet(this.id);   // late downloads join in
    if (!this.set_) return;
    (Array.isArray(notes) ? notes : [notes]).forEach(n => this._note(n, duration, time, velocity));
  }

  _note(note, duration, t, velocity) {
    const ctx = this.ctx, set = this.set_, info = set.info, o = this.opts;
    let midi = Tone.Frequency(note).toMidi();
    // A player moves a part into the range the instrument can play: shift by octaves until it sits inside it
    // (a bit of room at both ends, the recordings can be re-pitched a few semitones)
    const lowest = set.notes[0], highest = set.notes[set.notes.length - 1];
    if (info.kind === "808") { while (midi > 41) midi -= 12; while (midi < 24) midi += 12; }
    else { while (midi < lowest - 4) midi += 12; while (midi > highest + 5) midi -= 12; }
    // nearest recording
    let root = set.notes[0];
    set.notes.forEach(n => { if (Math.abs(n - midi) < Math.abs(root - midi)) root = n; });
    const buffer = set.buffers[root];
    const rate = Math.pow(2, (midi - root) / 12);
    const kind = info.kind;
    const gain = Math.max(0.0001, velocity * Math.pow(10, (o.gain || 0) / 20));
    const attack = o.attack !== undefined ? o.attack : (kind === "sustain" ? 0.04 : 0.002);
    const release = o.release !== undefined ? o.release : (kind === "sustain" ? 0.22 : kind === "808" ? 0.09 : 0.3);
    const hold = Math.max(0.05, duration);
    const natural = buffer.duration / rate;

    const src = ctx.createBufferSource(), amp = ctx.createGain();
    src.buffer = buffer;
    // 808 glide: a note that starts while the last one still rings slides up or down from it
    if (kind === "808" && o.glide && this.lastRate && this.lastEnd > t - 0.02) {
      src.playbackRate.setValueAtTime(this.lastRate, t);
      src.playbackRate.linearRampToValueAtTime(rate, t + o.glide);
    } else src.playbackRate.value = rate;
    if (kind === "808") { this.lastRate = rate; this.lastEnd = t + hold; }

    // Notes longer than the recording: loop its steady middle
    let end = t + Math.min(natural, hold + release);
    if (kind === "sustain" && hold + release > natural) {
      src.loop = true;
      src.loopStart = buffer.duration * 0.4;
      src.loopEnd = buffer.duration * 0.92;
      end = t + hold + release;
    }
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(gain, t + Math.max(0.001, attack));
    // keep the level until the note ends, then fade (a decay sound that has already died away just stays quiet)
    amp.gain.setValueAtTime(gain, t + Math.max(attack, hold));
    amp.gain.linearRampToValueAtTime(0.0001, t + Math.max(attack, hold) + release);
    end = Math.min(end, t + Math.max(attack, hold) + release + 0.02);
    src.connect(amp); amp.connect(this.out);
    src.start(t);
    src.stop(end + 0.02);
    src.onended = () => { try { amp.disconnect(); } catch (err) { /* already gone */ } };
    this.live = this.live.filter(v => v.end > ctx.currentTime);
    this.live.push({ end, amp, src });
  }

  releaseAll() {
    const t = this.ctx.currentTime;
    this.live.forEach(v => {
      try { v.amp.gain.cancelScheduledValues(t); v.amp.gain.setTargetAtTime(0, t, 0.02); v.src.stop(t + 0.2); } catch (err) { /* finished */ }
    });
    this.live = [];
    this.lastEnd = 0;
  }
  triggerRelease() { this.releaseAll(); }
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

  // A gentle high shelf ("air") ahead of the master compressor. Each genre sets its own amount (fx.air, dB; genrefeel.js):
  // R&B and Afro-Lust are dark by nature and lose their top end on a phone speaker.
  const airShelf = new Biquad("highshelf", 9000, { gain: 0 }).connect(compressor);
  const master = new Tone.Gain(MASTER_BASE).connect(airShelf);

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


  // Every track gets its own stereo panner
  const pan = {};
  const panFor = (name, destination) => { pan[name] = new Tone.Panner(0).connect(destination); return pan[name]; };

  // ---- Drums and percussion: recordings (see samplebank.js) ----
  // Each track is a SampleTrack: a fader plus the hits that are still sounding. The beat decides WHICH recording
  // each track plays (E.kitSamples, filled in by applySound); a hit only picks the buffer and how hard it is played.
  const kick = new SampleTrack().connect(panFor("kick", drumBus));
  const snare = new SampleTrack().connect(panFor("snare", drumBus));

  // Clap: a little room around it
  const clapGain = new Tone.Gain(1).connect(panFor("clap", drumBus));
  clapGain.connect(reverbSend);
  const clap = new SampleTrack().connect(clapGain);

  const rim = new SampleTrack().connect(panFor("rim", drumBus));

  // Hi-hats. The closed hat chokes the open one, like a real pedal.
  const hatLevel = new Tone.Gain(1).connect(panFor("hat", master));
  const hat = new SampleTrack().connect(hatLevel);
  const openhatLevel = new Tone.Gain(1).connect(panFor("openhat", master));
  const openhat = new SampleTrack().connect(openhatLevel);

  const shakerLevel = new Tone.Gain(1).connect(panFor("shaker", master));
  const shaker = new SampleTrack().connect(shakerLevel);

  const percLevel = new Tone.Gain(1).connect(panFor("perc", master));
  const perc = new SampleTrack().connect(percLevel);

  const bell = new SampleTrack().connect(panFor("bell", harmonyDuck));

  // ---- Instruments: all of them recordings (see instrumentbank.js) ----
  // Each track is a SampledInstrument: the fader (volume) the mixer moves, and the notes it plays are the nearest real
  // recording of the instrument the beat picked, re-pitched a few semitones.
  const bassDrive = new Tone.Chebyshev(3).connect(bassLP);
  bassDrive.wet.value = 0;                       // set per 808 / bass by applySound
  const bass = new SampledInstrument().connect(bassDrive);
  panFor("bass", bassDuck);

  // Log drum: a low wooden / struck recording (marimba, balafon, mbira) played short
  const logdrum = new SampledInstrument().connect(panFor("logdrum", master));

  // ---- Harmony ----
  // Keys: a light chorus (stereo width), then the pan and the reverb
  const chordChorus = new LightChorus({ rate: 1.6, delay: 0.012, depth: 0.003, wet: 0.2 })
    .connect(panFor("chords", harmonyDuck));
  chordChorus.connect(reverbSend);
  const chordFilter = new Biquad("lowpass", 9000).connect(chordChorus);
  const chordSynth = new SampledInstrument().connect(chordFilter);

  // Pad: a slow chorus makes the sustained recordings wide
  const padChorus = new LightChorus({ rate: 0.5, delay: 0.015, depth: 0.004, wet: 0.3 })
    .connect(panFor("pad", harmonyDuck));
  padChorus.connect(reverbSend);
  const padFilter = new Biquad("lowpass", 8000).connect(padChorus);
  const pad = new SampledInstrument().connect(padFilter);

  const pluckFilter = new Biquad("lowpass", 10000).connect(panFor("pluck", harmonyDuck));
  pluckFilter.connect(reverbSend);
  pluckFilter.connect(delaySend);
  const pluck = new SampledInstrument().connect(pluckFilter);

  const leadFilter = new Biquad("lowpass", 9000).connect(panFor("lead", harmonyDuck));
  leadFilter.connect(reverbSend);
  leadFilter.connect(delaySend);
  const lead = new SampledInstrument().connect(leadFilter);

  const sampler = { bass, logdrum, chords: chordSynth, pad, pluck, lead };
  const player = track => sampler[track];

  // ---- Effects for transitions: a recorded cymbal crash and a recorded 808 boom played slowly ----
  const fxBus = new Tone.Gain(1).connect(master);
  const fxCrash = new SampleTrack().connect(fxBus);
  const fxRev = new SampleTrack().connect(fxBus);               // the reversed crash (spice: swell into a chorus)
  const fxImpact = new SampleTrack().connect(fxBus);

  const instruments = {
    kick, snare, clap, rim, hat, openhat, shaker, perc, bell,
    bass, logdrum, chords: chordSynth, pad, pluck, lead
  };

  // Level meters for the auto-mix (live only): each one listens to a track right after its own
  // sound and processing, before panning and the buses, so it hears the track on its own.
  let trackAnalyser = null, masterAnalyser = null;
  if (live) {
    const meterSource = {
      kick, snare, clap: clapGain, rim, hat: hatLevel, openhat: openhatLevel, shaker: shakerLevel, perc: percLevel,
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
    chordFilter, padFilter, pluckFilter, leadFilter, bassDrive,
    master, airShelf, compressor, cleanPath, masteredPath, masterLow, vocalEQ,
    sampler, reverb, reverbSend, delay, delaySend, drumBus, harmonyLevel, harmonyDuck, bassDuck,
    outGain,
    reverbDecay: opts.reverbDecay || 2.5, masteringOn: false
  });

  // ---- Sound design: apply a beat's sound choices ----
  const safe = fn => { try { fn(); } catch (err) { console.warn("Sound preset skipped:", err.message); } };

  E.applySound = sound => {
    // Drums and percussion: the recordings this beat picked. If they are still downloading, the drums join in as soon
    // as they have loaded (the newest call wins, so a quick change of beat does not bring back an old drum).
    E.kitSamples = {};
    const drums = sound.drums;
    SAMPLE_TYPES.forEach(type => { const buffer = sampleBuffer(drums, type); if (buffer) E.kitSamples[type] = buffer; });
    if ((drums && !samplesReady(drums)) || !instrumentsReady(sound) || !fxReady()) {
      // At most 3 tries per sound, a pause between them: a file that never loads must not make this loop for ever
      const tries = sound === E.soundTried ? (E.soundTries || 0) + 1 : 1;
      E.soundTried = sound; E.soundTries = tries;
      if (tries <= 3) {
        const token = E.soundToken = {};
        ensureBeatSound(sound).then(() => { if (E.soundToken === token) setTimeout(() => { if (E.soundToken === token) E.applySound(sound); }, 30); });
      }
    } else if (E.soundTried === sound) {
      E.soundTries = 0;
    }

    // Every tonal part is a recorded instrument (a beat saved by an older version is mapped to the nearest recording)
    const TRACK_OF = { bass: "bass", chords: "chords", pad: "pad", pluck: "pluck", lead: "lead", log: "logdrum" };
    E.lvl = {};
    E.instrumentOf = {};
    Object.keys(TRACK_OF).forEach(role => {
      const id = resolveInstrument(role, sound[role]), track = TRACK_OF[role];
      E.instrumentOf[role] = id;
      const setup = Object.assign({}, SAMPLED_SETUP[id], role === "log" ? { release: 0.12, attack: 0.002 } : {});
      sampler[track].use(id, setup);
      // Level matching: the recordings differ a lot in loudness, so each is lifted or lowered (dB, measured per part)
      // to the same level; picking another instrument changes the SOUND and not the LEVEL.
      E.lvl[track] = Math.pow(10, sampledLevel(id, role) / 20);
      safe(() => {
        if (track === "bass") bassDrive.wet.value = setup.drive || 0;
        if (track === "chords") { chordFilter.frequency.value = setup.filter || 9000; chordChorus.wet.value = setup.chorus; }
        if (track === "pad") { padFilter.frequency.value = setup.filter || 8000; padChorus.wet.value = Math.max(setup.chorus, 0.25); }
        if (track === "pluck") pluckFilter.frequency.value = setup.filter || 10000;
        if (track === "lead") leadFilter.frequency.value = setup.filter || 9000;
        if (E.cutBase && track in E.cutBase) E.cutBase[track] = setup.filter || E.cutBase[track];
      });
    });
  };

  // Reverb and delay amounts for a style. In a live engine a new decay rebuilds the reverb tail.
  E.applyFx = (fx, bpm) => {
    if (!fx) return;
    safe(() => {
      if (Math.abs(fx.reverb.decay - E.reverbDecay) > 0.01) { reverb.decay = fx.reverb.decay; E.reverbDecay = fx.reverb.decay; }
      reverbSend.gain.value = fx.reverb.send;
      delaySend.gain.value = fx.delay.send;
      delay.feedback.value = fx.delay.feedback;
      airShelf.gain.value = fx.air || 0;
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
    E.setCut(sec.cut || 1, time);
  };

  // Section filter: the harmony parts (chords, pad, pluck, lead) close their low-pass to a fraction of the open
  // cutoff in quiet sections (intro, verse, breakdown) and open again in the chorus. 1 = fully open (no change).
  const CUT_NODES = { chords: chordFilter, pad: padFilter, pluck: pluckFilter, lead: leadFilter };
  const CUT_OPEN = { chords: 9000, pad: 8000, pluck: 10000, lead: 9000 };
  E.cutBase = Object.assign({}, CUT_OPEN);   // the open cutoff of the current instruments (set in applySound)
  E.setCut = (cut, time) => {
    safe(() => {
      const at = time === undefined ? Tone.now() : time;
      Object.keys(CUT_NODES).forEach(track => {
        const f = CUT_NODES[track].frequency, target = Math.max(400, (E.cutBase[track] || CUT_OPEN[track]) * cut);
        f.cancelScheduledValues(at);
        f.setTargetAtTime(target, at, 0.25);
      });
    });
  };

  // Transition effects: a recorded crash cymbal, and a recorded 808 boom played slowly (an octave and a bit down)
  E.fx = {
    riser: () => {},
    // Spice: the recorded crash played backwards, so it swells and ends on the next bar line. `barSec` = one bar. It starts late enough
    // to end exactly on the downbeat (the crash is short, so it plays a little slower than as recorded to fill most of the bar).
    reverse: (time, barSec) => {
      const b = fxBuffer("crash"); if (!b) return;
      if (!E._revBuf || E._revSrc !== b) {
        const n = b.length, rb = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: n, sampleRate: b.sampleRate });
        for (let ch = 0; ch < b.numberOfChannels; ch++) { const src = b.getChannelData(ch), dst = rb.getChannelData(ch); for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i]; }
        E._revBuf = rb; E._revSrc = b;
      }
      const rb = E._revBuf, rate = Math.min(1.6, Math.max(0.75, rb.duration / barSec)), dur = rb.duration / rate;
      fxRev.play(rb, time + Math.max(0, barSec - dur), 0.85 * dbGain(-3), rate);
    },
    impact: time => { const b = fxBuffer("impact"); if (b) fxImpact.play(b, time, 0.9 * dbGain(-6), 0.6); },
    crash: time => { const b = fxBuffer("crash"); if (b) fxCrash.play(b, time, 0.8 * dbGain(-4), 1); }
  };

  // Let notes that are still ringing (pad, chords, bass) die away
  E.silence = name => {
    const inst = instruments[name];
    if (inst.releaseAll) inst.releaseAll(); else inst.triggerRelease();
    if (name === "bass") bass.releaseAll();
  };
  E.stopAll = () => {
    Object.keys(instruments).forEach(E.silence);
    try { fxRev.choke(undefined, 0.02); } catch (err) { /* nothing playing */ }
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

  // The tonal voices. (The drum voices are further down: they play recordings.)
  E.voices = {
    bass: (t, v, c) => {
      const riff = c.beat.riffs && c.beat.riffs.bass;
      const tone = (c.view.bassTones || c.beat.bassTones)[c.step];
      const iv = c.chord.intervals;
      const offset = riff ? riffOffset(riff.tokens[c.step], c.chord)
        : tone === "fifth" ? iv[2] : tone === "third" ? iv[1]
        : tone === "seventh" ? (iv[3] !== undefined ? iv[3] : 10) - 12 : (BASS_OFFSET[tone] || 0);
      const midi = c.chord.bassMidi + offset;
      player("bass").triggerAttackRelease(name(midi, c.beat), c.dur, t, v);
    },
    logdrum: (t, v, c) => {
      const riff = c.beat.riffs && c.beat.riffs.logdrum;
      // A written riff plays over the chord's root (an octave above the bass); older beats pick chord tones
      const midi = riff ? c.chord.bassMidi + 12 + riffOffset(riff.tokens[c.step], c.chord)
        : c.chord.midi[Math.min(c.beat.logTones[c.step], c.chord.midi.length - 1)] - 12;
      logdrum.triggerAttackRelease(name(midi, c.beat), c.s16 * 2, t, v);
    },
    chords: (t, v, c) => {
      // Strum: each note of the chord lands slightly after the one before. The direction alternates
      // (down, up) from bar to bar, and the top notes are played a touch softer, like fingers do.
      const notes = voiceChord(c);
      const order = c.view.strumDown === false ? notes.slice().reverse() : notes;
      const keys = player("chords");
      order.forEach((note, i) => keys.triggerAttackRelease(note, c.dur, t + i * c.strum, v * (1 - 0.05 * i)));
    },
    pad:   (t, v, c) => player("pad").triggerAttackRelease(c.chord.notes, c.dur, t, v),
    pluck: (t, v, c) => player("pluck").triggerAttackRelease(name(c.view.pluckNotes[c.step], c.beat), c.dur, t, v),
    lead:  (t, v, c) => {
      const midi = c.view.leadNotes[c.step];
      const solo = player("lead");
      solo.triggerAttackRelease(name(midi, c.beat), c.dur, t, v);
      // The last time round the hook it is doubled an octave up (once per hit, quieter)
      if (c.view.leadExtra) solo.triggerAttackRelease(name(midi + 12, c.beat), c.dur, t + 0.001, v * 0.5);
    }
  };

  // ---- Drum voices ----
  // A hit plays the recording the beat picked for that track, unless you loaded a sample of your own for it (USER_SAMPLES).
  // `rate` nudges the pitch a little: real players never hit the same drum twice the same way, and without it a
  // hi-hat or a shaker sounds like a machine gun. The nudge is worked out from the step and the strength of the hit
  // (not at random), so the download plays exactly what you heard.
  const drumBuffer = track => USER_SAMPLES[track] || (E.kitSamples && E.kitSamples[track]) || null;
  // The recordings are kept below full scale; this lifts each type to sit where the mixer expects it
  // (the template fader values were set for much hotter drums). dB per type.
  const DRUM_MAKEUP_DB = { kick: 6, snare: 6, clap: 5, rim: 5, hat: 6, openhat: 6, shaker: 11, perc: 9, bell: 7 };
  const DRUM_MAKEUP = {};
  Object.keys(DRUM_MAKEUP_DB).forEach(k => { DRUM_MAKEUP[k] = Math.pow(10, DRUM_MAKEUP_DB[k] / 20); });
  const drumHit = (track, t, v, rate) => {
    const buffer = drumBuffer(track);
    if (!buffer) return;
    instruments[track].play(buffer, t, Math.max(0, v) * 0.9 * (USER_SAMPLES[track] ? 1 : DRUM_MAKEUP[track]), rate || 1);
  };
  const wobble = (c, v, amount) => 1 + (((c.step * 7 + Math.round(v * 100)) % 5) - 2) * amount;
  // Play one hit now (the grid editor uses it so a new hit can be heard as soon as you tap it)
  // Play one lead note now (the melody editor uses it so a drawn note can be heard at once)
  E.previewLead = (midi, beat) => { try { player("lead").triggerAttackRelease(name(midi, beat), 0.45, Tone.now() + 0.005, 0.8); } catch (err) { /* not ready */ } };
  E.preview = track => { if (SAMPLE_TRACKS.includes(track) && instruments[track]) drumHit(track, Tone.now() + 0.005, 0.8, 1); };

  Object.assign(E.voices, {
    kick:  (t, v, c) => drumHit("kick", t, v, 1),
    snare: (t, v, c) => drumHit("snare", t, v, wobble(c, v, 0.002)),
    clap:  (t, v, c) => drumHit("clap", t, v, wobble(c, v, 0.003)),
    rim:   (t, v, c) => drumHit("rim", t, v, wobble(c, v, 0.004)),
    // Closed hat: chokes any open hat that is still ringing
    hat: (t, v, c) => { openhat.choke(t, 0.008); drumHit("hat", t, v, wobble(c, v, 0.005)); },
    // Open hat: a new one cuts the last one off
    openhat: (t, v, c) => { openhat.choke(t, 0.012); drumHit("openhat", t, v, 1); },
    shaker: (t, v, c) => drumHit("shaker", t, v, wobble(c, v, 0.006)),
    // Percussion: hits between the beats are played a little higher, like the high and low drum of a pair
    perc: (t, v, c) => drumHit("perc", t, v, (c.step % 2 === 1 ? 1.09 : 1) * wobble(c, v, 0.004)),
    bell: (t, v, c) => drumHit("bell", t, v, (c.step % 2 === 1 || c.step % 8 === 6 ? 1.05 : 1) * wobble(c, v, 0.003))
  });

  // Every tonal voice plays at the loudness its current sound was matched to (E.lvl is filled in by applySound).
  // The drums are recordings that were loudness-matched when the files were made, so they are not scaled here.
  E.lvl = {};
  Object.keys(E.voices).forEach(trackName => {
    if (SAMPLE_TRACKS.includes(trackName)) return;
    const tonal = E.voices[trackName];
    E.voices[trackName] = (t, v, c) => tonal(t, v * (E.lvl[trackName] || 1), c);
  });

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
      if (fx.reverse) E.fx.reverse(time, barSec);
      if (fx.sweep) E.setCut(0.14, time + barSec * 0.5);       // spice: the keys and pads close in the second half of the bar; the next bar opens them again
    }
  } catch (err) {
    console.warn("Skipped a transition effect:", err.message);
  }
}
