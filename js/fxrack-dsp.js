/**
 * Voxloop Studio — FX Rack: plugin library (DSP only, no UI)
 *
 * Every plugin is:  { id, name, cat, blurb, easy:[param keys], params:[...], presets:{...}, process(channels, sr, p, env) }
 * process() takes plain Float32Array channels and returns (a Promise of) { channels } — possibly LONGER than the
 * input (reverb / echo tails). The rack decides how to place the tail.
 *
 * These are Voxloop's own tools that do the same JOB as well-known plugins (tuner, EQ, compressor, reverb,
 * stereo imager, auto-pan ...). They are not copies of any brand's plugin.
 */
(function (root) {
    "use strict";

    const TAU = Math.PI * 2;
    const dbLin = (d) => Math.pow(10, d / 20);
    const linDb = (l) => 20 * Math.log10(Math.max(l, 1e-9));
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function mulberry(seed) {
        let a = seed >>> 0;
        return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    const copy = (ch) => ch.map((c) => Float32Array.from(c));
    const stereo = (ch) => (ch.length >= 2 ? [ch[0], ch[1]] : [ch[0], Float32Array.from(ch[0])]);
    function padTo(ch, n) { return ch.map((c) => { if (c.length >= n) return c; const o = new Float32Array(n); o.set(c); return o; }); }
    function mono(ch) {
        if (ch.length === 1) return ch[0];
        const o = new Float32Array(ch[0].length);
        for (const c of ch) for (let i = 0; i < o.length; i++) o[i] += c[i] / ch.length;
        return o;
    }
    function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); }
    function peak(ch) { let p = 0; for (const c of ch) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; } return p; }

    // ---------- tiny RBJ biquad (used in places where native nodes are awkward) ----------
    function bqCoef(type, f, sr, q, gDb) {
        f = clamp(f, 10, sr * 0.49); q = q || 0.7071;
        const w = TAU * f / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, (gDb || 0) / 40);
        let b0, b1, b2, a0, a1, a2;
        if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
        else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
        else if (type === "bp") { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
        else if (type === "peak") { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
        else { // high shelf
            const sq = 2 * Math.sqrt(A) * al;
            b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq);
            a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq;
        }
        return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    }
    function bqRun(x, c) {
        const y = new Float32Array(x.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < x.length; i++) {
            const v = x[i], o = c[0] * v + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
            x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
        }
        return y;
    }

    // ---------- run native Web Audio nodes offline ----------
    async function runOffline(channels, sr, tailSec, outCh, build) {
        const n0 = channels[0].length, n = n0 + Math.max(0, Math.round(tailSec * sr));
        const ctx = new OfflineAudioContext(outCh, n, sr);
        const buf = ctx.createBuffer(channels.length, n0, sr);
        channels.forEach((c, i) => buf.copyToChannel(c, i));
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const out = build(ctx, src, buf);
        out.connect(ctx.destination);
        src.start(0);
        const r = await ctx.startRendering();
        const res = [];
        for (let c = 0; c < outCh; c++) res.push(Float32Array.from(r.getChannelData(c)));
        return res;
    }

    // =====================================================================
    // PITCH WORKER (runs the existing tune engine from pitchcorrect.js off the main thread)
    // =====================================================================
    function createTasks(engine) {
        const clampL = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        return {
            analyze(a) {
                const track = engine.trackClean(a.mono, a.sr);
                const notes = engine.segmentNotes(track.midi);
                let stats = null;
                try { stats = engine.measure(track, { rootPc: a.rootPc || 0, scale: a.scale || "major", refCents: 0 }); } catch (e) { stats = null; }
                let keyFit = null;
                try { keyFit = engine.estimateTuning ? null : null; } catch (e) { keyFit = null; }
                return { hop: track.hop, sr: a.sr, midi: track.midi, notes, stats, keyFit };
            },
            tune(a) {
                const r = engine.process(a.channels, a.sr, a.options, function () { });
                return { channels: r.audio.tuned, stats: r.stats, corrected: r.corrected, notes: r.notes, keyFit: r.keyFit || null, transpose: r.transposeTotal != null ? r.transposeTotal : (r.transposeAuto || 0) };
            },
            edit(a) {
                const mono = engine.mixDown(a.channels);
                const track = engine.trackClean(mono, a.sr);
                const notes = engine.segmentNotes(track.midi);
                const frames = track.midi.length;
                const shift = new Float32Array(frames);
                const vf = a.variation == null ? 1 : a.variation;
                for (const nt of notes) {
                    const move = (a.moves && a.moves[nt.start]) || 0;     // semitones
                    const target = nt.center + move;
                    for (let k = nt.start; k < nt.end && k < frames; k++) {
                        const m = track.midi[k];
                        if (isNaN(m)) continue;
                        const newM = target + (m - nt.center) * vf;
                        shift[k] = (newM - m) * 100;
                    }
                }
                // soften the steps between notes (about 25 ms)
                const sm = new Float32Array(frames);
                for (let k = 0; k < frames; k++) {
                    let s = 0, c = 0;
                    for (let j = -2; j <= 2; j++) { const i = k + j; if (i >= 0 && i < frames) { s += shift[i]; c++; } }
                    sm[k] = isNaN(track.midi[k]) ? 0 : s / c;
                }
                const out = engine.applyShift(a.channels, mono, a.sr, track, sm, { force: false });
                return { channels: out };
            },
            harmonize(a) {
                const r = engine.harmonize(a.channels, a.sr, a.options, function () { });
                return { channels: r.audio.harmony };
            },
            shiftConst(a) {
                const mono = engine.mixDown(a.channels);
                const track = engine.trackClean(mono, a.sr);
                const shift = new Float32Array(track.midi.length).fill(a.cents);
                const out = engine.applyShift(a.channels, mono, a.sr, track, shift, { force: true });
                return { channels: out };
            }
        };
    }

    let workerUrl = null;
    function runTask(task, args) {
        const hasEngine = typeof root.createTuneEngine === "function";
        if (!hasEngine) return Promise.reject(new Error("pitchcorrect.js is not loaded"));
        const copyArgs = Object.assign({}, args);
        if (args.channels) copyArgs.channels = args.channels.map((c) => Float32Array.from(c));
        if (args.mono) copyArgs.mono = Float32Array.from(args.mono);

        const here = () => {
            const tasks = createTasks(root.createTuneEngine());
            return Promise.resolve(tasks[task](copyArgs));
        };
        if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return here();

        return new Promise((resolve, reject) => {
            let worker;
            try {
                if (!workerUrl) {
                    const src = "const engine = (" + root.createTuneEngine.toString() + ")();\n" +
                        "const tasks = (" + createTasks.toString() + ")(engine);\n" +
                        "self.onmessage = function (e) {\n" +
                        "  try {\n" +
                        "    const r = tasks[e.data.task](e.data.args);\n" +
                        "    const t = [];\n" +
                        "    if (r.channels) r.channels.forEach(function (c) { t.push(c.buffer); });\n" +
                        "    if (r.midi) t.push(r.midi.buffer);\n" +
                        "    self.postMessage({ result: r }, t);\n" +
                        "  } catch (err) { self.postMessage({ error: String(err && err.stack || err) }); }\n" +
                        "};";
                    workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
                }
                worker = new Worker(workerUrl);
            } catch (e) { here().then(resolve, reject); return; }
            worker.onmessage = (ev) => {
                worker.terminate();
                if (ev.data.error) reject(new Error(ev.data.error)); else resolve(ev.data.result);
            };
            worker.onerror = (ev) => { worker.terminate(); here().then(resolve, reject); };
            worker.postMessage({ task, args: copyArgs });
        });
    }

    // =====================================================================
    // SMALL DSP BUILDING BLOCKS
    // =====================================================================

    // Waveform for LFOs, phase in radians
    function lfo(shape, ph) {
        const u = ((ph / TAU) % 1 + 1) % 1;
        switch (shape) {
            case "triangle": return 1 - 4 * Math.abs(u - 0.5);
            case "saw": return 2 * u - 1;
            case "square": return Math.tanh(4 * Math.sin(ph));
            default: return Math.sin(ph);
        }
    }

    function onePole(x, hz, sr, high) {
        const a = Math.exp(-TAU * hz / sr), y = new Float32Array(x.length);
        let s = 0;
        for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = high ? x[i] - s : s; }
        return y;
    }

    // Reverb impulse response with its own decay for lows / mids / highs ("decay rate EQ")
    const irCache = new Map();
    function makeIR(sr, p) {
        const key = [sr, p.decay, p.predelay, p.size, p.lowMul, p.highMul, p.midBoost, p.highDip, p.hp, p.lp, p.width].join("|");
        if (irCache.has(key)) return irCache.get(key);
        const decay = clamp(p.decay, 0.2, 8), pre = Math.round(clamp(p.predelay, 0, 250) / 1000 * sr);
        const len = pre + Math.round(decay * 1.15 * sr);
        const out = [new Float32Array(len), new Float32Array(len)];
        const shared = mulberry(99);
        const sh = new Float32Array(len); for (let i = 0; i < len; i++) sh[i] = shared() * 2 - 1;
        const wid = clamp(p.width, 0, 1);
        const early = [0.011, 0.017, 0.023, 0.031, 0.043, 0.059, 0.071, 0.089];
        for (let c = 0; c < 2; c++) {
            const r = mulberry(4000 + c * 733);
            const nz = new Float32Array(len);
            for (let i = 0; i < len; i++) nz[i] = (1 - wid * 0.9) * sh[i] + (0.3 + 0.7 * wid) * (r() * 2 - 1);
            const lowB = bqRun(bqRun(nz, bqCoef("lp", 350, sr, 0.7)), bqCoef("lp", 350, sr, 0.7));
            const highB = bqRun(bqRun(nz, bqCoef("hp", 3200, sr, 0.7)), bqCoef("hp", 3200, sr, 0.7));
            const midB = new Float32Array(len);
            for (let i = 0; i < len; i++) midB[i] = nz[i] - lowB[i] - highB[i];
            const rl = decay * clamp(p.lowMul, 0.2, 2), rm = decay, rh = decay * clamp(p.highMul, 0.1, 1.5);
            const x = out[c];
            for (let i = pre; i < len; i++) {
                const t = (i - pre) / sr;
                const ramp = Math.min(1, t / (0.004 + 0.03 * p.size));          // soft start so the tail does not click in
                x[i] = ramp * (lowB[i] * Math.pow(10, -3 * t / rl) + midB[i] * 1.4 * Math.pow(10, -3 * t / rm) + highB[i] * 0.9 * Math.pow(10, -3 * t / rh));
            }
            early.forEach((sec, k) => {
                const at = pre + Math.round((sec * (0.6 + p.size) + c * 0.0017 * (k + 1)) * sr);
                if (at < len) x[at] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.8, k);
            });
            let y = x;
            if (p.midBoost) y = bqRun(y, bqCoef("peak", 650, sr, 0.8, p.midBoost));
            if (p.highDip) y = bqRun(y, bqCoef("hs", 8000, sr, 0.7, -Math.abs(p.highDip)));
            if (p.hp > 20) { const k = bqCoef("hp", p.hp, sr, 0.7071); y = bqRun(bqRun(y, k), k); }
            if (p.lp > 0 && p.lp < sr * 0.45) { const k = bqCoef("lp", p.lp, sr, 0.7071); y = bqRun(bqRun(y, k), k); }
            const fade = Math.round(0.08 * sr);
            for (let i = 0; i < fade && i < len; i++) y[len - 1 - i] *= i / fade;
            out[c] = Float32Array.from(y);
        }
        let e = 0;
        for (let c = 0; c < 2; c++) for (let i = 0; i < len; i++) e += out[c][i] * out[c][i];
        const g = 1 / Math.sqrt(e / 2);
        for (let c = 0; c < 2; c++) for (let i = 0; i < len; i++) out[c][i] *= g;
        if (irCache.size > 6) irCache.clear();
        irCache.set(key, out);
        return out;
    }

    // Time stretch without changing pitch (WSOLA). Used by the "character" voice change.
    function wsola(x, sr, stretch) {
        const win = Math.round(0.035 * sr) & ~1, hs = win >> 1, ha = hs / stretch, tol = Math.round(0.009 * sr);
        const outLen = Math.round(x.length * stretch);
        const out = new Float32Array(outLen + win), wsum = new Float32Array(outLen + win);
        const w = new Float32Array(win); for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos(TAU * (i + 0.5) / win);
        let prev = 0, m = 0;
        for (let o = 0; o < outLen; o += hs, m++) {
            const nominal = Math.round(m * ha);
            let best = nominal;
            if (m > 0) {
                const ref = prev + hs;
                let bestC = -1e30;
                for (let d = -tol; d <= tol; d += 2) {
                    const s = nominal + d;
                    if (s < 0 || s + win > x.length || ref + win > x.length) continue;
                    let c = 0;
                    for (let i = 0; i < win; i += 3) c += x[s + i] * x[ref + i];
                    if (c > bestC) { bestC = c; best = s; }
                }
            }
            if (best + win > x.length) best = Math.max(0, x.length - win);
            for (let i = 0; i < win; i++) { out[o + i] += x[best + i] * w[i]; wsum[o + i] += w[i]; }
            prev = best;
        }
        const r = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) r[i] = wsum[i] > 1e-4 ? out[i] / wsum[i] : 0;
        return r;
    }
    function resample(x, ratio) { // ratio>1 = reads faster (higher pitch, shorter)
        const n = Math.floor(x.length / ratio), y = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const p = i * ratio, k = Math.floor(p), f = p - k;
            const a = x[k], b = x[Math.min(x.length - 1, k + 1)];
            y[i] = a + (b - a) * f;
        }
        return y;
    }

    // =====================================================================
    // PLUGINS
    // =====================================================================
    const P = {};
    const R = (k, label, min, max, step, def, unit, extra) => Object.assign({ k, label, min, max, step, def, unit: unit || "", type: "range" }, extra || {});
    const S = (k, label, options, def, extra) => Object.assign({ k, label, options, def, type: "select" }, extra || {});

    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const SCALE_OPTS = ["major", "minor", "dorian", "mixolydian", "lydian", "phrygian"];

    // ---- Tune (auto pitch correction) ----
    P.tune = {
        id: "tune", name: "VL Tune", cat: "Pitch", icon: "p-tune",
        blurb: "Snaps sung notes to the song's key so nothing sounds off. Low retune speed = fast, obvious tuning.",
        likeA: "Auto-Tune style",
        easy: ["amount", "speed", "key", "scale"],
        params: [
            R("amount", "Mix", 0, 100, 1, 100, "%", { easyLabel: "How much tuning" }),
            R("speed", "Retune speed", 1, 300, 1, 25, " ms", { easyLabel: "Natural ← → Robotic", invert: true }),
            S("key", "Key", ["auto"].concat(NOTE_NAMES), "auto", { easyLabel: "Song key" }),
            S("scale", "Scale", SCALE_OPTS, "major", { easyLabel: "Major or minor" }),
            R("flex", "Flex-Tune", 0, 100, 1, 0, "", {}),
            R("vibrato", "Natural vibrato kept", 0, 1.5, 0.05, 0.5, "", {}),
            R("humanize", "Humanize", 0, 100, 1, 0, "", {}),
            R("transpose", "Transpose", -12, 12, 1, 0, " st", {}),
            R("detune", "Detune (A = Hz)", 420, 460, 0.5, 440, " Hz", {})
        ],
        presets: {
            "Default": {},
            "Natural": { speed: 70, humanize: 60, flex: 25, vibrato: 0.9 },
            "Modern pop": { speed: 25 },
            "Hard (T-Pain)": { speed: 3, humanize: 0, flex: 0, vibrato: 0.2 }
        },
        async process(ch, sr, p, env) {
            let rootPc = 0, scale = p.scale, chromatic = false;
            if (p.key === "auto") {
                if (env && env.key) { rootPc = env.key.rootPc; scale = env.key.scale || scale; }
                else chromatic = true;
            } else rootPc = Math.max(0, NOTE_NAMES.indexOf(p.key));
            const options = {
                rootPc, scale, chromatic, refCents: 1200 * Math.log2((p.detune || 440) / 440),
                strength: 1, retuneMs: p.speed, selective: p.flex > 0, selectiveCents: Math.max(4, p.flex * 0.6), selectiveSoftCents: Math.max(10, p.flex * 1.2),
                flatten: 0.6 * (1 - p.humanize / 100), vibratoAmount: p.vibrato, manualSemitones: Math.round(p.transpose),
                adaptive: false, autoTranspose: false
            };
            const r = await runTask("tune", { channels: ch, sr, options });
            let out = r.channels;
            if (p.amount < 100) {
                const w = p.amount / 100;
                out = out.map((c, i) => { const d = ch[Math.min(i, ch.length - 1)], o = new Float32Array(c.length); for (let k = 0; k < o.length; k++) o[k] = d[k] * (1 - w) + c[k] * w; return o; });
            }
            return { channels: out, info: r };
        }
    };

    // ---- Pitch editor (blob editor: moves per note + pitch variation) ----
    P.pitchedit = {
        id: "pitchedit", name: "VL Pitch Editor", cat: "Pitch", icon: "p-pitchedit",
        blurb: "Grab a note blob and drag it up or down to fix it by hand. The Variation knob calms (or exaggerates) wobble inside notes.",
        likeA: "Melodyne style",
        easy: ["variation"],
        params: [R("variation", "Pitch variation", 0, 200, 1, 100, "%", { easyLabel: "Wobble: steady ← → expressive" })],
        hidden: { moves: {} },
        presets: { "Default": {}, "Steadier": { variation: 55 }, "Flat & robotic": { variation: 0 }, "More expressive": { variation: 150 } },
        async process(ch, sr, p) {
            const r = await runTask("edit", { channels: ch, sr, moves: p.moves || {}, variation: (p.variation == null ? 100 : p.variation) / 100 });
            return { channels: r.channels };
        }
    };

    // ---- EQ ----
    P.eq = {
        id: "eq", name: "VL EQ", cat: "Tone", icon: "p-eq",
        blurb: "Shapes the tone: cut rumble and mud, add presence and air.",
        likeA: "Pro-Q / Parametric EQ style",
        easy: ["hp", "mudG", "presG", "air"],
        params: [
            R("hp", "Low cut", 0, 400, 1, 90, " Hz", { easyLabel: "Remove rumble" }),
            R("lowShelf", "Low shelf (120 Hz)", -12, 12, 0.5, 0, " dB", {}),
            R("mudG", "Mud cut gain", -12, 6, 0.5, 0, " dB", { easyLabel: "Boxy/muddy cut →", invert: true }),
            R("mudF", "Mud cut freq", 150, 600, 1, 300, " Hz", {}),
            R("midG", "Bell gain", -12, 12, 0.5, 0, " dB", {}),
            R("midF", "Bell freq", 400, 5000, 1, 2500, " Hz", {}),
            R("midQ", "Bell width (Q)", 0.3, 6, 0.1, 1, "", {}),
            R("presG", "Presence gain", -8, 8, 0.5, 0, " dB", { easyLabel: "Softer ← → clearer" }),
            R("presF", "Presence freq", 2000, 6000, 10, 3500, " Hz", {}),
            R("air", "Air shelf (10 kHz)", -10, 10, 0.5, 0, " dB", { easyLabel: "Air / sparkle" }),
            R("lp", "High cut", 0, 20000, 50, 0, " Hz", {})
        ],
        presets: {
            "Default": {},
            "Clean-up": { hp: 90, mudG: -2.5, presG: 1.5, air: 1.5 },
            "Reverb return trim": { hp: 200, lp: 7500, mudG: 0, air: 0 },
            "Telephone": { hp: 400, lp: 3200, midG: 4, midF: 1500 }
        },
        async process(ch, sr, p) {
            const nodesNeeded = [];
            if (p.hp > 20) nodesNeeded.push(["highpass", p.hp, 0.7071, 0]);
            if (Math.abs(p.lowShelf) > 0.05) nodesNeeded.push(["lowshelf", 120, 0.7071, p.lowShelf]);
            if (Math.abs(p.mudG) > 0.05) nodesNeeded.push(["peaking", p.mudF, 1.1, p.mudG]);
            if (Math.abs(p.midG) > 0.05) nodesNeeded.push(["peaking", p.midF, p.midQ, p.midG]);
            if (Math.abs(p.presG) > 0.05) nodesNeeded.push(["peaking", p.presF, 0.9, p.presG]);
            if (Math.abs(p.air) > 0.05) nodesNeeded.push(["highshelf", 10000, 0.7071, p.air]);
            if (p.lp > 0 && p.lp < sr * 0.45) nodesNeeded.push(["lowpass", p.lp, 0.7071, 0]);
            if (!nodesNeeded.length) return { channels: copy(ch) };
            const out = await runOffline(ch, sr, 0, ch.length, (ctx, src) => {
                let last = src;
                for (const [type, f, q, g] of nodesNeeded) {
                    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g;
                    last.connect(b); last = b;
                }
                return last;
            });
            return { channels: out };
        }
    };

    // ---- Compressor ----
    P.comp = {
        id: "comp", name: "VL Comp", cat: "Dynamics", icon: "p-comp",
        blurb: "Evens out loud and quiet parts so the vocal stays steady in the mix.",
        likeA: "Pro-C style",
        easy: ["amount"],
        params: [
            R("amount", "Amount", 0, 100, 1, 50, "%", { easyLabel: "How much levelling", virtual: true }),
            R("thr", "Threshold", -50, 0, 0.5, -20, " dB", {}),
            R("ratio", "Ratio", 1, 20, 0.1, 3, " :1", {}),
            R("atk", "Attack", 0.1, 100, 0.1, 12, " ms", {}),
            R("rel", "Release", 10, 800, 1, 140, " ms", {}),
            R("knee", "Knee", 0, 24, 0.5, 8, " dB", {}),
            R("makeup", "Makeup", -6, 18, 0.5, 3, " dB", {}),
            R("mix", "Mix (parallel)", 0, 100, 1, 100, "%", {})
        ],
        presets: { "Default": {}, "Gentle level": { thr: -18, ratio: 2.2, makeup: 2 }, "Punchy": { thr: -24, ratio: 4.5, atk: 20, rel: 90, makeup: 5 }, "Adlib squash": { thr: -28, ratio: 6, atk: 5, rel: 120, makeup: 7, mix: 70 } },
        mapEasy(p) { // easy "Amount" drives threshold/ratio/makeup together
            const a = p.amount / 100;
            return Object.assign({}, p, { thr: -10 - 22 * a, ratio: 1.5 + 4 * a, makeup: 1 + 5 * a });
        },
        process(ch, sr, p0) {
            const p = p0._easy ? P.comp.mapEasy(p0) : p0;
            const n = ch[0].length, out = ch.map(() => new Float32Array(n));
            const ac = Math.exp(-1 / (Math.max(0.1, p.atk) / 1000 * sr)), rc = Math.exp(-1 / (Math.max(5, p.rel) / 1000 * sr));
            const slope = 1 / p.ratio - 1, kn = Math.max(0.01, p.knee), mk = dbLin(p.makeup), mix = p.mix / 100;
            let grDb = 0;
            for (let i = 0; i < n; i++) {
                let lv = 0;
                for (let c = 0; c < ch.length; c++) { const v = Math.abs(ch[c][i]); if (v > lv) lv = v; }
                const over = linDb(lv) - p.thr;
                let target = 0;
                if (2 * over < -kn) target = 0;
                else if (2 * Math.abs(over) <= kn) target = slope * Math.pow(over + kn / 2, 2) / (2 * kn);
                else target = slope * over;
                // grDb is <= 0; moving to a lower value = more reduction = attack
                grDb = target < grDb ? ac * grDb + (1 - ac) * target : rc * grDb + (1 - rc) * target;
                const g = dbLin(grDb) * mk;
                for (let c = 0; c < ch.length; c++) out[c][i] = ch[c][i] * (1 - mix) + ch[c][i] * g * mix;
            }
            return { channels: out };
        }
    };

    // ---- De-esser ----
    P.deess = {
        id: "deess", name: "VL De-Esser", cat: "Dynamics", icon: "p-deess",
        blurb: "Softens harsh 'S' and 'T' sounds without dulling the whole voice.",
        likeA: "Pro-DS style",
        easy: ["amount"],
        params: [
            R("amount", "Amount", 1, 12, 0.5, 6, " dB", { easyLabel: "How strong" }),
            R("freq", "Frequency", 3500, 9000, 50, 5800, " Hz", {}),
            R("sens", "Sensitivity", 2, 14, 0.5, 6.5, "", { invert: true })
        ],
        presets: { "Default": {}, "Gentle": { amount: 4, sens: 8 }, "Strong": { amount: 9, sens: 4.5 } },
        process(ch, sr, p) {
            const eng = root.VocalVaultStudio && root.VocalVaultStudio.engine;
            if (!eng) return { channels: copy(ch) };
            const r = eng.deEss(ch, sr, { freq: p.freq, maxCutDb: p.amount, aboveMedianDb: p.sens, maxActivePct: 30 });
            return { channels: r && r.channels ? r.channels : copy(ch) };
        }
    };

    // ---- Saturator ----
    P.sat = {
        id: "sat", name: "VL Warmth", cat: "Tone", icon: "p-sat",
        blurb: "Adds gentle analog-style warmth and thickness.",
        likeA: "Saturn style (simple)",
        easy: ["drive"],
        params: [R("drive", "Drive", 1.05, 2.2, 0.05, 1.35, "", { easyLabel: "Warmth" }), R("mix", "Mix", 0, 22, 1, 10, "%", {})],
        presets: { "Default": {}, "Subtle": { drive: 1.2, mix: 6 }, "Thick": { drive: 1.9, mix: 20 } },
        process(ch, sr, p) {
            const eng = root.VocalVaultStudio && root.VocalVaultStudio.engine;
            if (!eng) return { channels: copy(ch) };
            return { channels: eng.saturate(ch, { drive: p.drive, mix: p.mix / 100 }) };
        }
    };

    // ---- Limiter ----
    P.limit = {
        id: "limit", name: "VL Limiter", cat: "Dynamics", icon: "p-limit",
        blurb: "A safety ceiling so nothing clips. Push the gain to make it louder.",
        likeA: "Pro-L style",
        easy: ["gain"],
        params: [R("gain", "Gain", 0, 12, 0.5, 0, " dB", { easyLabel: "Make louder" }), R("ceiling", "Ceiling", -6, 0, 0.1, -1, " dB", {}), R("release", "Release", 40, 600, 5, 220, " ms", {})],
        presets: { "Default": {}, "Safety only": { gain: 0, ceiling: -1 }, "Loud": { gain: 5, ceiling: -1 } },
        process(ch, sr, p) {
            const eng = root.VocalVaultStudio && root.VocalVaultStudio.engine;
            const g = dbLin(p.gain);
            const boosted = ch.map((c) => c.map((v) => v * g));
            if (!eng) { const cl = dbLin(p.ceiling); return { channels: boosted.map((c) => c.map((v) => Math.max(-cl, Math.min(cl, v)))) }; }
            return { channels: eng.limiter(boosted, sr, p.ceiling, { releaseSec: p.release / 1000 }).channels };
        }
    };

    // ---- Stereo imager ----
    P.imager = {
        id: "imager", name: "VL Imager", cat: "Space", icon: "p-imager",
        blurb: "Makes a vocal wider (or narrower). Bass stays in the middle so the mix stays solid.",
        likeA: "S1 Stereo Imager style",
        easy: ["width"],
        params: [R("width", "Width", 0, 200, 1, 130, "%", { easyLabel: "Wider →" }), R("monoBelow", "Keep bass mono below", 0, 400, 5, 150, " Hz", {}), R("haas", "Spread delay (mono sources)", 4, 30, 1, 12, " ms", {})],
        presets: { "Default": {}, "Subtle": { width: 115 }, "Wide": { width: 160 }, "Doubled lead width": { width: 175, haas: 16 } },
        process(ch, sr, p) {
            const n = ch[0].length, w = p.width / 100;
            let L = ch[0], Rr = ch.length > 1 ? ch[1] : null;
            const mid = new Float32Array(n), side = new Float32Array(n);
            if (Rr) {
                for (let i = 0; i < n; i++) { mid[i] = 0.5 * (L[i] + Rr[i]); side[i] = 0.5 * (L[i] - Rr[i]); }
            } else {
                const d = Math.round(p.haas / 1000 * sr);
                const del = new Float32Array(n);
                for (let i = d; i < n; i++) del[i] = L[i - d];
                const hp = onePole(del, 250, sr, true);
                for (let i = 0; i < n; i++) { mid[i] = L[i]; side[i] = 0.55 * hp[i]; }
            }
            const lowSide = p.monoBelow > 20 ? onePole(side, p.monoBelow, sr, false) : null;
            const gSide = Rr ? w : Math.min(1.5, w);
            const sideOut = new Float32Array(n);
            for (let i = 0; i < n; i++) sideOut[i] = (side[i] - (lowSide ? lowSide[i] : 0)) * gSide;
            const l = new Float32Array(n), r = new Float32Array(n);
            for (let i = 0; i < n; i++) { l[i] = mid[i] + sideOut[i]; r[i] = mid[i] - sideOut[i]; }
            return { channels: [l, r] };
        }
    };

    // ---- Doubler ("chorus doubs") ----
    P.doubler = {
        id: "doubler", name: "VL Doubler", cat: "Space", icon: "p-doubler",
        blurb: "Makes it sound like the singer recorded it twice: thicker and bigger, great for choruses.",
        likeA: "Vocal doubling",
        easy: ["level", "spread"],
        params: [
            R("level", "Double level", -24, 0, 0.5, -8, " dB", { easyLabel: "How loud the doubles" }),
            R("spread", "Stereo spread", 0, 100, 1, 80, "%", { easyLabel: "Width" }),
            R("delay", "Offset", 8, 45, 1, 18, " ms", {}),
            R("detune", "Drift (detune)", 0, 20, 0.5, 6, " cents", {}),
            R("tone", "Tone (high cut)", 3000, 16000, 100, 9000, " Hz", {})
        ],
        presets: { "Default": {}, "Tight": { delay: 12, detune: 4, level: -10 }, "Big chorus": { delay: 26, detune: 9, level: -6, spread: 100 } },
        async process(ch, sr, p) {
            const voices = [{ pan: -1, d: p.delay / 1000, f: 0.31 }, { pan: 1, d: (p.delay * 1.45) / 1000, f: 0.43 }];
            const depthSec = (Math.pow(2, p.detune / 1200) - 1) * 0.5;       // small pitch drift from a slowly moving delay
            const out = await runOffline(mono(ch) ? [mono(ch)] : ch, sr, 0.06, 2, (ctx, src) => {
                const sum = ctx.createGain();
                const dry = ctx.createGain(); dry.gain.value = 1;
                const dryPan = ctx.createStereoPanner(); dryPan.pan.value = 0;
                src.connect(dry); dry.connect(dryPan); dryPan.connect(sum);
                voices.forEach((v) => {
                    const dl = ctx.createDelay(0.2); dl.delayTime.value = v.d;
                    const o = ctx.createOscillator(); o.frequency.value = v.f * 4; const og = ctx.createGain(); og.gain.value = Math.min(0.004, depthSec * 40);
                    o.connect(og); og.connect(dl.delayTime); o.start();
                    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.tone;
                    const g = ctx.createGain(); g.gain.value = dbLin(p.level);
                    const pn = ctx.createStereoPanner(); pn.pan.value = v.pan * p.spread / 100;
                    src.connect(dl); dl.connect(lp); lp.connect(g); g.connect(pn); pn.connect(sum);
                });
                return sum;
            });
            return { channels: out };
        }
    };

    // ---- Crowd (stack many copies) ----
    P.crowd = {
        id: "crowd", name: "VL Crowd", cat: "Creative", icon: "p-crowd",
        blurb: "Stacks many slightly different copies of the vocal to sound like a crowd singing back.",
        likeA: "Crowd / gang vocal stacking",
        easy: ["size", "level"],
        params: [
            R("size", "Crowd size", 3, 24, 1, 10, " voices", { easyLabel: "How many people" }),
            R("level", "Crowd level", -30, 0, 0.5, -10, " dB", { easyLabel: "How loud" }),
            R("looseness", "Looseness (timing)", 10, 160, 1, 70, " ms", {}),
            R("detune", "Pitch scatter", 0, 40, 1, 14, " cents", {}),
            R("spread", "Stereo spread", 0, 100, 1, 90, "%", {}),
            R("dry", "Keep original", 0, 100, 1, 100, "%", {})
        ],
        presets: { "Default": {}, "Small group": { size: 5, level: -9, looseness: 45 }, "Stadium": { size: 20, level: -7, looseness: 120, detune: 22 } },
        async process(ch, sr, p) {
            const rnd = mulberry(2026);
            const loose = p.looseness / 1000, tail = loose + 0.25;
            const m = mono(ch);
            const per = dbLin(p.level) / Math.sqrt(p.size);
            const out = await runOffline([m], sr, tail, 2, (ctx, src, buf) => {
                const sum = ctx.createGain();
                const dry = ctx.createGain(); dry.gain.value = p.dry / 100; src.connect(dry); dry.connect(sum);
                const rate0 = 1;
                for (let i = 0; i < p.size; i++) {
                    const s = ctx.createBufferSource(); s.buffer = buf;
                    const cents = (rnd() * 2 - 1) * p.detune;
                    s.playbackRate.value = Math.pow(2, cents / 1200) * rate0;
                    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 120 + rnd() * 260;
                    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3800 + rnd() * 5200;
                    const g = ctx.createGain(); g.gain.value = per * (0.6 + rnd() * 0.8);
                    const pn = ctx.createStereoPanner(); pn.pan.value = (rnd() * 2 - 1) * p.spread / 100;
                    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(pn); pn.connect(sum);
                    s.start(0.008 + rnd() * loose);
                }
                return sum;
            });
            return { channels: out };
        }
    };

    // ---- Reverb ----
    P.reverb = {
        id: "reverb", name: "VL Hall", cat: "Space", icon: "p-reverb",
        blurb: "Puts the vocal in a room. Keep the lows and harsh highs of the reverb trimmed so the mix stays clean.",
        likeA: "Pro-R style",
        easy: ["mix", "decay"],
        params: [
            R("mix", "Reverb amount", 0, 100, 1, 25, "%", { easyLabel: "How much reverb" }),
            R("decay", "Space (decay)", 0.3, 6, 0.01, 2.04, " s", { easyLabel: "Room size" }),
            R("predelay", "Predelay", 0, 200, 1, 63, " ms", { easyLabel: "Keeps the voice clear" }),
            R("size", "Early reflections", 0, 1, 0.01, 0.5, "", {}),
            R("lowMul", "Bass decay ×", 0.2, 1.8, 0.01, 0.8, "", {}),
            R("highMul", "Treble decay ×", 0.1, 1.2, 0.01, 0.45, "", {}),
            R("midBoost", "Mid glow (650 Hz)", -6, 8, 0.5, 3, " dB", {}),
            R("highDip", "Soften highs (8 kHz)", 0, 12, 0.5, 4, " dB", {}),
            R("hp", "Reverb low cut", 20, 600, 1, 200, " Hz", {}),
            R("lp", "Reverb high cut", 2000, 20000, 50, 8000, " Hz", {}),
            R("width", "Width", 0, 1, 0.01, 0.9, "", {}),
            S("ret", "Mode", ["insert", "return (wet only)"], "insert", {})
        ],
        presets: {
            "Default": {}, "Rich hall": {}, "Vocal plate": { decay: 1.3, predelay: 30, lowMul: 0.7, highMul: 0.55, mix: 22 },
            "Tight room": { decay: 0.6, predelay: 12, mix: 15, highMul: 0.6 }, "Big & airy": { decay: 3.4, predelay: 80, mix: 30, highMul: 0.6 }
        },
        async process(ch, sr, p) {
            const ir = makeIR(sr, p);
            const tail = ir[0].length / sr;
            const wetOnly = p.ret && String(p.ret).indexOf("return") === 0;
            const out = await runOffline(mono(ch) ? [mono(ch)] : ch, sr, tail, 2, (ctx, src) => {
                const sum = ctx.createGain();
                if (!wetOnly) { const d = ctx.createGain(); d.gain.value = 1; src.connect(d); d.connect(sum); }
                const conv = ctx.createConvolver(); conv.normalize = false;
                const ib = ctx.createBuffer(2, ir[0].length, sr); ib.copyToChannel(ir[0], 0); ib.copyToChannel(ir[1], 1);
                conv.buffer = ib;
                const w = ctx.createGain(); w.gain.value = wetOnly ? p.mix / 100 : p.mix / 100 * 0.35;
                src.connect(conv); conv.connect(w); w.connect(sum);
                return sum;
            });
            return { channels: out };
        }
    };

    // ---- Echo / delay (with "tail-end throw") ----
    P.delay = {
        id: "delay", name: "VL Echo", cat: "Space", icon: "p-delay",
        blurb: "Repeats that trail off. 'Enter at' makes the echo only appear near the END of your selection, for tail-end spice.",
        likeA: "Delay + volume automation",
        easy: ["mix", "enter"],
        params: [
            R("mix", "Echo amount", 0, 100, 1, 35, "%", { easyLabel: "How loud the echoes" }),
            R("enter", "Enter at (throw)", 0, 95, 1, 65, "% of selection", { easyLabel: "Echo starts at…" }),
            S("sync", "Time", ["1/4", "1/8", "1/8 dotted", "1/16", "free"], "1/8 dotted", {}),
            R("time", "Free time", 40, 900, 1, 300, " ms", {}),
            R("fb", "Repeats", 0, 85, 1, 38, "%", {}),
            R("hp", "Echo low cut", 50, 1500, 5, 350, " Hz", {}),
            R("lp", "Echo high cut", 1500, 16000, 50, 5500, " Hz", {}),
            R("pingpong", "Ping-pong", 0, 100, 1, 70, "%", {})
        ],
        presets: { "Default": {}, "Tail-end throw": { enter: 70, mix: 40 }, "Whole-phrase slap": { enter: 0, sync: "1/16", fb: 18, mix: 22 }, "Dreamy": { enter: 0, sync: "1/4", fb: 55, mix: 30 } },
        process(ch, sr, p, env) {
            const bpm = (env && env.bpm) || 100, beat = 60000 / bpm;
            const ms = { "1/4": beat, "1/8": beat / 2, "1/8 dotted": beat * 0.75, "1/16": beat / 4 }[p.sync] || p.time;
            const d = Math.max(8, Math.round(ms / 1000 * sr)), fb = p.fb / 100;
            const n0 = ch[0].length, tail = fb > 0 ? Math.min(5, (ms / 1000) * (Math.log(0.002) / Math.log(Math.max(0.05, fb)))) : ms / 1000;
            const n = n0 + Math.round(tail * sr), m = mono(ch);
            const send = new Float32Array(n);
            const dur = n0 / sr, tStart = dur * p.enter / 100, ramp = Math.min(0.3, Math.max(0.04, dur * 0.12));
            for (let i = 0; i < n0; i++) {
                let g = 1;
                if (p.enter > 0) { const u = clamp((i / sr - tStart) / ramp, 0, 1); g = u * u * (3 - 2 * u); }
                send[i] = m[i] * g;
            }
            const hpC = bqCoef("hp", p.hp, sr, 0.7071), lpC = bqCoef("lp", p.lp, sr, 0.7071);
            const fl = bqRun(bqRun(send, hpC), lpC);
            const pp = p.pingpong / 100, g = p.mix / 100;
            const yL = new Float32Array(n), yR = new Float32Array(n);
            for (let i = d; i < n; i++) {                       // echoes bounce left, right, left ...
                yL[i] = fl[i - d] + fb * yR[i - d];
                yR[i] = fb * yL[i - d];
            }
            const dryL = ch[0], dryR = ch.length > 1 ? ch[1] : ch[0];
            const L = new Float32Array(n), Rr = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const c = 0.5 * (yL[i] + yR[i]);
                L[i] = (i < n0 ? dryL[i] : 0) + g * (pp * yL[i] + (1 - pp) * c);
                Rr[i] = (i < n0 ? dryR[i] : 0) + g * (pp * yR[i] + (1 - pp) * c);
            }
            return { channels: [L, Rr] };
        }
    };

    // ---- Orbit (slow auto-pan / AM / FM movement) ----
    P.orbit = {
        id: "orbit", name: "VL Orbit", cat: "Creative", icon: "p-orbit",
        blurb: "Slowly moves the vocal around the stereo field. Best heard on headphones.",
        likeA: "MondoMod style",
        easy: ["rate", "rotation"],
        params: [
            R("rate", "Speed", 0.05, 6, 0.01, 0.2, " Hz", { easyLabel: "How fast it moves" }),
            R("rotation", "Rotation range", 0, 180, 1, 120, "°", { easyLabel: "How far it travels" }),
            R("am", "AM depth (volume wobble)", 0, 100, 1, 50, "", {}),
            R("amPhase", "AM phase", 0, 360, 1, 270, "°", {}),
            R("fm", "FM depth (pitch wobble)", 0, 100, 1, 50, "", {}),
            R("fmPhase", "FM phase", 0, 360, 1, 180, "°", {}),
            S("shape", "Waveform", ["sine", "triangle", "saw", "square"], "sine", {}),
            R("mix", "Mix", 0, 100, 1, 100, "%", {})
        ],
        presets: { "Default": {}, "Gentle drift": { am: 15, fm: 10, rotation: 80, rate: 0.12 }, "Wobbly": { rate: 0.8, fm: 70, am: 60 } },
        process(ch, sr, p) {
            const n = ch[0].length, L0 = ch[0], R0 = ch.length > 1 ? ch[1] : ch[0];
            const l = new Float32Array(n), r = new Float32Array(n);
            const w = TAU * p.rate / sr, amP = p.amPhase * Math.PI / 180, fmP = p.fmPhase * Math.PI / 180;
            const amD = p.am / 100 * 0.5, fmMax = (p.fm / 100) * 0.0025 * sr, panR = Math.min(1, p.rotation / 180), mix = p.mix / 100;
            const base = Math.ceil(fmMax) + 2;
            const rd = (x, pos) => { const k = Math.floor(pos); if (k < 0) return 0; const f = pos - k; return x[k] * (1 - f) + (x[k + 1] === undefined ? 0 : x[k + 1]) * f; };
            for (let i = 0; i < n; i++) {
                const ph = w * i;
                const am = 1 - amD * (1 + lfo(p.shape, ph + amP));
                const dl = base + fmMax * lfo(p.shape, ph + fmP);
                const a = rd(L0, i - dl), b = rd(R0, i - dl);
                const pos = panR * lfo(p.shape, ph), th = (pos + 1) * Math.PI / 4, gl = Math.cos(th) * Math.SQRT2, gr = Math.sin(th) * Math.SQRT2;
                const m = 0.5 * (a + b);
                l[i] = L0[i] * (1 - mix) + m * am * gl * mix;
                r[i] = R0[i] * (1 - mix) + m * am * gr * mix;
            }
            return { channels: [l, r] };
        }
    };

    // ---- Voice change ----
    P.voice = {
        id: "voice", name: "VL Voice Change", cat: "Creative", icon: "p-voice",
        blurb: "Shifts the pitch of a chopped phrase. 'Same voice' keeps it sounding like you; 'Character' changes the voice itself (chipmunk / deep).",
        likeA: "Sampler pitch / time-stretch",
        easy: ["semi", "mode"],
        params: [
            R("semi", "Pitch", -12, 12, 0.5, 5, " st", { easyLabel: "Up / down" }),
            S("mode", "Style", ["same voice", "character"], "character", { easyLabel: "Style" }),
            R("mix", "Mix", 0, 100, 1, 100, "%", {})
        ],
        presets: { "Default": {}, "Chipmunk": { semi: 7, mode: "character" }, "Deep": { semi: -5, mode: "character" }, "Octave up (same voice)": { semi: 12, mode: "same voice" } },
        async process(ch, sr, p) {
            let wet;
            if (p.mode === "same voice") {
                const r = await runTask("shiftConst", { channels: ch, sr, cents: p.semi * 100 });
                wet = r.channels;
            } else {
                const ratio = Math.pow(2, p.semi / 12);
                wet = ch.map((c) => { const target = c.length; const rs = resample(c, ratio); const st = wsola(rs, sr, ratio); const o = new Float32Array(target); o.set(st.subarray(0, Math.min(target, st.length))); return o; });
            }
            const w = p.mix / 100;
            return { channels: wet.map((c, i) => { const d = ch[i]; const o = new Float32Array(c.length); for (let k = 0; k < o.length; k++) o[k] = (d[k] || 0) * (1 - w) + c[k] * w; return o; }) };
        }
    };

    // ---- Resonance: natural double + one soft echo + ghost harmony (the maths lives in resonance.js, shared with the Pipeline) ----
    P.resonance = {
        id: "resonance", name: "VL Resonance", cat: "Space", icon: "p-resonance",
        blurb: "A shimmer layer under the voice: a natural double, one soft echo that never keeps repeating, and a faint ghost harmony. It sounds like the singer sang it again.",
        likeA: "Voloco-style resonance",
        easy: ["amount", "halo"],
        params: [
            R("amount", "Shimmer", 0, 200, 1, 100, "%", { easyLabel: "How much shimmer" }),
            S("halo", "Ghost harmony", ["octave", "third", "fifth", "off"], "octave", { easyLabel: "Ghost harmony" }),
            R("dblDelay", "Double offset", 10, 45, 1, 20, " ms", {}),
            R("dblDrift", "Double drift", 0, 15, 0.5, 6, " cents", {}),
            R("dblBelow", "Double level (dB under voice)", 6, 30, 0.5, 14, " dB", {}),
            R("echoTime", "Echo time", 40, 220, 1, 100, " ms", {}),
            R("echoBelow", "Echo level (dB under voice)", 8, 34, 0.5, 18, " dB", {}),
            R("haloBelow", "Ghost level (dB under voice)", 8, 34, 0.5, 19, " dB", {}),
            R("tone", "Layer tone (high cut)", 3000, 12000, 100, 7500, " Hz", {})
        ],
        presets: {
            "Default": {}, "Subtle halo": { amount: 65 }, "Airy octave": { halo: "octave", haloBelow: 16 },
            "Faint chord (third)": { halo: "third" }, "Double + echo only": { halo: "off" }, "Bold": { amount: 150 }
        },
        async process(ch, sr, p, env) {
            const RS = root.VLResonance;
            if (!RS || !RS.ready() || p.amount <= 0) return { channels: copy(ch) };
            const shift = -20 * Math.log10(Math.max(p.amount, 1) / 100);        // more shimmer = a smaller "dB under the voice"
            const params = { dblOn: true, dblDelay: p.dblDelay, dblDrift: p.dblDrift, dblBelow: p.dblBelow + shift, dblLp: p.tone,
                echoOn: true, echoTime: p.echoTime, echoBelow: p.echoBelow + shift, echoLp: Math.max(2000, p.tone - 700),
                halo: p.halo, haloBelow: p.haloBelow + shift, haloLp: p.tone, haloHaas: 11 };
            let halo = null;
            if (p.halo !== "off") {
                const key = env && env.key;
                if (p.halo === "octave" || !key) halo = (await runTask("shiftConst", { channels: ch, sr, cents: 1200 })).channels;
                else halo = (await runTask("harmonize", { channels: ch, sr, options: { rootPc: key.rootPc, scale: key.scale, refCents: 0, degrees: RS.DEGREES[p.halo] || 2, retuneMs: 25 } })).channels;
            }
            const layer = RS.build(ch, sr, params, halo);
            const n = layer.channels[0].length, dry = ch.length > 1 ? ch : [ch[0], ch[0]];
            const L = new Float32Array(n), Rr = new Float32Array(n);
            for (let i = 0; i < n; i++) { L[i] = (i < dry[0].length ? dry[0][i] : 0) + layer.channels[0][i]; Rr[i] = (i < dry[1].length ? dry[1][i] : 0) + layer.channels[1][i]; }
            return { channels: [L, Rr] };
        }
    };

    const ORDER = ["tune", "pitchedit", "deess", "eq", "comp", "sat", "voice", "doubler", "resonance", "crowd", "imager", "orbit", "delay", "reverb", "limit"];

    function defaults(id) {
        const pl = P[id], o = {};
        pl.params.forEach((q) => { o[q.k] = q.def; });
        if (pl.hidden) Object.assign(o, JSON.parse(JSON.stringify(pl.hidden)));
        return o;
    }
    function withPreset(id, name) {
        const base = defaults(id), pr = P[id].presets && P[id].presets[name];
        return Object.assign(base, pr || {});
    }

    // Run a whole chain. onStep(i) lets the rack cache per step.
    async function runChain(channels, sr, chain, env, cache, key0) {
        let cur = channels, key = key0 || "in", reused = 0;
        for (let i = 0; i < chain.length; i++) {
            const pl = chain[i];
            if (pl.bypass) continue;
            const def = P[pl.type];
            key = key + ">" + pl.type + JSON.stringify(pl.params);
            if (cache && cache[i] && cache[i].key === key) { cur = cache[i].channels; reused++; continue; }
            if (cache) cache.length = Math.min(cache.length, i);
            const p = Object.assign({}, pl.params);
            const r = await def.process(cur, sr, p, env || {});
            cur = r.channels;
            if (cache) cache[i] = { key, channels: cur, info: r.info };
        }
        return { channels: cur, reused };
    }

    root.VLFx = { P, ORDER, NOTE_NAMES, SCALE_OPTS, defaults, withPreset, runChain, runTask, util: { dbLin, linDb, rms, peak, mono, copy, stereo, padTo, bqCoef, bqRun, clamp, mulberry } };
})(typeof window !== "undefined" ? window : globalThis);
