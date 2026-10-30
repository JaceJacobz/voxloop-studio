/**
 * Voxloop — Pipeline brain (mixing and mastering)
 *
 * The Pipeline used to start from fixed tables (one set of numbers per style) and then adjust a few of them.
 * This module listens to the beat (its vibe: energy, brightness, how full it is, tempo, genre) and to the vocal
 * (range, sung or rapped, noise, clipping, dynamics, harshness) and turns that into the actual settings, so:
 *
 *   - the compressors follow the vocal's dynamics and the song's tempo,
 *   - the style tables become STARTING POINTS that are moved by what was heard,
 *   - harshness control, loudness target, glue and limiting are worked out for this song,
 *   - the tuning step sets its own speed from the genre and how the person sings.
 *
 * Every function is pure: same beat + same vocal = same answer, and each returns plain-language `notes`
 * that end up in the mix report ("why did it do that?").
 *
 * Needs: fxbrain.js (VLBrain) + fxrack-dsp.js (VLFx). If either is missing every function returns null and the
 * Pipeline falls back to its previous behaviour, so nothing breaks.
 */
(function (root) {
    "use strict";

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, u) => a + (b - a) * u;
    const mapc = (x, a, b, c, d) => lerp(c, d, clamp((x - a) / ((b - a) || 1), 0, 1));
    const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r05 = (v) => Math.round(v * 2) / 2;
    const ready = () => !!(root.VLBrain && root.VLFx && root.VLBrain.vibeOf);
    const channelsOf = (buf, maxSec) => {
        const out = [], n = maxSec ? Math.min(buf.length, Math.floor(buf.sampleRate * maxSec)) : buf.length;
        for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) out.push(buf.getChannelData(c).subarray(0, n));
        return out;
    };

    // How each style likes things to start. These are the priors; every one gets moved by what is heard.
    const GENRE = () => (root.VLBrain && root.VLBrain.GENRE) || {};
    const STYLE_TO_GENRE = { afrobeats: "afrobeats", amapiano: "amapiano", trap: "trap", rap: "rap", rnb: "rnb", universal: "universal", clean: "universal" };
    // loudness a finished song of this style usually sits at (LUFS), before the beat and the take move it
    const IDEAL_LUFS = { afrobeats: -12, amapiano: -12, trap: -10, rap: -10.5, rnb: -13.5, universal: -12.5 };
    const PUSH_BAND = { afrobeats: 1.0, amapiano: 1.0, trap: 1.2, rap: 1.2, rnb: 0.8, universal: 1.0 };

    // ------------------------------------------------------------------ listen: build the picture of this beat + this vocal
    const cache = new WeakMap();

    async function profile(state, o) {
        if (!ready()) return null;
        o = o || {};
        const beat = o.beat || state.beatBuffer, vocal = o.vocal || state.tunedVocal || state.preparedVocal || state.vocalBuffer;
        if (!beat || !vocal) return null;
        const keyId = (o.styleId || "") + "|" + (o.key ? o.key.rootPc + o.key.scale : "");
        const hit = cache.get(vocal);
        if (hit && hit.beat === beat && hit.styleId === keyId) return hit.ctx;

        const B = root.VLBrain, Fx = root.VLFx;
        const bpm = (state && (state.beatBpm || state.bpm)) || null;
        const bch = channelsOf(beat, 240);
        const vibe = B.vibeOf(bch, beat.sampleRate, bpm);

        let genre = null;
        if (o.genreInfo && o.genreInfo.styleId) genre = { id: o.genreInfo.styleId, label: o.genreInfo.label, decided: o.genreInfo.decided, genreId: o.genreInfo.decided ? (o.genreInfo.sub === "amapiano" ? "amapiano" : o.genreInfo.styleId) : "universal", confidence: o.genreInfo.confidence };
        else if (o.styleId && o.styleId !== "auto" && STYLE_TO_GENRE[o.styleId]) genre = { id: o.styleId, label: o.styleId, decided: true, genreId: STYLE_TO_GENRE[o.styleId] };
        else genre = B.genreOf(bch, beat.sampleRate, bpm);
        const genreId = (genre && genre.genreId) || "universal";

        const vch = channelsOf(vocal, 200);
        const meas = B.measureVocal(vch, vocal.sampleRate);
        let key = null;
        if (o.key && o.key.rootPc != null) key = { rootPc: o.key.rootPc, scale: o.key.scale || "major", label: "" };
        else if (state && state.beatKey && state.beatKey.key) key = B.parseKey(state.beatKey.key + " " + (state.beatKey.scale || "major"));
        let pitch = null;
        try {
            const mono = root.VLFx.util.mono(channelsOf(vocal, 90));
            pitch = await Fx.runTask("analyze", { mono, sr: vocal.sampleRate, rootPc: key ? key.rootPc : 0, scale: key ? key.scale : "major" });
        } catch (e) { pitch = null; }
        const prof = B.profileVocal(meas, pitch);

        // the beat on its own: how loud, and how much louder its peaks are than its average
        let beatLufs = null, beatPlr = null;
        const L = root.VocalVaultLevels && root.VocalVaultLevels.engine;
        if (L) {
            try {
                beatLufs = L.integrated(L.momentary(L.hopPowers(bch, beat.sampleRate)));
                let pk = 0; for (const c of bch) for (let i = 0; i < c.length; i += 3) { const v = Math.abs(c[i]); if (v > pk) pk = v; }
                beatPlr = 20 * Math.log10(Math.max(pk, 1e-6)) - beatLufs;
            } catch (e) { beatLufs = null; }
        }
        const ctx = { vibe, genre, genreId, bpm, beatMs: bpm ? 60000 / bpm : 600, meas, prof, pitch, key, beatLufs, beatPlr,
            vibeText: describeVibe(vibe, genre, bpm), vocalText: prof.label };
        cache.set(vocal, { beat, styleId: keyId, ctx });
        return ctx;
    }

    function describeVibe(v, genre, bpm) {
        return (genre && genre.decided ? genre.label + " · " : "") + (bpm ? Math.round(bpm) + " BPM · " : "") + v.mood;
    }

    // ------------------------------------------------------------------ 1. compressors: follow the vocal and the song
    function chain(ctx) {
        const { meas, prof, genreId, bpm, beatMs } = ctx, g = GENRE()[genreId] || GENRE().universal || { comp: 1 };
        const q = prof.quality, notes = [];
        const spike = clamp((meas.crestDb - 8) / 10, 0, 1);              // how peaky the take is
        const wide = clamp((meas.rangeDb - 6) / 8, 0, 1);                // how far loud and quiet words are apart
        const rapped = prof.delivery === "rapped";
        const peak = {
            ratio: r1(lerp(4, 8, spike) * (0.8 + 0.2 * q)),
            knee: q < 0.7 ? 6 : 4,
            attack: (rapped ? 0.003 : 0.005),
            release: clamp(beatMs * 0.12, 35, 90) / 1000
        };
        const lev = {
            ratio: r1(clamp((1.8 + 1.9 * wide) * g.comp * (0.8 + 0.2 * q), 1.6, 4.2)),
            knee: 12,
            attack: (rapped ? 0.015 : 0.03) * (bpm && bpm < 90 ? 1.2 : 1),
            release: clamp(beatMs / 2, 100, 320) / 1000
        };
        notes.push("Compression follows this take: peak catcher " + peak.ratio + ":1 (" + (spike > 0.5 ? "it has sharp peaks" : spike < 0.2 ? "few sharp peaks" : "some sharp peaks") + "), leveler " + lev.ratio + ":1, letting go every " + Math.round(lev.release * 1000) + " ms to move with the beat (an eighth note at " + (bpm ? Math.round(bpm) + " BPM" : "a typical tempo") + ")." + (q < 0.7 ? " Kept gentler because the take is rough and heavy compression would lift the noise." : ""));
        return { peak, leveler: lev, notes };
    }

    // ------------------------------------------------------------------ 2. the style tables become starting points
    function adaptRecipe(recipe, ctx) {
        if (!recipe || !ctx) return recipe;
        const { vibe, prof, meas, genreId, bpm } = ctx, B = vibe;
        const r = JSON.parse(JSON.stringify(recipe)), notes = [];
        r.eq = r.eq || { presenceDb: r.presenceDb, airDb: r.airDb, cutStrength: r.cutStrength, boostStrength: r.boostStrength };
        const q = prof.quality;

        // clarity where the beat crowds the words; air where the beat is dark; less top on a bright beat or a noisy take
        const presMask = B.bands ? mapc(B.bands[5], -13, -9, 0, 1) : 0;
        const mudMask = B.bands ? mapc(B.bands[2], -9, -5, 0, 1) : 0;
        let pres = r.eq.presenceDb * (0.85 + 0.45 * presMask), air = r.eq.airDb * mapc(B.bright, 0.25, 0.8, 1.3, 0.55);
        if (q < 0.7) { pres = Math.min(pres, 1.0); air = Math.min(air, 0.8); }
        r.eq.presenceDb = r.presenceDb = r2(clamp(pres, 0, 1.6)); r.eq.airDb = r.airDb = r2(clamp(air, 0, 1.5));
        r.eq.boostStrength = r.boostStrength = r2(clamp(r.eq.boostStrength * (0.6 + 0.4 * q), 0.15, 0.7));
        r.eq.cutStrength = r.cutStrength = r2(clamp(r.eq.cutStrength * (0.9 + 0.35 * mudMask), 0.3, 0.9));
        if (presMask > 0.4) notes.push("The beat is strong where the words live (2.5–5 kHz), so the voice gets a little more clarity.");
        if (B.bright > 0.65) notes.push("The beat is bright, so the top end of the voice is held back to avoid piling up harshness.");
        else if (B.bright < 0.35) notes.push("The beat is dark and warm, so the voice can carry more air.");
        if (mudMask > 0.4) notes.push("The beat is dense around 300 Hz, so the voice's boxy low-mids are cut a bit harder to leave room.");

        // warmth: only as much as the take can take
        r.sat.mix = r2(clamp(r.sat.mix * (0.5 + 0.5 * q), 0.02, 0.18));
        if (q < 0.5) r.sat.drive = Math.min(r.sat.drive, 1.2);

        // space follows how much room the beat leaves, its tempo and its energy (the style value is the starting size)
        const tempoScale = bpm ? clamp(Math.sqrt(100 / bpm), 0.75, 1.25) : 1;
        r.reverbScale = r2(clamp(r.reverbScale * (0.65 + 0.7 * B.space) * tempoScale, 0.25, 1.6));
        r.reverbBelowAdd = r1(r.reverbBelowAdd + (0.5 - B.space) * 4);
        r.echoScale = r2(clamp(r.echoScale * (0.7 + 0.6 * B.space), 0.3, 1.4));
        r.echoBelowAdd = r1(r.echoBelowAdd + (0.5 - B.space) * 3 + (B.energy - 0.5) * 1.5);
        r.midDuckScale = r2(clamp(r.midDuckScale * (0.75 + 0.7 * B.busy), 0.5, 1.6));
        notes.push("Space: " + (B.space < 0.4 ? "the beat is full, so reverb and echo are kept small and further back" : B.space > 0.7 ? "the beat has room, so reverb and echo can open up" : "the beat is moderately full, so reverb and echo are moderate") + " (" + (bpm ? Math.round(bpm) + " BPM" : "typical tempo") + ", " + (B.energy > 0.66 ? "hard-hitting" : B.energy < 0.36 ? "laid-back" : "mid-energy") + ").");

        // compression tightening: peaky or wide-ranging takes get more; steady takes less
        const gComp = (GENRE()[genreId] || { comp: 1 }).comp;
        r.compressTightenDb = r1(clamp(r.compressTightenDb + (meas.rangeDb - 9) * 0.2 + (gComp - 1) * 2, -3, 4.5));

        // beat repair: only as far as the beat is really thin
        r.beatEnhanceStrength = r2(clamp(r.beatEnhanceStrength * mapc(B.lowWeight, 0.15, 0.8, 1.2, 0.85), 0.4, 1.6));

        // how far above the beat the voice sits: busier, harder beats need a touch more
        r.vocalAboveBeatDb = r2(clamp((r.vocalAboveBeatDb || 0) + (B.energy - 0.5) * 0.3 + (B.busy - 0.5) * 0.2, -2, 0.25));
        if (prof.delivery === "rapped") r.vocalAboveBeatDb = r2(Math.min(0.25, r.vocalAboveBeatDb + 0.1));

        r._vibeNotes = notes;
        return r;
    }

    // ------------------------------------------------------------------ 3. harshness control: how firm, from this voice and this beat
    function harshness(ctx) {
        const { meas, vibe } = ctx;
        const sib = clamp((meas.sibIdx - 8) / 8, 0, 1);
        const bright = clamp((vibe.bright - 0.4) / 0.6, 0, 1);
        const topHeavy = meas.bands ? clamp(((meas.bands[6] + meas.bands[7]) / 2 + 17) / 8, 0, 1) : 0.3;       // the voice itself is bright
        const sev = clamp(0.5 * sib + 0.3 * bright + 0.2 * topHeavy, 0, 1);
        const calm = { amount: r2(lerp(0.6, 1, sev)), sibTargetDb: r1(lerp(-11, -16, sev)), presTargetDb: r1(lerp(-15, -20, sev)), maxSibCutDb: r1(lerp(7, 10, sev)), maxPresCutDb: r1(lerp(4.5, 7, sev)), ratio: 8 };
        const level = sev < 0.25 ? "gentle" : sev < 0.6 ? "standard" : "firm";
        const why = [];
        if (meas.sibIdx > 11) why.push("sharp S sounds");
        if (vibe.bright > 0.62) why.push("a bright beat makes edge stand out");
        if (topHeavy > 0.6) why.push("the voice itself is bright");
        const note = "Harshness control set to " + level + " for this voice and beat" + (why.length ? ": " + why.join(", ") + "." : ": nothing harsh stood out, so it only watches for trouble.");
        return { calm, level, sev, note };
    }

    // ------------------------------------------------------------------ 4. level matching: how far, how fast
    function levels(ctx) {
        const { vibe, prof, bpm } = ctx;
        const barSec = bpm ? 240 / bpm : 2.4;
        const o = {
            maxGainDb: r1(3 + 3 * prof.quality),                                       // rough takes are not pushed as far
            rangeDb: r1(clamp(3 + 0.35 * (vibe.dynamicsDb || 6), 3, 7)),              // songs that rise and fall a lot need a bigger ride
            beatWindowSec: r1(clamp(barSec * 1.25, 2, 5)),                            // follow the beat's sections at about a bar's pace
            vocalWindowSec: prof.delivery === "rapped" ? 0.6 : prof.delivery === "mixed" ? 0.8 : 1.2,
            smoothSec: r2(clamp(60 / (bpm || 100) * 0.8, 0.25, 0.6))
        };
        const note = "Level riding: up to ±" + o.rangeDb + " dB (this beat " + (vibe.dynamicsDb > 8 ? "changes a lot" : "stays fairly even") + "), following the beat at a bar's pace (" + o.beatWindowSec + " s) and the " + (prof.delivery === "rapped" ? "rapped" : "singing") + " phrases at " + o.vocalWindowSec + " s." + (prof.quality < 0.7 ? " The boost is capped at +" + o.maxGainDb + " dB because the take is rough." : "");
        return { options: o, note };
    }

    // ------------------------------------------------------------------ 5. master: target loudness, glue, limiting for this song
    function master(ctx) {
        const { vibe, prof, genreId, beatMs, beatLufs, beatPlr } = ctx;
        const notes = [];
        const ideal = IDEAL_LUFS[genreId] != null ? IDEAL_LUFS[genreId] : -12.5;
        let t = ideal + 1.2 * (vibe.energy - 0.5);
        let why = (ctx.genre && ctx.genre.decided ? ctx.genre.label : "this kind of song") + " usually sits near " + ideal + " LUFS";
        if (beatPlr != null && beatPlr > 13) { const d = clamp((beatPlr - 13) * 0.4, 0, 2.5); t -= d; why += "; the beat has big peaks (" + beatPlr.toFixed(0) + " dB above its average) so I kept it more open by " + d.toFixed(1) + " LU"; }
        if (beatLufs != null && beatLufs > t + 1.5) { t = Math.min(beatLufs + 0.5, t + 1.5); why += "; the beat is already loud (" + beatLufs.toFixed(1) + " LUFS), so I match it instead of squashing it further"; }
        if (prof.quality < 0.6) { t -= 1; why += "; a rough take is kept less loud so limiting doesn't spotlight the noise"; }
        else if (prof.quality < 0.8) t -= 0.5;
        t = clamp(r05(t), -16, -9);
        const energy = vibe.energy;
        const glueOpts = {
            ratio: r2(1.4 + 0.5 * energy),
            attackSec: r2(0.025 + 0.03 * (1 - energy)),
            releaseSec: r2(clamp(beatMs * 0.45 / 1000, 0.18, 0.45)),
            aboveLoudDb: r1(6 + 3 * (1 - energy))
        };
        let maxLimiterDb = 3.5 + 2 * energy;
        if (vibe.dynamicsDb > 9) maxLimiterDb -= 0.5;
        if (prof.quality < 0.6) maxLimiterDb -= 0.5;
        maxLimiterDb = r1(clamp(maxLimiterDb, 2.5, 5.5));
        notes.push("Loudness target " + t + " LUFS: " + why + ".");
        notes.push("Glue compression " + glueOpts.ratio + ":1, releasing in " + Math.round(glueOpts.releaseSec * 1000) + " ms (in time with the beat); the limiter may work up to " + maxLimiterDb + " dB because the song is " + (energy > 0.66 ? "hard-hitting" : energy < 0.36 ? "laid-back" : "mid-energy") + ".");
        return { targetLufs: t, glueOpts, maxLimiterDb, notes };
    }

    // ------------------------------------------------------------------ 6. echo time that fits the singer's pauses
    function echo(ctx, fallback) {
        const gaps = ((ctx.meas && ctx.meas.phrases) || []).map((p) => p.gapAfter).filter((g) => g > 0.25 && g < 20).sort((a, b) => a - b);
        if (gaps.length < 3 || !ctx.bpm) return fallback || null;
        const med = gaps[Math.floor(gaps.length * 0.5)], beat = 60 / ctx.bpm;
        const opts = [[beat, "a quarter note"], [beat * 0.75, "a dotted eighth note"], [beat / 2, "an eighth note"], [beat / 4, "a sixteenth note"]];
        const fit = opts.find((o) => o[0] >= 0.18 && o[0] <= 0.55 && o[0] <= med / 2.5) || opts.filter((o) => o[0] >= 0.18).pop() || opts[2];
        return { sec: fit[0], label: fit[1], note: "Echo timed to " + fit[1] + " so its repeats finish inside the singer's usual pause (" + med.toFixed(1) + " s)." };
    }

    // ------------------------------------------------------------------ 6b. reverb tail: the tempo gives the base, genre and room decide how far it opens
    function reverbTail(ctx, tail) {
        const g = GENRE()[ctx.genreId] || GENRE().universal || { decay: 1.6 };
        return r2(clamp(tail * Math.sqrt(g.decay / 1.6) * (0.85 + 0.3 * ctx.vibe.space), 0.5, 2.2));
    }

    // ------------------------------------------------------------------ 6c. the gate between phrases: never audible as an on/off step
    // A gate that is too deep or too fast is the thing that makes a take sound like it "came with noise": the room is there
    // while you sing and vanishes the instant you stop. So it is shallow on a sparse beat (where there is nothing to hide
    // behind), only deep when the beat is busy, and it lets go slowly, in time with the music.
    function gate(ctx) {
        const { vibe: B, prof, beatMs } = ctx;
        const depthDb = r1(clamp(lerp(2.5, 7, B.busy) + (prof.quality < 0.6 ? 1.5 : 0), 2, 7));
        const releaseSec = r2(clamp(beatMs * 0.6 / 1000, 0.3, 0.7));
        const holdSec = 0.25;
        return { opts: { depthDb, releaseSec, holdSec }, note: "The gate between lines is limited to " + depthDb + " dB and lets go over about " + Math.round(releaseSec * 1000) + " ms" + (B.busy < 0.4 ? " (kept shallow because the beat is sparse and a deeper gate would be heard)" : B.busy > 0.65 ? " (a bit deeper because the busy beat hides it)" : "") + ", so the room between lines isn't switched off." };
    }

    // ------------------------------------------------------------------ 6d. ambient bloom: the "ocean" that keeps the song breathing after the singer stops
    function bloom(ctx, mode) {
        mode = mode || "auto";
        const { vibe: B, prof, genreId, beatMs, bpm, meas } = ctx;
        const G = { rnb: 1.2, afrobeats: 1.0, amapiano: 1.1, universal: 0.9, trap: 0.6, rap: 0.4 }[genreId];
        const g = G != null ? G : 0.9;
        if (mode === "auto") {
            if (g < 0.5 && B.busy > 0.5) return { use: false, notes: ["Ambient bloom left off: this style is kept dry and tight."] };
            if (B.space < 0.15) return { use: false, notes: ["Ambient bloom left off: the beat is so full that a wash would just blur it."] };
        }
        const inten = { subtle: 0.6, natural: 1, rich: 1.6, auto: 1 }[mode] || 1;
        const wetTake = meas && meas.tailDb != null && meas.tailDb > -24;                 // the take already has its own room sound
        const f = inten * g * (0.5 + 1.0 * B.space) * (0.7 + 0.3 * prof.quality) * (wetTake ? 0.6 : 1);
        const belowDb = r1(clamp(22 - 20 * Math.log10(f) + 3 * B.busy, 14, 34));
        const rt60 = r1(clamp(beatMs * 4 / 1000 * 0.9 * Math.sqrt(clamp(g, 0.8, 1.2)), 1.8, 4.2));      // about a bar of tail
        const swellSec = r2(clamp(beatMs * 0.9 / 1000, 0.35, 0.8));
        const lp = Math.round(lerp(5200, 3600, B.bright));
        return { use: true, options: { rt60, belowDb, duckDepth: 0.65, swellSec, lp, hp: 350 },
            notes: ["Ambient bloom (" + (mode === "auto" ? "calculated for this song" : mode) + "): a " + rt60 + " s dark wash " + belowDb + " dB under the voice that sits back while you sing and swells up over " + Math.round(swellSec * 1000) + " ms after each line, so the room keeps breathing instead of going dead the instant you stop" + (B.busy > 0.62 ? " (pulled back because the beat is full)" : B.space > 0.7 ? " (a little fuller because the beat has room)" : "") + (wetTake ? "; reduced because the take already has room sound" : "") + "."] };
    }

    // ------------------------------------------------------------------ 7. beat repair caps: a noisy take must not get a brighter beat
    function enhanceCaps(ctx) {
        const { prof, vibe } = ctx, q = prof.quality;
        const hush = (q < 0.7 ? 0.7 : 1) * mapc(vibe.bright, 0.5, 0.9, 1, 0.7);
        return { capHat: r1(2.0 * hush), capAir: r1(1.8 * hush), capPres: r1(2.2 * (q < 0.7 ? 0.85 : 1)) };
    }

    // ------------------------------------------------------------------ 8. the Tune step
    function tune(ctx) {
        const { prof, genreId, pitch, vibe } = ctx, g = GENRE()[genreId] || GENRE().universal || { tune: 30 };
        const st = pitch && pitch.stats, w25 = st ? st.within25Pct : 60;
        const raw = clamp((92 - w25) / 50, 0, 1);
        const retuneMs = Math.round(clamp(g.tune * (prof.delivery === "mixed" ? 1.3 : 1) * (1 - 0.3 * raw), 3, 120) / 5) * 5 || 5;
        const flatten = Math.round(clamp(0.4 + (g.tune < 15 ? 0.15 : g.tune > 50 ? -0.12 : 0) + 0.1 * raw, 0.2, 0.7) * 20) * 5;
        const strength = prof.delivery === "mixed" ? 85 : 100;
        const notes = ["Pitch fix set for " + (ctx.genre && ctx.genre.decided ? ctx.genre.label : "this song") + " and a " + prof.label + ": retune speed " + retuneMs + " ms (" + (retuneMs <= 15 ? "fast, a modern tuned sound" : retuneMs >= 50 ? "slow, keeps it natural" : "in between") + "), vibrato flattening " + flatten + "%, strength " + strength + "%" + (st ? "; " + Math.round(100 - w25) + "% of notes were more than a quarter-tone off" : "") + "."];
        if (prof.delivery === "rapped") notes.push("This sounds rapped or spoken, so talk-sing lines are left as performed.");
        return { retuneMs, flatten, strength, selectiveCents: Math.round(lerp(30, 18, raw)), selectiveSoftCents: Math.round(lerp(60, 44, raw)), notes };
    }

    root.VLMixBrain = { ready, profile, chain, adaptRecipe, harshness, levels, master, echo, reverbTail, gate, bloom, enhanceCaps, tune, IDEAL_LUFS };
})(typeof window !== "undefined" ? window : globalThis);
