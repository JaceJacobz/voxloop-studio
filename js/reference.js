/**
 * Voxloop Studio — Reference & versions
 *
 *  - Load a finished song you like as a REFERENCE.
 *  - Save VERSIONS of your own mix as you work (v1, v2 ...), each rendered with its levels and volume automation.
 *  - Switch between Current mix / versions / reference while it plays. Everything is loudness-matched to your
 *    current mix (so louder never sounds "better"). Versions of your mix switch at the same time position;
 *    the reference plays from its own spot (click the strip to pick the chorus).
 *  - Tone, loudness, width and punch are compared in plain language, with one-tap fixes in the FX Rack.
 *
 * Needs: daw.js (VocalVaultDAW.api.renderMix), levelmatch.js (VocalVaultLevels), studio.js (fft).
 */
(function () {
    "use strict";

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const fmtT = (s) => { const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); };
    const sgn = (v, d) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 1 : d);
    const D = () => window.VocalVaultDAW;
    const api = () => (D() && D().api) || {};

    const BANDS = [
        ["Sub", 30, 60], ["Bass", 60, 150], ["Low-mid", 150, 400], ["Mid", 400, 1000],
        ["Upper-mid", 1000, 2500], ["Presence", 2500, 5000], ["Brilliance", 5000, 10000], ["Air", 10000, 16000]
    ];

    const R = { open: false, sources: [], active: null, ctx: null, node: null, gain: null, t0: 0, p0: 0, playing: false, match: true, busy: "", raf: 0, sigAtRender: "", seq: 0 };
    let panel = null;

    // ------------------------------------------------------------------ analysis
    function channelsOf(buf) { const c = []; for (let i = 0; i < Math.min(2, buf.numberOfChannels); i++) c.push(buf.getChannelData(i)); return c; }
    const tick = () => new Promise((r) => setTimeout(r, 0));

    async function analyze(buf) {
        const sr = buf.sampleRate, ch = channelsOf(buf);
        const maxN = Math.min(ch[0].length, Math.floor(sr * 360));          // look at up to six minutes
        const cut = ch.map((c) => c.subarray(0, maxN));
        const out = {};
        const L = window.VocalVaultLevels && window.VocalVaultLevels.engine;
        out.lufs = L ? L.integrated(L.momentary(L.hopPowers(cut, sr))) : -20;
        await tick();

        // sample peak
        let pk = 0; for (const c of cut) for (let i = 0; i < c.length; i += 3) { const v = Math.abs(c[i]); if (v > pk) pk = v; }
        out.peakDb = 20 * Math.log10(Math.max(pk, 1e-6));
        out.plr = out.peakDb - out.lufs;                     // how much louder the peaks are than the average

        // stereo width: side energy relative to mid energy
        if (cut.length > 1) {
            let m = 0, s = 0;
            for (let i = 0; i < maxN; i += 3) { const a = cut[0][i], b = cut[1][i]; m += (a + b) * (a + b); s += (a - b) * (a - b); }
            out.width = 10 * Math.log10(Math.max(s, 1e-12) / Math.max(m, 1e-12));
        } else out.width = -60;
        await tick();

        // long-term tone: average spectrum in 8 bands (louder parts only, so silence does not skew it)
        const eng = window.VocalVaultStudio && window.VocalVaultStudio.engine;
        const N = 4096, hop = 8192, win = new Float64Array(N);
        for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        const bins = new Float64Array(N / 2);
        const mono = new Float64Array(N), im = new Float64Array(N);
        let frames = 0, energies = [];
        for (let a = 0; a + N <= maxN; a += hop) { let e = 0; for (let i = 0; i < N; i += 8) { const v = cut[0][a + i]; e += v * v; } energies.push(e); }
        const sorted = Float64Array.from(energies).sort(), floor = sorted.length ? sorted[Math.floor(sorted.length * 0.3)] : 0;
        let fi = 0;
        for (let a = 0; a + N <= maxN; a += hop, fi++) {
            if (energies[fi] < floor) continue;
            for (let i = 0; i < N; i++) { let v = cut[0][a + i]; if (cut.length > 1) v = 0.5 * (v + cut[1][a + i]); mono[i] = v * win[i]; im[i] = 0; }
            if (eng && eng.fft) eng.fft(mono, im);
            for (let k = 1; k < N / 2; k++) bins[k] += mono[k] * mono[k] + im[k] * im[k];
            frames++;
            if (frames % 40 === 0) await tick();
        }
        const hz = sr / N, bandP = BANDS.map(([n, lo, hi]) => { let s = 0; for (let k = Math.ceil(lo / hz); k <= Math.min(N / 2 - 1, Math.floor(hi / hz)); k++) s += bins[k]; return s; });
        const tot = bandP.reduce((x, y) => x + y, 0) || 1;
        out.bands = bandP.map((p) => 10 * Math.log10(Math.max(p / tot, 1e-12)));       // each band relative to the total, in dB
        return out;
    }

    function waveformPeaks(buf, cols) {
        const d = buf.getChannelData(0), per = Math.max(1, Math.floor(d.length / cols)), out = new Float32Array(cols);
        for (let c = 0; c < cols; c++) { let m = 0; const a = c * per, b = Math.min(d.length, a + per); for (let i = a; i < b; i += 4) { const v = Math.abs(d[i]); if (v > m) m = v; } out[c] = m; }
        return out;
    }

    // ------------------------------------------------------------------ sources
    function signature() {
        const lanes = (D() && D().lanes) || [], b = (D() && D().beat) || {};
        return JSON.stringify([b.name, b.duration, lanes.map((l) => [l.id, l.muted, l.mixLevel, (l.clips || []).map((c) => [c.id, +c.start.toFixed(3), +c.duration.toFixed(3), (c.fxLog || []).length]), l.auto && l.auto.volume])]);
    }
    const anchor = () => R.sources.find((s) => s.id === "mix") || null;
    const getSrc = (id) => R.sources.find((s) => s.id === id) || null;
    const matchDb = (s) => { const a = anchor(); if (!R.match || !a || !s || s === a || s.lufs == null) return 0; return clamp(a.lufs - s.lufs, -24, 18); };

    async function renderCurrent(label) {
        if (!api().renderMix) { setMsg("This version of Studio can't render the mix."); return null; }
        setMsg("Rendering your mix…");
        const buf = await api().renderMix();
        if (!buf) { setMsg("There is nothing to render yet. Add a beat or a vocal first."); return null; }
        setMsg("Measuring loudness and tone…");
        const a = await analyze(buf);
        setMsg("");
        return Object.assign({ buffer: buf, cursor: 0, peaks: waveformPeaks(buf, 900) }, a);
    }

    async function refreshMix() {
        if (R.busy) return;
        R.busy = "mix"; renderPanel();
        try {
            const s = await renderCurrent();
            if (s) {
                const old = anchor(), isActive = R.active === "mix";
                Object.assign(s, { id: "mix", kind: "mix", name: "Current mix", cursor: old ? old.cursor : 0 });
                R.sources = R.sources.filter((x) => x.id !== "mix"); R.sources.unshift(s);
                R.sigAtRender = signature();
                if (!R.active) R.active = "mix";
                if (isActive && R.playing) switchTo("mix", true);
            }
        } catch (e) { console.warn(e); setMsg("Could not render the mix: " + (e.message || e)); }
        R.busy = ""; renderPanel();
    }

    async function saveVersion() {
        if (R.busy) return;
        R.busy = "version"; renderPanel();
        try {
            const s = await renderCurrent();
            if (s) {
                const n = ++R.seq, nm = ($("#rf-vname") && $("#rf-vname").value.trim()) || "";
                Object.assign(s, { id: "v" + n, kind: "version", name: "Version " + n + (nm ? " · " + nm : ""), at: new Date() });
                R.sources.push(s);
                if (R.sources.filter((x) => x.kind === "version").length > 5) { const first = R.sources.find((x) => x.kind === "version"); R.sources.splice(R.sources.indexOf(first), 1); }
                if (!anchor()) { const m = Object.assign({}, s, { id: "mix", kind: "mix", name: "Current mix" }); R.sources.unshift(m); R.sigAtRender = signature(); }
                if ($("#rf-vname")) $("#rf-vname").value = "";
                setMsg("Saved " + s.name + ". Keep working, then compare.");
            }
        } catch (e) { console.warn(e); setMsg("Could not save the version: " + (e.message || e)); }
        R.busy = ""; renderPanel();
    }

    async function loadReference(file) {
        if (!file) return;
        R.busy = "ref"; setMsg("Reading " + file.name + "…"); renderPanel();
        try {
            const ctx = api().ensureCtx();
            const buf = await ctx.decodeAudioData(await file.arrayBuffer());
            const a = await analyze(buf);
            R.sources = R.sources.filter((s) => s.kind !== "ref");
            R.sources.push(Object.assign({ id: "ref", kind: "ref", name: file.name.replace(/\.[^.]+$/, ""), buffer: buf, cursor: 0, peaks: waveformPeaks(buf, 900) }, a));
            if (!anchor()) await refreshMix();
            setMsg("");
            R.active = "ref";
        } catch (e) { console.warn(e); setMsg("I couldn't read that file. Try an MP3, WAV or M4A."); }
        R.busy = ""; renderPanel();
    }

    // ------------------------------------------------------------------ player (own little transport)
    function pos() { return R.playing && R.ctx ? R.p0 + (R.ctx.currentTime - R.t0) : (getSrc(R.active) || {}).cursor || 0; }

    function stopNode(fade) {
        const n = R.node, g = R.gain; if (!n) return;
        try { const t = R.ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + (fade ? 0.02 : 0.005)); n.stop(t + (fade ? 0.03 : 0.01)); } catch (e) { /* ignore */ }
        R.node = null; R.gain = null;
    }
    function startNode(src, at) {
        const ctx = R.ctx = api().ensureCtx();
        const g = ctx.createGain(), n = ctx.createBufferSource();
        n.buffer = src.buffer; n.connect(g); g.connect(ctx.destination);
        const lin = Math.pow(10, matchDb(src) / 20), t = ctx.currentTime;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lin, t + 0.02);
        at = clamp(at, 0, Math.max(0, src.buffer.duration - 0.05));
        n.start(t, at);
        n.onended = () => { if (R.node === n) { R.playing = false; R.node = null; src.cursor = 0; renderTransport(); } };
        R.node = n; R.gain = g; R.t0 = t; R.p0 = at; R.playing = true;
    }

    function play() {
        const s = getSrc(R.active); if (!s) return;
        if (api().pause) api().pause();
        if (s.id === "mix" && isStale()) { refreshMix().then(() => { const t = getSrc("mix"); if (t) { startNode(t, t.cursor || 0); loop(); renderTransport(); } }); return; }
        startNode(s, s.cursor || 0); loop(); renderTransport();
    }
    function pause() { const s = getSrc(R.active); if (s) s.cursor = pos(); stopNode(true); R.playing = false; renderTransport(); }
    function toggle() { if (R.playing) pause(); else play(); }

    function switchTo(id, force) {
        const from = getSrc(R.active), to = getSrc(id); if (!to) return;
        const aligned = from && from.kind !== "ref" && to.kind !== "ref";
        if (from && R.playing) { from.cursor = pos(); }
        if (aligned && from) to.cursor = from.cursor;
        const wasPlaying = R.playing;
        if (!force && from && id === from.id) return;
        stopNode(true); R.playing = false;
        R.active = id;
        if (wasPlaying) { if (to.id === "mix" && isStale()) { refreshMix().then(() => { const t = getSrc("mix"); startNode(t, t.cursor); loop(); renderPanel(); }); return; } startNode(to, to.cursor || 0); loop(); }
        renderPanel();
    }

    function loop() {
        cancelAnimationFrame(R.raf);
        const f = () => { if (!R.open) return; drawStrip(); const t = $("#rf-time"); if (t) t.textContent = fmtT(pos()) + " / " + fmtT((getSrc(R.active) || { buffer: { duration: 0 } }).buffer.duration); if (R.playing) R.raf = requestAnimationFrame(f); };
        R.raf = requestAnimationFrame(f);
    }

    function isStale() { return R.sigAtRender && signature() !== R.sigAtRender; }

    // ------------------------------------------------------------------ drawing
    function drawStrip() {
        const cv = $("#rf-strip"); const s = getSrc(R.active); if (!cv || !s) return;
        const W = cv.width, H = cv.height, g = cv.getContext("2d"), cols = s.peaks.length;
        const cs = getComputedStyle(document.documentElement), col = (n, d) => cs.getPropertyValue(n).trim() || d;
        g.clearRect(0, 0, W, H);
        g.fillStyle = col("--surface-2", "#1f1b2b"); g.fillRect(0, 0, W, H);
        const p = pos() / s.buffer.duration, mid = H / 2;
        for (let x = 0; x < W; x += 3) {
            const v = s.peaks[Math.floor(x / W * cols)] || 0, db = 20 * Math.log10(Math.max(v, 1e-4)), h = Math.max(2, clamp((db + 54) / 54, 0, 1) * (H - 8));
            g.fillStyle = x / W < p ? col("--accent-hi", "#a894ff") : "rgba(198,194,216,0.45)";
            g.fillRect(x, mid - h / 2, 2, h);
        }
        g.fillStyle = "#fff"; g.fillRect(Math.round(p * W), 0, 2, H);
    }

    function drawTone() {
        const cv = $("#rf-tone"); const a = anchor(), s = getSrc(R.active); if (!cv) return;
        const W = cv.width, H = cv.height, g = cv.getContext("2d");
        const cs = getComputedStyle(document.documentElement), col = (n, d) => cs.getPropertyValue(n).trim() || d;
        g.clearRect(0, 0, W, H);
        if (!a || !s || s === a) return;
        const diff = BANDS.map((b, i) => s.bands[i] - a.bands[i]);       // + means the other source has more of it than your mix
        const mid = H / 2 - 6, scale = (H / 2 - 26) / 8, bw = W / BANDS.length;
        g.strokeStyle = "rgba(255,255,255,0.25)"; g.beginPath(); g.moveTo(0, mid + 0.5); g.lineTo(W, mid + 0.5); g.stroke();
        g.font = "11px system-ui"; g.textAlign = "center";
        BANDS.forEach((b, i) => {
            const d = clamp(diff[i], -8, 8), h = Math.abs(d) * scale, x = i * bw + bw * 0.2, w = bw * 0.6;
            g.fillStyle = Math.abs(diff[i]) >= 2.5 ? col("--warn", "#f6bf4a") : col("--accent", "#7c5cfc");
            g.fillRect(x, d >= 0 ? mid - h : mid, w, Math.max(1, h));
            g.fillStyle = "#f1eff8"; g.fillText(sgn(diff[i]), x + w / 2, d >= 0 ? mid - h - 5 : mid + h + 13);
            g.fillStyle = "rgba(198,194,216,0.7)"; g.fillText(b[0], x + w / 2, H - 4);
        });
    }

    // ------------------------------------------------------------------ advice in plain language
    function tips(s) {
        const a = anchor(); if (!a || !s || s === a) return [];
        const out = [], who = s.kind === "ref" ? "the reference" : s.name;
        const d = BANDS.map((b, i) => s.bands[i] - a.bands[i]);
        const dl = s.lufs - a.lufs;
        if (Math.abs(dl) >= 1.5) out.push({ t: "Your mix is " + Math.abs(dl).toFixed(1) + " LU " + (dl > 0 ? "quieter" : "louder") + " than " + who + " before matching. Everything below is judged at equal loudness." + (dl > 2.5 && s.kind === "ref" ? " If you want to be as loud, raise the master level in Pipeline." : "") });
        else out.push({ t: "Loudness is close to " + who + ".", ok: true });
        const low = (d[0] + d[1]) / 2, mud = d[2], pres = d[5], air = (d[6] + d[7]) / 2;
        if (low >= 2.5) out.push({ t: who[0].toUpperCase() + who.slice(1) + " has more bass (" + sgn(low) + " dB). Try lifting the beat's low end or a bass boost on the beat." });
        else if (low <= -2.5) out.push({ t: "Your mix is bassier than " + who + " (" + sgn(-low) + " dB). If it feels heavy, trim the beat's lows." });
        if (mud <= -2) out.push({ t: "Your mix is boxier around 150–400 Hz (" + sgn(-mud) + " dB more than " + who + ").", fix: { eq: { mudG: -Math.min(3, -mud * 0.5), mudF: 280 } }, fixText: "Add a gentle mud cut on the vocal" });
        if (pres >= 2) out.push({ t: who[0].toUpperCase() + who.slice(1) + " is clearer in the 2.5–5 kHz range (" + sgn(pres) + " dB). Your vocal may be less present.", fix: { eq: { presG: Math.min(3, pres * 0.5), presF: 3500 } }, fixText: "Add presence to the vocal" });
        else if (pres <= -2.5) out.push({ t: "Your mix is harsher around 2.5–5 kHz (" + sgn(-pres) + " dB).", fix: { eq: { presG: -Math.min(3, -pres * 0.5), presF: 3500 } }, fixText: "Soften the vocal's presence" });
        if (air >= 2) out.push({ t: who[0].toUpperCase() + who.slice(1) + " is brighter on top (" + sgn(air) + " dB above 5 kHz).", fix: { eq: { air: Math.min(3, air * 0.5) } }, fixText: "Add air to the vocal" });
        else if (air <= -2.5) out.push({ t: "Your mix is brighter on top than " + who + " (" + sgn(-air) + " dB).", fix: { eq: { air: -Math.min(3, -air * 0.5) } }, fixText: "Roll back the vocal's air" });
        const dw = s.width - a.width;
        if (dw >= 3) out.push({ t: who[0].toUpperCase() + who.slice(1) + " is wider. Try VL Imager or doubles on the backing vocals and adlibs.", fix: { imager: { width: 140 } }, fixText: "Widen with VL Imager" });
        else if (dw <= -4) out.push({ t: "Your mix is wider than " + who + ". Check it still holds up in mono." });
        const dp = a.plr - s.plr;
        if (dp >= 3) out.push({ t: "Your mix is punchier or more peaky than " + who + " (" + dp.toFixed(1) + " dB). More glue compression or a limiter would even it out." });
        else if (dp <= -3) out.push({ t: "Your mix is more squashed than " + who + ". You have room to back off the compression." });
        if (out.length === 1 && out[0].ok) out.push({ t: "Tone is very close, so there's nothing obvious to fix.", ok: true });
        return out;
    }

    // ------------------------------------------------------------------ panel
    function setMsg(m) { const el = $("#rf-msg"); if (el) el.textContent = m || ""; if (m && api().status) api().status(m); }

    function buildPanel() {
        const layout = $(".studio-layout");
        if (!layout || $("#ref-panel")) return;
        panel = document.createElement("section");
        panel.id = "ref-panel"; panel.className = "fx-rack rf-panel hidden";
        const transport = $(".studio-transport", layout);
        layout.insertBefore(panel, transport || null);
        panel.addEventListener("click", onClick);
        panel.addEventListener("change", (e) => {
            if (e.target.id === "rf-file") loadReference(e.target.files[0]);
            if (e.target.id === "rf-match") { R.match = e.target.checked; if (R.playing) { const s = getSrc(R.active); const t = R.ctx.currentTime; R.gain.gain.cancelScheduledValues(t); R.gain.gain.setTargetAtTime(Math.pow(10, matchDb(s) / 20), t, 0.03); } renderPanel(); }
        });
    }

    function injectToolbar() {
        const box = $(".studio-toolbar-actions");
        if (!box || $("#rf-open-btn")) return;
        const b = document.createElement("button");
        b.type = "button"; b.id = "rf-open-btn"; b.className = "secondary-button studio-tool-btn"; b.textContent = "🎯 Reference";
        b.title = "Compare your mix to a song you like, and to earlier versions of your mix";
        box.insertBefore(b, box.firstChild);
        b.addEventListener("click", () => { R.open ? closePanel() : openPanel(); });
    }

    async function openPanel() {
        R.open = true; panel.classList.remove("hidden"); renderPanel();
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        if (!anchor() && (D().beat.buffer || D().lanes.some((l) => l.clips.length))) await refreshMix();
    }
    function closePanel() { pause(); R.open = false; panel.classList.add("hidden"); }

    function onClick(e) {
        const t = e.target.closest("[data-rf]"); if (!t) return;
        const a = t.dataset.rf;
        if (a === "close") closePanel();
        else if (a === "play") toggle();
        else if (a === "ref") $("#rf-file").click();
        else if (a === "save") saveVersion();
        else if (a === "refresh") refreshMix();
        else if (a === "src") switchTo(t.dataset.id);
        else if (a === "del") { const id = t.dataset.id; if (R.active === id) { pause(); R.active = "mix"; } R.sources = R.sources.filter((s) => s.id !== id); renderPanel(); }
        else if (a === "fix") {
            const s = getSrc(R.active), item = tips(s)[+t.dataset.i];
            if (!item || !item.fix || !window.VLRack || !window.VLRack.addPlugin) return;
            Object.keys(item.fix).forEach((type) => window.VLRack.addPlugin(type, item.fix[type], item.fixText + " (from the comparison)"));
            if (api().status) api().status("Added to the FX Rack. Select a part of your vocal and press Preview.");
        }
    }

    function renderPanel() {
        if (!panel) return;
        const a = anchor(), s = getSrc(R.active), stale = a && isStale();
        const row = (x) => {
            const md = matchDb(x), on = R.active === x.id;
            return '<div class="rf-src' + (on ? " is-on" : "") + '"><button type="button" class="rf-src-main" data-rf="src" data-id="' + x.id + '" aria-pressed="' + on + '">' +
                '<span class="rf-dot rf-' + x.kind + '"></span><span class="rf-name">' + esc(x.name) + (x.id === "mix" && stale ? ' <em class="rf-stale">changed, tap Refresh</em>' : "") + "</span>" +
                '<span class="rf-meta">' + x.lufs.toFixed(1) + " LUFS" + (x.id !== "mix" && R.match && a ? " · " + sgn(md) + " dB to match" : "") + "</span></button>" +
                (x.kind !== "mix" ? '<button type="button" class="rf-del" data-rf="del" data-id="' + x.id + '" aria-label="Remove ' + esc(x.name) + '">✕</button>' : "") + "</div>";
        };
        const busy = R.busy ? '<span class="fx-busy">working…</span>' : "";
        let html =
            '<div class="fx-head"><div class="fx-sel"><strong>Reference &amp; versions</strong> <span class="fx-hint">Compare at equal loudness, like a pro.</span></div>' +
            '<div class="fx-head-btns"><button type="button" class="fx-x" data-rf="close" aria-label="Close">✕</button></div></div>' +
            '<div class="fx-pvbar">' +
            '<button type="button" class="fx-btn" data-rf="ref">📂 Load reference song</button><input type="file" id="rf-file" accept="audio/*" hidden>' +
            '<button type="button" class="fx-btn" data-rf="save"' + (R.busy ? " disabled" : "") + '>💾 Save version</button>' +
            '<input type="text" id="rf-vname" class="rf-name-input" placeholder="Version note (optional)" maxlength="40">' +
            '<button type="button" class="fx-btn fx-ghost" data-rf="refresh"' + (R.busy ? " disabled" : "") + '>↻ Refresh current mix</button>' + busy +
            '<span class="fx-status" id="rf-msg"></span></div><div class="fx-body">';
        if (!R.sources.length) {
            html += '<div class="fx-empty">Load a song you love as a <b>reference</b>, and press <b>Save version</b> whenever you reach a mix you might want to come back to. Then switch between them while they play, all at the same loudness.</div>';
        } else {
            html += '<div class="rf-list">' + R.sources.map(row).join("") + "</div>";
            if (s) {
                html += '<div class="rf-player"><button type="button" class="fx-btn fx-play' + (R.playing ? " is-on" : "") + '" id="rf-play" data-rf="play">' + (R.playing ? "■ Pause" : "▶ Play") + "</button>" +
                    '<label class="fx-chk"><input type="checkbox" id="rf-match"' + (R.match ? " checked" : "") + '> Match loudness</label>' +
                    '<span class="rf-time" id="rf-time">' + fmtT(pos()) + " / " + fmtT(s.buffer.duration) + "</span></div>" +
                    '<canvas id="rf-strip" width="900" height="64" class="rf-strip" aria-label="Click to jump to a spot"></canvas>' +
                    '<p class="fx-tip">' + (s.kind === "ref" ? "Click the strip to jump to the part you want to compare, like the chorus. " : "Versions of your mix switch at the same time position. ") + "</p>";
            }
            if (a && s && s !== a) {
                const list = tips(s);
                html += '<div class="rf-section"><strong>' + esc(s.name) + " vs your current mix</strong><span class='fx-hint'> (tone, at equal loudness; bars show how much more or less " + (s.kind === "ref" ? "the reference" : "this version") + " has)</span></div>" +
                    '<canvas id="rf-tone" width="900" height="170" class="rf-tone"></canvas><ul class="rf-tips">' +
                    list.map((x, i) => '<li class="' + (x.ok ? "ok" : "warn") + '">' + esc(x.t) + (x.fix ? ' <button type="button" class="fx-btn rf-fix" data-rf="fix" data-i="' + i + '">' + esc(x.fixText) + "</button>" : "") + "</li>").join("") + "</ul>";
            } else if (a && s === a) html += '<p class="fx-tip">Pick the reference or a version above to see how it differs from your current mix.</p>';
        }
        html += "</div>";
        const msg = $("#rf-msg") ? $("#rf-msg").textContent : "";
        panel.innerHTML = html;
        if ($("#rf-msg")) $("#rf-msg").textContent = msg;
        const strip = $("#rf-strip");
        if (strip) strip.addEventListener("pointerdown", (e) => {
            const r = strip.getBoundingClientRect(), u = clamp((e.clientX - r.left) / r.width, 0, 1), src = getSrc(R.active);
            src.cursor = u * src.buffer.duration;
            if (R.playing) { stopNode(false); startNode(src, src.cursor); } drawStrip();
        });
        drawStrip(); drawTone();
    }
    function renderTransport() { const b = $("#rf-play"); if (b) { b.textContent = R.playing ? "■ Pause" : "▶ Play"; b.classList.toggle("is-on", R.playing); } }

    // ------------------------------------------------------------------ boot
    function init() {
        if (!D()) { setTimeout(init, 200); return; }
        buildPanel(); injectToolbar();
        const play = $("#tr-play"); if (play) play.addEventListener("click", () => { if (R.playing) pause(); });
        $$(".mode-btn").forEach((b) => b.addEventListener("click", () => { if (b.dataset.mode !== "studio" && R.playing) pause(); }));
        setInterval(() => { if (R.open && anchor()) { const st = isStale(), el = $(".rf-stale"); if (st && !el) renderPanel(); else if (!st && el) renderPanel(); } }, 1500);
    }
    window.VLRef = { state: R, analyze, tips, BANDS };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
