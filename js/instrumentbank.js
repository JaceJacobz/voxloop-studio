// =====================================================================
// Recorded instruments (piano, trumpet, violin, sax, flute, guitars, strings, 808 bass ...).
//
// Each instrument is a handful of real recordings (a note every few semitones) in samples/instruments/<id>/<midi>.mp3.
// A note is played from the nearest recording, re-pitched by the (small) distance, the way a sampler does.
// instrumentmap.js (generated) lists what exists: INSTRUMENT_LIBRARY[id] = { name, kind, ext, notes[] }.
// A sound id that starts with "s-" in a beat ("s-piano") means "play the recorded piano".
// =====================================================================

const INSTRUMENT_BANK = {};        // "id/midi" -> AudioBuffer
const INSTRUMENT_LOADING = {};     // "id/midi" -> Promise
const INSTRUMENT_FAILED = {};      // "id/midi" -> true
const INSTRUMENT_USED = {};        // id -> the last time a beat asked for it (the oldest are freed first)
let INSTRUMENT_RECENT = [];        // the instrument ids of the last two beats asked for
let INSTRUMENT_PINNED = [];        // ...flattened: these are never freed

// Memory guard. Decoded audio is big (all 29 instruments at once is about 140 MB), so on small devices the app keeps
// only what the beats you are using need: it frees the instruments you have not used for longest once a budget is
// passed, and on phones with 2 GB or less it loads every second note of the big instruments (the app re-pitches).
const DEVICE_MEMORY_GB = (typeof LIGHT_MODE !== "undefined" && LIGHT_MODE) ? 1 : (typeof navigator !== "undefined" && navigator.deviceMemory) || 0;     // 0 = the browser does not say
const INSTRUMENT_BUDGET_MB = DEVICE_MEMORY_GB && DEVICE_MEMORY_GB <= 1 ? 45 : DEVICE_MEMORY_GB && DEVICE_MEMORY_GB <= 2 ? 60 : DEVICE_MEMORY_GB >= 8 ? 200 : 110;
if (DEVICE_MEMORY_GB && DEVICE_MEMORY_GB <= 2 && typeof INSTRUMENT_LIBRARY !== "undefined") {
  Object.values(INSTRUMENT_LIBRARY).forEach(info => {
    if (info.kind === "808" || info.notes.length <= 8) return;
    info.notes = info.notes.filter((n, k) => k % 2 === 0 || k === info.notes.length - 1);
  });
}
function instrumentBankMB() {
  let bytes = 0;
  for (const k in INSTRUMENT_BANK) { const b = INSTRUMENT_BANK[k]; if (b) bytes += b.length * b.numberOfChannels * 4; }
  return bytes / 1048576;
}
function trimInstrumentBank() {
  let total = instrumentBankMB();
  if (total <= INSTRUMENT_BUDGET_MB) return;
  const loaded = {};
  for (const k in INSTRUMENT_BANK) loaded[k.slice(0, k.lastIndexOf("/"))] = true;
  const order = Object.keys(loaded).filter(id => !INSTRUMENT_PINNED.includes(id)).sort((a, b) => (INSTRUMENT_USED[a] || 0) - (INSTRUMENT_USED[b] || 0));
  for (const id of order) {
    if (total <= INSTRUMENT_BUDGET_MB) break;
    for (const k of Object.keys(INSTRUMENT_BANK)) {
      if (k.slice(0, k.lastIndexOf("/")) !== id) continue;
      const b = INSTRUMENT_BANK[k]; if (b) total -= b.length * b.numberOfChannels * 4 / 1048576;
      delete INSTRUMENT_BANK[k];
    }
  }
}

const isSampledId = id => typeof id === "string" && id.startsWith("s-");
const instrumentIdOf = id => (isSampledId(id) ? id.slice(2) : null);

