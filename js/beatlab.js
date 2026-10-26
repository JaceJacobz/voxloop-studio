/* Voxloop Studio — Beat Lab (Beatsmith engine + handoff) */
// =====================================================================
// Beatsmith: page wiring, the live sequencer and the auto-mix.
// The musical decisions (patterns, key, chords, hook) live in beatgen.js,
// the sounds live in engine.js and the WAV download lives in export.js.
// =====================================================================

// ---------- Audio engine (live) — created lazily so UI can still boot if Tone fails ----------
let engine = null;
let instruments, pan, trackAnalyser, masterAnalyser, masterBus, harmonyDuck, bassDuck, vocalEQ;

function ensureEngine() {
  if (engine) return engine;
  if (typeof Tone === "undefined") {
    throw new Error("Tone.js failed to load (check lib/Tone.js path)");
  }
  // More scheduling slack: Tone sends notes to the audio thread 0.2 s ahead instead of 0.1 s, so a busy
  // moment on the page (drawing, the browser tidying memory) does not make a note arrive late. The bigger
  // audio buffer is set when Tone loads (see index.html).
  try { Tone.getContext().lookAhead = 0.2; } catch (err) { console.warn(err); }
  engine = createEngine({ live: true });
  instruments = engine.instruments;
  pan = engine.pan;
  trackAnalyser = engine.trackAnalyser;
  masterAnalyser = engine.masterAnalyser;
  masterBus = engine.master;
  harmonyDuck = engine.harmonyDuck;
  bassDuck = engine.bassDuck;
  vocalEQ = engine.vocalEQ;
  return engine;
}

// ---------- State ----------
const STEPS = 16;

let current = generatePattern("rnb");       // the beat that is playing
let pending = null;                         // a new beat waiting for the next bar
let bar = -1;                               // which bar of the song we are in
let startBar = 0;                           // where Play starts (click a section to change it)
let pendingJump = null;                     // a bar to jump to at the next bar line
let playing = false;                        // true between Play and Stop
let view = null;                            // what is played in the current bar (see barView)
let arrangeOn = true;                       // loop mode: arrangement over bars on or off
let sidechainOn = true;                     // kick ducks the harmony and bass
let loopSong = true;                        // go back to the start at the end of the song
let calibrating = false;                    // a silent run to balance the mix before a download
let exporting = false;

// Humanizer settings (the page controls change these)
let humanize = true;                        // velocity + timing variation on or off
let swing = resolveTemplate(current.genre, current.style).swing;   // 0 to 0.5 of a 16th note

// Auto-mix: listens to the beat and nudges each track so nothing is buried
const autoMix = {
  on: true,            // the Auto-mix switch
  listening: false,    // true while it is measuring
  armed: false,        // the bar it measures starts at the next bar line
  balanced: false,     // true once the whole song (or phrase) has been heard
  mode: "full",        // "full" = tracks + master level, "master" = master level only
  barsHeard: 0,
  barsToListen: 6,
  masterReadings: 0,   // bars measured for the master level (choruses only, in a song)
  logs: {},            // loudest hit level of each bar, by track
  autos: {},           // the auto-trim (dB) applied to each track
  rel: {},             // where each track naturally sits (before any trim), in dB under the kick
  peaks: [],           // loudest peak of the last few bars, master level taken off
  rmsRing: [],         // average loudness of the last bars (used when Mastering is on)
  master: 0,           // auto master level (dB), for headroom or mastering
  last: { peak: -Infinity, rms: -Infinity }   // the last bar of the final output
};
TRACK_ORDER.forEach(name => { autoMix.autos[name] = 0; autoMix.logs[name] = []; });
let masteringOn = false;                    // the Mastering switch (off by default)
let vocalSpaceOn = true;                    // the Vocal space switch
let lastBarKind = null;                     // what kind of section the bar being measured belongs to

const muted = new Set();                    // tracks the user has muted
const soloed = new Set();                   // tracks the user has soloed (only these play)
const locked = new Set();                   // groups kept when making a new beat
const trim = {};                            // dB the user added or removed per track
TRACK_ORDER.forEach(name => { trim[name] = 0; });

// What the pickers are set to. "auto" means: choose at random on every new beat.
const settings = {
  root: "auto", scale: "auto", progression: "auto", style: "auto",
  structure: "full", bpmAuto: true, bpm: current.bpm, phraseBars: 4
};

try { if (typeof Tone !== 'undefined') Tone.Transport.bpm.value = current.bpm; } catch (e) { console.warn(e); }

const isSong = beat => beat.structure !== "loop" && beat.sections.length > 0;
const barSeconds = beat => 16 * 60 / beat.bpm / 4;
const formatTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- Page elements ----------
const $ = id => document.getElementById(id);
const gridEl = $("bl-grid"), bpmEl = $("bl-bpm"), statusEl = $("bl-status"), keyEl = $("bl-key");
const styleNameEl = $("bl-styleName"), chordsEl = $("bl-chords"), genreEl = $("bl-genre"), styleEl = $("bl-style");
const playBtn = $("bl-play"), regenBtn = $("bl-regen");
const humanizeEl = $("bl-humanize"), swingEl = $("bl-swing"), swingValEl = $("bl-swingVal");
const tempoEl = $("bl-tempo"), tempoValEl = $("bl-tempoVal"), tempoAutoEl = $("bl-tempoAuto");
const rootEl = $("bl-root"), scaleEl = $("bl-scale"), progEl = $("bl-prog");
const locksEl = $("bl-locks"), mixerEl = $("bl-mixer"), mixerResetEl = $("bl-mixerReset");
const structureEl = $("bl-structure"), loopSongEl = $("bl-loopSong");
const arrangeEl = $("bl-arrange"), phraseEl = $("bl-phrase"), sidechainEl = $("bl-sidechain");
const barInfoEl = $("bl-barInfo"), timelineEl = $("bl-timeline"), songTimeEl = $("bl-songTime");
const automixEl = $("bl-automix"), vocalspaceEl = $("bl-vocalspace"), masteringEl = $("bl-mastering");
const rebalanceEl = $("bl-rebalance"), mixBadgeEl = $("bl-mixBadge"), mixStatusEl = $("bl-mixStatus"), mixReportEl = $("bl-mixReport");
const exportBtn = $("bl-export"), bitsEl = $("bl-bits"), appEl = document.querySelector(".beatlab-layout") || document.body;

