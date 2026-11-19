// Starting faders for the recorded sounds.
// The template faders (mix) were set when the instruments were synthesized. Each track was re-measured with the recordings
// (loudest 46 ms of the track played alone, compared with the kick the way the live auto-mix measures) against the genre's
// target balance, and the difference is added here (dB). The auto-mix still fine-tunes during playback; this just
// means it starts close instead of moving a track by 10 dB.
const MIX_CAL = {
 "afrobeats": {
  "snare": -4.0,
  "clap": -1.5,
  "rim": 2.0,
  "hat": 8.0,
  "openhat": 9.0,
  "shaker": -2.5,
  "bass": -10.5,
  "pad": 3.5,
  "pluck": 5.0
 },
 "amapiano": {
  "snare": -2.5,
  "hat": 9.5,
  "openhat": 9.0,
  "shaker": -4.5,
  "perc": -3.0,
  "bell": 1.5,
  "bass": -7.5,
  "logdrum": -5.5,
  "chords": -2.0,
  "pad": 1.5,
  "pluck": 2.5,
  "rim": -2.5
 },
 "afrohouse": {
  "snare": -3.5,
  "rim": 3.5,
  "hat": 9.0,
  "openhat": 9.0,
  "shaker": -3.5,
  "bass": -7.0,
  "chords": 3.0,
  "pluck": 5.0,
  "pad": 5.5,
  "bell": 3.5
 },
 "rnb": {
  "snare": -5.5,
  "clap": -4.0,
  "hat": 9.5,
  "openhat": 9.0,
  "perc": -5.0,
  "bell": 3.0,
  "bass": -10.0,
  "chords": 3.5,
  "pad": 5.5,
  "pluck": 6.5,
  "rim": -4.5,
  "shaker": -8.5
 },
 "afrolust": {
  "clap": 3.0,
  "hat": 11.5,
  "openhat": 20.0,
  "bass": -10.0,
  "pluck": 4.0,
  "chords": 3.0,
  "bell": 2.5,
  "snare": -1.5,
  "rim": -2.5,
  "logdrum": 1.5,
  "shaker": -1.5,
  "perc": -1.5
 },
 "trap": {
  "hat": 6.0,
  "perc": -2.0,
  "bell": -2.0,
  "bass": -6.5,
  "chords": 5.0,
  "pad": 7.5,
  "pluck": 7.5,
  "openhat": 9.0
 }
};
Object.keys(MIX_CAL).forEach(genre => {
  if (typeof TEMPLATES === "undefined" || !TEMPLATES[genre]) return;
  Object.keys(MIX_CAL[genre]).forEach(track => { TEMPLATES[genre].mix[track] = +(TEMPLATES[genre].mix[track] + MIX_CAL[genre][track]).toFixed(1); });
});
