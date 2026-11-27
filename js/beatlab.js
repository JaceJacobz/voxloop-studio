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

let current = generatePattern("rnb", { structure: "auto" });       // the beat that is playing
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
const keptRoles = new Set();               // instruments (bass, chords, ...) kept when making a new beat
const beatHistory = [];                    // the beats you had before, newest last (the Back button)
let backTarget = null;
const trim = {};                            // dB the user added or removed per track
TRACK_ORDER.forEach(name => { trim[name] = 0; });

// What the pickers are set to. "auto" means: choose at random on every new beat.
const settings = {
  sound: {},   // tonal parts the user picked in the Sound panel; kept when making a new beat
  drums: {},   // drum samples the user picked, { kick: 2, ... }; the other types get a new random pick on every beat
  vibe: "auto",   // "auto" = the producer reads the genre, key and tempo; or one of VIBES
  root: "auto", scale: "auto", progression: "auto", style: "auto",
  structure: "auto", bpmAuto: true, bpm: current.bpm, phraseBars: 4
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

// Structure dropdown: auto (a different form each time) / full song / short song / loop / your own edited form
[["auto", "Auto (varied)"], ...Object.entries(STRUCTURES).map(([key, s]) => [key, s.name]), ["custom", "Custom (edited)"]]
  .forEach(([key, name]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = name;
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

// ---------- Step grid ----------
// One row per sound, one box per sixteenth note, coloured by family (drums, hats, percussion, low end, harmony).
// The drum and percussion rows can be edited (tap or drag); the rows that play notes (bass, chords, pad, pluck, lead,
// log drum) follow the chords and the melody, so they are shown but not drawn by hand.
const rowEls = {};
// Everything but the lead can be drawn: the lead's notes are written note by note in its melody, so a new hit would have no note.
const GRID_EDITABLE = new Set(["kick", "snare", "clap", "rim", "hat", "openhat", "shaker", "perc", "bell", "bass", "logdrum", "chords", "pad", "pluck"]);
const GRID_PITCHED = new Set(["bass", "logdrum"]);        // these also have a note per hit (Pitch tool)
let gridTool = "hits";
let gridEdit = false;                 // Edit pattern is on: the grid shows the pattern itself, and taps change it
let gridPainting = null;              // while dragging: { track, value }
let gridKind = "chorus";              // which part's pattern is being edited (song)
// The note of a bass or log drum hit, as a short label (R = root, 3, 5, 7, 8 = octave) and how to step to the next one
const PITCH_TOKENS = ["r", "3", "5", "7", "8"], PITCH_TONES = ["root", "third", "fifth", "seventh", "octave"];
const PITCH_LABEL = { r: "R", "3": "3", "5": "5", "7": "7", "8": "8", "9": "9", "4": "4", l: "\u2193", b: "b7", root: "R", third: "3", fifth: "5", seventh: "7", octave: "8" };
function pitchLabel(beat, track, step) {
  const riff = beat.riffs && beat.riffs[track];
  if (riff) return PITCH_LABEL[riff.tokens[step]] || "R";
  if (track === "bass") return PITCH_LABEL[beat.bassTones[step]] || "R";
  return String((beat.logTones[step] || 0) + 1);
}
function cyclePitch(beat, track, step, reset) {
  const riff = beat.riffs && beat.riffs[track];
  if (riff) {
    const at = PITCH_TOKENS.indexOf(riff.tokens[step]);
    riff.tokens[step] = reset ? "r" : PITCH_TOKENS[(at + 1) % PITCH_TOKENS.length];
  } else if (track === "bass") {
    const at = PITCH_TONES.indexOf(beat.bassTones[step]);
    beat.bassTones[step] = reset ? "root" : PITCH_TONES[(at + 1) % PITCH_TONES.length];
  } else {
    beat.logTones[step] = reset ? 0 : ((beat.logTones[step] || 0) + 1) % 4;
  }
}
const ROW_SOUND = { bass: "bass", logdrum: "log", chords: "chords", pad: "pad", pluck: "pluck", lead: "lead" };

// The beat numbers above the grid (1 2 3 4), so the sixteenths are easy to count
const rulerEl = document.createElement("div");
rulerEl.className = "row ruler";
rulerEl.appendChild(Object.assign(document.createElement("span"), { className: "label ruler-label", textContent: "beat" }));
for (let i = 0; i < STEPS; i++) {
  const t = document.createElement("div");
  t.className = "cell tick" + (i % 4 === 0 ? " beatno" : "") + (Math.floor(i / 4) % 2 === 1 ? " alt" : "");
  t.textContent = i % 4 === 0 ? String(i / 4 + 1) : "";
  rulerEl.appendChild(t);
}
gridEl.appendChild(rulerEl);

// Build the rows once: a name button plus 16 cells per track
TRACK_ORDER.forEach((trackName, index) => {
  const rowEl = document.createElement("div");
  rowEl.className = "row" + (GRID_EDITABLE.has(trackName) ? " editable" : " readonly");
  rowEl.dataset.row = trackName;
  rowEl.dataset.group = TRACK_GROUPS[trackName];
  if (index > 0 && TRACK_GROUPS[trackName] !== TRACK_GROUPS[TRACK_ORDER[index - 1]]) {
    rowEl.classList.add("group-start");
  }

  // Click the name to mute / unmute the track
  const label = document.createElement("button");
  label.type = "button";
  label.className = "label";
  const nameEl = document.createElement("span");
  nameEl.className = "label-name";
  nameEl.textContent = TRACK_LABELS[trackName];
  const subEl = document.createElement("span");
  subEl.className = "label-sub";
  label.append(nameEl, subEl);
  label.title = "Click to mute or unmute";
  label.setAttribute("aria-pressed", "false");
  label.addEventListener("click", () => toggleMute(trackName));
  rowEl.appendChild(label);

  for (let i = 0; i < STEPS; i++) {
    const cell = document.createElement("div");
    cell.className = "cell" + (Math.floor(i / 4) % 2 === 1 ? " alt" : "");
    rowEl.appendChild(cell);
  }

  gridEl.appendChild(rowEl);
  rowEls[trackName] = rowEl;
});

// The instrument's name under the name of each melodic row ("bass: 808 punch")
function refreshRowSubs(beat) {
  Object.entries(ROW_SOUND).forEach(([track, role]) => {
    const id = beat.sound && resolveInstrument(role, beat.sound[role]), info = id && instrumentInfo(id);
    rowEls[track].querySelector(".label-sub").textContent = info ? info.name : "";
  });
}

// The pattern the editor works on: a song part's pattern, or the loop's own
function editPattern(beat) {
  return isSong(beat) ? beat.patterns[gridKind] || beat.patterns.chorus : null;
}
function patternHits(beat, track) {
  const pat = editPattern(beat);
  return (pat ? pat.hits[track] : beat.tracks[track]) || Array(STEPS).fill(0);
}
function setPatternHit(beat, track, step, on) {
  const apply = hits => { if (hits && hits[track]) hits[track][step] = on ? 1 : 0; };
  const pat = editPattern(beat);
  const val = on ? 1 : 0;
  // keep a copy of the first state, so Reset pattern can bring it back
  beat.gridBackup = beat.gridBackup || {};
  const key = pat ? gridKind : "loop";
  if (!beat.gridBackup[key]) {
    beat.gridBackup[key] = pat ? JSON.parse(JSON.stringify({ hits: pat.hits, probs: pat.probs, alt: pat.alt || null }))
      : JSON.parse(JSON.stringify({ hits: beat.tracks, probs: beat.loopProbs || null }));
  }
  const write = p => { apply(p.hits); if (p.probs && p.probs[track]) p.probs[track][step] = val; };
  if (on && GRID_PITCHED.has(track)) cyclePitch(beat, track, step, true);      // a new bass or log drum hit starts on the root
  if (pat) {
    write(pat);
    if (pat.alt) write(pat.alt);
    if (gridKind === "chorus") beat.tracks[track][step] = val;        // beat.tracks mirrors the chorus pattern
  } else {
    beat.tracks[track][step] = val;
    if (beat.loopProbs && beat.loopProbs[track]) beat.loopProbs[track][step] = val;
  }
}
function resetPattern(beat) {
  const key = isSong(beat) ? gridKind : "loop", saved = beat.gridBackup && beat.gridBackup[key];
  if (!saved) return false;
  const copy = JSON.parse(JSON.stringify(saved));
  const pat = editPattern(beat);
  const restore = (into, from) => { Object.keys(from.hits).forEach(t => { into.hits[t] = from.hits[t]; if (from.probs && into.probs) into.probs[t] = from.probs[t]; }); };
  if (pat) {
    restore(pat, copy);
    if (pat.alt && copy.alt) restore(pat.alt, copy.alt);
    if (gridKind === "chorus") Object.keys(copy.hits).forEach(t => { beat.tracks[t] = copy.hits[t].slice(); });
  } else {
    Object.keys(copy.hits).forEach(t => { beat.tracks[t] = copy.hits[t]; });
    if (copy.probs && beat.loopProbs) Object.keys(copy.probs).forEach(t => { beat.loopProbs[t] = copy.probs[t]; });
  }
  delete beat.gridBackup[key];
  return true;
}

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
  refreshRowSubs(beat);
  TRACK_ORDER.forEach(trackName => {
    const cells = rowEls[trackName].querySelectorAll(".cell");
    // Edit pattern: show the pattern itself (what you change), not this bar's fills and variations
    const hits = gridEdit ? patternHits(beat, trackName) : tracks[trackName];
    hits.forEach((hit, i) => {
      cells[i].classList.toggle("on", hit === 1);
      // Brightness shows how hard the hit is played
      const vel = gridEdit ? 0.9 : humanize ? velocities[trackName][i] : FLAT_VELOCITY;
      cells[i].style.setProperty("--v", 0.55 + 0.45 * vel);
      if (GRID_PITCHED.has(trackName)) {
        if (gridEdit && hit === 1) cells[i].dataset.t = pitchLabel(beat, trackName, i); else delete cells[i].dataset.t;
      }
    });
    rowEls[trackName].classList.toggle("empty", !hits.some(Boolean));
    const rests = gridEdit
      ? isSong(beat) && !beat.sections.some((s, k) => s.kind === gridKind && beat.presence[k][trackName])
      : Boolean(shown) && !shown.present[trackName];
    rowEls[trackName].classList.toggle("resting", rests);
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
  if (typeof melodyPlayhead === "function") melodyPlayhead(step);
  document.querySelectorAll(".cell.now").forEach(c => c.classList.remove("now"));
  if (step === null) return;
  TRACK_ORDER.forEach(trackName => {
    // +1 because the first child of each row is the name button
    rowEls[trackName].children[step + 1].classList.add("now");
  });
  rulerEl.children[step + 1].classList.add("now");
}

// ---------- Song timeline ----------
// One block per part, as wide as it is long. Tap a block to select it (to edit it) and to play from there.
const FORM_NAMES = { intro: "Intro", verse: "Verse", pre: "Pre-chorus", chorus: "Chorus", bridge: "Bridge", outro: "Outro" };
let formDraft = [];            // [{ kind, bars, src, keep? }]  src = the section of the beat it came from (undefined = new)
let formTrash = [];            // removed parts: [{ kind, bars, at, keep }]
let formSel = 0;               // the selected part
let formTimer = null;
let lastAppliedBeat = null;    // the beat made from the user's own edit (so a swap to it does not reset the list)
function buildTimeline(beat) {
  timelineEl.innerHTML = "";
  timelineEl.hidden = !isSong(beat);
  songTimeEl.hidden = !isSong(beat);
  if (!isSong(beat)) return;
  const items = formDraft.length ? formDraft : beat.sections.map((s, i) => ({ kind: s.kind, bars: s.bars, src: i }));
  const same = items.length === beat.sections.length && items.every((f, i) => f.kind === beat.sections[i].kind && f.bars === beat.sections[i].bars);
  const seen = {}, count = {};
  items.forEach(f => { count[f.kind] = (count[f.kind] || 0) + 1; });
  items.forEach((item, i) => {
    seen[item.kind] = (seen[item.kind] || 0) + 1;
    const name = same ? beat.sections[i].label : FORM_NAMES[item.kind] + (count[item.kind] > 1 ? " " + seen[item.kind] : "");
    const seg = document.createElement("button");
    seg.type = "button";
    seg.className = "seg" + (i === formSel ? " sel" : "");
    seg.dataset.kind = item.kind;
    seg.style.flexGrow = Math.max(item.bars, 6);       // wide enough to read, still roughly to scale
    seg.title = `${name} (${item.bars} bars): tap to select it${same ? " and play from here" : ""}`;
    const label = document.createElement("span");
    label.textContent = name.replace("Pre-chorus", "Pre").replace("Final chorus", "Final");
    const fill = document.createElement("i");
    seg.append(fill, label);
    seg.addEventListener("click", () => {
      formSel = i;
      [...timelineEl.children].forEach((el, k) => el.classList.toggle("sel", k === i));
      if (gridEdit && same && beat.patterns && beat.patterns[item.kind]) { gridKind = item.kind; syncGridEdit(); }
      if (typeof renderFormTools === "function") renderFormTools();
      if (same) jumpTo(beat.sections[i].start);
    });
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
  swing = beat.swing != null ? beat.swing : template.swing;     // (a beat made around a voice can carry the swing of the singer)
  swingEl.value = Math.round(swing * 100);
  swingValEl.textContent = swingEl.value;
  refreshSoundUI(beat);
}

// Swap in a beat right now (used while stopped)
function switchTo(next) {
  const genreChanged = next.genre !== current.genre;
  if (next !== current) {                          // remember the beat we are leaving, so Back can return to it
    if (next === backTarget) backTarget = null;
    else { beatHistory.push(current); if (beatHistory.length > 30) beatHistory.shift(); }
    if (backBtn) backBtn.disabled = !beatHistory.length;
  }
  current = next;
  startBar = 0;
  try { if (typeof Tone !== 'undefined') Tone.Transport.bpm.value = current.bpm; } catch (e) { console.warn(e); }
  if (genreChanged) applyGenreSettings(current.genre);
  applyBeatSound(current);
  syncFormToBeat();
  buildTimeline(current);
  syncStructureControls();
  paint(current);
  paintTimeline(null, -1);
  if (gridEdit) syncGridEdit();
  if (typeof syncMelodyRoll === "function") syncMelodyRoll();
}

// The loop-only controls (phrase length, arrangement) do nothing in a song
function syncStructureControls() {
  const song = isSong(current);
  if (arrangeEl) arrangeEl.disabled = song;
  if (phraseEl) phraseEl.disabled = song;
  if (structureEl) structureEl.value = current.formSource === "auto" ? "auto" : current.formSource === "edited" ? "custom" : current.structure;
  if (song && arrangeEl) arrangeEl.checked = true;
}

// ---------- Mute, solo and the mixer ----------
const strips = {};   // the mixer controls of each track (plus "master")

// The melody toggle ("Melody" in the toolbar, on by default). Off removes everything that plays a TUNE a singer would
// feel pushed to follow: the lead and the pluck are silenced, and the bass and the log drum stop playing riffs and play
// the root note of the chord only (their rhythm stays, so the beat still grooves). The chords, pad and all drums and
// percussion stay, so the key and the chord changes are all still there for the vocal and for the Studio melody
// writer. Downloads, stems and the Mix Doctor all follow it (isAudible and flatMelody travel with the render settings).
let melodyOn = true;
function isMelodyTrack(name) {
  if (name === "lead" || name === "pluck") return true;
  return false;                                   // the bell is a percussion recording, not a melody
}

// A track plays unless it is muted, or another track is soloed and it is not, or it is melody and the melody is off
function isAudible(name) {
  if (!melodyOn && isMelodyTrack(name)) return false;
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

const melodyEl = $("bl-melody");
melodyEl?.addEventListener("change", () => {
  melodyOn = melodyEl.checked;
  playCtx.flatMelody = !melodyOn;
  ensureEngine();
  refreshStates();
  statusEl.textContent = melodyOn ? "Melody on." : "Melody off: no lead, no pluck, and the bass and log drum play only the root note. Chords, pad and drums keep playing, so the key stays and you are free to sing any tune.";
});

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

// ---------- Keep an instrument ----------
// "Keep instrument: Bass" holds the bass instrument while New beat changes everything else (the producer builds around it).
const keepRolesEl = $("bl-keepRoles");
const KEEP_ROLES = [["bass", "Bass"], ["chords", "Keys"], ["pad", "Pad"], ["pluck", "Pluck"], ["lead", "Lead"], ["log", "Log drum"]];
const keepButtons = {};
KEEP_ROLES.forEach(([role, label]) => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    if (keptRoles.has(role)) keptRoles.delete(role); else keptRoles.add(role);
    button.setAttribute("aria-pressed", String(keptRoles.has(role)));
    // keeping an instrument tells the producer you like it (un-keeping takes the vote back)
    try { const id = resolveInstrument(role, current.sound && current.sound[role]); TASTE.vote(role, id, keptRoles.has(role) ? 1 : -1); } catch (err) { /* no taste memory */ }
  });
  keepButtons[role] = button;
  if (keepRolesEl) keepRolesEl.appendChild(button);
});
function refreshKeepButtons(beat) {
  KEEP_ROLES.forEach(([role, label]) => {
    const id = beat.sound && resolveInstrument(role, beat.sound[role]), info = id && instrumentInfo(id);
    keepButtons[role].textContent = label + (info ? ": " + info.name : "");
    keepButtons[role].title = "Keep this " + label.toLowerCase() + " instrument when you press New beat";
    keepButtons[role].hidden = !info;
  });
}
const backBtn = $("bl-back");
backBtn?.addEventListener("click", () => {
  const prev = beatHistory.pop();
  if (!prev) return;
  backBtn.disabled = !beatHistory.length;
  backTarget = prev;
  useBeat(prev, "Back to the previous beat on the next bar.", "Back to the previous beat.");
});

// ---------- Edit pattern ----------
const gridEditBtn = $("bl-gridEdit"), gridKindWrap = $("bl-gridKindWrap"), gridKindEl = $("bl-gridKind");
const gridResetBtn = $("bl-gridReset"), gridHintEl = $("bl-gridHint");
const GRID_HINT_OFF = gridHintEl ? gridHintEl.textContent : "";

function fillGridKinds() {
  const kinds = isSong(current) ? [...new Set(current.sections.map(s => s.kind))] : [];
  gridKindEl.innerHTML = "";
  kinds.forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = FORM_NAMES[k]; gridKindEl.appendChild(o); });
  if (!kinds.includes(gridKind)) gridKind = kinds.includes("chorus") ? "chorus" : kinds[0] || "chorus";
  gridKindEl.value = gridKind;
}
function syncGridEdit() {
  if (!gridEditBtn) return;
  gridEl.classList.toggle("editing", gridEdit);
  gridEditBtn.setAttribute("aria-pressed", String(gridEdit));
  gridEditBtn.textContent = gridEdit ? "Done editing" : "Edit pattern";
  gridKindWrap.hidden = !(gridEdit && isSong(current));
  gridResetBtn.hidden = !gridEdit;
  gridToolsEl.hidden = !gridEdit;
  gridToolsEl.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.tool === gridTool)));
  if (gridEdit) fillGridKinds();
  gridHintEl.textContent = !gridEdit ? GRID_HINT_OFF
    : "Tap or drag the boxes to add or remove hits" + (isSong(current) ? ". A change applies to every " + FORM_NAMES[gridKind].toLowerCase() + " in the song." : " (it changes the loop).")
      + " Bass and log drum hits also have a note: use the Pitch tool and tap a hit to change it (R = root, 3, 5, 7, 8 = octave). The lead plays its written melody, so it cannot be drawn by hand.";
  paint(current, playing ? view : null);
}
gridEditBtn?.addEventListener("click", () => { gridEdit = !gridEdit; if (!gridEdit) gridTool = "hits"; syncGridEdit(); });
const gridToolsEl = $("bl-gridTools");
gridToolsEl?.addEventListener("click", e => {
  const btn = e.target.closest("button[data-tool]");
  if (!btn) return;
  gridTool = btn.dataset.tool;
  syncGridEdit();
});
gridKindEl?.addEventListener("change", () => { gridKind = gridKindEl.value; syncGridEdit(); });
gridResetBtn?.addEventListener("click", () => {
  statusEl.textContent = resetPattern(current) ? "Pattern put back as it was." : "Nothing to reset: you have not changed this pattern.";
  paint(current, playing ? view : null);
});