// Genre dropdown: one option per template
Object.entries(TEMPLATES).forEach(([key, template]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = template.name;
  genreEl.appendChild(option);
});
genreEl.value = current.genre;

// Structure dropdown: full song / short song / loop
Object.entries(STRUCTURES).forEach(([key, structure]) => {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = structure.name;
  if (structureEl) structureEl.appendChild(option);
});
if (structureEl) structureEl.value = settings.structure;

// Style dropdown: Auto plus the styles of the chosen genre
function fillStyleOptions() {
  const genre = TEMPLATES[genreEl.value];
  styleEl.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "auto"; auto.textContent = "Auto (surprise me)";
  styleEl.appendChild(auto);
  genre.styleOrder.forEach(id => {
    const option = document.createElement("option");
    option.value = id; option.textContent = genre.styles[id].name;
    styleEl.appendChild(option);
  });
  styleEl.value = settings.style;
}

// ---------- Step grid (visual) ----------
const rowEls = {};

// Build the rows once: a name button plus 16 cells per track
TRACK_ORDER.forEach((trackName, index) => {
  const rowEl = document.createElement("div");
  rowEl.className = "row";
  rowEl.dataset.row = trackName;
  rowEl.dataset.group = TRACK_GROUPS[trackName];
  if (index > 0 && TRACK_GROUPS[trackName] !== TRACK_GROUPS[TRACK_ORDER[index - 1]]) {
    rowEl.classList.add("group-start");
  }

  // Click the name to mute / unmute the track
  const label = document.createElement("button");
  label.type = "button";
  label.className = "label";
  label.textContent = TRACK_LABELS[trackName];
  label.title = "Click to mute or unmute";
  label.setAttribute("aria-pressed", "false");
  label.addEventListener("click", () => toggleMute(trackName));
  rowEl.appendChild(label);

  for (let i = 0; i < STEPS; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    rowEl.appendChild(cell);
  }

  gridEl.appendChild(rowEl);
  rowEls[trackName] = rowEl;
});

// Key name, style name and the chord chips (the chords of the section that is playing)
let chipSignature = "";
function paintHarmony(beat, v) {
  keyEl.textContent = beat.key.name;
  styleNameEl.textContent = beat.styleName;
  const kind = v && v.kind ? v.kind : "verse";
  const list = isSong(beat) ? beat.harmony.chords[kind] : beat.chords;
  const signature = beat.styleName + "|" + beat.key.name + "|" + kind + "|" + list.map(c => c.name).join();
  if (signature === chipSignature) return;
  chipSignature = signature;
  chordsEl.innerHTML = "";
  list.forEach(chord => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = chord.name;
    chordsEl.appendChild(chip);
  });
}

// Highlight the chord(s) of the bar that is playing (pass null to clear)
function highlightChords(v, barIndex) {
  const chips = [...chordsEl.children];
  chips.forEach(chip => chip.classList.remove("on"));
  if (!v || !chips.length) return;
  const cpb = current.chordsPerBar || 1;
  const within = isSong(current) ? v.phraseBar : barIndex;
  const first = (within * cpb) % chips.length;
  chips[first].classList.add("on");
  if (cpb === 2) chips[(first + 1) % chips.length].classList.add("on");
}

// Light up the cells that have a hit in the given beat
// With a bar view `v`, shows what is played in that bar (fill, resting tracks...).
// Without one, shows the beat's own base pattern.
function paint(beat, v) {
  const shown = v || (isSong(beat) ? barView(beat, startBar, true) : null);
  const tracks = shown ? shown.tracks : beat.tracks;
  const velocities = shown ? shown.velocities : beat.velocities;
  TRACK_ORDER.forEach(trackName => {
    const cells = rowEls[trackName].querySelectorAll(".cell");
    tracks[trackName].forEach((hit, i) => {
      cells[i].classList.toggle("on", hit === 1);
      // Brightness shows how hard the hit is played
      const vel = humanize ? velocities[trackName][i] : FLAT_VELOCITY;
      cells[i].style.setProperty("--v", 0.55 + 0.45 * vel);
    });
    rowEls[trackName].classList.toggle("empty", !tracks[trackName].some(Boolean));
    rowEls[trackName].classList.toggle("resting", Boolean(shown) && !shown.present[trackName]);
  });
  gridEl.classList.toggle("fill", Boolean(v) && v.isFill);
  updateBarInfo(beat, v);
  bpmEl.textContent = beat.bpm;
  tempoEl.value = beat.bpm;
  tempoValEl.textContent = beat.bpm;
  paintHarmony(beat, shown);
  refreshProgressionOptions();
}

// "Chorus · bar 3 of 8 · fill" (or the song length when nothing is playing)
function updateBarInfo(beat, v) {
  if (isSong(beat)) {
    const total = barSeconds(beat) * beat.totalBars;
    if (!v) barInfoEl.textContent = `${beat.totalBars} bars \u00b7 ${formatTime(total)}`;
    else barInfoEl.textContent = `${v.label} \u00b7 bar ${v.phraseBar + 1} of ${v.bars}` + (v.isFill ? " \u00b7 fill" : "");
    return;
  }
  const bars = beat.arrangement ? beat.arrangement.bars : 4;
  if (!arrangeOn) barInfoEl.textContent = "";
  else if (!v) barInfoEl.textContent = `${bars}-bar phrase`;
  else barInfoEl.textContent = `Bar ${v.phraseBar + 1} of ${v.bars}` + (v.isFill ? " \u00b7 fill" : "");
}

