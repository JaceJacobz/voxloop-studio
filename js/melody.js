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
    const Y = () => (root.VLYield ? root.VLYield() : null);                 // let the screen breathe during long loops (yield.js)
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
    async function chordsOf(mono, sr, bpm, key, refCents) {
        const barSec = 240 / bpm, winSec = barSec / 2, N = 16384, out = [];
        const dur = mono.length / sr, pcs = key ? scalePcs(key) : null, re = new Float64Array(N), im = new Float64Array(N);
        const hann = new Float64Array(N); for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        const cents = (refCents || 0) / 100;
        for (let t0 = 0; t0 < dur - 0.2; t0 += winSec) {
            await Y();
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
    // Several lines, each with a job, and each only where it is needed:
    //   answer   a reply after a sung line (in the bigger gaps), built from the shape of what was just sung
    //   fill     a small figure in the SHORT gaps, only where the beat itself is quiet in the mids
    //   sparkle  a high chime on the landing note of a phrase that ends a verse or chorus
    //   support  (optional) a soft double / harmony of long sung notes in the loudest lines
    // Who plays each job depends on the beat (S.palette): the beat's own lead, pluck, bell and keys, or the built-in trumpet.
    // opts: { amount: "subtle"|"normal"|"lots", answer: bool, support: "off"|"double"|"harmony", seed }
    const REG = { trumpet: { off: 7, lo: 55, hi: 84 }, lead: { off: 7, lo: 58, hi: 86 }, pluck: { off: 9, lo: 60, hi: 88 }, bell: { off: 19, lo: 72, hi: 96 }, keys: { off: 2, lo: 50, hi: 79 } };

    function write(S, opts) {
        const R = rng(opts.seed || 1), beatSec = 60 / S.bpm, eighth = beatSec / 2, pcs = scalePcs(S.key), pal = S.palette || { answer: ["trumpet"], support: "trumpet" };
        const out = [], lines = S.lines, vN = S.notes;
        const med = median(vN.map((n) => n.midi)), p10 = pct(vN.map((n) => n.midi), 0.1), p90 = pct(vN.map((n) => n.midi), 0.9);
        const swing = clamp(S.swing != null ? S.swing : 0, 0, 0.6);
        // swing: every second eighth note comes a little late, as the beat's groove does
        const grid = (t) => { const k = Math.ceil((t - 1e-6) / eighth); return k * eighth + (k % 2 ? swing * 0.4 * eighth : 0); };
        const regOf = (inst) => { const r = REG[inst] || REG.trumpet, c = clamp(Math.round(med + r.off), r.lo + 5, r.hi - 5); return [clamp(c - 7, r.lo, r.hi), clamp(c + 7, r.lo, r.hi)]; };
        const nearestIn = (target, set, a, b) => { let best = null; for (let m = a; m <= b; m++) if (set.has(mod12(m)) && (best == null || Math.abs(m - target) < Math.abs(best - target))) best = m; return best == null ? Math.round(target) : best; };
        const amountK = opts.amount === "lots" ? 1 : opts.amount === "normal" ? 0.7 : 0.4;       // how much of what is possible is used
        const needed = (a, b, tol) => !S.activity || S.activity.at(a, b) <= tol;               // is the beat quiet enough there to want something?

        // which sung lines are the big ones (loudest 35%): extras go there, the quiet lines are left to the voice
        const lvl = lines.map((l) => l.db != null ? l.db : 0), sortedL = lvl.slice().sort((a, b) => a - b), bigThr = sortedL[Math.floor(sortedL.length * 0.65)];
        const big = (i) => lvl[i] >= bigThr;

        let placed = 0, eligible = 0, fills = 0, sparkles = 0, supported = 0;
        const answered = new Set();
        const add = (n) => out.push(n);

        // ---- Answer (and a sparkle on its landing note)
        if (opts.answer !== false) lines.forEach((ln, i) => {
            const next = lines[i + 1], gapEnd = next ? next.t0 : S.duration, gapStart = ln.t1, room = gapEnd - gapStart;
            if (room < 1.6 * beatSec) return;
            eligible++;
            const stanzaEnd = room >= 3 * beatSec;
            if (!(stanzaEnd || (i % 2 === 1 ? R() < amountK + 0.4 : R() < amountK - 0.1))) return;
            if (opts.amount !== "lots" && placed && placed >= Math.ceil(eligible * (opts.amount === "normal" ? 0.8 : 0.55))) return;
            const start = grid(gapStart + 0.4 * beatSec), maxEnd = gapEnd - 0.5 * beatSec;
            const L = Math.min(maxEnd - start, (opts.amount === "lots" ? 5 : 3.5) * beatSec);
            if (L < 0.9 * beatSec) return;
            if (!needed(start, maxEnd, 4)) return;                                           // the beat is busy there: leave the gap alone
            const inst = pal.answer[placed % pal.answer.length];
            const [lo, hi] = regOf(inst);

            const last = ln.notes.slice(-4);
            let cells = [];
            for (let k = 0; k < last.length - 1; k++) cells.push(clamp(Math.round((last[k + 1].t0 - last[k].t0) / eighth) * eighth, eighth, beatSec));
            if (cells.length < 2) cells = [eighth, eighth, beatSec * 0.5];
            if (R() < 0.5) cells.reverse();
            const heldLen = clamp(L - 0.4 * beatSec, beatSec, 1.5 * beatSec);
            const rhythm = []; let tAcc = 0;
            for (const c of cells) { if (tAcc + c > L - heldLen) break; rhythm.push(c); tAcc += c; }
            if (rhythm.length < 1) { rhythm.push(eighth); tAcc = eighth; }
            const finalLen = Math.max(0.6 * beatSec, Math.min(heldLen, maxEnd - (start + tAcc)));
            if (start + tAcc + 0.4 > maxEnd) return;
            rhythm.push(finalLen);

            const iv = []; for (let k = 1; k < last.length; k++) iv.push(clamp(Math.round(last[k].midi - last[k - 1].midi), -4, 4));
            const invert = i % 2 === 0 ? R() < 0.7 : R() < 0.3;
            const ch0 = chordAt(S.chords, start, S.key), tones0 = new Set(chordTones(ch0));
            const centre = Math.round((lo + hi) / 2);
            let m = nearestIn(centre + (R() < 0.5 ? 0 : 2), tones0, lo, hi);
            const seq = [m];
            for (let k = 1; k < rhythm.length; k++) {
                const t = start + rhythm.slice(0, k).reduce((a, b) => a + b, 0);
                const ch = chordAt(S.chords, t, S.key), cset = new Set(chordTones(ch));
                let step = (iv[k - 1] != null ? iv[k - 1] : (R() < 0.5 ? 2 : -2)) * (invert ? -1 : 1);
                if (seq.length >= 2 && Math.abs(step) > 3) step = Math.sign(step) * 2;
                const target = clamp(seq[k - 1] + step, lo, hi);
                const onBeat = Math.abs((t / beatSec) - Math.round(t / beatSec)) < 0.02;
                let cand = nearestIn(target, onBeat ? cset : pcs, lo, hi);
                if (cand === seq[k - 1] && seq.length >= 2 && seq[k - 2] === cand) cand = nearestIn(target + (R() < 0.5 ? 2 : -2), pcs, lo, hi);
                seq.push(cand);
            }
            const tEnd = start + rhythm.slice(0, -1).reduce((a, b) => a + b, 0), chE = chordAt(S.chords, tEnd, S.key), tonesE = chordTones(chE);
            const want = stanzaEnd ? tonesE[0] : tonesE[R() < 0.5 ? 1 : 2];
            seq[seq.length - 1] = nearestIn(seq[seq.length - 1], new Set([want]), lo, hi);

            let t = start;
            const energy = clamp(0.62 + (big(i) ? 0.14 : 0), 0.5, 0.85);                  // louder lines get a fuller reply
            rhythm.forEach((d, k) => {
                const lastNote = k === rhythm.length - 1, tt = t + (k % 2 && !lastNote ? swing * 0.2 * eighth : 0);
                const n = { t: tt, dur: lastNote ? d : Math.min(d * 0.9, d - 0.03), midi: seq[k], vel: lastNote ? energy + 0.06 : energy + (k === 0 ? 0.06 : 0), inst, role: "answer" };
                add(n);
                if (inst === "keys") {                                                    // keys play two notes: the tune and a chord tone under it
                    const ch = chordAt(S.chords, tt, S.key), under = chordTones(ch).map((p) => { let q = n.midi - 3; while (mod12(q) !== p) q--; return q; }).filter((q) => n.midi - q >= 3 && n.midi - q <= 9)[0];
                    if (under != null) add({ t: tt, dur: n.dur, midi: under, vel: n.vel * 0.8, inst, role: "answer", sub: true });
                }
                t += d;
            });
            placed++; answered.add(i);
            // a chime on the landing note, an octave up, only where a verse or chorus ends (or in "lots")
            if ((stanzaEnd || opts.amount === "lots") && pal.sparkle !== false && R() < (stanzaEnd ? 0.9 : 0.5) * (0.5 + amountK)) {
                const [blo, bhi] = regOf("bell"), mb = nearestIn(seq[seq.length - 1] + 12, new Set([mod12(seq[seq.length - 1])]), blo, bhi);
                add({ t: tEnd + 0.01, dur: Math.min(finalLen, 2 * beatSec), midi: mb, vel: 0.5, inst: "bell", role: "sparkle" }); sparkles++;
            }
        });

        // ---- Fill: a small figure in any gap the answer did not take (a short gap, or a longer one where an answer would be too much),
        //      as a pickup into the next line or a small echo after the last one: only where the beat is quiet in the mids
        if (opts.answer !== false && pal.fill !== false) {
            const [lo, hi] = regOf("pluck");
            lines.forEach((ln, i) => {
                const next = lines[i + 1]; if (!next || answered.has(i)) return;
                const gapStart = ln.t1, gapEnd = next.t0, room = gapEnd - gapStart;
                if (room < 1.3 * beatSec) return;
                if (R() > amountK * 0.9) return;
                const pickup = i % 2 === 1;                                              // a lead-in to the next line, or an echo of the last one
                const maxLen = Math.min(room - 0.55 * beatSec, 2 * beatSec);
                const start = pickup ? grid(gapEnd - 0.3 * beatSec - maxLen) : grid(gapStart + 0.25 * beatSec), endT = Math.min(gapEnd - 0.25 * beatSec, start + maxLen);
                const n = Math.min(3, Math.floor((endT - start) / eighth));
                if (n < 2) return;
                if (!needed(start, endT, 1.5)) return;
                const ch = chordAt(S.chords, start, S.key), tones = chordTones(ch);
                let m = nearestIn(Math.round((lo + hi) / 2) + (pickup ? -2 : 0), new Set(tones), lo, hi);
                for (let k = 0; k < n; k++) {
                    const tt = start + k * eighth + (k % 2 ? swing * 0.2 * eighth : 0);
                    add({ t: tt, dur: eighth * 0.9, midi: m, vel: 0.42 + 0.06 * k, inst: "pluck", role: "fill" });
                    const dir = pickup ? 1 : -1; m = nearestIn(m + dir * 3, new Set(tones.concat([(tones[0] + 7) % 12])), lo, hi);
                }
                fills++;
            });
        }

        // ---- Support: soft doubling / harmony on long sung notes, in the big lines only
        if (opts.support && opts.support !== "off") {
            const longs = []; vN.forEach((n) => { if (n.t1 - n.t0 >= 0.5) { const li = lines.findIndex((l) => n.t0 >= l.t0 - 0.01 && n.t1 <= l.t1 + 0.01); if (li < 0 || big(li) || opts.amount === "lots") longs.push(n); } });
            const every = opts.amount === "lots" ? 1 : 2, inst = pal.support || "trumpet";
            longs.forEach((n, k) => {
                if (k % every !== 0) return;
                const snapped = snapToScale(n.midi, pcs, 0.9); if (snapped == null) return;
                let m = snapped + 12;
                if (opts.support === "harmony") {
                    const arr = (SCALES[S.key.scale] || SCALES.major).map((d) => (S.key.rootPc + d) % 12), idx = arr.indexOf(mod12(snapped)); if (idx < 0) return;
                    m = snapped + ((arr[(idx + 2) % 7] - arr[idx] + 12) % 12);
                }
                const r = REG[inst] || REG.trumpet;
                if (m > r.hi || m < r.lo) { m = snapped; if (m > r.hi || m < r.lo) return; }
                add({ t: n.t0 + 0.03, dur: Math.max(0.3, (n.t1 - n.t0) * 0.85), midi: m, vel: 0.5, inst, role: "support" }); supported++;
            });
        }

        // ---- never a second singer: a cap on how many notes a minute, dropping the least important first
        const mins = Math.max(0.5, S.duration / 60), cap = Math.round((opts.amount === "lots" ? 44 : opts.amount === "normal" ? 28 : 18) * mins);
        const prio = { answer: 0, sparkle: 1, fill: 2, support: 3 };
        let dropped = 0;
        const core = out.filter((n) => !n.sub);                                           // (the second note of a keys chord is not counted)
        if (core.length > cap) {
            const order = core.map((n, idx) => ({ n, idx })).sort((a, b) => prio[a.n.role] - prio[b.n.role] || a.idx - b.idx), keep = new Set(order.slice(0, cap).map((o) => o.n));
            for (let k = out.length - 1; k >= 0; k--) { const n = out[k]; if (n.sub ? !core.some((c) => keep.has(c) && Math.abs(c.t - n.t) < 0.002 && c.inst === n.inst) : !keep.has(n)) { out.splice(k, 1); if (!n.sub) dropped++; } }
        }
        const count = (role) => out.filter((n) => n.role === role).length;
        const insts = [...new Set(out.map((n) => n.inst))];
        return { notes: out, answers: count("answer") ? placed : 0, eligible, fills: count("fill"), sparkles: count("sparkle"), supported: count("support"), dropped, instruments: insts, register: regOf(pal.answer[0] || "trumpet"), vocalRange: [Math.round(p10), Math.round(p90)] };
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
    async function reverbWet(x, sr, decay) {
        const sets = [[1116, 1188, 1277, 1356], [1139, 1211, 1300, 1379]], outs = [new Float32Array(x.length), new Float32Array(x.length)];
        for (let side = 0; side < sets.length; side++) {
            const delays = sets[side];
            const combs = delays.map((d) => ({ buf: new Float32Array(Math.round(d * sr / 44100)), i: 0, fb: Math.pow(10, -3 * (d / 44100) / decay), lp: 0 }));
            const aps = [225, 556].map((d) => ({ buf: new Float32Array(Math.round(d * sr / 44100)), i: 0 }));
            const o = outs[side];
            for (let n = 0; n < x.length; n++) {
                if ((n & 32767) === 0) await Y();
                let s = 0; const inp = x[n] * 0.3;
                for (const c of combs) { const y = c.buf[c.i]; c.lp = y * 0.62 + c.lp * 0.38; c.buf[c.i] = inp + c.lp * c.fb; c.i = (c.i + 1) % c.buf.length; s += y; }
                for (const a of aps) { const y = a.buf[a.i], z = s + y * 0.5; a.buf[a.i] = z; s = y - z * 0.5; a.i = (a.i + 1) % a.buf.length; }
                o[n] = s * 0.25;
            }
        }
        return outs;
    }

    // ---------------------------------------------------------------- 4. MIX
    function frameDb(x, sr, from, to, win) { const n = Math.floor((to - from) / win), out = new Float32Array(n); for (let k = 0; k < n; k++) { let e = 0; for (let i = from + k * win; i < from + (k + 1) * win; i++) e += x[i] * x[i]; out[k] = db(Math.sqrt(e / win)); } return out; }

    // ---- the beat's own instruments (Beat Lab's engine): lead, pluck, chime bell and keys, rendered offline with the sound
    // pack of the beat, so the added lines sound like they belong to it. Returns a stereo AudioBuffer or null.
    const ENGINE_NAME = { lead: "lead", pluck: "pluck", bell: "bell", keys: "chordSynth" };
    const ROLE_DB = { answer: 0, fill: -3, sparkle: -7, support: -6 };
    async function renderEngineStem(notes, plan, S) {
        if (!notes.length || typeof createEngine !== "function" || typeof Tone === "undefined" || typeof OfflineAudioContext === "undefined") return null;
        const sr = S.sr, template = resolveTemplate(plan.genre, plan.styleId), dur = S.duration + 2.5;
        const original = Tone.getContext(), native = new OfflineAudioContext(2, Math.ceil(dur * sr), sr), offline = new Tone.OfflineContext(native);
        Object.defineProperty(offline, "currentTime", { get: () => native.currentTime });
        offline.now = () => native.currentTime;
        Tone.setContext(offline);
        try {
            const E = createEngine({ live: false, reverbDecay: template.fx.reverb.decay });
            E.applySound(plan.sound);
            E.applyFx(template.fx, S.bpm);
            const tmpl = (typeof TEMPLATES !== "undefined" && TEMPLATES[plan.genre]) || { mix: {}, pan: {} };
            const base = { lead: 0, pluck: 0, bell: 0, chordSynth: 0 };
            ["lead", "pluck", "bell"].forEach((n) => { E.instruments[n].volume.value = (tmpl.mix[n] != null ? tmpl.mix[n] : -8); if (E.pan && E.pan[n]) E.pan[n].pan.value = (tmpl.pan && tmpl.pan[n]) || 0; });
            E.instruments.chords.volume.value = tmpl.mix.chords != null ? tmpl.mix.chords : -8;
            E.master.gain.value = MASTER_BASE;
            Tone.getDestination().volume.value = 0;
            E.vocalEQ.gain.value = 0;
            E.setMastering(false, true);
            try { await E.reverb.ready; } catch (err) { /* older Tone */ }
            await new Promise((r) => setTimeout(r, 120));
            const inst = { lead: E.instruments.lead, pluck: E.instruments.pluck, bell: E.instruments.bell, keys: E.instruments.chords };
            const nm = (m) => Tone.Frequency(m, "midi").toNote();
            notes.forEach((n) => {
                const ins = inst[n.inst]; if (!ins) return;
                const v = clamp(n.vel * lin(ROLE_DB[n.role] || 0), 0.05, 1);
                try { ins.triggerAttackRelease(nm(n.midi), Math.max(0.08, n.dur), Math.max(0.01, n.t), v); } catch (err) { console.warn("melody note skipped", err.message); }
            });
            const rendered = await offline.render();
            return rendered.get();
        } finally { Tone.setContext(original); }
    }

    async function renderAndMix(S, written, opts, report) {
        const sr = S.sr, N = Math.ceil(S.duration * sr), lead = new Float32Array(N), sup = new Float32Array(N);
        const trumpetNotes = written.notes.filter((n) => n.inst === "trumpet"), engineNotes = written.notes.filter((n) => n.inst !== "trumpet");
        for (const n of trumpetNotes) { renderTrumpet(n.role === "support" ? sup : lead, sr, n, { muted: n.role === "support", voices: n.role === "support" ? 2 : 3 }); await Y(); }
        if (report.stage) report.stage(0.6, engineNotes.length ? "Playing the beat's instruments…" : "Mixing the melody under your voice…");
        // the beat's own instruments (if the engine is not there, the same notes are played by the built-in muted trumpet)
        let eng = null;
        if (engineNotes.length) {
            try { eng = await renderEngineStem(engineNotes, S.plan, S); } catch (e) { console.warn("engine stem", e); eng = null; }
            if (!eng) { for (const n of engineNotes) { renderTrumpet(sup, sr, Object.assign({}, n, { midi: clamp(n.midi, 55, 84) }), { muted: true, voices: 2 }); await Y(); } report.fallback = true; }
        }
        const engL = new Float32Array(N), engR = new Float32Array(N);
        if (eng) { const a = eng.getChannelData(0), b = eng.numberOfChannels > 1 ? eng.getChannelData(1) : a, len = Math.min(N, a.length); engL.set(a.subarray(0, len)); engR.set(b.subarray(0, len)); }

        // the vocal's activity: where the singer is (for ducking and for the final check)
        const win = Math.round(0.02 * sr), vm = S.vocalMono, vdb = vm ? frameDb(vm, sr, 0, Math.min(vm.length, N), win) : new Float32Array(0);
        const vtop = vdb.length ? pct(Array.from(vdb), 0.95) : -60;
        const singing = new Uint8Array(vdb.length); for (let k = 0; k < vdb.length; k++) singing[k] = vdb[k] > vtop - 30 ? 1 : 0;

        // tone: no low end (the bass and kick own it), a pocket at 2.5 kHz for the voice, no fizz
        [lead, sup, engL, engR].forEach((b) => { biquad(b, sr, "hp", 170, 0.7); biquad(b, sr, "peak", 2600, 0.9, -3.5); biquad(b, sr, "lp", 9000, 0.7); });
        // duck under the singer: -5 dB while there is singing (fast in, slow out), the support line a little more
        const duck = new Float32Array(N); let cur = 1;
        const a = Math.exp(-1 / (0.015 * sr)), r = Math.exp(-1 / (0.22 * sr));
        for (let i = 0; i < N; i++) {
            if ((i & 131071) === 0) await Y();
            const k = Math.min(singing.length - 1, Math.floor(i / win)), want = k >= 0 && singing[k] ? lin(-5) : 1;
            cur = want < cur ? a * cur + (1 - a) * want : r * cur + (1 - r) * want; duck[i] = cur;
        }
        for (let i = 0; i < N; i++) { lead[i] *= duck[i]; sup[i] *= duck[i] * duck[i] * 0.8; engL[i] *= duck[i]; engR[i] *= duck[i]; }

        // level: against the beat (about 8 dB under its body) and against the vocal (11 dB under it), for all lines together
        const bm = S.beatMono, bdb = frameDb(bm, sr, 0, Math.min(bm.length, N), Math.round(0.1 * sr)), beatRms = pct(Array.from(bdb), 0.6);
        const mel = new Float32Array(N); for (let i = 0; i < N; i++) mel[i] = lead[i] + sup[i] + (engL[i] + engR[i]) * 0.5;
        // loudness of the melody while it plays: the same measure used for the final report (mean power of the sounding samples), so
        // sustained notes (trumpet) and sharp ones (plucks, chimes) are levelled the same way
        let mp = 0, mc = 0; for (let i = 0; i < N; i += 5) { if (Math.abs(mel[i]) > 1e-4) { mp += mel[i] * mel[i]; mc++; } }
        const melRms = mc ? 10 * Math.log10(mp / mc) : -60;
        const wantDb = Math.min(beatRms - 8, vdb.length ? vtop - 12 : 0);
        const amountTrim = opts.amount === "lots" ? 1.5 : opts.amount === "normal" ? 0 : -1.5;
        const gDb = wantDb + amountTrim - melRms;
        report.gainSteps = ["level to the beat and the vocal: " + gDb.toFixed(1) + " dB"];
        const g = lin(clamp(gDb, -40, 18));

        // reverb: a short plate on the trumpet only (the beat's instruments already carry the beat's own space)
        const tr = new Float32Array(N); for (let i = 0; i < N; i++) tr[i] = lead[i] + sup[i];
        const wet = await reverbWet(tr, sr, 1.1);
        const L = new Float32Array(N), Rr = new Float32Array(N), widen = Math.round(0.011 * sr);
        for (let i = 0; i < N; i++) {
            const c = lead[i], s = sup[i];
            L[i] = (c * 0.95 + s * 0.8 + engL[i]) * g + wet[0][i] * g * 0.22;
            Rr[i] = (c * 1.0 + (i >= widen ? sup[i - widen] * 0.95 : 0) + engR[i]) * g + wet[1][i] * g * 0.22;
        }
        biquad(L, sr, "hp", 220, 0.7); biquad(Rr, sr, "hp", 220, 0.7);

        // final check against the vocal: in the 1-4 kHz band, while the singer sings, the melody must stay >= 12 dB under the voice
        let trim = 0;
        if (vm) {
            const bandL = new Float32Array(L), bandV = Float32Array.from(vm.subarray(0, Math.min(vm.length, N)));
            [bandL, bandV].forEach((b) => { biquad(b, sr, "hp", 1000, 0.7); biquad(b, sr, "lp", 4000, 0.7); });
            let ev = 0, em = 0;
            for (let k = 0; k < singing.length; k++) if (singing[k]) for (let i = k * win; i < (k + 1) * win && i < bandL.length; i++) { ev += bandV[i] * bandV[i]; em += bandL[i] * bandL[i]; }
            if (ev > 0 && em > 0) { const ratio = 10 * Math.log10(em / ev); report.melOverVoice = ratio; if (ratio > -12) trim = Math.min(8, ratio + 12); }
        }
        if (trim > 0) { const tt = lin(-trim); for (let i = 0; i < N; i++) { L[i] *= tt; Rr[i] *= tt; } report.gainSteps.push("kept under the voice: " + (-trim).toFixed(1) + " dB"); }

        // headroom: the beat plus the melody together must stay under -1 dBFS; if not, the melody (never the beat) comes down
        let pk = 0; const bL = S.beatL, bR = S.beatR;
        for (let i = 0; i < N; i++) { const a1 = Math.abs((bL[i] || 0) + L[i]), a2 = Math.abs((bR[i] || 0) + Rr[i]); if (a1 > pk) pk = a1; if (a2 > pk) pk = a2; }
        if (pk > lin(-1)) {
            let bp = 0; for (let i = 0; i < N; i++) bp = Math.max(bp, Math.abs(bL[i] || 0), Math.abs(bR[i] || 0));
            const tt = clamp((lin(-1) - bp) / Math.max(1e-9, pk - bp), 0.2, 1);
            if (tt < 1) { for (let i = 0; i < N; i++) { L[i] *= tt; Rr[i] *= tt; } report.gainSteps.push("headroom: " + db(tt).toFixed(1) + " dB"); }
        }
        const fade = Math.round(0.01 * sr); for (let i = 0; i < fade; i++) { const f = i / fade; L[i] *= f; Rr[i] *= f; L[N - 1 - i] *= f; Rr[N - 1 - i] *= f; }
        let rms = 0, cnt = 0; for (let i = 0; i < N; i += 7) { if (Math.abs(L[i]) > 1e-4) { rms += L[i] * L[i]; cnt++; } }
        report.melodyDb = cnt ? 10 * Math.log10(rms / cnt) : -90; report.beatDb = beatRms; report.voiceDb = vtop;
        return { L, R: Rr };
    }

    // ---------------------------------------------------------------- what to play it with
    // Beat Lab beats carry their own sound (the pack they were made with): the lines use exactly that. Any other beat gets the
    // sound pack that suits its style, found from its tempo and the style the analysis heard.
    const ROLES = {
        afrobeats: { answer: ["trumpet", "lead"], support: "trumpet", why: "trumpet and the beat's lead answer you, small plucked fills appear where the beat has room" },
        amapiano:  { answer: ["keys", "lead"], support: "keys", why: "keys and the lead answer you, small plucked fills appear where the beat has room" },
        afrohouse: { answer: ["lead", "pluck"], support: "keys", why: "the lead and plucks answer you" },
        rnb:       { answer: ["keys", "lead"], support: "keys", why: "soft keys and the lead answer you, small plucked fills appear where the beat has room" },
        universal: { answer: ["trumpet"], support: "trumpet", why: "a trumpet answers you, small plucked fills appear where the beat has room" }
    };
    function buildPlan(beat, info, bpm, seed, mode) {
        const trumpetOnly = { genre: "afrobeats", styleId: null, sound: null, engine: false, source: "the built-in trumpet", palette: { answer: ["trumpet"], support: "trumpet", fill: false, sparkle: false } };
        if (mode === "trumpet" || typeof createEngine !== "function" || typeof Tone === "undefined" || typeof resolveTemplate !== "function") return trumpetOnly;
        let genre, styleId = null, sound, source, rolesKey;
        if (beat.engine && beat.engine.sound && beat.engine.genre) {
            genre = beat.engine.genre; styleId = beat.engine.styleId || null; sound = Object.assign({}, beat.engine.sound);
            source = "the beat's own sounds"; rolesKey = ROLES[genre] ? genre : "universal";
        } else {
            const gid = info && info.genreId;
            genre = gid === "amapiano" ? "amapiano" : gid === "rnb" ? "rnb" : gid === "afrobeats" ? "afrobeats" : (bpm < 90 ? "rnb" : bpm >= 120 ? "afrohouse" : bpm >= 108 ? "amapiano" : "afrobeats");
            rolesKey = gid === "afrobeats" || gid === "amapiano" || gid === "rnb" ? gid : (!gid || gid === "universal" ? genre : "universal");   // a style we have no pack of (trap, rap) gets the neutral set
            try {
                const tpl = resolveTemplate(genre, null); styleId = tpl.styleId;
                const packs = typeof packsFor === "function" ? packsFor(genre, styleId) : [];
                const pack = packs.length ? packs[(seed - 1 + packs.length * 4) % packs.length] : null;
                sound = pack ? packParts(pack) : null;
                source = pack ? "matched to the beat: the “" + pack.name + "” sounds (" + (gid && gid !== "universal" ? "it sounds like " + gid : "chosen from its tempo") + ")" : "";
            } catch (e) { sound = null; }
        }
        if (!sound) return trumpetOnly;
        sound.bellKind = "bell";                                                   // the chime has to be a pitched bell
        const roles = ROLES[rolesKey] || ROLES.universal;
        const answer = roles.answer.slice();
        if (mode === "lots-brass" && answer.indexOf("trumpet") < 0) answer.push("trumpet");
        return { genre, styleId, sound, engine: true, source, rolesKey, palette: { answer, support: roles.support, fill: true, sparkle: true, why: roles.why } };
    }
    const GROOVE_SWING = { rnb: 0.3, afrobeats: 0.12, amapiano: 0.1, afrohouse: 0.05, universal: 0.1 };

    // How busy is the beat in the mids (400 Hz - 4 kHz), 100 ms at a time? A line is only added where the beat is not already busy.
    function beatActivity(beatMono, sr) {
        const m = Float32Array.from(beatMono); biquad(m, sr, "hp", 400, 0.7); biquad(m, sr, "lp", 4000, 0.7);
        const fr = Math.round(0.1 * sr), n = Math.floor(m.length / fr), dbs = new Float32Array(n);
        for (let k = 0; k < n; k++) { let e = 0; for (let i = k * fr; i < (k + 1) * fr; i += 2) e += m[i] * m[i]; dbs[k] = db(Math.sqrt(e / (fr / 2))); }
        const active = Array.from(dbs).filter((v) => v > -80), medDb = active.length ? pct(active, 0.5) : -60;
        return { at(a, b) { const k0 = Math.max(0, Math.floor(a / 0.1)), k1 = Math.min(n - 1, Math.floor(b / 0.1)); if (k1 < k0) return 0; let s = 0; for (let k = k0; k <= k1; k++) s += dbs[k]; return s / (k1 - k0 + 1) - medDb; } };
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

        const stage = (f, txt) => { if (options && options.onStage) options.onStage(f, txt); };
        stage(0.1, "Listening to your vocal…");
        const heard = await listenToVocal(Dd.lanes, bpm);
        stage(0.3, "Reading the beat's chords…");
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
        const chords = await chordsOf(beatMono, sr, bpm, useKey, useKey.refCents || (info && info.key && info.key.refCents) || 0);

        // the vocal as one mono signal on the song's timeline (for ducking and the final check)
        const vocalMono = new Float32Array(N);
        heard.clips.forEach((c) => { const b = c.buffer, off = Math.round(c.start * sr); for (let ch = 0; ch < b.numberOfChannels; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length && off + i < N; i++) vocalMono[off + i] += d[i] / b.numberOfChannels; } });

        stage(0.45, "Choosing the sounds and writing the lines…");
        const seed = options && options.seed != null ? options.seed : 1;
        const opts = { amount: (options && options.amount) || "subtle", answer: !(options && options.answer === false), support: (options && options.support) || "off", seed, instruments: (options && options.instruments) || "auto" };
        const plan = buildPlan(beat, info, bpm, seed, opts.instruments);
        const activity = beatActivity(beatMono, sr);
        // how loud each sung line is (the loud ones are the big moments)
        lines.forEach((l) => { const a = Math.floor(l.t0 * sr), b = Math.min(N, Math.floor(l.t1 * sr)); let e = 0, c = 0; for (let i = a; i < b; i += 3) { e += vocalMono[i] * vocalMono[i]; c++; } l.db = c ? db(Math.sqrt(e / c)) : -90; });
        const swing = beat.swing != null ? beat.swing : (GROOVE_SWING[plan.rolesKey] != null ? GROOVE_SWING[plan.rolesKey] : 0.1);
        const S = { bpm, key: useKey, chords, notes: heard.notes, lines, duration: beat.buffer.duration, sr, vocalMono, beatMono, beatL: bL, beatR: bR, palette: plan.palette, plan, activity, swing };
        const written = write(S, opts);
        if (!written.notes.length) return { ok: false, text: "No good place for a melody: the gaps between your lines are too short. (It never plays over the singing.)" };

        await new Promise((r) => setTimeout(r, 0));
        const mixRep = {};
        mixRep.stage = stage;
        const mixed = await renderAndMix(S, written, opts, mixRep);
        const ctx = A.ensureCtx(), buf = ctx.createBuffer(2, N, sr);
        buf.copyToChannel(mixed.L, 0); buf.copyToChannel(mixed.R, 1);

        const out = {
            ok: true, buffer: buf, on: true, seed, opts,
            notes: written.notes, chordsUsed: chords,
            report: {
                key: keyText, tempo: Math.round(bpm) + " BPM",
                answers: written.answers, fills: written.fills, sparkles: written.sparkles, support: written.supported, dropped: written.dropped, instruments: written.instruments, sounds: plan.source, why: plan.palette.why || "", fallback: !!mixRep.fallback, register: NOTE[mod12(written.register[0])] + " to " + NOTE[mod12(written.register[1])] + ", above your " + NOTE[mod12(written.vocalRange[0])] + "-" + NOTE[mod12(written.vocalRange[1])],
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
        const prog = root.VLProgress ? root.VLProgress.start("Writing a melody around your vocal…") : null;
        try {
            const r = await generate(Object.assign({}, options, { onStage: (f, txt) => { if (prog) prog.set(f, txt); } }));
            if (!r.ok) { status(r.text); paint(r.text); return r; }
            previous = api().getMelody ? api().getMelody() : null;
            api().setMelody(r);
            suppressed = false;
            const rp = r.report;
            status("Melody added: " + [rp.answers + " answer" + (rp.answers === 1 ? "" : "s"), rp.fills ? rp.fills + " fill" + (rp.fills === 1 ? "" : "s") : "", rp.sparkles ? rp.sparkles + " chime" + (rp.sparkles === 1 ? "" : "s") : "", rp.support ? rp.support + " support" : ""].filter(Boolean).join(" + "));
            paint();
            return r;
        } catch (e) { console.warn("melody", e); status("Could not write a melody"); return null; }
        finally { busy = false; if (prog) prog.done(); }
    }
    const status = (m) => { if (api().status) api().status(m); };
    const current = () => (api().getMelody ? api().getMelody() : null);
    const optsFromUi = () => ({ amount: ui.amount, answer: ui.answer, support: ui.support, seed: ui.seed, instruments: ui.instruments });
    const ui = { amount: "subtle", answer: true, support: "off", seed: 1, instruments: "auto", open: false };

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
            '<p class="ml-lead"><b>Melody that fits your vocal.</b> Short lines written around what you sang, played by the beat\'s own instruments or a trumpet. They answer you in the gaps and never play over the singing.' + (current() ? "" : " Autopilot adds this by itself when the beat has no melody.") + "</p>" +
            '<div class="ml-row"><span>Sounds</span>' + seg("instruments", ui.instruments, [["auto", "Match the beat"], ["trumpet", "Trumpet only"]]) + "</div>" +
            '<div class="ml-row"><span>Answer the voice</span>' + seg("answer", ui.answer, [[true, "On"], [false, "Off"]]) + "</div>" +
            '<div class="ml-row"><span>Support long notes</span>' + seg("support", ui.support, [["off", "Off"], ["double", "Double"], ["harmony", "Harmonise"]]) + "</div>" +
            '<div class="ml-row"><span>How much</span>' + seg("amount", ui.amount, [["subtle", "Subtle"], ["normal", "Normal"], ["lots", "Lots"]]) + "</div>" +
            '<label class="ml-auto"><input type="checkbox" id="ml-auto"' + (settings() && settings().get("autoMelody") ? " checked" : "") + '> Let Autopilot decide (adds it when the beat has no melody)</label>' +
            '<div class="ml-actions"><button type="button" class="eb-primary" data-ml-act="add">' + (m ? "Update melody" : "Add melody that fits my vocal") + "</button>" +
            (m ? '<button type="button" class="bp-mini" data-ml-act="regen">Regenerate</button><button type="button" class="bp-mini" data-ml-act="toggle">' + (m.on ? "Hide" : "Show") + '</button><button type="button" class="bp-mini" data-ml-act="remove">Remove</button>' : "") +
            (previous !== null && (previous || m) ? '<button type="button" class="bp-mini" data-ml-act="undo">Undo</button>' : "") + "</div>" +
            (note ? '<p class="ml-note">' + note + "</p>" : "") +
            (rp ? '<ul class="ml-report"><li>' + rp.key + "</li><li>" + describe(rp) + "</li><li>" + (rp.sounds ? "Sounds: " + rp.sounds + (rp.why ? ": " + rp.why + "." : ".") : "Sounds: the built-in trumpet.") + (rp.fallback ? " (The beat's instruments were not available here, so a muted trumpet played those lines.)" : "") + "</li><li>Mix: about " + Math.round(rp.voiceDb - rp.melodyDb) + " dB under your voice, in a pocket at 2.5 kHz, lowered while you sing" + (rp.mix && rp.mix.length > 1 ? "; " + rp.mix.slice(1).join("; ") : "") + ".</li></ul>" : (w.why ? '<p class="ml-note">' + w.why + "</p>" : ""));
        sheet.querySelectorAll("[data-ml]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.ml; ui[k] = k === "answer" ? b.dataset.v === "true" : b.dataset.v; paint(); }));
        sheet.querySelectorAll("[data-ml-act]").forEach((b) => b.addEventListener("click", () => ({ add, regen: regenerate, toggle, remove, undo }[b.dataset.mlAct]())));
        const au = sheet.querySelector("#ml-auto"); if (au) au.addEventListener("change", () => { settings().set("autoMelody", au.checked); suppressed = false; });
    }
    const INST_NAME = { trumpet: "trumpet", lead: "lead", pluck: "pluck", bell: "chime", keys: "keys" };
    function describe(rp) {
        const parts = [];
        parts.push(rp.answers + (rp.answers === 1 ? " answer" : " answers"));
        if (rp.fills) parts.push(rp.fills + (rp.fills === 1 ? " small fill" : " small fills") + " in short gaps");
        if (rp.sparkles) parts.push(rp.sparkles + (rp.sparkles === 1 ? " chime" : " chimes") + " on phrase ends");
        if (rp.support) parts.push(rp.support + " supported note" + (rp.support === 1 ? "" : "s"));
        const who = (rp.instruments || ["trumpet"]).map((i) => INST_NAME[i] || i).join(", ");
        return parts.join(", ") + ". Played by: " + who + ". Each is only added where the beat has room, and never over your singing" + (rp.dropped ? " (" + rp.dropped + " extra notes were left out to keep it light)" : "") + ".";
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
