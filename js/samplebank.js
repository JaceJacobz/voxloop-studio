// =====================================================================
// Drum and percussion samples.
//
// Beat Lab no longer synthesizes its drums. Every drum and percussion sound is a real recording
// (drum-machine hits and acoustic hand percussion) kept in samples/<genre>/<type>/<n>.wav.
// Each genre has SAMPLE_VARIANTS (5) recordings of every type, so an Afrobeats kick is always a real kick
// chosen for Afrobeats, an amapiano shaker a real shaker chosen for amapiano, and so on.
// A new beat picks ONE of the five for each type at random (and never the one the last beat used),
// so no two beats in a row share the same kick, snare, hats...
//
// A beat stores its picks as  beat.sound.drums = { genre: "afrobeats", kick: 3, snare: 1, ... }.
// The engine looks the buffers up here, the download waits for them (ensureSamples) and a Studio session that
// receives the beat gets the same picks, so what you hear is what you export.
//
// samplemap.js (generated) holds the original name of every file, for the Sound panel.
// =====================================================================

const SAMPLE_TYPES = ["kick", "snare", "clap", "rim", "hat", "openhat", "shaker", "perc", "bell"];
const SAMPLE_VARIANTS = 5;
const SAMPLE_TYPE_NAMES = {
  kick: "Kick", snare: "Snare", clap: "Clap", rim: "Rim", hat: "Hi-hat",
  openhat: "Open hat", shaker: "Shaker", perc: "Percussion", bell: "Bell"
};

const SAMPLE_BANK = {};             // "genre/type/n" -> AudioBuffer (decoded)
const SAMPLE_LOADING = {};          // "genre/type/n" -> Promise (a download that is under way)
const SAMPLE_FAILED = {};           // "genre/type/n" -> true (could not be loaded; not tried again this session)

const sampleKey = (genre, type, n) => genre + "/" + type + "/" + n;
const sampleUrl = (genre, type, n) => "samples/" + genre + "/" + type + "/" + n + ".wav";

// The original name of a sample, for the Sound panel ("RolandTR808 BD5025")
function sampleLabel(genre, type, n) {
  const list = typeof SAMPLE_LABELS !== "undefined" && SAMPLE_LABELS[genre] && SAMPLE_LABELS[genre][type];
  return (list && list[n - 1]) || ("Sample " + n);
}

// Choose one of the SAMPLE_VARIANTS recordings for every type.
//   avoid  : the picks of the last beat; a type never repeats its last pick (so every new beat sounds different)
//   forced : picks the user fixed in the Sound panel, { kick: 2, ... }, which are kept
function pickDrumSamples(genre, avoid, forced) {
  const out = { genre };
  SAMPLE_TYPES.forEach(type => {
    const fixed = forced && Number.isInteger(forced[type]) ? forced[type] : 0;
    if (fixed >= 1 && fixed <= SAMPLE_VARIANTS) { out[type] = fixed; return; }
    const last = avoid && avoid.genre === genre ? avoid[type] : 0;
    const options = [];
    for (let n = 1; n <= SAMPLE_VARIANTS; n++) if (n !== last) options.push(n);
    out[type] = options[Math.floor(Math.random() * options.length)];
  });
  return out;
}

// A raw context used only to decode the files (it does not need a click, and works before the audio engine exists)
let _decodeCtx = null;
function decodeContext() {
  if (_decodeCtx) return _decodeCtx;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  _decodeCtx = new Offline(1, 1, 44100);
  return _decodeCtx;
}
// Download the bytes of one audio file. Over http(s) that is a plain fetch. Opened straight from a folder (file://),
// browsers refuse to fetch local files, so the same audio also ships as small script files (fileaudio/<path>.js, made
// by tools/build_fileaudio.py) and is read back from those. Either way the caller gets an ArrayBuffer.
const _fileInflight = {};
function fetchAudio(url) {
  if (typeof location !== "undefined" && location.protocol === "file:") {
    if (!_fileInflight[url]) _fileInflight[url] = fetchAudioOnce(url).then(r => { delete _fileInflight[url]; return r; }, e => { delete _fileInflight[url]; throw e; });
    return _fileInflight[url];
  }
  return fetchAudioOnce(url);
}
function fetchAudioOnce(url) {
  if (typeof location === "undefined" || location.protocol !== "file:") {
    return fetch(url).then(res => { if (!res.ok) throw new Error("HTTP " + res.status); return res.arrayBuffer(); });
  }
  return new Promise((resolve, reject) => {
    const store = (window.__VLA = window.__VLA || {});
    const done = () => {
      const b64 = store[url];
      if (!b64) return reject(new Error("no data for " + url));
      delete store[url];
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(bytes.buffer);
    };
    if (store[url]) return done();
    const el = document.createElement("script");
    el.src = "fileaudio/" + url + ".js";
    el.onload = () => { done(); el.remove(); };
    el.onerror = () => { el.remove(); reject(new Error("cannot load " + url)); };
    document.head.appendChild(el);
  });
}