// Move the playhead marker (pass null to clear it)
function showStep(step) {
  document.querySelectorAll(".cell.now").forEach(c => c.classList.remove("now"));
  if (step === null) return;
  TRACK_ORDER.forEach(trackName => {
    // +1 because the first child of each row is the name button
    rowEls[trackName].children[step + 1].classList.add("now");
  });
}

// ---------- Song timeline ----------
// One block per section, as wide as it is long. Click a block to play from there.
function buildTimeline(beat) {
  timelineEl.innerHTML = "";
  timelineEl.hidden = !isSong(beat);
  songTimeEl.hidden = !isSong(beat);
  if (!isSong(beat)) return;
  beat.sections.forEach(section => {
    const seg = document.createElement("button");
    seg.type = "button";
    seg.className = "seg";
    seg.dataset.kind = section.kind;
    seg.style.flexGrow = Math.max(section.bars, 6);       // wide enough to read, still roughly to scale
    seg.title = `${section.label} (${section.bars} bars): click to play from here`;
    const label = document.createElement("span");
    label.textContent = section.label.replace("Pre-chorus", "Pre").replace("Final chorus", "Final");
    const fill = document.createElement("i");
    seg.append(fill, label);
    seg.addEventListener("click", () => jumpTo(section.start));
    timelineEl.appendChild(seg);
  });
  paintTimeline(null, -1);
  if (window.VoxloopVocal) window.VoxloopVocal.refreshSections();
}

// Show which section is playing, how far into it, and the clock
function paintTimeline(v, barIndex) {
  if (!isSong(current)) return;
  const segs = [...timelineEl.children];
  const active = v ? v.sectionIndex : (startBar > 0 ? current.sectionAt[startBar].index : -1);
  segs.forEach((seg, i) => {
    seg.classList.toggle("on", i === active);
    seg.firstChild.style.width = (v && i === active ? ((v.phraseBar + 1) / v.bars) * 100 : 0) + "%";
  });
  const total = barSeconds(current) * current.totalBars;
  const now = barSeconds(current) * (v ? barIndex : startBar);
  songTimeEl.textContent = `${formatTime(now)} / ${formatTime(total)}`;
}

// Play from a bar: right away if stopped, at the next bar line if playing
function jumpTo(barIndex) {
  if (!isSong(current)) return;
  if (playing) {
    pendingJump = barIndex;
    statusEl.textContent = "Jumping at the next bar.";
  } else {
    startBar = barIndex;
    paint(current);
    paintTimeline(null, -1);
  }
}

// ---------- Genre settings ----------
// Each genre has its own mix (volume per track).
function applyVolumes(genre) {
  TRACK_ORDER.forEach(trackName => {
    instruments[trackName].volume.value =
      TEMPLATES[genre].mix[trackName] + trim[trackName] + autoMix.autos[trackName];
  });
}

function applyGenreSettings(genre) {
  ensureEngine();
  TRACK_ORDER.forEach(trackName => { autoMix.autos[trackName] = 0; });   // a new genre starts from its own mix
  applyVolumes(genre);
  TRACK_ORDER.forEach(trackName => {
    pan[trackName].pan.value = TEMPLATES[genre].pan[trackName] || 0;
  });
}

// Every beat has its own sounds, reverb and swing (set by its style)
function applyBeatSound(beat) {
  ensureEngine();
  const template = resolveTemplate(beat.genre, beat.style);
  engine.applySound(beat.sound);
  engine.applyFx(template.fx, beat.bpm);
  swing = template.swing;
  swingEl.value = Math.round(swing * 100);
  swingValEl.textContent = swingEl.value;
}

// Swap in a beat right now (used while stopped)
function switchTo(next) {
  const genreChanged = next.genre !== current.genre;
  current = next;
  startBar = 0;
  try { if (typeof Tone !== 'undefined') Tone.Transport.bpm.value = current.bpm; } catch (e) { console.warn(e); }
  if (genreChanged) applyGenreSettings(current.genre);
  applyBeatSound(current);
  buildTimeline(current);
  syncStructureControls();
  paint(current);
  paintTimeline(null, -1);
}

// The loop-only controls (phrase length, arrangement) do nothing in a song
function syncStructureControls() {
  const song = isSong(current);
  if (arrangeEl) arrangeEl.disabled = song;
  if (phraseEl) phraseEl.disabled = song;
  if (structureEl) structureEl.value = current.structure;
  if (song && arrangeEl) arrangeEl.checked = true;
}

// ---------- Mute, solo and the mixer ----------
const strips = {};   // the mixer controls of each track (plus "master")

// A track plays unless it is muted, or another track is soloed and it is not
function isAudible(name) {
  return !muted.has(name) && (soloed.size === 0 || soloed.has(name));
}

// Make rows and mixer buttons show the current mute / solo state
function refreshStates() {
  TRACK_ORDER.forEach(name => {
    const row = rowEls[name];
    row.classList.toggle("muted", muted.has(name));
    row.classList.toggle("solo", soloed.has(name));
    row.classList.toggle("quiet", !muted.has(name) && !isAudible(name));
    row.querySelector(".label").setAttribute("aria-pressed", String(muted.has(name)));
    strips[name].mute.setAttribute("aria-pressed", String(muted.has(name)));
    strips[name].solo.setAttribute("aria-pressed", String(soloed.has(name)));
    if (!isAudible(name)) engine.silence(name);
  });
}

function toggleMute(name) {
  if (muted.has(name)) muted.delete(name); else muted.add(name);
  refreshStates();
}

function toggleSolo(name) {
  if (soloed.has(name)) soloed.delete(name); else soloed.add(name);
  refreshStates();
}

const formatDb = v => (v > 0 ? "+" : "") + v + " dB";

function miniButton(text, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", onClick);
  return button;
}

