/**
 * Voxloop Studio — Studio-mode UI helpers
 *
 *  1. LIVE RECORDING WAVEFORM (BandLab style): while you record, the armed lane draws bars that grow with
 *     the playhead. Bar height follows the real level in dB, colour shows how hot it is
 *     (teal = good, amber = getting loud, red = clipping). A dB readout + peak hold sits in the transport.
 *  2. The ruler and the lanes now scroll together (before, the ruler stayed behind).
 *  3. A playhead line runs through all lanes, and the view follows the playhead while recording.
 *
 * daw.js calls VLRecWave.start() / .stop() and VLStudioUI.afterRender() (4 one-line hooks).
 */
(function () {
    "use strict";

    const BAR = 3, GAP = 1, STEP = BAR + GAP, FLOOR = -54, CAP = 8192, H = 72;
    const COL = { good: "#3fd0b8", warm: "#f6bf4a", hot: "#ff5468" };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const dbH = (db) => clamp((db - FLOOR) / -FLOOR, 0, 1);
    const fmtT = (s) => { const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); };
    const fmtDb = (db) => (db <= -90 ? "−∞" : (db <= 0 ? "−" : "+") + Math.abs(db).toFixed(1)) + " dB";

    const S = { active: false, o: null, peaks: [], el: null, cv: null, tag: null, analyser: null, src: null, buf: null, raf: 0, last: 0, hold: -90, holdAt: 0, clips: 0, lastExtend: 0, maxDb: -90 };
    const $ = (s) => document.querySelector(s);

    // ------------------------------------------------------------ transport readout
    function readoutEls() {
        const meter = $(".tr-meter");
        if (!meter) return {};
        let peak = meter.querySelector(".tr-meter-peak");
        if (!peak) { peak = document.createElement("div"); peak.className = "tr-meter-peak"; meter.appendChild(peak); }
        let db = $("#tr-db");
        if (!db) { db = document.createElement("span"); db.id = "tr-db"; db.className = "tr-db"; db.textContent = ""; meter.parentNode.insertBefore(db, meter.nextSibling); }
        return { meter, peak, db, fill: $("#tr-meter-fill") };
    }

    // ------------------------------------------------------------ the live clip element in the armed lane
    function ensureEl() {
        const o = S.o;
        const track = document.querySelector('.studio-lane[data-lane-id="' + o.laneId + '"] .studio-lane-track');
        if (!track) return null;
        if (S.el && S.el.isConnected && S.el.parentNode === track) return S.el;
        const el = document.createElement("div");
        el.className = "studio-clip is-live";
        el.style.left = (o.startOffset * o.pxPerSec) + "px";
        el.style.width = "4px";
        const cv = document.createElement("canvas");
        cv.className = "live-wave"; cv.height = H; cv.width = 64;
        const tag = document.createElement("span");
        tag.className = "live-tag"; tag.textContent = "● REC";
        el.appendChild(cv); el.appendChild(tag);
        track.appendChild(el);
        S.el = el; S.cv = cv; S.tag = tag;
        const row = track.closest(".studio-lane"); if (row) row.classList.add("is-recording-lane");
        return el;
    }

    function colourFor(db) { return db >= -1 ? COL.hot : db >= -6 ? COL.warm : COL.good; }

    function draw() {
        const el = ensureEl(); if (!el) return;
        const o = S.o, nb = S.peaks.length;
        const need = nb * STEP, scale = need > CAP ? CAP / need : 1;
        const pos = o.getPlayhead(), rel = Math.max(0, pos - o.startOffset);
        el.style.width = Math.max(4, rel * o.pxPerSec) + "px";
        const w = Math.max(8, Math.ceil(need * scale));
        const cv = S.cv;
        if (cv.width < w || cv.width > w + 1024) cv.width = w + 256;       // grow in chunks; a resize clears, we redraw anyway
        const g = cv.getContext("2d");
        g.clearRect(0, 0, cv.width, cv.height);
        const mid = H / 2, bw = Math.max(1, BAR * scale), st = STEP * scale;
        // zero line
        g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(0, mid - 0.5, cv.width, 1);
        for (let i = 0; i < nb; i++) {
            const db = S.peaks[i];
            const h = Math.max(2, dbH(db) * (H - 10));
            g.fillStyle = colourFor(db);
            const x = i * st, y = mid - h / 2;
            if (g.roundRect) { g.beginPath(); g.roundRect(x, y, bw, h, Math.min(1.5, bw / 2)); g.fill(); } else g.fillRect(x, y, bw, h);
        }
        // the canvas is allocated in chunks, so scale it until the drawn bars exactly fill the clip
        cv.style.height = "100%";
        cv.style.width = (cv.width / w * 100) + "%";
        S.tag.textContent = "● REC  " + fmtT(rel) + (S.clips ? "   ⚠ clipping" : "");
        S.tag.classList.toggle("is-clip", !!S.clips);
    }

    function frame(ts) {
        if (!S.active) return;
        const o = S.o, dt = Math.max(8, Math.min(100, ts - (S.last || ts - 16)));
        S.last = ts;
        S.analyser.getFloatTimeDomainData(S.buf);
        const n = clamp(Math.round(o.sampleRate * dt / 1000), 256, S.buf.length);
        let pk = 0;
        for (let i = S.buf.length - n; i < S.buf.length; i++) { const v = Math.abs(S.buf[i]); if (v > pk) pk = v; }
        const db = pk > 1e-5 ? 20 * Math.log10(pk) : -90;

        const rel = Math.max(0, o.getPlayhead() - o.startOffset);
        const bar = Math.floor(rel * o.pxPerSec / STEP);
        while (S.peaks.length <= bar) S.peaks.push(-90);
        if (db > S.peaks[bar]) S.peaks[bar] = db;
        if (db >= -0.5) S.clips++;
        if (db > S.maxDb) S.maxDb = db;

        // peak hold falls slowly (12 dB / second)
        if (db >= S.hold) { S.hold = db; S.holdAt = ts; } else S.hold = Math.max(db, S.hold - 12 * (dt / 1000));

        const r = readoutEls();
        if (r.fill) { r.fill.style.width = (dbH(db) * 100) + "%"; }
        if (r.peak) r.peak.style.left = (dbH(S.hold) * 100) + "%";
        if (r.db) { r.db.textContent = fmtDb(S.hold); r.db.className = "tr-db " + (S.hold >= -1 ? "is-hot" : S.hold >= -6 ? "is-warm" : ""); }

        draw();
        follow(rel);
        extend(ts);
        S.raf = requestAnimationFrame(frame);
    }

    // keep the playhead in view while recording
    function follow() {
        const host = $("#studio-lanes"); if (!host) return;
        const head = host.querySelector(".studio-lane-head"), hw = head ? head.offsetWidth : 0;
        const x = hw + S.o.getPlayhead() * S.o.pxPerSec;
        const right = host.scrollLeft + host.clientWidth;
        if (x > right - host.clientWidth * 0.12) host.scrollLeft = x - host.clientWidth * 0.55;
    }
    // the ruler and lane tracks need to be longer than the beat while you record past its end
    function extend(ts) {
        if (ts - S.lastExtend < 1500) return;
        S.lastExtend = ts;
        const need = (S.o.getPlayhead() + 12) * S.o.pxPerSec;
        document.querySelectorAll(".studio-lane-track").forEach((t) => { if ((parseFloat(t.style.minWidth) || 0) < need) t.style.minWidth = need + "px"; });
        if (S.o.drawRuler) S.o.drawRuler();
    }

    function start(o) {
        stop(true);
        try {
            const ctx = o.ctx;
            S.o = Object.assign({ sampleRate: ctx.sampleRate }, o);
            S.analyser = ctx.createAnalyser();
            S.analyser.fftSize = 2048; S.analyser.smoothingTimeConstant = 0;
            S.src = ctx.createMediaStreamSource(o.stream); S.src.connect(S.analyser);
            S.buf = new Float32Array(S.analyser.fftSize);
        } catch (e) { console.warn("[recwave] could not listen to the mic", e); return; }
        S.peaks = []; S.el = null; S.cv = null; S.tag = null; S.hold = -90; S.clips = 0; S.maxDb = -90; S.last = 0; S.lastExtend = 0;
        S.active = true; window.VLRecWave.active = true;
        document.body.classList.add("is-live-rec");
        S.raf = requestAnimationFrame(frame);
    }

    function stop(silent) {
        if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0;
        const was = S.active;
        S.active = false; window.VLRecWave.active = false;
        try { if (S.src) S.src.disconnect(); } catch (e) { /* ignore */ }
        S.src = null; S.analyser = null;
        document.body.classList.remove("is-live-rec");
        const r = readoutEls();
        if (r.fill) r.fill.style.width = "0%";
        if (r.peak) r.peak.style.left = "0%";
        if (r.db) { r.db.textContent = was && !silent ? "peak " + fmtDb(S.maxDb) : ""; r.db.className = "tr-db"; setTimeout(() => { if (!S.active && r.db) r.db.textContent = ""; }, 6000); }
        if (S.el && S.el.isConnected) {
            // the real clip replaces this once the take has been decoded; dim it until then
            S.el.classList.add("is-finishing");
            if (S.tag) S.tag.textContent = "Saving take…";
            const el = S.el;
            setTimeout(() => { if (el.isConnected) el.remove(); }, 8000);
        }
        document.querySelectorAll(".studio-lane.is-recording-lane").forEach((n) => n.classList.remove("is-recording-lane"));
        S.el = null;
    }

    // ------------------------------------------------------------ ruler sync + playhead line
    let line = null, headW = 0;
    function ensureLine() {
        const host = $("#studio-lanes"); if (!host) return null;
        if (!line || !line.isConnected) { line = document.createElement("div"); line.className = "studio-playline"; line.setAttribute("aria-hidden", "true"); host.appendChild(line); }
        return line;
    }
    function placeLine() {
        const host = $("#studio-lanes"), ph = $("#studio-playhead"); if (!host || !ph) return;
        const l = ensureLine(); if (!l) return;
        const m = /translateX\(([-\d.]+)px\)/.exec(ph.style.transform || "");
        const x = m ? parseFloat(m[1]) : 0;
        l.style.transform = "translateX(" + (headW + x) + "px)";
    }
    function afterRender() {
        const host = $("#studio-lanes"); if (!host) return;
        const head = host.querySelector(".studio-lane-head");
        headW = head ? head.offsetWidth : 0;
        const l = ensureLine();
        if (l) { l.style.height = Math.max(host.scrollHeight, host.clientHeight) + "px"; l.hidden = !host.querySelector(".studio-lane"); }
        placeLine();
        if (S.active) { S.el = null; }      // the lanes were rebuilt: the live clip is recreated on the next frame
    }

    function init() {
        const host = $("#studio-lanes"), rs = $("#studio-ruler-scroll");
        if (!host || host.dataset.uiBound) return;
        host.dataset.uiBound = "1";
        if (rs) host.addEventListener("scroll", () => { rs.scrollLeft = host.scrollLeft; }, { passive: true });
        const ph = $("#studio-playhead");
        if (ph) new MutationObserver(placeLine).observe(ph, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", afterRender);
        afterRender();
    }

    window.VLRecWave = { start, stop, active: false, _state: S };
    window.VLStudioUI = { afterRender };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
