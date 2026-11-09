/**
 * Voxloop Studio: Take check
 *
 * Measures a fresh recording and says, in plain words, what limits its quality and what to do about it. Phone vocals are mostly
 * limited by the recording itself (mic, distance, room, the phone's call-style processing), and no later step can add back what
 * was never captured, so this tells the singer BEFORE they sing the next take.
 *
 *   Mic quality   how high the recording reaches (a steep cut at 4-8 kHz means a phone-call style mic or a narrow-band input)
 *   Noise         how far the room is under the voice (signal to noise)
 *   Level         how loud the singing is (very quiet = noisy once lifted)
 *   Clipping      flat-topped peaks (too close, too loud): cannot be repaired
 *   Beat in mic   the beat is audible in the take (speaker bleed): cannot be removed afterwards
 *
 * check({ samples, sr, micRate, label, processing, beat: { buffer, start } }) -> { verdict, findings: [{ id, status, title, detail, tip }] }
 * status: "good" | "warn" | "bad". Measured only: nothing here is a judgement by ear.
 */
(function (root) {
    "use strict";
    const db = (x) => 10 * Math.log10(Math.max(x, 1e-20));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const N = 2048, HOP = 1024;

    const tables = {};
    function fft(re, im) {
        const n = re.length;
        let t = tables[n];
        if (!t) {
            const levels = Math.round(Math.log2(n)), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n);
            for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = Math.sin(2 * Math.PI * k / n); }
            for (let i = 0; i < n; i++) rev[i] = (rev[i >> 1] >> 1) | ((i & 1) << (levels - 1));
            t = tables[n] = { cos, sin, rev };
        }
        for (let i = 0; i < n; i++) { const j = t.rev[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
        for (let size = 2; size <= n; size <<= 1) {
            const half = size >> 1, step = n / size;
            for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
                const a = i + j, b = a + half, tr = re[b] * t.cos[k] + im[b] * t.sin[k], ti = im[b] * t.cos[k] - re[b] * t.sin[k];
                re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
            }
        }
    }
    const pct = (a, q) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

    function check(o) {
        const x = o.samples, sr = o.sr, findings = [];
        const add = (id, status, title, detail, tip) => findings.push({ id, status, title, detail, tip: tip || "" });
        if (!x || x.length < sr * 1.0) return { verdict: "short", findings };

        // ---- frames: level, spectrum
        const frames = Math.floor((x.length - N) / HOP) + 1;
        const lvl = new Float32Array(frames), spec = new Array(frames);
        const re = new Float64Array(N), im = new Float64Array(N), w = new Float64Array(N);
        for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        for (let f = 0; f < frames; f++) {
            let e = 0;
            for (let i = 0; i < N; i++) { const v = x[f * HOP + i]; e += v * v; re[i] = v * w[i]; im[i] = 0; }
            lvl[f] = db(e / N);
            fft(re, im);
            const p = new Float32Array(N / 2); for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
            spec[f] = p;
        }
        const sorted = Float64Array.from(lvl).sort(), top = sorted[Math.floor(frames * 0.92)], low = sorted[Math.floor(frames * 0.1)];
        const thr = Math.max(top - 20, low + 0.45 * (top - low));
        const singing = [], quiet = [];
        for (let f = 0; f < frames; f++) { if (lvl[f] >= thr) singing.push(f); else if (lvl[f] <= low + 0.3 * (thr - low)) quiet.push(f); }

        // ---- level
        const singDb = singing.length ? pct(singing.map((f) => lvl[f]), 0.5) : top;
        if (singDb < -42) add("level", "bad", "Very quiet recording", "Your singing is about " + Math.round(singDb) + " dBFS. Studio lifts it, but it lifts the background noise just as much.", "Hold the phone about 15 cm from your mouth, a little to the side, and sing out more.");
        else if (singDb < -34) add("level", "warn", "Quiet recording", "Your singing is about " + Math.round(singDb) + " dBFS.", "A little closer to the mic (about 15 cm) gives a cleaner result.");
        else add("level", "good", "Good recording level", "Your singing is about " + Math.round(singDb) + " dBFS.");

        // ---- noise: the room between the lines, against the voice
        if (quiet.length >= 4 && singing.length >= 4) {
            const floor = pct(quiet.map((f) => lvl[f]), 0.5), snr = singDb - floor;
            if (snr < 20) add("noise", "bad", "Noisy room", "The background is only " + Math.round(snr) + " dB under your voice (about " + Math.round(floor) + " dBFS).", "Record somewhere quieter: switch off fans and air-con, close the window, and sit away from traffic. Autopilot will clean what it can.");
            else if (snr < 32) add("noise", "warn", "Some background noise", "The background is " + Math.round(snr) + " dB under your voice.", "Autopilot's cleaner will reduce it. A quieter spot gives the best result.");
            else add("noise", "good", "Quiet background", "The background is " + Math.round(snr) + " dB under your voice.");
        }

        // ---- clipping: samples stuck at the top
        let flat = 0, run = 0, maxRun = 0;
        for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) >= 0.985) { run++; flat++; if (run > maxRun) maxRun = run; } else run = 0; }
        if (maxRun >= 3 || flat / x.length > 0.0005) add("clip", maxRun >= 6 ? "bad" : "warn", "Distortion from clipping", "Some peaks are flattened (" + flat + " samples at the maximum). This cannot be repaired afterwards.", "Sing a bit softer or move the phone a little further away, then record that part again.");
        else add("clip", "good", "No clipping", "No flattened peaks.");

        // ---- how high does the recording reach?
        const sel = singing.length >= 4 ? singing : Array.from(lvl.keys());
        const avg = new Float64Array(N / 2);
        sel.forEach((f) => { for (let k = 0; k < N / 2; k++) avg[k] += spec[f][k] / sel.length; });
        const hz = sr / N, band = (a, b) => { let s = 0, c = 0; for (let k = Math.round(a / hz); k < Math.round(b / hz) && k < N / 2; k++) { s += avg[k]; c++; } return db(s / Math.max(1, c)); };
        // a hard band limit shows as a cliff: one 500 Hz band far lower than the one below it, between 3 and 11 kHz
        let cliffAt = 0, cliffDrop = 0;
        for (let f0 = 3000; f0 <= 11000; f0 += 500) {
            if (f0 + 500 > sr / 2 - 300) break;
            const drop = band(f0 - 500, f0) - band(f0, f0 + 500);
            if (drop > cliffDrop) { cliffDrop = drop; cliffAt = f0; }
        }
        const micRate = o.micRate || 0;
        const hfs = [];
        sel.forEach((f) => { let hi = 0, mid = 0; const p = spec[f]; for (let k = Math.round(5000 / hz); k < Math.min(N / 2, Math.round(10000 / hz)); k++) hi += p[k]; for (let k = Math.round(300 / hz); k < Math.round(3000 / hz); k++) mid += p[k]; if (mid > 0) hfs.push(db(hi / Math.max(1e-20, mid))); });
        const hfTop = pct(hfs, 0.9);                       // the airiest moments (breaths, S sounds)
        if (root.__tcDebug) console.log('   [band debug] hfTop=', hfTop.toFixed(1), 'cliff', cliffAt, cliffDrop.toFixed(1));
        if (micRate && micRate <= 16000) add("band", "bad", "Phone-call quality microphone", "The microphone delivered only " + Math.round(micRate / 1000) + " kHz audio, which is phone-call quality (no air, no sparkle).", "Do not use a Bluetooth earbud's mic for singing. Use the phone's own mic or a wired mic.");
        else if ((cliffDrop > 22 && cliffAt <= 5500) || hfTop < -62) add("band", "bad", "Muffled: almost nothing above 5 kHz was captured", "The recording has no air or detail in the top end.", "This usually means a call-style input. Try the phone's own mic, with Mic cleanup set to Off in Settings.");
        else if ((cliffDrop > 22 && cliffAt <= 8500) || hfTop < -48) add("band", "warn", "Slightly dull recording", "Little top end was captured. Typical of a cheap or narrow-band mic.", "Sing a touch closer, at an angle so breaths do not hit the mic, and keep Mic cleanup Off.");
        else add("band", "good", "Good high-end", "The recording reaches the upper range normally.");

        // ---- is the beat audible in the take? (speaker bleed) envelope match in the gaps, with a small time search
        if (o.beat && o.beat.buffer && quiet.length >= 6) {
            const bb = o.beat.buffer, bd = bb.getChannelData(0), bsr = bb.sampleRate, hopS = HOP / sr;
            const beatEnv = (t) => { const i0 = Math.floor(t * bsr), n = Math.floor(HOP / sr * bsr); if (i0 < 0 || i0 + n >= bd.length) return null; let e = 0; for (let i = 0; i < n; i += 2) e += bd[i0 + i] * bd[i0 + i]; return db(e / (n / 2)); };
            const gapFrames = []; for (let f = 0; f < frames; f++) if (lvl[f] < thr) gapFrames.push(f);
            let best = 0;
            for (const lag of [-0.2, -0.1, 0, 0.1, 0.2, 0.3]) {                               // output delay of phones is not exactly known
                const a = [], b2 = [];
                gapFrames.forEach((f) => { const be = beatEnv(o.beat.start + f * hopS + lag); if (be != null) { a.push(lvl[f]); b2.push(be); } });
                if (a.length < 8) continue;
                const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b2.reduce((s, v) => s + v, 0) / b2.length;
                let nu = 0, da = 0, dbb = 0; for (let i = 0; i < a.length; i++) { nu += (a[i] - ma) * (b2[i] - mb); da += (a[i] - ma) ** 2; dbb += (b2[i] - mb) ** 2; }
                const r = nu / Math.sqrt(Math.max(1e-9, da * dbb)); if (r > best) best = r;
            }
            const gapMed = pct(gapFrames.map((f) => lvl[f]), 0.5), gapGap = singDb - gapMed;     // how far under the voice the leak sits
            if (root.__tcDebug) console.log('   [bleed debug] r=', best.toFixed(2), 'gap under voice=', gapGap.toFixed(1));
            if (best > 0.5 && gapGap < 32) add("bleed", "bad", "The beat is leaking into your mic", "Between your lines the recording follows the beat (match " + Math.round(best * 100) + "%), only " + Math.round(gapGap) + " dB under your voice.", "Wear headphones (wired is best) while you record and keep the phone speaker off. It cannot be removed afterwards.");
            else if (best > 0.4 && gapGap < 42) add("bleed", "warn", "A little of the beat is reaching the mic", "Some of the beat is audible between your lines.", "Wear headphones and keep the volume a bit lower.");
        }

        // ---- the input path, for the record
        if (o.processing) add("processing", "warn", "Call-style mic processing was on", "Noise suppression, echo cancel and auto-gain were switched on for this take. They squash and dull a singing voice.", "Turn Mic cleanup Off in Settings (use headphones so the beat does not leak).");

        const bad = findings.filter((f) => f.status === "bad").length, warn = findings.filter((f) => f.status === "warn").length;
        return { verdict: bad ? "needs-work" : warn ? "ok" : "good", findings, stats: { singDb, cliffAt, cliffDrop, micRate, hfTop } };
    }

    // The tips sheet for a take
    function show(clip) {
        const q = clip && clip.quality, UI = root.VLUI;
        if (!q || !UI) return;
        const body = document.createElement("div"); body.className = "tc-list";
        const head = document.createElement("p"); head.className = "tc-verdict";
        head.textContent = q.verdict === "good" ? "This recording is in good shape." : q.verdict === "ok" ? "Good start. A few things would make it sound better." : q.verdict === "short" ? "Too short to check." : "Some things are holding this recording back. Fixing them next time will help more than any effect.";
        body.appendChild(head);
        q.findings.slice().sort((a, b) => ({ bad: 0, warn: 1, good: 2 }[a.status] - { bad: 0, warn: 1, good: 2 }[b.status])).forEach((f) => {
            const row = document.createElement("div"); row.className = "tc-row tc-" + f.status;
            const dot = document.createElement("span"); dot.className = "tc-dot"; dot.setAttribute("aria-label", f.status === "good" ? "fine" : f.status === "warn" ? "could be better" : "needs fixing");
            const txt = document.createElement("div");
            const b = document.createElement("strong"); b.textContent = f.title; txt.appendChild(b);
            if (f.detail && f.status !== "good") { const d = document.createElement("span"); d.textContent = f.detail; txt.appendChild(d); }
            if (f.tip) { const tp = document.createElement("em"); tp.textContent = "Try: " + f.tip; txt.appendChild(tp); }
            row.appendChild(dot); row.appendChild(txt); body.appendChild(row);
        });
        UI.sheet({ title: "Take check: " + (clip.name || "recording"), body, actions: [{ label: "Got it", primary: true }] });
    }

    root.VLTakeCheck = { check, show };
})(typeof window !== "undefined" ? window : this);