// One mixer strip: name, level slider, readout and (for tracks) M and S buttons
function buildStrip(name, text, range, onInput, withButtons) {
  const strip = document.createElement("div");
  strip.className = "strip";

  const nameEl = document.createElement("span");
  nameEl.textContent = text;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = range.min;
  slider.max = range.max;
  slider.step = 1;
  slider.value = 0;
  slider.setAttribute("aria-label", text + " level");

  const readout = document.createElement("output");
  readout.textContent = formatDb(0);

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    readout.textContent = formatDb(v);
    onInput(v);
  });

  strip.append(nameEl, slider, readout);
  const parts = { strip, slider, readout };

  if (withButtons) {
    parts.mute = miniButton("M", "Mute " + text, () => toggleMute(name));
    parts.solo = miniButton("S", "Solo " + text, () => toggleSolo(name));
    strip.append(parts.mute, parts.solo);
  }

  mixerEl.appendChild(strip);
  return parts;
}

// Track levels are +/- dB around the genre's own mix, so a genre switch keeps your changes
TRACK_ORDER.forEach(name => {
  strips[name] = buildStrip(name, TRACK_LABELS[name], { min: -24, max: 6 }, v => {
    trim[name] = v;
    if (instruments && instruments[name]) {
      instruments[name].volume.value = TEMPLATES[current.genre].mix[name] + v + autoMix.autos[name];
    }
  }, true);
});

strips.master = buildStrip("master", "master", { min: -30, max: 0 }, v => {
  Tone.getDestination().volume.value = v;
}, false);
strips.master.strip.classList.add("master");

mixerResetEl.addEventListener("click", () => {
  TRACK_ORDER.concat("master").forEach(name => {
    strips[name].slider.value = 0;
    strips[name].readout.textContent = formatDb(0);
  });
  TRACK_ORDER.forEach(name => { trim[name] = 0; });
  Tone.getDestination().volume.value = 0;
  muted.clear();
  soloed.clear();
  applyVolumes(current.genre);
  refreshStates();
});

// ---------- Auto-mix ----------
// Listens to every track while the beat plays and nudges each one toward the genre's
// target balance (templates.js, `balance`), so nothing stays buried. It also keeps the
// loudest peak at -6 dBFS (room for a vocal) unless Mastering is on. In a song the master
// level is set from the CHORUSES, the loudest part, so the rest of the song sits below it.
const dbToGain = db => Math.pow(10, db / 20);

const barLevels = {};                       // loudest short-term level this bar, by track
let barPeak = -Infinity;                    // loudest sample of the final output this bar
let barPowerSum = 0;
let barPowerCount = 0;

function resetBarMeters() {
  TRACK_ORDER.forEach(name => { barLevels[name] = -Infinity; });
  barPeak = -Infinity;
  barPowerSum = 0;
  barPowerCount = 0;
}
resetBarMeters();

// Read all the meters about 60 times a second and remember the loudest moment of the bar
function sampleLevels() {
  if (playing && trackAnalyser && masterAnalyser) {
    TRACK_ORDER.forEach(name => {
      const level = levelDb(trackAnalyser[name].getValue());
      if (level > barLevels[name]) barLevels[name] = level;
    });
    const wave = masterAnalyser.getValue();
    const peak = peakDb(wave);
    if (peak > barPeak) barPeak = peak;
    const rms = levelDb(wave);
    if (Number.isFinite(rms)) { barPowerSum += Math.pow(10, rms / 10); }
    barPowerCount++;
  }
  requestAnimationFrame(sampleLevels);
}
requestAnimationFrame(sampleLevels);

// Start (or restart) listening. mode "full" balances the tracks and the master level;
// "master" only sets the master level (used when Mastering is switched).
//   barsToListen : how many bars to hear (a whole song by default)
function startListening(mode, barsToListen) {
  autoMix.mode = mode || "full";
  autoMix.listening = autoMix.on;
  autoMix.armed = false;
  autoMix.balanced = false;
  autoMix.barsHeard = 0;
  autoMix.masterReadings = 0;
  autoMix.barsToListen = barsToListen || (isSong(current) ? current.totalBars : (current.arrangement ? current.arrangement.bars : 4) + 4);
  autoMix.peaks = [];
  autoMix.rmsRing = [];
  TRACK_ORDER.forEach(name => { autoMix.logs[name] = []; });
  lastBarKind = null;
  resetBarMeters();
  updateMixBadge();
}

// Called at the start of every bar while playing
function onBarStart() {
  if (!playing) return;

  // The bar we start measuring begins here
  if (autoMix.listening && !autoMix.armed) {
    autoMix.armed = true;
    lastBarKind = view ? view.kind : null;
    resetBarMeters();
    return;
  }

  // Otherwise the bar that just ended is complete: collect what it measured
  const levels = { ...barLevels };
  const peak = barPeak;
  const rms = barPowerCount ? 10 * Math.log10(barPowerSum / barPowerCount) : -Infinity;
  const endedKind = lastBarKind;
  lastBarKind = view ? view.kind : null;
  resetBarMeters();
  autoMix.last = { peak, rms };
  if (!autoMix.on || !autoMix.listening) return;

  // Remember how loud each track is at its ORIGINAL volume (the user's trim and the auto-trim
  // that were applied while measuring are taken off). Because of that, a correction never
  // changes what the next bar tells us, and the mix settles instead of chasing itself.
  TRACK_ORDER.forEach(name => {
    if (levels[name] > AUTOMIX.floorDb) {
      autoMix.logs[name].push(levels[name] - trim[name] - autoMix.autos[name]);
    }
  });
  autoMix.barsHeard++;

  if (autoMix.mode === "full") adjustTracks();

  // The final output: keep the last few loud bars to set the master level from
  // (in a song only the choruses count, because they are the loudest part)
  const loud = !isSong(current) || endedKind === "chorus";
  if (loud) {
    if (Number.isFinite(peak)) autoMix.peaks = [...autoMix.peaks, peak - autoMix.master].slice(-4);
    if (Number.isFinite(rms)) autoMix.rmsRing = [...autoMix.rmsRing, rms].slice(-2);
    autoMix.masterReadings++;
    if (autoMix.masterReadings >= 2) adjustMaster();
  }

  const masterDone = autoMix.masterReadings >= 4 || !isSong(current) && autoMix.barsHeard >= 2;
  if (autoMix.barsHeard >= autoMix.barsToListen && masterDone) {
    autoMix.listening = false;
    autoMix.balanced = true;
  }
  if (calibrating) statusEl.textContent = `Balancing the mix\u2026 ${Math.min(autoMix.barsHeard, autoMix.barsToListen)} / ${autoMix.barsToListen} bars`;
  updateMixBadge();
  renderMixReport();
}

