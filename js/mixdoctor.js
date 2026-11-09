// =====================================================================
// Mix Doctor: Beat Lab checking its OWN result.
//
// The live auto-mix only looks at how loud each instrument is. The Doctor renders the beat (the chorus, the
// loudest and fullest part), listens to every instrument on its own and to the whole mix, and checks it the way a
// mix engineer would before handing a beat to a singer:
//
//   1. Is every instrument that should be playing actually making sound?
//   2. Is each instrument at its place in the balance (nothing buried, nothing sticking out)?
//   3. Is the low end under control (not too much weight below 150 Hz for a vocal to sit on top of)?
//   4. Is a bass, keys or pad crowding the 1-4 kHz range where the singer lives?
//   5. Is there room (headroom) so the vocal and the recorder never clip?
//   6. Is the audio valid (no NaN or clipping), and how wide is the stereo picture?
//
// Where it can fix something it does (level trims, master level), measures AGAIN, and repeats up to a few
// times. Where it cannot, it says what is wrong in plain words and what to change. The numbers it checks against
// were taken from the original genres (the Afrobeats and R&B mixes the app was tuned on).
//
// Needs: automix-bs.js (balanceTrims, levelDb), engine.js (TRACK_ORDER), beatgen.js (barView)
// =====================================================================

const MIXDOC = {
  headroomDb: -6,          // loudest peak of the finished beat (room for a vocal)
  peakTolDb: 1,            // within this much of the target is fine
  maxLowShare: 0.60,       // most energy allowed below 150 Hz (the original genres measure 48-54%)
  lowStepDb: 1.5,          // each pass lowers the bass-heavy tracks by this much...
  maxLowTrimDb: 4.5,       // ...but never by more than this in total
  maxVocalHog: 0.40,       // a bass / keys / pad holding more than this share of 1-4 kHz is crowding the singer
  hogStepDb: 2,
  maxHogTrimDb: 4,
  narrowCorr: 0.985,       // left/right correlation above this = practically mono
  probeBars: 4,            // how many chorus bars are rendered
  maxPasses: 4
};

// ---------- Maths (no audio, no page) ----------

// Radix-2 FFT, in place
function mdFFT(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const MD_BANDS = [["low", 20, 150], ["mid", 150, 1000], ["voice", 1000, 4000], ["high", 4000, 20000]];

// Average power in each band (low = under 150 Hz, voice = 1-4 kHz...) of a mono signal
function mdBandPower(mono, sampleRate) {
  const n = 8192, hop = 4096, win = new Float32Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  const power = {}; MD_BANDS.forEach(b => { power[b[0]] = 0; });
  const re = new Float32Array(n), im = new Float32Array(n);
  const frames = Math.max(1, Math.floor((mono.length - n) / hop) + 1);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < n; i++) { re[i] = (mono[f * hop + i] || 0) * win[i]; im[i] = 0; }
    mdFFT(re, im);
    for (let k = 1; k < n / 2; k++) {
      const hz = k * sampleRate / n, p = re[k] * re[k] + im[k] * im[k];
      for (const b of MD_BANDS) if (hz >= b[1] && hz < b[2]) { power[b[0]] += p; break; }
    }
  }
  return power;
}

// The app's own level measure: the loudest short moment (a 2048-sample RMS window)
function mdLoudestDb(mono) {
  const w = 2048; let best = 0;
  for (let i = 0; i + w <= mono.length; i += 512) {
    let p = 0; for (let j = 0; j < w; j++) p += mono[i + j] * mono[i + j];
    if (p / w > best) best = p / w;
  }
  return best > 0 ? 10 * Math.log10(best) : -Infinity;
}

function mdMono(buffer) {
  const l = buffer.getChannelData(0), r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = (l[i] + r[i]) / 2;
  return out;
}