// Tap a box to switch a hit on or off; drag along a row to paint several. (A change is heard from the next bar.)
function gridCellAt(x, y) {
  const el = document.elementFromPoint(x, y), cell = el && el.closest ? el.closest(".grid .row:not(.ruler) .cell") : null;
  if (!cell) return null;
  const row = cell.parentElement;
  return { track: row.dataset.row, step: [...row.children].indexOf(cell) - 1 };
}
function gridSet(track, step, on) {
  setPatternHit(current, track, step, on);
  if (pending && pending !== current && isSong(pending) === isSong(current)) { /* the next beat is a different one: leave it */ }
  paint(current, playing ? view : null);
}
gridEl.addEventListener("pointerdown", e => {
  if (!gridEdit) return;
  const hit = gridCellAt(e.clientX, e.clientY);
  if (!hit || hit.step < 0) return;
  if (!GRID_EDITABLE.has(hit.track)) {
    statusEl.textContent = "The lead plays its written melody, so it is not drawn by hand. Use New beat, Variation or Keep instrument to change it.";
    return;
  }
  e.preventDefault();
  if (gridTool === "pitch") {
    if (!GRID_PITCHED.has(hit.track)) { statusEl.textContent = "The Pitch tool changes the note of a bass or log drum hit. Switch to Hits for the other rows."; return; }
    if (!patternHits(current, hit.track)[hit.step]) return;
    cyclePitch(current, hit.track, hit.step, false);
    paint(current, playing ? view : null);
    return;
  }
  const on = !patternHits(current, hit.track)[hit.step];
  gridPainting = { track: hit.track, value: on };
  gridSet(hit.track, hit.step, on);
  if (on) { try { ensureEngine(); Tone.start(); engine.preview(hit.track); } catch (err) { /* no sound yet */ } }
});
gridEl.addEventListener("pointermove", e => {
  if (!gridPainting) return;
  const hit = gridCellAt(e.clientX, e.clientY);
  if (!hit || hit.track !== gridPainting.track || hit.step < 0) return;
  if (!!patternHits(current, hit.track)[hit.step] !== gridPainting.value) gridSet(hit.track, hit.step, gridPainting.value);
});
["pointerup", "pointercancel", "pointerleave"].forEach(type => gridEl.addEventListener(type, () => { gridPainting = null; }));

