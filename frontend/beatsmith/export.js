// =====================================================================
// Download: renders the whole song faster than real time and saves a WAV.
//
// It builds a second copy of the audio engine inside Tone.Offline, plays every bar of the
// song into it with the same mix, swing, humanize and effects you are hearing, and encodes
// the result. Nothing here touches the live player.
// =====================================================================

const EXPORT_TAIL_SECONDS = 4;          // room for the reverb and the last chord to ring out

// settings = {
//   trim, autos          : dB per track (your faders + the auto-mix)
//   masterDb             : the auto-mix master level in dB      masterStripDb : the master fader
//   masteringOn, vocalSpaceOn, sidechainOn, humanize, swing, isAudible(name)
// }
async function renderSongBuffer(beat, settings) {
  const template = resolveTemplate(beat.genre, beat.style);
  const stepSec = 60 / beat.bpm / 4;
  const barSec = stepSec * 16;
  const lead = 0.05;                                          // a hair of silence before bar 1
  const duration = lead + beat.totalBars * barSec + EXPORT_TAIL_SECONDS;

  const rendered = await Tone.Offline(async () => {
    const E = createEngine({ live: false, reverbDecay: template.fx.reverb.decay });

    // The same sound and mix as the live player
    E.applySound(beat.sound);
    E.applyFx(template.fx, beat.bpm);
    TRACK_ORDER.forEach(name => {
      E.instruments[name].volume.value = TEMPLATES[beat.genre].mix[name] + settings.trim[name] + settings.autos[name];
      E.pan[name].pan.value = TEMPLATES[beat.genre].pan[name] || 0;
    });
    E.master.gain.value = MASTER_BASE * dbGain(settings.masterDb);
    Tone.getDestination().volume.value = settings.masterStripDb;
    E.vocalEQ.gain.value = settings.vocalSpaceOn ? -3 : 0;
    E.setMastering(settings.masteringOn, true);

    // The reverb builds its tail in the background: wait for it
    try { await E.reverb.ready; } catch (err) { /* old Tone: nothing to wait for */ }
    await new Promise(resolve => setTimeout(resolve, 120));

    const ctx = {
      template, beat, view: null, stepSec, swing: settings.swing, humanize: settings.humanize,
      sidechainOn: settings.sidechainOn, isAudible: settings.isAudible, floorTime: 0, lastWhen: {}
    };

    // Play every bar of the song at its exact time
    for (let bar = 0; bar < beat.totalBars; bar++) {
      ctx.view = barView(beat, bar, true);
      const barStart = lead + bar * barSec;
      playBarStart(E, ctx, barStart);
      for (let step = 0; step < 16; step++) {
        const time = barStart + step * stepSec;
        TRACK_ORDER.forEach(trackName => playTrackStep(E, ctx, trackName, step, time));
      }
    }
  }, duration, 2);

  return rendered.get();                                      // an AudioBuffer
}

// ---------- WAV encoding ----------
// bits: 16 or 24. Trailing silence is trimmed (a short tail is kept).
function encodeWav(audioBuffer, bits) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const rate = audioBuffer.sampleRate;
  const data = [];
  for (let c = 0; c < channels; c++) data.push(audioBuffer.getChannelData(c));

  // Find the end of the sound (anything louder than about -80 dB), keep a quarter second after it
  let end = audioBuffer.length - 1;
  while (end > 0 && Math.abs(data[0][end]) < 1e-4 && Math.abs(data[channels - 1][end]) < 1e-4) end--;
  const frames = Math.min(audioBuffer.length, end + Math.floor(rate * 0.25));

  const bytes = bits / 8;
  const dataSize = frames * channels * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const text = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };

  text(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, channels, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * bytes, true); view.setUint16(32, channels * bytes, true);
  view.setUint16(34, bits, true);
  text(36, "data"); view.setUint32(40, dataSize, true);

  let offset = 44;
  const max = bits === 24 ? 8388607 : 32767;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let s = Math.max(-1, Math.min(1, data[c][i]));
      // 16-bit gets a touch of TPDF dither so quiet tails do not sound gritty
      if (bits === 16) s += (Math.random() - Math.random()) / 32768;
      const v = Math.round(Math.max(-1, Math.min(1, s)) * max);
      if (bits === 24) {
        view.setUint8(offset, v & 255);
        view.setUint8(offset + 1, (v >> 8) & 255);
        view.setUint8(offset + 2, (v >> 16) & 255);
      } else {
        view.setInt16(offset, v, true);
      }
      offset += bytes;
    }
  }
  return { blob: new Blob([buffer], { type: "audio/wav" }), seconds: frames / rate, bytes: buffer.byteLength };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function exportFileName(beat) {
  const key = beat.key.rootName + (beat.key.scale === "major" ? "maj" : beat.key.scale === "dorian" ? "dor" : "min");
  return `beatsmith-${beat.styleName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${beat.bpm}bpm-${key}.wav`;
}

if (typeof module !== "undefined") module.exports = { encodeWav, exportFileName };
