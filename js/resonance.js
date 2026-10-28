/**
 * Voxloop — Resonance (the "shimmer" layer under a tuned vocal)
 *
 * Three quiet layers stacked under the lead, which together sound like the singer sang it again:
 *   1. a natural DOUBLE   a copy ~15–35 ms late, drifting a few cents and a hair in time, darker, spread left/right
 *   2. one soft ECHO      a single repeat (no feedback, it never "goes on and on"), timed to the groove
 *   3. a ghost HARMONY    a very quiet copy an octave up (airy) or a third / fifth up in the key (a faint chord)
 *
 * plan(ctx, mode)  works out every number from the beat (tempo, how full, how bright, energy, genre) and the
 *                  vocal (sung or rapped, range, take quality), and says why. It can also decide NOT to add it.
 * build(...)       makes the layer from a vocal (and, for the ghost harmony, a pitch-shifted copy supplied by the
 *                  caller, because the Pipeline and the FX Rack each have their own pitch engine access).
 *
 * Parameter names are shared with the VL Resonance plugin in fxrack-dsp.js.
 * Needs VLFx (fxrack-dsp.js) for its filters; without it plan() says it can't run.
 */
(function (root) {
    "use strict";

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, u) => a + (b - a) * u;
    const lin = (db) => Math.pow(10, db / 20);
    const r1 = (v) => Math.round(v * 10) / 10;
    const util = () => root.VLFx && root.VLFx.util;
    const ready = () => !!util();

    // ------------------------------------------------------------------ PLAN: every number from the beat and the vocal
    /**
     * ctx: the mix brain's picture { vibe:{energy,busy,bright,space}, prof:{delivery,range,quality}, genreId, bpm, beatMs, key }
     * mode: "auto" (also decides whether it suits the song) | "subtle" | "natural" | "bold"
     */
    function plan(ctx, mode) {
        mode = mode || "auto";
        const notes = [];
        if (!ready()) return { use: false, params: null, notes: ["Resonance can't run: the effects engine (fxrack-dsp.js) isn't loaded."] };
        if (!ctx || !ctx.vibe || !ctx.prof) return { use: false, params: null, notes: ["Resonance skipped: I couldn't hear the beat and vocal well enough to calculate it."] };
        const { vibe: B, prof, genreId, key } = ctx;
        const bpm = ctx.bpm || null, beatMs = ctx.beatMs || (bpm ? 60000 / bpm : 600);
        const rapped = prof.delivery === "rapped";

        // ---- does it suit this song? (only Auto decides; Subtle/Natural/Bold do what you asked)
        if (mode === "auto") {
            if (rapped) return { use: false, params: null, notes: ["Resonance left off: this vocal is rapped or spoken, and a shimmer layer needs held notes to work with."] };
            if (B.space < 0.22) return { use: false, params: null, notes: ["Resonance left off: the beat is very full, so a shimmer layer would just cloud the words."] };
            if (prof.quality < 0.5) return { use: false, params: null, notes: ["Resonance left off: the take is rough, and a shimmer layer would repeat its flaws."] };
        }

        // ---- how much: the beat's room, the take's quality and the song's energy scale everything
        const inten = { subtle: 0.65, natural: 1, bold: 1.45, auto: 1 }[mode] || 1;
        const room = 0.55 + 0.9 * B.space;                              // a roomy beat can carry more
        const clean = 0.6 + 0.4 * prof.quality;                         // a rough take gets less
        const calm = 1 - 0.25 * (B.energy - 0.5);                       // a hard-hitting song needs it quieter to stay clear
        const f = inten * room * clean * calm;
        const dbShift = -20 * Math.log10(f);                            // louder layer = smaller "below the voice" number
        const busyExtra = 3 * B.busy;                                   // and a full beat pushes it back
        const below = (base, lo, hi) => r1(clamp(base + dbShift + busyExtra, lo, hi));
        const dark = lerp(9000, 5200, B.bright);                        // a bright beat gets a darker layer so it doesn't pile up on top

        // ---- 1. natural double: tight on fast songs, wider on slow; drift keeps it human
        const dblDelay = Math.round(clamp((16 + 10 * (1 - B.busy)) * Math.pow(100 / (bpm || 100), 0.25), 12, 36));
        const dblDrift = r1(clamp(4 + 4 * (1 - B.energy) + (prof.quality < 0.7 ? -1 : 0), 3, 9));
        const dblBelow = below(14, 8, 24);

        // ---- 2. one soft echo, a sixteenth note of the groove (never repeats)
        const echoTime = Math.round(clamp(beatMs / 4, 70, 150));
        const echoBelow = below(18, 11, 28);

        // ---- 3. ghost harmony: an octave is airy; a third in the key is a faint chord; a high voice can't take an octave up
        let halo = "off", haloWhy = "";
        if (!rapped) {
            if (prof.range === "high" || prof.f0 > 330) { halo = key ? "third" : "octave"; haloWhy = prof.f0 > 330 ? "this is a high voice, so an octave up would be too shrill; a third up in the key is gentler" : "a high voice, so a third up in the key"; }
            else if (genreId === "rnb" && key) { halo = "third"; haloWhy = "R&B likes a faint chord, so a third up in the key"; }
            else { halo = "octave"; haloWhy = "an octave up gives the airy shimmer"; }
            if (halo !== "octave" && !key) { halo = "octave"; haloWhy += " (the key isn't known, so an octave instead)"; }
        } else haloWhy = "no ghost harmony on a rapped vocal";
        const haloBelow = below(19, 12, 30);

        const params = {
            dblOn: true, dblDelay, dblDrift, dblBelow, dblLp: Math.round(dark),
            echoOn: true, echoTime, echoBelow, echoLp: Math.round(dark - 700),
            halo, haloBelow, haloLp: Math.round(lerp(9500, 6500, B.bright)), haloHaas: Math.round(clamp(9 + 4 * (1 - B.busy), 8, 14))
        };

        notes.push("Resonance (" + (mode === "auto" ? "calculated for this song" : mode) + "): a natural double " + dblDelay + " ms late drifting " + dblDrift + " cents (" + dblBelow + " dB under the voice)" +
            (B.busy > 0.62 ? ", pulled back a little because the beat is full" : B.space > 0.7 ? ", a bit fuller because the beat has room" : "") +
            "; one soft echo at " + echoTime + " ms, a sixteenth note" + (bpm ? " at " + Math.round(bpm) + " BPM" : "") + ", that doesn't repeat (" + echoBelow + " dB)" +
            (halo === "off" ? "; " + haloWhy + "." : "; a ghost harmony " + (halo === "octave" ? "an octave" : halo === "third" ? "a third" : "a fifth") + " up (" + haloWhy + ", " + haloBelow + " dB). ") +
            (B.bright > 0.62 ? " The layer is darkened because the beat is bright." : "") + (prof.quality < 0.7 ? " Kept quieter because the take is rough." : ""));
        return { use: true, params, notes, factor: f };
    }

    // The harmony the plan asked for, as a diatonic step count for the key-aware harmonizer (octave is a plain pitch shift)
    const DEGREES = { third: 2, fifth: 4 };

    // ------------------------------------------------------------------ BUILD: the layer itself (pure JS on Float32Arrays)
    function monoOf(ch) {
        if (ch.length === 1) return ch[0];
        const o = new Float32Array(ch[0].length);
        for (const c of ch) for (let i = 0; i < o.length; i++) o[i] += c[i] / ch.length;
        return o;
    }
    function filtered(x, sr, hp, lp) {
        const u = util();
        let y = x;
        if (hp > 20) y = u.bqRun(u.bqRun(y, u.bqCoef("hp", hp, sr, 0.7071)), u.bqCoef("hp", hp, sr, 0.7071));
        if (lp > 0 && lp < sr * 0.45) y = u.bqRun(u.bqRun(y, u.bqCoef("lp", lp, sr, 0.7071)), u.bqCoef("lp", lp, sr, 0.7071));
        return y;
    }
    // read x at a fractional position
    const at = (x, p) => { const k = Math.floor(p); if (k < 0 || k + 1 >= x.length) return 0; const f = p - k; return x[k] * (1 - f) + x[k + 1] * f; };

    /**
     * channels: the vocal (mono or stereo). halo: a pitch-shifted copy of the vocal (mono or stereo) or null.
     * opts.keepLength: cut the layer to the vocal's length (the Pipeline needs the same length as its other stems).
     * Returns { channels:[L,R] } — a layer to ADD to the vocal bus (levels are "dB below the voice").
     */
    function build(channels, sr, p, halo, opts) {
        if (!ready()) throw new Error("VLFx is not loaded");
        opts = opts || {};
        const m = monoOf(channels), N = m.length;
        const tail = Math.ceil((((p.echoOn ? p.echoTime : 0) + 60) / 1000) * sr);
        const len = opts.keepLength ? N : N + tail;
        const L = new Float32Array(len), R = new Float32Array(len);

        if (p.dblOn) {
            const x = filtered(m, sr, 140, p.dblLp);
            const g = lin(-p.dblBelow) * 0.75;
            // two imperfect copies: slow drift in delay = a few cents of pitch wander, plus a hair of timing looseness
            const voices = [{ d: p.dblDelay, f: 0.37, ph: 0.4, side: 0 }, { d: p.dblDelay * 1.37, f: 0.53, ph: 2.1, side: 1 }];
            voices.forEach((v) => {
                const base = (v.d / 1000) * sr;
                const depth = Math.min(0.004 * sr, (p.dblDrift / 1200 * Math.LN2) / (2 * Math.PI * v.f) * sr);
                const w = 2 * Math.PI * v.f / sr;
                let walk = 0, seed = 1234 + v.side * 77;
                for (let i = 0; i < len; i++) {
                    if (i % 64 === 0) { seed = (seed * 16807) % 2147483647; walk = walk * 0.995 + ((seed / 2147483647) * 2 - 1) * 0.02 * sr / 1000; }   // timing looseness, about ±1 ms
                    const s = at(x, i - (base + depth * Math.sin(w * i + v.ph) + walk)) * g;
                    if (v.side === 0) { L[i] += s; R[i] += s * 0.25; } else { R[i] += s; L[i] += s * 0.25; }
                }
            });
        }

        if (p.echoOn) {
            const x = filtered(m, sr, 350, p.echoLp);
            const g = lin(-p.echoBelow), d = Math.round(p.echoTime / 1000 * sr);
            for (let i = d; i < len; i++) { const s = (i - d) < N ? x[i - d] * g : 0; R[i] += s * 0.8; L[i] += s * 0.35; }     // one tap, leaning right, no feedback
        }

        if (halo && p.halo && p.halo !== "off") {
            const hm = filtered(monoOf(halo), sr, 500, p.haloLp);
            const g = lin(-p.haloBelow), d = Math.round(p.haloHaas / 1000 * sr);
            for (let i = 0; i < len && i < hm.length; i++) { L[i] += hm[i] * g * 0.7; if (i >= d) R[i] += hm[i - d] * g; }       // a few ms of width so it floats
        }
        return { channels: [L, R] };
    }

    root.VLResonance = { plan, build, ready, DEGREES };
})(typeof window !== "undefined" ? window : globalThis);
