/**
 * Voxloop — Autopilot decisions
 *
 * Pure functions (no DOM, no Web Audio) that turn what Voxloop heard into the settings a person used to choose by hand.
 * Every decision returns { ...settings, why: ["plain-language reason", ...] } so the Autopilot can show what it chose and why.
 *
 *   alignDecision   where the vocal belongs against the beat. The old "Auto-align" matched the first sound in each file,
 *                   which is only right when both files happen to start together. This compares the vocal's RHYTHM with
 *                   the beat's RHYTHM (cross-correlating their onset curves), so it also fixes recording latency.
 *   cleanDecision   noise clean-up / speed match / timing tighten
 *   tuneDecision    how hard to tune: a rap is left alone, a sung line is tuned
 *   mixDecision     polish, balance, instrument balance, harmony, beat enhance
 *
 * Runs in the page (window.AutoDecide) and in Node (tests/).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.AutoDecide = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const HOP = 0.01;                                   // 10 ms analysis step

    // ------------------------------------------------------------------ onset curve: how much new sound starts, every 10 ms
    function onsetCurve(x, sr, maxSec) {
        const n = Math.min(x.length, Math.floor((maxSec || 90) * sr)), blk = Math.round(HOP * sr), m = Math.floor(n / blk);
        const lev = new Float32Array(m);
        for (let b = 0; b < m; b++) { let s = 0; const a = b * blk; for (let i = a; i < a + blk; i++) s += x[i] * x[i]; lev[b] = Math.sqrt(s / blk); }
        // compress (so a loud kick does not hide everything else), then keep only the rises
        const c = new Float32Array(m); for (let i = 0; i < m; i++) c[i] = Math.pow(lev[i], 0.5);
        const flux = new Float32Array(m);
        for (let i = 1; i < m; i++) flux[i] = Math.max(0, c[i] - c[i - 1]);
        // take away the slow trend (a moving average about 0.4 s wide) so only the sharp starts remain
        const W = 20, out = new Float32Array(m); let acc = 0;
        const pre = new Float64Array(m + 1); for (let i = 0; i < m; i++) pre[i + 1] = pre[i] + flux[i];
        for (let i = 0; i < m; i++) { const a = Math.max(0, i - W), b = Math.min(m, i + W + 1); acc = (pre[b] - pre[a]) / (b - a); out[i] = Math.max(0, flux[i] - acc); }
        let nrm = 0; for (let i = 0; i < m; i++) nrm += out[i] * out[i];
        nrm = Math.sqrt(nrm) || 1; for (let i = 0; i < m; i++) out[i] /= nrm;
        return { env: out, level: lev, hopSec: blk / sr };
    }
    function monoOf(ch) {
        if (!ch.length) return new Float32Array(0);
        if (ch.length === 1) return ch[0];
        const o = new Float32Array(ch[0].length); for (const c of ch) for (let i = 0; i < o.length; i++) o[i] += c[i] / ch.length; return o;
    }
    function firstSound(lev, hopSec) {
        let pk = 0; for (let i = 0; i < lev.length; i++) if (lev[i] > pk) pk = lev[i];
        const thr = Math.max(pk * 0.06, 1e-4);
        for (let i = 0; i < lev.length; i++) if (lev[i] >= thr) return i * hopSec;
        return 0;
    }
    // correlation between the beat's curve and the vocal's curve moved `lag` steps later (positive lag = vocal later)
    function corrAt(b, v, lag) {
        let s = 0;
        const i0 = Math.max(0, lag), i1 = Math.min(b.length, v.length + lag);
        for (let i = i0; i < i1; i++) s += b[i] * v[i - lag];
        return s;
    }
    function bestNear(b, v, centre, span) {
        let best = -1, bl = centre; const vals = [];
        for (let l = centre - span; l <= centre + span; l++) { const c = corrAt(b, v, l); vals.push(c); if (c > best) { best = c; bl = l; } }
        const i = bl - (centre - span), y0 = vals[i - 1], y1 = vals[i], y2 = vals[i + 1];
        let frac = 0; if (y0 != null && y2 != null) { const d = y0 - 2 * y1 + y2; if (d < 0) frac = clamp(0.5 * (y0 - y2) / d, -0.5, 0.5); }
        const mean = vals.reduce((a, c) => a + c, 0) / vals.length;
        return { lag: bl + frac, score: best, distinct: mean > 1e-9 ? best / mean : 1 };
    }

    // Squash an onset curve into coarser steps (sum of squares per bin) and make it unit length again, for a fast wide search.
    function coarsen(env, f) {
        const m = Math.floor(env.length / f), o = new Float32Array(m);
        let n = 0;
        for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < f; k++) s += env[i * f + k]; o[i] = s; n += s * s; }
        n = Math.sqrt(n) || 1; for (let i = 0; i < m; i++) o[i] /= n;
        return o;
    }
    // Wide search: how well does the vocal's rhythm match the beat's at every shift from lo to hi (in coarse steps)?
    function wideSearch(bC, vC, lo, hi) {
        const vals = new Float32Array(hi - lo + 1);
        for (let l = lo; l <= hi; l++) vals[l - lo] = corrAt(bC, vC, l);
        return vals;
    }

    /**
     * Where does the vocal belong against the beat?  offsetSec > 0 means the vocal starts later.
     *
     * What changed (the old version could put a vocal several seconds LATE):
     *  - it only looked +-0.18 s around two guesses; a wrong "first sounds" guess (a beat with a quiet intro, a vocal with a long
     *    lead-in) was never questioned. Now the whole range (up to +-30 s) is searched, coarse first, then refined to 10 ms.
     *  - big moves need big evidence. A shift of more than a quarter second must beat "as recorded" clearly, otherwise the vocal stays put.
     *  - when there is no clear rhythm it is left where it was recorded. It is only moved for a latency-sized gap (<= 250 ms).
     *  - the vocal is never moved so far earlier that the start of the singing would be cut off.
     */
    // how many distinct sound starts per second the vocal has: a rap or a lyric has several, held notes and a drone have almost none
    function onsetRate(env, hopSec) {
        let mx = 0; for (let i = 0; i < env.length; i++) if (env[i] > mx) mx = env[i];
        let c = 0, last = -99;
        for (let i = 1; i < env.length - 1; i++) if (env[i] >= 0.2 * mx && env[i] >= env[i - 1] && env[i] >= env[i + 1] && i - last >= 8) { c++; last = i; }
        return { count: c, perSec: c / Math.max(1, env.length * hopSec) };
    }
    function alignDecision(vocalCh, vsr, beatCh, bsr, o) {
        o = o || {};
        const V = onsetCurve(monoOf(vocalCh), vsr, 90), B = onsetCurve(monoOf(beatCh), bsr, 150);
        const vStart = firstSound(V.level, V.hopSec), bStart = firstSound(B.level, B.hopSec);
        const firstOffset = bStart - vStart;
        const why = [];
        if (V.env.length < 200 || B.env.length < 200) {
            const off = firstOffset > 0 && firstOffset <= 0.25 ? firstOffset : 0;
            return { offsetSec: off, confidence: 0.2, method: "first sound", why: ["Too little audio to compare rhythms, so the vocal was left where it was recorded."] };
        }
        const maxShift = o.maxShiftSec || 30;
        const F = 4;                                                                // coarse step = 40 ms
        const vC = coarsen(V.env, F), bC = coarsen(B.env, F);
        const lo = -Math.min(Math.round(maxShift / (HOP * F)), vC.length - 20), hi = Math.min(Math.round(maxShift / (HOP * F)), bC.length - 20);
        const vals = wideSearch(bC, vC, lo, hi);
        let mean = 0; for (let i = 0; i < vals.length; i++) mean += Math.max(0, vals[i]); mean /= vals.length;
        // the best few peaks, with a mild preference for staying near where it was recorded (a rhythm repeats every beat and bar,
        // so several shifts look alike; the nearest one is the safest)
        const peaks = [];
        for (let i = 1; i < vals.length - 1; i++) if (vals[i] >= vals[i - 1] && vals[i] >= vals[i + 1] && vals[i] > 0) peaks.push({ lag: lo + i, v: vals[i] });
        peaks.forEach((p) => { p.w = p.v * Math.exp(-Math.abs(p.lag * HOP * F) / 25); });
        peaks.sort((a, b) => b.w - a.w);
        const span = Math.round((o.searchSec || 0.18) / HOP);
        const cands = [{ name: "as recorded", centre: 0 }];
        let maxVal = 0; for (let i = 0; i < vals.length; i++) if (vals[i] > maxVal) maxVal = vals[i];
        // does the rhythm search score well (>= 60% of its best) within ~80 ms of this shift?
        const nearGlobalBest = (sec) => { const c = Math.round(sec / (HOP * F)); let m = 0; for (let l = c - 2; l <= c + 2; l++) { const i = l - lo; if (i >= 0 && i < vals.length && vals[i] > m) m = vals[i]; } return m >= 0.6 * maxVal; };
        // the first-sound reading is a second, independent cue: it only counts when the rhythm search lands in the same place
        if (Math.abs(firstOffset) <= maxShift && Math.round(firstOffset / HOP) !== 0) cands.push({ name: "first sounds", centre: Math.round(firstOffset / HOP), span: span, agree: nearGlobalBest(firstOffset) });
        peaks.slice(0, 3).forEach((p, i) => { const c = Math.round(p.lag * F); if (!cands.some((x) => Math.abs(x.centre - c) <= 6)) cands.push({ name: i === 0 ? "rhythm match" : "rhythm match " + (i + 1), centre: c }); });
        cands.forEach((c) => {
            const span2 = c.span || (c.centre === 0 ? span : F * 2 + 2);                            // refine around a coarse hit, or look +-0.18 s around the recording
            Object.assign(c, bestNear(B.env, V.env, c.centre, span2));
            c.rho = c.score; c.distinct = mean > 1e-9 ? Math.max(c.distinct, (c.rho / (mean * 1.0 + 1e-9))) : c.distinct;
        });
        cands.forEach((c) => { if (c.name !== "first sounds" && !c.agree && Math.abs(firstOffset) <= maxShift && Math.abs(c.lag - firstOffset / HOP) <= 8) c.agree = true; });
        const asRec = cands[0];
        const others = cands.slice(1).sort((a, b) => b.rho * Math.exp(-Math.abs(b.lag * HOP) / 25) - a.rho * Math.exp(-Math.abs(a.lag * HOP) / 25));
        let pick = asRec;
        const best = others[0];
        if (best) {
            const bigMove = Math.abs(best.lag - asRec.lag) * HOP;                        // anything beyond latency size (~0.25 s) is a real move
            // small moves (latency, a few hundred ms) need 25% more evidence; bigger ones need 60% more and a clear, distinct peak
            const twoCues = !!best.agree || others.some((x) => x !== best && x.agree && Math.abs(x.lag - best.lag) * HOP < 0.12);   // rhythm and first sounds agree
            const big = bigMove > 0.25, need = big && !twoCues ? 1.6 : 1.25;
            const strongEnough = big && !twoCues ? (best.rho >= 0.18 && best.distinct >= 2.2) : (best.rho >= 0.12 && best.distinct >= 1.8);
            if (strongEnough && best.rho >= asRec.rho * need) pick = best;
        }
        const rate = onsetRate(V.env, V.hopSec), rhythmic = rate.count >= 8 && rate.perSec >= 0.4;
        if (!rhythmic) pick = asRec;                                              // nothing to match: never move it on a guess
        const clearAsRec = rhythmic && asRec.rho >= 0.12 && asRec.distinct >= 1.8;
        const clear = pick !== asRec ? true : clearAsRec;
        let offsetSec;
        if (clear) {
            offsetSec = pick.lag * HOP;
            const moved = Math.round((pick.lag - asRec.lag) * HOP * 1000);
            if (pick === asRec) why.push(Math.abs(moved) >= 8
                ? "The vocal was recorded against this beat; moved it " + (moved > 0 ? "later" : "earlier") + " by " + Math.abs(moved) + " ms so its rhythm lands on the beat (recording delay)."
                : "The vocal's rhythm already lands on the beat, so it was left exactly where it was recorded.");
            else why.push("Searched the whole song for where the vocal's rhythm fits the beat: moved it " + (offsetSec >= 0 ? "later" : "earlier") + " by " + Math.abs(offsetSec).toFixed(2) + " s, where the match is clearly better than as recorded.");
        } else {
            // no clear rhythm (long held notes, spoken word): leave it where it was recorded; only fix a latency-sized gap
            offsetSec = firstOffset > 0 && firstOffset <= 0.25 ? firstOffset : 0;
            why.push("The vocal has no clear rhythm to match against the beat, so " + (offsetSec === 0 ? "it was left as recorded (moving it on a guess is the riskier choice)." : "it was moved " + Math.round(offsetSec * 1000) + " ms to line up the first sounds."));
        }
        // never cut off the singing: moving earlier by more than the lead-in would trim the first words
        const minOff = -Math.max(0.15, vStart - 0.05);                              // a latency-sized nudge earlier is always fine
        if (offsetSec < minOff) { offsetSec = minOff; why.push("Kept the start of the singing: it was not moved earlier than the first word."); }
        const conf = clear ? clamp(0.35 + pick.rho * 2.2, 0.35, 0.98) : 0.3;
        if (conf < 0.45) why.push("Low confidence in the timing: check the playback and nudge it if it feels off.");
        return { offsetSec, confidence: conf, method: clear ? "rhythm match" : "kept as recorded", why, candidates: cands.map((c) => ({ name: c.name, offsetSec: c.lag * HOP, rho: +c.rho.toFixed(3), distinct: +c.distinct.toFixed(2) })) };
    }

    // ------------------------------------------------------------------ the other steps
    const LOOSE = { rnb: 1, universal: 1 };         // styles where a loose feel is part of the sound
    /** Clean-up & timing. The engines gate themselves (a clean room is left alone), so denoise and speed match are safe to allow. */
    function cleanDecision(c) {
        c = c || {}; const why = [];
        const genre = c.genreId || "universal", rapped = c.delivery === "rapped", sung = c.delivery === "sung";
        const out = { denoise: true, tempo: true, timing: false, why };
        why.push("Light noise clean-up allowed: it only works if the recording is noisy, and leaves a clean room alone.");
        why.push("Speed match allowed: it only acts when the singer's speed is clearly different from the beat's.");
        if (rapped || (!LOOSE[genre] && !sung)) { out.timing = true; why.push("Timing tighten on: " + (rapped ? "a rap sits on the grid" : "this style is played tight") + ". Far-off syllables are left as groove."); }
        else why.push("Timing tighten off: " + (sung ? "a sung line breathes around the beat" : "this style keeps a loose feel") + ".");
        return out;
    }
    /** How hard to tune. `delivery` is sung / mixed / rapped from Voice ID. */
    function tuneDecision(c) {
        c = c || {}; const why = [];
        const out = { on: true, strengthCap: 100, spoken: false, why };
        if (c.delivery === "rapped") { out.on = false; out.strengthCap = 0; why.push("Left the rap untuned: tuning a rap makes it sound robotic."); }
        else if (c.delivery === "mixed") {
            if (c.lineByLine !== false) why.push("This vocal mixes singing and rapping, so it is tuned line by line: sung lines are tuned, rapped lines are left alone.");
            else { out.strengthCap = 65; why.push("Tuned the sung parts at a gentler strength, because this mixes singing and rapping."); }
        }
        else if (c.delivery === "sung") why.push("Tuned the sung notes to the beat's key.");
        else if (c.delivery == null || c.delivery === "unknown") { const vc = c.voiceConfidence != null ? clamp(c.voiceConfidence, 0, 1) : 0.4; out.strengthCap = Math.round(55 + 45 * vc); why.push("Could not tell for sure whether this is sung or rapped, so the tuning strength was held to " + out.strengthCap + "%, in proportion to how sure the voice check is."); }
        if (c.voiceConfidence != null && c.voiceConfidence < 1 && c.delivery === "sung") { const cap = Math.round(55 + 45 * clamp(c.voiceConfidence, 0, 1)); if (cap < out.strengthCap) { out.strengthCap = cap; why.push("Not fully sure this is singing, so the tuning was held to " + cap + "%, in proportion to how sure the voice check is."); } }
        return out;
    }
    /** Mix choices that were still manual. Style, space, resonance and calm are already "auto" in the Pipeline. */
    function mixDecision(c) {
        c = c || {}; const why = [];
        const genre = c.genreId || "universal", rapped = c.delivery === "rapped";
        // "Natural" takes 30% off the presence and air, which is what made covers sound dull next to the original. It is now only for a
        // take that is rough or already pushed; a clean take gets the lively "radio" tone, even in R&B.
        const rough = c.vocalQuality != null && c.vocalQuality < 0.55;
        const polish = genre === "trap" ? "aggressive" : (genre === "rnb" && rough) ? "natural" : "radio";
        // vocal level against the beat: rap and trap sit the voice forward, R&B and dense beats let it blend
        let balance = rapped || genre === "rap" || genre === "trap" ? "forward" : genre === "rnb" ? "balanced" : "balanced";
        if (c.vocalQuality != null && c.vocalQuality < 0.45) { balance = "balanced"; why.push("Voice level kept balanced because the take is rough: pushing it forward would show the flaws."); }
        const beatEnhance = true, fill = false;                                         // filling in missing instruments rewrites the beat: only on request
        // a backing harmony only suits a sung vocal with a known key
        const harmony = c.delivery === "sung" && c.keyKnown && (genre === "rnb" || genre === "afrobeats" || genre === "amapiano") ? 2 : 0;
        why.push("Polish: " + polish + " (suits " + genre + (genre === "rnb" && polish === "radio" ? ", and the take is clean enough to keep its shine" : "") + ").");
        why.push("Voice level: " + balance + ".");
        why.push(harmony ? "Added a quiet third-above harmony, because the vocal is sung in a known key." : "No added harmony: " + (rapped ? "this is a rap" : c.keyKnown ? "it does not suit this style" : "the key is not known well enough") + ".");
        return { polish, balance, instrumentBalance: "balanced", harmony, beatEnhance, fillInstruments: fill, why };
    }

    /**
     * The octave brain: judged from THIS beat and THIS voice, not from fixed pitch numbers.
     *
     * It listens to the beat for where its bass sits, where the gap above the bass is, and where the chord body sits (all measured:
     * pitchcorrect.js beatRegister). It listens to the voice for its whole pitch distribution (how much of the singing is at each
     * semitone). Then, for the voice where it is and for one octave up and one octave down, it works out how much of the singing:
     *   - lands ON the beat's bass (muddy, buried)
     *   - sits UNDER the beat's chord body (dark, behind the track)
     *   - floats far OVER the chord body (thin, detached)
     * and picks the placement that leaves the least of that. A move has to fix most of the problem, and by more than the doubt in
     * the measurement allows (a short or unclear take, a beat that was hard to read, a rarely-wanted lowering all raise the bar).
     * The song itself moves the bar: a hard-hitting, busy beat asks for less proof to raise the voice, a sparse, spacious one more.
     * If the singer already sang some lines an octave higher than others, that is the singer showing where the song sits, and it
     * counts for raising the rest. Auto only ACTS on a sung vocal; a rap is never moved, and weaker evidence only SUGGESTS.
     * The only fixed numbers are physical limits of a human voice (so nothing is ever pushed beyond what a lead vocal can do).
     *
     * c = { median, p05, p95, hist (frames per MIDI semitone from histFirst), histFirst, lines [{median, voicedSec}], voicedSec,
     *       steadyShare, delivery, mode: auto | up | down | off, beat | null, vibe: { energy, space } | null }
     * returns { action: raise | lower | suggest-raise | suggest-lower | none, semis, score, confidence, heard, why, evidence }
     */
    const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = (m) => NOTE[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const HUMAN_TOP = 88, HUMAN_BOTTOM = 36;                                 // E6 and C2: physical limits of a lead vocal, not tastes
    function histOf(c) {
        if (c.hist && c.hist.length) return { h: c.hist, first: c.histFirst == null ? 20 : c.histFirst };
        const first = 20, h = new Array(80).fill(0), lo = Math.round(c.p05 != null ? c.p05 : c.median - 5), hi = Math.round(c.p95 != null ? c.p95 : c.median + 6), md = Math.round(c.median);
        for (let m = lo; m <= hi; m++) { const w = m <= md ? 1 + (m - lo) / Math.max(1, md - lo) : 1 + (hi - m) / Math.max(1, hi - md); if (m - first >= 0 && m - first < 80) h[m - first] = w; }
        return { h, first };
    }
    function placement(beat, H, d) {                                         // share of the singing that is on the bass / under the chords / far over them, if moved by d semitones
        let tot = 0, bass = 0, under = 0, over = 0;
        const half = (beat.bodyP75 - beat.bodyP25) / 2;
        for (let i = 0; i < H.h.length; i++) {
            const w = H.h[i]; if (!w) continue; tot += w;
            const m = H.first + i + d;
            if (m >= beat.bassLo && m <= beat.valleyMidi) bass += w;
            else if (m < beat.bodyP25) under += w;
            else if (m > beat.bodyP75 + half) over += w;
        }
        tot = tot || 1;
        return { bass: bass / tot, under: under / tot, over: over / tot, cost: (1.0 * bass + 0.6 * under + 0.6 * over) / tot };
    }
    function octaveBrain(c) {
        c = c || {}; const heard = [], why = [], mode = c.mode || "auto";
        const out = (action, semis, score, conf, extra) => Object.assign({ action, semis, score, confidence: conf, heard, why, evidence: [] }, extra || {});
        if (mode === "off") return out("none", 0, 0, 0);
        if (c.median == null || !isFinite(c.median)) { why.push("Not enough singing to judge the octave."); return out("none", 0, 0, 0); }
        const m = c.median, where = noteName(m) + " (" + Math.round(midiHz(m)) + " Hz)";
        heard.push("Your voice sits around " + where + (c.p05 != null ? ", singing from about " + noteName(c.p05) + " to " + noteName(c.p95) : "") + ".");
        const beat = c.beat && c.beat.bodyP25 != null && c.beat.valleyMidi != null ? c.beat : null;
        if (beat) heard.push("The beat's bass sits near " + noteName(beat.bassMidi) + " and its chords and pads around " + noteName(beat.bodyMidi) + ".");
        if (c.delivery === "rapped") { why.push("This is a rap, so it was left in the register it was performed in."); return out("none", 0, 0, 0); }
        if (mode === "up" || mode === "down") {
            why.push(mode === "up" ? "Raised one octave as you asked. Lines that were already sung high were left alone, and each raised line keeps its own ups and downs."
                : "Lowered one octave as you asked. Lines that were already sung low were left alone, and each lowered line keeps its own ups and downs.");
            return out(mode === "up" ? "raise" : "lower", mode === "up" ? 12 : -12, 0, 1);
        }
        if (!beat) { why.push("There is no beat to judge the octave against, so it was left alone."); return out("none", 0, 0, 0); }

        const H = histOf(c), now = placement(beat, H, 0), upP = placement(beat, H, 12), dnP = placement(beat, H, -12);
        const vs = c.voicedSec == null ? 10 : c.voicedSec;
        const reliability = clamp((beat.confidence == null ? 1 : beat.confidence) * (vs / (vs + 8)), 0.15, 1);   // a short take or a hard-to-read beat means more doubt
        const v = c.vibe || null, push = v && v.energy != null ? clamp(1 - 0.4 * (v.energy - 0.5) + 0.3 * ((v.space == null ? 0.5 : v.space) - 0.5), 0.7, 1.3) : 1;
        const baseNeed = 0.2 + 0.35 * (1 - reliability);                      // how much of the singing a move must rescue
        // the singer's own evidence: lines sung about an octave apart show where the song sits comfortably
        let own = 0;
        if (c.lines && c.lines.length >= 2) {
            const meds = c.lines.map((L) => L.median), lo = Math.min.apply(null, meds), hi = Math.max.apply(null, meds);
            if (hi - lo >= 8 && hi - lo <= 16) {
                const cut = (lo + hi) / 2; let tl = 0, tt = 0; c.lines.forEach((L) => { const t = L.voicedSec || 1; tt += t; if (L.median < cut) tl += t; });
                if (tl / tt >= 0.15 && tl / tt <= 0.85) own = tl / tt;           // share of the singing that sits in the lower group
            }
        }
        const impUp = now.cost - upP.cost + 0.35 * own, impDn = now.cost - dnP.cost;
        const needUp = baseNeed * push, needDn = baseNeed / push * 1.5;      // lowering is rarer and riskier: more proof
        const pct = (x) => Math.round(x * 100) + "%";
        const ev = [{ name: "on the bass", value: +now.bass.toFixed(2), after: +upP.bass.toFixed(2) }, { name: "under the chords", value: +now.under.toFixed(2), after: +upP.under.toFixed(2) }, { name: "over the chords", value: +now.over.toFixed(2), after: +upP.over.toFixed(2) }, { name: "own lines", value: +own.toFixed(2) }];
        const wantUp = impUp >= impDn;
        const imp = wantUp ? impUp : impDn, need = wantUp ? needUp : needDn, dir = wantUp ? 12 : -12, after = wantUp ? upP : dnP;
        const kind = wantUp ? "raise" : "lower";
        const problem = now.cost > 0.05;
        if (!problem || imp < need * 0.5 || imp <= 0) {
            why.push("Your voice is comfortably in the range this beat leaves for it, so the octave was left alone.");
            return out("none", 0, imp, 1 - clamp(now.cost, 0, 1), { evidence: ev });
        }
        // what a producer would say
        const bits = [];
        if (now.bass >= 0.15) bits.push(pct(now.bass) + " of your singing sits on the beat's bass line");
        if (now.under >= 0.2) bits.push(pct(now.under) + " sits under the beat's chords");
        if (now.over >= 0.2) bits.push(pct(now.over) + " floats far above the beat's chords");
        if (bits.length) why.push(bits.join(" and ").replace(/^./, (x) => x.toUpperCase()) + (wantUp ? ", so it gets buried." : ", so it feels detached from the track."));
        if (own > 0) why.push("You also sang some lines about an octave higher than the rest, which shows where the song sits comfortably.");
        if (v && wantUp && push <= 0.88) why.push("The beat is hard-hitting and busy, so the voice needs to be higher to cut through.");
        else if (v && wantUp && push >= 1.12) why.push("The beat is sparse and spacious, so a lower voice is more at home in it and it asked for stronger proof.");
        const veto = wantUp ? (c.p95 != null && c.p95 + 12 > HUMAN_TOP ? "it would go above what a lead vocal can comfortably reach" : null) : (c.p05 != null && c.p05 - 12 < HUMAN_BOTTOM ? "it would go below what a lead vocal can comfortably reach" : null);
        const fixesMost = after.cost <= now.cost * 0.4;
        const conf = clamp(imp / (need * 2), 0, 1);
        const sungish = c.delivery === "sung" || c.delivery === "mixed";
        const unknown = !sungish && c.delivery !== "rapped", heldNotes = c.steadyShare == null || c.steadyShare > 0.03;
        const proof = unknown ? need * 1.5 : need;                           // when it is not known whether it is sung, ask for more
        if (veto) { why.push("Not moved: " + veto + "."); return out("suggest-" + kind, dir, imp, conf * 0.5, { evidence: ev }); }
        if (imp >= proof && fixesMost && (sungish || (unknown && heldNotes))) {
            why.push("Tried it on paper: " + (wantUp ? "an octave up" : "an octave down") + " that drops to " + pct(after.bass) + " on the bass, " + pct(after.under) + " under the chords and " + pct(after.over) + " floating over them, so it was " + (wantUp ? "raised" : "lowered") + " one octave. Lines already in the right register were left alone.");
            return out(kind, dir, imp, conf, { evidence: ev });
        }
        why.push(!fixesMost ? "I tried the move on paper and it would not sit clearly better against this beat, so nothing was changed. If you sang it an octave away from the original, set Octave by hand and compare."
            : "The evidence is suggestive but not strong enough to move your voice on its own. If you sang it an octave away from the original, set Octave by hand to " + (wantUp ? "\"Raise one octave\"" : "\"Lower one octave\"") + " and compare.");
        return out("suggest-" + kind, dir, imp, conf * 0.6, { evidence: ev });
    }
    // the older entry point
    function octaveDecision(c) { return octaveBrain(c); }

    /**
     * Which of the seven notes is home? A beat on its own can be ambiguous between a major key and its relative minor (A major and
     * F# minor are the same seven notes; a chord loop like F#m-D-A-E fits both). So the singer's melody gets a vote: where its
     * phrases land and rest. They are weighed by how sure each side is (the beat's own tonic confidence; the melody's confidence,
     * discounted when there are few notes to go on). A key told by the Beat Lab is exact and never overridden. If the singer's
     * seven notes differ from the beat's, nothing is changed (that is a different matter, not a labelling one).
     * c = { beat: { rootPc, scale, tonicConfidence, source }, singer: { rootPc, scale, tonicConfidence } | null, notes }
     */
    const setRootOf = (k) => (String(k.scale || "").toLowerCase().indexOf("min") === 0 ? (k.rootPc + 3) % 12 : k.rootPc);
    function keyDecision(c) {
        c = c || {}; const b = c.beat, g = c.singer, why = [];
        if (!b || !g || b.rootPc == null || g.rootPc == null) return { change: false, why };
        if (b.source === "Beat Lab" || b.source === "set by you") return { change: false, why };
        if (setRootOf(b) !== setRootOf(g)) return { change: false, why };                   // not the same seven notes: not a labelling question
        if (b.rootPc === g.rootPc && String(b.scale).toLowerCase() === String(g.scale).toLowerCase()) return { change: false, why };
        const n = c.notes || 0, beatS = clamp(b.tonicConfidence == null ? 0.5 : b.tonicConfidence, 0, 1), singS = clamp(g.tonicConfidence == null ? 0.5 : g.tonicConfidence, 0, 1) * (n / (n + 10));
        const nameOf = (k) => NOTE[k.rootPc] + " " + (String(k.scale).toLowerCase().indexOf("min") === 0 ? "minor" : "major");
        if (singS > beatS) {
            why.push("The beat's chords could be read as " + nameOf(b) + " or " + nameOf(g) + " (the same seven notes), but your melody keeps landing and resting on " + NOTE[g.rootPc] + ", so the key was set to " + nameOf(g) + ". The notes used for tuning are the same either way.");
            return { change: true, to: { rootPc: g.rootPc, scale: String(g.scale).toLowerCase().indexOf("min") === 0 ? "Minor" : "Major" }, alsoFits: nameOf(b), why };
        }
        why.push("The beat's chords point to " + nameOf(b) + " and your melody could also be " + nameOf(g) + " (the same seven notes). The beat is the clearer voice, so the key stayed " + nameOf(b) + ".");
        return { change: false, alsoFits: nameOf(g), why };
    }

    return { alignDecision, cleanDecision, tuneDecision, mixDecision, octaveDecision, octaveBrain, keyDecision, onsetCurve };
});
