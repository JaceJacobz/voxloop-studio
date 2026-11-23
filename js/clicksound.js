/*
 * Voxloop — recorded click sounds (v2.25.4)
 *
 * The count-in (Studio / Settings) and the Vocal Sketch metronome used to be made in code (a sine beep, a burst of noise). They now play
 * short RECORDED hits from the sample pack (a rim click for the beat, a brighter one for the first beat of the bar, a shaker): the same
 * recordings the beats use, already cached for offline use. If a recording cannot be loaded nothing is made up: ready() resolves false and
 * the caller says so.
 *   VLClick.ready()                      -> Promise<boolean>  (true when the clicks are loaded)
 *   VLClick.hit(ctx, when, kind, gain)   -> boolean           kind: "accent" | "beat" | "shake" | "shakeSoft"
 */
(function () {
    "use strict";
    const FILES = { accent: "samples/afrobeats/rim/1.wav", beat: "samples/afrobeats/rim/5.wav", shake: "samples/afrobeats/shaker/4.wav" };
    let buffers = null, loading = null;
    function load() {
        if (loading) return loading;
        loading = (async () => {
            const out = {};
            try {
                const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, c = new OAC(1, 1, 44100);
                await Promise.all(Object.keys(FILES).map(async (k) => {
                    try {
                        const r = await fetch(FILES[k]); if (!r.ok) return;
                        const ab = await r.arrayBuffer();
                        out[k] = await new Promise((res, rej) => { const p = c.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
                    } catch (e) { /* this one stays missing */ }
                }));
            } catch (e) { /* nothing loaded */ }
            buffers = out;
            return Object.keys(out).length === Object.keys(FILES).length;
        })();
        return loading;
    }
    function hit(ctx, when, kind, gain) {
        const key = kind === "shakeSoft" ? "shake" : kind, b = buffers && buffers[key];
        if (!b) return false;
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = b; g.gain.value = gain == null ? 0.7 : gain;
        s.connect(g); g.connect(ctx.destination); s.start(when);
        return true;
    }
    window.VLClick = { ready: load, hit, files: FILES };
    load();                                                                    // start fetching at page load (a few KB)
})();