// The loading indicator: shows while a beat's drums and instruments are being fetched
BEAT_LOADING_HOOK = p => {
  const box = $("bl-loading");
  if (!box) return;
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  $("bl-loadText").textContent = "Loading sounds " + p.done + "/" + p.total;
  $("bl-loadFill").style.width = Math.round(100 * p.done / Math.max(1, p.total)) + "%";
};
ensureBeatSound(current.sound);                       // start fetching the first beat's sounds now

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
// The song form to hand the generator: the user's own edited form is kept; Auto makes a new one each time.
function formOpts(beat) {
  if (beat && beat.structure === "custom" && beat.formSource !== "auto") return { structure: "custom", form: beat.form };
  if (!beat && settings.structure === "custom") { const c = currentOrPending(); return c.form ? { structure: "custom", form: c.form } : { structure: "auto" }; }
  if (beat && beat.formSource === "auto") return { structure: "custom", form: beat.form };   // a variation keeps its song form
  return beat ? { structure: beat.structure } : { structure: settings.structure };
}
// Everything the pickers, tempo and locks ask for, in the form the generator wants
function beatOptions() {
  const options = {
    from: current, lockGroups: [...locked], keepRoles: [...keptRoles], phraseBars: settings.phraseBars, ...formOpts()
  };
  if (settings.style !== "auto") options.style = settings.style;
  if (settings.root !== "auto") options.root = settings.root;
  if (settings.scale !== "auto") options.scale = settings.scale;
  if (settings.progression !== "auto") options.progression = settings.progression;
  if (!settings.bpmAuto) options.bpm = settings.bpm;
  if (Object.keys(settings.sound).length) options.sound = Object.assign({}, settings.sound);
  if (settings.vibe && settings.vibe !== "auto") options.vibe = settings.vibe;
  if (Object.keys(settings.drums).length) options.drums = Object.assign({}, settings.drums);
  return options;
}

