/**
 * Voxloop Studio: melody that fits the vocal
 *
 * A beat with no melody + a recorded vocal  ->  a few short trumpet lines written around what was sung.
 *
 *   1. LISTEN   the singer's notes (pitch, timing, rests, range) from the vocal lanes, and the beat's chords bar by bar
 *   2. WRITE    "Answer": a short trumpet reply in the gaps between sung lines, built from the shape of the line just sung,
 *               using only notes of the key and landing on a note of the chord that is playing.
 *               "Support" (optional): a soft trumpet that doubles (octave above) or harmonises long sung notes.
 *   3. PLAY     a trumpet voice built here (no samples): scoop into the note, brass bloom, late vibrato, a little breath.
 *   4. MIX      carved a pocket at 2.5 kHz for the voice, lowered under singing, levelled against the beat AND the vocal,
 *               checked against the vocal at the end (VLMelody.report says what was done).
 *
 *   The result is ONE stereo buffer kept next to the beat (VLDAW.api.setMelody): it plays with the beat, is in the mix and
 *   goes to the Pipeline with the beat. It can be regenerated (new seed), changed (amount, lines) or removed.
 *   Autopilot decides when to add it: a beat that has no melody + a vocal with enough singing in it.
 *
 *   Not claimed: that it sounds right to a trained ear. Everything here is judged by measurement (in key, on chord tones,
 *   off the voice's range, under the voice in level). Off-key singing is followed only as far as it is close to the key.
 */
