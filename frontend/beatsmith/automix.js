// Auto-mix maths. Pure functions (no audio, no page), so they can be tested on their own.
//
// The idea: listen to how loud each track's hits really are, compare them with the
// genre's target balance (dB below the kick), and nudge each track's volume until
// nothing is buried and nothing sticks out.

const AUTOMIX = {
  floorDb: -70,        // a level below this means "this track is not playing"
  maxTrimDb: 14,       // the auto-mix never moves a track more than this up or down
  toleranceDb: 0.5,    // smaller differences than this are ignored
  headroomPeakDb: -6,  // unmastered mix: loudest peak sits at -6 dBFS, room left for vocals
  masteredRmsDb: -15,  // mastering on: average loudness aimed at (RMS, not true LUFS)
  maxMasterDb: 12      // the most the master level can be raised
};

// Short-term level of a block of samples (RMS) in dB
function levelDb(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

// Loudest single sample of a block, in dB
function peakDb(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Work out the auto-trim of every track.
//   levels  : { track: level in dB at the track's ORIGINAL volume }. The app measures a hit,
//             then takes off the volume that was applied while measuring, so the number does
//             not depend on earlier corrections. That is what keeps the auto-mix steady.
//   balance : { track: target dB below the kick, or null for "not used" }
// Returns { autos, rel }  rel = where each track naturally sits, compared with the kick.
function balanceTrims({ levels, balance, reference = "kick" }) {
  const autos = {};
  const rel = {};
  const ref = levels[reference];
  if (!Number.isFinite(ref)) return { autos, rel };

  for (const name of Object.keys(levels)) {
    if (name === reference) continue;
    const target = balance[name];
    if (target === null || target === undefined) continue;
    if (!Number.isFinite(levels[name]) || levels[name] < AUTOMIX.floorDb) continue;
    rel[name] = levels[name] - ref;
    autos[name] = clamp(target - rel[name], -AUTOMIX.maxTrimDb, AUTOMIX.maxTrimDb);
  }
  return { autos, rel };
}

// Work out the auto master level (dB).
//   unmastered : `peaks` are the loudest peaks of the last few bars, each with the master
//                level at that time taken off. The master is set so the loudest of them
//                lands on the headroom target (-6 dBFS by default).
//   mastered   : `rms` is the average loudness of the last bars; the master moves toward the
//                mastered loudness in gentle steps (the limiter catches the peaks).
function masterTrim({ peaks, rms, mastering, current }) {
  if (mastering) {
    if (!Number.isFinite(rms)) return current;
    const step = clamp(AUTOMIX.masteredRmsDb - rms, -6, 6);
    if (Math.abs(step) < AUTOMIX.toleranceDb) return current;
    return clamp(current + step, -24, AUTOMIX.maxMasterDb);
  }
  const loudest = Math.max(...(peaks || []).filter(Number.isFinite));
  if (!Number.isFinite(loudest)) return current;
  return clamp(AUTOMIX.headroomPeakDb - loudest, -24, 6);
}

// Lets the same file be tested in Node. Ignored in the browser.
if (typeof module !== "undefined") {
  module.exports = { AUTOMIX, levelDb, peakDb, median, balanceTrims, masterTrim };
}