// Every tonal part of a beat is a recording. Beats saved by an older version name synth sounds ("rhodes", "sub808"...);
// each of those is played by the closest recorded instrument instead.
const LEGACY_INSTRUMENT = {
  bass:   { sub808: "808-boom", glide808: "808-boom", softSub: "808-deep", moog: "bass-electric", pluckSub: "bass-electric", amaSub: "upright-bass", growl: "808-punch", rolling: "bass-electric" },
  chords: { rhodes: "epiano", wurli: "epiano", vibes: "vibraphone", darkKeys: "piano", organ: "organ", amaPiano: "piano", guitar: "guitar-nylon", stab: "organ" },
  pad:    { warm: "harmonium", airy: "harp", dark: "cello", strings: "violin", choir: "organ" },
  lead:   { glass: "glockenspiel", vibes: "vibraphone", softSaw: "flute", kalimba: "kalimba", flute: "flute", horn: "french-horn", whistle: "flute" },
  pluck:  { kalimba: "kalimba", bellPluck: "glockenspiel", pluckSaw: "guitar-electric", afroGuitar: "guitar-electric", kora: "harp", marimba: "marimba", nylon: "guitar-nylon", pianoRun: "piano" },
  log:    { classic: "marimba", ama: "balafon", wood: "mbira" }
};
const DEFAULT_INSTRUMENT = { bass: "808-boom", chords: "epiano", pad: "harmonium", lead: "flute", pluck: "kalimba", log: "marimba" };
function resolveInstrument(role, id) {
  const direct = instrumentIdOf(id);
  if (direct && instrumentInfo(direct)) return direct;
  return (LEGACY_INSTRUMENT[role] && LEGACY_INSTRUMENT[role][id]) || DEFAULT_INSTRUMENT[role];
}
const SOUND_ROLES = ["bass", "chords", "pad", "lead", "pluck", "log"];
const instrumentInfo = id => (typeof INSTRUMENT_LIBRARY !== "undefined" ? INSTRUMENT_LIBRARY[id] : null) || null;
const instrumentName = id => { const i = instrumentInfo(instrumentIdOf(id) || id); return i ? i.name : String(id); };

function instrumentUrl(id, note) {
  const info = instrumentInfo(id);
  const file = info && info.kind === "808" ? "root" : note;          // the 808s are one recording named root.wav
  return "samples/instruments/" + id + "/" + file + "." + (info ? info.ext : "mp3");
}

function loadInstrumentNote(id, note) {
  const key = id + "/" + note;
  if (INSTRUMENT_BANK[key]) return Promise.resolve(INSTRUMENT_BANK[key]);
  if (INSTRUMENT_FAILED[key]) return Promise.resolve(null);
  if (!INSTRUMENT_LOADING[key]) {
    INSTRUMENT_LOADING[key] = loadAudioBuffer(instrumentUrl(id, note))
      .then(buffer => { INSTRUMENT_BANK[key] = buffer; return buffer; })
      .catch(err => {
        INSTRUMENT_FAILED[key] = true;
        console.warn("Could not load instrument note " + key + ":", err && err.message ? err.message : err);
        return null;
      })
      .then(result => { delete INSTRUMENT_LOADING[key]; return result; });
  }
  return INSTRUMENT_LOADING[key];
}

// MEASURED (the pitch of every recording of these, v2.25.4 and again in v2.25.5): six instruments sound one octave ABOVE the note they are
// filed under in instrumentmap.js (a marimba filed as C4 really sounds C5). Everything that plays a recording asks instrumentSet() for its
// notes, so the sounding pitch is applied here, once: a note asked for sounds as asked, in the Beat Lab, in fills and in Studio's guests.
// (The files and the labels in instrumentmap.js are untouched, only the label each recording is offered under.)
const INSTRUMENT_SOUNDS_ABOVE_LABEL = { marimba: 12, vibraphone: 12, kalimba: 12, mbira: 12, balafon: 12, glockenspiel: 12 };

