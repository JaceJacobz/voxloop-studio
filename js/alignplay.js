/*
 * Voxloop — alignment player (v2.25.4)
 *
 * What Autopilot's "Is the vocal lined up?" card plays with. The old "Hear it" played ten seconds, once, and then fell silent while the
 * button still said "Stop", so the line-up could not be judged by ear before the mix.
 *
 * This plays the WHOLE song (beat and vocal together) from where the vocal comes in, or from anywhere you tap, with:
 *   - the vocal following your nudges live, without the beat restarting (only the vocal is re-timed, with a tiny crossfade),
 *   - an optional loop (a few seconds from where you are) for fine nudging,
 *   - seek, pause / resume, and a state that always matches what you hear (the button goes back to "Play" when the song ends).
 * Both tracks are placed on the audio clock, so the gap between them is exact. Pure Web Audio; no DOM. Runs in the page
 * (window.VLAlignPlay) and in Node (tests/alignplay.test.js, with a fake audio context).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.VLAlignPlay = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";
    const LEAD = 0.03;            // how far ahead things are scheduled (s)
    const FADE = 0.008;           // crossfade when the vocal is re-timed, so it does not click
    const EDGE = 0.002;           // tiny fades at the edges of a stretch of audio
    const LOOP_LEN = 6;           // seconds in the loop
    const PRE_ROLL = 1.5;         // start this long before the vocal comes in
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // when the first clear sound of the vocal is (seconds from the start of the vocal file)
    function firstSound(buf) {
        const d = buf.getChannelData(0); let pk = 0;
        for (let i = 0; i < d.length; i += 64) pk = Math.max(pk, Math.abs(d[i]));
        if (!(pk > 0)) return 0;
        for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) >= pk * 0.1) return i / buf.sampleRate;
        return 0;
    }
    function envelope(param, from, to, fin, fout) {
        param.setValueAtTime(0, from);
        param.linearRampToValueAtTime(1, from + fin);
        if (to - fout > from + fin) { param.setValueAtTime(1, to - fout); param.linearRampToValueAtTime(0, to); }
    }

    // o: { ctx, beat, vocal (AudioBuffers), getOffset() -> seconds the vocal is moved later, beatGain, vocalGain,
    //      onTick(beatSeconds), onState(isPlaying), onEnd() }
    function create(o) {
        const ctx = o.ctx, beat = o.beat, vocal = o.vocal, dur = beat.duration;
        const offset = () => (typeof o.getOffset === "function" ? Number(o.getOffset()) || 0 : 0);
        const vFirst = firstSound(vocal);
        let passes = [], timer = null, playing = false, cursor = 0, loop = null, bus = null;

        // where playback should start by default: a moment before the vocal comes in
        const startPoint = () => clamp(offset() + vFirst - PRE_ROLL, 0, Math.max(0, dur - 0.5));
        cursor = startPoint();

        function makeBus() {
            const b = ctx.createGain(), v = ctx.createGain();
            b.gain.value = o.beatGain != null ? o.beatGain : 0.7; v.gain.value = o.vocalGain != null ? o.vocalGain : 1;
            b.connect(ctx.destination); v.connect(ctx.destination);
            return { beat: b, vocal: v };
        }
        // where the song is right now (seconds into the beat)
        function position() {
            if (!playing) return cursor;
            const now = ctx.currentTime;
            for (let i = passes.length - 1; i >= 0; i--) { const p = passes[i]; if (now >= p.ctxStart) return Math.min(p.beatEnd, p.beatStart + (now - p.ctxStart)); }
            return cursor;
        }
        // the vocal sits at (where the beat is) - (offset): moving the offset moves the vocal and nothing else
        function placeVocal(pass, fromCtx, crossfade) {
            const t = Math.max(fromCtx, pass.ctxStart);
            if (t >= pass.ctxEnd) return;
            const beatTime = pass.beatStart + (t - pass.ctxStart), vocalPos = beatTime - offset();
            let startCtx = t, startPos = vocalPos;
            if (vocalPos < 0) { startCtx = t - vocalPos; startPos = 0; }              // the vocal has not started yet: wait for it
            const length = pass.ctxEnd - startCtx;
            if (length <= 0 || startPos >= vocal.duration) return;
            const g = ctx.createGain();
            envelope(g.gain, startCtx, pass.ctxEnd, crossfade ? FADE : EDGE, EDGE);
            g.connect(pass.bus.vocal);
            const src = ctx.createBufferSource(); src.buffer = vocal; src.connect(g);
            src.start(startCtx, startPos, length);
            pass.vocal = { src, g, startCtx };
        }
        function schedulePass(ctxStart, beatStart, beatEnd) {
            const length = beatEnd - beatStart; if (length <= 0.01) return null;
            const g = ctx.createGain();
            envelope(g.gain, ctxStart, ctxStart + length, EDGE, EDGE);
            g.connect(bus.beat);
            const src = ctx.createBufferSource(); src.buffer = beat; src.connect(g);
            src.start(ctxStart, beatStart, length);
            const pass = { ctxStart, ctxEnd: ctxStart + length, beatStart, beatEnd, src, g, vocal: null, bus };
            passes.push(pass);
            placeVocal(pass, ctxStart, false);
            return pass;
        }
        function silence() {                                                           // stop everything that is playing or queued, without a click
            const now = ctx.currentTime, old = passes, oldBus = bus;
            passes = []; bus = null;
            old.forEach((p) => {
                [p.g].concat(p.vocal ? [p.vocal.g] : []).forEach((g) => { try { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.004); } catch (e) { /* done */ } });
                try { p.src.stop(now + 0.03); } catch (e) { /* done */ }
                if (p.vocal) { try { p.vocal.src.stop(now + 0.03); } catch (e) { /* done */ } }
            });
            if (oldBus) setTimeout(() => { try { oldBus.beat.disconnect(); oldBus.vocal.disconnect(); } catch (e) { /* done */ } }, 200);
        }
        function tick() {
            if (!playing) return;
            const now = ctx.currentTime, last = passes[passes.length - 1];
            if (last) {
                if (loop) { if (now + 0.2 >= last.ctxEnd) schedulePass(last.ctxEnd, loop.a, loop.b); }
                else if (now > last.ctxEnd + 0.05) { finish(); return; }              // the song has ended
            }
            passes = passes.filter((p) => {                                            // let go of laps that are over
                if (p.ctxEnd + 0.3 >= now) return true;
                try { p.g.disconnect(); if (p.vocal) p.vocal.g.disconnect(); } catch (e) { /* done */ }
                return false;
            });
            if (o.onTick) o.onTick(position());
        }
        function finish() {
            silence(); playing = false; clearInterval(timer); timer = null;
            cursor = startPoint();
            if (o.onState) o.onState(false);
            if (o.onTick) o.onTick(cursor);
            if (o.onEnd) o.onEnd();
        }
        function play(fromSec) {
            try { if (ctx.state === "suspended") ctx.resume(); } catch (e) { /* ignore */ }
            silence();
            if (fromSec != null) cursor = clamp(fromSec, 0, Math.max(0, dur - 0.2));
            let a = cursor, end = dur;
            if (loop) { end = loop.b; if (a < loop.a || a >= loop.b - 0.05) a = loop.a; }
            bus = makeBus(); playing = true;
            schedulePass(ctx.currentTime + LEAD, a, end);
            if (!timer) timer = setInterval(tick, 30);
            if (o.onState) o.onState(true);
            if (o.onTick) o.onTick(a);
        }
        function pause() {
            if (!playing) return;
            cursor = position(); silence(); playing = false; clearInterval(timer); timer = null;
            if (o.onState) o.onState(false);
            if (o.onTick) o.onTick(cursor);
        }
        function seek(sec) {
            cursor = clamp(sec, 0, Math.max(0, dur - 0.2));
            if (playing) play(cursor); else if (o.onTick) o.onTick(cursor);
        }
        // the offset changed: re-time ONLY the vocal, in every lap that is playing or queued. The beat carries on untouched.
        function retime() {
            if (!playing) { if (!loop) { cursor = Math.min(cursor, dur); } return; }
            const when = ctx.currentTime + LEAD;
            passes.forEach((pass) => {
                if (pass.ctxEnd <= when) return;
                const v = pass.vocal;
                if (v) {
                    if (v.startCtx >= when) { try { v.src.stop(0); } catch (e) { /* done */ } }
                    else {
                        try { v.g.gain.cancelScheduledValues(when); v.g.gain.setValueAtTime(1, when); v.g.gain.linearRampToValueAtTime(0, when + FADE); v.src.stop(when + FADE); } catch (e) { /* done */ }
                    }
                    pass.vocal = null;
                }
                placeVocal(pass, when, true);
            });
        }
        // a loop of a few seconds from where you are (or from `fromSec`)
        function setLoop(on, fromSec, len) {
            if (!on) { const p = position(); loop = null; if (playing) play(p); return; }
            const n = len || LOOP_LEN, a0 = fromSec != null ? fromSec : position(), a = clamp(Math.min(a0, dur - n), 0, Math.max(0, dur - 0.5)), b = Math.min(dur, a + n);
            loop = { a, b };
            if (playing) play(a); else cursor = a;
        }
        function destroy() { silence(); playing = false; clearInterval(timer); timer = null; }
        return { play, pause, toggle() { if (playing) pause(); else play(); }, seek, retime, setLoop, destroy, startPoint,
            isPlaying: () => playing, position, duration: dur, loopRegion: () => (loop ? { a: loop.a, b: loop.b } : null), vocalStart: () => offset() + vFirst };
    }

    return { create, firstSound, LOOP_LEN, PRE_ROLL };
});
