/**
 * Voxloop Studio: VL Clean (background noise)
 *
 * Two parts that share one measurement:
 *   VLClean.analyze(channels, sr)  listens to a take and says what is in the background and how much to do about it
 *   VLFx.P.clean                   the plugin Autopilot adds: it removes what analyze() found
 *
 * What it handles
 *   steady noise      fan, air-con, fridge, road hum, hiss. Learned from the gaps between lines and followed over time,
 *                     so a noise that slowly changes (a car passing, a fan speeding up) is followed too.
 *   wind and rumble   low-frequency bursts (wind on the mic, handling, traffic thumps). A low cut that is only closed
 *                     in the moments the rumble is there, so the voice keeps its body the rest of the time.
 *   sudden noises     children shouting, a horn, a dog, a door, a car going by, but only BETWEEN lines.
 *   What it cannot do: remove a shout that happens at the same moment as the singing. That would need the voice
 *   separated from the noise, which this does not claim to do. Those moments are lowered by the steady-noise step only,
 *   and the report says so.
 * Needs: fxrack-dsp.js (VLFx). Loaded before fxbrain.js.
 */
(function (root) {
    "use strict";
    const Fx = root.VLFx;
    if (!Fx) return;
    const U = Fx.util, clamp = U.clamp;
    const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
    const dbP = (x) => 10 * Math.log10(Math.max(x, 1e-20));

    // ---------------------------------------------------------------- FFT (radix 2, cached tables)
    const fftCache = {};
    function fftFor(N) {
        if (fftCache[N]) return fftCache[N];
        const levels = Math.round(Math.log2(N));
        const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), rev = new Uint32Array(N);
        for (let k = 0; k < N / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / N); sin[k] = Math.sin(2 * Math.PI * k / N); }
        for (let i = 0; i < N; i++) rev[i] = (rev[i >> 1] >> 1) | ((i & 1) << (levels - 1));
        return (fftCache[N] = function (re, im) {
            for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
            for (let size = 2; size <= N; size <<= 1) {
                const half = size >> 1, step = N / size;
                for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
                    const a = i + j, b = a + half;
                    const tr = re[b] * cos[k] + im[b] * sin[k], ti = im[b] * cos[k] - re[b] * sin[k];
                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                }
            }
        });
    }
    const N = 2048, HOP = 1024, BINS = N / 2 + 1;
    const WIN = (() => { const w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); return w; })();   // sqrt-Hann: used to analyse AND to rebuild

    function mono(ch) { return ch.length === 1 ? ch[0] : U.mono(ch); }

    // Power spectrum of every frame plus the frame's level (dB) in a few bands
    function spectra(m, sr) {
        const frames = Math.max(0, Math.floor((m.length - N) / HOP) + 1);
        const P = new Array(frames), lvl = new Float32Array(frames), lf = new Float32Array(frames), mid = new Float32Array(frames), hf = new Float32Array(frames);
        const re = new Float64Array(N), im = new Float64Array(N), fft = fftFor(N);
        const hz = sr / N, kLf = Math.round(200 / hz), kMid0 = Math.round(300 / hz), kMid1 = Math.round(3800 / hz), kHf = Math.round(5000 / hz);
        for (let f = 0; f < frames; f++) {
            for (let i = 0; i < N; i++) { re[i] = m[f * HOP + i] * WIN[i]; im[i] = 0; }
            fft(re, im);
            const p = new Float32Array(BINS); let e = 0, el = 0, em = 0, eh = 0;
            for (let k = 0; k < BINS; k++) {
                const v = re[k] * re[k] + im[k] * im[k]; p[k] = v; e += v;
                if (k >= 1 && k < kLf) el += v; else if (k >= kMid0 && k < kMid1) em += v; else if (k >= kHf) eh += v;
            }
            P[f] = p; lvl[f] = dbP(e / N / N * 4); lf[f] = dbP(el / N / N * 4); mid[f] = dbP(em / N / N * 4); hf[f] = dbP(eh / N / N * 4);
        }
        return { P, lvl, lf, mid, hf, frames };
    }

    function pct(a, q) { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
    function med(a) { return pct(a, 0.5); }
    function std(a) { if (a.length < 2) return 0; let m = 0; a.forEach((v) => { m += v; }); m /= a.length; let s = 0; a.forEach((v) => { s += (v - m) * (v - m); }); return Math.sqrt(s / a.length); }

    // Which frames are the singer (loud) and which are the gaps. Frames near singing are kept out of the gap set,
    // because breaths and word tails sit there and must not be learned as noise.
    function voiceMask(lvl, sr) {
        const sorted = Float64Array.from(lvl).sort(), n = sorted.length;
        const top = sorted[Math.floor(n * 0.9)] || -90, low = sorted[Math.floor(n * 0.1)] || -90;
        // "singing" is well above the quiet end. A noisy room raises that quiet end, so the line moves up with it
        const thr = Math.max(top - 22, low + 0.45 * (top - low));
        const sing = new Uint8Array(n);
        for (let f = 0; f < n; f++) sing[f] = lvl[f] >= thr ? 1 : 0;
        const before = Math.ceil(0.15 * sr / HOP), after = Math.ceil(0.30 * sr / HOP);
        const guard = new Uint8Array(n);
        for (let f = 0; f < n; f++) if (sing[f]) for (let d = -before; d <= after; d++) { const j = f + d; if (j >= 0 && j < n) guard[j] = 1; }
        return { sing, guard, thr, top };
    }

    // Sudden noises in the gaps: louder than the room, quieter than the singer, shorter than a sung line, with quiet on both sides.
    // A noise as loud as the singing, or one that happens during singing, cannot be told apart from the voice and is left alone.
    function findEvents(S, vm, floorDb, sr) {
        const hop = HOP / sr, ev = [], evThr = floorDb + 9;
        let run = null;
        const close = () => {
            if (!run) return;
            const secs = (run.b - run.a + 1) * hop;
            const quietBefore = run.a - 1 < 0 || S.lvl[run.a - 1] <= evThr + 3, quietAfter = run.b + 1 >= S.frames || S.lvl[run.b + 1] <= evThr + 3;
            if (secs >= 0.12 && secs <= 1.8 && quietBefore && quietAfter) ev.push(run);
            run = null;
        };
        for (let f = 0; f < S.frames; f++) {
            const isEv = !vm.guard[f] && S.lvl[f] > evThr && S.lvl[f] < vm.thr;
            if (isEv) { if (!run) run = { a: f, b: f, peak: S.lvl[f], mid: 0, lf: 0, n: 0 }; run.b = f; run.peak = Math.max(run.peak, S.lvl[f]); run.mid += S.mid[f]; run.lf += S.lf[f]; run.n++; }
            else close();
        }
        close();
        return ev;
    }

    // ---------------------------------------------------------------- ANALYSIS
    function analyze(channels, sr) {
        const out = { needed: false, kinds: [], params: null, reason: "", notes: [], noiseDb: null, snrDb: null };
        try {
            const m = mono(channels);
            if (m.length < sr * 1.2) return out;
            const S = spectra(m, sr);
            if (S.frames < 12) return out;
            const vm = voiceMask(S.lvl, sr);
            const gapIdx = []; for (let f = 0; f < S.frames; f++) if (!vm.guard[f]) gapIdx.push(f);
            const singN = vm.sing.reduce((a, b) => a + b, 0);
            if (singN < 4) return out;                                    // nothing sung: leave the take alone

            // noise floor: the quiet end of the gaps, or (if there are no real gaps) the quietest frames overall
            const gapLvl = gapIdx.map((f) => S.lvl[f]);
            const haveGaps = gapIdx.length >= 6;
            const floorDb = haveGaps ? pct(gapLvl, 0.2) : pct(Array.from(S.lvl), 0.08);
            const singDb = med(Array.from(S.lvl).filter((v, f) => vm.sing[f]));
            out.noiseDb = floorDb; out.snrDb = singDb - floorDb;

            // --- what do the gaps look like?
            const tail = haveGaps ? gapIdx : Array.from(S.lvl.keys()).filter((f) => S.lvl[f] <= pct(Array.from(S.lvl), 0.25));
            const gStd = std(tail.map((f) => S.lvl[f]));                  // how much the quiet parts move: steady noise barely moves
            const gLf = med(tail.map((f) => S.lf[f])), gMid = med(tail.map((f) => S.mid[f])), gHf = med(tail.map((f) => S.hf[f]));
            const lfShare = gLf - Math.max(gMid, gHf);                    // > 0: the noise lives below 200 Hz
            const lfStd = std(tail.map((f) => S.lf[f]));
            const lfHi = pct(tail.map((f) => S.lf[f]), 0.9), lfLo = pct(tail.map((f) => S.lf[f]), 0.2);
            const lfGust = lfHi - lfLo, lfHiShare = lfHi - Math.max(pct(tail.map((f) => S.mid[f]), 0.9), pct(tail.map((f) => S.hf[f]), 0.9));   // gusts: low end swings by many dB and leads
            // tonal (hum, whine): one bin far above its neighbours in the average gap spectrum
            const avg = new Float64Array(BINS); tail.forEach((f) => { for (let k = 0; k < BINS; k++) avg[k] += S.P[f][k] / tail.length; });
            let tonal = 0, tonalHz = 0;
            for (let k = 6; k < BINS - 6; k++) {
                let nb = 0; for (let d = 3; d <= 6; d++) nb += avg[k - d] + avg[k + d]; nb /= 8;
                const r = dbP(avg[k]) - dbP(nb + 1e-20);
                if (r > tonal && k * sr / N < 2500) { tonal = r; tonalHz = k * sr / N; }
            }

            // --- sudden noises in the gaps
            const ev = findEvents(S, vm, floorDb, sr), hop = HOP / sr;
            const evSec = ev.reduce((s, e) => s + (e.b - e.a + 1) * hop, 0), gapSec = gapIdx.length * hop;
            const evMid = ev.filter((e) => e.mid / e.n >= e.lf / e.n - 3);   // voices, horns, dogs live in the mids; thumps and wind in the lows

            const kinds = [];
            // steady noise
            const gusty = lfGust > 6 && lfHiShare > 3 && lfHi > -58;
            if (floorDb > -55 && out.snrDb < 40 && (gStd < 4.5 || !haveGaps) && !gusty) {
                const what = tonal > 14 ? "a steady hum or whine (" + Math.round(tonalHz) + " Hz: a fan, fridge or mains hum)"
                    : lfShare > 6 ? "a low steady rumble (a fan, air-con, engine or road noise)"
                    : gHf > gMid - 3 ? "steady hiss"
                    : "a steady background noise (a fan or air-con)";
                kinds.push({ kind: "steady", text: "Heard " + what + " about " + Math.round(out.snrDb) + " dB under your voice.", strength: clamp((floorDb + 64) / 22, 0.15, 1) });
            }
            // wind and handling
            if (gusty) {
                kinds.push({ kind: "wind", text: "Heard low rumbles that come and go (wind on the mic, handling or traffic thumps).", strength: clamp((lfGust - 4) / 10 + (lfHi + 58) / 20, 0.3, 1) });
            }
            // shouts, horns, cars between lines
            if (ev.length && evSec / Math.max(gapSec, 1) > 0.02 && evMid.length) {
                kinds.push({ kind: "events", text: "Heard " + evMid.length + " sudden noise" + (evMid.length > 1 ? "s" : "") + " between lines (shouting, a horn, a dog or a car going by).", strength: clamp(evSec / Math.max(gapSec, 1) * 2 + 0.3, 0.3, 1) });
            }
            out.kinds = kinds;
            out.stats = { floorDb, singDb, gStd, lfShare, lfStd, lfGust, lfHiShare, tonal, tonalHz, events: ev.length, gapSec, haveGaps };

            if (!kinds.length) { out.reason = "The background is clean (noise floor about " + Math.round(floorDb) + " dBFS), so nothing was cleaned."; return out; }

            const has = (k) => kinds.find((x) => x.kind === k);
            const st = has("steady"), wd = has("wind"), ev1 = has("events");
            out.needed = true;
            out.params = {
                steady: st ? Math.round(clamp(8 + st.strength * 10, 8, 18)) : (wd || ev1 ? 6 : 0),   // dB of reduction ceiling for steady noise
                wind: wd ? Math.round(wd.strength * 100) : 0,
                events: ev1 ? Math.round(clamp(10 + ev1.strength * 14, 10, 24)) : 0,                  // dB the sudden noises are lowered by, between lines
                hum: tonal > 14 ? Math.round(tonalHz) : 0
            };
            // The reduction in the steady step is kept moderate on purpose: strong subtraction makes the voice sound watery
            out.reason = kinds.map((k) => k.text).join(" ") + " " +
                (out.params.steady ? "Steady noise is lowered by up to " + out.params.steady + " dB. " : "") +
                (out.params.wind ? "The low cut closes only while the rumble is there. " : "") +
                (out.params.events ? "Sudden noises between lines are lowered by " + out.params.events + " dB. " : "") +
                (ev1 || wd ? "Anything that happens at the same moment as your singing can only be reduced a little, not removed." : "");
            out.reason = out.reason.trim();
        } catch (e) { console.warn("VLClean.analyze", e); }
        return out;
    }

    // ---------------------------------------------------------------- THE PLUGIN
    function process(ch, sr, p) {
        const n = ch[0].length;
        const copyOut = () => ch.map((c) => Float32Array.from(c));
        if (!(p.steady > 0 || p.wind > 0 || p.events > 0) || n < N * 4) return { channels: copyOut(), info: { skipped: "nothing to clean" } };

        const m = mono(ch);
        const S = spectra(m, sr), F = S.frames;
        if (F < 8) return { channels: copyOut(), info: { skipped: "too short" } };
        const vm = voiceMask(S.lvl, sr);

        // ---- 1. noise spectrum that follows the recording. Windows of about 1.5 s: the gaps inside each window are averaged;
        //         if a window has no gaps, the quiet 20% of its frames are used (minimum statistics).
        const winF = Math.max(8, Math.round(1.5 * sr / HOP)), stepF = Math.max(2, Math.round(0.4 * sr / HOP));
        const centres = [], profiles = [];
        for (let c0 = 0; c0 < F + stepF; c0 += stepF) {
            const a = Math.max(0, c0 - winF), b = Math.min(F - 1, c0 + winF);
            let idx = []; for (let f = a; f <= b; f++) if (!vm.guard[f]) idx.push(f);
            let bias = 1.0;
            if (idx.length < 4) {
                const order = []; for (let f = a; f <= b; f++) order.push(f);
                order.sort((x, y) => S.lvl[x] - S.lvl[y]);
                idx = order.slice(0, Math.max(4, Math.floor(order.length * 0.2))); bias = 1.6;     // the quiet end under-estimates the average
            }
            const prof = new Float64Array(BINS);
            // events in the gaps are not "the noise": use the quiet half of the gap frames so a shout does not become the profile
            idx.sort((x, y) => S.lvl[x] - S.lvl[y]);
            const use = idx.slice(0, Math.max(3, Math.ceil(idx.length * 0.6)));
            use.forEach((f) => { for (let k = 0; k < BINS; k++) prof[k] += S.P[f][k] / use.length; });
            for (let k = 0; k < BINS; k++) prof[k] *= bias;
            const sm = new Float64Array(BINS);
            for (let k = 0; k < BINS; k++) { let s = 0, c = 0; for (let d = -2; d <= 2; d++) { const j = k + d; if (j >= 0 && j < BINS) { s += prof[j]; c++; } } sm[k] = s / c; }
            centres.push(Math.min(c0, F - 1)); profiles.push(sm);
            if (c0 >= F - 1) break;
        }
        const noiseAt = (f, k) => {                                      // interpolate between the two nearest profiles
            let i = 0; while (i < centres.length - 2 && centres[i + 1] <= f) i++;
            const a = centres[i], b = centres[Math.min(i + 1, centres.length - 1)];
            const t = b > a ? clamp((f - a) / (b - a), 0, 1) : 0;
            return profiles[i][k] * (1 - t) + profiles[Math.min(i + 1, profiles.length - 1)][k] * t;
        };

        // ---- 2. wind: how strongly each frame looks like rumble that is not the voice
        const lfRef = med(Array.from(S.lf).filter((v, f) => vm.sing[f])) - med(Array.from(S.mid).filter((v, f) => vm.sing[f]));   // normal low-to-mid balance of this voice
        const windAmt = new Float32Array(F);
        if (p.wind > 0) for (let f = 0; f < F; f++) {
            const excess = (S.lf[f] - S.mid[f]) - lfRef;                // dB more low end than the voice normally has
            windAmt[f] = clamp((excess - 3) / 9, 0, 1) * (p.wind / 100);
        }
        // spread it a little in time so the cut does not flutter
        for (let pass = 0; pass < 2; pass++) for (let f = 1; f < F - 1; f++) windAmt[f] = Math.max(windAmt[f], 0.6 * Math.max(windAmt[f - 1], windAmt[f + 1]));
        const hz = sr / N, kcut = Math.round(150 / hz);

        // ---- 3. gains per frame: Wiener filter with a decision-directed a priori SNR (this is what keeps the leftover noise from "twinkling")
        const floorG = Math.pow(10, -Math.max(0, p.steady) / 20), floorSing = Math.pow(10, -0.55 * Math.max(0, p.steady) / 20);   // while singing the voice masks the noise, so cut less
        const G = new Array(F), prevG = new Float64Array(BINS).fill(1), prevSnr = new Float64Array(BINS);
        const beta = 0.94;
        for (let f = 0; f < F; f++) {
            const g = new Float32Array(BINS), P = S.P[f];
            for (let k = 0; k < BINS; k++) {
                if (p.steady > 0) {
                    const nz = noiseAt(f, k) * 1.05 + 1e-20;
                    const gamma = P[k] / nz;
                    const xi = Math.max(beta * prevSnr[k] + (1 - beta) * Math.max(gamma - 1, 0), 0.02);
                    g[k] = Math.max(vm.sing[f] ? floorSing : floorG, xi / (1 + xi));
                    prevSnr[k] = g[k] * g[k] * gamma;
                } else g[k] = 1;
            }
            // across frequency: light smoothing, never above the neighbours' average by much
            // across frequency: widen the open bands a little so the skirts of every harmonic pass (smoothing by averaging would dull the voice)
            const gs = new Float32Array(BINS);
            for (let k = 0; k < BINS; k++) { const a0 = g[k > 0 ? k - 1 : k], a2 = g[k < BINS - 1 ? k + 1 : k], a3 = g[k > 1 ? k - 2 : k], a4 = g[k < BINS - 2 ? k + 2 : k]; gs[k] = 0.5 * g[k] + 0.35 * Math.max(g[k], a0, a2) + 0.15 * Math.max(g[k], a0, a2, a3, a4); }
            // over time: opens fast (word starts), closes slowly (no pumping)
            for (let k = 0; k < BINS; k++) { gs[k] = gs[k] >= prevG[k] ? 0.7 * gs[k] + 0.3 * prevG[k] : 0.8 * prevG[k] + 0.2 * gs[k]; prevG[k] = gs[k]; }
            // wind: close the low cut by how much rumble this frame has
            const w = windAmt[f];
            if (w > 0.01) for (let k = 0; k < kcut * 2 && k < BINS; k++) {
                const fr = Math.max(k, 0.5) * hz, hp = 1 / (1 + Math.pow(150 / Math.max(fr, 1), 4));      // 150 Hz low cut, 4th order
                gs[k] *= 1 - w * (1 - hp);
            }
            G[f] = gs;
        }

        // ---- 4. rebuild each channel with the same gains
        const outCh = [];
        const wsum = new Float32Array(n);
        for (let f = 0; f < F; f++) for (let i = 0; i < N; i++) wsum[f * HOP + i] += WIN[i] * WIN[i];
        for (const x of ch) {
            const out = new Float32Array(n), re = new Float64Array(N), im = new Float64Array(N), fft = fftFor(N);
            for (let f = 0; f < F; f++) {
                for (let i = 0; i < N; i++) { re[i] = x[f * HOP + i] * WIN[i]; im[i] = 0; }
                fft(re, im);
                const g = G[f];
                for (let k = 0; k < BINS; k++) { re[k] *= g[k]; im[k] *= g[k]; if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
                for (let i = 0; i < N; i++) im[i] = -im[i];
                fft(re, im);
                for (let i = 0; i < N; i++) out[f * HOP + i] += (re[i] / N) * WIN[i];
            }
            for (let i = 0; i < n; i++) out[i] = wsum[i] > 0.05 ? out[i] / wsum[i] : x[i];      // the ends that no full frame covers stay as they were
            outCh.push(out);
        }

        // ---- 5. sudden noises between the lines: only the stretches found by findEvents() are lowered (smoothly, with a few ms look-ahead)
        if (p.events > 0) {
            const gapLvl = []; for (let f = 0; f < F; f++) if (!vm.guard[f]) gapLvl.push(S.lvl[f]);
            const floorDb = gapLvl.length >= 6 ? pct(gapLvl, 0.2) : pct(Array.from(S.lvl), 0.08);
            const runs = findEvents(S, vm, floorDb, sr);
            if (runs.length) {
                const want = new Float32Array(n).fill(1), reduce = Math.pow(10, -p.events / 20), pad = Math.round(0.05 * sr);
                runs.forEach((r) => { const a = Math.max(0, r.a * HOP - pad), b = Math.min(n, (r.b + 1) * HOP + N / 2 + pad); for (let i = a; i < b; i++) want[i] = reduce; });
                const att = Math.exp(-1 / (0.012 * sr)), rel = Math.exp(-1 / (0.06 * sr));
                const g = new Float32Array(n); let cur = 1;
                for (let i = 0; i < n; i++) { cur = want[i] < cur ? att * cur + (1 - att) * want[i] : rel * cur + (1 - rel) * want[i]; g[i] = cur; }
                const la = Math.round(0.012 * sr);
                for (const o of outCh) for (let i = 0; i < n; i++) o[i] *= g[Math.min(n - 1, i + la)];
            }
        }

        let sum = 0, cnt = 0; for (let f = 0; f < F; f += 3) { let a = 0; for (let k = 6; k < 300; k++) a += G[f][k]; sum += a / 294; cnt++; }
        return { channels: outCh, info: { avgGain: sum / Math.max(cnt, 1) } };
    }

    const R = (k, label, min, max, step, def, unit, extra) => Object.assign({ k, label, min, max, step, def, unit: unit || "", type: "range" }, extra || {});
    Fx.P.clean = {
        id: "clean", name: "VL Clean", cat: "Clean", icon: "p-clean",
        blurb: "Takes background noise out of the take: steady noise (fans, air-con, hiss), wind and rumble, and sudden noises like shouting or cars between the lines. Autopilot listens and sets it for you.",
        likeA: "Noise reduction / de-noiser",
        easy: ["steady", "wind", "events"],
        params: [
            R("steady", "Steady noise", 0, 24, 1, 0, " dB", { easyLabel: "Fans, hiss, steady noise (dB removed)" }),
            R("wind", "Wind and rumble", 0, 100, 1, 0, " %", { easyLabel: "Wind and rumble" }),
            R("events", "Sudden noises between lines", 0, 30, 1, 0, " dB", { easyLabel: "Shouting, cars, horns between lines" })
        ],
        presets: {
            "Default": {},
            "Fan or air-con": { steady: 14 },
            "Windy": { steady: 8, wind: 80 },
            "Street": { steady: 12, wind: 40, events: 18 },
            "Home (kids, doors)": { steady: 10, events: 20 }
        },
        process
    };
    // clean the take before anything else works on it (tuning would make noise louder)
    if (Fx.ORDER.indexOf("clean") === -1) Fx.ORDER.unshift("clean");

    root.VLClean = { analyze, process };
})(typeof window !== "undefined" ? window : this);