// Use a new beat: at the next bar if playing, or straight away if stopped
function useBeat(next, playingMessage, stoppedMessage) {
  const go = () => {
    if (Tone.Transport.state === "started") {
      pending = next;
      statusEl.textContent = playingMessage;
    } else {
      pending = null;
      switchTo(next);
      statusEl.textContent = stoppedMessage;
    }
  };
  // The new beat's drum recordings are fetched first (a few small files; instant once a genre has been loaded),
  // so it never starts with a missing kick
  const drums = next.sound && next.sound.drums;
  if ((drums && !samplesReady(drums)) || !instrumentsReady(next.sound)) {
    statusEl.textContent = "Loading the drum and instrument sounds\u2026";
    ensureBeatSound(next.sound).then(() => { go(); producerWarmUp(next.genre); });
  } else {
    go();
    producerWarmUp(next.genre);
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
  sidechainOn: true, isAudible, flatMelody: false, floorTime: 0, lastWhen: {}
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
      syncFormToBeat();
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
  playCtx.flatMelody = !melodyOn;
  playCtx.floorTime = Tone.immediate();
  TRACK_ORDER.forEach(trackName => playTrackStep(engine, playCtx, trackName, step, time));

  // Update the visuals at the same moment the sound plays.
  Tone.Draw.schedule(() => {
    if (Tone.Transport.state === "started") showStep(step);
  }, time);
}

// ---------- Play and stop ----------
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
}

// Why there might be no sound, in plain words. Every sound is a recording now, so if the files cannot be fetched the
// beat is silent: most often because the page was opened from a folder (file://) instead of a web address.
function soundProblem() {
  const sound = current && current.sound;
  const drumFailed = sound && sound.drums && typeof SAMPLE_FAILED !== "undefined" && SAMPLE_TYPES.some(t => SAMPLE_FAILED[sampleKey(sound.drums.genre, t, sound.drums[t])]);
  const instFailed = typeof INSTRUMENT_FAILED !== "undefined" && soundInstrumentIds(sound).some(id => instrumentInfo(id).notes.some(n => INSTRUMENT_FAILED[id + "/" + n]));
  if (drumFailed || instFailed) {
    return location.protocol === "file:"
      ? "Some sound files could not be found. Keep the whole folder together: the samples and fileaudio folders must sit next to index.html."
      : "Some sound files could not be loaded (check your internet connection, then press New beat). The beat may be missing parts or silent.";
  }
  if (Tone.context.state !== "running") return "The browser is holding the audio back. Tap Play again. On a phone, also check that the silent switch is off and the volume is up.";
  return "";
}
// iPhones keep web audio silent while the ring/silent switch is on, unless the page says it is playing media
function unlockAudioOnce() {
  if (unlockAudioOnce.done) return;
  unlockAudioOnce.done = true;
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* not supported */ }
  try {
    const a = document.createElement("audio");
    a.setAttribute("playsinline", ""); a.loop = true; a.volume = 0.01;
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    a.play().catch(() => {});
    unlockAudioOnce.el = a;
  } catch (e) { /* ignore */ }
}

playBtn.addEventListener("click", async () => {
  try {
    if (!bootAudio()) return;
    unlockAudioOnce();
    // Browsers only allow audio after a user click
    await Tone.start();
    if (Tone.Transport.state === "started") stopPlayback("Stopped.");
    else {
      startPlayback();
      const loaded = !current.sound || (samplesReady(current.sound.drums) && instrumentsReady(current.sound));
      const check = () => { const why = soundProblem(); if (why) statusEl.textContent = why; };
      if (loaded) check(); else ensureBeatSound(current.sound).then(check);
    }
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = "Could not start audio: " + (err && err.message ? err.message : err);
  }
});

// ---------- New beat, genre, style, structure ----------
// "New beat" and changing the genre both ask for a fresh beat of the chosen genre.
// Locked groups are kept, and the key, scale, chords and tempo pickers are respected.
// ---------- Sound panel: pick the kit, percussion, keys, bass... or keep the style's own ----------
const soundGridEl = $("bl-soundGrid"), soundResetEl = $("bl-soundReset");
const soundSelects = {};
if (soundGridEl && typeof SOUND_MENU !== "undefined") {
  Object.keys(SOUND_MENU).forEach(key => {
    const menu = SOUND_MENU[key];
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.className = "field-label";
    span.textContent = menu.label;
    const select = document.createElement("select");
    select.id = "bl-sound-" + key;
    select.innerHTML = '<option value=""></option>' + menu.options.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join("");
    select.addEventListener("change", () => setSoundPart(key, select.value));
    label.append(span, select);
    soundGridEl.appendChild(label);
    soundSelects[key] = select;
  });
}

// ---------- Drum samples: one select per drum type ----------
// "Auto" picks a different recording of that type on every new beat (and shows the one this beat uses). A numbered
// choice keeps that recording for every new beat until you change it, or change the genre.
const drumGridEl = $("bl-drumGrid");
const drumSelects = {};
let drumListGenre = "";
if (drumGridEl && typeof SAMPLE_TYPES !== "undefined") {
  SAMPLE_TYPES.forEach(type => {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.className = "field-label";
    span.textContent = SAMPLE_TYPE_NAMES[type];
    const select = document.createElement("select");
    select.id = "bl-drum-" + type;
    select.addEventListener("change", () => setDrumPick(type, Number(select.value) || 0));
    label.append(span, select);
    drumGridEl.appendChild(label);
    drumSelects[type] = select;
  });
}

function refreshDrumUI(beat) {
  const drums = beat && beat.sound && beat.sound.drums;
  if (!drums) return;
  SAMPLE_TYPES.forEach(type => {
    const select = drumSelects[type];
    if (!select) return;
    if (drumListGenre !== drums.genre) {                        // the list follows the genre
      let html = '<option value=""></option>';
      for (let n = 1; n <= SAMPLE_VARIANTS; n++) html += '<option value="' + n + '">' + n + " \u00B7 " + sampleLabel(drums.genre, type, n) + "</option>";
      select.innerHTML = html;
    }
    select.options[0].textContent = "Auto: " + drums[type] + " \u00B7 " + sampleLabel(drums.genre, type, drums[type]);
    const custom = settings.drums[type];
    select.value = custom ? String(custom) : "";
    select.classList.toggle("is-custom", !!custom);
  });
  drumListGenre = drums.genre;
}

