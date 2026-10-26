// =====================================================================
// Record your vocal over the Beat Lab beat, balance it against the beat, and download the mix.
//
// How it fits together
//   Record   : the microphone is opened, the beat starts (after an optional one-bar count-in) and the
//              microphone is recorded in the same audio clock as the beat. That shared clock is what lets
//              the vocal be put back exactly where it was sung.
//   Balance  : one slider moves the beat down and the vocal up (or the reverse). "Auto balance" listens to
//              how loud the beat and the voice are and sets a good starting point.
//   Download : the beat is rendered (the same fast render as "Download full beat"), the vocal is put through
//              a small vocal chain (rumble filter, gentle compressor, a little clarity, optional reverb), and
//              the two are added together at the balance you chose.
// It uses the beat player in beatlab.js (startPlayback, stopPlayback, engine ...), loaded just before it.
// =====================================================================
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const panel = $("vr-panel");
  if (!panel) return;

  const el = {
    record: $("vr-record"), recordLabel: $("vr-record-label"), start: $("vr-start"), countIn: $("vr-countin"),
    meter: $("vr-meter-fill"), status: $("vr-status"), take: $("vr-take"), play: $("vr-play"), redo: $("vr-redo"),
    balance: $("vr-balance"), balanceOut: $("vr-balance-readout"), auto: $("vr-auto"),
    sync: $("vr-sync"), syncOut: $("vr-sync-out"), reverb: $("vr-reverb"), reverbOut: $("vr-reverb-out"),
    downloadMix: $("vr-download-mix"), downloadVocal: $("vr-download-vocal"), polish: $("vr-polish")
  };

  const state = {
    recording: false, previewing: false, busy: false,
    recorder: null, stream: null, level: 0, meterTimer: 0,
    beatStart: 0, fromBar: 0, restoreLoop: null, countInSynth: null,
    take: null,                 // { samples, sampleRate, songStart, seed }  songStart = seconds on the song's clock
    vocalBaseDb: 0,             // set by "Auto balance": how much the raw vocal is lifted or lowered
    beatLevel: { sum: 0, count: 0 },
    chain: null, player: null
  };

  const setStatus = text => { el.status.textContent = text; };
  const barSec = () => barSeconds(current);

  // ---------- Where to start from ----------
  function refreshSections() {
    const keep = el.start.value;
    el.start.innerHTML = "";
    const add = (bar, label) => { const o = document.createElement("option"); o.value = String(bar); o.textContent = label; el.start.appendChild(o); };
    add(0, "The beginning");
    if (typeof isSong === "function" && current && isSong(current)) {
      current.sections.forEach(section => { if (section.start > 0) add(section.start, section.label); });
    }
    if ([...el.start.options].some(o => o.value === keep)) el.start.value = keep;
    if (state.take && current && state.take.seed !== current.seed) {
      setStatus("Heads up: this take was recorded over a different beat. Delete it and record again for this one.");
    }
  }

  // ---------- Microphone ----------
  async function openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser cannot use a microphone here. Open the page in Chrome, Edge, Firefox or Safari.");
    }
    try {
      // Raw, unprocessed sound: the browser's echo cancelling and noise gate chop up a singing voice
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
      });
    } catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        throw new Error("The microphone is blocked. Allow it from the lock icon in the address bar, then press Record again.");
      }
      if (err && err.name === "NotFoundError") throw new Error("No microphone found. Plug one in and press Record again.");
      throw err;
    }
  }

  // The recorder runs in the audio thread and reports the exact audio-clock time of its first sample
  const WORKLET = `
    class VrRec extends AudioWorkletProcessor {
      constructor() {
        super();
        this.on = false; this.first = false; this.buf = new Float32Array(4096); this.n = 0;
        this.port.onmessage = e => {
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
    registerProcessor("vr-rec", VrRec);`;

  async function makeWorkletRecorder(tone, source) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await tone.addAudioWorkletModule(url, "vr-rec");
    const node = tone.createAudioWorkletNode("vr-rec", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    const mute = tone.rawContext.createGain();                  // keeps the node running without any sound coming out
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(tone.rawContext.destination);

    const chunks = [];
    let firstTime = null, finish = null;
    node.port.onmessage = e => {
      if (e.data.t !== undefined) firstTime = e.data.t;
      if (e.data.d) {
        chunks.push(e.data.d);
        let peak = 0;
        for (let i = 0; i < e.data.d.length; i += 4) { const a = Math.abs(e.data.d[i]); if (a > peak) peak = a; }
        state.level = Math.max(state.level * 0.8, peak);
      }
      if (e.data.done && finish) finish();
    };
    return {
      start() { node.port.postMessage("start"); },
      stop() {
        return new Promise(resolve => {
          finish = resolve;
          node.port.postMessage("stop");
        }).then(() => {
          try { source.disconnect(node); node.disconnect(); mute.disconnect(); } catch (err) { /* already gone */ }
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const samples = new Float32Array(total);
          let at = 0;
          chunks.forEach(c => { samples.set(c, at); at += c.length; });
          return { samples, sampleRate: tone.rawContext.sampleRate, firstTime };
        });
      }
    };
  }

  // A fallback for browsers without audio worklets: less exact about the start time (the Timing slider fixes it)
  function makeMediaRecorder(tone, stream) {
    const rec = new MediaRecorder(stream);
    const parts = [];
    let startedAt = 0;
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    return {
      start() { rec.start(); startedAt = tone.rawContext.currentTime; },
      stop() {
        return new Promise(resolve => { rec.onstop = resolve; rec.stop(); }).then(async () => {
          const bytes = await new Blob(parts).arrayBuffer();
          const decoded = await tone.rawContext.decodeAudioData(bytes);
          return { samples: decoded.getChannelData(0).slice(), sampleRate: decoded.sampleRate, firstTime: startedAt + 0.06 };
        });
      }
    };
  }

  // How late the vocal arrives because of the sound card: you sing to what you HEAR (output delay) and the
  // microphone reports it a moment later (input delay). Both are taken off.
  function latencyCompensation(stream) {
    const raw = Tone.getContext().rawContext;
    const output = (raw.outputLatency || 0) + (raw.baseLatency || 0);
    const track = stream && stream.getAudioTracks()[0];
    const input = (track && track.getSettings && track.getSettings().latency) || 0.015;
    return output + input;
  }

  // ---------- Count-in clicks ----------
  function playCountIn(startTime, beatSec) {
    if (!state.countInSynth) {
      state.countInSynth = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 } }).toDestination();
      state.countInSynth.volume.value = -6;
    }
    for (let i = 0; i < 4; i++) state.countInSynth.triggerAttackRelease(i === 0 ? "A5" : "E5", 0.05, startTime + i * beatSec, 0.9);
  }

  // ---------- Recording ----------
  async function startRecording() {
    if (state.busy || state.recording || state.previewing) return;
    state.busy = true;
    el.record.disabled = true;
    try {
      await Tone.start();
      if (!bootAudio()) throw new Error("The audio engine could not start.");
      if (playing) stopPlayback("");
      setStatus("Allowing the microphone\u2026");
      state.stream = await openMic();

      const tone = Tone.getContext();
      const source = tone.rawContext.createMediaStreamSource(state.stream);
      try {
        state.recorder = await makeWorkletRecorder(tone, source);
      } catch (err) {
        console.warn("Audio worklet unavailable, using MediaRecorder:", err);
        state.recorder = makeMediaRecorder(tone, state.stream);
      }

      state.fromBar = Number(el.start.value) || 0;
      const beatSec = 60 / current.bpm;
      const countIn = el.countIn.checked;
      const begin = Tone.now() + 0.15;
      const beatStart = begin + (countIn ? 4 * beatSec : 0);
      if (countIn) playCountIn(begin, beatSec);

      // The song must not loop while recording (the vocal is stored against one pass of the song)
      state.restoreLoop = loopSong;
      loopSong = false;
      state.beatLevel = { sum: 0, count: 0 };
      state.level = 0;
      state.recorder.start();
      state.beatStart = startPlayback(state.fromBar, beatStart);
      state.recording = true;
      state.micLatency = latencyCompensation(state.stream);
      document.body.classList.add("vr-is-recording");
      el.record.classList.add("is-recording");
      el.recordLabel.textContent = "Stop";
      setStatus(countIn ? "Count-in\u2026 then sing." : "Recording. Press Stop when you are done.");
      if (countIn) setTimeout(() => { if (state.recording) setStatus("Recording. Press Stop when you are done."); }, (begin - Tone.now() + 4 * beatSec) * 1000);
      meterLoop();
    } catch (err) {
      console.error(err);
      cleanupMic();
      setStatus(err.message || "Could not start recording.");
    } finally {
      state.busy = false;
      el.record.disabled = false;
    }
  }

  async function finishRecording() {
    if (!state.recording) return;
    state.recording = false;
    document.body.classList.remove("vr-is-recording");
    el.record.classList.remove("is-recording");
    el.recordLabel.textContent = "Record";
    el.record.disabled = true;
    setStatus("Saving your take\u2026");
    if (playing) stopPlayback("");
    if (state.restoreLoop !== null) { loopSong = state.restoreLoop; state.restoreLoop = null; }
    try {
      const result = await state.recorder.stop();
      cleanupMic();
      const seconds = result.samples.length / result.sampleRate;
      if (seconds < 0.4) { setStatus("That was too short to keep. Press Record to try again."); return; }
      // Where on the song's clock the first recorded sample belongs
      const songStart = state.fromBar * barSec() + (result.firstTime - state.beatStart) - state.micLatency;
      state.take = { samples: result.samples, sampleRate: result.sampleRate, songStart, seed: current.seed };
      el.sync.value = 0; el.syncOut.textContent = "0 ms";
      autoBalance(false);
      showTake();
      setStatus(`Take saved (${seconds.toFixed(1)} s). Press Play to hear it with the beat, then balance it below.`);
    } catch (err) {
      console.error(err);
      cleanupMic();
      setStatus("Could not save the take: " + err.message);
    } finally {
      el.record.disabled = false;
    }
  }

  function cleanupMic() {
    clearInterval(state.meterTimer);
    el.meter.style.width = "0%";
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  }

  // The level meter: green, then orange, then red when it is close to clipping
  function meterLoop() {
    clearInterval(state.meterTimer);
    state.meterTimer = setInterval(() => {
      if (!state.recording) return;
      const peak = state.level;
      el.meter.style.width = Math.min(100, Math.round(Math.pow(peak, 0.6) * 100)) + "%";
      el.meter.className = peak > 0.97 ? "hot" : peak > 0.7 ? "warm" : "";
      if (peak > 0.97) setStatus("Too loud: move back from the microphone or turn the input volume down.");
      sampleBeatLevel();
      state.level *= 0.85;
    }, 60);
  }

  // ---------- Beat loudness (for Auto balance) ----------
  function sampleBeatLevel() {
    try {
      const data = engine.masterAnalyser.getValue();
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      if (rms > 0.003) { state.beatLevel.sum += rms * rms; state.beatLevel.count++; }
    } catch (err) { /* the analyser is not ready: Auto balance falls back to a typical level */ }
  }
  const beatLevelDb = () => state.beatLevel.count > 10 ? 10 * Math.log10(state.beatLevel.sum / state.beatLevel.count) : -16;

  function vocalLevelDb(samples, rate) {
    const win = Math.floor(rate * 0.05);
    const rms = [];
    let loudest = 0;
    for (let i = 0; i + win <= samples.length; i += win) {
      let s = 0;
      for (let j = 0; j < win; j++) s += samples[i + j] * samples[i + j];
      const r = Math.sqrt(s / win);
      rms.push(r);
      if (r > loudest) loudest = r;
    }
    const gate = loudest * 0.1;                         // anything 20 dB under the loudest is room noise, not singing
    let sum = 0, count = 0;
    rms.forEach(r => { if (r > gate) { sum += r * r; count++; } });
    return count ? 10 * Math.log10(sum / count) : -60;
  }

  // Set the starting point: the voice's average loudness a couple of dB above the beat's, which is where
  // a lead vocal normally sits. The slider then moves both from there.
  function autoBalance(announce) {
    if (!state.take) return;
    const voice = vocalLevelDb(state.take.samples, state.take.sampleRate);
    state.vocalBaseDb = Math.max(-24, Math.min(30, beatLevelDb() + 2 - voice));
    el.balance.value = 0;
    paintBalance();
    applyBalance();
    if (announce) setStatus("Balanced: your voice now sits just above the beat. Use the slider to taste.");
  }

  // ---------- Balance ----------
  // One slider: +6 means the vocal is 3 dB louder AND the beat 3 dB quieter (a 6 dB change in balance, with the
  // overall loudness about the same).
  const balanceDb = () => Number(el.balance.value) || 0;
  const vocalGainDb = () => state.vocalBaseDb + balanceDb() / 2;
  const beatGainDb = () => -balanceDb() / 2;

  function paintBalance() {
    const b = balanceDb();
    el.balanceOut.textContent = b === 0 ? "Even" : b > 0 ? `Vocal +${b} dB` : `Beat +${-b} dB`;
  }
  function applyBalance() {
    if (state.chain) state.chain.level.gain.value = dbGain(vocalGainDb());
    if (state.previewing && engine) engine.outGain.gain.value = dbGain(beatGainDb());
  }

  // ---------- The vocal chain (used for the preview and for the download) ----------
  // rumble filter -> gentle compressor -> a little clarity -> level -> (dry + reverb)
  function buildVocalChain(reverbAmount) {
    const hp = new Tone.Filter(90, "highpass");
    const comp = new Tone.Compressor({ threshold: -22, ratio: 3, attack: 0.01, release: 0.18 });
    const clarity = new Tone.Filter({ type: "peaking", frequency: 3200, Q: 0.8, gain: 2 });
    const level = new Tone.Gain(1);
    const out = new Tone.Gain(1);
    const verb = new Tone.Reverb({ decay: 1.6, preDelay: 0.02 });
    verb.wet.value = 1;
    const send = new Tone.Gain(reverbAmount);
    hp.chain(comp, clarity, level, out);
    level.connect(send);
    send.connect(verb);
    verb.connect(out);
    return { input: hp, level, send, output: out, ready: verb.ready };
  }

  const reverbAmount = () => (Number(el.reverb.value) || 0) / 100 * 0.6;

  function toAudioBuffer(take) {
    const buffer = Tone.getContext().rawContext.createBuffer(1, take.samples.length, take.sampleRate);
    buffer.getChannelData(0).set(take.samples);
    return buffer;
  }
  const timingNudge = () => (Number(el.sync.value) || 0) / 1000;

  // ---------- Listening: the beat and the vocal together ----------
  async function playPreview() {
    if (!state.take || state.busy || state.recording) return;
    if (state.previewing) { stopPlayback(""); return; }
    await Tone.start();
    if (!bootAudio()) return;
    if (playing) stopPlayback("");

    disposeChain();
    state.chain = buildVocalChain(reverbAmount());
    state.chain.output.toDestination();
    state.player = new Tone.Player(toAudioBuffer(state.take)).connect(state.chain.input);
    try { await state.chain.ready; } catch (err) { /* nothing to wait for */ }

    state.beatLevel = { sum: 0, count: 0 };
    const from = Number(el.start.value) || 0;
    const t0 = Tone.now() + 0.2;
    state.previewing = true;
    applyBalance();
    startPlayback(from, t0);
    el.play.textContent = "Stop";

    // Where the vocal starts, measured from the moment the beat starts playing
    const songStart = state.take.songStart + timingNudge();
    let when = t0 + (songStart - from * barSec()), offset = 0;
    if (when < t0) { offset = t0 - when; when = t0; }
    const length = state.take.samples.length / state.take.sampleRate;
    if (offset < length) state.player.start(when, offset);
    setStatus("Playing the beat with your vocal.");
    clearInterval(state.meterTimer);
    state.meterTimer = setInterval(() => { if (state.previewing) sampleBeatLevel(); }, 150);
  }

  function endPreview() {
    if (!state.previewing) return;
    state.previewing = false;
    clearInterval(state.meterTimer);
    el.play.textContent = "Play beat + vocal";
    try { if (state.player) state.player.stop(); } catch (err) { /* already stopped */ }
    if (engine) engine.outGain.gain.value = 1;              // the beat is back at normal level for everything else
    setStatus("Stopped.");
  }

  function disposeChain() {
    try { if (state.player) state.player.dispose(); } catch (err) { /* ignore */ }
    try { if (state.chain) [state.chain.input, state.chain.level, state.chain.send, state.chain.output].forEach(n => n.dispose()); } catch (err) { /* ignore */ }
    state.player = null; state.chain = null;
  }

  // ---------- Download ----------
  // The vocal through the same chain, placed on the song's clock, in a render of its own
  async function renderVocal(length, sampleRate) {
    const take = state.take;
    const start = take.songStart + timingNudge();
    const buffer = toAudioBuffer(take);
    const rendered = await Tone.Offline(async () => {
      const chain = buildVocalChain(reverbAmount());
      chain.level.gain.value = dbGain(vocalGainDb());
      chain.output.toDestination();
      const player = new Tone.Player(buffer).connect(chain.input);
      try { await chain.ready; } catch (err) { /* nothing to wait for */ }
      let when = start, offset = 0;
      if (when < 0) { offset = -when; when = 0; }
      if (offset < buffer.duration) player.start(when, offset);
    }, length, 2, sampleRate);
    return rendered.get();
  }

  function addToDownload(blob, name) { downloadBlob(blob, name); }

  async function downloadMix() {
    if (!state.take || state.busy) return;
    state.busy = true;
    setButtons(false);
    try {
      setStatus("Rendering the beat\u2026");
      const beatBuffer = await VoxloopBeatLab.renderCurrentBuffer();
      setStatus("Mixing your vocal in\u2026");
      const vocalBuffer = await renderVocal(beatBuffer.duration, beatBuffer.sampleRate);

      const frames = beatBuffer.length;
      const out = new AudioBuffer({ length: frames, numberOfChannels: 2, sampleRate: beatBuffer.sampleRate });
      const beatGain = dbGain(beatGainDb());
      const vocalL = vocalBuffer.getChannelData(0), vocalR = vocalBuffer.getChannelData(vocalBuffer.numberOfChannels > 1 ? 1 : 0);
      let peak = 0;
      for (let c = 0; c < 2; c++) {
        const beat = beatBuffer.getChannelData(Math.min(c, beatBuffer.numberOfChannels - 1)), vocal = c === 0 ? vocalL : vocalR;
        const dest = out.getChannelData(c);
        for (let i = 0; i < frames; i++) {
          const v = beat[i] * beatGain + (i < vocal.length ? vocal[i] : 0);
          dest[i] = v;
          const a = Math.abs(v);
          if (a > peak) peak = a;
        }
      }
      if (peak > 0.97) {                                     // never clip the file: bring the whole mix down together
        const k = 0.97 / peak;
        for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < frames; i++) d[i] *= k; }
      }
      const bits = Number(($("bl-bits") || {}).value) === 16 ? 16 : 24;
      const wav = encodeAudioBufferWav(out, bits);
      const day = new Date().toISOString().slice(0, 10);
      addToDownload(wav.blob, `voxloop-mix-${day}.wav`);
      setStatus(`Saved your mix (${wav.seconds.toFixed(0)} s, ${(wav.bytes / 1048576).toFixed(1)} MB).`);
    } catch (err) {
      console.error(err);
      setStatus("Could not make the mix: " + err.message);
    } finally {
      state.busy = false;
      setButtons(true);
    }
  }

  // The dry vocal, lined up with the start of the song, so it drops into any other program on top of the beat file
  function dryVocalBuffer() {
    const take = state.take;
    const lead = Math.max(0, Math.round((take.songStart + timingNudge()) * take.sampleRate));
    const cut = Math.max(0, Math.round(-(take.songStart + timingNudge()) * take.sampleRate));
    const length = lead + take.samples.length - cut;
    const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: take.sampleRate });
    buffer.getChannelData(0).set(take.samples.subarray(cut), lead);
    return buffer;
  }

  function downloadVocalOnly() {
    if (!state.take) return;
    const wav = encodeAudioBufferWav(dryVocalBuffer(), 24);
    addToDownload(wav.blob, `voxloop-vocal-${new Date().toISOString().slice(0, 10)}.wav`);
    setStatus("Saved your vocal (dry, lined up with the start of the beat). Use it with the beat download in any other program.");
  }

  async function polishInPipeline() {
    if (!state.take || state.busy) return;
    state.busy = true;
    setButtons(false);
    try {
      const wav = encodeAudioBufferWav(dryVocalBuffer(), 24);
      const file = new File([wav.blob], "my-vocal.wav", { type: "audio/wav" });
      await VoxloopBeatLab.sendToPipeline();                       // loads the beat and opens Pipeline
      const input = document.getElementById("vocal-input");
      if (!input) throw new Error("The Pipeline upload box was not found.");
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (err) {
      console.error(err);
      setStatus("Could not send the vocal: " + err.message);
    } finally {
      state.busy = false;
      setButtons(true);
    }
  }

  // ---------- The take panel ----------
  function showTake() { el.take.hidden = !state.take; }
  function setButtons(enabled) {
    [el.play, el.redo, el.downloadMix, el.downloadVocal, el.polish, el.record, el.auto].forEach(b => { b.disabled = !enabled; });
  }
  function deleteTake() {
    if (state.previewing) stopPlayback("");
    state.take = null;
    disposeChain();
    showTake();
    setStatus("Take deleted. Press Record to make a new one.");
  }

  // ---------- Wiring ----------
  el.record.addEventListener("click", () => { if (state.recording) finishRecording(); else startRecording(); });
  el.play.addEventListener("click", playPreview);
  el.redo.addEventListener("click", deleteTake);
  el.auto.addEventListener("click", () => autoBalance(true));
  el.downloadMix.addEventListener("click", downloadMix);
  el.downloadVocal.addEventListener("click", downloadVocalOnly);
  el.polish.addEventListener("click", polishInPipeline);
  el.balance.addEventListener("input", () => { paintBalance(); applyBalance(); });
  panel.querySelectorAll(".vr-quick [data-bal]").forEach(btn => btn.addEventListener("click", () => {
    el.balance.value = btn.dataset.bal; paintBalance(); applyBalance();
  }));
  el.reverb.addEventListener("input", () => {
    el.reverbOut.textContent = el.reverb.value + "%";
    if (state.chain) state.chain.send.gain.value = reverbAmount();
  });
  el.sync.addEventListener("input", () => { el.syncOut.textContent = `${el.sync.value} ms`; });
  el.sync.addEventListener("change", () => { if (state.previewing) setStatus("Timing changes are heard the next time you press Play."); });

  // The beat stopping (Stop, the end of the song, or a new beat) also ends recording / listening
  playbackStopHooks.push(() => {
    if (state.recording) finishRecording();
    if (state.previewing) endPreview();
  });

  window.VoxloopVocal = { refreshSections, hasTake: () => !!state.take, _state: state };
  refreshSections();
  paintBalance();
})();
