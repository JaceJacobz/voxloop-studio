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
        else if (c.delivery == null || c.delivery === "unknown") { out.strengthCap = 75; why.push("Could not tell for sure whether this is sung or rapped, so the tuning was kept to a gentler strength."); }
        if (c.voiceConfidence != null && c.voiceConfidence < 0.5 && c.delivery === "sung") { out.strengthCap = Math.min(out.strengthCap, 80); why.push("Not fully sure this is singing, so the tuning was kept a little lighter."); }
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
     * The octave brain. It works like a producer would: listen to where the voice sits, listen to where the beat leaves room, weigh
     * what the genre and the energy of the song want, try the move on paper, and only then decide. Positive score = the voice is
     * too LOW for this song (raise it); negative = too HIGH (lower it).
     *
     * Evidence (each from -1 to +1, then weighed):
     *   register  where the voice sits against where lead vocals normally live (the voice's own pitch)            weight .45
     *   chords    where the voice sits against the middle of the beat's sustained body (chords, pads, bass)         weight .20
     *   bass      whether the voice shares its notes with the beat's bass line (buried and muddy)                    weight .20
     * The beat's two weights shrink when the beat could not be measured well. Then the score is nudged by the song:
     *   genre     trap and drill suit a deep voice (a raise needs more proof); pop, afrobeats and dance want it up front
     *   vibe      a hard-hitting, busy beat wants the voice higher; a sparse, laid-back one lets it sit low
     * Then the listen-back: the move is tried on paper (score again as if the voice already sat there). It is only made if that
     * fixes the problem; if the moved voice would sit no better, nothing is changed and the doubt is reported.
     * Auto only ACTS on strong, agreeing evidence on a sung vocal; weaker evidence only SUGGESTS. A rap is never moved.
     *
     * c = { median, p05, p95 (MIDI, over the singing), delivery, mode: auto | up | down | off,
     *       beat: { bodyMidi, bassMidi, bassStrength, confidence } | null, genreId, vibe: { energy, space, busy } | null }
     * returns { action: raise | lower | suggest-raise | suggest-lower | none, semis, score, confidence, heard: [...], why: [...], evidence: [...] }
     */
    const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = (m) => NOTE[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const interp = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };
    const REG = [[40, 1], [44, 0.95], [46, 0.8], [48, 0.5], [50, 0.3], [52, 0.1], [55, 0], [70, 0], [73, -0.1], [76, -0.4], [79, -0.8], [82, -1]];
    const REL = [[-16, 1], [-12, 0.8], [-8, 0.45], [-3, 0.1], [0, 0], [12, 0], [16, -0.35], [20, -0.7], [24, -1]];
    // Does the voice's range sit on top of the beat's bass? (a voice sharing the bass's notes is buried and muddy)
    function bassCollision(beat, m) {
        if (beat.bassMidi == null || !(beat.bassStrength >= 1.6)) return null;      // no clear bass line to collide with
        const lo = Math.max(m - 4, beat.bassMidi - 3), hi = Math.min(m + 4, beat.bassMidi + 9);
        return clamp((hi - lo) / 8, 0, 1);
    }
    function scoreAt(c, m) {                                                // evidence for a voice sitting at pitch m (positive: raising would help)
        const parts = [], beat = c.beat && c.beat.bodyMidi != null ? c.beat : null, bc = beat ? clamp(c.beat.confidence == null ? 1 : c.beat.confidence, 0, 1) : 0;
        parts.push({ name: "register", v: interp(REG, m), w: 0.45 });
        if (beat) {
            parts.push({ name: "chords", v: interp(REL, m - beat.bodyMidi), w: 0.2 * bc, rel: m - beat.bodyMidi });
            const here = bassCollision(beat, m), upC = bassCollision(beat, m + 12) || 0;
            // only counts when the bass is actually in play (the voice, or the raised voice, touches it); a bass far away says nothing.
            // positive: raising gets the voice off the bass; negative: raising would put it on the bass
            if (here != null && (here > 0 || upC > 0)) parts.push({ name: "bass", v: clamp(here - upC, -1, 1), w: 0.2 * bc, here });
        }
        const W = parts.reduce((t, p) => t + p.w, 0) || 1;
        return { S: parts.reduce((t, p) => t + p.v * p.w, 0) / W, parts };
    }
    function songFactor(c) {
        const g = String(c.genreId || "").toLowerCase(), v = c.vibe || null;
        let gf = 1, gt = null;
        if (/trap|drill|phonk|lofi|lo-fi/.test(g)) { gf = 0.7; gt = "this genre carries a deep voice well, so a raise needed stronger proof"; }
        else if (/rnb|r&b|soul/.test(g)) { gf = 0.9; }
        else if (/afro|amapiano|dancehall|pop|house|dance|edm|reggaeton/.test(g)) { gf = 1.1; gt = "this genre wants the voice forward and up"; }
        let vf = 1, vt = null;
        if (v && v.energy != null) {
            vf = clamp(1 + 0.25 * (v.energy - 0.5) - 0.2 * ((v.space == null ? 0.5 : v.space) - 0.5), 0.8, 1.2);
            vt = vf > 1.06 ? "a hard-hitting, busy beat needs the voice higher to cut through" : vf < 0.94 ? "a sparse, laid-back beat lets a lower voice sit comfortably" : null;
        }
        return { f: gf * vf, gt, vt };
    }
    function octaveBrain(c) {
        c = c || {}; const heard = [], why = [], mode = c.mode || "auto";
        const out = (action, semis, score, conf, extra) => Object.assign({ action, semis, score, confidence: conf, heard, why, evidence: [] }, extra || {});
        if (mode === "off") return out("none", 0, 0, 0);
        if (c.median == null || !isFinite(c.median)) { why.push("Not enough singing to judge the octave."); return out("none", 0, 0, 0); }
        const m = c.median, where = noteName(m) + " (" + Math.round(midiHz(m)) + " Hz)";
        heard.push("Your voice sits around " + where + (c.p05 != null ? ", singing from about " + noteName(c.p05) + " to " + noteName(c.p95) : "") + ".");
        const beat = c.beat && c.beat.bodyMidi != null ? c.beat : null;
        if (beat) heard.push("The beat's chords and pads sit around " + noteName(beat.bodyMidi) + (beat.bassMidi && beat.bassStrength > 1.6 ? " with its bass near " + noteName(beat.bassMidi) : "") + ".");
        if (c.delivery === "rapped") { why.push("This is a rap, so it was left in the register it was performed in."); return out("none", 0, 0, 0); }
        if (mode === "up" || mode === "down") {
            const semis = mode === "up" ? 12 : -12;
            why.push(mode === "up" ? "Raised one octave as you asked. Lines that were already sung high were left alone, and each raised line keeps its own ups and downs."
                : "Lowered one octave as you asked. Lines that were already sung low were left alone, and each lowered line keeps its own ups and downs.");
            return out(mode === "up" ? "raise" : "lower", semis, 0, 1);
        }
        const sungish = c.delivery === "sung" || c.delivery === "mixed";
        const now = scoreAt(c, m), sf = songFactor(c), S0 = now.S > 0 ? now.S * sf.f : now.S;
        const ev = now.parts.map((p) => ({ name: p.name, value: +p.v.toFixed(2), weight: +p.w.toFixed(2) }));
        const rp = now.parts.find((p) => p.name === "chords"), op = now.parts.find((p) => p.name === "bass");
        // what a producer would say about it
        if (S0 > 0.3) {
            if (interp(REG, m) >= 0.5) why.push("That is low for a lead vocal.");
            if (rp && rp.v >= 0.35) why.push("It sits about " + Math.abs(Math.round(rp.rel)) + " semitones under the beat's chords, down where the bass and chords already are, so it gets buried.");
            if (op && op.v >= 0.3) why.push("It shares its notes with the beat's bass line, which makes it muddy; an octave up clears the bass.");
        } else if (S0 < -0.3) {
            if (interp(REG, m) <= -0.4) why.push("That is very high for a lead vocal; it can sound thin and strained.");
            if (rp && rp.v <= -0.35) why.push("It floats about " + Math.round(rp.rel) + " semitones above the beat's chords, so it feels detached from the track.");
            if (op && op.v <= -0.3) why.push("Lowering it would collide with the bass line, so it stays up.");
        }
        if (Math.abs(S0) >= 0.3 && sf.gt) why.push("Genre: " + sf.gt + ".");
        if (Math.abs(S0) >= 0.3 && sf.vt) why.push("Vibe: " + sf.vt + ".");
        const need = S0 > 0 ? { act: 0.62, say: 0.3 } : { act: 0.75, say: 0.4 };
        const dir = S0 > 0 ? 12 : -12;
        const veto = S0 > 0 ? (c.p95 != null && c.p95 + 12 > 86 ? "it would go above the comfortable top of a lead vocal" : null) : (c.p05 != null && c.p05 - 12 < 34 ? "it would go below the comfortable bottom of a lead vocal" : null);
        if (Math.abs(S0) < need.say) {
            if (beat || c.genreId) why.push("Your voice is comfortably in the range this beat leaves for it, so the octave was left alone.");
            else why.push("The octave looks fine, so it was left alone.");
            return out("none", 0, S0, 1 - Math.abs(S0), { evidence: ev });
        }
        // listen-back: try it on paper
        const after = scoreAt(c, m + dir), S1 = after.S > 0 ? after.S * sf.f : after.S;
        const fixes = Math.abs(S1) <= Math.abs(S0) * 0.5;
        const conf = clamp(Math.abs(S0), 0, 1);
        const kind = S0 > 0 ? "raise" : "lower";
        if (veto) { why.push("Not moved: " + veto + "."); return out("suggest-" + kind, dir, S0, conf * 0.5, { evidence: ev }); }
        if (!fixes) { why.push("I tried the move on paper and it would not sit clearly better against this beat, so nothing was changed. If you sang it an octave away from the original, set Octave by hand and compare."); return out("suggest-" + kind, dir, S0, conf * 0.5, { evidence: ev }); }
        if (Math.abs(S0) >= need.act && sungish && !(beat == null && Math.abs(S0) < 0.75)) {
            why.push("Tried it on paper: " + (S0 > 0 ? "an octave up" : "an octave down") + " it sits clearly better against this beat, so it was " + (S0 > 0 ? "raised" : "lowered") + " one octave. Lines already sung in the right register were left alone.");
            return out(kind, dir, S0, conf, { evidence: ev });
        }
        why.push(sungish ? "The evidence is suggestive but not strong enough to move your voice on its own. If you sang it an octave away from the original, set Octave by hand to " + (S0 > 0 ? "\"Raise one octave\"" : "\"Lower one octave\"") + " and compare."
                         : "It is not clear this is sung, so nothing was moved. If you sang an octave away from the original, set Octave by hand.");
        return out("suggest-" + kind, dir, S0, conf * 0.6, { evidence: ev });
    }
    // the older entry point (voice only): same brain, no beat information
    function octaveDecision(c) { const r = octaveBrain(c); return Object.assign({}, r, { action: r.action }); }

    return { alignDecision, cleanDecision, tuneDecision, mixDecision, octaveDecision, octaveBrain, onsetCurve };
});
