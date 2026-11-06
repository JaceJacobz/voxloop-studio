/**
 * Voxloop Studio — Voice ID
 *
 * Works out WHAT KIND OF VOICE a take is, so the effects chosen for it are the right ones.
 * Before this, the brain looked at one number (the median pitch: under 150 Hz "low", under 235 Hz "mid", else "high")
 * and at how many notes were held. That mislabels a male falsetto (high pitch, big voice) and a low female voice (low
 * pitch, small voice), and it cannot tell sung from rapped when a rapper holds a few notes.
 *
 * This module measures instead of guessing, and every effect setting is meant to follow a MEASUREMENT, not a label:
 *
 *   pitch range      where the voice lives (median, low edge, high edge)           -> low cut, harmony choice
 *   sibilance        where the voice's own S / T / SH energy sits (4-10 kHz)      -> de-esser frequency
 *   breathiness      how clean the harmonics are in the voiced sound              -> how much air / saturation is safe
 *   delivery         sung / mixed / rapped from held notes, pitch plateaus,        -> tuning on or off, comp timing,
 *                    syllable rate and pitch span                                    reverb, harmony
 *
 * It also reports a confidence. When the confidence is low the brain uses neutral settings and says so, because a
 * wrong confident answer is worse than a plain one.
 *
 * Pure functions on Float32Arrays. No Web Audio, no DOM: the same file runs in the page and in Node (tests/).
 * It does not say "male" or "female": pitch cannot decide that, so it reports the range that is sung and, where two voice
 * types overlap, says so ("tenor / low alto").
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.VoiceID = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, u) => a + (b - a) * u;
    const smooth01 = (x, a, b) => clamp((x - a) / ((b - a) || 1), 0, 1);
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    function sorted(a) { return Array.prototype.slice.call(a).sort((x, y) => x - y); }
    function pctOf(a, p) { if (!a.length) return NaN; const s = sorted(a); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; }
    function medianOf(a) { return pctOf(a, 0.5); }

    // ------------------------------------------------------------------ tiny FFT (radix 2, in place)
    const twCache = new Map();
    function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        let tw = twCache.get(n);
        if (!tw) { tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) }; for (let k = 0; k < n / 2; k++) { tw.c[k] = Math.cos(2 * Math.PI * k / n); tw.s[k] = -Math.sin(2 * Math.PI * k / n); } twCache.set(n, tw); }
        for (let len = 2; len <= n; len <<= 1) {
            const half = len >> 1, step = n / len;
            for (let i = 0; i < n; i += len) {
                for (let k = 0; k < half; k++) {
                    const wr = tw.c[k * step], wi = tw.s[k * step];
                    const a = i + k, b = a + half;
                    const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
                }
            }
        }
    }

    function monoOf(ch) {
        if (!ch.length) return new Float32Array(0);
        if (ch.length === 1) return ch[0];
        const o = new Float32Array(ch[0].length);
        for (const c of ch) for (let i = 0; i < o.length; i++) o[i] += c[i] / ch.length;
        return o;
    }

    // ------------------------------------------------------------------ main analysis
    /**
     * @param {object} o
     *   mono   Float32Array  the vocal (mono)
     *   sr     number        its sample rate
     *   midi   Float32Array  pitch track in MIDI notes (NaN = unvoiced), from the tune engine
     *   hop    number        samples between pitch frames
     *   notes  Array         optional [{start,end,center}] in pitch frames
     */
    function describe(o) {
        const x = o.mono, sr = o.sr, midi = o.midi, hop = o.hop || Math.round(0.006 * sr);
        const out = { ok: false, confidence: 0, f0: null, register: "unknown", sib: null,
            harmonicity: null, delivery: { label: "unknown", score: null, sustained: null, plateau: null, syllablesPerSec: null, spanSt: null }, hints: null, notes: [] };
        if (!x || !x.length || !midi || !midi.length) { out.notes.push("No pitch track, so the voice type could not be judged."); return out; }

        // ---- 1. pitch range
        const v = [], idx = [];
        for (let k = 0; k < midi.length; k++) if (!isNaN(midi[k])) { v.push(midi[k]); idx.push(k); }
        const hopSec = hop / sr;
        out.voicedSec = v.length * hopSec;
        if (v.length * hopSec < 1.0) { out.notes.push("Under a second of clear pitch, so the voice type is a guess."); return out; }
        const med = medianOf(v);
        out.f0 = { median: hz(med), low: hz(pctOf(v, 0.05)), high: hz(pctOf(v, 0.95)), spanSt: pctOf(v, 0.95) - pctOf(v, 0.05) };

        // frame energy (dB) for picking good frames and for the syllable counter
        const ehop = Math.round(0.01 * sr), ne = Math.floor(x.length / ehop), edb = new Float32Array(ne);
        for (let b = 0; b < ne; b++) { let s = 0; const a = b * ehop; for (let i = a; i < a + ehop; i++) s += x[i] * x[i]; edb[b] = 10 * Math.log10(Math.max(1e-12, s / ehop)); }
        const voicedDb = [];
        for (const k of idx) { const b = Math.min(ne - 1, Math.floor(k * hop / ehop)); voicedDb.push(edb[b]); }
        const voicedMed = medianOf(voicedDb);

        // ---- 2. the voice's own sibilants (unvoiced, bright, loud enough to be an S and not background hiss)
        const N = 1024, re = new Float64Array(N), im = new Float64Array(N), hannW = new Float64Array(N);
        for (let i = 0; i < N; i++) hannW[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        const binHz = sr / N, loBin = Math.ceil(3500 / binHz), hiBin = Math.min(N / 2 - 1, Math.floor(Math.min(11500, sr * 0.45) / binHz)), lowBin = Math.ceil(120 / binHz);
        const cents = [], ratios = [];
        const nf = Math.floor((x.length - N) / (N / 2)), stepF = Math.max(1, Math.floor(nf / 900));
        const voicedAt = new Uint8Array(midi.length);
        for (let k = 0; k < midi.length; k++) voicedAt[k] = isNaN(midi[k]) ? 0 : 1;
        for (let f = 0; f < nf; f += stepF) {
            const a = f * (N / 2), c0 = Math.floor(a / hop), c1 = Math.min(midi.length - 1, Math.floor((a + N) / hop));
            let anyVoiced = false; for (let k = c0; k <= c1; k++) if (voicedAt[k]) { anyVoiced = true; break; }
            if (anyVoiced) continue;
            let s = 0; for (let i = 0; i < N; i++) s += x[a + i] * x[a + i];
            if (10 * Math.log10(Math.max(1e-12, s / N)) < voicedMed - 24) continue;        // quieter than a real S next to this voice
            for (let i = 0; i < N; i++) { re[i] = x[a + i] * hannW[i]; im[i] = 0; }
            fft(re, im);
            let hf = 0, tot = 0, wsum = 0, wf = 0;
            for (let b = lowBin; b <= hiBin; b++) { const p = re[b] * re[b] + im[b] * im[b]; tot += p; if (b >= loBin) { hf += p; wsum += p; wf += p * b * binHz; } }
            if (tot <= 0) continue;
            const ratio = hf / tot;
            if (ratio < 0.6) continue;
            cents.push(wf / wsum); ratios.push(ratio);
        }
        if (cents.length >= 4) out.sib = { hz: medianOf(cents), frames: cents.length, strength: medianOf(ratios) };

        // ---- 3. how clean the harmonics are (1 = pure tone, lower = breath / noise in the voice)
        const hv = [], nh = Math.min(100, idx.length), sh = nh ? idx.length / nh : 1, W = Math.round(0.025 * sr);
        for (let t = 0; t < nh; t++) {
            const k = idx[Math.floor(t * sh)], f0k = hz(midi[k]), L = Math.round(sr / f0k), s0 = k * hop - (W >> 1);
            if (s0 < 0 || s0 + W + L + 3 >= x.length) continue;
            let best = -1;
            for (let l = L - 2; l <= L + 2; l++) {
                let xy = 0, xx = 0, yy = 0;
                for (let i = 0; i < W; i++) { const a1 = x[s0 + i], b1 = x[s0 + i + l]; xy += a1 * b1; xx += a1 * a1; yy += b1 * b1; }
                const r = xy / Math.sqrt(xx * yy + 1e-18);
                if (r > best) best = r;
            }
            hv.push(best);
        }
        if (hv.length >= 10) out.harmonicity = medianOf(hv);

        // ---- 4. sung / mixed / rapped
        const d = out.delivery;
        // (a) held notes
        let sustained = null;
        if (o.notes && o.notes.length) {
            let voiced = 0, sus = 0;
            o.notes.forEach((n) => { const sec = (n.end - n.start) * hopSec; voiced += sec; if (sec >= 0.22) sus += sec; });
            sustained = voiced > 0 ? sus / voiced : 0;
            const centres = o.notes.map((n) => n.center);
            d.spanSt = centres.length >= 4 ? pctOf(centres, 0.9) - pctOf(centres, 0.1) : null;
        }
        d.sustained = sustained;
        // (b) pitch plateaus: share of voiced time that sits within 1.2 semitones for 250 ms or more
        const wLen = Math.max(3, Math.round(0.25 / hopSec)); let plate = 0, tot = 0;
        for (let k = 0; k + wLen < midi.length; k += 2) {
            let lo = Infinity, hi = -Infinity, ok = true;
            for (let i = k; i < k + wLen; i++) { const m = midi[i]; if (isNaN(m)) { ok = false; break; } if (m < lo) lo = m; if (m > hi) hi = m; }
            let any = false; for (let i = k; i < k + wLen; i++) if (!isNaN(midi[i])) { any = true; break; }
            if (!any) continue;
            tot++; if (ok && hi - lo <= 1.2) plate++;
        }
        d.plateau = tot ? plate / tot : null;
        // (c) syllables per second of speech (peaks in the loudness curve that stand clear of the dip beside them)
        const sm = new Float32Array(ne);
        for (let b = 0; b < ne; b++) { let s = 0, c = 0; for (let j = -1; j <= 1; j++) { const i = b + j; if (i >= 0 && i < ne) { s += edb[i]; c++; } } sm[b] = s / c; }
        const gate = voicedMed - 22; let active = 0, peaks = 0, lastPk = -99;
        for (let b = 0; b < ne; b++) if (sm[b] >= gate) active++;
        for (let b = 5; b < ne - 5; b++) {
            if (sm[b] < gate + 4) continue;
            let isMax = true; for (let j = -5; j <= 5; j++) if (sm[b + j] > sm[b]) { isMax = false; break; }
            if (!isMax || b - lastPk < 8) continue;
            let lv = sm[b], rv = sm[b]; for (let j = 1; j <= 15 && b - j >= 0; j++) lv = Math.min(lv, sm[b - j]); for (let j = 1; j <= 15 && b + j < ne; j++) rv = Math.min(rv, sm[b + j]);
            if (sm[b] - Math.max(lv, rv) >= 2.5) { peaks++; lastPk = b; }
        }
        d.syllablesPerSec = active > 100 ? peaks / (active * 0.01) : null;
        // combine: held notes and plateaus say "sung", fast syllables say "rapped"
        let sc = 0, wt = 0;
        if (d.sustained != null) { sc += 0.42 * smooth01(d.sustained, 0.22, 0.7); wt += 0.42; }
        if (d.plateau != null) { sc += 0.28 * smooth01(d.plateau, 0.12, 0.6); wt += 0.28; }
        if (d.syllablesPerSec != null) { sc += 0.30 * (1 - smooth01(d.syllablesPerSec, 3.2, 6.2)); wt += 0.30; }
        if (wt > 0) {
            d.score = sc / wt;
            d.label = d.score >= 0.68 ? "sung" : d.score <= 0.36 ? "rapped" : "mixed";
        }

        // ---- 5. register. Pitch alone cannot tell a high male voice from a low female one, so the bands in the middle say so
        // instead of guessing. (A formant-based "voice size" was tried and removed: on test voices the same vocal tract
        // read anywhere from 1.03 to 1.21 depending on the pitch sung, which would have caused exactly the wrong-label
        // problem this module exists to prevent.)
        const f0m = out.f0.median;
        const reg = f0m < 105 ? "bass" : f0m < 150 ? "baritone" : f0m < 205 ? "tenor / low alto" : f0m < 300 ? "alto / high tenor" : f0m < 480 ? "soprano / falsetto" : "very high / child";
        const regConf = f0m < 105 || f0m > 330 ? 0.85 : f0m < 150 ? 0.75 : 0.55;
        out.register = reg;
        out.range = f0m < 150 ? "low" : f0m < 235 ? "mid" : "high";

        // ---- 6. confidence: enough voice, a clear register, a decided delivery
        const dataC = clamp(out.voicedSec / 6, 0.3, 1);
        const delC = d.score == null ? 0.4 : 0.55 + 0.45 * Math.abs(d.score - 0.48) * 2;
        out.confidence = clamp(dataC * (0.5 * regConf + 0.5 * clamp(delC, 0, 1)) / 0.95, 0, 1);
        out.ok = true;

        // ---- 7. effect hints: each one comes from a measurement
        // the voice's own sibilants are the best size cue measured here (about 5.5 kHz for a deeper voice, 7+ kHz for a lighter one)
        const scale = out.sib ? clamp(out.sib.hz / 5600, 0.9, 1.4) : (f0m > 235 ? 1.15 : 1.0);
        const hints = {};
        // low cut: stay well under the voice's lowest note (the fundamental carries the warmth)
        hints.hpHz = Math.round(clamp(out.f0.low * 0.62, 60, 135) / 5) * 5;
        // de-esser: where this voice's S sounds really are; if none were found, from the pitch range
        hints.deessHz = out.sib ? Math.round(clamp(out.sib.hz * 0.97, 4500, 9000) / 50) * 50 : Math.round(clamp(5400 * Math.pow(scale, 1.5), 4800, 8000) / 50) * 50;
        hints.deessFromAudio = !!out.sib;
        // presence: lighter voices carry their clarity a little higher
        hints.presHz = Math.round(clamp(3000 * Math.pow(scale, 0.8), 2600, 4200) / 100) * 100;
        // air: a breathy take already has plenty on top
        hints.airSafe = out.harmonicity == null ? true : out.harmonicity > 0.86;
        out.hints = hints;

        out.label = d.label + " " + out.register + " (~" + Math.round(f0m) + " Hz, " + Math.round(out.confidence * 100) + "% sure)";
        if (out.confidence < 0.5) out.notes.push("Not sure about this voice type (" + Math.round(out.confidence * 100) + "%), so the effects use middle-of-the-road settings.");
        return out;
    }

    /** An override from the person ("it is a rapper", "it is a high voice") wins over the measurement. */
    function applyOverride(p, ov) {
        if (!ov) return p;
        const q = Object.assign({}, p);
        if (ov.delivery && ov.delivery !== "auto") { q.delivery = Object.assign({}, p.delivery, { label: ov.delivery }); q.confidence = Math.max(q.confidence, 0.8); q.overridden = true; }
        if (ov.range && ov.range !== "auto") {
            q.range = ov.range; q.overridden = true; q.confidence = Math.max(q.confidence, 0.8);
            if (q.hints) q.hints = Object.assign({}, q.hints, { hpHz: ov.range === "high" ? 120 : ov.range === "low" ? 70 : 90 });
        }
        return q;
    }

    return { describe, applyOverride, fft };
});