// Set each track's volume from where it naturally sits compared with the kick.
// A track needs two bars of readings first (one bar can be a fluke), and the middle
// value of all its readings is used.
function adjustTracks() {
  const levels = {};
  TRACK_ORDER.forEach(name => {
    levels[name] = autoMix.logs[name].length >= 2 ? median(autoMix.logs[name]) : -Infinity;
  });
  const result = balanceTrims({ levels, balance: TEMPLATES[current.genre].balance });
  autoMix.rel = { ...autoMix.rel, ...result.rel };

  TRACK_ORDER.forEach(name => {
    if (result.autos[name] === undefined) return;
    if (Math.abs(result.autos[name] - autoMix.autos[name]) <= AUTOMIX.toleranceDb) return;
    autoMix.autos[name] = result.autos[name];
    instruments[name].volume.rampTo(
      TEMPLATES[current.genre].mix[name] + trim[name] + autoMix.autos[name], 0.4
    );
  });
}

// Keep the final output at the headroom target (or at the mastered loudness)
function adjustMaster() {
  const rms = autoMix.rmsRing.length
    ? 10 * Math.log10(autoMix.rmsRing.reduce((s, v) => s + Math.pow(10, v / 10), 0) / autoMix.rmsRing.length)
    : -Infinity;
  const next = masterTrim({
    peaks: autoMix.peaks, rms, mastering: masteringOn, current: autoMix.master
  });
  if (Math.abs(next - autoMix.master) < AUTOMIX.toleranceDb) return;
  autoMix.master = next;
  masterBus.gain.rampTo(MASTER_BASE * dbToGain(next), 0.3);
}

function updateMixBadge() {
  let text = "";
  if (!autoMix.on) text = "Auto-mix off";
  else if (autoMix.listening) text = "Mix: listening\u2026";
  else if (autoMix.balanced) text = "Mix: balanced";
  if (mixBadgeEl) mixBadgeEl.textContent = text;
}

// The table in the Mixer panel: what the auto-mix heard and what it did
function renderMixReport() {
  const balance = TEMPLATES[current.genre].balance;
  const fmt = v => (v > 0 ? "+" : "") + v.toFixed(0);
  mixReportEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "mixrow head";
  ["track", "before", "target", "change"].forEach(text => {
    const cell = document.createElement("span");
    cell.textContent = text;
    header.appendChild(cell);
  });
  mixReportEl.appendChild(header);

  TRACK_ORDER.forEach(name => {
    if (name === "kick" || balance[name] === null || balance[name] === undefined) return;
    const row = document.createElement("div");
    row.className = "mixrow";
    const before = autoMix.rel[name];
    [
      TRACK_LABELS[name],
      before === undefined ? "\u2013" : fmt(before),
      fmt(balance[name]),
      fmt(autoMix.autos[name]) + " dB"
    ].forEach(text => {
      const cell = document.createElement("span");
      cell.textContent = text;
      row.appendChild(cell);
    });
    mixReportEl.appendChild(row);
  });

  const peak = autoMix.last.peak, rms = autoMix.last.rms;
  mixStatusEl.textContent = Number.isFinite(peak)
    ? `Output peak ${peak.toFixed(1)} dBFS \u00b7 average ${rms.toFixed(1)} dB \u00b7 ` +
      `"before" and "target" are in dB under the kick`
    : "Press Play: the mix is balanced while the beat plays.";
}

// ---------- Mix switches ----------
automixEl.addEventListener("change", () => {
  autoMix.on = automixEl.checked;
  if (autoMix.on) {
    if (playing) startListening("full");
  } else {
    // Back to the plain genre mix
    autoMix.listening = false;
    autoMix.balanced = false;
    TRACK_ORDER.forEach(name => { autoMix.autos[name] = 0; });
    applyVolumes(current.genre);
    autoMix.master = 0;
    masterBus.gain.rampTo(MASTER_BASE, 0.3);
  }
  updateMixBadge();
  renderMixReport();
});

vocalspaceEl.addEventListener("change", () => {
  vocalSpaceOn = vocalspaceEl.checked;
  vocalEQ.gain.rampTo(vocalSpaceOn ? -3 : 0, 0.05);
});

masteringEl.addEventListener("change", () => {
  masteringOn = masteringEl.checked;
  if (engine) engine.setMastering(masteringOn);
  if (autoMix.on && playing) startListening("master", 6);   // set the master level for the new mode
});

rebalanceEl.addEventListener("click", () => {
  if (!autoMix.on) { automixEl.checked = true; automixEl.dispatchEvent(new Event("change")); return; }
  if (playing) startListening("full");
  else mixStatusEl.textContent = "Press Play: the mix is balanced while the beat plays.";
});

// ---------- Locks ----------
// A locked group keeps its pattern when you press New beat or change genre.
Object.entries(TRACK_GROUP_LABELS).forEach(([group, text]) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = "Keep this part when you press New beat or change genre";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    if (locked.has(group)) locked.delete(group); else locked.add(group);
    button.setAttribute("aria-pressed", String(locked.has(group)));
    TRACK_ORDER.forEach(name => {
      if (TRACK_GROUPS[name] === group) rowEls[name].classList.toggle("locked", locked.has(group));
    });
  });
  locksEl.appendChild(button);
});

// ---------- Key, scale and chord pickers ----------
function addOption(selectEl, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  selectEl.appendChild(option);
}

addOption(rootEl, "auto", "Auto");
ROOT_LABELS.forEach((text, i) => addOption(rootEl, String(i), text));
addOption(scaleEl, "auto", "Auto");
Object.entries(SCALE_LABELS).forEach(([value, text]) => addOption(scaleEl, value, text));

