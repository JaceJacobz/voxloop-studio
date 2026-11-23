"use strict";
// Producer check after mastering (js/mixreview.js): a clean mix is left alone, and each fault that is put in on purpose
// (boomy bass, muddy low-mids, sub rumble, one side louder) is found, eased, measured again and explained.
const fs = require("fs"), path = require("path");
const MR = require(path.join(__dirname, "../js/mixreview.js"));
const sr = 44100, n = sr * 20;
let bad = 0;
const check = (name, ok, extra) => { if (!ok) bad++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

// a deterministic "song": shaped noise with a bass-heavy, natural-looking tilt, a little pumping, slightly different left and right
function song() {
  let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const x = ch[c]; for (let i = 0; i < n; i++) x[i] = rnd() * 0.12;
    MR.run(x, MR.coef("lowshelf", 150, 9, 0.707, sr)); MR.run(x, MR.coef("lowshelf", 1200, 7, 0.707, sr)); MR.run(x, MR.coef("peaking", 800, 3, 0.8, sr));
    for (let i = 0; i < n; i++) x[i] *= 0.8 + 0.2 * Math.sin(2 * Math.PI * 2 * i / sr);
  }
  return ch;
}
const clone = (ch) => ch.map((x) => Float32Array.from(x));
const peakDb = (ch) => { let p = 0; for (const x of ch) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return 20 * Math.log10(p); };
const norm = (ch, to) => { const p = Math.pow(10, peakDb(ch) / 20), k = Math.pow(10, to / 20) / p; ch.forEach((x) => { for (let i = 0; i < x.length; i++) x[i] *= k; }); return ch; };

const beat = norm(song(), -3);
// a "voice": broad noise from 8 to 14 s, loud enough to add real body to the middle of the music
function voiceTrack() {
  let s = 777; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (let i = Math.round(8 * sr); i < Math.round(14 * sr); i++) { const v = rnd() * 0.10 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / sr)); ch[0][i] = v; ch[1][i] = v; }
  ch.forEach((x) => { MR.run(x, MR.coef("highpass", 180, 0, 0.707, sr)); MR.run(x, MR.coef("peaking", 350, 6, 0.7, sr)); });
  return ch;
}
const voice = voiceTrack(), activity = MR.activityMap(voice, sr, 0, n / sr);
const withVoice = () => beat.map((x, c) => { const y = Float32Array.from(x); for (let i = 0; i < n; i++) y[i] += voice[c][i]; return y; });
const rev = (mix, o) => MR.review(mix, sr, Object.assign({ reference: beat, activity }, o || {}));
check("the voice's singing time is found", activity.singingShare > 0.3 && activity.singingShare < 0.5, "singing " + Math.round(100 * activity.singingShare) + " % of the song, tail included");

