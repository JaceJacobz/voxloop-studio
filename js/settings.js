// =====================================================================
// Settings: one place for recording options, shared by Studio and Beat Lab.
//   VLSettings : the saved options (microphone, mic cleanup, count-in, timing nudge)
//   VLMic      : opens the right microphone (earbuds or the phone's own) and reports which one it got
// Loaded before daw.js and vocalrec.js. Saved in this browser (localStorage); every read has a safe default.
// =====================================================================
(function () {
  "use strict";

  const KEY = "vl-settings";
  const DEFAULTS = {
    micSource: "earbuds",     // "earbuds" (default) or "phone"
    micCleanup: "off",        // call-style processing (noise suppression, echo cancel, auto-gain): "off" is best for singing, "on" if the beat leaks into the mic
    autoMelody: true,         // Autopilot adds a melody that fits the vocal when the beat has none
    micLift: "auto",          // quiet singing: "auto" (up to +30 dB), "normal" (up to +12 dB), "off"
    countIn: false,           // off by default
    countInBars: 1,           // 1 or 2 bars of clicks
    offsetMs: 0               // manual timing nudge, -300..300 ms (positive = vocal later)
  };
  const CHOICES = { micSource: ["earbuds", "phone"], micCleanup: ["off", "on", "auto"], micLift: ["auto", "normal", "off"], countInBars: [1, 2] };

  const data = Object.assign({}, DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    Object.keys(DEFAULTS).forEach(k => { if (saved[k] !== undefined) data[k] = clean(k, saved[k]); });
  } catch (err) { /* private mode or damaged data: keep the defaults */ }

  function clean(key, value) {
    if (CHOICES[key]) return CHOICES[key].includes(value) ? value : DEFAULTS[key];
    if (key === "countIn" || key === "autoMelody") return value === true;
    if (key === "offsetMs") { const n = Number(value); return isFinite(n) ? Math.max(-300, Math.min(300, Math.round(n))) : 0; }
    return value;
  }

  const listeners = [];
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (err) { /* not saved, still works this session */ } }
  function emit(key) { listeners.forEach(fn => { try { fn(key, data[key]); } catch (err) { console.warn(err); } }); }

  const VLSettings = {
    DEFAULTS,
    get: key => data[key],
    set(key, value) { if (!(key in DEFAULTS)) return; data[key] = clean(key, value); save(); emit(key); },
    reset() { Object.assign(data, DEFAULTS); save(); emit("*"); },
    onChange: fn => { listeners.push(fn); },
    report: text => { const e = document.getElementById("st-last"); if (e) e.textContent = text; },

    // Count-in: short clicks on the audio clock (the first one higher), n clicks starting at `when`
    clicks(ctx, when, beatSec, n) {
      for (let i = 0; i < n; i++) {
        const t = when + i * beatSec;
        const accent = i % 4 === 0;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = accent ? 1568 : 1175;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.7, t + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.08);
      }
    }
  };

  // ---------- Microphone ----------
  const EARBUD_RE = /airpods|earbud|buds|earphone|headset|headphone|bluetooth|hands-?free|wired|beats|bose|jabra|\bbt\b/i;
  const PHONE_RE = /built-?in|internal|iphone|ipad|phone|microphone array|front|back|bottom|handset|^microphone$/i;
  const ALIAS_RE = /^(default|communications)\b/i;

  const hasMedia = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  async function listInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    let list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
    if (list.length && !list.some(d => d.label) && hasMedia()) {          // names stay hidden until the mic was allowed once
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach(t => t.stop());
        list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
      } catch (err) { /* blocked: the default mic is used */ }
    }
    return list;
  }

  function classify(list) {
    const real = list.filter(d => d.label && !ALIAS_RE.test(d.label));
    const earbuds = real.filter(d => EARBUD_RE.test(d.label) && !PHONE_RE.test(d.label));
    const phone = real.filter(d => PHONE_RE.test(d.label) && !EARBUD_RE.test(d.label));
    return { earbuds, phone, others: real.filter(d => !earbuds.includes(d) && !phone.includes(d)) };
  }
  const isWireless = label => /bluetooth|airpods|buds|hands-?free|\bbt\b/i.test(label || "");

  // Which input should be used for the chosen source. found = false when none matched (the default mic is used then)
  async function pickDevice(source) {
    const list = await listInputs();
    const groups = classify(list);
    let device = null;
    if (source === "earbuds") device = groups.earbuds[0] || null;
    else device = groups.phone[0] || (groups.earbuds.length ? groups.others[0] : null) || null;
    return { device, found: !!device, labelled: list.some(d => d.label), groups };
  }

  function friendlyError(err) {
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
      return new Error("The microphone is blocked. Allow it for this site in your browser settings, then try again.");
    }
    if (err && err.name === "NotFoundError") return new Error("No microphone found. Plug in your earbuds or check the phone's mic, then try again.");
    return err;
  }

  // Opens the microphone for recording. Returns { stream, label, note, processing, wireless }
  async function open() {
    if (!hasMedia()) throw new Error("This browser cannot use a microphone here. Open the page in Chrome, Edge, Firefox or Safari.");
    const source = VLSettings.get("micSource");
    const cleanup = VLSettings.get("micCleanup");
    // Cleanup (echo cancel, noise gate, auto-gain) hurts a voice sung into earbuds and adds delay; it is only
    // needed when the phone's own mic can hear the speaker.
    const processing = cleanup === "on";            // ("auto", from older versions, now means off: the call-style processing dulls and squashes a voice)

    let pick = { device: null, found: false };
    try { pick = await pickDevice(source); } catch (err) { console.warn("Could not list microphones", err); }

    const base = {
      channelCount: { ideal: 1 }, latency: { ideal: 0 },
      echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing
    };
    let stream = null, note = "";
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: pick.device ? Object.assign({ deviceId: { exact: pick.device.deviceId } }, base) : base });
    } catch (err) {
      if (err && (err.name === "OverconstrainedError" || err.name === "NotFoundError" || err.name === "NotReadableError") && pick.device) {
        pick.found = false;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: base }); } catch (err2) { throw friendlyError(err2); }
      } else if (err && err.name === "OverconstrainedError") {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err2) { throw friendlyError(err2); }
      } else throw friendlyError(err);
    }

    const track = stream.getAudioTracks()[0];
    const label = (track && track.label) || "";
    const got = classify([{ label, deviceId: "" }]);
    const gotEarbuds = got.earbuds.length > 0, gotPhone = got.phone.length > 0;
    if (source === "earbuds") {
      if (!pick.found && !gotEarbuds) note = "No earbuds mic found, so the phone's mic is used.";
      else if (gotPhone) note = "Your browser used the phone's mic instead of the earbuds.";
    } else {
      if (!pick.found && !gotPhone) note = "Could not tell which input is the phone's own mic, so the default input is used.";
      else if (gotEarbuds) note = "Your browser used the earbuds mic instead of the phone's.";
    }
    return { stream, label, note, processing, wireless: isWireless(label) };
  }

  // What the chosen source will use right now (no recording). Used by the Settings tab.
  async function describe() {
    if (!hasMedia()) return "This browser cannot use a microphone here.";
    try {
      const source = VLSettings.get("micSource");
      const pick = await pickDevice(source);
      if (!pick.labelled) return "Press Test mic once and allow the microphone, so this page can see which mics you have.";
      if (pick.found) return "Will use: " + pick.device.label;
      return source === "earbuds"
        ? "No earbuds mic found. The phone's mic is used until you connect earbuds."
        : "Could not tell which input is the phone's own mic. The default input is used.";
    } catch (err) { return "Could not list the microphones."; }
  }

  window.VLSettings = VLSettings;
  window.VLMic = { open, describe, isWireless };

  // ---------- The Settings tab ----------
  const $ = id => document.getElementById(id);
  function wire() {
    if (!$("mode-settings")) return;
    const micRadios = [...document.querySelectorAll('input[name="st-mic"]')];
    const lift = $("st-lift"), cleanup = $("st-cleanup"), countIn = $("st-countin"), bars = $("st-countin-bars"), barsRow = $("st-countin-bars-row");
    const autoMel = $("st-automelody"), offset = $("st-offset"), offsetOut = $("st-offset-out"), now = $("st-mic-now");

    const paint = () => {
      micRadios.forEach(r => { r.checked = r.value === VLSettings.get("micSource"); });
      if (cleanup) cleanup.value = VLSettings.get("micCleanup") === "on" ? "on" : "off";
      if (lift) lift.value = VLSettings.get("micLift");
      if (autoMel) autoMel.checked = VLSettings.get("autoMelody");
      if (countIn) countIn.checked = VLSettings.get("countIn");
      if (bars) bars.value = String(VLSettings.get("countInBars"));
      if (barsRow) barsRow.hidden = !VLSettings.get("countIn");
      if (offset) offset.value = String(VLSettings.get("offsetMs"));
      if (offsetOut) { const v = VLSettings.get("offsetMs"); offsetOut.textContent = (v > 0 ? "+" : "") + v + " ms"; }
    };
    const showMic = async () => { if (now) now.textContent = await describe(); };

    micRadios.forEach(r => r.addEventListener("change", () => { if (r.checked) { VLSettings.set("micSource", r.value); showMic(); } }));
    cleanup?.addEventListener("change", () => VLSettings.set("micCleanup", cleanup.value));
    autoMel?.addEventListener("change", () => VLSettings.set("autoMelody", autoMel.checked));
    lift?.addEventListener("change", () => VLSettings.set("micLift", lift.value));
    countIn?.addEventListener("change", () => VLSettings.set("countIn", countIn.checked));
    bars?.addEventListener("change", () => VLSettings.set("countInBars", Number(bars.value)));
    offset?.addEventListener("input", () => VLSettings.set("offsetMs", Number(offset.value)));
    $("st-reset")?.addEventListener("click", () => { VLSettings.reset(); });
    $("st-refresh")?.addEventListener("click", showMic);
    VLSettings.onChange(paint);
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", showMic);

    // Test mic: opens the chosen mic for 4 seconds, shows its level and name
    const testBtn = $("st-test"), fill = $("st-meter-fill");
    let testing = false;
    testBtn?.addEventListener("click", async () => {
      if (testing) return;
      testing = true; testBtn.disabled = true;
      let mic = null, ctx = null, raf = 0;
      try {
        now.textContent = "Opening the microphone\u2026";
        mic = await open();
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(mic.stream), an = ctx.createAnalyser();
        an.fftSize = 512; src.connect(an);
        const buf = new Uint8Array(an.fftSize), until = performance.now() + 4000;
        now.textContent = "Listening to: " + (mic.label || "the default mic") + (mic.note ? ". " + mic.note : "") + " Say something.";
        await new Promise(resolve => {
          const loop = () => {
            an.getByteTimeDomainData(buf);
            let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
            if (fill) fill.style.width = Math.min(100, Math.round(Math.pow(peak, 0.6) * 100)) + "%";
            if (performance.now() < until) raf = requestAnimationFrame(loop); else resolve();
          };
          loop();
        });
      } catch (err) {
        now.textContent = err.message || "Could not open the microphone.";
      } finally {
        cancelAnimationFrame(raf);
        if (fill) fill.style.width = "0%";
        if (mic) mic.stream.getTracks().forEach(t => t.stop());
        if (ctx) ctx.close().catch(() => {});
        testing = false; testBtn.disabled = false;
        if (mic) setTimeout(showMic, 600);
      }
    });

    paint();
    showMic();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
})();
