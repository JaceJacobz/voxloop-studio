// =====================================================================
// Producer check: the finished, mastered mix listens to itself and fixes what is off.
//
// The old "listen pass" at the end of the Pipeline measured two things (a clipping peak and a very bright top end) and
// almost every mix passed both, so it nearly always said "no extra changes". This one measures what a producer listens for
// in a finished mix and compares it with THE BEAT THE SINGER WAS GIVEN (the beat is the best reference there is: the balance
// it had is the balance the finished song should keep, and a voice on top should not make the bass bigger):
//
//   1. Rumble:          energy under 22 Hz (nobody hears it, it eats headroom and makes small speakers flutter).
//   2. Boomy low end:   bass (40-120 Hz) against the body of the music (500 Hz-2 kHz), compared with the beat alone.
//   3. Muddy middle:    200-500 Hz against 500 Hz-2 kHz, compared with the beat alone.
//   4. Left / right:    one side louder than it was in the beat.
//
// How it works (cheap on purpose, a phone has to run it on a whole song):
//   - one pass measures the long-term spectrum of the parts that are playing. A voice on top adds body of its own and hides
//     bass problems (a sung song reads 2 to 6 dB less bassy than its beat even when nothing is wrong), so when the singer's
//     timeline is known the measuring is done ONLY WHERE THE VOICE IS NOT SINGING (intros, breaks, outros), on the mix and on
//     the beat alike: there the finished mix is the beat plus whatever the mixing and mastering did to it, so any difference is
//     the chain's doing. Without enough such parts it measures the whole song and allows a little more;
//   - the fixes are filters, and what a filter does to a long-term spectrum is known exactly, so the amount of cut that is
//     just enough is worked out from that one measurement (no copies of the song, no repeated measuring);
//   - the filters are then applied once, the mix is measured again to check, and a fix that did not help is taken back out.
// Every fix only CUTS (so it cannot push the master into clipping), is limited in size, and is explained in plain words,
// including the case where everything was fine.
//
// The limits come from the producer brain's picture of the song (VLMixBrain.review): a trap 808 is meant to carry more
// bass than an R&B ballad. No page and no audio context needed, so it is tested in Node.
// =====================================================================
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.VLMixReview = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const LIMITS = {
        rumbleAbsDb: -24,          // under-22-Hz energy against the whole mix; real mixes read -26 to -38
        rumbleOverBeatDb: 3,       // ...and this much more than the beat alone had
        lowOverBeatDb: 2.0,        // bass-against-body may grow this much over the beat where the voice is not singing (the master alone moves it by -0.2 to -0.4 dB)
        mudOverBeatDb: 2.0,        // low-mids against body, over the beat (the master alone moves it by 0.0 dB)
        lrOverBeatDb: 1.0,         // left/right level difference over what the beat had
        wholeSongLowSlackDb: 1.0,  // extra allowance for bass / low-mids when the voice could not be left out of the measuring
        wholeSongMudSlackDb: 2.0,  //   (a voice brings 2 to 3 dB of low-mid body of its own; it only ever LOWERS the bass-to-body ratio)
        minFreeFrames: 8,          // fewer voice-free frames than this (about 1.5 s of music): measure the whole song
        margin: 0.3,               // fixes aim this far inside the limit
        maxLowCutDb: 4.5,          // never more than this in total (shelf below 120 Hz)
        maxMudCutDb: 4.5,          // never more than this (dip around 320 Hz)
        ceilingDb: -1.2,           // sample-peak ceiling after the fixes
        makeupMaxDb: 1.0           // loudness lost to a fix may be given back, up to this
    };
    const N = 8192;

    // ---------- tiny maths ----------
    function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < len / 2; k++) {
                    const a = i + k, b = i + k + len / 2;
                    const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
                    const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
                }
            }
        }
    }
    const db10 = (x) => 10 * Math.log10(x + 1e-30);

    // ---------- RBJ filters ----------
    function coef(type, f, gainDb, q, sr) {
        const A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w0), sn = Math.sin(w0), al = sn / (2 * q);
        let b0, b1, b2, a0, a1, a2;
        if (type === "peaking") { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
        else if (type === "lowshelf") { const sq = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq); a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq; }
        else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }   // highpass
        return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    }
    function run(x, c) {
        const b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4];
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < x.length; i++) {
            const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
        }
    }
    // power response |H|^2 of one biquad at angular frequency w
    function power(c, w) {
        const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
        const nr = c[0] + c[1] * cw + c[2] * c2, ni = -(c[1] * sw + c[2] * s2);
        const dr = 1 + c[3] * cw + c[4] * c2, di = -(c[3] * sw + c[4] * s2);
        return (nr * nr + ni * ni) / (dr * dr + di * di);
    }
    // a "filter" here is { type, f, gainDb, q, times }; its coefficients are made on demand
    const mk = (type, f, gainDb, q, times) => ({ type, f, gainDb, q, times: times || 1 });
    const coefOf = (flt, sr) => coef(flt.type, flt.f, flt.gainDb, flt.q, sr);

    // ---------- measuring ----------
    // Long-term spectrum of the playing parts (frames within 30 dB of the loudest), mono sum, <= ~700 frames.
    function spectrum(channels, sr, keep) {
        const n = channels[0].length;
        if (n < N * 8) return null;
        const hop = Math.max(N, Math.floor(n / 700)), win = new Float64Array(N), nc = channels.length;
        for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
        const starts = [], pows = []; let mx = 0;
        for (let s = 0; s + N <= n; s += hop) {
            if (keep && !keep(s)) continue;
            let p = 0;
            for (let c = 0; c < nc; c++) { const x = channels[c]; for (let i = 0; i < N; i += 4) p += x[s + i] * x[s + i]; }
            p /= (N / 4) * nc; starts.push(s); pows.push(p); if (p > mx) mx = p;
        }
        const re = new Float64Array(N), im = new Float64Array(N), acc = new Float64Array(N / 2);
        let used = 0, el = 0, er = 0, esum = 0, ecount = 0;
        for (let f = 0; f < starts.length; f++) {
            if (pows[f] < mx * 1e-3 || pows[f] < 1e-10) continue;
            const s = starts[f];
            for (let i = 0; i < N; i++) { let v = 0; for (let c = 0; c < nc; c++) v += channels[c][s + i]; re[i] = (v / nc) * win[i]; im[i] = 0; }
            fft(re, im);
            for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
            if (nc > 1) for (let i = 0; i < N; i += 2) { el += channels[0][s + i] * channels[0][s + i]; er += channels[1][s + i] * channels[1][s + i]; }
            for (let c = 0; c < nc; c++) for (let i = 0; i < N; i += 2) { esum += channels[c][s + i] * channels[c][s + i]; ecount++; }
            used++;
        }
        if (used < 6) return null;
        return { acc, sr, frames: used, lrDb: nc > 1 && el > 0 && er > 0 ? db10(el / er) : 0, rms: Math.sqrt(esum / Math.max(1, ecount)) };
    }
    // band levels of a spectrum, optionally as it WOULD be after some filters
    function bands(spec, filters, sr) {
        const acc = spec.acc, fs = spec.sr, list = (filters || []).map((f) => ({ c: coefOf(f, sr || fs), times: f.times }));
        const E = (a, b) => {
            let t = 0;
            for (let k = Math.max(1, Math.ceil(a * N / fs)); k < Math.min(N / 2, Math.ceil(b * N / fs)); k++) {
                let g = 1;
                for (const f of list) g *= Math.pow(power(f.c, 2 * Math.PI * k / N), f.times);
                t += acc[k] * g;
            }
            return t;
        };
        const tot = E(10, 20000), body = E(500, 2000);
        return { rumbleDb: db10(E(10, 22) / tot), lowDb: db10(E(40, 120) / body), mudDb: db10(E(200, 500) / body) };
    }
    function peakOf(channels) { let p = 0; for (const x of channels) for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > p) p = a; } return p; }
    const toDb = (v) => v > 0 ? 20 * Math.log10(v) : -120;
    function measure(channels, sr, keep) {
        const sp = spectrum(channels, sr, keep);
        if (!sp) return null;
        return Object.assign({ lrDb: sp.lrDb, rms: sp.rms, frames: sp.frames, spec: sp }, bands(sp, [], sr));
    }

    // Where is the voice singing? Cells of 0.1 s on the song's timeline (the vocal starts `offsetSec` into the beat), with the
    // reverb/echo tail (1.5 s) and a moment before counted as "voice present". Quiet breaths and noise do not count: a cell
    // is "present" when it is within 30 dB of the vocal's own typical (90th percentile) level.
    function activityMap(vchannels, sr, offsetSec, totalSec) {
        const cell = 0.1, cs = Math.max(1, Math.round(sr * cell)), nCells = Math.ceil(totalSec / cell) + 2;
        const vc = Math.floor(vchannels[0].length / cs), pw = new Float64Array(vc);
        for (let k = 0; k < vc; k++) { let p = 0; for (const x of vchannels) for (let i = k * cs; i < (k + 1) * cs; i += 3) p += x[i] * x[i]; pw[k] = p; }
        const sorted = Float64Array.from(pw).sort(), nz = sorted.filter((v) => v > 1e-12);
        const p90 = nz.length ? nz[Math.floor(nz.length * 0.9)] : 0, thr = p90 * 1e-3;
        const act = new Uint8Array(nCells), shift = Math.round((offsetSec || 0) / cell), hold = Math.round(1.5 / cell), lead = Math.round(0.2 / cell);
        let on = 0;
        for (let k = 0; k < vc; k++) {
            if (!(pw[k] > thr) || thr <= 0) continue;
            const j = k + shift;
            for (let m = Math.max(0, j - lead); m <= Math.min(nCells - 1, j + hold); m++) act[m] = 1;
        }
        for (let m = 0; m < nCells; m++) on += act[m];
        return { cell, act, singingShare: on / nCells };
    }
    function freeOfVoice(map, sr) {
        return (start) => {
            const a = Math.floor(start / sr / map.cell), b = Math.floor((start + N) / sr / map.cell);
            for (let m = Math.max(0, a); m <= b && m < map.act.length; m++) if (map.act[m]) return false;
            return true;
        };
    }

    // the smallest cut (0.25 dB steps, up to the cap) that brings value(filters with that cut) to the goal
    function smallestCut(make, value, goal, cap) {
        let best = 0;
        for (let cut = 0.5; cut <= cap + 1e-9; cut += 0.25) { best = cut; if (value(make(cut)) <= goal) break; }
        return best;
    }

    /**
     * @param channels   the finished mix (changed IN PLACE when something is fixed)
     * @param sr         sample rate
     * @param opts       { reference: the beat's channels, referenceSr, limits: { lowOverBeatDb, mudOverBeatDb, ... } }
     * @returns { fixes, lines, heard }
     */
    function review(channels, sr, opts) {
        const o = opts || {}, lines = [], plan = [];
        const L = Object.assign({}, LIMITS, o.limits || {});
        const haveRef = !!(o.reference && o.reference[0] && o.reference[0].length);
        // measure only where the voice is not singing, when there is enough of that and the beat is at the same rate
        let keep = null, mix = null, ref = null, masked = false;
        if (haveRef && o.activity && Math.abs((o.referenceSr || sr) - sr) < 1) {
            const k = freeOfVoice(o.activity, sr), m2 = measure(channels, sr, k), r2 = m2 ? measure(o.reference, sr, k) : null;
            if (m2 && r2 && m2.frames >= L.minFreeFrames && r2.frames >= L.minFreeFrames) { keep = k; mix = m2; ref = r2; masked = true; }
        }
        if (!mix) {
            mix = measure(channels, sr);
            if (!mix) return { fixes: plan, lines: ["Producer check: the mix is too short to judge, so it was left as it is."], heard: null };
            ref = haveRef ? measure(o.reference, o.referenceSr || sr) : null;
            if (ref) { L.lowOverBeatDb += L.wholeSongLowSlackDb; L.mudOverBeatDb += L.wholeSongMudSlackDb; }
        }
        const heard = { before: mix, beat: ref, masked, limits: { low: L.lowOverBeatDb, mud: L.mudOverBeatDb, lr: L.lrOverBeatDb }, after: null };
        const filters = [];
        const lowExcess = (b) => ref ? b.lowDb - ref.lowDb : 0, mudExcess = (b) => ref ? b.mudDb - ref.mudDb : 0;
        const preLow = lowExcess(mix), preMud = mudExcess(mix);

        // 1. rumble (a steep high-pass; 24 dB per octave at 22 Hz leaves the kick alone)
        if (mix.rumbleDb > L.rumbleAbsDb && (!ref || mix.rumbleDb > ref.rumbleDb + L.rumbleOverBeatDb)) { filters.push(mk("highpass", 22, 0, 0.707, 2)); plan.push("rumble"); }

        // 2. muddy middle, against the beat (a dip around 320 Hz). Planned BEFORE the bass: the dip also lowers the body of the music
        //    that the bass is measured against, so the bass is planned knowing about it.
        let mudCut = 0;
        if (ref && preMud > L.mudOverBeatDb) {
            mudCut = smallestCut((c) => filters.concat([mk("peaking", 320, -c, 0.8)]), (fl) => mudExcess(bands(mix.spec, fl, sr)), L.mudOverBeatDb - L.margin, L.maxMudCutDb);
            filters.push(mk("peaking", 320, -mudCut, 0.8)); plan.push("mud");
        }

        // 3. boomy low end, against the beat (a gentle shelf below 120 Hz)
        let lowCut = 0;
        if (ref && lowExcess(bands(mix.spec, filters, sr)) > L.lowOverBeatDb) {
            lowCut = smallestCut((c) => filters.concat([mk("lowshelf", 120, -c, 0.707)]), (fl) => lowExcess(bands(mix.spec, fl, sr)), L.lowOverBeatDb - L.margin, L.maxLowCutDb);
            filters.push(mk("lowshelf", 120, -lowCut, 0.707)); plan.push("low");
        }
        const predicted = ref ? bands(mix.spec, filters, sr) : null;      // what the filters should give, to check the result against

        // apply once, in place
        for (const f of filters) { const c = coefOf(f, sr); for (let t = 0; t < f.times; t++) for (const x of channels) run(x, c); }

        // 4. left / right, against the beat: spread the correction over both sides (the louder one down, the quieter one up)
        const lrGap = mix.lrDb - (ref ? ref.lrDb : 0);
        let lrDone = null;
        if (channels.length > 1 && Math.abs(lrGap) > L.lrOverBeatDb) {
            const half = Math.abs(lrGap) / 2, loud = lrGap > 0 ? 0 : 1, quiet = 1 - loud;
            const down = Math.pow(10, -half / 20), up = Math.pow(10, half / 20);
            const upOk = toDb(peakOf([channels[quiet]]) * up) <= L.ceilingDb;
            const xl = channels[loud], xq = channels[quiet], kd = upOk ? down : down * down;
            for (let i = 0; i < xl.length; i++) xl[i] *= kd;
            if (upOk) for (let i = 0; i < xq.length; i++) xq[i] *= up;
            lrDone = { side: loud === 0 ? "left" : "right", gap: Math.abs(lrGap) };
            plan.push("balance");
        }

        // check by measuring again; take back a fix that did not help (peaking and shelves undo exactly with the opposite gain)
        let after = plan.length ? measure(channels, sr, keep) : mix;
        if (after && ref && plan.length) {
            const undo = (flt) => { const c = coef(flt.type, flt.f, -flt.gainDb, flt.q, sr); for (const x of channels) run(x, c); };
            const lowF = filters.find((f) => f.type === "lowshelf"), mudF = filters.find((f) => f.type === "peaking");
            let changed = false;
            if (lowF && lowExcess(after) > lowExcess(predicted) + 0.7) { undo(lowF); plan.splice(plan.indexOf("low"), 1); lowCut = 0; changed = true; }
            if (mudF && mudExcess(after) > mudExcess(predicted) + 0.7) { undo(mudF); plan.splice(plan.indexOf("mud"), 1); mudCut = 0; changed = true; }
            if (changed) after = measure(channels, sr, keep) || after;
        }
        after = after || mix;

        // loudness: a cut makes the song a little quieter; give back what was lost, only as far as the ceiling and +1 dB allow
        let makeup = 0;
        if (plan.length && after.rms > 0 && mix.rms > 0) {
            const lost = toDb(mix.rms) - toDb(after.rms), head = L.ceilingDb - toDb(peakOf(channels));
            makeup = Math.max(0, Math.min(lost, L.makeupMaxDb, head));
            if (makeup >= 0.15) { const k = Math.pow(10, makeup / 20); for (const x of channels) for (let i = 0; i < x.length; i++) x[i] *= k; } else makeup = 0;
            const pk = toDb(peakOf(channels));
            if (pk > L.ceilingDb) { const k = Math.pow(10, (L.ceilingDb - pk) / 20); for (const x of channels) for (let i = 0; i < x.length; i++) x[i] *= k; }
        }

        // ---- the plain-language report ----
        const sgn = (v) => (v >= 0 ? "+" : "") + v.toFixed(1);
        const where = masked ? " (measured where you are not singing, so the voice cannot hide it)" : "";
        if (plan.includes("rumble")) lines.push(`Producer check: sub-bass rumble under 22 Hz was ${mix.rumbleDb.toFixed(0)} dB against the whole mix (a clean mix reads below ${L.rumbleAbsDb} dB). Cut everything under 22 Hz, which nobody hears but which uses up headroom (now ${after.rumbleDb.toFixed(0)} dB).`);
        if (plan.includes("low")) lines.push(`Producer check: the finished mix had ${sgn(preLow)} dB more bass than your beat did${where}. About ${L.lowOverBeatDb} dB is the most the mixing and mastering should add; more sounds boomy and crowds the voice. Eased the bass below 120 Hz by ${lowCut.toFixed(1)} dB; it is now ${sgn(lowExcess(after))} dB against the beat.${lowExcess(after) > L.lowOverBeatDb + 0.3 ? " That is as far as it is safe to go without thinning the kick, so the rest was left." : ""}`);
        if (plan.includes("mud")) lines.push(`Producer check: the low-mids (200-500 Hz) were ${sgn(preMud)} dB heavier against the body of the music than in your beat${where}, which sounds boxy and muddy. Up to ${L.mudOverBeatDb} dB is allowed. Took ${mudCut.toFixed(1)} dB out around 320 Hz; now ${sgn(mudExcess(after))} dB.${mudExcess(after) > L.mudOverBeatDb + 0.3 ? " That is as far as it is safe to go without thinning the voice, so the rest was left." : ""}`);
        if (lrDone) lines.push(`Producer check: the ${lrDone.side} side was ${lrDone.gap.toFixed(1)} dB louder than it was in your beat, so the song leaned to one side. Evened it out (now ${Math.abs(after.lrDb - (ref ? ref.lrDb : 0)).toFixed(1)} dB).`);
        if (plan.length && makeup > 0) lines.push(`Producer check: gave back ${makeup.toFixed(1)} dB of the loudness the fixes took away.`);
        if (!plan.length) {
            const bits = [];
            if (ref) { bits.push(`bass ${sgn(preLow)} dB against your beat${masked ? " where you are not singing" : ""} (limit +${L.lowOverBeatDb})`); bits.push(`low-mids ${sgn(preMud)} dB (limit +${L.mudOverBeatDb})`); }
            bits.push(`rumble ${mix.rumbleDb.toFixed(0)} dB`);
            if (channels.length > 1) bits.push(`left/right ${Math.abs(lrGap).toFixed(1)} dB off the beat`);
            lines.push("Producer check after mastering: " + bits.join(", ") + ". All inside the limits, so nothing needed fixing.");
        }
        heard.after = after; heard.makeupDb = makeup;
        delete mix.spec; if (ref) delete ref.spec; if (after) delete after.spec;
        return { fixes: plan, lines, heard };
    }

    return { LIMITS, measure, review, coef, run, spectrum, bands, activityMap };
});
