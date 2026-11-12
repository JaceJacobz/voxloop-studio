/**
 * Voxloop Studio — Studio DAW + mode switch
 *
 * Studio mode: full timeline DAW
 *  - Load a beat
 *  - Add up to 20 vocal lanes (main / adlib / tag / harmony / other)
 *  - Record while the beat plays from the playhead (punch-in anywhere)
 *  - Clips store startOffset so they sit correctly on the timeline
 *  - Send main vocal + beat into Pipeline mode (rendered in place)
 *
 * Pipeline mode: existing upload → align → process flow (unchanged IDs)
 */
(function () {
    "use strict";

    const MAX_LANES = 20;
    const PX_PER_SEC_DESKTOP = 80;
    const PX_PER_SEC_MOBILE = 48;

    let zoom = 1;                                   // pinch / buttons / Ctrl+wheel (editing.js)
    const ZOOM_MIN = 0.15, ZOOM_MAX = 12;
    function pxPerSec() {
        return (window.matchMedia("(max-width: 720px)").matches ? PX_PER_SEC_MOBILE : PX_PER_SEC_DESKTOP) * zoom;
    }
    // "Phone speaker": hear the mix the way a small phone speaker plays it (no low end, a push in the upper mids, mono, a little
    // distortion), so the mix can be judged where many people will listen. Only changes what you hear, never the files.
    let studioOut = null, phoneOn = false;
    function outBus(ctx) {
        if (studioOut && studioOut.context === ctx) return studioOut;
        studioOut = ctx.createGain();
        routeOut();
        return studioOut;
    }
    function routeOut() {
        if (!studioOut) return;
        const ctx = studioOut.context;
        try { studioOut.disconnect(); } catch (_) {}
        if (!phoneOn) { studioOut.connect(ctx.destination); return; }
        const mk = (type, f, q, g) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q || 0.7; if (g != null) n.gain.value = g; return n; };
        const hp1 = mk("highpass", 220, 0.8), hp2 = mk("highpass", 220, 0.8), peak = mk("peaking", 2400, 1.1, 4), lp = mk("lowpass", 8500, 0.7);
        hp1.channelCount = 1; hp1.channelCountMode = "explicit";                           // one small speaker: mono
        const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8); }
        shaper.curve = curve; shaper.oversample = "2x";
        const out = ctx.createGain(); out.gain.value = 0.9;
        studioOut.connect(hp1); hp1.connect(hp2); hp2.connect(peak); peak.connect(shaper); shaper.connect(lp); lp.connect(out); out.connect(ctx.destination);
    }
    function setPhonePreview(on) {
        phoneOn = !!on; routeOut();
        els.trPhone?.classList.toggle("is-on", phoneOn); els.trPhone?.setAttribute("aria-pressed", phoneOn ? "true" : "false");
        status(phoneOn ? "Phone speaker preview on: this is how a small phone speaker plays it." : "Phone speaker preview off");
    }

    let zoomRaf = 0, zoomWant = null;
    // Zoom around a point (a screen x, or the middle of the view): the time under that point stays where it is
    function setZoom(z, clientX) {
        z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
        if (isRecording || Math.abs(z - zoom) < 0.002) return;
        const host = els.lanes, head = document.querySelector(".studio-ruler-head");
        const hw = head ? head.offsetWidth : 0;
        if (host && !zoomWant) {
            const rect = host.getBoundingClientRect();
            const ax = (clientX == null ? rect.left + hw + (host.clientWidth - hw) / 2 : clientX) - rect.left - hw;
            zoomWant = { ax, t: (host.scrollLeft + ax) / pxPerSec() };
        }
        zoom = z;
        if (zoomRaf) return;
        zoomRaf = requestAnimationFrame(() => {
            zoomRaf = 0;
            const w = zoomWant; zoomWant = null;
            renderLanes();
            if (w && els.lanes) { els.lanes.scrollLeft = Math.max(0, w.t * pxPerSec() - w.ax); if (els.rulerScroll) els.rulerScroll.scrollLeft = els.lanes.scrollLeft; }
            updatePlayheadUi();
        });
    }
    const COLORS = {
        melody: "#f59e0b",
        main: "#22d3ee",
        adlib: "#a78bfa",
        tag: "#f472b6",
        harmony: "#34d399",
        other: "#fbbf24",
        beat: "#8b5cf6"
    };

    // Relative level of each lane in the composite sent to Pipeline / mix.
    // All the maths lives in studiolevels.js (measured against how loud the lead SOUNDS, not against the recorded
    // volume). If that file is missing, lanes simply stay as recorded.
    const SL = window.VLStudioLevels || {
        MIX_LEVELS: { keep: { label: "Keep as recorded", blurb: "No level change" }, mute: { label: "Mute", blurb: "Skip this lane" } },
        normalizeMode: (m) => (m === "mute" ? "mute" : "keep"),
        activeLevel: () => ({ db: -120, activeSec: 0 }),
        resolveGain: (a) => (a.mode === "mute" ? { db: null, lin: 0, key: "mute", label: "Mute" } : { db: 0, lin: 1, key: "keep", label: "Keep as recorded" })
    };
    const MIX_LEVELS = SL.MIX_LEVELS;

    const HARMONY_INTERVALS = {
        0: { label: "Off (use take as-is)", degrees: 0 },
        2: { label: "3rd above (in key)", degrees: 2 },
        4: { label: "5th above (in key)", degrees: 4 },
        7: { label: "Octave above", degrees: 7 }
    };

    function defaultMixLevel(type) {
        return "auto";
    }

    // how loud a lane sounds while it is sounding (silence and breaths ignored)
    function laneLevel(lane) {
        const clips = [];
        for (const clip of (lane.clips || [])) if (clip.buffer) clips.push({ data: clip.buffer.getChannelData(0), sr: clip.buffer.sampleRate });
        return SL.activeLevel(clips);
    }

    function findMainLane() {
        const withClips = lanes.filter((l) => l.clips.length);
        const main = withClips.find((l) => l.type === "main");
        return main || withClips[0] || null;
    }

    /** Resolve linear gain for a lane against the lead's measured level. */
    function resolveLaneGain(lane, mainDb) {
        const lvl = laneLevel(lane);
        return SL.resolveGain({
            mode: lane.mixLevel || defaultMixLevel(lane.type),
            type: lane.type,
            laneDb: lvl.db,
            laneActiveSec: lvl.activeSec,
            leadDb: mainDb,
            isLead: lane === findMainLane()
        });
    }

    function mainReferenceDb() {
        const main = findMainLane();
        return main ? laneLevel(main).db : -120;
    }

    let lanes = [];
    let beat = { file: null, buffer: null, name: null, duration: 0 };

    let audioCtx = null;
    let playhead = 0;
    let isPlaying = false;
    let isRecording = false;
    let playStartCtx = 0;
    let playStartOffset = 0;
    let animFrame = null;
    let activeSources = [];

    let mediaStream = null;
    let recEngine = null;          // records the mic and reports exactly when its first sample arrived (see makeRecEngine)
    let recLaneId = null;
    let recStartOffset = 0;        // where in the song the recording was started from
    let recT0 = 0;                 // audio-clock time at which the beat started playing
    let recMic = null;             // what VLMic.open() reported (label, cleanup, wireless)
    let recStarting = false;
    let melody = null;             // the melody written around the vocal (melody.js): one stereo buffer that plays with the beat
    let activeLaneId = null;       // the lane that Paste and Split work on (tap a lane's name, a clip, or arm it)
    function setActiveLane(id) {
        activeLaneId = id;
        document.querySelectorAll(".studio-lane[data-lane-id]").forEach((r) => r.classList.toggle("is-active", r.dataset.laneId === id));
    }
    let scrubbing = false;         // the playhead is being dragged on the ruler
    let lastUserScroll = 0;        // when the person last scrolled the timeline themselves (the view does not fight that)
    let analyser = null;
    let meterRaf = null;
    const S = window.VLSettings;

    const $ = (id) => document.getElementById(id);
    const els = {};

    function cache() {
        els.shell = $("app-shell");
        els.preloader = $("preloader");
        els.modePipeline = $("mode-pipeline");
        els.modeStudio = $("mode-studio");
        els.modeBeatlab = $("mode-beatlab");
        els.modeSettings = $("mode-settings");
        els.modeDrafts = $("mode-drafts");
        els.subtitle = $("mode-subtitle");
        els.lanes = $("studio-lanes");
        els.empty = $("studio-empty");
        els.ruler = $("studio-ruler");
        els.rulerScroll = $("studio-ruler-scroll");
        els.playheadEl = $("studio-playhead");
        els.beatInput = $("studio-beat-input");
        els.beatName = $("studio-beat-name");
        els.loadBeat = $("studio-load-beat");
        els.addLane = $("studio-add-lane");
        els.laneType = $("studio-lane-type");
        els.importAudio = $("studio-import-audio");
        els.importInput = $("studio-import-input");
        els.toPipeline = $("studio-to-pipeline");
        els.trPlay = $("tr-play");
        els.trStop = $("tr-stop");
        els.trRecord = $("tr-record");
        els.trScrub = $("tr-scrub");
        els.trCur = $("tr-time-current");
        els.trTot = $("tr-time-total");
        els.trLoop = $("tr-loop");
        els.trSettings = $("tr-settings");
        els.trPhone = $("tr-phone");
        els.trStatus = $("tr-status");
        els.trMeter = $("tr-meter-fill");
        els.trackCount = $("track-count-label");
        els.roleVocal = $("role-vocal-chip");
        els.roleBeat = $("role-beat-chip");
        els.vocalInput = $("vocal-input");
        els.beatFileInput = $("beat-input");
        els.vocalFileName = $("vocal-file-name");
        els.beatFileName = $("beat-file-name");
    }

    function uid() {
        return Math.random().toString(36).slice(2, 9);
    }

    function fmt(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return m + ":" + s.toFixed(1).padStart(4, "0");
    }

    function status(msg) {
        if (els.trStatus) els.trStatus.textContent = msg;
    }

    function ensureCtx() {
        if (!audioCtx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            try { audioCtx = new Ctor({ latencyHint: "interactive" }); } catch (e) { audioCtx = new Ctor(); }   // smallest buffer: the beat and the mic stay close together
        }
        if (audioCtx.state === "suspended") audioCtx.resume();
        return audioCtx;
    }

    function totalDuration() {
        let d = beat.duration || 0;
        lanes.forEach((lane) => {
            lane.clips.forEach((c) => {
                d = Math.max(d, c.start + c.duration);
            });
        });
        if (isRecording) d = Math.max(d, playhead + 12);     // keep the ruler ahead of you while recording
        return Math.max(d, 30);
    }

    function timelineWidth() {
        return Math.ceil(totalDuration() * pxPerSec()) + 200;
    }

    function assignFile(input, file, nameEl) {
        if (!input || !file) return;
        try {
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            if (nameEl) nameEl.textContent = file.name;
        } catch (e) {
            console.warn(e);
        }
    }

    function hidePreloader() {
        if (!els.preloader) return;
        els.preloader.classList.add("is-done");
        els.shell?.classList.remove("is-booting");
        setTimeout(() => els.preloader?.remove(), 400);
    }

    function setMode(mode) {
        if (![ "studio", "beatlab", "pipeline", "settings", "drafts" ].includes(mode)) mode = "pipeline";
        const isStudio = mode === "studio";
        const isBeatlab = mode === "beatlab";
        const isSettings = mode === "settings";
        const isDrafts = mode === "drafts";
        const isPipeline = mode === "pipeline";

        els.shell?.classList.toggle("mode-studio", isStudio);
        els.shell?.classList.toggle("mode-pipeline", isPipeline);
        els.shell?.classList.toggle("mode-beatlab", isBeatlab);
        els.shell?.classList.toggle("mode-settings", isSettings);
        els.shell?.classList.toggle("mode-drafts", isDrafts);
        els.modeDrafts?.classList.toggle("hidden", !isDrafts);
        els.modeDrafts?.setAttribute("aria-hidden", isDrafts ? "false" : "true");

        els.modePipeline?.classList.toggle("hidden", !isPipeline);
        els.modeStudio?.classList.toggle("hidden", !isStudio);
        els.modeBeatlab?.classList.toggle("hidden", !isBeatlab);
        els.modeSettings?.classList.toggle("hidden", !isSettings);
        els.modePipeline?.setAttribute("aria-hidden", isPipeline ? "false" : "true");
        els.modeStudio?.setAttribute("aria-hidden", isStudio ? "false" : "true");
        els.modeBeatlab?.setAttribute("aria-hidden", isBeatlab ? "false" : "true");
        els.modeSettings?.setAttribute("aria-hidden", isSettings ? "false" : "true");

        document.querySelectorAll(".mode-btn").forEach((btn) => {
            const on = btn.dataset.mode === mode;
            btn.classList.toggle("is-active", on);
            btn.setAttribute("aria-selected", on ? "true" : "false");
        });

        if (els.subtitle) {
            els.subtitle.textContent = isStudio
                ? "Record · multi-lane · punch-in anywhere"
                : isBeatlab
                ? "Generate · arrange · mix · send to vocals"
                : isSettings
                ? "Microphone · count-in · timing"
                : isDrafts
                ? "Beats and songs saved to finish later"
                : "Upload → align → correct → mix → master";
        }

        if (isStudio) {
            renderLanes();
            drawRuler();
            updatePlayheadUi();
        }
        // Pause Beat Lab audio when leaving that mode
        if (!isBeatlab && window.VoxloopBeatLab && typeof window.VoxloopBeatLab.pause === "function") {
            try { window.VoxloopBeatLab.pause(); } catch (e) {}
        }
        window.dispatchEvent(new CustomEvent("vl-mode", { detail: { mode } }));
        try {
            if (mode !== "settings" && mode !== "drafts") localStorage.setItem("vl-last-screen", mode);   // reopen on the last working tab, not on Settings
        } catch (_) {}
    }

    async function loadBeatFile(file) {
        if (!file) return;
        const ctx = ensureCtx();
        try {
            const ab = await file.arrayBuffer();
            const buffer = await ctx.decodeAudioData(ab.slice(0));
            melody = null;
            beat = { file, buffer, name: file.name, duration: buffer.duration, bpm: 0 };
            if (els.beatName) els.beatName.textContent = file.name;
            assignFile(els.beatFileInput, file, els.beatFileName);
            refreshRoles();
            drawRuler();
            updateTotals();
            status("Beat loaded");
            renderLanes();
            listenToBeat();
        } catch (e) {
            console.warn(e);
            status("Could not decode beat");
        }
    }

    function loadBeatBuffer(buffer, name, bpm, key, noMelody, engineInfo, swingAmt) {
        if (!buffer) return;
        ensureCtx();
        melody = null;                                              // a melody belongs to the beat it was written for
        beat = { file: null, buffer, name: name || "Beat Lab", duration: buffer.duration, bpm: bpm > 0 ? bpm : 0, noMelody: noMelody === true, engine: engineInfo || null, swing: typeof swingAmt === "number" ? swingAmt : null };
        if (els.beatName) els.beatName.textContent = beat.name;
        refreshRoles();
        drawRuler();
        updateTotals();
        status("Beat Lab instrumental loaded");
        renderLanes();
        listenToBeat(key);
    }

    function setMelody(m) {
        melody = m && m.buffer ? m : null;
        renderLanes(); updateTotals();
        if (isPlaying) scheduleFrom(playhead);
    }

    // ---------- Drafts: the whole Studio project as plain data, and back ----------
    // Audio stays as AudioBuffers here; drafts.js turns them into compact PCM for storage.
    function snapshotProject() {
        const plain = (o, skip) => { const r = {}; Object.keys(o).forEach((k) => { const v = o[k]; if (skip.includes(k) || typeof v === "function" || v instanceof Blob || (typeof AudioBuffer !== "undefined" && v instanceof AudioBuffer)) return; r[k] = v; }); return r; };
        const ap = window.VLStudioAutopilot;
        return {
            beat: beat.buffer ? { buffer: beat.buffer, name: beat.name, bpm: beat.bpm || 0, keyLabel: beat.info && beat.info.key ? beat.info.key.label : (beat.key && beat.key.label) || null, noMelody: beat.noMelody === true, corrected: !!(beat.info && beat.info.source && (beat.info.source.bpm === "set by you" || beat.info.source.key === "set by you")) } : null,
            lanes: lanes.map((l) => Object.assign(plain(l, ["clips", "armed"]), {
                clips: l.clips.map((c) => Object.assign(plain(c, ["buffer", "file", "blob", "fxHistory"]), { buffer: c.buffer, produced: !!(ap && ap.isDone && ap.isDone(c)) }))
            })),
            melody: melody && melody.buffer ? { buffer: melody.buffer, on: melody.on !== false, seed: melody.seed, opts: melody.opts, report: melody.report, notes: melody.notes } : null,
            playhead, zoom
        };
    }
    function restoreProject(p) {
        stopSources(); isPlaying = false; isRecording = false; els.trPlay?.classList.remove("is-active");
        if (p.beat && p.beat.buffer) {
            beat = { file: null, buffer: p.beat.buffer, name: p.beat.name, duration: p.beat.buffer.duration, bpm: p.beat.bpm || 0, noMelody: p.beat.noMelody === true };
            if (els.beatName) els.beatName.textContent = p.beat.name || "Beat";
        } else beat = { file: null, buffer: null, name: "", duration: 0, bpm: 0 };
        melody = p.melody && p.melody.buffer ? Object.assign({}, p.melody) : null;
        lanes.length = 0;
        const ap = window.VLStudioAutopilot;
        (p.lanes || []).forEach((l) => {
            const lane = Object.assign({}, l, { armed: false, clips: [] });
            (l.clips || []).forEach((c) => {
                const clip = Object.assign({}, c); delete clip.produced;
                const wav = audioBufferToWav(clip.buffer);
                clip.file = new File([wav], (lane.name || "lane").replace(/\s+/g, "_") + "_" + (clip.name || "take").replace(/\s+/g, "_") + ".wav", { type: "audio/wav" });
                clip.blob = clip.file;
                lane.clips.push(clip);
                if (c.produced && ap && ap.markDone) ap.markDone(clip);
            });
            lanes.push(lane);
        });
        if (lanes[0]) lanes[0].armed = true;
        zoom = p.zoom > 0 ? p.zoom : 1;
        playhead = p.playhead > 0 ? p.playhead : 0;
        activeLaneId = lanes[0] ? lanes[0].id : null;
        renderLanes(); updateTotals(); updateCount(); refreshRoles(); updatePlayheadUi();
        if (beat.buffer) {
            listenToBeat(p.beat && p.beat.keyLabel);
            if (p.beat && p.beat.corrected) { const wait = setInterval(() => { if (beat.info) { clearInterval(wait); setBeatInfo(p.beat.bpm, p.beat.keyLabel); } }, 300); setTimeout(() => clearInterval(wait), 20000); }
        }
        status("Draft opened");
    }

    // Works out the beat's tempo, key, style and sections (the same read Autopilot decides from) as soon as a beat is loaded.
    // A Beat Lab beat already knows its tempo and key, so it is not guessed again. The result is kept on `beat` and shown in the
    // chip next to the beat's name, where it can be corrected.
    let listenToken = 0;
    function listenToBeat(knownKey) {
        const b = beat, token = ++listenToken;
        b.info = null; b.listening = true;
        window.VLStudioKnownBeat = b.bpm > 0 || knownKey ? { buffer: b.buffer, bpm: b.bpm, key: knownKey || null } : null;
        window.dispatchEvent(new CustomEvent("vl-beat-info", { detail: { state: "listening" } }));
        setTimeout(async () => {
            let info = null;
            try { info = window.VLBrain ? await window.VLBrain.analyzeBeat(b.buffer) : null; } catch (e) { console.warn("beat analysis", e); }
            if (token !== listenToken || beat !== b) return;           // another beat was loaded meanwhile
            b.listening = false; b.info = info;
            if (info && info.bpm > 30) b.bpm = info.bpm;
            if (info && info.key) b.key = info.key;
            drawRuler(); updatePlayheadUi();
            window.dispatchEvent(new CustomEvent("vl-beat-info", { detail: { state: "ready", info } }));
            if (info && info.bpm) status("Beat: " + Math.round(info.bpm) + " BPM" + (info.key ? " · " + info.key.label : ""));
        }, 80);
    }
    // the person corrected the tempo or key (editing.js): Autopilot reads the same object, so it decides from the corrected values
    function setBeatInfo(bpm, keyLabel) {
        const info = beat.info; if (!info) return false;
        if (bpm > 30 && bpm < 300) { info.bpm = bpm; beat.bpm = bpm; info.source = Object.assign({}, info.source, { bpm: "set by you" }); delete info.tempoNote; }
        if (keyLabel && window.VLBrain && window.VLBrain.parseKey) {
            const k = window.VLBrain.parseKey(keyLabel);
            if (k) { k.refCents = (info.key && info.key.refCents) || 0; info.key = k; beat.key = k; info.source = Object.assign({}, info.source, { key: "set by you" }); }
        }
        drawRuler(); updatePlayheadUi();
        window.dispatchEvent(new CustomEvent("vl-beat-info", { detail: { state: "ready", info } }));
        return true;
    }

    window.addEventListener("vl-set-beat-studio", (ev) => {
        const d = ev.detail || {};
        if (d.buffer) loadBeatBuffer(d.buffer, d.name, d.bpm, d.key, d.noMelody, d.engine, d.swing);
    });

    async function importAudioFiles(fileList) {
        const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.indexOf("audio") === 0);
        // Some browsers omit type for .wav — still try by extension
        const more = Array.from(fileList || []).filter((f) => {
            if (!f || files.indexOf(f) >= 0) return false;
            return /\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i.test(f.name || "");
        });
        const all = files.concat(more);
        if (!all.length) {
            status("No audio files selected");
            return;
        }

        const ctx = ensureCtx();
        let target = lanes.find((l) => l.armed);
        // If nothing armed, create a lane matching the toolbar type
        if (!target) {
            addLane(els.laneType?.value || "main");
            target = lanes.find((l) => l.armed) || lanes[lanes.length - 1];
        }

        let placed = 0;
        for (let i = 0; i < all.length; i++) {
            const file = all[i];
            // First file goes on the armed lane; extra files each get their own lane
            let lane = target;
            if (i > 0) {
                addLane(els.laneType?.value || target.type || "main");
                lane = lanes.find((l) => l.armed) || lanes[lanes.length - 1];
            }
            if (!lane) continue;

            try {
                status("Importing " + file.name + "…");
                const ab = await file.arrayBuffer();
                const buffer = await ctx.decodeAudioData(ab.slice(0));
                const start = playhead; // land at playhead so you can place adlibs mid-song
                const takeNum = lane.clips.length + 1;
                lane.clips.push({
                    id: uid(),
                    name: file.name.replace(/\.[^.]+$/, "") || ("Import " + takeNum),
                    blob: file,
                    file,
                    buffer,
                    start,
                    duration: buffer.duration
                });
                placed++;
            } catch (e) {
                console.warn("import failed", file.name, e);
                status("Could not decode " + file.name);
            }
        }

        renderLanes();
        updateTotals();
        refreshRoles();
        if (placed) {
            status("Imported " + placed + " file(s) @ " + fmt(playhead) + " — set Mix level, then Send to Pipeline");
        }
    }

    function addLane(type) {
        if (lanes.length >= MAX_LANES) {
            status("Max " + MAX_LANES + " lanes");
            return;
        }
        type = type || els.laneType?.value || "main";
        const labels = { main: "Main vocal", adlib: "Adlib", tag: "Tag", harmony: "Harmony", other: "Other" };
        const count = lanes.filter((l) => l.type === type).length + 1;
        const lane = {
            id: uid(),
            name: labels[type] + (count > 1 ? " " + count : ""),
            type,
            color: COLORS[type] || COLORS.other,
            clips: [],
            armed: true,
            muted: false,
            mixLevel: defaultMixLevel(type),
            harmonyDegrees: type === "harmony" ? 2 : 0
        };
        lanes.forEach((l) => (l.armed = false));
        lanes.push(lane);
        renderLanes();
        updateCount();
        status("Added " + lane.name);
    }

    function removeLane(id) {
        lanes = lanes.filter((l) => l.id !== id);
        renderLanes();
        updateCount();
        updateTotals();
    }

    function armLane(id) {
        lanes.forEach((l) => (l.armed = l.id === id));
        activeLaneId = id;
        renderLanes();
    }

    function renameLane(id, name) {
        const l = lanes.find((x) => x.id === id);
        if (l && name.trim()) {
            l.name = name.trim();
            renderLanes();
        }
    }

    function setMixLevel(id, level) {
        const l = lanes.find((x) => x.id === id);
        level = SL.normalizeMode(level);
        if (!l || !MIX_LEVELS[level]) return;
        l.mixLevel = level;
        renderLanes();
        if (level === "mute") { status(l.name + " → Mute (skipped in mix)"); return; }
        const g = resolveLaneGain(l, mainReferenceDb());
        status(l.name + " → " + g.label);
    }

    function setHarmonyDegrees(id, degrees) {
        const l = lanes.find((x) => x.id === id);
        if (!l) return;
        const d = parseInt(degrees, 10) || 0;
        l.harmonyDegrees = d;
        renderLanes();
        const meta = HARMONY_INTERVALS[d] || HARMONY_INTERVALS[0];
        status(l.name + " harmony: " + meta.label + (d ? " — builds on Send to Pipeline" : ""));
    }

    function renderLanes() {
        if (!els.lanes) return;
        const keepL = els.lanes.scrollLeft, keepT = els.lanes.scrollTop;       // a rebuild must not throw the view back to the start
        els.lanes.innerHTML = "";
        const w = timelineWidth();

        if (els.empty) {
            els.empty.classList.toggle("hidden", lanes.length > 0 || !!beat.buffer);
        }

        if (beat.buffer) {
            const row = document.createElement("div");
            row.className = "studio-lane studio-lane-beat";
            row.innerHTML =
                '<div class="studio-lane-head">' +
                '<span class="lane-color" style="background:' + COLORS.beat + '"></span>' +
                '<div class="lane-meta"><strong>Beat</strong><small>' + escapeHtml(beat.name || "") + "</small></div>" +
                "</div><div class=\"studio-lane-track\"></div>";
            const track = row.querySelector(".studio-lane-track");
            track.style.minWidth = w + "px";
            const clip = document.createElement("div");
            clip.className = "studio-clip beat-clip";
            clip.style.left = "0px";
            clip.style.width = Math.max(4, beat.duration * pxPerSec()) + "px";
            clip.style.background = COLORS.beat;
            clip.innerHTML = "<span>" + escapeHtml(beat.name || "Beat") + "</span>";
            track.appendChild(clip);
            els.lanes.appendChild(row);
            drawClipWave(clip, beat.buffer);
        }

        if (melody && melody.buffer) {
            const row = document.createElement("div");
            row.className = "studio-lane studio-lane-melody" + (melody.on ? "" : " is-off");
            row.innerHTML =
                '<div class="studio-lane-head">' +
                '<span class="lane-color" style="background:' + COLORS.melody + '"></span>' +
                '<div class="lane-meta"><strong>Melody</strong><small>Trumpet · fits your vocal</small></div>' +
                '<div class="lane-btns"><button type="button" class="lane-btn' + (melody.on ? " is-on" : "") + '" data-mel="toggle" title="' + (melody.on ? "Hide the melody" : "Play the melody") + '" aria-label="Melody on or off">' + (melody.on ? "♪" : "–") + '</button>' +
                '<button type="button" class="lane-btn" data-mel="remove" title="Remove the melody" aria-label="Remove the melody">×</button></div>' +
                "</div><div class=\"studio-lane-track\"></div>";
            const track = row.querySelector(".studio-lane-track");
            track.style.minWidth = w + "px";
            const clip = document.createElement("div");
            clip.className = "studio-clip melody-clip";
            clip.style.left = "0px";
            clip.style.width = Math.max(4, melody.buffer.duration * pxPerSec()) + "px";
            clip.style.background = COLORS.melody;
            track.appendChild(clip);
            els.lanes.appendChild(row);
            drawClipWave(clip, melody.buffer);
            row.querySelector('[data-mel="toggle"]').addEventListener("click", () => { if (window.VLMelody) window.VLMelody.toggle(); });
            row.querySelector('[data-mel="remove"]').addEventListener("click", () => { if (window.VLMelody) window.VLMelody.remove(); });
        }

        lanes.forEach((lane) => {
            const row = document.createElement("div");
            row.className = "studio-lane" + (lane.armed ? " is-armed" : "") + (lane.id === activeLaneId ? " is-active" : "");
            row.dataset.laneId = lane.id;
            const level = SL.normalizeMode(lane.mixLevel || defaultMixLevel(lane.type));
            let levelOpts = "";
            for (const key of Object.keys(MIX_LEVELS)) {
                const m = MIX_LEVELS[key];
                levelOpts += '<option value="' + key + '"' + (key === level ? " selected" : "") + ">" + m.label + "</option>";
            }
            let autoHint = "";
            if (level !== "mute" && lane.clips.length) {
                const g = resolveLaneGain(lane, mainReferenceDb());
                if (g.db != null) {
                    autoHint = '<small class="lane-auto-hint">' +
                        (g.noReference ? "No lead to compare with" : (level === "keep" || g.db === 0 ? "As recorded" : ((g.db > 0 ? "+" : "−") + Math.abs(g.db).toFixed(1) + " dB vs recorded"))) +
                        "</small>";
                }
            }
            let harmHtml = "";
            if (lane.type === "harmony") {
                const deg = lane.harmonyDegrees != null ? lane.harmonyDegrees : 2;
                let hOpts = "";
                for (const k of Object.keys(HARMONY_INTERVALS)) {
                    const m = HARMONY_INTERVALS[k];
                    hOpts += '<option value="' + k + '"' + (String(deg) === String(k) ? " selected" : "") + ">" + m.label + "</option>";
                }
                harmHtml =
                    '<div class="lane-harmony-wrap" title="Optional: build a harmony in the song key">' +
                    '<label class="lane-level-label">Harmony</label>' +
                    '<select class="lane-harmony-select" data-act="harmony">' + hOpts + "</select>" +
                    "</div>";
            }
            row.innerHTML =
                '<div class="studio-lane-head">' +
                '<span class="lane-color" style="background:' + lane.color + '"></span>' +
                '<div class="lane-meta">' +
                '<input class="lane-name-input" value="' + escapeAttr(lane.name) + '">' +
                "<small>" + lane.type + (lane.armed ? " · armed" : "") + "</small>" +
                '</div>' +
                '<div class="lane-level-wrap" title="' + escapeAttr(MIX_LEVELS[level].blurb) + '">' +
                '<label class="lane-level-label">Mix</label>' +
                '<select class="lane-level-select" data-act="level" aria-label="Mix level for ' + escapeAttr(lane.name) + '">' +
                levelOpts +
                "</select>" +
                autoHint +
                harmHtml +
                "</div>" +
                '<div class="lane-btns">' +
                '<button type="button" class="lane-btn' + (lane.armed ? " is-on" : "") + '" data-act="arm" title="Arm for record" aria-label="Arm for record">' + (window.VLI ? VLI("record", 14) : "R") + '</button>' +
                '<button type="button" class="lane-btn" data-act="del" title="Delete lane" aria-label="Delete lane">' + (window.VLI ? VLI("trash", 15) : "×") + '</button>' +
                "</div></div>" +
                '<div class="studio-lane-track"></div>';

            const track = row.querySelector(".studio-lane-track");
            track.style.minWidth = w + "px";

            // clips that overlap (a pasted copy on top of the original) sit in rows, so both stay visible and both play
            const rowEnd = [], rowOf = new Map();
            lane.clips.slice().sort((a, b) => a.start - b.start).forEach((c) => {
                let r = 0; while (r < rowEnd.length && rowEnd[r] > c.start + 0.005) r++;
                rowEnd[r] = c.start + c.duration; rowOf.set(c, r);
            });
            const rowsN = Math.min(3, Math.max(1, rowEnd.length));
            if (rowsN > 1) track.style.minHeight = (40 * rowsN + 16) + "px";
            lane.clips.forEach((c) => {
                const el = document.createElement("div");
                el.className = "studio-clip";
                if (rowsN > 1) { const r = Math.min(rowsN - 1, rowOf.get(c) || 0), hh = 40; el.style.top = (8 + r * hh) + "px"; el.style.bottom = "auto"; el.style.height = (hh - 4) + "px"; el.classList.add("is-layered"); }
                el.style.left = c.start * pxPerSec() + "px";
                el.style.width = Math.max(4, c.duration * pxPerSec()) + "px";
                el.style.background = lane.color;
                el.dataset.clipId = c.id;
                el.dataset.laneId = lane.id;
                el.innerHTML = "<span>" + escapeHtml(c.name) + "</span>";
                el.title = c.name + " @ " + fmt(c.start);
                track.appendChild(el);
                if (c.buffer) drawClipWave(el, c.buffer);
            });

            row.querySelector('[data-act="arm"]').addEventListener("click", () => armLane(lane.id));
            row.querySelector(".studio-lane-head").addEventListener("click", (e) => { if (!e.target.closest("button,select,input")) setActiveLane(lane.id); });
            row.querySelector('[data-act="del"]').addEventListener("click", () => {
                (async function () {
                    const ok = window.VLModal
                        ? await window.VLModal.confirm(
                            "Delete lane \u201c" + lane.name + "\u201d? This cannot be undone.",
                            "Delete lane"
                        )
                        : true;
                    if (ok) removeLane(lane.id);
                })();
            });
            row.querySelector(".lane-name-input").addEventListener("change", (e) => {
                renameLane(lane.id, e.target.value);
            });
            const levelSel = row.querySelector('[data-act="level"]');
            if (levelSel) {
                levelSel.addEventListener("change", (e) => setMixLevel(lane.id, e.target.value));
                levelSel.addEventListener("click", (e) => e.stopPropagation());
            }
            const harmSel = row.querySelector('[data-act="harmony"]');
            if (harmSel) {
                harmSel.addEventListener("change", (e) => setHarmonyDegrees(lane.id, e.target.value));
                harmSel.addEventListener("click", (e) => e.stopPropagation());
            }

            track.addEventListener("click", (e) => {
                if (isRecording) return;
                setActiveLane(lane.id);
                if (e.target.closest(".studio-clip")) return;
                const scrollHost = track.closest(".studio-lanes") || track;
                // position relative to track content
                const rect = track.getBoundingClientRect();
                // tracks don't scroll individually - parent studio-timeline may
                const x = e.clientX - rect.left;
                playhead = snapTime(x / pxPerSec());
                if (isPlaying) scheduleFrom(playhead);
                updatePlayheadUi();
            });

            els.lanes.appendChild(row);
        });

        drawRuler();
        placePlayhead();
        els.lanes.scrollLeft = keepL; els.lanes.scrollTop = keepT;
        if (els.rulerScroll) els.rulerScroll.scrollLeft = keepL;
        if (window.VLRack && window.VLRack.afterRender) window.VLRack.afterRender();   // FX Rack: redraw selection + fx badges
        if (window.VLAuto) window.VLAuto.afterRender();                                  // volume automation rows (before the playhead line is sized)
        if (window.VLStudioUI) window.VLStudioUI.afterRender();                          // playhead line, live clip
    }

    function drawClipWave(clipEl, buffer) {
        try {
            const STEP = 4, BAR = 3, FLOOR = -54, H = 72, TILE = 2048;
            const cssW = Math.max(2, parseFloat(clipEl.style.width) || 100);
            const data = buffer.getChannelData(0);
            const totalBars = Math.max(1, Math.floor(cssW / STEP));
            const per = Math.max(1, Math.floor(data.length / totalBars));
            const mid = H / 2;
            // tiles of at most 2048 px, so a zoomed-in clip never needs one huge canvas (phones refuse those)
            for (let b0 = 0; b0 < totalBars; b0 += TILE / STEP) {
                const nb = Math.min(TILE / STEP, totalBars - b0);
                const canvas = document.createElement("canvas");
                canvas.width = nb * STEP; canvas.height = H;
                canvas.className = "clip-wave";
                canvas.style.left = (b0 * STEP) + "px";
                canvas.style.width = (b0 + nb >= totalBars ? Math.max(2, cssW - b0 * STEP) : nb * STEP) + "px";
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "rgba(0,0,0,0.22)";
                ctx.fillRect(0, 0, canvas.width, H);
                ctx.fillStyle = "rgba(255,255,255,0.14)";
                ctx.fillRect(0, mid - 0.5, canvas.width, 1);
                ctx.fillStyle = "rgba(255,255,255,0.88)";
                for (let k = 0; k < nb; k++) {
                    // peak of this slice, drawn on a dB scale so quiet and loud parts both read clearly
                    let pk = 0;
                    const start = (b0 + k) * per, end = Math.min(data.length, start + per);
                    for (let i = start; i < end; i += 2) {
                        const v = Math.abs(data[i]);
                        if (v > pk) pk = v;
                    }
                    const db = pk > 1e-5 ? 20 * Math.log10(pk) : -90;
                    const h = Math.max(2, Math.min(1, Math.max(0, (db - FLOOR) / -FLOOR)) * (H - 10));
                    const x = k * STEP, y = mid - h / 2;
                    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, BAR, h, 1.5); ctx.fill(); }
                    else ctx.fillRect(x, y, BAR, h);
                }
                clipEl.appendChild(canvas);
            }
        } catch (_) {}
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function escapeAttr(s) {
        return escapeHtml(s).replace(/"/g, "&quot;");
    }

    // The timeline grid: bars and beats when the tempo is known (a Beat Lab beat), seconds otherwise.
    function gridInfo() {
        const bpm = beat.bpm > 0 ? beat.bpm : 0;
        if (!bpm) return null;
        const beatSec = 60 / bpm, pps = pxPerSec();
        return { bpm, beatSec, barSec: beatSec * 4, beatPx: beatSec * pps, barPx: beatSec * 4 * pps };
    }

    function drawRuler() {
        const canvas = els.ruler;
        if (!canvas) return;
        const H = 30;
        const w = timelineWidth();
        const dpr = window.devicePixelRatio || 1;
        const pps = pxPerSec();
        const dur = totalDuration();
        canvas.style.width = w + "px";
        canvas.style.height = H + "px";
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(H * dpr);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, H);
        ctx.font = "600 10px Inter, system-ui, sans-serif";
        ctx.textBaseline = "top";
        const line = (x, y0, color) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke(); };
        const g = gridInfo();
        let major, minor;                                 // distance between grid lines in px (for the lanes behind)
        if (g) {
            // bars: a number on every bar (or every 2nd / 4th / 8th when zoomed out); beats: small ticks
            let every = 1;
            while (g.barPx * every < 30) every *= 2;
            const bars = Math.ceil(dur / g.barSec) + 1;
            for (let b = 0; b <= bars; b++) {
                const x = b * g.barPx;
                if (b % every === 0) {
                    line(x, 6, "#4a4a58");
                    ctx.fillStyle = "#a6a6b6";
                    ctx.fillText(String(b + 1), x + 4, 4);
                } else line(x, 18, "#34343f");
                if (g.beatPx >= 9) for (let k = 1; k < 4; k++) line(x + k * g.beatPx, 22, "#2c2c36");
            }
            major = g.barPx; minor = g.beatPx >= 9 ? g.beatPx : g.barPx;
        } else {
            const steps = [1, 2, 5, 10, 15, 30, 60];
            const step = steps.find((s) => s * pps >= 64) || 60;
            const sub = step === 1 ? 4 : step === 15 ? 3 : step === 30 || step === 60 ? 6 : step === 2 ? 2 : 5;
            for (let s = 0; s <= dur + step; s += step) {
                const x = s * pps;
                line(x, 6, "#4a4a58");
                ctx.fillStyle = "#a6a6b6";
                ctx.fillText(fmt(s).replace(/\.0$/, ""), x + 4, 4);
                for (let k = 1; k < sub; k++) line(x + (k * step * pps) / sub, 22, "#2c2c36");
            }
            major = step * pps; minor = (step * pps) / sub;
        }
        // the lanes draw the same grid behind the clips (see .studio-lane-track in the CSS)
        if (els.lanes) { els.lanes.style.setProperty("--gmaj", major + "px"); els.lanes.style.setProperty("--gmin", minor + "px"); }
    }

    // One playhead for the ruler and every lane. It sits in a layer over the timeline and is placed from the
    // playhead time and the scroll position in the same step, so it can never drift from the clips.
    function placePlayhead() {
        const ph = els.playheadEl;
        if (!ph) return;
        const x = playhead * pxPerSec() - (els.lanes ? els.lanes.scrollLeft : 0);
        ph.style.transform = "translateX(" + x + "px)";
        ph.dataset.time = fmt(playhead);
        if (scrubbing) { const chip = ph.querySelector(".ph-time"); if (chip) chip.textContent = fmt(playhead); }
        ph.classList.toggle("is-armed", !isPlaying && !isRecording && lanes.some((l) => l.armed));   // red = recording starts here
        ph.classList.toggle("is-rec", isRecording);
        ph.classList.toggle("is-dragging", scrubbing);
    }

    function updatePlayheadUi() {
        placePlayhead();
        if (els.trCur) els.trCur.textContent = fmt(playhead);
        const dur = totalDuration();
        if (els.trTot) els.trTot.textContent = fmt(beat.duration || dur);
        if (els.trScrub && dur > 0) {
            els.trScrub.max = Math.max(1, Math.floor(dur * 1000));
            els.trScrub.value = Math.floor(playhead * 1000);
        }
    }

    // While playing or recording the view turns the page when the playhead reaches the right edge
    function followPlayhead() {
        const host = els.lanes;
        if (!host || scrubbing || Date.now() - lastUserScroll < 1800) return;
        const head = document.querySelector(".studio-ruler-head");
        const view = host.clientWidth - (head ? head.offsetWidth : 0);
        if (view <= 0) return;
        const x = playhead * pxPerSec() - host.scrollLeft;
        if (x > view * 0.9 || x < 0) host.scrollLeft = Math.max(0, playhead * pxPerSec() - view * 0.12);
    }

    // The playhead snaps to the nearest beat when the tempo is known (punch in on the beat, like any DAW)
    function snapTime(t) {
        t = Math.max(0, t);
        const g = gridInfo();
        return g ? Math.round(t / g.beatSec) * g.beatSec : t;
    }

    function updateTotals() {
        updatePlayheadUi();
        drawRuler();
    }

    function updateCount() {
        if (els.trackCount) els.trackCount.textContent = lanes.length + " / " + MAX_LANES;
    }

    function refreshRoles() {
        let vocalClip = null;
        const mainLane = lanes.find((l) => l.type === "main" && l.clips.length);
        const anyLane = lanes.find((l) => l.clips.length);
        const lane = mainLane || anyLane;
        if (lane) vocalClip = lane.clips[lane.clips.length - 1];
        if (els.roleVocal) els.roleVocal.textContent = "Vocal: " + (vocalClip ? vocalClip.name : "—");
        if (els.roleBeat) els.roleBeat.textContent = "Beat: " + (beat.name || "—");
    }

    let activeGains = [];   // gain nodes of the playing clips, so volume automation can be edited while the song plays

    function stopSources() {
        activeSources.forEach((s) => {
            try { s.stop(); } catch (_) {}
        });
        activeSources = [];
        activeGains = [];
    }

    // Re-draw the volume curve onto the clips that are playing right now (called by automation.js while you edit)
    function refreshAutomation() {
        if (!isPlaying || !audioCtx || !window.VLAuto) return;
        const nowT = playStartOffset + (audioCtx.currentTime - playStartCtx);
        const ct = audioCtx.currentTime;
        activeGains.forEach((a) => {
            const clipEnd = a.clip.start + a.clip.duration;
            if (nowT >= clipEnd) return;
            try { a.param.cancelScheduledValues(ct); } catch (_) {}
            const tFrom = Math.max(nowT, a.clip.start);
            window.VLAuto.schedule(a.param, a.lane, a.base, tFrom, clipEnd, ct + (tFrom - nowT));
        });
    }

    function scheduleFrom(offset, gainValue, delaySec) {
        const ctx = ensureCtx();
        stopSources();
        const startAt = ctx.currentTime + (delaySec > 0 ? delaySec : 0);      // a delay lets a count-in play first
        const g = gainValue == null ? 1 : gainValue;

        if (beat.buffer && offset < beat.buffer.duration) {
            const src = ctx.createBufferSource();
            src.buffer = beat.buffer;
            const gain = ctx.createGain();
            gain.gain.value = g;
            src.connect(gain);
            gain.connect(outBus(ctx));
            src.start(startAt, offset);
            activeSources.push(src);
        }
        if (melody && melody.on && melody.buffer && offset < melody.buffer.duration) {
            const ms = ctx.createBufferSource();
            ms.buffer = melody.buffer;
            const mg = ctx.createGain();
            mg.gain.value = g;
            ms.connect(mg); mg.connect(outBus(ctx));
            ms.start(startAt, offset);
            activeSources.push(ms);
        }

        const mainDb = mainReferenceDb();
        lanes.forEach((lane) => {
            if (lane.muted) return;
            const resolved = resolveLaneGain(lane, mainDb);
            if (resolved.key === "mute" || resolved.lin <= 0) return;
            const levelLin = resolved.lin;
            lane.clips.forEach((clip) => {
                if (!clip.buffer) return;
                const clipEnd = clip.start + clip.duration;
                if (offset >= clipEnd) return;

                const src = ctx.createBufferSource();
                src.buffer = clip.buffer;
                const gain = ctx.createGain();
                gain.gain.value = g * levelLin;
                src.connect(gain);
                gain.connect(outBus(ctx));
                if (window.VLAuto && window.VLAuto.has(lane)) {
                    const tFrom = Math.max(offset, clip.start);
                    window.VLAuto.schedule(gain.gain, lane, g * levelLin, tFrom, clipEnd, startAt + (tFrom - offset));
                }
                activeGains.push({ param: gain.gain, lane, clip, base: g * levelLin });

                if (offset <= clip.start) {
                    const when = startAt + (clip.start - offset);
                    src.start(when, 0);
                } else {
                    const into = offset - clip.start;
                    src.start(startAt, into);
                }
                activeSources.push(src);
            });
        });

        playStartCtx = startAt;
        playStartOffset = offset;
    }

    function play() {
        if (isRecording) return;
        if (!beat.buffer && !lanes.some((l) => l.clips.length)) {
            status("Load a beat or record first");
            return;
        }
        ensureCtx();
        if (isPlaying) {
            const now = playStartOffset + (audioCtx.currentTime - playStartCtx);
            stopSources();
            isPlaying = false;
            playhead = Math.min(now, totalDuration());
            els.trPlay?.classList.remove("is-active");
            if (animFrame) cancelAnimationFrame(animFrame);
            updatePlayheadUi();
            status("Paused");
            return;
        }
        scheduleFrom(playhead);
        isPlaying = true;
        els.trPlay?.classList.add("is-active");
        status("Playing");
        tick();
    }

    function pauseTransport() {
        if (isPlaying) play();
    }

    function hardStop() {
        stopSources();
        isPlaying = false;
        if (isRecording) stopRecording(false);
        playhead = 0;
        els.trPlay?.classList.remove("is-active");
        if (animFrame) cancelAnimationFrame(animFrame);
        updatePlayheadUi();
        status("Stopped");
    }

    function tick() {
        if (!isPlaying || !audioCtx) return;
        if (!scrubbing) playhead = playStartOffset + Math.max(0, audioCtx.currentTime - playStartCtx);   // stays put during a count-in
        const dur = totalDuration();
        if (playhead >= dur && !isRecording) {          // never cut off a take because the beat ended
            if (els.trLoop?.checked) {
                playhead = 0;
                scheduleFrom(0);
            } else {
                hardStop();
                return;
            }
        }
        followPlayhead();
        updatePlayheadUi();
        animFrame = requestAnimationFrame(tick);
    }

    // ---------- Recording engine ----------
    // The mic is recorded inside the audio thread (an AudioWorklet), which reports the exact audio-clock time of
    // the first sample. The beat plays on the same clock, so the take can be put back exactly where it was sung.
    // (The old way, MediaRecorder, starts a variable time after you press the button and encodes lossy audio.)
    const REC_WORKLET = `
        class VlRec extends AudioWorkletProcessor {
            constructor() {
                super();
                this.on = false; this.first = false; this.buf = new Float32Array(4096); this.n = 0;
                this.port.onmessage = (e) => {
                    if (e.data === "start") { this.on = true; this.first = true; this.n = 0; }
                    else if (e.data === "stop") {
                        this.on = false;
                        if (this.n) this.port.postMessage({ d: this.buf.slice(0, this.n) });
                        this.n = 0;
                        this.port.postMessage({ done: true });
                    }
                };
            }
            process(inputs) {
                if (this.on) {
                    const ch = inputs[0] && inputs[0][0];
                    if (ch) {
                        if (this.first) { this.port.postMessage({ t: currentTime }); this.first = false; }
                        for (let i = 0; i < ch.length; i++) {
                            this.buf[this.n++] = ch[i];
                            if (this.n === this.buf.length) { this.port.postMessage({ d: this.buf.slice() }); this.n = 0; }
                        }
                    }
                }
                return true;
            }
        }
        registerProcessor("vl-rec", VlRec);`;

    async function makeWorkletEngine(ctx, stream) {
        if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("no worklet");
        if (!ctx.__vlRecLoaded) {
            const url = URL.createObjectURL(new Blob([REC_WORKLET], { type: "application/javascript" }));
            try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
            ctx.__vlRecLoaded = true;
        }
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "vl-rec", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
        const mute = ctx.createGain();                 // keeps the node running with no sound coming out
        mute.gain.value = 0;
        source.connect(node); node.connect(mute); mute.connect(ctx.destination);
        const chunks = [];
        let firstTime = null, finish = null;
        node.port.onmessage = (e) => {
            if (e.data.t !== undefined) firstTime = e.data.t;
            if (e.data.d) chunks.push(e.data.d);
            if (e.data.done && finish) finish();
        };
        const teardown = () => { try { source.disconnect(); node.disconnect(); mute.disconnect(); } catch (_) {} };
        return {
            kind: "worklet",
            start() { node.port.postMessage("start"); },
            discard() { teardown(); },
            stop() {
                return new Promise((resolve) => { finish = resolve; node.port.postMessage("stop"); }).then(() => {
                    teardown();
                    const total = chunks.reduce((n, c) => n + c.length, 0);
                    const samples = new Float32Array(total);
                    let at = 0;
                    chunks.forEach((c) => { samples.set(c, at); at += c.length; });
                    return { samples, sampleRate: ctx.sampleRate, firstTime };
                });
            }
        };
    }

    // For browsers without audio worklets: the start time is an estimate (the Timing nudge in Settings fixes the rest)
    function makeMediaRecorderEngine(ctx, stream) {
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        const opts = mime ? { mimeType: mime } : {};
        if (mime.indexOf("opus") !== -1) opts.audioBitsPerSecond = 192000;
        const rec = new MediaRecorder(stream, opts);
        const parts = [];
        let startedAt = 0;
        rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
        return {
            kind: "mediarecorder",
            start() { rec.start(50); startedAt = ctx.currentTime; },
            discard() { try { rec.stop(); } catch (_) {} },
            stop() {
                return new Promise((resolve) => { rec.onstop = resolve; rec.stop(); }).then(async () => {
                    const bytes = await new Blob(parts, { type: rec.mimeType || "audio/webm" }).arrayBuffer();
                    const decoded = await ctx.decodeAudioData(bytes);
                    return { samples: decoded.getChannelData(0).slice(), sampleRate: decoded.sampleRate, firstTime: startedAt + 0.06 };
                });
            }
        };
    }

    async function makeRecEngine(ctx, stream) {
        try { return await makeWorkletEngine(ctx, stream); }
        catch (err) {
            console.warn("Audio worklet unavailable, using MediaRecorder:", err);
            return makeMediaRecorderEngine(ctx, stream);
        }
    }

    // How late the take arrives: what you hear comes out of the speaker/earbuds a moment after it is played
    // (output delay) and the mic reports it a moment after you sing (input delay). Both are taken off the take.
    function recordingDelay(ctx, mic) {
        let out = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        const track = mediaStream && mediaStream.getAudioTracks()[0];
        let inn = (track && track.getSettings && track.getSettings().latency) || 0.015;
        let estimated = false;
        // Wireless earbuds: browsers often report almost no delay although it is really 150 ms or more
        if (mic && mic.wireless && out < 0.06) { out = 0.17; inn = Math.max(inn, 0.03); estimated = true; }
        return { out, inn, estimated, total: out + inn };
    }

    async function startRecording() {
        if (isRecording || recStarting) return;
        const armed = lanes.find((l) => l.armed);
        if (!armed) {
            status("Arm a lane first (R button)");
            return;
        }
        recStarting = true;
        const ctx = ensureCtx();                         // inside the tap, so phones allow the audio to start
        status("Starting the mic…");

        try {
            recMic = await window.VLMic.open();
            mediaStream = recMic.stream;
        } catch (err) {
            status(err && err.message ? err.message : "Mic permission denied");
            console.warn(err);
            recStarting = false;
            return;
        }

        try {
            if (ctx.state !== "running") await ctx.resume();
            recEngine = await makeRecEngine(ctx, mediaStream);
        } catch (err) {
            status("Recorder not supported");
            console.warn(err);
            cleanupRecStream();
            recStarting = false;
            return;
        }

        recLaneId = armed.id;
        recStartOffset = playhead;

        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        const micSrc = ctx.createMediaStreamSource(mediaStream);
        micSrc.connect(analyser);
        runMeter();
        // live waveform in the armed lane + dB readout (studioui.js)
        if (window.VLRecWave) window.VLRecWave.start({ ctx, stream: mediaStream, laneId: recLaneId, startOffset: recStartOffset, pxPerSec: pxPerSec(), getPlayhead: () => playhead, drawRuler });

        // Count-in (off unless it is switched on in Settings): real clicks in the beat's tempo, then the beat comes in
        const bpm = beat.bpm > 0 ? beat.bpm : 100;
        const beatSec = 60 / bpm;
        const clicks = S.get("countIn") ? 4 * S.get("countInBars") : 0;
        const lead = 0.12;
        if (clicks) S.clicks(ctx, ctx.currentTime + lead, beatSec, clicks);

        stopSources();
        isPlaying = false;
        // Phone mic: play the beat quieter so less of it leaks into the take. Earbuds: full level, nothing leaks.
        const phoneMic = S.get("micSource") === "phone";
        scheduleFrom(recStartOffset, phoneMic ? 0.55 : 1, lead + clicks * beatSec);
        recT0 = playStartCtx;                            // the audio-clock time the beat starts

        recEngine.start();
        isRecording = true;
        recStarting = false;
        document.body.classList.add("is-recording");
        els.trRecord?.classList.add("is-hot");
        isPlaying = true;
        els.trPlay?.classList.add("is-active");
        playStartOffset = recStartOffset;
        status((clicks ? "Count-in… then sing" : "Recording from " + fmt(recStartOffset)) + (recMic.note ? " · " + recMic.note : ""));
        if (clicks) setTimeout(() => { if (isRecording) status("Recording from " + fmt(recStartOffset)); }, (lead + clicks * beatSec) * 1000);
        tick();
    }

    function stopRecording(save) {
        if (!isRecording || !recEngine) return;
        if (save === false) {
            try { recEngine.discard(); } catch (_) {}
            recEngine = null;
            cleanupRecStream();
            isRecording = false;
            document.body.classList.remove("is-recording");
            els.trRecord?.classList.remove("is-hot");
            return;
        }
        onRecordStop();
    }

    async function onRecordStop() {
        const prog = window.VLProgress ? window.VLProgress.start("Saving your take…") : null;
        try { await onRecordStopInner(); } finally { if (prog) prog.done(); }
    }

    async function onRecordStopInner() {
        const engine = recEngine;
        recEngine = null;
        isRecording = false;
        document.body.classList.remove("is-recording");
        els.trRecord?.classList.remove("is-hot");
        const ctx = ensureCtx();

        if (isPlaying && audioCtx) {
            playhead = playStartOffset + Math.max(0, audioCtx.currentTime - playStartCtx);
            stopSources();
            isPlaying = false;
            els.trPlay?.classList.remove("is-active");
            if (animFrame) cancelAnimationFrame(animFrame);
        }

        let result = null;
        try {
            result = await engine.stop();
        } catch (e) {
            console.warn("stop rec", e);
        }
        const delay = recordingDelay(ctx, recMic);          // measured while the stream is still open
        let micRate = 0;
        try { const tr = mediaStream && mediaStream.getAudioTracks()[0]; micRate = (tr && tr.getSettings && tr.getSettings().sampleRate) || 0; } catch (_) {}
        cleanupRecStream();

        if (!result || !result.samples || result.samples.length < result.sampleRate * 0.1) {
            status("Empty recording");
            return;
        }
        const lane = lanes.find((l) => l.id === recLaneId);
        if (!lane) return;

        // Where in the song the first recorded sample belongs
        const nudge = (S.get("offsetMs") || 0) / 1000;
        let songStart = recStartOffset + (result.firstTime - recT0) - delay.total + nudge;
        let samples = result.samples;
        // Anything recorded before the beat came in (count-in clicks, button noise) is cut off
        const keepFrom = Math.max(0, recStartOffset - 0.03);
        if (songStart < keepFrom) {
            const drop = Math.min(samples.length, Math.round((keepFrom - songStart) * result.sampleRate));
            samples = samples.subarray(drop);
            songStart = keepFrom;
        }
        if (!samples.length) { status("Empty recording"); return; }

        let buffer = ctx.createBuffer(1, samples.length, result.sampleRate);
        buffer.copyToChannel(samples, 0);
        const duration = buffer.duration;
        try {
            // Lift quiet takes; light high-pass to cut DC / rumble
            buffer = await polishTake(buffer);
        } catch (e) {
            console.warn("polish rec", e);
        }

        const takeNum = lane.clips.length + 1;
        const wav = audioBufferToWav(buffer);
        const file = new File([wav], lane.name.replace(/\s+/g, "_") + "_take" + takeNum + ".wav", { type: "audio/wav" });

        if (window.VLEdit) window.VLEdit.checkpoint();            // a recorded take can be undone
        const newClip = {
            id: uid(),
            name: "Take " + takeNum,
            blob: file,
            file,
            buffer,
            start: songStart,
            duration
        };
        lane.clips.push(newClip);
        window.dispatchEvent(new CustomEvent("vl-take-saved", { detail: { clipId: newClip.id } }));
        // Take check: measure the raw recording (before any lift or cleaning) and tell the singer what limits it
        const rawForCheck = samples, rawRate = result.sampleRate, micLabel = recMic && recMic.label, micProc = !!(recMic && recMic.processing);
        setTimeout(async () => {
            if (!window.VLTakeCheck) return;
            try {
                const q = await window.VLTakeCheck.check({ samples: rawForCheck, sr: rawRate, micRate, label: micLabel, processing: micProc, beat: beat.buffer ? { buffer: beat.buffer, start: songStart } : null });
                newClip.quality = q;
                window.dispatchEvent(new CustomEvent("vl-take-checked", { detail: { clipId: newClip.id } }));
                const issues = q.findings.filter((f) => f.status !== "good").length;
                if (window.VLUI && issues) window.VLUI.toast("Take saved. " + issues + (issues === 1 ? " thing" : " things") + " could sound better.", { label: "See tips", run: () => window.VLTakeCheck.show(newClip) });
            } catch (e) { console.warn("take check", e); }
        }, 60);

        renderLanes();
        updateTotals();
        refreshRoles();
        status("Saved Take " + takeNum + " @ " + fmt(songStart) + (Math.abs(polishTake.lastGainDb || 0) >= 3 ? " · level " + ((polishTake.lastGainDb > 0 ? "+" : "") + Math.round(polishTake.lastGainDb)) + " dB" : ""));
        if (S.report) {
            S.report("Last take: " + Math.round(delay.total * 1000) + " ms of delay removed (" + Math.round(delay.out * 1000) + " out + " + Math.round(delay.inn * 1000) + " in" +
                (delay.estimated ? ", estimated for wireless earbuds" : "") + (nudge ? ", " + Math.round(nudge * 1000) + " ms nudge" : "") + ")" +
                (recMic && recMic.label ? " · mic: " + recMic.label : "") + (engine && engine.kind === "mediarecorder" ? " · this browser has no exact recorder, so timing is approximate" : "") + ".");
        }
    }

    /** Normalize peak ~ -6 dBFS and apply a gentle high-pass (cuts jack/DC rumble). */
    // Brings the take to a healthy level. The lift is worked out from how loud the SINGING is (not from one stray peak),
    // so a quiet singer is lifted properly; a take that is too loud is brought down. Stray peaks that would go over
    // the top are caught by a small limiter instead of holding the whole take back. Also a light 80 Hz high-pass.
    async function polishTake(buffer) {
        const Y = () => (window.VLYield ? window.VLYield() : null);
        const sr = buffer.sampleRate;
        const ch = buffer.numberOfChannels;
        const len = buffer.length;
        const out = ensureCtx().createBuffer(ch, len, sr);
        const mode = S.get("micLift");

        // how loud is the singing? (50 ms blocks; the loud ones are the voice, the quiet ones the room)
        const blk = Math.max(1, Math.round(0.05 * sr)), nb = Math.floor(len / blk), lv = [];
        const m0 = buffer.getChannelData(0);
        let peak = 0;
        for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < len; i++) { if ((i & 524287) === 0) await Y(); const v = Math.abs(d[i]); if (v > peak) peak = v; } }
        for (let b = 0; b < nb; b++) { let e = 0; for (let i = b * blk; i < (b + 1) * blk; i++) e += m0[i] * m0[i]; lv.push(10 * Math.log10(e / blk + 1e-12)); }
        const sorted = lv.slice().sort((a, b) => a - b);
        const top = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : -60;
        const active = lv.filter((v) => v >= top - 20).sort((a, b) => a - b);
        const singDb = active.length ? active[Math.floor(active.length * 0.6)] : top;       // typical level while singing

        const TARGET = -21, maxLift = mode === "auto" ? 30 : mode === "normal" ? 12 : 0;
        let gainDb = mode === "off" ? 0 : Math.max(-12, Math.min(maxLift, TARGET - singDb));
        if (peak < 0.001) gainDb = 0;
        const gain = Math.pow(10, gainDb / 20);
        polishTake.lastGainDb = gainDb;
        polishTake.limited = false;

        const rc = 1 / (2 * Math.PI * 80), dt = 1 / sr, alpha = rc / (rc + dt);
        const CEIL = 0.97;
        // limiter gain (shared by all channels): fast attack with 4 ms look-ahead, slow release
        let lim = null;
        if (peak * gain > CEIL) {
            polishTake.limited = true;
            lim = new Float32Array(len).fill(1);
            const la = Math.round(0.004 * sr);
            const need = new Float32Array(len).fill(1);
            for (let i = 0; i < len; i++) {
                if ((i & 262143) === 0) await Y();
                let v = 0; for (let c = 0; c < ch; c++) { const a = Math.abs(buffer.getChannelData(c)[i]); if (a > v) v = a; }
                const w = v * gain;
                if (w > CEIL) need[i] = CEIL / w;
            }
            const rel = Math.exp(-1 / (0.06 * sr)), att = Math.exp(-1 / (0.0015 * sr));
            let cur = 1;
            for (let i = len - 1; i >= 0; i--) { /* smooth backwards so the dip starts before the peak */
                const w = need[i];
                cur = w < cur ? att * cur + (1 - att) * w : Math.min(1, rel * cur + (1 - rel) * 1);
                lim[i] = Math.min(cur, w);
            }
            let fwd = 1;
            for (let i = 0; i < len; i++) { fwd = lim[i] < fwd ? lim[i] : Math.min(1, fwd + (1 - fwd) * (1 - rel)); lim[i] = Math.min(fwd, lim[Math.min(len - 1, i + la)]); }
        }
        for (let c = 0; c < ch; c++) {
            const src = buffer.getChannelData(c);
            const dst = out.getChannelData(c);
            let prevIn = 0, prevOut = 0;
            for (let i = 0; i < len; i++) {
                if ((i & 524287) === 0) await Y();
                const x = src[i];
                const y = alpha * (prevOut + x - prevIn);
                prevIn = x;
                prevOut = y;
                dst[i] = y * gain * (lim ? lim[i] : 1);
            }
        }
        return out;
    }

    function cleanupRecStream() {
        stopMeter();
        if (window.VLRecWave) window.VLRecWave.stop();
        if (mediaStream) {
            mediaStream.getTracks().forEach((t) => t.stop());
            mediaStream = null;
        }
        analyser = null;
    }

    function runMeter() {
        if (!analyser || !els.trMeter) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
            if (!analyser) return;
            if (window.VLRecWave && window.VLRecWave.active) { meterRaf = requestAnimationFrame(loop); return; }   // studioui.js draws the meter
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (let i = 0; i < data.length; i++) {
                const v = Math.abs(data[i] - 128) / 128;
                if (v > peak) peak = v;
            }
            els.trMeter.style.width = Math.min(100, peak * 150) + "%";
            meterRaf = requestAnimationFrame(loop);
        };
        loop();
    }

    function stopMeter() {
        if (meterRaf) cancelAnimationFrame(meterRaf);
        meterRaf = null;
        if (els.trMeter) els.trMeter.style.width = "0%";
    }

    function toggleRecord() {
        if (isRecording) stopRecording(true);
        else startRecording();
    }

    async function renderLaneToFile(lane, gainDb) {
        if (!lane.clips.length) return null;
        const sr = beat.buffer?.sampleRate || lane.clips[0].buffer?.sampleRate || 44100;
        const dur = Math.max(
            beat.duration || 0,
            ...lane.clips.map((c) => c.start + c.duration)
        );
        const offline = new OfflineAudioContext(1, Math.ceil(dur * sr) || sr, sr);
        const gLin = typeof gainDb === "number" ? Math.pow(10, gainDb / 20) : 1;

        for (const clip of lane.clips) {
            if (!clip.buffer) continue;
            const src = offline.createBufferSource();
            src.buffer = clip.buffer;
            const gain = offline.createGain();
            gain.gain.value = gLin;
            if (window.VLAuto && window.VLAuto.has(lane)) window.VLAuto.schedule(gain.gain, lane, gLin, Math.max(0, clip.start), clip.start + clip.duration, Math.max(0, clip.start));
            src.connect(gain);
            gain.connect(offline.destination);
            src.start(Math.max(0, clip.start));
        }

        const rendered = await offline.startRendering();
        const wav = audioBufferToWav(rendered);
        return new File([wav], lane.name.replace(/\s+/g, "_") + "_comp.wav", { type: "audio/wav" });
    }


    function channelsFromBuffer(buf) {
        const out = [];
        for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c));
        return out;
    }

    function bufferFromChannels(channels, sr) {
        const n = channels[0].length;
        const ch = channels.length;
        const buf = typeof AudioBuffer !== "undefined"
            ? new (window.AudioBuffer || AudioBuffer)({ length: n, numberOfChannels: ch, sampleRate: sr })
            : null;
        // OfflineAudioContext path (widely supported)
        const offline = new OfflineAudioContext(ch, n, sr);
        const b = offline.createBuffer(ch, n, sr);
        for (let c = 0; c < ch; c++) b.copyToChannel(Float32Array.from(channels[c]), c);
        return b;
    }

    function keyOptionsForHarmony() {
        const S = window.VLState || window.state || {};
        let rootPc = 0, scale = "major", refCents = 0;
        if (S.tuneOptions) {
            if (S.tuneOptions.rootPc != null) rootPc = S.tuneOptions.rootPc;
            if (S.tuneOptions.scale) scale = S.tuneOptions.scale;
            if (S.tuneOptions.refCents != null) refCents = S.tuneOptions.refCents;
        }
        if (S.analysis) {
            const a = S.analysis;
            if (a.rootPc != null) rootPc = a.rootPc;
            if (a.keyScale) scale = a.keyScale;
            if (a.key && typeof a.key === "object") {
                if (a.key.rootPc != null) rootPc = a.key.rootPc;
                if (a.key.scale) scale = String(a.key.scale).toLowerCase().indexOf("min") >= 0 ? "minor" : "major";
            }
            if (typeof a.key === "string") {
                const low = a.key.toLowerCase();
                scale = low.indexOf("min") >= 0 ? "minor" : "major";
            }
        }
        if (S.beatKey && S.beatKey.rootPc != null) {
            rootPc = S.beatKey.rootPc;
            if (S.beatKey.scale) scale = S.beatKey.scale;
        }
        return { rootPc, scale, refCents };
    }

    async function harmonizeBuffer(buf, degrees, onStatus) {
        const Tune = window.VLTune;
        if (!Tune || typeof Tune.harmonizeVocal !== "function") {
            throw new Error("Pitch engine not loaded");
        }
        if (!degrees) return buf;
        const sr = buf.sampleRate;
        const channels = channelsFromBuffer(buf);
        const keyOpts = keyOptionsForHarmony();
        const result = await Tune.harmonizeVocal(
            channels,
            sr,
            Object.assign({}, keyOpts, { degrees: degrees, retuneMs: 25 }),
            (f) => { if (onStatus) onStatus(f); }
        );
        const outCh = result && result.audio && result.audio.harmony;
        if (!outCh || !outCh[0]) throw new Error("Harmony build returned empty");
        return bufferFromChannels(outCh, sr);
    }

    /** Composite every non-muted lane onto one mono vocal, with per-lane mix levels. */
    // The lead on its own, on the composite's timeline, exactly as recorded (the lead lane is never gained).
    async function renderLeadReference(mainLane, length, sr) {
        const leadCtx = new OfflineAudioContext(1, length, sr);
        for (const clip of mainLane.clips) {
            if (!clip.buffer) continue;
            const src = leadCtx.createBufferSource();
            src.buffer = clip.buffer;
            if (window.VLAuto && window.VLAuto.has(mainLane)) {
                // the lead as it sounds in this mix, including the volume rides you drew
                const lg = leadCtx.createGain();
                window.VLAuto.schedule(lg.gain, mainLane, 1, Math.max(0, clip.start), clip.start + clip.duration, Math.max(0, clip.start));
                src.connect(lg); lg.connect(leadCtx.destination);
            } else src.connect(leadCtx.destination);
            src.start(Math.max(0, clip.start));
        }
        return leadCtx.startRendering();
    }

    /** The whole Studio mix as you hear it (beat + every lane with its level and automation) as a stereo buffer. */
    async function renderMix() {
        const sr = beat.buffer?.sampleRate || lanes.find((l) => l.clips[0]?.buffer)?.clips[0].buffer.sampleRate || 44100;
        let dur = beat.duration || 0;
        lanes.forEach((l) => l.clips.forEach((c) => { dur = Math.max(dur, c.start + c.duration); }));
        if (dur <= 0) return null;
        const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * sr)), sr);
        if (beat.buffer) {
            const b = offline.createBufferSource();
            b.buffer = beat.buffer; b.connect(offline.destination); b.start(0);
        }
        if (melody && melody.on && melody.buffer) {
            const mb = offline.createBufferSource();
            mb.buffer = melody.buffer; mb.connect(offline.destination); mb.start(0);
        }
        const mainDb = mainReferenceDb();
        lanes.forEach((lane) => {
            if (lane.muted) return;
            const resolved = resolveLaneGain(lane, mainDb);
            if (resolved.key === "mute" || resolved.lin <= 0) return;
            lane.clips.forEach((clip) => {
                if (!clip.buffer) return;
                const src = offline.createBufferSource();
                src.buffer = clip.buffer;
                const gain = offline.createGain();
                gain.gain.value = resolved.lin;
                if (window.VLAuto && window.VLAuto.has(lane)) window.VLAuto.schedule(gain.gain, lane, resolved.lin, Math.max(0, clip.start), clip.start + clip.duration, Math.max(0, clip.start));
                src.connect(gain); gain.connect(offline.destination);
                src.start(Math.max(0, clip.start));
            });
        });
        return offline.startRendering();
    }

    async function renderCompositeVocal() {
        // Include muted-by-mix mute skip; harmony lanes can be empty if they will generate from main
        const active = lanes.filter((l) => {
            if ((l.mixLevel || defaultMixLevel(l.type)) === "mute") return false;
            if (l.clips.length) return true;
            if (l.type === "harmony" && (l.harmonyDegrees || 0) > 0) return true;
            return false;
        });
        if (!active.length) return null;

        const mainLane = findMainLane();
        const sr = beat.buffer?.sampleRate
            || (active.find((l) => l.clips[0]?.buffer)?.clips[0].buffer.sampleRate)
            || mainLane?.clips[0]?.buffer?.sampleRate
            || 44100;

        let dur = beat.duration || 0;
        active.forEach((l) => l.clips.forEach((c) => { dur = Math.max(dur, c.start + c.duration); }));
        if (mainLane) mainLane.clips.forEach((c) => { dur = Math.max(dur, c.start + c.duration); });
        const length = Math.max(1, Math.ceil(dur * sr));
        // Stereo only when an FX Rack effect made a clip stereo (widener, doubler...). Plain mono sessions render exactly as before.
        const wantStereo = active.some((l) => l.clips.some((c) => c.buffer && c.buffer.numberOfChannels > 1));
        const offline = new OfflineAudioContext(wantStereo ? 2 : 1, length, sr);

        const report = [];
        const mainDb = mainReferenceDb();
        const harmNames = { 2: "3rd", 4: "5th", 7: "octave" };

        for (const lane of active) {
            const resolved = resolveLaneGain(lane, mainDb);
            if (resolved.key === "mute" || resolved.lin <= 0) continue;
            const gLin = resolved.lin;
            const degrees = (lane.type === "harmony") ? (lane.harmonyDegrees || 0) : 0;

            // Source clips: own takes, or Main when generating a harmony on an empty lane
            let sourceClips = lane.clips.filter((c) => c.buffer);
            let fromMain = false;
            if (!sourceClips.length && degrees > 0 && mainLane) {
                sourceClips = mainLane.clips.filter((c) => c.buffer);
                fromMain = true;
            }
            if (!sourceClips.length) continue;

            let line = lane.name + ": " + resolved.label;
            if (degrees > 0) {
                line += " · " + (harmNames[degrees] || degrees) + " harmony"
                    + (fromMain ? " from Main" : " from take");
                status("Building harmony for " + lane.name + "…");
            }
            report.push(line);

            for (const clip of sourceClips) {
                let buf = clip.buffer;
                if (degrees > 0) {
                    try {
                        buf = await harmonizeBuffer(buf, degrees, (f) => {
                            status("Building harmony for " + lane.name + "… " + Math.round(f * 100) + "%");
                        });
                    } catch (err) {
                        console.warn("Harmony build failed", err);
                        report.push(lane.name + ": harmony skipped (" + (err.message || "error") + ")");
                        if (fromMain) continue; // don't dump dry main as "harmony"
                        // fall back to original take
                    }
                }
                const src = offline.createBufferSource();
                src.buffer = buf;
                const gain = offline.createGain();
                gain.gain.value = gLin;
                if (window.VLAuto && window.VLAuto.has(lane)) window.VLAuto.schedule(gain.gain, lane, gLin, Math.max(0, clip.start), clip.start + buf.duration, Math.max(0, clip.start));
                src.connect(gain);
                gain.connect(offline.destination);
                src.start(Math.max(0, clip.start));
            }
        }

        const rendered = await offline.startRendering();

        // Lead-only reference on the same timeline so Pipeline can balance/ride the lead while keeping adlibs/tags at the
        // relative level set here. Only when the lead really is in this composite (a muted lead is not), and never at the
        // cost of the send itself: if it cannot be built, Pipeline simply works as before and the person is told.
        let stack = null;
        if (mainLane && active.includes(mainLane) && active.length > 1 && mainLane.clips.some((c) => c.buffer)) {
            try {
                stack = { leadReference: await renderLeadReference(mainLane, length, sr), extras: active.length - 1 };
            } catch (leadErr) {
                console.warn("Lead reference render failed", leadErr);
                stack = null;
                report.push("Could not build the lead reference, so mastering may even out your adlib / tag levels a little");
            }
        }

        const wav = audioBufferToWav(rendered);
        const name = active.length === 1
            ? active[0].name.replace(/\s+/g, "_") + "_comp.wav"
            : "VoxloopStudio_composite_" + active.length + "lanes.wav";
        return {
            file: new File([wav], name, { type: "audio/wav" }),
            report,
            laneCount: active.length,
            stack
        };
    }

    function audioBufferToWav(buffer) {
        const sr = buffer.sampleRate;
        const nch = Math.min(2, buffer.numberOfChannels);
        const chans = [];
        for (let c = 0; c < nch; c++) chans.push(buffer.getChannelData(c));
        const frames = chans[0].length;
        const dataLength = frames * 2 * nch;
        const ab = new ArrayBuffer(44 + dataLength);
        const view = new DataView(ab);
        const writeStr = (o, s) => {
            for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
        };
        writeStr(0, "RIFF");
        view.setUint32(4, 36 + dataLength, true);
        writeStr(8, "WAVE");
        writeStr(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, nch, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * 2 * nch, true);
        view.setUint16(32, 2 * nch, true);
        view.setUint16(34, 16, true);
        writeStr(36, "data");
        view.setUint32(40, dataLength, true);
        let off = 44;
        for (let i = 0; i < frames; i++) {
            for (let c = 0; c < nch; c++, off += 2) {
                const s = Math.max(-1, Math.min(1, chans[c][i]));
                view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            }
        }
        return new Blob([ab], { type: "audio/wav" });
    }

    async function sendToPipeline() {
        if (!beat.file && !beat.buffer) {
            status("Load a beat first");
            return;
        }
        const any = lanes.some((l) => {
            if ((l.mixLevel || defaultMixLevel(l.type)) === "mute") return false;
            if (l.clips.length) return true;
            if (l.type === "harmony" && (l.harmonyDegrees || 0) > 0 && findMainLane()) return true;
            return false;
        });
        if (!any) {
            status("Record at least one vocal take (or add a Harmony lane with interval on)");
            return;
        }

        status("Rendering composite vocal…");
        try {
            const composite = await renderCompositeVocal();
            if (!composite || !composite.file) {
                status("Nothing to send");
                return;
            }

            let beatFile = beat.file;
            if (melody && melody.on && melody.buffer && beat.buffer) {          // the melody belongs to the instrumental
                const m = melody.buffer, bb = beat.buffer, mixed = ensureCtx().createBuffer(bb.numberOfChannels, bb.length, bb.sampleRate);
                for (let c = 0; c < bb.numberOfChannels; c++) {
                    const o = mixed.getChannelData(c), x = bb.getChannelData(c), y = m.getChannelData(Math.min(c, m.numberOfChannels - 1));
                    for (let i = 0; i < o.length; i++) o[i] = x[i] + (i < y.length ? y[i] : 0);
                }
                beatFile = new File([audioBufferToWav(mixed)], (beat.name || "beat") + " + melody.wav", { type: "audio/wav" });
            }
            if (!beatFile && beat.buffer) {
                const wav = audioBufferToWav(beat.buffer);
                beatFile = new File([wav], (beat.name || "beat") + ".wav", { type: "audio/wav" });
            }

            assignFile(els.vocalInput, composite.file, els.vocalFileName);
            assignFile(els.beatFileInput, beatFile, els.beatFileName);
            if (window.VLState) window.VLState.studioStack = composite.stack || null;
            refreshRoles();
            setMode("pipeline");
            const summary = composite.report.length
                ? composite.report.join(" · ")
                : "1 lane";
            status("Sent " + composite.laneCount + " lane(s) to Pipeline — " + summary);
            $("upload-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
            console.warn("sendToPipeline failed", e);
            const msg = (e && e.message) ? e.message : String(e || "unknown error");
            status("Render failed: " + msg);
        }
    }

    function bindPlayheadScrub() {
        if (!els.rulerScroll) return;
        const ruler = els.rulerScroll;
        const seek = (clientX) => {
            const rect = ruler.getBoundingClientRect();
            playhead = snapTime((clientX - rect.left + (els.lanes ? els.lanes.scrollLeft : 0)) / pxPerSec());
            updatePlayheadUi();
            if (els.trScrub) els.trScrub.value = Math.floor(playhead * 1000);
        };
        ruler.addEventListener("pointerdown", (e) => {
            if (isRecording || (e.pointerType === "mouse" && e.button !== 0)) return;
            scrubbing = true;
            try { ruler.setPointerCapture(e.pointerId); } catch (_) {}
            seek(e.clientX);
        });
        ruler.addEventListener("pointermove", (e) => {
            if (!scrubbing) return;
            seek(e.clientX);
            // dragging to an edge scrolls the timeline
            const rect = ruler.getBoundingClientRect();
            if (els.lanes) {
                if (e.clientX > rect.right - 28) els.lanes.scrollLeft += 10;
                else if (e.clientX < rect.left + 28) els.lanes.scrollLeft -= 10;
            }
        });
        const end = () => {
            if (!scrubbing) return;
            scrubbing = false;
            if (isPlaying) scheduleFrom(playhead);          // keep playing from where it was dropped
            updatePlayheadUi();
        };
        ruler.addEventListener("pointerup", end);
        ruler.addEventListener("pointercancel", end);

        // keep the ruler and the playhead locked to the lanes while they scroll
        if (els.lanes) {
            els.lanes.addEventListener("scroll", () => { ruler.scrollLeft = els.lanes.scrollLeft; placePlayhead(); }, { passive: true });
            ["wheel", "touchstart", "pointerdown"].forEach((ev) => els.lanes.addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));
        }
    }

    function init() {
        cache();

        const minMs = 600;
        const t0 = performance.now();
        const done = () => {
            setTimeout(hidePreloader, Math.max(0, minMs - (performance.now() - t0)));
        };
        if (document.readyState === "complete") done();
        else window.addEventListener("load", done);

        document.querySelectorAll(".mode-btn").forEach((btn) => {
            btn.addEventListener("click", () => setMode(btn.dataset.mode));
        });
        els.trSettings?.addEventListener("click", () => setMode("settings"));
        els.trPhone?.addEventListener("click", () => setPhonePreview(!phoneOn));
        $("vr-open-settings")?.addEventListener("click", () => setMode("settings"));

        let saved = "pipeline";
        try {
            saved = localStorage.getItem("vl-last-screen") || "pipeline";
        } catch (_) {}
        setMode(saved);

        els.loadBeat?.addEventListener("click", () => els.beatInput?.click());
        els.beatInput?.addEventListener("change", () => {
            const f = els.beatInput.files?.[0];
            if (f) loadBeatFile(f);
            els.beatInput.value = "";
        });
        els.addLane?.addEventListener("click", () => addLane(els.laneType?.value));
        els.importAudio?.addEventListener("click", () => els.importInput?.click());
        els.importInput?.addEventListener("change", () => {
            const list = els.importInput.files;
            if (list && list.length) importAudioFiles(list);
            els.importInput.value = "";
        });
        els.toPipeline?.addEventListener("click", sendToPipeline);

        els.trPlay?.addEventListener("click", play);
        els.trStop?.addEventListener("click", hardStop);
        els.trRecord?.addEventListener("click", toggleRecord);

        els.trScrub?.addEventListener("input", () => {
            if (isRecording) return;
            playhead = (+els.trScrub.value) / 1000;
            if (isPlaying) scheduleFrom(playhead);
            updatePlayheadUi();
        });

        bindPlayheadScrub();
        updateCount();
        refreshRoles();
        status("Ready");

        // Redraw timeline when rotating phone / resizing
        let resizeTimer = null;
        window.addEventListener("resize", () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (els.shell?.classList.contains("mode-studio")) {
                    renderLanes();
                    drawRuler();
                    updatePlayheadUi();
                }
            }, 120);
        });

        window.VLDAW = {
            setMode,
            addLane,
            loadBeatFile,
            importAudioFiles,
            // getters, because lanes / beat get replaced (delete lane, load a new beat)
            get lanes() { return lanes; },
            get beat() { return beat; },
            sendToPipeline,
            MAX_LANES,
            // used by the FX Rack (fxrack.js)
            api: { renderLanes, updateTotals, refreshRoles, ensureCtx, status, pause: pauseTransport, drawRuler, pxPerSec, timelineWidth, totalDuration, renderMix, refreshAutomation, getPlayhead: () => playhead, setPlayhead: (v) => { playhead = Math.max(0, v); updatePlayheadUi(); }, isPlaying: () => isPlaying, setZoom, getZoom: () => zoom, setActiveLane, getActiveLane: () => activeLaneId, audioBufferToWav, uid, setBeatInfo, snapTime, gridInfo, getMelody: () => melody, setMelody, snapshotProject, restoreProject, isEmpty: () => !beat.buffer && !lanes.some((l) => l.clips.length) }
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