// Pick one recording now, on the beat that is playing and the one waiting to start (0 = back to Auto)
function setDrumPick(type, n) {
  if (n) settings.drums[type] = n; else delete settings.drums[type];
  if (n) [current, pending].filter(Boolean).forEach(beat => { if (beat.sound.drums) beat.sound.drums[type] = n; });
  ensureEngine();
  engine.applySound(current.sound);
  refreshDrumUI(current);
  // Let the person hear it straight away when the beat is not playing
  if (n && !playing) {
    ensureBeatSound(current.sound).then(() => {
      try {
        Tone.start();
        engine.applySound(current.sound);
        engine.voices[type](Tone.now() + 0.05, 0.9, { step: 0 });
      } catch (err) { console.warn(err); }
    });
  }
}

// New kit (v2.27.0): another kit design, mix and tone for the beat on screen. The notes, the pattern and the chosen recordings stay;
// only how each drum is tuned, clicked and tailed changes (and the reverb size, delay and the keys' tone).
const newKitEl = $("bl-newKit");
newKitEl?.addEventListener("click", () => {
  if (!current || !current.sound || !current.sound.drums || typeof kitApply !== "function") return;
  const seed = Math.floor(Math.random() * 2147483646) + 1;
  current.sound = kitApply(current.sound, current.genre, current.style, seed, { from: current.sound.drums, keep: { kick: false } });
  ensureEngine();
  ensureBeatSound(current.sound).then(() => {
    try {
      engine.applySound(current.sound);
      engine.applyFx(resolveTemplate(current.genre, current.style).fx);
      statusEl.textContent = "New kit: the drums, reverb and tone are redesigned. The notes are the same.";
      if (!playing) {                          // let the person hear it straight away: a kick, then a snare and a hat
        Tone.start();
        const t = Tone.now() + 0.05;
        engine.voices.kick(t, 0.9, { step: 0 }); engine.voices.hat(t + 0.2, 0.7, { step: 2 }); engine.voices.snare(t + 0.4, 0.9, { step: 4 }); engine.voices.hat(t + 0.6, 0.7, { step: 6 });
      }
    } catch (err) { console.warn(err); }
  });
});

function soundLabel(key, id) {
  const hit = SOUND_MENU[key].options.find(o => o[0] === id);
  return hit ? hit[1] : id;
}

// The producer's note: what it chose for this beat and why
const packHintEl = $("bl-packHint");
function refreshPackUI(beat) {
  refreshSpiceUI(beat);
  if (!packHintEl) return;
  packHintEl.textContent = beat.pack ? beat.pack.name : "";
  renderWhy(beat);
  refreshKeepButtons(beat);
}

// The spice (see spice.js): one line with its name, and what it does in plain words
function refreshSpiceUI(beat) {
  const line = $("bl-spiceLine"), hint = $("bl-spiceHint");
  if (!line) return;
  const s = beat && beat.spice;
  line.textContent = s && typeof spiceLine === "function" ? spiceLine(beat) : "";
  if (hint) hint.textContent = s ? [s.what, s.lift && s.lift.what, s.extra && s.extra.id !== "none" ? s.extra.what : ""].filter(Boolean).join(" ") : "";
}

// "Why these sounds?": the producer's reasoning for each instrument of this beat, in plain words
const WHY_ROLES = [["bass", "Bass"], ["chords", "Keys"], ["pad", "Pad"], ["pluck", "Pluck"], ["lead", "Lead"], ["log", "Log drum"]];
function whyFit(weight) {
  if (weight === undefined) return "";
  return weight >= 0.85 ? "a perfect fit" : weight >= 0.6 ? "a good fit" : weight >= 0.35 ? "an unusual choice" : "a bold choice";
}
function renderWhy(beat) {
  const body = $("bl-whyBody");
  if (!body) return;
  body.innerHTML = "";
  const add = (cls, html) => { const p = document.createElement("p"); if (cls) p.className = cls; p.textContent = html; body.appendChild(p); return p; };
  if (!beat.pack || typeof PRODUCER_KB === "undefined") { add("", "This beat has no producer notes."); return; }
  const vibe = beat.pack.vibe, vibeName = vibe && VIBES[vibe] ? VIBES[vibe].toLowerCase() : "";
  const [head, arr] = String(beat.pack.blurb || "").split(" Arrangement:");
  if (head) add("", head.split(" I used")[0]);        // the list below says what was used
  WHY_ROLES.forEach(([role, label]) => {
    const id = resolveInstrument(role, beat.sound && beat.sound[role]);
    const info = id && instrumentInfo(id), kb = id && PRODUCER_KB[id];
    if (!info) return;
    const p = document.createElement("p");
    const strong = document.createElement("span");
    strong.className = "why-role"; strong.textContent = label + ": " + info.name;
    p.appendChild(strong);
    const bits = [];
    if (kb) {
      bits.push(kb.why);
      const g = whyFit(kb.genres[beat.genre]), v = vibe ? whyFit(kb.vibes[vibe]) : "";
      if (g) bits.push(g + " for " + beat.genre);
      if (v) bits.push(v + " for the " + vibeName + " mood");
    }
    p.appendChild(document.createTextNode(bits.length ? " \u2014 " + bits.join("; ") + "." : ""));
    body.appendChild(p);
  });
  if (arr) add("why-note", "Arrangement:" + arr);
  if (beat.spice) add("why-note", "Spice: " + [beat.spice.name + " \u2014 " + beat.spice.what, beat.spice.lift && beat.spice.lift.what, beat.spice.extra && beat.spice.extra.id !== "none" ? beat.spice.extra.what : ""].filter(Boolean).join(" "));
  tasteRow(body, beat);
}

// "More like this" / "Less like this": teaches the producer your taste (see taste.js)
function tasteRow(body, beat) {
  if (typeof TASTE === "undefined" || !beat.sound) return;
  const row = document.createElement("div");
  row.className = "why-taste";
  const msg = document.createElement("span");
  msg.className = "why-taste-msg";
  const refreshMsg = () => {
    msg.textContent = beat.tasteVote === 1 ? "Noted: the producer will lean toward these sounds."
      : beat.tasteVote === -1 ? "Noted: the producer will go easy on these sounds."
      : TASTE.count() ? "The producer is learning your taste (" + TASTE.count() + " sounds noted)." : "Tell the producer what you like.";
  };
  const mk = (label, vote) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "gridbar-toggle"; btn.textContent = label;
    btn.setAttribute("aria-pressed", String(beat.tasteVote === vote));
    btn.addEventListener("click", () => {
      const before = beat.tasteVote || 0, after = before === vote ? 0 : vote;     // tapping the same button again takes it back
      TASTE.voteSound(beat.sound, after - before);
      beat.tasteVote = after;
      row.querySelectorAll("button[data-vote]").forEach(x => x.setAttribute("aria-pressed", String(beat.tasteVote === Number(x.dataset.vote))));
      refreshMsg();
      window.dispatchEvent(new Event("vl-taste-changed"));
    });
    btn.dataset.vote = String(vote);
    return btn;
  };
  row.appendChild(mk("More like this", 1));
  row.appendChild(mk("Less like this", -1));
  const forget = document.createElement("button");
  forget.type = "button"; forget.className = "gridbar-toggle"; forget.textContent = "Forget my taste";
  forget.addEventListener("click", () => { TASTE.reset(); beat.tasteVote = 0; renderWhy(beat); });
  row.appendChild(forget);
  row.appendChild(msg);
  refreshMsg();
  body.appendChild(row);
}