// The progression list depends on the style and the scale, so rebuild it when those change
let progSignature = "";
function refreshProgressionOptions() {
  const scale = settings.scale !== "auto" ? settings.scale : current.key.scale;
  const list = resolveTemplate(current.genre, current.style).progressions[scale] || [];
  const signature = current.genre + "|" + current.style + "|" + scale;
  if (signature !== progSignature) {
    progSignature = signature;
    progEl.innerHTML = "";
    addOption(progEl, "auto", "Auto");
    list.forEach((degrees, i) => addOption(progEl, String(i), progressionLabel(scale, degrees)));
  }
  progEl.value = settings.progression === "auto" ? "auto" : String(settings.progression);
}

// ---------- Making beats ----------
// Everything the pickers, tempo and locks ask for, in the form the generator wants
function beatOptions() {
  const options = {
    from: current, lockGroups: [...locked], phraseBars: settings.phraseBars, structure: settings.structure
  };
  if (settings.style !== "auto") options.style = settings.style;
  if (settings.root !== "auto") options.root = settings.root;
  if (settings.scale !== "auto") options.scale = settings.scale;
  if (settings.progression !== "auto") options.progression = settings.progression;
  if (!settings.bpmAuto) options.bpm = settings.bpm;
  return options;
}

// Use a new beat: at the next bar if playing, or straight away if stopped
function useBeat(next, playingMessage, stoppedMessage) {
  if (Tone.Transport.state === "started") {
    pending = next;
    statusEl.textContent = playingMessage;
  } else {
    pending = null;
    switchTo(next);
    statusEl.textContent = stoppedMessage;
  }
}

// A new key, scale or progression changes only the harmony; the rhythm stays
function changeHarmony() {
  const options = {};
  if (settings.root !== "auto") options.root = settings.root;
  if (settings.scale !== "auto") options.scale = settings.scale;
  if (settings.progression !== "auto") options.progression = settings.progression;
  useBeat(
    rebuildHarmony(pending || current, options),
    "New key starts on the next bar.",
    "Key changed. Tap Play."
  );
}

fillStyleOptions();
buildTimeline(current);
syncStructureControls();
paint(current);
paintTimeline(null, -1);
refreshStates();
updateMixBadge();
renderMixReport();

// ---------- Sequencer ----------
const playCtx = {
  template: null, beat: null, view: null, stepSec: 0.2, swing: 0, humanize: true,
  sidechainOn: true, isAudible, floorTime: 0, lastWhen: {}
};

let sequence = null;
let beatLabReady = false;

function bootAudio() {
  if (beatLabReady) return true;
  try {
    ensureEngine();
    applyGenreSettings(current.genre);
    applyBeatSound(current);
    if (!sequence) {
      sequence = new Tone.Sequence((time, step) => {
        sequenceTick(time, step);
      }, [...Array(STEPS).keys()], "16n");
      sequence.start(0);
    }
    beatLabReady = true;
    if (statusEl) statusEl.textContent = "Ready. Tap Play.";
    return true;
  } catch (err) {
    console.error("[Beat Lab] audio boot failed", err);
    if (statusEl) statusEl.textContent = "Audio engine failed: " + (err && err.message ? err.message : err) + " — check the browser console.";
    return false;
  }
}

// Runs once per 16th note. `time` is the exact audio time to play at.
function sequenceTick(time, step) {
  // Tone fires a few more callbacks (~100ms) after Stop. Ignore them, so no
  // sound plays and no bar/state changes after the user pressed Stop.
  if (!playing) return;

  if (step === 0) {
    let swapped = false;
    if (pending) {
      // A new beat waits until the start of a bar, so the loop never breaks mid-bar
      const genreChanged = pending.genre !== current.genre;
      current = pending;
      pending = null;
      bar = 0;
      startBar = 0;
      swapped = true;
      try { if (typeof Tone !== 'undefined') Tone.Transport.bpm.value = current.bpm; } catch (e) { console.warn(e); }
      if (genreChanged) applyGenreSettings(current.genre);
      applyBeatSound(current);
      buildTimeline(current);
      syncStructureControls();
      startListening("full");      // a new beat or key: listen to the mix again
    } else if (pendingJump !== null) {
      bar = pendingJump;
      pendingJump = null;
    } else {
      bar += 1;
    }

    // The end of a song: back to the start, or stop
    if (isSong(current) && bar >= current.totalBars) {
      if (loopSong || calibrating) {
        bar = 0;
      } else {
        playing = false;
        Tone.Draw.schedule(() => stopPlayback("Finished. Press Download for the full beat."), time);
        return;
      }
    }

    // What is played in this bar: which tracks are in, the fill, fresh strength and
    // timing (a human never plays two bars exactly alike)
    view = barView(current, bar, arrangeOn);
    playCtx.view = view;
    playCtx.beat = current;
    playCtx.template = resolveTemplate(current.genre, current.style);
    playBarStart(engine, playCtx, time);

    const viewNow = view;
    const barNow = bar;
    Tone.Draw.schedule(() => {
      if (Tone.Transport.state !== "started") return;
      paint(current, viewNow);
      highlightChords(viewNow, barNow);
      paintTimeline(viewNow, barNow);
      onBarStart();
      if (swapped && !calibrating) statusEl.textContent = `Playing ${current.bpm} BPM.`;
    }, time);
  }

  playCtx.stepSec = 60 / current.bpm / 4;
  playCtx.swing = swing;
  playCtx.humanize = humanize;
  playCtx.sidechainOn = sidechainOn;
  playCtx.floorTime = Tone.immediate();
  TRACK_ORDER.forEach(trackName => playTrackStep(engine, playCtx, trackName, step, time));

  // Update the visuals at the same moment the sound plays.
  Tone.Draw.schedule(() => {
    if (Tone.Transport.state === "started") showStep(step);
  }, time);
}

// ---------- Play and stop ----------
// Other panels (the vocal recorder) can ask to be told when playback stops
const playbackStopHooks = [];