// Peak, invalid samples and left/right correlation of a finished mix
function mdMixFacts(buffer) {
  const l = buffer.getChannelData(0), r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  let peak = 0, bad = 0, sl = 0, sr = 0, slr = 0;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = r[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { bad++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b)); if (m > peak) peak = m;
    sl += a * a; sr += b * b; slr += a * b;
  }
  return { peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity, bad, corr: sl > 0 && sr > 0 ? slr / Math.sqrt(sl * sr) : 1 };
}

// ---------- The probe: a short copy of the beat that is the chorus ----------
function mixProbeBeat(beat) {
  if (!beat.sections || !beat.sections.length || beat.structure === "loop") return beat;
  const chorus = beat.sections.find(s => s.kind === "chorus") || beat.sections[Math.min(1, beat.sections.length - 1)];
  // Start on the chorus's SECOND bar: the first bar fires an impact and a crash that do not belong to any one
  // instrument (a solo cannot switch them off) and would be measured as part of every track. Stop before the fill.
  const first = chorus.bars > 2 ? 1 : 0;
  const bars = Math.max(1, Math.min(MIXDOC.probeBars, chorus.bars - first - 1));
  // Keep the chorus's own index: every section has its own table of who plays in it (beat.presence[index])
  const sectionAt = []; for (let b = 0; b < bars; b++) sectionAt.push({ index: chorus.index, barIn: first + b });
  return Object.assign({}, beat, { sectionAt, totalBars: bars });
}

// Which tracks play at least one note in the probe
function mixProbeTracks(probe) {
  const played = {};
  for (let bar = 0; bar < probe.totalBars; bar++) {
    const view = barView(probe, bar, true);
    TRACK_ORDER.forEach(name => { if (view.tracks[name] && view.tracks[name].some(Boolean)) played[name] = true; });
  }
  return played;
}

const MD_NAMES = {
  kick: "kick", snare: "snare", clap: "clap", rim: "rim", hat: "hi-hat", openhat: "open hat", shaker: "shaker", perc: "percussion",
  bell: "bell", bass: "bass", logdrum: "log drum", chords: "keys", pad: "pad", pluck: "pluck", lead: "lead"
};
const md1 = v => (Math.round(v * 10) / 10).toFixed(1);
const mdPct = v => Math.round(v * 100) + "%";