// Vibe: tell the producer the mood you want (or leave it on Auto). A new beat is made in that mood.
const vibeEl = $("bl-vibe");
if (vibeEl && typeof VIBES !== "undefined") {
  vibeEl.innerHTML = '<option value="auto">Auto: the producer reads the beat</option>' +
    Object.keys(VIBES).map(v => '<option value="' + v + '">' + VIBES[v] + '</option>').join("");
  vibeEl.value = settings.vibe;
  vibeEl.addEventListener("change", () => {
    settings.vibe = vibeEl.value;
    settings.sound = {};
    requestBeat();
  });
}

function refreshSoundUI(beat) {
  if (!beat || !beat.sound) return;
  refreshPackUI(beat);
  refreshDrumUI(beat);
  const auto = beat.autoSound || beat.sound;
  Object.keys(soundSelects).forEach(key => {
    const select = soundSelects[key];
    select.options[0].textContent = "Producer's pick: " + soundLabel(key, auto[key] || "");
    const custom = settings.sound[key];
    select.value = custom || "";
    select.classList.toggle("is-custom", !!custom);
  });
}

// One part changes right now, on the beat that is playing and the one waiting to start
function setSoundPart(key, value) {
  if (value) settings.sound[key] = value; else delete settings.sound[key];
  [current, pending].filter(Boolean).forEach(beat => {
    const auto = beat.autoSound || beat.sound;
    beat.sound[key] = value || auto[key];
  });
  ensureEngine();
  engine.applySound(current.sound);
  refreshSoundUI(current);
  refreshStates();                                  // a bell kind can turn the bell into melody or percussion
}

soundResetEl?.addEventListener("click", () => {
  settings.sound = {};
  settings.drums = {};
  [current, pending].filter(Boolean).forEach(beat => { if (beat.autoSound) Object.assign(beat.sound, beat.autoSound); });
  ensureEngine();
  engine.applySound(current.sound);
  refreshSoundUI(current);
});

refreshSoundUI(current);

function requestBeat() {
  useBeat(
    generatePattern(genreEl.value, beatOptions()),
    "New beat starts on the next bar.",
    "New beat ready. Tap Play."
  );
}

regenBtn.addEventListener("click", requestBeat);

// Variation: keeps the key, chords, drums and instruments; the hats, percussion, bass line (two of the three, at random)
// and the arrangement are new. Re-style ("Make it darker"): keeps the key, chords, drums, hats and bass line; the
// producer picks new instruments and a new arrangement for the mood.
function currentOrPending() { return pending || current; }
const variationBtn = $("bl-variation");
variationBtn?.addEventListener("click", () => {
  const base = currentOrPending();
  if (!base || !base.pack) return requestBeat();
  const loose = ["hats", "percussion", "low"].sort(() => Math.random() - 0.5).slice(0, 2);
  const keep = ["drums", "harmony", "hats", "percussion", "low"].filter(g => !loose.includes(g));
  useBeat(
    generatePattern(base.genre, {
      from: base, lockGroups: keep, style: base.style, bpm: base.bpm, keepSound: true,
      phraseBars: settings.phraseBars, ...formOpts(base)
    }),
    "Variation starts on the next bar.",
    "Variation ready. Tap Play."
  );
});
document.querySelectorAll("#bl-quick [data-vibe]").forEach(btn => {
  btn.addEventListener("click", () => {
    const base = currentOrPending();
    if (!base || !base.pack) return requestBeat();
    useBeat(
      generatePattern(base.genre, {
        from: base, lockGroups: ["drums", "harmony", "hats", "percussion", "low"], style: base.style, bpm: base.bpm,
        vibe: btn.dataset.vibe, keepSpice: true, phraseBars: settings.phraseBars, ...formOpts(base)
      }),
      btn.textContent + ": starts on the next bar.",
      btn.textContent + ": ready. Tap Play."
    );
  });
});

// "More spice": keep the beat, roll a different spice (see spice.js)
$("bl-respice")?.addEventListener("click", () => {
  const base = currentOrPending();
  if (!base || !base.pack || typeof spiceRespice !== "function") return requestBeat();
  useBeat(spiceRespice(base), "New spice starts on the next bar.", "New spice ready. Tap Play.");
});

genreEl.addEventListener("change", () => {
  settings.sound = {};             // each genre brings its own sounds
  settings.drums = {};             // ... and its own drum recordings
  settings.progression = "auto";   // a progression number means something different in each style
  settings.style = "auto";
  fillStyleOptions();
  requestBeat();
});

styleEl.addEventListener("change", () => {
  settings.sound = {};
  settings.style = styleEl.value;
  settings.progression = "auto";
  requestBeat();
});

structureEl?.addEventListener("change", () => {
  if (structureEl.value === "custom") { syncStructureControls(); return; }   // "Custom" only shows that the form was edited
  settings.structure = structureEl.value;
  useBeat(
    rebuildStructure(pending || current, settings.structure),
    "New song form starts on the next bar.",
    "Song form changed."
  );
});

loopSongEl.addEventListener("change", () => { loopSong = loopSongEl.checked; });

// ---------- Song form editor ----------
// Edit one part at a time, right on the timeline: tap a block, then shorter / longer / move / duplicate / remove. A
// removed part goes to the "Removed" tray (greyed, in the corner) and can be brought back where it was. A part that
// is only moved or resized keeps the tracks it had, so editing does not re-roll the whole arrangement.
const formBarEl = $("bl-formBar"), formMoreEl = $("bl-formMore"), formAddEl = $("bl-formAdd"), formKindEl = $("bl-formKind");
const formTrashEl = $("bl-formTrash"), formTrashListEl = $("bl-formTrashList");

function loadFormDraft(beat) {
  formDraft = isSong(beat) ? beat.sections.map((s, i) => ({ kind: s.kind, bars: s.bars, src: i })) : [];
}
function formTotal() { return formDraft.reduce((a, f) => a + f.bars, 0); }
function renderFormTools() {
  if (typeof syncMelodyRoll === "function") setTimeout(syncMelodyRoll, 0);
  const song = formDraft.length > 0;
  if (formBarEl) formBarEl.hidden = !song;
  if (formMoreEl) formMoreEl.hidden = !song;
  if (formSel >= formDraft.length) formSel = formDraft.length - 1;
  if (formSel < 0) formSel = 0;
  if (song && formBarEl) {
    const p = formDraft[formSel];
    $("bl-formName").textContent = FORM_NAMES[p.kind] + " \u00b7 " + p.bars + " bars  (song: " + formTotal() + " bars)";
    formKindEl.value = p.kind;
    const off = (act, v) => { const x = formBarEl.querySelector('[data-act="' + act + '"]'); if (x) x.disabled = v; };
    off("shorter", p.bars <= 2); off("longer", p.bars >= 32);
    off("left", formSel === 0); off("right", formSel === formDraft.length - 1);
    off("dup", formDraft.length >= 24); off("del", formDraft.length <= 1);
  }
  if (formTrashEl) {
    formTrashEl.hidden = !formTrash.length;
    formTrashListEl.innerHTML = "";
    formTrash.forEach((t, k) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = FORM_NAMES[t.kind] + " \u00b7 " + t.bars + " \u21ba";
      btn.title = "Bring back the " + FORM_NAMES[t.kind].toLowerCase();
      btn.addEventListener("click", () => {
        const [item] = formTrash.splice(k, 1);
        formDraft.splice(Math.min(item.at, formDraft.length), 0, { kind: item.kind, bars: item.bars, keep: item.keep });
        formSel = Math.min(item.at, formDraft.length - 1);
        formChanged();
      });
      formTrashListEl.appendChild(btn);
    });
  }
}
function formChanged() {
  buildTimeline(currentOrPending());
  renderFormTools();
  clearTimeout(formTimer);
  formTimer = setTimeout(applyFormDraft, 400);       // wait for the last tap, so a few quick edits are one change
}
function applyFormDraft() {
  formTimer = null;
  if (!formDraft.length) return;
  const base = currentOrPending();
  const form = formDraft.map(f => f.src === undefined ? [f.kind, f.bars] : [f.kind, f.bars, f.src]);
  const next = rebuildStructure(base, "custom", form, "edited");
  formDraft.forEach((f, i) => {                      // a part brought back from the tray gets its old tracks back
    if (f.keep) { next.presence[i] = Object.assign({}, f.keep.presence); next.fillPick[i] = f.keep.fill; }
  });
  settings.structure = "custom";
  formDraft.forEach((f, i) => { f.src = i; delete f.keep; });   // the new beat's sections now match the list
  lastAppliedBeat = next;
  useBeat(next, "New song form starts on the next bar.", "Song form changed.");
}
// A new beat (not our own edit) replaces the list and empties the tray
function syncFormToBeat() {
  if (current !== lastAppliedBeat && !formTimer) { loadFormDraft(current); formTrash = []; formSel = 0; }
  renderFormTools();
}

