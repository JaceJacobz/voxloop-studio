// ============================================================
// Music Theory engine: the "knows music" part of detection.
//
// Plain JavaScript, no dependencies, works in the page and in Node.
// It does two jobs:
//   1. analyzeKey()  - a harmonic key detector (chroma with tuning
//      correction, bass notes and chord evidence, mode-aware).
//   2. Music knowledge tables and helpers (scales, modes, relative
//      keys, diatonic chords, tempo / genre conventions) that the
//      "Music Brain" uses to check detectors against each other.
//
// It is a rule-based engine built on music theory. It is not a
// language model and it does not "listen" like a person.
// ============================================================
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.MusicTheory = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    // ---- scales and modes (semitones above the tonic) ----
    const MODES = {
        ionian:     [0, 2, 4, 5, 7, 9, 11],
        dorian:     [0, 2, 3, 5, 7, 9, 10],
        phrygian:   [0, 1, 3, 5, 7, 8, 10],
        lydian:     [0, 2, 4, 6, 7, 9, 11],
        mixolydian: [0, 2, 4, 5, 7, 9, 10],
        aeolian:    [0, 2, 3, 5, 7, 8, 10],
        locrian:    [0, 1, 3, 5, 6, 8, 10]
    };
    const MODE_ORDER = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];
    // How common each mode is in popular music (prior for choosing the tonic). Ionian and aeolian dominate.
    const MODE_PRIOR = { ionian: 1.0, aeolian: 1.0, dorian: 0.55, mixolydian: 0.5, lydian: 0.15, phrygian: 0.12, locrian: 0.01 };
    // Mode -> the major scale (ionian root) that holds the same seven notes: root minus this many semitones.
    const MODE_TO_IONIAN = { ionian: 0, dorian: 2, phrygian: 4, lydian: 5, mixolydian: 7, aeolian: 9, locrian: 11 };

    const mod12 = (x) => ((x % 12) + 12) % 12;

    function scaleNotes(rootPc, mode) {
        const m = MODES[mode] || MODES.ionian;
        return m.map((s) => mod12(rootPc + s));
    }

    // The seven notes of the key that this tonic + mode share (as a 12-slot 0/1 mask).
    function maskOf(rootPc, mode) {
        const mask = new Array(12).fill(false);
        scaleNotes(rootPc, mode).forEach((n) => { mask[n] = true; });
        return mask;
    }

    // Roman-numeral diatonic triads of a mode: [{degree, rootPc, quality, numeral}]
    function diatonicChords(rootPc, mode) {
        const notes = scaleNotes(rootPc, mode);
        const out = [];
        for (let d = 0; d < 7; d++) {
            const r = notes[d], t = notes[(d + 2) % 7], f = notes[(d + 4) % 7];
            const third = mod12(t - r), fifth = mod12(f - r);
            let q = "maj";
            if (third === 3 && fifth === 7) q = "min";
            else if (third === 3 && fifth === 6) q = "dim";
            else if (third === 4 && fifth === 8) q = "aug";
            const base = ["I", "II", "III", "IV", "V", "VI", "VII"][d];
            out.push({
                degree: d, rootPc: r, quality: q,
                numeral: (q === "min" || q === "dim") ? base.toLowerCase() + (q === "dim" ? "°" : "") : base
            });
        }
        return out;
    }

    function relativeOf(rootPc, scale) {      // "major" <-> "minor"
        return scale === "major" ? { root: mod12(rootPc + 9), scale: "minor" } : { root: mod12(rootPc + 3), scale: "major" };
    }

    // =========================================================
    //                         DSP
    // =========================================================
    const _fftCache = {};
    function fftPlan(n) {
        if (_fftCache[n]) return _fftCache[n];
        const levels = Math.log2(n) | 0;
        const rev = new Uint32Array(n);
        for (let i = 0; i < n; i++) {
            let x = i, r = 0;
            for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
            rev[i] = r;
        }
        const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
        for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
        return (_fftCache[n] = { n, rev, cos, sin });
    }
    function fft(re, im, plan) {
        const n = plan.n, rev = plan.rev;
        for (let i = 0; i < n; i++) {
            const j = rev[i];
            if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (let size = 2; size <= n; size <<= 1) {
            const half = size >> 1, step = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = 0, k = 0; j < half; j++, k += step) {
                    const a = i + j, b = a + half;
                    const tr = re[b] * plan.cos[k] + im[b] * plan.sin[k];
                    const ti = -re[b] * plan.sin[k] + im[b] * plan.cos[k];
                    re[b] = re[a] - tr; im[b] = im[a] - ti;
                    re[a] += tr; im[a] += ti;
                }
            }
        }
    }

    // Low-pass and drop the sample rate to about 11 kHz (all the pitch information lives below 4 kHz).
    function decimate(x, sr) {
        const f = Math.max(1, Math.round(sr / 11025));
        if (f === 1) return { x, sr };
        // two cascaded moving averages ~ a triangular FIR low-pass at sr/(2f)
        const n = x.length;
        const a = new Float32Array(n), b = new Float32Array(n);
        const w = f;
        let acc = 0;
        for (let i = 0; i < n; i++) { acc += x[i]; if (i >= w) acc -= x[i - w]; a[i] = acc / w; }
        acc = 0;
        for (let i = 0; i < n; i++) { acc += a[i]; if (i >= w) acc -= a[i - w]; b[i] = acc / w; }
        const m = Math.floor(n / f), out = new Float32Array(m);
        for (let i = 0; i < m; i++) out[i] = b[i * f];
        return { x: out, sr: sr / f };
    }

    // =========================================================
    //                   KEY DETECTION
    // =========================================================
    // Krumhansl-Kessler profiles, used only as a weak tie-breaker for the tonic.
    const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    function pearson(a, b) {
        let ma = 0, mb = 0;
        for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
        ma /= a.length; mb /= b.length;
        let n = 0, da = 0, db = 0;
        for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; n += x * y; da += x * x; db += y * y; }
        return n / (Math.sqrt(da * db) || 1);
    }


    // Collapse a per-frame list of chord degrees into runs, then find the shortest chord loop that explains them.
    // degrees: array of 0..6 (or null) = diatonic degree of the best 7-note set; returns {loop:[degree...], period, fit}
    function findLoop(degrees, minRun) {
        const runs = [];
        let cur = null, len = 0;
        const push = () => { if (cur != null && len >= (minRun || 3)) { if (!runs.length || runs[runs.length - 1] !== cur) runs.push(cur); } };
        for (const d of degrees) {
            if (d == null) continue;
            if (d === cur) len++; else { push(); cur = d; len = 1; }
        }
        push();
        if (runs.length < 4) return null;
        let best = null;
        for (let L = 1; L <= 6; L++) {
            if (runs.length < L * 2) break;
            for (let off = 0; off < L; off++) {
                let ok = 0, tot = 0;
                for (let i = off; i < runs.length; i++) { tot++; if (runs[i] === runs[off + ((i - off) % L)]) ok++; }
                const fit = ok / tot;
                // prefer short loops; a longer loop must clearly beat a shorter one
                const score = fit - 0.03 * L;
                if (!best || score > best.score) best = { score: score, fit: fit, period: L, loop: runs.slice(off, off + L) };
            }
        }
        return best && best.fit >= 0.8 ? best : null;
    }

    // Degree numbers of a set -> Roman numerals relative to a tonic/mode ("i", "VI", "III", "VII")
    function numeralsFor(loopDegrees, setRootPc, tonicPc, mode) {
        const setNotes = scaleNotes(setRootPc, "ionian");
        const tonicDeg = setNotes.indexOf(tonicPc);
        const dia = diatonicChords(tonicPc, mode);
        return loopDegrees.map((d) => { const rel = (d - tonicDeg + 7) % 7; return dia[rel].numeral; });
    }


    /**
     * keyFromMelody(notes, hopSec): the key of a sung line.
     *   notes: [{center (MIDI, fractional), start, end}]  (frames if hopSec is given, else seconds)
     * A singer is often a little flat or sharp all the way through, so the overall tuning offset is estimated first.
     * Then: the 7-note set that holds most of the (duration-weighted) notes, and the home note from where phrases land and rest.
     */
    function keyFromMelody(notesIn, hopSec) {
        if (!notesIn || notesIn.length < 6) return null;
        const hs = hopSec > 0 ? hopSec : 1;                       // note start/end are in frames when hopSec is given, seconds otherwise
        const notes = notesIn.map((n) => ({ center: n.center, start: n.start * hs, end: n.end * hs }));
        // overall tuning: weighted circular mean of how far each note sits from the nearest semitone
        let sx = 0, sy = 0;
        for (const n of notes) {
            const dur = Math.max(0.05, n.end - n.start), frac = n.center - Math.round(n.center), a = frac * 2 * Math.PI;
            sx += dur * Math.cos(a); sy += dur * Math.sin(a);
        }
        const offset = Math.atan2(sy, sx) / (2 * Math.PI);         // semitones, -0.5..0.5
        const tuningCents = Math.round(offset * 100);
        const hist = new Float64Array(12), fin = new Float64Array(12), first = new Float64Array(12);
        const sorted = notes.slice().sort((a, b) => a.start - b.start);
        sorted.forEach((n, i) => {
            const pc = mod12(Math.round(n.center - offset)), dur = Math.max(0.05, n.end - n.start);
            hist[pc] += Math.sqrt(dur);                                 // a long held note counts more, but not overwhelmingly
            const next = sorted[i + 1];
            if (!next || next.start - n.end > 0.35) fin[pc] += Math.min(1.5, 0.5 + dur);          // the note a phrase comes to rest on
            const prev = sorted[i - 1];
            if (!prev || n.start - prev.end > 0.6) first[pc] += 0.5;
        });
        const norm = (a) => { let t = 0; for (let i = 0; i < 12; i++) t += a[i]; return Array.from(a).map((v) => (t > 0 ? v / t : 0)); };
        const H = norm(hist), F = norm(fin), S = norm(first);
        // 7-note set
        const setScore = new Float64Array(12);
        for (let r = 0; r < 12; r++) { const m = maskOf(r, "ionian"); let sc = 0; for (let i = 0; i < 12; i++) sc += (m[i] ? 1 : -1) * H[i]; setScore[r] = sc; }
        const order = Array.from({ length: 12 }, (_, i) => i).sort((a, b) => setScore[b] - setScore[a]);
        const setRoot = order[0], margin = setScore[order[0]] - setScore[order[1]];
        // home note among the seven (ionian and aeolian preferred: they are what popular melodies mostly use)
        const setNotes = scaleNotes(setRoot, "ionian");
        let best = null, second = -1e9;
        for (let d = 0; d < 7; d++) {
            const t = setNotes[d], mode = MODE_ORDER.find((mm) => MODE_TO_IONIAN[mm] === mod12(t - setRoot));
            const third = mod12(setNotes[(d + 2) % 7] - t);
            const sc = (1.0 * F[t] + 0.7 * H[t] + 0.3 * S[t] + 0.25 * H[mod12(t + 7)] + (third === 3 || third === 4 ? 0.1 : 0)) * (0.45 + 0.55 * MODE_PRIOR[mode]);
            if (!best || sc > best.sc) { if (best) second = best.sc; best = { t: t, mode: mode, sc: sc }; } else if (sc > second) second = sc;
        }
        let rootPc = best.t, scale = best.mode === "aeolian" ? "minor" : "major";
        if (best.mode !== "aeolian" && best.mode !== "ionian") { rootPc = setRoot; scale = "major"; }      // modal: keep the same seven notes
        return {
            rootPc: rootPc, scale: scale, mode: best.mode, modeRootPc: best.t, label: NOTE_NAMES[rootPc] + " " + scale,
            score: setScore[setRoot], confidence: Math.max(0, Math.min(1, margin / 0.25)), tonicConfidence: Math.max(0, Math.min(1, (best.sc - second) / 0.12)),
            tuningCents: tuningCents, mask: maskOf(setRoot, "ionian")
        };
    }

    /**
     * analyzeKey(mono, sr, opts)
     *   mono : Float32Array (mixed to mono)
     *   returns {
     *     key, scale ("Major"|"Minor"),   // spelled so the 7 notes are right even for modes
     *     mode, modeRoot,                  // the richer name, e.g. D dorian
     *     confidence,                      // how sure we are of the 7-note set (what tuning needs)
     *     tonicConfidence,                 // how sure we are of which of the 7 is "home"
     *     mask, chroma, bassChroma, tuningCents, chords: [...], alternatives: [...]
     *   }
     */
    function analyzeKey(monoIn, srIn, opts) {
        opts = opts || {};
        if (!monoIn || monoIn.length < srIn * 3) return { key: null, scale: null, confidence: 0, reason: "Audio too short to find a key." };

        const maxSec = opts.maxSeconds || 100;
        const take = Math.min(monoIn.length, Math.floor(srIn * maxSec));
        const dec = decimate(monoIn.subarray(0, take), srIn);
        const x = dec.x, sr = dec.sr;

        const N = 8192, HOP = 2048;
        const plan = fftPlan(N);
        const win = new Float64Array(N);
        for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
        const binHz = sr / N;
        const kLo = Math.max(2, Math.floor(30 / binHz));
        const kHi = Math.min(N / 2 - 2, Math.floor(3500 / binHz));
        const nBins = kHi - kLo + 1;
        const nFrames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
        if (nFrames < 4) return { key: null, scale: null, confidence: 0, reason: "Audio too short to find a key." };

        // ---- magnitude spectrogram (bins kLo..kHi) ----
        const spec = new Float32Array(nFrames * nBins);
        const re = new Float64Array(N), im = new Float64Array(N);
        const frameRms = new Float64Array(nFrames);
        for (let f = 0; f < nFrames; f++) {
            const o = f * HOP;
            let e = 0;
            for (let i = 0; i < N; i++) { const v = x[o + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
            frameRms[f] = Math.sqrt(e / N);
            fft(re, im, plan);
            for (let k = 0; k < nBins; k++) {
                const kk = kLo + k;
                spec[f * nBins + k] = Math.sqrt(re[kk] * re[kk] + im[kk] * im[kk]);
            }
        }

        // ---- harmonic / percussive split: median across time keeps sustained notes, drops drum hits ----
        const harm = new Float32Array(nFrames * nBins);
        {
            const W = 9, h = W >> 1, tmp = new Float32Array(W);
            const percW = 25, ph = percW >> 1, ptmp = new Float32Array(percW);
            const Hm = new Float32Array(nFrames * nBins);
            for (let k = 0; k < nBins; k++) {
                for (let f = 0; f < nFrames; f++) {
                    for (let j = 0; j < W; j++) { const ff = Math.min(nFrames - 1, Math.max(0, f - h + j)); tmp[j] = spec[ff * nBins + k]; }
                    Hm[f * nBins + k] = tmp.slice().sort()[h];
                }
            }
            // percussive median across frequency (per frame)
            for (let f = 0; f < nFrames; f++) {
                const base = f * nBins;
                for (let k = 0; k < nBins; k++) {
                    for (let j = 0; j < percW; j++) { const kk = Math.min(nBins - 1, Math.max(0, k - ph + j)); ptmp[j] = spec[base + kk]; }
                    const P = ptmp.slice().sort()[ph];
                    const H = Hm[base + k];
                    // soft mask (Wiener-like, power 2)
                    harm[base + k] = spec[base + k] * (H * H) / (H * H + P * P + 1e-12);
                }
            }
        }

        // ---- peak picking with parabolic interpolation, collect for tuning estimate ----
        const peaks = [];            // per frame: arrays of [freq, weight]
        const tuneHist = new Float64Array(100);
        for (let f = 0; f < nFrames; f++) {
            const base = f * nBins;
            let mx = 0;
            for (let k = 0; k < nBins; k++) if (harm[base + k] > mx) mx = harm[base + k];
            const list = [];
            if (mx > 0 && frameRms[f] > 1e-5) {
                const thr = mx * 0.04;
                for (let k = 2; k < nBins - 2; k++) {
                    const m = harm[base + k];
                    if (m < thr || m < harm[base + k - 1] || m <= harm[base + k + 1]) continue;
                    // parabola on log magnitude
                    const a = Math.log(harm[base + k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(harm[base + k + 1] + 1e-12);
                    const den = a - 2 * b + c;
                    const d = den === 0 ? 0 : 0.5 * (a - c) / den;
                    const freq = (kLo + k + d) * binHz;
                    if (freq < 40 || freq > 3200) continue;
                    const w = Math.sqrt(m / mx);
                    list.push([freq, w]);
                    if (freq > 90 && freq < 1600) {
                        const cents = 1200 * Math.log2(freq / 440);
                        const dev = ((cents % 100) + 150) % 100;          // 0..100, 50 = exactly in tune
                        tuneHist[Math.min(99, Math.floor(dev))] += w;
                    }
                }
            }
            peaks.push(list);
        }

        // ---- tuning estimate (cents the whole recording is off from A=440), circular-smoothed peak of the histogram ----
        let tuneCents = 0, tuningRaw = 0, tuningStrength = 0;
        {
            let best = -1, bi = 50;
            for (let i = 0; i < 100; i++) {
                let s = 0;
                for (let d = -4; d <= 4; d++) s += tuneHist[(i + d + 100) % 100] * (1 - Math.abs(d) / 5);
                if (s > best) { best = s; bi = i; }
            }
            tuneCents = bi - 50;            // positive = recording is sharp
            tuningRaw = tuneCents;
            // how concentrated the peaks are around that offset (random pitches would put 24% of them within +-12 cents)
            let near = 0, all = 0;
            for (let i = 0; i < 100; i++) { all += tuneHist[i]; const d = Math.min(Math.abs(i - bi), 100 - Math.abs(i - bi)); if (d <= 12) near += tuneHist[i]; }
            tuningStrength = all > 0 ? Math.max(0, Math.min(1, (near / all - 0.24) / 0.5)) : 0;
            if (Math.abs(tuneCents) < 8) tuneCents = 0;       // inside the noise: leave it alone
        }

        // ---- chroma (HPCP-like). `full` uses 100-2000 Hz, `bass` uses 35-260 Hz ----
        const harmonicsW = [1, 0.5, 0.33, 0.25];
        const chromaFrames = new Array(nFrames), bassFrames = new Array(nFrames);
        const spread = (arr, pcFloat, w) => {
            // spread weight over the two nearest pitch classes (linear), keeps semitone precision
            const lo = Math.floor(pcFloat), fr = pcFloat - lo;
            arr[mod12(lo)] += w * (1 - fr);
            arr[mod12(lo + 1)] += w * fr;
        };
        for (let f = 0; f < nFrames; f++) {
            const c = new Float64Array(12), bchr = new Float64Array(12);
            for (const [freq, w] of peaks[f]) {
                const midi = 69 + 12 * Math.log2(freq / 440) - tuneCents / 100;
                if (freq >= 100 && freq <= 2000) {
                    for (let h = 0; h < harmonicsW.length; h++) {
                        const sub = midi - 12 * Math.log2(h + 1);
                        if (sub < 33) break;                  // do not invent notes below A1
                        spread(c, sub, w * harmonicsW[h]);
                    }
                }
                if (freq >= 35 && freq <= 260) spread(bchr, midi, w);
            }
            chromaFrames[f] = c; bassFrames[f] = bchr;
        }

        // ---- smooth over time (~1 s), average into the song-level profile ----
        const nrm = (v) => { let s = 0; for (let i = 0; i < 12; i++) s += v[i]; const o = new Float64Array(12); if (s > 0) for (let i = 0; i < 12; i++) o[i] = v[i] / s; return o; };
        const chroma = new Float64Array(12), bassChroma = new Float64Array(12);
        let used = 0;
        for (let f = 0; f < nFrames; f++) {
            const c = nrm(chromaFrames[f]);
            let tot = 0; for (let i = 0; i < 12; i++) tot += chromaFrames[f][i];
            if (tot <= 0) continue;
            for (let i = 0; i < 12; i++) chroma[i] += c[i];
            const b = nrm(bassFrames[f]);
            for (let i = 0; i < 12; i++) bassChroma[i] += b[i];
            used++;
        }
        if (used < 3) return { key: null, scale: null, confidence: 0, reason: "No clear pitched notes found." };
        for (let i = 0; i < 12; i++) { chroma[i] /= used; bassChroma[i] /= used; }

        // ---- 1. which 7-note set? (12 candidates) ----
        // Score = share of tonal energy that falls inside the set. Each candidate is compared with the others, and a note that is
        // clearly absent counts for more than a note that is merely quiet.
        const setScore = new Float64Array(12);      // index = ionian root
        for (let r = 0; r < 12; r++) {
            const m = maskOf(r, "ionian");
            let inn = 0, out = 0;
            for (let i = 0; i < 12; i++) { if (m[i]) inn += chroma[i]; else out += chroma[i]; }
            setScore[r] = inn - out;
        }
        const smooth = [];
        const SM = 2;     // +/-2 frames ~ 0.4 s around each frame
        for (let f = 0; f < nFrames; f++) {
            const s = new Float64Array(12);
            for (let d = -SM; d <= SM; d++) { const ff = f + d; if (ff < 0 || ff >= nFrames) continue; const c = chromaFrames[ff]; for (let i = 0; i < 12; i++) s[i] += c[i]; }
            smooth.push(nrm(s));
        }

        // ---- 1b. chord-progression plausibility (music knowledge) ----
        // When a loop only plays two or three chords, several 7-note sets fit the notes equally well (Bm-G fits G major and D major).
        // Popular music uses some chord roles far more than others (I, IV, V, vi are common; iii and vii are rare), so the set in
        // which the observed chords play the most common roles is the likelier reading.
        const DEG_W = [1.0, 0.6, 0.35, 0.9, 0.9, 0.95, 0.1];
        const triadHist = { maj: new Float64Array(12), min: new Float64Array(12) };
        for (let f = 0; f < nFrames; f++) {
            let tt = 0; for (let i = 0; i < 12; i++) tt += chromaFrames[f][i];
            if (tt <= 0) continue;
            const c = smooth[f] || nrm(chromaFrames[f]);
            let bq = "maj", br = 0, bs = -1;
            for (let r = 0; r < 12; r++) {
                const sM = c[r] + c[mod12(r + 4)] + c[mod12(r + 7)], sm = c[r] + c[mod12(r + 3)] + c[mod12(r + 7)];
                if (sM > bs) { bs = sM; bq = "maj"; br = r; }
                if (sm > bs) { bs = sm; bq = "min"; br = r; }
            }
            triadHist[bq][br] += 1;
        }
        let triadTot = 0; for (let i = 0; i < 12; i++) triadTot += triadHist.maj[i] + triadHist.min[i];
        triadTot = triadTot || 1;
        const plaus = new Float64Array(12);
        for (let r = 0; r < 12; r++) {
            const dc = diatonicChords(r, "ionian");
            let p = 0;
            for (let d = 0; d < 7; d++) {
                const q = dc[d].quality === "min" ? "min" : "maj";
                if (dc[d].quality === "dim" || dc[d].quality === "aug") continue;
                p += triadHist[q][dc[d].rootPc] * DEG_W[d];
                const oq = q === "maj" ? "min" : "maj";
                p -= 0.3 * triadHist[oq][dc[d].rootPc];          // right root, wrong quality for this key
            }
            plaus[r] = p / triadTot;
        }
        // Only sets the audio cannot tell apart (within BAND of the best) are re-ranked by plausibility; clear audio evidence always wins.
        const LAMBDA = opts.plausWeight != null ? opts.plausWeight : 0.5, BAND = opts.plausBand != null ? opts.plausBand : 0.06;
        const bestAudio = Math.max.apply(null, Array.from(setScore));
        const setFinal = new Float64Array(12);
        for (let r = 0; r < 12; r++) setFinal[r] = setScore[r] >= bestAudio - BAND ? setScore[r] + LAMBDA * plaus[r] : setScore[r] - 10;
        const order = Array.from({ length: 12 }, (_, i) => i).sort((a, b) => setFinal[b] - setFinal[a]);
        const bestSetRoot = order[0];
        const margin = setScore[bestSetRoot] - Math.max(...order.slice(1).map((r) => setScore[r]));   // audio-only margin (plausibility never inflates confidence)
        const setConfidence = Math.max(0, Math.min(1, margin / 0.12));

        // ---- 2. chords through time, restricted to the chords that belong to the best set ----
        const diaIonian = diatonicChords(bestSetRoot, "ionian");
        const chordPc = new Float64Array(12);        // time spent on each root (pitch class) among diatonic chords
        const chordLog = [];
        let firstBlock = null;
        for (let f = 0; f < nFrames; f += 1) {
            const c = smooth[f];
            let tot = 0; for (let i = 0; i < 12; i++) tot += chromaFrames[f][i];
            if (tot <= 0) { chordLog.push(null); continue; }
            let best = -1, bestS = -1e9;
            for (let d = 0; d < 7; d++) {
                const ch = diaIonian[d];
                const r = ch.rootPc, th = ch.quality === "min" || ch.quality === "dim" ? 3 : 4, fi = ch.quality === "dim" ? 6 : 7;
                // triad energy, with a small bonus for the bass actually playing the root
                const bm = bassFrames[f];
                let bs = 0; for (let i = 0; i < 12; i++) bs += bm[i];
                const s = c[r] + c[mod12(r + th)] + c[mod12(r + fi)] - 0.5 * (1 - 0) * (1 / 12) * 0 + (bs > 0 ? 0.35 * bm[r] / bs : 0);
                if (s > bestS) { bestS = s; best = d; }
            }
            chordLog.push(best);
            chordPc[diaIonian[best].rootPc] += 1;
        }
        // Chord at the start of the first stable stretch (loops usually begin on the tonic chord)
        const startChords = new Float64Array(12);
        {
            let cnt = 0;
            for (let f = 0; f < chordLog.length && cnt < 24; f++) { if (chordLog[f] == null) continue; startChords[diaIonian[chordLog[f]].rootPc] += 1; cnt++; }
        }
        // Last chords
        const endChords = new Float64Array(12);
        {
            let cnt = 0;
            for (let f = chordLog.length - 1; f >= 0 && cnt < 12; f--) { if (chordLog[f] == null) continue; endChords[diaIonian[chordLog[f]].rootPc] += 1; cnt++; }
        }

        // ---- 3. which of the seven notes is "home"? every mode of the best set is a candidate ----
        const tot = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s || 1; };
        const chordTot = tot(chordPc), bassTot = tot(bassChroma), stTot = tot(startChords), enTot = tot(endChords);
        const W = Object.assign({ bass: 1.0, chord: 1.1, support: 0.6, start: 1.2, end: 0.25, energy: 0.6, profile: 0.1 }, opts.weights || {});
        const cands = [];
        for (let d = 0; d < 7; d++) {
            const tonic = scaleNotes(bestSetRoot, "ionian")[d];
            const mode = MODE_ORDER.find((mm) => MODE_TO_IONIAN[mm] === mod12(tonic - bestSetRoot)) || "ionian";
            const dom = mod12(tonic + 7), sub = mod12(tonic + 5);
            // evidence
            const ev = {
                bass: bassChroma[tonic] / bassTot,                              // tonic is the most-played bass note
                chord: chordPc[tonic] / chordTot,                              // tonic chord is the most-played chord
                support: (chordPc[dom] * 0.5 + chordPc[sub] * 0.3) / chordTot, // dominant and subdominant chords prop it up
                start: startChords[tonic] / stTot,
                end: endChords[tonic] / enTot,
                energy: chroma[tonic]
            };
            // key-profile fit of the whole chroma (major profile for major-third modes, minor profile otherwise)
            const third = mod12(scaleNotes(bestSetRoot, "ionian")[(d + 2) % 7] - tonic);
            const prof = third === 4 ? KK_MAJOR : KK_MINOR;
            const rot = []; for (let i = 0; i < 12; i++) rot.push(prof[mod12(i - tonic)]);
            ev.profile = pearson(Array.from(chroma), rot);
            const score = W.bass * ev.bass + W.chord * ev.chord + W.support * ev.support + W.start * ev.start + W.end * ev.end + W.energy * ev.energy + W.profile * ev.profile;
            cands.push({ tonic, mode, third, score: score * (0.4 + 0.6 * MODE_PRIOR[mode]), ev });
        }
        cands.sort((a, b) => b.score - a.score);
        const tonicMargin = cands[0].score - cands[1].score;
        const tonicConfidence = Math.max(0, Math.min(1, tonicMargin / 0.12));
        const top = cands[0];

        // Spelling that keeps the seven notes right for tuning: dorian etc. are written as the major (ionian) or minor (aeolian) of the same set.
        let spellRoot, spellScale;
        if (top.mode === "aeolian") { spellRoot = top.tonic; spellScale = "Minor"; }
        else if (top.mode === "ionian") { spellRoot = top.tonic; spellScale = "Major"; }
        else {
            // modal: write it as the relative major (same notes); keep the modal name in `mode`
            spellRoot = bestSetRoot; spellScale = "Major";
        }

        // chord loop in Roman numerals, relative to the detected home note and mode
        let progression = null;
        {
            const lp = findLoop(chordLog, 3);
            if (lp) {
                const nums = numeralsFor(lp.loop, bestSetRoot, top.tonic, top.mode);
                // start the loop on the tonic chord when it is part of it (how people write it down)
                const ti = lp.loop.findIndex((d) => scaleNotes(bestSetRoot, "ionian")[d] === top.tonic);
                const rot = ti > 0 ? nums.slice(ti).concat(nums.slice(0, ti)) : nums;
                progression = { numerals: rot, text: rot.join(" - "), loopChords: lp.loop.length, fit: lp.fit };
            }
        }
        const alternatives = cands.slice(1, 4).map((c) => ({ tonic: NOTE_NAMES[c.tonic], mode: c.mode, score: c.score }));
        return {
            key: NOTE_NAMES[spellRoot],
            scale: spellScale,
            mode: top.mode,
            modeRoot: NOTE_NAMES[top.tonic],
            confidence: setConfidence,
            tonicConfidence,
            score: setScore[bestSetRoot],
            margin,
            mask: maskOf(bestSetRoot, "ionian"),
            setRoot: NOTE_NAMES[bestSetRoot],
            chroma: Array.from(chroma),
            bassChroma: Array.from(bassChroma),
            tuningCents: tuneCents,
            tuningRaw: tuningRaw,
            tuningStrength: tuningStrength,
            chordTimeShare: Array.from(chordPc).map((v) => v / chordTot),
            alternatives,
            progression,
            candDebug: opts.debug ? cands.map((c) => ({ t: NOTE_NAMES[c.tonic], m: c.mode, s: +c.score.toFixed(3), ev: Object.fromEntries(Object.entries(c.ev).map(([k, v]) => [k, +v.toFixed(2)])) })) : undefined,
            engine: "musictheory-v1"
        };
    }

    // =========================================================
    //          TEMPO KNOWLEDGE (how fast styles are played)
    // =========================================================
    // The tempo detector cannot always tell 68 from 136: both are the same pulse, one count apart. A musician settles it with
    // genre knowledge: slow-jam R&B is counted at 60-90, trap is counted at 130-170 even when the snare lands half-time.
    // `typical` is where the style is normally counted, `hard` the range outside which a tempo is unusual for that style.
    const GENRE_TEMPO = {
        rnb:       { typical: [58, 98],  hard: [50, 110] },
        rap:       { typical: [76, 100], hard: [68, 112] },
        afrobeats: { typical: [90, 118], hard: [80, 128] },
        amapiano:  { typical: [104, 116], hard: [100, 122] },
        trap:      { typical: [130, 172], hard: [120, 190] }
    };
    // Which count of the pulse (half / as detected / double) fits the style? Returns {bpm, factor, changed, reason}.
    function reconcileTempo(bpm, genreId, opts) {
        const info = GENRE_TEMPO[genreId];
        const same = { bpm: bpm, factor: 1, changed: false, reason: null };
        if (!info || !bpm) return same;
        const inRange = (v, r) => v >= r[0] && v <= r[1];
        const dist = (v) => v < info.typical[0] ? info.typical[0] / v : v > info.typical[1] ? v / info.typical[1] : 1;
        if (inRange(bpm, info.typical)) return same;                       // already normal for the style: never touch it
        const cands = [0.5, 2].map((k) => ({ k: k, v: bpm * k })).filter((c) => inRange(c.v, info.typical));
        if (!cands.length) return same;
        cands.sort((a, b) => dist(a.v) - dist(b.v));
        const pick = cands[0];
        return {
            bpm: pick.v, factor: pick.k, changed: true,
            reason: (pick.k === 0.5 ? "Counted at half speed: " : "Counted at double speed: ") + (opts && opts.label ? opts.label : genreId) +
                " is normally felt at " + info.typical[0] + "-" + info.typical[1] + " BPM"
        };
    }

    return {
        GENRE_TEMPO, reconcileTempo, keyFromMelody, findLoop,
        NOTE_NAMES, MODES, MODE_ORDER, MODE_TO_IONIAN, MODE_PRIOR,
        scaleNotes, maskOf, diatonicChords, relativeOf, mod12,
        analyzeKey, fft, fftPlan, decimate
    };
});
