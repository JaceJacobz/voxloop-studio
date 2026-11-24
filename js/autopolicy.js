/**
 * Voxloop Studio: what Autopilot may do with each plugin (v2.25.9)
 *
 * Every plugin the FX Rack knows (VLFx.ORDER) has one entry here that says how Autopilot treats it:
 *
 *   chain  Autopilot listens to the clip and decides whether this goes on the WHOLE clip, and with what settings.
 *   extra  Autopilot places it only on PART of a clip (the big sections, the ends of lines), and only when the song and the
 *          vocal suit it. `byDefault` says whether Autopilot chooses it without being asked.
 *   hand   a hand tool. Autopilot never adds it, never changes it, never switches it off, and never undoes what it made.
 *
 * `use` and `never` are the plain-words rules the brain (fxbrain.js) follows; the Auto tab shows them to the person.
 *
 * ADDING A PLUGIN? Add its id to VLFx.ORDER and a line here, in the same change. tests/autopolicy.test.js fails when a plugin has no
 * line, when the brain puts a hand or extra plugin on a whole clip, or when a plugin Autopilot made is not named here.
 *
 * Pure data and small helpers: no DOM, no audio. Loaded before fxbrain.js and fxrack.js.
 */
(function (root) {
    "use strict";

    const POLICY = {
        clean:     { mode: "chain", where: "the whole clip, first in the chain",
                     use: "steady hum or hiss, wind, or sudden noises were found in the take",
                     never: "the take is clean: nothing is added, because cleaning a clean take only dulls the voice" },
        tune:      { mode: "chain", where: "the whole clip",
                     use: "a sung or mixed take with enough clear notes, when notes sit off the beat's key (a key you set in Studio wins); the speed follows the style",
                     never: "rapped or spoken lines, takes already within about 10 cents, too few clear notes, or a clip whose notes you fixed by hand in the Pitch editor" },
        pitchedit: { mode: "hand", where: "only where you drag notes in the Pitch editor",
                     use: "never by Autopilot: moving a note up or down is your decision",
                     never: "Autopilot does not add it, change your moves, switch it off, or tune over a clip you fixed by hand" },
        gate:      { mode: "chain", where: "the whole clip",
                     use: "there are real gaps between lines and the room noise in them is audible (above about -56 dBFS), or there is mains hum",
                     never: "a take with no gaps, or a quiet room: a gate would only chop the ends of words" },
        harmony:   { mode: "extra", byDefault: "in R&B, Afrobeats and Amapiano with a known key, on sung lines only", where: "the biggest sections of the beat, on the lead",
                     use: "the key is known and the lines are sung",
                     never: "rapped lines, an unknown key, or the whole take" },
        deess:     { mode: "chain", where: "the whole clip",
                     use: "sharp S and T sounds stick out (more so when the beat is bright)",
                     never: "S sounds are already under control" },
        eq:        { mode: "chain", where: "the whole clip",
                     use: "every clip gets a gentle clean-up, shaped by the voice type and the beat",
                     never: "no big boosts on a rough take, because boosting lifts the noise too" },
        comp:      { mode: "chain", where: "the whole clip",
                     use: "loud and quiet words are far apart (about 9 dB, 7 dB for backing parts); it lets go in time with the beat",
                     never: "the level is already steady" },
        sat:       { mode: "chain", where: "the whole clip",
                     use: "only in the Big style, on a clean take",
                     never: "Natural or Polished style, or a rough take" },
        voice:     { mode: "extra", byDefault: "no: only when you switch the voice-change spice on", where: "one short phrase end, ideally just before the beat lifts",
                     use: "you asked for voice-change spice",
                     never: "on the whole take, or by itself" },
        doubler:   { mode: "extra", byDefault: "yes, when the beat has big sections", where: "the biggest sections of the beat (1.5 s or longer), on the lead",
                     use: "the beat has a big section; louder when the beat is more energetic",
                     never: "quiet parts, or backing lanes" },
        resonance: { mode: "extra", byDefault: "yes, but it may decide not to run", where: "the whole clip, planned from this beat and vocal",
                     use: "the planner says the shimmer fits this voice and beat",
                     never: "when the planner says it would clash: it says why instead" },
        crowd:     { mode: "extra", byDefault: "no: only when you switch the crowd on", where: "the last words of a line in a big section that is followed by a pause of about a second",
                     use: "you asked for the crowd and a line ends in a big section with room after it",
                     never: "lines with no pause after them, or by itself" },
        imager:    { mode: "chain", where: "backing parts only (ad-libs, harmonies, tags)",
                     use: "the lane is a backing part: it is widened, a little less when the beat is already full",
                     never: "the lead, which stays in the centre" },
        orbit:     { mode: "extra", byDefault: "no: only when you switch the movement on", where: "the whole clip, one slow lap every four bars (best on headphones)",
                     use: "you asked for stereo movement",
                     never: "by itself" },
        delay:     { mode: "extra", byDefault: "yes", where: "the last word of lines that have room for the echo to ring out",
                     use: "a line ends with a pause long enough for the repeats",
                     never: "on the whole take, or on a line with no pause after it (the repeats would run into the next line)" },
        reverb:    { mode: "chain", where: "the whole clip",
                     use: "every clip gets room; the size follows the tempo, the style and how full the beat is",
                     never: "no more than a touch when the take already has room sound in it" },
        limit:     { mode: "chain", where: "the whole clip, last in the chain",
                     use: "the take peaks above -1.5 dBFS",
                     never: "the take already has headroom" }
    };

    const entry = (id) => POLICY[id] || null;
    const modeOf = (id) => (POLICY[id] ? POLICY[id].mode : null);
    // A plugin Autopilot has no line for is treated like a hand tool: left exactly as it is. (The test makes sure none is unknown.)
    const isHand = (id) => { const m = modeOf(id); return m !== "chain" && m !== "extra"; };
    // ids (from VLFx.ORDER) that have no entry: the test and the Auto tab both look for these
    const missing = (ids) => (ids || []).filter((id) => !POLICY[id]);

    // Did the person fix this clip's notes by hand? fxrack.js marks the log entry when a chain with the Pitch editor is applied;
    // splits and pastes copy the log, so the mark follows the audio.
    const handPitched = (clip) => !!(clip && clip.fxLog && clip.fxLog.some((z) => z && z.hand && z.hand.indexOf("pitchedit") >= 0));

    // Keep the brain's answer inside the policy. Hand tools are never in a chain Autopilot makes, and a clip whose notes were fixed by hand
    // is not tuned again. Changes the arrays in place and returns what it did (the plan shows it).
    function respectHandWork(chain, findings, clip) {
        const did = { removed: [], handPitched: handPitched(clip) };
        for (let i = chain.length - 1; i >= 0; i--) {
            const t = chain[i].type;
            if (isHand(t) || (t === "tune" && did.handPitched)) { did.removed.push(t); chain.splice(i, 1); }
        }
        if (did.handPitched && findings) findings.push({ ok: true, text: "You fixed notes by hand in this clip, so Autopilot left the tuning alone and kept your notes as you set them." });
        return did;
    }
    // "Auto this" builds a new chain; a hand tool already on the chain (your note moves) stays exactly as it was.
    function keepHand(oldChain, newChain) {
        const keep = (oldChain || []).filter((p) => isHand(p.type));
        return keep.concat((newChain || []).filter((p) => !isHand(p.type)));
    }

    // Rows for the Auto tab: what Autopilot does with each plugin. `nameOf(id)` gives the plugin's display name.
    function describe(ids, nameOf) {
        return (ids || []).map((id) => {
            const p = POLICY[id];
            return p ? { id, name: nameOf ? nameOf(id) : id, mode: p.mode, where: p.where, use: p.use, never: p.never, byDefault: p.byDefault || "" }
                     : { id, name: nameOf ? nameOf(id) : id, mode: "unknown", where: "", use: "", never: "", byDefault: "" };
        });
    }

    root.VLAutoPolicy = { POLICY, entry, modeOf, isHand, missing, handPitched, respectHandWork, keepHand, describe };
    if (typeof module !== "undefined" && module.exports) module.exports = root.VLAutoPolicy;
})(typeof window !== "undefined" ? window : globalThis);
