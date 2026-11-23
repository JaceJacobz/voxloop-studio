// Vocal Sketch (v2.14.0): sing a song part by part, and Beat Lab builds a beat for it. A small timeline editor.
// Beat Lab only. Loaded after beatlab.js. Needs vocaldsp.js (the analysis) and the Beat Lab globals (generatePattern, useBeat, settings...).
//
//   1. Click strip: set the tempo (type, +/- or tap), hear the click (preview) before recording, count-in, delay.
//   2. Record a part (verse, chorus...) or import a voice note, or try the demo take. Every take is a lane on the timeline.
//   3. The timeline shows the waveform and the notes against the beat. Drag a take left or right to line it up with the click,
//      play it with the click to check. Nothing is uploaded; the analysis runs on the phone.
//   4. Build my beat: the form is your takes in order, the key, tempo and chords come from what you sang, the sounds from the
//      genre you pick. The voice is not in the beat. The takes are saved with the draft.
(function () {
  "use strict";
  const D = window.VocalDSP;
  if (!D || typeof generatePattern !== "function" || typeof useBeat !== "function") return;
  const $ = id => document.getElementById(id);
  const KINDS = [["intro", "Intro"], ["verse", "Verse"], ["pre", "Pre-chorus"], ["chorus", "Chorus"], ["bridge", "Bridge"], ["outro", "Outro"]];
  const KIND_NAME = Object.fromEntries(KINDS);
  const NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const FEELS = [["Change often", 0], ["Normal", 1], ["Change rarely", 2]];
  const S = { bpm: 94, takes: [], click: "click", vol: 0.7, latency: 0, countIn: true, playClick: true, feel: 1, keyPick: 0, manualKey: null, style: "auto", io: true, keepLead: false, nextId: 1, ppb: null, rec: null, metro: null, play: null, keyInfo: null };
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- the panel ----------
  const panel = document.createElement("section");
  panel.className = "panel-card vocalsketch"; panel.id = "bl-vsPanel";
  panel.innerHTML = [
    '<h3 class="panel-title">Vocal Sketch <span class="vs-sub">Sing it. Get the beat.</span></h3>',
    '<ol class="vs-steps"><li>Set the tempo and hear the click</li><li>Record each part, or import a voice note</li><li>Line it up, then build the beat</li></ol>',
    '<div class="vs-card"><div class="vs-h">1 &middot; Click</div>',
    '<div class="vs-row"><div class="vs-stepper" role="group" aria-label="Tempo"><button type="button" id="vs-minus" aria-label="Slower">&minus;</button><input type="number" id="vs-bpm" min="60" max="160" step="0.1" value="94" inputmode="decimal" aria-label="Beats per minute"><button type="button" id="vs-plus" aria-label="Faster">+</button><span class="vs-unit">BPM</span></div>',
    '<button type="button" class="vs-btn" id="vs-tap">Tap tempo</button>',
    '<button type="button" class="vs-btn vs-primary" id="vs-prev">&#9654; Hear the click</button></div>',
    '<div class="vs-dots" id="vs-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>',
    '<div class="vs-row"><label class="vs-field">Sound <select id="vs-click"><option value="click">Click</option><option value="shaker">Soft shaker</option><option value="off">Silent</option></select></label>',
    '<label class="vs-field vs-grow">Volume <input type="range" id="vs-vol" min="0" max="100" value="70"></label></div>',
    '<details class="vs-more"><summary>More settings</summary><div class="vs-row">',
    '<label class="vs-check"><input type="checkbox" id="vs-count" checked><span>4-beat count-in before recording</span></label>',
    '<label class="vs-field">Delay <input type="number" id="vs-lat" min="0" max="500" step="10" value="0"> ms</label></div>',
    '<p class="vs-note">If your voice always lands late (Bluetooth headphones), add a delay here. You can also just drag the take on the timeline.</p></details></div>',
    '<div class="vs-card"><div class="vs-h">2 &middot; Record</div>',
    '<p class="vs-note">Use headphones so the click is not picked up by the microphone.</p>',
    '<div class="vs-row"><label class="vs-field">This is the <select id="vs-kind"></select></label>',
    '<div class="vs-seg" role="group" aria-label="Sing or rap"><button type="button" class="is-on" data-mode="sing">Sing</button><button type="button" data-mode="rap">Rap</button></div></div>',
    '<div class="vs-row"><button type="button" class="vs-btn vs-rec" id="vs-rec">&#9679; Record</button>',
    '<label class="vs-btn vs-file-btn">Import a voice note<input type="file" id="vs-file" accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.caf,.mp4,.3gp,.webm"></label>',
    '<button type="button" class="vs-btn" id="vs-demo">Try a demo take</button></div>',
    '<div class="vs-meter" id="vs-meter" hidden><i></i></div>',
    '<div class="vs-status" id="vs-status" role="status" aria-live="polite">Tap a button above to start.</div></div>',
    '<div class="vs-card"><div class="vs-h">3 &middot; Your takes <span class="vs-zoom"><button type="button" id="vs-zout" aria-label="Zoom out">&minus;</button><button type="button" id="vs-zfit">Fit</button><button type="button" id="vs-zin" aria-label="Zoom in">+</button></span></div>',
    '<label class="vs-check"><input type="checkbox" id="vs-pclick" checked><span>Play the click with my take (to check it is on the beat)</span></label>',
    '<div class="vs-tlwrap" id="vs-tlwrap"><div class="vs-tl" id="vs-tl"></div></div></div>',
    '<div class="vs-card vs-key" id="vs-key"></div>',
    '<div class="vs-card"><div class="vs-h">4 &middot; Build the beat</div>',
    '<div class="vs-hear" id="vs-hear" hidden></div>',
    '<div class="vs-row"><label class="vs-field">Beat mood <select id="vs-mood"></select></label><label class="vs-field">Chords <select id="vs-harm"><option value="notes">Follow my notes (closest)</option><option value="key">Keep to one key (simpler)</option></select></label></div>',
    '<div class="vs-row"><label class="vs-field">How full <select id="vs-full"><option value="light">Light (only what the song needs)</option><option value="normal">Medium</option><option value="full">Full (everything the style has)</option></select></label></div>',
    '<label class="vs-check"><input type="checkbox" id="vs-answer" checked> Answer my singing with a short melody in the pauses</label>',
    '<div class="vs-row"><label class="vs-field">Genre <select id="vs-genre"></select></label>',
    '<label class="vs-field">Style <select id="vs-style"></select></label>',
    '<label class="vs-field">Chord changes <select id="vs-feel"></select></label></div>',
    '<label class="vs-check"><input type="checkbox" id="vs-io" checked><span>Add an intro and an outro if I did not record them</span></label>',
    '<label class="vs-check"><input type="checkbox" id="vs-lead"><span>Keep the beat\'s own lead melody (it can clash with the voice)</span></label>',
    '<button type="button" class="vs-btn vs-primary vs-big" id="vs-build" disabled>Build my beat</button></div>',
    '<div class="vs-card" id="vs-mixcard" hidden><div class="vs-h">5 &middot; Hear it with your voice</div>',
    '<p class="vs-note">Your recording on top of the beat. If your voice sounds early or late, nudge it until it feels right, then save it.</p>',
    '<div class="vs-row"><button type="button" class="vs-btn vs-primary" id="vs-mixplay">&#9654; Hear my voice with the beat</button><button type="button" class="vs-btn" id="vs-mixstop" disabled>&#9632; Stop</button></div>',
    '<div class="vs-row"><span class="vs-field">Voice timing<span class="vs-stepper"><button type="button" id="vs-nudgem" aria-label="Voice earlier">&#9664;</button><input type="text" id="vs-nudgeval" value="0 ms" readonly aria-label="Voice timing"><button type="button" id="vs-nudgep" aria-label="Voice later">&#9654;</button></span></span>',
    '<label class="vs-field vs-grow">Voice louder or softer<input type="range" id="vs-voicelvl" min="40" max="160" value="100"></label></div>',
    '<p class="vs-note" id="vs-nudgehelp">Tap &#9664; if your voice sounds LATE, &#9654; if it sounds EARLY. Each tap moves it 10 ms.</p>',
    '<div class="vs-row"><button type="button" class="vs-btn" id="vs-mixsave">Save voice + beat (.wav)</button><button type="button" class="vs-btn" id="vs-beatsave">Save the beat alone (.wav)</button></div>',
    '<div class="vs-status" id="vs-mixstatus" role="status" aria-live="polite"></div></div>'
  ].join("");
  const anchor = $("bl-lustGuide") || $("bl-melPanel");
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor); else document.body.appendChild(panel);
  const el = {};
  ["bpm", "minus", "plus", "tap", "prev", "dots", "click", "vol", "count", "lat", "kind", "rec", "file", "demo", "meter", "status", "zout", "zfit", "zin", "pclick", "tlwrap", "tl", "key", "hear", "mood", "harm", "answer", "full", "genre", "style", "feel", "io", "lead", "build", "mixcard", "mixplay", "mixstop", "nudgem", "nudgep", "nudgeval", "voicelvl", "mixsave", "beatsave", "mixstatus"].forEach(k => { el[k] = $("vs-" + k); });
  el.kind.innerHTML = KINDS.map(([k, n]) => '<option value="' + k + '">' + n + "</option>").join(""); el.kind.value = "verse";
  el.feel.innerHTML = FEELS.map(([n, v]) => '<option value="' + v + '">' + n + "</option>").join(""); el.feel.value = "1";
  el.genre.innerHTML = Object.keys(TEMPLATES).map(g => '<option value="' + g + '">' + TEMPLATES[g].name + "</option>").join("");
  el.genre.value = (typeof genreEl !== "undefined" && TEMPLATES[genreEl.value]) ? genreEl.value : Object.keys(TEMPLATES)[0];
  function fillStyles() {
    const g = TEMPLATES[el.genre.value];
    el.style.innerHTML = '<option value="auto">Auto (best match for my voice)</option>' + g.styleOrder.map(id => '<option value="' + id + '">' + g.styles[id].name + "</option>").join("");
    el.style.value = "auto";
  }
  fillStyles();
  const MOODS = [["match", "Match my voice (recommended)"], ["chill", "Chill"], ["romantic", "Romantic"], ["dreamy", "Dreamy"], ["soulful", "Soulful"], ["dark", "Dark"], ["hard", "Hard"], ["party", "Party"], ["uplifting", "Uplifting"], ["none", "Don't match (random)"]];
  el.mood.innerHTML = MOODS.map(([v, n]) => '<option value="' + v + '">' + n + "</option>").join(""); el.mood.value = "match";
  let mode = "sing";
  panel.querySelectorAll(".vs-seg button").forEach(b => b.addEventListener("click", () => { mode = b.dataset.mode; panel.querySelectorAll(".vs-seg button").forEach(x => x.classList.toggle("is-on", x === b)); }));
  const say = (t, bad) => { el.status.textContent = t; el.status.classList.toggle("is-bad", !!bad); };

  // ---------- audio: one context, a click, a small clock ----------
  let AC = null;
  function ctx() { if (!AC) { const C = window.AudioContext || window.webkitAudioContext; AC = new C(); } return AC; }
  function clickAt(c, t, accent) {
    if (S.click === "off" || S.vol <= 0 || !window.VLClick) return;
    if (S.click === "click") window.VLClick.hit(c, t, accent ? "accent" : "beat", S.vol * (accent ? 0.95 : 0.7));       // recorded rim clicks
    else {
      const spb = 60 / S.bpm;                                                                                          // a recorded shaker on the eighth notes
      for (let h = 0; h < 2; h++) window.VLClick.hit(c, t + h * spb / 2, "shake", S.vol * (h === 0 && accent ? 0.9 : h === 0 ? 0.55 : 0.3));
    }
  }
  // schedules a click on every beat from t0, a little ahead of time (so tempo changes apply at once)
  function makeClock(t0, spbFn, total, withClick) {
    const c = ctx(), h = { t0, beat: 0, next: t0, stopped: false, queue: [] };
    const pump = () => { if (h.stopped) return; while (h.next < c.currentTime + 0.25 && h.beat < total) { if (withClick) clickAt(c, h.next, h.beat % 4 === 0); h.queue.push({ t: h.next, b: h.beat }); h.next += spbFn(); h.beat++; } if (h.queue.length > 64) h.queue.splice(0, h.queue.length - 32); };
    h.timer = setInterval(pump, 25); pump();
    h.stop = () => { h.stopped = true; clearInterval(h.timer); };
    h.current = () => { const now = c.currentTime; let r = null; for (const q of h.queue) if (q.t <= now) r = q; return r; };
    return h;
  }
  let raf = 0;
  function tickUI() {
    cancelAnimationFrame(raf);
    const dots = el.dots.children, c = AC;
    const loop = () => {
      let on = -1;
      const clk = S.metro || (S.rec && S.rec.clock) || (S.play && S.play.clock);
      if (clk && c) { const cur = clk.current(); if (cur) on = cur.b % 4; }
      for (let i = 0; i < 4; i++) dots[i].classList.toggle("is-on", i === on);
      if (S.rec && S.rec.level !== undefined) el.meter.firstElementChild.style.width = Math.min(100, Math.round(S.rec.level * 400)) + "%";
      if (S.play && c) movePlayhead((c.currentTime - S.play.t0) / (60 / S.play.take.bpm));
      if (S.metro || S.rec || S.play) raf = requestAnimationFrame(loop); else { for (let i = 0; i < 4; i++) dots[i].classList.remove("is-on"); }
    };
    raf = requestAnimationFrame(loop);
  }

  // ---------- tempo + click preview ----------
  const recorded = () => S.takes.some(t => !t.imported && !t.demo);
  function syncLock() {
    const locked = recorded() || !!S.rec;
    [el.bpm, el.minus, el.plus, el.tap].forEach(b => { b.disabled = locked; });
    el.bpm.title = locked ? "The tempo is locked while you have recorded takes: they were sung to this click. Delete them to change it." : "";
  }
  function setBpm(v, quiet) {
    v = Math.max(60, Math.min(160, Math.round((Number(v) || 94) * 10) / 10));   // one decimal: a singer's tempo is often 113.9, not 114
    S.bpm = v; el.bpm.value = v;
    S.takes.filter(t => t.imported || t.demo).forEach(t => { t.bpm = v; if (t.autoOffset) t.offset = firstOffset(t); t.bars = autoBars(t); regrid(t); });
    renderTakes(); updateKey();
    if (!quiet) say("Tempo " + v + " BPM.");
  }
  el.bpm.addEventListener("change", () => setBpm(el.bpm.value));
  el.minus.addEventListener("click", () => setBpm(Math.round(S.bpm) === S.bpm ? S.bpm - 1 : Math.floor(S.bpm)));
  el.plus.addEventListener("click", () => setBpm(Math.round(S.bpm) === S.bpm ? S.bpm + 1 : Math.ceil(S.bpm)));
  let taps = [];
  el.tap.addEventListener("click", () => {
    const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2200) taps = [];
    taps.push(now); if (taps.length > 8) taps.shift();
    if (taps.length >= 3) { const gaps = []; for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]); setBpm(60000 / mean(gaps), true); say("Tempo " + S.bpm + " BPM. Keep tapping to refine it."); }
    else say("Keep tapping, once on every beat.");
  });
  function stopMetro() { if (S.metro) { S.metro.stop(); S.metro = null; } el.prev.innerHTML = "&#9654; Hear the click"; el.prev.classList.remove("is-on"); }
  function startMetro() {
    stopAll(); const c = ctx(); c.resume();
    S.metro = makeClock(c.currentTime + 0.12, () => 60 / S.bpm, 1e9, true);
    el.prev.innerHTML = "&#9632; Stop the click"; el.prev.classList.add("is-on"); tickUI();
    say("Playing the click. Change the tempo, sound or volume while it plays.");
  }
  el.prev.addEventListener("click", () => { if (S.metro) { stopMetro(); say("Click stopped."); } else startMetro(); });
  el.click.addEventListener("change", () => { S.click = el.click.value; });
  el.vol.addEventListener("input", () => { S.vol = el.vol.value / 100; });
  el.lat.addEventListener("change", () => { S.latency = Math.max(0, Math.min(500, Number(el.lat.value) || 0)); });
  el.count.addEventListener("change", () => { S.countIn = el.count.checked; });
  el.pclick.addEventListener("change", () => { S.playClick = el.pclick.checked; });
  el.genre.addEventListener("change", fillStyles);
  el.style.addEventListener("change", () => { S.style = el.style.value; });
  el.feel.addEventListener("change", () => { S.feel = Number(el.feel.value); });
  el.io.addEventListener("change", () => { S.io = el.io.checked; });
  el.lead.addEventListener("change", () => { S.keepLead = el.lead.checked; });
  function stopAll() { stopMetro(); stopPlay(); if (S.tap) stopTap(); if (typeof mixStop === "function") mixStop(); }

  // ---------- recording ----------
  async function record() {
    if (S.rec) { S.rec.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say("This page cannot use the microphone (the preview inside Claude blocks it). Open Beat Lab from an https link such as your GitHub Pages site, or use Import a voice note or the demo take.", true); return; }
    stopAll();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }); }
    catch (e) { say("The microphone is blocked. Allow it for this page in the browser settings and try again. You can still import a voice note.", true); return; }
    const c = ctx(); try { await c.resume(); } catch (e) { /* started by the tap */ }
    const src = c.createMediaStreamSource(stream), proc = c.createScriptProcessor(4096, 1, 1), mute = c.createGain();
    mute.gain.value = 0; src.connect(proc); proc.connect(mute); mute.connect(c.destination);
    const chunks = []; let cap0 = null; const spb = 60 / S.bpm, kind = el.kind.value, m = mode;
    const r = S.rec = { level: 0 };
    proc.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); if (cap0 === null) cap0 = e.playbackTime - 4096 / c.sampleRate; chunks.push(new Float32Array(d)); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * d[i]; r.level = Math.sqrt(s / (d.length / 4)); };
    const count = S.countIn ? 4 : 0, tStart = c.currentTime + 0.25, tBar1 = tStart + count * spb;
    r.clock = makeClock(tStart, () => spb, 1e9, true);
    el.rec.innerHTML = "&#9632; Stop"; el.rec.classList.add("is-recording"); el.meter.hidden = false; syncLock(); tickUI();
    const label = KIND_NAME[kind].toLowerCase(), fmt = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
    const done = new Promise(resolve => {
      r.stop = () => { if (!r.over) { r.over = true; resolve(); } };
      r.timer = setInterval(() => {
        const now = c.currentTime;
        if (now < tBar1) say("Get ready to " + (m === "rap" ? "rap" : "sing") + " the " + label + " ... " + Math.max(1, Math.ceil((tBar1 - now) / spb)));
        else say("Recording the " + label + " (" + fmt(now - tBar1) + "). Tap Stop when you are done.");
        if (now - tStart > 300) r.stop();
      }, 150);
    });
    await done;
    clearInterval(r.timer); r.clock.stop();
    try { proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); } catch (e) { /* closing */ }
    const lat = (c.outputLatency || c.baseLatency || 0), sr = c.sampleRate;
    S.rec = null; el.rec.innerHTML = "&#9679; Record"; el.rec.classList.remove("is-recording"); el.meter.hidden = true; syncLock();
    if (cap0 === null || !chunks.length) { say("Nothing was recorded. Check the microphone and try again.", true); return; }
    let n = 0; chunks.forEach(ch => { n += ch.length; }); const x = new Float32Array(n); let p = 0; chunks.forEach(ch => { x.set(ch, p); p += ch.length; });
    await addTake(x, sr, { kind, mode: m, bpm: S.bpm, offset: tBar1 - cap0 + lat + S.latency / 1000, imported: false });
  }
  el.rec.addEventListener("click", record);

  // ---------- importing and the demo ----------
  async function importFile(f) {
    try {
      say("Reading " + f.name + " ...");
      const bytes = await f.arrayBuffer(), c = ctx();
      const buf = await new Promise((res, rej) => { const p = c.decodeAudioData(bytes, res, rej); if (p && p.then) p.then(res, rej); });
      await addFromBuffer(buf, f.name);
    } catch (e) { console.warn(e); say("That file could not be read" + (e && e.message ? " (" + e.message + ")" : "") + ". Try an mp3, m4a, wav or ogg voice note, or the demo take.", true); }
  }
  el.file.addEventListener("change", () => { const f = el.file.files && el.file.files[0]; el.file.value = ""; if (f) importFile(f); });
  async function addFromBuffer(buf, name) {
    let x = D.toMono(buf), sr = buf.sampleRate;
    if (x.length / sr > 180) { x = x.subarray(0, Math.floor(180 * sr)); say("Only the first 3 minutes are used. Import one part at a time for the best result."); }
    const guess = D.estimateTempo(D.resample16k(x, sr));          // only a hint: it is not reliable enough to overwrite the tempo you set
    const t = await addTake(x, sr, { kind: el.kind.value, mode, bpm: S.bpm, offset: 0, imported: true, name, tempoGuess: guess });
    if (t && guess && Math.abs(guess - S.bpm) > 8) say(el.status.textContent + " (Tempo is " + S.bpm + " BPM. If you sang it at a different tempo, change it above.)", el.status.classList.contains("is-bad"));
  }
  // The demo take: a short melody played by a RECORDED saxophone (from the instrument library), standing in for a voice so the timing and key
  // tools have something to work on. Nothing is made up in code: if the recording cannot be loaded this returns null.
  async function demoVoice(bpm) {
    const id = "saxophone", R = window.VLMelody && window.VLMelody._internal && window.VLMelody._internal.renderRecorded;
    if (!R || typeof instrumentInfo !== "function" || typeof loadInstrumentNote !== "function" || typeof instrumentSet !== "function") return null;
    const info = instrumentInfo(id); if (!info) return null;
    if (typeof INSTRUMENT_USED !== "undefined") INSTRUMENT_USED[id] = Date.now();
    try { await Promise.all(info.notes.map((n) => loadInstrumentNote(id, n))); } catch (e) { return null; }
    if (!instrumentSet(id)) return null;
    const sr = 16000, spb = 60 / bpm, late = 0.11, len = Math.ceil((16 * spb + 0.6) * sr), x = new Float32Array(len);
    const line = [[0, 1, 57], [1, 1, 60], [2, 1, 62], [3, 1, 64], [4, 1, 62], [5, 1, 60], [6, 2, 57], [8, 1, 60], [9, 1, 62], [10, 1, 64], [11, 1, 67], [12, 1, 64], [13, 1, 62], [14, 2, 57]];
    line.forEach(([b, l, m]) => R(x, sr, { t: late + b * spb, dur: l * spb - 0.07, midi: m, vel: 0.85, role: "answer" }, {}, id));
    let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
    if (!(pk > 0)) return null;
    const g = 0.5 / pk; for (let i = 0; i < x.length; i++) x[i] *= g;
    return x;
  }
  el.demo.addEventListener("click", async () => {
    say("Making a demo take ...");
    try {
    stopAll();
    const x = await demoVoice(S.bpm);
    if (!x) { say("The demo take needs the saxophone recording, which could not be loaded. Check your connection and try again, or sing / import a voice note instead.", true); return; }
    const t = await addTake(x, 16000, { kind: el.kind.value, mode: "sing", bpm: S.bpm, offset: 0, imported: true, demo: true, name: "Demo" });
    if (t) { t.autoOffset = false; t.offset = 0; t.bars = autoBars(t); regrid(t); renderTakes(); updateKey(); say("A demo melody (a recorded saxophone standing in for a voice), played 0.11 s late on purpose. Drag it a little to the left on the timeline until its notes sit on the beat lines, then press Play."); }
    } catch (e) { console.warn(e); say("The demo take failed: " + (e && e.message ? e.message : e) + " (tell Claude this message)", true); }
  });
  // anything that goes wrong while this tab is open is shown here instead of failing silently
  const oops = m => { if (panel.offsetParent) say("Something went wrong: " + m + " (tell Claude this message)", true); };
  window.addEventListener("error", e => oops(e.message || "error"));
  window.addEventListener("unhandledrejection", e => oops(e.reason && e.reason.message ? e.reason.message : String(e.reason)));

  // ---------- takes ----------
  function activeEnd(t) {
    const x = t.pcm, hop = 320, env = []; for (let s = 0; s + hop <= x.length; s += hop) { let e = 0; for (let j = 0; j < hop; j++) e += x[s + j] * x[s + j]; env.push(Math.sqrt(e / hop)); }
    if (!env.length) return 0; const sorted = env.slice().sort((a, b) => a - b), peak = sorted[Math.floor(sorted.length * 0.95)] || 0;
    let last = 0; env.forEach((v, i) => { if (v > Math.max(0.004, peak * 0.15)) last = i + 1; }); return last * 0.02;
  }
  // How well does the singing sit on a beat grid at this tempo? (0 = not at all, 1 = perfectly). Long notes count more.
  // The beat is felt a little after the moment the pitch starts (it sits on the vowel), so the beat lines are put P_SHIFT after the detected note starts.
  // (0.14 s: from one real voice note where the singer lined a click up by ear: 0.09 s by one measure, 0.16 s by another. Worth re-checking with more voices.)
  const P_SHIFT = 0.14;
  function lock(notes, bpm) {
    const T = 60 / bpm; let c = 0, sn = 0, w = 0;
    notes.forEach(n => { const a = 2 * Math.PI * n.t / T, k = Math.min(1, n.dur / 0.3); c += k * Math.cos(a); sn += k * Math.sin(a); w += k; });
    return w ? { r: Math.hypot(c, sn) / w, phase: (((Math.atan2(sn, c) / (2 * Math.PI) + 1) % 1) * T + P_SHIFT) % T } : { r: 0, phase: 0 };
  }
  // Which of the four beats is the start of the bar? Singers start phrases on the 1, and hold their longest notes on it.
  // Each beat line (counted from `phase`) gets points when a phrase start or a held note lands on it; the best of the four wins. (A guess: check it by ear.)
  function downbeatOf(notes, bpm, phase) {
    const T = 60 / bpm, sc = [0, 0, 0, 0];
    notes.forEach((n, i) => {
      const start = i === 0 || n.t - (notes[i - 1].t + notes[i - 1].dur) >= 0.4, bi = (n.t + P_SHIFT - phase) / T, k = Math.round(bi), dev = (bi - k) * T;
      const near = Math.exp(-(dev * dev) / (2 * 0.09 * 0.09));
      sc[((k % 4) + 4) % 4] += near * ((start ? 2 : 0) + Math.min(n.dur, 1) * 0.6);
    });
    let j = 0; sc.forEach((v, i) => { if (v > sc[j]) j = i; });
    return j;
  }
  // The time in the take where bar 1 starts: the bar line the take begins on, allowing a pick-up of up to about two beats before it.
  function firstOffset(t, phaseIn) {
    const nn = t.seg && t.seg.notes; if (!nn || !nn.length) return 0;
    const spb = 60 / t.bpm, f = lock(nn, t.bpm); t.tight = f.r;
    const phase = phaseIn === undefined ? f.phase : phaseIn;            // phaseIn: a beat line found by tapping
    const j = downbeatOf(nn, t.bpm, phase); t.barBeat = j;
    const bar = 4 * spb, first = phase + j * spb, from = nn[0].t - 2.2 * spb;
    return first + Math.ceil((from - first) / bar - 1e-9) * bar;
  }
  // ---------- tap along: the person taps the beat while the take plays; the app finds the tempo and where the beats fall ----------
  function stopTap() { if (S.tap) { try { S.tap.src.stop(); } catch (e) { /* ended */ } S.tap = null; } document.querySelectorAll(".vs-tappad").forEach(p => { p.hidden = true; }); document.querySelectorAll(".vs-tapstart").forEach(b => { b.disabled = false; }); }
  function startTap(t, card) {
    stopAll(); stopTap(); const c = ctx(); c.resume();
    const b = c.createBuffer(1, t.pcm.length, D.SR); b.copyToChannel(t.pcm, 0);
    const t0 = c.currentTime + 0.5, src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(t0, 0);
    S.tap = { take: t, src, t0, taps: [] };
    src.onended = () => { if (S.tap && S.tap.src === src) finishTap(t, card); };
    card.querySelector(".vs-tappad").hidden = false; card.querySelector(".vs-tapstart").disabled = true;
    card.querySelector(".vs-tapcount").textContent = "0 taps";
    say("Listen, and tap the big button on every beat, the way you would tap your foot. At least 8 taps. Tap Done when you have had enough.");
  }
  function tapNow(card) {
    if (!S.tap) return; const c = ctx(), lat = (c.outputLatency || 0) + (c.baseLatency || 0), x = c.currentTime - lat - S.tap.t0;
    if (x < 0) return; S.tap.taps.push(x); card.querySelector(".vs-tapcount").textContent = S.tap.taps.length + " tap" + (S.tap.taps.length === 1 ? "" : "s");
  }
  function finishTap(t, card) {
    const taps = S.tap ? S.tap.taps.slice() : []; stopTap();
    const f = D.fitTaps(taps, S.bpm);
    if (!f) { say("I need at least 8 clear taps on the beat. Try again: tap on every beat while it plays.", true); return; }
    const bpm = Math.round(f.bpm * 10) / 10; setBpm(bpm, true);
    t.offset = firstOffset(t, f.phase); t.autoOffset = false; finishMove(t);
    const steady = f.spread < 0.04 ? "Your taps were steady." : "Your taps were a little uneven, so check the result by ear.";
    say("From your taps: " + S.bpm + " BPM, and the bar starts at " + (Math.round(t.offset * 1000) / 1000) + " s. " + steady + " Press Play: the higher click is the start of the bar (the 1). If the 1 is somewhere else, use the buttons next to Where does the bar start.");
  }
  function tightWord(r) { return r >= 0.6 ? "on the beat" : r >= 0.42 ? "a little loose" : "loose, it wanders off the beat"; }
  function fitTempo(t) {
    const nn = t.seg && t.seg.notes; if (!nn || nn.length < 6) return null;
    let best = { bpm: t.bpm, r: lock(nn, t.bpm).r };
    for (let b = Math.max(60, t.bpm * 0.9); b <= Math.min(160, t.bpm * 1.1); b += 0.25) { const r = lock(nn, b).r; if (r > best.r + 0.02) best = { bpm: b, r }; }
    return best;
  }
  function autoBars(t) {
    const barSec = 4 * 60 / t.bpm, len = Math.max(0.5, activeEnd(t) - t.offset); let bars = Math.max(2, Math.ceil(len / barSec - 0.12));
    if (bars % 2) bars++; return Math.min(32, bars);
  }
  async function addTake(x, sr, o) {
    const pcm = sr === D.SR ? Float32Array.from(x) : D.resample16k(x, sr);
    const t = { id: S.nextId++, kind: o.kind, mode: o.mode, bars: o.bars || 0, repeat: 1, bpm: o.bpm, offset: o.offset || 0, imported: !!o.imported, demo: !!o.demo, autoOffset: !!o.imported && !o.demo, name: o.name || "", pcm, dur: pcm.length / D.SR, state: "analysing" };
    t.hi = { x: Float32Array.from(x), sr };                       // the take at its full quality, for the mix: the analysis copy (16 kHz) sounds like a telephone
    S.takes.push(t); syncLock(); renderTakes();
    try { await analyse(t); } catch (e) { console.warn(e); }
    if (t.autoOffset) t.offset = firstOffset(t);
    if (!t.bars || t.imported) t.bars = autoBars(t);
    if (t.mode === "rap") t.flow = D.flow(t.pcm, t.bpm, t.offset, t.bars); else regrid(t);
    t.state = "ready"; renderTakes(); updateKey();
    try { el.tlwrap.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* no scroll */ }
    const n = t.grid ? t.grid.length : 0;
    if (t.mode === "sing" && t.seg && t.seg.notes.length > 5 && t.imported) { const lk = lock(t.seg.notes, t.bpm).r; if (lk < 0.42) { say("Got your " + KIND_NAME[t.kind].toLowerCase() + ": " + n + " notes. But your singing is loose against " + S.bpm + " BPM (it wanders off the beat). Try Fit tempo to my singing, or record it to the click."); return t; } }
    if (t.mode === "sing" && t.imported && n && !(t.seg && lock(t.seg.notes, t.bpm).r < 0.42)) { say("Got your " + KIND_NAME[t.kind].toLowerCase() + ": " + n + " notes. I guessed where the bar starts. Press Play and listen: the higher click is the 1. If that is not where you would count 1, use the arrows under 'Where does the bar start?'."); return t; }
    say(t.mode === "rap" ? "Got your " + KIND_NAME[t.kind].toLowerCase() + " (rap, about " + (t.flow ? t.flow.density.toFixed(0) : "?") + " syllables a bar). Check it against the click on the timeline." : n ? "Got your " + KIND_NAME[t.kind].toLowerCase() + ": " + n + " notes found. Press its Play button to hear it with the click, and drag it if it is off the beat." : "I could not find clear notes in that take. Sing a bit closer to the microphone, or record again.", t.mode !== "rap" && !n);
    return t;
  }
  async function analyse(t) {
    if (t.mode === "rap") return;
    say("Listening to your " + KIND_NAME[t.kind].toLowerCase() + " ...");
    const frames = await D.trackPitch(t.pcm, { onProgress: p => say("Listening to your " + KIND_NAME[t.kind].toLowerCase() + " ... " + Math.round(p * 100) + "%") });
    t.seg = D.segmentNotes(frames);
  }
  function regrid(t) {
    if (!t.seg) { t.grid = []; return; }
    const bars = t.bars || 99;
    t.grid = D.toGrid(t.seg.notes, t.bpm, t.offset).filter(g => g.abs >= 0 && g.abs < bars * 16);
  }
  async function changeMode(t, m) {
    t.mode = m; t.state = "analysing"; renderTakes();
    if (m === "rap") t.flow = D.flow(t.pcm, t.bpm, t.offset, t.bars); else { if (!t.seg) await analyse(t); regrid(t); }
    t.state = "ready"; renderTakes(); updateKey();
  }
  function finishMove(t) { t.autoOffset = false; t.bars = autoBars(t); regrid(t); if (t.mode === "rap") t.flow = D.flow(t.pcm, t.bpm, t.offset, t.bars); renderTakes(); updateKey(); }

  // playback of one take with the click
  function stopPlay() { if (S.play) { const p = S.play; S.play = null; try { p.src.stop(); } catch (e) { /* ended */ } p.clock.stop(); document.querySelectorAll(".vs-play").forEach(b => { b.innerHTML = "&#9654; Play"; }); movePlayhead(null); } }
  function playTake(t) {
    if (S.play && S.play.take === t) { stopPlay(); return; }
    stopAll(); const c = ctx(); c.resume();
    const b = c.createBuffer(1, t.pcm.length, D.SR); b.copyToChannel(t.pcm, 0);
    const t0 = c.currentTime + 0.15, s = c.createBufferSource(); s.buffer = b; s.connect(c.destination);
    if (t.offset >= 0) s.start(t0, t.offset); else s.start(t0 - t.offset, 0);
    const spb = 60 / t.bpm, beats = Math.ceil((t.dur - t.offset) / spb) + 1;
    S.play = { take: t, src: s, t0, clock: makeClock(t0, () => spb, beats, S.playClick) };
    s.onended = () => { if (S.play && S.play.src === s) stopPlay(); };
    document.querySelectorAll('.vs-take[data-id="' + t.id + '"] .vs-play').forEach(bn => { bn.innerHTML = "&#9632; Stop"; });
    tickUI();
  }

  // ---------- the timeline ----------
  function layoutScale() {
    const beats = Math.max(12, ...S.takes.map(t => (t.dur - t.offset) / (60 / t.bpm) + 2));
    const vw = Math.max(260, el.tlwrap.clientWidth || 340);
    let ppb = S.ppb || Math.max(8, Math.min(48, vw / beats));
    ppb = Math.min(ppb, 7000 / beats); S.eff = ppb;
    return { beats, ppb, width: Math.ceil(beats * ppb) };
  }
  function drawLane(t, canvas, L) {
    const H = 76, dpr = L.width > 3500 ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(L.width * dpr); canvas.height = H * dpr; canvas.style.width = L.width + "px"; canvas.style.height = H + "px";
    const g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, L.width, H);
    const spb = 60 / t.bpm, accent = css("--accent") || "#7c5cfc", vocal = css("--vocal") || "#3fd0b8";
    for (let b = 0; b <= L.beats; b++) { const x = Math.round(b * L.ppb) + 0.5; g.strokeStyle = b % 4 === 0 ? "rgba(168,148,255,.55)" : "rgba(168,148,255,.2)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    // the waveform: the take, shifted by its offset, against the fixed beat lines
    const pk = peaksOf(t), n = pk.length / 2, gain = 0.9 / (t.peakMax || 1); g.fillStyle = vocal; g.globalAlpha = 0.75;
    for (let x = 0; x < L.width; x++) {
      const ts = t.offset + x / L.ppb * spb, te = t.offset + (x + 1) / L.ppb * spb, i0 = Math.floor(ts * 100), i1 = Math.max(i0 + 1, Math.floor(te * 100));
      if (i1 < 0 || i0 >= n) continue; let lo = 0, hi = 0;
      for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) { if (pk[2 * i] < lo) lo = pk[2 * i]; if (pk[2 * i + 1] > hi) hi = pk[2 * i + 1]; }
      const y0 = Math.max(1, H / 2 - hi * gain * (H / 2 - 4)), y1 = Math.min(H - 1, H / 2 - lo * gain * (H / 2 - 4)); g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    g.globalAlpha = 1;
    // the notes we found
    if (t.mode === "sing" && t.seg && t.seg.notes.length) {
      const ms = t.seg.notes.map(q => q.pitch), lo = Math.min(...ms) - 1, hi = Math.max(...ms) + 1, span = Math.max(7, hi - lo);
      g.fillStyle = accent;
      t.seg.notes.forEach(q => { const x = (q.t - t.offset) / spb * L.ppb, w = Math.max(3, q.dur / spb * L.ppb - 1), y = H - 6 - ((q.pitch - lo) / span) * (H - 12); g.fillRect(x, y - 3, w, 6); });
    }
  }
  function peaksOf(t) {
    if (t.peaks) return t.peaks;
    const x = t.pcm, n = Math.ceil(x.length / 160), pk = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { let lo = 0, hi = 0; for (let j = i * 160; j < Math.min(x.length, i * 160 + 160); j++) { if (x[j] < lo) lo = x[j]; if (x[j] > hi) hi = x[j]; } pk[2 * i] = lo; pk[2 * i + 1] = hi; }
    const mags = []; for (let i = 0; i < pk.length; i += 2) mags.push(Math.max(-pk[i], pk[i + 1])); mags.sort((a, b) => a - b); t.peakMax = Math.max(0.02, mags[Math.floor(mags.length * 0.98)] || 0.1);
    return (t.peaks = pk);
  }
  function movePlayhead(beats) {
    const ph = el.tl.querySelector(".vs-ph"); if (!ph) return;
    if (beats === null) { ph.style.display = "none"; return; }
    if (beats < 0) beats = 0;
    const x = beats * (S.eff || 20); ph.style.display = "block"; ph.style.left = Math.round(x) + "px";
    const w = el.tlwrap; if (x > w.scrollLeft + w.clientWidth - 30 || x < w.scrollLeft) w.scrollLeft = Math.max(0, x - 40);
  }
  function renderTakes() {
    el.tl.innerHTML = "";
    if (!S.takes.length) { el.tl.style.width = "auto"; el.tl.innerHTML = '<p class="vs-empty">No takes yet. Record a part, import a voice note, or try the demo take.</p>'; el.build.disabled = true; syncLock(); return; }
    const L = layoutScale(); el.tl.style.width = Math.max(L.width, el.tlwrap.clientWidth || 0) + "px";
    el.tl.style.setProperty("--vs-vw", (el.tlwrap.clientWidth || 320) + "px");
    const ruler = document.createElement("div"); ruler.className = "vs-ruler"; ruler.style.width = L.width + "px";
    let rh = ""; for (let b = 0; b < L.beats; b += 4) rh += '<span style="left:' + Math.round(b * L.ppb) + 'px">' + (b / 4 + 1) + "</span>"; ruler.innerHTML = rh; el.tl.appendChild(ruler);
    const sel = (cls, opts, val) => '<select class="' + cls + '">' + opts.map(([v, n]) => '<option value="' + v + '"' + (String(v) === String(val) ? " selected" : "") + ">" + n + "</option>").join("") + "</select>";
    S.takes.forEach((t, i) => {
      const card = document.createElement("div"); card.className = "vs-take"; card.dataset.id = t.id;
      let info;
      if (t.state === "analysing") info = "Listening ...";
      else if (t.mode === "rap") info = "Rap, about " + (t.flow ? t.flow.density.toFixed(0) : "?") + " syllables a bar";
      else info = (t.grid ? t.grid.length : 0) + " notes" + (t.grid && t.grid.length ? ", " + midiRange(t) : "");
      info += " · " + Math.round(Math.max(0, t.dur - Math.max(0, t.offset))) + " s" + (t.demo ? " · demo" : t.imported ? " · imported" : "");
      if (t.mode === "sing" && t.seg && t.seg.notes.length > 5 && t.state === "ready") { const lk = lock(t.seg.notes, t.bpm).r; info += " · timing: " + tightWord(lk); }
      card.innerHTML = '<div class="vs-take-head" style="width:var(--vs-vw)">' + sel("vs-t-kind", KINDS, t.kind) + sel("vs-t-mode", [["sing", "Sing"], ["rap", "Rap"]], t.mode) + sel("vs-t-rep", [1, 2, 3, 4].map(n => [n, n === 1 ? "Once" : n + " times"]), t.repeat) +
        '<span class="vs-info">' + info + "</span></div>" +
        '<canvas class="vs-lane" aria-label="Take on the timeline. Drag to line it up with the beat."></canvas>' +
        '<div class="vs-take-foot" style="width:var(--vs-vw)"><button type="button" class="vs-chip vs-play">&#9654; Play</button>' +
        '<button type="button" class="vs-chip vs-earlier" aria-label="Earlier by 10 milliseconds">&#9664; 10 ms</button><button type="button" class="vs-chip vs-later" aria-label="Later by 10 milliseconds">10 ms &#9654;</button>' +
        '<button type="button" class="vs-chip vs-snap" title="Put the first note exactly on the nearest beat">Snap to beat</button><span class="vs-shift"></span>' +
        (t.imported && !t.demo ? '<div class="vs-import-row"><label class="vs-field">First bar starts at (seconds) <input type="number" class="vs-t-off" step="0.001" value="' + (Math.round(t.offset * 1000) / 1000) + '" inputmode="decimal"></label><div class="vs-field">Where does the bar start? <span class="vs-bartools"><button type="button" class="vs-chip vs-bar-early">&#9664; 1 beat</button><button type="button" class="vs-chip vs-bar-late">1 beat &#9654;</button></span></div>' + '<button type="button" class="vs-chip vs-fit" title="Look for the tempo your singing really follows">Fit tempo to my singing</button><button type="button" class="vs-chip vs-tapstart" title="Tap the beat while it plays: finds the tempo and where the bar starts">Tap along</button><div class="vs-tappad" hidden><button type="button" class="vs-tapbtn">TAP</button><span class="vs-tapcount">0 taps</span><button type="button" class="vs-chip vs-tapdone">Done</button><button type="button" class="vs-chip vs-tapcancel">Cancel</button></div></div>' : "") +
        '<button type="button" class="vs-chip vs-up" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>&uarr;</button><button type="button" class="vs-chip vs-down" aria-label="Move down"' + (i === S.takes.length - 1 ? " disabled" : "") + '>&darr;</button><button type="button" class="vs-chip vs-del">Delete</button></div>';
      el.tl.appendChild(card);
      const canvas = card.querySelector("canvas"); drawLane(t, canvas, L);
      const q = c => card.querySelector(c), shiftEl = q(".vs-shift"), spb = 60 / t.bpm;
      q(".vs-t-kind").addEventListener("change", e => { t.kind = e.target.value; renderTakes(); updateKey(); });
      q(".vs-t-mode").addEventListener("change", e => changeMode(t, e.target.value));
      q(".vs-t-rep").addEventListener("change", e => { t.repeat = Number(e.target.value); });
      q(".vs-play").addEventListener("click", () => playTake(t));
      if (q(".vs-t-off")) q(".vs-t-off").addEventListener("change", e => { const v = Number(e.target.value); if (isFinite(v)) { t.offset = v; finishMove(t); } });
      if (q(".vs-tapstart")) {
        q(".vs-tapstart").addEventListener("click", () => startTap(t, card));
        q(".vs-tapbtn").addEventListener("pointerdown", e => { e.preventDefault(); tapNow(card); });
        q(".vs-tapbtn").addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tapNow(card); } });
        q(".vs-tapdone").addEventListener("click", () => finishTap(t, card));
        q(".vs-tapcancel").addEventListener("click", () => { stopTap(); say("Cancelled."); });
      }
      if (q(".vs-bar-early")) {
        q(".vs-bar-early").addEventListener("click", () => { t.offset -= spb; finishMove(t); say("The bar now starts one beat earlier. Press Play: the higher click is the start of the bar (the 1)."); });
        q(".vs-bar-late").addEventListener("click", () => { t.offset += spb; finishMove(t); say("The bar now starts one beat later. Press Play: the higher click is the start of the bar (the 1)."); });
        q(".vs-fit").addEventListener("click", () => {
          const f = fitTempo(t); if (!f) { say("Not enough notes to find the tempo.", true); return; }
          if (Math.abs(f.bpm - S.bpm) < 0.3) { say("Your singing already fits " + S.bpm + " BPM as well as it can. It is " + tightWord(f.r) + "."); return; }
          setBpm(f.bpm, true); say("Your singing follows about " + Math.round(f.bpm * 10) / 10 + " BPM better, so the tempo is now " + S.bpm + ". It is " + tightWord(f.r) + ".");
        });
      }
      q(".vs-earlier").addEventListener("click", () => { t.offset += 0.01; finishMove(t); });
      q(".vs-later").addEventListener("click", () => { t.offset -= 0.01; finishMove(t); });
      q(".vs-snap").addEventListener("click", () => {
        const n0 = t.seg && t.seg.notes[0]; if (!n0) { say("There are no notes to snap yet.", true); return; }
        const p = (n0.t + P_SHIFT - t.offset) / spb; t.offset = n0.t + P_SHIFT - Math.round(p) * spb; finishMove(t); say("Snapped: the first note now sits on a beat.");
      });
      q(".vs-up").addEventListener("click", () => { [S.takes[i - 1], S.takes[i]] = [S.takes[i], S.takes[i - 1]]; renderTakes(); });
      q(".vs-down").addEventListener("click", () => { [S.takes[i + 1], S.takes[i]] = [S.takes[i], S.takes[i + 1]]; renderTakes(); });
      q(".vs-del").addEventListener("click", () => { if (S.play && S.play.take === t) stopPlay(); S.takes.splice(i, 1); syncLock(); renderTakes(); updateKey(); });
      // drag the take against the beat lines
      let drag = null;
      canvas.addEventListener("pointerdown", e => { if (t.state !== "ready") return; drag = { x0: e.clientX, off0: t.offset }; try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* no capture */ } canvas.classList.add("is-drag"); });
      canvas.addEventListener("pointermove", e => {
        if (!drag) return; const dx = e.clientX - drag.x0; t.offset = drag.off0 - dx / L.ppb * spb;
        drawLane(t, canvas, L); const ms = Math.round((drag.off0 - t.offset) * 1000); shiftEl.textContent = ms === 0 ? "" : (ms > 0 ? "later " : "earlier ") + Math.abs(ms) + " ms";
      });
      const end = () => { if (!drag) return; const moved = Math.abs(t.offset - drag.off0) > 0.0005; drag = null; canvas.classList.remove("is-drag"); if (moved) finishMove(t); };
      canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    });
    const ph = document.createElement("div"); ph.className = "vs-ph"; ph.style.display = "none"; el.tl.appendChild(ph);
    el.build.disabled = S.takes.some(t => t.state === "analysing");
    syncLock();
  }
  function midiRange(t) { const p = (t.grid || []).map(g => g.pitch); if (!p.length) return ""; const f = m => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); return f(Math.min(...p)) + " to " + f(Math.max(...p)); }
  el.zin.addEventListener("click", () => { S.ppb = Math.min(160, (S.eff || 20) * 1.6); renderTakes(); });
  el.zout.addEventListener("click", () => { S.ppb = Math.max(5, (S.eff || 20) / 1.6); renderTakes(); });
  el.zfit.addEventListener("click", () => { S.ppb = null; renderTakes(); el.tlwrap.scrollLeft = 0; });
  // dragging the ruler scrolls the timeline sideways
  (function () { let d = null; el.tlwrap.addEventListener("pointerdown", e => { if (!e.target.closest(".vs-ruler")) return; d = { x: e.clientX, s: el.tlwrap.scrollLeft }; try { e.target.setPointerCapture(e.pointerId); } catch (er) { /* none */ } }); el.tlwrap.addEventListener("pointermove", e => { if (d) el.tlwrap.scrollLeft = d.s - (e.clientX - d.x); }); const u = () => { d = null; }; el.tlwrap.addEventListener("pointerup", u); el.tlwrap.addEventListener("pointercancel", u); })();
  window.addEventListener("resize", () => { if (S.takes.length && panel.offsetParent) renderTakes(); });
  document.addEventListener("blux-tab", e => { if (e.detail === "sketch") renderTakes(); else stopAll(); });

  // ---------- the key ----------
  function allNotes() { return S.takes.filter(t => t.mode === "sing" && t.grid).flatMap(t => t.grid.map(g => ({ pitch: g.pitch, len: g.len }))); }
  function currentKey() {
    if (S.manualKey) return S.manualKey;
    const k = S.keyInfo && S.keyInfo.candidates[S.keyPick];
    return k ? { root: k.root, scale: k.scale } : null;
  }
  function updateKey() {
    const notes = allNotes();
    S.keyInfo = notes.length >= 4 ? D.detectKey(notes) : null;
    if (S.keyInfo && S.keyPick >= S.keyInfo.candidates.length) S.keyPick = 0;
    renderKey(); readVibe();
  }
  // ---------- the vibe: what the voice feels like ----------
  function readVibe() {
    S.vibe = null; el.hear.hidden = true; if (!D.vibeOf) return;
    const key = currentKey(), list = [];
    S.takes.forEach(t => {
      t.energy = null; if (t.state !== "ready") return;
      let f = null;
      if (t.mode === "rap" && t.flow) f = D.takeFeatures(t.pcm, null, t.bpm, t.flow.density);
      else if (t.mode === "sing" && t.seg && t.seg.notes.length >= 4) f = D.takeFeatures(t.pcm, t.seg.notes, t.bpm);
      if (!f) return; t.energy = D.energyOf(f); list.push({ f, w: Math.max(1, t.dur) });
    });
    if (!list.length) return;
    S.vibe = D.vibeOf(list, key ? key.scale : "minor");
    const v = S.vibe, top3 = v.order.slice(0, 3).map(x => x[0].toUpperCase() + x.slice(1));
    el.hear.hidden = false;
    el.hear.innerHTML = '<div class="vs-h">What I hear</div><p class="vs-note">Your voice sounds <strong>' + v.traits.join(", ") + "</strong>. Closest moods: <strong>" + top3.join(", ") + "</strong>. The beat will be built to match. Change the mood below if it is wrong.</p>";
  }
  // the beat style whose mood fits the voice best (within the chosen genre)
  function bestStyle(genre, vibe) {
    const g = TEMPLATES[genre]; if (!g || !vibe || typeof STYLE_VIBES === "undefined") return null;
    let best = null, bs = 0.3;                                    // a style must really fit (weighted average of the squared mood scores), else leave the pick to the generator
    g.styleOrder.forEach(id => { const tb = STYLE_VIBES[id] || {}; let sc = 0, w = 0; Object.keys(tb).forEach(k => { const v = vibe.scores[k] || 0; sc += tb[k] * v * v; w += tb[k]; }); sc = w ? sc / w : 0; if (sc > bs) { bs = sc; best = id; } });
    return best;
  }
  el.mood.addEventListener("change", () => { /* read when building */ });
  // changing the Chords box after a build swaps only the chords: same drums, same sounds, so the two can be compared fairly
  el.harm.addEventListener("change", () => {
    const b = typeof current !== "undefined" ? current : null, key = currentKey();
    if (!b || !b.vocalSketch || !b.vocalSketch.entries || !key) return;
    try { harmonize(b, b.vocalSketch.entries, key); useBeat(b, "New chords, same drums. They start on the next bar.", "New chords. Tap Play."); } catch (e) { console.warn(e); say("Could not change the chords: " + e.message, true); return; }
    const hf = S.harmFit && S.harmFit.length ? (S.harmFit.find(c => c.kind === "verse") || S.harmFit[0]) : null;
    say(el.harm.value === "notes" ? "Chords now follow your notes." + (hf ? " " + Math.round(hf.fit * 100) + "% of what you sang sits on the chord under it." : "") : "Chords now stay in one key.");
  });
  function renderKey() {
    const box = el.key; box.innerHTML = "";
    if (!S.takes.length) { box.hidden = true; return; } box.hidden = false;
    const info = S.keyInfo;
    let html = '<div class="vs-h">Key</div>';
    if (info && info.best) {
      const sure = info.confidence > 0.75 ? "fairly sure" : info.confidence > 0.5 ? "probably" : "not sure";
      html += '<p class="vs-note">You sang in <strong>' + NOTE[info.best.root] + " " + info.best.scale + "</strong> (" + sure + "). If the beat sounds wrong against your voice, pick another:</p>" +
        '<div class="vs-keychoices">' + info.candidates.map((c, i) => '<label class="vs-keychoice"><input type="radio" name="vs-keypick" value="' + i + '"' + (!S.manualKey && i === S.keyPick ? " checked" : "") + "><span>" + NOTE[c.root] + " " + c.scale + "</span></label>").join("") + "</div>";
    } else html += '<p class="vs-note">' + (S.takes.some(t => t.mode === "sing") ? "Not enough notes to find the key yet. Choose the key you sang in:" : "Rap has no notes, so choose the key you want for the beat:") + "</p>";
    const mk = S.manualKey;
    html += '<div class="vs-row"><label class="vs-field">Or choose <select id="vs-mroot"><option value="">key ...</option>' + NOTE.map((n, i) => '<option value="' + i + '"' + (mk && mk.root === i ? " selected" : "") + ">" + n + "</option>").join("") + "</select></label>" +
      '<label class="vs-field">&nbsp;<select id="vs-mscale"><option value="minor">minor</option><option value="major"' + (mk && mk.scale === "major" ? " selected" : "") + '>major</option><option value="dorian"' + (mk && mk.scale === "dorian" ? " selected" : "") + ">dorian</option></select></label></div>";
    box.innerHTML = html;
    box.querySelectorAll('input[name="vs-keypick"]').forEach(r => r.addEventListener("change", () => { S.keyPick = Number(r.value); S.manualKey = null; renderKey(); }));
    const mr = box.querySelector("#vs-mroot"), ms = box.querySelector("#vs-mscale");
    const setManual = () => { S.manualKey = mr.value === "" ? null : { root: Number(mr.value), scale: ms.value }; renderKey(); };
    mr.addEventListener("change", setManual); ms.addEventListener("change", setManual);
  }

  // ---------- build ----------
  // The chords of the beat, from what was sung: the first take of each part decides that part's chords. Also used to change only the chords of a beat already built.
  function harmonize(beat, entries, key) {
    const t = resolveTemplate(beat.genre, beat.style), cpb = beat.chordsPerBar || 1;
    const degrees = Object.assign({}, beat.harmony.degrees), chords = Object.assign({}, beat.harmony.chords), fitted = [];
    const followNotes = el.harm.value === "notes" && typeof D.fitTriads === "function", covers = [];
    ["intro", "verse", "pre", "chorus", "bridge", "outro"].forEach(kind => {
      const take = S.takes.find(x => x.kind === kind && x.mode === "sing" && x.grid && x.grid.length >= 3);
      if (!take) return;
      const bars = Math.max(2, take.bars || 4), fits = D.fitChords(take.grid, key, bars, cpb), opt = fits[S.feel] || fits[1];
      degrees[kind] = opt; chords[kind] = chordsFor(t, beat.key, opt); fitted.push(KIND_NAME[kind].toLowerCase());
      if (followNotes && take.seg && take.seg.notes.length >= 3) {      // chords from the notes actually sung, bar by bar (any major or minor chord, not only the ones of one key)
        const tri = D.fitTriads(take.seg.notes, take.bpm, take.offset, bars, cpb, key), pick = tri[S.feel] || tri[1];
        const keyFit = D.triadFit(chords[kind].map(c => ({ root: c.rootPc, minor: c.intervals[1] === 3 })), take.seg.notes, take.bpm, take.offset, bars, cpb);
        chords[kind] = absChords(pick, t, beat.key.flats); covers.push({ kind, keyFit, fit: D.triadFit(pick, take.seg.notes, take.bpm, take.offset, bars, cpb) });
      }
    });
    ["intro", "outro"].forEach(kind => {                          // no take for it: borrow the first bars of the verse, cut to this part's length
      if (fitted.includes(kind)) return;
      const e = entries.find(x => x[0] === kind), n = Math.max(1, (e ? e[1] : 4) * cpb);
      degrees[kind] = degrees.verse.slice(0, n); chords[kind] = followNotes && covers.some(c => c.kind === "verse") ? chords.verse.slice(0, n) : chordsFor(t, beat.key, degrees[kind]);
    });
    S.harmFit = covers;
    beat.harmony = { degrees, chords }; beat.chords = chords.verse;
    beat.hooks = buildHooks(t, degrees, cpb);
    liftChords(beat, chords);
    beat.harmony = { degrees, chords }; beat.chords = chords.verse;
    beat.hooks = buildHooks(t, degrees, cpb);
    S.fitted = fitted;
  }
  // Keep the chords above the voice: a low voice (men, or any low part) sits where the keys and strings would be, so all the chords move up an octave together
  function liftChords(beat, chords) {
    const pitches = S.takes.filter(x => x.mode === "sing" && x.seg && x.state === "ready").flatMap(x => x.seg.notes.map(n => n.pitch)).sort((p, q) => p - q);
    if (pitches.length < 4) return;
    const top = pitches[Math.floor(pitches.length * 0.92)], want = top + 3;                    // the chords' lowest note should clear the top of the voice
    const all = Object.keys(chords).flatMap(k => chords[k]), seen = new Set(all), low = Math.min(...all.map(c => Math.min(...c.midi)));
    if (low >= want) { S.lifted = 0; return; }
    const shift = 12 * Math.ceil((want - low) / 12), flats = beat.key.flats; S.lifted = shift;
    seen.forEach(c => { c.midi = c.midi.map(m => m + shift); c.notes = c.midi.map(m => midiToName(m, flats)); });
  }
  // Chord objects (like buildChord in beatgen.js) for any major/minor chord: [{root, minor}] -> chords with smooth voice leading
  function absChords(list, t, flats) {
    const chords = list.map(c => {
      const seventh = Math.random() < t.chord.seventh, intervals = c.minor ? [0, 3, 7] : [0, 4, 7];
      if (seventh) intervals.push(c.minor ? 10 : 11);
      const rootMidi = 48 + c.root, midi = intervals.map(i => rootMidi + i); let bassMidi = 24 + c.root; if (bassMidi < 31) bassMidi += 12;
      const rootName = (flats ? NOTE_FLAT : NOTE_SHARP)[c.root];
      return { degree: 0, rootPc: c.root, rootName, name: rootName + chordSuffix(intervals), intervals, midi, notes: midi.map(m => midiToName(m, flats)), bassMidi, bass: midiToName(bassMidi, flats), bell: midiToName(72 + c.root, flats) };
    });
    return voiceLead(chords, flats);
  }
  // The answering line: in a pause of the singer (a beat and a quarter or more, in every second bar) the lead plays 2 or 3 notes that echo the
  // contour of the last notes sung, above the voice, on notes of the chord under it. -> beat.answer = { bars: { <bar>: [{ step, len, midi }] }, level }
  function answerLine(entries, beat) {
    const out = {}, cpb = beat.chordsPerBar || 1, ps = S.takes.filter(x => x.mode === "sing" && x.seg && x.state === "ready").flatMap(x => x.seg.notes.map(n => n.pitch)).sort((a, b) => a - b);
    if (ps.length < 6) return null;
    const lowest = ps[Math.floor(ps.length * 0.92)] + 2;
    let start = 0;
    entries.forEach(e => {
      const kind = e[0], n = e[1], take = S.takes[e[2]];
      if (take && take.state === "ready" && take.mode === "sing" && take.grid && take.grid.length >= 4) {
        const chs = beat.harmony.chords[kind] || beat.harmony.chords.verse, grid = take.grid.slice().sort((a, b) => a.abs - b.abs);
        for (let k = 0; k < n; k++) {
          const vm = beat.voice.bars[start + k], act = vm && vm.act; if (!act || k === n - 1) continue;   // the last bar of a part is a fill bar: no answer there
          let gs = -1, glen = 0;
          for (let s2 = 0; s2 < 16 && gs < 0; s2++) { if (act[s2] !== 0) continue; let e2 = s2; while (e2 < 16 && act[e2] === 0) e2++; if (e2 - s2 >= 5 && (s2 > 0 || (vm && start + k > 0))) { gs = s2; glen = e2 - s2; } else s2 = e2; }
          if (gs < 0 || (k % 2 === 0 && glen < 9)) continue;
          const gapAbs = k * 16 + gs, last = grid.filter(x => x.abs < gapAbs && x.abs >= gapAbs - 24).slice(-3);
          if (last.length < 2) continue;
          const chord = chs[(k * cpb + Math.floor(gs / (16 / cpb))) % chs.length], allowed = chord.intervals.map(i => (chord.rootPc + i) % 12);
          const near = (target, dir) => { let best = null; for (let m = Math.round(target) - 7; m <= Math.round(target) + 7; m++) { if (!allowed.includes(((m % 12) + 12) % 12)) continue; if (dir && (m - target) * dir <= 0) continue; if (best === null || Math.abs(m - target) < Math.abs(best - target)) best = m; } return best; };
          const raw = last.map(x => x.pitch), shift = 12 * Math.ceil((lowest - Math.min(...raw)) / 12), notes = [near(raw[0] + shift)];
          for (let i = 1; i < raw.length; i++) { const iv = Math.max(-5, Math.min(5, raw[i] - raw[i - 1])); let m = near(notes[i - 1] + iv); if (m === notes[i - 1] && iv !== 0) m = near(notes[i - 1], iv > 0 ? 1 : -1); notes.push(m); }
          if (notes.some(m => m === null)) continue;
          while (Math.max(...notes) > lowest + 19) for (let i = 0; i < notes.length; i++) notes[i] -= 12;
          const step0 = gs + (glen >= 8 ? 2 : 1), room = Math.floor((gs + glen - step0) / 2), cnt = Math.min(notes.length, room);
          if (cnt < 2) continue;
          out[start + k] = notes.slice(0, cnt).map((m, i) => ({ step: step0 + i * 2, len: i === cnt - 1 ? Math.min(4, gs + glen - (step0 + i * 2)) : 2, midi: m }));
        }
      }
      start += n;
    });
    return Object.keys(out).length ? { bars: out, level: 0.75 } : null;
  }
  // "Less is more": a beat under a voice keeps only the layers that the song and the mood need.
  //   light  : kick, snare, bass, chords, ONE top-percussion (hat for a driving mood, shaker for a calm one); the pad only in the lift (chorus), the intro and the outro
  //   normal : light + the second top-percussion and one small extra percussion
  //   full   : everything the style has
  // The small extras (rim, openhat, pluck, bell, log drum) are dropped unless the mood is driving (hard, party, uplifting) and the voice is energetic.
  function trimLayers(beat, entries, vibeKey, level) {
    if (level === "full") return;
    const driving = ["hard", "party", "uplifting"].includes(vibeKey) && S.vibe && S.vibe.energy >= 0.55, calm = !vibeKey || ["chill", "romantic", "dreamy", "soulful", "dark"].includes(vibeKey);
    beat.sections.forEach((sec, i) => {
      const p = beat.presence[i]; if (!p) return;
      const lift = sec.kind === "chorus" || sec.kind === "bridge", edge = sec.kind === "intro" || sec.kind === "outro";
      const topKeep = "hat";                                       // the hat is the pulse; in a calm mood it is played soft (see applyGroove / shapeGroove)
      if (!edge) { p.kick = true; p.snare = true; p.bass = true; p.chords = true; }                // the spine of a groove is always there in a sung part
      if (!edge && !p.hat && !p.shaker) p.hat = true;                // a groove always needs a pulse on top
      const top = p[topKeep] ? topKeep : (p.hat ? "hat" : (p.shaker ? "shaker" : null));
      ["hat", "shaker"].forEach(n => { if (n !== top && !(level === "normal" && !edge)) p[n] = false; });
      if (level === "normal" && !edge) { /* both top-percussion stay */ }
      ["openhat", "pluck", "bell", "logdrum"].forEach(n => { if (!driving) p[n] = false; });
      if (!driving) p.rim = level === "normal" ? p.rim && !edge : false;
      if (level === "light" || !driving) { if (!(level === "normal" && lift)) p.perc = level === "normal" ? p.perc && !edge : false; }
      if (level === "light" || calm === false) { if (!lift && !edge) p.pad = false; }
      if (edge) { p.pluck = false; }
    });
  }
  function voiceGroove() {
    let tot = 0, acc = 0;
    S.takes.forEach(t => { if (t.mode !== "sing" || t.state !== "ready" || !t.seg || !D.swingOf) return; const g = D.swingOf(t.seg.notes, t.bpm); if (g && g.r >= 0.45 && g.on >= 6 && g.off >= 6) { acc += g.s * (g.on + g.off); tot += g.on + g.off; } });
    return tot ? { s: acc / tot } : null;
  }
  // For each bar of the song: which of its 16 steps have a note starting (1), a note still held (2), or silence (0)
  function voiceBars(entries) {
    const out = {}; let start = 0;
    entries.forEach(e => {
      const take = S.takes[e[2]], n = e[1];
      if (take && take.state === "ready") {
        const acts = Array.from({ length: n }, () => new Array(16).fill(0)), step = 60 / take.bpm / 4;
        const mark = (abs, len) => { if (abs < 0 || abs >= n * 16) return; acts[Math.floor(abs / 16)][abs % 16] = 1; for (let k = 1; k < len && abs + k < n * 16; k++) { const b = Math.floor((abs + k) / 16), st = (abs + k) % 16; if (!acts[b][st]) acts[b][st] = 2; } };
        if (take.mode === "rap" && take.flow && take.flow.onsetT) take.flow.onsetT.forEach(t => mark(Math.round((t - take.offset) / step), 2));
        else if (take.grid) take.grid.forEach(g => mark(g.abs, Math.min(g.len, 16)));
        acts.forEach((a, k) => { out[start + k] = { act: a }; });
      }
      start += n;
    });
    return out;
  }
  function buildForm() {
    const entries = [];                                           // [kind, bars, takeIndex]
    S.takes.forEach((t, i) => { for (let r = 0; r < t.repeat; r++) entries.push([t.kind, Math.max(2, t.bars || 4), i]); });
    if (S.io) {
      if (!entries.some(e => e[0] === "intro")) entries.unshift(["intro", 4, -1]);
      if (!entries.some(e => e[0] === "outro")) entries.push(["outro", 4, -1]);
    }
    return entries.slice(0, 24);
  }
  function build() {
    if (!S.takes.length || S.takes.some(t => t.state === "analysing")) return;
    stopAll();
    const key = currentKey();
    if (!key) { say("Choose the key first (in the Key box above): there are no sung notes to read it from.", true); el.key.scrollIntoView({ block: "center" }); return; }
    const entries = buildForm();
    const genre = el.genre.value, opts = { structure: "custom", form: entries.map(e => [e[0], e[1]]), bpm: S.bpm, root: key.root, scale: key.scale };
    readVibe();
    const moodSel = el.mood.value, vibeKey = moodSel === "match" ? (S.vibe && S.vibe.top) : (moodSel === "none" ? null : moodSel);
    if (vibeKey) opts.vibe = vibeKey;
    if (el.style.value !== "auto") opts.style = el.style.value;
    else if (moodSel !== "none") { const bs = bestStyle(genre, moodSel === "match" ? S.vibe : { scores: Object.fromEntries(Object.keys(S.vibe ? S.vibe.scores : { [moodSel]: 1 }).map(k => [k, k === moodSel ? 1 : 0.05])) }); if (bs) opts.style = bs; }
    let beat;
    try { beat = generatePattern(genre, opts); } catch (e) { console.warn(e); say("Could not build that beat: " + e.message, true); return; }
    harmonize(beat, entries, key);                                // the chords follow what was sung
    // the voice carries the tune: no lead melody (unless asked for); no plucked line under a rapper; a fast rap leaves the percussion alone
    const ens = S.takes.map(x => x.energy).filter(v => v != null).sort((a, b) => a - b), med = ens.length > 1 ? ens[Math.floor(ens.length / 2)] : null;
    beat.sections.forEach((sec, i) => {
      const take = S.takes[entries[i] ? entries[i][2] : -1], p = beat.presence[i]; if (!p) return;
      if (!S.keepLead) p.lead = false;
      if (vibeKey && ["chill", "romantic", "dreamy", "soulful"].includes(vibeKey) || (vibeKey === "dark" && S.vibe && S.vibe.energy < 0.6)) { p.logdrum = false; p.bell = false; }   // a calm, soft song leaves out the bright, percussive instruments
      if (take && take.energy != null && S.vibe && moodSel !== "none" && med != null && take.energy < med - 0.1) { p.perc = false; p.openhat = false; }   // a calmer part of the song gets a calmer beat
      if (take && take.mode === "rap") { p.pluck = false; p.lead = false; if (take.flow && take.flow.level === "fast") { p.perc = false; p.openhat = false; } }
    });
    trimLayers(beat, entries, vibeKey, el.full.value);
    beat.voice = { bars: voiceBars(entries), variety: true, groove: { calm: !vibeKey || ["chill", "romantic", "dreamy", "soulful"].includes(vibeKey) || (vibeKey === "dark" && S.vibe && S.vibe.energy < 0.6) } };                    // where the singer sings and rests: the beat gives room (see applyVoice in beatgen.js)
    const fitted = S.fitted || [];
    // the groove: a singer who clearly swings the eighth notes gets a swung beat, a straight singer a straighter one (only when the singing sits clearly on the beat)
    const gr = voiceGroove(), baseSwing = resolveTemplate(beat.genre, beat.style).swing;
    if (gr) { beat.swing = Math.max(0, Math.min(0.42, baseSwing * (0.3 + 0.9 * gr.s) + 0.09 * gr.s)); S.groove = { s: gr.s, swing: beat.swing }; } else { delete beat.swing; S.groove = null; }
    delete beat.answer;
    if (el.answer.checked) {
      beat.answer = answerLine(entries, beat);
      if (beat.answer) beat.sections.forEach((sec, i) => { if (beat.presence[i]) beat.presence[i].lead = Object.keys(beat.answer.bars).some(b => b >= sec.start && b < sec.start + sec.bars); });
    }
    beat.vocalSketch = { takes: S.takes.length, fitted, entries };
    try {
      genreEl.value = beat.genre; if (typeof fillStyleOptions === "function") fillStyleOptions();
      settings.root = key.root; settings.scale = key.scale; settings.bpmAuto = false; settings.bpm = S.bpm;
      if (typeof rootEl !== "undefined" && rootEl) rootEl.value = String(key.root);
      if (typeof scaleEl !== "undefined" && scaleEl) scaleEl.value = key.scale;
      if (typeof tempoAutoEl !== "undefined" && tempoAutoEl) tempoAutoEl.checked = false;
      if (typeof structureEl !== "undefined" && structureEl) { try { structureEl.value = "custom"; } catch (e) { /* option may not exist */ } }
      useBeat(beat, "Your beat starts on the next bar.", "Your beat is ready. Tap Play.");
    } catch (e) { console.warn(e); }
    const hf = S.harmFit && S.harmFit.length ? (S.harmFit.find(c => c.kind === "verse") || S.harmFit[0]) : null;
    const fitWords = hf ? " " + Math.round(hf.fit * 100) + "% of what you sang sits on the chord under it (staying in one key it would be " + Math.round(hf.keyFit * 100) + "%)." : "";
    say("Built a " + (vibeKey ? vibeKey + " " : "") + (beat.styleName || TEMPLATES[beat.genre].name) + " beat in " + NOTE[key.root] + " " + key.scale + " at " + S.bpm + " BPM. The chords follow your " + (fitted.length ? fitted.join(", ") : "melody") + "." + fitWords + (S.groove ? (S.groove.s > 0.6 ? " Your eighth notes swing, so the beat swings." : S.groove.s < 0.25 ? " Your singing is straight, so the groove is straighter." : "") : "") + " Tap Play.");
    el.mixcard.hidden = false; MIX.beat = null; mixStop();
    if (window.VLBLUX) window.VLBLUX.show("beat");
  }
  el.build.addEventListener("click", build);

  // ---------- loudness: a finished beat is about -15 LUFS, with a limiter so the kick does not clip ----------
  function biquad(x, b0, b1, b2, a1, a2) {
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; y[i] = v; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; }
    return y;
  }
  function kWeighted(x, rate) {                                   // the K-weighting of ITU-R BS.1770 (what LUFS measures)
    let K = Math.tan(Math.PI * 1681.974450955533 / rate), Q = 0.7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    const y = biquad(x, (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
    K = Math.tan(Math.PI * 38.13547087602444 / rate); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
    return biquad(y, 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  }
  // integrated loudness (LUFS) of one or two channels, with the standard gates; also used for the sung part of a voice (gated by the same rule)
  function lufsOf(chs, rate) {
    const w = chs.map(c => kWeighted(c, rate)), blk = Math.round(rate * 0.4), hop = Math.round(rate * 0.1), ms = [];
    for (let a = 0; a + blk <= w[0].length; a += hop) { let e = 0; w.forEach(c => { let t = 0; for (let i = a; i < a + blk; i++) t += c[i] * c[i]; e += t / blk; }); ms.push(e); }
    const lu = e => -0.691 + 10 * Math.log10(e + 1e-20), above = ms.filter(e => lu(e) > -70);
    if (!above.length) return -70;
    const rel = lu(above.reduce((x, y) => x + y, 0) / above.length) - 10, kept = above.filter(e => lu(e) > rel);
    return kept.length ? lu(kept.reduce((x, y) => x + y, 0) / kept.length) : -70;
  }
  // a look-ahead peak limiter (ceiling in dBFS): the gain falls smoothly just before a peak and comes back in about 120 ms
  function limitChannels(chs, rate, ceilDb) {
    const n = chs[0].length, ceil = Math.pow(10, ceilDb / 20), L = Math.round(rate * 0.003), need = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < chs.length; c++) { const v = Math.abs(chs[c][i]); if (v > m) m = v; } need[i] = m > ceil ? ceil / m : 1; }
    const mn = new Float32Array(n), dq = new Int32Array(n); let h = 0, t = 0;                     // sliding minimum over +-L samples
    for (let i = 0; i < n + L; i++) {
      if (i < n) { while (t > h && need[dq[t - 1]] >= need[i]) t--; dq[t++] = i; }
      const j = i - L; if (j >= 0) { while (dq[h] < j - L) h++; mn[j] = need[dq[h]]; }
    }
    const g = new Float32Array(n); let run = 0;                                                   // smooth the fall (box of L), then a slow release
    const cs = new Float64Array(n + 1); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + mn[i];
    const rel = 1 - Math.exp(-1 / (0.12 * rate)); let prev = 1;
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - (L >> 1)), z = Math.min(n, i + (L >> 1) + 1); run = (cs[z] - cs[a]) / (z - a); prev = Math.min(run, prev + (1 - prev) * rel); g[i] = prev; }
    chs.forEach(c => { for (let i = 0; i < n; i++) c[i] *= g[i]; });
  }
  // a dip around 2.4 kHz (where a voice is clear): a beat made for a voice leaves room for it (RBJ peaking filter)
  function carve(x, rate, f0, q, db) {
    const A = Math.pow(10, db / 40), w = 2 * Math.PI * f0 / rate, al = Math.sin(w) / (2 * q), a0 = 1 + al / A;
    return biquad(x, (1 + al * A) / a0, -2 * Math.cos(w) / a0, (1 - al * A) / a0, -2 * Math.cos(w) / a0, (1 - al / A) / a0);
  }
  function masterBeat(buf, targetLufs, makeRoom) {
    const c = ctx(), rate = buf.sampleRate, chs = [0, 1].map(k => Float32Array.from(buf.getChannelData(Math.min(k, buf.numberOfChannels - 1))));
    if (makeRoom) chs.forEach((ch, k) => { chs[k] = carve(ch, rate, 2400, 0.7, -3.5); });
    const cur = lufsOf(chs, rate), gain = Math.pow(10, (targetLufs - cur) / 20);
    chs.forEach(ch => { for (let i = 0; i < ch.length; i++) ch[i] *= gain; });
    limitChannels(chs, rate, -1.5);
    const out = c.createBuffer(2, buf.length, rate); chs.forEach((ch, k) => out.copyToChannel(ch, k));
    out.__lufs = lufsOf(chs, rate); out.__was = cur;
    return out;
  }
  // ---------- hear it with the voice: the beat is rendered once, the takes are laid on it at the right place, the voice can be nudged ----------
  const MIX = { beat: null, forBeat: null, nudge: 10, src: null, busy: false };
  const mixSay = (t, bad) => { el.mixstatus.textContent = t; el.mixstatus.classList.toggle("is-bad", !!bad); };
  function mixStop() { if (MIX.src) { try { MIX.src.stop(); } catch (e) { /* ended */ } MIX.src = null; } el.mixstop.disabled = true; el.mixplay.innerHTML = "&#9654; Hear my voice with the beat"; }
  function nudgeLabel() { el.nudgeval.value = (MIX.nudge > 0 ? "+" : "") + MIX.nudge + " ms"; }
  // The voice laid on the beat: returns an AudioBuffer (beat + voice), or the voice alone as Float32Array placed in the beat's own time (see mixBuffer)
  function placeVoice(beat, rate, withNudge) {
    const barSec = 60 / beat.bpm * 4, entries = (beat.vocalSketch && beat.vocalSketch.entries) || [], total = Math.ceil((beat.totalBars * barSec + 1) * rate), out = new Float32Array(total);
    let start = 0;
    entries.forEach(e => {
      const t = S.takes[e[2]], n = e[1];
      if (t && t.state === "ready" && t.pcm) {
        // the take's own time 0 sits at (the part's start + nudge - the take's bar-1 offset): a pickup sung before "1" is kept
        const hi = t.hi || { x: t.pcm, sr: D.SR }, x = hi.x, base = (start * barSec + (withNudge ? MIX.nudge / 1000 : 0) - (t.offset || 0)) * rate, endAt = Math.min(total, Math.round(((start + n) * barSec + 0.4) * rate));
        for (let m = Math.max(0, Math.ceil(base)); m < endAt; m++) {
          const k = (m - base) / rate * hi.sr, j = Math.floor(k); if (j + 2 >= x.length) break;
          const f = k - j, y0 = x[Math.max(0, j - 1)], y1 = x[j], y2 = x[j + 1], y3 = x[j + 2];
          const v = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));        // cubic: smooth even from a 16 kHz copy
          const fade = Math.min(1, k / (hi.sr * 0.015), (endAt - m) / (rate * 0.005));    // a short fade at both ends so the cut does not click
          out[m] += v * fade;
        }
      }
      start += n;
    });
    return out;
  }
  function mixBuffer(voiceOnly) {
    const c = ctx(), beat = MIX.beat, rate = beat.sampleRate, ch = Math.min(2, beat.numberOfChannels), len = beat.length;
    const voice = placeVoice(MIX.forBeat, rate, true);
    // the voice sits about 4 LU above the beat (measured on the sung part): the "Voice louder or softer" slider moves it from there
    if (MIX.vgain == null) { const lv = lufsOf([voice], rate); MIX.vgain = Math.max(0.25, Math.min(12, Math.pow(10, ((beat.__lufs != null ? beat.__lufs : -15) + 4 - lv) / 20))); MIX.vlufs = lv; }
    const lvl = MIX.vgain * 0.8 * el.voicelvl.value / 100, out = c.createBuffer(2, Math.max(len, voice.length), rate);
    let peak = 0;
    for (let k = 0; k < 2; k++) {
      const o = out.getChannelData(k), b = beat.getChannelData(Math.min(k, ch - 1));
      for (let i = 0; i < o.length; i++) { const v = (i < len && !voiceOnly ? b[i] * 0.8 : 0) + (i < voice.length ? voice[i] * lvl : 0); o[i] = v; if (Math.abs(v) > peak) peak = Math.abs(v); }
    }
    // the whole mix is brought to the same finished loudness as the beat (about -15 LUFS, peaks held at -1 dB by the limiter)
    return masterBeat(out, -15);
  }
  async function ensureMixBeat() {
    if (MIX.beat && MIX.forBeat === current) return true;
    if (typeof renderBeatForOutput !== "function") { mixSay("This needs the Beat Lab player.", true); return false; }
    if (typeof bootAudio === "function" && !bootAudio()) return false;
    mixSay("Getting the beat ready ...");
    // the beat for a voice is rendered with Beat Lab's Mastering on (about 4 dB louder and more even: a finished beat, not a quiet mix), then the switch goes back
    const wasMastering = typeof masteringOn !== "undefined" ? masteringOn : false;
    try { if (typeof masteringOn !== "undefined") masteringOn = true; MIX.beat = await renderBeatForOutput("Getting the beat ready"); }
    finally { if (typeof masteringOn !== "undefined") masteringOn = wasMastering; }
    MIX.beat = masterBeat(MIX.beat, -15, true); MIX.vgain = null; MIX.forBeat = current;
    return true;
  }
  async function mixPlay() {
    if (MIX.busy) return; MIX.busy = true; el.mixplay.disabled = true;
    try {
      if (!current || !current.vocalSketch) { mixSay("Build a beat from your voice first.", true); return; }
      stopAll(); mixStop();
      if (!await ensureMixBeat()) return;
      const c = ctx(); if (c.state === "suspended") await c.resume();
      const buf = mixBuffer(false), src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination);
      src.onended = () => { if (MIX.src === src) mixStop(); }; src.start(); MIX.src = src; el.mixstop.disabled = false; el.mixplay.innerHTML = "&#9654; Play again";
      mixSay("Playing your voice with the beat. Nudge the timing below if it feels early or late.");
    } catch (e) { console.warn(e); mixSay("Could not make the preview: " + e.message, true); }
    finally { MIX.busy = false; el.mixplay.disabled = false; }
  }
  async function mixSave(beatOnly) {
    if (MIX.busy) return; MIX.busy = true;
    try {
      if (!current || !current.vocalSketch) { mixSay("Build a beat from your voice first.", true); return; }
      if (!await ensureMixBeat()) return;
      const buf = beatOnly ? MIX.beat : mixBuffer(false), wav = encodeAudioBufferWav(buf, 16), name = exportFileName(current).replace(/\.wav$/, beatOnly ? "" : "-with-voice") + ".wav";
      downloadBlob(wav.blob, name);
      mixSay("Saved " + name + (beatOnly ? "" : " (voice timing " + (MIX.nudge > 0 ? "+" : "") + MIX.nudge + " ms)") + ".");
    } catch (e) { console.warn(e); mixSay("Could not save: " + e.message, true); }
    finally { MIX.busy = false; }
  }
  function nudge(d) { MIX.nudge = Math.max(-500, Math.min(500, MIX.nudge + d)); nudgeLabel(); if (MIX.src && MIX.beat && MIX.forBeat === current) { mixStop(); mixPlay(); } }
  el.mixplay.addEventListener("click", mixPlay); el.mixstop.addEventListener("click", () => { mixStop(); mixSay(""); });
  el.nudgem.addEventListener("click", () => nudge(-10)); el.nudgep.addEventListener("click", () => nudge(10));
  el.voicelvl.addEventListener("change", () => { if (MIX.src) { mixStop(); mixPlay(); } });
  el.mixsave.addEventListener("click", () => mixSave(false)); el.beatsave.addEventListener("click", () => mixSave(true));
  nudgeLabel();

  // ---------- drafts: the takes travel with the beat ----------
  function to16(t) {
    if (!t.pcm16) { const f = t.pcm, a = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = f[i] < -1 ? -1 : f[i] > 1 ? 1 : f[i]; a[i] = v < 0 ? v * 32768 : v * 32767; } t.pcm16 = a; }
    return t.pcm16;
  }
  function packTakes() {
    return {
      v: 2, bpm: S.bpm, genre: el.genre.value, style: el.style.value, feel: S.feel, keyPick: S.keyPick, manualKey: S.manualKey, io: S.io, keepLead: S.keepLead,
      takes: S.takes.filter(t => t.state === "ready").map(t => ({ id: t.id, kind: t.kind, mode: t.mode, bars: t.bars, repeat: t.repeat, bpm: t.bpm, offset: t.offset, imported: t.imported, demo: t.demo, autoOffset: t.autoOffset, name: t.name, pcm16: to16(t) }))
    };
  }
  async function unpackTakes(p) {
    stopAll(); S.takes = []; S.manualKey = null; S.keyInfo = null;
    if (!p || !p.takes || !p.takes.length) { renderTakes(); renderKey(); syncLock(); return; }
    S.bpm = p.bpm; el.bpm.value = p.bpm; S.feel = p.feel || 1; el.feel.value = String(S.feel); S.io = p.io !== false; el.io.checked = S.io; S.keepLead = !!p.keepLead; el.lead.checked = S.keepLead;
    if (p.genre && TEMPLATES[p.genre]) { el.genre.value = p.genre; fillStyles(); if (p.style) { try { el.style.value = p.style; } catch (e) { /* gone */ } } }
    for (const d of p.takes) {
      const f = new Float32Array(d.pcm16.length); for (let i = 0; i < f.length; i++) f[i] = d.pcm16[i] / (d.pcm16[i] < 0 ? 32768 : 32767);
      S.takes.push({ id: S.nextId++, kind: d.kind, mode: d.mode, bars: d.bars, repeat: d.repeat || 1, bpm: d.bpm, offset: d.offset, imported: d.imported, demo: !!d.demo, autoOffset: d.autoOffset, name: d.name || "", pcm: f, pcm16: d.pcm16, dur: f.length / D.SR, state: "analysing" });
    }
    renderTakes();
    for (const t of S.takes) { await analyse(t); if (t.mode === "rap") t.flow = D.flow(t.pcm, t.bpm, t.offset, t.bars); else regrid(t); t.state = "ready"; }
    S.keyPick = p.keyPick || 0; S.manualKey = p.manualKey || null;
    syncLock(); renderTakes(); updateKey();
    say("This draft has " + S.takes.length + " vocal take" + (S.takes.length > 1 ? "s" : "") + ". Open the Sketch tab to hear them.");
  }
  try {
    const BL = window.VLBeatLab;
    if (BL && BL.snapshot && BL.restore) {
      const snap0 = BL.snapshot.bind(BL), rest0 = BL.restore.bind(BL);
      BL.snapshot = function () { const s = snap0(); if (S.takes.some(t => t.state === "ready")) s.vocal = packTakes(); return s; };
      BL.restore = function (s) { const ok = rest0(s); if (ok) unpackTakes(s && s.vocal).catch(e => console.warn("[Vocal Sketch] restore", e)); return ok; };
    }
  } catch (e) { console.warn("[Vocal Sketch] drafts hook", e); }

  syncLock(); renderTakes(); renderKey();
  // a small door for tests and for other tools
  window.VocalSketch = { state: S, _mix: MIX, _mixBuffer: mixBuffer, _placeVoice: placeVoice, _tapNow: (id, x) => { if (S.tap) S.tap.taps.push(x); }, _finishTap: id => { const t = S.takes.find(x => x.id === id); finishTap(t, document.querySelector('.vs-take[data-id="' + id + '"]')); }, setOffset: (id, sec) => { const t = S.takes.find(x => x.id === id); if (t) { t.offset = sec; finishMove(t); } }, addTake, addFromBuffer, build, setBpm, updateKey, packTakes, unpackTakes, demoVoice };
})();
