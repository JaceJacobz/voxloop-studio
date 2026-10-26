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
function holdParam(param, time) {
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
    holdParam(g, time);
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
    holdParam(g, t);
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
  holdParam(param, t);
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
    holdParam(g, time);
    g.setValueAtTime(start, time);                    // the anchor: without it the volume swells between hits
    g.linearRampToValueAtTime(peak, time + p.attack);
    g.exponentialRampToValueAtTime(0.001, time + p.attack + p.decay);
    g.linearRampToValueAtTime(0, time + p.attack + p.decay + 0.02);
    this.last = { time, peak, attack: p.attack, decay: p.decay };
  }
  triggerRelease(time) {
    const g = this.vca.gain, t = time === undefined ? this.vca.context.currentTime : time;
    const start = drumLevel(this.last, t);
    holdParam(g, t);
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
    holdParam(g, t);
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

  // ---- Percussion ----
  const shakerFilter = new Biquad("highpass", 5500).connect(panFor("shaker", master));
  const shaker = new NoiseVoice(noiseSources, { type: "white", attack: 0.012, decay: 0.05, release: 0.02 })   // a soft push, like a real shaker
    .connect(shakerFilter);

  const percFilter = new Biquad("highpass", 120).connect(panFor("perc", master));
  const perc = new PitchDrum({ pitchDecay: 0.02, octaves: 2, decay: 0.12, release: 0.05 }).connect(percFilter);

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
    E.rimNote = kit.rim.note;
    E.openDecay = kit.openhat.decay;

    const ch = CHORD_PRESETS[sound.chords] || CHORD_PRESETS.rhodes;
    safe(() => chordSynth.set(ch.synth));
    safe(() => { chordFilter.frequency.value = ch.filter; chordChorus.wet.value = ch.chorus; });

    const pd = PAD_PRESETS[sound.pad] || PAD_PRESETS.warm;
    safe(() => pad.set(pd.synth));
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

  E.voices = {
    // Kick: body + beater click (the click only really speaks on hard hits)
    kick: (t, v, c) => {
      kick.triggerAttackRelease("C1", c.s16 * 2, t, v * 0.75);
      kickClick.triggerAttackRelease(0.012, t, v * v * 0.75);
    },
    // Snare: shell + wires. Soft hits are mostly wires, hard hits bring the shell.
    snare: (t, v, c) => {
      snare.triggerAttackRelease(E.snareNote || "A3", 0.1, t, (0.35 + 0.5 * v) * 0.38);
      snareNoise.triggerAttackRelease(c.s16, t, v * 0.38);
    },
    // Clap: three bursts a few milliseconds apart
    clap: (t, v, c) => {
      clap.triggerAttackRelease(0.01, t, v * 0.75);
      clap.triggerAttackRelease(0.01, t + 0.011, v * 0.85);
      clap.triggerAttackRelease(c.s16, t + 0.023, v);
    },
    rim: (t, v, c) => rim.triggerAttackRelease(E.rimNote || "E5", c.s16 / 2, t, v),
    // Closed hat: chokes any open hat that is still ringing; harder hits are brighter
    hat: (t, v, c) => {
      openhat.triggerRelease(t);
      hatFilter.frequency.setValueAtTime((E.hatBase || 7000) - 900 + 1800 * v, t);
      hat.triggerAttackRelease(c.s16 / 2, t, v);
    },
    openhat: (t, v, c) => openhat.triggerAttackRelease((E.openDecay || 0.3) * 1.5, t, v),
    shaker:  (t, v, c) => shaker.triggerAttackRelease(c.s16 / 2, t, v * 0.5),
    // Congas: a low, open tone on the beat and a higher, shorter one in between (one drum only has one pitch,
    // so a pattern played on a single note sounds like a drum machine, not a player)
    perc:    (t, v, c) => {
      const onBeat = c.step % 4 === 0;
      perc.triggerAttackRelease(onBeat ? "A3" : "E4", onBeat ? c.s16 : c.s16 * 0.6, t, v * 0.5);
    },
    bell:    (t, v, c) => bell.triggerAttackRelease(c.chord.bell, c.s16, t, v),

    bass: (t, v, c) => {
      const tone = (c.view.bassTones || c.beat.bassTones)[c.step];
      const iv = c.chord.intervals;
      const offset = tone === "fifth" ? iv[2] : tone === "third" ? iv[1]
        : tone === "seventh" ? (iv[3] !== undefined ? iv[3] : 10) - 12 : (BASS_OFFSET[tone] || 0);
      const midi = c.chord.bassMidi + offset;
      bass.triggerAttackRelease(name(midi, c.beat), c.dur, t, v);
      if (E.bassBite) bassBite.triggerAttackRelease(name(midi + 12, c.beat), Math.min(c.dur, 0.3), t, v * E.bassBite);
    },
    logdrum: (t, v, c) => {
      const midi = c.chord.midi[Math.min(c.beat.logTones[c.step], c.chord.midi.length - 1)] - 12;
      logdrum.triggerAttackRelease(name(midi, c.beat), c.s16 * 2, t, v);
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
    if (fx.impact) E.fx.impact(time);
    if (fx.crash) E.fx.crash(time);
  } catch (err) {
    console.warn("Skipped a transition effect:", err.message);
  }
}