// Every recording of one instrument: { notes: [midi...], buffers: {midi: AudioBuffer} } (what is loaded so far), under the pitch it really sounds
function instrumentSet(id) {
  const info = instrumentInfo(id);
  if (!info) return null;
  const up = INSTRUMENT_SOUNDS_ABOVE_LABEL[id] || 0, buffers = {}, notes = [];
  info.notes.forEach(n => { const b = INSTRUMENT_BANK[id + "/" + n]; if (b) { buffers[n + up] = b; notes.push(n + up); } });
  return notes.length ? { info, notes, buffers, shift: up } : null;
}

const instrumentReady = id => {
  const info = instrumentInfo(id);
  return !info || info.notes.every(n => INSTRUMENT_BANK[id + "/" + n] || INSTRUMENT_FAILED[id + "/" + n]);
};

// The recorded instruments a beat uses (one per part)
function soundInstrumentIds(sound) {
  const out = [];
  if (!sound) return out;
  SOUND_ROLES.forEach(role => {
    const id = resolveInstrument(role, sound[role]);
    if (id && instrumentInfo(id) && !out.includes(id)) out.push(id);
  });
  return out;
}

// Always resolves (a missing file only leaves that instrument quieter)
function ensureInstruments(sound) {
  const work = [], ids = soundInstrumentIds(sound), now = Date.now();
  ids.forEach(id => { INSTRUMENT_USED[id] = now; });
  INSTRUMENT_RECENT = [ids].concat(INSTRUMENT_RECENT).slice(0, 2);                    // this beat and the one before it
  INSTRUMENT_PINNED = INSTRUMENT_RECENT.flat();
  ids.forEach(id => instrumentInfo(id).notes.forEach(n => work.push(loadInstrumentNote(id, n))));
  return Promise.all(work).then(() => { trimInstrumentBank(); });
}
const instrumentsReady = sound => soundInstrumentIds(sound).every(instrumentReady);

// Transition effects: a recorded crash cymbal and a recorded 808 boom (samples/fx)
const FX_BANK = {}, FX_FAILED = {};
const FX_NAMES = ["crash", "impact"];
const fxBuffer = name => FX_BANK[name] || null;
const fxReady = () => FX_NAMES.every(n => FX_BANK[n] || FX_FAILED[n]);
const FX_LOADING = {};
function ensureFx() {
  return Promise.all(FX_NAMES.map(name => {
    if (FX_BANK[name] || FX_FAILED[name]) return null;
    if (!FX_LOADING[name]) FX_LOADING[name] = loadAudioBuffer("samples/fx/" + name + ".wav")
      .then(b => { FX_BANK[name] = b; })
      .catch(err => { FX_FAILED[name] = true; console.warn("Could not load fx " + name + ":", err.message); })
      .then(() => { delete FX_LOADING[name]; });
    return FX_LOADING[name];
  })).then(() => undefined);
}

// Load the sound of a whole beat: drums, instruments and transition effects
// How much of a beat's sound is ready: { done, total } files (drums, instrument notes, transition effects)
function soundProgress(sound) {
  let done = 0, total = 0;
  const d = sound && sound.drums;
  if (d) drumVoices(d).forEach(([v, t]) => { total++; const k = sampleKey(d.genre, t, d[v]); if (SAMPLE_BANK[k] || SAMPLE_FAILED[k]) done++; });
  soundInstrumentIds(sound).forEach(id => instrumentInfo(id).notes.forEach(n => { total++; const k = id + "/" + n; if (INSTRUMENT_BANK[k] || INSTRUMENT_FAILED[k]) done++; }));
  FX_NAMES.forEach(n => { total++; if (FX_BANK[n] || FX_FAILED[n]) done++; });
  return { done, total };
}
let BEAT_LOADING_HOOK = null;       // Beat Lab sets this: called with { done, total } while a beat's sounds load, then with null
let BEAT_LOADING_ACTIVE = 0;
function ensureBeatSound(sound) {
  if (!sound) return Promise.resolve();
  const start = soundProgress(sound);
  const all = Promise.all([ensureSamples(sound.drums), ensureInstruments(sound), ensureFx()]).then(() => undefined);
  // Never wait for ever: after 60 s the beat plays with what has loaded (the progress bar can not stay stuck)
  const job = new Promise(resolve => { const t = setTimeout(resolve, 60000); all.then(() => { clearTimeout(t); resolve(); }, () => { clearTimeout(t); resolve(); }); });
  if (!BEAT_LOADING_HOOK || start.done >= start.total) return job;
  BEAT_LOADING_ACTIVE++;
  const tick = () => BEAT_LOADING_HOOK(soundProgress(sound));
  tick();
  const timer = setInterval(tick, 100);
  const finish = () => { clearInterval(timer); if (--BEAT_LOADING_ACTIVE <= 0) { BEAT_LOADING_ACTIVE = 0; BEAT_LOADING_HOOK(null); } };
  return job.then(r => { finish(); return r; }, err => { finish(); throw err; });
}

