"use strict";
// The alignment player (js/alignplay.js): plays the whole song, follows nudges live without restarting the beat, loops, seeks,
// pauses and resets its state when the song ends. Uses a fake audio clock that the test moves by hand.
const AP = require("../js/alignplay");
let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m.padEnd(72) + (x || "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 0.02 : e);

function fakeCtx() {
  const ctx = { currentTime: 10, state: "running", destination: {}, sources: [], resumed: 0, resume() { this.resumed++; } };
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  ctx.createGain = () => ({ gain: param(), connect() {}, disconnect() {} });
  ctx.createBufferSource = () => { const s = { buffer: null, connect() {}, disconnect() {}, started: null, stoppedAt: null, start(when, off, dur) { s.started = { when, off, dur }; }, stop(t) { s.stoppedAt = t; } }; ctx.sources.push(s); return s; };
  return ctx;
}
function buf(seconds, loudFrom) {                        // a mono buffer; `loudFrom` = where the sound begins (quiet before it)
  const sr = 8000, n = Math.round(seconds * sr), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = (loudFrom == null || i / sr >= loudFrom) ? 0.5 * Math.sin(i / 20) : 0.001 * Math.sin(i / 20);
  return { duration: seconds, sampleRate: sr, numberOfChannels: 1, getChannelData: () => d, tag: "x" };
}
const beatOf = (ctx) => ctx.sources.filter((s) => s.buffer && s.buffer.duration === 40);
const vocalOf = (ctx) => ctx.sources.filter((s) => s.buffer && s.buffer.duration === 27);

(async () => {
  const BEAT = buf(40), VOC = buf(27, 0.5);
  let offset = 2.0, events = [];
  const ctx = fakeCtx();
  const P = AP.create({ ctx, beat: BEAT, vocal: VOC, getOffset: () => offset, onTick: (t) => events.push(["tick", t]), onState: (s) => events.push(["state", s]), onEnd: () => events.push(["end"]) });

  // the vocal comes in at 0.5 s of its own file, moved to 2.0 s: the default start is a moment before it
  ok(near(P.startPoint(), 2.0 + 0.5 - AP.PRE_ROLL), "starts a moment before the vocal comes in", "start " + P.startPoint().toFixed(2));
  ok(near(P.vocalStart(), 2.5), "knows when the vocal comes in");

  // 1. plays the whole song, not ten seconds
  P.play();
  const b0 = beatOf(ctx)[0];
  ok(!!b0 && near(b0.started.off, 1.0) && near(b0.started.dur, 39.0), "plays the beat to the END of the song", b0 ? "from " + b0.started.off.toFixed(2) + " for " + b0.started.dur.toFixed(2) + " s" : "no source");
  ok(P.isPlaying() && events.some((e) => e[0] === "state" && e[1] === true), "reports that it is playing");
  // 2. the vocal sits at (beat time - offset): beat 1.0 -> vocal position -1.0, so it waits 1 s and starts from its beginning
  const v0 = vocalOf(ctx)[0];
  ok(!!v0 && near(v0.started.off, 0) && near(v0.started.when - b0.started.when, 1.0), "the vocal is placed exactly at the offset", v0 ? "waits " + (v0.started.when - b0.started.when).toFixed(3) + " s" : "no vocal");
  // 3. position follows the clock
  ctx.currentTime += 5; ok(near(P.position(), 1.0 + 5 - 0.03, 0.05), "the position follows the audio clock", P.position().toFixed(2));

  // 4. a nudge re-times only the vocal; the beat is not restarted
  const nBeat = beatOf(ctx).length, nVoc = vocalOf(ctx).length;
  offset = 2.1; P.retime();
  ok(beatOf(ctx).length === nBeat, "a nudge does not restart the beat");
  const vNew = vocalOf(ctx)[vocalOf(ctx).length - 1], when = vNew.started.when, beatAtThen = 1.0 + (when - b0.started.when);
  ok(vocalOf(ctx).length === nVoc + 1 && near(vNew.started.off, beatAtThen - 2.1, 0.02), "the vocal is re-placed at the new offset, live", "vocal position " + vNew.started.off.toFixed(3) + " (want " + (beatAtThen - 2.1).toFixed(3) + ")");
  ok(vocalOf(ctx)[nVoc - 1].stoppedAt != null, "the old vocal is faded out and stopped");

  // 5. pause keeps the place; play resumes there
  const at = P.position(); P.pause();
  ok(!P.isPlaying() && near(P.position(), at, 0.001), "pause keeps the place", at.toFixed(2));
  const nb = beatOf(ctx).length; P.play(); const rb = beatOf(ctx)[nb];
  ok(rb && near(rb.started.off, at, 0.001), "play resumes from where it paused");

  // 6. seek: while playing it jumps; while paused it only moves the marker
  P.seek(20); const sb = beatOf(ctx)[beatOf(ctx).length - 1];
  ok(near(sb.started.off, 20, 0.001) && near(sb.started.dur, 20, 0.001), "seek while playing jumps there and plays on to the end");
  P.pause(); const cnt = ctx.sources.length; P.seek(7);
  ok(ctx.sources.length === cnt && near(P.position(), 7, 0.001), "seek while paused only moves the marker (no sound)");

  // 7. the song ends: the player says so and goes back to the start (the button can reset)
  P.play(39.0); ctx.currentTime += 5; events = []; await sleep(90);
  ok(!P.isPlaying() && events.some((e) => e[0] === "end") && events.some((e) => e[0] === "state" && e[1] === false), "when the song ends it reports it (the button resets)");
  ok(near(P.position(), P.startPoint()), "and goes back to the start point");

  // 8. loop: a few seconds repeat, queued seamlessly; the beat is never longer than the loop
  P.play(10); P.setLoop(true, 10);
  const lb = beatOf(ctx)[beatOf(ctx).length - 1];
  ok(near(lb.started.off, 10, 0.001) && near(lb.started.dur, AP.LOOP_LEN, 0.001), "loop: plays 6 s from where it was switched on", lb.started.dur.toFixed(2) + " s");
  ok(near(P.loopRegion().b - P.loopRegion().a, AP.LOOP_LEN, 0.001), "loop region is reported");
  const before = beatOf(ctx).length; ctx.currentTime = lb.started.when + 5.9; await sleep(90);
  const lap = beatOf(ctx)[before];
  ok(lap && near(lap.started.when, lb.started.when + AP.LOOP_LEN, 0.001) && near(lap.started.off, 10, 0.001), "loop: the next lap is queued just before the first ends (no gap)");
  P.setLoop(false);
  const after = beatOf(ctx)[beatOf(ctx).length - 1];
  ok(P.loopRegion() === null && near(after.started.dur, 40 - after.started.off, 0.001), "loop off: plays on to the end again");
  // 9. a loop near the end of the song still fits inside it
  P.setLoop(true, 38.5); ok(P.loopRegion().b <= 40 && near(P.loopRegion().b - P.loopRegion().a, AP.LOOP_LEN, 0.001), "a loop near the end is moved back so it fits");
  P.destroy();
  ok(!P.isPlaying(), "destroy stops everything");

  // 10. a vocal that is moved EARLIER (negative offset) and one longer than the playback window
  const ctx2 = fakeCtx(), P2 = AP.create({ ctx: ctx2, beat: BEAT, vocal: VOC, getOffset: () => -1.5 });
  P2.play(5); const v2 = vocalOf(ctx2)[0];
  ok(near(v2.started.off, 5 + 1.5, 0.001) && near(v2.started.when, ctx2.sources[0].started.when, 0.001), "a vocal moved earlier starts part-way in, together with the beat", v2 ? "from " + v2.started.off.toFixed(2) + " s into the vocal" : "");
  P2.destroy();
  console.log(fail ? "\n" + fail + " FAILED" : "\nall passed (" + pass + ")");
  process.exit(fail ? 1 : 0);
})();