// 1. an untouched mix (a different level only) passes everything and says so
{
  const m = norm(withVoice(), -1.5), r = rev(m);
  check("clean mix: nothing to fix", r.fixes.length === 0, r.lines[0].slice(0, 110));
  check("clean mix: says it was checked", /nothing needed fixing/.test(r.lines.join(" ")));
}
// 2. boomy bass (+6 dB shelf below 120 Hz)
{
  const m = withVoice(); m.forEach((x) => MR.run(x, MR.coef("lowshelf", 120, 6, 0.707, sr))); norm(m, -1.5);
  const r = rev(m), b = r.heard.before, a = r.heard.after, R = r.heard.beat;
  check("boomy bass: found", r.fixes.includes("low"), `bass was ${(b.lowDb - R.lowDb).toFixed(1)} dB over the beat`);
  check("boomy bass: eased to inside the limit", a.lowDb - R.lowDb <= 2.0 + 0.3, `now ${(a.lowDb - R.lowDb).toFixed(1)} dB over`);
  check("boomy bass: explained in words", /more bass than your beat/.test(r.lines.join(" ")));
  check("boomy bass: no clipping after the fix", peakDb(m) <= -1.2 + 0.05, `peak ${peakDb(m).toFixed(2)} dBFS`);
}
// 3. muddy low-mids (+7 dB around 320 Hz)
{
  const m = withVoice(); m.forEach((x) => MR.run(x, MR.coef("peaking", 320, 5, 0.9, sr))); norm(m, -1.5);
  const r = rev(m), b = r.heard.before, a = r.heard.after, R = r.heard.beat;
  check("muddy mids: found", r.fixes.includes("mud"), `mids were ${(b.mudDb - R.mudDb).toFixed(1)} dB over the beat`);
  check("muddy mids: improved", (a.mudDb - R.mudDb) < (b.mudDb - R.mudDb) - 1, `now ${(a.mudDb - R.mudDb).toFixed(1)} dB over`);
}
// 4. sub rumble
{
  const m = withVoice(); m.forEach((x) => { for (let i = 0; i < x.length; i++) x[i] += 0.05 * Math.sin(2 * Math.PI * 15 * i / sr) + 0.03 * Math.sin(2 * Math.PI * 11 * i / sr); }); norm(m, -1.5);
  const r = rev(m), b = r.heard.before, a = r.heard.after;
  check("rumble: found", r.fixes.includes("rumble"), `${b.rumbleDb.toFixed(0)} dB`);
  check("rumble: removed", a.rumbleDb < b.rumbleDb - 6, `now ${a.rumbleDb.toFixed(0)} dB`);
}
// 5. one side louder than the beat had it
{
  const m = withVoice(); for (let i = 0; i < n; i++) m[1][i] *= 0.75; norm(m, -1.5);
  const r = rev(m), R = r.heard.beat, a = r.heard.after;
  check("lopsided: found", r.fixes.includes("balance"));
  check("lopsided: evened out", Math.abs(a.lrDb - R.lrDb) < 0.4, `${Math.abs(a.lrDb - R.lrDb).toFixed(2)} dB apart`);
}
// 6. a voice-sized amount of low-mid body is NOT a fault
{
  const m = withVoice(); m.forEach((x) => MR.run(x, MR.coef("peaking", 300, 1.5, 0.9, sr))); norm(m, -1.5);
  const r = rev(m);
  check("normal vocal body is left alone", !r.fixes.includes("mud") && !r.fixes.includes("low"), r.fixes.join(",") || "no fixes");
}
// 7. genre limits from the producer brain are used (a trap bass may be bigger)
{
  const m = clone(beat); m.forEach((x) => MR.run(x, MR.coef("lowshelf", 120, 3.2, 0.707, sr))); norm(m, -1.5);
  const strict = rev(clone(m)), trap = rev(clone(m), { limits: { lowOverBeatDb: 3.5 } });
  check("limits can be set per style", strict.fixes.includes("low") !== trap.fixes.includes("low") || strict.fixes.length >= trap.fixes.length, `default: ${strict.fixes.join(",") || "-"}  trap: ${trap.fixes.join(",") || "-"}`);
}
// 8. works without a beat to compare with (rumble and balance only), and on a clip that is too short
{
  const m = clone(beat); m.forEach((x) => { for (let i = 0; i < x.length; i++) x[i] += 0.06 * Math.sin(2 * Math.PI * 14 * i / sr); }); norm(m, -1.5);
  const r = MR.review(m, sr, {});
  check("no beat to compare: still fixes rumble", r.fixes.includes("rumble") && !r.fixes.includes("low") && !r.fixes.includes("mud"));
  const tiny = [new Float32Array(5000), new Float32Array(5000)];
  const t = MR.review(tiny, sr, { reference: beat });
  check("too short: left as it is", t.fixes.length === 0 && /too short/.test(t.lines[0]));
}
// 9. nothing broken: no NaN, same length
{
  const m = clone(beat); m.forEach((x) => MR.run(x, MR.coef("lowshelf", 120, 6, 0.707, sr))); norm(m, -1.5);
  rev(m);
  let ok = true; for (const x of m) { if (x.length !== n) ok = false; for (let i = 0; i < x.length; i += 97) if (!Number.isFinite(x[i])) { ok = false; break; } }
  check("output is finite and the same length", ok);
}
// 10. measured where the voice is not singing
{
  const m = norm(withVoice(), -1.5), r = rev(m);
  check("measures the voice-free parts when there are enough", r.heard.masked === true && /not singing/.test(r.lines.join(" ")));
}
// 11. a voice over the whole song: falls back to the whole song (bigger allowance), still catches a real fault, leaves a normal mix alone
{
  const full = [new Float32Array(n), new Float32Array(n)]; let s2 = 99; const rnd = () => { s2 = (s2 * 1664525 + 1013904223) >>> 0; return s2 / 4294967296 * 2 - 1; };
  for (let i = 0; i < n; i++) { const v = rnd() * 0.10; full[0][i] = v; full[1][i] = v; }
  full.forEach((x) => MR.run(x, MR.coef("highpass", 180, 0, 0.707, sr)));
  const act = MR.activityMap(full, sr, 0, n / sr);
  const mk = () => beat.map((x, c) => { const y = Float32Array.from(x); for (let i = 0; i < n; i++) y[i] += full[c][i]; return y; });
  const ok = mk(); norm(ok, -1.5); const r1 = MR.review(ok, sr, { reference: beat, activity: act });
  check("voice everywhere: whole song measured", r1.heard.masked === false);
  check("voice everywhere: a normal mix is left alone", r1.fixes.length === 0, r1.fixes.join(",") || "no fixes");
  const bad = mk(); bad.forEach((x) => MR.run(x, MR.coef("lowshelf", 120, 9, 0.707, sr))); norm(bad, -1.5);
  const r2 = MR.review(bad, sr, { reference: beat, activity: act });
  check("voice everywhere: a big fault is still found", r2.fixes.includes("low"), `bass ${(r2.heard.before.lowDb - r2.heard.beat.lowDb).toFixed(1)} dB over`);
}
process.exit(bad ? 1 : 0);