// fromBar: the bar to start at.  atTime: the exact audio time to start at (default: right now).
// Returns the audio time the first beat plays at.
function startPlayback(fromBar, atTime) {
  if (!bootAudio()) return null;
  // If a new beat was queued, use it right away
  if (pending) {
    const next = pending;
    pending = null;
    switchTo(next);
  }
  bar = (fromBar === undefined ? startBar : fromBar) - 1;   // the first step of the loop moves this to the start bar
  view = null;
  pendingJump = null;
  playing = true;
  startListening("full", calibrating ? 8 : undefined);
  const startAt = atTime === undefined ? Tone.now() + 0.05 : atTime;
  Tone.Transport.start(startAt);
  playBtn.textContent = "Stop";
  if (!calibrating) statusEl.textContent = `Playing ${current.bpm} BPM.`;
  return startAt;
}

function stopPlayback(message) {
  playing = false;
  autoMix.listening = false;
  updateMixBadge();
  try { Tone.Transport.stop(); } catch (e) {}
  if (engine) { engine.stopAll(); engine.openDucks(); }
  bar = -1;
  view = null;
  playCtx.lastWhen = {};
  paint(current);
  showStep(null);
  highlightChords(null);
  paintTimeline(null, -1);
  playBtn.textContent = "Play";
  statusEl.textContent = message || "Stopped.";
  playbackStopHooks.forEach(hook => { try { hook(); } catch (err) { console.warn(err); } });
}

playBtn.addEventListener("click", async () => {
  try {
    if (!bootAudio()) return;
    // Browsers only allow audio after a user click
    await Tone.start();
    if (Tone.Transport.state === "started") stopPlayback("Stopped.");
    else startPlayback();
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = "Could not start audio: " + (err && err.message ? err.message : err);
  }
});

// ---------- New beat, genre, style, structure ----------
// "New beat" and changing the genre both ask for a fresh beat of the chosen genre.
// Locked groups are kept, and the key, scale, chords and tempo pickers are respected.
function requestBeat() {
  useBeat(
    generatePattern(genreEl.value, beatOptions()),
    "New beat starts on the next bar.",
    "New beat ready. Tap Play."
  );
}

regenBtn.addEventListener("click", requestBeat);

genreEl.addEventListener("change", () => {
  settings.progression = "auto";   // a progression number means something different in each style
  settings.style = "auto";
  fillStyleOptions();
  requestBeat();
});

styleEl.addEventListener("change", () => {
  settings.style = styleEl.value;
  settings.progression = "auto";
  requestBeat();
});

structureEl?.addEventListener("change", () => {
  settings.structure = structureEl.value;
  useBeat(
    rebuildStructure(pending || current, settings.structure),
    "New song form starts on the next bar.",
    "Song form changed."
  );
});

loopSongEl.addEventListener("change", () => { loopSong = loopSongEl.checked; });

rootEl.addEventListener("change", () => {
  settings.root = rootEl.value === "auto" ? "auto" : Number(rootEl.value);
  if (settings.root !== "auto") changeHarmony();
});

scaleEl.addEventListener("change", () => {
  settings.scale = scaleEl.value;
  settings.progression = "auto";   // the old progression may not fit the new scale
  refreshProgressionOptions();
  if (settings.scale !== "auto") changeHarmony();
});

progEl.addEventListener("change", () => {
  if (progEl.value === "auto") {
    settings.progression = "auto";
    return;
  }
  // Progressions belong to a scale, so choosing one also fixes the scale
  if (settings.scale === "auto") {
    settings.scale = (pending || current).key.scale;
    scaleEl.value = settings.scale;
  }
  settings.progression = Number(progEl.value);
  changeHarmony();
});

// ---------- Tempo ----------
tempoEl.addEventListener("input", () => {
  const bpm = Number(tempoEl.value);
  settings.bpm = bpm;
  settings.bpmAuto = false;
  tempoAutoEl.checked = false;
  current.bpm = bpm;
  if (pending) pending.bpm = bpm;
  if (engine && typeof Tone !== "undefined") {
    Tone.Transport.bpm.value = bpm;
    engine.setTempo(bpm);
  }
  bpmEl.textContent = bpm;
  tempoValEl.textContent = bpm;
  if (!playing) { updateBarInfo(current, null); paintTimeline(null, -1); }
});

tempoAutoEl.addEventListener("change", () => {
  settings.bpmAuto = tempoAutoEl.checked;
  if (settings.bpmAuto) statusEl.textContent = "Next new beat picks a tempo for the style.";
});

// ---------- Humanizer controls ----------
humanizeEl.addEventListener("change", () => {
  humanize = humanizeEl.checked;
  paint(current); // cell brightness follows the setting
});

swingEl.addEventListener("input", () => {
  swing = Number(swingEl.value) / 100;
  swingValEl.textContent = swingEl.value;
});

// ---------- Arrangement and mix polish controls ----------
arrangeEl?.addEventListener("change", () => {
  arrangeOn = arrangeEl.checked;
  if (!playing) paint(current);   // while playing, the next bar picks it up
});

phraseEl?.addEventListener("change", () => {
  settings.phraseBars = Number(phraseEl.value);
  useBeat(
    rebuildArrangement(pending || current, settings.phraseBars),
    "New phrase length starts on the next bar.",
    "Phrase length changed."
  );
});

sidechainEl?.addEventListener("change", () => {
  sidechainOn = sidechainEl.checked;
  if (!sidechainOn && engine) engine.openDucks();
});

// ---------- Download ----------
// Waits until a condition is true (or the time runs out)
function waitFor(test, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (test() || Date.now() - started > timeoutMs) { clearInterval(timer); resolve(); }
    }, 150);
  });
}