// How each recorded instrument is played: level (dB, so a swap changes the sound and not the loudness), the filter that
// shapes it (Hz), chorus amount, and for 808s the glide and a little drive. Defaults suit most; measured values go here.
const SAMPLED_LEVEL = {"piano":{"chords":2.6,"pluck":1.7,"lead":10.4},"epiano":{"chords":2.8,"pluck":2,"lead":10.7},"organ":{"chords":7.6,"pad":12.3},"harmonium":{"pad":12.5,"chords":8.7},"guitar-nylon":{"chords":2.4,"pluck":1.5,"lead":10.1},"guitar-acoustic":{"chords":2.8,"pluck":1.5},"guitar-electric":{"chords":3.1,"pluck":2.3,"lead":10.9},"harp":{"pluck":1.9,"chords":2.5,"pad":9.2},"vibraphone":{"chords":4.6,"pluck":3.2,"lead":12.2},"violin":{"lead":13.5,"pad":11.9},"cello":{"pad":13.9,"lead":17.2},"trumpet":{"lead":12.3},"saxophone":{"lead":12.4},"flute":{"lead":14.8,"pluck":3.3},"clarinet":{"lead":13.7},"french-horn":{"pad":11.4,"lead":14.5},"trombone":{"lead":21.5},"kalimba":{"pluck":4.4,"lead":14.1},"mbira":{"pluck":1.8,"lead":11.7,"log":8.4},"marimba":{"pluck":2.1,"lead":10.7,"log":8.8},"balafon":{"pluck":0.7,"lead":10.2,"log":8.7},"xylophone":{"pluck":4.2,"lead":11.2},"glockenspiel":{"pluck":3.7,"lead":12.2},"bass-electric":{"bass":15.8},"upright-bass":{"bass":14.9},"tuba":{"bass":13.8},"808-boom":{"bass":7.1},"808-punch":{"bass":7.5},"808-deep":{"bass":6.7}};
// dB to add so the recording plays as loud as the synth it replaces (measured: loudest 0.4 s of the same phrase)
const sampledLevel = (id, role) => { const l = SAMPLED_LEVEL[id]; if (!l) return 0; if (l[role] !== undefined) return l[role]; const v = Object.values(l); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const SAMPLED_SETUP = {};
(function () {
  if (typeof INSTRUMENT_LIBRARY === "undefined") return;
  const own = {
    "808-boom": { glide: 0.07, drive: 0.25, filter: 3000 }, "808-punch": { glide: 0.05, drive: 0.3 }, "808-deep": { glide: 0.08, drive: 0.2 },
    violin: { attack: 0.08, release: 0.3, chorus: 0.3, filter: 4200 }, trumpet: { filter: 5500 }, saxophone: { filter: 4800 }, cello: { attack: 0.09, release: 0.3, chorus: 0.25 },
    "french-horn": { attack: 0.07 }, trombone: { attack: 0.05 }, flute: { attack: 0.05, release: 0.25 }
  };
  Object.keys(INSTRUMENT_LIBRARY).forEach(id => {
    SAMPLED_SETUP[id] = Object.assign({ level: 0, chorus: 0.12, drive: 0 }, own[id] || {});
  });
})();