(function (root) {
    "use strict";
    const D = () => root.VLDAW;
    const api = () => (D() && D().api) || {};
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
    const lin = (d) => Math.pow(10, d / 20);
    const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const mod12 = (n) => ((Math.round(n) % 12) + 12) % 12;
    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

    const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10] };
    const scalePcs = (key) => new Set((SCALES[key.scale] || SCALES.major).map((d) => (key.rootPc + d) % 12));
    // nearest note of the scale (ties go downward); null if it is further than maxDist semitones away
    function snapToScale(m, pcs, maxDist) {
        const base = Math.round(m);
        for (let d = 0; d <= 6; d++) {
            for (const cand of d === 0 ? [base] : [base - d, base + d]) if (pcs.has(mod12(cand))) return maxDist != null && Math.abs(cand - m) > maxDist ? null : cand;
        }
        return null;
    }

    // ---------------------------------------------------------------- tiny FFT
    const fftTables = {};
    function fft(re, im) {
        const n = re.length;
        let t = fftTables[n];
        if (!t) {
            const levels = Math.round(Math.log2(n)), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n);
            for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = Math.sin(2 * Math.PI * k / n); }
            for (let i = 0; i < n; i++) rev[i] = (rev[i >> 1] >> 1) | ((i & 1) << (levels - 1));
            t = fftTables[n] = { cos, sin, rev };
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

    // ---------------------------------------------------------------- 1a. the beat's chords, bar by bar (and half bar)
    // chroma of each half-bar window, scored against major / minor triads of the key; bass counts extra. Not a transcription:
    // it only has to say "which three notes are safe to land on here".
    function chordsOf(mono, sr, bpm, key, refCents) {
        const barSec = 240 / bpm, winSec = barSec / 2, N = 16384, out = [];
        const dur = mono.length / sr, pcs = key ? scalePcs(key) : null, re = new Float64Array(N), im = new Float64Array(N);
        const hann = new Float64Array(N); for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        const cents = (refCents || 0) / 100;
        for (let t0 = 0; t0 < dur - 0.2; t0 += winSec) {
            const mid = Math.floor((t0 + winSec / 2) * sr) - N / 2;
            for (let i = 0; i < N; i++) { const k = mid + i; re[i] = k >= 0 && k < mono.length ? mono[k] * hann[i] : 0; im[i] = 0; }
            fft(re, im);
            const chroma = new Float64Array(12), bass = new Float64Array(12);
            for (let k = 1; k < N / 2; k++) {
                const f = k * sr / N; if (f < 45 || f > 2000) continue;
                const mag = Math.pow(Math.hypot(re[k], im[k]), 0.7), pc = mod12(12 * Math.log2(f / 440) + 69 - cents);
                chroma[pc] += mag * (f < 260 ? 1.4 : f < 900 ? 1 : 0.6);
                if (f < 200) bass[pc] += mag;
            }
            let cs = 0, bs = 0; for (let i = 0; i < 12; i++) { cs += chroma[i]; bs += bass[i]; }
            if (cs <= 0) { out.push({ t0, t1: Math.min(dur, t0 + winSec), rootPc: key ? key.rootPc : 0, minor: key ? key.scale === "minor" : false, conf: 0 }); continue; }
            let best = null;
            for (let r = 0; r < 12; r++) for (const minor of [false, true]) {
                const tones = [r, (r + (minor ? 3 : 4)) % 12, (r + 7) % 12];
                let s = (chroma[tones[0]] * 1.1 + chroma[tones[1]] + chroma[tones[2]] * 0.9) / cs + (bs > 0 ? 0.5 * bass[r] / bs : 0);
                if (pcs && tones.every((p) => pcs.has(p))) s *= 1.18;                 // chords of the key are far likelier
                if (!best || s > best.s) best = { s, r, minor };
            }
            out.push({ t0, t1: Math.min(dur, t0 + winSec), rootPc: best.r, minor: best.minor, conf: best.s });
        }
        // a chord must win by a clear margin to change: median over three windows removes one-window flickers
        for (let i = 1; i < out.length - 1; i++) {
            const a = out[i - 1], b = out[i], c = out[i + 1];
            if (a.rootPc === c.rootPc && a.minor === c.minor && (b.rootPc !== a.rootPc || b.minor !== a.minor)) { b.rootPc = a.rootPc; b.minor = a.minor; }
        }
        return out;
    }
    const chordAt = (chords, t, key) => {
        for (let i = 0; i < chords.length; i++) if (t >= chords[i].t0 && t < chords[i].t1) return chords[i];
        return chords[chords.length - 1] || { rootPc: key ? key.rootPc : 0, minor: key ? key.scale === "minor" : false };
    };
    const chordTones = (c) => [c.rootPc, (c.rootPc + (c.minor ? 3 : 4)) % 12, (c.rootPc + 7) % 12];

    // ---------------------------------------------------------------- 1b. the singer: notes on the song's timeline
    async function listenToVocal(lanes, bpm) {
        const Fx = root.VLFx, FxTask = Fx && Fx.runTask;
        const notes = [];
        const clips = [];
        lanes.filter((l) => l.type === "main" && !l.muted).forEach((l) => l.clips.forEach((c) => { if (c.buffer) clips.push(c); }));
        for (const c of clips) {
            const b = c.buffer, m = new Float32Array(b.length);
            for (let ch = 0; ch < b.numberOfChannels; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < m.length; i++) m[i] += d[i] / b.numberOfChannels; }
            let p = null;
            try { p = FxTask ? await FxTask("analyze", { mono: m, sr: b.sampleRate, rootPc: 0, scale: "major", refCents: 0 }) : null; } catch (e) { p = null; }
            if (!p || !p.notes) continue;
            const hop = p.hop / p.sr;
            p.notes.forEach((n) => {
                const t0 = c.start + n.start * hop, t1 = c.start + n.end * hop;
                if (t1 - t0 >= 0.06) notes.push({ t0, t1, midi: n.center });
            });
        }
        notes.sort((a, b) => a.t0 - b.t0);
        return { notes, clips };
    }

    // lines = groups of notes separated by a breath (0.35 s or more)
    function linesOf(notes) {
        const lines = []; let cur = null;
        notes.forEach((n) => { if (cur && n.t0 - cur.t1 < 0.35) { cur.notes.push(n); cur.t1 = Math.max(cur.t1, n.t1); } else { cur = { t0: n.t0, t1: n.t1, notes: [n] }; lines.push(cur); } });
        return lines.filter((l) => l.t1 - l.t0 >= 0.4);
    }
    const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

    // the key the singer used: weighted note histogram against the major / minor scales (long notes count more)
    function singerKey(notes) {
        const MT = root.MusicTheory;
        if (MT && MT.keyFromMelody) { try { const k = MT.keyFromMelody(notes.map((n) => ({ start: n.t0, end: n.t1, center: n.midi })), 1); if (k) return { rootPc: k.rootPc, scale: k.scale, confidence: k.confidence }; } catch (e) { /* fall through */ } }
        const hist = new Float64Array(12); notes.forEach((n) => { hist[mod12(n.midi)] += n.t1 - n.t0; });
        let best = null;
        for (let r = 0; r < 12; r++) for (const sc of ["major", "minor"]) {
            let inside = 0; SCALES[sc].forEach((d) => { inside += hist[(r + d) % 12]; });
            const s = inside + hist[r] * 0.3; if (!best || s > best.s) best = { s, rootPc: r, scale: sc };
        }
        const tot = hist.reduce((a, b) => a + b, 0) || 1;
        return { rootPc: best.rootPc, scale: best.scale, confidence: clamp(best.s / tot - 0.6, 0, 1) };
    }
    function fitOf(notes, key) {
        const pcs = scalePcs(key); let inN = 0, tot = 0;
        notes.forEach((n) => { const w = Math.min(n.t1 - n.t0, 0.8); tot += w; if (pcs.has(mod12(n.midi)) || Math.abs(n.midi - Math.round(n.midi)) > 0.4 && (pcs.has(mod12(n.midi + 0.5)) || pcs.has(mod12(n.midi - 0.5)))) inN += w; });
        return tot ? inN / tot : 0;
    }

    // ---------------------------------------------------------------- 2. WRITE
    // opts: { amount: "subtle"|"normal"|"lots", answer: bool, support: "off"|"double"|"harmony", seed }
    function write(S, opts) {
        const R = rng(opts.seed || 1), beatSec = 60 / S.bpm, eighth = beatSec / 2, pcs = scalePcs(S.key);
        const out = [], dropped = [];
        const lines = S.lines, vN = S.notes;
        const med = median(vN.map((n) => n.midi)), p10 = pct(vN.map((n) => n.midi), 0.1), p90 = pct(vN.map((n) => n.midi), 0.9);
        // register: above the singer's middle, never below G3 or above C6 (a trumpet plays and sits well there)
        let centre = clamp(Math.round(med + 7), 62, 79);
        const lo = clamp(centre - 7, 55, 79), hi = clamp(centre + 7, 62, 84);
        const nearestIn = (target, set, a, b) => { let best = null; for (let m = a; m <= b; m++) if (set.has(mod12(m)) && (best == null || Math.abs(m - target) < Math.abs(best - target))) best = m; return best == null ? Math.round(target) : best; };

        const grid = (t) => Math.ceil((t - 1e-6) / eighth) * eighth;
        const prob = opts.amount === "lots" ? 1 : opts.amount === "normal" ? 0.8 : 0.55;

        // ---- Answer: after a sung line, in the gap before the next one
        let placed = 0, eligible = 0;
        if (opts.answer !== false) lines.forEach((ln, i) => {
            const next = lines[i + 1], gapEnd = next ? next.t0 : S.duration, gapStart = ln.t1;
            const room = gapEnd - gapStart;
            if (room < 1.6 * beatSec) return;
            eligible++;
            // not after every line: subtle = about every second line (plus any long gap), so it never becomes a second singer
            const stanzaEnd = room >= 3 * beatSec;
            if (!(stanzaEnd || (i % 2 === 1 ? R() < prob + 0.2 : R() < prob - 0.3))) return;
            if (opts.amount !== "lots" && placed && placed >= Math.ceil(eligible * (opts.amount === "normal" ? 0.8 : 0.55))) return;
            const start = grid(gapStart + 0.4 * beatSec), maxEnd = gapEnd - 0.5 * beatSec;
            const L = Math.min(maxEnd - start, (opts.amount === "lots" ? 5 : 3.5) * beatSec);
            if (L < 0.9 * beatSec) return;

            // rhythm: the onsets of the line just sung (its last notes), squeezed onto the eighth grid: a short motif of 2 to 4 notes,
            // then one held note that ends the phrase (a beat to a beat and a half), so it always sounds like a reply and a landing
            const last = ln.notes.slice(-4);
            let cells = [];
            for (let k = 0; k < last.length - 1; k++) cells.push(clamp(Math.round((last[k + 1].t0 - last[k].t0) / eighth) * eighth, eighth, beatSec));
            if (cells.length < 2) cells = [eighth, eighth, beatSec * 0.5];
            if (R() < 0.5) cells.reverse();                                         // a reversed rhythm: related, but not an echo
            const heldLen = clamp(L - 0.4 * beatSec, beatSec, 1.5 * beatSec);       // the landing note
            const rhythm = []; let tAcc = 0;
            for (const c of cells) { if (tAcc + c > L - heldLen) break; rhythm.push(c); tAcc += c; }
            if (rhythm.length < 1) { rhythm.push(eighth); tAcc = eighth; }
            const finalLen = Math.max(0.6 * beatSec, Math.min(heldLen, maxEnd - (start + tAcc)));
            if (start + tAcc + 0.4 > maxEnd) return;
            rhythm.push(finalLen);

            // pitches: the contour of the sung line, inverted or kept, on key notes; strong notes on chord tones
            const iv = []; for (let k = 1; k < last.length; k++) iv.push(clamp(Math.round(last[k].midi - last[k - 1].midi), -4, 4));
            const invert = i % 2 === 0 ? R() < 0.7 : R() < 0.3;
            const ch0 = chordAt(S.chords, start, S.key), tones0 = new Set(chordTones(ch0));
            let m = nearestIn(centre + (R() < 0.5 ? 0 : 2), tones0, lo, hi);
            const seq = [m];
            for (let k = 1; k < rhythm.length; k++) {
                const t = start + rhythm.slice(0, k).reduce((a, b) => a + b, 0);
                const ch = chordAt(S.chords, t, S.key), cset = new Set(chordTones(ch));
                let step = (iv[k - 1] != null ? iv[k - 1] : (R() < 0.5 ? 2 : -2)) * (invert ? -1 : 1);
                if (seq.length >= 2 && Math.abs(step) > 3) step = Math.sign(step) * 2;
                let target = clamp(seq[k - 1] + step, lo, hi);
                const onBeat = Math.abs((t / beatSec) - Math.round(t / beatSec)) < 0.02;
                let cand = nearestIn(target, onBeat ? cset : pcs, lo, hi);
                if (cand === seq[k - 1] && seq.length >= 2 && seq[k - 2] === cand) cand = nearestIn(target + (R() < 0.5 ? 2 : -2), pcs, lo, hi);
                seq.push(cand);
            }
            // the last note: root of the chord when this ends a stanza (settled), its fifth or third when another line follows (open)
            const tEnd = start + rhythm.slice(0, -1).reduce((a, b) => a + b, 0), chE = chordAt(S.chords, tEnd, S.key), tonesE = chordTones(chE);
            const want = stanzaEnd ? tonesE[0] : tonesE[R() < 0.5 ? 1 : 2];
            seq[seq.length - 1] = nearestIn(seq[seq.length - 1], new Set([want]), lo, hi);

            let t = start;
            rhythm.forEach((d, k) => {
                const lastNote = k === rhythm.length - 1;
                out.push({ t, dur: lastNote ? d : Math.min(d * 0.9, d - 0.03), midi: seq[k], vel: lastNote ? 0.78 : 0.7 + (k === 0 ? 0.08 : 0), voice: "lead", line: "answer" });
                t += d;
            });
            placed++;
        });

        // ---- Support: soft doubling / harmony on long sung notes (only where the singing is already close to the key)
        let supported = 0;
        if (opts.support && opts.support !== "off") {
            const longs = vN.filter((n) => n.t1 - n.t0 >= 0.5);
            const every = opts.amount === "lots" ? 1 : 2;
            longs.forEach((n, i) => {
                if (i % every !== 0) return;
                const snapped = snapToScale(n.midi, pcs, 0.9);
                if (snapped == null) return;
                let m = snapped + 12;
                if (opts.support === "harmony") {
                    const arr = (SCALES[S.key.scale] || SCALES.major).map((d) => (S.key.rootPc + d) % 12);
                    const idx = arr.indexOf(mod12(snapped)); if (idx < 0) return;
                    m = snapped + ((arr[(idx + 2) % 7] - arr[idx] + 12) % 12);       // the next-but-one scale note above: a third
                    if (m < snapped + 3) m += 0;
                }
                if (m > 84 || m < 52) { m = snapped; if (m > 84 || m < 52) return; }
                out.push({ t: n.t0 + 0.03, dur: Math.max(0.3, (n.t1 - n.t0) * 0.85), midi: m, vel: 0.5, voice: "support", line: "support" });
                supported++;
            });
        }
        return { notes: out, answers: placed, eligible, supported, register: [lo, hi], vocalRange: [Math.round(p10), Math.round(p90)] };
    }

    // ---------------------------------------------------------------- 3. PLAY: the trumpet
    // wavetables: harmonic series with a slope that gets brighter as the note is pushed (brass); built once and reused
    const tables = {};
    function table(slopeIdx, maxH) {
        const key = slopeIdx + ":" + maxH;
        if (tables[key]) return tables[key];
        const N = 2048, t = new Float32Array(N), slope = 2.3 - slopeIdx * 0.32;           // idx 0 = mellow, 5 = blaring
        for (let h = 1; h <= maxH; h++) {
            const a = Math.pow(h, -slope) * (h === 2 ? 1.25 : h === 3 ? 1.1 : 1);             // trumpets are strong in 2nd and 3rd harmonics
            for (let i = 0; i < N; i++) t[i] += a * Math.sin(2 * Math.PI * h * i / N);
        }
        let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(t[i]));
        for (let i = 0; i < N; i++) t[i] /= pk;
        return (tables[key] = t);
    }

    function renderTrumpet(out, sr, nt, opts) {
        const f0 = midiHz(nt.midi), maxH = Math.max(2, Math.min(22, Math.floor(0.42 * sr / f0)));
        const total = Math.ceil((nt.dur + 0.12) * sr), start = Math.floor(nt.t * sr);
        const muted = !!opts.muted, vel = nt.vel, att = muted ? 0.05 : 0.03 + (1 - vel) * 0.03;
        const detune = [0, 0.0017, -0.0021];                       // two or three players in unison: a little thickness
        const voices = opts.voices || 2;
        const R = rng(Math.floor(nt.t * 1000) + nt.midi);
        let ph = [R(), R(), R()], vib = 0, noiseState = 0;
        const phase0 = R() * 2 * Math.PI;
        for (let i = 0; i < total; i++) {
            const idx = start + i; if (idx >= out.length) break;
            const t = i / sr;
            // amplitude: soft attack, small dip to the sustain, release after the written length
            let a = t < att ? t / att : 1 + 0.16 * Math.exp(-(t - att) / 0.1);                 // a little bloom, then it settles
            if (t > nt.dur) a *= Math.max(0, 1 - (t - nt.dur) / 0.1);
            if (a <= 0) continue;
            // brightness blooms after the attack and follows the loudness
            const bright = clamp((muted ? 0.8 : 1) * (vel * 4.2) * (1 - Math.exp(-t / 0.06)) + 0.3, 0, 4.99);
            const si = Math.floor(bright), sf = bright - si, tA = table(si, maxH), tB = table(Math.min(5, si + 1), maxH);
            // pitch: scoop up from 35 cents flat in 45 ms, vibrato fades in after 0.2 s
            const scoop = t < 0.045 ? -0.35 * (1 - t / 0.045) * (1 - t / 0.045) : 0;
            vib = Math.sin(2 * Math.PI * 5.3 * t + phase0) * 0.14 * clamp((t - 0.2) / 0.25, 0, 1);
            const f = f0 * Math.pow(2, (scoop + vib) / 12);
            let s = 0;
            for (let v = 0; v < voices; v++) {
                ph[v] += f * (1 + detune[v]) / sr; ph[v] -= Math.floor(ph[v]);
                const p = ph[v] * 2048, k = Math.floor(p) & 2047, fr = p - Math.floor(p);
                const x0 = tA[k] + (tA[(k + 1) & 2047] - tA[k]) * fr, x1 = tB[k] + (tB[(k + 1) & 2047] - tB[k]) * fr;
                s += x0 + (x1 - x0) * sf;
            }
            s /= voices;
            // breath / tongue: a short band of noise at the start
            if (t < 0.03) { noiseState = 0.7 * noiseState + 0.3 * (R() * 2 - 1); s += noiseState * 0.35 * (1 - t / 0.03); }
            out[idx] += s * a * (0.35 + 0.65 * vel) * (muted ? 0.8 : 1);
        }
    }

    // RBJ biquads on a Float32Array (in place)
    function biquad(x, sr, type, f, q, gainDb) {
        const w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w), A = Math.pow(10, (gainDb || 0) / 40), al = sw / (2 * (q || 0.707));
        let b0, b1, b2, a0, a1, a2;
        if (type === "hp") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
        else if (type === "lp") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
        else { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }     // peaking
        b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
    }

    // a small stereo plate-ish reverb (4 combs + 2 all-passes per side); returns the wet signal only
    function reverbWet(x, sr, decay) {
        const sets = [[1116, 1188, 1277, 1356], [1139, 1211, 1300, 1379]], outs = [new Float32Array(x.length), new Float32Array(x.length)];
        sets.forEach((delays, side) => {
            const combs = delays.map((d) => ({ buf: new Float32Array(Math.round(d * sr / 44100)), i: 0, fb: Math.pow(10, -3 * (d / 44100) / decay), lp: 0 }));
            const aps = [225, 556].map((d) => ({ buf: new Float32Array(Math.round(d * sr / 44100)), i: 0 }));
            const o = outs[side];
            for (let n = 0; n < x.length; n++) {
                let s = 0; const inp = x[n] * 0.3;
                for (const c of combs) { const y = c.buf[c.i]; c.lp = y * 0.62 + c.lp * 0.38; c.buf[c.i] = inp + c.lp * c.fb; c.i = (c.i + 1) % c.buf.length; s += y; }
                for (const a of aps) { const y = a.buf[a.i], z = s + y * 0.5; a.buf[a.i] = z; s = y - z * 0.5; a.i = (a.i + 1) % a.buf.length; }
                o[n] = s * 0.25;
            }
        });
        return outs;
    }

    // ---------------------------------------------------------------- 4. MIX
    function frameDb(x, sr, from, to, win) { const n = Math.floor((to - from) / win), out = new Float32Array(n); for (let k = 0; k < n; k++) { let e = 0; for (let i = from + k * win; i < from + (k + 1) * win; i++) e += x[i] * x[i]; out[k] = db(Math.sqrt(e / win)); } return out; }

    function renderAndMix(S, written, opts, report) {
        const sr = S.sr, N = Math.ceil(S.duration * sr), lead = new Float32Array(N), sup = new Float32Array(N);
        written.notes.forEach((n) => renderTrumpet(n.voice === "lead" ? lead : sup, sr, n, { muted: n.voice === "support", voices: n.voice === "lead" ? 3 : 2 }));

        // the vocal's activity: where the singer is (for ducking and for the final check)
        const win = Math.round(0.02 * sr), vm = S.vocalMono, vdb = vm ? frameDb(vm, sr, 0, Math.min(vm.length, N), win) : new Float32Array(0);
        const vtop = vdb.length ? pct(Array.from(vdb), 0.95) : -60;
        const singing = new Uint8Array(vdb.length); for (let k = 0; k < vdb.length; k++) singing[k] = vdb[k] > vtop - 30 ? 1 : 0;

        // tone: no low end (the bass and kick own it), a pocket at 2.5 kHz for the voice, no fizz
        [lead, sup].forEach((b) => { biquad(b, sr, "hp", 170, 0.7); biquad(b, sr, "peak", 2600, 0.9, -3.5); biquad(b, sr, "lp", 9000, 0.7); });
        // duck under the singer: -5 dB while there is singing (fast in, slow out), the support line a little more
        const duck = new Float32Array(N); let cur = 1;
        const a = Math.exp(-1 / (0.015 * sr)), r = Math.exp(-1 / (0.22 * sr));
        for (let i = 0; i < N; i++) {
            const k = Math.min(singing.length - 1, Math.floor(i / win)), want = k >= 0 && singing[k] ? lin(-5) : 1;
            cur = want < cur ? a * cur + (1 - a) * want : r * cur + (1 - r) * want; duck[i] = cur;
        }
        for (let i = 0; i < N; i++) { lead[i] *= duck[i]; sup[i] *= duck[i] * duck[i] * 0.8; }

        // level: against the beat (a trumpet answer sits about 8 dB under the beat's body) and against the vocal (11 dB under it)
        const bm = S.beatMono, bdb = frameDb(bm, sr, 0, Math.min(bm.length, N), Math.round(0.1 * sr)), beatRms = pct(Array.from(bdb), 0.6);
        const mel = new Float32Array(N); for (let i = 0; i < N; i++) mel[i] = lead[i] + sup[i];
        const mdb = frameDb(mel, sr, 0, N, Math.round(0.1 * sr)), act = Array.from(mdb).filter((v) => v > -70), melRms = act.length ? pct(act, 0.6) : -60;
        let wantDb = Math.min(beatRms - 8, vdb.length ? vtop - 12 : 0);
        const amountTrim = opts.amount === "lots" ? 1.5 : opts.amount === "normal" ? 0 : -1.5;
        let gDb = wantDb + amountTrim - melRms;
        report.gainSteps = ["level to the beat and the vocal: " + gDb.toFixed(1) + " dB"];
        let g = lin(clamp(gDb, -40, 18));

        // reverb: a short plate on the melody only, high-passed, mixed low: it sits in the room of the beat, it does not wash
        const wet = reverbWet(mel, sr, 1.1);
        const L = new Float32Array(N), Rr = new Float32Array(N);
        const widen = Math.round(0.011 * sr);
        for (let i = 0; i < N; i++) {
            const c = lead[i], s = sup[i];
            L[i] = (c * 0.95 + s * 0.8) * g + wet[0][i] * g * 0.22;
            Rr[i] = (c * 1.0 + (i >= widen ? sup[i - widen] * 0.95 : 0)) * g + wet[1][i] * g * 0.22;
        }
        biquad(L, sr, "hp", 220, 0.7); biquad(Rr, sr, "hp", 220, 0.7);       // (the reverb's low end goes too)

        // final check against the vocal: in the 1-4 kHz band, while the singer sings, the melody must stay >= 12 dB under the voice
        let trim = 0;
        if (vm) {
            const bandL = new Float32Array(L), bandV = Float32Array.from(vm.subarray(0, Math.min(vm.length, N)));
            [bandL, bandV].forEach((b) => { biquad(b, sr, "hp", 1000, 0.7); biquad(b, sr, "lp", 4000, 0.7); });
            let ev = 0, em = 0;
            for (let k = 0; k < singing.length; k++) if (singing[k]) for (let i = k * win; i < (k + 1) * win && i < bandL.length; i++) { ev += bandV[i] * bandV[i]; em += bandL[i] * bandL[i]; }
            if (ev > 0 && em > 0) {
                const ratio = 10 * Math.log10(em / ev);
                report.melOverVoice = ratio;
                if (ratio > -12) { trim = Math.min(8, ratio + 12); }
            }
        }
        if (trim > 0) { const t = lin(-trim); for (let i = 0; i < N; i++) { L[i] *= t; Rr[i] *= t; } report.gainSteps.push("kept under the voice: " + (-trim).toFixed(1) + " dB"); }

        // headroom: the beat plus the melody together must stay under -1 dBFS; if not, the melody (never the beat) comes down
        let pk = 0; const bL = S.beatL, bR = S.beatR;
        for (let i = 0; i < N; i++) { const a1 = Math.abs((bL[i] || 0) + L[i]), a2 = Math.abs((bR[i] || 0) + Rr[i]); if (a1 > pk) pk = a1; if (a2 > pk) pk = a2; }
        if (pk > lin(-1)) {
            // only worth lowering if the melody is what pushes it over
            let bp = 0; for (let i = 0; i < N; i++) bp = Math.max(bp, Math.abs(bL[i] || 0), Math.abs(bR[i] || 0));
            const t = clamp((lin(-1) - bp) / Math.max(1e-9, pk - bp), 0.2, 1);
            if (t < 1) { for (let i = 0; i < N; i++) { L[i] *= t; Rr[i] *= t; } report.gainSteps.push("headroom: " + db(t).toFixed(1) + " dB"); }
        }
        // a soft fade at each end of every note group is already in the notes; fade the buffer edges
        const fade = Math.round(0.01 * sr); for (let i = 0; i < fade; i++) { const f = i / fade; L[i] *= f; Rr[i] *= f; L[N - 1 - i] *= f; Rr[N - 1 - i] *= f; }
        let rms = 0, cnt = 0; for (let i = 0; i < N; i += 7) { if (Math.abs(L[i]) > 1e-4) { rms += L[i] * L[i]; cnt++; } }
        report.melodyDb = cnt ? 10 * Math.log10(rms / cnt) : -90; report.beatDb = beatRms; report.voiceDb = vtop;
        return { L, R: Rr };
    }

    // ---------------------------------------------------------------- put it all together
    async function generate(options) {
        const A = api(), Dd = D();
        if (!Dd || !Dd.beat || !Dd.beat.buffer) return { ok: false, text: "Load a beat first." };
        const beat = Dd.beat, info = beat.info || (root.VLBrain ? await root.VLBrain.analyzeBeat(beat.buffer) : null);
        const bpm = beat.bpm > 30 ? beat.bpm : info && info.bpm > 30 ? info.bpm : 0;
        const key = beat.key || (info && info.key) || null;
        const rep = { lines: [], notes: [] };
        if (!bpm) return { ok: false, text: "The beat's tempo is not known yet. Set it in the beat chip, then try again." };

        const heard = await listenToVocal(Dd.lanes, bpm);
        const lines = linesOf(heard.notes);
        if (heard.notes.length < 6 || lines.length < 2) return { ok: false, text: "Record a vocal first. There is not enough singing to write around yet." };

        // key: the beat's key leads (the chords are in it). If the beat's key is unknown, the singer's is used.
        const sk = singerKey(heard.notes);
        let useKey = key, keyText;
        if (!key) { useKey = { rootPc: sk.rootPc, scale: sk.scale }; keyText = "The beat's key was not known, so the key you sang in (" + NOTE[sk.rootPc] + " " + sk.scale + ") was used."; }
        else {
            const fitBeat = fitOf(heard.notes, key), fitSing = fitOf(heard.notes, sk);
            if (fitBeat >= 0.7) keyText = "You sing in the beat's key (" + key.label + "): " + Math.round(fitBeat * 100) + "% of your notes fit it.";
            else keyText = "Only " + Math.round(fitBeat * 100) + "% of your notes fit the beat's key (" + key.label + ")" + (fitSing > fitBeat + 0.15 ? ", you lean towards " + NOTE[sk.rootPc] + " " + sk.scale : "") + ". The melody stays in the beat's key so it is never clashing with the chords.";
        }

        const sr = beat.buffer.sampleRate, N = beat.buffer.length;
        const bL = beat.buffer.getChannelData(0), bR = beat.buffer.numberOfChannels > 1 ? beat.buffer.getChannelData(1) : bL;
        const beatMono = new Float32Array(N); for (let i = 0; i < N; i++) beatMono[i] = (bL[i] + bR[i]) / 2;
        await new Promise((r) => setTimeout(r, 0));                // let the screen update between the heavy steps
        const chords = chordsOf(beatMono, sr, bpm, useKey, useKey.refCents || (info && info.key && info.key.refCents) || 0);

        // the vocal as one mono signal on the song's timeline (for ducking and the final check)
        const vocalMono = new Float32Array(N);
        heard.clips.forEach((c) => { const b = c.buffer, off = Math.round(c.start * sr); for (let ch = 0; ch < b.numberOfChannels; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length && off + i < N; i++) vocalMono[off + i] += d[i] / b.numberOfChannels; } });

        const seed = options && options.seed != null ? options.seed : 1;
        const opts = { amount: (options && options.amount) || "subtle", answer: !(options && options.answer === false), support: (options && options.support) || "off", seed };
        const S = { bpm, key: useKey, chords, notes: heard.notes, lines, duration: beat.buffer.duration, sr, vocalMono, beatMono, beatL: bL, beatR: bR };
        const written = write(S, opts);
        if (!written.notes.length) return { ok: false, text: "No good place for a melody: the gaps between your lines are too short. (It never plays over the singing.)" };

        await new Promise((r) => setTimeout(r, 0));
        const mixRep = {};
        const mixed = renderAndMix(S, written, opts, mixRep);
        const ctx = A.ensureCtx(), buf = ctx.createBuffer(2, N, sr);
        buf.copyToChannel(mixed.L, 0); buf.copyToChannel(mixed.R, 1);

        const out = {
            ok: true, buffer: buf, on: true, seed, opts,
            notes: written.notes, chordsUsed: chords,
            report: {
                key: keyText, tempo: Math.round(bpm) + " BPM",
                answers: written.answers, support: written.supported, register: NOTE[mod12(written.register[0])] + " to " + NOTE[mod12(written.register[1])] + ", above your " + NOTE[mod12(written.vocalRange[0])] + "-" + NOTE[mod12(written.vocalRange[1])],
                mix: mixRep.gainSteps, melodyDb: mixRep.melodyDb, voiceDb: mixRep.voiceDb, melOverVoice: mixRep.melOverVoice,
                vocalVersion: heard.clips.map((c) => c.id + ":" + c.start.toFixed(2) + ":" + c.duration.toFixed(2)).join("|")
            }
        };
        return out;
    }

    // ---------------------------------------------------------------- the DAW side: state, Autopilot and the panel
    let previous = null, busy = false, suppressed = false;
    const settings = () => root.VLSettings;
    async function apply(options, label) {
        if (busy) return null; busy = true;
        status("Writing a melody around your vocal…");
        try {
            const r = await generate(options);
            if (!r.ok) { status(r.text); paint(r.text); return r; }
            previous = api().getMelody ? api().getMelody() : null;
            api().setMelody(r);
            suppressed = false;
            const rp = r.report;
            status("Melody added: " + rp.answers + " answer" + (rp.answers === 1 ? "" : "s") + (rp.support ? " + " + rp.support + " support" : ""));
            paint();
            return r;
        } catch (e) { console.warn("melody", e); status("Could not write a melody"); return null; }
        finally { busy = false; }
    }
    const status = (m) => { if (api().status) api().status(m); };
    const current = () => (api().getMelody ? api().getMelody() : null);
    const optsFromUi = () => ({ amount: ui.amount, answer: ui.answer, support: ui.support, seed: ui.seed });
    const ui = { amount: "subtle", answer: true, support: "off", seed: 1, open: false };

    function add() { ui.seed = 1; return apply(optsFromUi()); }
    function regenerate() { ui.seed = (current() ? current().seed : ui.seed) + 1; return apply(optsFromUi()); }
    function remove() { if (api().setMelody) { previous = current(); api().setMelody(null); suppressed = true; status("Melody removed"); paint(); } }
    function undo() { if (api().setMelody) { const cur = current(); api().setMelody(previous); previous = cur; paint(); status(previous || current() ? "Back to the previous melody" : "Melody removed"); } }
    function toggle() { const m = current(); if (m && api().setMelody) { m.on = !m.on; api().setMelody(m); paint(); } }

    // Does the beat already have a lead line? Works on ANY beat (downloaded from Beat Lab and brought back, or from anywhere):
    // the mids (350 Hz-3.5 kHz) go through the pitch tracker. A chord pad or bass is tracked too, but it changes note about once a
    // bar; a melody changes several times a bar. So: "melody" = a pitched line present for 30% of the time AND 2.5+ note changes a bar.
    async function beatHasMelody(beat) {
        if (beat.melodyCheck) return beat.melodyCheck;
        if (beat.noMelody === true) return (beat.melodyCheck = { has: false, why: "Beat Lab says this beat has no melody." });
        const Fx = root.VLFx, bpm = beat.bpm;
        if (!Fx || !Fx.runTask || !bpm) return { has: false, why: "" };
        const sr = beat.buffer.sampleRate, n = Math.min(beat.buffer.length, sr * 60), m = new Float32Array(n), d = beat.buffer.getChannelData(0);
        const d1 = beat.buffer.numberOfChannels > 1 ? beat.buffer.getChannelData(1) : d;
        for (let i = 0; i < n; i++) m[i] = (d[i] + d1[i]) / 2;
        biquad(m, sr, "hp", 350, 0.7); biquad(m, sr, "lp", 3500, 0.7);
        let r = null; try { r = await Fx.runTask("analyze", { mono: m, sr, rootPc: 0, scale: "major", refCents: 0 }); } catch (e) { r = null; }
        if (!r || !r.notes) return { has: false, why: "" };
        const hop = r.hop / r.sr, notes = r.notes.map((x) => ({ d: (x.end - x.start) * hop, c: x.center })).filter((x) => x.d >= 0.1);
        const cover = notes.reduce((a, x) => a + x.d, 0) / (n / sr);
        let changes = 0; for (let i = 1; i < notes.length; i++) if (Math.abs(Math.round(notes[i].c) - Math.round(notes[i - 1].c)) >= 1) changes++;
        const perBar = changes / (n / sr / (240 / bpm));
        const has = cover >= 0.3 && perBar >= 2.5;
        return (beat.melodyCheck = { has, why: has ? "This beat already has a melody, so Autopilot leaves it alone (you can still add one with the button)." : "This beat has no melody line.", cover, perBar });
    }
    // Autopilot: does THIS project want a melody? A beat that already has one is left alone.
    async function wantsMelody() {
        const Dd = D(); if (!Dd || !Dd.beat || !Dd.beat.buffer || !Dd.beat.bpm) return { want: false, why: "" };
        const c = await beatHasMelody(Dd.beat);
        return { want: !c.has, why: c.why };
    }
    function vocalSignature() {
        const Dd = D(); if (!Dd) return "";
        return Dd.lanes.filter((l) => l.type === "main").flatMap((l) => l.clips.map((c) => c.id + ":" + c.start.toFixed(2) + ":" + c.duration.toFixed(2))).join("|");
    }
    let lastAuto = "";
    async function autoTick() {
        if (busy || suppressed || !settings() || !settings().get("autoMelody")) return;
        const Dd = D(); if (!Dd || !Dd.beat.buffer) return;
        const ap = root.VLStudioAutopilot;
        const fresh = Dd.lanes.some((l) => l.type === "main" && l.clips.some((c) => c.buffer && ap && ap.isDone && !ap.isDone(c)));
        if (fresh) return;                                         // wait until Autopilot has produced the vocal
        const sig = vocalSignature(); if (!sig || sig === lastAuto) return;
        if (current() && current().report && current().report.vocalVersion === sig) { lastAuto = sig; return; }
        const w = await wantsMelody(); lastAuto = sig;
        if (!w.want) return;
        const r = await apply({ amount: "subtle", answer: true, support: "off", seed: 1 });
        if (r && r.ok) status("Autopilot added a melody that fits your vocal. " + w.why);
    }

    // ---------------------------------------------------------------- the panel
    let btn = null, sheet = null;
    function paint(note) {
        if (!sheet) return;
        const m = current(), rp = m && m.report;
        const seg = (name, val, opts) => '<div class="ml-seg" role="group" aria-label="' + name + '">' + opts.map((o) => '<button type="button" data-ml="' + name + '" data-v="' + o[0] + '" class="' + (String(ui[name]) === String(o[0]) ? "is-on" : "") + '">' + o[1] + "</button>").join("") + "</div>";
        const w = { why: (D() && D().beat && D().beat.melodyCheck && D().beat.melodyCheck.why) || "" };
        if (D() && D().beat && D().beat.buffer && !D().beat.melodyCheck) beatHasMelody(D().beat).then(() => { if (ui.open) paint(); });
        sheet.innerHTML =
            '<p class="ml-lead"><b>Melody that fits your vocal.</b> Short trumpet lines written around what you sang: they answer you in the gaps and never play over the singing.' + (current() ? "" : " Autopilot adds this by itself when the beat has no melody.") + "</p>" +
            '<div class="ml-row"><span>Answer the voice</span>' + seg("answer", ui.answer, [[true, "On"], [false, "Off"]]) + "</div>" +
            '<div class="ml-row"><span>Support long notes</span>' + seg("support", ui.support, [["off", "Off"], ["double", "Double"], ["harmony", "Harmonise"]]) + "</div>" +
            '<div class="ml-row"><span>How much</span>' + seg("amount", ui.amount, [["subtle", "Subtle"], ["normal", "Normal"], ["lots", "Lots"]]) + "</div>" +
            '<label class="ml-auto"><input type="checkbox" id="ml-auto"' + (settings() && settings().get("autoMelody") ? " checked" : "") + '> Let Autopilot decide (adds it when the beat has no melody)</label>' +
            '<div class="ml-actions"><button type="button" class="eb-primary" data-ml-act="add">' + (m ? "Update melody" : "Add melody that fits my vocal") + "</button>" +
            (m ? '<button type="button" class="bp-mini" data-ml-act="regen">Regenerate</button><button type="button" class="bp-mini" data-ml-act="toggle">' + (m.on ? "Hide" : "Show") + '</button><button type="button" class="bp-mini" data-ml-act="remove">Remove</button>' : "") +
            (previous !== null && (previous || m) ? '<button type="button" class="bp-mini" data-ml-act="undo">Undo</button>' : "") + "</div>" +
            (note ? '<p class="ml-note">' + note + "</p>" : "") +
            (rp ? '<ul class="ml-report"><li>' + rp.key + "</li><li>" + rp.answers + " answer" + (rp.answers === 1 ? "" : "s") + " placed" + (rp.support ? ", " + rp.support + " supported note" + (rp.support === 1 ? "" : "s") : "") + " · trumpet, " + rp.register + ".</li><li>Mix: about " + Math.round(rp.voiceDb - rp.melodyDb) + " dB under your voice, in a pocket at 2.5 kHz, lowered while you sing" + (rp.mix && rp.mix.length > 1 ? "; " + rp.mix.slice(1).join("; ") : "") + ".</li></ul>" : (w.why ? '<p class="ml-note">' + w.why + "</p>" : ""));
        sheet.querySelectorAll("[data-ml]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.ml; ui[k] = k === "answer" ? b.dataset.v === "true" : b.dataset.v; paint(); }));
        sheet.querySelectorAll("[data-ml-act]").forEach((b) => b.addEventListener("click", () => ({ add, regen: regenerate, toggle, remove, undo }[b.dataset.mlAct]())));
        const au = sheet.querySelector("#ml-auto"); if (au) au.addEventListener("change", () => { settings().set("autoMelody", au.checked); suppressed = false; });
    }
    function build() {
        const tb = document.querySelector(".studio-toolbar"); if (!tb || document.getElementById("ml-btn")) return;
        btn = document.createElement("button");
        btn.type = "button"; btn.id = "ml-btn"; btn.className = "studio-tool-btn ml-btn"; btn.title = "Melody that fits your vocal"; btn.setAttribute("aria-label", "Melody that fits your vocal");
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10v4h4l7 5V5L7 10z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"/></svg><span class="btn-label">Melody</span>';
        btn.addEventListener("click", () => {
            ui.open = !ui.open; sheet.hidden = !ui.open;
            if (ui.open) { const x = document.getElementById("fx-close"), rk = document.getElementById("fx-rack"); if (x && rk && !rk.classList.contains("hidden")) x.click(); paint(); }   // the Effects panel would cover this one
        });
        const send = document.getElementById("studio-to-pipeline");
        const actions = tb.querySelector(".studio-toolbar-actions") || tb;
        actions.insertBefore(btn, send && send.parentNode === actions ? send : null);
        sheet = document.createElement("div"); sheet.className = "melody-sheet"; sheet.hidden = true; sheet.id = "ml-sheet";
        tb.parentNode.insertBefore(sheet, tb.nextSibling);
    }
    function init() { build(); setInterval(autoTick, 2500); window.addEventListener("vl-set-beat-studio", () => { suppressed = false; lastAuto = ""; previous = null; }); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

    root.VLMelody = { beatHasMelody, generate, apply, add, regenerate, remove, undo, toggle, wantsMelody, chordsOf, write, listenToVocal, linesOf, singerKey, fitOf, _internal: { biquad, renderTrumpet, snapToScale, scalePcs, rng } };
})(typeof window !== "undefined" ? window : this);