formBarEl?.addEventListener("click", e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn || !formDraft.length) return;
  const p = formDraft[formSel], act = btn.dataset.act;
  if (act === "shorter") p.bars = Math.max(2, p.bars - 2);
  else if (act === "longer") p.bars = Math.min(32, p.bars + 2);
  else if (act === "left" && formSel > 0) { [formDraft[formSel - 1], formDraft[formSel]] = [formDraft[formSel], formDraft[formSel - 1]]; formSel--; }
  else if (act === "right" && formSel < formDraft.length - 1) { [formDraft[formSel + 1], formDraft[formSel]] = [formDraft[formSel], formDraft[formSel + 1]]; formSel++; }
  else if (act === "dup" && formDraft.length < 24) { formDraft.splice(formSel + 1, 0, { kind: p.kind, bars: p.bars, src: p.src }); formSel++; }
  else if (act === "del" && formDraft.length > 1) {
    const base = currentOrPending();
    const keep = p.keep || (p.src !== undefined && base.presence[p.src] ? { presence: Object.assign({}, base.presence[p.src]), fill: base.fillPick[p.src] } : null);
    formTrash.push({ kind: p.kind, bars: p.bars, at: formSel, keep });
    formDraft.splice(formSel, 1);
    formSel = Math.min(formSel, formDraft.length - 1);
  } else return;
  formChanged();
});
formKindEl?.addEventListener("change", () => {
  if (!formDraft.length) return;
  formDraft[formSel].kind = formKindEl.value;
  formDraft[formSel].src = undefined; delete formDraft[formSel].keep;
  formChanged();
});
formAddEl?.addEventListener("change", () => {
  if (!formAddEl.value) return;
  const kind = formAddEl.value;
  formAddEl.value = "";
  if (!formDraft.length || formDraft.length >= 24) return;
  const size = { intro: 4, verse: 8, pre: 4, chorus: 8, bridge: 4, outro: 4 }[kind];
  const lastChorus = formDraft.map(f => f.kind).lastIndexOf("chorus");
  const at = kind === "intro" ? 0 : kind === "outro" ? formDraft.length : (lastChorus >= 0 && kind !== "verse" ? lastChorus + 1 : formDraft.length);
  formDraft.splice(at, 0, { kind, bars: size });
  formSel = at;
  formChanged();
});
$("bl-formChorusFirst")?.addEventListener("click", () => {
  const i = formDraft.findIndex(f => f.kind === "chorus");
  if (i > 0) { const [c] = formDraft.splice(i, 1); formDraft.unshift(c); formSel = 0; formChanged(); }
});
$("bl-formShuffle")?.addEventListener("click", () => {
  if (formDraft.length < 2) return;
  // Everything moves, but an intro stays first and an outro stays last so the song still opens and closes
  const intro = formDraft[0].kind === "intro" ? formDraft[0] : null;
  const outro = formDraft.length > 1 && formDraft[formDraft.length - 1].kind === "outro" ? formDraft[formDraft.length - 1] : null;
  const middle = formDraft.filter(f => f !== intro && f !== outro);
  for (let i = middle.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [middle[i], middle[j]] = [middle[j], middle[i]]; }
  formDraft = [intro, ...middle, outro].filter(Boolean);
  formSel = 0;
  formChanged();
});
$("bl-formRandom")?.addEventListener("click", () => {
  clearTimeout(formTimer); formTimer = null;
  settings.structure = "auto";
  formTrash = [];
  useBeat(rebuildStructure(currentOrPending(), "auto"), "New song form starts on the next bar.", "Song form changed.");
});
loadFormDraft(current); renderFormTools(); buildTimeline(current);     // the first beat's form, shown from the start

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
    masteringOn, vocalSpaceOn, sidechainOn, humanize, swing, isAudible, flatMelody: !melodyOn
  };
}

// Get the beat ready (stop playback, use a queued beat, balance the mix if it has not been balanced),
// then render the whole song. `what` is the first words of the status message.
// Everything before a download or send: stop the player, take the waiting beat, and get the mix right
// (the Mix Doctor when "Check my mix first" is ticked, otherwise the live auto-mix listening)
async function prepareMixForRender() {
  await Tone.start();
  if (playing) stopPlayback("");
  if (pending) { const next = pending; pending = null; switchTo(next); }
  if ($("bl-doctorOnExport") && $("bl-doctorOnExport").checked) {
    try { await runDoctorAndApply(); }
    catch (err) { console.warn("Mix Doctor failed, using the live auto-mix instead", err); await calibrateMix(); }   // a download never fails because of the check
  } else {
    await calibrateMix();
  }
}

async function renderBeatForOutput(what) {
  await prepareMixForRender();

  statusEl.textContent = `${what}\u2026 0%`;
  await new Promise(resolve => setTimeout(resolve, 60));      // let the message show
  return renderSongBuffer(current, currentRenderSettings(), (done, total) => {
    statusEl.textContent = `${what}\u2026 ${Math.round((done / total) * 100)}%`;
  });
}

// ---------- Mix Doctor: the beat checks its own mix ----------
const doctorBtn = $("bl-doctorBtn"), doctorListEl = $("bl-doctorList");
let doctorRunning = false;

// Runs the Doctor on the current beat, puts its fixes where the live auto-mix keeps its own, and lists what it found.
// (Used by the button and, when "Check my mix first" is ticked, before every download and send.)
async function runDoctorAndApply() {
  {
    const result = await mixDoctor({
      beat: current,
      settings: currentRenderSettings(),
      render: renderSongBuffer,
      say: text => { statusEl.textContent = text; }
    });

    // Put its fixes where the live auto-mix keeps its own, so the faders, the player and the download all agree
    TRACK_ORDER.forEach(name => { autoMix.autos[name] = result.autos[name] || 0; });
    if (!masteringOn) {                            // with Mastering on, the master level is set by loudness instead
      autoMix.master = result.masterDb;
      masterBus.gain.rampTo(MASTER_BASE * dbToGain(autoMix.master), 0.1);
    }
    autoMix.listening = false;
    autoMix.balanced = true;
    applyVolumes(current.genre);
    updateMixBadge();
    renderMixReport();

    doctorListEl.innerHTML = "";
    result.findings.forEach(f => {
      const li = document.createElement("li");
      li.className = f.status;
      li.textContent = f.text;
      doctorListEl.appendChild(li);
    });
    return result;
  }
}

