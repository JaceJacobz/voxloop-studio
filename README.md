# Voxloop Studio (VL Studio)

Full browser-based music production: **generate beats → record / import vocals → analyze → clean → pitch-correct → mix → master**.

## Modes

| Mode | What it is |
|------|------------|
| **Beat Lab** | Former Beatsmith — procedural beat generation (Afrobeats, R&B, etc.), arrangement, humanize, auto-mix, WAV download |
| **Pipeline** | Former Vocal Vault pipeline — Upload → Align → Analyze → Clean → Tune → Mix |
| **Studio** | Multi-lane DAW — record / import vocals on a beat, send composite to Pipeline |

## Handoff

1. In **Beat Lab**, generate a beat.
2. **Download full beat (WAV)** — standalone instrumental.
3. **Send to Pipeline** — renders the beat and loads it as the instrumental; upload a vocal and continue the steps.
4. **Open in Studio** — loads the beat as the session instrumental; add vocal lanes, record, then *Send mix to Pipeline*.

## Run

Serve the folder over HTTP (required for modules / AudioContext on some browsers):

```bash
cd voxloop-studio
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Structure

```
index.html          Unified shell (3 modes)
css/style.css       Voxloop design system + Beat Lab
js/                 Engines (Vocal Vault + Beatsmith + beatlab bridge)
lib/Tone.js         Beatsmith audio engine dependency
assets/logo.png
```

## Brand

- Full name: **Voxloop Studio**
- Short: **VL Studio**

## Step 6 — FX Rack + Auto-produce (Studio mode)

New files: `js/fxrack-dsp.js` (plugins), `js/fxbrain.js` (Auto), `js/fxrack.js` (panel, preview, pitch editor), `css/fxrack.css`.
Small edits: `js/daw.js` (clip ids, afterRender hook, getters + `api`, stereo-aware composite/WAV), `index.html` (css + 3 script tags).

Drag across a vocal clip to select a part (tap = whole clip) → pick a Quick start or plugins → Preview loops it over the beat
(Original / With effects) → Apply bakes it into that part only (Undo last / Back to original clip).
Plugins: VL Tune, VL Pitch Editor, VL EQ, VL Comp, VL De-Esser, VL Warmth, VL Limiter, VL Imager, VL Doubler, VL Crowd,
VL Hall, VL Echo (tail-end throw), VL Orbit, VL Voice Change. Easy / Pro switch in the panel header.

## Step 7 — UI polish
New: `js/studioui.js`, `css/ui-polish.css`. Edited: `index.html` (workspace tabs, 2 tags), `js/daw.js` (hooks).
- Workspace tabs (Beat Lab / Studio / Pipeline): icon tabs with an underline, peers rather than a step flow. Simple/Pro is smaller.
- Recording: live bar waveform in the armed lane (dB scale; teal good, amber loud, red clipping), dB readout + peak hold, timeline follows you.
- Ruler now scrolls with the lanes; playhead line runs through all lanes.
- Recorded clips use the same bar waveform.
- Fix: a take is no longer discarded when the beat ends (or a loop restarts) while recording.

## Step 8 — Volume automation + Reference & versions
New: `js/automation.js`, `js/reference.js`; styles appended to `css/ui-polish.css`.
Edited: `js/daw.js` (automation in playback / lane render / composite / lead reference, `renderMix()`, extra `api`), `js/fxrack.js` (`addPlugin`, Auto-ride option), `index.html` (2 script tags).
- ∿ button on each vocal lane opens a Volume row: tap to add points, drag, double-tap/right-click/long-press to delete, Fade in/out, ✨ Auto-ride, ↶ undo, Clear. Used live in playback, in the reference render and in "Send mix to Pipeline".
- 🎯 Reference: load a reference song, Save version (v1..v5), switch between Current mix / versions / reference at equal loudness; tone, loudness, width and punch comparison with plain-language tips and one-tap FX Rack fixes.

## Step 9 — Brain v2 (Auto decides from the vocal AND the beat)
Rewritten: `js/fxbrain.js`. Edited: `js/fxrack.js` (vibe line, "I hear" line, intensity Subtle/Normal/Lots, tap an extra to hear it), `css/ui-polish.css`.
- Beat: tempo, key, big sections, plus energy, brightness, low-end weight, how full it is, how much room it leaves (space), and the Pipeline's own genre sensor.
- Vocal: pitch range, sung / mixed / rapped, noise, clipping, room sound, and a take-quality score (rough takes get gentler boosts).
- Every setting is now computed: tune speed, de-ess strength, EQ (target curve + what the beat is crowding), compressor timing (tempo) and makeup, reverb size / amount / colour, widths.
- Extras are placed from the vocal's pauses and the beat's big moments, with echo time fitted to each pause.

## Step 12 — Phone layout, icons, and the ambience fix
New: `js/icons.js` (icon set, loaded first), `css/mobile.css` (loaded last). Edited: many small spots (emoji and symbol icons replaced with SVG icons), `index.html`, `js/studioui.js`, `js/automix-vv.js`, `js/studio.js`, `js/mixbrain.js`, `js/fxrack.js`, `js/automation.js`, `js/reference.js`.
- Phone: Studio is a slim mobile-DAW layout (icon toolbar strip, compact lanes with a "more" menu, one-row transport, FX Rack / Reference as bottom sheets). Beat Lab no longer overflows the screen. The Pipeline's bottom "Continue" bar hides while the in-page Continue button is visible, so it never shows twice.
- No emoji anywhere: every icon is inline SVG (`VLI("name")`).
- Mixing and mastering: the quiet-gap cleaner never touches a stretch where the beat is playing and lets go slowly; the phrase gate is shallower and slower (shaped by the beat); new calculated "Ambience between lines" option (default Auto) swells a soft wash after each line so the song keeps breathing when the singer stops.
- Fixed: the Auto tab's panel was painted solid violet (a class-name clash).

## Step 13 — Less "Voloco", more natural vocals
Edited: `js/fxrack-dsp.js`, `js/fxbrain.js`, `js/pitchcorrect.js`, `index.html`.
- Studio VL Tune used to snap EVERY note onto the grid by default (Flex-Tune 0, Humanize 0): on a test vocal ~80% of the singing
  ended up within 10 cents of a scale note, the same as the "Hard (T-Pain)" preset. Defaults are now retune 60 ms, Flex-Tune 40
  (notes within ~24 cents are left as sung), Humanize 40. The Hard preset is unchanged.
- The "Natural vibrato kept" knob actually ADDED a synthetic vibrato to held straight notes. It is now "Added vibrato (straight notes)",
  default 0 in the rack and in Auto; the Pipeline's "Natural" option adds about half as much as before.
- Auto (Studio): house retune speeds raised (afrobeats / amapiano / universal 55 ms, rnb 75, rap 50, trap 18), every style uses Flex-Tune,
  humanize raised. Pipeline Auto follows the same table; the Pipeline retune slider starts at 50 ms.
- Reverb predelay: Studio default 63 ms -> 30 ms; Auto 18-80 ms -> 16-38 ms (past ~40 ms the room is heard as a separate repeat).

## Step 14 — Better detection + the Music Brain

Everything that listens to a beat or a vocal was measured against 48 beats rendered by the Beat Lab (so key, tempo and style are known),
then improved. New file: `js/musictheory.js` (plain JS, also runs in Node). It is a **rule-based music-knowledge engine**, not a language
model: it knows scales and modes, chord roles, and how fast each style is played, and uses that to check what the detectors hear.

- **Beat key** (`MusicTheory.analyzeKey`, used by `detectKey`; the old detector stays as fallback):
  tuning is estimated first (so a beat that is 40 cents off pitch still reads correctly), drums are filtered out of the spectrum,
  the 7-note set is chosen, then the home note from the bass notes, chord loop, first chord and chord roles. Reports the mode
  (e.g. "D dorian feel") and the chord loop in Roman numerals (e.g. `i - VI - III - VII`). When a loop only plays two chords and several
  keys fit, common chord roles (vi-IV, not iii-I) break the tie. The key spelling always keeps the right 7 notes for pitch correction.
- **Beat tuning** (the "tuned to the beat, not A = 440" reference): measured on the pitched sound only, accurate to about 1 cent.
- **Tempo**: half/double-time is settled by the style's normal count (`MusicTheory.reconcileTempo`): slow-jam R&B is shown at 68, not 136;
  trap at 140, not 70. Only applied when the style call is confident, and never to a tempo the Beat Lab or the user set.
- **Bar start (beat 1)**: the fill engine now also looks at where the *chords change* (pitch content before vs after each beat), not
  only where drums hit. Correct bar phase went from 18 of 48 to 26 of 48 beats (off-beat anticipations in Afro grooves are still hard).
- **Genre**: fingerprints re-calibrated against what the sensor really measures; hand percussion (congas) is now used as evidence;
  the rule that kept calling Afropop "universal" was loosened. `classifyFeatures()` is a pure function so it can be tested without audio.
- **Vocal key** (when the beat's key is unknown): the singer's overall tuning offset is removed first, held notes count by duration, and
  the notes phrases come to rest on decide the home note.

How well it works is measured on synthetic Beat Lab beats only (Afrobeats and R&B). Real recordings will differ: treat the numbers as a
regression check, not a promise.

## Step 15 — Exact key landing + no "ocean" noise after tuning

**1. The tuner now lands every note exactly on the key it names.** The softer settings added in Step 13 left notes within about 24 cents of a
scale note untouched, so the median sung note ended up 14-17 cents off the key (measured). Changed:
- Flex-Tune default 40 → 6 (notes within 4 cents are left as sung; everything else is pulled onto the key). Natural preset 8, Modern pop 4.
- Auto (Studio) and the Pipeline's auto settings use the same tight 4-6 cent zone. The "adaptive" logic used to widen that zone for rough
  takes (12-34 cents), so the rougher the singing the less it was fixed; it can no longer loosen it.
- Auto no longer skips tuning because a take is "within a quarter-tone"; it skips only when nearly every note is within 10 cents.
- Studio / Auto-mix now tune to the beat's real pitch (the tuning offset measured from the beat), not only to A = 440, so a beat that sits
  20 cents sharp still gets a vocal that is in tune with it.
- Speed (retune ms) and Humanize still control how the note is *reached*, so the glide between notes stays natural; they no longer decide
  whether the note lands on the key.

**2. Noise cleanup after retuning (`cleanNoise` in `pitchcorrect.js`, "Noise cleanup" on VL Tune).** Shifting pitch re-spaces tiny grains of the
voice, which brought room noise back a few dB louder and swishy *only while the singer sings* (the gaps were untouched), so the singer seemed
to bring the noise. After tuning, the noise between the voice's harmonics is now lowered using the note's own tracked pitch (the harmonics are
left alone), plus a light broad noise cut learned from the quiet gaps (fading out above 5 kHz so S sounds and air are kept). It switches itself off
when the take has no clear gap or is already clean. Default 60% = 10 dB between harmonics, 3 dB broad.

Measured on synthetic sung vocals (not by ear): sung-note noise 4-10 dB louder than the gaps before, about level with them now; voice peaks
unchanged (0.07 dB); S sounds 1-2 dB lower; note centres median 2 cents from the key, 98-100% within 10 cents on every path.


## Step 16 — Voice type, plugin accuracy, VL Harmony, bar-start fix

Everything below was measured with the scripts in `tests/` (run with `node tests/<name>.test.js`). They use **synthetic** voices and beats
(`tests/synth-voice.js`, `tests/synth-beat.js`): treat them as regression checks, not a promise about real recordings.

**1. Voice type (`js/voiceid.js`, new).** The brain used to call a voice low / mid / high from one number (median pitch) and sung / rapped from
the share of held notes. Now it measures: pitch range (low edge, median), the voice's *own* S-sound frequency (4-10 kHz), how clean the harmonics
are (breathiness), and sung / mixed / rapped from held notes + pitch plateaus + syllables per second. Every voice-dependent setting follows a
measurement: low cut = 0.62 x the lowest note, de-esser centre = the measured S frequency, presence centre from it, air held back on breathy takes.
It reports a **confidence**; under 50% the brain uses neutral settings (and an unsure "rapped" can no longer switch tuning off). The Auto panel has a
**Voice** row (Auto / Sung / Rapped / Low / Mid / High) to correct a wrong call in one tap. Findings now say what was detected and how sure it is.
Measured on 11 synthetic voices (bass to soprano, sung and rapped): sung/rapped right on 11/11; the S frequency lands within ~200 Hz.
Known limits: pitch alone cannot separate a high male voice from a low female one, so the middle bands say "tenor / low alto" instead of guessing
(a formant-based voice-size estimate was tried and **removed**: the same synthetic vocal tract read 1.03 to 1.21 depending on the pitch sung).
Alternating sung and rapped lines read "mixed", fast short sung notes can still look sung only because they are held.

**2. Plugin accuracy.** Found by measuring each plugin, then fixed:
- **VL Comp** under-compressed (it read raw sample values, so the gain recovered between waveform peaks): at 4:1, -2 dB in gave -14.3 instead of -15.5. Now a peak-hold detector; the curve is within 0.1 dB.
- **Limiter** let the first few ms of any audio through (a loud start passed at +5.4 dB with a -1 dB ceiling). Fixed; also fixes the master.
- Checked and fine: de-esser (3/6/9 dB setting cuts the S by 2.98/5.94/8.89 dB, leaves vowels untouched), delay timing (250.0 ms at 1/8 and 120 BPM), imager, orbit, master true-peak (never above -1 dB on 4 test mixes).
- Not testable in Node (need a browser audio engine): EQ, Hall, Doubler, Crowd. Listen to those.

**3. VL Harmony (new plugin, category Pitch).** There was no plugin called "path"; this was read as "pitch" and adds the missing pitch tool: up to three backing voices, each moved by
*scale steps* (3rd, 4th, 5th, 6th, octave, above or below) in the beat's key, so a harmony cannot land on a wrong note (tested: every note in A minor, exact intervals).
Auto can place it in the big sections only (flavour "Key-locked backing harmonies"), never on a rapped vocal or an unknown key; high voices get the part below.
If the plugin meant something else (phaser, pan, pad, gate...), say which.

**4. Bar start (beat 1).** On synthetic beats the grid could lock half a beat late on off-beat Afro grooves (hats on the "and"). Now chord changes decide: the grid moves half a beat
only when the chord changes are clearly sharper there and concentrated on one beat of the bar (a drums-only beat is left alone).
Measured (24 beats each, original -> now): normal 20 -> 23, chords every 2 bars 20 -> 23, noisy 24 -> 24, drums only 14 -> 14. An attempt using kick/bass evidence was worse and was dropped.

**5. Still open (measured, not fixed).** Major two-chord loops (I-IV, e.g. C - F) are called the wrong key (F major) on all 6 test keys; a change that let the home-note evidence choose between the tied
key sets fixed none of them and broke minor two-chord loops (6/6 -> 2/6), so it was **not** shipped. Minor two-chord loops and every four-chord loop are right (`tests/key.test.js`).
The original 48-beat Beat Lab set is not in this zip, so the 26/48 figure above could not be re-measured; the numbers here are from my own synthetic beats.
