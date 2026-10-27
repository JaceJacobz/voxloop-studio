/**
 * Voxloop Studio — Brain (auto-produce)
 *
 * Listens to a vocal clip and the beat, then decides which plugins are NEEDED and how strong they should be.
 * Rule: if the vocal does not have a problem, that tool is skipped and the report says so.
 * Creative flavours (doubles, crowd, echo throws, voice change) are only added when the person ticks them.
 *
 * Needs: fxrack-dsp.js (VLFx). Re-uses the Pipeline's own spectrum target (VocalVaultStudio.engine.planEq).
 */
(function (root) {
    "use strict";
    const Fx = root.VLFx;
    if (!Fx) return;
    const U = Fx.util, clamp = U.clamp, dbOf = U.linDb;
    const NOTE = Fx.NOTE_NAMES;

    const median = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const pct = (a, q) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
    const mkItem = (type, over, reason) => ({ type, params: Object.assign(Fx.withPreset(type, "Default"), over || {}), reason: reason || "", bypass: false });
    const engine = () => root.VocalVaultStudio && root.VocalVaultStudio.engine;

    // ---------------------------------------------------------------- key helpers
    function parseKey(label) {
        if (!label) return null;
        const m = String(label).match(/([A-G])\s*([#b♯♭]?)\s*(major|minor|dorian|mixolydian|lydian|phrygian|maj|min)?/i);
        if (!m) return null;
        let name = m[1].toUpperCase() + (m[2] === "♯" ? "#" : m[2] === "♭" ? "b" : m[2] || "");
        const flats = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
        if (flats[name]) name = flats[name];
        const rootPc = NOTE.indexOf(name);
        if (rootPc < 0) return null;
        let sc = (m[3] || "major").toLowerCase();
        if (sc === "maj") sc = "major"; if (sc === "min") sc = "minor";
        return { rootPc, scale: sc, label: name + " " + sc };
    }

    // Guess the key from the notes someone actually sang (used only when the beat's key is unknown)
    function keyFromNotes(notes, hopSec) {
        const hist = new Float64Array(12);
        for (const n of notes) hist[((Math.round(n.center) % 12) + 12) % 12] += Math.max(1, (n.end - n.start));
        const major = [0, 2, 4, 5, 7, 9, 11], minor = [0, 2, 3, 5, 7, 8, 10];
        let best = null;
        for (let r = 0; r < 12; r++) {
            for (const [name, set] of [["major", major], ["minor", minor]]) {
                let inside = 0; for (const d of set) inside += hist[(r + d) % 12];
                const tonic = hist[r] * 0.3 + hist[(r + (name === "major" ? 7 : 7)) % 12] * 0.1;
                const score = inside + tonic;
                if (!best || score > best.score) best = { rootPc: r, scale: name, score, label: NOTE[r] + " " + name };
            }
        }
        return best;
    }

    // ---------------------------------------------------------------- shared measuring helpers
    const lerp = (a, b, u) => a + (b - a) * u;
    const mapc = (x, a, b, c, d) => lerp(c, d, clamp((x - a) / (b - a || 1), 0, 1));        // map x from [a,b] to [c,d], clamped
    const BANDS = [["Sub", 30, 60], ["Bass", 60, 150], ["Low-mid", 150, 400], ["Mid", 400, 1000], ["Upper-mid", 1000, 2500], ["Presence", 2500, 5000], ["Brilliance", 5000, 10000], ["Air", 10000, 16000]];

    // Long-term tone in 8 bands, each as dB relative to the whole (so loudness does not matter)
    function bandProfile(ch, sr, maxSec) {
        const eng = engine(); if (!eng || !eng.fft) return null;
        const N = 4096, hop = 8192, maxN = Math.min(ch[0].length, Math.floor(sr * (maxSec || 90)));
        const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        const bins = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
        const en = []; for (let a = 0; a + N <= maxN; a += hop) { let e = 0; for (let i = 0; i < N; i += 8) { const v = ch[0][a + i]; e += v * v; } en.push(e); }
        if (!en.length) return null;
        const floor = Float64Array.from(en).sort()[Math.floor(en.length * 0.3)];
        let fi = 0, used = 0;
        for (let a = 0; a + N <= maxN; a += hop, fi++) {
            if (en[fi] < floor) continue;
            for (let i = 0; i < N; i++) { let v = ch[0][a + i]; if (ch.length > 1) v = 0.5 * (v + ch[1][a + i]); re[i] = v * win[i]; im[i] = 0; }
            eng.fft(re, im);
            for (let k = 1; k < N / 2; k++) bins[k] += re[k] * re[k] + im[k] * im[k];
            used++;
        }
        if (!used) return null;
        const hz = sr / N, p = BANDS.map(([n, lo, hi]) => { let s = 0; for (let k = Math.ceil(lo / hz); k <= Math.min(N / 2 - 1, Math.floor(hi / hz)); k++) s += bins[k]; return s; });
        const tot = p.reduce((x, y) => x + y, 0) || 1;
        return p.map((v) => 10 * Math.log10(Math.max(v / tot, 1e-12)));
    }

    // The beat's vibe from its audio alone (no tempo/key detection): big sections, how full, how bright, how heavy, how much room.
    // Shared by Studio Auto and the Pipeline so both hear the beat the same way.
    function vibeOf(chans, sr, bpm) {
        const info = { sections: [], busy: 0.5, loudDb: -20, bands: null };
        const x = chans[0];

        // bar-by-bar energy → which parts of the song are the big ones
        const barSec = bpm ? (4 * 60) / bpm : 2;
        const bar = Math.max(1, Math.round(barSec * sr)), bars = Math.floor(x.length / bar), lv = [];
        for (let b = 0; b < bars; b++) { let s = 0; const a = b * bar; for (let i = a; i < a + bar; i += 4) s += x[i] * x[i]; lv.push(10 * Math.log10(Math.max(1e-12, s / (bar / 4)))); }
        if (lv.length >= 4) {
            const thr = (median(lv) + pct(lv, 0.9)) / 2;
            let cur = null;
            lv.forEach((v, b) => {
                if (v >= thr && v > median(lv) + 1) { if (!cur) cur = { start: b * barSec, end: (b + 1) * barSec }; else cur.end = (b + 1) * barSec; }
                else if (cur) { if (cur.end - cur.start >= barSec * 2) info.sections.push(cur); cur = null; }
            });
            if (cur && cur.end - cur.start >= barSec * 2) info.sections.push(cur);
            info.loudDb = median(lv);
            info.dynamicsDb = pct(lv, 0.9) - pct(lv, 0.1);          // how much the song rises and falls
        }
        // how crowded the middle of the beat is (where the voice lives)
        try {
            const m = x.subarray(0, Math.min(x.length, sr * 30));
            const midBand = U.bqRun(U.bqRun(m, U.bqCoef("hp", 300, sr, 0.7)), U.bqCoef("lp", 3500, sr, 0.7));
            info.busy = clamp((dbOf(U.rms(midBand)) - dbOf(U.rms(m)) + 8) / 8, 0, 1);
        } catch (e) { /* keep default */ }
        // tone of the beat → brightness and low-end weight (these steer EQ, reverb colour and how much "air" to add)
        try { info.bands = bandProfile(chans, sr, 90); } catch (e) { info.bands = null; }
        if (info.bands) {
            info.bright = mapc((info.bands[6] + info.bands[7]) / 2, -17, -9, 0, 1);
            info.lowWeight = mapc((info.bands[0] + info.bands[1]) / 2, -12, -4, 0, 1);
        } else { info.bright = 0.5; info.lowWeight = 0.5; }
        info.energy = mapc(info.loudDb, -32, -14, 0, 1) * 0.65 + mapc(info.dynamicsDb || 0, 3, 14, 0, 1) * 0.15 + info.busy * 0.2;
        info.space = clamp(1 - 0.55 * info.busy - 0.35 * info.energy - 0.1 * info.lowWeight, 0.08, 1);     // how much room there is for wet effects

        // a few words a person would use for the beat
        const w = [];
        w.push(info.energy > 0.66 ? "hard-hitting" : info.energy < 0.36 ? "laid-back" : "mid-energy");
        w.push(info.bright > 0.62 ? "bright" : info.bright < 0.36 ? "warm and dark" : "balanced tone");
        w.push(info.busy > 0.66 ? "busy" : info.busy < 0.4 ? "spacious" : "moderately full");
        info.mood = w.join(", ");
        return info;
    }

    // The Pipeline's own genre sensor (so Studio and Pipeline agree on what the beat is). Returns null if unsure.
    function genreOf(chans, sr, bpm) {
        const G = root.VocalVaultGenre;
        if (!(G && G.detect)) return null;
        try {
            const g = G.detect(chans.map((c) => c.subarray(0, Math.min(c.length, sr * 75))), sr, { bpm: bpm || 100 });
            if (!g) return null;
            return { id: g.styleId, label: g.label, confidence: g.confidence, decided: g.decided, sub: g.sub, reasons: g.reasons || [], genreId: g.decided ? (g.sub === "amapiano" ? "amapiano" : g.styleId) : "universal" };
        } catch (e) { return null; }
    }

    // ---------------------------------------------------------------- the beat: tempo, key, sections AND vibe
    const beatCache = new WeakMap();
    async function analyzeBeat(buf) {
        if (!buf) return null;
        if (beatCache.has(buf)) return beatCache.get(buf);
        const info = { bpm: null, key: null, sections: [], busy: 0.5, loudDb: -20, source: {}, genreId: "universal", genre: null, bands: null };
        const known = root.VocalVaultKnownBeat;
        if (known && known.buffer === buf) {
            if (known.bpm > 30) { info.bpm = known.bpm; info.source.bpm = "Beat Lab"; }
            const k = parseKey(known.key); if (k) { info.key = k; info.source.key = "Beat Lab"; }
        }
        const A = root.VocalVaultAnalysis;
        if (A && !info.bpm) { try { const r = await A.analyzeBpm(buf); if (r && r.bpm) { info.bpm = r.bpm; info.source.bpm = "listened"; } } catch (e) { /* ignore */ } }
        if (A && !info.key) { try { const r = A.detectKey(buf); const k = r && r.key ? parseKey(r.key + " " + r.scale) : null; if (k) { info.key = k; info.source.key = "listened"; info.keyConfidence = r.confidence; } } catch (e) { /* ignore */ } }

        const sr = buf.sampleRate;
        const chans = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
        Object.assign(info, vibeOf(chans, sr, info.bpm));
        const gen = genreOf(chans, sr, info.bpm);
        if (gen) { info.genre = gen; info.genreId = gen.genreId; }
        beatCache.set(buf, info);
        return info;
    }

    // ---------------------------------------------------------------- the vocal: levels, tone, pitch, delivery, quality
    function measureVocal(ch, sr) {
        const m = U.mono(ch), blk = Math.round(0.05 * sr), nb = Math.floor(m.length / blk), db = [];
        for (let b = 0; b < nb; b++) { let s = 0; const a = b * blk; for (let i = a; i < a + blk; i++) s += m[i] * m[i]; db.push(10 * Math.log10(Math.max(1e-12, s / blk))); }
        const top = Math.max.apply(null, db.concat([-90]));
        const thr = Math.max(top - 32, -66);
        const act = db.map((v) => v >= thr);
        const lvls = db.filter((v, i) => act[i]);
        const out = { seconds: m.length / sr, activeSec: lvls.length * 0.05, peakDb: dbOf(U.peak(ch)), levelDb: median(lvls), p10: pct(lvls, 0.1), p90: pct(lvls, 0.9), levels: lvls };
        out.rangeDb = out.p90 - out.p10;
        out.crestDb = out.peakDb - out.levelDb;
        out.noiseDb = db.length > 12 ? pct(db, 0.08) : null;                    // the quietest blocks = background noise
        out.snrDb = out.noiseDb != null ? out.levelDb - out.noiseDb : null;
        let clip = 0, tot = 0; for (const c of ch) { for (let i = 0; i < c.length; i += 2) { if (Math.abs(c[i]) >= 0.985) clip++; tot++; } }
        out.clipPct = tot ? clip / tot * 100 : 0;

        const lowR = U.bqRun(U.bqRun(m, U.bqCoef("lp", 80, sr, 0.7)), U.bqCoef("lp", 80, sr, 0.7));
        out.rumbleDb = dbOf(U.rms(lowR)) - dbOf(U.rms(m));

        const hf = U.bqRun(U.bqRun(m, U.bqCoef("hp", 5000, sr, 0.7)), U.bqCoef("hp", 5000, sr, 0.7));
        const b20 = Math.round(0.02 * sr), hfDb = [];
        for (let a = 0; a + b20 <= m.length; a += b20) {
            const bi = Math.min(nb - 1, Math.floor(a / blk));
            if (!act[bi]) continue;
            let s = 0; for (let i = a; i < a + b20; i++) s += hf[i] * hf[i];
            hfDb.push(10 * Math.log10(Math.max(1e-12, s / b20)));
        }
        out.sibIdx = hfDb.length > 20 ? pct(hfDb, 0.96) - median(hfDb) : 0;

        const drops = [];
        for (let b = 2; b < nb - 7; b++) {
            if (act[b - 1] && act[b - 2] && !act[b] && !act[b + 1] && !act[b + 2]) {
                drops.push(Math.max(db[b + 4], db[b + 5]) - Math.max(db[b - 1], db[b - 2]));
                b += 8;
            }
        }
        out.tailDb = drops.length >= 2 ? median(drops) : null;

        const phr = []; let cur = null, gap = 0;
        for (let b = 0; b < nb; b++) {
            if (act[b]) { if (!cur) cur = { start: b * 0.05, end: (b + 1) * 0.05 }; else cur.end = (b + 1) * 0.05; gap = 0; }
            else if (cur) { gap++; if (gap >= 9) { phr.push(cur); cur = null; gap = 0; } }
        }
        if (cur) phr.push(cur);
        out.phrases = phr.map((p, i) => Object.assign(p, { gapAfter: i < phr.length - 1 ? phr[i + 1].start - p.end : 99 }));

        out.eq = null;
        const eng = engine();
        if (eng) { try { const meas = eng.bandSpectrum(ch, sr); if (meas) out.eq = eng.planEq(meas, { quietTake: out.levelDb < -30 }, sr); } catch (e) { out.eq = null; } }
        try { out.bands = bandProfile(ch, sr, 120); } catch (e) { out.bands = null; }
        return out;
    }

    // Who is singing and how clean is the take: this decides how gentle or bold the processing should be
    function profileVocal(meas, pitch) {
        const p = { f0: null, range: "unknown", delivery: "unknown", sustained: null, quality: 1, qualityNotes: [], label: "" };
        if (pitch && pitch.midi) {
            const v = []; for (let i = 0; i < pitch.midi.length; i++) { const m = pitch.midi[i]; if (!isNaN(m)) v.push(m); }
            if (v.length > 30) { const med = median(v); p.f0 = 440 * Math.pow(2, (med - 69) / 12); p.range = p.f0 < 150 ? "low" : p.f0 < 235 ? "mid" : "high"; }
            const hopSec = pitch.hop / pitch.sr;
            if (pitch.notes && pitch.notes.length) {
                let voiced = 0, sus = 0;
                pitch.notes.forEach((n) => { const d = (n.end - n.start) * hopSec; voiced += d; if (d >= 0.22) sus += d; });
                p.sustained = voiced > 0 ? sus / voiced : 0;
                p.delivery = p.sustained >= 0.55 ? "sung" : p.sustained >= 0.3 ? "mixed" : "rapped";
            }
        }
        // take quality: noise, clipping, room
        if (meas.snrDb != null) { if (meas.snrDb < 22) { p.quality -= 0.3; p.qualityNotes.push("noisy (only " + meas.snrDb.toFixed(0) + " dB above the background)"); } else if (meas.snrDb < 32) { p.quality -= 0.12; p.qualityNotes.push("a little background noise"); } }
        if (meas.clipPct > 0.05) { p.quality -= 0.25; p.qualityNotes.push("clipping in places (" + meas.clipPct.toFixed(2) + "% of samples)"); }
        if (meas.tailDb != null && meas.tailDb > -18) { p.quality -= 0.1; p.qualityNotes.push("recorded in a live room"); }
        if (meas.levelDb < -42) { p.quality -= 0.1; p.qualityNotes.push("recorded very quietly"); }
        p.quality = clamp(p.quality, 0.2, 1);
        const who = p.range === "low" ? "low voice" : p.range === "high" ? "high voice" : p.range === "mid" ? "mid-range voice" : "voice";
        p.label = (p.delivery === "unknown" ? "" : p.delivery + " ") + who + (p.f0 ? " (~" + Math.round(p.f0) + " Hz)" : "") + ", " + (p.quality > 0.85 ? "clean take" : p.quality > 0.6 ? "decent take" : "rough take");
        return p;
    }

    // ---------------------------------------------------------------- house sound per style: the STARTING point; the measurements then move every number
    const GENRE = {
        afrobeats: { tune: 28, decay: 1.7, wet: 1.0, comp: 1.0, crowd: 1.0, dbl: 1.0 },
        amapiano:  { tune: 30, decay: 2.0, wet: 1.1, comp: 0.9, crowd: 1.0, dbl: 1.0 },
        trap:      { tune: 9,  decay: 1.1, wet: 0.8, comp: 1.25, crowd: 0.8, dbl: 1.1 },
        rap:       { tune: 35, decay: 0.9, wet: 0.6, comp: 1.3, crowd: 0.9, dbl: 1.1 },
        rnb:       { tune: 58, decay: 2.4, wet: 1.2, comp: 0.85, crowd: 0.35, dbl: 0.9 },
        universal: { tune: 30, decay: 1.6, wet: 1.0, comp: 1.0, crowd: 0.7, dbl: 1.0 }
    };
    const STYLE_MUL = { natural: { tune: 1.9, wet: 0.85, comp: 0.8, humanize: 55 }, polished: { tune: 1, wet: 1, comp: 1, humanize: 25 }, big: { tune: 0.55, wet: 1.3, comp: 1.2, humanize: 8 } };
    const LABEL = { main: "Main vocal", adlib: "Adlib", tag: "Tag", harmony: "Harmony", other: "Vocal" };
    const r1 = (v) => Math.round(v * 10) / 10, r05 = (v) => Math.round(v * 2) / 2;

    // ---------------------------------------------------------------- DECISIONS for one clip (pure: same vocal + same beat = same answer)
    function decide(type, V, B, style, key) {
        const find = [], chain = [], say = (ok, text) => find.push({ ok, text });
        const meas = V.meas, prof = V.prof, pitch = V.pitch, st = pitch && pitch.stats;
        const g = GENRE[B.genreId] || GENRE.universal, sm = STYLE_MUL[style] || STYLE_MUL.polished;
        const beatMs = B.bpm ? 60000 / B.bpm : 600;
        const gentle = prof.quality < 0.7;                                   // a rough take gets gentler boosts (boosting lifts the noise too)

        // ---- pitch
        if (prof.delivery === "rapped" && !V.forceTune) {
            say(true, "This sounds rapped or spoken (few held notes), so I left tuning off. Tuning would make it sound odd.");
        } else if (st && st.voicedFrames > 60) {
            const w25 = st.within25Pct;
            if (w25 >= 93 || (w25 >= 90 && type !== "main")) say(true, "Pitch is already tight (" + Math.round(w25) + "% within a quarter-tone), so no tuning needed.");
            else {
                const raw = clamp((92 - w25) / 50, 0, 1);
                let speed = g.tune * sm.tune * (prof.delivery === "mixed" ? 1.35 : 1) * (1 - 0.35 * raw);
                if (prof.sustained != null && prof.sustained > 0.8) speed *= 1.1;
                speed = Math.round(clamp(speed, 3, 120));
                say(false, "About " + Math.round(100 - w25) + "% of the singing drifts more than a quarter-tone from " + (key ? key.label : "the key") + (V.keyNote || "") + ".");
                chain.push(mkItem("tune", {
                    key: key ? NOTE[key.rootPc] : "auto", scale: key ? key.scale : "major", speed,
                    humanize: sm.humanize, flex: style === "natural" ? 20 : 0, amount: prof.delivery === "mixed" ? 85 : 100
                }, "Pulls the off-notes into " + (key ? key.label : "the key") + " at " + speed + " ms. " + (speed < 15 ? "That's fast, for the modern tuned sound that suits " + (B.genre ? B.genre.label : "this beat") + "." : speed > 45 ? "That's slow so it still sounds natural." : "A middle setting that keeps it natural but clean.")));
            }
        } else say(true, "I couldn't track enough clear notes to judge the pitch, so I left tuning off.");

        // ---- sibilance (stronger when the beat is bright, because bright beats make harsh S sounds stand out more)
        if (meas.sibIdx > 10 + 1.5 * B.bright) {
            const amt = clamp(3 + (meas.sibIdx - 10) * 0.8 + 1.2 * (B.bright - 0.5), 3, 10);
            say(false, "Sharp 'S' / 'T' sounds stick out (" + meas.sibIdx.toFixed(0) + " dB above normal brightness).");
            chain.push(mkItem("deess", { amount: r05(amt), freq: prof.range === "high" ? 6800 : prof.range === "low" ? 5200 : 6000 }, "Softens the harsh S sounds by up to " + amt.toFixed(0) + " dB" + (B.bright > 0.62 ? ", a bit more because the beat is bright" : "") + "."));
        } else say(true, "'S' sounds are under control, so no de-esser.");

        // ---- tone: the target curve, then adjusted for THIS beat (so voice and beat share the space) and THIS take
        const eqOver = {}, why = [];
        const hpBase = prof.range === "high" ? 120 : prof.range === "low" ? 70 : 90;
        if (meas.rumbleDb > -26) { eqOver.hp = Math.max(hpBase, 100); why.push("cuts low rumble"); }
        else if (type !== "main") { eqOver.hp = Math.max(hpBase, 130); why.push("keeps " + (LABEL[type] || "it").toLowerCase() + "s out of the bass"); }
        else eqOver.hp = hpBase;
        const plan = meas.eq;
        if (plan) {
            const by = {}; plan.bands.forEach((b) => { by[b.f] = b.gainDb; });
            const mud = [200, 320, 500].reduce((a, f) => (by[f] < a.g ? { f, g: by[f] } : a), { f: 320, g: 0 });
            let mudG = mud.g, mudF = mud.f;
            // the beat is crowded in the low-mids: carve a little more out of the vocal
            const mudMask = B.bands ? mapc(B.bands[2], -9, -5, 0, 1) : 0;
            let masked = false;
            if ((mudMask > 0.3 && type !== "main") || mudMask > 0.5) { mudG -= 1.5 * mudMask; masked = true; if (mud.g > -1) mudF = 300; }
            if (mudG <= -1) {
                eqOver.mudG = r05(mudG); eqOver.mudF = mudF;
                if (mud.g <= -1) { why.push("trims boxiness near " + mud.f + " Hz"); say(false, "A bit boxy around " + mud.f + " Hz."); }
                if (masked) why.push("leaves room around 300 Hz where the beat is dense");
            }
            let pres = by[3200] || 0;
            const presMask = B.bands ? mapc(B.bands[5], -13, -9, 0, 1) : 0;           // beat strong where the words live
            if (presMask > 0.25) { pres += 1.2 * presMask; why.push("adds clarity because the beat is strong in the 2.5–5 kHz range"); }
            pres = Math.min(pres, 2.2);
            if (gentle && pres > 1) pres = 1;
            if (Math.abs(pres) >= 0.8) { eqOver.presG = r05(pres); if (pres > 0 && !presMask) why.push("adds clarity"); if (pres < 0) why.push("takes the edge off harshness"); say(false, pres > 0 ? "A little dull in the presence area, so the words may get lost." : "Slightly harsh around 3 kHz."); }
            const oth = [800, 1300, 2000, 5000, 8000].reduce((a, f) => (Math.abs(by[f]) > Math.abs(a.g) ? { f, g: by[f] } : a), { f: 1300, g: 0 });
            if (Math.abs(oth.g) >= 1.2) { eqOver.midF = oth.f; eqOver.midG = r05(oth.g); eqOver.midQ = 1; why.push((oth.g < 0 ? "dips " : "lifts ") + oth.f + " Hz"); }
            let air = plan.shelf.gainDb;
            // dark beat = voice can sparkle more; bright beat or a noisy take = keep the top gentle
            air += mapc(B.bright, 0.3, 0.0, 0, 0.8) - mapc(B.bright, 0.6, 1, 0, 1.2);
            if (gentle) air = Math.min(air, 0.5);
            air = clamp(air, -2, 2);
            if (Math.abs(air) >= 0.8) { eqOver.air = r05(air); why.push(air > 0 ? "adds air" + (B.bright < 0.4 ? " (the beat is dark, so there's room on top)" : "") : "softens the top because the beat is already bright"); say(false, air > 0 ? "The top end is a bit closed in." : "The beat is bright, so the voice's top end needs to sit back."); }
            if (!why.length || (why.length === 1 && eqOver.hp)) say(true, "Tone is balanced for this beat.");
        }
        chain.push(mkItem("eq", eqOver, why.length ? "Clean-up: " + why.join(", ") + "." : "Gentle clean-up."));

        // ---- dynamics (speed follows the tempo and the way it is delivered)
        const wide = meas.rangeDb > 9 || (type !== "main" && meas.rangeDb > 7);
        if (wide) {
            const ratio = r1(clamp((2 + (meas.rangeDb - 8) * 0.35) * g.comp * sm.comp, 1.8, 6));
            const thr = Math.round(clamp(pct(meas.levels, 0.55) - 1, -45, -10));       // just under the typical loudness
            const rel = Math.round(clamp(beatMs / 2, 70, 260));                          // let go in time with the music (an eighth note)
            const atk = prof.delivery === "rapped" ? 5 : type === "main" ? 14 : 7;
            // estimate average gain reduction so the makeup gain keeps the level the same
            let gr = 0; meas.levels.forEach((l) => { gr += Math.max(0, l - thr) * (1 - 1 / ratio); }); gr /= Math.max(1, meas.levels.length);
            const makeup = Math.round(clamp(gr * 0.75 + 0.5, 1, 8));
            say(false, "Loud and quiet words are " + meas.rangeDb.toFixed(0) + " dB apart, which will jump in and out of the mix.");
            chain.push(mkItem("comp", { thr, ratio, atk, rel, makeup }, "Evens out the volume (" + ratio + ":1), releasing in time with the beat (" + rel + " ms)."));
        } else say(true, "Volume is already steady (" + meas.rangeDb.toFixed(0) + " dB between loud and quiet), so no compressor.");
        if (style === "big" && prof.quality > 0.6) chain.push(mkItem("sat", { drive: 1.5, mix: 10 }, "Adds thickness for a bigger sound."));
        else if (style === "big") say(true, "Skipped added warmth because the take is rough and it would bring up the noise.");

        // ---- backing parts: width depends on how crowded the beat is
        if (type === "adlib" || type === "harmony" || type === "tag") {
            const width = Math.round((type === "harmony" ? 150 : 140) * (1 - 0.2 * B.busy) + (B.space > 0.6 ? 10 : 0));
            chain.push(mkItem("imager", { width }, "Spreads this part wide (" + width + "%) so the lead stays in the middle" + (B.busy > 0.65 ? ", a little less because the beat is already full" : "") + "."));
            say(true, (LABEL[type] || "This part") + "s sit better wide, so I'm widening it and leaving the lead centred.");
        }

        // ---- space: size, brightness and amount follow tempo, genre, how full the beat is, and how wet the take already is
        const wet = meas.tailDb != null && meas.tailDb > -24;
        say(wet ? true : false, wet ? "This take already has room sound in it, so I'm adding only a touch of reverb." : "The take is dry, so it sounds close and flat next to a produced beat.");
        const tempoScale = clamp(Math.sqrt(100 / (B.bpm || 100)), 0.75, 1.25);              // slower songs can ring longer
        const decay = clamp(g.decay * tempoScale * (0.7 + 0.5 * B.space), 0.6, 3.2);
        const roleMix = { main: 16, adlib: 28, tag: 26, harmony: 24, other: 20 }[type] || 20;
        const mix = Math.round(clamp(roleMix * g.wet * sm.wet * (0.6 + 0.8 * B.space) * (wet ? 0.4 : 1) * (prof.delivery === "rapped" ? 0.8 : 1), 4, 45));
        const pre = Math.round(clamp(beatMs / 8, 18, 80));
        const lp = Math.round(6200 + (1 - B.bright) * 3300), lowMul = r1(0.7 + 0.25 * B.space);
        chain.push(mkItem("reverb", { decay: Math.round(decay * 100) / 100, predelay: pre, mix, lp, lowMul }, "Hall reverb: " + decay.toFixed(1) + " s because it's " + (B.genre ? B.genre.label + " at " : "") + (B.bpm ? Math.round(B.bpm) + " BPM" : "a typical tempo") + (B.space < 0.4 ? " and the beat is full (kept tight)" : B.space > 0.7 ? " and the beat has lots of room (let it bloom)" : "") + "; " + pre + " ms predelay keeps the words clear; its top is rolled off at " + lp + " Hz to suit a " + (B.bright > 0.6 ? "bright" : B.bright < 0.4 ? "dark" : "balanced") + " beat."));

        if (meas.peakDb > -1.5) chain.push(mkItem("limit", { gain: 0, ceiling: -1 }, "Safety ceiling: the take peaks at " + meas.peakDb.toFixed(1) + " dB."));
        if (prof.quality < 0.7 && prof.qualityNotes.length) say(false, "This take is " + prof.qualityNotes.join(" and ") + ", so I kept the boosts gentle. A cleaner re-record would help more than any plugin.");
        return { findings: find, chain };
    }

    async function analyzeClip(ch, sr, ctx) {
        const type = ctx.type || "main", style = ctx.style || "polished", beat = ctx.beat || {};
        const B = Object.assign({ bpm: null, key: null, busy: 0.5, bright: 0.5, space: 0.5, energy: 0.5, lowWeight: 0.5, genreId: "universal", genre: null, bands: null, sections: [] }, beat);
        const meas = measureVocal(ch, sr);
        if (meas.activeSec < 0.3) return { findings: [{ ok: true, text: "Almost no singing here, so I left it alone." }], chain: [], meas };

        let pitch = null;
        try { pitch = await Fx.runTask("analyze", { mono: U.mono(ch), sr, rootPc: B.key ? B.key.rootPc : 0, scale: B.key ? B.key.scale : "major" }); } catch (e) { pitch = null; }
        let key = B.key || null, keyNote = "";
        if (pitch && pitch.notes && pitch.notes.length >= 3) {
            const guess = keyFromNotes(pitch.notes);
            if (!key) { key = guess; keyNote = " (key worked out from the singing)"; }
            else if (guess && !(guess.rootPc === key.rootPc && guess.scale === key.scale)) {
                try {
                    const alt = await Fx.runTask("analyze", { mono: U.mono(ch), sr, rootPc: guess.rootPc, scale: guess.scale });
                    if (alt.stats && pitch.stats && alt.stats.inKeyPct > pitch.stats.inKeyPct + 18 && ctx.beatKeyConfidence !== 1) { key = guess; keyNote = " (the vocal fits " + guess.label + " better than the beat's reading)"; pitch = alt; }
                } catch (e) { /* keep beat key */ }
            }
        }
        const prof = profileVocal(meas, pitch);
        const r = decide(type, { meas, prof, pitch, keyNote, forceTune: ctx.forceTune }, B, style, key);
        return { findings: r.findings, chain: r.chain, meas, key, pitch, prof };
    }

    // ---------------------------------------------------------------- flavour placement (only when asked): based on the singing's gaps and the beat's big moments
    const INTENSITY = { subtle: { echo: 0.2, crowd: 1, voice: 1, orbit: 40 }, normal: { echo: 0.4, crowd: 2, voice: 1, orbit: 60 }, lots: { echo: 0.7, crowd: 4, voice: 2, orbit: 80 } };

    function flavourZones(meas, flavors, B, clipStart, clipDur, type, intensity) {
        const zones = [], rel = (t) => t - clipStart, inten = INTENSITY[intensity] || INTENSITY.normal;
        const phr = meas.phrases || [];
        if (type !== "main" || !phr.length) return zones;
        const beatMs = B.bpm ? 60000 / B.bpm : 600, energy = B.energy != null ? B.energy : 0.5, g = GENRE[B.genreId] || GENRE.universal;
        const hot = (t) => (B.sections || []).some((s) => t >= s.start && t <= s.end);
        const spaced = (list, minSep, cap) => { const out = []; list.forEach((p) => { if (out.length < cap && out.every((q) => Math.abs(q.i - p.i) >= minSep)) out.push(p); }); return out; };

        if (flavors.doubs) {
            (B.sections || []).forEach((s) => {
                const a = Math.max(0, rel(s.start)), b = Math.min(clipDur, rel(s.end));
                if (b - a < 1.5) return;
                const level = Math.round(clamp(-11 + 5 * energy * g.dbl, -12, -5)), delay = Math.round(clamp(14 + 8 * (1 - (B.busy || 0.5)), 12, 24));
                zones.push({ start: a, end: b, label: "Doubles in the big section", chain: [mkItem("doubler", { level, delay, spread: 85 }, "Doubles the lead only where the beat is biggest, at " + level + " dB and " + delay + " ms, tight enough to sound like one thick voice.")] });
            });
        }
        if (flavors.tails) {
            // choose the echo time that fits inside each pause, and only use the pauses big enough to let it ring
            const cand = phr.map((p, i) => ({ i, p, gap: p.gapAfter })).filter((c) => c.gap >= 0.8).sort((a, b) => b.gap - a.gap);
            const cap = Math.max(1, Math.round(phr.length * inten.echo));
            const picks = spaced(cand, 2, cap);
            const last = cand.find((c) => c.i === phr.length - 1) || { i: phr.length - 1, p: phr[phr.length - 1], gap: 4 };
            if (!picks.some((c) => c.i === last.i)) picks.push(last);
            picks.forEach((c) => {
                const divs = [["1/4", beatMs], ["1/8 dotted", beatMs * 0.75], ["1/8", beatMs / 2], ["1/16", beatMs / 4]];
                const fit = divs.find((d) => d[1] / 1000 <= c.gap / 2.5) || divs[3];
                const repeats = Math.min(4, Math.floor(c.gap / (fit[1] / 1000))), fb = repeats >= 4 ? 45 : repeats >= 3 ? 38 : 28;
                const end = Math.min(clipDur, c.p.end + 0.05), a = Math.max(c.p.start, end - 0.55);
                const mixv = Math.round(clamp(46 - 16 * energy, 26, 46));
                if (end - a > 0.25) zones.push({ start: a, end, label: "Echo on the last word", chain: [mkItem("delay", { enter: 55, mix: mixv, sync: fit[0], fb }, "Echo (" + fit[0] + ") only on the last word, " + (c.gap > 50 ? "so the song ends with a trail." : "timed so the repeats finish inside the " + c.gap.toFixed(1) + " s pause before the next line."))] });
            });
        }
        if (flavors.crowd) {
            const ok = (g.crowd >= 0.7) || intensity === "lots";
            if (!ok) { zones.skippedCrowd = true; }
            else {
                const cand = phr.map((p, i) => ({ i, p, gap: p.gapAfter })).filter((c) => hot(clipStart + c.p.end) && c.gap >= 0.9).sort((a, b) => b.gap - a.gap);
                const picks = spaced(cand, 2, Math.max(1, Math.min(inten.crowd, Math.ceil(cand.length * 0.5))));
                picks.forEach((c) => {
                    const end = Math.min(clipDur, c.p.end + 0.05), a = Math.max(c.p.start, end - 0.8), size = Math.round(clamp(6 + 10 * energy, 6, 16));
                    if (end - a > 0.3) zones.push({ start: a, end, label: "Crowd answers", chain: [mkItem("crowd", { size, level: -9 }, "A crowd of " + size + " answering the last words, in a big section, where there's a " + c.gap.toFixed(1) + " s gap for them to sing into.")] });
                });
            }
        }
        if (flavors.voice) {
            // best spot: the phrase just before the beat lifts into a big section; otherwise the last phrase
            const starts = (B.sections || []).map((s) => s.start);
            let picks = phr.map((p, i) => ({ i, p, d: Math.min.apply(null, starts.map((s) => Math.abs(s - (clipStart + p.end))).concat([99])) })).filter((c) => c.d < 1.5).sort((a, b) => a.d - b.d).slice(0, inten.voice);
            if (!picks.length) picks = [{ i: phr.length - 1, p: phr[phr.length - 1], d: 99 }];
            const semi = energy > 0.55 ? 5 : -5;
            picks.forEach((c) => {
                const end = Math.min(clipDur, c.p.end + 0.05), a = Math.max(c.p.start, end - 0.35);
                zones.push({ start: a, end, label: "Voice-change spice", chain: [mkItem("voice", { semi, mode: "character" }, "A quick " + (semi > 0 ? "pitched-up" : "pitched-down") + " chop " + (c.d < 1.5 ? "just before the beat lifts into a big section" : "on the final sound") + ", " + (semi > 0 ? "up because the song is high-energy." : "down because the song is laid-back."))] });
            });
        }
        if (flavors.orbit) {
            const rate = Math.round(clamp((B.bpm || 100) / 60 / 16, 0.05, 0.4) * 1000) / 1000;      // one slow lap every four bars
            zones.push({ start: 0, end: clipDur, label: "Slow stereo movement", chain: [mkItem("orbit", { rate, am: 25, fm: 20, rotation: 90, mix: inten.orbit }, "Moves the voice around you once every four bars (" + rate + " Hz) so the motion stays in time with the song.")] });
        }
        return zones;
    }

    // ---------------------------------------------------------------- whole project
    function describeBeat(B) { return (B.genre && B.genre.decided ? B.genre.label + " · " : "") + (B.bpm ? Math.round(B.bpm) + " BPM · " : "") + (B.key ? B.key.label + " · " : "") + B.mood; }

    async function planProject(lanes, beatBuf, opts) {
        opts = opts || {};
        const beat = (await analyzeBeat(beatBuf)) || { bpm: null, key: null, sections: [], busy: 0.5, mood: "" };
        const out = { beat, vibe: beat.mood ? describeBeat(beat) : "", lanes: [] };
        for (const lane of lanes) {
            for (const clip of lane.clips) {
                if (!clip.buffer) continue;
                if (lane.mixLevel === "mute" || lane.muted) continue;
                const chans = []; for (let c = 0; c < clip.buffer.numberOfChannels; c++) chans.push(clip.buffer.getChannelData(c));
                const r = await analyzeClip(chans, clip.buffer.sampleRate, { type: lane.type, style: opts.style, beat, beatKeyConfidence: beat.source && beat.source.key === "Beat Lab" ? 1 : 0 });
                const extra = r.meas ? flavourZones(r.meas, opts.flavors || {}, beat, clip.start, clip.duration, lane.type, opts.intensity) : [];
                out.lanes.push({ laneId: lane.id, clipId: clip.id, laneName: lane.name, laneType: lane.type, clipName: clip.name, findings: r.findings, chain: r.chain, extra, meas: r.meas, vocal: r.prof ? r.prof.label : "", skippedCrowd: !!extra.skippedCrowd });
                if (opts.onProgress) opts.onProgress(lane.name);
            }
        }
        return out;
    }

    root.VLBrain = { vibeOf, genreOf, analyzeBeat, measureVocal, analyzeClip, planProject, parseKey, keyFromNotes, profileVocal, decide, flavourZones, bandProfile, GENRE, describeBeat };
})(typeof window !== "undefined" ? window : globalThis);