function decodeBytes(bytes) {
  const ctx = decodeContext();
  return new Promise((resolve, reject) => {
    const maybe = ctx.decodeAudioData(bytes, resolve, reject);       // old Safari only has the callback form
    if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
  });
}

// One door for every download+decode. At most a few run at once (a weak laptop chokes on dozens of base64 files and
// decodes at the same time), and each has a time limit, so a stuck file ends as "failed" instead of hanging the app.
// Light mode (Settings > Performance): for slow phones and PCs. Fewer sounds at once, a small memory budget, half the notes.
const LIGHT_MODE = (() => { try { return localStorage.getItem("vl-light") === "1"; } catch (err) { return false; } })();
const AUDIO_LIMIT = LIGHT_MODE ? 2 : typeof location !== "undefined" && location.protocol === "file:" ? 3 : 6;
let _audioRunning = 0; const _audioWaiting = [];
function withTimeout(promise, ms, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out: " + what)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
function loadAudioBuffer(url) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _audioRunning++;
      withTimeout(fetchAudio(url), 12000, url).then(bytes => withTimeout(decodeBytes(bytes), 20000, "decode " + url))
        .then(resolve, reject)
        .then(() => { _audioRunning--; const next = _audioWaiting.pop(); if (next) setTimeout(next, 0); });   // newest first: the beat on screen loads before ones you moved on from
    };
    if (_audioRunning < AUDIO_LIMIT) run(); else _audioWaiting.push(run);
  });
}

// Download and decode one sample (once)
function loadSample(genre, type, n) {
  const key = sampleKey(genre, type, n);
  if (SAMPLE_BANK[key]) return Promise.resolve(SAMPLE_BANK[key]);
  if (SAMPLE_FAILED[key]) return Promise.resolve(null);
  if (!SAMPLE_LOADING[key]) {
    SAMPLE_LOADING[key] = loadAudioBuffer(sampleUrl(genre, type, n))
      .then(buffer => { SAMPLE_BANK[key] = buffer; return buffer; })
      .catch(err => {
        SAMPLE_FAILED[key] = true;
        console.warn("Could not load sample " + key + ":", err && err.message ? err.message : err);
        return null;
      })
      .then(result => { delete SAMPLE_LOADING[key]; return result; });
  }
  return SAMPLE_LOADING[key];
}

// The decoded buffer of one pick, or null if it has not loaded (yet)
function sampleBuffer(drums, type) {
  if (!drums || !drums[type]) return null;
  return SAMPLE_BANK[sampleKey(drums.genre, type, drums[type])] || null;
}

// True when every sample of a pick is ready (or failed for good, so waiting longer would not help)
function samplesReady(drums) {
  if (!drums) return true;
  return SAMPLE_TYPES.every(type => {
    const key = sampleKey(drums.genre, type, drums[type]);
    return Boolean(SAMPLE_BANK[key]) || Boolean(SAMPLE_FAILED[key]);
  });
}

// Wait until the nine samples of a pick are loaded. Always resolves (a missing file only leaves that drum silent).
function ensureSamples(drums) {
  if (!drums) return Promise.resolve();
  return Promise.all(SAMPLE_TYPES.map(type => loadSample(drums.genre, type, drums[type]))).then(() => undefined);
}

// Quietly fetch every sample of a genre (about 1.5 MB) so the next "New beat" starts instantly
const _preloaded = {};
function preloadGenreSamples(genre) {
  if (_preloaded[genre]) return;
  _preloaded[genre] = true;
  const work = [];
  SAMPLE_TYPES.forEach(type => { for (let n = 1; n <= SAMPLE_VARIANTS; n++) work.push([type, n]); });
  // a few at a time, so the page stays responsive on a slow connection
  const next = () => {
    const item = work.shift();
    if (!item) return Promise.resolve();
    return loadSample(genre, item[0], item[1]).then(next);
  };
  next(); next(); next();
}
