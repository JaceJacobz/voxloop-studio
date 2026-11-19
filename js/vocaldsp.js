// Vocal Sketch, the analysis part (v2.13.0). Pure functions, no DOM, no Tone: it runs in the browser and in Node (the tests).
// Beat Lab only. Nothing here touches Pipeline or Studio, and it does not use their pitch code.
//
// What it does with a sung (or rapped) take:
//   resample16k      any sample rate to 16 kHz mono
//   trackPitch       YIN pitch tracking, one reading every 16 ms (async, so a phone stays responsive)
//   segmentNotes     readings to notes (start, length, pitch), octave jumps removed, slides merged
//   toGrid           notes to bars and 16th steps, on a tempo that is already known (the click)
//   detectKey        the key and scale from the notes (Krumhansl profiles + a dorian check), best four with a confidence
//   fitChords        one chord per bar (or per half bar) that fits the melody, three different harmonic rhythms
//   flow             rap: syllable onsets, density per bar and the stressed steps (no pitch needed)
//   estimateTempo    a tempo guess for an imported voice note that has no click
// A scale degree is 0..6 inside the key (the same numbers Beat Lab's progressions use).
(function (root) {
  "use strict";
  const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11] };
  const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const SR = 16000, HOP = 256;                 // 16 ms per reading
  const tick = () => new Promise(r => setTimeout(r, 0));

  // ---------- samples ----------
  function resample16k(data, sr) {
    if (sr === SR) return Float32Array.from(data);
    const ratio = sr / SR, n = Math.floor(data.length / ratio), out = new Float32Array(n), w = Math.max(1, Math.floor(ratio));
    for (let i = 0; i < n; i++) {                       // a box filter then a linear pick: enough for pitch work
      const p = i * ratio, a = Math.floor(p);
      let s = 0, c = 0;
      for (let k = 0; k < w && a + k < data.length; k++) { s += data[a + k]; c++; }
      out[i] = c ? s / c : 0;
    }
    return out;
  }
  function toMono(buffer) {                              // a Web Audio AudioBuffer to one Float32Array
    const ch = buffer.numberOfChannels, n = buffer.length, out = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  }
  const midiOf = f => 69 + 12 * Math.log2(f / 440);
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

  // ---------- pitch (YIN) ----------
  function yinAt(x, start, W, tauMin, tauMax) {
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const diff = x[start + j] - x[start + j + tau]; s += diff * diff; }
      d[tau] = s;
    }
    let run = 0; const dn = new Float32Array(tauMax + 1); dn[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; dn[tau] = run ? d[tau] * tau / run : 1; }
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (dn[t] < 0.15) { while (t + 1 < tauMax && dn[t + 1] < dn[t]) t++; tau = t; break; }
    }
    let conf;
    if (tau < 0) { let m = tauMin; for (let t = tauMin; t < tauMax; t++) if (dn[t] < dn[m]) m = t; tau = m; conf = 1 - dn[m]; if (conf < 0.7) return { f0: 0, conf }; }
    else conf = 1 - dn[tau];
    const a = dn[tau - 1], b = dn[tau], c = dn[Math.min(tau + 1, tauMax)];
    const den = a - 2 * b + c, shift = den ? 0.5 * (a - c) / den : 0;
    return { f0: SR / (tau + shift), conf };
  }
  // x: 16 kHz mono. Returns frames [{t, midi, conf, rms, voiced}]
  async function trackPitch(x, opts) {
    opts = opts || {};
    const W = 512, tauMin = Math.floor(SR / 900), tauMax = Math.floor(SR / 65), need = W + tauMax;
    const frames = [];
    for (let s = 0; s + need <= x.length; s += HOP) {
      let e = 0; for (let j = 0; j < W; j++) e += x[s + j] * x[s + j];
      const rms = Math.sqrt(e / W);
      const y = rms > 0.002 ? yinAt(x, s, W, tauMin, tauMax) : { f0: 0, conf: 0 };
      frames.push({ t: (s + W / 2) / SR, midi: y.f0 ? midiOf(y.f0) : 0, conf: y.conf, rms });
      if (opts.onProgress && frames.length % 150 === 0) { opts.onProgress(s / x.length); await tick(); }
    }
    const floor = median(frames.map(f => f.rms).sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(frames.length * 0.2))));
    const sorted = frames.map(f => f.rms).sort((a, b) => a - b), peak = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    const gate = Math.max(0.006, Math.min(floor * 3, peak * 0.3));   // never above 30% of the loud parts (a clean take has no noise floor)
    frames.forEach(f => { f.voiced = f.midi > 0 && f.conf > 0.7 && f.rms > gate && f.midi > 33 && f.midi < 90; });
    return frames;
  }

  // ---------- notes ----------
  function segmentNotes(frames) {
    // 1. remove octave jumps against a running median of the last few voiced readings
    const recent = [];
    const mid = frames.map(f => {
      if (!f.voiced) { recent.length = 0; return 0; }
      let m = f.midi;
      if (recent.length >= 3) {
        const ref = median(recent);
        while (m - ref > 7) m -= 12;
        while (ref - m > 7) m += 12;
      }
      recent.push(m); if (recent.length > 7) recent.shift();
      return m;
    });
    // 2. cut into notes: a gap of 2+ unvoiced readings (a re-sung note on the same pitch has a small dip), or a lasting move of more than 0.9 semitone
    const notes = []; let cur = null, off = 0, unv = 0;
    const close = () => {
      if (!cur) return;
      const n = cur.f.length;
      if (n >= 3) {
        const ms = cur.f.map(i => mid[i]), t0 = frames[cur.f[0]].t, t1 = frames[cur.f[n - 1]].t + HOP / SR;
        notes.push({ t: t0 - HOP / SR / 2, dur: t1 - t0, midi: median(ms), vel: Math.min(1, median(cur.f.map(i => frames[i].rms)) * 6) });
      }
      cur = null;
    };
    frames.forEach((f, i) => {
      if (!f.voiced) { unv++; if (unv >= 2) close(); return; }
      unv = 0;
      if (cur) {
        const m = median(cur.f.map(k => mid[k]).slice(-5));
        if (Math.abs(mid[i] - m) > 0.9) { off++; if (off >= 3) { const keep = cur.f.splice(cur.f.length - 2, 2); close(); cur = { f: keep.concat([i]) }; off = 0; return; } }
        else off = 0;
        cur.f.push(i);
      } else { cur = { f: [i] }; off = 0; }
    });
    close();
    // 3. slides: a note shorter than 90 ms joins its neighbour that is closer in pitch
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.dur >= 0.09 || notes.length < 2) continue;
      const prev = notes[i - 1], next = notes[i + 1];
      const near = (prev && next) ? (Math.abs(prev.midi - n.midi) <= Math.abs(next.midi - n.midi) ? prev : next) : (prev || next);
      if (near === prev && prev && Math.abs(prev.midi - n.midi) < 3) { prev.dur = n.t + n.dur - prev.t; notes.splice(i, 1); }
      else if (near === next && next && Math.abs(next.midi - n.midi) < 3) { next.dur = next.t + next.dur - n.t; next.t = n.t; notes.splice(i, 1); }
      else if (n.dur < 0.06) notes.splice(i, 1);
    }
    // 4. the singer's tuning: the typical distance from the nearest semitone, taken out so a flat or sharp voice still lands on the right notes
    const dev = notes.map(n => ({ d: n.midi - Math.round(n.midi), w: n.dur }));
    let sx = 0, sy = 0; dev.forEach(o => { sx += Math.cos(o.d * 2 * Math.PI) * o.w; sy += Math.sin(o.d * 2 * Math.PI) * o.w; });
    const tuning = notes.length ? Math.atan2(sy, sx) / (2 * Math.PI) : 0;
    notes.forEach(n => { n.pitch = Math.round(n.midi - tuning); });
    return { notes, tuning };
  }

  // ---------- grid ----------
  // offsetSec: the time in the take where bar 1 beat 1 sits. Returns notes as { bar, step, len, pitch, vel } on 16th steps.
  function toGrid(notes, bpm, offsetSec) {
    const spb = 60 / bpm, step = spb / 4, out = [];
    notes.forEach(n => {
      const s = Math.round((n.t - offsetSec) / step);
      if (s < 0) return;
      const len = Math.max(1, Math.round(n.dur / step));
      out.push({ bar: Math.floor(s / 16), step: s % 16, abs: s, len, pitch: n.pitch, vel: n.vel });
    });
    // two notes on one step: keep the longer one
    const seen = new Map();
    out.forEach(n => { const k = n.abs; if (!seen.has(k) || seen.get(k).len < n.len) seen.set(k, n); });
    return Array.from(seen.values()).sort((a, b) => a.abs - b.abs);
  }

  // ---------- key ----------
  function pearson(a, b) {
    const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }
  // notes: [{pitch, dur|len, ...}]. Returns { best:{root,scale,score}, candidates:[...], confidence:0..1, total }
  function detectKey(notes) {
    const hist = new Array(12).fill(0); let total = 0, first = null, last = null;
    notes.forEach(n => { const w = n.dur != null ? n.dur : n.len; hist[((n.pitch % 12) + 12) % 12] += w; total += w; if (!first) first = n; last = n; });
    if (!total) return { best: null, candidates: [], confidence: 0, total: 0 };
    const cands = [];
    for (let r = 0; r < 12; r++) {
      const rot = hist.map((_, i) => hist[(i + r) % 12]);
      let maj = pearson(rot, KS_MAJOR), min = pearson(rot, KS_MINOR);
      // a long final note on the tonic is a strong hint (songs end at home)
      if (last && ((last.pitch % 12) + 12) % 12 === r) { maj += 0.06; min += 0.06; }
      // the first note and the most-sung note are hints too; they settle A minor against its relative C major
      if (first && ((first.pitch % 12) + 12) % 12 === r) { maj += 0.03; min += 0.03; }
      if (hist[r] === Math.max(...hist)) { maj += 0.04; min += 0.04; }
      cands.push({ root: r, scale: "major", score: maj });
      const m6 = rot[9], b6 = rot[8];
      cands.push({ root: r, scale: m6 > b6 * 1.5 && m6 / total > 0.05 ? "dorian" : "minor", score: min + (m6 > b6 * 1.5 && m6 / total > 0.05 ? 0.02 : 0) });
    }
    cands.sort((a, b) => b.score - a.score);
    const uniq = []; cands.forEach(c => { if (!uniq.some(u => u.root === c.root && u.scale === c.scale)) uniq.push(c); });
    const gap = uniq[0].score - uniq[1].score;
    // the relative major / minor pair (A minor and C major hold the same notes) can never be told apart with certainty: cap the confidence
    const rel = uniq[1].root === (uniq[0].scale === 'major' ? (uniq[0].root + 9) % 12 : (uniq[0].root + 3) % 12) && uniq[1].scale !== uniq[0].scale;
    let conf = 0.35 + gap * 4 + Math.min(1, total / 8) * 0.25; if (rel) conf = Math.min(conf, 0.6);
    return { best: uniq[0], candidates: uniq.slice(0, 4), confidence: Math.max(0, Math.min(1, conf)), total };
  }
  function degreeOf(pitch, key) {                         // scale degree 0..6 of a note, or -1 when it is outside the scale
    const sc = SCALES[key.scale], pc = (((pitch - key.root) % 12) + 12) % 12;
    return sc.indexOf(pc);
  }

  // ---------- chords ----------
  // gridNotes: toGrid output for ONE section; bars: number of bars; slotsPerBar: 1 or 2.
  // Returns [ [degrees for option 1], [option 2], [option 3] ], each with bars*slotsPerBar entries.
  function fitChords(gridNotes, key, bars, slotsPerBar) {
    const slots = bars * slotsPerBar, per = 16 / slotsPerBar;
    const score = Array.from({ length: slots }, () => new Array(7).fill(0));
    const has = new Array(slots).fill(0);
    gridNotes.forEach(n => {
      for (let k = 0; k < n.len; k++) {                      // a long note counts in every slot it sounds in
        const a = n.abs + k, slot = Math.floor(a / per); if (slot < 0 || slot >= slots) continue;
        const d = degreeOf(n.pitch, key), strong = (a % 4 === 0) ? 1.4 : 1;
        has[slot] += strong;
        for (let c = 0; c < 7; c++) {
          const tones = [c, (c + 2) % 7, (c + 4) % 7];
          let w;
          if (d < 0) w = -0.3; else if (d === c) w = 1.3; else if (tones.includes(d)) w = 1; else w = -0.2;
          score[slot][c] += w * strong;
        }
      }
    });
    score.forEach((row, s) => { const norm = Math.max(4, has[s]); for (let c = 0; c < 7; c++) row[c] /= norm; });
    const options = [0.18, 0.5, 1.1].map(change => {
      // Viterbi: the best chord path, a change costs `change`, falling by a fourth or fifth is cheaper
      const best = score.map(() => new Array(7).fill(-1e9)), from = score.map(() => new Array(7).fill(0));
      for (let c = 0; c < 7; c++) best[0][c] = score[0][c] + (c === 0 ? 0.25 : 0);
      for (let s = 1; s < slots; s++) {
        for (let c = 0; c < 7; c++) {
          let bv = -1e9, bp = 0;
          for (let p = 0; p < 7; p++) {
            const move = ((c - p) % 7 + 7) % 7;
            const cost = p === c ? 0 : change * ((move === 3 || move === 4) ? 0.6 : move === 1 || move === 6 ? 1.05 : 1);
            const v = best[s - 1][p] - cost;
            if (v > bv) { bv = v; bp = p; }
          }
          best[s][c] = bv + score[s][c] + (s === slots - 1 && c === 0 ? 0.2 : 0);
          from[s][c] = bp;
        }
      }
      let c = best[slots - 1].indexOf(Math.max(...best[slots - 1])); const path = new Array(slots);
      for (let s = slots - 1; s >= 0; s--) { path[s] = c; c = from[s][c]; }
      return path;
    });
    return options;
  }


  // ---------- chords that follow the melody, note by note ----------
  // fitChords (above) only chooses among the 7 chords of one key. A singer who is a little loose, or who wanders out of the
  // key, gets chords that clash. fitTriads looks at the real pitches (not rounded to a semitone) in each bar and may use any
  // of the 24 major/minor triads; a mild preference for the key keeps the result musical.
  const MAJ_PCS = [0, 2, 4, 5, 7, 9, 11], MIN_PCS = [0, 2, 3, 5, 7, 8, 10];
  function toneFit(miss) { return miss <= 0.35 ? 1 : miss <= 0.65 ? 0.7 : miss <= 1.3 ? -0.45 : 0.05; }   // 0 = right on a chord tone; about a semitone off = a clash
  function pcDist(midi, pc) { let d = ((midi - pc) % 12 + 12) % 12; return d > 6 ? 12 - d : d; }
  // notes: [{t, dur, midi}] (midi may be fractional). Returns { slots, notes per slot weights } used by fitTriads and triadFit.
  function slotWeights(notes, bpm, offsetSec, bars, slotsPerBar) {
    const spb = 60 / bpm, slotSec = spb * 4 / slotsPerBar, slots = bars * slotsPerBar, out = Array.from({ length: slots }, () => []);
    notes.forEach(n => {
      const a = n.t - offsetSec, b = a + Math.min(n.dur, 2.5);
      for (let k = Math.max(0, Math.floor(a / slotSec)); k <= Math.min(slots - 1, Math.floor((b - 1e-6) / slotSec)); k++) {
        const ov = Math.min(b, (k + 1) * slotSec) - Math.max(a, k * slotSec); if (ov <= 0) continue;
        const onBeat = Math.abs(a / spb - Math.round(a / spb)) < 0.12 && Math.floor(a / slotSec) === k;
        out[k].push({ m: n.midi !== undefined ? n.midi : n.pitch, w: ov * (onBeat ? 1.5 : 1) });
      }
    });
    return out;
  }
  function triadTones(root, minor) { return [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12]; }
  function fitTriads(notes, bpm, offsetSec, bars, slotsPerBar, keyHint) {
    const sw = slotWeights(notes, bpm, offsetSec, bars, slotsPerBar), slots = sw.length, N = 24;      // state = root + 12 * (minor ? 1 : 0)
    const score = sw.map(list => {
      const tot = list.reduce((a, x) => a + x.w, 0), row = new Array(N).fill(0);
      if (tot <= 0) return row;
      for (let st = 0; st < N; st++) {
        const tones = triadTones(st % 12, st >= 12); let sc = 0;
        list.forEach(x => { sc += x.w * toneFit(Math.min(...tones.map(pc => pcDist(x.m, pc)))); });
        row[st] = sc / Math.max(tot, 0.6);                  // quiet slots count less than full ones
      }
      return row;
    });
    const inKey = new Array(N).fill(0);
    if (keyHint) {
      const sc = keyHint.scale === "major" ? MAJ_PCS : MIN_PCS;
      for (let st = 0; st < N; st++) { const r = st % 12, minor = st >= 12; const deg = sc.indexOf(((r - keyHint.root) % 12 + 12) % 12); if (deg < 0) continue;
        const third = (sc[(deg + 2) % 7] - sc[deg] + 12) % 12; if (third === (minor ? 3 : 4)) inKey[st] = deg === 0 ? 0.2 : 0.12; }
    }
    return [0.12, 0.3, 0.7].map(change => {
      const best = score.map(() => new Array(N).fill(-1e9)), from = score.map(() => new Array(N).fill(0));
      for (let st = 0; st < N; st++) best[0][st] = score[0][st] + inKey[st];
      for (let s = 1; s < slots; s++) for (let st = 0; st < N; st++) {
        let bv = -1e9, bp = 0;
        for (let p = 0; p < N; p++) {
          let cost = 0;
          if (p !== st) { const mv = (((st % 12) - (p % 12)) % 12 + 12) % 12, common = triadTones(p % 12, p >= 12).filter(x => triadTones(st % 12, st >= 12).includes(x)).length;
            cost = change * ((mv === 5 || mv === 7) ? 0.7 : (mv === 3 || mv === 4 || mv === 8 || mv === 9) ? 0.9 : 1.15) * (common ? 0.8 : 1); }
          const v = best[s - 1][p] - cost; if (v > bv) { bv = v; bp = p; }
        }
        best[s][st] = bv + score[s][st] + inKey[st] * 0.5; from[s][st] = bp;
      }
      let c = best[slots - 1].indexOf(Math.max(...best[slots - 1])); const path = new Array(slots);
      for (let s = slots - 1; s >= 0; s--) { path[s] = c; c = from[s][c]; }
      return path.map(st => ({ root: st % 12, minor: st >= 12 }));
    });
  }
  // How much of the sung notes (by weight) sits on the chord tones of the chord under it? 0..1.  chords: [{root, minor}] one per slot.
  function triadFit(chords, notes, bpm, offsetSec, bars, slotsPerBar) {
    const sw = slotWeights(notes, bpm, offsetSec, bars, slotsPerBar); let ok = 0, tot = 0;
    sw.forEach((list, k) => { const c = chords[k % chords.length], tones = triadTones(c.root, c.minor); list.forEach(x => { tot += x.w; if (Math.min(...tones.map(pc => pcDist(x.m, pc))) <= 0.65) ok += x.w; }); });
    return tot ? ok / tot : 0;
  }


  // ---------- tap along: tempo and beat position from a person tapping the beat while the take plays ----------
  // times: seconds into the take of each tap; bpm0: the tempo to start from. Taps that come too soon after the last one (double taps) are dropped;
  // a missed beat is allowed (a gap of two beats counts as two). Returns { bpm, phase (seconds of a beat line inside one beat), spread (typical miss, seconds), used } or null.
  function fitTaps(times, bpm0) {
    const raw = times.filter(isFinite).sort((a, b) => a - b); let spb = 60 / bpm0, t = [];
    raw.forEach(x => { if (!t.length || x - t[t.length - 1] > 0.4 * spb) t.push(x); });
    if (t.length < 6) return null;
    let ks = [0]; for (let i = 1; i < t.length; i++) ks.push(ks[i - 1] + Math.max(1, Math.round((t[i] - t[i - 1]) / spb)));
    let pts = t.map((x, i) => [ks[i], x]), a = 0;
    for (let it = 0; it < 4; it++) {
      const n = pts.length, mk = pts.reduce((s2, p) => s2 + p[0], 0) / n, mt = pts.reduce((s2, p) => s2 + p[1], 0) / n;
      let num = 0, den = 0; pts.forEach(p => { num += (p[0] - mk) * (p[1] - mt); den += (p[0] - mk) * (p[0] - mk); });
      if (!den) return null;
      spb = num / den; a = mt - spb * mk;
      const keep = pts.filter(p => Math.abs(p[1] - (a + spb * p[0])) <= 0.2 * spb);
      if (keep.length < 6) break; if (keep.length === pts.length) break; pts = keep;
    }
    const bpm = 60 / spb; if (!(bpm > 40 && bpm < 220)) return null;
    const res = pts.map(p => p[1] - (a + spb * p[0])), spread = Math.sqrt(res.reduce((s2, r) => s2 + r * r, 0) / res.length);
    return { bpm, phase: ((a % spb) + spb) % spb, spread, used: pts.length };
  }


  // ---------- the groove of the singer ----------
  // How far late does the singer put the off-beat eighth notes? 0 = straight, 1 = a full triplet feel (the off-beat sits 2/3 of the way through the beat).
  // Measured between the notes on the beat and the notes between the beats, so a constant lag of the voice does not matter.
  // Returns { s: 0..1.2, offset (beats), on, off } or null when there are too few notes to say.
  function swingOf(notes, bpm) {
    const T = 60 / bpm; let c = 0, sn = 0, w = 0;
    notes.forEach(n => { const a = 2 * Math.PI * n.t / T, k = Math.min(1, n.dur / 0.3); c += k * Math.cos(a); sn += k * Math.sin(a); w += k; });
    if (!w) return null;
    const phi = Math.atan2(sn, c) / (2 * Math.PI), on = [], off = [];
    notes.forEach(n => { let p = n.t / T - phi; p -= Math.floor(p); p = p > 0.85 ? p - 1 : p; if (p >= -0.15 && p < 0.2) on.push(p); else if (p >= 0.3 && p < 0.85) off.push(p); });
    if (on.length < 4 || off.length < 4) return null;
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length, offset = (mean(off) - mean(on)) - 0.5;
    let c2 = 0, s2 = 0; notes.forEach(n => { const a = 4 * Math.PI * n.t / T, k = Math.min(1, n.dur / 0.3); c2 += k * Math.cos(a); s2 += k * Math.sin(a); });
    return { s: Math.max(0, Math.min(1.2, offset / 0.167)), offset, r: Math.max(Math.hypot(c, sn), Math.hypot(c2, s2)) / w, on: on.length, off: off.length };   // r: how tightly the notes sit on the beats or on the eighth notes (the better of the two); below ~0.45 the groove cannot be read (a random scatter reads as a slight swing)
  }

  // ---------- rap flow ----------
  function flow(x, bpm, offsetSec, bars) {
    const hop = 320, env = [];                                 // 20 ms
    for (let s = 0; s + hop <= x.length; s += hop) { let e = 0; for (let j = 0; j < hop; j++) e += x[s + j] * x[s + j]; env.push(Math.sqrt(e / hop)); }
    const sm = env.map((_, i) => (env[i - 1] || env[i]) * 0.25 + env[i] * 0.5 + (env[i + 1] || env[i]) * 0.25);
    const floor = median(sm.slice().sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(sm.length * 0.2))));
    const thr = Math.max(0.008, floor * 3), onsets = [];
    for (let i = 2; i < sm.length - 2; i++) {
      const rise = sm[i] - sm[i - 2];
      if (sm[i] > thr && rise > sm[i] * 0.25 && sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && (!onsets.length || (i - onsets[onsets.length - 1].i) * 0.02 > 0.09)) onsets.push({ i, t: i * 0.02, a: sm[i] });
    }
    const spb = 60 / bpm, step = spb / 4, perBar = new Array(Math.max(1, bars)).fill(0), stress = new Array(16).fill(0);
    onsets.forEach(o => {
      const s = Math.round((o.t - offsetSec) / step); if (s < 0) return;
      const bar = Math.floor(s / 16); if (bar < perBar.length) perBar[bar]++;
      stress[s % 16] += o.a;
    });
    const used = perBar.filter(v => v > 0), density = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
    const top = Math.max(...stress, 1e-9);
    return { onsetT: onsets.map(o => o.t), onsets: onsets.length, perBar, density, level: density < 5 ? "slow" : density < 9 ? "medium" : "fast", stress: stress.map(v => v / top) };
  }

  // ---------- tempo of a voice note with no click ----------
  function estimateTempo(x) {
    const hop = 320, env = [];
    for (let s = 0; s + hop <= x.length; s += hop) { let e = 0; for (let j = 0; j < hop; j++) e += x[s + j] * x[s + j]; env.push(Math.sqrt(e / hop)); }
    const d = env.map((v, i) => Math.max(0, v - (env[i - 1] || 0)));
    const m = d.reduce((a, b) => a + b, 0) / (d.length || 1); const z = d.map(v => v - m);
    let bestBpm = 0, bestV = -1e9;
    for (let bpm = 60; bpm <= 150; bpm++) {
      const lag = Math.round(60 / bpm / 0.02); let s = 0, c = 0;
      for (let i = 0; i + lag < z.length; i++) { s += z[i] * z[i + lag]; c++; }
      const prior = Math.exp(-0.5 * ((Math.log(bpm / 95)) / 0.35) ** 2);
      const v = (c ? s / c : 0) * prior;
      if (v > bestV) { bestV = v; bestBpm = bpm; }
    }
    return bestBpm || 95;
  }

  // How many whole bars a take is: the nearest of 1, 2, 4, 6, 8, 12, 16 (a singer rarely ends exactly on a bar)
  function suggestBars(durSec, bpm) {
    const bar = 4 * 60 / bpm, raw = durSec / bar, choices = [1, 2, 4, 6, 8, 12, 16];
    let best = choices[0], bv = 1e9;
    choices.forEach(c => { const d = Math.abs(raw - c) + (c > raw ? 0 : 0.35); if (d < bv) { bv = d; best = c; } });
    return best;
  }


  // ---------- the vibe: what does this voice feel like? ----------
  // Features of one take (a sung line, or a rap with its syllables a bar), measured in beats so they mean the same at any tempo.
  function takeFeatures(pcm, notes, bpm, rapDensity) {
    const spb = 60 / bpm, f = { bpm, sung: !rapDensity };
    let sumSq = 0, cnt = 0; const lv = [];
    (notes || []).forEach(n => {
      const a = Math.max(0, Math.floor(n.t * SR)), b = Math.min(pcm.length, Math.floor((n.t + n.dur) * SR)); let e = 0;
      for (let i = a; i < b; i++) e += pcm[i] * pcm[i];
      if (b > a) { const r = Math.sqrt(e / (b - a)); lv.push(r); sumSq += e; cnt += b - a; }
    });
    if (!notes || !notes.length) {                                // a rap: the whole take's loudness where it is not silent
      let e = 0, c = 0; for (let i = 0; i < pcm.length; i += 4) { const v = pcm[i] * pcm[i]; if (v > 1e-5) { e += v; c++; } }
      f.loudDb = c ? 10 * Math.log10(e / c) : -60; f.notesPerBeat = rapDensity ? rapDensity / 4 : 0; f.medDurBeats = 0.3; f.range = 0; f.meanInterval = 0; f.dynCV = 0.3; f.meanMidi = 0; return f;
    }
    f.loudDb = cnt ? 10 * Math.log10(sumSq / cnt) : -60;
    const m = lv.reduce((a, b) => a + b, 0) / lv.length, sd = Math.sqrt(lv.reduce((a, b) => a + (b - m) * (b - m), 0) / lv.length);
    f.dynCV = m ? sd / m : 0;
    const span = Math.max(spb, notes[notes.length - 1].t + notes[notes.length - 1].dur - notes[0].t), durs = notes.map(n => n.dur / spb).sort((a, b) => a - b);
    f.notesPerBeat = notes.length / (span / spb); f.medDurBeats = durs[Math.floor(durs.length / 2)];
    const ps = notes.map(n => n.pitch).sort((a, b) => a - b); f.range = ps[Math.floor(ps.length * 0.95)] - ps[Math.floor(ps.length * 0.05)];
    let iv = 0; for (let i = 1; i < notes.length; i++) iv += Math.abs(notes[i].pitch - notes[i - 1].pitch); f.meanInterval = notes.length > 1 ? iv / (notes.length - 1) : 0;
    f.meanMidi = ps.reduce((a, b) => a + b, 0) / ps.length;
    return f;
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));
  // How energetic is a take (0 calm .. 1 driving)? Used for the whole voice and to shape each section of the beat.
  function energyOf(f) {
    const tempoN = clamp01((f.bpm - 70) / 70), densityN = clamp01((f.notesPerBeat - 0.3) / 1.0), loudN = clamp01((f.loudDb + 38) / 22);
    return 0.4 * tempoN + 0.35 * densityN + 0.25 * loudN;
  }
  // Mix the features of all takes (weighted by length), then score the eight vibes of the producer (chill, dark, romantic ...).
  function vibeOf(list, scale) {
    if (!list.length) return null;
    const tot = list.reduce((a, x) => a + (x.w || 1), 0), avg = k => list.reduce((a, x) => a + (x.f[k] || 0) * (x.w || 1), 0) / tot;
    const f = { bpm: list[0].f.bpm, notesPerBeat: avg("notesPerBeat"), medDurBeats: avg("medDurBeats"), loudDb: avg("loudDb"), range: avg("range"), meanInterval: avg("meanInterval"), dynCV: avg("dynCV"), meanMidi: avg("meanMidi") };
    const E = energyOf(f), calm = 1 - E, sustain = clamp01((f.medDurBeats - 0.4) / 1.6), wide = clamp01((f.range - 6) / 10), leaps = clamp01((f.meanInterval - 1) / 3), expressive = clamp01(f.dynCV / 0.6);
    const minor = scale === "minor" ? 1 : scale === "dorian" ? 0.6 : 0, major = scale === "major" ? 1 : 0, loudN = clamp01((f.loudDb + 38) / 22), dens = clamp01((f.notesPerBeat - 0.3) / 1.0);
    const sc = {
      chill: calm * 1.0 + sustain * 0.5 + major * 0.15 + (1 - dens) * 0.2,
      romantic: calm * 0.8 + sustain * 0.6 + minor * 0.25 + (1 - leaps) * 0.15,
      dreamy: sustain * 0.9 + calm * 0.45 + wide * 0.2 + (1 - dens) * 0.2,
      soulful: expressive * 0.55 + sustain * 0.25 + wide * 0.25 + leaps * 0.2 - E * 0.15,        // a wide range alone must not make a voice soulful
      dark: minor * 0.55 + (1 - loudN) * 0.25 + (1 - wide) * 0.1,
      hard: E * 0.4 + loudN * 0.9 + minor * 0.2 + dens * 0.15 - 0.25,
      party: E * 0.9 + major * 0.5 + clamp01((f.bpm - 100) / 40) * 0.4 + dens * 0.25,
      uplifting: major * 0.8 + E * 0.5 + wide * 0.3 + leaps * 0.2
    };
    const order = Object.keys(sc).sort((a, b) => sc[b] - sc[a]), traits = [];
    traits.push(f.bpm < 90 ? "slow" : f.bpm > 125 ? "fast" : "mid-tempo");
    traits.push(dens < 0.3 ? "sparse" : dens > 0.65 ? "busy" : "moderately busy");
    if (sustain > 0.55) traits.push("long held notes"); else if (sustain < 0.2) traits.push("short, quick notes");
    if (loudN > 0.7) traits.push("strong delivery"); else if (loudN < 0.3) traits.push("soft delivery");
    if (wide > 0.6) traits.push("wide range"); else if (wide < 0.2) traits.push("narrow range");
    if (minor) traits.push("minor key"); else if (major) traits.push("major key");
    return { energy: E, scores: sc, top: order[0], order, traits, features: f };
  }

  const api = { swingOf, fitTaps, fitTriads, triadFit, takeFeatures, energyOf, vibeOf, SCALES, SR, resample16k, toMono, trackPitch, segmentNotes, toGrid, detectKey, degreeOf, fitChords, flow, estimateTempo, suggestBars, midiOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.VocalDSP = api;
})(typeof window !== "undefined" ? window : globalThis);