// If the mix has not been balanced yet, run the chorus silently so the auto-mix can listen first.
async function calibrateMix() {
  if (!autoMix.on || autoMix.balanced || !isSong(current)) return;
  const chorus = current.sections.find(section => section.kind === "chorus");
  const destination = Tone.getDestination();
  const wasMuted = destination.mute;
  calibrating = true;
  destination.mute = true;
  try {
    statusEl.textContent = "Balancing the mix\u2026";
    startPlayback(chorus ? chorus.start : 0);
    const waitMs = (9 + 3) * barSeconds(current) * 1000 + 4000;
    await waitFor(() => autoMix.balanced || !playing, waitMs);
  } finally {
    stopPlayback("");
    destination.mute = wasMuted;
    calibrating = false;
  }
}

// Everything that decides how the beat sounds right now. The download, "Send to Pipeline" and
// "Open in Studio" all render with exactly this, so what you get is what you hear.
function currentRenderSettings() {
  return {
    trim: { ...trim },
    autos: { ...autoMix.autos },
    masterDb: autoMix.master,
    masterStripDb: Tone.getDestination().volume.value,
    masteringOn, vocalSpaceOn, sidechainOn, humanize, swing, isAudible
  };
}

// Get the beat ready (stop playback, use a queued beat, balance the mix if it has not been balanced),
// then render the whole song. `what` is the first words of the status message.
async function renderBeatForOutput(what) {
  await Tone.start();
  if (playing) stopPlayback("");
  if (pending) { const next = pending; pending = null; switchTo(next); }

  await calibrateMix();

  statusEl.textContent = `${what}\u2026 0%`;
  await new Promise(resolve => setTimeout(resolve, 60));      // let the message show
  return renderSongBuffer(current, currentRenderSettings(), (done, total) => {
    statusEl.textContent = `${what}\u2026 ${Math.round((done / total) * 100)}%`;
  });
}

exportBtn.addEventListener("click", async () => {
  if (exporting) return;
  if (!bootAudio()) return;
  exporting = true;
  exportBtn.disabled = true;
  appEl.setAttribute("inert", "");           // nothing can change the beat while it is being rendered
  try {
    const started = performance.now();
    const buffer = await renderBeatForOutput("Rendering the full beat");

    const bits = Number(bitsEl.value) === 16 ? 16 : 24;
    const wav = encodeAudioBufferWav(buffer, bits);
    const filename = exportFileName(current);
    downloadBlob(wav.blob, filename);
    const took = Math.max(1, Math.round((performance.now() - started) / 1000));
    statusEl.textContent = `Saved ${filename} \u00b7 ${formatTime(wav.seconds)} \u00b7 ${(wav.bytes / 1048576).toFixed(1)} MB \u00b7 made in ${took}s`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Could not make the download: " + err.message;
  } finally {
    appEl.removeAttribute("inert");
    exportBtn.disabled = false;
    exporting = false;
  }
});


// ---------- Voxloop Studio bridge ----------
window.VoxloopBeatLab = {
  pause() {
    try {
      if (playing) stopPlayback("");                        // also lets the vocal recorder wrap up its take
      else if (Tone.Transport.state === "started") Tone.Transport.stop();
    } catch (e) {}
  },
  async renderCurrentBuffer() {
    if (!current) throw new Error("No beat yet");
    return renderBeatForOutput("Rendering the beat");
  },
  getCurrentBeat() { return current; },
  async sendToPipeline() {
    const status = $("bl-status");
    if (status) status.textContent = "Rendering beat for Pipeline\u2026";
    try {
      if (!bootAudio()) return;
      this.pause();
      const buffer = await this.renderCurrentBuffer();
      // Hand off to Vocal Vault state
      const S = window.VocalVaultState;
      if (!S) throw new Error("Pipeline state not ready");
      // VocalVaultState uses internal closures; expose a setter via custom event
      // The Pipeline would otherwise have to guess the key and tempo from the audio. The Beat Lab knows them exactly,
      // including modes (a dorian beat is NOT natural minor, and the vocal must be tuned to the right notes).
      const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const meta = {
        bpm: current.bpm,
        key: { key: SHARP_NAMES[current.key.root], scale: current.key.scale.charAt(0).toUpperCase() + current.key.scale.slice(1), confidence: 1 }
      };
      window.dispatchEvent(new CustomEvent("vl-set-beat", {
        detail: { buffer, name: exportFileName(current).replace(/\.wav$/i, "") + " (Beat Lab)", meta }
      }));
      if (window.VocalVaultDAW && typeof window.VocalVaultDAW.setMode === "function") {
        window.VocalVaultDAW.setMode("pipeline");
      } else {
        // fallback: click the mode button
        const btn = document.querySelector('.mode-btn[data-mode="pipeline"]');
        if (btn) btn.click();
      }
      if (status) status.textContent = "Beat sent to Pipeline. Upload or record a vocal to continue.";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "Could not send: " + err.message;
    }
  },
  async sendToStudio() {
    const status = $("bl-status");
    if (status) status.textContent = "Rendering beat for Studio…";
    try {
      if (!bootAudio()) return;
      this.pause();
      const buffer = await this.renderCurrentBuffer();
      window.dispatchEvent(new CustomEvent("vl-set-beat-studio", {
        detail: { buffer, name: exportFileName(current).replace(/\.wav$/i, "") + " (Beat Lab)" }
      }));
      if (window.VocalVaultDAW && typeof window.VocalVaultDAW.setMode === "function") {
        window.VocalVaultDAW.setMode("studio");
      } else {
        const btn = document.querySelector('.mode-btn[data-mode="studio"]');
        if (btn) btn.click();
      }
      if (status) status.textContent = "Beat loaded in Studio. Add vocal lanes and record.";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "Could not send: " + err.message;
    }
  }
};

document.getElementById("bl-send-pipeline")?.addEventListener("click", () => window.VoxloopBeatLab.sendToPipeline());
document.getElementById("bl-send-studio")?.addEventListener("click", () => window.VoxloopBeatLab.sendToStudio());


// Attempt audio boot after DOM is fully ready (dropdowns already filled above)
try {
  if (document.readyState === "complete") bootAudio();
  else window.addEventListener("load", () => { try { bootAudio(); } catch (e) { console.warn(e); } });
} catch (e) {
  console.warn("[Beat Lab] deferred boot", e);
}