// ---------- The Doctor ----------
//   settings : what the beat is rendered with (trim, autos, masterDb... as in renderSongBuffer)
//   render   : async (beat, settings) => AudioBuffer          (renderSongBuffer)
//   say      : (text) => void                                  progress messages
// Returns { autos, masterDb, findings: [{ status: "ok" | "fixed" | "warn", text }], facts }
async function mixDoctor({ beat, settings, render, say }) {
  const speak = say || (() => {});
  const probe = mixProbeBeat(beat);
  const played = mixProbeTracks(probe);
  // Only what will actually be heard: a muted track, or melody switched off, is not part of the mix being checked
  const heardNow = n => !settings.isAudible || settings.isAudible(n);
  const names = TRACK_ORDER.filter(n => played[n] && heardNow(n));
  const balance = TEMPLATES[beat.genre].balance;
  const findings = [];
  const zero = {}; TRACK_ORDER.forEach(n => { zero[n] = 0; });
  const flat = Object.assign({}, settings, { trim: Object.assign({}, zero), autos: Object.assign({}, zero), masterDb: 0, vocalSpaceOn: false, masteringOn: false });

  // 1. Each instrument on its own, at its starting volume
  const solos = {}, levels = {};
  let sampleRate = 44100, done = 0;
  for (const name of names) {
    speak("Mix Doctor: listening to the " + MD_NAMES[name] + "\u2026 " + (++done) + " / " + names.length);
    const buf = await render(probe, Object.assign({}, flat, { isAudible: n => n === name }));
    sampleRate = buf.sampleRate;
    const mono = mdMono(buf);
    solos[name] = mono;
    levels[name] = mdLoudestDb(mono);
  }

  // 2. Instruments that should play but make no sound
  const silent = names.filter(n => !Number.isFinite(levels[n]) || levels[n] < AUTOMIX.floorDb);
  silent.forEach(n => findings.push({ status: "warn", text: "The " + MD_NAMES[n] + " is supposed to play in this style but came out silent. Try another sound for it in the Sound panel." }));

  // 3. Balance: every instrument to its place under the kick (the same maths as the live auto-mix)
  const heard = {}; names.forEach(n => { if (!silent.includes(n)) heard[n] = levels[n]; });
  const result = balanceTrims({ levels: heard, balance });
  const autos = Object.assign({}, zero);
  Object.keys(result.autos).forEach(n => { autos[n] = result.autos[n]; });
  const moved = Object.keys(result.autos).filter(n => Math.abs(result.autos[n]) >= 4)
    .map(n => MD_NAMES[n] + (result.autos[n] > 0 ? " up " : " down ") + Math.abs(Math.round(result.autos[n])) + " dB");
  findings.push(moved.length
    ? { status: "fixed", text: "Balance: set each instrument to its place under the kick (" + moved.slice(0, 5).join(", ") + (moved.length > 5 ? ", ..." : "") + ")." }
    : { status: "ok", text: "Balance: every instrument already sat in its place." });
  if (Object.keys(result.autos).some(n => Math.abs(result.autos[n]) >= AUTOMIX.maxTrimDb - 0.05)) {
    const hit = Object.keys(result.autos).filter(n => Math.abs(result.autos[n]) >= AUTOMIX.maxTrimDb - 0.05).map(n => MD_NAMES[n]);
    findings.push({ status: "warn", text: "The " + hit.join(" and ") + " needed more correction than the auto-mix allows: that sound is far too loud or too quiet for this style." });
  }

  // 4. Render the whole mix, measure, fix, repeat. The last measurement is always taken AFTER the last fix,
  //    so what the report says is what the beat now does.
  let masterDb = 0, facts = null, shares = null, lowShare = 0, voiceHogs = {};
  let lowTrim = 0, lowFixed = false, hogFixed = {}, lowBefore = null;
  const lowTracks = ["bass", "logdrum"].filter(n => heard[n] !== undefined);
  const lowFallback = lowTracks.length ? lowTracks : ["kick"];

  const measure = async label => {
    speak("Mix Doctor: checking the whole mix\u2026 " + label);
    const buf = await render(probe, Object.assign({}, settings, { autos: Object.assign({}, autos), masterDb, masteringOn: false, isAudible: heardNow }));
    facts = mdMixFacts(buf);
    if (facts.bad) return false;
    shares = mdBandPower(mdMono(buf), sampleRate);
    lowShare = shares.low / ((shares.low + shares.mid + shares.voice + shares.high) || 1);
    if (lowBefore === null) lowBefore = lowShare;
    // who holds the singer's range (the solos at the gains now applied)
    voiceHogs = {};
    const voicePower = {}; let voiceTotal = 0;
    Object.keys(heard).forEach(n => {
      const g = Math.pow(10, (autos[n] + masterDb + (settings.trim[n] || 0)) / 20);
      voicePower[n] = mdBandPower(solos[n], sampleRate).voice * g * g;
      voiceTotal += voicePower[n];
    });
    ["bass", "chords", "pad"].forEach(n => { if (voicePower[n] && voiceTotal > 0) voiceHogs[n] = voicePower[n] / voiceTotal; });
    return true;
  };

  let clean = false;
  for (let pass = 1; pass <= MIXDOC.maxPasses; pass++) {
    if (!(await measure("pass " + pass))) { clean = true; break; }   // invalid audio: nothing to tune
    let changed = false;

    // headroom: the loudest peak of the real mix goes to the target
    const peakErr = MIXDOC.headroomDb - facts.peakDb;
    if (Number.isFinite(peakErr) && Math.abs(peakErr) > MIXDOC.peakTolDb / 2) { masterDb = Math.max(-24, Math.min(12, masterDb + peakErr)); changed = true; }

    // low end
    if (lowShare > MIXDOC.maxLowShare && lowTrim < MIXDOC.maxLowTrimDb) {
      const step = Math.min(MIXDOC.lowStepDb, MIXDOC.maxLowTrimDb - lowTrim);
      lowFallback.forEach(n => { autos[n] -= step; });
      lowTrim += step; lowFixed = true; changed = true;
    }

    // singer's range
    Object.keys(voiceHogs).forEach(n => {
      const taken = hogFixed[n] || 0;
      if (voiceHogs[n] > MIXDOC.maxVocalHog && taken < MIXDOC.maxHogTrimDb) {
        const step = Math.min(MIXDOC.hogStepDb, MIXDOC.maxHogTrimDb - taken);
        autos[n] -= step; hogFixed[n] = taken + step; changed = true;
      }
    });

    if (!changed) { clean = true; break; }
  }
  if (!clean) await measure("final check");        // the last pass still changed something: measure the result

  // 5. Report
  if (facts && facts.bad) {
    findings.push({ status: "warn", text: "Some sound produced invalid audio (" + facts.bad + " bad samples). Change the kit or instruments in the Sound panel and run the check again." });
  } else if (facts) {
    const lowNow = lowShare;
    findings.push(Math.abs(facts.peakDb - MIXDOC.headroomDb) <= MIXDOC.peakTolDb + 0.5
      ? { status: "ok", text: "Headroom: the loudest peak is " + md1(facts.peakDb) + " dBFS, so a vocal has room and nothing clips." }
      : { status: "warn", text: "Headroom: the loudest peak is " + md1(facts.peakDb) + " dBFS (aimed at " + MIXDOC.headroomDb + ")." });
    if (lowFixed) {
      findings.push(lowNow <= MIXDOC.maxLowShare
        ? { status: "fixed", text: "Low end: " + mdPct(lowBefore) + " of the energy was under 150 Hz (heavy for a vocal). Lowered the " + lowFallback.map(n => MD_NAMES[n]).join(" and ") + " by " + md1(lowTrim) + " dB, now " + mdPct(lowNow) + "." }
        : { status: "warn", text: "Low end is still heavy (" + mdPct(lowNow) + " under 150 Hz) after lowering it by " + md1(lowTrim) + " dB. Pick a lighter bass or log drum in the Sound panel." });
    } else {
      findings.push({ status: "ok", text: "Low end: " + mdPct(lowNow) + " of the energy is under 150 Hz, a good weight for a vocal to sit on." });
    }
    const hogNames = Object.keys(hogFixed);
    if (hogNames.length) {
      hogNames.forEach(n => {
        const left = voiceHogs[n];
        findings.push(left > MIXDOC.maxVocalHog
          ? { status: "warn", text: "The " + MD_NAMES[n] + " is still taking " + mdPct(left) + " of the singer's range (1-4 kHz) after lowering it " + md1(hogFixed[n]) + " dB. A darker " + MD_NAMES[n] + " sound would leave more room." }
          : { status: "fixed", text: "Singer's range: the " + MD_NAMES[n] + " was crowding 1-4 kHz. Lowered it " + md1(hogFixed[n]) + " dB." });
      });
    } else {
      findings.push({ status: "ok", text: "Singer's range: no bass, keys or pad is crowding 1-4 kHz." });
    }
    findings.push(facts.corr > MIXDOC.narrowCorr
      ? { status: "warn", text: "Stereo: the mix is almost mono (left/right match " + md1(facts.corr * 100) + "%). That is safe for a vocal, but panning percussion or widening the keys would feel bigger." }
      : { status: "ok", text: "Stereo: a healthy spread, and it still holds together in mono." });
  }

  return { autos, masterDb, findings, facts: { peakDb: facts && facts.peakDb, lowShare, levels } };
}