doctorBtn?.addEventListener("click", async () => {
  if (doctorRunning || exporting) return;
  if (!bootAudio()) return;
  doctorRunning = true;
  doctorBtn.disabled = true;
  appEl.setAttribute("inert", "");                 // nothing can change the beat while it is checked
  try {
    await Tone.start();
    if (playing) stopPlayback("");
    if (pending) { const next = pending; pending = null; switchTo(next); }
    const result = await runDoctorAndApply();
    const warnings = result.findings.filter(f => f.status === "warn").length;
    statusEl.textContent = warnings ? "Mix Doctor: done. " + warnings + " thing" + (warnings > 1 ? "s" : "") + " to look at." : "Mix Doctor: your mix is ready for a vocal.";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Mix Doctor could not finish: " + err.message;
  } finally {
    appEl.removeAttribute("inert");
    doctorBtn.disabled = false;
    doctorRunning = false;
  }
});

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


// ---------- Stems: four WAV files in a zip ----------
const stemsBtn = $("bl-stems");
stemsBtn?.addEventListener("click", async () => {
  if (exporting) return;
  if (!bootAudio()) return;
  exporting = true;
  stemsBtn.disabled = true; exportBtn.disabled = true;
  appEl.setAttribute("inert", "");
  try {
    const started = performance.now();
    await prepareMixForRender();
    const bits = Number(bitsEl.value) === 16 ? 16 : 24;
    const base = exportFileName(current).replace(/\.wav$/i, "");
    const files = [];
    let frames = 0;
    // One stem at a time: render, turn into a WAV, drop the audio (a phone cannot hold four full songs in memory)
    await renderStems(current, currentRenderSettings(), (index, count, fraction) => {
      statusEl.textContent = `Rendering stems: ${STEM_GROUPS[index].name} (${index + 1} of ${count}) ${Math.round(fraction * 100)}%`;
    }, async stem => {
      frames = frames || stem.buffer.length;                              // every stem is exactly the same length as the first
      const wav = encodeAudioBufferWav(stem.buffer, bits, frames);
      files.push({ name: base + " - " + stem.name + ".wav", data: new Uint8Array(await wav.blob.arrayBuffer()) });
    });
    statusEl.textContent = "Packing the stems into a zip\u2026";
    const zip = await makeZip(files);
    downloadBlob(zip, base + " - stems.zip");
    const took = Math.max(1, Math.round((performance.now() - started) / 1000));
    statusEl.textContent = `Saved ${base} - stems.zip \u00b7 ${files.length} files \u00b7 ${(zip.size / 1048576).toFixed(1)} MB \u00b7 made in ${took}s`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Could not make the stems: " + err.message;
  } finally {
    appEl.removeAttribute("inert");
    stemsBtn.disabled = false; exportBtn.disabled = false;
    exporting = false;
  }
});

// ---------- Your own samples ----------
const sampleGridEl = $("bl-sampleGrid");
const SAMPLE_NAMES = SAMPLE_TYPE_NAMES;
if (sampleGridEl && typeof SAMPLE_TRACKS !== "undefined") {
  SAMPLE_TRACKS.forEach(track => {
    const slot = document.createElement("div");
    slot.className = "field sample-slot";
    const title = document.createElement("span");
    title.className = "field-label";
    title.textContent = SAMPLE_NAMES[track] || track;
    const info = document.createElement("span");
    info.className = "sample-name";
    info.textContent = "Built-in sample";
    const input = document.createElement("input");
    input.type = "file"; input.accept = "audio/*,.wav,.mp3,.m4a,.ogg"; input.hidden = true;
    const buttons = document.createElement("div");
    buttons.className = "sample-buttons";
    const load = document.createElement("button");
    load.type = "button"; load.className = "secondary-button"; load.textContent = "Load\u2026";
    const clear = document.createElement("button");
    clear.type = "button"; clear.className = "secondary-button"; clear.textContent = "Clear"; clear.hidden = true;
    load.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        info.textContent = "Loading\u2026";
        const buffer = await Tone.getContext().rawContext.decodeAudioData(await file.arrayBuffer());
        if (buffer.duration > 10) throw new Error("it is longer than 10 seconds");
        USER_SAMPLES[track] = buffer;
        info.textContent = file.name.length > 24 ? file.name.slice(0, 21) + "\u2026" : file.name;
        clear.hidden = false;
        statusEl.textContent = (SAMPLE_NAMES[track] || track) + " sample loaded. It plays instead of the built-in one.";
      } catch (err) {
        info.textContent = USER_SAMPLES[track] ? info.dataset.last || "Your sample" : "Built-in sample";
        statusEl.textContent = "Could not load that sample: " + err.message;
      }
      input.value = "";
    });
    clear.addEventListener("click", () => {
      delete USER_SAMPLES[track];
      info.textContent = "Built-in sample"; clear.hidden = true;
    });
    buttons.append(load, clear);
    slot.append(title, info, buttons, input);
    sampleGridEl.appendChild(slot);
  });
}

// ---------- Voxloop Studio bridge ----------
window.VoxloopBeatLab = {
  pause() {
    try {
      if (playing) stopPlayback("");
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
      // Hand off to Voxloop Studio state
      const S = window.VLState;
      if (!S) throw new Error("Pipeline state not ready");
      // VLState uses internal closures; expose a setter via custom event
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
      if (window.VLDAW && typeof window.VLDAW.setMode === "function") {
        window.VLDAW.setMode("pipeline");
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
        detail: { buffer, noMelody: !melodyOn, engine: current.sound ? { genre: current.genre, styleId: current.style, sound: JSON.parse(JSON.stringify(current.sound)) } : null, swing: swing, bpm: current.bpm, key: ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][current.key.root] + " " + current.key.scale, name: exportFileName(current).replace(/\.wav$/i, "") + " (Beat Lab)" }
      }));
      if (window.VLDAW && typeof window.VLDAW.setMode === "function") {
        window.VLDAW.setMode("studio");
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

// ---------- Drafts: save this beat and open it again later (drafts.js) ----------
// The beat is plain data (patterns, chords, sounds, seed), so a draft is small and opens fully editable.
try {
  window.VLBeatLab = {
    snapshot() {
      const key = current.key ? ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][current.key.root] + " " + current.key.scale : "";
      return {
        v: 1,
        beat: JSON.parse(JSON.stringify(current)),
        settings: JSON.parse(JSON.stringify(settings)),
        trim: Object.assign({}, trim), muted: [...muted], soloed: [...soloed], locked: [...locked],
        melodyOn, swing,
        summary: { genre: current.genre, genreName: (TEMPLATES[current.genre] && TEMPLATES[current.genre].name) || current.genre, style: current.styleName || "", bpm: Math.round(current.bpm), key, bars: current.totalBars || 0, seconds: Math.round((current.totalBars || 0) * 240 / current.bpm) }
      };
    },
    restore(s) {
      if (!s || !s.beat) return false;
      if (playing) stopPlayback();
      pending = null;
      Object.keys(settings).forEach(k => { delete settings[k]; });
      Object.assign(settings, s.settings || {});
      Object.keys(trim).forEach(k => { trim[k] = (s.trim && s.trim[k]) || 0; });
      muted.clear(); (s.muted || []).forEach(n => muted.add(n));
      soloed.clear(); (s.soloed || []).forEach(n => soloed.add(n));
      locked.clear(); (s.locked || []).forEach(n => locked.add(n));
      melodyOn = s.melodyOn !== false; if (melodyEl) melodyEl.checked = melodyOn; playCtx.flatMelody = !melodyOn;
      genreEl.value = s.beat.genre; fillStyleOptions();
      switchTo(s.beat);
      if (s.swing != null) { swing = s.swing; swingEl.value = Math.round(swing * 100); swingValEl.textContent = swingEl.value; }
      try { ensureEngine(); refreshStates(); } catch (e) { console.warn(e); }
      statusEl.textContent = "Draft opened. Press Play.";
      return true;
    }
  };
} catch (e) { console.warn("[Beat Lab] drafts hook", e); }
