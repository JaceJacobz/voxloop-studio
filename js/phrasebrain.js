/**
 * Voxloop — Phrase brain (line by line)
 *
 * A singer is not locked to the seven notes of the beat's key. Lines borrow notes: a blue note (the flat 5th in a minor
 * song), the raised 6th or 7th, the major version of the same tonic, a lift to the 4th or 5th for a chorus. Forcing the whole
 * vocal onto one key pulls those notes the wrong way and flattens the style.
 *
 * So the vocal is listened to LINE BY LINE. For every line this works out:
 *   - which set of allowed notes explains what was actually sung with the least correction (the beat's key unless
 *     another set is clearly better: the key is the default and has to be beaten by a margin, so lines do not flip-flop),
 *   - whether the line is sung, mixed or rapped (a rap line is left exactly as performed),
 *   - where the line sits in the singer's range (a high part, a low part), so its processing can differ.
 * The result is a list of zones for the tune engine (see zones in pitchcorrect.js) and a plain-language list of what was decided.
 *
 * Pure functions: runs in the page (window.PhraseBrain) and in Node (tests/).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.PhraseBrain = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const SETS = {
        major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
        "harmonic minor": [0, 2, 3, 5, 7, 8, 11], blues: [0, 3, 5, 6, 7, 10], "major blues": [0, 2, 3, 4, 7, 9]
    };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const pcName = (pc) => NAMES[((pc % 12) + 12) % 12];
    const maskOf = (rootPc, scale) => { const m = new Array(12).fill(false); SETS[scale].forEach((d) => { m[(rootPc + d) % 12] = true; }); return m; };
    const maskString = (m) => "mask:" + m.map((b) => (b ? "1" : "0")).join("");
    const mmss = (t) => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");

    /** The sets a line may use, from the beat's key. `prior` is a small penalty: the key is the default. */
    function candidatesFor(key) {
        const T = key.rootPc, minor = key.scale === "minor";
        const c = [{ id: "key", rootPc: T, scale: key.scale, prior: 0, label: "the beat's key" }];
        if (minor) {
            c.push({ id: "blues", rootPc: T, scale: "blues", prior: 0.04, label: pcName(T) + " minor blues (adds the flat 5th)" });
            c.push({ id: "dorian", rootPc: T, scale: "dorian", prior: 0.06, label: pcName(T) + " dorian (raised 6th)" });
            c.push({ id: "harmonic", rootPc: T, scale: "harmonic minor", prior: 0.08, label: pcName(T) + " harmonic minor (raised 7th)" });
            c.push({ id: "parallel", rootPc: T, scale: "major", prior: 0.12, label: pcName(T) + " major (the major colour on the same note)" });
        } else {
            c.push({ id: "mixolydian", rootPc: T, scale: "mixolydian", prior: 0.06, label: pcName(T) + " mixolydian (flat 7th)" });
            c.push({ id: "blues", rootPc: T, scale: "major blues", prior: 0.04, label: pcName(T) + " major blues (adds the flat 3rd)" });
            c.push({ id: "lydian", rootPc: T, scale: "lydian", prior: 0.10, label: pcName(T) + " lydian (raised 4th)" });
            c.push({ id: "parallel", rootPc: T, scale: "minor", prior: 0.12, label: pcName(T) + " minor (borrowed from the minor)" });
        }
        c.push({ id: "up4", rootPc: (T + 5) % 12, scale: key.scale, prior: 0.14, label: "lifted to the 4th (" + pcName(T + 5) + " " + key.scale + ")" });
        c.push({ id: "up5", rootPc: (T + 7) % 12, scale: key.scale, prior: 0.14, label: "lifted to the 5th (" + pcName(T + 7) + " " + key.scale + ")" });
        c.forEach((x) => { x.mask = maskOf(x.rootPc, x.scale); });
        return c;
    }

    // distance in semitones from a (fractional) pitch to the nearest allowed pitch class, going round the octave
    function distToSet(m, mask) {
        const pc = ((m % 12) + 12) % 12; let best = 6;
        for (let k = 0; k < 12; k++) if (mask[k]) { const d = Math.abs(pc - k), dd = Math.min(d, 12 - d); if (dd < best) best = dd; }
        return best;
    }
    function costOf(notes, mask, ref) {
        let num = 0, den = 0;
        notes.forEach((n) => { const w = Math.min(n.dur, 0.6); num += w * Math.min(1, distToSet(n.center - ref, mask)); den += w; });
        return den > 0 ? num / den : 0;
    }

    /**
     * @param {object} o
     *   notes   [{start,end,center}]  start/end in pitch frames, center in MIDI (from the tune engine's segmentNotes)
     *   hopSec  seconds per pitch frame
     *   key     { rootPc, scale: "major"|"minor" }
     *   refCents  the beat's tuning offset
     *   totalSec  length of the vocal
     */
    function analyze(o) {
        const hop = o.hopSec, ref = (o.refCents || 0) / 100, key = o.key;
        const all = (o.notes || []).map((n) => ({ start: n.start * hop, end: n.end * hop, dur: (n.end - n.start) * hop, center: n.center })).filter((n) => n.dur >= 0.06);
        const out = { phrases: [], zones: [], lines: [], summary: { lines: 0, changedKey: 0, rapped: 0, mixed: 0, high: 0, low: 0 } };
        if (all.length < 4 || !key) return out;

        // 1. group notes into lines: a gap of 0.35 s or more (a breath) starts a new line; very short lines join a neighbour
        const groups = []; let cur = [all[0]];
        for (let i = 1; i < all.length; i++) { if (all[i].start - all[i - 1].end >= 0.35) { groups.push(cur); cur = []; } cur.push(all[i]); }
        groups.push(cur);
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i], span = g[g.length - 1].end - g[0].start;
            if (span < 0.5 && groups.length > 1) { const j = i === 0 ? 1 : i - 1; groups[j] = i === 0 ? g.concat(groups[j]) : groups[j].concat(g); groups.splice(i, 1); i--; }
        }
        const centres = all.map((n) => n.center), overall = median(centres), cands = candidatesFor(key);
        const total = o.totalSec || all[all.length - 1].end + 0.5;

        groups.forEach((g, i) => {
            const start = g[0].start, end = g[g.length - 1].end;
            const prevEnd = i ? groups[i - 1][groups[i - 1].length - 1].end : 0, nextStart = i < groups.length - 1 ? groups[i + 1][0].start : total;
            const zs = i ? (prevEnd + start) / 2 : 0, ze = i < groups.length - 1 ? (end + nextStart) / 2 : total;
            // delivery of this line: the share of the line spent holding notes
            let voiced = 0, held = 0; g.forEach((n) => { voiced += n.dur; if (n.dur >= 0.22) held += n.dur; });
            const share = voiced > 0 ? held / voiced : 0;
            const delivery = g.length < 3 ? (o.delivery || "sung") : share >= 0.55 ? "sung" : share >= 0.3 ? "mixed" : "rapped";
            const med = median(g.map((n) => n.center)), rel = med - overall;
            const register = rel >= 3 ? "high" : rel <= -3 ? "low" : "mid";

            // 2. which allowed set explains this line best (only sung and mixed lines have notes worth fitting)
            const fitNotes = g.filter((n) => n.dur >= 0.12), weighted = fitNotes.reduce((s, n) => s + Math.min(n.dur, 0.6), 0);
            const base = cands[0], baseCost = costOf(fitNotes, base.mask, ref);
            let pick = base, pickCost = baseCost;
            if (delivery !== "rapped" && fitNotes.length >= 3 && weighted >= 0.8) {
                // Evidence for another set = how long this line sits on notes that are OUTSIDE the beat's key (more than 0.7 of a semitone from
                // any key note: a singer who is merely flat is not borrowing) yet land on a note of that set. It has to be at least 0.7 s,
                // and a tenth of the line, so one stray note cannot change the line's key.
                let bestScore = Infinity, bestC = null, bestEv = 0, bestCost = baseCost;
                cands.slice(1).forEach((c) => {
                    let ev = 0; fitNotes.forEach((n) => { if (distToSet(n.center - ref, base.mask) > 0.7 && distToSet(n.center - ref, c.mask) < 0.35) ev += Math.min(n.dur, 0.8); });
                    const cost = costOf(fitNotes, c.mask, ref);
                    if (ev >= 0.7 && ev / weighted >= 0.1 && cost <= baseCost - 0.04) { const score = cost + c.prior - 0.1 * ev; if (score < bestScore) { bestScore = score; bestC = c; bestEv = ev; bestCost = cost; } }
                });
                if (bestC) { pick = bestC; pickCost = bestCost; }
            }
            const strength = delivery === "rapped" ? 0 : delivery === "mixed" ? 0.55 : 1;
            const why = [];
            if (pick !== base) {
                const usedFlat = g.filter((n) => distToSet(n.center - ref, base.mask) > 0.5 && distToSet(n.center - ref, pick.mask) < 0.3).length;
                why.push("Allowed " + pick.label + " here, because " + usedFlat + " of " + g.length + " notes in this line " + (usedFlat === 1 ? "is" : "are") + " outside the beat's key but inside that set. Cutting " + (usedFlat === 1 ? "it" : "them") + " to the nearest key note would change the tune.");
            }
            if (delivery === "rapped") why.push("Rapped line: left exactly as performed.");
            else if (delivery === "mixed") why.push("Sung and rapped mixed: tuned the held notes more gently.");
            if (register !== "mid") why.push("This is a " + register + " part of the vocal (" + Math.abs(Math.round(rel)) + " semitones " + (rel > 0 ? "above" : "below") + " your usual).");

            const ph = { index: i, start, end, zoneStart: zs, zoneEnd: ze, delivery, register, relSemitones: rel, medianMidi: med, noteCount: g.length, setId: pick.id, setLabel: pick.label, changedKey: pick !== base, baseCost, pickCost, why };
            out.phrases.push(ph);
            out.zones.push({ start: zs, end: ze, rootPc: pick.rootPc, scale: maskString(pick.mask), strength });
            if (pick !== base) out.summary.changedKey++;
            if (delivery === "rapped") out.summary.rapped++; else if (delivery === "mixed") out.summary.mixed++;
            if (register === "high") out.summary.high++; else if (register === "low") out.summary.low++;
            why.forEach((w) => out.lines.push("Line " + (i + 1) + " (" + mmss(start) + "–" + mmss(end) + "): " + w));
        });
        // how much of the whole vocal already sits inside the beat's key (a low number means the vocal is in a different key altogether)
        { let num = 0, den = 0; all.forEach((n) => { const w = Math.min(n.dur, 0.6); den += w; if (distToSet(n.center - ref, cands[0].mask) < 0.35) num += w; }); out.keyCoverage = den ? num / den : 0; }
        out.summary.lines = out.phrases.length;
        // If most lines fit a DIFFERENT key (a whole-vocal mismatch), phrase tuning is the wrong tool: the old whole-vocal move is better
        out.globalMismatch = out.phrases.length >= 4 && out.phrases.filter((p) => p.changedKey && (p.setId === "up4" || p.setId === "up5")).length / out.phrases.length > 0.6;
        return out;
    }

    return { analyze, candidatesFor, distToSet, maskString, SETS };
});
