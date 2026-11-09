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

    /**
     * @returns {offsetSec, confidence 0..1, reason, ...}  offsetSec > 0 means the vocal starts later against the beat.
     */
    function alignDecision(vocalCh, vsr, beatCh, bsr, o) {
        o = o || {};
        const V = onsetCurve(monoOf(vocalCh), vsr), B = onsetCurve(monoOf(beatCh), bsr);
        const vStart = firstSound(V.level, V.hopSec), bStart = firstSound(B.level, B.hopSec);
        const firstOffset = bStart - vStart;                                        // what the old Auto-align did
        const why = [];
        if (V.env.length < 200 || B.env.length < 200) return { offsetSec: firstOffset, confidence: 0.2, method: "first sound", why: ["Too little audio to compare rhythms, so the first sounds were lined up."] };

        const span = Math.round((o.searchSec || 0.18) / HOP);                       // how far to look around each candidate
        const cands = [
            { name: "as recorded", centre: 0 },
            { name: "first sounds", centre: Math.round(firstOffset / HOP) }
        ];
        if (cands[1].centre === cands[0].centre) cands.pop();
        cands.forEach((c) => Object.assign(c, bestNear(B.env, V.env, c.centre, span)));
        const self = (e) => { let s = 0; for (let i = 0; i < e.length; i++) s += e[i] * e[i]; return s; };
        // corr is normalised by both curves having unit length, so a perfect match is 1.0
        cands.forEach((c) => { c.rho = c.score; });
        cands.sort((a, b) => b.rho - a.rho);
        const top = cands[0], asRec = cands.find((c) => c.name === "as recorded");
        // The recording is trusted as it is unless the other reading is clearly better: files from a DAW or the Studio already
        // line up, and moving them is the worse mistake.
        let pick = top;
        if (asRec && top !== asRec && top.rho < asRec.rho * 1.25) pick = asRec;
        const clear = pick.rho >= 0.12 && pick.distinct >= 1.8;
        let offsetSec;
        if (clear) {
            offsetSec = pick.lag * HOP;
            const moved = Math.round((pick.lag - pick.centre) * HOP * 1000);
            why.push(pick.name === "as recorded"
                ? (Math.abs(moved) >= 8 ? "The vocal was recorded against this beat; moved it " + (moved > 0 ? "later" : "earlier") + " by " + Math.abs(moved) + " ms so its rhythm lands on the beat (recording delay)." : "The vocal's rhythm already lands on the beat, so it was left exactly where it was recorded.")
                : "Lined up the first sounds, then moved it " + Math.abs(moved) + " ms " + (moved >= 0 ? "later" : "earlier") + " so its rhythm lands on the beat.");
        } else {
            // no clear rhythm in the vocal (long held notes, spoken word): keep the safest choice
            // (never move it EARLIER: that would cut off the start of the vocal)
            offsetSec = firstOffset > 0 ? firstOffset : 0;
            why.push("The vocal has no clear rhythm to match against the beat, so " + (offsetSec === 0 ? "it was left as recorded." : "its first sound was lined up with the beat's first sound."));
        }
        const conf = clear ? clamp(0.35 + pick.rho * 2.2, 0.35, 0.98) : 0.3;
        return { offsetSec, confidence: conf, method: clear ? "rhythm match" : "first sound", why, candidates: cands.map((c) => ({ name: c.name, offsetSec: c.lag * HOP, rho: +c.rho.toFixed(3), distinct: +c.distinct.toFixed(2) })) };
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
        if (c.voiceConfidence != null && c.voiceConfidence < 0.5 && c.delivery === "sung") { out.strengthCap = Math.min(out.strengthCap, 80); why.push("Not fully sure this is singing, so the tuning was kept a little lighter."); }
        return out;
    }
    /** Mix choices that were still manual. Style, space, resonance and calm are already "auto" in the Pipeline. */
    function mixDecision(c) {
        c = c || {}; const why = [];
        const genre = c.genreId || "universal", rapped = c.delivery === "rapped";
        const polish = genre === "rnb" ? "natural" : genre === "trap" ? "aggressive" : "radio";
        // vocal level against the beat: rap and trap sit the voice forward, R&B and dense beats let it blend
        let balance = rapped || genre === "rap" || genre === "trap" ? "forward" : genre === "rnb" ? "balanced" : "balanced";
        if (c.vocalQuality != null && c.vocalQuality < 0.45) { balance = "balanced"; why.push("Voice level kept balanced because the take is rough: pushing it forward would show the flaws."); }
        const beatEnhance = true, fill = false;                                         // filling in missing instruments rewrites the beat: only on request
        // a backing harmony only suits a sung vocal with a known key
        const harmony = c.delivery === "sung" && c.keyKnown && (genre === "rnb" || genre === "afrobeats" || genre === "amapiano") ? 2 : 0;
        why.push("Polish: " + polish + " (suits " + genre + ").");
        why.push("Voice level: " + balance + ".");
        why.push(harmony ? "Added a quiet third-above harmony, because the vocal is sung in a known key." : "No added harmony: " + (rapped ? "this is a rap" : c.keyKnown ? "it does not suit this style" : "the key is not known well enough") + ".");
        return { polish, balance, instrumentBalance: "balanced", harmony, beatEnhance, fillInstruments: fill, why };
    }

    return { alignDecision, cleanDecision, tuneDecision, mixDecision, onsetCurve };
});
